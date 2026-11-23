import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { applyPatch } from 'diff'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const upstreamRoot = path.dirname(require.resolve('pi-acp/package.json'))
const entry = path.join(upstreamRoot, 'dist/index.js')
const vendor = path.join(root, 'vendor/pi-acp')
const output = path.resolve(process.argv[2] ?? path.join(root, 'dist/node/adapters/pi-acp'))
const expected = JSON.parse(await readFile(path.join(vendor, 'upstream.json'), 'utf8'))
const upstream = JSON.parse(await readFile(path.join(upstreamRoot, 'package.json'), 'utf8'))
const original = await readFile(entry, 'utf8')
if (upstream.version !== expected.version || createHash('sha256').update(original).digest('hex') !== expected.sha256) {
  throw new Error('pi-acp upstream changed; review vendor/pi-acp/mcp.patch before rebuilding')
}
const patched = applyPatch(original, await readFile(path.join(vendor, 'mcp.patch'), 'utf8'), { fuzzFactor: 0 })
if (patched === false) throw new Error('Could not apply the Alto pi-acp MCP patch')

const extension = path.join(vendor, 'mcp-extension.ts')
const result = await build({
  entryPoints: { index: entry, 'mcp-extension': extension },
  outdir: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  metafile: true,
  legalComments: 'linked',
  banner: { js: "import { createRequire as altoCreateRequire } from 'node:module'; const require = altoCreateRequire(import.meta.url);" },
  plugins: [{
    name: 'alto-pi-mcp-patch',
    setup(builder) {
      builder.onLoad({ filter: /index\.js$/ }, (args) => args.path === entry
        ? { contents: patched, resolveDir: path.dirname(entry), loader: 'js' } : undefined)
      builder.onResolve({ filter: /^\.\/mcp-extension\.js$/ }, (args) => args.importer === entry
        ? { path: extension } : undefined)
    },
  }],
})

// Preserve notices for upstream and every dependency included in the bundle.
const packages = new Set([upstreamRoot])
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules')) continue
  let directory = path.dirname(path.resolve(input))
  while (directory !== path.dirname(directory)) {
    try {
      await readFile(path.join(directory, 'package.json'))
      packages.add(directory)
      break
    } catch { directory = path.dirname(directory) }
  }
}
const notices = []
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  let license
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try { license = await readFile(path.join(directory, name), 'utf8'); break } catch {}
  }
  if (!license) throw new Error(`Missing license notice for bundled dependency ${pkg.name}`)
  notices.push(`${pkg.name}@${pkg.version}\n${license}`)
}
await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.txt'), notices.join('\n\n'))
await writeFile(path.join(output, 'package.json'), JSON.stringify({ name: upstream.name, version: `${upstream.version}-alto.1`, type: 'module', private: true }) + '\n')
console.log(`Built Alto's patched pi-acp ${upstream.version}`)
