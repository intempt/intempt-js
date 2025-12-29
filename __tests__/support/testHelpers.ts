/**
 * Test helper utilities for Cypress tests
 */

export function clearCookies() {
  document.cookie.split(";").forEach(c => {
    document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });
}

export function setCookie(name: string, value: string, path: string = '/') {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=${path}`;
}

export function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export function mockWindowLocation(href: string) {
  delete (window as any).location;
  (window as any).location = { 
    href,
    hostname: new URL(href).hostname,
    pathname: new URL(href).pathname,
    search: new URL(href).search,
    hash: new URL(href).hash,
    origin: new URL(href).origin
  };
}

export function restoreWindowLocation() {
  // Restore original location
  (window as any).location = location;
}

