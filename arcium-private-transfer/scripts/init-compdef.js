import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { Program, AnchorProvider, Wallet } from '@project-serum/anchor';
const PROGRAM_ID = '5yiVpa6pW6VZV5NynRmV4N2qCPu3hu2MrcdpjZj5FnSP';
const RPC_URL = 'https://api.devnet.solana.com';
const WALLET_PATH = path.join(process.env.HOME, '.config/solana/id.json');
async function main() {
    // Load wallet
    const walletKeyfile = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(walletKeyfile));
    // Setup connection and provider
    const connection = new Connection(RPC_URL, 'confirmed');
    const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: 'confirmed' });
    // Load IDL
    const idlPath = path.join(__dirname, '../target/idl/arcium_private_transfer.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    // Create program instance
    const program = new Program(idl, new PublicKey(PROGRAM_ID), provider);
    console.log('Initializing CompDef...');
    console.log('Program ID:', PROGRAM_ID);
    console.log('Wallet:', wallet.publicKey.toString());
    try {
        const tx = await program.methods
            .initEncryptedTransferCompDef()
            .accounts({
            payer: wallet.publicKey,
        })
            .rpc();
        console.log('✅ CompDef initialized!');
        console.log('Transaction:', tx);
    }
    catch (error) {
        console.error('❌ Error initializing CompDef:', error);
        throw error;
    }
}
main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
