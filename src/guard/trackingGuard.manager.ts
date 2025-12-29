import { GuardConfig, GuardContext, GuardResult, GuardCondition } from './trackingGuard.types.ts';

export class TrackingGuardManager {
  private _guards: Map<string, GuardConfig> = new Map();
  private _enabled: boolean = true;

  /**
   * Register a guard condition
   */
  register(guard: GuardConfig): void {
    if (!guard.id || guard.id.trim().length === 0) {
      throw new Error('Guard ID is required');
    }

    if (!guard.condition || typeof guard.condition !== 'function') {
      throw new Error('Guard condition function is required');
    }

    this._guards.set(guard.id, {
      ...guard,
      enabled: guard.enabled !== false, // Default to enabled
    });
  }

  /**
   * Unregister a guard condition
   */
  unregister(guardId: string): boolean {
    return this._guards.delete(guardId);
  }

  /**
   * Check if a guard is registered
   */
  hasGuard(guardId: string): boolean {
    return this._guards.has(guardId);
  }

  /**
   * Enable/disable a specific guard
   */
  setGuardEnabled(guardId: string, enabled: boolean): void {
    const guard = this._guards.get(guardId);
    if (guard) {
      guard.enabled = enabled;
    }
  }

  /**
   * Enable/disable all guards
   */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  /**
   * Check if guards are enabled
   */
  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Clear all guards
   */
  clear(): void {
    this._guards.clear();
  }

  /**
   * Get all registered guards
   */
  getGuards(): GuardConfig[] {
    return Array.from(this._guards.values());
  }

  /**
   * Evaluate guards against context
   * Returns GuardResult with blocked=true if SDK should not initialize
   */
  async evaluate(context: GuardContext): Promise<GuardResult> {
    // If guards are disabled, allow initialization
    if (!this._enabled) {
      return { blocked: false };
    }

    // If no guards registered, allow initialization
    if (this._guards.size === 0) {
      return { blocked: false };
    }

    // Get enabled guards only
    const enabledGuards = Array.from(this._guards.values())
      .filter(guard => guard.enabled !== false);

    if (enabledGuards.length === 0) {
      return { blocked: false };
    }

    // Check all guards - if any blocks, return blocked
    for (const guard of enabledGuards) {
      try {
        const shouldBlock = await guard.condition(context);
        if (shouldBlock === true) {
          return {
            blocked: true,
            guardId: guard.id,
            reason: guard.description || `Blocked by guard: ${guard.id}`
          };
        }
      } catch (error) {
        // Log error but continue checking other guards
        try {
          if (import.meta.env?.VITE_ENV !== 'production') {
            console.error(`[TrackingGuard] Error evaluating guard ${guard.id}:`, error);
          }
        } catch {
          // If import.meta.env is not available (e.g., in tests), just continue
          // Error is already caught, we just skip logging
        }
      }
    }

    return { blocked: false };
  }
}

