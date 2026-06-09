#!/usr/bin/env node
/**
 * Verify published attendance CSV includes P practice columns and parsing rules.
 *
 * Usage:
 *   node tools/verify-attendance-practice.mjs
 *   node tools/verify-attendance-practice.mjs path/to/attendance.csv
 */

import { readFileSync } from "fs";

const DEFAULT_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT-oEpo0pvk7YAWpv2jAhyqmWeIYVEZRRXliKY6uY-_NGZwE3rl28BG2HSSLtamqfeTLvR5AT8ywh28/pub?gid=585894674&single=true&output=csv";

const ATTENDANCE_START_IDX = 2;
const SUMMARY_HEADERS = new Set([
  "Current Total",
  "Ironman %",
  "# of sessions this summer",
  "% required for ironman",
]);

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
      } else {
        inQuotes = !inQuotes;
      }
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
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += ch;
  }

  if (value.length || row.length) {
    row.push(value);
    if (row.some((c) => String(c).trim() !== "")) rows.push(row);
  }

  return rows;
}

function parseHeaderDate(value) {
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
  return null;
}

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isPracticeHeader(header) {
  const text = String(header ?? "").trim();
  return /^P(\s+|\s*\d)/i.test(text);
}

function parsePracticeHeaderDate(header) {
  const text = String(header ?? "").trim();
  const direct = text.match(/^P\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*$/i);
  if (direct) return parseHeaderDate(direct[1]);
  const embedded = text.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (embedded) return parseHeaderDate(embedded[1]);
  return null;
}

function getColumnKind(header) {
  const text = String(header ?? "").trim();
  if (text.toUpperCase() === "C") return "conditioning";
  if (isPracticeHeader(text)) return "practice";
  if (parseHeaderDate(text)) return "weightroom";
  return "other";
}

function getValidAttendanceIndexes(headers, throughDate = getToday()) {
  const indexes = [];

  for (let col = ATTENDANCE_START_IDX; col < headers.length; col++) {
    const header = String(headers[col] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;

    const dateVal = parseHeaderDate(header);

    if (dateVal) {
      if (dateVal > throughDate) break;
      indexes.push(col);

      const nextHeader = String(headers[col + 1] ?? "").trim();
      if (nextHeader.toUpperCase() === "C") indexes.push(col + 1);
    }
  }

  return indexes;
}

function getValidPracticeIndexes(headers, throughDate = getToday()) {
  const indexes = [];

  for (let col = ATTENDANCE_START_IDX; col < headers.length; col++) {
    const header = String(headers[col] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;
    if (!isPracticeHeader(header)) continue;

    const dateVal = parsePracticeHeaderDate(header);
    if (dateVal && dateVal > throughDate) continue;

    indexes.push(col);
  }

  return indexes;
}

async function loadCsvText() {
  const path = process.argv[2];
  if (path) return readFileSync(path, "utf8");
  const res = await fetch(DEFAULT_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching attendance CSV`);
  return res.text();
}

function smokeTest() {
  const samples = ["P 6/9", "P 6/11", "P6/9", "P 6/9/2026", "6/9", "C"];
  console.log("Header parsing smoke test:");
  for (const h of samples) {
    console.log(
      `  ${JSON.stringify(h)} → kind=${getColumnKind(h)} practice=${isPracticeHeader(h)} date=${parsePracticeHeaderDate(h)?.toDateString() ?? "—"}`
    );
  }
  console.log("");
}

async function run() {
  smokeTest();

  const text = await loadCsvText();
  const rows = parseCSV(text);
  const headerRow = rows[0] || [];

  const practiceCols = headerRow
    .map((h, idx) => ({ idx, raw: String(h ?? "").trim() }))
    .filter(({ raw }) => raw && isPracticeHeader(raw));

  console.log(`CSV rows: ${rows.length}, columns: ${headerRow.length}`);
  console.log(`Practice (P) columns found: ${practiceCols.length}`);

  if (!practiceCols.length) {
    console.log("\nNo P columns in CSV yet. Expected headers like 'P 6/9', 'P 6/11'.");
    process.exit(1);
  }

  for (const { idx, raw } of practiceCols) {
    const date = parsePracticeHeaderDate(raw);
    console.log(
      `  col ${idx}: ${JSON.stringify(raw)}` +
        (date ? ` → ${date.toLocaleDateString()}` : " (no date parsed)")
    );
  }

  const ironSlots = getValidAttendanceIndexes(headerRow);
  const practiceSlots = getValidPracticeIndexes(headerRow);
  const overlap = practiceSlots.filter((i) => ironSlots.includes(i));

  console.log(`\nIronmen/momentum slots: ${ironSlots.length}`);
  console.log(`Practice slots (through today): ${practiceSlots.length}`);
  console.log(`Overlap (should be 0): ${overlap.length}`);

  const dataRows = rows.slice(1).filter((r) => String(r[1] ?? "").trim());
  let practiceAttended = 0;
  for (const row of dataRows) {
    if (practiceSlots.some((col) => String(row[col] ?? "").trim().toUpperCase() === "X")) {
      practiceAttended++;
    }
  }

  console.log(
    `\nPractice participation: ${practiceAttended}/${dataRows.length} players with ≥1 X` +
      ` across ${practiceSlots.length} P column(s)`
  );

  if (overlap.length) {
    console.error("\nERROR: Practice columns are counted in ironmen slots.");
    process.exit(1);
  }

  console.log("\nOK — P columns parsed; ironmen unaffected.");
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
