# Guide d'Intégration SDK Stealf - Frontend

Ce guide vous montre comment intégrer le SDK Stealf dans votre application frontend.

## ✅ Travail Complété

### 1. SDK Core
- ✅ IDL généré et intégré (`private_wallet.json`)
- ✅ Client principal `WalletLinkClient` fonctionnel
- ✅ Gestion des erreurs typées
- ✅ Utilitaires de chiffrement et PDA
- ✅ Build TypeScript réussi

### 2. Composants React
- ✅ `<WalletLinkProvider>` - Provider de contexte
- ✅ `useWalletLink()` - Hook React
- ✅ `<LinkWalletButton>` - Bouton pour lier des wallets
- ✅ `<RetrieveWalletsButton>` - Bouton pour récupérer les wallets

### 3. Documentation
- ✅ README complet avec exemples
- ✅ Exemples d'intégration React
- ✅ Documentation API complète

## 🚀 Intégration Rapide

### Installation

```bash
npm install @stealf/wallet-link-sdk @coral-xyz/anchor @solana/web3.js @arcium-hq/client
```

### Intégration dans une App React

#### 1. Configuration du Provider

```tsx
// App.tsx
import { WalletLinkProvider } from '@stealf/wallet-link-sdk';
import { useWallet } from '@solana/wallet-adapter-react';

function App() {
  const wallet = useWallet();

  return (
    <WalletLinkProvider wallet={wallet} environment="devnet">
      <YourApp />
    </WalletLinkProvider>
  );
}
```

#### 2. Utilisation dans un Composant

```tsx
// LinkWalletsComponent.tsx
import { useWalletLink, LinkWalletButton } from '@stealf/wallet-link-sdk';
import { PublicKey, Keypair } from '@solana/web3.js';
import { useState } from 'react';

export function LinkWalletsComponent() {
  const { client, hasLinkedWallets, isLoading } = useWalletLink();

  // Génération de wallets de test
  const [gridWallet] = useState(() => Keypair.generate().publicKey);
  const [privateWallet] = useState(() => Keypair.generate().publicKey);

  if (!client) {
    return <div>Connectez votre wallet d'abord</div>;
  }

  if (isLoading) {
    return <div>Chargement...</div>;
  }

  return (
    <div>
      <h2>Lier vos Wallets</h2>

      {!hasLinkedWallets ? (
        <LinkWalletButton
          gridWallet={gridWallet}
          privateWallet={privateWallet}
          onSuccess={(signature) => {
            console.log('Wallets liés !', signature);
            alert('Succès ! TX: ' + signature);
          }}
          onError={(error) => {
            console.error('Erreur:', error);
            alert('Erreur: ' + error.message);
          }}
          className="btn btn-primary"
        />
      ) : (
        <div>
          <p>✅ Vous avez déjà des wallets liés</p>
          <RetrieveWalletsButton
            onWalletsRetrieved={(wallets) => {
              console.log('Grid:', wallets.gridWallet.toBase58());
              console.log('Private:', wallets.privateWallet.toBase58());
            }}
          />
        </div>
      )}
    </div>
  );
}
```

### 3. Utilisation du Client Directement (Vanilla JS)

```typescript
import { WalletLinkClient } from '@stealf/wallet-link-sdk';
import { PublicKey } from '@solana/web3.js';

// Initialiser le client
const client = new WalletLinkClient(wallet, {
  environment: 'devnet'
});

// Lier des wallets
const result = await client.linkWallets({
  gridWallet: new PublicKey('...'),
  privateWallet: new PublicKey('...'),
  onProgress: (status) => console.log('Status:', status),
  onComputationQueued: (sig) => console.log('TX:', sig)
});

console.log('Résultat:', result);

// Récupérer les wallets liés
const wallets = await client.retrieveLinkedWallets({
  onProgress: (status) => console.log('Status:', status)
});

console.log('Grid wallet:', wallets.gridWallet.toBase58());
console.log('Private wallet:', wallets.privateWallet.toBase58());
```

## 📁 Structure du SDK

```
sdk/
├── src/
│   ├── client/
│   │   └── WalletLinkClient.ts    # Client principal
│   ├── core/
│   │   ├── types.ts                # Types TypeScript
│   │   ├── constants.ts            # Constantes (Program ID, etc.)
│   │   └── errors.ts               # Classes d'erreur
│   ├── utils/
│   │   ├── encryption.ts           # Utilitaires de chiffrement
│   │   └── pda.ts                  # Dérivation de PDA
│   ├── react/                      # Composants React
│   │   ├── WalletLinkProvider.tsx
│   │   ├── LinkWalletButton.tsx
│   │   └── RetrieveWalletsButton.tsx
│   ├── idl/
│   │   └── private_wallet.json    # IDL du programme Solana
│   └── index.ts                    # Exports principaux
├── examples/
│   └── react-example.tsx           # Exemple complet React
├── dist/                           # Build compilé
└── README.md                       # Documentation complète
```

## 🔧 Configuration

### Variables d'Environnement

Le SDK utilise les configurations suivantes :

**Devnet:**
- Program ID: `CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm`
- Cluster Offset: `1100229901`
- RPC: `https://api.devnet.solana.com`

**Mainnet:**
- À venir...

### Configuration Personnalisée

```typescript
const client = new WalletLinkClient(wallet, {
  environment: 'devnet',
  rpcEndpoint: 'https://your-custom-rpc.com',
  programId: new PublicKey('custom-program-id'),
  clusterOffset: 123456789
});
```

## 🎯 Cas d'Usage Typiques

### 1. Première Utilisation (Lier des Wallets)

```typescript
// Vérifier si l'utilisateur a déjà lié des wallets
const hasLinked = await client.hasLinkedWallets();

if (!hasLinked) {
  // Lier pour la première fois
  await client.linkWallets({
    gridWallet: userGridWallet,
    privateWallet: generatedPrivateWallet,
    onProgress: (msg) => updateUI(msg)
  });
}
```

### 2. Récupération de Wallets Existants

```typescript
// Si l'utilisateur a déjà lié des wallets
if (await client.hasLinkedWallets()) {
  const wallets = await client.retrieveLinkedWallets({
    onProgress: (msg) => showLoader(msg)
  });

  // Utiliser les wallets récupérés
  console.log('Grid:', wallets.gridWallet.toBase58());
  console.log('Private:', wallets.privateWallet.toBase58());
}
```

### 3. Gestion des Erreurs

```typescript
import {
  MPCTimeoutError,
  WalletsAlreadyLinkedError,
  WalletsNotLinkedError
} from '@stealf/wallet-link-sdk';

try {
  await client.linkWallets({ ... });
} catch (error) {
  if (error instanceof MPCTimeoutError) {
    // Le calcul MPC a timeout (peut arriver sur devnet)
    console.warn('MPC timeout - réessayer plus tard');
  } else if (error instanceof WalletsAlreadyLinkedError) {
    // L'utilisateur a déjà lié des wallets
    console.log('Wallets déjà liés');
  } else if (error instanceof WalletsNotLinkedError) {
    // Aucun wallet lié pour cet utilisateur
    console.log('Aucun wallet trouvé');
  } else {
    console.error('Erreur inconnue:', error);
  }
}
```

## 🔍 Suivi de Progression

Le SDK fournit des callbacks de progression détaillés :

```typescript
await client.linkWallets({
  gridWallet,
  privateWallet,
  onProgress: (status) => {
    // Statuts possibles:
    // - "Fetching MXE public key..."
    // - "Encrypting wallet data..."
    // - "Storing encrypted wallets on-chain..."
    // - "Queueing MPC computation..."
    // - "Waiting for MPC computation..."
    // - "Complete!"

    console.log('[Progress]', status);
    updateProgressBar(status);
  },
  onComputationQueued: (signature) => {
    console.log('[Transaction]', signature);
    showExplorerLink(signature);
  }
});
```

## 🧪 Test sur Devnet

Le SDK est déployé et testé sur Solana Devnet. Voici comment tester :

1. **Connecter un wallet** avec des SOL sur devnet
2. **Lier des wallets** avec `linkWallets()`
3. **Vérifier la transaction** sur Solana Explorer
4. **Récupérer les wallets** avec `retrieveLinkedWallets()`

### Obtenir des SOL Devnet

```bash
solana airdrop 2 <votre-adresse> --url devnet
```

Ou utiliser: https://faucet.solana.com

## 📚 Ressources

- **README complet**: `sdk/README.md`
- **Exemple React**: `sdk/examples/react-example.tsx`
- **Composants React**: `sdk/src/react/`
- **Tests d'intégration**: `arcium/scripts/test/test-devnet.ts`

## 🔐 Sécurité

Le SDK utilise :
- **x25519 ECDH** pour l'échange de clés
- **RescueCipher** pour le chiffrement (compatible zk-SNARK)
- **Arcium MPC** pour le calcul confidentiel distribué
- **Clés éphémères** générées pour chaque opération
- **Stockage on-chain chiffré** (aucun validateur ne peut déchiffrer)

## 🚨 Points d'Attention

### MPC Timeout sur Devnet

Le cluster MPC devnet peut être lent. Si vous rencontrez des timeouts :
- La transaction on-chain a réussi
- Le calcul MPC est en queue
- Réessayer plus tard ou utiliser un cluster local

### Compatibilité Navigateur

Le SDK utilise :
- `crypto.randomBytes()` pour Node.js
- `window.crypto.getRandomValues()` pour les navigateurs

## ✨ Prochaines Étapes

Pour utiliser le SDK dans votre projet :

1. **Installer les dépendances**
   ```bash
   npm install @stealf/wallet-link-sdk
   ```

2. **Configurer le Provider React**
   ```tsx
   <WalletLinkProvider wallet={wallet} environment="devnet">
   ```

3. **Utiliser les composants ou le client**
   - Composants: `<LinkWalletButton />`, `<RetrieveWalletsButton />`
   - Client: `new WalletLinkClient(wallet, config)`

4. **Tester sur devnet**

5. **Déployer en production sur mainnet** (quand disponible)

---

**Créé le**: 2025-11-17
**SDK Version**: 0.1.0
**Statut**: ✅ Prêt pour l'intégration frontend
