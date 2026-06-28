import { parseCSV, readCsvCache, fetchCsvRows, clearCsvCache, clearAttendanceJsonCache, fetchAttendanceRows } from "/shared/ghfb-csv.js";
import { coachApiGet } from "/shared/ghfb-coach-api.js";
import {
  getDataRows,
  getPlayerDisplayName,
  getTodayLabel,
  findSessionColumnIndex,
  getSessionNotScheduledMessage,
  describeTodaySessionStatus,
} from "/shared/ghfb-attendance.js";
import { fetchLiftPlanRows, getTodayLiftPlan, getTodayConditioningPlan } from "/shared/ghfb-lift-plan.js";
import { escapeHtml } from "/shared/ghfb-dom.js";

const PIN_STORAGE_KEY = "ghfb-coach-pin";
const CHECKIN_STATE_TTL_MS = 45 * 1000;
const saveQueue = [];
let saveQueueRunning = false;
let syncing = false;
let viewOnly = false;
let dashboardRefreshHint = false;
const buttonByRow = new Map();
const rowUiState = new Map();

let sessionType = "weightroom";
let players = [];
let todayLabel = "";
let loadGeneration = 0;

const statusEl = document.getElementById("status");
const gridEl = document.getElementById("grid");
const searchEl = document.getElementById("search");
const pinEl = document.getElementById("pin");
const setupBanner = document.getElementById("setupBanner");
const todayBanner = document.getElementById("todayBanner");

const savedPin = sessionStorage.getItem(PIN_STORAGE_KEY);
if (savedPin) pinEl.value = savedPin;
pinEl.addEventListener("change", () => {
  sessionStorage.setItem(PIN_STORAGE_KEY, pinEl.value.trim());
});

document.querySelectorAll(".seg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sessionType = btn.dataset.type;
    load();
  });
});
searchEl.addEventListener("input", render);

function getPin() {
  return pinEl.value.trim();
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

function refreshStatusLine(isError = false, errorMsg = "") {
  if (isError) {
    setStatus(errorMsg, true);
    return;
  }
  statusEl.classList.remove("error");
  if (dashboardRefreshHint && !viewOnly) {
    statusEl.innerHTML =
      `${escapeHtml(statusLine())} · ` +
      `<a href="/attendance-dashboard.html?refresh=1">View updated dashboard</a>`;
  } else {
    statusEl.textContent = statusLine();
  }
}

function renderTodayBanner(headerRow, liftPlan, condPlan, liftError, type = sessionType) {
  if (!todayBanner) return;

  const parts = [];
  if (type === "conditioning") {
    if (liftError) {
      parts.push(`Conditioning plan unavailable (${liftError}).`);
    } else if (!condPlan) {
      parts.push("No conditioning row for today in Daily Lift Plan tab.");
    } else {
      const condText = condPlan.url
        ? `<a href="${escapeHtml(condPlan.url)}">${escapeHtml(condPlan.label)}</a>`
        : escapeHtml(condPlan.label);
      parts.push(`Today's conditioning: ${condText}`);
      if (condPlan.coach) parts.push(`Coach: ${escapeHtml(condPlan.coach)}`);
    }
  } else if (liftError) {
    parts.push(`Lift plan unavailable (${liftError}).`);
  } else if (!liftPlan) {
    parts.push("No lift row for today in Daily Lift Plan tab.");
  } else if (liftPlan.off) {
    parts.push(escapeHtml(liftPlan.label));
    if (liftPlan.notes) parts.push(escapeHtml(liftPlan.notes));
  } else {
    const liftText = liftPlan.url
      ? `<a href="${escapeHtml(liftPlan.url)}">${escapeHtml(liftPlan.label)}</a>`
      : escapeHtml(liftPlan.label);
    parts.push(`Today's lift: ${liftText}`);
    if (liftPlan.notes) parts.push(escapeHtml(liftPlan.notes));
  }

  if (headerRow) {
    const sessionStatus = describeTodaySessionStatus(headerRow);
    parts.push(escapeHtml(sessionStatus.message));
    todayBanner.className = "banner " + (sessionStatus.level === "ok" ? "ok" : sessionStatus.level === "warn" ? "warn" : "info");
  } else {
    todayBanner.className = "banner info";
  }

  todayBanner.innerHTML = parts.join(" · ");
  todayBanner.hidden = false;
}

async function loadTodayBanner(headerRow, generation = loadGeneration) {
  const type = sessionType;
  try {
    const liftRows = await fetchLiftPlanRows();
    if (generation !== loadGeneration || type !== sessionType) return;
    renderTodayBanner(
      headerRow,
      getTodayLiftPlan(liftRows),
      getTodayConditioningPlan(liftRows),
      null,
      type
    );
  } catch {
    if (generation !== loadGeneration || type !== sessionType) return;
    renderTodayBanner(headerRow, null, null, "publish Daily Lift Plan CSV", type);
  }
}

function buildFromCsv(rows, type) {
  const headerRow = rows[0] || [];
  const dataRows = getDataRows(rows);
  todayLabel = getTodayLabel();
  const colIdx = findSessionColumnIndex(headerRow, type);

  if (colIdx == null) {
    return {
      ok: false,
      error: getSessionNotScheduledMessage(type, todayLabel, headerRow),
      todayLabel,
      headerRow,
    };
  }

  const roster = dataRows.map((row, i) => {
    const sheetRow = i + 2;
    const checked = String(row[colIdx] ?? "").trim().toUpperCase() === "X";
    return {
      sheetRow,
      name: getPlayerDisplayName(row),
      checked,
      serverChecked: checked,
    };
  });

  return {
    ok: true,
    todayLabel,
    headerRow,
    players: roster,
    checkedCount: roster.filter((p) => p.checked).length,
    total: roster.length,
    syncing: true,
    viewOnly: false,
  };
}

function normalizePlayers(list) {
  return (list || []).map((p) => ({
    sheetRow: p.sheetRow,
    name: p.name,
    checked: !!p.checked,
    serverChecked: p.serverChecked != null ? !!p.serverChecked : !!p.checked,
  }));
}

function mergeLiveMarks(apiData) {
  if (!apiData?.ok) return;
  const byRow = new Map(apiData.players.map((p) => [p.sheetRow, !!p.checked]));
  for (const pl of players) {
    if (byRow.has(pl.sheetRow)) {
      const checked = byRow.get(pl.sheetRow);
      pl.checked = checked;
      pl.serverChecked = checked;
    }
  }
  syncing = false;
  refreshAllButtons();
  refreshStatusLine();
  persistCheckInCache();
}

function checkInStateCacheKey(type) {
  return `ghfb-checkin-${type}-${getTodayLabel()}`;
}

function readCheckInCache(type) {
  try {
    const raw = sessionStorage.getItem(checkInStateCacheKey(type));
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    if (!data || Date.now() - savedAt >= CHECKIN_STATE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCheckInCache(type, data) {
  if (!data?.ok) return;
  try {
    sessionStorage.setItem(
      checkInStateCacheKey(type),
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch {
    /* ignore */
  }
}

async function apiToggle(sheetRow) {
  const data = await coachApiGet("toggleCheckIn", {
    sheetRow: String(sheetRow),
    sessionType,
    pin: getPin(),
  });
  if (data.ok === false) throw new Error(data.error || "Save failed");
  return data;
}

function queueSuffix() {
  const q = saveQueue.length;
  const parts = [];
  if (syncing) parts.push("syncing marks…");
  if (q > 0) parts.push(`${q} save${q === 1 ? "" : "s"} queued`);
  if (viewOnly) parts.push("view only");
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function sessionKindLabel(type) {
  if (type === "conditioning") return "Conditioning";
  if (type === "practice") return "Practice";
  return "Weightroom";
}

function statusLine() {
  const kind = sessionKindLabel(sessionType);
  const n = players.filter((p) => p.checked).length;
  return `${kind} · ${todayLabel} · ${n} / ${players.length} checked in${queueSuffix()}`;
}

function markLabel(player, uiState) {
  if (uiState === "saving") return '<span class="mark">Saving…</span>';
  if (uiState === "queued") return '<span class="mark">Queued…</span>';
  if (player.checked) return '<span class="mark">Checked in</span>';
  return "";
}

function updatePlayerButton(btn, player, uiState) {
  btn.classList.toggle("checked", player.checked);
  btn.classList.toggle("is-queued", uiState === "queued");
  btn.classList.toggle("is-saving", uiState === "saving");
  btn.innerHTML = player.name + markLabel(player, uiState);
}

function refreshRow(sheetRow) {
  const btn = buttonByRow.get(sheetRow);
  const pl = players.find((x) => x.sheetRow === sheetRow);
  if (!btn || !pl) return;
  updatePlayerButton(btn, pl, rowUiState.get(sheetRow) || "idle");
}

function refreshAllButtons() {
  for (const pl of players) refreshRow(pl.sheetRow);
}

function persistCheckInCache() {
  writeCheckInCache(sessionType, {
    ok: true,
    todayLabel,
    players: players.map((p) => ({
      sheetRow: p.sheetRow,
      name: p.name,
      checked: p.checked,
    })),
    checkedCount: players.filter((p) => p.checked).length,
    total: players.length,
    sessionType,
  });
}

function applyData(data) {
  if (!data.ok) {
    setStatus(data.error, true);
    players = [];
    gridEl.innerHTML = "";
    buttonByRow.clear();
    return;
  }
  players = normalizePlayers(data.players);
  todayLabel = data.todayLabel || getTodayLabel();
  if (data.syncing != null) syncing = !!data.syncing;
  if (data.viewOnly != null) viewOnly = !!data.viewOnly;
  refreshStatusLine();
  setupBanner.hidden = !viewOnly;
  render();
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  gridEl.innerHTML = "";
  buttonByRow.clear();
  players
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const uiState = rowUiState.get(p.sheetRow) || "idle";
      btn.className = "player" + (p.checked ? " checked" : "");
      updatePlayerButton(btn, p, uiState);
      btn.addEventListener("click", () => toggle(p.sheetRow));
      buttonByRow.set(p.sheetRow, btn);
      gridEl.appendChild(btn);
    });
}

function enqueueSave(sheetRow) {
  const idx = saveQueue.findIndex((j) => j.sheetRow === sheetRow);
  if (idx >= 0) saveQueue.splice(idx, 1);
  saveQueue.push({ sheetRow });
  rowUiState.set(sheetRow, "queued");
  refreshRow(sheetRow);
  refreshStatusLine();
  drainSaveQueue();
}

async function syncRowToServer(sheetRow) {
  const pl = players.find((x) => x.sheetRow === sheetRow);
  if (!pl) return;

  let guard = 0;
  while (pl.checked !== pl.serverChecked && guard < 4) {
    guard += 1;
    const res = await apiToggle(sheetRow);
    pl.serverChecked = !!res.checked;
    pl.checked = pl.serverChecked;
  }
}

async function drainSaveQueue() {
  if (saveQueueRunning) return;
  saveQueueRunning = true;
  try {
    while (saveQueue.length > 0) {
      const job = saveQueue[0];
      const pl = players.find((x) => x.sheetRow === job.sheetRow);
      if (!pl) {
        saveQueue.shift();
        continue;
      }

      const pending = saveQueue.filter((j) => j.sheetRow === job.sheetRow);
      for (const j of pending) {
        const i = saveQueue.indexOf(j);
        if (i >= 0) saveQueue.splice(i, 1);
      }

      if (pl.checked === pl.serverChecked) {
        rowUiState.set(job.sheetRow, "idle");
        refreshRow(job.sheetRow);
        continue;
      }

      rowUiState.set(job.sheetRow, "saving");
      refreshRow(job.sheetRow);
      refreshStatusLine();

      try {
        await syncRowToServer(job.sheetRow);
        rowUiState.set(job.sheetRow, "idle");
        refreshRow(job.sheetRow);
        persistCheckInCache();
        clearCsvCache();
        clearAttendanceJsonCache();
        dashboardRefreshHint = true;
      } catch (err) {
        pl.checked = pl.serverChecked;
        rowUiState.set(job.sheetRow, "idle");
        refreshRow(job.sheetRow);
        setStatus(err.message || String(err), true);
        if (/pin/i.test(String(err.message))) pinEl.focus();
      }
    }
  } finally {
    saveQueueRunning = false;
    refreshStatusLine();
    if (saveQueue.length > 0) drainSaveQueue();
  }
}

function toggle(sheetRow) {
  if (viewOnly) return;
  const pl = players.find((x) => x.sheetRow === sheetRow);
  if (!pl) return;

  pl.checked = !pl.checked;
  refreshRow(sheetRow);
  refreshStatusLine();
  enqueueSave(sheetRow);
}

function isStaleLoad(generation) {
  return generation !== loadGeneration;
}

async function load() {
  const generation = ++loadGeneration;
  setStatus("Loading roster…", false);
  gridEl.innerHTML = "";
  buttonByRow.clear();
  rowUiState.clear();
  players = [];
  dashboardRefreshHint = false;

  const cachedApi = readCheckInCache(sessionType);
  if (cachedApi?.ok) {
    applyData({ ...cachedApi, syncing: false, viewOnly: false });
  }

  const cachedCsvText = readCsvCache();
  if (cachedCsvText && !cachedApi?.ok) {
    const cachedRows = parseCSV(cachedCsvText);
    const shell = buildFromCsv(cachedRows, sessionType);
    if (shell.ok) applyData(shell);
    loadTodayBanner(cachedRows[0] || [], generation);
  }

  syncing = true;
  try {
    const [rows, apiData] = await Promise.all([
      fetchAttendanceRows(),
      coachApiGet("getCheckInData", { sessionType, pin: getPin() }),
    ]);
    if (isStaleLoad(generation)) return;

    const headerRow = rows?.[0] || [];
    loadTodayBanner(headerRow, generation);

    if (rows) {
      const shell = buildFromCsv(rows, sessionType);
      if (shell.ok) applyData(shell);
      else if (!apiData.ok) {
        syncing = false;
        setStatus(shell.error || apiData.error, true);
        return;
      }
    }

    if (apiData.ok) {
      if (players.length) {
        mergeLiveMarks(apiData);
        writeCheckInCache(sessionType, {
          ok: true,
          todayLabel,
          players: players.map((p) => ({
            sheetRow: p.sheetRow,
            name: p.name,
            checked: p.checked,
          })),
          checkedCount: players.filter((p) => p.checked).length,
          total: players.length,
          sessionType,
        });
      } else {
        writeCheckInCache(sessionType, apiData);
        applyData({ ...apiData, syncing: false, viewOnly: false });
      }
      return;
    }

    if (isStaleLoad(generation)) return;
    syncing = false;
    if (rows) {
      const shell = buildFromCsv(rows, sessionType);
      if (shell.ok) applyData({ ...shell, viewOnly: true });
      else setStatus(shell.error || apiData.error, true);
    } else {
      setStatus(apiData.error, true);
    }
  } catch (err) {
    if (isStaleLoad(generation)) return;
    const msg = err.message || String(err);
    if (/pin/i.test(msg)) {
      setStatus(msg, true);
      pinEl.focus();
      return;
    }

    syncing = false;
    try {
      const rows = await fetchAttendanceRows();
      const shell = buildFromCsv(rows, sessionType);
      loadTodayBanner(rows[0] || [], generation);
      if (shell.ok) {
        applyData({ ...shell, viewOnly: true });
        return;
      }
      setStatus(shell.error || msg, true);
    } catch {
      setStatus(msg, true);
    }
  }
}

load();
