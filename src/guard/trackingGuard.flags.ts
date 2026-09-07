import { EnvConfig } from '../shared/envConfig.ts';
import { readBooleanParam } from '../shared/readBooleanParam.ts';

/**
 * `?allow_bots=1` on the SDK script URL disables the crawler/bot guard.
 *
 * Read here, not in `sdkLoader.getIntemptConfig()`, because the guards run in
 * `main.ts` *before* the loader exists — by the time `IntemptConfig` is built the
 * decision to load at all has already been made. Same mechanism as `ignore_dnt`
 * and `pii_scrubbing`: the script URL is the only configuration surface the
 * supported embed has.
 *
 * Off by default. A bot that gets past the guard receives a full SDK footprint
 * (cookie, profile, events), so this is for sites that want SEO-crawler renders
 * or synthetic monitors counted on purpose. When the script tag cannot be found
 * the answer is `false`, i.e. bots stay blocked — the loader will report
 * "CAN'T FIND SCRIPT" on its own.
 */
export function readAllowBotsFlag(doc: Document = document): boolean {
  const cdnLink = EnvConfig.getCdnLink();
  const script = Array.from(doc.scripts).find((s) => s.src.includes(cdnLink));
  if (!script) return false;
  return readBooleanParam(new URL(script.src).searchParams, 'allow_bots') ?? false;
}
