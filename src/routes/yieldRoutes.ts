import { Router } from "express";
import { verifyAuth } from "../middleware/verifyAuth";
import { YieldController } from "../controllers/YieldController";

const router = Router();

// Permissionless endpoint — registered BEFORE verifyAuth
router.get("/reserve-proof", YieldController.proofOfReserve);

// All yield routes require authentication
router.use(verifyAuth);

// Deposit flow
router.post("/deposit", YieldController.deposit);

// Withdrawal flow
router.post("/withdraw", YieldController.withdraw);

// Confirm deposit or withdrawal
router.post("/confirm", YieldController.confirm);

// Read-only endpoints
router.get("/balance", YieldController.getBalance);
router.get("/apy", YieldController.getAPY);
router.get("/dashboard", YieldController.getDashboard);

// Arcium proof of yield (MPC-verified)
router.get("/proof", YieldController.proofOfYield);

// Arcium balance snapshots
router.get("/snapshots", YieldController.getSnapshots);

// Arcium proof of yield from snapshots
router.get("/proof-from-snapshots", YieldController.proofFromSnapshots);

// Arcium yield distribution (admin trigger)
router.post("/distribute-yield", YieldController.distributeYield);

export default router;
