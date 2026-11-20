/**
 * Puts the files of the speech model that runs on a phone or laptop (PLAN-V24 T4-1) on our own site,
 * and checks each one. `npm run build` runs it before Vite, so every build (on this laptop, in Docker
 * and on App Platform) serves them under /voice/. They are never in git (.gitignore): each build
 * fetches them again, at the fixed version in src/apps/companies/call-notes/mic/on-device/files.json.
 *
 * For each model file in that list:
 *   - already there with the right size and sha256: kept as it is;
 *   - missing, or different: downloaded from Hugging Face at the fixed revision (a commit hash, so the
 *     file can't change under that name), checked, then put in place;
 *   - a wrong sha256 after the download: the script stops with an error, so the build fails. A file
 *     that isn't checked is never left in the folder.
 * A file in the folder that the list doesn't name is removed, so an old version is never served.
 *
 * The runtime (ONNX Runtime's WebAssembly, from the onnxruntime-web package that
 * @huggingface/transformers brings) is not copied here: Vite serves it from node_modules, as files
 * under /assets/. The script checks that the installed package is the version in the list, and that
 * its files have the listed sha256, so a changed package-lock.json can't change the runtime silently.
 *
 *   node scripts/voice-files.js          # the app's: Moonshine Base and Tiny, and the voice detector
 *   node scripts/voice-files.js --all    # and the ones only the S2 test page uses (Whisper base)
 *
 * For tests: --list <file>, --out <folder>, --hub <address> and --modules <folder>.
 */
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { once } from 'node:events'

const here = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}

const LIST = option('--list', join(here, 'src/apps/companies/call-notes/mic/on-device/files.json'))
const OUT = resolve(option('--out', join(here, 'public/voice')))
const HUB = option('--hub', 'https://huggingface.co')
const MODULES = option('--modules', join(here, 'node_modules'))
const ALL = args.includes('--all')

/** A download that stalls or is cut off is tried again, this many times in all. */
const TRIES = 3
/** One file may take this long to download (the biggest is about 54 MB). */
const TIMEOUT_MS = 10 * 60 * 1000

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`
const say = (line) => console.log(`voice-files: ${line}`)

class Wrong extends Error {}

/** The size and sha256 of a file on disk, read as a stream (the biggest are tens of MB). */
async function factsOf(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { bytes: (await stat(path)).size, sha256: hash.digest('hex') }
}

const same = (facts, want) => facts.bytes === want.bytes && facts.sha256 === want.sha256

/**
 * Downloads one file to `part`, hashing it on the way. A dropped connection, a server error or a
 * wrong size is tried again; a wrong hash or a missing file isn't.
 */
async function download(url, part, want) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      // A file the hub hasn't got (4xx) won't come by trying again: the list is wrong.
      if (response.status >= 400 && response.status < 500)
        throw new Wrong(`${url}: ${response.status}`)
      if (!response.ok || !response.body) throw new Error(`the server answered ${response.status}`)
      const hash = createHash('sha256')
      const file = createWriteStream(part)
      let bytes = 0
      for await (const chunk of response.body) {
        hash.update(chunk)
        bytes += chunk.length
        if (!file.write(chunk)) await once(file, 'drain')
      }
      file.end()
      await once(file, 'finish')
      if (bytes !== want.bytes) throw new Error(`got ${bytes} bytes, not ${want.bytes}`)
      const sha256 = hash.digest('hex')
      if (sha256 !== want.sha256)
        throw new Wrong(`wrong checksum: sha256 ${sha256}, not ${want.sha256}`)
      return
    } catch (error) {
      await rm(part, { force: true })
      if (error instanceof Wrong || attempt >= TRIES) throw error
      say(`try ${attempt} failed (${error.message}), trying again`)
      await new Promise((done) => setTimeout(done, 2000 * attempt))
    }
  }
}

/** The installed runtime must be the listed version, file for file. */
async function checkRuntime(runtime) {
  const folder = join(MODULES, runtime.package)
  const installed = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')).version
  if (installed !== runtime.version) {
    throw new Wrong(`${runtime.package} is ${installed}, but files.json lists ${runtime.version}`)
  }
  for (const [name, want] of Object.entries(runtime.files)) {
    const path = join(folder, 'dist', name)
    if (!existsSync(path) || !same(await factsOf(path), want)) {
      throw new Wrong(`${runtime.package}/dist/${name}: wrong checksum`)
    }
  }
  say(`runtime ${runtime.package} ${runtime.version} checked`)
}

/** Every file under a folder, as paths relative to it. */
function filesUnder(folder) {
  if (!existsSync(folder)) return []
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
}

async function main() {
  // The folder is emptied of anything the list doesn't name, so it must be the voice folder.
  if (basename(OUT) !== 'voice') throw new Error(`${OUT} is not a folder named voice`)
  const list = JSON.parse(await readFile(LIST, 'utf8'))
  await checkRuntime(list.runtime)

  const models = Object.values(list.models).filter((model) => ALL || model.for === 'app')
  const wanted = new Set()
  let fetched = 0
  for (const model of models) {
    for (const [path, want] of Object.entries(model.files)) {
      const name = join(model.folder, path)
      const target = join(OUT, name)
      wanted.add(name)
      if (existsSync(target) && same(await factsOf(target), want)) {
        say(`kept ${name.replaceAll(sep, '/')} (${mb(want.bytes)})`)
        continue
      }
      mkdirSync(dirname(target), { recursive: true })
      const part = `${target}.part`
      await download(`${HUB}/${model.repo}/resolve/${model.revision}/${path}`, part, want)
      await rename(part, target)
      fetched += want.bytes
      say(`fetched ${name.replaceAll(sep, '/')} (${mb(want.bytes)})`)
    }
  }

  // Anything else in the folder is an old version, or a half download: it goes.
  for (const name of filesUnder(OUT)) {
    if (!wanted.has(name)) rmSync(join(OUT, name), { force: true })
  }
  const total = models
    .flatMap((model) => Object.values(model.files))
    .reduce((sum, f) => sum + f.bytes, 0)
  say(
    `${models.length} models, ${mb(total)} in ${relative(here, OUT) || OUT}, ${mb(fetched)} fetched`,
  )
}

try {
  await main()
} catch (error) {
  console.error(`voice-files: ${error.message}`)
  process.exitCode = 1
}
