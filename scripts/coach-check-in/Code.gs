/**
 * GHFB Coach check-in - personal account, school sheet.
 * 1. Share school sheet with this Google account (Editor).
 * 2. Set SHEET_ID below.
 * 3. Run testSheetAccess, then Deploy Web app.
 * Optional Script property: COACH_PIN
 */
var SHEET_ID = "PASTE_SCHOOL_SPREADSHEET_ID_HERE";
var SHEET_NAME = "2026 Summer WR & Conditioning";
var SUMMARY_HEADERS = [
  "Current Total",
  "Ironman %",
  "# of sessions this summer",
  "% required for ironman",
];

function doGet(e) {
  var action = "";
  if (e && e.parameter && e.parameter.action) {
    action = String(e.parameter.action).trim();
  }
  if (!action) {
    return HtmlService.createHtmlOutput(
      "<p><strong>GHFB Coach Check-in API</strong></p>" +
        "<p>Use ghfb check-in with this URL in check-in-config.js.</p>"
    ).setTitle("GHFB Coach Check-in");
  }

  var result;
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
    var raw = "{}";
    if (e && e.postData && e.postData.contents) {
      raw = e.postData.contents;
    }
    var body = JSON.parse(raw);
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
  var sheet = getSheet_();
  var sessionCol = findSessionColumn_(sheet, sessionType);
  var todayLabel = getTodayHeaderCandidates_()[0];

  if (!sessionCol) {
    return {
      ok: false,
      error:
        "No column found for today (" +
        todayLabel +
        '). Add a "' +
        todayLabel +
        '" date header in the sheet first.',
      sessionType: String(sessionType || "weightroom"),
      todayLabel: todayLabel,
    };
  }

  var roster = getRoster_(sheet);
  var marksByRow = getMarksForColumn_(sheet, sessionCol, roster);
  var players = [];
  var i;
  for (i = 0; i < roster.length; i++) {
    players.push({
      sheetRow: roster[i].sheetRow,
      name: roster[i].name,
      checked: marksByRow[roster[i].sheetRow] === true,
    });
  }

  var checkedCount = 0;
  for (i = 0; i < players.length; i++) {
    if (players[i].checked) checkedCount++;
  }

  return {
    ok: true,
    sessionType: String(sessionType || "weightroom").toLowerCase(),
    todayLabel: todayLabel,
    sessionCol: sessionCol,
    players: players,
    checkedCount: checkedCount,
    total: players.length,
  };
}

function toggleCheckIn(sheetRow, sessionType, pin) {
  verifyPin_(pin);
  var sheet = getSheet_();
  var sessionCol = findSessionColumn_(sheet, sessionType);
  if (!sessionCol) {
    throw new Error("Today session column was not found. Add it in the sheet first.");
  }

  var row = Number(sheetRow);
  if (!row || row < 2) throw new Error("Invalid player row.");

  var cell = sheet.getRange(row, sessionCol);
  var raw = cell.getValue();
  var value = String(raw != null ? raw : "")
    .trim()
    .toUpperCase();
  var next = value === "X" ? "" : "X";
  cell.setValue(next);

  return { ok: true, sheetRow: row, checked: next === "X" };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function respond_(e, obj) {
  var callback = "";
  if (e && e.parameter && e.parameter.callback) {
    callback = String(e.parameter.callback).trim();
  }
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
      "Set SHEET_ID in Code.gs (share the school sheet with this Google account as Editor)."
    );
  }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Tab not found: "' + SHEET_NAME + '"');
  return sheet;
}

function testSheetAccess() {
  var sheet = getSheet_();
  var roster = getRoster_(sheet);
  Logger.log("OK: " + roster.length + " players on " + SHEET_NAME);
}

function verifyPin_(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty("COACH_PIN");
  if (!expected) return;
  var given = pin != null ? String(pin).trim() : "";
  if (given !== String(expected).trim()) {
    throw new Error("Incorrect coach PIN.");
  }
}

function getRoster_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow, 2).getValues();
  var roster = [];
  var i;

  for (i = 0; i < values.length; i++) {
    var first = String(values[i][0] != null ? values[i][0] : "").trim();
    var last = String(values[i][1] != null ? values[i][1] : "").trim();
    var name = (first + " " + last).trim();
    if (!name) continue;
    if (/^first\s*name$/i.test(first)) continue;
    roster.push({ sheetRow: i + 2, name: name });
  }

  while (roster.length > 0) {
    var lastEntry = roster[roster.length - 1];
    var rowVals = sheet
      .getRange(lastEntry.sheetRow, 1, lastEntry.sheetRow, 2)
      .getValues()[0];
    var firstCol = String(rowVals[0] != null ? rowVals[0] : "").trim();
    if (lastEntry.name || firstCol) break;
    roster.pop();
  }

  return roster;
}

function getMarksForColumn_(sheet, col, roster) {
  var out = {};
  if (!roster.length) return out;

  var rows = [];
  var i;
  for (i = 0; i < roster.length; i++) {
    rows.push(roster[i].sheetRow);
  }
  var minRow = Math.min.apply(null, rows);
  var maxRow = Math.max.apply(null, rows);
  var values = sheet.getRange(minRow, col, maxRow, col).getValues();

  for (i = 0; i < roster.length; i++) {
    var idx = roster[i].sheetRow - minRow;
    var cellVal = values[idx][0];
    var v = String(cellVal != null ? cellVal : "")
      .trim()
      .toUpperCase();
    out[roster[i].sheetRow] = v === "X";
  }
  return out;
}

function findSessionColumn_(sheet, sessionType) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var today = startOfDay_(new Date());
  var type = String(sessionType != null ? sessionType : "weightroom").toLowerCase();
  var c;

  for (c = 0; c < headers.length; c++) {
    var header = String(headers[c] != null ? headers[c] : "").trim();
    if (!header || SUMMARY_HEADERS.indexOf(header) >= 0) break;

    var dateVal = parseHeaderDate_(header);
    if (!dateVal || !isSameDay_(dateVal, today)) continue;

    if (type === "weightroom") return c + 1;

    if (type === "conditioning") {
      var nextHeader = headers[c + 1];
      var next = String(nextHeader != null ? nextHeader : "")
        .trim()
        .toUpperCase();
      if (next === "C") return c + 2;
      throw new Error('Today has a date column but no "C" column for conditioning.');
    }
  }
  return null;
}

function getTodayHeaderCandidates_() {
  var tz = Session.getScriptTimeZone();
  var today = new Date();
  return [
    Utilities.formatDate(today, tz, "M/d"),
    Utilities.formatDate(today, tz, "MM/dd"),
    Utilities.formatDate(today, tz, "M/dd"),
  ];
}

function parseHeaderDate_(text) {
  var s = String(text != null ? text : "").trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var year = Number(m[3]);
    if (year < 100) year += 2000;
    return startOfDay_(new Date(year, Number(m[1]) - 1, Number(m[2])));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    year = new Date().getFullYear();
    return startOfDay_(new Date(year, Number(m[1]) - 1, Number(m[2])));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return startOfDay_(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return null;
}

function startOfDay_(d) {
  var x = new Date(d);
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
