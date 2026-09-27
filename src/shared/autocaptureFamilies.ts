export const AUTOCAPTURE_FAMILIES = [
  'pageview',
  'click',
  'input',
  'submit',
] as const;

export type AutocaptureFamily = (typeof AUTOCAPTURE_FAMILIES)[number];

export type AutocaptureSetting = boolean | AutocaptureFamily[];

const ALL_VALUES = new Set(['', 'true', '1', 'yes', 'all']);
const NONE_VALUES = new Set(['false', '0', 'no', 'none', 'off']);

function isFamily(name: string): name is AutocaptureFamily {
  return (AUTOCAPTURE_FAMILIES as readonly string[]).includes(name);
}

export function parseAutocaptureParam(params: URLSearchParams): {
  setting: AutocaptureSetting | undefined;
  unknown: string[];
} {
  const raw = params.get('autocapture');
  if (raw === null) return { setting: undefined, unknown: [] };

  const normalized = raw.trim().toLowerCase();
  if (ALL_VALUES.has(normalized)) return { setting: true, unknown: [] };
  if (NONE_VALUES.has(normalized)) return { setting: false, unknown: [] };

  const families: AutocaptureFamily[] = [];
  const unknown: string[] = [];
  for (const entry of normalized.split(',')) {
    const name = entry.trim();
    if (!name) continue;
    if (isFamily(name)) {
      if (!families.includes(name)) families.push(name);
    } else if (!unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return { setting: families, unknown };
}

export function enabledAutocaptureFamilies(
  setting: AutocaptureSetting | undefined,
): Set<AutocaptureFamily> {
  if (setting === undefined || setting === true) {
    return new Set(AUTOCAPTURE_FAMILIES);
  }
  if (setting === false) return new Set();
  return new Set(setting.filter((name) => isFamily(name)));
}
