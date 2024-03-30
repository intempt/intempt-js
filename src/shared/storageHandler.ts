import { SetCookieParams } from '../intemptJs/modules/autoTracker/autoTracker.types.ts';


export function setCookie({name, value, path, maxAge}:SetCookieParams){
   const cookieValue = `${name}=${value};`;
   const cookiePath = ` path=${path};`;
   const expires = maxAge ?
    ` expires=${new Date(Date.now() + maxAge).toUTCString()};`
    :'';
  document.cookie = `${cookieValue}${expires}${cookiePath}`;
  return {[name]: value}
}

export function getCookie(name:string){
  const cookies = document.cookie.split(';');
  const cookie = cookies.find(cookie => cookie.includes(name));

  return !!cookie
    ? cookie
      .split(';')
      .map(chunk => chunk.trim().split('='))
      .reduce((acc, [key, value]) => ({...acc, [key]: value}), {})
    : null;
}


