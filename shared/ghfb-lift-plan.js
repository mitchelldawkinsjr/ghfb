import { parseCSV } from "/shared/ghfb-csv.js";
import { parseHeaderDate, getToday } from "/shared/ghfb-attendance.js";

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

/**
 * Read conditioning columns from the same Daily Lift Plan CSV.
 * Expected columns: Date, Coach, and optional CondLabel, CondPhase, CondSession, CondLink.
 */
export function getTodayConditioningPlan(rows) {
  if (!rows?.length || rows.length < 2) return null;

  const headers = normalizeHeaders(rows[0]);
  const dateCol = findColumnIndex(headers, ["date"]);
  if (dateCol < 0) return null;

  const labelCol = findColumnIndex(headers, ["condlabel", "cond label"]);
  const phaseCol = findColumnIndex(headers, ["condphase", "cond phase"]);
  const sessionCol = findColumnIndex(headers, ["condsession", "cond session"]);
  const linkCol = findColumnIndex(headers, ["condlink", "cond link"]);
  const coachCol = findColumnIndex(headers, ["coach"]);

  const today = getToday();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateVal = parseHeaderDate(row[dateCol]);
    if (!dateVal || dateVal.getTime() !== today.getTime()) continue;

    const label = labelCol >= 0 ? String(row[labelCol] ?? "").trim() : "";
    const phase = phaseCol >= 0 ? String(row[phaseCol] ?? "").trim() : "";
    const session = sessionCol >= 0 ? String(row[sessionCol] ?? "").trim() : "";
    const customUrl = linkCol >= 0 ? String(row[linkCol] ?? "").trim() : "";
    const coach = coachCol >= 0 ? String(row[coachCol] ?? "").trim() : "";

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

  return null;
}

export function getTodayLiftPlan(rows) {
  if (!rows?.length || rows.length < 2) return null;

  const headers = normalizeHeaders(rows[0]);
  const dateCol = findColumnIndex(headers, ["date"]);
  if (dateCol < 0) return null;

  const labelCol = findColumnIndex(headers, ["label"]);
  const phaseCol = findColumnIndex(headers, ["phase"]);
  const sessionCol = findColumnIndex(headers, ["session"]);
  const notesCol = findColumnIndex(headers, ["notes"]);
  const linkCol = findColumnIndex(headers, ["liftlink", "lift link", "url"]);

  const today = getToday();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateVal = parseHeaderDate(row[dateCol]);
    if (!dateVal || dateVal.getTime() !== today.getTime()) continue;

    const label = labelCol >= 0 ? String(row[labelCol] ?? "").trim() : "";
    const phase = phaseCol >= 0 ? String(row[phaseCol] ?? "").trim() : "";
    const session = sessionCol >= 0 ? String(row[sessionCol] ?? "").trim() : "";
    const notes = notesCol >= 0 ? String(row[notesCol] ?? "").trim() : "";
    const customUrl = linkCol >= 0 ? String(row[linkCol] ?? "").trim() : "";

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

  return null;
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
