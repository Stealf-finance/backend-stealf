import { PrivacyCash } from 'privacycash';
import { PublicKey } from '@solana/web3.js';

export const SUPPORTED_TOKENS = {
    SOL: null,
    USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
} as const;

export const PRIVACY_FEES = {
    DEPOSIT: 0,
    WITHDRAWAL_BASE: 0.006,
    WITHDRAWAL_PERCENTAGE: 0.0035,
} as const;

let privacyCashClient: PrivacyCash | null = null;

export const getPrivacyCashClient = (): PrivacyCash => {
    if (!privacyCashClient) {
        if (!process.env.SOLANA_RPC_URL) {
            throw new Error('SOLANA_RPC_URL is not defined in environment variables');
        }

        if (!process.env.VAULT_PRIVATE_KEY) {
            throw new Error('VAULT_PRIVATE_KEY is not defined in environment variables');
        }

    
        const privateKey = JSON.parse(process.env.VAULT_PRIVATE_KEY) as number[];

        privacyCashClient = new PrivacyCash({
            RPC_url: process.env.SOLANA_RPC_URL,
            owner: privateKey,
            enableDebug: false, // Disable verbose Privacy Cash logs
        });
    }
    return privacyCashClient;
};

export const calculateWithdrawalFee = (amount: number, recipientCount: number = 1): number => {
    const baseFee = PRIVACY_FEES.WITHDRAWAL_BASE * recipientCount;
    const percentageFee = amount * PRIVACY_FEES.WITHDRAWAL_PERCENTAGE;
    return baseFee + percentageFee;
};
