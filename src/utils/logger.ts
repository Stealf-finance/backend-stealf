/**
 * Returns the raw error message in non-production environments,
 * or a generic 'Internal server error' string in production.
 * Use in 5xx catch blocks to prevent leaking stack traces or file paths.
 */
export function stripProdError(message: string | undefined): string {
  if (process.env.NODE_ENV === 'production') return 'Internal server error';
  return message ?? 'Internal server error';
}
