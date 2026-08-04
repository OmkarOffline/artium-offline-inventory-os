// =============================================================================
// Inventory OS — Firebase Initialization
// Single source of Firebase app/service instances. Every other module should
// import auth/db/storage from here rather than calling initializeApp again.
// =============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ---------------------------------------------------------------------------
// Live config for the "Artium Offline Inventory OS" Firebase project.
// This apiKey is a public client identifier, not a secret — Firestore
// Security Rules (not this file) are what actually protect the data.
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyChRrVOiKWO-syfCeUk48MiL65LsmXxz9E",
  authDomain: "artium-offline-inventory-os.firebaseapp.com",
  projectId: "artium-offline-inventory-os",
  storageBucket: "artium-offline-inventory-os.firebasestorage.app",
  messagingSenderId: "890289081490",
  appId: "1:890289081490:web:818c7f8d4a77624ee5aa4b"
};

export const IS_FIREBASE_CONFIGURED = firebaseConfig.apiKey !== "PLACEHOLDER_API_KEY";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Restrict the Google account chooser to Artium's Workspace domain up front.
// This is a UX convenience only — the real enforcement happens in auth.js
// (post sign-in email check) and must also be mirrored in Firestore Security
// Rules per Blueprint Chapter 11. Never rely on this hint alone.
googleProvider.setCustomParameters({ hd: "artiumacademy.com" });

// Persist sessions across browser restarts so users rarely need to sign in
// again on the same device (Blueprint Chapter 3 — Persistent Login).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("[firebase] Failed to set auth persistence:", err);
});

export const ALLOWED_DOMAIN = "artiumacademy.com";
