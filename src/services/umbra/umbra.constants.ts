/**
 * Constantes Umbra Mixer
 * Programme déployé sur devnet et mainnet : UMBRAkrfUTHuPAjDQXgmpoQjGGyhtqiRqWNrMroEijV
 */

export const UMBRA_PROGRAM_ID = 'UMBRAkrfUTHuPAjDQXgmpoQjGGyhtqiRqWNrMroEijV';

export const UMBRA_INDEXER_URL_DEFAULT =
  'https://acqzie0a1h.execute-api.eu-central-1.amazonaws.com';

/** Adresse mint USDC selon le réseau */
export const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** SOL natif — représenté par cette adresse de convention dans le SDK Umbra */
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export type UmbraNetwork = 'devnet' | 'mainnet';

export function getUsdcMint(network: UmbraNetwork): string {
  return network === 'mainnet' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

export function getUmbraNetwork(): UmbraNetwork {
  const raw = process.env.UMBRA_NETWORK ?? 'devnet';
  if (raw !== 'devnet' && raw !== 'mainnet') {
    throw new Error(`[UmbraMixer] Invalid UMBRA_NETWORK="${raw}" — expected "devnet" or "mainnet"`);
  }
  return raw;
}

export function getIndexerUrl(): string {
  return process.env.UMBRA_INDEXER_URL ?? UMBRA_INDEXER_URL_DEFAULT;
}
