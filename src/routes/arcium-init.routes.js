import express from 'express';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Program, AnchorProvider, Wallet } from '@project-serum/anchor';
const router = express.Router();
const PROGRAM_ID = new PublicKey('G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp');
const RPC_URL = 'https://api.devnet.solana.com';
router.post('/init-compdef', async (req, res) => {
    try {
        const walletPath = path.join(os.homedir(), '.config/solana/id.json');
        const walletKeyfile = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
        const wallet = Keypair.fromSecretKey(new Uint8Array(walletKeyfile));
        const connection = new Connection(RPC_URL, 'confirmed');
        const provider = new AnchorProvider(connection, new Wallet(wallet), {});
        const idlPath = path.join(__dirname, '../services/arcium/arcium_private_transfer.json');
        const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
        const program = new Program(idl, PROGRAM_ID, provider);
        const tx = await program.methods
            .initEncryptedTransferCompDef()
            .rpc();
        res.json({ success: true, signature: tx });
    }
    catch (error) {
        console.error('Init CompDef error:', error);
        res.status(500).json({ error: error.message, logs: error.logs });
    }
});
export default router;
