# 🔗 Frontend Integration Guide - npm link Method

This guide explains how to integrate the Stealf SDK into your frontend application using **npm link** for local development.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [SDK Setup](#sdk-setup)
3. [Frontend Setup](#frontend-setup)
4. [Configuration](#configuration)
5. [Usage Examples](#usage-examples)
6. [Troubleshooting](#troubleshooting)
7. [Development Workflow](#development-workflow)

---

## Prerequisites

### Required Dependencies

Your frontend project needs these dependencies:

```bash
npm install @solana/web3.js@^1.95.8
npm install @coral-xyz/anchor@^0.32.1
npm install @solana/wallet-adapter-react
npm install @solana/wallet-adapter-react-ui
npm install @solana/wallet-adapter-wallets
```

### Environment

- Node.js >= 18.0.0
- npm >= 8.0.0
- A React application (Next.js, Vite, CRA, etc.)

---

## SDK Setup

### Step 1: Build the SDK

First, navigate to the SDK directory and build it:

```bash
cd /Users/thomasgaugain/Documents/backend-stealf/sdk
npm install
npm run build
```

**Expected output:**
```
✓ Successfully built SDK
✓ Generated dist/ folder
✓ Created type definitions (.d.ts files)
```

### Step 2: Create npm link

Still in the SDK directory, create the link:

```bash
npm link
```

**Expected output:**
```
/usr/local/lib/node_modules/@stealf/sdk -> /Users/thomasgaugain/Documents/backend-stealf/sdk
```

**Verification:** Check that the link was created:
```bash
ls -la /usr/local/lib/node_modules/ | grep stealf
```

---

## Frontend Setup

### Step 1: Link the SDK to Your Frontend

Navigate to your frontend project directory:

```bash
cd /path/to/your/frontend
npm link @stealf/sdk
```

**Expected output:**
```
/path/to/your/frontend/node_modules/@stealf/sdk -> /usr/local/lib/node_modules/@stealf/sdk
```

### Step 2: Verify Installation

Check that the SDK is linked:

```bash
ls -la node_modules/@stealf/
```

You should see a symlink pointing to the SDK directory.

### Step 3: Configure Solana Wallet Adapter

Create or update your wallet provider configuration:

**File: `src/components/WalletProvider.tsx`**

```typescript
import React, { FC, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Import wallet adapters
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  // Add other wallets as needed
} from '@solana/wallet-adapter-wallets';

require('@solana/wallet-adapter-react-ui/styles.css');

export const SolanaWalletProvider: FC<{ children: React.ReactNode }> = ({ children }) => {
  // Use devnet for testing
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
```

**Wrap your app with the provider:**

```typescript
// App.tsx or _app.tsx
import { SolanaWalletProvider } from './components/WalletProvider';

function App() {
  return (
    <SolanaWalletProvider>
      {/* Your app components */}
    </SolanaWalletProvider>
  );
}
```

---

## Configuration

### Environment Variables

Create a `.env` file in your frontend project:

```bash
# Solana Network
REACT_APP_SOLANA_NETWORK=devnet
REACT_APP_SOLANA_RPC_URL=https://api.devnet.solana.com

# Stealf SDK
REACT_APP_PROGRAM_ID=CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm
REACT_APP_CLUSTER_OFFSET=1100229901
```

**For Next.js, use `NEXT_PUBLIC_` prefix:**

```bash
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm
NEXT_PUBLIC_CLUSTER_OFFSET=1100229901
```

---

## Usage Examples

### Scenario 1: Account Creation (Signup)

When a new user signs up with their Grid Smart Account and needs a private wallet.

**File: `src/components/AccountCreation.tsx`**

```typescript
import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletLinkClient } from '@stealf/sdk';
import { PublicKey, Keypair } from '@solana/web3.js';

export const AccountCreation: React.FC = () => {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [privateWallet, setPrivateWallet] = useState<Keypair | null>(null);
  const [status, setStatus] = useState<string>('');

  const handleCreateAccount = async () => {
    if (!publicKey || !signTransaction) {
      alert('Please connect your Grid Smart Account wallet first');
      return;
    }

    setLoading(true);
    setStatus('Initializing...');

    try {
      // Initialize SDK client
      const client = await WalletLinkClient.initialize({
        connection,
        programId: new PublicKey(process.env.REACT_APP_PROGRAM_ID!),
        clusterOffset: parseInt(process.env.REACT_APP_CLUSTER_OFFSET!),
        signTransaction,
      });

      setStatus('Creating private wallet and linking accounts...');

      // Link Grid Smart Account with auto-generated Private Wallet
      const result = await client.linkSmartAccountWithPrivateWallet({
        gridWallet: publicKey,
        onComputationQueued: (signature) => {
          setStatus(`Transaction sent: ${signature.slice(0, 8)}...`);
          console.log('Computation queued:', signature);
        },
        onProgress: (progressStatus) => {
          setStatus(progressStatus);
        },
      });

      // Save the private wallet securely
      setPrivateWallet(result.privateWallet);

      // Store in localStorage (or better: encrypted storage)
      const privateWalletData = {
        publicKey: result.privateWallet.publicKey.toBase58(),
        secretKey: Array.from(result.privateWallet.secretKey),
      };
      localStorage.setItem('stealf_private_wallet', JSON.stringify(privateWalletData));

      setStatus('Success! Private wallet created and linked.');
      alert(`Private Wallet Created!\n\nGrid Wallet: ${result.gridWallet.toBase58()}\nPrivate Wallet: ${result.privateWallet.publicKey.toBase58()}`);

    } catch (error) {
      console.error('Error creating account:', error);
      setStatus('Error: ' + (error as Error).message);
      alert('Failed to create account. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="account-creation">
      <h2>Create Private Wallet</h2>

      {publicKey ? (
        <div>
          <p>Grid Smart Account: {publicKey.toBase58()}</p>

          <button
            onClick={handleCreateAccount}
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create & Link Private Wallet'}
          </button>

          {status && <p className="status">{status}</p>}

          {privateWallet && (
            <div className="success">
              <h3>✅ Private Wallet Created!</h3>
              <p><strong>Address:</strong> {privateWallet.publicKey.toBase58()}</p>
              <p className="warning">
                ⚠️ Your private key has been saved to browser storage.
                In production, use secure encrypted storage!
              </p>
            </div>
          )}
        </div>
      ) : (
        <p>Please connect your Grid Smart Account wallet first.</p>
      )}
    </div>
  );
};
```

---

### Scenario 2: Login (Retrieve Linked Wallets)

When an existing user logs in with their Grid Smart Account.

**File: `src/components/Login.tsx`**

```typescript
import React, { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletLinkClient } from '@stealf/sdk';
import { PublicKey, Keypair } from '@solana/web3.js';

export const Login: React.FC = () => {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [hasLinkedWallet, setHasLinkedWallet] = useState(false);
  const [wallets, setWallets] = useState<{ grid: PublicKey; private: PublicKey } | null>(null);
  const [status, setStatus] = useState<string>('');

  // Check if wallet has linked accounts
  useEffect(() => {
    const checkLinkedWallets = async () => {
      if (!publicKey || !signTransaction) return;

      try {
        const client = await WalletLinkClient.initialize({
          connection,
          programId: new PublicKey(process.env.REACT_APP_PROGRAM_ID!),
          clusterOffset: parseInt(process.env.REACT_APP_CLUSTER_OFFSET!),
          signTransaction,
        });

        const hasWallets = await client.hasLinkedWallets(publicKey);
        setHasLinkedWallet(hasWallets);
      } catch (error) {
        console.error('Error checking linked wallets:', error);
      }
    };

    checkLinkedWallets();
  }, [publicKey, connection, signTransaction]);

  const handleLogin = async () => {
    if (!publicKey || !signTransaction) {
      alert('Please connect your Grid Smart Account wallet first');
      return;
    }

    if (!hasLinkedWallet) {
      alert('No linked wallet found. Please create an account first.');
      return;
    }

    setLoading(true);
    setStatus('Initializing...');

    try {
      // Initialize SDK client
      const client = await WalletLinkClient.initialize({
        connection,
        programId: new PublicKey(process.env.REACT_APP_PROGRAM_ID!),
        clusterOffset: parseInt(process.env.REACT_APP_CLUSTER_OFFSET!),
        signTransaction,
      });

      setStatus('Retrieving linked wallets via MPC...');

      // Retrieve linked wallets
      const result = await client.retrieveLinkedWallets({
        gridWallet: publicKey,
        onComputationQueued: (signature) => {
          setStatus(`MPC computation queued: ${signature.slice(0, 8)}...`);
          console.log('Computation queued:', signature);
        },
        onProgress: (progressStatus) => {
          setStatus(progressStatus);
        },
      });

      setWallets({
        grid: result.gridWallet,
        private: result.privateWallet,
      });

      setStatus('Success! Wallets retrieved.');

      // You might want to reconstruct the full Keypair from localStorage
      const storedWallet = localStorage.getItem('stealf_private_wallet');
      if (storedWallet) {
        const { secretKey } = JSON.parse(storedWallet);
        const privateKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
        console.log('Private wallet restored:', privateKeypair.publicKey.toBase58());
      }

    } catch (error) {
      console.error('Error logging in:', error);
      setStatus('Error: ' + (error as Error).message);
      alert('Failed to retrieve wallets. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <h2>Login</h2>

      {publicKey ? (
        <div>
          <p>Grid Smart Account: {publicKey.toBase58()}</p>

          {hasLinkedWallet ? (
            <p className="success">✅ Linked wallet detected</p>
          ) : (
            <p className="warning">⚠️ No linked wallet found</p>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || !hasLinkedWallet}
          >
            {loading ? 'Logging in...' : 'Login & Retrieve Wallets'}
          </button>

          {status && <p className="status">{status}</p>}

          {wallets && (
            <div className="wallets-info">
              <h3>✅ Logged In Successfully!</h3>
              <div>
                <strong>Grid Wallet:</strong>
                <p>{wallets.grid.toBase58()}</p>
              </div>
              <div>
                <strong>Private Wallet:</strong>
                <p>{wallets.private.toBase58()}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p>Please connect your Grid Smart Account wallet first.</p>
      )}
    </div>
  );
};
```

---

### Complete Example: App Integration

**File: `src/App.tsx`**

```typescript
import React, { useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { SolanaWalletProvider } from './components/WalletProvider';
import { AccountCreation } from './components/AccountCreation';
import { Login } from './components/Login';

function AppContent() {
  const { connected } = useWallet();
  const [mode, setMode] = useState<'signup' | 'login'>('login');

  return (
    <div className="app">
      <header>
        <h1>Stealf - Private Wallet System</h1>
        <WalletMultiButton />
      </header>

      {connected && (
        <div className="content">
          <div className="mode-switch">
            <button
              className={mode === 'login' ? 'active' : ''}
              onClick={() => setMode('login')}
            >
              Login
            </button>
            <button
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => setMode('signup')}
            >
              Sign Up
            </button>
          </div>

          {mode === 'signup' ? <AccountCreation /> : <Login />}
        </div>
      )}

      {!connected && (
        <div className="connect-prompt">
          <p>Please connect your Grid Smart Account wallet to continue.</p>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <SolanaWalletProvider>
      <AppContent />
    </SolanaWalletProvider>
  );
}

export default App;
```

---

## Troubleshooting

### Issue 1: Module not found - '@stealf/sdk'

**Symptom:**
```
Module not found: Can't resolve '@stealf/sdk'
```

**Solutions:**

1. **Verify npm link was created:**
   ```bash
   cd /Users/thomasgaugain/Documents/backend-stealf/sdk
   npm link
   ```

2. **Re-link in frontend:**
   ```bash
   cd /path/to/your/frontend
   npm unlink @stealf/sdk
   npm link @stealf/sdk
   ```

3. **Check symlink exists:**
   ```bash
   ls -la node_modules/@stealf/
   ```

4. **Rebuild SDK:**
   ```bash
   cd /Users/thomasgaugain/Documents/backend-stealf/sdk
   npm run build
   ```

---

### Issue 2: TypeScript errors

**Symptom:**
```
Could not find a declaration file for module '@stealf/sdk'
```

**Solutions:**

1. **Ensure SDK was built:**
   ```bash
   cd /Users/thomasgaugain/Documents/backend-stealf/sdk
   npm run build
   # Verify dist/ folder contains .d.ts files
   ls -la dist/
   ```

2. **Add to tsconfig.json:**
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@stealf/sdk": ["./node_modules/@stealf/sdk/dist"]
       }
     }
   }
   ```

---

### Issue 3: Wallet not connected

**Symptom:**
```
TypeError: Cannot read property 'publicKey' of null
```

**Solution:**

Always check wallet connection before using SDK:

```typescript
const { publicKey, signTransaction } = useWallet();

if (!publicKey || !signTransaction) {
  alert('Please connect wallet first');
  return;
}
```

---

### Issue 4: MPC Computation Timeout

**Symptom:**
```
Error: MPC computation timed out
```

**Explanation:**
The MPC devnet cluster can be slow. The transaction succeeds on-chain, but the MPC computation is queued.

**Solutions:**

1. **Increase timeout in SDK client** (if needed, modify SDK):
   ```typescript
   // In WalletLinkClient.ts
   private readonly MPC_TIMEOUT = 120000; // 2 minutes instead of 60s
   ```

2. **Retry retrieval later:**
   ```typescript
   try {
     const result = await client.retrieveLinkedWallets({ gridWallet });
   } catch (error) {
     if (error.message.includes('timeout')) {
       alert('MPC computation is still processing. Please try again in a few minutes.');
     }
   }
   ```

3. **Check transaction on Solana Explorer:**
   - Go to https://explorer.solana.com/?cluster=devnet
   - Search for the transaction signature
   - Verify it succeeded (even if MPC is slow)

---

### Issue 5: Development Server Not Hot Reloading SDK Changes

**Symptom:**
Changes to SDK code don't reflect in frontend without restart.

**Solution:**

1. **Use watch mode in SDK:**
   ```bash
   cd /Users/thomasgaugain/Documents/backend-stealf/sdk
   npm run build -- --watch
   ```

2. **Configure frontend bundler:**

   **For Vite:**
   ```javascript
   // vite.config.js
   export default {
     server: {
       watch: {
         usePolling: true,
       },
     },
     resolve: {
       alias: {
         '@stealf/sdk': '/Users/thomasgaugain/Documents/backend-stealf/sdk/dist',
       },
     },
   };
   ```

   **For Webpack (CRA):**
   ```javascript
   // craco.config.js or webpack.config.js
   module.exports = {
     watchOptions: {
       poll: 1000,
       ignored: /node_modules/,
     },
   };
   ```

---

## Development Workflow

### Daily Development Flow

1. **Terminal 1 - SDK Development:**
   ```bash
   cd /Users/thomasgaugain/Documents/backend-stealf/sdk
   npm run build -- --watch
   ```

2. **Terminal 2 - Frontend Development:**
   ```bash
   cd /path/to/your/frontend
   npm run dev  # or npm start
   ```

3. **Make changes to SDK** → Auto-rebuilds → **Frontend picks up changes**

---

### When to Rebuild SDK

**Rebuild manually when:**
- Adding new public exports
- Changing type definitions
- Modifying package.json

```bash
cd /Users/thomasgaugain/Documents/backend-stealf/sdk
npm run build
```

---

### Testing Changes

1. **Unit test SDK:**
   ```bash
   cd /Users/thomasgaugain/Documents/backend-stealf/sdk
   npm test
   ```

2. **Integration test from frontend:**
   - Test account creation flow
   - Test login flow
   - Check console for errors
   - Verify on Solana Explorer

---

### Unlinking (When Done Developing)

When you're ready to publish the SDK to npm:

1. **Unlink from frontend:**
   ```bash
   cd /path/to/your/frontend
   npm unlink @stealf/sdk
   ```

2. **Unlink SDK globally:**
   ```bash
   cd /Users/thomasgaugain/Documents/backend-stealf/sdk
   npm unlink
   ```

3. **Install from npm (once published):**
   ```bash
   cd /path/to/your/frontend
   npm install @stealf/sdk
   ```

---

## Additional Resources

- **SDK Documentation:** [sdk/README.md](./README.md)
- **Usage Examples:** [sdk/USAGE_EXAMPLE.md](./USAGE_EXAMPLE.md)
- **Implementation Details:** [sdk/IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
- **Solana Wallet Adapter:** https://github.com/solana-labs/wallet-adapter
- **Arcium Documentation:** https://docs.arcium.com

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review SDK documentation in `sdk/README.md`
3. Check console logs for detailed error messages
4. Verify Solana Explorer for transaction status


