/**
 * Read a boolean from a script-URL query parameter.
 *
 * A real boolean parse, rather than the `!!searchParams.get(name)` idiom this
 * replaced everywhere it appeared (D-17). That shorthand treated `?shopify=false`
 * as **true**, because any non-empty string is truthy — including the literal
 * text "false". Fixed to a single shared helper so every boolean query
 * parameter — `shopify`, `magento`, and the privacy switches — parses the same
 * way; the privacy switches were the first to get this treatment, since
 * `?ignore_dnt=false` silently meaning "ignore the visitor's Do Not Track
 * signal" is the kind of default that ends up in a regulator's finding.
 */
export function readBooleanParam(
  params: URLSearchParams,
  name: string,
): boolean | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;

  const normalized = raw.trim().toLowerCase();
  if (
    normalized === '' ||
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes'
  ) {
    // A bare `?ignore_dnt` with no value reads as opting in to the flag, which is
    // how HTML boolean attributes behave and therefore what an author expects.
    return true;
  }
  return false;
}
