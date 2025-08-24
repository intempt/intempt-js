import { SDK } from './loaders/sdkLoader.ts';
import { WEB_EDITOR } from './loaders/webEditorLoader.ts';





(()=> {
  if(import.meta.env.VITE_ENV !== 'production') {
    console.log('ENVIRONMENT ',import.meta.env.VITE_ENV);
    console.log('version:', 'v5.9');
  }

  const qs = new URLSearchParams(location.search);
  const openerOrigin = (qs.get('openerOrigin') || '').replace(/\/+$/, '');
  const channel      = qs.get('channel') || '';

  const cameFromOpener = Boolean(openerOrigin && channel);
  if (cameFromOpener) sessionStorage.setItem('__intempt_from_opener', '1');

  if (cameFromOpener || sessionStorage.getItem('__intempt_from_opener') === '1') {
    WEB_EDITOR.init();
  } else {
    // Regular SDK path
    SDK.init();
  }
})()


