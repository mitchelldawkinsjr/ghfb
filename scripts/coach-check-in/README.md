# Coach check-in (Google Apps Script)

Powers **`/check-in.html`** on ghfb. Writes **X** marks to the attendance sheet; the dashboard reads the same sheet via published CSV.

## Recommended: school sheet + personal Google account

Use this when your **school account cannot deploy** Apps Script web apps but **can share** the spreadsheet with your personal Gmail.

### 1. Share the school spreadsheet

On the **school** attendance workbook:

1. **Share** → add your **personal Gmail** as **Editor**.
2. If blocked, ask IT to allow external sharing for that file or share to your personal **@gmail.com** only.

### 2. Get the spreadsheet ID

From the sheet URL:

```text
https://docs.google.com/spreadsheets/d/1ABC...xyz/edit
                                      ^^^^^^^^^^^
                                      SHEET_ID
```

Copy the long ID between `/d/` and `/edit`.

### 3. Create script on personal account

1. Go to [script.google.com](https://script.google.com) while logged into **personal** Google.
2. **New project**.
3. Paste all of **`Code.gs`** from this folder.
4. Set at the top:

```javascript
const SHEET_ID = "paste-school-spreadsheet-id-here";
```

5. **Save**.
6. Select **`testSheetAccess`** in the toolbar → **Run** → **Authorize** when prompted.
7. **View → Logs** should show e.g. `OK: 53 players on 2026 Summer WR & Conditioning`.

### 4. Deploy web app (personal account)

1. **Deploy → New deployment → Web app**
2. **Execute as:** Me (your personal account)
3. **Who has access:** Anyone with the link (or Anyone in domain if ghfb + JSONP need it)
4. **Deploy** → copy URL ending in **`/exec`**

When you change `Code.gs`: **Manage deployments → Edit → New version → Deploy**.

### 5. Connect ghfb

In repo root **`check-in-config.js`**:

```javascript
window.GHFB_CHECKIN_SCRIPT_URL = "https://script.google.com/macros/s/...../exec";
```

Push to `main` (or redeploy Docker).

### 6. Optional PIN

Apps Script → **Project settings → Script properties** → add `COACH_PIN`.

### 7. Practice schedule writes

`Code.gs` also powers coach edits on **`/practice-schedule.html`** (`updatePracticeBlock`).

1. Set `PRACTICE_SPREADSHEET_ID` at the top of `Code.gs` (practice workbook ID from its URL).
2. Share that workbook with the **same Google account** that runs the script (Editor).
3. **Run → `testPracticeSheetAccess`** → logs should show block count.
4. After any `Code.gs` change: **Deploy → Manage deployments → New version → Deploy**.

Edits update column C on the practice tab: label on the block’s first row, blanks on continuation rows. Changing end time may relocate the next period’s label in the sheet.

---

## Alternative: script bound to school sheet

If your **school account can deploy** web apps:

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Paste `Code.gs` and set `SHEET_ID` to the same spreadsheet’s ID (or leave empty and change `getSheet_()` to use `getActiveSpreadsheet()` — school-bound only).
3. Deploy from the school account.

For school-bound projects only, you can use:

```javascript
function getSheet_() {
  const ss = SHEET_ID
    ? SpreadsheetApp.openById(SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Tab not found: "' + SHEET_NAME + '"');
  return sheet;
}
```

The repo version **requires `SHEET_ID`** so one file works for personal standalone deploy.

---

## nginx proxy (optional)

Instead of JSONP + `check-in-config.js`, proxy `/api/checkin` to your `/exec` URL in `deploy/nginx.conf`.

---

## API

| Call | Purpose |
|------|---------|
| `GET ?action=getCheckInData&sessionType=weightroom&pin=` | Roster + today’s marks |
| `GET ?action=getCheckInData&sessionType=practice&pin=` | Roster + today’s **P** practice column |
| `GET ?action=toggleCheckIn&sheetRow=5&sessionType=weightroom&pin=` | Toggle **X** |
| `GET ?action=toggleCheckIn&sheetRow=5&sessionType=practice&pin=` | Toggle **X** in today’s practice column |
| `POST` JSON `{ "action":"toggleCheckIn", ... }` | Toggle (via nginx proxy) |

Add `&callback=fnName` for JSONP (used by ghfb).

---

## Sheet requirements

- Tab name: **`2026 Summer WR & Conditioning`**
- Today’s date column header (e.g. **`6/2`**)
- **`C`** column immediately after that date for conditioning
- **`P 6/9`** (or **`P`** + today’s date) for football practice — separate from ironmen
- Player names in columns **A** and **B**

Form responses and coach tap-list both update this same workbook — no copy needed.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Set SHEET_ID in Code.gs` | Paste spreadsheet ID from URL |
| `Tab not found` | Check `SHEET_NAME` matches tab exactly |
| Authorization / access denied | Re-run `testSheetAccess`; confirm personal account is **Editor** on school sheet |
| `No scheduled weight room…` / `No scheduled conditioning…` | Add today’s date column and/or the `C` column next to it on the sheet (see check-in status message) |
| ghfb banner “not connected” | Set `GHFB_CHECKIN_SCRIPT_URL` in `check-in-config.js` and redeploy ghfb |
| School blocks sharing | Use personal copy as master (see main README) or Form-only check-in |
