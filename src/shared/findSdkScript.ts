import { EnvConfig } from './envConfig.ts';

/**
 * Locate the SDK's own `<script>` tag — the one whose `src` points at the CDN
 * link this build was configured with.
 *
 * The script URL is the SDK's only configuration surface (there is no
 * constructor in the supported embed), and two layers need to read it at
 * different times: the guard layer in `main.ts`, before anything else runs, and
 * `sdkLoader.getIntemptConfig()`, once the guards have allowed the load. One
 * lookup, used by both, so the discovery rule cannot drift between them.
 *
 * Returns `null` when no matching tag exists. The caller decides what that
 * means — the loader logs "CAN'T FIND SCRIPT", the guard flags fall back to
 * their defaults.
 */
export function findSdkScript(
  doc: Document = document,
): HTMLScriptElement | null {
  const cdnLink = EnvConfig.getCdnLink();
  return Array.from(doc.scripts).find((s) => s.src.includes(cdnLink)) ?? null;
}
