/**
 * Coach tap-list check-in for "2026 Summer WR & Conditioning".
 *
 * School sheet + personal Google account (recommended):
 *   1. Share the school spreadsheet with your personal Gmail as Editor.
 *   2. Create a standalone Apps Script project on your personal account (script.google.com).
 *   3. Paste this file, set SHEET_ID below, Run → testSheetAccess once, then Deploy → Web app.
 *
 * Deploy: Execute as Me, Anyone with the link (or your domain).
 * Optional Script property: COACH_PIN
 *
 * JSON API (ghfb check-in.html via check-in-config.js JSONP):
 *   GET ?action=getCheckInData&sessionType=weightroom|conditioning&pin=
 *   GET ?action=toggleCheckIn&sheetRow=5&sessionType=weightroom&pin=
 */
/** School spreadsheet ID from URL: .../spreadsheets/d/COPY_THIS_PART/edit */
const SHEET_ID = "";
const SHEET_NAME = "2026 Summer WR & Conditioning";
const SUMMARY_HEADERS = [
  "Current Total",
  "Ironman %",
  "# of sessions this summer",
  "% required for ironman",
];

function doGet(e) {
  const action = String(e?.parameter?.action ?? "").trim();
  if (!action) {
    return HtmlService.createHtmlOutput(
      "<p><strong>GHFB Coach Check-in API</strong></p>" +
        "<p>Use <a href=\"https://ghfb.360web.cloud/check-in.html\">ghfb check-in</a> " +
        "with this deployment URL in check-in-config.js.</p>"
    ).setTitle("GHFB Coach Check-in");
  }

  let result;
  try {
    if (action === "getCheckInData") {
      result = getCheckInData(e.parameter.sessionType, e.parameter.pin);
    } else if (action === "toggleCheckIn") {
      result = toggleCheckIn(
        e.parameter.sheetRow,
        e.parameter.sessionType,
        e.parameter.pin
      );
    } else {
      result = { ok: false, error: "Unknown action: " + action };
    }
  } catch (err) {
    result = { ok: false, error: String(err.message || err) };
  }
  return respond_(e, result);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData?.contents || "{}");
    if (body.action === "toggleCheckIn") {
      return jsonOutput_(
        toggleCheckIn(body.sheetRow, body.sessionType, body.pin)
      );
    }
    return jsonOutput_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err.message || err) });
  }
}

function getCheckInData(sessionType, pin) {
  verifyPin_(pin);
  const sheet = getSheet_();
  const sessionCol = findSessionColumn_(sheet, sessionType);
  const todayLabel = getTodayHeaderCandidates_()[0];

  if (!sessionCol) {
    return {
      ok: false,
      error:
        'No column found for today (' +
        todayLabel +
        '). Add a "' +
        todayLabel +
        '" date header in the sheet first.',
      sessionType: String(sessionType || "weightroom"),
      todayLabel,
    };
  }

  const roster = getRoster_(sheet);
  const marksByRow = getMarksForColumn_(sheet, sessionCol, roster);

  const players = roster.map((p) => ({
    sheetRow: p.sheetRow,
    name: p.name,
    checked: marksByRow[p.sheetRow] === true,
  }));

  return {
    ok: true,
    sessionType: String(sessionType || "weightroom").toLowerCase(),
    todayLabel,
    sessionCol,
    players,
    checkedCount: players.filter((p) => p.checked).length,
    total: players.length,
  };
}

function toggleCheckIn(sheetRow, sessionType, pin) {
  verifyPin_(pin);
  const sheet = getSheet_();
  const sessionCol = findSessionColumn_(sheet, sessionType);
  if (!sessionCol) {
    throw new Error("Today's session column was not found. Add it in the sheet first.");
  }

  const row = Number(sheetRow);
  if (!row || row < 2) throw new Error("Invalid player row.");

  const cell = sheet.getRange(row, sessionCol);
  const value = String(cell.getValue() ?? "").trim().toUpperCase();
  const next = value === "X" ? "" : "X";
  cell.setValue(next);

  return { ok: true, sheetRow: row, checked: next === "X" };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** JSON for fetch (/api/checkin proxy) or JSONP for ghfb check-in-config.js */
function respond_(e, obj) {
  const callback = String(e?.parameter?.callback ?? "").trim();
  if (callback && /^[A-Za-z_$][\w.$]*$/.test(callback)) {
    return ContentService.createTextOutput(
      callback + "(" + JSON.stringify(obj) + ");"
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOutput_(obj);
}

function getSheet_() {
  if (!SHEET_ID) {
    throw new Error(
      "Set SHEET_ID in Code.gs to the school spreadsheet ID (share that sheet with this Google account as Editor)."
    );
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Tab not found: "' + SHEET_NAME + '"');
  return sheet;
}

/** Run once from the script editor (personal account) to authorize sheet access. */
function testSheetAccess() {
  const sheet = getSheet_();
  const roster = getRoster_(sheet);
  Logger.log("OK: " + roster.length + " players on " + SHEET_NAME);
}

function verifyPin_(pin) {
  const expected = PropertiesService.getScriptProperties().getProperty("COACH_PIN");
  if (!expected) return;
  if (String(pin ?? "").trim() !== String(expected).trim()) {
    throw new Error("Incorrect coach PIN.");
  }
}

function getRoster_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow, 2).getValues();
  const roster = [];

  for (let i = 0; i < values.length; i++) {
    const first = String(values[i][0] ?? "").trim();
    const last = String(values[i][1] ?? "").trim();
    const name = (first + " " + last).trim();
    if (!name) continue;
    if (/^first\s*name$/i.test(first)) continue;
    roster.push({ sheetRow: i + 2, name: name });
  }

  while (roster.length > 0) {
    const last = roster[roster.length - 1];
    const rowVals = sheet.getRange(last.sheetRow, 1, last.sheetRow, 2).getValues()[0];
    const firstCol = String(rowVals[0] ?? "").trim();
    if (last.name || firstCol) break;
    roster.pop();
  }

  return roster;
}

function getMarksForColumn_(sheet, col, roster) {
  const out = {};
  if (!roster.length) return out;

  const rows = roster.map((p) => p.sheetRow);
  const minRow = Math.min.apply(null, rows);
  const maxRow = Math.max.apply(null, rows);
  const values = sheet.getRange(minRow, col, maxRow, col).getValues();

  roster.forEach((p) => {
    const idx = p.sheetRow - minRow;
    const v = String(values[idx][0] ?? "").trim().toUpperCase();
    out[p.sheetRow] = v === "X";
  });
  return out;
}

function findSessionColumn_(sheet, sessionType) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const today = startOfDay_(new Date());
  const type = String(sessionType ?? "weightroom").toLowerCase();

  for (let c = 0; c < headers.length; c++) {
    const header = String(headers[c] ?? "").trim();
    if (!header || SUMMARY_HEADERS.indexOf(header) >= 0) break;

    const dateVal = parseHeaderDate_(header);
    if (!dateVal || !isSameDay_(dateVal, today)) continue;

    if (type === "weightroom") return c + 1;

    if (type === "conditioning") {
      const next = String(headers[c + 1] ?? "").trim().toUpperCase();
      if (next === "C") return c + 2;
      throw new Error('Today has a date column but no "C" column for conditioning.');
    }
  }
  return null;
}

function getTodayHeaderCandidates_() {
  const tz = Session.getScriptTimeZone();
  const today = new Date();
  return [
    Utilities.formatDate(today, tz, "M/d"),
    Utilities.formatDate(today, tz, "MM/dd"),
    Utilities.formatDate(today, tz, "M/dd"),
  ];
}

function parseHeaderDate_(text) {
  const s = String(text ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return startOfDay_(new Date(year, Number(m[1]) - 1, Number(m[2])));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const year = new Date().getFullYear();
    return startOfDay_(new Date(year, Number(m[1]) - 1, Number(m[2])));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return startOfDay_(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return null;
}

function startOfDay_(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay_(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
