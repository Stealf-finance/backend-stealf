/**
 * Test Connectivity to Umbra Services
 * Tests: Program ID, Relayer, Indexer
 */

import { Connection, PublicKey } from '@solana/web3.js';

const log = {
  info: (msg: string) => console.log(`ℹ ${msg}`),
  success: (msg: string) => console.log(`✓ ${msg}`),
  warn: (msg: string) => console.log(`⚠ ${msg}`),
  error: (msg: string) => console.log(`✗ ${msg}`),
  step: (msg: string) => console.log(`\n▶ ${msg}`),
};

// Configuration
const PROGRAM_ID = 'A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4';
const RELAYER_URL = 'https://relayer.umbraprivacy.com/';
const INDEXER_URL = 'https://5nqw12m1pa.execute-api.eu-central-1.amazonaws.com/proof/';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

async function testConnectivity() {
  let results = {
    solana: false,
    program: false,
    relayer: false,
    indexer: false,
  };

  try {
    log.step('🔍 Testing Umbra Infrastructure Connectivity');

    // ============================================
    // 1. Test Solana RPC
    // ============================================
    log.step('1️⃣ Testing Solana RPC Connection');

    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const version = await connection.getVersion();
      log.success(`Connected to Solana RPC: ${RPC_URL}`);
      log.info(`Solana version: ${JSON.stringify(version)}`);

      const slot = await connection.getSlot();
      log.info(`Current slot: ${slot}`);

      results.solana = true;

      // ============================================
      // 2. Test Program ID
      // ============================================
      log.step('2️⃣ Testing Umbra Program on Devnet');

      try {
        const programPubkey = new PublicKey(PROGRAM_ID);
        const accountInfo = await connection.getAccountInfo(programPubkey);

        if (accountInfo) {
          log.success(`✅ Umbra Program Found!`);
          log.info(`Program ID: ${PROGRAM_ID}`);
          log.info(`Owner: ${accountInfo.owner.toBase58()}`);
          log.info(`Executable: ${accountInfo.executable}`);
          log.info(`Data length: ${accountInfo.data.length} bytes`);

          if (accountInfo.executable) {
            log.success('Program is executable ✓');
            results.program = true;
          } else {
            log.warn('Account exists but is not executable');
          }
        } else {
          log.error(`❌ Program not found at ${PROGRAM_ID}`);
          log.warn('The program may not be deployed on Devnet');
        }
      } catch (error: any) {
        log.error(`Failed to fetch program: ${error.message}`);
      }

    } catch (error: any) {
      log.error(`Solana RPC connection failed: ${error.message}`);
    }

    // ============================================
    // 3. Test Relayer
    // ============================================
    log.step('3️⃣ Testing Umbra Relayer');

    try {
      // Test base URL
      const relayerResponse = await fetch(RELAYER_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      log.info(`Relayer URL: ${RELAYER_URL}`);
      log.info(`Status: ${relayerResponse.status} ${relayerResponse.statusText}`);

      if (relayerResponse.ok) {
        log.success('✅ Relayer is accessible!');
        const text = await relayerResponse.text();
        if (text) {
          log.info(`Response: ${text.slice(0, 200)}...`);
        }
        results.relayer = true;
      } else {
        log.warn(`Relayer responded with status ${relayerResponse.status}`);
        log.info('This might be normal - the relayer might not have a root endpoint');
        // Try health endpoint
        try {
          const healthResponse = await fetch(RELAYER_URL + 'health');
          if (healthResponse.ok) {
            log.success('Health endpoint accessible');
            results.relayer = true;
          }
        } catch (e) {
          log.warn('Health endpoint not found');
        }
      }

    } catch (error: any) {
      log.error(`Relayer connection failed: ${error.message}`);
      log.warn('The relayer might be down or require authentication');
    }

    // ============================================
    // 4. Test Indexer
    // ============================================
    log.step('4️⃣ Testing Umbra Indexer');

    try {
      const indexerResponse = await fetch(INDEXER_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      log.info(`Indexer URL: ${INDEXER_URL}`);
      log.info(`Status: ${indexerResponse.status} ${indexerResponse.statusText}`);

      if (indexerResponse.ok) {
        log.success('✅ Indexer is accessible!');
        const text = await indexerResponse.text();
        if (text) {
          log.info(`Response: ${text.slice(0, 200)}...`);
        }
        results.indexer = true;
      } else {
        log.warn(`Indexer responded with status ${indexerResponse.status}`);

        // Try a specific endpoint (siblings)
        try {
          const siblingsResponse = await fetch(INDEXER_URL + 'siblings/0');
          if (siblingsResponse.ok) {
            log.success('Siblings endpoint accessible');
            const data = await siblingsResponse.json();
            log.info(`Sample response: ${JSON.stringify(data).slice(0, 100)}...`);
            results.indexer = true;
          }
        } catch (e: any) {
          log.warn(`Siblings endpoint failed: ${e.message}`);
        }
      }

    } catch (error: any) {
      log.error(`Indexer connection failed: ${error.message}`);
      log.warn('The indexer might be down or require authentication');
    }

    // ============================================
    // 5. Summary
    // ============================================
    log.step('📊 Connectivity Test Summary');

    console.log('\nResults:');
    console.log(`  Solana RPC:     ${results.solana ? '✅ CONNECTED' : '❌ FAILED'}`);
    console.log(`  Umbra Program:  ${results.program ? '✅ DEPLOYED' : '❌ NOT FOUND'}`);
    console.log(`  Relayer:        ${results.relayer ? '✅ ACCESSIBLE' : '⚠️  UNAVAILABLE'}`);
    console.log(`  Indexer:        ${results.indexer ? '✅ ACCESSIBLE' : '⚠️  UNAVAILABLE'}`);

    const totalTests = Object.keys(results).length;
    const passedTests = Object.values(results).filter(Boolean).length;

    console.log(`\n Score: ${passedTests}/${totalTests} services accessible`);

    if (results.solana && results.program) {
      log.success('\n🎉 Core services are ready!');
      log.info('You can proceed with testing deposits and claims');
    } else if (!results.program) {
      log.warn('\n⚠️  Umbra program not found on Devnet');
      log.info('Options:');
      log.info('  1. Check if there is a mainnet-beta deployment');
      log.info('  2. Deploy the program yourself');
      log.info('  3. Contact Umbra team for deployment status');
    }

    if (!results.relayer || !results.indexer) {
      log.warn('\n⚠️  Some external services are unavailable');
      log.info('This is not critical if:');
      log.info('  - You use mode: "connection" instead of "forwarder"');
      log.info('  - You implement your own indexer for Merkle siblings');
    }

  } catch (error: any) {
    log.error(`Test failed: ${error.message}`);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

// Run test
testConnectivity();
