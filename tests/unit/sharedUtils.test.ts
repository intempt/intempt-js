import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  debounce,
  detectDevice,
  dispatchIntemptEvent,
  generateId,
} from '../../src/shared/shared.utils.ts';
import { SDK_VERSION } from '../../src/shared/version.ts';

const ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

describe('generateId', () => {
  it('produces unique ids across a tight loop', () => {
    // The generator mixes a millisecond timestamp with randomness, so a tight
    // loop is the adversarial case: many ids inside the same millisecond.
    const ids = new Set(Array.from({ length: 5000 }, () => generateId()));
    expect(ids.size).toBe(5000);
  });

  it('prefixes with the type when one is given', () => {
    const id = generateId('profile' as never);
    expect(id.startsWith('profile_')).toBe(true);
  });

  it('omits the prefix when no type is given', () => {
    expect(generateId().startsWith('undefined')).toBe(false);
  });

  it('has the shape <base36-ts>_<ms>_<10 random chars>', () => {
    const id = generateId();
    const parts = id.split('_');
    expect(parts).toHaveLength(3);
    expect(Number(parts[1])).toBeGreaterThan(1_600_000_000_000);
    expect(parts[2]).toHaveLength(10);
  });

  // --- randomSuffix's two code paths, mutation-driven -----------------------
  //
  // generateId() (the only export) always bottoms out in randomSuffix(10),
  // which branches on whether `crypto.getRandomValues` is available. jsdom
  // supplies a real `crypto`, so nothing before this batch ever forced the
  // fallback branch, and nothing asserted that the crypto branch actually
  // *uses* crypto rather than merely being reachable. Both branches compute a
  // value (a string of random characters) — exactly the shape the §3f-iii
  // heuristic says is worth the test.

  describe('crypto path (the normal case in a browser)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('actually calls crypto.getRandomValues rather than merely being reachable', () => {
      // Kills the BlockStatement mutant that empties the crypto `if` body, and
      // the ConditionalExpression/EqualityOperator mutants on its guard
      // (`if (true)`/`if (false)`/`!==`→`===`): each would either skip the
      // real call or take a path that (given a valid crypto object) does not
      // call it at all.
      const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
      generateId();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('draws every character from the byte buffer crypto filled, modulo the alphabet length', () => {
      // Kills the ArithmeticOperator/MethodExpression mutants on
      // `ID_ALPHABET.charAt(bytes[i] % ID_ALPHABET.length)` and the
      // ConditionalExpression/UpdateOperator/BlockStatement mutants on the
      // `for` loop that builds it (28:21 `i < length` → `i <= length`, and
      // the no-coverage siblings at 34 which belong to the OTHER loop below
      // but share the same shape). A wrong modulus or a skipped iteration
      // changes the produced string, not just whether code ran.
      vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((
        array: Uint8Array,
      ) => {
        for (let i = 0; i < array.length; i++) array[i] = i;
        return array;
      }) as typeof globalThis.crypto.getRandomValues);

      const id = generateId();
      const suffix = id.split('_')[2];
      const expected = Array.from({ length: 10 }, (_, i) =>
        ID_ALPHABET.charAt(i % ID_ALPHABET.length),
      ).join('');
      expect(suffix).toBe(expected);
    });
  });

  describe('fallback path (no crypto.getRandomValues)', () => {
    let originalCrypto: Crypto;

    afterEach(() => {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
      vi.restoreAllMocks();
    });

    it('still produces a well-formed id when crypto is entirely absent', () => {
      // Kills the ConditionalExpression/EqualityOperator/LogicalOperator
      // mutants on `typeof globalThis !== 'undefined' ? ... : undefined` and
      // on `if (cryptoObj && typeof cryptoObj.getRandomValues === 'function')`.
      // Flipping either would call `.getRandomValues` on `undefined` and
      // throw, or would skip the fallback and leave `id` short — this is the
      // one case that forces the fallback branch to actually run.
      originalCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
      });

      let id: string;
      expect(() => {
        id = generateId();
      }).not.toThrow();
      const suffix = id!.split('_')[2];
      expect(suffix).toHaveLength(10);
      expect(suffix).toMatch(new RegExp(`^[${ID_ALPHABET}]{10}$`));
    });

    it('takes the fallback when getRandomValues is not a function, even if crypto exists', () => {
      // Kills the EqualityOperator mutant `!== 'function'` → `=== 'function'`
      // read the other way: a crypto object present but without a usable
      // getRandomValues must still fall back rather than crash.
      originalCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        value: {},
        configurable: true,
      });

      expect(() => generateId()).not.toThrow();
    });

    it('uses Math.random for every character of the fallback suffix', () => {
      // Kills the AssignmentOperator/MethodExpression/ArithmeticOperator
      // mutants on `id += ID_ALPHABET.charAt(Math.floor(Math.random() *
      // ID_ALPHABET.length))`, and the ConditionalExpression/EqualityOperator/
      // UpdateOperator/BlockStatement mutants on the `for` loop around it
      // (34:19, 34:31, 34:36) — a wrong index or a skipped/looping-backward
      // counter changes the produced string's length or content.
      originalCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
      });

      let call = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        // Distinct, predictable draws so each output character is pinned.
        const v = (call % ID_ALPHABET.length) / ID_ALPHABET.length;
        call++;
        return v;
      });

      const suffix = generateId().split('_')[2];
      const expected = Array.from({ length: 10 }, (_, i) =>
        ID_ALPHABET.charAt(i % ID_ALPHABET.length),
      ).join('');
      expect(suffix).toBe(expected);
      expect(call).toBe(10);
    });
  });
});

describe('dispatchIntemptEvent', () => {
  it('dispatches a CustomEvent on document carrying the detail', () => {
    const received: any[] = [];
    const listener = (e: Event) => received.push((e as CustomEvent).detail);
    document.addEventListener('unit-event', listener);

    dispatchIntemptEvent('unit-event', { hello: 'world' });
    document.removeEventListener('unit-event', listener);

    expect(received).toEqual([{ hello: 'world' }]);
  });

  it('defaults detail to an empty object', () => {
    const received: any[] = [];
    const listener = (e: Event) => received.push((e as CustomEvent).detail);
    document.addEventListener('unit-event-empty', listener);

    dispatchIntemptEvent('unit-event-empty');
    document.removeEventListener('unit-event-empty', listener);

    expect(received).toEqual([{}]);
  });

  it('dispatches with bubbles and cancelable both true', () => {
    // Kills the two BooleanLiteral mutants that flip `bubbles`/`cancelable`
    // to false. A listener attached higher up the DOM (the SDK's own
    // integration point) relies on bubbling to ever see the event.
    let captured: Event | undefined;
    const listener = (e: Event) => (captured = e);
    document.addEventListener('unit-event-flags', listener);

    dispatchIntemptEvent('unit-event-flags');
    document.removeEventListener('unit-event-flags', listener);

    expect(captured!.bubbles).toBe(true);
    expect(captured!.cancelable).toBe(true);
  });
});

describe('debounce', () => {
  it('runs once after the wait, with the latest arguments', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced('first');
    debounced('second');
    debounced('third');

    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('third');
  });

  it('restarts the wait on every call', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced();
    vi.advanceTimersByTime(90);
    debounced();
    vi.advanceTimersByTime(90);

    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not call clearTimeout on the very first invocation', () => {
    // Kills the ConditionalExpression mutant `if(!!timeout)` → `if(true)`.
    // On the first call `timeout` is undefined, so `clearTimeout` must not
    // run at all — calling it on undefined is harmless in practice, but the
    // mutant is a real behaviour change (it always clears, even when there
    // is nothing scheduled), so this pins the guard rather than the symptom.
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const debounced = debounce(vi.fn(), 100);

    debounced('first');

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('does call clearTimeout from the second invocation onward', () => {
    // The other half of the same guard: once a timeout exists it must be
    // cleared before scheduling the next one, or two invocations close
    // together both fire.
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const debounced = debounce(vi.fn(), 100);

    debounced('first');
    debounced('second');

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SDK_VERSION', () => {
  it('is injected at build time, not hardcoded', () => {
    // vitest.config.ts defines __SDK_VERSION__ from package.json exactly as
    // vite.config.ts does, so this asserts the wiring, not a literal.
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(SDK_VERSION).not.toBe('0.0.0-dev');
  });
});

describe('detectDevice', () => {
  const withUA = (userAgent: string) =>
    vi.stubGlobal('navigator', { userAgent });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * ONE detection, shared by `choose-web` and `choose-api`.
   *
   * The value is spliced into the serving query's
   * `and (device is null or device = 'ALL' or device = '<DEVICE>')` predicate, so two
   * detections that disagree serve the same visitor different experiences depending on which
   * channel they arrived through. Every alternative in the pattern is asserted individually
   * because dropping one is a silent narrowing: that device class quietly starts being told it
   * is a desktop.
   */
  it.each([
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'],
    ['webOS', 'Mozilla/5.0 (webOS/1.4.0; U; en-US) AppleWebKit/532.2'],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'],
    ['iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0 like Mac OS X)'],
    ['BlackBerry', 'BlackBerry9700/5.0.0.862 Profile/MIDP-2.1'],
    [
      'IEMobile',
      'Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; IEMobile/10.0)',
    ],
    ['Opera Mini', 'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80) Presto/2.5.25'],
  ])('reports mobile for %s', (_name, ua) => {
    withUA(ua);
    expect(detectDevice()).toBe('mobile');
  });

  it.each([
    [
      'Chrome on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
    ],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605',
    ],
    [
      'Firefox on Linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101',
    ],
  ])('reports desktop for %s', (_name, ua) => {
    withUA(ua);
    expect(detectDevice()).toBe('desktop');
  });

  it('matches case-insensitively', () => {
    withUA('mozilla/5.0 (iphone; cpu iphone os 17_0)');
    expect(detectDevice()).toBe('mobile');
  });

  it('reports desktop rather than throwing when there is no user agent', () => {
    // A non-browser host (SSR, a worker, a test runner without jsdom) has no `navigator`. The
    // request still has to be made; `desktop` is the value that changes nothing about which
    // rows the server's `device is null or device = 'ALL'` clause already returns.
    vi.stubGlobal('navigator', undefined);
    expect(detectDevice()).toBe('desktop');

    vi.stubGlobal('navigator', { userAgent: '' });
    expect(detectDevice()).toBe('desktop');
  });
});
