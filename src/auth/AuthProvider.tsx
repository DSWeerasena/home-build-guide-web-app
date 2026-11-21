import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, sendEmailVerification,
  sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signOut, updateProfile, type User,
} from "firebase/auth";
import { auth, cloudEnabled } from "../lib/firebase";
import { apiFetch } from "../lib/api";
import type { Language } from "../i18n";

// "local" = no Firebase settings: the app keeps working on this browser with a demo login.
export type AuthStatus = "local" | "loading" | "signedOut" | "signedIn";

// Name and language chosen on the Register form, sent with the first profile bootstrap.
export const SIGNUP_DETAILS_KEY = "hbg-signup-details";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  emailVerified: boolean;
  register: (details: { name: string; email: string; password: string; language: Language }) => Promise<void>;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshUser: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(cloudEnabled ? "loading" : "local");
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, next => {
      setUser(next);
      setEmailVerified(Boolean(next?.emailVerified));
      setStatus(next ? "signedIn" : "signedOut");
    });
  }, []);

  const requireAuth = () => {
    if (!auth) throw new Error("Firebase is not configured");
    return auth;
  };

  const value: AuthContextValue = {
    status,
    user,
    emailVerified,
    async register({ name, email, password, language }) {
      sessionStorage.setItem(SIGNUP_DETAILS_KEY, JSON.stringify({ name, preferredLanguage: language }));
      const cred = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password);
      await updateProfile(cred.user, { displayName: name }).catch(() => {});
      // Verification is encouraged but not required to start using the app.
      await sendEmailVerification(cred.user).catch(() => {});
    },
    // "Remember me" keeps the session after the browser closes; otherwise it ends with the tab.
    async login(email, password, remember = true) {
      await setPersistence(requireAuth(), remember ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(requireAuth(), email.trim(), password);
    },
    async logout() {
      await signOut(requireAuth());
    },
    async resetPassword(email) {
      await sendPasswordResetEmail(requireAuth(), email.trim());
    },
    async resendVerification() {
      const current = requireAuth().currentUser;
      if (current) await sendEmailVerification(current);
    },
    async refreshUser() {
      const current = requireAuth().currentUser;
      if (!current) return;
      await current.reload();
      setEmailVerified(current.emailVerified);
      // A fresh token carries the updated email_verified claim to the API.
      await current.getIdToken(true);
    },
    // Deleting an account is sensitive, so Firebase requires the password again first.
    async deleteAccount(password) {
      const current = requireAuth().currentUser;
      if (!current?.email) throw new Error("Not signed in");
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
      await apiFetch("/api/me", { method: "DELETE" });
      await signOut(requireAuth()).catch(() => {});
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
