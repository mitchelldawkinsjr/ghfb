# Code map and maintenance

## Repository layout

| Path | Purpose |
|------|---------|
| `index.html` | Team tools hub (PWA) |
| `check-in.html` | Coach check-in shell (loads `js/check-in.js`) |
| `attendance-dashboard.html` | Attendance analytics (ES module) |
| `schedule.html` | 2026 schedule image page |
| `check-in-config.js` | Optional `GHFB_CHECKIN_SCRIPT_URL` override |
| `js/check-in.js` | Coach check-in logic |
| `js/attendance-dashboard.js` | Dashboard entry module |
| `shared/ghfb-csv.js` | CSV fetch, parse, sessionStorage cache |
| `shared/ghfb-attendance.js` | Dates, columns, rolling stats, roster |
| `shared/ghfb-dom.js` | Formatting, `escapeHtml` |
| `shared/theme.css` | Shared dashboard styles |
| `scripts/coach-check-in/Code.gs` | Sheet read/write API |
| `scripts/coach-check-in/README.md` | Apps Script setup |
| `deploy/nginx.conf` | Routes, CSV proxy, check-in proxy |
| `deploy/cache.conf` | nginx `proxy_cache` zone |
| `deploy/checkin_proxy.py` | Threading Apps Script proxy |
| `deploy/start-ghfb.sh` | Container entry (proxy + nginx) |
| `Dockerfile` / `docker-compose.prod.yml` | Production image |
| `.github/workflows/deploy-vps.yml` | VPS deploy |
| `docs/` | Architecture documentation (this folder) |

## Shared logic: browser vs Apps Script

| Concern | Browser (`shared/ghfb-attendance.js`) | Server (`Code.gs`) |
|---------|--------------------------------------|---------------------|
| Today’s label | `getTodayLabel()` → `M/D` | `getTodayHeaderCandidates_()` |
| Session column | `findSessionColumnIndex` | `findSessionColumn_` |
| Roster names | `getDataRows`, `getPlayerDisplayName` | `getRoster_` |
| Toggle mark | N/A (API only) | `toggleCheckIn` |

Keep date-header parsing aligned when changing either side.

## Cache layers (summary)

| Layer | TTL | Used by |
|-------|-----|---------|
| nginx `proxy_cache` | 90s | `/api/attendance.csv` |
| Browser CSV `sessionStorage` | 3 min | Check-in + dashboard |
| Check-in API `sessionStorage` | 45s | Per `sessionType` |
| Service worker | Versioned precache | Hub shell only |

## When to redeploy what

| Change | Action |
|--------|--------|
| HTML/CSS/JS/nginx/proxy | Push `main` → GitHub Actions |
| `Code.gs` only | Apps Script **Deploy → New version** |
| New sheet tab or publish URL | Update `deploy/nginx.conf` + redeploy ghfb |
| New date column for today | Add headers in sheet (no code deploy if format unchanged) |

## Related documentation

- [architecture.md](./architecture.md)
- [sheet-model.md](./sheet-model.md)
- [flows-coach-check-in.md](./flows-coach-check-in.md)
- [flows-attendance-dashboard.md](./flows-attendance-dashboard.md)
- Project [README.md](../README.md)
