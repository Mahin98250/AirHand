# AirHand — AI Hand Gesture Controller

A browser-based webcam hand-tracking demo using MediaPipe Tasks Vision. It includes a virtual in-page cursor and a hand-controlled endless runner.

## Run it

1. Enable GitHub Pages for this repository, or run a local static server.
2. For example, run `python -m http.server 8000` and open `http://localhost:8000`.
3. Press **Enable camera** and allow camera permission.

Camera access requires HTTPS or localhost. The MediaPipe JavaScript module, WASM runtime and hand model load from public CDNs on first use, so the first launch requires internet access. Webcam frames are processed in the browser and are not uploaded by this app.

## Gestures

- Point with your index finger: move the virtual cursor.
- Pinch thumb and index finger: click feedback in cursor mode; jump in runner mode.
- Peace sign: switch between cursor and runner.
- Open palm: start the runner.
- Thumbs-up: pause or resume the runner.
- Tap/click the game canvas: jump as a fallback.

## Limitations

The cursor is limited to the web page. Browsers cannot control the operating-system mouse or click other desktop applications without a separately installed native companion app. Gesture recognition is based on landmark geometry and can vary with lighting, camera angle and hand orientation. This is a working prototype, not an accessibility-certified system-wide controller.
