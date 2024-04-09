import { SetCookieParams } from '../intemptJs/types/autoTracker.types.ts';
import { LocalStorageCache } from '../intemptJs/types/intemptJs.types.ts';


export function setCookie({name, value, path, expiration}:SetCookieParams){
   const cookieValue = `${name}=${value};`;
   const cookiePath = ` path=${path};`;
   const expires = expiration ?
    ` expires=${new Date(Date.now() + expiration).toUTCString()};`
    :'';
  document.cookie = `${cookieValue}${expires}${cookiePath}`;
  return {[name]: value}
}

export function getCookie(name:string){
  const cookies = document.cookie.split(';');
  const cookie = cookies.find(
    cookie => cookie.trim().split('=')[0] === name
  );

  return !!cookie
    ? cookie
      .split(';')
      .map(chunk => chunk.trim().split('='))
      .reduce((acc, [key, value]) => ({...acc, [key]: value}), {})
    : null;
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

