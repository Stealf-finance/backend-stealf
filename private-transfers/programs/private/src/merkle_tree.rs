use anchor_lang::prelude::*;
use crate::poseidon_utils::hash_merkle_node;

/// Maximum depth of the Merkle tree
/// Depth 20 allows for 2^20 = 1,048,576 commitments
pub const MERKLE_TREE_DEPTH: usize = 20;

/// Incremental Merkle tree for commitments
/// Following Zcash Sapling design with Poseidon hash
#[account]
pub struct MerkleTree {
    /// Current root of the tree
    pub root: [u8; 32],

    /// Number of leaves in the tree
    pub next_index: u64,

    /// Cached hashes at each level for incremental updates
    /// filled_subtrees[i] = latest complete subtree hash at level i
    pub filled_subtrees: Vec<[u8; 32]>,

    /// Zero hashes for empty nodes at each level
    /// zero_hashes[i] = Poseidon(zero_hashes[i-1], zero_hashes[i-1])
    pub zero_hashes: Vec<[u8; 32]>,

    /// PDA bump
    pub bump: u8,
}

impl MerkleTree {
    /// Size calculation for account space
    pub const LEN: usize = 8  // discriminator
        + 32  // root
        + 8   // next_index
        + 4 + (MERKLE_TREE_DEPTH * 32)  // filled_subtrees vec
        + 4 + (MERKLE_TREE_DEPTH * 32)  // zero_hashes vec
        + 1;  // bump

    /// Initialize the Merkle tree with zero hashes
    pub fn initialize(&mut self) -> Result<()> {
        // Compute zero hashes for each level
        // zero_hashes[0] = 0
        // zero_hashes[i] = Poseidon(zero_hashes[i-1], zero_hashes[i-1])
        let mut zeros = Vec::with_capacity(MERKLE_TREE_DEPTH);
        zeros.push([0u8; 32]); // Level 0

        for i in 1..MERKLE_TREE_DEPTH {
            let prev = zeros[i - 1];
            let hash = hash_merkle_node(&prev, &prev)?;
            zeros.push(hash);
        }

        self.zero_hashes = zeros.clone();
        self.filled_subtrees = vec![[0u8; 32]; MERKLE_TREE_DEPTH];
        self.root = zeros[MERKLE_TREE_DEPTH - 1];
        self.next_index = 0;

        msg!("✅ Merkle tree initialized with depth {}", MERKLE_TREE_DEPTH);
        Ok(())
    }

    /// Insert a new leaf (commitment) into the tree
    /// Returns the index of the inserted leaf
    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<u64> {
        require!(
            (self.next_index as usize) < (1 << MERKLE_TREE_DEPTH),
            ErrorCode::MerkleTreeFull
        );

        let index = self.next_index;
        let mut current_hash = leaf;
        let mut current_index = index;

        // Climb the tree, updating hashes
        for i in 0..MERKLE_TREE_DEPTH {
            if current_index % 2 == 0 {
                // Left node - store hash for later pairing
                self.filled_subtrees[i] = current_hash;
                // Pair with zero hash on the right
                current_hash = hash_merkle_node(&current_hash, &self.zero_hashes[i])?;
            } else {
                // Right node - pair with previously stored left node
                let left = self.filled_subtrees[i];
                current_hash = hash_merkle_node(&left, &current_hash)?;
            }

            current_index /= 2;
        }

        self.root = current_hash;
        self.next_index += 1;

        msg!("✅ Leaf inserted at index {}, new root: {:?}", index, &self.root[..8]);
        Ok(index)
    }

    /// Get Merkle proof for a given leaf index
    /// Returns the path (sibling hashes) from leaf to root
    pub fn get_proof(&self, index: u64) -> Result<Vec<[u8; 32]>> {
        require!(
            index < self.next_index,
            ErrorCode::InvalidLeafIndex
        );

        let mut path = Vec::with_capacity(MERKLE_TREE_DEPTH);
        let mut current_index = index;

        for i in 0..MERKLE_TREE_DEPTH {
            if current_index % 2 == 0 {
                // Left node - sibling is either filled_subtrees[i] or zero_hash[i]
                if current_index + 1 < (self.next_index >> i) {
                    path.push(self.filled_subtrees[i]);
                } else {
                    path.push(self.zero_hashes[i]);
                }
            } else {
                // Right node - sibling is filled_subtrees[i]
                path.push(self.filled_subtrees[i]);
            }

            current_index /= 2;
        }

        Ok(path)
    }

    /// Verify a Merkle proof
    /// Returns true if the proof is valid for the given leaf and root
    pub fn verify_proof(
        leaf: &[u8; 32],
        proof: &[[u8; 32]],
        index: u64,
        root: &[u8; 32],
    ) -> Result<bool> {
        require!(
            proof.len() == MERKLE_TREE_DEPTH,
            ErrorCode::InvalidProofLength
        );

        let mut current_hash = *leaf;
        let mut current_index = index;

        for i in 0..MERKLE_TREE_DEPTH {
            let sibling = proof[i];

            if current_index % 2 == 0 {
                // Current node is left child
                current_hash = hash_merkle_node(&current_hash, &sibling)?;
            } else {
                // Current node is right child
                current_hash = hash_merkle_node(&sibling, &current_hash)?;
            }

            current_index /= 2;
        }

        Ok(current_hash == *root)
    }

    /// Get current root
    pub fn get_root(&self) -> [u8; 32] {
        self.root
    }

    /// Get number of leaves
    pub fn get_size(&self) -> u64 {
        self.next_index
    }
}

// ===================================
// ERROR CODES
// ===================================

#[error_code]
pub enum ErrorCode {
    #[msg("Merkle tree is full (reached maximum capacity)")]
    MerkleTreeFull,

    #[msg("Invalid leaf index for Merkle proof")]
    InvalidLeafIndex,

    #[msg("Invalid Merkle proof length")]
    InvalidProofLength,

    #[msg("Merkle proof verification failed")]
    ProofVerificationFailed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_tree_initialization() {
        let mut tree = MerkleTree {
            root: [0u8; 32],
            next_index: 0,
            filled_subtrees: vec![],
            zero_hashes: vec![],
            bump: 0,
        };

        tree.initialize().unwrap();
        assert_eq!(tree.next_index, 0);
        assert_eq!(tree.zero_hashes.len(), MERKLE_TREE_DEPTH);
        assert_ne!(tree.root, [0u8; 32]); // Root should be computed zero hash
    }

    #[test]
    fn test_merkle_tree_insert() {
        let mut tree = MerkleTree {
            root: [0u8; 32],
            next_index: 0,
            filled_subtrees: vec![],
            zero_hashes: vec![],
            bump: 0,
        };

        tree.initialize().unwrap();

        let leaf1 = [1u8; 32];
        let index1 = tree.insert(leaf1).unwrap();
        assert_eq!(index1, 0);
        assert_eq!(tree.next_index, 1);

        let leaf2 = [2u8; 32];
        let index2 = tree.insert(leaf2).unwrap();
        assert_eq!(index2, 1);
        assert_eq!(tree.next_index, 2);

        // Root should change after each insertion
        assert_ne!(tree.root, [0u8; 32]);
    }

    #[test]
    fn test_merkle_proof_verification() {
        let mut tree = MerkleTree {
            root: [0u8; 32],
            next_index: 0,
            filled_subtrees: vec![],
            zero_hashes: vec![],
            bump: 0,
        };

        tree.initialize().unwrap();

        // Insert leaves
        let leaf1 = [1u8; 32];
        let leaf2 = [2u8; 32];
        let leaf3 = [3u8; 32];

        tree.insert(leaf1).unwrap();
        tree.insert(leaf2).unwrap();
        tree.insert(leaf3).unwrap();

        let root = tree.get_root();

        // Get proof for leaf2 (index 1)
        let proof = tree.get_proof(1).unwrap();
        let is_valid = MerkleTree::verify_proof(&leaf2, &proof, 1, &root).unwrap();
        assert!(is_valid);

        // Invalid proof (wrong leaf)
        let is_invalid = MerkleTree::verify_proof(&leaf1, &proof, 1, &root).unwrap();
        assert!(!is_invalid);
    }
}
