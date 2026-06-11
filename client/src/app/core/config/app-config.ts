/**
 * Runtime configuration. The backend origin is resolved from the current host
 * so the same build works on localhost (dev) and GitHub Pages (production).
 *
 * When deploying the SPA to GitHub Pages, set PRODUCTION_API_ORIGIN to your
 * DigitalOcean Droplet backend URL.
 */
const PRODUCTION_API_ORIGIN = 'http://157.230.177.68';
const DEV_API_ORIGIN = 'http://localhost:5058';

function resolveApiOrigin(): string {
  if (typeof window === 'undefined') {
    return DEV_API_ORIGIN;
  }
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return isLocal ? DEV_API_ORIGIN : PRODUCTION_API_ORIGIN;
}

const apiOrigin = resolveApiOrigin();

export const APP_CONFIG = {
  apiOrigin,
  apiUrl: `${apiOrigin}/api`,
  hubUrl: `${apiOrigin}/hubs/chat`,
} as const;
