import { parseCSV } from "/shared/ghfb-csv.js";
import { parseHeaderDate, getToday } from "/shared/ghfb-attendance.js";

const EASTERN_TZ = "America/New_York";

/**
 * Returns { hours, minutes, seconds } in Eastern Time regardless of where
 * the browser's system clock is set.
 */
export function getEasternHMS(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => {
    const v = parts.find((p) => p.type === type)?.value;
    const n = Number(v ?? 0);
    return Number.isNaN(n) ? 0 : n % 24;
  };
  return { hours: get("hour"), minutes: get("minute"), seconds: get("second") };
}

export function getEasternTotalMinutes(date = new Date()) {
  const { hours, minutes } = getEasternHMS(date);
  return hours * 60 + minutes;
}

export const PRACTICE_SCHEDULE_CSV_URL = "/api/practice-schedule.csv";
export const PRACTICE_SCHEDULE_CACHE_KEY = "ghfb-practice-schedule-csv";
export const PRACTICE_SCHEDULE_CACHE_TTL_MS = 5 * 60 * 1000;
export const PRACTICE_SHEET_EDIT_URL =
  "https://docs.google.com/spreadsheets/d/1c5NqGj5b-7CgVY3UuOziaNgDJqDIo0J2j2HjV443HTU/edit?gid=224955206#gid=224955206";

/** Rows 1–4 are headers; row 4 (POS/QB/WR…) is ignored for the timeline. */
export const PRACTICE_HEADER_ROWS = 4;
export const PRACTICE_TIME_COL = 1;
export const PRACTICE_LABEL_COL = 2;
export const PRACTICE_SLOT_MINUTES = 5;
export const PRACTICE_DATA_START_SHEET_ROW = 5;

export function parsePracticeTime(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = String(match[3] ?? "").toUpperCase();

  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 8) hour += 12;

  return hour * 60 + minute;
}

/** Display clock derived from CSV time column after parsePracticeTime(). */
export function formatPracticeClock(totalMinutes) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const hour12 = hour24 % 12 || 12;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

export function formatPracticeRange(startMinutes, endMinutes) {
  return `${formatPracticeClock(startMinutes)} – ${formatPracticeClock(endMinutes)}`;
}

export function blockDisplayTitle(label) {
  const line = String(label ?? "")
    .split(/\r?\n/)[0]
    .trim();
  return line || "Period";
}

export function parsePracticeSheetMeta(rows) {
  if (!rows?.length) {
    return { title: "Practice", subtitle: "", date: null, dateLabel: "" };
  }

  const bannerRow = rows[0] || [];
  const dateRow = rows[2] || [];
  const title = String(bannerRow[2] ?? "").trim() || "Practice";

  let date = parseHeaderDate(dateRow[0]);
  if (!date) {
    const dateText = String(dateRow[2] ?? "");
    const match = dateText.match(/DATE:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (match) date = parseHeaderDate(match[1]);
  }

  const dateLabel = date
    ? date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : String(dateRow[2] ?? "").trim();

  return { title, subtitle: "Practice schedule", date, dateLabel };
}

export function splitBlockLabel(label) {
  const lines = String(label ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const title = lines[0] || "";
  const notes = lines.slice(1).filter(Boolean).join("\n");
  return { title, notes };
}

export function joinBlockLabel(title, notes) {
  const t = String(title ?? "").trim();
  const n = String(notes ?? "").trim();
  if (!t) return n;
  if (!n) return t;
  return `${t}\n${n}`;
}

export function getPracticeSlots(rows) {
  const dataRows = (rows || []).slice(PRACTICE_HEADER_ROWS);
  return forwardFillLabels(dataRows);
}

export function getMaxEndSheetRow(block, blocks, blockIndex, slots) {
  const nextBlock = blocks[blockIndex + 1];
  if (!nextBlock) {
    const lastSlot = slots[slots.length - 1];
    return lastSlot?.sheetRow ?? block.endSheetRow;
  }
  return nextBlock.endSheetRow;
}

export function getEndRowOptions(block, blocks, blockIndex, slots) {
  const maxEndRow = getMaxEndSheetRow(block, blocks, blockIndex, slots);
  const options = [];
  for (const slot of slots) {
    if (slot.sheetRow < block.startSheetRow) continue;
    if (slot.sheetRow > maxEndRow) break;
    const endMinutes = parsePracticeTime(slot.timeText);
    if (endMinutes == null) continue;
    options.push({
      sheetRow: slot.sheetRow,
      endMinutes: endMinutes + PRACTICE_SLOT_MINUTES,
      endTimeText: formatPracticeClock(endMinutes + PRACTICE_SLOT_MINUTES),
      durationMin: ((slot.sheetRow - block.startSheetRow + 1) * PRACTICE_SLOT_MINUTES),
    });
  }
  return options;
}

export function clearPracticeScheduleCache() {
  try {
    sessionStorage.removeItem(PRACTICE_SCHEDULE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function forwardFillLabels(dataRows) {
  let lastLabel = "";
  return dataRows.map((row, index) => {
    const label = String(row[PRACTICE_LABEL_COL] ?? "").trim();
    if (label) lastLabel = label;
    return {
      sheetRow: PRACTICE_DATA_START_SHEET_ROW + index,
      period: String(row[0] ?? "").trim(),
      timeText: String(row[PRACTICE_TIME_COL] ?? "").trim(),
      label: label || lastLabel,
      rawLabel: label,
    };
  });
}

/**
 * Collapse 5-minute CSV rows into merged timeline blocks.
 * A new block starts on each row with an explicit label in column C;
 * blank cells below (merged in the sheet) extend the current block.
 */
export function collapsePracticeBlocks(rows) {
  const dataRows = (rows || []).slice(PRACTICE_HEADER_ROWS);
  if (!dataRows.length) return [];

  const filled = forwardFillLabels(dataRows);
  const blocks = [];
  let current = null;

  for (const slot of filled) {
    const startMinutes = parsePracticeTime(slot.timeText);
    if (startMinutes == null) continue;

    if (slot.rawLabel) {
      if (current) blocks.push(current);
      current = {
        label: slot.label,
        title: blockDisplayTitle(slot.label),
        startMinutes,
        endMinutes: startMinutes + PRACTICE_SLOT_MINUTES,
        startTimeText: formatPracticeClock(startMinutes),
        endTimeText: formatPracticeClock(startMinutes + PRACTICE_SLOT_MINUTES),
        startSheetRow: slot.sheetRow,
        endSheetRow: slot.sheetRow,
        slotCount: 1,
      };
      continue;
    }

    if (!current) continue;

    current.endMinutes = startMinutes + PRACTICE_SLOT_MINUTES;
    current.endTimeText = formatPracticeClock(current.endMinutes);
    current.endSheetRow = slot.sheetRow;
    current.slotCount += 1;
  }

  if (current) blocks.push(current);
  return blocks;
}

export function getPracticeWindow(blocks) {
  if (!blocks.length) return null;
  return {
    startMinutes: blocks[0].startMinutes,
    endMinutes: blocks[blocks.length - 1].endMinutes,
  };
}

export function findPracticeBlockAt(blocks, totalMinutes) {
  return (
    blocks.find(
      (block) => totalMinutes >= block.startMinutes && totalMinutes < block.endMinutes
    ) ?? null
  );
}

export function findNextPracticeBlock(blocks, totalMinutes) {
  return blocks.find((block) => block.startMinutes > totalMinutes) ?? null;
}

export function isPracticeSheetToday(meta) {
  if (!meta?.date) return false;
  const today = getToday();
  return meta.date.getTime() === today.getTime();
}

export function describePracticeForNow(rows, when = new Date()) {
  const meta = parsePracticeSheetMeta(rows);
  const blocks = collapsePracticeBlocks(rows);
  const window = getPracticeWindow(blocks);
  const nowMinutes = getEasternTotalMinutes(when);
  const isToday = isPracticeSheetToday(meta);

  let current = null;
  let next = null;
  let status = "upcoming";

  if (isToday && window) {
    if (nowMinutes < window.startMinutes) {
      status = "before";
      next = blocks[0] ?? null;
    } else if (nowMinutes >= window.endMinutes) {
      status = "after";
    } else {
      current = findPracticeBlockAt(blocks, nowMinutes);
      next = findNextPracticeBlock(blocks, nowMinutes);
      status = current ? "live" : "between";
    }
  }

  return { meta, blocks, window, isToday, current, next, status };
}

export function readPracticeScheduleCache() {
  try {
    const raw = sessionStorage.getItem(PRACTICE_SCHEDULE_CACHE_KEY);
    if (!raw) return null;
    const { savedAt, csv } = JSON.parse(raw);
    if (!csv || Date.now() - savedAt >= PRACTICE_SCHEDULE_CACHE_TTL_MS) return null;
    return csv;
  } catch {
    return null;
  }
}

export function writePracticeScheduleCache(csv) {
  try {
    sessionStorage.setItem(
      PRACTICE_SCHEDULE_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), csv })
    );
  } catch {
    /* ignore quota */
  }
}

/**
 * Load practice schedule rows from the published sheet CSV feed.
 * Timeline, timer, and edits all derive from this — no separate schedule source.
 */
export async function fetchPracticeScheduleRows({ bypassCache = false } = {}) {
  if (!bypassCache) {
    const cached = readPracticeScheduleCache();
    if (cached) return { rows: parseCSV(cached), fromCache: true };
  }

  const res = await fetch(PRACTICE_SCHEDULE_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  writePracticeScheduleCache(text);
  return { rows: parseCSV(text), fromCache: false };
}
