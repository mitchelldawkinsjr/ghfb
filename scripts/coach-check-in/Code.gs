/**
 * Coach tap-list check-in for "2026 Summer WR & Conditioning".
 * Deploy as Web app (Execute as: Me, Anyone with the link).
 * Optional Script property: COACH_PIN
 *
 * JSON API (for ghfb check-in.html via /api/checkin proxy):
 *   GET  ?action=getCheckInData&sessionType=weightroom|conditioning&pin=
 *   POST { "action": "toggleCheckIn", "sheetRow": 5, "sessionType": "weightroom", "pin": "" }
 */
const SHEET_NAME = "2026 Summer WR & Conditioning";
const SUMMARY_HEADERS = [
  "Current Total",
  "Ironman %",
  "# of sessions this summer",
  "% required for ironman",
];

function doGet(e) {
  const action = String(e?.parameter?.action ?? "").trim();
  if (action === "getCheckInData") {
    return jsonOutput_(
      getCheckInData(e.parameter.sessionType, e.parameter.pin)
    );
  }
  return HtmlService.createHtmlOutputFromFile("CheckIn")
    .setTitle("GHFB Coach Check-in")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: "' + SHEET_NAME + '"');
  return sheet;
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
