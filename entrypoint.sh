#!/bin/sh
set -e

# maplibre-gl-native renders through OpenGL and needs a real X display, so the
# container runs one in software. Without it the renderer loops forever on
# "Failed to open X display, retrying...".
: "${DISPLAY:=:99}"
export DISPLAY

Xvfb "$DISPLAY" -screen 0 1280x1024x24 -ac +extension GLX +extension RENDER -noreset &
XVFB_PID=$!

# Wait for the display to actually answer rather than guessing with sleep, and
# give up with a clear message instead of handing Node a display that is not there.
i=0
until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
        echo "[entrypoint] Xvfb exited before $DISPLAY was ready — cannot render maps" >&2
        exit 1
    fi
    i=$((i + 1))
    if [ "$i" -ge 100 ]; then
        echo "[entrypoint] $DISPLAY did not come up within 10s — cannot render maps" >&2
        exit 1
    fi
    sleep 0.1
done

echo "[entrypoint] Xvfb ready (pid $XVFB_PID, DISPLAY=$DISPLAY)"
echo "[entrypoint] Starting server..."

exec node server.js
