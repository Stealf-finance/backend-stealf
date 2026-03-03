/**
 * CORS configuration — shared between Express and Socket.IO.
 *
 * In production only the origins listed in FRONTEND_URL (comma-separated) are
 * allowed.  In development common localhost origins are added automatically.
 */

const isDev = process.env.NODE_ENV !== 'production';

function getAllowedOrigins(): string[] | true {
  // Dev: accept all origins (React Native on physical devices sends no Origin
  // header or connects from local network IPs like 192.168.x.x)
  if (isDev) return true;

  const origins: string[] = [];

  if (process.env.FRONTEND_URL) {
    const parsed = process.env.FRONTEND_URL
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    origins.push(...parsed);
  }

  return origins;
}

export const allowedOrigins = getAllowedOrigins();
