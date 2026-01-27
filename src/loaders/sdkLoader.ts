import { IntemptConfig } from '../intemptJs/types/intemptJs.types.ts'
import { IntemptJs } from '../intemptJs/intemptJs.ts'
import { EnvConfig } from '../shared/envConfig.ts'

type QueuedCall = {
  method: string
  args: any[]
  timestamp?: number
}

function getIntemptConfig(): IntemptConfig {
  const cdnLink = EnvConfig.getCdnLink()
  const scripts = document.scripts

  const intemptScript = Array.from(scripts).find((s) => s.src.includes(cdnLink))
  if (!intemptScript) {
    console.error("CAN'T FIND SCRIPT")
    return {
      project: '',
      writeKey: '',
      sourceId: '',
      organization: '',
      shopify: false,
      magento: false,
    }
  }

  const source = new URL(intemptScript.src)
  return {
    project: source.searchParams.get('project') ?? '',
    writeKey: source.searchParams.get('key') ?? '',
    sourceId: source.searchParams.get('source') ?? '',
    organization: source.searchParams.get('organization') ?? '',
    shopify: !!source.searchParams.get('shopify'),
    magento: !!source.searchParams.get('magento'),
  }
}

/**
 * Extracts queued calls from stub if it exists
 * Checks multiple possible queue property names for compatibility
 */
function extractStubQueue(): QueuedCall[] | null {
  if (!window.intempt) return null

  const stub = window.intempt as any

  if (Array.isArray(stub._queue)) return stub._queue
  if (Array.isArray(stub._stubQueue)) return stub._stubQueue
  if (Array.isArray(stub.queue)) return stub.queue
  if (Array.isArray(stub.__queue)) return stub.__queue

  return null
}

/**
 * Extracts pending promises from stub if it exists
 */
function extractStubPromises(): any[] | null {
  if (!window.intempt) return null

  const stub = window.intempt as any
  if (Array.isArray(stub._pendingPromises)) return stub._pendingPromises

  return null
}

/**
 * Replays queued calls from stub on the real IntemptJs instance
 * Handles both sync and async methods, resolving promises for async calls.
 *
 * Important: For async `recommendation()` calls we resolve stub promises in FIFO order.
 * This is robust and avoids brittle JSON.stringify matching.
 */
function replayQueuedCalls(
  realIntempt: IntemptJs,
  queue: QueuedCall[],
  pendingPromises: any[] | null,
): void {
  if (!queue || queue.length === 0) return

  if (!EnvConfig.isProduction()) {
    console.log(`[Intempt] Replaying ${queue.length} queued calls from stub`)
  }

  for (const call of queue) {
    try {
      const fn = (realIntempt as any)[call.method]
      if (typeof fn !== 'function') {
        if (!EnvConfig.isProduction()) {
          console.warn(`[Intempt] Method ${call.method} not found on IntemptJs instance`)
        }
        continue
      }

      const result = fn.apply(realIntempt, call.args)

      // Handle async methods (recommendation returns Promise)
      if (result instanceof Promise) {
        let promiseInfo: any = null

        // Resolve stub promises for recommendation in the same order calls were queued.
        if (pendingPromises && call.method === 'recommendation') {
          if (pendingPromises.length > 0) {
            promiseInfo = pendingPromises.shift() // FIFO
          } else if (!EnvConfig.isProduction()) {
            console.warn('[Intempt] No pending promise found for recommendation call')
          }
        }

        if (promiseInfo?.resolve) {
          result
            .then((data: any) => promiseInfo.resolve(data))
            .catch((err: any) => {
              if (promiseInfo.reject) promiseInfo.reject(err)
              else console.error(`[Intempt] Error in async queued call ${call.method}:`, err)
            })
        } else {
          // No promise to resolve, just handle errors
          result.catch((err: any) => {
            console.error(`[Intempt] Error in async queued call ${call.method}:`, err)
          })
        }
      }
    } catch (error) {
      console.error(`[Intempt] Error replaying queued call ${call.method}:`, error)
    }
  }

  // Optional: clear extracted arrays to prevent accidental double-replay
  try {
    queue.length = 0
    if (pendingPromises) pendingPromises.length = 0
  } catch { }
}

function initSDK() {
  // Extract from stub BEFORE replacing window.intempt
  const stubQueue = extractStubQueue()
  const stubPromises = extractStubPromises()

  // Create real IntemptJs instance
  const realIntempt = new IntemptJs({ ...getIntemptConfig() })

    // Replace window.intempt with real instance
    ; (window as any).intempt = realIntempt

  // Replay queued calls if stub existed
  if (stubQueue && stubQueue.length > 0) {
    replayQueuedCalls(realIntempt, stubQueue, stubPromises)
  }

  if (!EnvConfig.isProduction()) {
    console.log('Intempt SDK initialized', (window as any).intempt)
  }
}

export const SDK = {
  init: initSDK,
}
