import {
  parseCSV,
  readCsvCache,
  writeCsvCache,
  fetchCsvText,
  clearCsvCache,
} from "/shared/ghfb-csv.js";
import {
  ATTENDANCE_START_IDX,
  getColumnKind,
  formatHeaderLabel,
  getToday,
  getValidAttendanceIndexes,
  computeRollingStats,
  getTableColumnIndexes,
  buildAttendanceSummary,
  computeAtRiskPlayers,
  MISSED_24_THRESHOLD,
} from "/shared/ghfb-attendance.js";
import { formatPct, escapeHtml } from "/shared/ghfb-dom.js";

const loadStatus = document.getElementById("loadStatus");
const tableCard = document.getElementById("tableCard");
const chartCard = document.getElementById("chartCard");
const attentionCard = document.getElementById("attentionCard");
const barChartEl = document.getElementById("attendanceBarChart");

function setLoadStatus(text, isError) {
  if (!loadStatus) return;
  loadStatus.textContent = text;
  loadStatus.classList.toggle("error", !!isError);
}

function buildRosterPieCharts(stats) {
  const grid = document.getElementById("rosterPieGrid");
  if (!grid) return;

  const pies = [
    {
      label: "in Weightroom",
      pct: stats.weightroomPct,
      attended: stats.weightroomAttended,
      color: "#ffe599",
      sessions: stats.weightroomCols,
    },
    {
      label: "at Conditioning",
      pct: stats.conditioningPct,
      attended: stats.conditioningAttended,
      color: "#9fc5e8",
      sessions: stats.conditioningCols,
    },
  ];

  if (stats.practiceCols > 0) {
    pies.push({
      label: "at Practice",
      pct: stats.practicePct,
      attended: stats.practiceAttended,
      color: "#b8d4a8",
      sessions: stats.practiceCols,
    });
  }

  grid.innerHTML = pies
    .map((pie) => {
      const pctDisplay = (pie.pct * 100).toFixed(2);
      const attendedDeg = Math.max(0, Math.min(100, pie.pct * 100)) * 3.6;
      const sessionNote =
        pie.sessions === 0
          ? "No eligible sessions yet"
          : `${pie.attended} of ${stats.rosterSize} players`;
      return (
        `<div class="roster-pie-block">` +
        `<div class="roster-pie-wrap" style="background:conic-gradient(${pie.color} 0deg ${attendedDeg}deg, rgba(255,255,255,0.1) ${attendedDeg}deg 360deg);">` +
        `<div class="roster-pie-hole">${pctDisplay}%</div></div>` +
        `<p class="roster-pie-label">${pie.label}</p>` +
        `<p class="roster-pie-detail">${sessionNote}</p>` +
        `</div>`
      );
    })
    .join("");
}

function renderIronMenList(ironMen, emptyMessage) {
  const container = document.getElementById("ironMenNames");
  if (!container) return;

  if (!ironMen.length) {
    container.innerHTML = emptyMessage
      ? `<p class="ironmen-empty">${emptyMessage}</p>`
      : "";
    return;
  }

  const sorted = [...ironMen].sort(
    (a, b) => b.rollingRate - a.rollingRate || a.name.localeCompare(b.name)
  );

  container.innerHTML = sorted
    .map(
      (player) =>
        `<span class="ironman-chip">` +
        `<span class="ironman-name">${escapeHtml(player.name)}</span>` +
        `<span class="ironman-pct">${formatPct(player.rollingRate)}</span>` +
        `</span>`
    )
    .join("");
}

function updateSummaryBoxes(stats) {
  const {
    playerCount,
    topPlayerLabel,
    ironMenCount,
    ironMen,
    ironMenEmptyMessage,
    momentumPct,
    momentumMeta,
  } = stats;

  document.getElementById("totalPlayers").textContent = String(playerCount);
  document.getElementById("topPlayer").textContent = topPlayerLabel;
  document.getElementById("ironMenNumber").textContent = String(ironMenCount);
  renderIronMenList(ironMen ?? [], ironMenEmptyMessage ?? "");
  document.getElementById("momentumRate").textContent = momentumPct;
  document.getElementById("momentumMeta").textContent = momentumMeta;
}

function renderAttentionList(title, players) {
  if (!players.length) {
    return (
      `<div class="attention-block">` +
      `<h4>${escapeHtml(title)}</h4>` +
      `<p class="attention-empty">No one in this group right now.</p>` +
      `</div>`
    );
  }

  const items = players
    .map(
      (player) =>
        `<li>` +
        `<span class="attention-name">${escapeHtml(player.name)}</span>` +
        `<span class="attention-meta">${formatPct(player.rollingRate)} · ${escapeHtml(player.reason)}</span>` +
        `</li>`
    )
    .join("");

  return (
    `<div class="attention-block">` +
    `<h4>${escapeHtml(title)}</h4>` +
    `<ul class="attention-list">${items}</ul>` +
    `</div>`
  );
}

function buildAttentionPanel(summary) {
  const grid = document.getElementById("attentionGrid");
  if (!grid) return;

  const atRisk = computeAtRiskPlayers(summary);
  grid.innerHTML =
    renderAttentionList("Near ironman line", atRisk.nearIronman) +
    renderAttentionList(`Heavy misses (${MISSED_24_THRESHOLD}+)`, atRisk.heavyMisses) +
    renderAttentionList("WR / conditioning gap", atRisk.splitAttendance);

  attentionCard?.classList.remove("is-loading");
}

function applySummaryToDom(summary) {
  const {
    playerTotals,
    dataRows,
    validIndexes,
    ironMen,
    ironMenThresholdRate,
    momentumRate,
    momentumMarks,
    momentumPossible,
    top,
    totalPossible,
    lastSevenIndexes,
    rosterParticipation,
    practiceParticipation,
  } = summary;

  const ironLabel = document.getElementById("ironMenLabel");
  if (ironLabel) {
    ironLabel.textContent = `Ironmen (rolling avg ≥ ${formatPct(ironMenThresholdRate)}, through today)`;
  }

  const formulaNote = document.getElementById("rollingFormulaNote");
  if (formulaNote && totalPossible > 0) {
    const todayLabel = getToday().toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });
    formulaNote.innerHTML =
      `As of <strong>${todayLabel}</strong>: rolling % = <strong>X</strong> marks ÷ <strong>${totalPossible}</strong> ` +
      `session slots (weightroom dates on/before today + paired <strong>C</strong>; future dates excluded). ` +
      `<strong>P</strong> practice columns are tracked separately and do not affect ironmen. ` +
      `Leader example: ${top ? `${top.marks}/${totalPossible} = ${formatPct(top.rollingRate)}` : "—"}.`;
  }

  buildRosterPieCharts({
    ...rosterParticipation,
    practicePct: practiceParticipation?.practicePct ?? 0,
    practiceAttended: practiceParticipation?.practiceAttended ?? 0,
    practiceCols: practiceParticipation?.practiceCols ?? 0,
  });
  buildAttentionPanel(summary);

  updateSummaryBoxes({
    playerCount: dataRows.length,
    topPlayerLabel: top
      ? `${top.name} (${top.marks}/${totalPossible}, ${formatPct(top.rollingRate)})`
      : "N/A",
    ironMenCount: ironMen.length,
    ironMen,
    ironMenEmptyMessage: ironMen.length
      ? ""
      : totalPossible > 0
        ? `No players at ${formatPct(ironMenThresholdRate)} yet (${totalPossible} sessions through today)`
        : "No completed sessions yet for ironmen",
    momentumPct: momentumPossible > 0 ? formatPct(momentumRate) : "—",
    momentumMeta:
      lastSevenIndexes.length > 0
        ? `${lastSevenIndexes.length} sessions · ${momentumMarks}/${momentumPossible} marks · through today`
        : "No completed sessions yet for momentum",
  });

  return { playerTotals, dataRows, validIndexes };
}

function buildTable(rows, ctx) {
  const table = document.getElementById("attendanceTable");
  const { displayCols, columnKinds, validIndexes, validSet } = ctx;
  const fragment = document.createDocumentFragment();

  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    let rowMissed24 = false;

    if (rowIndex > 0) {
      const { marks, totalPossible } = computeRollingStats(row, validIndexes);
      const missed = totalPossible - marks;
      rowMissed24 = totalPossible > 0 && missed >= MISSED_24_THRESHOLD;
    }

    for (const colIndex of displayCols) {
      const kind = columnKinds[colIndex] || "other";
      const isHeader = rowIndex === 0;
      const cell = row[colIndex];
      const cellEl = document.createElement(isHeader ? "th" : "td");
      cellEl.textContent = isHeader ? formatHeaderLabel(cell) : (cell ?? "");

      if (colIndex <= 1) {
        cellEl.classList.add("col-meta");
        if (!isHeader && rowMissed24) cellEl.classList.add("col-missed24");
      } else if (isHeader) {
        if (kind === "weightroom") cellEl.classList.add("col-weightroom");
        if (kind === "conditioning") cellEl.classList.add("col-conditioning");
        if (kind === "practice") cellEl.classList.add("col-practice");
      } else {
        const cellValue = String(cell ?? "").trim().toUpperCase();
        if (cellValue === "X") {
          if (kind === "conditioning") cellEl.classList.add("col-conditioning");
          else if (kind === "practice") cellEl.classList.add("col-practice");
          else cellEl.classList.add("col-weightroom");
        } else if (validSet.has(colIndex)) {
          cellEl.classList.add(rowMissed24 ? "col-missed24" : "col-no-attendance");
        } else if (kind === "weightroom") {
          cellEl.classList.add("col-weightroom");
        } else if (kind === "conditioning") {
          cellEl.classList.add("col-conditioning");
        } else if (kind === "practice") {
          cellEl.classList.add("col-practice");
        }
      }

      tr.appendChild(cellEl);
    }

    fragment.appendChild(tr);
  });

  table.replaceChildren(fragment);
  tableCard.classList.remove("is-loading");
}

function buildBarChart(playerTotals) {
  const sorted = [...playerTotals].sort((a, b) => b.rollingRate - a.rollingRate);
  const rows = sorted.map((p) => {
    const pct = (p.rollingRate * 100).toFixed(1);
    const width = Math.max(0, Math.min(100, p.rollingRate * 100));
    const name = escapeHtml(p.name);
    return (
      `<div class="bar-row">` +
      `<span class="bar-label" title="${name}">${name}</span>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>` +
      `<span class="bar-pct">${pct}%</span>` +
      `</div>`
    );
  });
  barChartEl.innerHTML = rows.join("");
  chartCard.classList.remove("is-loading");
}

function renderDashboard(csv, statusLabel) {
  const rows = parseCSV(csv).filter((r) => r.some((c) => c !== ""));
  if (rows.length < 2) throw new Error("No attendance rows found");

  const headerRow = rows[0] || [];
  const displayCols = getTableColumnIndexes(headerRow);
  const columnKinds = headerRow.map((header) => getColumnKind(header));
  const validIndexes = getValidAttendanceIndexes(headerRow, ATTENDANCE_START_IDX);
  const validSet = new Set(validIndexes);

  const summary = buildAttendanceSummary(rows);
  applySummaryToDom(summary);
  buildBarChart(summary.playerTotals);
  setLoadStatus(statusLabel || "Updated just now");

  requestAnimationFrame(() => {
    buildTable(rows, { displayCols, columnKinds, validIndexes, validSet });
  });
}

function startAttendanceLoad() {
  const forceRefresh = new URLSearchParams(window.location.search).get("refresh") === "1";
  if (forceRefresh) clearCsvCache();

  const cached = forceRefresh ? null : readCsvCache();
  if (cached) {
    try {
      renderDashboard(cached, "Showing cached data…");
    } catch (e) {
      console.warn("Cached CSV invalid:", e);
    }
    fetchCsvText()
      .then((fresh) => {
        writeCsvCache(fresh);
        renderDashboard(fresh, "Updated just now");
      })
      .catch((err) => {
        console.warn("Background refresh failed:", err);
        if (!cached) throw err;
        setLoadStatus("Showing cached data (refresh failed)", true);
      });
    return;
  }

  fetchCsvText()
    .then((csv) => {
      writeCsvCache(csv);
      renderDashboard(csv, "Updated just now");
    })
    .catch((error) => {
      console.error("Error loading CSV:", error);
      setLoadStatus("Could not load attendance data. Try refreshing.", true);
      updateSummaryBoxes({
        playerCount: 0,
        topPlayerLabel: "N/A",
        ironMenCount: 0,
        ironMen: [],
        ironMenEmptyMessage: "",
        momentumPct: "—",
        momentumMeta: "—",
      });
      tableCard?.classList.remove("is-loading");
      chartCard?.classList.remove("is-loading");
      attentionCard?.classList.remove("is-loading");
      if (barChartEl) barChartEl.innerHTML = "";
      const grid = document.getElementById("attentionGrid");
      if (grid) grid.innerHTML = "";
    });
}

startAttendanceLoad();
