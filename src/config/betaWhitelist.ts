/**
 * Beta whitelist — only these emails can register/sign in during beta.
 * Add or remove emails here to control access.
 */
export const BETA_WHITELIST: string[] = [
  // Add beta tester emails here:
  // "user@example.com",
];

export function isBetaAllowed(email: string): boolean {
  return BETA_WHITELIST.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}
