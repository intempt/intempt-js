import { describe, expect, it, vi } from 'vitest';
import {
  DO_NOT_TRACK_KEY,
  loadDoNotTrack,
  persistDoNotTrack,
} from '../../src/shared/consentState.ts';

/**
 * Consent has to outlive the page that captured it — an opt-out that resets on
 * reload is a compliance defect, so these are correctness tests, not nice-to-haves.
 */
describe('persisted opt-out state', () => {
  it('defaults to tracking allowed when nothing is stored', () => {
    expect(loadDoNotTrack()).toBe(false);
  });

  it('survives a reload after opt-out', () => {
    persistDoNotTrack(true);
    expect(loadDoNotTrack()).toBe(true);
  });

  it('lets an explicit opt-in clear a stored opt-out', () => {
    persistDoNotTrack(true);
    persistDoNotTrack(false);
    expect(loadDoNotTrack()).toBe(false);
  });

  it('treats a corrupt stored value as tracking allowed', () => {
    localStorage.setItem(DO_NOT_TRACK_KEY, '{not json');
    expect(loadDoNotTrack()).toBe(false);
  });

  it('treats a non-boolean stored value as tracking allowed', () => {
    localStorage.setItem(DO_NOT_TRACK_KEY, '"yes"');
    expect(loadDoNotTrack()).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    // Safari private mode and a full quota both throw on setItem. optOut() runs
    // inside a consent banner's click handler, so a throw here would turn our
    // compliance fix into the host page's outage.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => persistDoNotTrack(true)).not.toThrow();
    expect(loadDoNotTrack()).toBe(false);

    setItem.mockRestore();
    getItem.mockRestore();
  });
});
