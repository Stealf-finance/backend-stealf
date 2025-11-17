import React, { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWalletLink } from './WalletLinkProvider';

interface RetrieveWalletsButtonProps {
  onWalletsRetrieved?: (wallets: { gridWallet: PublicKey; privateWallet: PublicKey }) => void;
  onError?: (error: Error) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Button component to retrieve linked wallets
 *
 * @example
 * ```tsx
 * import { RetrieveWalletsButton } from '@stealf/wallet-link-sdk/react';
 *
 * function MyComponent() {
 *   return (
 *     <RetrieveWalletsButton
 *       onWalletsRetrieved={(wallets) => {
 *         console.log("Grid:", wallets.gridWallet.toBase58());
 *         console.log("Private:", wallets.privateWallet.toBase58());
 *       }}
 *     />
 *   );
 * }
 * ```
 */
export function RetrieveWalletsButton({
  onWalletsRetrieved,
  onError,
  className,
  disabled
}: RetrieveWalletsButtonProps) {
  const { client } = useWalletLink();
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [status, setStatus] = useState('');

  const handleRetrieve = async () => {
    if (!client || disabled) return;

    setIsRetrieving(true);
    setStatus('Retrieving...');

    try {
      const result = await client.retrieveLinkedWallets({
        onProgress: (msg) => {
          setStatus(msg);
        }
      });

      setStatus('Success!');
      onWalletsRetrieved?.(result);
    } catch (error: any) {
      console.error('[WalletLink] Retrieve error:', error);
      setStatus(`Error: ${error.message}`);
      onError?.(error);
    } finally {
      setIsRetrieving(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleRetrieve}
        disabled={disabled || isRetrieving || !client}
        className={className}
      >
        {isRetrieving ? 'Retrieving...' : 'Retrieve Wallets'}
      </button>
      {status && <p>{status}</p>}
    </div>
  );
}
