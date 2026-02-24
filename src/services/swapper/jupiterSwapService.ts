import axios, { isAxiosError } from 'axios';
import baseLogger from '../../config/logger';

const JUPITER_ULTRA_API = 'https://api.jup.ag/ultra/v1';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const jupiterLogger = baseLogger.child({ module: 'Jupiter' });

function logJupiter(method: string, url: string, params?: Record<string, string>, body?: unknown) {
    jupiterLogger.debug({ method, url, params, body }, 'Jupiter API request');
}

function logJupiterResponse(method: string, status: number, data: unknown) {
    jupiterLogger.debug({ method, status, data }, 'Jupiter API response');
}

function logJupiterError(method: string, error: unknown) {
    if (isAxiosError(error) && error.response) {
        jupiterLogger.error({ method, status: error.response.status, data: error.response.data }, 'Jupiter API error');
    } else {
        jupiterLogger.error({ err: error, method }, 'Jupiter API error');
    }
}

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
            outputMint: USDC_MINT,
            amount: params.amount,
            taker: params.taker,
        };

        if (params.receiver) {
            queryParams.receiver = params.receiver;
        }

        const url = `${JUPITER_ULTRA_API}/order`;
        logJupiter('GET', url, queryParams);

        try {
            const response = await axios.get<OrderResponse>(url, {
                params: queryParams,
                headers: { 'x-api-key': this.getApiKey() },
            });

            logJupiterResponse('GET /order', response.status, response.data);
            return response.data;
        } catch (error) {
            logJupiterError('GET /order', error);
            throw error;
        }
    }

    async executeSwap(params: ExecuteParams): Promise<ExecuteResponse> {
        const url = `${JUPITER_ULTRA_API}/execute`;
        const body = {
            requestId: params.requestId,
            signedTransaction: params.signedTransaction,
        };
        logJupiter('POST', url, undefined, body);

        try {
            const response = await axios.post<ExecuteResponse>(url, body, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.getApiKey(),
                },
            });

            logJupiterResponse('POST /execute', response.status, response.data);
            return response.data;
        } catch (error) {
            logJupiterError('POST /execute', error);
            throw error;
        }
    }
}

export const jupiterSwapService = new JupiterSwapService();
