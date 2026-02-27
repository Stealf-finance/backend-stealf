/**
 * Production-safe logging utilities.
 *
 * devLog()      — equivalent to console.log(), silenced in production.
 * stripProdError() — masks internal error details in production 5xx responses.
 *
 * Requirements: 13.2, 13.3, 13.4
 */

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Logs to console only outside of production.
 * Use instead of console.log() for any output containing wallet addresses,
 * transaction signatures, MongoDB IDs, or other sensitive operational data.
 */
export function devLog(...args: unknown[]): void {
  if (!isProd()) {
    console.log(...args);
  }
}

/**
 * Returns the raw error message in non-production environments,
 * or a generic 'Internal server error' string in production.
 * Use in 5xx catch blocks to prevent leaking stack traces or file paths.
 */
export function stripProdError(message: string | undefined): string {
  if (isProd()) return 'Internal server error';
  return message ?? 'Internal server error';
}
