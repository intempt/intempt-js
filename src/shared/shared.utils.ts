
import { IdType } from '../intemptJs/types/intemptJs.types.ts';

function generateUniqueId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const timestamp = new Date().getTime().toString(36).split('');
  const shuffledTimestamp = timestamp.slice().sort(() => Math.random() - 0.5);
  const timestampNum = new Date().getTime();
  let id = '';

  for (let i = 0; i < 10; i++) {
    const char = i < shuffledTimestamp.length ? shuffledTimestamp[i] : alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    id += char;
  }

  return `${timestamp.join('')}_${timestampNum}_${id}`;
}

export function generateId(type?: IdType) {
  const uuid = generateUniqueId();
  return !!type
    ? `${type}_${uuid}`
    : uuid;

}

export function dispatchIntemptEvent( eventName: string, data = {}){
  const event = new CustomEvent(eventName, {
    bubbles: true,
    cancelable: true,
    detail: data
  });

  document.dispatchEvent(event);
}

export function debounce(func: Function, wait: number) {
  let timeout: ReturnType<typeof setTimeout>;

  return function (...args:any)   {
    if(!!timeout)  clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }
}
