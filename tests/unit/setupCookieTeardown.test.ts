/**
 * @vitest-environment-options { "url": "https://shop.example.com/" }
 *
 * D-26 regression guard for `tests/unit/setup.ts`.
 *
 * The teardown in that file used to expire every cookie with `path=/` and no
 * `domain=`, which does not match a cookie written *with* a domain attribute —
 * they are two distinct cookies of the same name. Domain-scoped cookies therefore
 * survived into the next test, and the privacy suites had to clear their own state
 * rather than trust the shared hook.
 *
 * These tests are deliberately ORDER-DEPENDENT: the first writes, the second
 * asserts the write is gone. That is the only way to assert a `beforeEach`
 * actually ran — a single test cannot observe its own teardown. Needs a host with
 * a registrable parent (`shop.example.com`), because jsdom rejects a `domain=`
 * that is not a suffix of the document host, and `localhost` has no parent.
 */
import { describe, expect, it } from 'vitest';

describe('setup.ts cookie teardown — D-26', () => {
  it('writes cookies at the host, the parent domain, and the dotted parent', () => {
    document.cookie = 'd26_host=1;path=/';
    document.cookie = 'd26_parent=1;path=/;domain=example.com';
    document.cookie = 'd26_dotted=1;path=/;domain=.example.com';

    // Sanity: jsdom accepted all three. If it ever stops, the next assertion
    // would pass vacuously and the guard would be worthless.
    expect(document.cookie).toContain('d26_host=1');
    expect(document.cookie).toContain('d26_parent=1');
    expect(document.cookie).toContain('d26_dotted=1');
  });

  it('clears all three before the next test, domain-scoped ones included', () => {
    expect(document.cookie).not.toContain('d26_host');
    expect(document.cookie).not.toContain('d26_parent');
    expect(document.cookie).not.toContain('d26_dotted');
  });
});
