import { SolPriceService } from '../../pricing/solPrice';
import { Transaction, RawTransaction } from './types';
import { formatDate, getExplorerUrl } from './utils';

export async function parseTransactions(
    rawTransactions: RawTransaction[],
    walletAddress: string
): Promise<Transaction[]> {

    const solPrice = await SolPriceService.getSolanaPrice();

    const parsedTransactions: Transaction[] = rawTransactions.map((tx) => {
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

export function filterTransactionsByToken(
    transactions: Transaction[],
    tokenMint: string | null
): Transaction[] {
    return transactions.filter(tx => tx.tokenMint === tokenMint);
}

export function filterTransactionsBySymbol(
    transactions: Transaction[],
    tokenSymbol: string
): Transaction[] {
    return transactions.filter(tx => tx.tokenSymbol === tokenSymbol);
}

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
