import axios from 'axios';

const JUPITER_ULTRA_API = 'https://api.jup.ag/ultra/v1';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

interface OrderParams {
    inputMint: string;
    amount: string;
    taker: string;
    receiver?: string;
}

interface OrderResponse {
    requestId: string;
    transaction: string;
    totalInputAmount: string;
    totalOutputAmount: string;
    expiresAt: string;
    swapType: string;
    slippageBps: number;
    [key: string]: unknown;
}

interface ExecuteParams {
    requestId: string;
    signedTransaction: string;
}

interface ExecuteResponse {
    status: string;
    signature: string;
    slot: number;
    code: number;
    inputAmountResult: string;
    outputAmountResult: string;
    swapEvents: unknown[];
    [key: string]: unknown;
}

export class JupiterSwapService {
    private apiKey: string;

    constructor() {
        const key = process.env.JUPITER_API_KEY;
        if (!key) {
            throw new Error('JUPITER_API_KEY environment variable is required');
        }
        this.apiKey = key;
    }

    async getOrder(params: OrderParams): Promise<OrderResponse> {
        const queryParams: Record<string, string> = {
            inputMint: params.inputMint,
            outputMint: USDC_MINT,
            amount: params.amount,
            taker: params.taker,
        };

        if (params.receiver) {
            queryParams.receiver = params.receiver;
        }

        const response = await axios.get<OrderResponse>(
            `${JUPITER_ULTRA_API}/order`,
            {
                params: queryParams,
                headers: { 'x-api-key': this.apiKey },
            }
        );

        return response.data;
    }

    async executeSwap(params: ExecuteParams): Promise<ExecuteResponse> {
        const response = await axios.post<ExecuteResponse>(
            `${JUPITER_ULTRA_API}/execute`,
            {
                requestId: params.requestId,
                signedTransaction: params.signedTransaction,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                },
            }
        );

        return response.data;
    }
}

export const jupiterSwapService = new JupiterSwapService();
