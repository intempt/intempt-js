import { IntemptJs } from './intemptJs/intemptJs.ts';

declare global {
  interface Window { intempt: IntemptJs; }
  interface ImportMeta {
    readonly env: {
      readonly VITE_ENV: string;
      readonly VITE_API: string;
      readonly VITE_CDN_LINK: string;

    };
  }
}


