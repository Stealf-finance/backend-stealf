# @stealf/wallet-link-sdk

SDK for integrating **Stealf Private Wallet Linking** with Arcium MPC into your Solana applications.

## Features

- 🔐 **Private Wallet Linking** - Link wallets securely using Multi-Party Computation (MPC)
- 🌐 **Browser & Node.js Support** - Works in both environments
- ⚛️ **React Components** - Pre-built components for quick integration
- 🔒 **Type-Safe** - Full TypeScript support
- 🚀 **Production Ready** - Deployed on Solana Devnet

## Installation

```bash
npm install @stealf/wallet-link-sdk
# or
yarn add @stealf/wallet-link-sdk
```

### Peer Dependencies

```bash
npm install @coral-xyz/anchor @solana/web3.js @arcium-hq/client
```

## Quick Start

### 1. Basic Usage (Vanilla JS/TS)

```typescript
import { WalletLinkClient } from '@stealf/wallet-link-sdk';
import { PublicKey } from '@solana/web3.js';

// Initialize client
const client = new WalletLinkClient(wallet, {
  environment: 'devnet'
});

// Link wallets
const result = await client.linkWallets({
  gridWallet: new PublicKey('...'),   // Your smart account
  privateWallet: new PublicKey('...'), // Generated private wallet
  onProgress: (status) => console.log(status)
});

console.log('Transaction:', result.signature);

// Retrieve linked wallets
const wallets = await client.retrieveLinkedWallets({
  onProgress: (status) => console.log(status)
});

console.log('Grid wallet:', wallets.gridWallet.toBase58());
console.log('Private wallet:', wallets.privateWallet.toBase58());
```

### 2. React Integration

#### Setup Provider

```tsx
import { WalletLinkProvider } from '@stealf/wallet-link-sdk';
import { useWallet } from '@solana/wallet-adapter-react';

function App() {
  const wallet = useWallet();

  return (
    <WalletLinkProvider wallet={wallet} environment="devnet">
      <YourComponents />
    </WalletLinkProvider>
  );
}
```

#### Use Hook

```tsx
import { useWalletLink } from '@stealf/wallet-link-sdk';

function MyComponent() {
  const { client, hasLinkedWallets, isLoading } = useWalletLink();

  if (isLoading) return <div>Loading...</div>;
  if (!client) return <div>Connect your wallet</div>;

  return (
    <div>
      {hasLinkedWallets ? (
        <p>You have linked wallets!</p>
      ) : (
        <p>No linked wallets found</p>
      )}
    </div>
  );
}
```

#### Use Pre-built Components

```tsx
import { LinkWalletButton, RetrieveWalletsButton } from '@stealf/wallet-link-sdk';
import { PublicKey } from '@solana/web3.js';

function WalletManager() {
  const gridWallet = new PublicKey('...');
  const privateWallet = new PublicKey('...');

  return (
    <div>
      <LinkWalletButton
        gridWallet={gridWallet}
        privateWallet={privateWallet}
        onSuccess={(sig) => console.log('Linked!', sig)}
        onError={(err) => console.error(err)}
      />

      <RetrieveWalletsButton
        onWalletsRetrieved={(wallets) => {
          console.log('Grid:', wallets.gridWallet.toBase58());
          console.log('Private:', wallets.privateWallet.toBase58());
        }}
      />
    </div>
  );
}
```

## API Reference

### WalletLinkClient

#### Constructor

```typescript
new WalletLinkClient(wallet: Wallet, config: WalletLinkConfig)
```

**Config Options:**
- `environment`: `'devnet' | 'mainnet'` - Network to use
- `rpcEndpoint?`: `string` - Custom RPC endpoint (optional)
- `programId?`: `PublicKey` - Custom program ID (optional)
- `clusterOffset?`: `number` - Custom cluster offset (optional)

#### Methods

##### `linkWallets(options)`

Link a grid wallet with a private wallet using MPC.

```typescript
await client.linkWallets({
  gridWallet: PublicKey,
  privateWallet: PublicKey,
  onProgress?: (status: string) => void,
  onComputationQueued?: (signature: string) => void
});
```

**Returns:** `Promise<LinkWalletsResult>`

**Flow:**
1. Fetches MXE public key
2. Encrypts wallet data
3. Stores encrypted data on-chain
4. Queues MPC computation
5. Waits for computation to complete

##### `retrieveLinkedWallets(options?)`

Retrieve previously linked wallets via MPC re-encryption.

```typescript
await client.retrieveLinkedWallets({
  onProgress?: (status: string) => void,
  onComputationQueued?: (signature: string) => void
});
```

**Returns:** `Promise<{ gridWallet: PublicKey, privateWallet: PublicKey }>`

##### `hasLinkedWallets()`

Check if the current user has linked wallets.

```typescript
const hasLinked: boolean = await client.hasLinkedWallets();
```

## React Components

### `<WalletLinkProvider>`

Provider component that wraps your app.

**Props:**
- `wallet`: Solana wallet adapter instance
- `environment`: `'devnet' | 'mainnet'`
- `rpcEndpoint?`: Custom RPC endpoint
- `children`: React nodes

### `useWalletLink()`

Hook to access wallet link context.

**Returns:**
```typescript
{
  client: WalletLinkClient | null,
  hasLinkedWallets: boolean,
  isLoading: boolean,
  error: string | null,
  checkHasLinkedWallets: () => Promise<void>
}
```

### `<LinkWalletButton>`

Pre-built button component to link wallets.

**Props:**
- `gridWallet`: PublicKey
- `privateWallet`: PublicKey
- `onSuccess?`: (signature: string) => void
- `onError?`: (error: Error) => void
- `className?`: string
- `disabled?`: boolean

### `<RetrieveWalletsButton>`

Pre-built button component to retrieve wallets.

**Props:**
- `onWalletsRetrieved?`: (wallets) => void
- `onError?`: (error: Error) => void
- `className?`: string
- `disabled?`: boolean

## Error Handling

The SDK provides typed error classes:

```typescript
import {
  WalletLinkError,
  EncryptionError,
  MPCError,
  MPCTimeoutError,
  WalletNotConnectedError,
  InsufficientBalanceError,
  WalletsAlreadyLinkedError,
  WalletsNotLinkedError
} from '@stealf/wallet-link-sdk';

try {
  await client.linkWallets({ ... });
} catch (error) {
  if (error instanceof MPCTimeoutError) {
    console.error('MPC computation timed out');
  } else if (error instanceof WalletsAlreadyLinkedError) {
    console.error('Wallets already linked');
  } else {
    console.error('Unknown error:', error);
  }
}
```

## Advanced Usage

### Custom RPC Endpoint

```typescript
const client = new WalletLinkClient(wallet, {
  environment: 'devnet',
  rpcEndpoint: 'https://your-custom-rpc.com'
});
```

### Progress Tracking

```typescript
await client.linkWallets({
  gridWallet,
  privateWallet,
  onProgress: (status) => {
    // Status updates:
    // - "Fetching MXE public key..."
    // - "Encrypting wallet data..."
    // - "Storing encrypted wallets on-chain..."
    // - "Queueing MPC computation..."
    // - "Waiting for MPC computation..."
    // - "Complete!"
    console.log('[Progress]', status);
  },
  onComputationQueued: (signature) => {
    console.log('[TX]', signature);
  }
});
```

### Checking Wallet Status

```typescript
const hasLinked = await client.hasLinkedWallets();

if (hasLinked) {
  // User has already linked wallets
  const wallets = await client.retrieveLinkedWallets();
  // ...
} else {
  // User needs to link wallets first
  await client.linkWallets({ ... });
}
```

## How It Works

### Architecture

```
CLIENT (Browser/App)
  ↓ Generate x25519 keypair
  ↓ Encrypt wallet addresses
  ↓ Split into 4× u128 values

SOLANA BLOCKCHAIN
  ↓ Store encrypted data in PDA
  ↓ Trigger MPC computation

ARCIUM MPC NETWORK
  ↓ 2+ MXE nodes decrypt (distributed)
  ↓ Re-encrypt with new client key
  ↓ Return via callback

CLIENT
  ✓ Decrypt with ephemeral key
  ✓ Reconstruct wallet addresses
```

### Security

- **x25519 ECDH** - Key exchange protocol
- **RescueCipher** - zk-SNARK friendly encryption
- **MPC** - No single party sees plaintext
- **On-chain Storage** - Validators cannot decrypt data
- **Ephemeral Keys** - New keys for each operation

## Examples

### Full React App Example

```tsx
import { WalletLinkProvider, useWalletLink, LinkWalletButton } from '@stealf/wallet-link-sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Keypair } from '@solana/web3.js';
import { useState } from 'react';

function WalletLinkDemo() {
  const { client, hasLinkedWallets } = useWalletLink();
  const [gridWallet] = useState(() => Keypair.generate().publicKey);
  const [privateWallet] = useState(() => Keypair.generate().publicKey);

  if (!client) {
    return <div>Please connect your wallet</div>;
  }

  return (
    <div>
      <h2>Wallet Linking Demo</h2>

      {!hasLinkedWallets ? (
        <div>
          <p>Link your wallets securely with MPC</p>
          <LinkWalletButton
            gridWallet={gridWallet}
            privateWallet={privateWallet}
            onSuccess={(sig) => alert(`Linked! TX: ${sig}`)}
          />
        </div>
      ) : (
        <div>
          <p>✅ Wallets already linked</p>
        </div>
      )}
    </div>
  );
}

function App() {
  const wallet = useWallet();

  return (
    <WalletLinkProvider wallet={wallet} environment="devnet">
      <WalletMultiButton />
      <WalletLinkDemo />
    </WalletLinkProvider>
  );
}

export default App;
```

## Network Configuration

### Devnet (Current)

- **Program ID:** `CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm`
- **Cluster Offset:** `1100229901`
- **RPC:** `https://api.devnet.solana.com`

### Mainnet

Coming soon...

## Troubleshooting

### MPC Computation Timeout

If MPC computation times out:
- Devnet MPC cluster may be slow or inactive
- Check Arcium devnet status
- Retry later when cluster is more active
- Transaction succeeded even if computation times out

### "IDL not loaded" Error

Ensure you've built the SDK:
```bash
npm run build
```

### React Component Not Found

Make sure you're importing from the correct path:
```typescript
import { WalletLinkProvider } from '@stealf/wallet-link-sdk'; // ✅
```

## Development

### Build SDK

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

## License

MIT

## Support

- GitHub Issues
- Documentation

## Credits

Built with:
- [Arcium MPC](https://arcium.com) - Multi-Party Computation framework
- [Anchor](https://www.anchor-lang.com/) - Solana program framework
- [Solana](https://solana.com) - High-performance blockchain
