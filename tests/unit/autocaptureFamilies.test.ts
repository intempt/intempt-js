import { describe, expect, it } from 'vitest';
import {
  enabledAutocaptureFamilies,
  parseAutocaptureParam,
} from '../../src/shared/autocaptureFamilies.ts';

function parse(query: string) {
  return parseAutocaptureParam(new URLSearchParams(query));
}

describe('parsing the autocapture script-URL parameter', () => {
  it('is undefined when absent, leaving every family on', () => {
    expect(parse('')).toEqual({ setting: undefined, unknown: [] });
  });

  it.each([
    'autocapture',
    'autocapture=',
    'autocapture=true',
    'autocapture=1',
    'autocapture=yes',
    'autocapture=all',
    'autocapture=ALL',
  ])('reads %s as every family on', (query) => {
    expect(parse(query)).toEqual({ setting: true, unknown: [] });
  });

  it.each([
    'autocapture=false',
    'autocapture=0',
    'autocapture=no',
    'autocapture=none',
    'autocapture=off',
    'autocapture=NONE',
  ])('reads %s as every family off', (query) => {
    expect(parse(query)).toEqual({ setting: false, unknown: [] });
  });

  it('reads a single family', () => {
    expect(parse('autocapture=pageview')).toEqual({
      setting: ['pageview'],
      unknown: [],
    });
  });

  it('reads a comma list, trimming space and ignoring case', () => {
    expect(parse('autocapture=pageview,%20Submit%20')).toEqual({
      setting: ['pageview', 'submit'],
      unknown: [],
    });
  });

  it('keeps valid names and reports unknown ones', () => {
    expect(parse('autocapture=pageview,clicks')).toEqual({
      setting: ['pageview'],
      unknown: ['clicks'],
    });
  });

  it('turns everything off when a list names no valid family', () => {
    expect(parse('autocapture=clicks,forms')).toEqual({
      setting: [],
      unknown: ['clicks', 'forms'],
    });
  });

  it('drops empty entries and duplicates', () => {
    expect(parse('autocapture=click,,click,')).toEqual({
      setting: ['click'],
      unknown: [],
    });
  });

  it('does not treat an integration name as a family', () => {
    expect(parse('autocapture=shopify,magento')).toEqual({
      setting: [],
      unknown: ['shopify', 'magento'],
    });
  });
});

describe('resolving the enabled families', () => {
  const ALL = ['pageview', 'click', 'input', 'submit'];

  it('enables every family when the setting is absent or true', () => {
    expect([...enabledAutocaptureFamilies(undefined)].sort()).toEqual(
      [...ALL].sort(),
    );
    expect([...enabledAutocaptureFamilies(true)].sort()).toEqual(
      [...ALL].sort(),
    );
  });

  it('enables nothing when the setting is false or an empty list', () => {
    expect(enabledAutocaptureFamilies(false).size).toBe(0);
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
