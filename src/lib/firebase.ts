import { initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// Public Firebase web settings (safe to ship to the browser). Admin credentials live only on the API server.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const API_URL = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

// Without these settings the app runs in "local mode": data stays in this browser and login is a demo.
export const cloudEnabled = Boolean(API_URL && Object.values(firebaseConfig).every(Boolean));

export const auth: Auth | null = cloudEnabled ? getAuth(initializeApp(firebaseConfig)) : null;
