

type setCookieParams = {
    name: string,
    value: string,
    path: string,
    maxAge: number,
}


export function setCookie({name, value, path, maxAge}:setCookieParams){
  const expires = new Date(Date.now() + maxAge).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=${path};`;
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


