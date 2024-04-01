import { IntemptJs } from './intemptJs/intemptJs.ts'
import { IntemptConfig } from './intemptJs/intemptJs.types.ts';


console.log('version:', 'v1');

function getIntemptConfig(): IntemptConfig {
  //const cdnLink = 'https://cdn.intempt.com/intempt.min.js';
  const cdnLink = 'https://cdn.test.com/test.min.js';
  const scripts = document.scripts;

  const intemptScript = Array.from(scripts).find(s => s.src.includes(cdnLink));

  if(!intemptScript) {
    console.error("CAN'T FIND SCRIPT")
    return {
      project:'',
      writeKey:'',
      sourceId:'',
      organization:''
    }
  }
  const source = new URL(intemptScript.src)

  return {
    project: source.searchParams.get('project') ?? '',
    writeKey: source.searchParams.get('key') ?? '',
    sourceId: source.searchParams.get('sourceId') ?? '',
    organization: source.searchParams.get('organization') ?? '',
  };
}


window.intempt = new IntemptJs({...getIntemptConfig()});


