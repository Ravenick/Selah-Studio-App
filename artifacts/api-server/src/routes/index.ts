import { Router, type IRouter } from "express";
import healthRouter from "./health";
import selahRouter from "./selah";

const router: IRouter = Router();

router.use(healthRouter);
router.use(selahRouter);

export default router;
