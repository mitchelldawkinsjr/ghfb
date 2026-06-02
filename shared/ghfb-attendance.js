export const ATTENDANCE_START_IDX = 2;
export const HIDDEN_HEADERS = new Set(["Jersey #", "Grade"]);
export const SUMMARY_HEADERS = new Set([
  "Current Total",
  "Ironman %",
  "# of sessions this summer",
  "% required for ironman",
]);

export function parseHeaderDate(value) {
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, Number(match[1]) - 1, Number(match[2]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  match = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const year = new Date().getFullYear();
    const date = new Date(year, Number(match[1]) - 1, Number(match[2]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** M/D label for today's session column (matches sheet headers). */
export function getTodayLabel() {
  const d = getToday();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function getColumnKind(header) {
  const text = String(header ?? "").trim();
  if (text.toUpperCase() === "C") return "conditioning";
  if (parseHeaderDate(text)) return "weightroom";
  return "other";
}

export function formatHeaderLabel(header) {
  const text = String(header ?? "").trim();
  const dateVal = parseHeaderDate(text);
  if (dateVal) {
    return `${dateVal.getMonth() + 1}/${dateVal.getDate()}/${dateVal.getFullYear()}`;
  }
  return text;
}

/**
 * Session columns available through today:
 * each weightroom date on/before today + paired C when listed next.
 */
export function getValidAttendanceIndexes(headers, attendanceStartIdx = ATTENDANCE_START_IDX) {
  const today = getToday();
  const indexes = [];

  for (let col = attendanceStartIdx; col < headers.length; col++) {
    const header = String(headers[col] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;

    const dateVal = parseHeaderDate(header);

    if (dateVal) {
      if (dateVal > today) break;

      indexes.push(col);

      const nextHeader = String(headers[col + 1] ?? "").trim();
      if (nextHeader.toUpperCase() === "C") {
        indexes.push(col + 1);
      }
    }
  }
  return indexes;
}

/** Column index for today's weightroom or conditioning session. */
export function findSessionColumnIndex(headerRow, sessionType) {
  const today = getToday();
  const type = String(sessionType).toLowerCase();

  for (let col = ATTENDANCE_START_IDX; col < headerRow.length; col++) {
    const header = String(headerRow[col] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;

    const dateVal = parseHeaderDate(header);
    if (!dateVal || dateVal > today) continue;
    if (dateVal.getTime() !== today.getTime()) continue;

    if (type === "weightroom") return col;
    if (type === "conditioning") {
      const next = String(headerRow[col + 1] ?? "").trim().toUpperCase();
      if (next === "C") return col + 1;
      return null;
    }
  }
  return null;
}

/** Column index for today's weight room date header, or null if not on the sheet. */
export function findTodayDateColumnIndex(headerRow) {
  const today = getToday();

  for (let col = ATTENDANCE_START_IDX; col < headerRow.length; col++) {
    const header = String(headerRow[col] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;

    const dateVal = parseHeaderDate(header);
    if (!dateVal || dateVal > today) continue;
    if (dateVal.getTime() === today.getTime()) return col;
  }
  return null;
}

/** Coach-facing message when today's session column is missing from the sheet. */
export function getSessionNotScheduledMessage(sessionType, todayLabel, headerRow) {
  const type = String(sessionType).toLowerCase();
  const label = todayLabel || getTodayLabel();
  const dateCol = headerRow ? findTodayDateColumnIndex(headerRow) : null;
  const addDayHint =
    `If today should count toward attendance, add a new column in the spreadsheet labeled ${label} (weight room), with a C column immediately to its right (conditioning).`;

  if (type === "conditioning" && dateCol != null) {
    return (
      `No scheduled conditioning session for today (${label}). ` +
      `The weight room column for ${label} is set up, but the conditioning column (C) is missing. ` +
      `Add a C column in the spreadsheet immediately after ${label}.`
    );
  }

  if (type === "weightroom") {
    return `No scheduled weight room session for today (${label}). ${addDayHint}`;
  }

  return `No scheduled weight room or conditioning for today (${label}). ${addDayHint}`;
}

export function getSheetMeta(headerRow, dataRows) {
  const col = (name) => headerRow.findIndex((h) => String(h ?? "").trim() === name);
  const iSessions = col("# of sessions this summer");
  const iRequired = col("% required for ironman");
  const sample = dataRows[0] || [];

  let summerSessions = 0;
  if (iSessions >= 0 && sample[iSessions]) {
    summerSessions = Number(String(sample[iSessions]).trim());
  }

  let ironMenThresholdRate = 35 / 42;
  if (iRequired >= 0 && sample[iRequired]) {
    const text = String(sample[iRequired]).trim().replace("%", "");
    const pct = Number(text);
    if (!Number.isNaN(pct)) ironMenThresholdRate = pct / 100;
  }

  return { summerSessions, ironMenThresholdRate, iSessions, iRequired };
}

export function computeRollingStats(row, validIndexes) {
  const marks = validIndexes.filter(
    (idx) => String(row[idx] ?? "").trim().toUpperCase() === "X"
  ).length;
  const totalPossible = validIndexes.length;
  const rollingRate = totalPossible > 0 ? marks / totalPossible : 0;
  return { marks, totalPossible, rollingRate };
}

export function getHiddenColumnIndexes(headerRow) {
  return new Set(
    headerRow
      .map((name, idx) => ({ name: String(name ?? "").trim(), idx }))
      .filter((c) => HIDDEN_HEADERS.has(c.name))
      .map((c) => c.idx)
  );
}

export function getTableColumnIndexes(headerRow) {
  const hidden = getHiddenColumnIndexes(headerRow);
  const cols = [];
  for (let idx = 0; idx < headerRow.length; idx++) {
    const header = String(headerRow[idx] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;
    if (!hidden.has(idx)) cols.push(idx);
  }
  return cols;
}

export function getPlayerDisplayName(row) {
  const first = String(row[0] ?? "").trim();
  const last = String(row[1] ?? "").trim();
  return `${first} ${last}`.trim();
}

export function getDataRows(rows) {
  const body = rows.slice(1);
  let end = body.length;
  while (end > 0) {
    const row = body[end - 1];
    const name = getPlayerDisplayName(row);
    const firstCol = String(row[0] ?? "").trim();
    if (name || firstCol) break;
    end -= 1;
  }

  return body.slice(0, end).filter((row) => {
    const name = getPlayerDisplayName(row);
    if (!name) return false;
    if (/^first\s*name$/i.test(String(row[0] ?? "").trim())) return false;
    return true;
  });
}

export function cellIsMark(row, colIndex) {
  return String(row[colIndex] ?? "").trim().toUpperCase() === "X";
}

export function computeRosterParticipation(dataRows, headerRow, validIndexes) {
  const weightroomCols = validIndexes.filter(
    (idx) => getColumnKind(headerRow[idx]) === "weightroom"
  );
  const conditioningCols = validIndexes.filter(
    (idx) => getColumnKind(headerRow[idx]) === "conditioning"
  );
  const rosterSize = dataRows.length;

  let weightroomAttended = 0;
  let conditioningAttended = 0;

  for (const row of dataRows) {
    if (weightroomCols.some((idx) => cellIsMark(row, idx))) weightroomAttended += 1;
    if (conditioningCols.some((idx) => cellIsMark(row, idx))) conditioningAttended += 1;
  }

  return {
    rosterSize,
    weightroomAttended,
    conditioningAttended,
    weightroomPct: rosterSize > 0 ? weightroomAttended / rosterSize : 0,
    conditioningPct: rosterSize > 0 ? conditioningAttended / rosterSize : 0,
    weightroomCols: weightroomCols.length,
    conditioningCols: conditioningCols.length,
  };
}
