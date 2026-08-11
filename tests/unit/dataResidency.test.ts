import { describe, expect, it, vi } from 'vitest';
import { resolveIngestBaseUrl } from '../../src/shared/privacy/dataResidency.ts';

const DEFAULT_HOST = 'https://api.intempt.com/v1';

describe('ingest host override', () => {
  it.each([[undefined], [''], ['   '], [null], [42]])(
    'uses the build-time default for %o',
    (override) => {
      expect(resolveIngestBaseUrl(override as never, DEFAULT_HOST)).toBe(
        DEFAULT_HOST,
      );
    },
  );

  it('honours a valid https override', () => {
    expect(
      resolveIngestBaseUrl('https://api.eu.example.com/v1', DEFAULT_HOST),
    ).toBe('https://api.eu.example.com/v1');
  });

  it('keeps the version path, which is part of the base URL', () => {
    expect(
      resolveIngestBaseUrl(
        'https://ingest.example.com/custom/v2',
        DEFAULT_HOST,
      ),
    ).toBe('https://ingest.example.com/custom/v2');
  });

  it('strips a trailing slash so paths do not double up', () => {
    // Otherwise every URL becomes `…/v1//org/projects/…` — harmless on most
    // servers, a 404 on some.
    expect(
      resolveIngestBaseUrl('https://api.eu.example.com/v1/', DEFAULT_HOST),
    ).toBe('https://api.eu.example.com/v1');
    expect(
      resolveIngestBaseUrl('https://api.eu.example.com/', DEFAULT_HOST),
    ).toBe('https://api.eu.example.com');
  });

  it('drops a query string and fragment, which are not part of a base URL', () => {
    expect(
      resolveIngestBaseUrl('https://api.eu.example.com/v1?x=1#y', DEFAULT_HOST),
    ).toBe('https://api.eu.example.com/v1');
  });

  it('trims surrounding whitespace from a pasted value', () => {
    expect(
      resolveIngestBaseUrl('  https://api.eu.example.com/v1  ', DEFAULT_HOST),
    ).toBe('https://api.eu.example.com/v1');
  });
});

describe('invalid overrides fall back, and say so', () => {
  it.each([
    ['api.eu.example.com/v1', 'no scheme, so not an absolute URL'],
    ['/v1', 'a path, not a URL'],
    ['not a url at all', 'unparseable'],
  ])('ignores %o (%s)', (override) => {
    const onInvalid = vi.fn();

    expect(resolveIngestBaseUrl(override, DEFAULT_HOST, onInvalid)).toBe(
      DEFAULT_HOST,
    );
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it.each(['http://api.eu.example.com/v1', 'ftp://api.eu.example.com'])(
    'rejects the non-https scheme in %o',
    (override) => {
      // An http ingest host is blocked as mixed content on any https page, which is
      // nearly all of them — accepting it would produce a silent total outage
      // rather than a working-but-insecure transport.
      const onInvalid = vi.fn();

      expect(resolveIngestBaseUrl(override, DEFAULT_HOST, onInvalid)).toBe(
        DEFAULT_HOST,
      );
      expect(onInvalid.mock.calls[0][0]).toContain('https');
    },
  );

  it('falls back to the host already in use, introducing no new destination', () => {
    // The property that makes falling back safe *here* specifically: a bad override
    // cannot cause data to go somewhere the customer was not already sending it.
    // That is why validation fails back rather than failing hard, and it is the
    // reason a `region: 'eu'` shorthand was NOT built — see the module header.
    expect(resolveIngestBaseUrl('http://evil.example.com', DEFAULT_HOST)).toBe(
      DEFAULT_HOST,
    );
  });

  it('does not require a reporter', () => {
    expect(() => resolveIngestBaseUrl('nonsense', DEFAULT_HOST)).not.toThrow();
  });
});
