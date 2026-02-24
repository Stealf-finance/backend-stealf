import axios from 'axios';

const JUPITER_ULTRA_API = 'https://api.jup.ag/ultra/v1';

interface OrderParams {
    inputMint: string;
    outputMint: string;
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
    private getApiKey(): string {
        const key = process.env.JUPITER_API_KEY;
        if (!key) {
            throw new Error('JUPITER_API_KEY environment variable is required');
        }
        return key;
    }

    async getOrder(params: OrderParams): Promise<OrderResponse> {
        const queryParams: Record<string, string> = {
            inputMint: params.inputMint,
            outputMint: params.outputMint,
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
                headers: { 'x-api-key': this.getApiKey() },
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
                    'x-api-key': this.getApiKey(),
                },
            }
        );

        return response.data;
    }
}

export const jupiterSwapService = new JupiterSwapService();
