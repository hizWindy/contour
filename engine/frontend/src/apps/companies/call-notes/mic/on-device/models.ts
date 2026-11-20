/**
 * The real models, with Hugging Face's Transformers.js (PLAN-V24 T4-1, choice 23). Only worker.ts
 * imports this file, so the library loads inside the Web Worker, and only when the tool is made.
 *
 * - Moonshine turns a turn's sound into words: on the graphics chip (WebGPU) where the browser has
 *   one, else on the CPU. A model that won't start on WebGPU starts again on the CPU.
 * - Silero VAD is the voice detector: tiny, so always on the CPU.
 * Both use their 8-bit files (q8), the smallest ones (TBC at S2).
 */

import { AutoModel, env, LogLevel, pipeline, Tensor } from '@huggingface/transformers'
import type { Models, Progress } from './engine'
import {
  DETECTOR,
  filesFor,
  fromKept,
  keepFiles,
  keptFile,
  modelFolder,
  runtimeFor,
  SERVED,
  tidyKept,
  type Device,
  type ModelName,
} from './files'
import { padded, RATE } from './turns'

/** Silero's own wrapper puts the last 64 samples of the window before in front of each window. */
const CONTEXT = 64

/**
 * The quiet put on each side of a short turn (turns.ts, `padded`), per model: TBC at S2. Tried on
 * 21 Nov with Windows' two voices saying 16 short commands ("Send it.", "Later.", "Cancel.", "Stop
 * listening.", "That's all."): Moonshine Base heard 12 right with none, 16 with 300 ms or 500 ms;
 * Tiny heard 14 with none, but 12 with 300 ms and 10 with 500 ms (it wrote nothing for some).
 */
const PAD_MS: Record<ModelName, number> = {
  'moonshine-base': 300,
  'moonshine-tiny': 0,
  'whisper-base-en': 0,
}

/** Moonshine writes at most about 6 tokens a second of sound; more is a loop (its model card). */
const tokensFor = (samples: number): number => Math.ceil((samples / RATE) * 6.5) + 4

type Detector = (inputs: {
  input: Tensor
  sr: Tensor
  state: Tensor
}) => Promise<{ output: Tensor; stateN: Tensor }>

type Transcriber = (
  sound: Float32Array,
  options: { max_new_tokens: number },
) => Promise<{ text: string } | { text: string }[]>

/** Transformers.js reads only what this device keeps, and ONNX Runtime gets its WebAssembly. */
async function setUp(device: Device): Promise<void> {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = SERVED
  env.useBrowserCache = false
  env.useWasmCache = false
  env.fetch = fromKept
  env.logLevel = LogLevel.ERROR
  const wasm = env.backends.onnx.wasm
  if (!wasm) throw new Error('ONNX Runtime has no WebAssembly settings')
  const runtime = runtimeFor(device)
  const kept = await keptFile(runtime.wasm)
  if (!kept) throw new Error('the runtime is not kept')
  wasm.wasmBinary = await kept.arrayBuffer()
  // The GPU build's JavaScript is inside the library; the CPU build's comes from our own site.
  wasm.wasmPaths = runtime.glue ? { mjs: new URL(runtime.glue, self.location.href).href } : {}
  // One thread: more need the page to be cross-origin isolated, which ours isn't.
  wasm.numThreads = 1
  wasm.proxy = false
}

async function transcriber(model: ModelName, device: Device): Promise<Transcriber> {
  const made = (await pipeline('automatic-speech-recognition', modelFolder(model), {
    device,
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  })) as unknown as Transcriber
  // The first run is slow (shaders are built, the code warms up): do it now, on a second of quiet.
  await made(new Float32Array(RATE), { max_new_tokens: 2 })
  return made
}

/** A voice detector for one stream: its own memory of the sound so far. */
function detectorFrom(vad: Detector): () => (window: Float32Array) => Promise<number> {
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(RATE)]), [])
  return () => {
    let state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128])
    let context = new Float32Array(CONTEXT)
    return async (window) => {
      const input = new Float32Array(CONTEXT + window.length)
      input.set(context)
      input.set(window, CONTEXT)
      context = window.slice(-CONTEXT)
      const { output, stateN } = await vad({
        input: new Tensor('float32', input, [1, input.length]),
        sr,
        state,
      })
      state = stateN
      return Number(output.data[0] ?? 0)
    }
  }
}

export async function loadModels(
  model: ModelName,
  device: Device,
  onProgress: (progress: Progress) => void,
): Promise<Models> {
  await keepFiles(filesFor(model, device), onProgress)
  void tidyKept().catch(() => undefined)
  await setUp(device)
  const vad = (await AutoModel.from_pretrained(modelFolder(DETECTOR), {
    config: { model_type: 'custom' } as never,
    device: 'wasm',
    dtype: 'fp32',
  })) as unknown as Detector
  let used = device
  let asr: Transcriber
  try {
    asr = await transcriber(model, device)
  } catch (error) {
    if (device !== 'webgpu') throw error
    used = 'wasm'
    asr = await transcriber(model, 'wasm')
  }
  return {
    device: used,
    detector: detectorFrom(vad),
    words: async (turn) => {
      const sound = padded(turn, PAD_MS[model])
      const result = await asr(sound, { max_new_tokens: tokensFor(sound.length) })
      const first = Array.isArray(result) ? result[0] : result
      return first?.text.trim() ?? ''
    },
  }
}
