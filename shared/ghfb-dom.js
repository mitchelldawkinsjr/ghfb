/** @param {number} v 0–1 */
export function formatPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
