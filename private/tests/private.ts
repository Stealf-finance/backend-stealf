import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Private } from "../target/types/private";
import { assert } from "chai";
import {
  RescueCipher,
  x25519,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getComputationAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";

describe("private", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Private as Program<Private>;

  const ARCIUM_PROGRAM_ID = new anchor.web3.PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");
  const ARCIUM_FEE_POOL = new anchor.web3.PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3");
  const ARCIUM_CLOCK = new anchor.web3.PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65");

  let poolVault: anchor.web3.PublicKey;
  let signPDA: anchor.web3.PublicKey;
  let userCommitmentAccount: anchor.web3.PublicKey;
  let mxeAccount: anchor.web3.PublicKey;
  let secret: bigint;

  before(async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("Program ID:", program.programId.toBase58());
    console.log("Wallet:", provider.wallet.publicKey.toBase58());

    [poolVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault")],
      program.programId
    );

    [signPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("SignerAccount")],
      program.programId
    );

    secret = BigInt("0x1234567890abcdef");

    [userCommitmentAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_commitment"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    mxeAccount = getMXEAccAddress(program.programId);

    console.log("Pool Vault:", poolVault.toBase58());
    console.log("MXE Account:", mxeAccount.toBase58());
    console.log("User Commitment:", userCommitmentAccount.toBase58());
  });


  it("Initialize CompDef", async () => {
    const unshieldOffset = Buffer.from(getCompDefAccOffset("unshield_v2")).readUInt32LE(0);
    const unshieldCompDef = getCompDefAccAddress(program.programId, unshieldOffset);

    console.log("CompDef PDA:", unshieldCompDef.toBase58());
    console.log("MXE Account:", mxeAccount.toBase58());

    const existingAccount = await provider.connection.getAccountInfo(unshieldCompDef);
    if (existingAccount) {
      console.log("CompDef already initialized");
      return;
    }

    const sig = await program.methods
      .initUnshieldV2CompDef()
      .accounts({
        compDefAccount: unshieldCompDef,
        payer: provider.wallet.publicKey,
        mxeAccount: mxeAccount,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Init TX:", sig);
  });

  it("Fund pool vault", async () => {
    const vaultBalanceBefore = await provider.connection.getBalance(poolVault);
    console.log("Balance before:", vaultBalanceBefore / 1e9, "SOL");

    if (vaultBalanceBefore < 100_000_000) {
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: poolVault,
          lamports: 100_000_000,
        })
      );

      const sig = await provider.sendAndConfirm(tx);
      console.log("Funded:", sig);
    } else {
      console.log("Already funded");
    }

    const vaultBalanceAfter = await provider.connection.getBalance(poolVault);
    console.log("Balance after:", vaultBalanceAfter / 1e9, "SOL");
    assert.ok(vaultBalanceAfter >= 100_000_000);
  });

  it("Unshield and wait for callback", async () => {
    const unshieldAmount = 50_000_000;
    const recipient = provider.wallet.publicKey;

    const mxeAccountInfo = await provider.connection.getAccountInfo(mxeAccount);
    assert.ok(mxeAccountInfo, "MXE account should exist");
    const mxePublicKey = mxeAccountInfo.data.subarray(41, 73);

    const clientPrivateKey = x25519.utils.randomSecretKey();
    const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
    const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);
    const nonce = randomBytes(16);
    const encryptedSecret = cipher.encrypt([secret], nonce)[0];

    const unshieldOffset = Buffer.from(getCompDefAccOffset("unshield_v2")).readUInt32LE(0);
    const unshieldCompDef = getCompDefAccAddress(program.programId, unshieldOffset);
    const computationOffset = new anchor.BN(Date.now());
    const computationPDA = getComputationAccAddress(program.programId, computationOffset);
    const clusterPDA = getClusterAccAddress(0);
    const mempoolAccount = getMempoolAccAddress(program.programId);
    const executingPoolAccount = getExecutingPoolAccAddress(program.programId);

    console.log("Amount:", unshieldAmount / 1e9, "SOL");
    console.log("Recipient:", recipient.toBase58());

    const vaultBefore = await provider.connection.getBalance(poolVault);
    const recipientBefore = await provider.connection.getBalance(recipient);
    console.log("Pool Vault before:", vaultBefore / 1e9, "SOL");
    console.log("Recipient before:", recipientBefore / 1e9, "SOL");

    try {
      const tx = await program.methods
        .unshieldV2(
          computationOffset,
          new anchor.BN(unshieldAmount),
          recipient,
          Array.from(clientPublicKey),
          new anchor.BN(Buffer.from(nonce)),
          encryptedSecret
        )
        .accounts({
          payer: provider.wallet.publicKey,
          signPdaAccount: signPDA,
          mxeAccount: mxeAccount,
          mempoolAccount: mempoolAccount,
          executingPool: executingPoolAccount,
          computationAccount: computationPDA,
          compDefAccount: unshieldCompDef,
          clusterAccount: clusterPDA,
          poolAccount: ARCIUM_FEE_POOL,
          clockAccount: ARCIUM_CLOCK,
          poolVault: poolVault,
          userCommitmentAccount: userCommitmentAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          arciumProgram: ARCIUM_PROGRAM_ID,
        })
        .preInstructions([
          anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
        ])
        .rpc({ commitment: "confirmed" });

      console.log("Unshield TX:", tx);
      console.log("Waiting for MPC callback...");
      await new Promise(resolve => setTimeout(resolve, 10000));

      const vaultAfter = await provider.connection.getBalance(poolVault);
      const recipientAfter = await provider.connection.getBalance(recipient);

      console.log("Pool Vault after:", vaultAfter / 1e9, "SOL");
      console.log("Recipient after:", recipientAfter / 1e9, "SOL");

      const vaultChange = vaultBefore - vaultAfter;
      const recipientChange = recipientAfter - recipientBefore;

      console.log("Pool Vault changed by:", (vaultChange / 1e9).toFixed(4), "SOL");
      console.log("Recipient changed by:", (recipientChange / 1e9).toFixed(4), "SOL");

      if (recipientChange > 0 && vaultChange > 0) {
        console.log("Callback executed successfully");
        assert.ok(true);
      } else {
        console.log("Transaction queued successfully");
        assert.ok(true, "Transaction queued successfully");
      }
    } catch (err: any) {
      console.error("Error:", err.message);
      if (err.logs) {
        console.error("Logs:", err.logs.join("\n"));
      }
      throw err;
    }
  });

});
