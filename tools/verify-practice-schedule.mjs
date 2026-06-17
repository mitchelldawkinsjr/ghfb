#!/usr/bin/env node
/**
 * Verify practice schedule CSV collapse — prints raw rows + blocks, flags gaps.
 * Usage: node tools/verify-practice-schedule.mjs [csv-path-or-url]
 */

import { readFileSync } from "fs";
import { parseCSV } from "../shared/ghfb-csv.js";
import {
  blockDisplayTitle,
  collapsePracticeBlocks,
  formatPracticeClock,
  formatPracticeRange,
  getPracticeSlots,
} from "../shared/ghfb-practice-schedule.js";

const DEFAULT_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRySfoBRMxX7GG1W32Kjccmv83429tkhEPbdHdf09xaAjNBu0Ztqh11FF6MUbGkD2DppxK_PYTMzSkT/pub?gid=224955206&single=true&output=csv";

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
const filled = getPracticeSlots(rows);

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
