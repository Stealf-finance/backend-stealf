import { Router } from "express";
import { verifyAuth } from "../middleware/verifyAuth";
import { YieldController } from "../controllers/YieldController";

const router = Router();

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

// Auto-sweep (Yield-to-Card)
router.get("/auto-sweep", YieldController.getAutoSweepConfig);
router.put("/auto-sweep", YieldController.updateAutoSweepConfig);

export default router;
