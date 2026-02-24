/**
 * CORS configuration — shared between Express and Socket.IO.
 *
 * In production only the origins listed in FRONTEND_URL (comma-separated) are
 * allowed.  In development common localhost origins are added automatically.
 */

function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.FRONTEND_URL) {
    const parsed = process.env.FRONTEND_URL
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    origins.push(...parsed);
  }

  if (process.env.NODE_ENV !== 'production') {
    const devOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8081',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8081',
    ];
    for (const devOrigin of devOrigins) {
      if (!origins.includes(devOrigin)) {
        origins.push(devOrigin);
      }
    }
  }

  return origins;
}

export const allowedOrigins = getAllowedOrigins();
