// One way to compare the name of a place.
//
// The same resort is spelled four ways across the things that have to agree on it: the bundled
// catalog ("Marriott’s Aruba Surf Club", curly apostrophe), the live database (whatever the Desk
// typed), RedWeek ("Marriott's Aruba Surf Club", straight apostrophe) and VakayMood. An exact
// string comparison between any two of those quietly fails, and a failed name match is never an
// error — it is a stay with no photograph, a live listing marked "not in our catalog yet", or a
// watcher find dropped on the floor. So every comparison goes through here.
//
// Deliberately DOM-free: the watcher on the VPS imports it under plain Node, the same way it
// already imports core/money.js.

/** Lower-case, no apostrophes, accents folded, "&" read as "and", punctuation and runs of space collapsed. */
export const normName = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[’'`]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

/** The same place, spelled however. */
export const sameName = (a, b) => {
  const x = normName(a), y = normName(b);
  return x !== '' && x === y;
};

/**
 * Does a longer piece of text name this place? For sources that give a heading rather than a
 * name — Interval's Getaway rows say "Aruba Marriott Resort & Stellaris Casino Palm Beach ·
 * ARUBA" in one run of text — an exact match never fires, and a contains match does.
 */
export const nameWithin = (text, name) => {
  const n = normName(name);
  return n !== '' && normName(text).includes(n);
};
