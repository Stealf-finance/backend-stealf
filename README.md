# Stealf Backend - GRID SDK

Backend for the Stealf application using the GRID SDK for Solana account and transaction management.

## 🚀 Installation

```bash
npm install
```

## ⚙️ Configuration

1. Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```

2. Configure your environment variables in `.env`:
```env
PORT=3001
NODE_ENV=development
GRID_API_KEY=your_grid_api_key
GRID_ENV=sandbox
```

## 🏃 Getting Started

### Development mode (with hot reload)
```bash
npm run dev
```

### Production mode
```bash
npm run build
npm start
```

## 📡 API Endpoints

### Authentication

#### Initiate authentication (Step 1)
```http
POST /grid/auth
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "session_id": "string"
}
```

#### Verify OTP (Step 2)
```http
POST /grid/auth/verify
Content-Type: application/json

{
  "session_id": "string",
  "otp_code": "123456"
}
```

### Account Creation

#### Create an account (Step 1)
```http
POST /grid/accounts
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Verify OTP and finalize creation (Step 2)
```http
POST /grid/accounts/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "otp_code": "123456",
  "sessionSecrets": {},
  "user": {
    "email": "user@example.com"
  }
}
```

### Account Management

#### Create a smart account
```http
POST /grid/smart-accounts
Content-Type: application/json

{
  "network": "solana-devnet"
}
```

#### Get balance
```http
POST /grid/balance
Content-Type: application/json

{
  "smartAccountAddress": "SolanaAddress..."
}
```

#### Get transfers
```http
GET /grid/transfers?smart_account_address=SolanaAddress...
```

### Transactions

#### Create a payment intent
```http
POST /grid/payment-intent
Content-Type: application/json

{
  "smartAccountAddress": "SolanaAddress...",
  "payload": {
    "amount": "1000000",
    "destination": "DestinationAddress..."
  }
}
```

#### Confirm and send transaction
```http
POST /grid/confirm
Content-Type: application/json

{
  "address": "SolanaAddress...",
  "signedTransactionPayload": "base64_encoded_transaction"
}
```

## 🏗️ Project Structure

```
new-back/
├── src/
│   ├── config/
│   │   └── gridClient.ts       # GRID SDK configuration
│   ├── routes/
│   │   ├── auth.routes.ts      # Authentication routes
│   │   ├── account.routes.ts   # Account management routes
│   │   └── transaction.routes.ts # Transaction routes
│   ├── types/
│   │   └── errors.ts           # Error types
│   └── server.ts               # Main Express server
├── .env.example                # Configuration template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Technologies Used

- **Express.js** - Web framework
- **TypeScript** - Typed language
- **@sqds/grid** - GRID SDK for Solana
- **dotenv** - Environment variable management
- **cors** - CORS management

## 📝 Important Notes

- The backend uses the GRID SDK in server mode (with API Key)
- The GRID API Key must NEVER be exposed to the frontend
- Use `sandbox` for development and testing
- The SDK automatically determines the GRID endpoint based on `GRID_ENV`

## 🛡️ Security

- Never commit the `.env` file
- Keep your `GRID_API_KEY` secret
- Use HTTPS in production
- Configure CORS properly with `CORS_ORIGINS`

## 🚨 Health Check

To verify the server is running:

```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-21T...",
  "environment": "sandbox"
}
```

## 📚 GRID Documentation

For more information on the GRID SDK, consult the official documentation.
