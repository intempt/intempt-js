import { describe, expect, it } from 'vitest';
import { enabledAutocaptureFamilies } from '../../src/shared/autocaptureFamilies.ts';

describe('resolving the enabled families', () => {
  const ALL = ['pageview', 'click', 'input', 'submit'];

  it('enables every family when called with no argument (autoCapture.init())', () => {
    expect([...enabledAutocaptureFamilies(undefined)].sort()).toEqual(
      [...ALL].sort(),
    );
  });

  it('enables nothing when called with an empty list', () => {
    expect(enabledAutocaptureFamilies([]).size).toBe(0);
  });

  it('enables exactly the listed families', () => {
    expect([...enabledAutocaptureFamilies(['click', 'submit'])].sort()).toEqual(
      ['click', 'submit'],
    );
  });

  it('ignores names that are not families when passed from code', () => {
    expect([
      ...enabledAutocaptureFamilies(['click', 'shopify'] as never),
    ]).toEqual(['click']);
  });
});
