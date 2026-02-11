import { order } from './services/swap/swapOrchestrator';

// Test: order 0.01 SOL → USDC
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const TAKER = 'BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV'; // Adresse test de la doc Jupiter

async function main() {
  try {
    const res = await order({
      inputMint: WSOL_MINT,
      amount: '10000000', // 0.01 SOL
      taker: TAKER,
    });

    console.log('Input:', res.inAmount, 'lamports SOL');
    console.log('Output:', res.outAmount, 'USDC (raw)');
    console.log('Output USDC:', (parseInt(res.outAmount) / 1_000_000).toFixed(2), '$');
    console.log('Price impact:', res.priceImpact);
    console.log('Fees:', res.feeBps, 'bps');
    console.log('Gasless:', res.gasless);
    console.log('TX present:', !!res.transaction);
    console.log('Request ID:', res.requestId);
    console.log('Route:', res.routePlan?.map(r => r.swapInfo.label).join(' → '));
  } catch (error: any) {
    console.error('Error:', error.response?.data || error.message);
  }
}

main();
