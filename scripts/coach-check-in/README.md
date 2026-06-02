# Coach check-in (Google Apps Script)

Powers **`/check-in.html`** on ghfb via the `/api/checkin` nginx proxy.

## Setup

1. Open the **2026 Summer WR & Conditioning** spreadsheet → **Extensions → Apps Script**.
2. Paste `Code.gs` from this folder (replace or merge with your existing project).
3. (Optional) **Project settings → Script properties** → `COACH_PIN` = your coach PIN.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone with the link** (or your school domain)
5. Copy the **Web app URL** (ends with `/exec`).
6. In `deploy/nginx.conf`, set the `proxy_pass` under `location /api/checkin` to that URL (see comment in file).
7. Redeploy ghfb (push to `main` or `docker compose up --build`).

## API

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/api/checkin?action=getCheckInData&sessionType=weightroom&pin=` | Roster + today’s marks |
| POST | `/api/checkin` JSON `{ "action":"toggleCheckIn", "sheetRow": 5, "sessionType": "weightroom", "pin": "" }` | Toggle **X** |

## Sheet requirements

- Today’s date must exist as a column header (e.g. `6/2`).
- Conditioning uses the **`C`** column immediately after that date.
- Player names in columns **A** and **B** (same as the attendance dashboard).
