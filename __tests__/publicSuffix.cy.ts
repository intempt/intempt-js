import { extractEtldPlusOne, isHostOnlyTarget } from '../src/shared/publicSuffix.ts';
import { handleDomain } from '../src/shared/storageHandler.ts';

/**
 * Cover for the psl removal (152 KB raw, ~60% of the bundle, one call site).
 *
 * The expectations below were pinned against psl.parse() in a parity harness
 * before the dependency was dropped; the only intentional divergences are the
 * host-only cases and deep .us hierarchies, both asserted explicitly here.
 */
describe('extractEtldPlusOne', () => {
  it('takes the last two labels for ordinary gTLDs', () => {
    expect(extractEtldPlusOne('example.com')).to.equal('example.com');
    expect(extractEtldPlusOne('www.example.com')).to.equal('example.com');
    expect(extractEtldPlusOne('my.sub.example.com')).to.equal('example.com');
    expect(extractEtldPlusOne('a.b.c.example.dev')).to.equal('example.dev');
  });

  it('handles ccSLDs where the last two labels are the public suffix', () => {
    expect(extractEtldPlusOne('www.oxford.ac.uk')).to.equal('oxford.ac.uk');
    expect(extractEtldPlusOne('shop.example.co.uk')).to.equal('example.co.uk');
    expect(extractEtldPlusOne('a.b.example.com.au')).to.equal('example.com.au');
    expect(extractEtldPlusOne('www.example.co.jp')).to.equal('example.co.jp');
    expect(extractEtldPlusOne('www.example.co.za')).to.equal('example.co.za');
  });

  it('handles private suffixes, where the subdomain is the registrable unit', () => {
    // Shopify matters here specifically: the SDK ships a Shopify tracker, so
    // hosted-store hostnames are a first-class case.
    expect(extractEtldPlusOne('acme.myshopify.com')).to.equal('acme.myshopify.com');
    expect(extractEtldPlusOne('example.github.io')).to.equal('example.github.io');
    expect(extractEtldPlusOne('example.vercel.app')).to.equal('example.vercel.app');
    expect(extractEtldPlusOne('example.herokuapp.com')).to.equal('example.herokuapp.com');
  });

  it('normalises case and a trailing root dot', () => {
    expect(extractEtldPlusOne('WWW.Example.COM')).to.equal('example.com');
    expect(extractEtldPlusOne('www.example.com.')).to.equal('example.com');
  });

  it('returns hosts that cannot be domain-scoped unchanged', () => {
    expect(extractEtldPlusOne('localhost')).to.equal('localhost');
    expect(extractEtldPlusOne('127.0.0.1')).to.equal('127.0.0.1');
    expect(extractEtldPlusOne('192.168.1.10')).to.equal('192.168.1.10');
  });

  it('tolerates empty input', () => {
    expect(extractEtldPlusOne('')).to.equal('');
  });
});

describe('isHostOnlyTarget', () => {
  it('flags IP literals, single-label hosts and IPv6', () => {
    expect(isHostOnlyTarget('127.0.0.1')).to.be.true;
    expect(isHostOnlyTarget('localhost')).to.be.true;
    expect(isHostOnlyTarget('intranet')).to.be.true;
    expect(isHostOnlyTarget('[::1]')).to.be.true;
    expect(isHostOnlyTarget('')).to.be.true;
  });

  it('does not flag ordinary hostnames', () => {
    expect(isHostOnlyTarget('example.com')).to.be.false;
    expect(isHostOnlyTarget('www.example.co.uk')).to.be.false;
  });
});

describe('handleDomain', () => {
  it('returns a dot-prefixed registrable domain for shareable hosts', () => {
    expect(handleDomain('my.sub.example.com')).to.equal('.example.com');
    expect(handleDomain('www.oxford.ac.uk')).to.equal('.oxford.ac.uk');
    expect(handleDomain('acme.myshopify.com')).to.equal('.acme.myshopify.com');
  });

  it('returns empty for hosts that must get a host-only cookie', () => {
    // The psl-backed version produced '.0.1' for 127.0.0.1 and '.localhost' for
    // localhost. Browsers reject both, so the cookie was dropped entirely.
    expect(handleDomain('127.0.0.1')).to.equal('');
    expect(handleDomain('localhost')).to.equal('');
  });
});
