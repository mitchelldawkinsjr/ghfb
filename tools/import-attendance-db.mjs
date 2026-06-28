#!/usr/bin/env node
/**
 * Re-import attendance from the published Google Sheet CSV into SQLite.
 *
 * Usage:
 *   GHFB_BASE_URL=https://ghfb.360web.cloud COACH_PIN=1234 node tools/import-attendance-db.mjs
 *   node tools/import-attendance-db.mjs http://localhost:8020
 */

const baseUrl = (process.argv[2] || process.env.GHFB_BASE_URL || "http://localhost:8020").replace(/\/$/, "");
const pin = process.env.COACH_PIN || "";

const res = await fetch(`${baseUrl}/api/attendance/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});

const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error(text);
  process.exit(1);
}

if (!res.ok || !data.ok) {
  console.error(data.error || text);
  process.exit(1);
}

console.log("Imported attendance into SQLite:");
console.log(`  players:  ${data.players}`);
console.log(`  sessions: ${data.sessions}`);
console.log(`  marks:    ${data.marks}`);
console.log(`  season:   ${data.season_id}`);
