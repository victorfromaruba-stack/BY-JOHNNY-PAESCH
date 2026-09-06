// Small, dependency-free helpers shared by every module.

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const nowIso = () => new Date().toISOString();

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A URL safe to put in an href. Empty string for anything else.
 *
 * escapeHtml stops a value breaking out of the attribute, but it does nothing about the scheme:
 * `javascript:…` survives it intact and becomes a working link. Deal links come in from the
 * paste parser, the email ingest and the watcher, so they are not ours to trust — and the one
 * place they are shown is a big "Go and book it" button in front of an officer.
 */
export function safeUrl(url) {
  const u = String(url ?? '').trim();
  return /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : '';
}

// Tagged template that escapes interpolations unless wrapped with raw().
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    const v = values[i - 1];
    const safe = v instanceof RawHtml ? v.value
      : Array.isArray(v) ? v.map(x => (x instanceof RawHtml ? x.value : escapeHtml(x))).join('')
      : v == null || v === false ? '' : escapeHtml(v);
    return out + safe + s;
  });
}
class RawHtml { constructor(value) { this.value = value; } }
export const raw = (value) => new RawHtml(value);

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdFmtCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-US');

export const fmtUsd = (n, cents = false) => (cents ? usdFmtCents : usdFmt).format(Number(n) || 0);
export const fmtInt = (n) => intFmt.format(Math.round(Number(n) || 0));
export const fmtAwg = (usd, rate = 1.79) => `Afl. ${intFmt.format(Math.round((Number(usd) || 0) * rate))}`;

export function fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...opts });
}
export function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function fmtMonth(yyyyMm) {
  if (!yyyyMm) return '—';
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
export function fmtRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return fmtDate(iso);
}
export const monthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
export function addMonths(yyyyMm, n) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}
export function nightsBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.max(0, Math.round(ms / 86400000));
}
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const by = (key, dir = 1) => (a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0);
export const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const pluralize = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function toCsv(rows, columns) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(c => esc(c.label)).join(','), ...rows.map(r => columns.map(c => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','))].join('\n');
}

// ---- Hunto formatting: every number is printed with its unit, and points
// always carry the dollar behind them. 100 points = $1.00.
export const fmtPoints = (n) => `✦ ${intFmt.format(Math.round(Number(n) || 0))}`;
export const fmtPointsUsd = (n, ppd = 100) => `✦ ${intFmt.format(Math.round(Number(n) || 0))} (${usdFmtCents.format((Number(n) || 0) / ppd)})`;
export const pointsUsd = (n, ppd = 100) => usdFmtCents.format((Number(n) || 0) / ppd);
export const fmtUsd2 = (n) => usdFmtCents.format(Number(n) || 0);
/** Aruban florin, written the local way: Afl. 268,50 */
export const fmtAfl2 = (usd, rate = 1.79) =>
  `Afl. ${new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(usd) || 0) * rate)}`;
export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDayTime = (iso) => (iso ? `${fmtDay(iso)} ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '—');
export const fmtPct = (n, dp = 1) => `${(Number(n) * 100).toFixed(dp)}%`;
/** "41h 12m" until an ISO instant; null once it has passed. */
export function countdownTo(iso) {
  const ms = new Date(iso) - Date.now();
  if (!(ms > 0)) return null;
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h >= 1 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
export const hoursUntil = (iso) => (new Date(iso) - Date.now()) / 3600000;
