// Issues a signed Apple Wallet pass for the member who asks for it.
//
// Why this exists on the server: a .pkpass is a zip whose contents are signed
// with a certificate Apple issues to the club. The private key for that
// certificate can never go in the browser, so the browser asks this function and
// this function does the signing.
//
// pass.json follows Apple's schema: six required top-level keys (formatVersion,
// passTypeIdentifier, serialNumber, teamIdentifier, organizationName, description)
// plus one style key. Colours are CSS rgb() triples, not hex. A store card with a
// square barcode shows up to three header fields, one primary field, and four
// secondary and auxiliary fields between them.
//
// Deploy:  supabase functions deploy issue-pass
// Secrets: supabase secrets set PASS_TYPE_ID=pass.aw.hunto.card \
//            TEAM_ID=XXXXXXXXXX \
//            PASS_CERT_P12_BASE64="$(base64 -i pass.p12)" \
//            PASS_CERT_PASSWORD=... \
//            WWDR_PEM="$(cat AppleWWDRCAG4.pem)"
// The intermediate for a Pass Type ID certificate is generation G4:
//   https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer  (valid to 2030-12-10)
//   openssl x509 -inform der -in AppleWWDRCAG4.cer -out AppleWWDRCAG4.pem
// The README in circle/ has the full walkthrough for getting those.

import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import JSZip from 'npm:jszip@3.10.1';
import forge from 'npm:node-forge@1.3.1';

const need = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`${k} is not set. The club has not finished setting up Wallet passes.`);
  return v;
};

const CORS = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const TIER_FINISH: Record<number, { bg: string; fg: string; label: string; name: string }> = {
  100: { bg: 'rgb(233,238,238)', fg: 'rgb(18,26,38)', label: 'rgb(92,106,111)', name: 'Watapana' },
  150: { bg: 'rgb(142,154,160)', fg: 'rgb(243,246,246)', label: 'rgb(233,238,238)', name: 'Fofoti' },
  200: { bg: 'rgb(19,27,39)', fg: 'rgb(228,180,31)', label: 'rgb(154,168,173)', name: 'Kibrahacha' },
};
const REACH: Record<string, string> = { aruba: 'Aruba', region: 'The region', world: 'Anywhere' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // The caller is the member: their own token decides whose pass this is.
    const auth = req.headers.get('authorization') ?? '';
    const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_ANON_KEY'), { global: { headers: { authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: 'Sign in first.' }, 401);

    const { data: member } = await sb.from('members').select('*').eq('auth_user_id', user.id).maybeSingle();
    if (!member) return json({ error: 'You are not an Insider.' }, 403);
    const { data: settings } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();

    const passTypeId = need('PASS_TYPE_ID');
    const teamId = need('TEAM_ID');
    const finish = TIER_FINISH[member.monthly_usd] ?? TIER_FINISH[100];
    const tiers = (settings?.tiers ?? []) as Array<Record<string, unknown>>;
    const reach = String((tiers.find((t) => Number(t.monthlyUsd) === member.monthly_usd)?.reach) ?? 'aruba');
    const site = Deno.env.get('CLUB_URL') ?? '';
    const clubName = settings?.club_name ?? 'Hunto';

    const pass = {
      formatVersion: 1,
      passTypeIdentifier: passTypeId,
      teamIdentifier: teamId,
      serialNumber: member.card_code ?? member.id,
      organizationName: clubName,
      description: `${clubName} membership card`,
      backgroundColor: finish.bg,
      foregroundColor: finish.fg,
      labelColor: finish.label,
      logoText: clubName.toUpperCase(),
      sharingProhibited: true,
      storeCard: {
        headerFields: [{ key: 'tier', label: 'Level', value: finish.name }],
        primaryFields: [{ key: 'name', label: 'Insider', value: member.name }],
        secondaryFields: [
          { key: 'since', label: 'Member since', value: String(new Date(member.joined_at).getFullYear()) },
          { key: 'code', label: 'Card', value: member.card_code ?? '' },
        ],
        auxiliaryFields: [
          { key: 'reach', label: 'Covers', value: REACH[reach] ?? 'Aruba' },
          ...(member.founding ? [{ key: 'founding', label: '', value: `Founding Insider · ${new Date(member.joined_at).getFullYear()}` }] : []),
        ],
        backFields: [
          { key: 'what', label: 'What this card is',
            value: `A membership card for ${clubName}, a private travel circle in Aruba. Show it to Victor or Ian; the code identifies you.` },
          { key: 'money', label: 'The money',
            value: `${Math.round(Number(settings?.service_rate ?? 0.15) * 100)}% of every contribution runs the Circle; the rest backs your points at ${settings?.points_per_dollar ?? 100} points to the dollar and stays yours.` },
          { key: 'leaving', label: 'Leaving',
            value: `Any time. Unused base points come back at face value minus $${settings?.exit_fee_usd ?? 25} after a twelve-month window.` },
          { key: 'legal', label: '',
            value: `${clubName} is a private members' club for prepaid, club-arranged travel. Points are not deposits and not an investment.` },
        ],
      },
      barcodes: [{
        format: 'PKBarcodeFormatQR',
        message: site ? `${site}#/circle?c=${encodeURIComponent(member.card_code ?? member.id)}` : (member.card_code ?? member.id),
        messageEncoding: 'iso-8859-1',
        altText: member.card_code ?? '',
      }],
    };

    // --- the bundle -------------------------------------------------------
    // Apple's sizes are in points: the icon is 38pt, the logo 50pt tall and at most
    // 160pt wide. Wallet requires an icon; the rest are optional but a pass without a
    // logo looks unfinished. Replace these flat fills with real artwork when there is some.
    const zip = new JSZip();
    const files: Record<string, Uint8Array> = {
      'pass.json': new TextEncoder().encode(JSON.stringify(pass)),
      'icon.png': solidPng(38, 38, finish.bg),
      'icon@2x.png': solidPng(76, 76, finish.bg),
      'icon@3x.png': solidPng(114, 114, finish.bg),
      'logo.png': solidPng(160, 50, finish.bg),
      'logo@2x.png': solidPng(320, 100, finish.bg),
      'logo@3x.png': solidPng(480, 150, finish.bg),
    };
    // manifest.json: the SHA-1 of every file in the bundle, which the signature covers
    const manifest: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(files)) manifest[name] = await sha1Hex(bytes);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

    for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
    zip.file('manifest.json', manifestBytes);
    zip.file('signature', signManifest(manifestBytes));

    const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Response(out, {
      headers: {
        ...CORS,
        'content-type': 'application/vnd.apple.pkpass',
        'content-disposition': `attachment; filename="${clubName.toLowerCase()}-${member.card_code ?? 'card'}.pkpass"`,
      },
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A detached PKCS#7 signature over manifest.json, in DER — what Wallet checks. */
function signManifest(manifestBytes: Uint8Array): Uint8Array {
  const p12Der = forge.util.decode64(need('PASS_CERT_P12_BASE64'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, need('PASS_CERT_PASSWORD'));

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const key = keyBags[0]?.key;
  if (!key) throw new Error('No private key in the pass certificate.');
  // the leaf certificate is the one whose public key matches the private key
  const cert = certBags.map((b) => b.cert).find((c) => c && c.publicKey &&
    forge.pki.publicKeyToPem(c.publicKey) === forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(key.n, key.e)));
  if (!cert) throw new Error('No matching certificate in the pass certificate file.');
  const wwdr = forge.pki.certificateFromPem(need('WWDR_PEM'));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(new TextDecoder().decode(manifestBytes), 'utf8');
  p7.addCertificate(cert);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key,
    certificate: cert,
    // Apple hashes the manifest with SHA-1 and expects the signature to match.
    digestAlgorithm: forge.pki.oids.sha1,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Uint8Array.from(der, (c) => (c as unknown as string).charCodeAt(0));
}

/**
 * A flat PNG in the card's own colour, so a pass looks right without the club
 * having to upload artwork. Replace these with real logo files when there are some.
 */
function solidPng(w: number, h: number, rgb: string): Uint8Array {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
  const raw: number[] = [];
  for (let y = 0; y < h; y++) { raw.push(0); for (let x = 0; x < w; x++) raw.push(r, g, b); }
  const idat = deflateStore(new Uint8Array(raw));
  const chunks = [
    chunk('IHDR', new Uint8Array([...be32(w), ...be32(h), 8, 2, 0, 0, 0])),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ];
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type);
  const body = concat([t, data]);
  return concat([new Uint8Array(be32(data.length)), body, new Uint8Array(be32(crc32(body)))]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
/** zlib stream with stored (uncompressed) deflate blocks — valid, and dependency-free. */
function deflateStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let i = 0; i < data.length; i += 65535) {
    const part = data.subarray(i, Math.min(i + 65535, data.length));
    const last = i + 65535 >= data.length ? 1 : 0;
    blocks.push(new Uint8Array([last, part.length & 255, part.length >>> 8, ~part.length & 255, (~part.length >>> 8) & 255]), part);
  }
  blocks.push(new Uint8Array(be32(adler32(data))));
  return concat(blocks);
}
function adler32(d: Uint8Array) { let a = 1, b = 0; for (const x of d) { a = (a + x) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(d: Uint8Array) { let c = 0xffffffff; for (const x of d) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
