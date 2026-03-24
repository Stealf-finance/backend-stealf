import { Router } from "express";
import { YieldController } from "../controllers/YieldController";
import { verifyAuth } from "../middleware/verifyAuth";
import { yieldLimiter, withdrawLimiter } from "../middleware/rateLimiter";

const router = Router();

router.get("/mxe-pubkey", verifyAuth, YieldController.getMxePublicKey);
router.get("/balance/:userId", yieldLimiter, verifyAuth, YieldController.getBalance);
router.get("/stats", YieldController.getStats);
router.post("/withdraw", withdrawLimiter, verifyAuth, YieldController.withdraw);

export default router;
