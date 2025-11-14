import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/**
 * Arcium Program ID sur DEVNET
 * Source: Arcium v0.4.0 documentation
 */
export const ARCIUM_PROGRAM_ID_DEVNET = new PublicKey(
  "BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6"
);

/**
 * Dérive l'adresse du MXE Account pour devnet
 * Seeds: ["MXEAccount", mxe_program_id]
 */
export function getMXEAccAddressDevnet(mxeProgramId: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("MXEAccount"), mxeProgramId.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

/**
 * Dérive l'adresse du Mempool Account pour devnet
 * Seeds: ["Mempool", mxe_account]
 */
export function getMempoolAccAddressDevnet(mxeAccount: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("Mempool"), mxeAccount.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

/**
 * Dérive l'adresse du CompDef Account pour devnet
 * Seeds: ["CompDef", mxe_account, offset.to_le_bytes()]
 */
export function getCompDefAccAddressDevnet(
  mxeAccount: PublicKey,
  offset: BN
): PublicKey {
  const offsetBuffer = Buffer.alloc(8);
  offsetBuffer.writeBigUInt64LE(BigInt(offset.toString()));

  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("CompDef"), mxeAccount.toBuffer(), offsetBuffer],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

/**
 * Dérive l'adresse du ExecutingPool Account pour devnet
 * Seeds: ["ExecutingPool", mxe_account]
 */
export function getExecutingPoolAccAddressDevnet(mxeAccount: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("ExecutingPool"), mxeAccount.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

/**
 * Dérive l'adresse du Computation Account pour devnet
 * Seeds: ["Computation", mxe_account, requester, offset.to_le_bytes()]
 */
export function getComputationAccAddressDevnet(
  mxeAccount: PublicKey,
  requester: PublicKey,
  offset: BN
): PublicKey {
  const offsetBuffer = Buffer.alloc(8);
  offsetBuffer.writeBigUInt64LE(BigInt(offset.toString()));

  const [address] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("Computation"),
      mxeAccount.toBuffer(),
      requester.toBuffer(),
      offsetBuffer,
    ],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

/**
 * Dérive l'adresse du Cluster Account pour devnet
 * Seeds: ["cluster", mxe_account]
 */
export function getClusterAccAddressDevnet(mxeAccount: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("cluster"), mxeAccount.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

/**
 * Dérive l'adresse du FeePool Account pour devnet
 * Seeds: ["fee_pool", mxe_account]
 */
export function getFeePoolAccAddressDevnet(mxeAccount: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_pool"), mxeAccount.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}
