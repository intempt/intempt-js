import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts';

const autoTrackerModule = new AutoTrackerModule();
const sessionTrackerModule = new SessionTrackerModule();

autoTrackerModule.init();
sessionTrackerModule.init();
