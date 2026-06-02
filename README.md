# Godwin Heights Football — Team Tools Hub

Static landing page for Godwin Heights Football apps and resources. Live at **https://ghfb.360web.cloud**.

The hub (`index.html`) links six tools in navy/gold styling. The footer shows the current season and year (Winter Dec–Feb, Spring Mar–May, Summer Jun–Aug, Fall Sep–Nov) based on the visitor’s local date.

## Hub links

| Tool | URL |
|------|-----|
| Film Review Hub | https://mitchelldawkinsjr.github.io/GH-Flim-Review/ |
| GH Lift | https://ghlift.360web.cloud/ |
| Coach Check-in | https://ghfb.360web.cloud/check-in.html |
| Summer Attendance Form | [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSdWqLnvov1370FHO766NAIofeT9j2qsgKTHR37Puwodw0piZA/viewform) |
| Attendance Dashboard | https://ghfb.360web.cloud/attendance-dashboard.html |
| 2026 Schedule | https://ghfb.360web.cloud/schedule.html |
| Team Drive | [Google Drive](https://drive.google.com/drive/folders/18J5gEtYQynNmm1pXk7EjgjFzI_Hnko7I?usp=drive_link) |

**Not on the hub:** Team Weightroom Tracker is hidden for now; the app repo remains linked below for maintainers.

## Attendance dashboard

`attendance-dashboard.html` loads a published Google Sheets CSV (`2026 Summer WR & Conditioning`) and mirrors the workbook’s rolling attendance logic:

- **Column selection:** Same rules as Apps Script `rollingAttendance()` — dated weightroom columns through today, plus `C` conditioning columns; stops at the first future date.
- **Rolling rate:** `(X marks) ÷ (session slots through today)`, counting each weightroom date header on or before today plus its paired `C` column when it appears in the next column; stops at the first future date. Headers like `6/1` (no year) use the current year.
- **Ironmen:** Rolling average at or above **`% required for ironman`** from the sheet (typically ~85.4%, i.e. 35÷41 sessions).
- **Momentum:** Team attendance rate over the last seven valid sessions.
- **Chart:** Bar chart of each player’s rolling percentage.
- **Roster participation:** Pie charts for % of players with at least one weightroom or conditioning mark in eligible sessions through today.
- **Table:** Scrollable roster; Jersey # and Grade hidden; row colors inferred from session type (weightroom vs conditioning), `X` marks, empty cells, and a “missed 24+” highlight when applicable (CSV has no fill colors).
- **Legend:** On-page key matching workbook colors (Conditioning, Weightroom, No Attendance, Missed 24 for Summer).

To point at a different sheet, update the Google `proxy_pass` URL in `deploy/nginx.conf` and `CSV_URL` in `attendance-dashboard.html`.

Attendance CSV is fetched via **`/api/attendance.csv`** (nginx proxies Google Sheets and caches responses for 90 seconds on the server).

### Coach check-in

`check-in.html` is a coach tap-list for weightroom / conditioning.

**Recommended (school sheet, personal deploy):** Share the school spreadsheet with your personal Gmail as **Editor**, create a standalone Apps Script project on your personal account, set `SHEET_ID` in `scripts/coach-check-in/Code.gs`, deploy as web app, paste the `/exec` URL into **`check-in-config.js`**. Full steps: `scripts/coach-check-in/README.md`.

Until the script URL is set, the page loads the roster from CSV in **view-only** mode.

### Install as app (PWA)

The team tools hub (`index.html`) is installable on phone or desktop — use **Add to Home Screen** on the hub or Chrome/Edge **Install app**. Icons live in `icons/`; `manifest.webmanifest` opens to `/`. The attendance dashboard loads live data from Google Sheets when online.

## Repo layout

| File | Purpose |
|------|---------|
| `index.html` | Team tools hub (PWA entry + install banner) |
| `schedule.html` / `images/schedule-2026.jpg` | 2026 varsity schedule graphic |
| `check-in.html` | Coach tap-list check-in |
| `attendance-dashboard.html` | Live attendance dashboard |
| `scripts/coach-check-in/` | Apps Script for sheet writes |
| `manifest.webmanifest` / `sw.js` / `icons/` | PWA install + offline shell |
| `Dockerfile` / `deploy/nginx.conf` | nginx static image |
| `docker-compose.prod.yml` | `ghfb-app` on `360ws-network`, port 8020 |
| `.github/workflows/deploy-vps.yml` | rsync + compose deploy on push to `main` |

## Local preview

```bash
cd ~/Projects/ghfb
open index.html

# Or run the production Docker stack locally:
docker compose -f docker-compose.prod.yml up --build
open http://localhost:8020/
open http://localhost:8020/attendance-dashboard.html
open http://localhost:8020/check-in.html
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
