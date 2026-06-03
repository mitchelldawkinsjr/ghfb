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
  end

  Fan --> NPM
  Coach --> NPM
  NPM --> NGX
  NGX -->|"/lift/"| LiftNGX
  NGX -->|"/film/"| FilmNGX
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
    API --> GAS2[Apps Script]
    GAS2 --> S2[(School Sheet)]
  end

  subgraph read["Read path"]
    AD[attendance-dashboard.html] --> CSV[/api/attendance.csv/]
    CSV --> PUB[Published CSV snapshot]
    PUB --> S2
    CI --> CSV
  end

  Form[Google Form] -.->|legacy / backup| S2
```

| Path | Role |
|------|------|
| **Coach check-in** | Fast tap-list; writes `X` marks via Apps Script |
| **Attendance dashboard** | Analytics only; reads published CSV (cached) |
| **Google Form** | Still linked from hub as alternate entry |

The dashboard lags the sheet by nginx cache (~90s) plus optional browser CSV cache (3 minutes). Check-in writes are immediate on the sheet once each `toggleCheckIn` completes.

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
