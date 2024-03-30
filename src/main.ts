import { IntemptJs } from './intemptJs/intemptJs.ts'

declare global { interface Window { intempt: IntemptJs; } }

//"intempt-demo"
//"saas-demo"
//"496392441735024640"
//"9dfc6897a9934274acf8fb7236698ba0.12410a7599ee49528a898ff2764841a9"

window.intempt = new IntemptJs();

