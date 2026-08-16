import { describe, expect, it } from 'vitest';
import {
  extractEtldPlusOne,
  isHostOnlyTarget,
} from '../../src/shared/publicSuffix.ts';
import {
  handleDomain,
  setCookie,
  getCookie,
} from '../../src/shared/storageHandler.ts';

/**
 * Cover for the `psl` removal (152 KB raw, ~60% of the old bundle, one call site).
 *
 * The expectations here were pinned against `psl.parse()` in a parity harness
 * before the dependency was dropped. The two intentional divergences are
 * asserted explicitly rather than left implicit — a future reader must be able
 * to tell "we chose this" from "we missed this".
 */
describe('extractEtldPlusOne', () => {
  it('takes the last two labels for ordinary gTLDs', () => {
    expect(extractEtldPlusOne('example.com')).toBe('example.com');
    expect(extractEtldPlusOne('www.example.com')).toBe('example.com');
    expect(extractEtldPlusOne('my.sub.example.com')).toBe('example.com');
    expect(extractEtldPlusOne('a.b.c.example.dev')).toBe('example.dev');
    expect(extractEtldPlusOne('deep.a.b.c.example.io')).toBe('example.io');
  });

  it('handles ccSLDs, where the last two labels are the public suffix', () => {
    expect(extractEtldPlusOne('www.oxford.ac.uk')).toBe('oxford.ac.uk');
    expect(extractEtldPlusOne('shop.example.co.uk')).toBe('example.co.uk');
    expect(extractEtldPlusOne('a.b.example.com.au')).toBe('example.com.au');
    expect(extractEtldPlusOne('www.example.co.jp')).toBe('example.co.jp');
    expect(extractEtldPlusOne('www.example.co.za')).toBe('example.co.za');
    expect(extractEtldPlusOne('www.example.com.br')).toBe('example.com.br');
  });

  it('handles private suffixes, where the subdomain is the registrable unit', () => {
    // These are the cases the parity harness caught. Under a naive
    // last-two-labels rule they resolve to a PUBLIC suffix, and a browser
    // rejects such a cookie outright rather than mis-scoping it — so getting
    // this wrong drops the cookie entirely.
    expect(extractEtldPlusOne('acme.myshopify.com')).toBe('acme.myshopify.com');
    expect(extractEtldPlusOne('example.github.io')).toBe('example.github.io');
    expect(extractEtldPlusOne('example.vercel.app')).toBe('example.vercel.app');
    expect(extractEtldPlusOne('example.herokuapp.com')).toBe(
      'example.herokuapp.com',
    );
    expect(extractEtldPlusOne('example.pages.dev')).toBe('example.pages.dev');
  });

  it('resolves a sub-subdomain of a private suffix to the customer domain', () => {
    expect(extractEtldPlusOne('checkout.acme.myshopify.com')).toBe(
      'acme.myshopify.com',
    );
  });

  it('normalises case and a trailing root dot', () => {
    expect(extractEtldPlusOne('WWW.Example.COM')).toBe('example.com');
    expect(extractEtldPlusOne('www.example.com.')).toBe('example.com');
  });

  it('returns hosts that cannot be domain-scoped unchanged', () => {
    expect(extractEtldPlusOne('localhost')).toBe('localhost');
    expect(extractEtldPlusOne('127.0.0.1')).toBe('127.0.0.1');
    expect(extractEtldPlusOne('192.168.1.10')).toBe('192.168.1.10');
  });

  it('tolerates empty and malformed input without throwing', () => {
    expect(extractEtldPlusOne('')).toBe('');
    expect(extractEtldPlusOne('...')).toBe('');
    expect(() =>
      extractEtldPlusOne(undefined as unknown as string),
    ).not.toThrow();
  });
});

describe('isHostOnlyTarget', () => {
  it('flags IP literals, single-label hosts and IPv6', () => {
    expect(isHostOnlyTarget('127.0.0.1')).toBe(true);
    expect(isHostOnlyTarget('192.168.1.10')).toBe(true);
    expect(isHostOnlyTarget('localhost')).toBe(true);
    expect(isHostOnlyTarget('intranet')).toBe(true);
    expect(isHostOnlyTarget('[::1]')).toBe(true);
    expect(isHostOnlyTarget('')).toBe(true);
  });

  it('does not flag ordinary hostnames', () => {
    expect(isHostOnlyTarget('example.com')).toBe(false);
    expect(isHostOnlyTarget('www.example.co.uk')).toBe(false);
  });
});

describe('handleDomain', () => {
  it('returns a dot-prefixed registrable domain for shareable hosts', () => {
    expect(handleDomain('my.sub.example.com')).toBe('.example.com');
    expect(handleDomain('www.oxford.ac.uk')).toBe('.oxford.ac.uk');
    expect(handleDomain('acme.myshopify.com')).toBe('.acme.myshopify.com');
  });

  it('returns empty for hosts that must get a host-only cookie', () => {
    // The psl-backed version produced '.0.1' for 127.0.0.1 and '.localhost'.
    // Browsers reject both, so the cookie was dropped rather than scoped.
    expect(handleDomain('127.0.0.1')).toBe('');
    expect(handleDomain('localhost')).toBe('');
  });
});

describe('setCookie / getCookie', () => {
  it('round-trips a value', () => {
    setCookie({ name: 'unit_rt', value: 'hello', path: '/' });
    expect(getCookie('unit_rt')).toEqual({ unit_rt: 'hello' });
  });

  it('returns null for a cookie that is not set', () => {
    expect(getCookie('unit_missing')).toBeNull();
  });

  it('does not match on a name that is merely a prefix of another', () => {
    setCookie({ name: 'unit_prefix_long', value: 'x', path: '/' });
    expect(getCookie('unit_prefix')).toBeNull();
  });

  it('never emits a malformed empty domain attribute for host-only targets', () => {
    // Regression guard: `domain ? \`domain=${handleDomain(domain)};\` : ''`
    // would emit `domain=;` once handleDomain started returning '' — a
    // malformed attribute rather than an absent one.
    const written: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    );
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      set(value: string) {
        written.push(value);
      },
      get() {
        return '';
      },
    });

    try {
      setCookie({
        name: 'unit_hostonly',
        value: '1',
        path: '/',
        domain: 'localhost',
      });
    } finally {
      if (descriptor) {
        Object.defineProperty(document, 'cookie', descriptor);
      }
    }

    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain('domain=;');
    expect(written[0]).not.toContain('domain=');
  });
});
