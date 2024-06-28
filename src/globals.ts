import { IntemptJs } from './intemptJs/intemptJs.ts';

declare global {
  interface Window {
    intempt: IntemptJs;
  }

  interface NavigatorUAData {
    getHighEntropyValues(hints: string[]): Promise<Record<string, string>>;
    platform: string;
  }

  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
  interface ImportMeta {
    readonly env: {
      readonly DEV: boolean;
      readonly VITE_ENV: string;
      readonly VITE_API: string;
      readonly VITE_CHOICES_API: string;
      readonly VITE_CDN_LINK: string;
      readonly VITE_LOCATION_API_URL: string;

    };
  }
}


