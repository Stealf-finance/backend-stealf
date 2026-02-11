import axios from 'axios';
import { JUPITER_ULTRA_URL, JUPITER_API_KEY, USDC_MINT } from '../../constants';
import { OrderRequest, OrderResponse } from '../../types/swap';

export async function getOrder(request: OrderRequest): Promise<OrderResponse> {
  const { inputMint, amount, taker, receiver } = request;

  const { data } = await axios.get(`${JUPITER_ULTRA_URL}/order`, {
    headers: {
      'x-api-key': JUPITER_API_KEY,
    },
    params: {
      inputMint,
      outputMint: USDC_MINT,
      amount,
      taker,
      receiver,
    },
  });

  return data as OrderResponse;
}
