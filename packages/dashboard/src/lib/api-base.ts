export const DEV_API_BASE_URL = 'http://127.0.0.1:9100';

export function getApiBaseUrl(): string {
  if (import.meta.env.DEV) {
    return DEV_API_BASE_URL;
  }
  return '';
}
