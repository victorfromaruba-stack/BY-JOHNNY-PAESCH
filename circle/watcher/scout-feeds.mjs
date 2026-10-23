// The deal scout's readers: RSS 2.0 and Atom into plain items. No network here; scout.mjs fetches.
// Regex, not an XML library: three feeds, one shape each, and a feed that changes shape yields
// zero items, which scout.mjs treats as a parse failure and stops posting from that source.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENT[n]);
const text = (s) => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();   // twice: Reddit double-encodes its HTML
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

/** [{ id, title, summary, link, published }] from an RSS or Atom document; [] for anything else. */
export function parseFeed(xml) {
  const out = [];
  const blocks = String(xml || '').match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const link = (b.match(/<link\b[^>]*\bhref="([^"]+)"/i) || [])[1] || text(tag(b, 'link'));
    const title = text(tag(b, 'title'));
    const id = text(tag(b, 'guid') || tag(b, 'id')) || link;
    if (!title || !link) continue;
    const when = text(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'));
    const t = Date.parse(when);
    out.push({ id, title, summary: text(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 600), link: decode(link), published: Number.isFinite(t) ? new Date(t).toISOString() : null });
  }
  return out;
}
