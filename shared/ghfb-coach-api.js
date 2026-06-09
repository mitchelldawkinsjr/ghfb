const CHECKIN_API = window.GHFB_CHECKIN_API || "/api/checkin";

export async function coachApiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const res = await fetch(`${CHECKIN_API}?${qs}`, { cache: "no-store" });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Invalid API response" : `Coach API error (${res.status})`);
  }
  if (!res.ok && data?.error) throw new Error(data.error);
  return data;
}
