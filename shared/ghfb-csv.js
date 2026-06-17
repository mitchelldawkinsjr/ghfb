export const CSV_URL = "/api/attendance.csv";
export const CSV_CACHE_KEY = "ghfb-attendance-csv";
export const CSV_CACHE_TTL_MS = 3 * 60 * 1000;

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

export function fetchCsvText() {
  return fetch(CSV_URL, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

/** Cached CSV text when fresh; otherwise fetch and store. */
export async function fetchCsvRows() {
  const cached = readCsvCache();
  if (cached) return parseCSV(cached);
  const text = await fetchCsvText();
  writeCsvCache(text);
  return parseCSV(text);
}

