// The QR on the membership card. No CDN, no external script: js/ui/qrcode.js
// encodes it and we draw the modules ourselves, which is what lets the code be
// crisp (a whole number of pixels per module) and lets the same matrix be
// painted into the printable card.
import { drawQr } from './qrcode.js';

export function renderQr(el, text, { size = 220, dark = '#0B1220', light = '#FFFFFF' } = {}) {
  el.replaceChildren();
  try {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Membership QR code');
    el.appendChild(canvas);
    drawQr(canvas, text, { cssSize: size, dark, light });
    return true;
  } catch (err) {
    // Something is wrong with the data, not the network — say what it is.
    const code = document.createElement('code');
    code.className = 'qr-fallback';
    code.textContent = text;
    el.replaceChildren(code);
    console.warn('Could not draw the QR code', err);
    return false;
  }
}
