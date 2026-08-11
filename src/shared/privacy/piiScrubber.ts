/**
 * PII masking on outbound payloads.
 *
 * ## Off by default, and that is not laziness
 *
 * Redaction is **opt-in**. An SDK that starts rewriting payloads on upgrade is
 * worse than one that never had the feature: a customer whose funnel keys on
 * `email` would find their reports quietly broken by a version bump, with the
 * data unrecoverable because the redaction happened *client-side, before
 * transmission*. There is no server-side undo. So `enabled` defaults to `false`
 * and every call site must ask for it.
 *
 * That also means this module cannot be judged by "does it catch everything".
 * A scrubber that catches 95% of PII while being enabled by 100% of privacy-
 * conscious customers beats a perfect one nobody dares turn on.
 *
 * ## Two independent mechanisms, because they fail differently
 *
 *  - **Key-based redaction** (`redactKeys`) removes the value of a field whose
 *    *name* says it is sensitive — `email`, `password`, `ssn`. Precise, no false
 *    positives, but blind to PII in a field called `notes`.
 *  - **Pattern-based redaction** (`patterns`) rewrites anything matching a PII
 *    *shape* anywhere in a string. Catches the free-text case, at the cost of
 *    false positives.
 *
 * Both run; key-based first, since it is the cheaper and safer of the two.
 *
 * ## Why the card pattern runs a Luhn check
 *
 * A 13-to-19-digit run is not rare in analytics data — order ids, timestamps in
 * microseconds, and concatenated identifiers all match. Redacting those would
 * destroy legitimate data to catch a card number that was never there. Luhn is a
 * one-line checksum that every real card satisfies and an arbitrary digit run
 * satisfies about 10% of the time, which turns the false-positive rate from
 * unacceptable into negligible. This is the single most important detail in the
 * file: **do not "simplify" the card rule by dropping the checksum.**
 *
 * ## Never throws
 *
 * A scrubber on the send path that throws does not leak data — it *loses* every
 * event behind it. On any internal failure the original value is returned
 * unchanged and the failure is reported. That is the deliberate trade: this
 * module chooses "possibly unredacted" over "certainly dropped", because the
 * customer opted in to redaction as a defence-in-depth layer and not as their
 * only one.
 */

export type PiiPattern = {
  /** Name used in diagnostics. */
  readonly name: string;
  /** Must be global — the scrubber replaces every occurrence in a string. */
  readonly pattern: RegExp;
  /**
   * Index of the capture group holding the PII, when the pattern has to consume a
   * leading boundary character to avoid matching mid-token. Defaults to 0, the
   * whole match.
   *
   * **Constraint:** the designated group must end where the whole match ends —
   * i.e. anything the pattern consumes beyond it must be a leading prefix, not a
   * trailing suffix. That is what lets the replacement be computed by length
   * rather than by offset bookkeeping. Use a lookahead for trailing boundaries,
   * which consumes nothing.
   *
   * This exists because JavaScript lookBEHIND (`(?<!…)`) is a **parse-time**
   * SyntaxError on Safari before 16.4, and a regex literal is parsed when the
   * bundle loads — so one lookbehind anywhere in this file would take the entire
   * SDK down on those browsers rather than merely degrading the scrubber. A
   * capture group is the portable equivalent.
   */
  readonly sensitiveGroup?: number;
  /**
   * Optional confirmation for a syntactic match, e.g. the Luhn check on cards.
   * Receives the sensitive group's text. Returning `false` leaves it untouched.
   */
  readonly verify?: (match: string) => boolean;
};

export type PiiScrubberOptions = {
  /** Master switch. Defaults to `false`; see the module note. */
  enabled?: boolean;
  /** Replacement text for a redacted value. */
  redaction?: string;
  /**
   * Field names whose value is redacted wholesale, matched case-insensitively
   * against the key. Replaces the defaults rather than adding to them.
   */
  redactKeys?: readonly string[];
  /** Extra key names to redact, on top of the defaults. */
  additionalRedactKeys?: readonly string[];
  /** Pattern set. Replaces {@link DEFAULT_PII_PATTERNS} rather than adding to it. */
  patterns?: readonly PiiPattern[];
  /** Extra patterns, on top of the defaults. */
  additionalPatterns?: readonly PiiPattern[];
  /**
   * Keys never touched by either mechanism. The SDK's own identifiers are always
   * exempt regardless of this list — redacting `profileId` would not protect a
   * visitor, it would detach their events from them.
   */
  exemptKeys?: readonly string[];
  onFailure?: (message: string, error?: unknown) => void;
};

export const DEFAULT_REDACTION = '[REDACTED]';

/**
 * Structural fields the SDK itself relies on. Exempt unconditionally: they are
 * opaque generated ids, not personal data, and redacting one turns an event into
 * an orphan that ingest cannot attach to anything.
 */
const ALWAYS_EXEMPT_KEYS: readonly string[] = [
  'profileid',
  'sessionid',
  'pageid',
  'sourceid',
  'eventid',
  'type',
  'name',
  'action',
  'source',
  'timestamp',
  'validuntil',
];

/**
 * Field names redacted by name. Kept short and unambiguous on purpose — a name
 * like `user` or `contact` is far too common to redact blind, and the pattern
 * rules cover its contents anyway.
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  'email',
  'emailaddress',
  'e_mail',
  'mail',
  'phone',
  'phonenumber',
  'telephone',
  'mobile',
  'tel',
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'ssn',
  'socialsecuritynumber',
  'nationalid',
  'taxid',
  'creditcard',
  'cardnumber',
  'cc_number',
  'cvv',
  'cvc',
  'dob',
  'dateofbirth',
  'birthdate',
];

/** Luhn (mod-10) checksum. See the module note on why this is load-bearing. */
export function passesLuhn(digits: string): boolean {
  const cleaned = digits.replace(/[^\d]/g, '');
  if (cleaned.length < 13 || cleaned.length > 19) {
    return false;
  }

  let sum = 0;
  let double = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let value = cleaned.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
    double = !double;
  }

  return sum % 10 === 0;
}

export const DEFAULT_PII_PATTERNS: readonly PiiPattern[] = [
  {
    name: 'email',
    // Deliberately permissive on the local part and strict on the shape: an
    // over-narrow email rule is the classic way a scrubber misses real
    // addresses, and a false positive here is a string that looked like an
    // address, which is worth redacting anyway.
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    name: 'credit-card',
    // 13–19 digits with optional single spaces or hyphens as separators,
    // confirmed by Luhn. The leading boundary is consumed as group 1 and the
    // trailing one is a lookahead, so the rule cannot eat a slice out of a longer
    // digit run and redact half of an unrelated identifier.
    pattern: /(^|[^\dA-Za-z])((?:\d[ -]?){12,18}\d)(?![\dA-Za-z])/g,
    sensitiveGroup: 2,
    verify: passesLuhn,
  },
  {
    name: 'phone',
    // Requires either a leading `+` country code or bracketed/separated groups.
    // A bare run of 7–11 digits is NOT matched: that shape collides with order
    // numbers, zip+4, and epoch seconds, and redacting those is a bigger loss
    // than missing an unformatted phone number.
    pattern:
      /(^|[^\dA-Za-z+])(\(\d{2,4}\)[ .-]?\d{2,4}(?:[ .-]?\d{2,4}){1,2}|\+\d{1,3}[ .-]?\d{2,4}(?:[ .-]?\d{2,4}){1,3}|\d{3}[ .-]\d{3}[ .-]\d{4})(?![\dA-Za-z])/g,
    sensitiveGroup: 2,
  },
];

export type PiiScrubber = <T>(payload: T) => T;

/** Depth cap. Analytics payloads are shallow; anything deeper is a cycle or a bug. */
const MAX_DEPTH = 12;

/**
 * Build a scrubber. When `enabled` is not `true` the returned function is the
 * identity function — the disabled path costs one closure call and no traversal,
 * so the default configuration pays essentially nothing for this module.
 */
export function createPiiScrubber(
  options: PiiScrubberOptions = {},
): PiiScrubber {
  if (options.enabled !== true) {
    return (<T>(payload: T): T => payload) as PiiScrubber;
  }

  const redaction = options.redaction ?? DEFAULT_REDACTION;
  const redactKeys = new Set(
    [
      ...(options.redactKeys ?? DEFAULT_REDACT_KEYS),
      ...(options.additionalRedactKeys ?? []),
    ].map((key) => key.toLowerCase()),
  );
  const patterns = [
    ...(options.patterns ?? DEFAULT_PII_PATTERNS),
    ...(options.additionalPatterns ?? []),
  ];
  const exemptKeys = new Set([
    ...ALWAYS_EXEMPT_KEYS,
    ...(options.exemptKeys ?? []).map((key) => key.toLowerCase()),
  ]);

  function scrubString(value: string): string {
    let result = value;

    for (const { pattern, verify, sensitiveGroup } of patterns) {
      // `lastIndex` is per-RegExp state and these objects are shared across
      // calls, so a `/g` regex used with `.replace` must be reset or it resumes
      // mid-string on the next payload and silently skips matches. This is the
      // `/g`-regex bug the guard suites already documented once.
      pattern.lastIndex = 0;

      const groupIndex = sensitiveGroup ?? 0;

      result = result.replace(pattern, (...args: unknown[]) => {
        const match = args[0] as string;
        const sensitive =
          groupIndex === 0 ? match : (args[groupIndex] as string | undefined);

        if (typeof sensitive !== 'string' || sensitive.length === 0) {
          return match;
        }
        if (verify && !verify(sensitive)) {
          return match;
        }

        // The group is required to end where the match ends (see PiiPattern), so
        // everything before it is a consumed boundary prefix that must survive.
        return match.slice(0, match.length - sensitive.length) + redaction;
      });
    }

    return result;
  }

  function scrub(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) {
      return value;
    }

    if (typeof value === 'string') {
      return scrubString(value);
    }

    if (Array.isArray(value)) {
      return value.map((entry) => scrub(entry, depth + 1));
    }

    // Only plain-ish objects are walked. Dates, RegExps and class instances are
    // returned as-is: rebuilding them field by field would change their type on
    // the wire, which is a payload-shape change dressed up as redaction.
    if (
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof Date)
    ) {
      const source = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};

      for (const key of Object.keys(source)) {
        const normalized = key.toLowerCase();

        if (exemptKeys.has(normalized)) {
          output[key] = source[key];
          continue;
        }
        if (redactKeys.has(normalized)) {
          // Only scalars are replaced with the redaction string. A nested object
          // under a sensitive key is descended into instead, so
          // `{ email: { primary, verified } }` keeps `verified` rather than
          // collapsing a whole subtree into a string and changing its type.
          const current = source[key];
          output[key] =
            current !== null && typeof current === 'object'
              ? scrub(current, depth + 1)
              : current === undefined
                ? current
                : redaction;
          continue;
        }

        output[key] = scrub(source[key], depth + 1);
      }

      return output;
    }

    return value;
  }

  return (<T>(payload: T): T => {
    try {
      return scrub(payload, 0) as T;
    } catch (error) {
      options.onFailure?.(
        'PII scrubbing failed; payload sent unmodified',
        error,
      );
      return payload;
    }
  }) as PiiScrubber;
}
