// The app's own modules that Ian uses, copied into this folder as .ts, so the deploy bundle and the
// nightly replay's scratch copy of this folder (it copies .ts files only) both carry them.
//   deno run --allow-read --allow-write shared/sync.ts
// Edit the source in circle/js, never these copies; concierge.test.ts fails when a copy has drifted.
export const SHARED: [string, string][] = [
  ['js/data/places.js', 'places.ts'],
  ['js/data/stays.js', 'stays.ts'],
  ['js/core/names.js', 'names.ts'],
  ['js/core/airline-links.js', 'airline-links.ts'],
];
const head = (src: string) => `// @ts-nocheck\n// GENERATED from circle/${src} by shared/sync.ts. Do not edit here: edit the source and run the sync.\n`;
export const render = async (src: string) => head(src) + await Deno.readTextFile(new URL(`../../../../${src}`, import.meta.url));

if (import.meta.main) {
  for (const [src, dst] of SHARED) await Deno.writeTextFile(new URL(`./${dst}`, import.meta.url), await render(src));
  console.log(`copied ${SHARED.length} modules`);
}
