// Errors that are safe to show to the browser. Anything else becomes a generic 500.
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, "validation_failed", message, details);
export const forbidden = () => new HttpError(403, "forbidden", "Access denied.");
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found.`);
