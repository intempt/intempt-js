import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSecureContext } from '../../src/shared/secureContext.ts';

/**
 * `isSecureContext()` decides whether the SDK may set a `Secure` cookie
 * (storageHandler) and whether the consent cookie is written at all
 * (consentCookie). It had no direct test — it was exercised only incidentally
 * through those two callers, which never drive it into its failure path, so its
 * `catch` arm carried no coverage whatsoever.
 *
 * Note on what is *not* asserted here: the three mutants on line 4
 * (`typeof window !== 'undefined'` -> `true`, -> `!== ""`, and dropping the
 * `?.` on `window.location`) are genuinely equivalent. Every one of them turns a
 * `false` return into a throw, and the surrounding `try/catch` converts that
 * throw back into the same `false`. There is no observable difference to assert,
 * so no test here pretends to catch them.
 */
describe('isSecureContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false on a plain-http page', () => {
    // jsdom's default document URL is http://localhost/.
    expect(window.location.protocol).toBe('http:');
    expect(isSecureContext()).toBe(false);
  });

  it('is true on an https page', () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:' },
    });
    expect(isSecureContext()).toBe(true);
  });

  it('is false when there is no window at all', () => {
    // The non-browser case: a bundler evaluating the module, or SSR. The
    // `typeof` guard short-circuits before `window.location` is touched, so
    // nothing throws here — this path never reaches the `catch`.
    vi.stubGlobal('window', undefined);
    expect(isSecureContext()).toBe(false);
  });

  it('is false, not undefined, when reading window.location throws', () => {
    // The one situation that actually reaches the `catch`: a frame where
    // touching `location` raises a SecurityError. Before this test the catch arm
    // had no coverage at all, because the `typeof` guard means an absent window
    // never reaches it and every other caller runs in a normal document.
    //
    // It kills both of the arm's mutants: emptying the block makes the function
    // return `undefined` — falsy, so a loose assertion would not notice — and
    // flipping the literal to `true` would hand a page the SDK cannot verify a
    // `Secure` cookie, which the browser then silently drops, losing consent
    // state rather than failing loudly.
    vi.stubGlobal('window', {
      get location(): Location {
        throw new DOMException('cross-origin frame', 'SecurityError');
      },
    });
    expect(isSecureContext()).toBe(false);
  });
});
