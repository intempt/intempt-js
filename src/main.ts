import { AutoTrackerModule } from './modules/autoTracker/autoTracker.module.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts';
import { PageTrackerModule } from './modules/pagesTracker/pagesTracker.module.ts';

const sessionTrackerModule = new SessionTrackerModule();
const autoTrackerModule = new AutoTrackerModule();
const pagesTrackerModule = new PageTrackerModule();

sessionTrackerModule.init();
autoTrackerModule.init();
pagesTrackerModule.init();
console.log(document.links);
