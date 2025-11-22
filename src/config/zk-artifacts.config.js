/**
 * ZK Artifacts Configuration
 *
 * This module configures the ZK proof artifact URLs for the Umbra SDK.
 *
 * IMPORTANT: The artifacts are currently NOT available. This configuration
 * is prepared for when we obtain them from the Umbra team.
 *
 * See ZK_ARTIFACTS_BLOCKER.md for full details on the blocker.
 */
import { CIRCUIT_ARTIFACT_URLS } from '../lib/umbra-sdk/dist/index.mjs';
/**
 * Configure ZK artifact URLs
 *
 * This function modifies the SDK's CIRCUIT_ARTIFACT_URLS to point to
 * the correct location where artifacts are hosted.
 *
 * Options for artifact hosting:
 * 1. Official Umbra CDN (when they provide it)
 * 2. Our own CDN/static server
 * 3. Local file serving (development only)
 */
export function configureZkArtifactUrls() {
    // Get base URL from environment or use default (when artifacts are available)
    const baseUrl = process.env.ZK_ARTIFACTS_BASE_URL || 'NOT_CONFIGURED';
    if (baseUrl === 'NOT_CONFIGURED') {
        console.warn('⚠️  ZK_ARTIFACTS_BASE_URL not configured');
        console.warn('   ZK proof generation will fail until artifacts are available');
        console.warn('   See ZK_ARTIFACTS_BLOCKER.md for details');
        return;
    }
    console.log(`🔧 Configuring ZK artifact URLs: ${baseUrl}`);
    // Update each circuit's artifact URLs
    CIRCUIT_ARTIFACT_URLS.masterViewingKeyRegistration = {
        wasm: `${baseUrl}/master_viewing_key_registration.wasm`,
        zkey: `${baseUrl}/master_viewing_key_registration.zkey`,
        verificationKey: `${baseUrl}/master_viewing_key_registration_verification_key.json`,
    };
    CIRCUIT_ARTIFACT_URLS.createSplDepositWithHiddenAmount = {
        wasm: `${baseUrl}/create_spl_deposit_with_hidden_amount.wasm`,
        zkey: `${baseUrl}/create_spl_deposit_with_hidden_amount.zkey`,
        verificationKey: `${baseUrl}/create_spl_deposit_with_hidden_amount_verification_key.json`,
    };
    CIRCUIT_ARTIFACT_URLS.createSplDepositWithPublicAmount = {
        wasm: `${baseUrl}/create_spl_deposit_with_public_amount.wasm`,
        zkey: `${baseUrl}/create_spl_deposit_with_public_amount.zkey`,
        verificationKey: `${baseUrl}/create_spl_deposit_with_public_amount_verification_key.json`,
    };
    CIRCUIT_ARTIFACT_URLS.claimSplDepositWithHiddenAmount = {
        wasm: `${baseUrl}/claim_spl_deposit_with_hidden_amount.wasm`,
        zkey: `${baseUrl}/claim_spl_deposit_with_hidden_amount.zkey`,
        verificationKey: `${baseUrl}/claim_spl_deposit_with_hidden_amount_verification_key.json`,
    };
    CIRCUIT_ARTIFACT_URLS.claimSplDeposit = {
        wasm: `${baseUrl}/claim_spl_deposit.wasm`,
        zkey: `${baseUrl}/claim_spl_deposit.zkey`,
        verificationKey: `${baseUrl}/claim_spl_deposit_verification_key.json`,
    };
    console.log('✅ ZK artifact URLs configured');
}
/**
 * Check if ZK artifacts are properly configured
 */
export function areZkArtifactsConfigured() {
    const baseUrl = process.env.ZK_ARTIFACTS_BASE_URL;
    return baseUrl !== undefined && baseUrl !== 'NOT_CONFIGURED' && baseUrl.length > 0;
}
