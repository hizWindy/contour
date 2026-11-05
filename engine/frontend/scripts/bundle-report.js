/**
 * Where the bytes of the website go (PLAN-V7 A3). It builds the site in memory (nothing is written
 * and `dist` is left alone) and prints:
 *
 *   1. the first visit: the main file and everything it loads at once, JavaScript and CSS;
 *   2. for each page, how many more bytes opening it adds on top of the first visit;
 *   3. for each of those, the libraries that take the most room;
 *   4. fonts and other files.
 *
 * Sizes are gzip, which is close to what Caddy sends (it also offers zstd). Raw sizes are in the
 * JSON. A change is judged by comparing two runs, not by the numbers alone.
 *
 *   node scripts/bundle-report.js                  # the tables
 *   node scripts/bundle-report.js --json out.json  # and the numbers as JSON
 */
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const result = await build({ logLevel: 'error', build: { write: false } })
const output = (Array.isArray(result) ? result : [result]).flatMap((one) => one.output)
const chunks = output.filter((item) => item.type === 'chunk')
const assets = output.filter((item) => item.type === 'asset')
const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))

const gzipOf = (data) => gzipSync(data).length
const sizes = new Map(
  chunks.map((chunk) => [
    chunk.fileName,
    { raw: Buffer.byteLength(chunk.code), gzip: gzipOf(chunk.code) },
  ]),
)
const assetSize = (asset) => {
  const data = typeof asset.source === 'string' ? Buffer.from(asset.source) : asset.source
  return {
    raw: data.length,
    gzip: /\.(css|svg|json|html)$/.test(asset.fileName) ? gzipOf(data) : data.length,
  }
}
const assetByFile = new Map(assets.map((asset) => [asset.fileName, assetSize(asset)]))

/** A chunk and every chunk it imports at once (static imports), not the ones loaded later. */
function closure(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  for (const next of byFile.get(file)?.imports ?? []) closure(next, seen)
  return seen
}

/** The CSS files that go with a set of chunks. */
function cssOf(files) {
  const css = new Set()
  for (const file of files) {
    for (const name of byFile.get(file)?.viteMetadata?.importedCss ?? []) css.add(name)
  }
  return css
}

const total = (files, pick) => [...files].reduce((sum, file) => sum + pick(file), 0)
const jsGzip = (files) => total(files, (file) => sizes.get(file)?.gzip ?? 0)
const jsRaw = (files) => total(files, (file) => sizes.get(file)?.raw ?? 0)
const cssGzip = (files) => total(files, (file) => assetByFile.get(file)?.gzip ?? 0)

/** The library a module belongs to: the last `node_modules/<name>` in its path, else `src`. */
function libraryOf(id) {
  const parts = id.replaceAll('\\', '/').split('node_modules/')
  if (parts.length < 2) return 'src'
  const [first, second] = parts.at(-1).split('/')
  return first.startsWith('@') ? `${first}/${second}` : first
}

function librariesOf(chunk, limit = 4) {
  const bySize = new Map()
  for (const [id, info] of Object.entries(chunk.modules ?? {})) {
    const name = libraryOf(id)
    bySize.set(name, (bySize.get(name) ?? 0) + (info.renderedLength ?? 0))
  }
  return [...bySize.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, bytes]) => `${name} ${kb(bytes)}`)
    .join(', ')
}

const kb = (bytes) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} kB`
const pad = (text, width) => String(text).padEnd(width)
const padLeft = (text, width) => String(text).padStart(width)

const entry = chunks.find((chunk) => chunk.isEntry)
const first = closure(entry.fileName)
const firstCss = cssOf(first)
const pageName = (chunk) =>
  (chunk.facadeModuleId ?? chunk.name)
    .replaceAll('\\', '/')
    .replace(/^.*\/src\//, '')
    .replace(/\.tsx?$/, '')

const pages = chunks
  .filter((chunk) => chunk.isDynamicEntry && !first.has(chunk.fileName))
  .map((chunk) => {
    const files = closure(chunk.fileName)
    const extra = new Set([...files].filter((file) => !first.has(file)))
    const css = new Set([...cssOf(extra)].filter((file) => !firstCss.has(file)))
    return {
      page: pageName(chunk),
      file: chunk.fileName,
      ownGzip: sizes.get(chunk.fileName).gzip,
      extraGzip: jsGzip(extra) + cssGzip(css),
      extraRaw: jsRaw(extra),
      libraries: librariesOf(chunk),
    }
  })
  .sort((a, b) => b.extraGzip - a.extraGzip)

const fonts = assets.filter((asset) => /\.(woff2?|ttf|otf)$/.test(asset.fileName))
const firstVisit = {
  jsGzip: jsGzip(first),
  jsRaw: jsRaw(first),
  cssGzip: cssGzip(firstCss),
  files: first.size,
}

console.log('FIRST VISIT (the main file and what it loads at once)')
console.log(
  `  JavaScript ${kb(firstVisit.jsGzip)} gzip (${kb(firstVisit.jsRaw)} raw) in ${first.size} files,` +
    ` CSS ${kb(firstVisit.cssGzip)} gzip. Main file: ${entry.fileName} ${kb(sizes.get(entry.fileName).raw)} raw.`,
)
console.log(`  Biggest libraries in it: ${librariesOf(entry, 8)}`)
console.log('')
console.log('OPENING A PAGE (extra bytes on top of the first visit, gzip)')
console.log(
  `  ${pad('page', 38)}${padLeft('extra', 9)}${padLeft('own file', 10)}  biggest libraries (raw)`,
)
for (const page of pages) {
  console.log(
    `  ${pad(page.page, 38)}${padLeft(kb(page.extraGzip), 9)}${padLeft(kb(page.ownGzip), 10)}  ${page.libraries}`,
  )
}
console.log('')
console.log(
  `FONTS: ${fonts.length} files, ${kb(fonts.reduce((sum, font) => sum + assetByFile.get(font.fileName).raw, 0))}`,
)
console.log(
  `ALL JAVASCRIPT: ${chunks.length} files, ${kb(jsGzip(chunks.map((chunk) => chunk.fileName)))} gzip` +
    ` (${kb(jsRaw(chunks.map((chunk) => chunk.fileName)))} raw)`,
)

const jsonAt = process.argv.indexOf('--json')
if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
  writeFileSync(
    process.argv[jsonAt + 1],
    JSON.stringify({ firstVisit, pages, fonts: fonts.length, files: chunks.length }, null, 2),
  )
}
