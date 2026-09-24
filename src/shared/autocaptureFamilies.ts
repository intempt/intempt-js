export const AUTOCAPTURE_FAMILIES = [
  'pageview',
  'click',
  'input',
  'submit',
] as const;

export type AutocaptureFamily = (typeof AUTOCAPTURE_FAMILIES)[number];

export function isFamily(name: string): name is AutocaptureFamily {
  return (AUTOCAPTURE_FAMILIES as readonly string[]).includes(name);
}

/**
 * Resolves what `autoCapture.init(...)` was called with into the family set
 * the gate checks against. No arguments (`undefined`) means every family —
 * `autoCapture.init()` is "capture everything". An explicit list is filtered
 * to known names, silently dropping anything else: an unrecognised name in a
 * customer's list should not turn the whole call into a no-op.
 */
export function enabledAutocaptureFamilies(
  families?: AutocaptureFamily[],
): Set<AutocaptureFamily> {
  if (families === undefined) return new Set(AUTOCAPTURE_FAMILIES);
  return new Set(families.filter(isFamily));
}
