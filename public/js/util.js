// Small DOM + formatting helpers (no dependencies).

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// ---- time / slot math -------------------------------------------------------
export function minutesToLabel(min, use24 = false) {
  let h = Math.floor(min / 60) % 24;
  const m = min % 60;
  if (use24) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ampm = h < 12 ? 'AM' : 'PM';
  let hh = h % 12; if (hh === 0) hh = 12;
  return m === 0 ? `${hh} ${ampm}` : `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function slotsPerDay(ev) {
  return Math.round((ev.timeEnd - ev.timeStart) / ev.slotMinutes);
}

// A slot index encodes (dateIndex, rowIndex). We lay slots out date-major.
export function decodeSlot(ev, slot) {
  const spd = slotsPerDay(ev);
  const dateIndex = Math.floor(slot / spd);
  const row = slot % spd;
  return { dateIndex, row, minute: ev.timeStart + row * ev.slotMinutes };
}
export function encodeSlot(ev, dateIndex, row) {
  return dateIndex * slotsPerDay(ev) + row;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function columnLabel(ev, dateIndex) {
  const val = ev.dates[dateIndex];
  if (ev.dateType === 'days') {
    const name = WEEKDAYS[Number(val)] ?? val;
    return { top: name.slice(0, 3), bottom: '' };
  }
  const d = new Date(val + 'T00:00:00');
  return {
    top: d.toLocaleDateString(undefined, { weekday: 'short' }),
    bottom: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
}

export function slotDateISO(ev, slot) {
  const { dateIndex } = decodeSlot(ev, slot);
  return ev.dateType === 'dates' ? ev.dates[dateIndex] : null;
}

export function slotFullLabel(ev, slot) {
  const { dateIndex, minute } = decodeSlot(ev, slot);
  const col = columnLabel(ev, dateIndex);
  const day = ev.dateType === 'days'
    ? (col.top)
    : `${col.top} ${col.bottom}`;
  return `${day}, ${minutesToLabel(minute)}–${minutesToLabel(minute + ev.slotMinutes)}`;
}

// ---- pace -------------------------------------------------------------------
export function paceToStr(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function strToPace(str) {
  const m = String(str).trim().match(/^(\d{1,2}):([0-5]?\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
export const KM_PER_MI = 1.609344;
export function convertPace(sec, fromUnit, toUnit) {
  if (sec == null || fromUnit === toUnit) return sec;
  return fromUnit === 'km' ? sec * KM_PER_MI : sec / KM_PER_MI;
}
// predicted time (seconds) for a distance in the event's unit
export function predictTime(paceSec, distanceUnits) {
  if (paceSec == null) return null;
  return paceSec * distanceUnits;
}
export function fmtDuration(sec) {
  if (sec == null) return '—';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- misc -------------------------------------------------------------------
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function relTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
export function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
}
export function toast(msg, kind = 'info') {
  let host = $('#toasts');
  if (!host) { host = el('div', { id: 'toasts' }); document.body.append(host); }
  const t = el('div', { class: `toast toast-${kind}`, text: msg });
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}
// WCAG-ish contrast: pick black/white text for a hex bg
export function textOn(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
}
