// @vitest-environment node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/*
  scripts/voice-files.js, the build step that puts the speech model's files on our site
  (PLAN-V24 T4-1), run as the build runs it: a real process, against a made-up Hugging Face on
  this computer and a made-up runtime package. Made-up files only.
*/

const SCRIPT = resolve(import.meta.dirname, '../../../../../../scripts/voice-files.js')
const run = promisify(execFile)

const facts = (text: string) => ({
  bytes: Buffer.byteLength(text),
  sha256: createHash('sha256').update(text).digest('hex'),
})

/** What the made-up Hugging Face serves, by path. */
const HUB: Record<string, string> = {
  '/org/model/resolve/abc1234def/config.json': '{"model_type":"moonshine"}',
  '/org/model/resolve/abc1234def/onnx/model.onnx': 'weights '.repeat(2000),
  '/org/whisper/resolve/fff0000aaa/onnx/model.onnx': 'whisper weights',
}

let folder = ''
let server: Server
let hub = ''
let asked: string[] = []

interface Facts {
  bytes: number
  sha256: string
}

interface List {
  served: string
  runtime: { package: string; version: string; files: Record<string, Facts> }
  models: Record<
    string,
    { repo: string; revision: string; folder: string; for: string; files: Record<string, Facts> }
  >
}

/** The list, as files.json has it, with any changes; written where the script reads it. */
function list(change: (list: List) => void = () => undefined): string {
  const made = baseList()
  change(made)
  const path = join(folder, 'files.json')
  writeFileSync(path, JSON.stringify(made))
  return path
}

function baseList(): List {
  return {
    served: '/voice/',
    runtime: {
      package: 'onnxruntime-web',
      version: '9.9.9',
      files: { 'ort.wasm': facts('runtime') },
    },
    models: {
      model: {
        repo: 'org/model',
        revision: 'abc1234def',
        folder: 'model-abc1234',
        for: 'app',
        files: {
          'config.json': facts(HUB['/org/model/resolve/abc1234def/config.json'] ?? ''),
          'onnx/model.onnx': facts(HUB['/org/model/resolve/abc1234def/onnx/model.onnx'] ?? ''),
        },
      },
      whisper: {
        repo: 'org/whisper',
        revision: 'fff0000aaa',
        folder: 'whisper-fff0000',
        for: 's2',
        files: { 'onnx/model.onnx': facts('whisper weights') },
      },
    },
  }
}

const out = () => join(folder, 'public', 'voice')

/** Runs the script; gives its exit code and what it printed. */
async function fetchFiles(listPath: string, ...more: string[]) {
  const args = [SCRIPT, '--list', listPath, '--out', out(), '--hub', hub]
  try {
    const { stdout } = await run(process.execPath, [
      ...args,
      '--modules',
      join(folder, 'modules'),
      ...more,
    ])
    return { code: 0, output: stdout }
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string }
    return { code: failed.code, output: `${failed.stdout}${failed.stderr}` }
  }
}

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'voice-files-'))
  const runtime = join(folder, 'modules', 'onnxruntime-web')
  mkdirSync(join(runtime, 'dist'), { recursive: true })
  writeFileSync(join(runtime, 'package.json'), JSON.stringify({ version: '9.9.9' }))
  writeFileSync(join(runtime, 'dist', 'ort.wasm'), 'runtime')
  asked = []
  server = createServer((request, response) => {
    asked.push(request.url ?? '')
    const page = HUB[request.url ?? '']
    response.writeHead(page === undefined ? 404 : 200).end(page)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  hub = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise((done) => server.close(done))
  rmSync(folder, { recursive: true, force: true })
})

describe('scripts/voice-files.js', () => {
  it('fetches each listed file at its revision, checked, and a second build fetches nothing', async () => {
    const first = await fetchFiles(list())

    expect(first.code).toBe(0)
    expect(readFileSync(join(out(), 'model-abc1234', 'config.json'), 'utf8')).toBe(
      '{"model_type":"moonshine"}',
    )
    expect(existsSync(join(out(), 'model-abc1234', 'onnx', 'model.onnx'))).toBe(true)
    expect(asked).toEqual([
      '/org/model/resolve/abc1234def/config.json',
      '/org/model/resolve/abc1234def/onnx/model.onnx',
    ])

    const second = await fetchFiles(list())
    expect(second.code).toBe(0)
    expect(asked).toHaveLength(2)
    expect(second.output).toContain('kept model-abc1234/onnx/model.onnx')
  })

  it('fails on a wrong checksum, and leaves nothing of that file', async () => {
    const wrong = list((made) => {
      const model = made.models.model
      if (model) model.files['onnx/model.onnx'] = { bytes: 16000, sha256: '0'.repeat(64) }
    })

    const result = await fetchFiles(wrong)

    expect(result.code).toBe(1)
    expect(result.output).toContain('wrong checksum')
    expect(existsSync(join(out(), 'model-abc1234', 'onnx', 'model.onnx'))).toBe(false)
    expect(existsSync(join(out(), 'model-abc1234', 'onnx', 'model.onnx.part'))).toBe(false)
  })

  it('fetches again a file that changed on disk, and fails on a file Hugging Face has not got', async () => {
    await fetchFiles(list())
    writeFileSync(join(out(), 'model-abc1234', 'config.json'), '{"model_type":"changed"}')
    expect((await fetchFiles(list())).code).toBe(0)
    expect(readFileSync(join(out(), 'model-abc1234', 'config.json'), 'utf8')).toBe(
      '{"model_type":"moonshine"}',
    )

    const missing = list((made) => {
      const model = made.models.model
      if (model) model.files = { 'onnx/missing.onnx': facts('nothing') }
    })
    expect((await fetchFiles(missing)).code).toBe(1)
  })

  it('fails when the installed runtime is not the listed version, or not the listed file', async () => {
    const otherVersion = list((made) => {
      made.runtime.version = '9.9.10'
    })
    expect((await fetchFiles(otherVersion)).code).toBe(1)

    writeFileSync(join(folder, 'modules', 'onnxruntime-web', 'dist', 'ort.wasm'), 'changed runtime')
    const result = await fetchFiles(list())
    expect(result.code).toBe(1)
    expect(result.output).toContain('ort.wasm: wrong checksum')
    expect(asked).toEqual([])
  })

  it('leaves out the S2 test page models unless asked, and takes out files the list no longer names', async () => {
    const old = join(out(), 'model-0000000', 'config.json')
    mkdirSync(dirname(old), { recursive: true })
    writeFileSync(old, '{}')

    expect((await fetchFiles(list())).code).toBe(0)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(join(out(), 'whisper-fff0000'))).toBe(false)

    expect((await fetchFiles(list(), '--all')).code).toBe(0)
    expect(existsSync(join(out(), 'whisper-fff0000', 'onnx', 'model.onnx'))).toBe(true)
  })

  it('refuses a folder that is not the voice folder, so it never empties another one', async () => {
    const args = [SCRIPT, '--list', list(), '--out', join(folder, 'public'), '--hub', hub]
    await expect(run(process.execPath, args)).rejects.toMatchObject({ code: 1 })
  })
})
