import React, { useState, useEffect } from 'react';
import { WalletLinkClient } from '@stealf/wallet-link-sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

/**
 * Example React component showing wallet linking integration
 */
export function WalletLinkingExample() {
  const wallet = useWallet();
  const [client, setClient] = useState<WalletLinkClient | null>(null);
  const [hasLinked, setHasLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [wallets, setWallets] = useState<{
    gridWallet: PublicKey;
    privateWallet: PublicKey;
  } | null>(null);

  // Initialize client when wallet connects
  useEffect(() => {
    if (wallet.publicKey && wallet.signTransaction) {
      const newClient = new WalletLinkClient(wallet as any, {
        environment: 'devnet'
      });
      setClient(newClient);

      // Check if user has linked wallets
      newClient.hasLinkedWallets().then(setHasLinked);
    }
  }, [wallet.publicKey]);

  // Link new wallets
  const handleLinkWallets = async () => {
    if (!client) return;

    setLoading(true);
    setStatus('Starting...');

    try {
      // In a real app, these would come from user input or smart contract
      const gridWallet = new PublicKey("..."); // User's smart account
      const privateWallet = new PublicKey("..."); // Generated private wallet

      const result = await client.linkWallets({
        gridWallet,
        privateWallet,
        onProgress: (msg) => {
          console.log(msg);
          setStatus(msg);
        },
        onComputationQueued: (signature) => {
          console.log('Transaction:', signature);
        }
      });

      setWallets({ gridWallet, privateWallet });
      setHasLinked(true);
      setStatus(`✅ Wallets linked! TX: ${result.signature}`);
    } catch (error) {
      console.error('Link error:', error);
      setStatus(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Retrieve existing wallets
  const handleRetrieveWallets = async () => {
    if (!client) return;

    setLoading(true);
    setStatus('Retrieving wallets...');

    try {
      const result = await client.retrieveLinkedWallets({
        onProgress: (msg) => {
          console.log(msg);
          setStatus(msg);
        }
      });

      setWallets(result);
      setStatus('✅ Wallets retrieved!');
    } catch (error) {
      console.error('Retrieve error:', error);
      setStatus(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!wallet.connected) {
    return (
      <div className="wallet-link-container">
        <p>Please connect your wallet first</p>
      </div>
    );
  }

  return (
    <div className="wallet-link-container">
      <h2>Private Wallet Linking</h2>

      <div className="status-section">
        {status && <p className="status">{status}</p>}
        {loading && <div className="loader">Processing...</div>}
      </div>

      {!hasLinked ? (
        <div className="link-section">
          <h3>Link Your Wallets</h3>
          <p>Create a secure link between your smart account and private wallet</p>
          <button
            onClick={handleLinkWallets}
            disabled={loading || !client}
            className="btn-primary"
          >
            {loading ? 'Linking...' : 'Link Wallets'}
          </button>
        </div>
      ) : (
        <div className="retrieve-section">
          <h3>Retrieve Your Wallets</h3>
          <p>Securely retrieve your linked wallet addresses</p>
          <button
            onClick={handleRetrieveWallets}
            disabled={loading || !client}
            className="btn-primary"
          >
            {loading ? 'Retrieving...' : 'Retrieve Wallets'}
          </button>
        </div>
      )}

      {wallets && (
        <div className="wallets-display">
          <h3>Your Wallets</h3>
          <div className="wallet-item">
            <strong>Grid Wallet:</strong>
            <code>{wallets.gridWallet.toBase58()}</code>
          </div>
          <div className="wallet-item">
            <strong>Private Wallet:</strong>
            <code>{wallets.privateWallet.toBase58()}</code>
          </div>
        </div>
      )}
    </div>
  );
}

// Example CSS (optional)
const styles = `
.wallet-link-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
}

.status-section {
  margin-bottom: 2rem;
  min-height: 50px;
}

.status {
  padding: 1rem;
  background: #f0f0f0;
  border-radius: 8px;
}

.loader {
  text-align: center;
  color: #666;
}

.btn-primary {
  padding: 1rem 2rem;
  background: #0070f3;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wallets-display {
  margin-top: 2rem;
  padding: 1rem;
  background: #f9f9f9;
  border-radius: 8px;
}

.wallet-item {
  margin: 1rem 0;
}

.wallet-item code {
  display: block;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  word-break: break-all;
}
`;