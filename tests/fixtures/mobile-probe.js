// Runs inside the page: horizontal overflow, small tap targets and low-contrast text at the current viewport.
(() => {
  const W = innerWidth;
  const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
  const scroller = (el) => { for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) { const s = getComputedStyle(node); if (/(auto|scroll)/.test(s.overflowX) && !node.matches(".el-content, .el-thread, .el-shell, .el-main")) return true; } return false; };
  const overflow = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || scroller(el)) continue;
    if (b.right > W + 0.5 || b.left < -0.5) overflow.push(`${label(el)} [${Math.round(b.left)}, ${Math.round(b.right)}]`);
  }
  const targets = [];
  for (const el of document.querySelectorAll("button, a.el-btn, a.el-list-row, .el-icon-btn, summary, .el-chip, .el-tabbar a, input:not([type=hidden]), textarea, select")) {
    const field = el.matches("input, textarea, select") ? el.closest("label, .searchbox, .browser-address, .v4-search") || el : el;
    const b = field.getBoundingClientRect();
    if (!b.width) continue;
    if (b.height < 43.5 || (b.width < 43.5 && !el.matches("input, textarea, select"))) targets.push(`${label(el)} ${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  const rgb = (value) => { const m = value.match(/[\d.]+/g); if (!m) return null; const n = m.map(Number); if (value.startsWith("color(srgb")) return [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1]; return n; };
  const lum = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const bgOf = (el) => { for (let node = el; node; node = node.parentElement) { const c = rgb(getComputedStyle(node).backgroundColor); if (c && (c.length < 4 || c[3] > 0.6)) return c; } return rgb(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255]; };
  const contrast = [];
  for (const el of document.querySelectorAll("h1, h2, h3, p, strong, small, span, a, button, li, time, label")) {
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || Number(s.opacity) < 0.6) continue;
    const fg = rgb(s.color); const bg = bgOf(el);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < 3) contrast.push(`${label(el)} "${el.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
  }
  return { width: W, scrollWidth: document.documentElement.scrollWidth, background: getComputedStyle(document.body).backgroundColor, overflow, targets, contrast };
})()
