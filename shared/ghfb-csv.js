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

export function readCsvCache() {
  try {
    const raw = sessionStorage.getItem(CSV_CACHE_KEY);
    if (!raw) return null;
    const { savedAt, csv } = JSON.parse(raw);
    if (!csv || Date.now() - savedAt >= CSV_CACHE_TTL_MS) return null;
    return csv;
  } catch {
    return null;
  }
}

export function writeCsvCache(csv) {
  try {
    sessionStorage.setItem(
      CSV_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), csv })
    );
  } catch {
    /* ignore quota */
  }
}

export function clearCsvCache() {
  try {
    sessionStorage.removeItem(CSV_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

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

export function filterNonEmptyRows(rows) {
  return rows.filter((r) => r.some((c) => c !== ""));
}
