import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Serve the encrypted_transfer.arcis circuit file
 * This endpoint is used by Arcium MPC nodes to fetch the circuit
 */
router.get('/encrypted_transfer.arcis', (req, res) => {
    const arcisPath = path.join(__dirname, '../../arcium-private-transfer/build/encrypted_transfer.arcis');
    // Check if file exists
    if (!fs.existsSync(arcisPath)) {
        return res.status(404).json({ error: 'Circuit file not found' });
    }
    // Serve the file with correct headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="encrypted_transfer.arcis"');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for MPC nodes
    res.sendFile(arcisPath);
});
export default router;
