// Reads every setting from environment variables; nothing secret is ever hardcoded.
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8443", "http://localhost:4173"];

const normaliseOrigin = value => value.trim().replace(/\/+$/, "");

export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const frontendUrls = (env.FRONTEND_URL || "").split(",").map(normaliseOrigin).filter(Boolean);
  const projectId = env.FIREBASE_PROJECT_ID || "";
  return {
    isProduction,
    port: Number(env.PORT) || 5000,
    // Production accepts only the deployed frontend(s); development also allows the local Vite servers.
    allowedOrigins: isProduction ? frontendUrls : [...new Set([...frontendUrls, ...DEV_ORIGINS])],
    firebase: {
      projectId,
      clientEmail: env.FIREBASE_CLIENT_EMAIL || "",
      // Render and .env files store the key on one line with literal "\n" sequences.
      privateKey: (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      storageBucket: env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : ""),
    },
    uploads: { maxBytes: 10 * 1024 * 1024 },
  };
}

export function missingFirebaseSettings(config) {
  const { projectId, clientEmail, privateKey, storageBucket } = config.firebase;
  return Object.entries({ FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PRIVATE_KEY: privateKey, FIREBASE_STORAGE_BUCKET: storageBucket })
    .filter(([, value]) => !value)
    .map(([name]) => name);
}
