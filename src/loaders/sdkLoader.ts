import { IntemptConfig } from '../intemptJs/types/intemptJs.types.ts';
import { IntemptJs } from '../intemptJs/intemptJs.ts';


function getIntemptConfig(): IntemptConfig {
  const cdnLink = import.meta.env.VITE_CDN_LINK;
  const scripts = document.scripts;

  const intemptScript = Array.from(scripts).find(s => s.src.includes(cdnLink));
  if(!intemptScript) {
    console.error("CAN'T FIND SCRIPT")
    return {
      project:'',
      writeKey:'',
      sourceId:'',
      organization:'',
      shopify:false,
      magento:false
    }
  }
  const source = new URL(intemptScript.src)
  return {
    project: source.searchParams.get('project') ?? '',
    writeKey: source.searchParams.get('key') ?? '',
    sourceId: source.searchParams.get('source') ?? '',
    organization: source.searchParams.get('organization') ?? '',
    shopify: !!source.searchParams.get('shopify'),
    magento: !!source.searchParams.get('magento')
  };
}


function initSDK() {
  window.intempt = new IntemptJs({...getIntemptConfig()});
  console.log('Intempt SDK initialized', window.intempt);
}

export const SDK = {
  init: initSDK,
}
