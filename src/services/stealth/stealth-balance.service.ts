/**
 * StealthBalanceService — Calcule le solde cash unifié.
 *
 * Responsabilités :
 * - Lire le solde SOL de l'adresse principale du cash wallet via RPC Solana
 * - Agréger les UTXOs stealth cash spendable depuis MongoDB (StealthPayment walletType:'cash')
 * - Retourner mainBalance + stealthBalance + totalBalance garanti = somme
 *
 * Requirements : 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { Connection, PublicKey } from '@solana/web3.js';
import mongoose from 'mongoose';
import { StealthPayment } from '../../models/StealthPayment';

export interface CashBalance {
  mainBalance: number;
  stealthBalance: number;
  totalBalance: number;
  stealthPayments: Array<{
    _id: string;
    stealthAddress: string;
    amountLamports: string;
    detectedAt: Date;
    status: 'spendable';
  }>;
}

export class StealthBalanceService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    );
  }

  async getCashBalance(userId: string, cashWalletAddress: string): Promise<CashBalance> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Requêtes en parallèle : RPC Solana + MongoDB
    const [mainBalance, spendablePayments] = await Promise.all([
      this.connection.getBalance(new PublicKey(cashWalletAddress), 'confirmed'),
      StealthPayment.find({
        userId: userObjectId,
        walletType: 'cash',
        status: 'spendable',
      }).lean(),
    ]);

    // Sommation BigInt-safe via Number.parseInt sur les String lamports
    let stealthBalance = 0;
    for (const p of spendablePayments) {
      stealthBalance += Number.parseInt(p.amountLamports, 10);
    }

    return {
      mainBalance,
      stealthBalance,
      totalBalance: mainBalance + stealthBalance,
      stealthPayments: spendablePayments.map((p) => ({
        _id: String(p._id),
        stealthAddress: p.stealthAddress,
        amountLamports: p.amountLamports,
        detectedAt: p.detectedAt,
        status: 'spendable' as const,
      })),
    };
  }
}

let instance: StealthBalanceService | null = null;

export function getStealthBalanceService(): StealthBalanceService {
  if (!instance) instance = new StealthBalanceService();
  return instance;
}
