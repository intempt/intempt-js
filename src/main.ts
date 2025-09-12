import { SDK } from './loaders/sdkLoader.ts';
import { WEB_EDITOR } from './loaders/webEditorLoader.ts';


(()=> {
  const qs = new URLSearchParams(location.search);
  const openerOrigin = (qs.get('openerOrigin') || '').replace(/\/+$/, '');
  const channel      = qs.get('channel') || '';
  const cameFromOpener = Boolean(openerOrigin && channel);

  if(import.meta.env.VITE_ENV !== 'production') {
    console.log('ENVIRONMENT ',import.meta.env.VITE_ENV);
    console.log('version:', 'v6.0');
    console.log('cameFromOpener',cameFromOpener);
  }
  if (cameFromOpener) {
    WEB_EDITOR.init();
  } else {
    SDK.init();
  }
})()


