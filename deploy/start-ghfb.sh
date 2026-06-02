#!/bin/sh
set -e
python3 /opt/checkin_proxy.py &
exec nginx -g "daemon off;"
