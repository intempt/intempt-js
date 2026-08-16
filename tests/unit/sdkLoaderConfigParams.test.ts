import { describe, expect, it } from 'vitest';
import { readBooleanParam } from '../../src/loaders/sdkLoader.ts';

/**
 * The supported embed has **no constructor** — the snippet configures the SDK
 * entirely through the script URL's query string. So an option that exists only on
 * `IntemptConfig` is an option no customer can reach, and this parser is the real
 * public interface for the privacy switches.
 *
 * These tests exist mainly to pin one thing: `?ignore_dnt=false` must not mean
 * "ignore Do Not Track". The neighbouring `shopify`/`magento` params use
 * `!!searchParams.get(name)`, under which it would.
 */
function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('boolean script-URL parameters', () => {
  it('reports undefined when the parameter is absent, leaving the default in force', () => {
    expect(readBooleanParam(params(''), 'ignore_dnt')).toBe(undefined);
  });

  it.each([
    'ignore_dnt=true',
    'ignore_dnt=1',
    'ignore_dnt=yes',
    'ignore_dnt=TRUE',
    'ignore_dnt=  1  ',
  ])('reads %s as true', (query) => {
    expect(readBooleanParam(params(query), 'ignore_dnt')).toBe(true);
  });

  it('reads a valueless parameter as true, like an HTML boolean attribute', () => {
    expect(readBooleanParam(params('ignore_dnt'), 'ignore_dnt')).toBe(true);
    expect(readBooleanParam(params('ignore_dnt='), 'ignore_dnt')).toBe(true);
  });

  it.each([
    'ignore_dnt=false',
    'ignore_dnt=0',
    'ignore_dnt=no',
    'ignore_dnt=off',
  ])('reads %s as false', (query) => {
    // The assertion that matters. Under the `!!get()` idiom used by `shopify`,
    // every one of these would enable the flag and silently stop honouring the
    // visitor's Do Not Track signal.
    expect(readBooleanParam(params(query), 'ignore_dnt')).toBe(false);
  });

  it('does not confuse one parameter for another', () => {
    expect(readBooleanParam(params('pii_scrubbing=1'), 'ignore_dnt')).toBe(
      undefined,
    );
    expect(readBooleanParam(params('pii_scrubbing=1'), 'pii_scrubbing')).toBe(
      true,
    );
  });
});
