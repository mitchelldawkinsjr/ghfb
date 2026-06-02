import {
  parseCSV,
  readCsvCache,
  writeCsvCache,
  fetchCsvText,
  filterNonEmptyRows,
} from "/shared/ghfb-csv.js";
import {
  ATTENDANCE_START_IDX,
  getColumnKind,
  formatHeaderLabel,
  getToday,
  getValidAttendanceIndexes,
  getSheetMeta,
  computeRollingStats,
  getTableColumnIndexes,
  getPlayerDisplayName,
  getDataRows,
  computeRosterParticipation,
} from "/shared/ghfb-attendance.js";
import { formatPct, escapeHtml } from "/shared/ghfb-dom.js";

const MISSED_24_THRESHOLD = 24;

const loadStatus = document.getElementById("loadStatus");
const tableCard = document.getElementById("tableCard");
const chartCard = document.getElementById("chartCard");
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

function buildSummary(rows) {
  const headerRow = rows[0] || [];
  const dataRows = getDataRows(rows);
  const validAttendanceIndexes = getValidAttendanceIndexes(headerRow, ATTENDANCE_START_IDX);
  const lastSevenIndexes = validAttendanceIndexes.slice(-7);
  const sheetMeta = getSheetMeta(headerRow, dataRows);
  const ironMenThresholdRate = sheetMeta.ironMenThresholdRate;

  const ironLabel = document.getElementById("ironMenLabel");
  if (ironLabel) {
    ironLabel.textContent = `Ironmen (rolling avg ≥ ${formatPct(ironMenThresholdRate)})`;
  }

  const playerTotals = dataRows.map((row) => {
    const name = getPlayerDisplayName(row);
    const rolling = computeRollingStats(row, validAttendanceIndexes);
    return { name, ...rolling };
  });

  const totalPossible = validAttendanceIndexes.length;

  const top = [...playerTotals].sort((a, b) => b.rollingRate - a.rollingRate)[0];
  const ironMen = playerTotals.filter((p) => p.rollingRate >= ironMenThresholdRate);

  const momentumMarks = dataRows.reduce((sum, row) => {
    const rowMarks = lastSevenIndexes.filter(
      (idx) => String(row[idx] ?? "").trim().toUpperCase() === "X"
    ).length;
    return sum + rowMarks;
  }, 0);
  const momentumPossible = dataRows.length * lastSevenIndexes.length;
  const momentumRate = momentumPossible > 0 ? momentumMarks / momentumPossible : 0;

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
      `Leader example: ${top ? `${top.marks}/${totalPossible} = ${formatPct(top.rollingRate)}` : "—"}.`;
  }

  const rosterParticipation = computeRosterParticipation(
    dataRows,
    headerRow,
    validAttendanceIndexes
  );
  buildRosterPieCharts(rosterParticipation);

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
        ? `No players at ${formatPct(ironMenThresholdRate)} yet (${totalPossible} sessions counted)`
        : "No sessions counted yet as of today",
    momentumPct: totalPossible > 0 ? formatPct(momentumRate) : "—",
    momentumMeta:
      lastSevenIndexes.length > 0
        ? `${lastSevenIndexes.length} sessions · ${momentumMarks}/${momentumPossible} marks`
        : "No sessions in range yet",
  });

  return { playerTotals, dataRows, rosterParticipation };
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
      } else {
        const cellValue = String(cell ?? "").trim().toUpperCase();
        if (cellValue === "X") {
          cellEl.classList.add(kind === "conditioning" ? "col-conditioning" : "col-weightroom");
        } else if (validSet.has(colIndex)) {
          cellEl.classList.add(rowMissed24 ? "col-missed24" : "col-no-attendance");
        } else if (kind === "weightroom") {
          cellEl.classList.add("col-weightroom");
        } else if (kind === "conditioning") {
          cellEl.classList.add("col-conditioning");
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
  const rows = filterNonEmptyRows(parseCSV(csv));
  if (rows.length < 2) throw new Error("No attendance rows found");

  const headerRow = rows[0] || [];
  const displayCols = getTableColumnIndexes(headerRow);
  const columnKinds = headerRow.map((header) => getColumnKind(header));
  const validIndexes = getValidAttendanceIndexes(headerRow, ATTENDANCE_START_IDX);
  const validSet = new Set(validIndexes);

  const summary = buildSummary(rows);
  buildBarChart(summary.playerTotals);
  setLoadStatus(statusLabel || "Updated just now");

  requestAnimationFrame(() => {
    buildTable(rows, { displayCols, columnKinds, validIndexes, validSet });
  });
}

function startAttendanceLoad() {
  const cached = readCsvCache();
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
      tableCard.classList.remove("is-loading");
      chartCard.classList.remove("is-loading");
      if (barChartEl) barChartEl.innerHTML = "";
    });
}

startAttendanceLoad();
