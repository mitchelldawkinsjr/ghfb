import { fetchAttendanceRows } from "/shared/ghfb-csv.js";
import {
  buildAttendanceSummary,
  describeTodaySessionStatus,
  findTodayPracticeColumnIndex,
  cellIsMark,
  getTodayLabel,
} from "/shared/ghfb-attendance.js";
import { fetchLiftPlanRows, getTodayLiftPlan, getTodayConditioningPlan } from "/shared/ghfb-lift-plan.js";
import {
  describePracticeForNow,
  fetchPracticeScheduleRows,
} from "/shared/ghfb-practice-schedule.js";
import { formatPct, escapeHtml } from "/shared/ghfb-dom.js";

const PRACTICE_TIMELINE_URL = "/practice-schedule.html";

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
      `<span class="today-status-info">Nothing scheduled</span>`
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
  const note = plan.coach ? `Coach: ${plan.coach}` : "";
  return renderRow("Conditioning", link, note);
}

function renderPracticeRow(summary, practiceError) {
  if (practiceError) {
    return renderRow(
      "Practice",
      `<span class="today-status-info">Schedule unavailable</span>`,
      practiceError
    );
  }
  if (!summary?.isToday) return "";

  const { current, next, status } = summary;
  const timelineLink = `<a href="${escapeHtml(PRACTICE_TIMELINE_URL)}">`;

  if (!summary.blocks.length) {
    return renderRow(
      "Practice",
      `${timelineLink}<span class="today-status-info">No periods in sheet</span></a>`
    );
  }

  if (status === "before" && next) {
    return renderRow(
      "Practice",
      `${timelineLink}Starts ${escapeHtml(next.startTimeText)} · ${escapeHtml(next.title)}</a>`
    );
  }

  if (status === "after") {
    return renderRow("Practice", `${timelineLink}Practice ended</a>`);
  }

  if (current) {
    const link = `${timelineLink}Now: ${escapeHtml(current.title)}</a>`;
    const note = next
      ? `Timer & timeline · Up next: ${next.title} at ${next.startTimeText}`
      : "Timer & timeline";
    return renderRow("Practice", link, note);
  }

  return renderRow("Practice", `${timelineLink}Between periods</a>`, "Timer & timeline");
}

function renderAttendanceRow(headerRow, dataRows) {
  const status = describeTodaySessionStatus(headerRow, { short: true });
  const practiceCol = findTodayPracticeColumnIndex(headerRow);
  let note = "";
  if (practiceCol != null && dataRows?.length) {
    const practiceChecked = dataRows.filter((row) => cellIsMark(row, practiceCol)).length;
    note = `Practice check-in ${practiceChecked}/${dataRows.length} (${getTodayLabel()})`;
  }
  return renderRow(
    "Attendance",
    `<span class="${statusClass(status.level)}">${escapeHtml(status.message)}</span>`,
    note
  );
}

function renderStatsRow(summary) {
  const momentum = summary.momentumPossible > 0 ? formatPct(summary.momentumRate) : "—";
  const ironCount = summary.totalPossible > 0 ? String(summary.ironMen.length) : "—";
  const practiceNote =
    summary.practiceParticipation?.practiceCols > 0
      ? `${summary.practiceParticipation.practiceAttended}/${summary.practiceParticipation.rosterSize} marked practice`
      : "Live";
  return renderRow(
    "Team",
    `<span>Momentum ${momentum} · ${ironCount} ironmen</span>`,
    practiceNote
  );
}

function renderActions(liftPlan, condPlan) {
  const liftHref = liftPlan?.url && !liftPlan.off ? liftPlan.url : "/lift/";
  const condHref = condPlan?.url ? condPlan.url : "/lift/";
  actionsEl.innerHTML =
    `<a class="today-btn today-btn--primary" href="/check-in.html">Open check-in</a>` +
    `<a class="today-btn" href="/attendance-dashboard.html">Dashboard</a>` +
    `<a class="today-btn" href="${escapeHtml(PRACTICE_TIMELINE_URL)}">Practice schedule</a>` +
    `<div class="today-actions-pair">` +
    `<a class="today-btn" href="${escapeHtml(liftHref)}">Open lift</a>` +
    `<a class="today-btn" href="${escapeHtml(condHref)}">Open conditioning</a>` +
    `</div>`;
}

function renderError(message) {
  rowsEl.innerHTML = renderRow("Status", `<span class="today-status-warn">${escapeHtml(message)}</span>`);
  actionsEl.innerHTML =
    `<a class="today-btn today-btn--primary" href="/check-in.html">Open check-in</a>` +
    `<a class="today-btn" href="/attendance-dashboard.html">Dashboard</a>` +
    `<a class="today-btn" href="${escapeHtml(PRACTICE_TIMELINE_URL)}">Practice schedule</a>` +
    `<a class="today-btn" href="/weightroom/">Weightroom tracker</a>`;
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
    const [attRows, liftResult, practiceResult] = await Promise.all([
      fetchAttendanceRows(),
      fetchLiftPlanRows().then(
        (rows) => ({
          plan: getTodayLiftPlan(rows),
          condPlan: getTodayConditioningPlan(rows),
          error: null,
        }),
        () => ({ plan: null, condPlan: null, error: "Lift plan not published" })
      ),
      fetchPracticeScheduleRows().then(
        ({ rows }) => ({
          summary: describePracticeForNow(rows),
          error: null,
        }),
        () => ({ summary: null, error: "Could not load practice schedule" })
      ),
    ]);

    const summary = buildAttendanceSummary(attRows);
    rowsEl.innerHTML =
      renderLiftRow(liftResult.plan, liftResult.error) +
      renderConditioningRow(liftResult.condPlan) +
      renderPracticeRow(practiceResult.summary, practiceResult.error) +
      renderAttendanceRow(summary.headerRow, summary.dataRows) +
      renderStatsRow(summary);
    renderActions(liftResult.plan, liftResult.condPlan);
    panel?.classList.remove("is-loading");
  } catch (err) {
    console.warn("Today panel load failed:", err);
    renderError("Could not load attendance data.");
  }
}

loadTodayPanel();
