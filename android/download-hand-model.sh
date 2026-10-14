#!/usr/bin/env bash
set -euo pipefail

ANDROID_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL_PATH="$ANDROID_DIR/app/src/main/assets/hand_landmarker.task"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
EXPECTED_SHA256="fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
EXPECTED_BYTES="7819105"

mkdir -p "$(dirname "$MODEL_PATH")"
curl --fail --silent --show-error --location --retry 3 --retry-delay 2 "$MODEL_URL" --output "$MODEL_PATH"
printf '%s  %s\n' "$EXPECTED_SHA256" "$MODEL_PATH" | sha256sum --check --strict
actual_bytes="$(wc -c < "$MODEL_PATH" | tr -d ' ')"
if [[ "$actual_bytes" != "$EXPECTED_BYTES" ]]; then
  echo "Model size mismatch: expected $EXPECTED_BYTES bytes, got $actual_bytes" >&2
  rm -f "$MODEL_PATH"
  exit 1
fi

echo "Verified MediaPipe hand model: $MODEL_PATH"
