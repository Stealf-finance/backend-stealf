import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CacheService } from "../cache/cacheService";
import { parseHeliusTransaction } from "../wallet/transactionParser";
import { TokenMetadataService } from "../token/TokenMetadataService";
import logger from "../../config/logger";

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

let _connection: Connection | null = null;
function getConnection(): Connection {
    if (!_connection) {
        const rpc = process.env.SOLANA_RPC_URL;
        if (!rpc) throw new Error('SOLANA_RPC_URL is not defined');
        _connection = new Connection(rpc, 'confirmed');
    }
    return _connection;
}


export interface TokenBalance {
    tokenMint: string | null;
    tokenSymbol: string;
    tokenDecimals: number;
    balance: number;
    balanceUSD: number;
}

export interface WalletBalance {
    tokens: TokenBalance[];
    totalUSD: number;
}

export const solanaService = {

    async getBalance(walletAddress: string): Promise<WalletBalance> {

        const cacheKey = CacheService.balanceKey(walletAddress);
        const cached = await CacheService.get<WalletBalance>(cacheKey);

        if (cached !== null) {
            return cached;
        }

        try {
            const publicKey = new PublicKey(walletAddress);
            const { SolPriceService } = await import('../pricing/solPrice');
            const solPrice = await SolPriceService.getSolanaPrice();

            const balanceInLamports = await getConnection().getBalance(publicKey);
            const balanceInSOL = balanceInLamports / LAMPORTS_PER_SOL;

            const tokens: TokenBalance[] = [{
                tokenMint: null,
                tokenSymbol: 'SOL',
                tokenDecimals: 9,
                balance: balanceInSOL,
                balanceUSD: balanceInSOL * solPrice,
            }];

            // SPL token balances
            const [tokenAccounts, token2022Accounts] = await Promise.all([
                getConnection().getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
                getConnection().getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
            ]);

            const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value];

            const nonZeroAccounts: { mint: string; amount: number; decimals: number }[] = [];
            for (const account of allAccounts) {
                const info = account.account.data.parsed.info;
                const mint: string = info.mint;
                const amount: number = info.tokenAmount.uiAmount || 0;
                if (amount === 0) continue;
                nonZeroAccounts.push({ mint, amount, decimals: info.tokenAmount.decimals });
            }

            const mints = nonZeroAccounts.map(a => a.mint);
            const metadataMap = mints.length > 0
                ? await TokenMetadataService.getMetadataBatch(mints)
                : new Map();

            for (const { mint, amount, decimals } of nonZeroAccounts) {
                const meta = metadataMap.get(mint);
                const symbol = meta?.symbol || 'UNKNOWN';

                let balanceUSD = 0;
                if (symbol === 'USDC' || symbol === 'USDT') {
                    balanceUSD = amount;
                }

                tokens.push({
                    tokenMint: mint,
                    tokenSymbol: symbol,
                    tokenDecimals: meta?.decimals ?? decimals,
                    balance: amount,
                    balanceUSD,
                });
            }

            const totalUSD = tokens.reduce((sum, t) => sum + t.balanceUSD, 0);
            const result: WalletBalance = { tokens, totalUSD };

            await CacheService.set(cacheKey, result, 300);

            return result;
        } catch (error) {
            logger.error({ err: error }, 'Error fetching balance');
            throw error;
        }
    },


    async getTransactions(address: string, limit: number = 100): Promise<any[]> {

        const cacheKey = CacheService.historyKey(address, 100);
        const cached = await CacheService.get<any[]>(cacheKey);

        if (cached !== null){
            logger.debug({ count: cached.length }, 'WalletInit: returning transactions from cache');
            return cached.slice(0, limit);
        }

        try {
            const heliusApiKey = process.env.HELIUS_API_KEY;
            if (!heliusApiKey) {
                throw new Error('HELIUS_API_KEY not found in environment variables');
            }

            logger.debug({ address }, 'WalletInit: fetching transactions from Helius API');
            const isDevnet = process.env.SOLANA_RPC_URL?.includes('devnet');
            const heliusBase = isDevnet
                ? 'https://api-devnet.helius-rpc.com'
                : 'https://api-mainnet.helius-rpc.com';
            const baseUrl = `${heliusBase}/v0/addresses/${address}/transactions/?api-key=${heliusApiKey}`;

            let url = baseUrl;
            let lastSignature: string | null = null;
            let allTransactions: any[] = [];

            while (allTransactions.length < 100) {
                if (lastSignature) {
                    url = baseUrl + `&before=${lastSignature}`;
                }

                const response = await fetch(url);

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.error({ status: response.status, body: errorText }, 'Helius API error');
                    break;
                }

                const transactions = await response.json() as any[];

                if (transactions && transactions.length > 0) {
                    allTransactions = [...allTransactions, ...transactions];
                    lastSignature = transactions[transactions.length - 1].signature;

                    if (allTransactions.length >= 100) {
                        allTransactions = allTransactions.slice(0, 100);
                        break;
                    }
                } else {
                    break;
                }
            }

            const rawTransactions = await Promise.all(
                allTransactions.map((tx) => parseHeliusTransaction(tx, address))
            );

            await CacheService.set(cacheKey, rawTransactions, 300);
            return rawTransactions.slice(0, limit);

        } catch (error) {
            logger.error({ err: error }, 'Error fetching transactions');
            throw error;
        }
    }
};
