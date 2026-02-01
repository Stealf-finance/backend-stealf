import { Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl, AddressLookupTableProgram } from "@solana/web3.js";
import { CacheService } from "../cache/cacheService";
import { parseHeliusTransaction } from "../wallet/transactionParser";

const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const connection = new Connection(RPC_ENDPOINT, 'confirmed');


export const solanaService = {

    async getBalance(walletAddress: string): Promise<number> {

        const cacheKey = CacheService.balanceKey(walletAddress);
        const cached = await CacheService.get<number>(cacheKey);

        if (cached !== null){
            return cached;
        }

        try {
            const publicKey = new PublicKey(walletAddress);
            const balanceInLamports = await connection.getBalance(publicKey);
            const balanceInSOL = balanceInLamports / LAMPORTS_PER_SOL;

            await CacheService.set(cacheKey, balanceInSOL, 0);

            return balanceInSOL;
        } catch (error) {
            console.error('Error fetching balance:', error);
            throw error;
        }
    },


    async getTransactions(address: string, limit: number = 100): Promise<any[]> {

        const cacheKey = CacheService.historyKey(address, 100);
        const cached = await CacheService.get<any[]>(cacheKey);

        console.log(`[WalletInit] Cache check for ${address}:`, cached !== null ? `Found ${cached.length} transactions` : 'Not found');

        if (cached !== null){
            console.log(`[WalletInit] Returning ${cached.length} transactions from cache`);
            return cached.slice(0, limit);
        }

        try {
            const heliusApiKey = process.env.HELIUS_API_KEY;
            if (!heliusApiKey) {
                throw new Error('HELIUS_API_KEY not found in environment variables');
            }

            console.log(`[WalletInit] Fetching transactions from Helius API for ${address}`);
            const baseUrl = `https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions/?api-key=${heliusApiKey}`;
            
            let url = baseUrl;
            let lastSignature: string | null = null;
            let allTransactions: any[] = [];

            while (allTransactions.length < 100) {
                if (lastSignature) {
                    url = baseUrl + `&before=${lastSignature}`;
                }

                const response = await fetch(url);

                if (!response.ok) {
                    console.error(`Helius API error: ${response.status}`);
                    const errorText = await response.text();
                    console.error('Error response:', errorText);
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

            // Transform Helius transactions to RawTransaction format
            const rawTransactions = allTransactions.map((tx) => parseHeliusTransaction(tx, address));

            await CacheService.set(cacheKey, rawTransactions, 0);
            return rawTransactions.slice(0, limit);

        } catch (error) {
            console.error('Error fetching transactions:', error);
            throw error;
        }
    }
};