# 🔐 Stealf Shielded Transactions Guide

## Overview

Backend-stealf now includes **3 advanced privacy systems** for Solana transactions:

1. **Denomination Pools** (Tornado Cash style) - ⭐⭐⭐⭐⭐ Privacy
2. **Encrypted Balances** (Umbra style) - ⭐⭐⭐⭐⭐⭐ Privacy
3. **Flexible Amounts** (Stealth addresses) - ⭐⭐⭐⭐ Privacy

---

## 🚀 Quick Start

### 1. Installation

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Edit .env with your MongoDB URI
nano .env
```

### 2. Fund the Relayer

The relayer needs SOL on devnet to pay transaction fees:

```bash
# Get relayer address from keypair
RELAYER_ADDRESS=$(node -e "
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const kp = JSON.parse(fs.readFileSync('config/relayer-keypair.json'));
console.log(Keypair.fromSecretKey(new Uint8Array(kp)).publicKey.toString());
")

# Fund with 5 SOL
solana airdrop 5 $RELAYER_ADDRESS --url devnet
```

### 3. Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

Server will start on `http://localhost:3001`

---

## 📚 API Endpoints

### Health Check

```bash
curl http://localhost:3001/health
```

### 1. Deposit to Denomination Pool

Fixed amounts: 0.1, 0.5, 1, 5, 10 SOL

```bash
curl -X POST http://localhost:3001/api/v1/shielded-pool/deposit-to-pool \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "poolId": 1
  }'
```

**Pool IDs:**
- `0` = 0.1 SOL
- `1` = 0.5 SOL
- `2` = 1.0 SOL
- `3` = 5.0 SOL
- `4` = 10.0 SOL

**Response:**
```json
{
  "success": true,
  "transaction": "3jg2UrBhfMK5...",
  "poolId": 1,
  "amount": 0.5
}
```

---

### 2. Deposit Encrypted Balance

Flexible amounts (any amount)

```bash
curl -X POST http://localhost:3001/api/v1/shielded-pool/deposit-encrypted \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "amount": 0.137
  }'
```

**Response:**
```json
{
  "success": true,
  "transaction": "62zkiAhfvRb...",
  "encryptedBalancePDA": "GXft6MBFKC19...",
  "index": 0,
  "privacyScore": "⭐⭐⭐⭐⭐⭐ (6/5)"
}
```

---

### 3. Get Pending Claims

```bash
curl http://localhost:3001/api/v1/shielded-pool/pending-claims \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "claims": [
    {
      "_id": "691a0d22c8424aacef480f0f",
      "type": "encrypted_balance",
      "amount": 0.137,
      "encryptedBalancePDA": "GXft6MBFKC19...",
      "index": 0,
      "claimed": false,
      "depositedAt": "2024-11-17T10:30:00.000Z"
    },
    {
      "_id": "691a0d45c8424aacef480f10",
      "type": "denomination_pool",
      "poolId": 1,
      "amount": 0.5,
      "claimed": false,
      "depositedAt": "2024-11-17T10:35:00.000Z"
    }
  ]
}
```

---

### 4. Claim Funds

```bash
curl -X POST http://localhost:3001/api/v1/shielded-pool/claim \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "claimId": "691a0d22c8424aacef480f0f"
  }'
```

**Response:**
```json
{
  "success": true,
  "claimSignature": "3d8Gw8GbiQo...",
  "message": "🎉 Encrypted balance claimed!"
}
```

---

## 🔒 Privacy Features Comparison

| Feature | Denomination Pools | Encrypted Balances | Flexible Amounts |
|---------|-------------------|-------------------|------------------|
| **Montants** | Fixes (0.1, 0.5, 1, 5, 10) | Flexibles (any) | Flexibles (any) |
| **Privacy Deposit** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Privacy Claim** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Unlinkability** | ✅ Good | ✅ **Perfect** | ✅ Good |
| **Visible Amount?** | Pool ID implies | ⚠️ In args/transfer | ⚠️ In transfer |
| **Best For** | Standard amounts | Custom amounts | Simple privacy |

---

## 🏗️ Architecture

### Solana Program

**Program ID:** `FZpAL2ogH95Fh8N3Cs3wwXhR3VysR922WZYjTTPo17ka` (deployed on devnet)

**Instructions:**

1. **Encrypted Balances:**
   - `init_encrypted_balance_registry`
   - `init_encrypted_vault`
   - `deposit_encrypted_balance`
   - `withdraw_encrypted_balance`

2. **Denomination Pools:**
   - `init_denomination_pool`
   - `deposit_to_pool`
   - `claim_from_pool`

3. **Flexible Amounts:**
   - `init_commitment_tree`
   - `init_nullifier_registry`
   - `deposit_with_commitment`
   - `claim_with_proof`

---

## 💡 How It Works

### Denomination Pools (Tornado Cash Style)

1. **Deposit**: User deposits exactly 0.1, 0.5, 1, 5, or 10 SOL
2. **Secret Generation**: System generates secret + nullifier
3. **Pool Storage**: Funds go into pool with other deposits of same amount
4. **Claim**: User claims later using secret (relayer breaks link)

**Privacy:** Since all deposits are same amount, impossible to link deposit to claim!

---

### Encrypted Balances (Umbra Style)

1. **Deposit**: User deposits any amount (e.g., 0.137 SOL)
2. **Encryption**: Amount encrypted with ChaCha20 on-chain
3. **PDA Storage**: Encrypted balance stored in PDA
4. **Claim**: User claims using nullifier (amount revealed once but unlinkable)

**Privacy:** Amount hidden during deposit, revealed only on claim but unlinkable!

---

## 🔐 Security

### Relayer Service

The relayer signs claim transactions to break the on-chain link between your public wallet and privacy wallet.

**Configuration:**
- Keypair: `config/relayer-keypair.json`
- Auto-loaded on server start
- Needs SOL for transaction fees

### Encryption

- **ChaCha20** for encrypted balances
- **ECDH** for shared secrets
- **SHA-256** for commitments and nullifiers

---

## 🧪 Testing

### Test Flow

1. **Create User** (mock or via your auth system)
2. **Deposit to pool or encrypted balance**
3. **Check pending claims**
4. **Claim funds to privacy wallet**

### Example Test Script

```bash
#!/bin/bash

# 1. Deposit 0.5 SOL to denomination pool
DEPOSIT_RESPONSE=$(curl -X POST http://localhost:3001/api/v1/shielded-pool/deposit-to-pool \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d '{"poolId": 1}')

echo "Deposit result: $DEPOSIT_RESPONSE"

# 2. Wait a bit
sleep 5

# 3. Get pending claims
CLAIMS=$(curl http://localhost:3001/api/v1/shielded-pool/pending-claims \
  -H "Authorization: Bearer test")

echo "Pending claims: $CLAIMS"

# 4. Extract claim ID and claim
CLAIM_ID=$(echo $CLAIMS | jq -r '.claims[0]._id')

CLAIM_RESPONSE=$(curl -X POST http://localhost:3001/api/v1/shielded-pool/claim \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d "{\"claimId\": \"$CLAIM_ID\"}")

echo "Claim result: $CLAIM_RESPONSE"
```

---

## ⚠️ Important Notes

### MongoDB Index

The `PendingClaim` model uses a **sparse unique index** on `nullifier` to allow multiple `null` values (for encrypted balances).

If you encounter index errors, run:

```javascript
// fix-nullifier-index.js
const { MongoClient } = require('mongodb');

async function fixIndex() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const collection = db.collection('pendingclaims');

  // Drop old index
  await collection.dropIndex('nullifier_1').catch(() => {});

  // Create sparse unique index
  await collection.createIndex(
    { nullifier: 1 },
    { unique: true, sparse: true }
  );

  console.log('✅ Sparse index created!');
  await client.close();
}

fixIndex();
```

### User Model

Users need both `solanaWallet` (public) and `solanaPrivateWallet` (privacy 1) fields.

### BN Import

Always use:
```typescript
import BN from 'bn.js';  // ✅ Correct
// NOT: import { BN } from '@coral-xyz/anchor';  // ❌ Wrong
```

---

## 🔗 Resources

- [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet)
- [Anchor Framework Docs](https://www.anchor-lang.com/)
- [Integration Guide](/home/louis/Images/Stealf/INTEGRATION_GUIDE_FOR_AI_AGENT.md)

---

## 📊 Privacy Scores Explained

- ⭐⭐⭐⭐⭐⭐ (6/5) = **Perfect** - Amount hidden, deposit unlinkable, claim unlinkable
- ⭐⭐⭐⭐⭐ (5/5) = **Excellent** - Good mixing, hard to link
- ⭐⭐⭐⭐ (4/5) = **Good** - Basic privacy, some info visible

**Recommendation:** Use **Encrypted Balances** for custom amounts, **Denomination Pools** for standard amounts.

---

## 💬 Support

For questions or issues:
1. Check server logs
2. Check Solana Explorer for transaction details
3. Verify relayer has enough SOL
4. Ensure MongoDB is running

**Privacy Score:** ⭐⭐⭐⭐⭐⭐ (6/5) - Maximum possible on Solana L1! 🔐
