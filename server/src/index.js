import { loadConfig, missingFirebaseSettings } from "./config.js";
import { createApp } from "./app.js";
import { createAuthService, createFirestoreStore, createStorageFiles, initFirebase } from "./services/firebase.js";

const config = loadConfig();
const missing = missingFirebaseSettings(config);
if (missing.length) {
  console.error(`House Build Guide API cannot start. Missing environment variables: ${missing.join(", ")}. See server/.env.example.`);
  process.exit(1);
}
if (config.isProduction && !config.allowedOrigins.length) {
  console.error("FRONTEND_URL must be set in production so the API only accepts requests from your website.");
  process.exit(1);
}

const { db, bucket, auth } = initFirebase(config.firebase);
const app = createApp({ config, store: createFirestoreStore(db), files: createStorageFiles(bucket), auth: createAuthService(auth) });

app.listen(config.port, () => {
  console.log(`House Build Guide API listening on port ${config.port} (${config.isProduction ? "production" : "development"})`);
  console.log(`Allowed origins: ${config.allowedOrigins.join(", ") || "(none)"}`);
});
