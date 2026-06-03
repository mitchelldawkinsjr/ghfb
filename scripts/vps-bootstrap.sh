#!/usr/bin/env bash
# One-time host prep for docker-compose.prod.yml (run on the VPS with sudo as needed).
set -euo pipefail

NET="${DOCKER_NETWORK:-360ws-network}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/360ws/clients/docker-app}"
APP_DIR="${APP_DIR:-${DEPLOY_ROOT}/ghfb}"

if ! docker network inspect "$NET" >/dev/null 2>&1; then
  echo "Creating Docker network: $NET"
  docker network create "$NET"
else
  echo "Docker network exists: $NET"
fi

mkdir -p "$APP_DIR"
echo "Deploy directory ready: $APP_DIR"
echo ""
echo "Next steps:"
echo "  1. Push to main (GitHub Actions deploys) or rsync + compose up manually"
echo "  2. Configure DNS and reverse proxy host for the public domain"
echo "  3. Ensure sibling app containers (gh-lift, flim-review-app) join the same Docker network"
