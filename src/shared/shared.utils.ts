import { v4 as uuidv4 } from 'uuid';



export function generateId() {
  return uuidv4();
}

export async function getLocationInfo():Promise<{ip: string, region: string, city: string, country: string}>{
  const locationApiUrl = 'https://ipapi.co/json/'

  try {
    const response = await fetch(locationApiUrl)
    const data = await response.json()
    const {ip, region, city, country } = data
    return {
      ip: ip ?? '',
      region: region ?? '',
      city: city ?? '',
      country: country ?? '',
    }
  } catch (error) {
    console.log('Error fetching location information:', error)
    return {
      ip: '',
      region: '',
      city: '',
      country: '',
    }
  }
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
