export function isSecureContext(): boolean {
  try {
    return (
      typeof window !== 'undefined' && window.location?.protocol === 'https:'
    );
  } catch {
    return false;
  }
}
