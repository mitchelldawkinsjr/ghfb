#!/usr/bin/env node
/**
 * Verify published attendance CSV includes P practice columns and parsing rules.
 *
 * Usage:
 *   node tools/verify-attendance-practice.mjs
 *   node tools/verify-attendance-practice.mjs path/to/attendance.csv
 */

import { readFileSync } from "fs";
import { parseCSV } from "../shared/ghfb-csv.js";
import {
  getColumnKind,
  getValidAttendanceIndexes,
  getValidPracticeIndexes,
  isPracticeHeader,
  parsePracticeHeaderDate,
} from "../shared/ghfb-attendance.js";

const DEFAULT_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT-oEpo0pvk7YAWpv2jAhyqmWeIYVEZRRXliKY6uY-_NGZwE3rl28BG2HSSLtamqfeTLvR5AT8ywh28/pub?gid=585894674&single=true&output=csv";

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
