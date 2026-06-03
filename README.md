# Godwin Heights Football — Team Tools Hub

Static landing page for Godwin Heights Football apps and resources. Live at **https://ghfb.360web.cloud**.

The hub (`index.html`) links team tools in navy/gold styling. The footer shows the current season and year (Winter Dec–Feb, Spring Mar–May, Summer Jun–Aug, Fall Sep–Nov) based on the visitor’s local date.

**Architecture docs:** [docs/README.md](docs/README.md) — sitemap, data flows, deploy, and sheet model.

## Hub links

| Tool | URL |
|------|-----|
| Film Review Hub | `/film/` (in-app; also on GitHub Pages) |
| GH Lift | `/lift/` (in-app; also at ghlift.360web.cloud) |
| Coach Check-in | `/check-in.html` |
| Summer Attendance Form | [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSdWqLnvov1370FHO766NAIofeT9j2qsgKTHR37Puwodw0piZA/viewform) (opens in browser) |
| Attendance Dashboard | `/attendance-dashboard.html` |
| 2026 Schedule | `/schedule.html` |
| Team Drive | [Google Drive](https://drive.google.com/drive/folders/18J5gEtYQynNmm1pXk7EjgjFzI_Hnko7I?usp=drive_link) (opens in browser) |

**Not on the hub:** Team Weightroom Tracker is hidden for now.

## Attendance dashboard

`attendance-dashboard.html` loads a published Google Sheets CSV (`2026 Summer WR & Conditioning`) and mirrors the workbook’s rolling attendance logic:

- **Column selection:** Same rules as Apps Script — dated weightroom columns through today, plus `C` conditioning columns; stops at the first future date.
- **Rolling rate:** `(X marks) ÷ (session slots through today)`, counting each weightroom date header on or before today plus its paired `C` column when it appears in the next column.
- **Ironmen:** Rolling average at or above **`% required for ironman`** from the sheet.
- **Momentum:** Team attendance rate over the last seven valid sessions.
- **Chart:** Bar chart of each player’s rolling percentage.
- **Roster participation:** Pie charts for weightroom and conditioning participation through today.
- **Table:** Scrollable roster with session-type row styling and legend.

To point at a different sheet, update the Google `proxy_pass` URL in `deploy/nginx.conf`.

Attendance CSV is fetched via **`/api/attendance.csv`** (nginx proxies Google Sheets with a short server cache).

### Coach check-in

`check-in.html` is a coach tap-list for weightroom / conditioning.

**Recommended (school sheet, personal deploy):** Share the school spreadsheet with your personal Gmail as **Editor**, set `SHEET_ID` in `scripts/coach-check-in/Code.gs`, deploy as web app. Full steps: `scripts/coach-check-in/README.md`.

Check-in UX: instant roster from cached CSV, grid stays tappable while marks sync, queued saves, and a threaded server proxy for `/api/checkin`.

### Install as app (PWA)

The team tools hub is installable — use **Add to Home Screen** on the hub or **Install app** in Chrome/Edge. `manifest.webmanifest` opens to `/index.html`. GH Lift and Film Review load in-app at `/lift/` and `/film/` without leaving the PWA.

## Shared front-end modules

| Path | Purpose |
|------|---------|
| `shared/theme.css` | Navy/gold CSS variables, back link, card tokens |
| `shared/ghfb-csv.js` | CSV parse, session cache, fetch `/api/attendance.csv` |
| `shared/ghfb-attendance.js` | Sheet column rules, rolling stats, roster rows |
| `shared/ghfb-dom.js` | `formatPct`, `escapeHtml` |
| `js/attendance-dashboard.js` | Dashboard UI |
| `js/check-in.js` | Coach check-in UI |

Pages load shared code with `<script type="module" src="…">`. Use a local HTTP server — `file://` will not resolve module imports.

## Repo layout

| File | Purpose |
|------|---------|
| `index.html` | Team tools hub (PWA entry) |
| `schedule.html` / `images/schedule-2026.jpg` | 2026 varsity schedule |
| `check-in.html` | Coach tap-list check-in |
| `attendance-dashboard.html` | Live attendance dashboard |
| `shared/` / `js/` | Shared theme + sheet logic + page scripts |
| `docs/` | Architecture documentation |
| `scripts/coach-check-in/` | Apps Script for sheet writes |
| `manifest.webmanifest` / `sw.js` / `icons/` | PWA install + offline hub shell |
| `Dockerfile` / `deploy/nginx.conf` | nginx image + API proxies + in-app `/lift/` `/film/` |
| `docker-compose.prod.yml` | Production compose stack |
| `.github/workflows/deploy-vps.yml` | CI deploy on push to `main` |

## Local preview

```bash
cd ~/Projects/ghfb

python3 -m http.server 8080
open http://localhost:8080/

# Production-like stack:
docker compose -f docker-compose.prod.yml up --build
open http://localhost:8020/
```

## Deployment

The hub deploys to a private VPS via **GitHub Actions** on push to `main`:

1. CI rsyncs the repo to the server.
2. Docker Compose builds and runs an nginx container on a shared reverse-proxy network.
3. A reverse proxy host terminates TLS and forwards to the app container.

**Repository secrets** (same names as other 360web apps on the VPS):

- `VPS_SSH_KEY`
- `VPS_HOST`
- `VPS_USER`

In-app **GH Lift** and **Film Review** are nginx reverse-proxied to sibling containers on the same Docker network (`gh-lift`, `flim-review-app`). Those apps deploy from their own repos.

One-time host setup: run `scripts/vps-bootstrap.sh` on the VPS (creates deploy directory and Docker network if missing). Configure DNS and a reverse proxy host for the public domain separately.

See [docs/flows-deploy.md](docs/flows-deploy.md) for a high-level pipeline overview.

## Related projects

| Project | Live |
|---------|------|
| [ghfb](https://github.com/mitchelldawkinsjr/ghfb) | ghfb.360web.cloud |
| [GH-Flim-Review](https://github.com/mitchelldawkinsjr/GH-Flim-Review) | `/film/` on hub; GitHub Pages mirror |
| [gh-lift](https://github.com/mitchelldawkinsjr/gh-lift) | `/lift/` on hub; ghlift.360web.cloud |
