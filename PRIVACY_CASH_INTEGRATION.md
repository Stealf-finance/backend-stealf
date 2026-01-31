# Privacy Cash Integration - Technical Documentation

> **Hackathon Submission** - Complete Privacy Cash integration for private Solana transfers

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Flow Example](#flow-example)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [Security & Idempotency](#security--idempotency)
- [Frontend Integration](#frontend-integration)

---

## Overview

This integration enables users to perform **private transfers** on Solana using Privacy Cash, breaking the on-chain link between sender and recipient wallets.

### Key Features
- ✅ **Zero-knowledge privacy**: Breaks on-chain transaction links using Privacy Cash
- ✅ **Idempotent operations**: UUID-based correlation prevents duplicate transactions
- ✅ **Real-time updates**: WebSocket notifications at every stage
- ✅ **Multi-token support**: SOL and USDC (SPL tokens)
- ✅ **Retry mechanism**: Smart retry with double-withdrawal protection
- ✅ **Custodial vault**: Stealf-operated vault handles Privacy Cash operations (demo mode)

### What is Privacy Cash?
Privacy Cash is a privacy protocol for Solana that uses:
- **Zero-knowledge proofs** to break transaction traceability
- **UTXO-based encryption** for client-side privacy
- **CipherOwl screening** to detect malicious wallets
- **Merkle tree structure** for append-only privacy guarantees

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER (Bob)                              │
│  ┌──────────────┐                                               │
│  │  Wallet App  │ ──────────────────────────────────────┐      │
│  └──────────────┘                                        │      │
└──────────────────────────────────────────────────────────┼──────┘
                                                            │
                                                            │ 1. Initiate Transfer
                                                            │
┌───────────────────────────────────────────────────────────▼──────┐
│                    STEALF BACKEND                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  API Layer                                              │    │
│  │  • POST /initiate  • GET /status  • POST /retry        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TransferOrchestratorService                            │    │
│  │  • Coordinates entire privacy flow                      │    │
│  │  • Manages state transitions                            │    │
│  │  • Handles retries and error recovery                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│        ┌─────────────────────┼─────────────────────┐           │
│        ▼                     ▼                     ▼            │
│  ┌──────────┐     ┌──────────────────┐    ┌─────────────┐     │
│  │PrivacyCash│     │TransferCorrelation│    │SocketService│     │
│  │  Service  │     │    Service        │    │             │     │
│  └──────────┘     └──────────────────┘    └─────────────┘     │
│        │                   │                       │            │
└────────┼───────────────────┼───────────────────────┼────────────┘
         │                   │                       │
         ▼                   ▼                       ▼
┌────────────────┐   ┌──────────────┐      ┌──────────────┐
│  Privacy Cash  │   │   Helius     │      │  WebSocket   │
│     SDK        │   │   Webhook    │      │   Clients    │
└────────────────┘   └──────────────┘      └──────────────┘
         │                   │
         ▼                   │
┌────────────────────────────┼──────────────────────────────┐
│            SOLANA BLOCKCHAIN                               │
│                            │                               │
│  ┌──────────────┐         │         ┌──────────────────┐  │
│  │ Stealf Vault │◄────────┘         │  Privacy Cash    │  │
│  │   Wallet     │                   │   Program        │  │
│  └──────────────┘                   └──────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### Database Schema

```typescript
PrivateTransfer {
  _id: ObjectId                 // Transfer ID
  reference: string             // UUID for idempotency
  userId: ObjectId              // User reference
  sourceWallet: string          // Bob's wallet
  destinationWallet: string     // Final recipient wallet
  amount: number                // Transfer amount
  tokenMint?: string            // Token mint address (null for SOL)

  // Status tracking (9 states)
  status: 'pending_vault' | 'vault_tx_detected' | 'vault_received' |
          'deposit_submitted' | 'deposited' | 'withdraw_submitted' |
          'withdrawn' | 'completed' | 'failed'

  // Transaction references
  vaultDepositTx?: string       // Vault deposit signature
  privacyCashDepositTx?: string // Privacy Cash deposit signature
  privacyCashWithdrawTx?: string // Privacy Cash withdraw signature

  // Fee tracking
  fees: {
    vaultDeposit: number        // Network fee for vault deposit
    privacyDeposit: number      // Privacy Cash deposit fee
    privacyWithdraw: number     // Privacy Cash withdraw fee
    total: number               // Total fees
  }

  // Error handling
  errorMessage?: string
  retryCount: number            // Max 3 retries

  createdAt: Date
  updatedAt: Date
}
```

### Service Layer Architecture

#### 1. **TransferOrchestratorService**
- **Role**: Main coordinator for privacy transfers
- **Responsibilities**:
  - Initiates transfers and generates reference UUIDs
  - Processes vault deposits when webhooks arrive
  - Executes Privacy Cash deposit/withdraw flow
  - Manages state transitions with intermediate statuses
  - Handles failures and retries intelligently

#### 2. **PrivacyCashService**
- **Role**: Wrapper around Privacy Cash SDK
- **Responsibilities**:
  - Deposits SOL/SPL tokens to Privacy Cash
  - Withdraws SOL/SPL tokens from Privacy Cash
  - Checks Privacy Cash balances
  - Token support validation

#### 3. **TransferCorrelationService**
- **Role**: Correlates Helius webhooks to transfers
- **Responsibilities**:
  - **Primary**: Correlation by reference UUID (from memo)
  - **Fallback**: Correlation by transaction details (wallet, amount, token, time window)
  - Prevents duplicate processing

#### 4. **SocketService**
- **Role**: Real-time notifications
- **Responsibilities**:
  - Emits transfer status updates to users
  - User-specific rooms for private notifications
  - Event broadcasting at each state transition

---

## Flow Example

### Complete User Journey

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1: User Initiates Private Transfer                        │
└──────────────────────────────────────────────────────────────────┘

Bob wants to send 1.5 SOL to Alice privately

POST /api/private-transfer/initiate
{
  "destinationWallet": "AliceWallet111...",
  "amount": 1.5,
  "tokenMint": null  // SOL
}

Response:
{
  "transfer": {
    "transferId": "507f1f77bcf86cd799439011",
    "reference": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7",  ← UUID for correlation
    "status": "pending_vault",
    "vaultAddress": "FpRVZrZ7zAigWG4mGMirCJMibxedQ4DmMcQCo3p94nwF",
    "fees": { "total": 0.011025 }
  },
  "instructions": {
    "memo": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7"  ← MUST include in tx
  }
}

┌──────────────────────────────────────────────────────────────────┐
│  STEP 2: User Sends to Vault (with Memo)                        │
└──────────────────────────────────────────────────────────────────┘

Bob creates transaction:
- From: Bob's wallet
- To: Stealf Vault (FpRVZrZ7...)
- Amount: 1.5 SOL
- Memo: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7"  ← Critical for correlation

Transaction submitted to Solana blockchain
Signature: "2ZE7R8hK3mN..."

📱 WebSocket: status → "pending_vault"

┌──────────────────────────────────────────────────────────────────┐
│  STEP 3: Helius Detects Transaction                             │
└──────────────────────────────────────────────────────────────────┘

Helius webhook fires → POST /webhook/helius
{
  "signature": "2ZE7R8hK3mN...",
  "nativeTransfers": [{
    "fromUserAccount": "BobWallet...",
    "toUserAccount": "FpRVZrZ7...",  ← Vault address
    "amount": 1500000000
  }],
  "description": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7"  ← Memo extracted
}

TransferCorrelationService:
1. Extracts memo: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7"
2. Finds transfer with matching reference
3. Validates amount and token mint
4. ✅ Correlation successful!

📱 WebSocket: status → "vault_tx_detected"

Transfer updated:
- vaultDepositTx: "2ZE7R8hK3mN..."
- status: "vault_received"

📱 WebSocket: status → "vault_received"

┌──────────────────────────────────────────────────────────────────┐
│  STEP 4: Privacy Cash Deposit (Automated)                       │
└──────────────────────────────────────────────────────────────────┘

TransferOrchestrator.executePrivacyFlow() starts:

1. Status → "deposit_submitted"
   📱 WebSocket: status → "deposit_submitted"

2. PrivacyCashService.depositSOL(1.5)
   - Calls Privacy Cash SDK
   - Creates encrypted UTXO
   - Submits to Privacy Cash program

3. Deposit confirmed!
   - privacyCashDepositTx: "3KF8S9jL4oP..."
   - status: "deposited"

   📱 WebSocket: status → "deposited"

┌──────────────────────────────────────────────────────────────────┐
│  STEP 5: Privacy Cash Withdraw (Automated)                      │
└──────────────────────────────────────────────────────────────────┘

Wait 2 seconds (configurable delay for privacy)

1. Status → "withdraw_submitted"
   📱 WebSocket: status → "withdraw_submitted"

2. PrivacyCashService.withdrawSOL(1.5, "AliceWallet111...")
   - Calls Privacy Cash SDK
   - Uses relayer for withdrawal
   - CipherOwl screening passes
   - Submits withdraw transaction

3. Withdraw confirmed!
   - privacyCashWithdrawTx: "4LG9T0kM5qR..."
   - status: "withdrawn"
   - fees calculated

   📱 WebSocket: status → "withdrawn"

┌──────────────────────────────────────────────────────────────────┐
│  STEP 6: Completion                                             │
└──────────────────────────────────────────────────────────────────┘

Final status update:
- status: "completed"
- All transaction signatures recorded
- Final fees: { total: 0.011025 SOL }

📱 WebSocket: status → "completed"

🎉 Alice receives 1.5 SOL with NO on-chain link to Bob!
```

### State Transition Diagram

```
pending_vault
    │
    │ (User sends to vault with memo)
    ▼
vault_tx_detected ◄─── Helius webhook received
    │
    │ (Verification complete)
    ▼
vault_received
    │
    │ (Privacy Cash deposit starts)
    ▼
deposit_submitted
    │
    │ (Deposit confirmed on-chain)
    ▼
deposited
    │
    │ (Privacy Cash withdraw starts)
    ▼
withdraw_submitted
    │
    │ (Withdraw confirmed on-chain)
    ▼
withdrawn
    │
    │ (Final verification)
    ▼
completed ✅

    │
    │ (Error at any stage)
    ▼
  failed ❌
    │
    │ (Retry if conditions met)
    └──► vault_received OR deposited
```

---

## API Reference

### 1. Initiate Private Transfer

**Endpoint**: `POST /api/private-transfer/initiate`

**Headers**:
```
Authorization: Bearer <session_jwt>
Content-Type: application/json
```

**Request Body**:
```json
{
  "destinationWallet": "7xKXtg2CW87d9uFN1TdNdpgL9yc9J8XCy9nKv1Qw2VTR",
  "amount": 1.5,
  "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  // Optional, omit for SOL
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "transfer": {
      "transferId": "507f1f77bcf86cd799439011",
      "reference": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7",
      "status": "pending_vault",
      "vaultAddress": "FpRVZrZ7zAigWG4mGMirCJMibxedQ4DmMcQCo3p94nwF",
      "destinationWallet": "7xKXtg2CW87d9uFN1TdNdpgL9yc9J8XCy9nKv1Qw2VTR",
      "amount": 1.5,
      "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "fees": {
        "vaultDeposit": 0,
        "privacyDeposit": 0,
        "privacyWithdraw": 0.011025,
        "total": 0.011025
      },
      "createdAt": "2024-01-27T10:00:00.000Z"
    },
    "instructions": {
      "message": "Please send 1.5 tokens to the vault address",
      "vaultAddress": "FpRVZrZ7zAigWG4mGMirCJMibxedQ4DmMcQCo3p94nwF",
      "amount": 1.5,
      "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "transferId": "507f1f77bcf86cd799439011",
      "reference": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7",
      "memo": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7"  ⚠️ CRITICAL: Include this in transaction
    }
  }
}
```

### 2. Get Transfer Status

**Endpoint**: `GET /api/private-transfer/:transferId`

**Headers**:
```
Authorization: Bearer <session_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transfer": {
      "transferId": "507f1f77bcf86cd799439011",
      "reference": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7",
      "status": "completed",
      "vaultAddress": "FpRVZrZ7zAigWG4mGMirCJMibxedQ4DmMcQCo3p94nwF",
      "destinationWallet": "7xKXtg2CW87d9uFN1TdNdpgL9yc9J8XCy9nKv1Qw2VTR",
      "amount": 1.5,
      "fees": {
        "vaultDeposit": 0.000005,
        "privacyDeposit": 0,
        "privacyWithdraw": 0.011025,
        "total": 0.01103
      },
      "transactions": {
        "vaultDepositTx": "2ZE7R8hK3mN...",
        "privacyCashDepositTx": "3KF8S9jL4oP...",
        "privacyCashWithdrawTx": "4LG9T0kM5qR..."
      },
      "createdAt": "2024-01-27T10:00:00.000Z",
      "updatedAt": "2024-01-27T10:05:00.000Z"
    }
  }
}
```

### 3. Get User Transfer History

**Endpoint**: `GET /api/private-transfer/user/history?limit=10`

**Headers**:
```
Authorization: Bearer <session_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transfers": [
      {
        "transferId": "507f1f77bcf86cd799439011",
        "reference": "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5g6h7",
        "status": "completed",
        "amount": 1.5,
        "destinationWallet": "7xKXtg2CW87d9uFN1TdNdpgL9yc9J8XCy9nKv1Qw2VTR",
        "createdAt": "2024-01-27T10:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

### 4. Retry Failed Transfer

**Endpoint**: `POST /api/private-transfer/:transferId/retry`

**Headers**:
```
Authorization: Bearer <session_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transfer": {
      "transferId": "507f1f77bcf86cd799439011",
      "status": "vault_received"  // or "deposited" depending on retry point
    }
  },
  "message": "Transfer retry initiated"
}
```

**Retry Rules**:
- ❌ **BLOCKED** if `privacyCashWithdrawTx` exists (withdrawal already executed)
- ✅ **ALLOWED** if failed before withdrawal
- **Smart retry**:
  - If `privacyCashDepositTx` exists → resumes from `deposited`
  - Otherwise → resumes from `vault_received`
- **Maximum**: 3 retry attempts
- **Protection**: Each step is idempotent

### 5. Get Vault Balance

**Endpoint**: `GET /api/private-transfer/vault/balance`

**Headers**:
```
Authorization: Bearer <session_jwt>
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "balances": {
      "sol": 10500000000,      // lamports
      "usdc": 5000000          // smallest unit
    }
  }
}
```

---

## WebSocket Events

### Connection Setup

```javascript
import io from 'socket.io-client';

const socket = io('https://api.stealf.app', {
  auth: {
    token: sessionJWT
  }
});

// Subscribe to user-specific events
socket.emit('subscribe:user', userId);

// Listen for transfer updates
socket.on('private-transfer:status-update', (data) => {
  console.log('Transfer update:', data);
});
```

### Event: `private-transfer:status-update`

**Payload**:
```json
{
  "transferId": "507f1f77bcf86cd799439011",
  "status": "deposited",
  "amount": 1.5,
  "tokenMint": null,
  "transactions": {
    "vaultDepositTx": "2ZE7R8hK3mN...",
    "privacyCashDepositTx": "3KF8S9jL4oP..."
  },
  "timestamp": "2024-01-27T10:05:00.000Z"
}
```

**Emitted on every status change**:
- `pending_vault` → Initial state
- `vault_tx_detected` → Webhook received
- `vault_received` → Deposit verified
- `deposit_submitted` → Privacy Cash deposit started
- `deposited` → Privacy Cash deposit confirmed
- `withdraw_submitted` → Privacy Cash withdraw started
- `withdrawn` → Privacy Cash withdraw confirmed
- `completed` → Transfer complete
- `failed` → Transfer failed (includes errorMessage)

---

## Security & Idempotency

### Idempotency Mechanism

**Problem**: How to correlate a Helius webhook to the correct transfer?

**Solution**: UUID-based reference system

1. **Generate UUID** on transfer initiation:
```typescript
const reference = randomUUID(); // "a1b2c3d4-e5f6-4789..."
```

2. **User includes UUID in memo**:
```typescript
const transaction = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: userWallet,
    toPubkey: vaultAddress,
    lamports: amount
  }),
  new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(reference, 'utf-8')  // UUID in memo
  })
);
```

3. **Webhook correlation**:
```typescript
// Primary: Match by memo/reference
const transfer = await PrivateTransfer.findOne({
  reference: webhookMemo,
  status: 'pending_vault'
});

// Fallback: Match by tx details (wallet, amount, token, time)
if (!transfer) {
  const transfer = await PrivateTransfer.findOne({
    sourceWallet: webhookFromAddress,
    amount: webhookAmount,
    tokenMint: webhookToken,
    status: 'pending_vault',
    createdAt: { $gte: Date.now() - 20 * 60 * 1000 }  // 20min window
  });
}
```

### Security Features

#### 1. **Double-Withdrawal Protection**
```typescript
// In retryFailedTransfer()
if (transfer.privacyCashWithdrawTx) {
  throw new Error('Cannot retry: withdrawal already executed');
}
```

#### 2. **Authentication**
- All endpoints protected by `verifyAuth` middleware
- JWT session validation
- User-specific transfer access

#### 3. **Validation**
- Zod schema validation for all inputs
- Token mint verification (only SOL/USDC allowed)
- Wallet address format validation

#### 4. **Privacy Cash Security**
- CipherOwl screening for malicious wallets
- Zero-knowledge proofs prevent traceability
- Client-side UTXO encryption

#### 5. **Rate Limiting**
- Max 3 retry attempts per transfer
- Webhook deduplication by signature
- Time-windowed correlation (20 minutes)

### Fee Structure

**Privacy Cash Fees**:
```typescript
// Deposit: FREE
depositFee = 0

// Withdrawal: Base + Percentage
withdrawalFee = (0.006 SOL × recipientCount) + (amount × 0.35%)

// Example for 1 SOL:
withdrawalFee = 0.006 + (1 × 0.0035) = 0.0095 SOL
```

**Vault Deposit Fee**: Solana network fee (~0.000005 SOL)

---

## Frontend Integration

### React/TypeScript Example

```typescript
import {
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  TransactionInstruction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function initiatePrivateTransfer(
  destinationWallet: string,
  amount: number,
  tokenMint?: string
) {
  // 1. Call backend to initiate transfer
  const response = await fetch('/api/private-transfer/initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionJWT}`
    },
    body: JSON.stringify({
      destinationWallet,
      amount,
      tokenMint
    })
  });

  const { data } = await response.json();
  const { transfer, instructions } = data;

  return {
    vaultAddress: instructions.vaultAddress,
    amount: instructions.amount,
    memo: instructions.memo,  // ⚠️ CRITICAL: Include in transaction
    transferId: transfer.transferId
  };
}

async function sendToVault(
  wallet: any,
  connection: Connection,
  vaultAddress: string,
  amount: number,
  memo: string
) {
  // 2. Create transaction with memo
  const transaction = new Transaction();

  // Add transfer instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(vaultAddress),
      lamports: amount * LAMPORTS_PER_SOL
    })
  );

  // Add memo instruction with reference UUID
  transaction.add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, 'utf-8')
    })
  );

  // 3. Sign and send
  const signature = await wallet.sendTransaction(transaction, connection);

  // 4. Confirm transaction
  await connection.confirmTransaction(signature, 'confirmed');

  console.log('✅ Sent to vault:', signature);
  return signature;
}

// Complete flow
async function executePrivateTransfer() {
  const wallet = useWallet();
  const connection = new Connection('https://api.mainnet-beta.solana.com');

  try {
    // Step 1: Initiate
    const { vaultAddress, amount, memo, transferId } =
      await initiatePrivateTransfer(
        'AliceWallet111...',
        1.5
      );

    console.log('📝 Transfer initiated:', transferId);
    console.log('💭 Memo:', memo);

    // Step 2: Send to vault
    const signature = await sendToVault(
      wallet,
      connection,
      vaultAddress,
      amount,
      memo  // ⚠️ CRITICAL for correlation
    );

    console.log('✅ Vault deposit:', signature);

    // Step 3: Monitor via WebSocket
    // (Backend automatically processes Privacy Cash flow)

  } catch (error) {
    console.error('❌ Transfer failed:', error);
  }
}
```

### WebSocket Monitoring

```typescript
import io from 'socket.io-client';

function setupTransferMonitoring(userId: string, transferId: string) {
  const socket = io('https://api.stealf.app', {
    auth: { token: sessionJWT }
  });

  socket.emit('subscribe:user', userId);

  socket.on('private-transfer:status-update', (data) => {
    if (data.transferId === transferId) {
      console.log('📊 Status:', data.status);

      switch (data.status) {
        case 'vault_tx_detected':
          console.log('✅ Vault deposit detected');
          break;
        case 'deposited':
          console.log('✅ Privacy Cash deposit complete');
          break;
        case 'withdrawn':
          console.log('✅ Privacy Cash withdraw complete');
          break;
        case 'completed':
          console.log('🎉 Transfer completed!');
          console.log('Transactions:', data.transactions);
          break;
        case 'failed':
          console.error('❌ Transfer failed:', data.errorMessage);
          break;
      }
    }
  });

  return socket;
}
```

---

## Privacy Best Practices

To maximize privacy when using Privacy Cash:

1. **Use Round Amounts**: Prefer standard amounts (0.1, 0.5, 1, 5, 10 SOL) to increase anonymity set
2. **Add Delay**: Wait 24+ hours between deposit and withdraw (user decides timing)
3. **Split Large Amounts**: Break large transfers into multiple smaller withdrawals
4. **Token Mixing**: Convert partial amounts to different tokens (SOL ↔ USDC)
5. **Multiple Hops**: Use multiple Privacy Cash cycles for maximum privacy

---

## Error Handling

### Common Error Codes

| Error | Code | Description | Solution |
|-------|------|-------------|----------|
| Insufficient balance | 400 | Not enough funds in wallet | Add funds and retry |
| Unsupported token | 400 | Token not supported | Use SOL or USDC |
| Invalid address | 400 | Destination address invalid | Check address format |
| Vault not configured | 500 | VAULT_PUBLIC_KEY missing | Contact support |
| Max retries reached | 400 | Failed 3+ times | Manual intervention needed |
| Withdrawal executed | 400 | Cannot retry after withdraw | Transfer already completed |

### Retry Strategy

```typescript
// Smart retry logic
if (transfer.status === 'failed') {
  if (transfer.privacyCashWithdrawTx) {
    // ❌ Cannot retry - funds may be sent
    throw new Error('Withdrawal already executed');
  }

  if (transfer.privacyCashDepositTx) {
    // ✅ Resume from deposited state
    transfer.status = 'deposited';
  } else {
    // ✅ Resume from vault_received state
    transfer.status = 'vault_received';
  }

  await executePrivacyFlow(transfer._id);
}
```

---

## Testing

### Test Flow (Devnet)

1. **Setup** `.env`:
```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
VAULT_PRIVATE_KEY=[...]
VAULT_PUBLIC_KEY=FpRVZrZ7zAigWG4mGMirCJMibxedQ4DmMcQCo3p94nwF
```

2. **Initiate test transfer**:
```bash
curl -X POST http://localhost:3000/api/private-transfer/initiate \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationWallet": "7xKXtg2CW87d9uFN1TdNdpgL9yc9J8XCy9nKv1Qw2VTR",
    "amount": 0.1,
    "tokenMint": null
  }'
```

3. **Send test transaction** with memo

4. **Monitor logs**:
```bash
[Correlation] Attempting correlation by reference: a1b2c3d4...
[Correlation] ✅ Transfer 507f1f77... matched by reference
[Orchestrator] Vault transaction detected for transfer 507f1f77...
[Orchestrator] Starting privacy flow for transfer 507f1f77...
[Orchestrator] Executing deposit for transfer 507f1f77...
[Orchestrator] Deposit completed: 3KF8S9jL4oP...
[Orchestrator] Executing withdrawal for transfer 507f1f77...
[Orchestrator] Withdrawal completed: 4LG9T0kM5qR...
[Orchestrator] Privacy flow completed for transfer 507f1f77...
```

---

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Helius webhook registered to backend URL
- [ ] Vault wallet funded with SOL
- [ ] Privacy Cash SDK initialized correctly
- [ ] WebSocket server running
- [ ] MongoDB indexes created
- [ ] Rate limiting configured
- [ ] Frontend memo integration tested
- [ ] Error monitoring setup (Sentry, etc.)

---

## License & Credits

- **Privacy Cash**: Privacy protocol sponsor
- **Helius**: Webhook infrastructure
- **Stealf**: Implementation team

---

## Support & Contact

For hackathon questions or technical support:
- GitHub Issues: [stealf/backend](https://github.com/stealf/backend)
- Discord: [Privacy Cash Community](https://discord.gg/privacycash)
- Email: support@stealf.app

