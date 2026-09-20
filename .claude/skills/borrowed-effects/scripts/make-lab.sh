#!/bin/sh
# Build the viewing room: a throwaway Vite + React + Tailwind project where a component from
# Aceternity, 21st.dev or shadcn can be installed and watched running.
#
# You need this only for an effect you cannot read off the .tsx — a canvas, a WebGL shader, a
# physics loop, or anything whose behaviour you would otherwise be guessing at. Most ports never
# need it: borrow.mjs prints the source and the Tailwind mapping, and that is usually enough.
#
# The folder is gitignored and nothing in it ships. It is a viewing room, not a source directory:
# ported code lands in circle/css/app.css and, when it truly needs behaviour, circle/js/ui/.
# Delete it when you are done — it is about 150 MB and this container is rebuilt from git anyway.
#
#   sh .claude/skills/borrowed-effects/scripts/make-lab.sh [dir]     default: aceternity-lab
#   cd <dir> && node add.mjs <slug> && npm run dev
#
# The lab comes with its own two-line installer, add.mjs, which reads Aceternity's public registry
# and writes the files into src/components/ui/. It exists because `npx shadcn@latest add <url>`
# hangs at "Checking registry" behind this sandbox's proxy, while plain fetch to the same URL
# answers 200 — on an unproxied machine shadcn works too, but there is no reason to depend on it.

set -eu

DIR="${1:-aceternity-lab}"
if [ -e "$DIR" ]; then
  echo "$DIR already exists — delete it first, or pass another name." >&2
  exit 1
fi

mkdir -p "$DIR"
cd "$DIR"

echo "==> scaffolding Vite + React + TypeScript"
npm create vite@latest . -- --template react-ts --yes >/dev/null

echo "==> installing"
npm install >/dev/null
npm install tailwindcss @tailwindcss/vite clsx tailwind-merge >/dev/null

echo "==> wiring Tailwind, the @/ alias and cn()"
mkdir -p src/lib

cat > vite.config.ts <<'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
})
EOF

printf '@import "tailwindcss";\n' > src/index.css

cat > src/lib/utils.ts <<'EOF'
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
EOF

# shadcn reads this to know where components go. Without it, every install stops to ask.
cat > components.json <<'EOF'
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
EOF

# The path alias. baseUrl is deprecated in TypeScript 7 and errors the build, so paths alone.
# Vite's template also sets noUnusedLocals/noUnusedParameters, which fail on vendored components
# (meteors leaves a React import and a map index unused). A viewing room does not lint other
# people's code — turn them off so a component you did not write still compiles.
python3 - <<'PY'
import re
s = open('tsconfig.app.json').read()
if '"paths"' not in s:
    s = re.sub(r'"compilerOptions"\s*:\s*\{',
               '"compilerOptions": {\n    "paths": { "@/*": ["./src/*"] },', s, count=1)
s = re.sub(r'"noUnusedLocals"\s*:\s*true', '"noUnusedLocals": false', s)
s = re.sub(r'"noUnusedParameters"\s*:\s*true', '"noUnusedParameters": false', s)
open('tsconfig.app.json', 'w').write(s)
s = open('tsconfig.json').read()
if '"paths"' not in s:
    s = re.sub(r'\{', '{\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },', s, count=1)
    open('tsconfig.json', 'w').write(s)
PY

echo "==> writing add.mjs, the lab's own installer"
cat > add.mjs <<'EOF'
// Install a component from Aceternity's public registry into this lab.
//   node add.mjs <slug> [<slug>...]
// Reads https://ui.aceternity.com/registry/<slug>.json and writes files[] under src/.
// Nothing here ships: this is a viewing room. The port goes into circle/css/app.css by hand.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const slugs = process.argv.slice(2)
if (!slugs.length) { console.error('usage: node add.mjs <slug> [<slug>...]'); process.exit(1) }

let failed = 0
for (const slug of slugs) {
  const url = `https://ui.aceternity.com/registry/${slug}.json`
  let res
  try { res = await fetch(url, { headers: { accept: 'application/json' } }) }
  catch (e) { console.error(`${slug}: could not reach the registry — ${e.message}`); failed++; continue }
  if (!res.ok) {
    // 401 here means "not yours, or not a thing" — the registry answers the same either way,
    // so check the spelling on ui.aceternity.com before concluding it is paid.
    console.error(`${slug}: HTTP ${res.status} — wrong slug, or a Pro component. Check the spelling first.`)
    failed++; continue
  }
  const reg = await res.json()
  const sources = []
  for (const f of reg.files ?? []) {
    const out = join('src', f.path.replace(/^components\//, 'components/'))
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, f.content)
    sources.push(f.content)
    console.log(`  wrote ${out}`)
  }
  // The registry's `dependencies` field under-reports: meteors declares none and imports
  // motion/react. Read the imports instead — that is what the compiler will demand.
  const imported = new Set()
  for (const src of sources) {
    for (const m of src.matchAll(/(?:from|import)\s+["']([^"'.][^"']*)["']/g)) {
      const pkg = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
      if (pkg !== 'react' && !pkg.startsWith('@/')) imported.add(pkg)
    }
  }
  const declared = new Set((reg.dependencies ?? []).filter((d) => d !== 'react'))
  const all = [...new Set([...imported, ...declared])]
  if (all.length) {
    console.log(`  ${slug} needs: ${all.join(' ')}`)
    const missed = all.filter((d) => !declared.has(d))
    if (missed.length) console.log(`  (the registry did not declare ${missed.join(', ')} — it under-reports)`)
    console.log(`  npm install ${all.join(' ')}`)
  }
}
process.exit(failed ? 1 : 0)
EOF

echo "==> checking it builds"
npm run build >/dev/null

cat <<EOF

The viewing room is ready in $DIR.

  cd $DIR
  node add.mjs <slug>      # e.g. meteors — writes it into src/components/ui/
  npm run dev

Nothing here ships. Delete the folder when you are done looking.
EOF
