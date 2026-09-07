import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvConfig } from '../../src/shared/envConfig.ts';
import { readAllowBotsFlag } from '../../src/guard/trackingGuard.flags.ts';

/**
 * `?allow_bots` on the SDK script URL — the one switch that disables the
 * crawler/bot guard. Read before the loader exists, so it has its own reader.
 */

const CDN_LINK = 'https://cdn.example.com/v1/intempt.min.js';

function appendScript(query: string): void {
  const script = document.createElement('script');
  script.src = `${CDN_LINK}?${query}`;
  document.body.appendChild(script);
}

describe('readAllowBotsFlag', () => {
  beforeEach(() => {
    EnvConfig.initFromValues({ VITE_CDN_LINK: CDN_LINK });
    document.querySelectorAll('script').forEach((s) => s.remove());
  });
  afterEach(() => {
    document.querySelectorAll('script').forEach((s) => s.remove());
  });

  it('is false when the flag is absent — bots stay blocked by default', () => {
    appendScript('organization=acme');
    expect(readAllowBotsFlag()).toBe(false);
  });

  it.each(['allow_bots=1', 'allow_bots=true', 'allow_bots', 'allow_bots=yes'])(
    'is true for ?%s',
    (q) => {
      appendScript(`organization=acme&${q}`);
      expect(readAllowBotsFlag()).toBe(true);
    },
  );

  it.each(['allow_bots=0', 'allow_bots=false'])(
    'is false for ?%s (D-17 parser, not string truthiness)',
    (q) => {
      appendScript(`organization=acme&${q}`);
      expect(readAllowBotsFlag()).toBe(false);
    },
  );

  it('is false when no SDK script tag is on the page', () => {
    const other = document.createElement('script');
    other.src = 'https://other.example.com/x.js?allow_bots=1';
    document.body.appendChild(other);
    expect(readAllowBotsFlag()).toBe(false);
  });
});
