import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { HttpError } from "./errors.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { apiRouter } from "./routes/index.js";

// Builds the Express app from injected services so tests can run without real Firebase credentials.
export function createApp({ config, store, files, auth, logger = console }) {
  const app = express();
  const deps = { config, store, files, auth, logger };

  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render terminates HTTPS in front of the app; needed for correct client IPs in rate limiting.
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      // Requests without an Origin header (health checks, curl) are not browser cross-origin requests.
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new HttpError(403, "forbidden", "This website is not allowed to use the API."));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "rate_limited", message: "Too many requests. Please wait a moment and try again." } }));
  app.use(express.json({ limit: "512kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "house-build-guide-api" }));
  app.use("/api", apiRouter(deps));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
