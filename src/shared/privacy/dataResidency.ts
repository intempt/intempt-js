/**
 * Ingest host selection for data residency.
 *
 * ## Why this is an explicit host and not a `region` enum
 *
 * The obvious shape for this feature is `region: 'us' | 'eu'`, mapped to a table
 * of hosts. That shape was deliberately **not** built, and the reason is worth
 * keeping: **Intempt has one ingest host.** `.env.production`,
 * `.env.staging` and `.env.development` all point at `api.intempt.com/v1` (staging
 * at `api.staging.intempt.com/v1`); there is no EU endpoint to map `'eu'` to.
 *
 * A `region` enum would therefore have to either reject `'eu'` — a config option
 * whose only documented value is the default, i.e. no feature — or accept it and
 * fall back to the US host. The second is actively dangerous: a customer who sets
 * `region: 'eu'` to satisfy a GDPR commitment and has their data silently sent to
 * the United States is in a worse position than one who was told the feature does
 * not exist, because they believe they are compliant. **A residency switch that
 * can silently fail open is not a residency switch.**
 *
 * So the mechanism is an explicit `apiHost`. It is the honest version of the same
 * capability: it works the day a regional endpoint exists, needs no SDK release to
 * adopt one, and cannot misrepresent where data is going because the customer
 * names the destination. When the backend team stands up regional ingest, adding
 * the `region` shorthand on top of this is a few lines — the table is the missing
 * piece, not the plumbing. Tracked in `BACKEND.md`.
 *
 * ## Validation, and why it fails closed
 *
 * An override that does not parse, or is not https, is **ignored** in favour of
 * the build-time default. That is the one place where falling back is right rather
 * than dangerous: a typo'd host means every event 404s or is blocked as mixed
 * content, so honouring it would drop 100% of the customer's data. Falling back
 * keeps data flowing to the host they were already using — no *new* destination is
 * introduced by the failure, which is the property that matters for residency.
 */

export type IngestHostFailureReporter = (message: string) => void;

/**
 * Resolve the ingest base URL.
 *
 * @param override  `IntemptConfig.apiHost`, if the customer set one.
 * @param buildTimeDefault  `EnvConfig.getApi()`.
 */
export function resolveIngestBaseUrl(
  override: string | undefined,
  buildTimeDefault: string,
  onInvalid?: IngestHostFailureReporter,
): string {
  if (!override || typeof override !== 'string') {
    return buildTimeDefault;
  }

  const trimmed = override.trim();
  if (!trimmed) {
    return buildTimeDefault;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    onInvalid?.(`ignoring apiHost "${override}": not a valid absolute URL`);
    return buildTimeDefault;
  }

  // https only. An http ingest host is blocked as mixed content on any https page
  // — which is nearly all of them — so accepting it would produce a silent total
  // outage rather than a working-but-insecure transport.
  if (parsed.protocol !== 'https:') {
    onInvalid?.(`ignoring apiHost "${override}": must use https`);
    return buildTimeDefault;
  }

  // A trailing slash here would produce `…/v1//org/projects/…` once the callers
  // concatenate their paths. Harmless on most servers, 404 on some.
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}
