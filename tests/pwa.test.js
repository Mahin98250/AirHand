import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("AirHand declares an installable web app manifest", async () => {
  const html = await read("../index.html");
  const manifest = JSON.parse(await read("../manifest.webmanifest"));
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.equal(manifest.name, "AirHand — Hand Gesture Controller");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some(icon => icon.src === "./airhand-icon.svg" && icon.type === "image/svg+xml"));
});

test("AirHand caches the same-origin app shell without caching camera frames or third-party models", async () => {
  const worker = await read("../sw.js");
  assert.match(worker, /airhand-shell-v\d+/);
  assert.match(worker, /"\.\/index\.html"/);
  assert.match(worker, /"\.\/android-guide\.html"/);
  assert.match(worker, /"\.\/app\.js\?v=airhand-[^"]+"/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return/);
  assert.doesNotMatch(worker, /getUserMedia|MediaStream|storage\.googleapis\.com/);
  assert.match(worker, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(worker, /is3DDependency/);
});

test("install controls and service worker registration are wired", async () => {
  const pwa = await read("../pwa.js");
  const html = await read("../index.html");
  assert.match(html, /pwa\.js\?v=airhand-pwa-2/);
  assert.match(pwa, /android-guide\.html/);
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /appinstalled/);
  assert.match(pwa, /navigator\.serviceWorker\.register\("\.\/sw\.js"\)/);
  assert.match(pwa, /Add to Home Screen/);
});
