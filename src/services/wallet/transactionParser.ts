import { SolPriceService } from '../pricing/solPrice';
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TokenMetadataService } from '../token/TokenMetadataService';

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
    tokenMint: string | null; // null = SOL natif
    tokenSymbol: string;
    tokenDecimals: number;
    recipient: string | null;
    sender: string | null;
    type: 'sent' | 'received' | 'unknown';
    slot: number;
}


/**
 * 
 * @param address 
 * @returns address formatted
 */
export const formatAddress = (address: string | null) => {
    if (!address) return 'Unknown';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

/**
 * 
 * @param date 
 * @returns formatted date
 */
export const formatDate = (date: Date | string | null): string => {
    if (!date) return 'Unknown';

    const dateObj = typeof date === 'string' ? new Date(date) : date;

    const day = dateObj.getDate().toString().padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[dateObj.getMonth()];

    let hours = dateObj.getHours();
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = hours.toString().padStart(2, '0');

    return `${day} ${month} - ${hoursStr}:${minutes} ${ampm}`;
};

/**
 * 
 * @param signature 
 * @param cluster 
 * @returns url signature
 */
export const getExplorerUrl = (signature: string, cluster: 'devnet' | 'mainnet-beta' = 'devnet'): string => {
    return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
};

/**
 * Parse a raw Helius enhanced transaction into RawTransaction format
 * @param tx - Helius transaction object
 * @param walletAddress - The wallet address we're viewing the transaction from
 * @returns RawTransaction object
 */
export async function parseHeliusTransaction(tx: any, walletAddress: string): Promise<RawTransaction> {
    let amount = 0;
    let type: 'sent' | 'received' | 'unknown' = 'unknown';
    let sender = tx.feePayer || '';
    let recipient = '';
    let tokenMint: string | null = null;
    let tokenSymbol = 'SOL';
    let tokenDecimals = 9;

    // Check for native SOL transfers
    if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
        const transfer = tx.nativeTransfers.find(
            (t: any) => t.fromUserAccount === walletAddress || t.toUserAccount === walletAddress
        ) || tx.nativeTransfers[0];

        amount = transfer.amount / LAMPORTS_PER_SOL;
        type = transfer.fromUserAccount === walletAddress ? 'sent' : 'received';
        sender = transfer.fromUserAccount;
        recipient = transfer.toUserAccount;
        tokenMint = null;
        tokenSymbol = 'SOL';
        tokenDecimals = 9;

    // Check for SPL token transfers
    } else if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
        const transfer = tx.tokenTransfers.find(
            (t: any) => t.fromUserAccount === walletAddress || t.toUserAccount === walletAddress
        ) || tx.tokenTransfers[0];

        amount = transfer.tokenAmount || 0;
        type = transfer.fromUserAccount === walletAddress ? 'sent' : 'received';
        sender = transfer.fromUserAccount;
        recipient = transfer.toUserAccount;
        tokenMint = transfer.mint || null;

        if (tokenMint) {
            if (transfer.symbol && transfer.symbol !== 'UNKNOWN') {
                tokenSymbol = transfer.symbol;
                tokenDecimals = transfer.decimals || 9;
            } else {
                const meta = await TokenMetadataService.getMetadata(tokenMint);
                tokenSymbol = meta.symbol;
                tokenDecimals = meta.decimals;
            }
        }
    }

    return {
        signature: tx.signature,
        date: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
        status: tx.err ? 'failed' : 'success',
        amount,
        tokenMint,
        tokenSymbol,
        tokenDecimals,
        type,
        sender,
        recipient,
        slot: tx.slot || 0,
    };
}


export async function parseTransactions(
    RawTransactions: RawTransaction[],
    walletAddress: string
): Promise<Transaction[]> {

    const solPrice = await SolPriceService.getSolanaPrice();

    const parsedTransactions: Transaction[] = RawTransactions
        .filter((tx) => tx.type === 'sent' || tx.type === 'received')
        .map((tx) => {
        let amountUSD = 0;

        if (tx.tokenSymbol === 'SOL') {
            amountUSD = tx.amount * solPrice;
        } else if (tx.tokenSymbol === 'USDC' || tx.tokenSymbol === 'USDT') {
            amountUSD = tx.amount;
        } else {
            amountUSD = 0;
        }

        return {
            signature: tx.signature,
            amount: tx.amount,
            amountUSD: amountUSD,
            tokenMint: tx.tokenMint,
            tokenSymbol: tx.tokenSymbol,
            tokenDecimals: tx.tokenDecimals,
            signatureURL: getExplorerUrl(tx.signature, process.env.SOLANA_RPC_URL?.includes('devnet') ? 'devnet' : 'mainnet-beta'),
            walletAddress: walletAddress,
            dateFormatted: formatDate(tx.date),
            status: tx.status || 'unknown',
            type: tx.type,
            slot: tx.slot,
        };
    });

    return parsedTransactions.filter((tx) => tx.amountUSD >= 1);
}

export function filterTransactionsByType(
    transactions: Transaction[],
    type: 'sent' | 'received' | 'all'
): Transaction[] {
    if (type === 'all') return transactions;
    return transactions.filter(tx => tx.type === type);
}

/**
 * Filter transactions by token mint address
 * @param transactions - Array of transactions
 * @param tokenMint - Token mint address (null for SOL)
 * @returns Filtered array of transactions
 */
export function filterTransactionsByToken(
    transactions: Transaction[],
    tokenMint: string | null
): Transaction[] {
    return transactions.filter(tx => tx.tokenMint === tokenMint);
}

/**
 * Filter transactions by token symbol
 * @param transactions - Array of transactions
 * @param tokenSymbol - Token symbol (e.g., 'SOL', 'USDC', 'USDT')
 * @returns Filtered array of transactions
 */
export function filterTransactionsBySymbol(
    transactions: Transaction[],
    tokenSymbol: string
): Transaction[] {
    return transactions.filter(tx => tx.tokenSymbol === tokenSymbol);
}

/**
 * Group transactions by token mint address
 * @param transactions - Array of transactions
 * @returns Map with tokenMint as key and array of transactions as value
 */
export function groupTransactionsByToken(
    transactions: Transaction[]
): Map<string | null, Transaction[]> {
    const grouped = new Map<string | null, Transaction[]>();

    for (const tx of transactions) {
        const key = tx.tokenMint;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key)!.push(tx);
    }

    return grouped;
}

