#!/bin/sh
set -e
python3 /opt/checkin_proxy.py &
PROXY_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if nc -z 127.0.0.1 8081 2>/dev/null; then
    break
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "checkin_proxy.py exited during startup" >&2
    exit 1
  fi
  sleep 0.2
done
if ! nc -z 127.0.0.1 8081 2>/dev/null; then
  echo "checkin proxy did not listen on 8081" >&2
  exit 1
fi
exec nginx -g "daemon off;"
