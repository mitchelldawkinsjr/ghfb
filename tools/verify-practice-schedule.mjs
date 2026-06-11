#!/usr/bin/env node
/**
 * Verify practice schedule CSV collapse — prints raw rows + blocks, flags gaps.
 * Usage: node tools/verify-practice-schedule.mjs [csv-path-or-url]
 */

import { readFileSync } from "fs";

const DEFAULT_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRySfoBRMxX7GG1W32Kjccmv83429tkhEPbdHdf09xaAjNBu0Ztqh11FF6MUbGkD2DppxK_PYTMzSkT/pub?gid=224955206&single=true&output=csv";

const PRACTICE_HEADER_ROWS = 4;
const PRACTICE_TIME_COL = 1;
const PRACTICE_LABEL_COL = 2;
const PRACTICE_SLOT_MINUTES = 5;
const PRACTICE_DATA_START_SHEET_ROW = 5;

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ",") {
      row.push(value);
      value = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(value);
      if (row.some((c) => String(c).trim())) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += ch;
  }
  if (value.length || row.length) {
    row.push(value);
    if (row.some((c) => String(c).trim())) rows.push(row);
  }
  return rows;
}

function parsePracticeTime(value) {
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

function formatPracticeClock(totalMinutes) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const hour12 = hour24 % 12 || 12;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function formatPracticeRange(startMinutes, endMinutes) {
  return `${formatPracticeClock(startMinutes)} – ${formatPracticeClock(endMinutes)}`;
}

function blockDisplayTitle(label) {
  return String(label ?? "").split(/\r?\n/)[0].trim() || "Period";
}

function forwardFillLabels(dataRows) {
  let lastLabel = "";
  return dataRows.map((row, index) => {
    const label = String(row[PRACTICE_LABEL_COL] ?? "").trim();
    if (label) lastLabel = label;
    return {
      sheetRow: PRACTICE_DATA_START_SHEET_ROW + index,
      timeText: String(row[PRACTICE_TIME_COL] ?? "").trim(),
      label: label || lastLabel,
      rawLabel: label,
    };
  });
}

function collapsePracticeBlocks(rows) {
  const dataRows = (rows || []).slice(PRACTICE_HEADER_ROWS);
  if (!dataRows.length) return [];

  const filled = forwardFillLabels(dataRows);
  const blocks = [];
  let current = null;
  let prevRowMinutes = null;
  let pendingStart = null;

  function pushCurrent() {
    if (!current) return;
    if (current.endMinutes > current.startMinutes) {
      blocks.push(current);
    }
    current = null;
  }

  function blockStartFor(rowMinutes) {
    if (pendingStart != null) return pendingStart;
    if (current) return current.endMinutes;
    if (blocks.length) return blocks[blocks.length - 1].endMinutes;
    return rowMinutes;
  }

  function openBlock(slot, rowMinutes, startMinutes) {
    current = {
      label: slot.label,
      title: blockDisplayTitle(slot.label),
      startMinutes,
      endMinutes: rowMinutes,
      startSheetRow: slot.sheetRow,
      endSheetRow: slot.sheetRow,
      slotCount: 1,
    };
  }

  for (const slot of filled) {
    const rowMinutes = parsePracticeTime(slot.timeText);
    if (rowMinutes == null) continue;

    if (slot.rawLabel) {
      const startMinutes = blockStartFor(rowMinutes);
      pendingStart = null;
      pushCurrent();
      openBlock(slot, rowMinutes, startMinutes);
      prevRowMinutes = rowMinutes;
      continue;
    }

    const gap =
      prevRowMinutes != null ? rowMinutes - prevRowMinutes : PRACTICE_SLOT_MINUTES;

    if (!current || gap > PRACTICE_SLOT_MINUTES) {
      if (current) {
        current.endMinutes = rowMinutes;
        pushCurrent();
      }
      pendingStart = rowMinutes;
      prevRowMinutes = rowMinutes;
      continue;
    }

    current.endMinutes = rowMinutes;
    current.endSheetRow = slot.sheetRow;
    current.slotCount += 1;
    prevRowMinutes = rowMinutes;
  }

  pushCurrent();
  return blocks;
}

async function loadCsv() {
  const src = process.argv[2];
  if (src && !src.startsWith("http")) return readFileSync(src, "utf8");
  const url = src?.startsWith("http") ? src : DEFAULT_URL;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const text = await loadCsv();
const rows = parseCSV(text);
const filled = forwardFillLabels(rows.slice(PRACTICE_HEADER_ROWS));

console.log("=== RAW (sheet rows 5+) ===");
for (const s of filled) {
  const kind = s.rawLabel ? "LABEL" : "blank";
  console.log(`row ${s.sheetRow}  ${s.timeText.padEnd(5)} [${kind}] ${blockDisplayTitle(s.label)}`);
}

const blocks = collapsePracticeBlocks(rows);
console.log("\n=== COLLAPSED BLOCKS ===");
let errors = 0;
blocks.forEach((b, i) => {
  const dur = b.endMinutes - b.startMinutes;
  const prev = blocks[i - 1];
  let note = "";
  if (prev && b.startMinutes !== prev.endMinutes) {
    note = `  *** GAP: prev ends ${formatPracticeClock(prev.endMinutes)}, starts ${formatPracticeClock(b.startMinutes)} ***`;
    errors++;
  }
  if (dur <= 0) {
    note += "  *** ZERO/NEGATIVE DURATION ***";
    errors++;
  }
  console.log(
    `${String(i + 1).padStart(2)}. ${b.title}: ${formatPracticeRange(b.startMinutes, b.endMinutes)} (${dur} min) rows ${b.startSheetRow}-${b.endSheetRow}${note}`
  );
});

if (errors) {
  console.log(`\n${errors} issue(s) — periods should chain with no gaps.`);
  process.exit(1);
}
console.log("\nOK — all periods chain back-to-back.");
