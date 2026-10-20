import path from "node:path";
import { logger } from "./lib/logger";

try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // Replit and production deployments provide environment variables directly.
}

const { default: app } = await import("./app");

const rawPort = process.env["PORT"] ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
