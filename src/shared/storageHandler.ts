import { SetCookieParams } from '../intemptJs/types/autoTracker.types.ts';
import { LocalStorageCache } from '../intemptJs/types/intemptJs.types.ts';


const appLocalCookie:{[key:string]:any}= {};

export const localIntemptSessionCookie = () => !!appLocalCookie['intempt_session']
  ? JSON.parse(appLocalCookie['intempt_session'])
  : null;

export const localIntemptPageSessionCookie = () => !!appLocalCookie['intempt_session']
  ? JSON.parse(appLocalCookie['page_session'])
  : null;

export const localIntemptSessionInitializerName = () => {
  return appLocalCookie['session_initializer_name'] ?? ''
}

export function setCookie({name, value, path, expiration}:SetCookieParams){

   const cookieValue = `${name}=${value};`;
   const cookiePath = `path=${path};`;
   const expires = expiration ?
    `expires=${new Date(Date.now() + expiration).toUTCString()};`
    :'';
  document.cookie = `${cookieValue}${expires}${cookiePath}`;
  appLocalCookie[name] = value;

  return {[name]: value}
}

export function getCookie(name:string){
  const cookies = document.cookie.split(';');
  const cookie = cookies.find(
    cookie => cookie.trim().startsWith(name + '=')
  );

  if (!cookie) return null;

  const firstEqualIndex = cookie.indexOf('=');
  const key = cookie.substring(0, firstEqualIndex).trim();
  const value = cookie.substring(firstEqualIndex + 1).trim();

  if (key !== name.trim()) return null;


  return { [name]: decodeURIComponent(value) };

}

export const localStorageCache: LocalStorageCache = {
  get: (key: string): any => {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  },
  set: (key: string, value: any): void => localStorage.setItem(key, JSON.stringify(value)),
  remove: (key: string): void => localStorage.removeItem(key),
  getAllKeys: (): string[] => Object.keys(localStorage),
  clear: (): void => localStorage.clear()
};

