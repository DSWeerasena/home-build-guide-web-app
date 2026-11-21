import { HttpError } from "../errors.js";

// Verifies "Authorization: Bearer <Firebase ID token>". The UID used everywhere afterwards comes only from the
// verified token, never from the request body, query or URL.
export function authenticate(authService, logger) {
  return async (req, _res, next) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return next(new HttpError(401, "auth_required", "Authentication required."));
    try {
      const decoded = await authService.verifyIdToken(header.slice(7).trim());
      req.user = { uid: decoded.uid, email: decoded.email || "", emailVerified: Boolean(decoded.email_verified), name: decoded.name || "" };
      next();
    } catch (error) {
      // Logged without the token itself.
      logger.warn(`auth failure on ${req.method} ${req.path}: ${error?.code || error?.message || "unknown"}`);
      next(new HttpError(401, "invalid_token", "Your session has expired. Please sign in again."));
    }
  };
}

// Loads :projectId and allows the request only when the verified user owns it.
export function requireProjectOwner(store) {
  return async (req, _res, next) => {
    const project = await store.getProject(req.params.projectId);
    if (!project) return next(new HttpError(404, "not_found", "Project not found."));
    if (project.ownerId !== req.user.uid) return next(new HttpError(403, "forbidden", "Access denied."));
    req.project = project;
    next();
  };
}
