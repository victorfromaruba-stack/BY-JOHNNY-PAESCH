// QR rendering via qrcodejs 1.0.0 (MIT) from cdnjs, loaded on first use so the
// app shell stays dependency-free until a card is shown.
const URL_ = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const SRI = 'sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSQX0FslNhTDadL4O5SAGapGt4FodqL8My0mA==';
let loading;
export function loadQr() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = URL_; s.integrity = SRI; s.crossOrigin = 'anonymous'; s.async = true;
    s.onload = () => resolve(window.QRCode); s.onerror = () => reject(new Error('QR library did not load'));
    document.head.appendChild(s);
  });
  return loading;
}
/** Renders a QR into `el`. Falls back to the plain text if the library is unavailable (offline). */
export async function renderQr(el, text, { size = 148, dark = '#000000', light = '#ffffff' } = {}) {
  el.textContent = '';
  try {
    const QRCode = await loadQr();
    new QRCode(el, { text, width: size, height: size, colorDark: dark, colorLight: light, correctLevel: QRCode.CorrectLevel.M });
    el.querySelectorAll('img').forEach(i => { i.alt = 'Member QR code'; });
  } catch {
    // Offline, or the CDN is unreachable: show the link itself so it is still usable.
    const code = document.createElement('code');
    code.className = 'qr-fallback'; code.textContent = text;
    el.appendChild(code);
  }
}
