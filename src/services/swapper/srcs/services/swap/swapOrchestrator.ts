import { getOrder } from '../jupiter/orderService';
import { executeSwap } from '../jupiter/executeService';
import { USDC_MINT } from '../../constants';
import { OrderRequest, OrderResponse, ExecuteResponse } from '../../types/swap';

// Step 1 — Order : quote + TX unsigned en 1 appel
// Le param receiver envoie les USDC directement au recipient
export async function order(request: OrderRequest): Promise<OrderResponse> {
  return getOrder({
    ...request,
    outputMint: USDC_MINT,
  });
}

export async function execute(requestId: string, signedTransaction: string): Promise<ExecuteResponse> {
  return executeSwap({ requestId, signedTransaction });
}
