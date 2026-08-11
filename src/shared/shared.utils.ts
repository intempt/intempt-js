import { IdType } from '../intemptJs/types/intemptJs.types.ts';

const ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Random suffix for an id.
 *
 * The previous implementation filled 8 of these 10 characters with a *shuffle of
 * the timestamp's own base-36 digits*, so two ids minted in the same millisecond
 * differed only by a permutation of identical characters plus two random ones —
 * a few thousand possibilities. A tight loop collides, and these ids identify
 * profiles and sessions: a collision merges two visitors' data. At the 1M
 * events/sec operating point, same-millisecond id generation across the fleet is
 * continuous, not rare.
 *
 * `crypto.getRandomValues` where available, `Math.random` only as a fallback for
 * environments without it. The id *shape* is unchanged
 * (`<base36-ts>_<ms>_<10 chars>`), so anything parsing it keeps working.
 */
function randomSuffix(length: number): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  let id = '';

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      id += ID_ALPHABET.charAt(bytes[i] % ID_ALPHABET.length);
    }
    return id;
  }

  for (let i = 0; i < length; i++) {
    id += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
  }
  return id;
}

function generateUniqueId() {
  const timestampNum = new Date().getTime();
  const timestamp = timestampNum.toString(36);

  return `${timestamp}_${timestampNum}_${randomSuffix(10)}`;
}

export function generateId(type?: IdType) {
  const uuid = generateUniqueId();
  return !!type ? `${type}_${uuid}` : uuid;
}

export function dispatchIntemptEvent(eventName: string, data = {}) {
  const event = new CustomEvent(eventName, {
    bubbles: true,
    cancelable: true,
    detail: data,
  });

  document.dispatchEvent(event);
}

export function debounce(func: Function, wait: number) {
  let timeout: ReturnType<typeof setTimeout>;

  return function (...args: any) {
    if (!!timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
