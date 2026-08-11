import { describe, expect, it, vi } from 'vitest';
import { debounce, dispatchIntemptEvent, generateId } from '../../src/shared/shared.utils.ts';
import { SDK_VERSION } from '../../src/shared/version.ts';

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
});

describe('SDK_VERSION', () => {
  it('is injected at build time, not hardcoded', () => {
    // vitest.config.ts defines __SDK_VERSION__ from package.json exactly as
    // vite.config.ts does, so this asserts the wiring, not a literal.
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(SDK_VERSION).not.toBe('0.0.0-dev');
  });
});
