import { ISigner } from '../../lib/umbra-sdk/dist/index.mjs';
import nacl from 'tweetnacl';
/**
 * KeypairSigner - Adapter to convert Solana Keypair into ISigner interface
 * This allows Solana Keypairs to be used with the Umbra SDK
 */
export class KeypairSigner extends ISigner {
    constructor(keypair) {
        super();
        this.keypair = keypair;
    }
    /**
     * Sign an arbitrary message using the keypair's private key
     * Returns a 64-byte Ed25519 signature
     */
    async signMessage(message) {
        // Use nacl to sign the message with the keypair's secret key
        const signature = nacl.sign.detached(message instanceof Uint8Array ? message : new Uint8Array(message), this.keypair.secretKey);
        return signature;
    }
    /**
     * Sign a single Solana versioned transaction
     */
    async signTransaction(transaction) {
        // Sign the transaction with the keypair
        transaction.sign([this.keypair]);
        return transaction;
    }
    /**
     * Sign multiple Solana versioned transactions
     */
    async signTransactions(transactions) {
        // Sign each transaction
        return transactions.map((tx) => {
            tx.sign([this.keypair]);
            return tx;
        });
    }
    /**
     * Get the public key (Solana address) of this signer
     */
    async getPublicKey() {
        return this.keypair.publicKey;
    }
    /**
     * Get the underlying Solana Keypair
     * Useful for signing raw Solana transactions
     */
    getKeypair() {
        return this.keypair;
    }
}
