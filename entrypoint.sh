#!/bin/sh
set -e

# Start Xvfb with GLX and RENDER extensions explicitly enabled
Xvfb :99 -screen 0 1280x1024x24 -ac +extension GLX +extension RENDER -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Give Xvfb a moment to initialise before Node tries to open a GL context
sleep 1

echo "[entrypoint] Xvfb started (pid $XVFB_PID, DISPLAY=:99)"
echo "[entrypoint] Starting server..."

exec node server.js
