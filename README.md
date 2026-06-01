# Godwin Heights Football — Team Tools Hub

Static landing page for Godwin Heights Football apps and resources. Live at **https://ghfb.360web.cloud**.

## Hub links

| Tool | URL |
|------|-----|
| Film Review Hub | https://mitchelldawkinsjr.github.io/GH-Flim-Review/ |
| GH Lift | https://ghlift.360web.cloud/ |
| Summer Attendance | [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSdWqLnvov1370FHO766NAIofeT9j2qsgKTHR37Puwodw0piZA/viewform) |
| Team Dashboard | `/attendance-dashboard.html` (live CSV + Ironmen calculations) |
| Team Drive | [Google Drive](https://drive.google.com/drive/folders/18J5gEtYQynNmm1pXk7EjgjFzI_Hnko7I?usp=drive_link) |
| Team Weightroom Tracker | https://github.com/mitchelldawkinsjr/team-weightroom-tracker *(coming soon)* |

## Local preview

```bash
cd ~/Projects/ghfb
open index.html

# Or run the production Docker stack locally:
docker compose -f docker-compose.prod.yml up --build
open http://localhost:8020
```

## Deployment (VPS)

Matches the [wnba-stat-spot](https://github.com/mitchelldawkinsjr/WNBA-Stat-Spot) pattern on mitch-cloud.

| Setting | Value |
|---------|-------|
| VPS path | `/opt/360ws/clients/docker-app/ghfb` |
| Container | `ghfb-app` |
| Docker network | `360ws-network` |
| Host port | `8020` → container `80` |
| Domain | `ghfb.360web.cloud` |

### GitHub Actions secrets

Reuse the same secrets as other 360web VPS apps:

- `VPS_SSH_KEY`
- `VPS_HOST`
- `VPS_USER`

Push to `main` triggers [`.github/workflows/deploy-vps.yml`](.github/workflows/deploy-vps.yml).

### One-time NPM setup

1. **DNS:** Add an `A` record for `ghfb.360web.cloud` pointing to the VPS public IP.
2. **Deploy once** so `ghfb-app` is running on `360ws-network` (push to `main` or run compose on the VPS).
3. **Nginx Proxy Manager → Proxy Host:**
   - **Domain:** `ghfb.360web.cloud`
   - **Forward:** `http://ghfb-app:80` *(container name on the Docker network, not `localhost`)*
   - **SSL:** Request a Let's Encrypt certificate
   - **Force SSL:** Enable after the certificate is issued
4. **Verify:** `curl -I https://ghfb.360web.cloud`

### VPS bootstrap (first time on host)

```bash
./scripts/vps-bootstrap.sh
```

## Maintainer cross-links

| Local path | GitHub | Live |
|------------|--------|------|
| `~/Projects/ghfb/` | [mitchelldawkinsjr/ghfb](https://github.com/mitchelldawkinsjr/ghfb) | ghfb.360web.cloud |
| `~/Projects/flim-review/` | [GH-Flim-Review](https://github.com/mitchelldawkinsjr/GH-Flim-Review) | GitHub Pages |
| `~/Projects/gh-lift/` | [gh-lift](https://github.com/mitchelldawkinsjr/gh-lift) | ghlift.360web.cloud |
| `~/Projects/team-weightroom-tracker/` | [team-weightroom-tracker](https://github.com/mitchelldawkinsjr/team-weightroom-tracker) | TBD |
