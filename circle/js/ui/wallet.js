// The membership card, in the forms a phone understands.
//
// Apple Wallet passes must be cryptographically signed with a certificate that
// Apple issues to a paid developer account. That signing cannot happen in a
// browser — the private key would be sitting in the page — so the club signs
// passes in a Supabase Edge Function (see supabase/functions/issue-pass). Until
// the club has that certificate, everything else here still works: the QR any
// camera reads, and a card image the member can save or send.

import { VOCAB, tierName } from '../core/vocab.js';
import { fmtDay } from '../core/util.js';
import { paintQr } from './qrcode.js';

/**
 * The pass, as data. The Edge Function signs exactly this shape, and the card on
 * screen is drawn from the same values, so the two can never disagree.
 */
export function passPayload(member, store) {
  const s = store.settings;
  const lt = store.lifetime(member.id);
  const finish = { 100: { bg: 'rgb(233,238,238)', fg: 'rgb(18,26,38)', label: 'rgb(92,106,111)' },
                   150: { bg: 'rgb(142,154,160)', fg: 'rgb(243,246,246)', label: 'rgb(233,238,238)' },
                   200: { bg: 'rgb(19,27,39)', fg: 'rgb(228,180,31)', label: 'rgb(154,168,173)' } }[member.monthlyUsd];
  return {
    formatVersion: 1,
    organizationName: VOCAB.clubName,
    description: `${VOCAB.clubName} membership card`,
    serialNumber: member.cardCode || member.id,
    backgroundColor: finish.bg,
    foregroundColor: finish.fg,
    labelColor: finish.label,
    logoText: VOCAB.wordmark,
    storeCard: {
      headerFields: [{ key: 'tier', label: 'Level', value: tierName(member.monthlyUsd) }],
      primaryFields: [{ key: 'name', label: 'Insider', value: member.name }],
      secondaryFields: [
        { key: 'since', label: 'Member since', value: String(new Date(member.joinedAt).getFullYear()) },
        { key: 'code', label: 'Card', value: member.cardCode || '' },
      ],
      auxiliaryFields: [
        { key: 'earning', label: 'Earning', value: `${Math.round(member.monthlyUsd * s.pointsPerDollar).toLocaleString('en-US')} a month` },
        ...(member.founding ? [{ key: 'founding', label: '', value: VOCAB.founding }] : []),
      ],
      backFields: [
        { key: 'points', label: 'Points held when this pass was made', value: `${lt.available.toLocaleString('en-US')} · $${(lt.available / s.pointsPerDollar).toFixed(2)}` },
        { key: 'howto', label: 'What this card is', value: `A membership card for ${VOCAB.clubName}, a private travel circle in Aruba. Show it to Victor or Ian; the code identifies you.` },
        { key: 'money', label: 'The money', value: `Every dollar backs a point at ${s.pointsPerDollar} to the dollar and stays yours. The Circle's ${Math.round(s.serviceRate * 100)}% is charged on a room when you book one, never on the money going in.` },
        { key: 'leaving', label: 'Leaving', value: `Any time. Unused base points come back at face value minus $${s.exitFeeUsd} after a twelve-month window.` },
        { key: 'legal', label: '', value: VOCAB.legal },
      ],
    },
    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: cardUrl(member),
      messageEncoding: 'iso-8859-1',
      altText: member.cardCode || '',
    }],
  };
}

/** What the QR points at: a page that identifies the member to whoever scans it. */
export function cardUrl(member) {
  return `${location.origin}${location.pathname}#/circle?c=${encodeURIComponent(member.cardCode || member.id)}`;
}

/**
 * Draws the card face at print resolution so a member can save it to their photos
 * or send it to Ian. Deliberately carries no balance — the card face never does.
 */
export function cardImage(member, { scale = 3, withQr = true } = {}) {
  const W = 1012, H = 638;                     // 85.6 × 53.98 mm at ~300dpi
  const c = document.createElement('canvas');
  c.width = W * (scale / 3); c.height = H * (scale / 3);
  const x = c.getContext('2d');
  const finish = { 100: ['#E9EEEE', '#121A26', 'rgba(18,26,38,.16)'],
                   150: ['#8E9AA0', '#F3F6F6', 'rgba(255,255,255,.22)'],
                   200: ['#131B27', '#E4B41F', 'rgba(228,180,31,.26)'] }[member.monthlyUsd] || ['#E9EEEE', '#121A26', 'rgba(18,26,38,.16)'];
  const [bg, ink, line] = finish;
  const k = c.width / W;
  x.save(); x.scale(k, k);
  x.fillStyle = bg; x.fillRect(0, 0, W, H);

  // the same bathymetric contours that are etched on the card in the app
  let seed = 2166136261;
  for (let i = 0; i < member.id.length; i++) { seed ^= member.id.charCodeAt(i); seed = Math.imul(seed, 16777619); }
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  x.strokeStyle = line; x.lineWidth = 2;
  for (let i = 0; i < 13; i++) {
    const baseY = (H / 13) * i + 24, amp = 10 + rand() * 34, freq = 0.004 + rand() * 0.005, phase = rand() * 6.28;
    x.beginPath();
    for (let px = 0; px <= W; px += 8) x.lineTo(px, baseY + Math.sin(px * freq + phase) * amp);
    x.stroke();
  }
  // the QR, on white, so a printed card is scannable without the app
  let qrRoom = 0;
  if (withQr) {
    const box = 210, pad = 40;
    const drawn = paintQr(x, cardUrl(member), { x: W - box - pad, y: (H - box) / 2, box, quiet: 4, dark: '#0B1220', light: '#FFFFFF' });
    qrRoom = drawn + pad;
  }
  x.fillStyle = ink;
  x.font = '700 34px Archivo, system-ui, sans-serif';
  x.letterSpacing = '6px';
  x.fillText(VOCAB.wordmark, 56, 84);
  x.letterSpacing = '2px';
  x.font = '500 22px "Instrument Sans", system-ui, sans-serif';
  x.globalAlpha = 0.85;
  x.fillText(tierName(member.monthlyUsd).toUpperCase(), W - 56 - x.measureText(tierName(member.monthlyUsd).toUpperCase()).width, 84);
  x.globalAlpha = 1;
  x.letterSpacing = '0px';
  x.font = '600 68px Archivo, system-ui, sans-serif';
  // keep the name clear of the QR block
  let nameSize = 68;
  while (x.measureText(member.name).width > W - 112 - qrRoom && nameSize > 32) {
    nameSize -= 2; x.font = `600 ${nameSize}px Archivo, system-ui, sans-serif`;
  }
  x.fillText(member.name, 56, H - 132);
  x.globalAlpha = 0.8;
  x.font = '400 24px "Instrument Sans", system-ui, sans-serif';
  x.fillText(`Insider since ${new Date(member.joinedAt).getFullYear()}`, 56, H - 68);
  if (member.founding) {
    const t = VOCAB.founding;
    x.fillText(t, W - 56 - x.measureText(t).width, H - 68);
  }
  x.restore();
  return new Promise(resolve => c.toBlob(resolve, 'image/png'));
}

/**
 * Asks the club's server for a signed Apple Wallet pass. Returns null when the
 * club has not set up a pass certificate yet, so the caller can say so plainly
 * rather than handing the member a broken download.
 */
export async function fetchApplePass(store, member) {
  const cfg = store.walletConfig?.();
  if (!cfg?.url) return null;
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify({ memberId: member.id }),
  });
  if (!res.ok) throw new Error(`The pass service answered ${res.status}. Ask Ian to check it.`);
  const blob = await res.blob();
  if (blob.type && !blob.type.includes('pkpass')) throw new Error('That did not come back as a Wallet pass.');
  return blob;
}

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
