// --- Order (quote + TX en 1 appel) ---

export interface OrderRequest {
  inputMint: string;        // Mint du token SPL à swapper
  outputMint?: string;      // Default USDC
  amount: string;           // Montant en smallest unit
  taker: string;            // Wallet sender qui signe
  receiver?: string;        // Wallet recipient (reçoit USDC directement)
}

export interface OrderResponse {
  requestId: string;        // Requis pour /execute
  transaction: string;      // TX base64 unsigned, à signer via Turnkey
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  inUsdValue: number;
  outUsdValue: number;
  priceImpact: number;
  swapMode: string;
  slippageBps: number;
  otherAmountThreshold: string;
  feeBps: number;
  prioritizationFeeLamports: number;
  signatureFeeLamports: number;
  rentFeeLamports: number;
  gasless: boolean;
  routePlan: RoutePlan[];
  expireAt: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

// --- Execute (broadcast TX signée) ---

export interface ExecuteRequest {
  requestId: string;        // Du OrderResponse
  signedTransaction: string; // TX signée base64 par Turnkey
}

export interface ExecuteResponse {
  status: string;
  signature: string;        // TX signature on-chain
  error?: string;
}
