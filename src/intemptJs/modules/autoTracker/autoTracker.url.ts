import { IntemptConfig } from '../../types/intemptJs.types.ts';

/**
 * Build the `/track` URL both auto-tracker send paths post to.
 *
 * `?ip=1` asks the platform to derive country/region/city from the address the
 * request already arrives on; `?ip=0` when the customer has set
 * `useIpAddressForGeolocation: false`. Written once so the two send sites
 * (`autoTracker.eventPool.ts` and `autoTracker.transport.ts`) cannot drift.
 */
export function buildTrackUrl(api: string, config: IntemptConfig): string {
  const { organization, sourceId, project } = config;
  const ip = config.useIpAddressForGeolocation === false ? '0' : '1';

  return `${api}/${organization}/projects/${project}/sources/${sourceId}/track?ip=${ip}`;
}
