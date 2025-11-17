import React, { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWalletLink } from './WalletLinkProvider';

interface LinkWalletButtonProps {
  gridWallet: PublicKey;
  privateWallet: PublicKey;
  onSuccess?: (signature: string) => void;
  onError?: (error: Error) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Button component to link wallets
 *
 * @example
 * ```tsx
 * import { LinkWalletButton } from '@stealf/wallet-link-sdk/react';
 *
 * function MyComponent() {
 *   const gridWallet = new PublicKey("...");
 *   const privateWallet = new PublicKey("...");
 *
 *   return (
 *     <LinkWalletButton
 *       gridWallet={gridWallet}
 *       privateWallet={privateWallet}
 *       onSuccess={(sig) => console.log("Linked!", sig)}
 *     />
 *   );
 * }
 * ```
 */
export function LinkWalletButton({
  gridWallet,
  privateWallet,
  onSuccess,
  onError,
  className,
  disabled
}: LinkWalletButtonProps) {
  const { client, checkHasLinkedWallets } = useWalletLink();
  const [isLinking, setIsLinking] = useState(false);
  const [status, setStatus] = useState('');

  const handleLink = async () => {
    if (!client || disabled) return;

    setIsLinking(true);
    setStatus('Starting...');

    try {
      const result = await client.linkWallets({
        gridWallet,
        privateWallet,
        onProgress: (msg) => {
          setStatus(msg);
        },
        onComputationQueued: (signature) => {
          console.log('[WalletLink] Computation queued:', signature);
        }
      });

      setStatus('Success!');
      await checkHasLinkedWallets();
      onSuccess?.(result.signature);
    } catch (error: any) {
      console.error('[WalletLink] Error:', error);
      setStatus(`Error: ${error.message}`);
      onError?.(error);
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleLink}
        disabled={disabled || isLinking || !client}
        className={className}
      >
        {isLinking ? 'Linking...' : 'Link Wallets'}
      </button>
      {status && <p>{status}</p>}
    </div>
  );
}
