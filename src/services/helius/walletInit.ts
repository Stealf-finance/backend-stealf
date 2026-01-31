import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CacheService } from "../cache/cacheService";
import { parseHeliusTransaction } from "../wallet/transactionParser";

let connection: Connection | null = null;

function getConnection(): Connection {
    if (!connection) {
        const RPC_ENDPOINT = process.env.SOLANA_RPC_URL;
        if (!RPC_ENDPOINT) {
            throw new Error('SOLANA_RPC_URL not found in environment variables');
        }
        connection = new Connection(RPC_ENDPOINT, 'confirmed');
    }
    return connection;
}


export const solanaService = {

    async getBalance(walletAddress: string): Promise<number> {

        const cacheKey = CacheService.balanceKey(walletAddress);
        const cached = await CacheService.get<number>(cacheKey);

        if (cached !== null){
            return cached;
        }

        try {
            const publicKey = new PublicKey(walletAddress);
            const balanceInLamports = await getConnection().getBalance(publicKey);
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

        if (cached !== null){
            return cached.slice(0, limit);
        }

        try {
            const publicKey = new PublicKey(address);
            const conn = getConnection();

            const signatures = await conn.getSignaturesForAddress(publicKey, { limit: 100 });

            if (!signatures || signatures.length === 0) {
                await CacheService.set(cacheKey, [], 0);
                return [];
            }

            const transactionPromises = signatures.map(async (sig) => {
                try {
                    const tx = await conn.getParsedTransaction(sig.signature, {
                        maxSupportedTransactionVersion: 0
                    });
                    return tx;
                } catch (error) {
                    console.error(`Error fetching transaction ${sig.signature}:`, error);
                    return null;
                }
            });

            const transactions = await Promise.all(transactionPromises);
            const validTransactions = transactions.filter(tx => tx !== null);

            const rawTransactions = validTransactions.map((tx) => parseHeliusTransaction(tx, address));

            await CacheService.set(cacheKey, rawTransactions, 0);
            return rawTransactions.slice(0, limit);

        } catch (error) {
            console.error('Error fetching transactions:', error);
            throw error;
        }
    }
};