#!/usr/bin/env node
/**
 * Parse files/summer-schedule-2026/index.html + attendance sheet C columns
 * → data/summer-schedule-events.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "files/summer-schedule-2026/index.html");
const outPath = path.join(root, "data/summer-schedule-events.json");
const ATTENDANCE_URL =
  process.env.ATTENDANCE_CSV_URL || "https://ghfb.360web.cloud/api/attendance.csv";

const SUMMARY_HEADERS = new Set([
  "Current Total",
  "Ironman %",
  "# of sessions this summer",
  "% required for ironman",
]);
const ATTENDANCE_START_IDX = 2;

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
    } else if (ch === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }

  if (value.length || row.length) {
    row.push(value.trim());
    rows.push(row);
  }
  return rows;
}

function parseHeaderDate(value) {
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    let y = Number(match[3]);
    if (y < 100) y += 2000;
    const date = new Date(y, Number(match[1]) - 1, Number(match[2]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  match = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const y = new Date().getFullYear();
    const date = new Date(y, Number(match[1]) - 1, Number(match[2]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const MONTH_NUM = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const ACTIVITY_RE =
  /weight\s*room|team\s*workout|team\s*camp|practice|dead\s*week|scrimmage|\bgame\b|7\s*on\s*7|7\s*v\s*7|d\s*zone|hope|full\s*pads|first\s*day|bbq|4\s*man\s*workout|varsity|jv\b/i;

function cellText(tdHtml) {
  return tdHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function afternoonHour(h, isAm, isPm) {
  h = +h;
  if (isAm) return h === 12 ? 0 : h;
  if (isPm && h < 12) return h + 12;
  if (!isAm && !isPm && h >= 1 && h <= 7) return h + 12;
  return h;
}

function parseTimeRange(text) {
  const t = text.replace(/\s+/g, " ");
  const isPm = /\bPM\b/i.test(t);
  const isAm = /\bAM\b/i.test(t);

  let m = t.match(/(\d{1,2})\s*:\s*(\d{2})\s*[–-]\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (m) {
    const sh = afternoonHour(m[1], isAm, isPm);
    const eh = afternoonHour(m[3], isAm, isPm);
    return {
      start: `${pad2(sh)}:${m[2]}`,
      end: `${pad2(eh)}:${m[4]}`,
    };
  }
  m = t.match(/(\d{1,2})\s*[–-]\s*(\d{1,2})\s*(?:PM|pm)/i);
  if (m) {
    const sh = afternoonHour(m[1], false, true);
    const eh = afternoonHour(m[2], false, true);
    return { start: `${pad2(sh)}:00`, end: `${pad2(eh)}:00` };
  }
  m = t.match(/(\d{1,2})\s*:\s*(\d{2})\s*(?:AM|am)/i);
  if (m) {
    const h = +m[1];
    const endH = h + 2;
    return { start: `${pad2(h)}:${m[2]}`, end: `${pad2(endH)}:${m[2]}` };
  }
  m = t.match(/(\d{1,2})\s*(?:AM|am)/i);
  if (m) {
    const h = +m[1];
    return { start: `${pad2(h)}:00`, end: `${pad2(h + 2)}:00` };
  }
  return null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildSummary(lines) {
  let body = lines.slice(1).join(" ").trim();
  if (!body) body = lines.join(" ");
  body = body
    .replace(/^(\d{1,2})(?=\s|[A-Za-z])/, "")
    .replace(/\s+/g, " ")
    .trim();
  return body.slice(0, 120) || "Event";
}

function parseMonthSection(monthName, year, tableHtml) {
  const monthNum = MONTH_NUM[monthName.toLowerCase()];
  if (!monthNum) return [];

  const events = [];
  let lastDay = 0;
  let curMonth = monthNum;
  let curYear = year;
  let sectionStarted = false;

  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const row of rows) {
    const rowHtml = row[1];
    if (/Sunday/i.test(rowHtml) && /Monday/i.test(rowHtml)) continue;

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    for (const cell of cells) {
      const raw = cellText(cell[1]);
      if (!raw) continue;

      const lines = cell[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&ndash;/g, "–")
        .replace(/&amp;/g, "&")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      if (!lines.length) continue;

      let day = null;
      for (const line of lines) {
        const dm = line.match(/^(\d{1,2})(?!\d)/);
        if (dm) {
          day = +dm[1];
          break;
        }
      }
      if (day == null) continue;

      if (!sectionStarted) {
        sectionStarted = true;
        if (day > 20 && monthNum > 1) {
          curMonth = monthNum - 1;
        }
      } else if (day < lastDay && lastDay > 20) {
        curMonth += 1;
        if (curMonth > 12) {
          curMonth = 1;
          curYear += 1;
        }
      }
      lastDay = day;

      const joined = lines.join(" ");
      if (!ACTIVITY_RE.test(joined)) continue;

      const times = parseTimeRange(joined);
      const summary = buildSummary(lines);
      const date = `${curYear}-${pad2(curMonth)}-${pad2(day)}`;

      const ev = {
        date,
        summary,
        location: "Godwin Heights Football",
      };

      if (/dead\s*week/i.test(joined)) {
        ev.allDay = true;
      } else if (times) {
        ev.start = times.start;
        ev.end = times.end;
      } else if (/game|scrimmage|7\s*on\s*7|camp|d\s*zone/i.test(joined)) {
        ev.start = "16:00";
        ev.end = "19:00";
      } else {
        ev.start = "15:45";
        ev.end = "17:00";
      }

      events.push(ev);
    }
  }

  return events;
}

/** Conditioning sessions: date header with C in the next column (attendance sheet rules). */
function conditioningEventsFromAttendance(headers) {
  const events = [];

  for (let col = ATTENDANCE_START_IDX; col < headers.length; col++) {
    const header = String(headers[col] ?? "").trim();
    if (!header || SUMMARY_HEADERS.has(header)) break;

    const dateVal = parseHeaderDate(header);
    if (!dateVal) continue;

    const next = String(headers[col + 1] ?? "").trim().toUpperCase();
    if (next !== "C") continue;

    const date = `${dateVal.getFullYear()}-${pad2(dateVal.getMonth() + 1)}-${pad2(dateVal.getDate())}`;
    events.push({
      date,
      summary: "Conditioning",
      location: "Godwin Heights Football",
      start: "16:00",
      end: "18:00",
    });
  }

  return events;
}

async function loadAttendanceCsv() {
  const res = await fetch(ATTENDANCE_URL);
  if (!res.ok) {
    throw new Error(`Attendance CSV fetch failed: HTTP ${res.status}`);
  }
  return res.text();
}

const html = fs.readFileSync(htmlPath, "utf8");
const year = 2026;
const all = [];

const sections = html.split(/<h2[^>]*>[\s\S]*?<span[^>]*>(June|July|August)\s+2026/i);
for (let i = 1; i < sections.length; i += 2) {
  const monthName = sections[i];
  const chunk = sections[i + 1] || "";
  const tableMatch = chunk.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) continue;
  all.push(...parseMonthSection(monthName, year, tableMatch[1]));
}

const csvText = await loadAttendanceCsv();
const attendanceRows = parseCSV(csvText);
const headerRow = attendanceRows[0] || [];
const conditioning = conditioningEventsFromAttendance(headerRow);
console.log(`Attendance sheet: ${conditioning.length} conditioning (C) days`);
all.push(...conditioning);

const seen = new Set();
const events = all.filter((e) => {
  const key = `${e.date}|${e.summary}|${e.start ?? "all"}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

events.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary));

const payload = {
  calendarName: "Godwin Heights Football — Summer 2026",
  timezone: "America/Detroit",
  events,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(`Wrote ${events.length} events to ${outPath}`);
