import { z } from 'zod';

/**
 * Zod schema for environment variable validation.
 *
 * All env vars used across the codebase are declared here so that the
 * application crashes immediately at boot time with a clear error message
 * if any required variable is missing or malformed.
 */
const envSchema = z.object({
  // ── Required ──────────────────────────────────────────────────────
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  HELIUS_API_KEY: z.string().min(1, 'HELIUS_API_KEY is required'),
  WEBHOOK_URL: z.string().url('WEBHOOK_URL must be a valid URL'),
  HELIUS_WEBHOOK_SECRET: z.string().min(1, 'HELIUS_WEBHOOK_SECRET is required'),
  SOLANA_RPC_URL: z.string().url('SOLANA_RPC_URL must be a valid URL'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL'),

  // ── Optional with defaults ────────────────────────────────────────
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  BACKEND_URL: z.string().default('http://localhost:5000'),
  COINGECKO_URL: z.string().default(''),

  // ── Helius webhooks ───────────────────────────────────────────────
  HELIUS_WEBHOOK_ID: z.string().min(1, 'HELIUS_WEBHOOK_ID is required'),
  HELIUS_VAULT_WEBHOOK_ID: z.string().min(1, 'HELIUS_VAULT_WEBHOOK_ID is required'),

  // ── Optional (no defaults, used when present) ─────────────────────
  JUPITER_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  EMAIL_FROM: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

/**
 * Validated and typed environment variables.
 *
 * Import this object anywhere you need an env var instead of reaching
 * for `process.env` directly.  The parse call runs synchronously at
 * import time — if validation fails the process exits with a readable
 * error listing every missing / invalid variable.
 */
function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('========================================');
    console.error('  ENV VALIDATION FAILED');
    console.error('  Fix the following issues before starting the server:');
    console.error('========================================');

    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }

    console.error('========================================');
    process.exit(1);
  }

  return result.data;
}

export const env = parseEnv();

/** TypeScript type derived from the schema for use elsewhere. */
export type Env = z.infer<typeof envSchema>;
