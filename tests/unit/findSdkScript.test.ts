import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvConfig } from '../../src/shared/envConfig.ts';
import { findSdkScript } from '../../src/shared/findSdkScript.ts';

const CDN_LINK = 'https://cdn.example.com/v1/intempt.min.js';

describe('findSdkScript', () => {
  beforeEach(() => {
    EnvConfig.initFromValues({ VITE_CDN_LINK: CDN_LINK });
    document.querySelectorAll('script').forEach((s) => s.remove());
  });
  afterEach(() => {
    document.querySelectorAll('script').forEach((s) => s.remove());
  });

  it('returns the script whose src matches the CDN link', () => {
    const other = document.createElement('script');
    other.src = 'https://other.example.com/x.js';
    document.body.appendChild(other);
    const ours = document.createElement('script');
    ours.src = `${CDN_LINK}?organization=acme`;
    document.body.appendChild(ours);
    expect(findSdkScript()).toBe(ours);
  });

  it('returns null when no script matches', () => {
    const other = document.createElement('script');
    other.src = 'https://other.example.com/x.js';
    document.body.appendChild(other);
    expect(findSdkScript()).toBeNull();
  });
});
