import { PublicKey } from "@solana/web3.js";

/**
 * PDA derivation utilities
 */
export class PDAUtils {
  /**
   * Derive the encrypted wallets PDA for a user
   */
  static getEncryptedWalletsPDA(
    owner: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("encrypted_wallets"), owner.toBuffer()],
      programId
    );
  }
}