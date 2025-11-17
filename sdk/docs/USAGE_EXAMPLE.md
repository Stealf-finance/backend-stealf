# Guide d'Utilisation - Stealf Wallet Link SDK

## 📚 Scénarios d'Utilisation

Ce SDK implémente exactement le même flow que les tests du fichier `arcium/tests/anonyme_transfer.ts`.

---

## 🆕 Scénario 1 : Création de Compte (Premier Utilisateur)

L'utilisateur crée un nouveau compte. Le SDK Grid génère automatiquement un Smart Account, et nous générons un Private Wallet associé.

### Code Frontend

```typescript
import { WalletLinkClient } from '@stealf/wallet-link-sdk';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

function CreateAccount() {
  const wallet = useWallet();

  async function handleCreateAccount() {
    // 1. L'utilisateur se connecte avec son wallet (qui devient son Grid Smart Account)
    if (!wallet.publicKey) {
      alert("Connectez votre wallet d'abord");
      return;
    }

    // 2. Initialiser le client SDK
    const client = new WalletLinkClient(wallet as any, {
      environment: 'devnet'
    });

    // 3. Créer et lier un nouveau private wallet
    // Note: gridWallet = l'adresse du smart account Grid de l'utilisateur
    const result = await client.linkSmartAccountWithPrivateWallet({
      gridWallet: wallet.publicKey,  // Adresse du Grid Smart Account
      onProgress: (status) => {
        console.log('📋 Status:', status);
        // Afficher dans l'UI: "Generating new private wallet..."
        // "Encrypting wallet addresses..."
        // "Storing encrypted wallets on-chain..."
        // "Waiting for MPC computation..."
        // "Complete!"
      },
      onComputationQueued: (signature) => {
        console.log('✅ Transaction:', signature);
        // Montrer le lien Solana Explorer
      }
    });

    // 4. IMPORTANT: Sauvegarder le private wallet de manière sécurisée
    console.log('Grid Wallet:', result.gridWallet.toBase58());
    console.log('Private Wallet Public:', result.privateWallet.publicKey.toBase58());
    console.log('Private Wallet Secret:', result.privateWallet.secretKey);

    // CRITICAL: Sauvegarder la clé privée de manière sécurisée
    // Option 1: Stockage local chiffré (recommandé)
    const encryptedPrivateKey = encryptWithUserPassword(
      result.privateWallet.secretKey,
      userPassword
    );
    localStorage.setItem('encrypted_private_key', encryptedPrivateKey);

    // Option 2: Afficher à l'utilisateur pour qu'il le sauvegarde
    alert(`IMPORTANT: Sauvegardez cette clé privée de manière sécurisée:

    ${bs58.encode(result.privateWallet.secretKey)}

    Vous en aurez besoin pour récupérer votre wallet privé.`);

    console.log('✅ Compte créé avec succès!');
    console.log('Transaction:', result.signature);
  }

  return (
    <div>
      <h2>Créer un Nouveau Compte</h2>
      <button onClick={handleCreateAccount}>
        Créer mon compte privé
      </button>
    </div>
  );
}
```

### Ce qui se passe en arrière-plan :

1. **Génération automatique** d'un nouveau Private Wallet (Keypair complet)
2. **Chiffrement MPC** du lien entre Grid Wallet et Private Wallet
3. **Stockage on-chain** dans un PDA dérivé du Grid Smart Account
4. **Retour du Keypair complet** avec la clé privée

---

## 🔐 Scénario 2 : Login (Utilisateur Existant)

L'utilisateur se connecte avec son Grid Smart Account. Nous récupérons son Private Wallet via MPC.

### Code Frontend

```typescript
import { WalletLinkClient } from '@stealf/wallet-link-sdk';
import { useWallet } from '@solana/wallet-adapter-react';

function Login() {
  const wallet = useWallet();

  async function handleLogin() {
    // 1. L'utilisateur se connecte avec son wallet Grid Smart Account
    if (!wallet.publicKey) {
      alert("Connectez votre wallet d'abord");
      return;
    }

    // 2. Initialiser le client SDK
    const client = new WalletLinkClient(wallet as any, {
      environment: 'devnet'
    });

    // 3. Vérifier si l'utilisateur a déjà un compte
    const hasAccount = await client.hasLinkedWallets();

    if (!hasAccount) {
      console.log('❌ Aucun compte trouvé pour cet utilisateur');
      alert('Vous devez d\'abord créer un compte');
      return;
    }

    console.log('✅ Compte existant détecté');

    // 4. Récupérer les wallets liés via MPC
    const wallets = await client.retrieveLinkedWallets({
      onProgress: (status) => {
        console.log('📋 Status:', status);
        // Afficher dans l'UI: "Retrieving linked wallets..."
        // "Generating new encryption keys..."
        // "Queueing MPC re-encryption..."
        // "Waiting for MPC computation..."
        // "Decrypting wallets..."
        // "Complete!"
      },
      onComputationQueued: (signature) => {
        console.log('✅ Transaction:', signature);
      }
    });

    // 5. Utiliser les wallets récupérés
    console.log('Grid Wallet:', wallets.gridWallet.toBase58());
    console.log('Private Wallet:', wallets.privateWallet.toBase58());

    // 6. Maintenant vous pouvez utiliser ces adresses pour:
    // - Afficher le solde du private wallet
    // - Effectuer des transactions depuis le private wallet
    // - etc.

    alert(`Login réussi!

    Grid Wallet: ${wallets.gridWallet.toBase58()}
    Private Wallet: ${wallets.privateWallet.toBase58()}`);
  }

  return (
    <div>
      <h2>Se Connecter</h2>
      <button onClick={handleLogin}>
        Se connecter avec mon Grid Wallet
      </button>
    </div>
  );
}
```

### Ce qui se passe en arrière-plan :

1. **Vérification** de l'existence du compte (PDA check)
2. **Lecture du PDA** contenant le lien chiffré
3. **MPC re-encryption** avec une nouvelle clé éphémère
4. **Déchiffrement local** pour récupérer les adresses
5. **Retour des PublicKeys** (Grid + Private)

---

## 🔄 Exemple Complet : Flux Utilisateur

```typescript
import { WalletLinkClient } from '@stealf/wallet-link-sdk';
import { useWallet } from '@solana/wallet-adapter-react';
import { useState, useEffect } from 'react';

function WalletManager() {
  const wallet = useWallet();
  const [client, setClient] = useState<WalletLinkClient | null>(null);
  const [hasAccount, setHasAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [wallets, setWallets] = useState<{
    gridWallet: string;
    privateWallet: string;
  } | null>(null);

  // Initialiser le client quand le wallet se connecte
  useEffect(() => {
    if (wallet.publicKey) {
      const newClient = new WalletLinkClient(wallet as any, {
        environment: 'devnet'
      });
      setClient(newClient);

      // Vérifier si l'utilisateur a déjà un compte
      newClient.hasLinkedWallets().then(setHasAccount);
    }
  }, [wallet.publicKey]);

  // Créer un nouveau compte
  const createAccount = async () => {
    if (!client || !wallet.publicKey) return;

    setIsLoading(true);
    try {
      const result = await client.linkSmartAccountWithPrivateWallet({
        gridWallet: wallet.publicKey,
        onProgress: (status) => console.log('📋', status)
      });

      console.log('✅ Compte créé!');
      console.log('Private Key:', result.privateWallet.secretKey);

      // IMPORTANT: Sauvegarder la clé privée
      alert('Sauvegardez cette clé privée de manière sécurisée!');

      setHasAccount(true);
      setWallets({
        gridWallet: result.gridWallet.toBase58(),
        privateWallet: result.privateWallet.publicKey.toBase58()
      });
    } catch (error) {
      console.error('❌ Erreur:', error);
      alert('Erreur lors de la création du compte');
    } finally {
      setIsLoading(false);
    }
  };

  // Se connecter (récupérer les wallets)
  const login = async () => {
    if (!client) return;

    setIsLoading(true);
    try {
      const result = await client.retrieveLinkedWallets({
        onProgress: (status) => console.log('📋', status)
      });

      console.log('✅ Login réussi!');
      setWallets({
        gridWallet: result.gridWallet.toBase58(),
        privateWallet: result.privateWallet.toBase58()
      });
    } catch (error) {
      console.error('❌ Erreur:', error);
      alert('Erreur lors du login');
    } finally {
      setIsLoading(false);
    }
  };

  if (!wallet.connected) {
    return <div>Connectez votre wallet d'abord</div>;
  }

  return (
    <div>
      <h2>Gestion de Wallet</h2>

      {!hasAccount ? (
        <div>
          <p>Vous n'avez pas encore de compte</p>
          <button onClick={createAccount} disabled={isLoading}>
            {isLoading ? 'Création...' : 'Créer un compte'}
          </button>
        </div>
      ) : (
        <div>
          <p>Vous avez déjà un compte</p>
          <button onClick={login} disabled={isLoading}>
            {isLoading ? 'Connexion...' : 'Se connecter'}
          </button>
        </div>
      )}

      {wallets && (
        <div>
          <h3>Vos Wallets</h3>
          <p><strong>Grid Wallet:</strong> {wallets.gridWallet}</p>
          <p><strong>Private Wallet:</strong> {wallets.privateWallet}</p>
        </div>
      )}
    </div>
  );
}

export default WalletManager;
```

---

## 🔑 Points Importants

### 1. Dérivation du PDA

Le PDA est dérivé avec **l'adresse du wallet connecté** (Grid Smart Account) :

```typescript
const [encryptedWalletsPDA] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("encrypted_wallets"),
    wallet.publicKey.toBuffer()  // ← Grid Smart Account de l'utilisateur
  ],
  programId
);
```

Donc **chaque Grid Smart Account a SON PROPRE PDA** contenant son lien chiffré.

### 2. Sauvegarde du Private Wallet

Lors de la création du compte, vous recevez le **Keypair complet** avec la clé privée :

```typescript
const result = await client.linkSmartAccountWithPrivateWallet({ ... });

// IMPORTANT: Sauvegarder cette clé privée !
const secretKey = result.privateWallet.secretKey;
```

**Options de sauvegarde** :
- Stockage local chiffré avec un mot de passe utilisateur
- Affichage à l'utilisateur pour sauvegarde manuelle (phrase de récupération)
- Stockage sécurisé côté backend (si applicable)

### 3. Event Listener

Le SDK utilise un **event listener** pour attendre la fin du calcul MPC :

```typescript
private async awaitEvent(eventName: string): Promise<any> {
  let listenerId: number;
  const event = await new Promise<any>((res) => {
    listenerId = this.program.addEventListener(eventName as any, (event) => {
      res(event);
    });
  });
  await this.program.removeEventListener(listenerId!);
  return event;
}
```

Cela garantit qu'on attend bien la réponse du réseau MPC avant de continuer.

---

## 🧪 Test sur Devnet

```bash
# Installer les dépendances
npm install @stealf/wallet-link-sdk @coral-xyz/anchor @solana/web3.js @arcium-hq/client

# Configuration devnet
Program ID: CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm
Cluster Offset: 1100229901
RPC: https://api.devnet.solana.com
```

---

## 📝 Résumé

| Fonction | Usage | Retour |
|----------|-------|--------|
| `linkSmartAccountWithPrivateWallet()` | Création de compte | `{ signature, gridWallet, privateWallet: Keypair }` |
| `retrieveLinkedWallets()` | Login utilisateur | `{ gridWallet: PublicKey, privateWallet: PublicKey }` |
| `hasLinkedWallets()` | Vérifier l'existence du compte | `boolean` |

**Le SDK implémente exactement le même flow que les tests !** 🎉
