import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((error: unknown, _req: unknown, res: import("express").Response, next: import("express").NextFunction) => {
  const parserError = error as { status?: number; type?: string };
  if (parserError.status === 413 || parserError.type === "entity.too.large") {
    res.status(413).json({ error: "Audio recordings must be 25 MB or smaller." });
    return;
  }
  next(error);
});

export default app;
