import { parseCSV } from "./ghfb-csv.js";
import { parseHeaderDate, getToday } from "./ghfb-attendance.js";

export const LIFT_PLAN_CSV_URL = "/api/lift-plan.csv";
export const LIFT_PLAN_CACHE_KEY = "ghfb-lift-plan-csv";
export const LIFT_PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

export function buildLiftUrl(phase, session) {
  const p = String(phase ?? "").trim();
  const s = String(session ?? "").trim();
  if (!p || !s) return "/lift/";
  return `/lift/#/${encodeURIComponent(p)}/${encodeURIComponent(s)}`;
}

function normalizeHeaders(row) {
  return (row || []).map((cell) => String(cell ?? "").trim().toLowerCase());
}

function findColumnIndex(headers, names) {
  for (const name of names) {
    const idx = headers.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

function findTodayPlanCells(rows, columnNames) {
  if (!rows?.length || rows.length < 2) return null;

  const headers = (rows[0] || []).map((cell) => String(cell ?? "").trim().toLowerCase());
  const dateCol = headers.indexOf("date");
  if (dateCol < 0) return null;

  const cols = {};
  for (const [key, names] of Object.entries(columnNames)) {
    cols[key] = findColumnIndex(headers, names);
  }

  const today = getToday();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateVal = parseHeaderDate(row[dateCol]);
    if (!dateVal || dateVal.getTime() !== today.getTime()) continue;

    const cells = {};
    for (const [key, idx] of Object.entries(cols)) {
      cells[key] = idx >= 0 ? String(row[idx] ?? "").trim() : "";
    }
    return cells;
  }

  return null;
}

/**
 * Read conditioning columns from the same Daily Lift Plan CSV.
 * Expected columns: Date, Coach, and optional CondLabel, CondPhase, CondSession, CondLink.
 */
export function getTodayConditioningPlan(rows) {
  const cells = findTodayPlanCells(rows, {
    label: ["condlabel", "cond label"],
    phase: ["condphase", "cond phase"],
    session: ["condsession", "cond session"],
    link: ["condlink", "cond link"],
    coach: ["coach"],
  });
  if (!cells) return null;

  const { label, phase, session, link: customUrl, coach } = cells;
  if (!label && !phase && !session && !coach) return null;

  const displayLabel = label || (phase && session ? `${phase} · ${session}` : "") || "Conditioning";
  return {
    label: displayLabel,
    phase,
    session,
    coach,
    url: customUrl || (phase && session ? buildLiftUrl(phase, session) : null),
    off: false,
  };
}

export function getTodayLiftPlan(rows) {
  const cells = findTodayPlanCells(rows, {
    label: ["label"],
    phase: ["phase"],
    session: ["session"],
    notes: ["notes"],
    link: ["liftlink", "lift link", "url"],
  });
  if (!cells) return null;

  const { label, phase, session, notes, link: customUrl } = cells;
  const displayLabel = label || (phase && session ? `${phase} · ${session}` : "");
  const isOff =
    !phase &&
    !session &&
    (!displayLabel || /^off$/i.test(displayLabel) || /^no lift/i.test(displayLabel));

  if (isOff) {
    return {
      label: displayLabel || "No lift scheduled",
      phase: "",
      session: "",
      notes,
      url: null,
      off: true,
    };
  }

  return {
    label: displayLabel || "Lift scheduled",
    phase,
    session,
    notes,
    url: customUrl || buildLiftUrl(phase, session),
    off: false,
  };
}

export function readLiftPlanCache() {
  try {
    const raw = sessionStorage.getItem(LIFT_PLAN_CACHE_KEY);
    if (!raw) return null;
    const { savedAt, csv } = JSON.parse(raw);
    if (!csv || Date.now() - savedAt >= LIFT_PLAN_CACHE_TTL_MS) return null;
    return csv;
  } catch {
    return null;
  }
}

export function writeLiftPlanCache(csv) {
  try {
    sessionStorage.setItem(
      LIFT_PLAN_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), csv })
    );
  } catch {
    /* ignore quota */
  }
}

export async function fetchLiftPlanRows() {
  const cached = readLiftPlanCache();
  if (cached) return parseCSV(cached);

  const res = await fetch(LIFT_PLAN_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  writeLiftPlanCache(text);
  return parseCSV(text);
}
