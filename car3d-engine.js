import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.17.3/+esm";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PALETTES = {
  sunset: { sky: 0xb8d3e9, fog: 0xc8d8df, grass: 0x47794b, road: 0x303943, rail: 0xd9e1e9, sun: 0xffdfb0, wet: false },
  coast:  { sky: 0x83c9e3, fog: 0xc4e3e9, grass: 0x4f9565, road: 0x454e56, rail: 0xf0eee4, sun: 0xfff1c7, wet: false },
  night:  { sky: 0x091425, fog: 0x15263a, grass: 0x183c34, road: 0x171e28, rail: 0x5b819c, sun: 0x9ac8ff, wet: false },
  rain:   { sky: 0x4c5d6c, fog: 0x647581, grass: 0x34564a, road: 0x202e3b, rail: 0x91a8b8, sun: 0xb6d4e5, wet: true }
};

function vec3(x, y, z) { return { x, y, z }; }
function rotateLocal(v, q) {
  const x = v.x, y = v.y, z = v.z;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx
  };
}
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(v, n) { return { x: v.x * n, y: v.y * n, z: v.z * n }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function length(v) { return Math.hypot(v.x, v.y, v.z); }
function normalise(v) { const n = Math.max(1e-6, length(v)); return scale(v, 1 / n); }

export async function createCarGame3D(canvas, callbacks = {}) {
  await RAPIER.init();
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: "high-performance"
  });
  const mobileGPU = matchMedia("(max-width: 760px)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  // Desktop can render at high-DPI / 4K-ready resolution; mobile stays conservative.
  const maxPixelRatio = mobileGPU ? 1.5 : 2.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 420);
  camera.position.set(0, 5, 10);
  scene.background = new THREE.Color(PALETTES.sunset.sky);
  scene.fog = new THREE.Fog(PALETTES.sunset.fog, 70, 240);

  const hemi = new THREE.HemisphereLight(0xd8eaff, 0x4a5a45, 2.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffedcf, 3.0);
  sun.position.set(-45, 75, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobileGPU ? 512 : 1024, mobileGPU ? 512 : 1024);
  sun.shadow.camera.left = -100; sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100; sun.shadow.camera.bottom = -100;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const fixedBodies = [];
  const disposableGeometries = new Set();
  const disposableMaterials = new Set();
  const tempV3 = new THREE.Vector3();
  const tempV3b = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  let disposed = false;
  let running = false;
  let paused = true;
  let frameId = 0;
  let lastFrame = 0;
  let accumulator = 0;
  let controls = { steer: 0, throttle: false, brake: false, boost: false };
  let sceneName = "sunset";
  let carColour = "#28bfea";
  let speed = 0, score = 0, best = 0, damage = 0, nearMisses = 0, nitro = 100;
  let hitCooldown = 0;
  let offRoad = false;
  let lastTelemetryAt = 0;
  let traffic = [];
  let trees = [];
  let roadObjects = [];
  let trackCurve;
  let carBody, carCollider, carRoot, frontWheels = [], allWheels = [];
  let engineForce = 0;
  const maxSpeed = 52;
  const fixedStep = 1 / 60;

  function material(colour, roughness = 0.7, metalness = 0) {
    const m = new THREE.MeshStandardMaterial({ color: colour, roughness, metalness });
    disposableMaterials.add(m);
    return m;
  }
  function geometry(g) { disposableGeometries.add(g); return g; }
  function mesh(geo, mat, parent = scene) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const groundMat = material(0x47794b);
  const asphaltMat = material(0xffffff, 0.82);
  // Generate a subtle asphalt microtexture locally: no texture download or API needed.
  const asphaltCanvas = document.createElement("canvas");
  asphaltCanvas.width = 256; asphaltCanvas.height = 1024;
  const asphaltContext = asphaltCanvas.getContext("2d", { alpha: false });
  const asphaltPixels = asphaltContext.createImageData(asphaltCanvas.width, asphaltCanvas.height);
  for (let i = 0; i < asphaltPixels.data.length; i += 4) {
    const grain = 176 + Math.random() * 48;
    asphaltPixels.data[i] = grain;
    asphaltPixels.data[i + 1] = grain + 2;
    asphaltPixels.data[i + 2] = grain + 5;
    asphaltPixels.data[i + 3] = 255;
  }
  asphaltContext.putImageData(asphaltPixels, 0, 0);
  for (let i = 0; i < 42; i++) {
    asphaltContext.fillStyle = i % 3 ? "rgba(220,230,236,.06)" : "rgba(0,0,0,.10)";
    asphaltContext.fillRect(Math.random() * 256, Math.random() * 1024, 1 + Math.random() * 2, 3 + Math.random() * 18);
  }
  const asphaltTexture = new THREE.CanvasTexture(asphaltCanvas);
  asphaltTexture.wrapS = THREE.RepeatWrapping; asphaltTexture.wrapT = THREE.RepeatWrapping;
  asphaltTexture.repeat.set(1, 1); asphaltTexture.colorSpace = THREE.SRGBColorSpace;
  asphaltMat.map = asphaltTexture; asphaltMat.needsUpdate = true;
  const laneMat = material(0xe6e8e9, 0.65);
  const railMat = material(0xd9e1e9, 0.48, 0.45);
  const darkRailMat = material(0x354552, 0.62, 0.25);
  const treeMats = [material(0x234c34), material(0x31633c), material(0x497a45)];
  const trunkMat = material(0x574638);
  const trafficMats = [material(0xf05d51, 0.34, 0.25), material(0xe7b64c, 0.38, 0.2), material(0x8398e9, 0.32, 0.28), material(0xf2f4f5, 0.34, 0.22), material(0x56b98c, 0.38, 0.2)];
  const tyreMat = material(0x171b20, 0.95);
  const rimMat = material(0xb8c9d7, 0.28, 0.75);
  const glassMat = material(0x18374a, 0.22, 0.55);
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xeaf7ff, emissive: 0x8ed8ff, emissiveIntensity: 1.8 });
  const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff463d, emissive: 0xe51e17, emissiveIntensity: 1.5 });
  disposableMaterials.add(headlightMat); disposableMaterials.add(tailLightMat);

  const ground = mesh(geometry(new THREE.PlaneGeometry(360, 360)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.18;
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(180, 0.18, 180).setFriction(1.25), groundBody);
  fixedBodies.push(groundBody);

  // Closed, gently undulating oval circuit. A mesh road, painted lane markings,
  // and rigid guardrails share the same sampled centerline.
  trackCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-45, 0, -18), new THREE.Vector3(-34, 0, -44),
    new THREE.Vector3(-6, 0, -53), new THREE.Vector3(28, 0, -45),
    new THREE.Vector3(49, 0, -20), new THREE.Vector3(47, 0, 16),
    new THREE.Vector3(24, 0, 43), new THREE.Vector3(-12, 0, 48),
    new THREE.Vector3(-43, 0, 28), new THREE.Vector3(-52, 0, 2)
  ], true, "centripetal");
  const trackSamples = Array.from({ length: 120 }, (_, i) => trackCurve.getPointAt(i / 120));
  const roadWidth = 13.5;
  const roadSegments = 260;
  const roadPositions = [], roadUvs = [], roadIndices = [];
  const leftEdge = [], rightEdge = [];
  for (let i = 0; i <= roadSegments; i++) {
    const t = i / roadSegments;
    const p = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const l = p.clone().addScaledVector(normal, roadWidth / 2);
    const r = p.clone().addScaledVector(normal, -roadWidth / 2);
    leftEdge.push(l); rightEdge.push(r);
    roadPositions.push(l.x, 0.015, l.z, r.x, 0.015, r.z);
    roadUvs.push(0, t * 36, 1, t * 36);
    if (i < roadSegments) {
      const a = i * 2;
      // Winding is upward-facing so the asphalt renders and collides from above.
      roadIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const roadGeo = geometry(new THREE.BufferGeometry());
  roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute("uv", new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();
  const road = mesh(roadGeo, asphaltMat);
  road.receiveShadow = true;
  // The visible asphalt is also a real collision surface; the broad ground plane
  // remains the recovery surface when the player leaves the circuit.
  const roadBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const roadCollider = RAPIER.ColliderDesc.trimesh(new Float32Array(roadPositions), new Uint32Array(roadIndices))
    .setFriction(1.15).setRestitution(0.015);
  world.createCollider(roadCollider, roadBody);
  fixedBodies.push(roadBody);

  // Render hundreds of guardrail segments with instancing to keep draw calls low.
  // Collision rail bodies remain separate so impacts still use the physics engine.
  const railSegmentLength = trackCurve.getLength() / roadSegments * 3.15;
  const railGeo = geometry(new THREE.BoxGeometry(0.28, 0.42, railSegmentLength));
  const railInstanceCapacity = Math.ceil(roadSegments / 3) * 2;
  const railInstances = [
    new THREE.InstancedMesh(railGeo, railMat, railInstanceCapacity),
    new THREE.InstancedMesh(railGeo, darkRailMat, railInstanceCapacity)
  ];
  const railInstanceCounts = [0, 0];
  railInstances.forEach(instance => { instance.castShadow = true; instance.receiveShadow = true; scene.add(instance); });
  const railDummy = new THREE.Object3D();
  for (let i = 0; i < roadSegments; i += 3) {
    const p = trackCurve.getPointAt((i + 1.5) / roadSegments);
    const tangent = trackCurve.getTangentAt((i + 1.5) / roadSegments).normalize();
    const yaw = Math.atan2(-tangent.x, -tangent.z);
    for (const side of [-1, 1]) {
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const railPos = p.clone().addScaledVector(normal, side * (roadWidth / 2 + 0.38));
      railPos.y = 0.48;
      const materialIndex = i % 2 ? 0 : 1;
      railDummy.position.copy(railPos);
      railDummy.rotation.set(0, yaw, 0);
      railDummy.scale.set(1, 1, 1);
      railDummy.updateMatrix();
      const instanceIndex = railInstanceCounts[materialIndex]++;
      railInstances[materialIndex].setMatrixAt(instanceIndex, railDummy.matrix);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(railPos.x, railPos.y, railPos.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.14, 0.21, railSegmentLength / 2).setFriction(0.9).setRestitution(0.08), body);
      fixedBodies.push(body);
    }
  }
  railInstances.forEach((instance, i) => {
    instance.count = railInstanceCounts[i];
    instance.instanceMatrix.needsUpdate = true;
    instance.computeBoundingSphere();
  });

  // Lane dashes share one geometry and one draw call instead of dozens of meshes.
  const dashGeo = geometry(new THREE.BoxGeometry(0.16, 0.025, 1.25));
  const dashCount = 65;
  const dashInstances = new THREE.InstancedMesh(dashGeo, laneMat, dashCount);
  dashInstances.castShadow = false; dashInstances.receiveShadow = true;
  const dashDummy = new THREE.Object3D();
  let dashIndex = 0;
  for (let i = 0; i < 130; i += 2) {
    const t = i / 130;
    const p = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t).normalize();
    dashDummy.position.set(p.x, 0.045, p.z);
    dashDummy.rotation.set(0, Math.atan2(-tangent.x, -tangent.z), 0);
    dashDummy.updateMatrix();
    dashInstances.setMatrixAt(dashIndex++, dashDummy.matrix);
  }
  dashInstances.instanceMatrix.needsUpdate = true;
  dashInstances.computeBoundingSphere();
  scene.add(dashInstances);

  // Roadside scenery: varied tree silhouettes and distant low-poly hills.
  const hillMat = material(0x607d67);
  const hillMat2 = material(0x718b79);
  const hillGeo = geometry(new THREE.ConeGeometry(1, 1, 7));
  const hillCapacity = 22;
  const hillInstances = [
    new THREE.InstancedMesh(hillGeo, hillMat, hillCapacity),
    new THREE.InstancedMesh(hillGeo, hillMat2, hillCapacity)
  ];
  const hillCounts = [0, 0];
  const hillDummy = new THREE.Object3D();
  for (const instance of hillInstances) { instance.castShadow = false; instance.receiveShadow = true; scene.add(instance); }
  for (let i = 0; i < 44; i++) {
    const angle = i * 2.39996;
    const radius = 65 + (i % 7) * 7;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const h = 7 + (i % 5) * 2.2;
    const hillRadius = 8 + (i % 4) * 2;
    const materialIndex = i % 2 ? 0 : 1;
    hillDummy.position.set(x, h / 2 - 0.1, z);
    hillDummy.rotation.set(0, angle, 0);
    hillDummy.scale.set(hillRadius, h, hillRadius);
    hillDummy.updateMatrix();
    hillInstances[materialIndex].setMatrixAt(hillCounts[materialIndex]++, hillDummy.matrix);
  }
  hillInstances.forEach((instance, i) => {
    instance.count = hillCounts[i];
    instance.instanceMatrix.needsUpdate = true;
    instance.computeBoundingSphere();
  });
  // Instanced tree geometry preserves varied shapes while keeping mobile draw calls low.
  const treeCount = 100;
  const trunkGeo = geometry(new THREE.CylinderGeometry(0.13, 0.22, 1.8, 6));
  const leavesGeo = geometry(new THREE.ConeGeometry(0.95, 2.7, 7));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const leafInstances = treeMats.map(mat => new THREE.InstancedMesh(leavesGeo, mat, Math.ceil(treeCount / 3)));
  trunks.castShadow = true; trunks.receiveShadow = true;
  trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  leafInstances.forEach(instance => { instance.castShadow = true; instance.receiveShadow = true; instance.instanceMatrix.setUsage(THREE.StaticDrawUsage); scene.add(instance); });
  scene.add(trunks);
  const treeDummy = new THREE.Object3D();
  const leafCounts = [0, 0, 0];
  for (let i = 0; i < treeCount; i++) {
    const t = (i * 0.61803398875) % 1;
    const p = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const side = i % 2 ? 1 : -1;
    p.addScaledVector(normal, side * (10 + (i % 6) * 2.1));
    const scaleFactor = 0.75 + (i % 5) * 0.12;
    treeDummy.position.set(p.x, 0.9 * scaleFactor, p.z);
    treeDummy.rotation.set(0, 0, 0);
    treeDummy.scale.setScalar(scaleFactor);
    treeDummy.updateMatrix();
    trunks.setMatrixAt(i, treeDummy.matrix);
    const materialIndex = i % treeMats.length;
    treeDummy.position.y = 2.45 * scaleFactor;
    treeDummy.updateMatrix();
    leafInstances[materialIndex].setMatrixAt(leafCounts[materialIndex]++, treeDummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  trunks.computeBoundingSphere();
  leafInstances.forEach((instance, i) => {
    instance.count = leafCounts[i];
    instance.instanceMatrix.needsUpdate = true;
    instance.computeBoundingSphere();
  });

  function makeCarModel(colour, isPlayer = false) {
    const group = new THREE.Group();
    const paint = material(colour, 0.28, 0.62);
    const bodyGeo = geometry(new THREE.BoxGeometry(1.92, 0.48, 3.8));
    const body = mesh(bodyGeo, paint, group);
    body.position.y = 0.55;
    const hood = mesh(geometry(new THREE.BoxGeometry(1.78, 0.18, 1.2)), paint, group);
    hood.position.set(0, 0.78, -1.02);
    const rear = mesh(geometry(new THREE.BoxGeometry(1.68, 0.13, 0.62)), paint, group);
    rear.position.set(0, 0.83, 1.42);
    const cabin = mesh(geometry(new THREE.BoxGeometry(1.42, 0.48, 1.72)), glassMat, group);
    cabin.position.set(0, 0.95, 0.12);
    const roof = mesh(geometry(new THREE.BoxGeometry(1.34, 0.1, 1.18)), paint, group);
    roof.position.set(0, 1.22, 0.05);
    const wheelGeo = geometry(new THREE.CylinderGeometry(0.39, 0.39, 0.27, 16));
    const wheels = [];
    for (const x of [-0.94, 0.94]) for (const z of [-1.23, 1.23]) {
      const wheel = mesh(wheelGeo, tyreMat, group);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.03, z);
      const rim = mesh(geometry(new THREE.CylinderGeometry(0.21, 0.21, 0.285, 12)), rimMat, group);
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(wheel.position);
      wheels.push({ wheel, rim, front: z < 0, x, z });
    }
    for (const x of [-0.62, 0.62]) {
      const head = mesh(geometry(new THREE.BoxGeometry(0.38, 0.11, 0.09)), headlightMat, group);
      head.position.set(x, 0.63, -1.93);
      const tail = mesh(geometry(new THREE.BoxGeometry(0.38, 0.11, 0.09)), tailLightMat, group);
      tail.position.set(x, 0.64, 1.93);
    }
    const frontBumper = mesh(geometry(new THREE.BoxGeometry(1.78, 0.13, 0.16)), darkRailMat, group);
    frontBumper.position.set(0, 0.32, -1.88);
    const rearBumper = mesh(geometry(new THREE.BoxGeometry(1.76, 0.13, 0.16)), darkRailMat, group);
    rearBumper.position.set(0, 0.32, 1.88);
    for (const side of [-1, 1]) {
      const mirror = mesh(geometry(new THREE.BoxGeometry(0.18, 0.11, 0.2)), paint, group);
      mirror.position.set(side * 0.98, 0.93, -0.62);
    }
    const rearLip = mesh(geometry(new THREE.BoxGeometry(1.4, 0.07, 0.24)), paint, group);
    rearLip.position.set(0, 0.95, 1.56);
    if (isPlayer) {
      const glow = new THREE.PointLight(0x79dfff, 1.3, 9);
      glow.position.set(0, 0.6, -2.2);
      group.add(glow);
    }
    scene.add(group);
    return { group, wheels, paint };
  }
  const playerModel = makeCarModel(carColour, true);
  carRoot = playerModel.group;
  allWheels = playerModel.wheels;
  frontWheels = allWheels.filter(w => w.front);

  function buildTraffic() {
    traffic.forEach(item => {
      scene.remove(item.model.group);
      world.removeRigidBody(item.body);
    });
    traffic = [];
    const trafficColours = ["#ed6a5e", "#e7bd58", "#8496df", "#e9edf1", "#5fbd91", "#d69ae8"];
    for (let i = 0; i < 12; i++) {
      const t = (0.07 + i * 0.071) % 1;
      const p = trackCurve.getPointAt(t);
      const tangent = trackCurve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const side = i % 2 ? 1.8 : -1.8;
      p.addScaledVector(normal, side);
      const yaw = Math.atan2(-tangent.x, -tangent.z);
      const model = makeCarModel(trafficColours[i % trafficColours.length]);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      model.group.position.set(p.x, 0.35, p.z);
      model.group.quaternion.copy(q);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(p.x, 0.9, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
      const collider = RAPIER.ColliderDesc.cuboid(0.94, 0.35, 1.8).setFriction(0.8).setRestitution(0.05);
      world.createCollider(collider, body);
      traffic.push({ model, body, t, lane: side, cruiseSpeed: 5.5 + (i % 4) * 1.8, hit: false, passed: false, nearChecked: false });
    }
  }
  buildTraffic();

  carBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(trackCurve.getPointAt(0).x, 0.9, trackCurve.getPointAt(0).z).setLinearDamping(0.08).setAngularDamping(1.9)
    .setCcdEnabled(true).setCanSleep(false));
  carCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.32, 1.82)
    // Half-extents are used above; this density keeps the chassis near a realistic car mass.
    .setDensity(330).setFriction(0.85).setRestitution(0.01), carBody);
  const staticWheelLoad = carBody.mass() * 9.81 / 4;

  const ambientDust = new THREE.Group();
  scene.add(ambientDust);
  const dustCount = 170;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 130;
    dustPositions[i * 3 + 1] = 0.4 + Math.random() * 10;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 130;
  }
  const dustGeo = geometry(new THREE.BufferGeometry());
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xe5f3ff, size: 0.11, transparent: true, opacity: 0.5 });
  disposableMaterials.add(dustMat);
  const particles = new THREE.Points(dustGeo, dustMat);
  ambientDust.add(particles);

  function setCarColour(colour) {
    carColour = colour;
    if (playerModel.paint) playerModel.paint.color.set(colour);
    if (!running && !disposed) renderer.render(scene, camera);
  }
  function setScene(name) {
    sceneName = PALETTES[name] ? name : "sunset";
    const palette = PALETTES[sceneName];
    scene.background = new THREE.Color(palette.sky);
    scene.fog.color.set(palette.fog);
    groundMat.color.set(palette.grass);
    asphaltMat.color.set(palette.road);
    railMat.color.set(palette.rail);
    sun.color.set(palette.sun);
    sun.intensity = sceneName === "night" ? 0.9 : sceneName === "rain" ? 1.25 : 3.0;
    hemi.intensity = sceneName === "night" ? 0.55 : 2.0;
    dustMat.opacity = sceneName === "rain" ? 0.1 : sceneName === "night" ? 0.24 : 0.42;
    renderer.toneMappingExposure = sceneName === "night" ? 0.86 : 1.12;
    scene.fog.near = sceneName === "night" ? 38 : 70;
    scene.fog.far = sceneName === "night" ? 155 : 240;
    if (callbacks.onScene) callbacks.onScene(sceneName);
    if (!running && !disposed) renderer.render(scene, camera);
  }

  function reset() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    speed = 0; score = 0; damage = 0; nearMisses = 0; nitro = 100;
    hitCooldown = 0; offRoad = false; accumulator = 0; controls = { steer: 0, throttle: false, brake: false, boost: false };
    const startPoint = trackCurve.getPointAt(0);
    carBody.setTranslation({ x: startPoint.x, y: 0.9, z: startPoint.z }, true);
    carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const startTangent = trackCurve.getTangentAt(0).normalize();
    const startYaw = Math.atan2(-startTangent.x, -startTangent.z);
    carBody.setRotation({ x: 0, y: Math.sin(startYaw / 2), z: 0, w: Math.cos(startYaw / 2) }, true);
    traffic.forEach((item, i) => {
      item.hit = false; item.passed = false; item.nearChecked = false;
      const t = (0.07 + i * 0.071) % 1;
      item.t = t;
      const p = trackCurve.getPointAt(t);
      const tangent = trackCurve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      p.addScaledVector(normal, item.lane);
      const yaw = Math.atan2(-tangent.x, -tangent.z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      item.body.setTranslation({ x: p.x, y: 0.9, z: p.z }, true);
      item.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      item.body.setNextKinematicTranslation({ x: p.x, y: 0.9, z: p.z });
      item.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    });
    paused = true; running = false;
    syncVisuals();
    publishTelemetry(performance.now(), true);
    if (!disposed) renderer.render(scene, camera);
  }

  function setControls(next = {}) {
    controls = {
      steer: clamp(Number(next.steer) || 0, -1, 1),
      throttle: !!next.throttle,
      brake: !!next.brake,
      boost: !!next.boost && nitro > 0
    };
  }
  function applyCarPhysics(dt) {
    const pos = carBody.translation();
    const rot = carBody.rotation();
    const lin = carBody.linvel();
    const ang = carBody.angvel();
    const forward = normalise(rotateLocal({ x: 0, y: 0, z: -1 }, rot));
    const right = normalise(rotateLocal({ x: 1, y: 0, z: 0 }, rot));
    const velocity = { x: lin.x, y: lin.y, z: lin.z };
    const longitudinalSpeed = dot(velocity, forward);
    const lateralSpeed = dot(velocity, right);
    speed = Math.max(0, Math.abs(longitudinalSpeed) * 3.6);
    const lateralDrift = Math.abs(lateralSpeed);
    const onTrack = nearestTrackDistance(pos.x, pos.z) < roadWidth * 0.54;
    offRoad = !onTrack;
    const surfaceGrip = onTrack ? (sceneName === "rain" ? 0.58 : 1) : 0.34;
    const boostActive = controls.boost && nitro > 0 && !controls.brake;
    if (boostActive) nitro = Math.max(0, nitro - dt * 28);
    else nitro = Math.min(100, nitro + dt * 7.5);
    const power = controls.throttle ? 6400 : 0;
    const boostPower = boostActive ? 3400 : 0;
    engineForce = power + boostPower;
    if (longitudinalSpeed < (boostActive ? 68 : maxSpeed) && !controls.brake) {
      carBody.addForceAtPoint(scale(forward, engineForce * surfaceGrip), add(pos, rotateLocal({ x: 0, y: -0.18, z: 0.72 }, rot)), true);
    }
    if (controls.brake) {
      carBody.addForceAtPoint(scale(forward, -Math.sign(longitudinalSpeed || 1) * Math.min(10000, 3200 + Math.abs(longitudinalSpeed) * 190)), add(pos, rotateLocal({ x: 0, y: -0.2, z: 0.65 }, rot)), true);
    }
    // Four independent raycast suspension points apply spring/damper and tyre grip
    // at the contact patch. This is a real rigid-body chassis, not screen-space motion.
    const wheelOffsets = [
      { x: -0.76, y: -0.52, z: -1.18, front: true, left: true },
      { x: 0.76, y: -0.52, z: -1.18, front: true, left: false },
      { x: -0.76, y: -0.52, z: 1.18, front: false, left: true },
      { x: 0.76, y: -0.52, z: 1.18, front: false, left: false }
    ];
    // Suspension length is the wheel-centre clearance above the sampled road.
    // Preload each spring with one quarter of vehicle weight to prevent the old
    // zero-load drop / hard spring compression / upward-launch cycle.
    const restLength = 0.39, spring = 22000, damper = 3200;
    for (const wheel of wheelOffsets) {
      const arm = rotateLocal(wheel, rot);
      const wheelPos = add(pos, arm);
      const origin = { x: wheelPos.x, y: wheelPos.y + 0.9, z: wheelPos.z };
      const ray = new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 });
      const hit = world.castRayAndGetNormal(ray, 1.5, true, undefined, undefined, undefined, carBody);
      if (!hit) continue;
      const distance = hit.timeOfImpact;
      if (distance > 1.42) continue;
      const suspensionLength = distance - 0.9;
      const pointVelocity = {
        x: lin.x + ang.y * arm.z - ang.z * arm.y,
        y: lin.y + ang.z * arm.x - ang.x * arm.z,
        z: lin.z + ang.x * arm.y - ang.y * arm.x
      };
      const springForce = clamp(staticWheelLoad + (restLength - suspensionLength) * spring - pointVelocity.y * damper, 0, 9000);
      const contactPoint = { x: origin.x, y: origin.y - distance, z: origin.z };
      carBody.addForceAtPoint({ x: 0, y: springForce, z: 0 }, contactPoint, true);
      let wheelForward = forward;
      if (wheel.front) {
        const steerYaw = -controls.steer * 0.48;
        const steerQuat = { x: 0, y: Math.sin(steerYaw / 2), z: 0, w: Math.cos(steerYaw / 2) };
        wheelForward = normalise(rotateLocal(forward, steerQuat));
      }
      const wheelRight = normalise({ x: wheelForward.z, y: 0, z: -wheelForward.x });
      const longitudinal = dot(pointVelocity, wheelForward);
      const lateral = dot(pointVelocity, wheelRight);
      const tireLoad = springForce * 0.25;
      const lateralGrip = surfaceGrip * (controls.boost ? 0.8 : 1);
      carBody.addForceAtPoint(scale(wheelRight, -lateral * tireLoad * 0.075 * lateralGrip), contactPoint, true);
      if (controls.brake && Math.abs(longitudinal) > 0.2) {
        carBody.addForceAtPoint(scale(wheelForward, -Math.sign(longitudinal) * tireLoad * 0.22), contactPoint, true);
      }
    }
    // Steering torque follows speed: responsive at low speed, calmer at high speed.
    const steerAuthority = clamp(1.0 - speed / 190, 0.24, 1);
    const targetYawRate = -controls.steer * Math.min(1.65, Math.abs(longitudinalSpeed) * 0.095) * steerAuthority * Math.sign(longitudinalSpeed || 1);
    carBody.applyTorqueImpulse({ x: 0, y: (targetYawRate - ang.y) * 1.8 * dt * 620, z: 0 }, true);
    carBody.addForce({ x: -lin.x * 10, y: 0, z: -lin.z * 10 }, true);
    carBody.addForce({ x: 0, y: -Math.abs(longitudinalSpeed) * Math.abs(longitudinalSpeed) * 0.65, z: 0 }, true);
    if (offRoad) carBody.addForce(scale(forward, -longitudinalSpeed * 280), true);
    score += Math.abs(longitudinalSpeed) * dt * 0.8;
    if (hitCooldown > 0) hitCooldown -= dt;
    if (pos.y < -3 || Math.abs(pos.x) > 180 || Math.abs(pos.z) > 180) reset();
  }
  function nearestTrackDistance(x, z) {
    let bestD = Infinity;
    for (let i = 0; i < trackSamples.length; i++) {
      const p = trackSamples[i];
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bestD) bestD = d;
    }
    return bestD;
  }

  function advanceTraffic(dt) {
    const totalLength = trackCurve.getLength();
    for (const item of traffic) {
      item.t = (item.t + item.cruiseSpeed * dt / totalLength) % 1;
      const p = trackCurve.getPointAt(item.t);
      const tangent = trackCurve.getTangentAt(item.t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      p.addScaledVector(normal, item.lane);
      const yaw = Math.atan2(-tangent.x, -tangent.z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      item.body.setNextKinematicTranslation({ x: p.x, y: 0.9, z: p.z });
      item.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  function updateTrafficAndCollisions() {
    const p = carBody.translation();
    const v = carBody.linvel();
    const playerSpeed = Math.hypot(v.x, v.z);
    for (const item of traffic) {
      const t = item.body.translation();
      const distance = Math.hypot(p.x - t.x, p.z - t.z);
      if (distance < 2.55 && playerSpeed > 5 && !item.hit && hitCooldown <= 0) {
        item.hit = true;
        damage += 1;
        hitCooldown = 1.25;
        carBody.applyImpulse({ x: (p.x - t.x) * 320, y: 120, z: (p.z - t.z) * 320 }, true);
        if (callbacks.onCollision) callbacks.onCollision({ damage, remaining: Math.max(0, 3 - damage) });
        if (damage >= 3) {
          pause();
          if (callbacks.onGameOver) callbacks.onGameOver({ score: Math.floor(score), damage, nearMisses });
        }
      } else if (!item.passed && distance > 2.6 && distance < 4.2 && playerSpeed > 9) {
        item.passed = true;
        nearMisses += 1;
        score += 85;
        nitro = Math.min(100, nitro + 10);
        if (callbacks.onNearMiss) callbacks.onNearMiss({ nearMisses, score });
      } else if (distance > 12) {
        item.passed = false;
      }
      const tr = item.body.translation(), qr = item.body.rotation();
      item.model.group.position.set(tr.x, tr.y - 0.55, tr.z);
      item.model.group.quaternion.set(qr.x, qr.y, qr.z, qr.w);
      item.model.wheels.forEach(w => { w.wheel.rotation.x += speed * 0.002; w.rim.rotation.x += speed * 0.002; });
    }
  }

  function syncVisuals() {
    const p = carBody.translation(), q = carBody.rotation();
    carRoot.position.set(p.x, p.y - 0.55, p.z);
    carRoot.quaternion.set(q.x, q.y, q.z, q.w);
    const steeringAngle = -controls.steer * 0.48;
    allWheels.forEach(w => {
      w.wheel.rotation.x += speed * 0.0008;
      w.rim.rotation.x += speed * 0.0008;
      if (w.front) {
        w.wheel.rotation.y = steeringAngle;
        w.rim.rotation.y = steeringAngle;
      }
    });
    const forward = normalise(rotateLocal({ x: 0, y: 0, z: -1 }, q));
    const desired = new THREE.Vector3(p.x - forward.x * 7.4, p.y + 3.2, p.z - forward.z * 7.4);
    camera.position.lerp(desired, 0.11);
    const look = new THREE.Vector3(p.x + forward.x * 4, p.y + 0.8, p.z + forward.z * 4);
    camera.lookAt(look);
    const targetFov = 62 + clamp(speed / 52, 0, 1) * 7 + (controls.boost ? 3 : 0);
    camera.fov += (targetFov - camera.fov) * 0.06;
    camera.updateProjectionMatrix();
  }
  function publishTelemetry(now, force = false) {
    if (!force && now - lastTelemetryAt < 90) return;
    lastTelemetryAt = now;
    if (callbacks.onTelemetry) callbacks.onTelemetry({
      speed: Math.round(speed), score: Math.floor(score), best: Math.max(best, Math.floor(score)),
      damage, nearMisses, nitro: Math.round(nitro), steer: controls.steer,
      surface: offRoad ? "OFF ROAD" : controls.brake ? "BRAKE" : controls.boost && nitro > 0 ? "BOOST" : controls.steer < -0.15 ? "LEFT" : controls.steer > 0.15 ? "RIGHT" : "CENTER",
      fps: Math.round(1000 / Math.max(1, frameAverageMs)),
      pixelRatio: renderer.getPixelRatio(),
      shadowsActive,
      paused
    });
  }
  let frameAverageMs = 16.7;
  let qualityCheckAt = 0;
  let qualityMode = "auto";
  let slowFrameWindows = 0;
  let stableFrameWindows = 0;
  let shadowsActive = true;
  function resize() {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 800);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 515);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!running && !disposed) renderer.render(scene, camera);
  }
  function graphicsCeiling() {
    return qualityMode === "ultra"
      ? maxPixelRatio
      : Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  }
  function applyShadowQuality() {
    const size = qualityMode === "ultra" ? (mobileGPU ? 1024 : 2048) : (mobileGPU ? 512 : 1024);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.needsUpdate = true;
    shadowsActive = true;
    stableFrameWindows = 0;
    slowFrameWindows = 0;
  }
  function setGraphicsMode(mode = "auto") {
    qualityMode = mode === "ultra" ? "ultra" : "auto";
    frameAverageMs = 16.7;
    const nativeRatio = window.devicePixelRatio || 1;
    const requested = qualityMode === "ultra"
      ? (mobileGPU ? Math.min(maxPixelRatio, Math.max(nativeRatio, 1.2)) : maxPixelRatio)
      : Math.min(nativeRatio, maxPixelRatio);
    renderer.setPixelRatio(requested);
    applyShadowQuality();
    resize();
    if (callbacks.onGraphicsMode) callbacks.onGraphicsMode(qualityMode, renderer.getPixelRatio(), shadowsActive);
  }
  function adaptQuality(now, frameMs) {
    frameAverageMs += (frameMs - frameAverageMs) * 0.06;
    if (now - qualityCheckAt < 1400) return;
    qualityCheckAt = now;
    const current = renderer.getPixelRatio();
    const floor = mobileGPU ? 0.75 : 0.85;
    const ceiling = graphicsCeiling();
    const target = frameAverageMs > 22 ? Math.max(floor, current - 0.15)
      : frameAverageMs < 14.5 ? Math.min(ceiling, current + 0.06) : current;
    if (Math.abs(target - current) > 0.02) {
      renderer.setPixelRatio(target);
      resize();
    }
    if (frameAverageMs > 24) {
      slowFrameWindows++;
      stableFrameWindows = 0;
      if (mobileGPU && shadowsActive && slowFrameWindows >= 2) {
        renderer.shadowMap.enabled = false;
        sun.castShadow = false;
        shadowsActive = false;
        if (callbacks.onGraphicsMode) callbacks.onGraphicsMode(qualityMode, renderer.getPixelRatio(), shadowsActive);
      }
    } else if (frameAverageMs < 17.2) {
      stableFrameWindows++;
      slowFrameWindows = 0;
      if (mobileGPU && !shadowsActive && stableFrameWindows >= 3) {
        applyShadowQuality();
        if (callbacks.onGraphicsMode) callbacks.onGraphicsMode(qualityMode, renderer.getPixelRatio(), shadowsActive);
      }
    } else {
      slowFrameWindows = 0;
      stableFrameWindows = 0;
    }
  }
  function frame(now) {
    if (disposed) return;
    frameId = requestAnimationFrame(frame);
    const frameMs = lastFrame ? now - lastFrame : 16.7;
    const dt = Math.min(0.05, Math.max(0, frameMs / 1000));
    lastFrame = now;
    adaptQuality(now, frameMs);
    if (running && !paused) {
      accumulator = Math.min(accumulator + dt, fixedStep * 5);
      let steps = 0;
      while (accumulator >= fixedStep && steps < 5) {
        world.timestep = fixedStep;
        applyCarPhysics(fixedStep);
        advanceTraffic(fixedStep);
        world.step();
        updateTrafficAndCollisions();
        accumulator -= fixedStep;
        steps++;
        if (damage >= 3) break;
      }
      syncVisuals();
      publishTelemetry(now);
    }
    renderer.render(scene, camera);
  }
  function start() {
    if (disposed) return;
    if (frameId) cancelAnimationFrame(frameId);
    running = true; paused = false; lastFrame = 0;
    frameId = requestAnimationFrame(frame);
  }
  function pause() { paused = true; running = false; if (frameId) cancelAnimationFrame(frameId); frameId = 0; publishTelemetry(performance.now(), true); }
  function resume() { if (disposed) return; running = true; paused = false; lastFrame = 0; if (!frameId) frameId = requestAnimationFrame(frame); }
  function dispose() {
    disposed = true; running = false; paused = true;
    if (frameId) cancelAnimationFrame(frameId);
    window.removeEventListener("resize", resize);
    renderer.dispose();
    asphaltTexture.dispose();
    world.free();
    for (const g of disposableGeometries) g.dispose();
    for (const m of disposableMaterials) m.dispose();
  }

  resize();
  window.addEventListener("resize", resize);
  reset();
  setScene("sunset");
  renderer.render(scene, camera);
  return {
    start, pause, resume, reset, setControls, setScene, setCarColour, setGraphicsMode,
    getTelemetry: () => ({ speed, score, best, damage, nearMisses, nitro, offRoad }),
    dispose
  };
}
