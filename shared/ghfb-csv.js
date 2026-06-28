export const CSV_URL = "/api/attendance.csv";
export const ATTENDANCE_JSON_URL = "/api/attendance.json";
export const CSV_CACHE_KEY = "ghfb-attendance-csv";
export const ATTENDANCE_JSON_CACHE_KEY = "ghfb-attendance-json";
export const CSV_CACHE_TTL_MS = 3 * 60 * 1000;
export const ATTENDANCE_JSON_CACHE_TTL_MS = 15 * 1000;

/** Parse published Google Sheets CSV (RFC-style quoted fields). */
export function parseCSV(text) {
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

/** Serialize parsed rows back to CSV (for dashboard cache compatibility). */
export function rowsToCsvText(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
          return value;
        })
        .join(",")
    )
    .join("\n");
}

export function readTimedCache(key, ttlMs) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { savedAt, csv } = JSON.parse(raw);
    if (!csv || Date.now() - savedAt >= ttlMs) return null;
    return csv;
  } catch {
    return null;
  }
}

export function writeTimedCache(key, csv) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), csv }));
  } catch {
    /* ignore quota */
  }
}

export function clearTimedCache(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const readCsvCache = () => readTimedCache(CSV_CACHE_KEY, CSV_CACHE_TTL_MS);
export const writeCsvCache = (csv) => writeTimedCache(CSV_CACHE_KEY, csv);
export const clearCsvCache = () => clearTimedCache(CSV_CACHE_KEY);

export const readAttendanceJsonCache = () =>
  readTimedCache(ATTENDANCE_JSON_CACHE_KEY, ATTENDANCE_JSON_CACHE_TTL_MS);
export const writeAttendanceJsonCache = (payload) =>
  writeTimedCache(ATTENDANCE_JSON_CACHE_KEY, payload);
export const clearAttendanceJsonCache = () => clearTimedCache(ATTENDANCE_JSON_CACHE_KEY);

export function fetchCsvText() {
  return fetch(CSV_URL, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

/** Attendance grid from SQLite (source of truth). Falls back to published CSV. */
export async function fetchAttendanceRows({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readAttendanceJsonCache();
    if (cached) {
      try {
        const payload = JSON.parse(cached);
        if (payload?.rows?.length) return payload.rows;
      } catch {
        clearAttendanceJsonCache();
      }
    }
  }

  try {
    const res = await fetch(ATTENDANCE_JSON_URL, { cache: "no-store" });
    if (res.ok) {
      const payload = await res.json();
      if (payload?.ok && Array.isArray(payload.rows) && payload.rows.length) {
        writeAttendanceJsonCache(JSON.stringify(payload));
        return payload.rows;
      }
    }
  } catch {
    /* fall through to CSV */
  }

  return fetchCsvRows();
}

/** Cached CSV text when fresh; otherwise fetch and store. */
export async function fetchCsvRows() {
  const cached = readCsvCache();
  if (cached) return parseCSV(cached);
  const text = await fetchCsvText();
  writeCsvCache(text);
  return parseCSV(text);
}

