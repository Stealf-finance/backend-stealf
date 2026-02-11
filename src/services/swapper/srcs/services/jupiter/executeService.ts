import axios from 'axios';
import { JUPITER_ULTRA_URL, JUPITER_API_KEY } from '../../constants';
import { ExecuteRequest, ExecuteResponse } from '../../types/swap';

export async function executeSwap(request: ExecuteRequest): Promise<ExecuteResponse> {
  const { data } = await axios.post(`${JUPITER_ULTRA_URL}/execute`, {
    requestId: request.requestId,
    signedTransaction: request.signedTransaction,
  }, {
    headers: {
      'x-api-key': JUPITER_API_KEY,
    },
  });

  return data as ExecuteResponse;
}
