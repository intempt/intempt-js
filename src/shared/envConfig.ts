/**
 * Environment Configuration Utility
 * 
 * Centralized management of environment variables that can be initialized
 * from Vite's import.meta.env (production builds) or custom values (tests).
 * 
 * Usage:
 *   - Production: EnvConfig.initFromVite() (auto-initialized)
 *   - Tests: EnvConfig.initFromValues({ VITE_API: '...', ... })
 *   - Access: EnvConfig.getApi(), EnvConfig.getEnv(), etc.
 */

export interface EnvConfig {
  readonly VITE_API: string;
  readonly VITE_CDN_LINK: string;
  readonly VITE_ENV: string;
  readonly VITE_CHOICES_API: string;
  readonly VITE_WEB_EDITOR_BASE_LINK: string;
  readonly VITE_OPENER_LINK: string;
  readonly VITE_WEB_EDITOR_STORAGE_KEY: string;
  readonly VITE_LOCATION_API_URL: string;
  readonly DEV: boolean;
}

class EnvConfigManager {
  private static instance: EnvConfig | null = null;
  private static readonly DEFAULT_CONFIG: EnvConfig = {
    VITE_API: '',
    VITE_CDN_LINK: '',
    VITE_ENV: 'production',
    VITE_CHOICES_API: '',
    VITE_WEB_EDITOR_BASE_LINK: '',
    VITE_OPENER_LINK: '',
    VITE_WEB_EDITOR_STORAGE_KEY: '',
    VITE_LOCATION_API_URL: '',
    DEV: false,
  };

  /**
   * Initialize from Vite's import.meta.env (used in production builds)
   */
  static initFromVite(): void {
    // Check if import.meta.env is available
    // We access it directly in try-catch since 'import' is a reserved keyword
    let viteEnv: any = null;
    try {
      // @ts-ignore - import.meta is a special syntax that TypeScript/webpack handles
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (import.meta && import.meta.env) {
        // @ts-ignore
        viteEnv = import.meta.env;
      }
    } catch {
      // import.meta not available (e.g., in test environments)
    }

    if (!viteEnv) {
      console.warn('[EnvConfig] import.meta.env not available, using defaults');
      this.instance = { ...this.DEFAULT_CONFIG };
      return;
    }
    this.instance = {
      VITE_API: viteEnv.VITE_API || this.DEFAULT_CONFIG.VITE_API,
      VITE_CDN_LINK: viteEnv.VITE_CDN_LINK || this.DEFAULT_CONFIG.VITE_CDN_LINK,
      VITE_ENV: viteEnv.VITE_ENV || this.DEFAULT_CONFIG.VITE_ENV,
      VITE_CHOICES_API: viteEnv.VITE_CHOICES_API || this.DEFAULT_CONFIG.VITE_CHOICES_API,
      VITE_WEB_EDITOR_BASE_LINK: viteEnv.VITE_WEB_EDITOR_BASE_LINK || this.DEFAULT_CONFIG.VITE_WEB_EDITOR_BASE_LINK,
      VITE_OPENER_LINK: viteEnv.VITE_OPENER_LINK || this.DEFAULT_CONFIG.VITE_OPENER_LINK,
      VITE_WEB_EDITOR_STORAGE_KEY: viteEnv.VITE_WEB_EDITOR_STORAGE_KEY || this.DEFAULT_CONFIG.VITE_WEB_EDITOR_STORAGE_KEY,
      VITE_LOCATION_API_URL: viteEnv.VITE_LOCATION_API_URL || this.DEFAULT_CONFIG.VITE_LOCATION_API_URL,
      DEV: viteEnv.DEV !== undefined ? viteEnv.DEV : this.DEFAULT_CONFIG.DEV,
    };
  }

  /**
   * Initialize with custom values (used in tests)
   */
  static initFromValues(config: Partial<EnvConfig>): void {
    this.instance = {
      ...this.DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Get the full environment configuration
   * Auto-initializes with defaults if not initialized (allows safe evaluation during bundling)
   * Tests should call initFromValues() in support/index.ts to override with test values
   */
  static get(): EnvConfig {
    if (!this.instance) {
      // Auto-initialize with defaults to allow safe evaluation during webpack bundling
      // Tests will override this by calling initFromValues() in support/index.ts
      this.instance = { ...this.DEFAULT_CONFIG };
    }
    return this.instance;
  }

  /**
   * Check if EnvConfig has been initialized
   */
  static isInitialized(): boolean {
    return this.instance !== null;
  }

  /**
   * Reset the instance (useful for tests)
   */
  static reset(): void {
    this.instance = null;
  }

  // Individual getters for convenience
  static getApi(): string {
    return this.get().VITE_API;
  }

  static getCdnLink(): string {
    return this.get().VITE_CDN_LINK;
  }

  static getEnv(): string {
    return this.get().VITE_ENV;
  }

  static getChoicesApi(): string {
    return this.get().VITE_CHOICES_API;
  }

  static getWebEditorBaseLink(): string {
    return this.get().VITE_WEB_EDITOR_BASE_LINK;
  }

  static getOpenerLink(): string {
    return this.get().VITE_OPENER_LINK;
  }

  static getWebEditorStorageKey(): string {
    return this.get().VITE_WEB_EDITOR_STORAGE_KEY;
  }

  static getLocationApiUrl(): string {
    return this.get().VITE_LOCATION_API_URL;
  }

  static isDev(): boolean {
    return this.get().DEV;
  }

  /**
   * Check if current environment is production
   */
  static isProduction(): boolean {
    return this.getEnv() === 'production';
  }

  /**
   * Check if current environment is development
   */
  static isDevelopment(): boolean {
    return this.getEnv() === 'development';
  }

  /**
   * Check if current environment is staging
   */
  static isStaging(): boolean {
    return this.getEnv() === 'staging';
  }
}

// Auto-initialize from Vite if available (for production builds)
// This runs when the module is first imported
try {
  // @ts-ignore - import.meta is a special syntax that TypeScript/webpack handles
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (import.meta && import.meta.env) {
    EnvConfigManager.initFromVite();
  }
} catch {
  // Silently fail if initialization fails (will use defaults)
  // This is expected in test environments where import.meta.env might not be available
}

export const EnvConfig = EnvConfigManager;
