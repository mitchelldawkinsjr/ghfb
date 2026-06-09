# Sitemap

## On-site (`ghfb.360web.cloud`)

| Route | File | Role | Data |
|-------|------|------|------|
| `/` | `index.html` | Team tools hub (PWA entry) | Attendance CSV + lift plan CSV + practice schedule CSV (today strip) |
| `/check-in.html` | Coach roll call | **Write** today’s marks | CSV (fast) + `/api/checkin` |
| `/attendance-dashboard.html` | Analytics dashboard | **Read** rolling stats | `/api/attendance.csv` |
| `/schedule.html` | Schedule doc + varsity graphic | Static | Google Doc if public, else `files/summer-schedule-2026/`; **Download summer calendar (.ics)** |
| `/practice-schedule.html` | Practice timeline + countdown timer | **Read** 5-min blocks | `/api/practice-schedule.csv` |
| `/data/summer-schedule-events.json` | Summer ICS source | Static | Parsed from summer schedule HTML |
| `/api/schedule-doc-status` | Schedule embed probe | JSON | Python sidecar checks Google Doc export |
| `/files/summer-schedule-2026/` | Summer schedule fallback | Static | HTML export from team schedule file |
| `/api/attendance.csv` | nginx proxy | Cached CSV feed | Google Sheets publish URL |
| `/api/lift-plan.csv` | nginx proxy | Cached CSV feed | Daily Lift Plan tab (`gid=1599839883`) |
| `/api/practice-schedule.csv` | nginx proxy | Cached CSV feed | Practice Schedule tab (`gid=224955206`) |
| `/api/checkin` | Python proxy | Uncached JSON API | Apps Script `/exec` |
| `/manifest.webmanifest` | PWA manifest | Install metadata | — |
| `/sw.js` | Service worker | Offline hub shell | Precache hub assets |
| `/icons/*` | PWA icons | Install / favicon | — |
| `/check-in-config.js` | Optional override | `GHFB_CHECKIN_SCRIPT_URL` (legacy; proxy is primary) | — |
| `/lift/` | nginx proxy → `gh-lift` | GH Lift training app | Sibling container |
| `/film/` | nginx proxy → `flim-review-app` | Film review static site | Sibling container |
| `/weightroom/` | nginx proxy → `weightroom-app` | Weightroom Tracker (React + API + Postgres) | Sibling container |

**SPA fallback:** `location /` uses `try_files $uri $uri/ /index.html` (only affects unknown paths).

### Static assets (not separate routes)

| Path | Purpose |
|------|---------|
| `images/schedule-2026.jpg` | Schedule page image |
| `shared/theme.css` | Dashboard styling (module pages) |
| `js/`, `shared/*.js` | ES modules for dashboard and check-in (see [code-map.md](./code-map.md)) |

## Human navigation tree

```text
ghfb.360web.cloud/
├── /                      Team Tools hub (PWA)
├── check-in.html          Coach roll call → Sheet writes
├── attendance-dashboard.html   Live stats ← CSV
├── schedule.html          Static 2026 image
├── practice-schedule.html Live practice timeline + timer ← CSV
├── api/
│   ├── attendance.csv     → Google publish (cached)
│   ├── lift-plan.csv      → Daily Lift Plan tab (cached)
│   ├── practice-schedule.csv → Practice Schedule tab (cached)
│   └── checkin            → Apps Script (no cache)
├── lift/                  → GH Lift (in-app proxy)
├── film/                  → Film Review (in-app proxy)
├── weightroom/            → Weightroom Tracker (in-app proxy)
└── [external] Form, Drive
```

## Hub outbound links (`index.html`)

| Card | Destination |
|------|-------------|
| Film Review Hub | `/film/` (in-app) |
| GH Lift | `/lift/` (in-app) |
| Weightroom Tracker | `/weightroom/` (in-app) |
| Coach Check-in | `/check-in.html` (on-site) |
| Summer Attendance Form | [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSdWqLnvov1370FHO766NAIofeT9j2qsgKTHR37Puwodw0piZA/viewform) |
| Attendance Dashboard | `/attendance-dashboard.html` |
| 2026 Schedule | `/schedule.html` |
| Practice Schedule | `/practice-schedule.html` (edit in [Google Sheet](https://docs.google.com/spreadsheets/d/1c5NqGj5b-7CgVY3UuOziaNgDJqDIo0J2j2HjV443HTU/edit?gid=224955206#gid=224955206)) |
| Team Drive | [Google Drive folder](https://drive.google.com/drive/folders/18J5gEtYQynNmm1pXk7EjgjFzI_Hnko7I?usp=drive_link) |

**Also:** [Weightroom Tracker](https://weightroom.360web.cloud/) standalone subdomain (same app as `/weightroom/`).

## Off-repo but coupled

| Artifact | Location | Role |
|----------|----------|------|
| Apps Script | `scripts/coach-check-in/Code.gs` | `getCheckInData`, `toggleCheckIn` |
| School sheet | Tab `2026 Summer WR & Conditioning` | Source of truth for marks |
| GitHub Actions | `.github/workflows/deploy-vps.yml` | rsync + `docker compose` on `main` |
| Weightroom app | `mitchelldawkinsjr/team-weightroom-tracker` | Session logging; deploy to `weightroom-app` |
