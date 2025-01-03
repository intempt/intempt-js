import { IntemptJs } from './intemptJs/intemptJs.ts'
import { IntemptConfig } from './intemptJs/types/intemptJs.types.ts';


if(import.meta.env.VITE_ENV !== 'production') {
  console.log('ENVIRONMENT ',import.meta.env.VITE_ENV);
  console.log('version:', 'v5.9');
}


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


window.intempt = new IntemptJs({...getIntemptConfig()});
