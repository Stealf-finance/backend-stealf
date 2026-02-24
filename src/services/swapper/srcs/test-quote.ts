import { order } from './services/swap/swapOrchestrator';
import logger from '../../../config/logger';

// Test: order 0.01 SOL -> USDC
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const TAKER = 'BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV'; // Test address from Jupiter docs

async function main() {
  try {
    const res = await order({
      inputMint: WSOL_MINT,
      amount: '10000000', // 0.01 SOL
      taker: TAKER,
    });

    logger.info({
      inAmount: res.inAmount,
      outAmount: res.outAmount,
      outAmountUSDC: (parseInt(res.outAmount) / 1_000_000).toFixed(2),
      priceImpact: res.priceImpact,
      feeBps: res.feeBps,
      gasless: res.gasless,
      hasTx: !!res.transaction,
      requestId: res.requestId,
      route: res.routePlan?.map((r: any) => r.swapInfo.label).join(' -> '),
    }, 'Test quote result');
  } catch (error: any) {
    logger.error({ err: error, data: error.response?.data }, 'Test quote error');
  }
}

main();
