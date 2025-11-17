pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Hidden Amount Claim Circuit (Tornado Cash / Umbra-style)
 *
 * This circuit proves:
 * 1. Knowledge of commitment secrets (secret, nullifier, recipient, amount)
 * 2. Commitment is correctly formed: C = Poseidon(secret, nullifier, recipient, amount)
 * 3. Commitment exists in Merkle tree at claimed index
 * 4. Nullifier hash is correctly derived: nh = Poseidon(nullifier)
 * 5. Amount is valid (non-zero, within bounds)
 *
 * WITHOUT revealing:
 * - The amount (private witness!)
 * - The secret
 * - The nullifier
 * - The recipient
 * - The Merkle proof path (which commitment is being spent)
 *
 * Public Inputs:
 * - merkleRoot: Root of commitment Merkle tree
 * - nullifierHash: Hash of nullifier (prevents double-spend)
 *
 * Private Inputs (Witness):
 * - secret: Random secret for commitment
 * - nullifier: Random nullifier for double-spend prevention
 * - recipient: Recipient's public key
 * - amount: The hidden amount (KEY: This stays private!)
 * - pathElements[levels]: Merkle proof path
 * - pathIndices[levels]: Merkle proof indices
 */

template HiddenAmountClaim(levels) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;

    // Private inputs (witness)
    signal input secret;
    signal input nullifier;
    signal input recipient;
    signal input amount;  // ← HIDDEN! Not revealed on-chain!

    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 1. Verify nullifier hash is correctly derived
    // nh = Poseidon(nullifier)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.out === nullifierHash;

    // 2. Verify amount is valid (non-zero, within reasonable bounds)
    // Amount must be > 0
    component amountCheck = GreaterThan(64);
    amountCheck.in[0] <== amount;
    amountCheck.in[1] <== 0;
    amountCheck.out === 1;

    // Amount must be < 2^64 - 1 (max u64)
    component amountBoundsCheck = LessThan(64);
    amountBoundsCheck.in[0] <== amount;
    amountBoundsCheck.in[1] <== 18446744073709551615; // u64::MAX
    amountBoundsCheck.out === 1;

    // 3. Compute commitment
    // C = Poseidon(secret, nullifier, recipient, amount)
    component commitmentHasher = Poseidon(4);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;
    commitmentHasher.inputs[2] <== recipient;
    commitmentHasher.inputs[3] <== amount;  // Amount is hashed but NOT revealed!

    // 4. Verify Merkle proof
    // Prove commitment exists in tree without revealing which one!
    component merkleProof[levels];
    signal currentHash[levels + 1];
    currentHash[0] <== commitmentHasher.out;

    for (var i = 0; i < levels; i++) {
        merkleProof[i] = Poseidon(2);

        // Select left or right based on pathIndices
        component mux = Mux1();
        mux.c[0] <== currentHash[i];
        mux.c[1] <== pathElements[i];
        mux.s <== pathIndices[i];

        merkleProof[i].inputs[0] <== mux.out[0];
        merkleProof[i].inputs[1] <== mux.out[1];

        currentHash[i + 1] <== merkleProof[i].out;
    }

    // 5. Verify final hash matches merkle root
    currentHash[levels] === merkleRoot;
}

// Instantiate circuit with tree depth = 20 (supports up to 2^20 = 1M commitments)
component main {public [merkleRoot, nullifierHash]} = HiddenAmountClaim(20);
