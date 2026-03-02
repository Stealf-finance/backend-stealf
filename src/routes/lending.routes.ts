import { Router } from "express";
import { verifyAuth } from "../middleware/verifyAuth";
import { LendingController } from "../controllers/LendingController";

const router = Router();

// Public endpoint — SOL price (cached 30s in Redis, no auth needed)
router.get("/sol-price", LendingController.getSolPrice);

// All lending routes require authentication
router.use(verifyAuth);

// Build transactions (POST — returns unsigned transaction for Turnkey signing)
router.post("/collateral", LendingController.depositCollateral);
router.post("/borrow", LendingController.borrow);
router.post("/repay", LendingController.repay);
router.post("/withdraw-collateral", LendingController.withdrawCollateral);

// Confirm action after user-signed transaction is submitted on-chain
router.post("/confirm", LendingController.confirm);

// Read-only endpoints
router.get("/position", LendingController.getPosition);
router.get("/rates", LendingController.getRates);

export default router;
