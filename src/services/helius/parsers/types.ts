export interface Transaction {
    signature: string;
    amount: number;
    amountUSD: number;
    tokenMint: string | null;
    tokenSymbol: string;
    tokenDecimals: number;
    signatureURL: string;
    walletAddress: string;
    dateFormatted: string;
    status: string;
    type: 'sent' | 'received' | 'unknown';
    slot: number;
}

export interface RawTransaction {
    signature: string;
    date: Date | null;
    status: string;
    amount: number;
    tokenMint: string | null;
    tokenSymbol: string;
    tokenDecimals: number;
    recipient: string | null;
    sender: string | null;
    type: 'sent' | 'received' | 'unknown';
    slot: number;
}
