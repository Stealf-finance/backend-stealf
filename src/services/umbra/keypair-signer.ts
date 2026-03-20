/**
 * Adaptateur de signature pour convertir un Keypair Solana en IUmbraSigner du SDK.
 * Utilise createSignerFromPrivateKeyBytes du SDK pour rester compatible avec les
 * évolutions de l'interface IUmbraSigner.
 * Requirements: 1.4, 4.3
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IUmbraSigner = any;

/**
 * Crée un IUmbraSigner (SDK Umbra) depuis les 64 bytes d'un secretKey Solana.
 * Accepte directement un Uint8Array pour éviter la validation Keypair.fromSecretKey
 * sur des bytes de test ou de mock.
 */
export async function createUmbraSignerFromKeypair(secretKey: Uint8Array): Promise<IUmbraSigner> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createSignerFromPrivateKeyBytes } = require('@umbra-privacy/sdk');
  return createSignerFromPrivateKeyBytes(secretKey);
}
