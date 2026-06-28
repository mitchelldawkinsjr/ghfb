# System architecture

One VPS app (`ghfb-app`) serves static pages, proxies attendance CSV from Google Sheets, and proxies coach check-in to a **personal-account Apps Script** web app that writes the **school spreadsheet**.

## High-level diagram

```mermaid
flowchart TB
  subgraph clients["Clients"]
    Coach["Coach phone/browser"]
    Fan["Players / staff / parents"]
  end

  subgraph edge["ghfb.360web.cloud"]
    NPM["Nginx Proxy Manager"]
    subgraph container["Docker ghfb-app :8020"]
      NGX["nginx :80"]
      PY["checkin_proxy.py :8081<br/>ThreadingHTTPServer + /health"]
    end
  end

  subgraph google["Google"]
    CSVpub["Published CSV<br/>docs.google.com"]
    Sheet["School Sheet<br/>2026 Summer WR & Conditioning"]
    GAS["Apps Script Web App<br/>doGet / doPost"]
  end

  subgraph external["External (browser only)"]
    Form["Summer Attendance Form"]
    Drive["Team Drive"]
  end

  subgraph sibling["Sibling containers on shared network"]
    LiftNGX["gh-lift nginx"]
    FilmNGX["flim-review-app nginx"]
    Weightroom["weightroom-app Node :3000"]
  end

  Fan --> NPM
  Coach --> NPM
  NPM --> NGX
  NGX -->|"/lift/"| LiftNGX
  NGX -->|"/film/"| FilmNGX
  NGX -->|"/weightroom/"| Weightroom
  NGX -->|"/api/attendance.csv" 90s cache| CSVpub
  NGX -->|"/api/checkin" no-store| PY
  PY --> GAS
  GAS --> Sheet
  CSVpub -.->|same data, read-only| Sheet

  Fan --> Form
  Fan --> Drive
```

## Data authority

```mermaid
flowchart LR
  subgraph write["Write path"]
    CI[check-in.html] --> API[/api/checkin/]
    API --> DB[(SQLite)]
    DB --> GAS[Apps Script setCheckInMark]
    GAS --> S2[(School Sheet)]
  end

  subgraph read["Read path"]
    AD[attendance-dashboard.html] --> JSON[/api/attendance.json/]
    JSON --> DB
    AD -.-> CSV[/api/attendance.csv fallback/]
    CSV -.-> S2
    CI --> API
  end

  Form[Google Form] -.->|legacy / backup| S2
```

| Path | Role |
|------|------|
| **SQLite (`/data/attendance.db`)** | Source of truth for roster, sessions, and marks |
| **Coach check-in** | Fast tap-list; writes DB, syncs sheet in background |
| **Attendance dashboard** | Reads `/api/attendance.json`; CSV is fallback only |
| **Google Form** | Still linked from hub as alternate entry |

The dashboard reads the DB directly (short cache). Check-in writes are immediate in SQLite; the sheet may lag briefly while the sync outbox drains. Full DB docs: [flows-attendance-db.md](./flows-attendance-db.md).

## Container runtime

On start, `/opt/start-ghfb.sh`:

1. Runs `python3 /opt/checkin_proxy.py` in the background (port **8081**).
2. Runs `nginx -g "daemon off;"` (port **80**).

| Process | Config |
|---------|--------|
| nginx | `deploy/nginx.conf`, `deploy/cache.conf` |
| Check-in proxy | `deploy/checkin_proxy.py`, env `CHECKIN_SCRIPT_URL` (defaults to deployed `/exec` URL) |

Host mapping: NPM proxy host `ghfb.360web.cloud` → `ghfb-app:80` on Docker network `360ws-network`, published as host port **8020**.

See [flows-deploy.md](./flows-deploy.md) for CI and one-time VPS setup.
