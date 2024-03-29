import { IntemptJs } from './modules/intemptJs/intemptJs.ts'

import { PageTrackerModule } from './modules/autoTracker/modules/pagesTracker/pagesTracker.module.ts';


const pagesTrackerModule = new PageTrackerModule();



pagesTrackerModule.init();

const intemptJs = new IntemptJs();

console.log(intemptJs)



