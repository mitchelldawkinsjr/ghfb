const EVENTS_URL = "/data/summer-schedule-events.json";

function escapeIcs(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldLine(line) {
  const max = 73;
  if (line.length <= max) return [line];
  const out = [];
  let rest = line;
  out.push(rest.slice(0, max));
  rest = rest.slice(max);
  while (rest.length > 0) {
    out.push(" " + rest.slice(0, max - 1));
    rest = rest.slice(max - 1);
  }
  return out;
}

function formatLocalStamp(date, time) {
  const [y, mo, d] = date.split("-");
  const [hh, mm] = time.split(":");
  return `${y}${mo}${d}T${hh}${mm}00`;
}

function buildIcs(calendar) {
  const tz = calendar.timezone || "America/Detroit";
  const now = new Date();
  const dtstamp =
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}` +
    `${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Godwin Heights Football//Summer Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calendar.calendarName)}`,
  ];

  for (const ev of calendar.events) {
    const uid = `ghfb-summer-${ev.date}-${slug(ev.summary)}@ghfb.360web.cloud`;
    const parts = [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `SUMMARY:${escapeIcs(ev.summary)}`,
    ];

    if (ev.location) {
      parts.push(`LOCATION:${escapeIcs(ev.location)}`);
    }

    if (ev.allDay) {
      const day = ev.date.replace(/-/g, "");
      parts.push(`DTSTART;VALUE=DATE:${day}`);
      const endDay = addDaysDate(ev.date, 1).replace(/-/g, "");
      parts.push(`DTEND;VALUE=DATE:${endDay}`);
    } else {
      const start = formatLocalStamp(ev.date, ev.start || "09:00");
      const end = formatLocalStamp(ev.date, ev.end || ev.start || "10:00");
      parts.push(`DTSTART;TZID=${tz}:${start}`);
      parts.push(`DTEND;TZID=${tz}:${end}`);
    }

    parts.push("END:VEVENT");
    for (const line of parts) {
      lines.push(...foldLine(line));
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function addDaysDate(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSummerScheduleIcs() {
  const res = await fetch(EVENTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load schedule (${res.status})`);
  const calendar = await res.json();
  const ics = buildIcs(calendar);
  downloadText("godwin-summer-2026.ics", ics, "text/calendar;charset=utf-8");
}

const btn = document.getElementById("downloadSummerIcs");
if (btn) {
  btn.addEventListener("click", async () => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Building calendar…";
    try {
      await downloadSummerScheduleIcs();
    } catch (err) {
      console.error(err);
      alert("Could not download calendar file. Try again in a moment.");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}
