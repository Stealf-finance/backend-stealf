import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { WalletLinkClient } from '../client/WalletLinkClient';
import { PublicKey } from '@solana/web3.js';
import type { Environment } from '../core/constants';

interface WalletLinkContextType {
  client: WalletLinkClient | null;
  hasLinkedWallets: boolean;
  isLoading: boolean;
  error: string | null;
  checkHasLinkedWallets: () => Promise<void>;
}

const WalletLinkContext = createContext<WalletLinkContextType | undefined>(undefined);

interface WalletLinkProviderProps {
  wallet: any; // Solana wallet adapter
  environment: Environment;
  rpcEndpoint?: string;
  children: ReactNode;
}

/**
 * Provider component for WalletLink SDK
 * Wraps your app to provide wallet linking functionality
 *
 * @example
 * ```tsx
 * import { WalletLinkProvider } from '@stealf/wallet-link-sdk/react';
 *
 * function App() {
 *   const wallet = useWallet();
 *
 *   return (
 *     <WalletLinkProvider wallet={wallet} environment="devnet">
 *       <YourApp />
 *     </WalletLinkProvider>
 *   );
 * }
 * ```
 */
export function WalletLinkProvider({
  wallet,
  environment,
  rpcEndpoint,
  children
}: WalletLinkProviderProps) {
  const [client, setClient] = useState<WalletLinkClient | null>(null);
  const [hasLinkedWallets, setHasLinkedWallets] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize client when wallet connects
  useEffect(() => {
    if (wallet?.publicKey && wallet?.signTransaction) {
      try {
        const newClient = new WalletLinkClient(wallet, {
          environment,
          rpcEndpoint,
        });
        setClient(newClient);
        setError(null);
      } catch (err: any) {
        setError(err.message);
        setClient(null);
      }
    } else {
      setClient(null);
    }
  }, [wallet?.publicKey, environment, rpcEndpoint]);

  // Check if user has linked wallets
  const checkHasLinkedWallets = async () => {
    if (!client) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await client.hasLinkedWallets();
      setHasLinkedWallets(result);
    } catch (err: any) {
      setError(err.message);
      setHasLinkedWallets(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-check on client change
  useEffect(() => {
    checkHasLinkedWallets();
  }, [client]);

  const value: WalletLinkContextType = {
    client,
    hasLinkedWallets,
    isLoading,
    error,
    checkHasLinkedWallets,
  };

  return (
    <WalletLinkContext.Provider value={value}>
      {children}
    </WalletLinkContext.Provider>
  );
}

/**
 * Hook to access WalletLink context
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { client, hasLinkedWallets } = useWalletLink();
 *
 *   if (!client) return <div>Connect wallet first</div>;
 *
 *   // Use client to link/retrieve wallets
 * }
 * ```
 */
export function useWalletLink() {
  const context = useContext(WalletLinkContext);
  if (context === undefined) {
    throw new Error('useWalletLink must be used within a WalletLinkProvider');
  }
  return context;
}
