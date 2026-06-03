import { fetchCsvRows } from "/shared/ghfb-csv.js";
import {
  buildAttendanceSummary,
  describeTodaySessionStatus,
} from "/shared/ghfb-attendance.js";
import { fetchLiftPlanRows, getTodayLiftPlan, getTodayConditioningPlan } from "/shared/ghfb-lift-plan.js";
import { formatPct, escapeHtml } from "/shared/ghfb-dom.js";

const panel = document.getElementById("todayPanel");
const dateLabel = document.getElementById("todayDateLabel");
const rowsEl = document.getElementById("todayRows");
const actionsEl = document.getElementById("todayActions");

function statusClass(level) {
  if (level === "ok") return "today-status-ok";
  if (level === "warn") return "today-status-warn";
  return "today-status-info";
}

function renderRow(label, valueHtml, note) {
  return (
    `<div class="today-row">` +
    `<span class="today-label">${escapeHtml(label)}</span>` +
    `<span class="today-value">${valueHtml}</span>` +
    (note ? `<span class="today-note">${escapeHtml(note)}</span>` : "") +
    `</div>`
  );
}

function renderLiftRow(plan, liftError) {
  if (liftError) {
    return renderRow("Lift", `<span class="today-status-info">Plan unavailable</span>`, liftError);
  }
  if (!plan) {
    return renderRow(
      "Lift",
      `<span class="today-status-info">No row for today in Daily Lift Plan tab</span>`
    );
  }
  if (plan.off) {
    return renderRow("Lift", escapeHtml(plan.label), plan.notes || "");
  }
  const link = plan.url
    ? `<a href="${escapeHtml(plan.url)}">${escapeHtml(plan.label)}</a>`
    : escapeHtml(plan.label);
  return renderRow("Lift", link, plan.notes || "");
}

function renderConditioningRow(plan) {
  if (!plan) return "";
  const link = plan.url
    ? `<a href="${escapeHtml(plan.url)}">${escapeHtml(plan.label)}</a>`
    : escapeHtml(plan.label);
  return renderRow("Conditioning", link);
}

function renderAttendanceRow(headerRow) {
  const status = describeTodaySessionStatus(headerRow);
  return renderRow(
    "Attendance",
    `<span class="${statusClass(status.level)}">${escapeHtml(status.message)}</span>`
  );
}

function renderStatsRow(summary) {
  const momentum = summary.momentumPossible > 0 ? formatPct(summary.momentumRate) : "—";
  const ironCount =
    summary.completedTotalPossible > 0 ? String(summary.ironMen.length) : "—";
  return renderRow(
    "Team",
    `<span>Momentum ${momentum} · ${ironCount} ironmen</span>`,
    "Through yesterday"
  );
}

function renderActions(liftPlan, condPlan) {
  const liftHref = liftPlan?.url && !liftPlan.off ? liftPlan.url : "/lift/";
  const condHref = condPlan?.url ? condPlan.url : "/lift/";
  actionsEl.innerHTML =
    `<a class="today-btn today-btn--primary" href="/check-in.html">Open check-in</a>` +
    `<a class="today-btn" href="/attendance-dashboard.html">Dashboard</a>` +
    `<div class="today-actions-pair">` +
    `<a class="today-btn" href="${escapeHtml(liftHref)}">Open lift</a>` +
    `<a class="today-btn" href="${escapeHtml(condHref)}">Open conditioning</a>` +
    `</div>`;
}

function renderError(message) {
  rowsEl.innerHTML = renderRow("Status", `<span class="today-status-warn">${escapeHtml(message)}</span>`);
  actionsEl.innerHTML =
    `<a class="today-btn today-btn--primary" href="/check-in.html">Open check-in</a>` +
    `<a class="today-btn" href="/attendance-dashboard.html">Dashboard</a>`;
  panel?.classList.remove("is-loading");
}

async function loadTodayPanel() {
  if (dateLabel) {
    dateLabel.textContent = new Date().toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  try {
    const [attRows, liftResult] = await Promise.all([
      fetchCsvRows(),
      fetchLiftPlanRows().then(
        (rows) => ({
          plan: getTodayLiftPlan(rows),
          condPlan: getTodayConditioningPlan(rows),
          error: null,
        }),
        (err) => ({ plan: null, condPlan: null, error: "Add Daily Lift Plan tab and publish CSV (see docs)" })
      ),
    ]);

    const summary = buildAttendanceSummary(attRows);
    rowsEl.innerHTML =
      renderLiftRow(liftResult.plan, liftResult.error) +
      renderConditioningRow(liftResult.condPlan) +
      renderAttendanceRow(summary.headerRow) +
      renderStatsRow(summary);
    renderActions(liftResult.plan, liftResult.condPlan);
    panel?.classList.remove("is-loading");
  } catch (err) {
    console.warn("Today panel load failed:", err);
    renderError("Could not load attendance data.");
  }
}

loadTodayPanel();
