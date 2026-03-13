import { Router } from "express";
import { YieldController } from "../controllers/YieldController";

const router = Router();

router.get("/mxe-pubkey", YieldController.getMxePublicKey);
router.get("/balance/:userId", YieldController.getBalance);
router.get("/stats", YieldController.getStats);
router.post("/withdraw", YieldController.withdraw);

export default router;
