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

/** Calendar day before today (local), midnight. */
export function getYesterday() {
  const yesterday = getToday();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
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
 * Session columns available through a cutoff date (default: today):
 * each weightroom date on/before cutoff + paired C when listed next.
 */
export function getValidAttendanceIndexes(
  headers,
  attendanceStartIdx = ATTENDANCE_START_IDX,
  throughDate = getToday()
) {
  const indexes = [];

  for (let col = attendanceStartIdx; col < headers.length; col++) {
    const header = String(headers[col] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;

    const dateVal = parseHeaderDate(header);

    if (dateVal) {
      if (dateVal > throughDate) break;

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

export const MISSED_24_THRESHOLD = 24;
export const NEAR_IRONMAN_MARGIN = 0.08;
export const AT_RISK_MAX = 8;

/** Rolling stats, momentum, ironmen, and roster participation from parsed attendance rows. */
export function buildAttendanceSummary(rows, attendanceStartIdx = ATTENDANCE_START_IDX) {
  const headerRow = rows[0] || [];
  const dataRows = getDataRows(rows);
  const validIndexes = getValidAttendanceIndexes(headerRow, attendanceStartIdx);
  const completedIndexes = getValidAttendanceIndexes(headerRow, attendanceStartIdx, getYesterday());
  const lastSevenIndexes = completedIndexes.slice(-7);
  const sheetMeta = getSheetMeta(headerRow, dataRows);
  const ironMenThresholdRate = sheetMeta.ironMenThresholdRate;
  const todayLabel = getTodayLabel();

  const playerTotals = dataRows.map((row) => {
    const name = getPlayerDisplayName(row);
    const rolling = computeRollingStats(row, validIndexes);
    return { name, ...rolling };
  });

  const totalPossible = validIndexes.length;
  const completedTotalPossible = completedIndexes.length;
  const top = [...playerTotals].sort((a, b) => b.rollingRate - a.rollingRate)[0];
  const ironMen = dataRows
    .map((row) => {
      const name = getPlayerDisplayName(row);
      return { name, ...computeRollingStats(row, completedIndexes) };
    })
    .filter(
      (p) => p.totalPossible > 0 && p.rollingRate >= ironMenThresholdRate
    );

  const momentumMarks = dataRows.reduce((sum, row) => {
    const rowMarks = lastSevenIndexes.filter(
      (idx) => String(row[idx] ?? "").trim().toUpperCase() === "X"
    ).length;
    return sum + rowMarks;
  }, 0);
  const momentumPossible = dataRows.length * lastSevenIndexes.length;
  const momentumRate = momentumPossible > 0 ? momentumMarks / momentumPossible : 0;

  const rosterParticipation = computeRosterParticipation(dataRows, headerRow, validIndexes);

  return {
    playerTotals,
    dataRows,
    headerRow,
    validIndexes,
    completedIndexes,
    lastSevenIndexes,
    ironMen,
    ironMenThresholdRate,
    momentumRate,
    momentumMarks,
    momentumPossible,
    top,
    totalPossible,
    completedTotalPossible,
    todayLabel,
    rosterParticipation,
  };
}

/** Today's weight room / conditioning column setup and check-in counts. */
export function getTodaySessionStatus(headerRow, dataRows) {
  const weightroomCol = findSessionColumnIndex(headerRow, "weightroom");
  const conditioningCol = findSessionColumnIndex(headerRow, "conditioning");
  const dateCol = findTodayDateColumnIndex(headerRow);
  const total = dataRows?.length ?? 0;
  let wrChecked = 0;
  let condChecked = 0;

  if (dataRows?.length) {
    if (weightroomCol != null) {
      wrChecked = dataRows.filter((row) => cellIsMark(row, weightroomCol)).length;
    }
    if (conditioningCol != null) {
      condChecked = dataRows.filter((row) => cellIsMark(row, conditioningCol)).length;
    }
  }

  return {
    weightroomCol,
    conditioningCol,
    dateCol,
    wrChecked,
    condChecked,
    total,
  };
}

/** Coach call lists for players who need a conversation. */
export function computeAtRiskPlayers(ctx) {
  const {
    playerTotals,
    dataRows,
    headerRow,
    validIndexes,
    ironMenThresholdRate,
  } = ctx;

  const weightroomCols = validIndexes.filter(
    (idx) => getColumnKind(headerRow[idx]) === "weightroom"
  );
  const conditioningCols = validIndexes.filter(
    (idx) => getColumnKind(headerRow[idx]) === "conditioning"
  );

  const nearIronman = [];
  const heavyMisses = [];
  const splitAttendance = [];

  for (const player of playerTotals) {
    const { name, rollingRate, marks, totalPossible } = player;
    const missed = totalPossible - marks;

    if (
      totalPossible > 0 &&
      rollingRate < ironMenThresholdRate &&
      rollingRate >= ironMenThresholdRate - NEAR_IRONMAN_MARGIN
    ) {
      const marksNeeded = Math.max(0, Math.ceil(ironMenThresholdRate * totalPossible) - marks);
      nearIronman.push({
        name,
        rollingRate,
        reason: `${marksNeeded} more mark${marksNeeded === 1 ? "" : "s"} needed for ironman`,
      });
    }

    if (totalPossible > 0 && missed >= MISSED_24_THRESHOLD) {
      heavyMisses.push({
        name,
        rollingRate,
        reason: `${missed} missed sessions`,
      });
    }
  }

  for (const row of dataRows) {
    const name = getPlayerDisplayName(row);
    const wrMarks = weightroomCols.filter((idx) => cellIsMark(row, idx)).length;
    const condMarks = conditioningCols.filter((idx) => cellIsMark(row, idx)).length;
    const player = playerTotals.find((p) => p.name === name);
    const rollingRate = player?.rollingRate ?? 0;

    if (wrMarks > 0 && condMarks === 0 && conditioningCols.length > 0) {
      splitAttendance.push({
        name,
        rollingRate,
        reason: "Weight room only — no conditioning marks",
      });
    } else if (condMarks > 0 && wrMarks === 0 && weightroomCols.length > 0) {
      splitAttendance.push({
        name,
        rollingRate,
        reason: "Conditioning only — no weight room marks",
      });
    }
  }

  const sortByRate = (a, b) => a.rollingRate - b.rollingRate || a.name.localeCompare(b.name);

  return {
    nearIronman: nearIronman.sort(sortByRate).slice(0, AT_RISK_MAX),
    heavyMisses: heavyMisses.sort(sortByRate).slice(0, AT_RISK_MAX),
    splitAttendance: splitAttendance.sort(sortByRate).slice(0, AT_RISK_MAX),
  };
}

/** Human-readable attendance column status for hub/check-in banners. */
export function describeTodaySessionStatus(headerRow) {
  const todayLabel = getTodayLabel();
  const dateCol = findTodayDateColumnIndex(headerRow);
  const wrCol = findSessionColumnIndex(headerRow, "weightroom");
  const condCol = findSessionColumnIndex(headerRow, "conditioning");

  if (wrCol == null) {
    return {
      level: "warn",
      message: getSessionNotScheduledMessage("weightroom", todayLabel, headerRow),
    };
  }
  if (condCol == null) {
    return {
      level: "info",
      message: `Weight room column ready for ${todayLabel}. Conditioning column (C) not set up yet.`,
    };
  }
  return {
    level: "ok",
    message: `Weight room and conditioning columns ready for ${todayLabel}.`,
  };
}
