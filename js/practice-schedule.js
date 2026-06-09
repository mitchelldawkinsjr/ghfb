import { coachApiGet } from "/shared/ghfb-coach-api.js";
import {
  PRACTICE_SHEET_EDIT_URL,
  PRACTICE_SLOT_MINUTES,
  clearPracticeScheduleCache,
  describePracticeForNow,
  fetchPracticeScheduleRows,
  formatPracticeClock,
  formatPracticeRange,
  getEndRowOptions,
  getEasternHMS,
  getEasternTotalMinutes,
  getPracticeSlots,
  joinBlockLabel,
  parsePracticeSheetMeta,
  splitBlockLabel,
} from "/shared/ghfb-practice-schedule.js";
import { escapeHtml } from "/shared/ghfb-dom.js";

function blocksToTimerSegments(blocks) {
  return (blocks || []).map((block, index) => {
    const { notes } = splitBlockLabel(block.label);
    return {
      blockIndex: index,
      name: block.title,
      detail: notes,
      duration: block.slotCount * PRACTICE_SLOT_MINUTES * 60,
      timeText: formatPracticeClock(block.startMinutes),
      startMinutes: block.startMinutes,
      endMinutes: block.endMinutes,
    };
  });
}

function nowTotalSeconds(when) {
  const { hours, minutes, seconds } = getEasternHMS(when);
  return hours * 3600 + minutes * 60 + seconds;
}

function getWallClockTimerState(blocks, when = new Date()) {
  if (!blocks?.length) {
    return { segmentIndex: 0, timeLeft: 0, phase: "empty" };
  }

  const nowMinutes = getEasternTotalMinutes(when);
  const nowTotal = nowTotalSeconds(when);

  const liveIndex = blocks.findIndex(
    (block) => nowMinutes >= block.startMinutes && nowMinutes < block.endMinutes
  );
  if (liveIndex >= 0) {
    const block = blocks[liveIndex];
    return {
      segmentIndex: liveIndex,
      timeLeft: Math.max(0, block.endMinutes * 60 - nowTotal),
      phase: "live",
    };
  }

  const nextIndex = blocks.findIndex((block) => block.startMinutes > nowMinutes);
  if (nextIndex >= 0) {
    const block = blocks[nextIndex];
    return {
      segmentIndex: nextIndex,
      timeLeft: Math.max(0, block.startMinutes * 60 - nowTotal),
      phase: "waiting",
    };
  }

  return {
    segmentIndex: blocks.length - 1,
    timeLeft: 0,
    phase: "done",
  };
}

function formatCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function createPracticeTimer(options) {
  const {
    root,
    cardEl,
    labelEl,
    detailEl,
    displayEl,
    indexEl,
    nextEl,
    startBtn,
    skipBtn,
    resetBtn,
    announceBtn,
    expandBtn,
    onSegmentChange,
    onTick,
  } = options;

  let blocks = [];
  let segments = [];
  let currentSeg = 0;
  let timeLeft = 0;
  let phase = "empty";
  let manualMode = false;
  let running = false;
  let wallClockEnabled = false;
  let interval = null;
  let audioCtx = null;
  let lastBeepSecond = -1;
  let waitingDuration = 0;
  let announceEnabled = false;
  let hasInteracted = false;
  let hasAnnouncedStart = false;

  function ensureAudio() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioCtx = new AudioCtx();
    }
    return audioCtx;
  }

  function announce(text) {
    if (!announceEnabled || !hasInteracted) return;
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    window.speechSynthesis.speak(utter);
  }

  function announcePeriod(seg, index, total, isStart = false) {
    if (!seg) return;
    if (isStart) {
      announce(`Practice starting. Period 1 of ${total}. ${seg.name}.`);
    } else if (phase === "done") {
      announce("Practice complete.");
    } else {
      announce(`Period ${index + 1} of ${total}. ${seg.name}.`);
    }
  }

  function syncAnnounceBtn() {
    if (!announceBtn) return;
    if (announceEnabled) {
      announceBtn.textContent = "🔔 On";
      announceBtn.setAttribute("aria-pressed", "true");
      announceBtn.classList.add("is-active");
    } else {
      announceBtn.textContent = "🔕 Announce";
      announceBtn.setAttribute("aria-pressed", "false");
      announceBtn.classList.remove("is-active");
    }
  }

  announceBtn?.addEventListener("click", () => {
    hasInteracted = true;
    ensureAudio();
    announceEnabled = !announceEnabled;
    try {
      sessionStorage.setItem("ghfb-timer-announce", announceEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    syncAnnounceBtn();
    if (announceEnabled && phase === "live" && segments[currentSeg]) {
      announcePeriod(segments[currentSeg], currentSeg, segments.length);
    }
  });

  function setTimerFullscreen(on) {
    if (!root || !expandBtn) return;
    root.classList.toggle("is-fullscreen", on);
    expandBtn.textContent = on ? "✕ Exit" : "⛶ Expand";
    expandBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  expandBtn?.addEventListener("click", () => {
    setTimerFullscreen(!root?.classList.contains("is-fullscreen"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root?.classList.contains("is-fullscreen")) {
      setTimerFullscreen(false);
    }
  });

  try {
    announceEnabled = sessionStorage.getItem("ghfb-timer-announce") === "1";
  } catch {
    /* ignore */
  }
  syncAnnounceBtn();

  function beep(freq = 880, dur = 0.15, vol = 0.35) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "square";
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  function tripleBeep() {
    beep(1046, 0.12, 0.45);
    setTimeout(() => beep(1046, 0.12, 0.45), 180);
    setTimeout(() => beep(1318, 0.25, 0.55), 360);
  }

  function notifySegmentChange() {
    onSegmentChange?.(currentSeg);
    const seg = segments[currentSeg];
    if (!seg) return;
    if (phase === "done") {
      announce("Practice complete.");
    } else if (!hasAnnouncedStart && phase === "live" && currentSeg === 0) {
      hasAnnouncedStart = true;
      announcePeriod(seg, 0, segments.length, true);
    } else if (phase === "live") {
      announcePeriod(seg, currentSeg, segments.length);
    }
  }

  function syncFromWallClock(when = new Date()) {
    const state = getWallClockTimerState(blocks, when);
    const changed = state.segmentIndex !== currentSeg || state.phase !== phase;
    if (state.phase === "waiting" && phase !== "waiting") {
      waitingDuration = state.timeLeft;
    }
    currentSeg = state.segmentIndex;
    timeLeft = state.timeLeft;
    phase = state.phase;
    if (changed) notifySegmentChange();
  }

  function updateUI() {
    if (!segments.length) {
      if (root) root.classList.add("is-empty");
      return;
    }

    if (root) root.classList.remove("is-empty");
    const seg = segments[currentSeg];

    let labelText = seg?.name || "—";
    if (phase === "waiting") labelText = `Practice starts at ${seg?.timeText ?? "—"}`;
    if (phase === "done") labelText = "Practice complete";

    if (labelEl) labelEl.textContent = labelText;
    if (detailEl) {
      detailEl.textContent =
        phase === "done"
          ? ""
          : phase === "waiting"
            ? `Up first: ${seg?.name ?? ""}`
            : seg.detail || "";
    }

    if (displayEl) {
      displayEl.textContent = formatCountdown(timeLeft);
      displayEl.className =
        "timer-display" +
        (phase === "live" && timeLeft <= 10
          ? " timer-display--urgent"
          : phase === "live" && timeLeft <= 30
            ? " timer-display--warn"
            : "");
    }

    if (indexEl) {
      indexEl.textContent =
        phase === "done"
          ? `Period ${segments.length} of ${segments.length}`
          : `Period ${currentSeg + 1} of ${segments.length}`;
    }

    const progressDenom =
      phase === "waiting"
        ? Math.max(1, waitingDuration || timeLeft || 1)
        : seg?.duration || 1;
    if (cardEl) {
      cardEl.classList.toggle("is-live", phase === "live");
      cardEl.style.setProperty(
        "--timer-progress",
        String(Math.min(1, Math.max(0, timeLeft / progressDenom)))
      );
    }

    const nextSeg = segments[currentSeg + 1];
    if (nextEl) {
      if (phase === "done") {
        nextEl.textContent = "—";
      } else if (phase === "waiting") {
        nextEl.textContent = `${seg.name} begins at ${seg.timeText}`;
      } else if (nextSeg) {
        nextEl.textContent = `${nextSeg.name} · ${nextSeg.timeText}`;
      } else {
        nextEl.textContent = "Last period";
      }
    }

    if (startBtn) {
      if (phase === "done") {
        startBtn.textContent = "Done";
        startBtn.disabled = true;
      } else if (manualMode && running) {
        startBtn.textContent = "Pause";
        startBtn.disabled = false;
      } else if (manualMode) {
        startBtn.textContent = "Resume";
        startBtn.disabled = false;
      } else {
        startBtn.textContent = "Run timer";
        startBtn.disabled = false;
      }
    }
  }

  function maybeBeep() {
    if (phase !== "live" || timeLeft <= 0) return;
    if (timeLeft === 30 || timeLeft === 10) {
      if (lastBeepSecond !== timeLeft) {
        lastBeepSecond = timeLeft;
        beep(660, 0.1);
      }
    }
    if (timeLeft === 0) {
      tripleBeep();
      lastBeepSecond = -1;
    }
  }

  function advanceManualSegment() {
    if (currentSeg < segments.length - 1) {
      currentSeg++;
      timeLeft = segments[currentSeg].duration;
      phase = "live";
      notifySegmentChange();
    } else {
      timeLeft = 0;
      phase = "done";
      running = false;
      manualMode = false;
    }
  }

  function tick() {
    if (manualMode && running) {
      if (timeLeft > 0) {
        timeLeft--;
        maybeBeep();
        updateUI();
      } else {
        tripleBeep();
        advanceManualSegment();
        updateUI();
      }
      return;
    }

    if (!manualMode && wallClockEnabled) {
      const prevSeg = currentSeg;
      const prevPhase = phase;
      syncFromWallClock();
      if (
        phase === "live" &&
        (prevSeg !== currentSeg || (prevPhase === "live" && timeLeft <= 30))
      ) {
        maybeBeep();
      }
      updateUI();
    }

    onTick?.();
  }

  function startInterval() {
    if (interval) return;
    interval = setInterval(tick, 1000);
  }

  function stopInterval() {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
  }

  startBtn?.addEventListener("click", () => {
    hasInteracted = true;
    ensureAudio();
    if (phase === "done") return;

    if (manualMode && running) {
      running = false;
      updateUI();
      return;
    }

    if (!manualMode) {
      manualMode = true;
      if (wallClockEnabled) syncFromWallClock();
      if (phase === "waiting") {
        timeLeft = segments[currentSeg]?.duration || timeLeft;
        phase = "live";
      }
    }

    running = true;
    beep(880, 0.08);
    startInterval();
    updateUI();
  });

  skipBtn?.addEventListener("click", () => {
    hasInteracted = true;
    ensureAudio();
    if (!segments.length || phase === "done") return;
    manualMode = true;
    running = true;
    advanceManualSegment();
    startInterval();
    updateUI();
  });

  resetBtn?.addEventListener("click", () => {
    hasInteracted = true;
    ensureAudio();
    manualMode = false;
    running = false;
    hasAnnouncedStart = false;
    lastBeepSecond = -1;
    if (wallClockEnabled) syncFromWallClock();
    else if (segments.length) {
      currentSeg = 0;
      timeLeft = segments[0].duration;
      phase = "live";
      notifySegmentChange();
    }
    updateUI();
  });

  function applyBlocks(newBlocks, { useWallClock = false, preserveManual = false } = {}) {
    blocks = newBlocks || [];
    segments = blocksToTimerSegments(blocks);
    wallClockEnabled = useWallClock;

    if (!segments.length) {
      phase = "empty";
      manualMode = false;
      running = false;
      stopInterval();
      updateUI();
      return;
    }

    if (preserveManual && manualMode) {
      currentSeg = Math.min(currentSeg, segments.length - 1);
      timeLeft = Math.min(timeLeft, segments[currentSeg]?.duration || 0);
      phase = phase === "done" ? "done" : "live";
      startInterval();
      updateUI();
      return;
    }

    manualMode = false;
    running = false;
    hasAnnouncedStart = false;
    lastBeepSecond = -1;

    if (wallClockEnabled) {
      syncFromWallClock();
    } else {
      currentSeg = 0;
      timeLeft = segments[0].duration;
      phase = "live";
    }

    notifySegmentChange();
    startInterval();
    updateUI();
  }

  return {
    setSchedule(newBlocks, options = {}) {
      applyBlocks(newBlocks, options);
    },

    refreshSchedule(newBlocks, options = {}) {
      const preserveManual = options.preserveManual ?? manualMode;
      applyBlocks(newBlocks, { ...options, preserveManual });
    },

    jumpTo(index) {
      if (index < 0 || index >= segments.length) return;
      ensureAudio();
      manualMode = true;
      running = false;
      currentSeg = index;
      timeLeft = segments[index].duration;
      phase = "live";
      lastBeepSecond = -1;
      notifySegmentChange();
      startInterval();
      updateUI();
    },

    getCurrentSegment() {
      return currentSeg;
    },

    getPhase() {
      return phase;
    },

    isManualMode() {
      return manualMode;
    },

    destroy() {
      stopInterval();
    },
  };
}

const PIN_STORAGE_KEY = "ghfb-coach-pin";
const MINUTE_HEIGHT_PX = 5;
const REFRESH_MS = 30_000;

function scrollTimelineToSegment(index) {
  const el = timelineEl?.querySelector(`[data-block-index="${index}"]`);
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function updateTimelineLive(currentSummary) {
  if (!timelineEl || !currentSummary?.blocks?.length) return;

  const track = timelineEl.querySelector(".timeline-track");
  if (!track) return;

  const nowMinutes = getEasternTotalMinutes(new Date());
  const { blocks, isToday, window } = currentSummary;
  const totalHeight = blocks.reduce(
    (sum, block) => sum + block.slotCount * PRACTICE_SLOT_MINUTES * MINUTE_HEIGHT_PX,
    0
  );

  let nowMarker = track.querySelector(".timeline-now");
  if (isToday && window) {
    const nowOffset = (nowMinutes - window.startMinutes) * MINUTE_HEIGHT_PX;
    const showMarker = nowOffset >= 0 && nowOffset <= totalHeight;
    if (showMarker) {
      if (!nowMarker) {
        nowMarker = document.createElement("div");
        nowMarker.className = "timeline-now";
        nowMarker.innerHTML = "<span>Now</span>";
        track.prepend(nowMarker);
      }
      nowMarker.style.top = `${nowOffset}px`;
      nowMarker.hidden = false;
    } else if (nowMarker) {
      nowMarker.hidden = true;
    }
  } else if (nowMarker) {
    nowMarker.hidden = true;
  }

  blocks.forEach((block, index) => {
    const el = track.querySelector(`[data-block-index="${index}"]`);
    if (!el) return;
    const isCurrent =
      isToday && nowMinutes >= block.startMinutes && nowMinutes < block.endMinutes;
    el.classList.toggle("is-current", isCurrent);
  });
}

const metaEl = document.getElementById("practiceMeta");
const statusEl = document.getElementById("practiceStatus");
const timelineEl = document.getElementById("practiceTimeline");
const sheetLinkEl = document.getElementById("sheetLink");
const refreshBtnEl = document.getElementById("refreshSchedule");
const feedMetaEl = document.getElementById("practiceFeedMeta");
const coachBarEl = document.getElementById("coachBar");
const pinEl = document.getElementById("coachPin");
const editStatusEl = document.getElementById("editStatus");
const editModalEl = document.getElementById("editModal");
const editFormEl = document.getElementById("editForm");
const editTitleEl = document.getElementById("editTitle");
const editNotesEl = document.getElementById("editNotes");
const editEndRowEl = document.getElementById("editEndRow");
const editCancelEl = document.getElementById("editCancel");
const editBackdropEl = document.getElementById("editBackdrop");

const practiceTimer = createPracticeTimer({
  root: document.getElementById("practiceTimer"),
  cardEl: document.getElementById("timerCard"),
  labelEl: document.getElementById("timerSegLabel"),
  detailEl: document.getElementById("timerSegDetail"),
  displayEl: document.getElementById("timerDisplay"),
  indexEl: document.getElementById("timerSegIndex"),
  nextEl: document.getElementById("timerNextName"),
  startBtn: document.getElementById("timerStart"),
  skipBtn: document.getElementById("timerSkip"),
  resetBtn: document.getElementById("timerReset"),
  announceBtn: document.getElementById("timerAnnounce"),
  expandBtn: document.getElementById("timerExpand"),
  onSegmentChange: (index) => {
    if (summary) {
      renderTimeline(summary);
      scrollTimelineToSegment(index);
    }
  },
  onTick: () => {
    if (summary?.isToday) updateTimelineLive(summary);
  },
});

let summary = null;
let slots = [];
let editEnabled = false;
let editingBlock = null;
let editingBlockIndex = -1;
const saveQueue = [];
let saveQueueRunning = false;

if (pinEl) {
  const savedPin = sessionStorage.getItem(PIN_STORAGE_KEY);
  if (savedPin) pinEl.value = savedPin;
  pinEl.addEventListener("input", () => {
    sessionStorage.setItem(PIN_STORAGE_KEY, pinEl.value.trim());
    updateEditMode();
  });
}

editCancelEl?.addEventListener("click", closeEditModal);
editBackdropEl?.addEventListener("click", closeEditModal);
editFormEl?.addEventListener("submit", (event) => {
  event.preventDefault();
  queueBlockSave();
});

function getPin() {
  return pinEl?.value.trim() || "";
}

function updateEditMode() {
  editEnabled = Boolean(getPin());
  if (coachBarEl) coachBarEl.classList.toggle("is-active", editEnabled);
  if (summary) renderTimeline(summary);
}

function setEditStatus(message, isError = false) {
  if (!editStatusEl) return;
  editStatusEl.textContent = message;
  editStatusEl.classList.toggle("is-error", isError);
}

function renderMeta(meta) {
  if (!metaEl) return;
  metaEl.innerHTML =
    `<h1>${escapeHtml(meta.title)}</h1>` +
    `<p class="practice-date">${escapeHtml(meta.dateLabel || "Practice day not set in sheet")}</p>`;
}

function renderStatus(currentSummary) {
  if (!statusEl) return;

  const { meta, isToday, current, next, status, window } = currentSummary;
  let message = "";
  let level = "info";

  if (!currentSummary.blocks.length) {
    message = "No practice periods found in the sheet.";
    level = "warn";
  } else if (!isToday) {
    message = `This plan is for ${meta.dateLabel || "another day"}. Update row 3 in the sheet for today.`;
    level = "info";
  } else if (status === "before" && next) {
    message = `Practice starts at ${formatPracticeClock(next.startMinutes)} · Up first: ${next.title}`;
    level = "info";
  } else if (status === "after") {
    message = `Practice ended at ${formatPracticeRange(window.startMinutes, window.endMinutes).split(" – ")[1] || window.endMinutes}.`;
    level = "info";
  } else if (current) {
    message = `Now: ${current.title} (${formatPracticeRange(current.startMinutes, current.endMinutes)})`;
    level = "live";
    if (next) message += ` · Up next: ${next.title} at ${formatPracticeClock(next.startMinutes)}`;
  } else {
    message = "Between periods — check the timeline below.";
    level = "info";
  }

  statusEl.className = `practice-status practice-status--${level}`;
  statusEl.textContent = message;
}

function renderBlockDetails(label) {
  const lines = String(label).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return "";
  const detailHtml = lines
    .slice(1)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  return `<div class="timeline-block-detail">${detailHtml}</div>`;
}

function renderTimeline(currentSummary) {
  if (!timelineEl) return;

  const { blocks, isToday } = currentSummary;
  if (!blocks.length) {
    timelineEl.innerHTML = `<p class="practice-empty">Could not build a timeline from the sheet.</p>`;
    return;
  }

  const now = new Date();
  const nowMinutes = getEasternTotalMinutes(now);
  const nowOffset =
    isToday && currentSummary.window
      ? (nowMinutes - currentSummary.window.startMinutes) * MINUTE_HEIGHT_PX
      : null;
  const totalHeight = blocks.reduce(
    (sum, block) => sum + block.slotCount * PRACTICE_SLOT_MINUTES * MINUTE_HEIGHT_PX,
    0
  );

  const timerSeg = practiceTimer.getCurrentSegment();

  const blocksHtml = blocks
    .map((block, index) => {
      const height = block.slotCount * PRACTICE_SLOT_MINUTES * MINUTE_HEIGHT_PX;
      const isCurrent =
        isToday && nowMinutes >= block.startMinutes && nowMinutes < block.endMinutes;
      const isTimerActive = index === timerSeg;
      const classes = [
        "timeline-block",
        isCurrent ? "is-current" : "",
        isTimerActive ? "is-timer-active" : "",
        editEnabled ? "is-editable" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const editBtn = editEnabled
        ? `<button type="button" class="timeline-edit-btn" data-block-index="${index}">Edit</button>`
        : "";
      return (
        `<article class="${classes}" style="--block-height:${height}px" data-block-index="${index}">` +
        `<div class="timeline-block-time">${escapeHtml(formatPracticeRange(block.startMinutes, block.endMinutes))}</div>` +
        `<div class="timeline-block-body">` +
        `<div class="timeline-block-head">` +
        `<h2>${escapeHtml(block.title)}</h2>` +
        editBtn +
        `</div>` +
        `<p class="timeline-block-duration">${block.slotCount * PRACTICE_SLOT_MINUTES} min · sheet rows ${block.startSheetRow}–${block.endSheetRow}</p>` +
        renderBlockDetails(block.label) +
        `</div>` +
        `</article>`
      );
    })
    .join("");

  const nowMarker =
    nowOffset != null && nowOffset >= 0 && nowOffset <= totalHeight
      ? `<div class="timeline-now" style="top:${nowOffset}px"><span>Now</span></div>`
      : "";

  timelineEl.innerHTML =
    `<div class="timeline-track" style="min-height:${totalHeight}px">` +
    nowMarker +
    blocksHtml +
    `</div>`;

  if (editEnabled) {
    timelineEl.querySelectorAll(".timeline-edit-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openEditModal(Number(btn.dataset.blockIndex));
      });
    });
    timelineEl.querySelectorAll(".timeline-block.is-editable").forEach((card) => {
      card.addEventListener("click", () => {
        openEditModal(Number(card.dataset.blockIndex));
      });
    });
  } else {
    timelineEl.querySelectorAll(".timeline-block").forEach((card) => {
      card.addEventListener("click", () => {
        practiceTimer.jumpTo(Number(card.dataset.blockIndex));
      });
      card.style.cursor = "pointer";
    });
  }
}

function updatePracticeTimer(currentSummary, { initial = false } = {}) {
  if (!currentSummary?.blocks?.length) {
    practiceTimer.setSchedule([], { useWallClock: false });
    return;
  }
  const options = { useWallClock: currentSummary.isToday };
  if (initial) {
    practiceTimer.setSchedule(currentSummary.blocks, options);
  } else {
    practiceTimer.refreshSchedule(currentSummary.blocks, options);
  }
}

function openEditModal(blockIndex) {
  if (!editEnabled || !summary?.blocks[blockIndex]) return;
  editingBlock = summary.blocks[blockIndex];
  editingBlockIndex = blockIndex;

  const { title, notes } = splitBlockLabel(editingBlock.label);
  if (editTitleEl) editTitleEl.value = title;
  if (editNotesEl) editNotesEl.value = notes;

  if (editEndRowEl) {
    const options = getEndRowOptions(editingBlock, summary.blocks, blockIndex, slots);
    editEndRowEl.innerHTML = options
      .map(
        (option) =>
          `<option value="${option.sheetRow}"` +
          `${option.sheetRow === editingBlock.endSheetRow ? " selected" : ""}>` +
          `${escapeHtml(option.endTimeText)} (${option.durationMin} min)` +
          `</option>`
      )
      .join("");
  }

  if (editModalEl) editModalEl.hidden = false;
}

function closeEditModal() {
  if (editModalEl) editModalEl.hidden = true;
  editingBlock = null;
  editingBlockIndex = -1;
}

function queueBlockSave() {
  if (!editingBlock) return;
  const job = {
    startSheetRow: editingBlock.startSheetRow,
    endSheetRow: editingBlock.endSheetRow,
    label: joinBlockLabel(editTitleEl?.value, editNotesEl?.value),
    newEndSheetRow: Number(editEndRowEl?.value || editingBlock.endSheetRow),
  };
  saveQueue.push(job);
  closeEditModal();
  setEditStatus(saveQueue.length > 1 ? `${saveQueue.length} saves queued…` : "Saving…");
  drainSaveQueue();
}

async function saveBlock(job) {
  const data = await coachApiGet("updatePracticeBlock", {
    pin: getPin(),
    startSheetRow: String(job.startSheetRow),
    endSheetRow: String(job.endSheetRow),
    label: job.label,
    newEndSheetRow: String(job.newEndSheetRow),
  });
  if (data.ok === false) throw new Error(data.error || "Save failed");
  return data;
}

async function drainSaveQueue() {
  if (saveQueueRunning) return;
  saveQueueRunning = true;
  try {
    while (saveQueue.length > 0) {
      const job = saveQueue[0];
      try {
        await saveBlock(job);
        saveQueue.shift();
        clearPracticeScheduleCache();
        const { rows } = await fetchPracticeScheduleRows({ bypassCache: true });
        await applyPracticeRows(rows, { initialTimer: false, fromCache: false });
        setEditStatus("Saved to sheet.");
      } catch (err) {
        setEditStatus(err.message || "Save failed.", true);
        break;
      }
    }
  } finally {
    saveQueueRunning = false;
    if (saveQueue.length > 0) drainSaveQueue();
    else if (!editStatusEl?.classList.contains("is-error")) {
      setTimeout(() => setEditStatus(""), 2500);
    }
  }
}

function setSheetLink() {
  if (sheetLinkEl) sheetLinkEl.href = PRACTICE_SHEET_EDIT_URL;
}

function renderFeedMeta(currentSummary, { fromCache = false } = {}) {
  if (!feedMetaEl) return;
  const count = currentSummary?.blocks?.length ?? 0;
  if (!count) {
    feedMetaEl.textContent = "";
    return;
  }
  const loadedAt = new Date().toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  feedMetaEl.textContent =
    `${count} periods from sheet CSV · loaded ${loadedAt}` +
    (fromCache ? " (cached — use Refresh for latest publish)" : "");
}

async function applyPracticeRows(rows, { initialTimer = false, fromCache = false } = {}) {
  summary = describePracticeForNow(rows);
  slots = getPracticeSlots(rows);
  renderStatus(summary);
  renderFeedMeta(summary, { fromCache });
  updatePracticeTimer(summary, { initial: initialTimer });
  renderTimeline(summary);
}

async function refreshPracticeSchedule({ bypassCache = false } = {}) {
  const { rows, fromCache } = await fetchPracticeScheduleRows({ bypassCache });
  await applyPracticeRows(rows, { fromCache: bypassCache ? false : fromCache });
}

refreshBtnEl?.addEventListener("click", async () => {
  if (refreshBtnEl) refreshBtnEl.disabled = true;
  try {
    clearPracticeScheduleCache();
    await refreshPracticeSchedule({ bypassCache: true });
    scrollTimelineToSegment(practiceTimer.getCurrentSegment());
    setEditStatus("Reloaded from sheet CSV.");
    setTimeout(
      () =>
        setEditStatus(
          getPin()
            ? "Coach edit mode — tap a period to update title, notes, or end time."
            : "Enter coach PIN to edit periods in the sheet."
        ),
      2000
    );
  } catch (err) {
    setEditStatus(err.message || "Could not reload CSV.", true);
  } finally {
    if (refreshBtnEl) refreshBtnEl.disabled = false;
  }
});

async function loadPracticeSchedule() {
  try {
    const { rows, fromCache } = await fetchPracticeScheduleRows();
    const meta = parsePracticeSheetMeta(rows);
    updateEditMode();
    renderMeta(meta);
    await applyPracticeRows(rows, { initialTimer: true, fromCache });
    scrollTimelineToSegment(practiceTimer.getCurrentSegment());
    setSheetLink();
    if (coachBarEl) {
      setEditStatus(
        getPin()
          ? "Coach edit mode — tap a period to update title, notes, or end time."
          : "Enter coach PIN to edit periods in the sheet."
      );
    }
  } catch (err) {
    console.warn("Practice schedule load failed:", err);
    if (metaEl) {
      metaEl.innerHTML =
        `<h1>Practice schedule</h1>` +
        `<p class="practice-date">Could not load schedule data.</p>`;
    }
    if (statusEl) {
      statusEl.className = "practice-status practice-status--warn";
      statusEl.textContent = "Check your connection or try again in a minute.";
    }
    if (timelineEl) {
      timelineEl.innerHTML = `<p class="practice-empty">Schedule unavailable.</p>`;
    }
    if (feedMetaEl) feedMetaEl.textContent = "";
    practiceTimer.setSchedule([], { useWallClock: false });
    setSheetLink();
  }
}

loadPracticeSchedule();
setInterval(() => {
  if (document.hidden) return;
  refreshPracticeSchedule().catch((err) => {
    console.warn("Practice schedule refresh failed:", err);
  });
}, REFRESH_MS);
