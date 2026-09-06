// WhatsApp deep links and native sharing. Aruba is WhatsApp-first, and all
// member communication runs through Ian, so every template is written in his voice.
import { fmtInt, fmtUsd, fmtMonth } from './util.js';

const digits = (phone = '') => String(phone).replace(/\D/g, '');
export const waLink = (phone, text) => `https://wa.me/${digits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const waShareLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export async function shareText({ title, text, url }) {
  if (navigator.share) { try { await navigator.share({ title, text, url }); return 'shared'; } catch { /* cancelled */ } }
  window.open(waShareLink(url ? `${text}\n${url}` : text), '_blank', 'noopener');
  return 'whatsapp';
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Message templates. `v` is the vocabulary object; `s` the settings. */
export const TEMPLATES = {
  transferSent: ({ member, amountUsd, month, reference }) =>
    `Hi Vishnu, I just transferred ${fmtUsd(amountUsd)} for ${fmtMonth(month)}. Reference: ${reference}. — ${member.name}`,
  confirmed: ({ member, amountUsd, points, month, v }) =>
    `${v.greeting} ${member.name.split(' ')[0]}! Vishnu confirmed your ${fmtUsd(amountUsd)} for ${fmtMonth(month)}. ${fmtInt(points)} ${v.points} are in your account. ${v.thanks}! — Ian`,
  reminder: ({ member, amountUsd, month, reference, v }) =>
    `Hi ${member.name.split(' ')[0]}, a friendly note from the ${v.clubName}: your ${fmtUsd(amountUsd)} for ${fmtMonth(month)} is due. Transfer to Vishnu with reference ${reference} and tap “I transferred” in the app. — Ian`,
  notMatched: ({ member, month, reason, v }) =>
    `Hi ${member.name.split(' ')[0]}, Vishnu couldn’t match your ${fmtMonth(month)} transfer yet: ${reason} Could you check and resend the details in the app? — Ian`,
  stayApproved: ({ member, stay, nights, checkIn, points, v }) =>
    `${v.congrats} ${member.name.split(' ')[0]}! Your ${nights}-night stay at ${stay.name} from ${checkIn} is approved. ${fmtInt(points)} ${v.points} are on hold while Victor confirms the booking. — Ian`,
  stayConfirmed: ({ member, stay, nights, checkIn, confirmationRef }) =>
    `Bon biaha, ${member.name.split(' ')[0]}! ${stay.name}, ${nights} nights from ${checkIn}, is booked. Confirmation ${confirmationRef}. Victor will send the details before you go. — Ian`,
  drop: ({ stay, points, v }) =>
    `This week’s drop from the ${v.clubName}: ${stay.name} (${stay.area}, ${stay.country}) from ${fmtInt(points)} ${v.points} a night. Requests in the app before Sunday. — Ian`,
};
