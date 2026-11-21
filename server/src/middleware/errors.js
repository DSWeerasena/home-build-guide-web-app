import { HttpError } from "../errors.js";

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, "not_found", "Not found."));
}

// Sends only safe, generic messages to the browser; details (never tokens or keys) go to the server log.
export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    let error = err;
    if (err?.type === "entity.parse.failed") error = new HttpError(400, "validation_failed", "The request body is not valid JSON.");
    else if (err?.type === "entity.too.large") error = new HttpError(413, "payload_too_large", "The request is too large.");
    else if (err?.code === "LIMIT_FILE_SIZE") error = new HttpError(413, "file_too_large", "This file is too large. The maximum size is 10 MB.");
    else if (err?.code?.startsWith?.("LIMIT_")) error = new HttpError(400, "unsupported_file", "Unable to upload this plan.");

    if (error instanceof HttpError) {
      if (error.status >= 500) logger.error(`${req.method} ${req.path} -> ${error.status} ${error.code}`);
      return res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    logger.error(`${req.method} ${req.path} -> 500: ${err?.code || ""} ${err?.message || err}`);
    res.status(500).json({ error: "server_error", message: "Something went wrong. Please try again." });
  };
}
