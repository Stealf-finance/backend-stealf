npm install

ngrok http 3000 to receive helius pushes (balance/history updates)

npm run dev

services:

- coingeko -> display SOL price in USD
- redis -> caching system
- mongodb -> database with three collections:
  - User -> user information
  - magiclinks -> stores tokens to verify link validity
  - webhookshelius -> stores webhook IDs to update user info in real-time

- socket.io -> socket service that relays information to frontend when received (helius webhook)
- magiclink -> sends unique link to user to verify their email
- helius -> fetches user info in real-time
- arcium MPC -> on-chain encryption for user backup (email/pseudo) + private proof of balance. Added before Umbra integration to bring a first layer of confidentiality to sensitive user data via Multi-Party Computation


middleware:
  - turnkey session management -> on each call we check if JWT is properly signed by turnkey + expiration + extract suborgid and verify user exists in database
  - input validation during connection
  - preAuth -> JWT system directly managed by Stealf
