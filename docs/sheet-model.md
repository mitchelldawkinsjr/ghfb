# Spreadsheet data model

Attendance lives on the school Google Sheet, tab **`2026 Summer WR & Conditioning`**. The hub dashboard and coach check-in mirror the same column rules as Apps Script and the workbook formulas.

## Column layout

```text
Col A–B:   First name / Last name (roster rows start at row 2)
Col 3+:    [M/D date] [optional C] [M/D date] [C] … [P M/D practice] …
           then summary columns:
           "Current Total", "Ironman %", "# of sessions this summer",
           "% required for ironman"
```

## Session columns for “today”

| Session type | Column used |
|--------------|-------------|
| **weightroom** | Header whose date equals **today** (`6/2`, a Sheets Date object, or `6/2/2026`) |
| **conditioning** | **`C`** in the column immediately after today’s date header |

If there is no `C` after today’s date, conditioning check-in returns no column (Apps Script does not throw; the UI shows an error to add the column).

## Practice columns (`P`)

Football practice attendance uses headers starting with **`P`** and a date, e.g. **`P 6/9`**, **`P 6/11`**.

| Rule | Detail |
|------|--------|
| Mark | `X` = attended practice |
| Ironmen / momentum | **Not included** — only plain `M/D` date headers + paired `C` count |
| Dashboard | Green **Practice** columns; roster pie “at Practice” when P columns exist |
| Hub | Shows today’s practice check-in count when a `P` column matches today |
| Coach check-in | **Practice** tab writes `X` to today’s `P` column (same API as WR/C) |

Verify after sheet changes:

```bash
node tools/verify-attendance-practice.mjs
```

## Mark convention

| Cell value | Meaning |
|------------|---------|
| `X` (case-insensitive) | Attended that session |
| Empty | Not marked |

`toggleCheckIn` flips between `X` and empty.

## Rolling attendance (dashboard)

Eligible session slots **through today**:

- Each **weightroom** date header on or before today.
- Its paired **`C`** column when `C` appears in the next column.
- Processing **stops** at the first **future** date header.

**Rolling %** = count of `X` marks ÷ count of eligible session slots.

**Ironmen:** players whose rolling average is at or above **`% required for ironman`** from the sheet (derived from summer session count in the workbook).

**Momentum:** team attendance rate over the last seven valid session columns.

## Roster (~53 players)

Player rows are derived from first/last name columns:

- Trim footer rows with empty names.
- Skip header-like rows (`First name` in column A).
- Display name logic is shared in `shared/ghfb-attendance.js` (`getPlayerDisplayName`, `getDataRows`).

## Changing the sheet

1. Add new date + optional `C` columns in the sheet.
2. Ensure the **published CSV** URL in `deploy/nginx.conf` still points at the correct tab (`gid=`).
3. Redeploy **Apps Script** if `Code.gs` changed (`Deploy → New version`).
4. Redeploy **ghfb** Docker image if nginx CSV URL changed.

After structure changes, the dashboard may take up to ~90s (nginx) + 3 min (browser CSV cache) to reflect new columns; check-in uses live API for writes and CSV/API merge for reads.

## Daily Lift Plan tab

The hub today strip and coach check-in banner read **today’s lift** from a separate tab on the same school spreadsheet.

**Tab name:** `Daily Lift Plan`

| Column | Required | Purpose |
|--------|----------|---------|
| **Date** | Yes | Session date (`6/2/2026`, `6/2`, or a Sheets date value) |
| **Label** | Yes | Display text on hub/check-in (e.g. `Phase 2 · Lower A`) |
| **Phase** | For lift days | gh-lift phase slug (e.g. `phase-2`) |
| **Session** | For lift days | gh-lift session slug (e.g. `w3-lift-a`, `w4-lift-b`) |
| **Notes** | No | Optional (e.g. `Conditioning only`) |
| **LiftLink** | No | Optional full URL override if hash links are not set up yet |

**Rules:**

- One row per calendar day you want to show on the hub.
- Leave **Phase** and **Session** empty (or set **Label** to `Off`) for non-lift days.
- ghfb builds the default link as `/lift/#/{phase}/{session}` when Phase and Session are set (e.g. `#/phase-2/w3-lift-a`, `#/phase-1/day-a`). gh-lift also accepts legacy slugs like `lower-a` for the same MWF session. Run `node tools/print-route-slugs.mjs` in the **gh-lift** repo for in-app slugs. Phase 5 has two blocks: use `phase-5` or `phase-5-21-22` for wks 21–22, and `phase-5-23-24` for wks 23–24.

### Publish the lift plan tab

1. In Google Sheets: **File → Share → Publish to web** → choose the **Daily Lift Plan** tab → **Comma-separated values (.csv)** → Publish.
2. Copy the `gid=` from the published URL.
3. Set that `gid` in `deploy/nginx.conf` on the `/api/lift-plan.csv` route (same workbook as attendance, different tab id). Current production tab: **`gid=1599839883`**.
4. Redeploy ghfb.

Lift plan CSV is cached by nginx (~90s) and optionally in the browser (~5 min). Attendance and lift plan are independent tabs.

## Summer schedule ICS (`/schedule.html`)

The downloadable `.ics` file merges:

1. Events parsed from the **2026 Summer Schedule** HTML export (`files/summer-schedule-2026/`).
2. **Conditioning** entries for every attendance-sheet day where a date header is followed by a **`C`** column (same rules as check-in), default **4:00–6:00 PM**.

Regenerate after sheet or HTML changes:

```bash
node tools/extract-summer-schedule-events.mjs
```
