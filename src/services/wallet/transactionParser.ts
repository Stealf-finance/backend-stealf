import { SolPriceService } from '../pricing/solPrice';
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export interface Transaction {
    signature: string;
    amountUSD: number;
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
export function parseHeliusTransaction(tx: any, walletAddress: string): RawTransaction {
    let amount = 0;
    let type: 'sent' | 'received' | 'unknown' = 'unknown';
    let sender = tx.feePayer || '';
    let recipient = '';

    // Check for native SOL transfers
    if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
        const transfer = tx.nativeTransfers.find(
            (t: any) => t.fromUserAccount === walletAddress || t.toUserAccount === walletAddress
        ) || tx.nativeTransfers[0];

        amount = transfer.amount / LAMPORTS_PER_SOL;
        type = transfer.fromUserAccount === walletAddress ? 'sent' : 'received';
        sender = transfer.fromUserAccount;
        recipient = transfer.toUserAccount;

    // Check for SPL token transfers
    } else if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
        const transfer = tx.tokenTransfers[0];
        amount = transfer.tokenAmount || 0;
        type = transfer.fromUserAccount === walletAddress ? 'sent' : 'received';
        sender = transfer.fromUserAccount;
        recipient = transfer.toUserAccount;
    }

    return {
        signature: tx.signature,
        date: tx.timestamp ? new Date(tx.timestamp * 1000) : null,
        status: tx.err ? 'failed' : 'success',
        amount,
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

    const parsedTransactions: Transaction[] = RawTransactions.map((tx) => {
    const amountUSD = tx.amount * solPrice;

        return {
            signature: tx.signature,
            amountUSD: amountUSD,
            signatureURL: getExplorerUrl(tx.signature, "devnet"),
            walletAddress: walletAddress,
            dateFormatted: formatDate(tx.date),
            status: tx.status || 'unknown',
            type: tx.type,
            slot: tx.slot,
        };
    });

    return parsedTransactions;
}

export function filterTransactionsByType(
    transactions: Transaction[],
    type: 'sent' | 'received' | 'all'
): Transaction[] {
    if (type === 'all') return transactions;
    return transactions.filter(tx => tx.type === type);

}


