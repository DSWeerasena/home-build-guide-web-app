import { API_URL, auth } from "./firebase";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Options = { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; form?: FormData };

async function send(path: string, options: Options, forceRefresh: boolean): Promise<Response> {
  const user = auth?.currentUser;
  if (!user) throw new ApiError(401, "auth_required", "User is not authenticated");
  const token = await user.getIdToken(forceRefresh);
  try {
    return await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "network", "Network request failed");
  }
}

// Calls the House Build Guide API with the signed-in user's Firebase ID token.
export async function apiFetch<T = unknown>(path: string, options: Options = {}): Promise<T> {
  let res = await send(path, options, false);
  // An expired token is refreshed once before giving up.
  if (res.status === 401) res = await send(path, options, true);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "server_error", data.message || res.statusText);
  return data as T;
}

// Translation key for an API failure; raw server details are never shown to the user.
export function apiErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return "err.generic";
  if (error.status === 0) return "err.network";
  if (error.status === 401) return "err.session";
  if (error.status === 403) return "err.forbidden";
  if (error.status === 404) return "err.notFound";
  if (error.code === "file_too_large" || error.status === 413) return "err.fileTooLarge";
  if (error.status === 415) return "err.unsupportedFile";
  if (error.status === 429) return "err.rateLimited";
  if (error.status === 400) return "err.validation";
  return "err.generic";
}

// Translation key for a Firebase Authentication error code.
export function authErrorKey(error: unknown): string {
  const code = (error as { code?: string })?.code || "";
  const known: Record<string, string> = {
    "auth/email-already-in-use": "authErr.emailInUse",
    "auth/invalid-email": "authErr.invalidEmail",
    "auth/weak-password": "authErr.weakPassword",
    "auth/missing-password": "authErr.weakPassword",
    "auth/invalid-credential": "authErr.wrongCredentials",
    "auth/wrong-password": "authErr.wrongCredentials",
    "auth/user-not-found": "authErr.wrongCredentials",
    "auth/invalid-login-credentials": "authErr.wrongCredentials",
    "auth/too-many-requests": "authErr.tooManyRequests",
    "auth/network-request-failed": "err.network",
    "auth/requires-recent-login": "authErr.recentLogin",
    "auth/user-disabled": "authErr.disabled",
  };
  return known[code] ?? (error instanceof ApiError ? apiErrorKey(error) : "authErr.generic");
}
