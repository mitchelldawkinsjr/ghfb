# GHFB documentation

Architecture and flow documentation for the [Godwin Heights Football](https://ghfb.360web.cloud) team tools hub.

| Doc | Contents |
|-----|----------|
| [architecture.md](./architecture.md) | System overview, data authority, runtime |
| [sitemap.md](./sitemap.md) | Routes, hub links, off-repo artifacts |
| [sheet-model.md](./sheet-model.md) | Spreadsheet columns and mark conventions |
| [flows-hub-pwa.md](./flows-hub-pwa.md) | Landing page, today strip, installable PWA |
| [flows-attendance-dashboard.md](./flows-attendance-dashboard.md) | Read-only analytics from DB (CSV fallback) |
| [flows-attendance-db.md](./flows-attendance-db.md) | SQLite source of truth, sync, operations |
| [flows-coach-check-in.md](./flows-coach-check-in.md) | Coach roll call, API, save queue |
| [flows-deploy.md](./flows-deploy.md) | GitHub Actions, Docker, Apps Script |
| [code-map.md](./code-map.md) | Repo modules and maintenance notes |

## Live URLs

- Hub: https://ghfb.360web.cloud/
- Coach check-in: https://ghfb.360web.cloud/check-in.html
- Attendance dashboard: https://ghfb.360web.cloud/attendance-dashboard.html
- 2026 schedule: https://ghfb.360web.cloud/schedule.html

Setup for Apps Script and the school sheet: [`scripts/coach-check-in/README.md`](../scripts/coach-check-in/README.md).
