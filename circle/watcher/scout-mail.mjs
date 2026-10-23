// The deal scout's e-mail: what it says, who it may go to, and the SMTP conversation.
//
// SHADOW MODE (default on): the only address anything can be sent to is Victor's own. The guard is in
// sendMail itself, so no caller can get past it; members' addresses are not used in v1 at all.
// The app password is read by the caller (scout.mjs) from the locked box and handed in; it is never logged.

import net from 'node:net';
import tls from 'node:tls';

export const VICTOR = 'victorfromaruba@gmail.com';

/** Throws unless `to` may receive scout mail. Shadow: Victor only, exactly. */
export function assertRecipient(to, shadow = true) {
  const list = [].concat(to);
  if (!list.length) throw new Error('no recipient');
  if (shadow && list.some((a) => String(a).trim().toLowerCase() !== VICTOR)) throw new Error(`shadow mode: scout mail goes only to ${VICTOR}, refused ${list.join(', ')}`);
  return list;
}

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', ...(iso.slice(0, 4) === new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC' });
const arubaStamp = (ms) => new Date(ms - 4 * 3600e3).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
const SOURCE_NAME = { vakaymood: 'VakayMood', travelzoo: 'Travelzoo', holidaypirates: 'HolidayPirates', secretflying: 'Secret Flying' };

/** One deal as a short paragraph. `d` is a state item with its find; `seenMs` is when the scout last saw it. */
export function dealParagraph(d) {
  const f = d.find;
  const trap = f.source === 'vakaymood'
    ? (f.fees > 0 ? `Includes ${usd(f.fees)} of fees. Resort fees at the desk can add to it.` : 'An owner renting the week. Resort fees paid at the desk are not always in the price.')
    : 'Check that taxes and resort fees are in that price before you count on it.';
  return [
    `${f.resortName}, ${f.nights} nights, ${day(f.from)} to ${day(f.to)}${f.unit && f.source === 'vakaymood' ? ` (${f.unit})` : ''}`,
    `${usd(f.usdTotal)} for the stay, ${usd(f.usdNightly)} a night, against ${usd(f.retailPrice)} at the public rate. ${Math.round(d.pct * 100)}% under.`,
    `From ${SOURCE_NAME[d.src] || d.src}, last seen ${arubaStamp(d.last)} Aruba time. That was then: it has to be checked again before anyone acts on it.`,
    f.ourPrice && f.ourPrice < f.usdTotal ? `For those nights the Circle's own rate is ${usd(f.ourPrice)}, which is lower, so this is under the public rate but not a bargain for us.` : '',
    trap, d.url || f.url,
  ].filter(Boolean).join('\n');
}

const FOOT = '\nThis is the scout in test mode, so it is only coming to you. To stop these, tell Victor or reply "stop".';

export function digestMail(deals, now = Date.now()) {
  const great = deals.filter((d) => d.cls === 'great').length;
  return {
    subject: `Circle deal scout: ${deals.length} worth a look, ${day(new Date(now - 4 * 3600e3).toISOString().slice(0, 10))}`,
    text: `${deals.length} deal${deals.length === 1 ? '' : 's'} the scout found since the last note${great ? `, ${great} of them well under the public rate` : ''}.\n\n${deals.map(dealParagraph).join('\n\n')}\n${FOOT}\n`,
  };
}
export function instantMail(d) {
  return { subject: `Circle deal: ${d.find.resortName}, ${day(d.find.from)} to ${day(d.find.to)}, ${Math.round(d.pct * 100)}% under public`, text: `A big one.\n\n${dealParagraph(d)}\n${FOOT}\n` };
}

/** SMTP over TLS (Gmail, port 465). Returns { subject, log } where log is the server's side of the conversation, password never in it. */
export async function sendMail({ to, subject, text, from = VICTOR, pass, shadow = true, host = 'smtp.gmail.com', port = 587, connect = (h, p) => net.connect(p, h), upgrade = (s, h) => tls.connect({ socket: s, servername: h }) }) {
  assertRecipient(to, shadow);
  subject = subject.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  if (/[\r\n]/.test(subject) || /[^\x20-\x7e]/.test(subject)) throw new Error('subject must be plain ASCII on one line');
  const log = [];
  // Port 587 with STARTTLS: this server's outbound 465 times out (checked 23 Oct 2026).
  let sock = connect(host, port), buf = '';
  const waiters = [];
  const attach = (x) => {
    x.setTimeout(30000, () => x.destroy(new Error('SMTP timed out')));
    x.on('data', (c) => { buf += c; flush(); });
    x.on('error', (e) => { while (waiters.length) waiters.shift().rej(e); });
  };
  attach(sock);
  const flush = () => {
    const m = buf.match(/(?:^|\n)(\d{3}) [^\n]*\r?\n/);          // a final line: "250 text", not "250-text"
    if (m && waiters.length) { const end = m.index + m[0].length; const reply = buf.slice(0, end); buf = buf.slice(end); log.push(`S: ${reply.trim().replace(/\r?\n/g, ' | ')}`); waiters.shift().res({ code: +m[1], reply }); }
  };
  const reply = () => new Promise((res, rej) => { waiters.push({ res, rej }); flush(); });
  const say = async (line, secret) => { sock.write(`${line}\r\n`); log.push(`C: ${secret ? '(hidden)' : line}`); return reply(); };
  const ok = (r, ...codes) => { if (!codes.includes(r.code)) throw new Error(`SMTP said ${r.reply.trim().slice(0, 120)}`); };
  try {
    ok(await reply(), 220);
    ok(await say('EHLO circle-scout'), 250);
    ok(await say('STARTTLS'), 220);
    sock.removeAllListeners('data'); sock = upgrade(sock, host); buf = ''; attach(sock);
    ok(await say('EHLO circle-scout'), 250);
    ok(await say(`AUTH PLAIN ${Buffer.from(`\0${from}\0${pass}`).toString('base64')}`, true), 235);
    ok(await say(`MAIL FROM:<${from}>`), 250);
    for (const a of [].concat(to)) ok(await say(`RCPT TO:<${a}>`), 250, 251);
    ok(await say('DATA'), 354);
    const body = Buffer.from(text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/(.{76})/g, '$1\r\n');
    const msg = [`From: Inner Hotel Circle deal scout <${from}>`, `To: ${[].concat(to).join(', ')}`, `Subject: ${subject}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <scout.${Date.now()}.${Math.random().toString(36).slice(2)}@circle>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
    sock.write(`${msg}\r\n.\r\n`); log.push('C: (message body, base64)');
    ok(await reply(), 250);
    await say('QUIT').catch(() => {});
    return { subject, log };
  } finally { sock.destroy(); }
}
