import { describe, expect, it } from 'vitest';
import { SessionTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/sessionTracker/sessionTracker.module.ts';

// INT-7446 (CONTRACT-R2 §S5): when a session opens, "Session start" is enqueued before the event
// that opened it. IntemptJs reads the ids (touch) and dispatches the event in the same task, so
// the Session start must be dispatched inside touch(), not after an await.
describe('Session start order (INT-7446)', () => {
  it('dispatches Session start synchronously, before the opening event', () => {
    const order: string[] = [];
    const onSession = () => order.push('Session start');
    document.addEventListener('intempt:session', onSession);
    try {
      const tracker = new SessionTrackerModule();
      tracker.touch('Clicked');
      order.push('Clicked');
      expect(order).toEqual(['Session start', 'Clicked']);
      expect(tracker.getId()).toBeTruthy();
    } finally {
      document.removeEventListener('intempt:session', onSession);
    }
  });
});
