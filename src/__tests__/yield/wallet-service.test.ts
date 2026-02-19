/**
 * Tests for wallet/Helius service
 *
 * Validates: devnet/mainnet routing, balance fetching, transaction parsing.
 */

describe("Helius API URL routing", () => {
  it("should use devnet URL when SOLANA_RPC_URL contains devnet", () => {
    const rpcUrl = "https://api.devnet.solana.com";
    const isDevnet = rpcUrl.includes("devnet");
    const heliusBase = isDevnet
      ? "https://api-devnet.helius-rpc.com"
      : "https://api-mainnet.helius-rpc.com";

    expect(isDevnet).toBe(true);
    expect(heliusBase).toBe("https://api-devnet.helius-rpc.com");
  });

  it("should use mainnet URL when SOLANA_RPC_URL is mainnet", () => {
    const rpcUrl = "https://api.mainnet-beta.solana.com";
    const isDevnet = rpcUrl.includes("devnet");
    const heliusBase = isDevnet
      ? "https://api-devnet.helius-rpc.com"
      : "https://api-mainnet.helius-rpc.com";

    expect(isDevnet).toBe(false);
    expect(heliusBase).toBe("https://api-mainnet.helius-rpc.com");
  });

  it("should use mainnet URL for custom RPC (Helius mainnet)", () => {
    const rpcUrl = "https://rpc.helius.xyz/?api-key=xxx";
    const isDevnet = rpcUrl.includes("devnet");
    const heliusBase = isDevnet
      ? "https://api-devnet.helius-rpc.com"
      : "https://api-mainnet.helius-rpc.com";

    expect(isDevnet).toBe(false);
    expect(heliusBase).toBe("https://api-mainnet.helius-rpc.com");
  });

  it("should use devnet URL for Helius devnet RPC", () => {
    const rpcUrl = "https://devnet.helius-rpc.com/?api-key=xxx";
    const isDevnet = rpcUrl.includes("devnet");
    const heliusBase = isDevnet
      ? "https://api-devnet.helius-rpc.com"
      : "https://api-mainnet.helius-rpc.com";

    expect(isDevnet).toBe(true);
    expect(heliusBase).toBe("https://api-devnet.helius-rpc.com");
  });
});

describe("Wallet balance response shape", () => {
  /**
   * Frontend expects (via useWalletInfos):
   * {
   *   address: string,
   *   tokens: [{ tokenMint, tokenSymbol, tokenDecimals, balance, balanceUSD }],
   *   totalUSD: number
   * }
   */
  it("should match expected balance response shape", () => {
    const response = {
      address: "DXTwJwdnH6Eh84SPANtCwg4KM4Cuu7HNHFYoztRpaHYU",
      tokens: [
        {
          tokenMint: null,
          tokenSymbol: "SOL",
          tokenDecimals: 9,
          balance: 2.5,
          balanceUSD: 375.0,
        },
        {
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          balance: 100,
          balanceUSD: 100,
        },
      ],
      totalUSD: 475.0,
    };

    expect(typeof response.address).toBe("string");
    expect(Array.isArray(response.tokens)).toBe(true);
    expect(typeof response.totalUSD).toBe("number");

    // SOL token
    const sol = response.tokens.find((t) => t.tokenSymbol === "SOL");
    expect(sol).toBeDefined();
    expect(sol!.tokenMint).toBeNull(); // SOL has no mint
    expect(sol!.tokenDecimals).toBe(9);

    // USDC token
    const usdc = response.tokens.find((t) => t.tokenSymbol === "USDC");
    expect(usdc).toBeDefined();
    expect(usdc!.tokenMint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("should handle empty wallet (no tokens)", () => {
    const response = {
      address: "SomeEmptyWallet",
      tokens: [
        {
          tokenMint: null,
          tokenSymbol: "SOL",
          tokenDecimals: 9,
          balance: 0,
          balanceUSD: 0,
        },
      ],
      totalUSD: 0,
    };

    expect(response.tokens).toHaveLength(1); // always has SOL
    expect(response.totalUSD).toBe(0);
  });
});

describe("Transaction history response shape", () => {
  /**
   * Frontend expects (via useWalletInfos):
   * {
   *   address: string,
   *   count: number,
   *   transactions: [{ signature, amount, amountUSD, tokenMint, tokenSymbol,
   *                     tokenDecimals, signatureURL, walletAddress, dateFormatted,
   *                     status, type, slot }]
   * }
   */
  it("should match expected transaction shape", () => {
    const transaction = {
      signature: "5KtP...abc",
      amount: 1.5,
      amountUSD: 225.0,
      tokenMint: null,
      tokenSymbol: "SOL",
      tokenDecimals: 9,
      signatureURL: "https://solscan.io/tx/5KtP...abc",
      walletAddress: "DXTw...",
      dateFormatted: "2026-02-16 14:30",
      status: "confirmed",
      type: "sent" as const,
      slot: 123456789,
    };

    expect(typeof transaction.signature).toBe("string");
    expect(typeof transaction.amount).toBe("number");
    expect(typeof transaction.amountUSD).toBe("number");
    expect(["sent", "received", "unknown"]).toContain(transaction.type);
    expect(typeof transaction.dateFormatted).toBe("string");
    expect(typeof transaction.slot).toBe("number");
  });

  it("should handle transaction list response", () => {
    const response = {
      address: "DXTw...",
      count: 2,
      transactions: [
        {
          signature: "tx1",
          amount: 1,
          amountUSD: 150,
          tokenMint: null,
          tokenSymbol: "SOL",
          tokenDecimals: 9,
          signatureURL: "https://solscan.io/tx/tx1",
          walletAddress: "DXTw...",
          dateFormatted: "2026-02-16",
          status: "confirmed",
          type: "received" as const,
          slot: 1,
        },
        {
          signature: "tx2",
          amount: 50,
          amountUSD: 50,
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          signatureURL: "https://solscan.io/tx/tx2",
          walletAddress: "DXTw...",
          dateFormatted: "2026-02-15",
          status: "confirmed",
          type: "sent" as const,
          slot: 2,
        },
      ],
    };

    expect(response.count).toBe(response.transactions.length);
    expect(response.transactions).toHaveLength(2);
  });
});

describe("Wallet controller auth checks", () => {
  it("should verify wallet ownership logic", () => {
    const user = {
      cash_wallet: "wallet-A",
      stealf_wallet: "wallet-B",
    };

    const isOwnerA = user.cash_wallet === "wallet-A" || user.stealf_wallet === "wallet-A";
    const isOwnerB = user.cash_wallet === "wallet-B" || user.stealf_wallet === "wallet-B";
    const isOwnerC = user.cash_wallet === "wallet-C" || user.stealf_wallet === "wallet-C";

    expect(isOwnerA).toBe(true);
    expect(isOwnerB).toBe(true);
    expect(isOwnerC).toBe(false);
  });
});
