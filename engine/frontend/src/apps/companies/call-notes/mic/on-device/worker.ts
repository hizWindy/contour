/**
 * The Web Worker that runs the speech model (PLAN-V24 T4-1). tool.ts makes it, from our own site,
 * only when an on-device voice tool is made or got ready, so nothing of it is in the first visit.
 * The work is engine.ts's; this file only joins it to the real models and to the page.
 */

import { VoiceEngine, type FromEngine, type ToEngine } from './engine'
import { loadModels } from './models'

/** The parts of the worker's global scope used here (TypeScript's DOM types don't describe it). */
interface WorkerScope {
  postMessage: (message: FromEngine) => void
  onmessage: ((event: MessageEvent<ToEngine>) => void) | null
}

const scope = self as unknown as WorkerScope
const engine = new VoiceEngine(loadModels, (message) => scope.postMessage(message))
scope.onmessage = (event) => engine.take(event.data)
