import { PublicKey } from "@solana/web3.js";
import { x25519, RescueCipher, deserializeLE } from "@arcium-hq/client";
import { randomBytes } from "crypto";

/**
 * Encryption utilities for wallet data
 */
export class EncryptionUtils {
  /**
   * Encrypt wallet addresses for storage
   */
  static encryptWallets(
    gridWallet: PublicKey,
    privateWallet: PublicKey,
    mxePublicKey: Uint8Array
  ): {
    ciphertexts: number[][];
    clientPubKey: Uint8Array;
    clientNonce: Buffer;
    cipher: RescueCipher;
  } {
    // Generate client keypair
    const clientSecretKey = x25519.utils.randomSecretKey();
    const clientPubKey = x25519.getPublicKey(clientSecretKey);

    // Establish shared secret
    const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Convert wallet addresses to field elements (u128)
    const gridBytes = gridWallet.toBytes();
    const gridLow = BigInt('0x' + Buffer.from(gridBytes.slice(0, 16)).toString('hex'));
    const gridHigh = BigInt('0x' + Buffer.from(gridBytes.slice(16, 32)).toString('hex'));

    const privateBytes = privateWallet.toBytes();
    const privateLow = BigInt('0x' + Buffer.from(privateBytes.slice(0, 16)).toString('hex'));
    const privateHigh = BigInt('0x' + Buffer.from(privateBytes.slice(16, 32)).toString('hex'));

    // Encrypt
    const clientNonce = randomBytes(16);
    const ciphertexts = cipher.encrypt(
      [gridLow, gridHigh, privateLow, privateHigh],
      clientNonce
    );

    return {
      ciphertexts,
      clientPubKey,
      clientNonce,
      cipher,
    };
  }

  /**
   * Decrypt wallet addresses from event data
   */
  static decryptWallets(
    event: {
      nonce: number[];
      gridWalletLow: number[];
      gridWalletHigh: number[];
      privateWalletLow: number[];
      privateWalletHigh: number[];
    },
    cipher: RescueCipher
  ): {
    gridWallet: PublicKey;
    privateWallet: PublicKey;
  } {
    const eventNonce = Buffer.from(event.nonce);

    // Decrypt the 4 ciphertexts
    const decrypted = cipher.decrypt(
      [
        event.gridWalletLow,
        event.gridWalletHigh,
        event.privateWalletLow,
        event.privateWalletHigh,
      ],
      eventNonce
    );

    // Convert u128 bigint to bytes
    const u128ToBytes = (value: bigint): Buffer => {
      const hex = value.toString(16).padStart(32, '0');
      return Buffer.from(hex, 'hex');
    };

    // Reconstruct PublicKeys
    const gridWallet = new PublicKey(
      Buffer.concat([u128ToBytes(decrypted[0]), u128ToBytes(decrypted[1])])
    );

    const privateWallet = new PublicKey(
      Buffer.concat([u128ToBytes(decrypted[2]), u128ToBytes(decrypted[3])])
    );

    return { gridWallet, privateWallet };
  }

  /**
   * Generate a random computation offset
   */
  static generateComputationOffset(): bigint {
    return BigInt('0x' + randomBytes(8).toString('hex'));
  }
}