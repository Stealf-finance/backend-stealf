# ZK Proof Artifacts Blocker - Umbra Privacy SDK

## Current Status

The Umbra Privacy SDK integration is **BLOCKED** due to missing ZK proof artifacts required for Master Viewing Key (MVK) registration.

## Background

### What Works
- ✅ Backend server starts successfully
- ✅ Umbra Client initialization
- ✅ Arcium Encrypted User Account initialization (bit 0 SET)
- ✅ Solana connection and wallet management
- ✅ All infrastructure code is in place

### What's Blocked
- ❌ Master Viewing Key (MVK) registration
- ❌ Public deposits into mixer pool
- ❌ Confidential deposits into mixer pool
- ❌ Any privacy-preserving transactions

## The Problem

### Why MVK Registration is Required

Both `depositPubliclyIntoMixerPool` and `depositConfidentiallyIntoMixerPool` have this check:

```typescript
// From umbra-client.ts:1768-1773
if (
    !accountExists ||
    !isBitSet(accountStatusByte, FLAG_BIT_FOR_HAS_REGISTERED_MASTER_VIEWING_KEY)
) {
    throw new UmbraClientError(
        'User account has not registered master viewing key'
    );
}
```

**Without MVK registration (bit 2 set), ALL deposits are rejected by the SDK.**

### Why MVK Registration Fails

MVK registration requires generating a Zero-Knowledge proof using Groth16 circuits. The SDK's `WasmZkProver` expects these artifacts:

```typescript
// From wasm-zk-prover.ts:46-79
export const CIRCUIT_ARTIFACT_URLS: Record<CircuitId, { wasm: string; zkey: string; verificationKey?: string }> = {
    masterViewingKeyRegistration: {
        wasm: '/zk/master_viewing_key_registration.wasm',
        zkey: '/zk/master_viewing_key_registration.zkey',
        verificationKey: '/zk/master_viewing_key_registration_verification_key.json',
    },
    // ... other circuits
};
```

### The Root Cause

1. **Relative Paths Don't Work in Node.js**: The SDK uses relative paths like `/zk/master_viewing_key_registration.wasm` which work in browsers (fetch from same domain) but fail in Node.js backend.

2. **Artifacts Not Included**: The ZK proof artifacts are NOT included in the `@umbra-privacy/sdk` npm package.

3. **No Public CDN**: Extensive research found no public CDN or URL where these artifacts are hosted:
   - ❌ Not on `https://relayer.umbraprivacy.com/zk/...`
   - ❌ Not on `https://umbraprivacy.com/zk/...`
   - ❌ Not on `https://artifacts.umbraprivacy.com/...`
   - ❌ Not in any public GitHub repository

4. **No Documentation**: The official Umbra documentation does not provide:
   - Download links for artifacts
   - Instructions on generating artifacts
   - CDN URLs for production use
   - Developer guides for backend integration

### Error Message

When attempting MVK registration:

```
TypeError: Failed to parse URL from /zk/master_viewing_key_registration.wasm
    at WasmZkProver.fetchBinary (/home/louis/Bureau/Stealf/backend-stealf/src/lib/umbra-sdk/src/client/implementation/wasm-zk-prover.ts:262:39)
```

## Research Conducted

### SDK Analysis
- ✅ Read all ZK prover implementation code
- ✅ Found `IZkProver` interface for custom implementations
- ✅ Confirmed artifacts can be customized "at build time"
- ✅ Identified that `CIRCUIT_ARTIFACT_URLS` is exported (can be modified)

### Infrastructure Search
- ✅ Found `RELAYER_BASE_URL = 'https://relayer.umbraprivacy.com/'`
- ✅ Tested relayer for artifacts - NOT FOUND
- ✅ Checked official website - NOT FOUND
- ✅ Searched for GitHub repos - NOT FOUND
- ✅ Web searched for CDN URLs - NOT FOUND

### Documentation Review
- ✅ Checked `https://docs.umbraprivacy.com/` - No developer guides
- ✅ Searched for SDK documentation - Minimal/incomplete
- ✅ Looked for artifact download instructions - NONE FOUND

## Why We Can't Bypass This

### 1. Creating a Stub Prover Won't Work

We could implement a custom `IZkProver` that returns dummy proofs, but:

```typescript
// This WILL NOT WORK because:
class StubZkProver extends IZkProver {
  async generateMasterViewingKeyRegistrationProof(...): Promise<[bytes, bytes, bytes]> {
    // Return dummy proof
    return [new Uint8Array(64), new Uint8Array(128), new Uint8Array(64)];
  }
}
```

**Problem**: The Solana program validates proofs on-chain using Groth16 verification. Invalid proofs will be rejected by the blockchain, not just the SDK.

### 2. Skipping MVK Registration Won't Work

The SDK has hardcoded checks that prevent deposits without MVK registration. We cannot bypass this without modifying the SDK source code, which would break compatibility and updates.

### 3. Generating Artifacts Ourselves is Extremely Complex

To generate the artifacts, we would need:

1. **Circom Source Code**: The circuit definition files (`.circom`)
   - Not public in any Umbra repository
   - Proprietary to Umbra Privacy

2. **Trusted Setup**: Powers of Tau ceremony results
   - Required for Groth16 proving keys
   - Umbra likely has their own trusted setup

3. **Complex Build Process**:
   ```bash
   # Hypothetical process (we don't have the circuits):
   circom circuit.circom --r1cs --wasm --sym
   snarkjs powersoftau new bn128 12 pot12_0000.ptau
   snarkjs powersoftau prepare phase2 pot12_final.ptau
   snarkjs groth16 setup circuit.r1cs pot12_final.ptau circuit_0000.zkey
   # ... many more steps
   ```

4. **Correct Circuit Implementation**: One mistake = invalid proofs forever

## Possible Solutions

### Option 1: Contact Umbra Team (RECOMMENDED)

**Action Items**:
1. Join Umbra Discord/Telegram community
2. Email Umbra support/development team
3. Request:
   - Official CDN URL for ZK artifacts
   - OR downloadable artifact package
   - OR developer documentation for backend integration

**Contact Info to Try**:
- GitHub: `@umbra-defi` organization
- Website: `https://umbraprivacy.com/` (look for contact/support)
- Documentation: `https://docs.umbraprivacy.com/` (look for community links)
- Twitter/X: `@UmbraPrivacy`

### Option 2: Use Frontend-Only Integration

**Workaround**: Move all Umbra operations to the frontend where artifacts can be loaded via relative paths.

**Pros**:
- Artifacts load correctly in browser
- No CDN needed
- Works as SDK intended

**Cons**:
- Requires exposing more logic to frontend
- Less secure (private keys in browser)
- Not suitable for backend-driven privacy mixer

### Option 3: Host Artifacts Ourselves (if we can get them)

Once we obtain the artifacts from Umbra team:

1. Host on our own CDN or static server
2. Modify SDK configuration:

```typescript
// In umbra-client.service.ts
import { CIRCUIT_ARTIFACT_URLS } from '../../lib/umbra-sdk/dist/index.mjs';

// Update URLs to point to our CDN
CIRCUIT_ARTIFACT_URLS.masterViewingKeyRegistration = {
  wasm: 'https://our-cdn.com/zk/master_viewing_key_registration.wasm',
  zkey: 'https://our-cdn.com/zk/master_viewing_key_registration.zkey',
  verificationKey: 'https://our-cdn.com/zk/master_viewing_key_registration_verification_key.json',
};
```

### Option 4: Use Local File System (Development Only)

For local testing, if we get the artifacts:

1. Place artifacts in `/home/louis/Bureau/Stealf/backend-stealf/public/zk/`
2. Serve static files via Express
3. Update URLs to `http://localhost:3001/zk/...`

**Note**: This is NOT production-ready.

## Current Code State

### Working Code
All infrastructure is ready in:
- `src/services/umbra/umbra-client.service.ts` - Client initialization ✅
- `src/services/umbra/umbra-wallet.service.ts` - Wallet management ✅
- `src/services/umbra/account-init.service.ts` - Arcium account init ✅
- `src/services/umbra/deposit.service.ts` - Deposit logic (awaiting artifacts) ⏸️
- `src/services/umbra/claim.service.ts` - Claim logic (awaiting artifacts) ⏸️

### Debug Logging Added
Account status byte inspection shows:
- Bit 0 (IS_INITIALISED): SET ✅
- Bit 2 (HAS_REGISTERED_MVK): NOT SET ❌ (blocked by missing artifacts)
- Bit 3 (IS_ACTIVE): NOT SET ⏸️

## Next Steps

1. **Immediate**: Contact Umbra team for artifacts or CDN URL
2. **While waiting**: Continue building other features
3. **Once artifacts obtained**:
   - Host on CDN or configure local serving
   - Update `CIRCUIT_ARTIFACT_URLS`
   - Test MVK registration
   - Test deposits and claims
4. **Production**: Ensure artifacts are hosted on reliable CDN

## Files to Update Once Artifacts Are Available

1. **`src/services/umbra/umbra-client.service.ts`**:
   ```typescript
   // Add after imports:
   import { CIRCUIT_ARTIFACT_URLS } from '../../lib/umbra-sdk/dist/index.mjs';

   // In initialize() method, before creating client:
   CIRCUIT_ARTIFACT_URLS.masterViewingKeyRegistration = {
     wasm: process.env.ZK_ARTIFACTS_BASE_URL + '/master_viewing_key_registration.wasm',
     zkey: process.env.ZK_ARTIFACTS_BASE_URL + '/master_viewing_key_registration.zkey',
     verificationKey: process.env.ZK_ARTIFACTS_BASE_URL + '/master_viewing_key_registration_verification_key.json',
   };
   // ... same for other circuits
   ```

2. **`.env`**:
   ```bash
   ZK_ARTIFACTS_BASE_URL=https://cdn.umbraprivacy.com/zk  # (or our own CDN)
   ```

## Additional Resources

- Umbra SDK GitHub: `https://github.com/umbra-defi` (private repos)
- Umbra Documentation: `https://docs.umbraprivacy.com/`
- Relayer API: `https://relayer.umbraprivacy.com/`
- snarkjs Documentation: `https://github.com/iden3/snarkjs`

## Summary

The Umbra Privacy SDK integration is **95% complete**. The only blocker is obtaining the ZK proof artifacts, which are required by the protocol's cryptographic architecture and cannot be bypassed or generated without access to Umbra's circuit source code and trusted setup.

**The path forward is to contact the Umbra team for official artifact access.**
