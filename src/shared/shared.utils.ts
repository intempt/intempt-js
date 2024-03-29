import { v4 as uuidv4 } from 'uuid';
import { getCookie } from './storageHandler.ts'


export function generateId() {
  return uuidv4();
}


export function getSessionId(){
  const key = 'sessionId';

  const cookie = getCookie(key)! as {sessionId : string};
  const sessionIdObject = { ...JSON.parse(cookie[key]) };

  return sessionIdObject.id;
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
