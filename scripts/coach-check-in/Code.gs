/**
 * GHFB Coach check-in - personal account, school sheet.
 * 1. Share school sheet with this Google account (Editor).
 * 2. Set SHEET_ID below.
 * 3. Run testSheetAccess, then Deploy Web app.
 * Optional Script property: COACH_PIN
 */
var SHEET_ID = "PASTE_SCHOOL_SPREADSHEET_ID_HERE";
var SHEET_NAME = "2026 Summer WR & Conditioning";
var PRACTICE_SPREADSHEET_ID = "1c5NqGj5b-7CgVY3UuOziaNgDJqDIo0J2j2HjV443HTU";
var PRACTICE_SHEET_GID = 224955206;
var PRACTICE_DATA_START_ROW = 5;
var PRACTICE_DATA_END_ROW = 31;
var PRACTICE_LABEL_COL = 3;
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
    } else if (action === "setCheckInMark") {
      result = setCheckInMark(
        e.parameter.sheetRow,
        e.parameter.sessionType,
        e.parameter.checked,
        e.parameter.pin
      );
    } else if (action === "updatePracticeBlock") {
      result = updatePracticeBlock(
        e.parameter.pin,
        e.parameter.startSheetRow,
        e.parameter.endSheetRow,
        e.parameter.label,
        e.parameter.newEndSheetRow
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
    if (body.action === "setCheckInMark") {
      return jsonOutput_(
        setCheckInMark(body.sheetRow, body.sessionType, body.checked, body.pin)
      );
    }
    if (body.action === "updatePracticeBlock") {
      return jsonOutput_(
        updatePracticeBlock(
          body.pin,
          body.startSheetRow,
          body.endSheetRow,
          body.label,
          body.newEndSheetRow
        )
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
      error: sessionNotScheduledMessage_(sessionType, todayLabel, sheet),
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
    throw new Error(
      sessionNotScheduledMessage_(sessionType, getTodayHeaderCandidates_()[0], sheet)
    );
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

/** Set attendance mark explicitly (used when SQLite is source of truth). */
function setCheckInMark(sheetRow, sessionType, checked, pin) {
  verifyPin_(pin);
  var sheet = getSheet_();
  var sessionCol = findSessionColumn_(sheet, sessionType);
  if (!sessionCol) {
    throw new Error(
      sessionNotScheduledMessage_(sessionType, getTodayHeaderCandidates_()[0], sheet)
    );
  }

  var row = Number(sheetRow);
  if (!row || row < 2) throw new Error("Invalid player row.");

  var wantChecked =
    checked === true ||
    checked === 1 ||
    String(checked != null ? checked : "")
      .trim()
      .toLowerCase() === "true" ||
    String(checked != null ? checked : "").trim() === "1";

  var next = wantChecked ? "X" : "";
  sheet.getRange(row, sessionCol).setValue(next);

  return { ok: true, sheetRow: row, checked: wantChecked };
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
  var wrCol = findSessionColumn_(sheet, "weightroom");
  var condCol = findSessionColumn_(sheet, "conditioning");
  var practiceCol = findSessionColumn_(sheet, "practice");
  Logger.log("OK: " + roster.length + " players on " + SHEET_NAME);
  Logger.log(
    "Today weightroom col: " +
      wrCol +
      ", conditioning col: " +
      condCol +
      ", practice col: " +
      practiceCol
  );
}

function testPracticeSheetAccess() {
  var sheet = getPracticeSheet_();
  var labels = readPracticeLabelColumn_(sheet);
  var starts = findPracticeBlockStarts_(labels);
  Logger.log("OK: practice tab " + sheet.getName() + ", " + starts.length + " blocks");
}

function getPracticeSheet_() {
  if (!PRACTICE_SPREADSHEET_ID) {
    throw new Error(
      "Set PRACTICE_SPREADSHEET_ID in Code.gs (share the practice workbook with this account as Editor)."
    );
  }
  var ss = SpreadsheetApp.openById(PRACTICE_SPREADSHEET_ID);
  var sheets = ss.getSheets();
  var i;
  for (i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === PRACTICE_SHEET_GID) return sheets[i];
  }
  throw new Error("Practice schedule tab not found (gid=" + PRACTICE_SHEET_GID + ")");
}

function readPracticeLabelColumn_(sheet) {
  return sheet
    .getRange(
      PRACTICE_DATA_START_ROW,
      PRACTICE_LABEL_COL,
      PRACTICE_DATA_END_ROW,
      PRACTICE_LABEL_COL
    )
    .getValues();
}

function findPracticeBlockStarts_(labels) {
  var starts = [];
  var i;
  for (i = 0; i < labels.length; i++) {
    var value = String(labels[i][0] != null ? labels[i][0] : "").trim();
    if (value) {
      starts.push({
        sheetRow: PRACTICE_DATA_START_ROW + i,
        label: value,
      });
    }
  }
  return starts;
}

function findPracticeNextBlock_(labels, afterRow) {
  var starts = findPracticeBlockStarts_(labels);
  var i;
  for (i = 0; i < starts.length; i++) {
    if (starts[i].sheetRow > afterRow) return starts[i];
  }
  return null;
}

function updatePracticeBlock(pin, startSheetRow, endSheetRow, label, newEndSheetRow) {
  verifyPin_(pin);
  var sheet = getPracticeSheet_();
  var startRow = Number(startSheetRow);
  var endRow = Number(endSheetRow);
  var newEnd =
    newEndSheetRow != null && String(newEndSheetRow).trim() !== ""
      ? Number(newEndSheetRow)
      : endRow;
  var labelText = label != null ? String(label) : "";

  if (!startRow || startRow < PRACTICE_DATA_START_ROW || startRow > PRACTICE_DATA_END_ROW) {
    throw new Error("Invalid block start row.");
  }
  if (!endRow || endRow < startRow || endRow > PRACTICE_DATA_END_ROW) {
    throw new Error("Invalid block end row.");
  }
  if (!newEnd || newEnd < startRow || newEnd > PRACTICE_DATA_END_ROW) {
    throw new Error("Invalid new end row.");
  }

  var labels = readPracticeLabelColumn_(sheet);
  var starts = findPracticeBlockStarts_(labels);
  var isStart = false;
  var i;
  for (i = 0; i < starts.length; i++) {
    if (starts[i].sheetRow === startRow) {
      isStart = true;
      break;
    }
  }
  if (!isStart) throw new Error("Start row is not a block header row.");

  var nextBlock = findPracticeNextBlock_(labels, endRow);
  var labelCol = PRACTICE_LABEL_COL;

  if (newEnd > endRow && nextBlock && newEnd >= nextBlock.sheetRow) {
    var afterNext = findPracticeNextBlock_(labels, nextBlock.sheetRow);
    var nextBlockEnd = afterNext ? afterNext.sheetRow - 1 : PRACTICE_DATA_END_ROW;
    if (newEnd < nextBlockEnd) {
      sheet.getRange(newEnd + 1, labelCol).setValue(nextBlock.label);
      sheet.getRange(nextBlock.sheetRow, labelCol).setValue("");
    } else if (afterNext) {
      sheet.getRange(newEnd + 1, labelCol).setValue(afterNext.label);
      sheet.getRange(afterNext.sheetRow, labelCol).setValue("");
      sheet.getRange(nextBlock.sheetRow, labelCol).setValue("");
    } else {
      sheet.getRange(nextBlock.sheetRow, labelCol).setValue("");
    }
  }

  if (newEnd < endRow && nextBlock) {
    sheet.getRange(newEnd + 1, labelCol).setValue(nextBlock.label);
    if (nextBlock.sheetRow !== newEnd + 1) {
      sheet.getRange(nextBlock.sheetRow, labelCol).setValue("");
    }
  }

  sheet.getRange(startRow, labelCol).setValue(labelText);
  for (i = startRow + 1; i <= newEnd; i++) {
    sheet.getRange(i, labelCol).setValue("");
  }

  return {
    ok: true,
    startSheetRow: startRow,
    endSheetRow: newEnd,
    label: labelText,
  };
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

function isPracticeHeader_(header) {
  var text = headerToString_(header);
  return /^P(\s+|\s*\d)/i.test(text);
}

function parsePracticeHeaderDate_(header) {
  var text = headerToString_(header);
  var direct = text.match(/^P\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*$/i);
  if (direct) return parseHeaderDate_(direct[1]);
  var embedded = text.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (embedded) return parseHeaderDate_(embedded[1]);
  return null;
}

function findTodayPracticeColumn_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var today = startOfDay_(new Date());
  var c;

  for (c = 0; c < headers.length; c++) {
    var header = headerToString_(headers[c]);
    if (!header) continue;
    if (SUMMARY_HEADERS.indexOf(header) >= 0) break;
    if (!isPracticeHeader_(header)) continue;

    var dateVal = parsePracticeHeaderDate_(headers[c]);
    if (dateVal && isSameDay_(dateVal, today)) return c + 1;
  }
  return null;
}

function findSessionColumn_(sheet, sessionType) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var today = startOfDay_(new Date());
  var type = String(sessionType != null ? sessionType : "weightroom").toLowerCase();
  var c;

  if (type === "practice") return findTodayPracticeColumn_(sheet);

  for (c = 0; c < headers.length; c++) {
    var header = headerToString_(headers[c]);
    if (!header) continue;
    if (SUMMARY_HEADERS.indexOf(header) >= 0) break;

    var dateVal = parseHeaderDate_(headers[c]);
    if (!dateVal || !isSameDay_(dateVal, today)) continue;

    if (type === "weightroom") return c + 1;

    if (type === "conditioning") {
      var next = headerToString_(headers[c + 1]).toUpperCase();
      if (next === "C") return c + 2;
      return null;
    }
  }
  return null;
}

function findTodayDateColumn_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var today = startOfDay_(new Date());
  var c;

  for (c = 0; c < headers.length; c++) {
    var header = headerToString_(headers[c]);
    if (!header) continue;
    if (SUMMARY_HEADERS.indexOf(header) >= 0) break;

    var dateVal = parseHeaderDate_(headers[c]);
    if (dateVal && isSameDay_(dateVal, today)) return c + 1;
  }
  return null;
}

function sessionNotScheduledMessage_(sessionType, todayLabel, sheet) {
  var type = String(sessionType != null ? sessionType : "weightroom").toLowerCase();
  var label = todayLabel || getTodayHeaderCandidates_()[0];
  var dateCol = sheet ? findTodayDateColumn_(sheet) : null;
  var addDayHint =
    "If today should count toward attendance, add a new column in the spreadsheet labeled " +
    label +
    " (weight room), with a C column immediately to its right (conditioning).";

  if (type === "conditioning" && dateCol) {
    return (
      "No scheduled conditioning session for today (" +
      label +
      "). The weight room column for " +
      label +
      " is set up, but the conditioning column (C) is missing. " +
      "Add a C column in the spreadsheet immediately after " +
      label +
      "."
    );
  }

  if (type === "weightroom") {
    return "No scheduled weight room session for today (" + label + "). " + addDayHint;
  }

  if (type === "practice") {
    return (
      "No practice column for today (" +
      label +
      "). Add a column labeled P " +
      label +
      " on the attendance sheet. Practice columns are tracked separately and do not affect ironmen."
    );
  }

  return "No scheduled weight room or conditioning for today (" + label + "). " + addDayHint;
}

/** Normalize row-1 header cells (text "6/2" or Sheets date values). */
function headerToString_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "M/d");
  }
  if (typeof value === "number" && value > 0) {
    var fromSerial = parseHeaderDate_(value);
    if (fromSerial) {
      return Utilities.formatDate(fromSerial, Session.getScriptTimeZone(), "M/d");
    }
  }
  return String(value != null ? value : "").trim();
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

function parseHeaderDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return startOfDay_(value);
  }
  if (typeof value === "number" && value > 0) {
    var epoch = new Date(Date.UTC(1899, 11, 30));
    var fromSerial = new Date(epoch.getTime() + Math.round(value * 86400000));
    if (!isNaN(fromSerial.getTime())) return startOfDay_(fromSerial);
  }
  var s = String(value != null ? value : "").trim();
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
