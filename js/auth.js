// =============================================================================
// Inventory OS — Authentication & Role Resolution
// Owns: Google Sign-In, domain restriction, session state, and resolving a
// signed-in Firebase user into an Inventory OS user profile (role + centres).
// No other module should call Firebase Auth methods directly.
// =============================================================================

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, googleProvider, ALLOWED_DOMAIN } from "./firebase.js";

// Bootstrap-only seed list (Blueprint Chapter 3). Used exactly once per
// account, the first time that email signs in, to create its /users
// document as an Owner. After that, the /users collection — editable via
// the Users module — is the sole source of truth for role and permissions.
// This list must never be consulted for anything other than first-login
// bootstrap of these two accounts.
const SEED_OWNERS = ["omkar@artiumacademy.com", "padma@artiumacademy.com"];

export const ROLES = { OWNER: "owner", CENTRE_ADMIN: "centre_admin", VIEWER: "viewer" };

/**
 * Trigger the Google Sign-In popup. Throws on failure — caller (login.html)
 * is responsible for surfacing a friendly error message.
 */
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser() {
  await signOut(auth);
}

/**
 * Validate domain, then load (or bootstrap) the user's Inventory OS profile
 * document from /users/{uid}. Returns null if access should be denied —
 * callers must sign the user back out and show a friendly message in that
 * case rather than leaving a half-authenticated session.
 */
export async function resolveUserProfile(firebaseUser) {
  if (!firebaseUser || !firebaseUser.email) return null;

  const email = firebaseUser.email.toLowerCase();
  const domain = email.split("@")[1];

  if (domain !== ALLOWED_DOMAIN) {
    return null; // Access denied: outside @artiumacademy.com
  }

  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const data = snap.data();
    if (data.disabled) return data.pendingApproval ? "pending" : "disabled";
    return { uid: firebaseUser.uid, email, ...data };
  }

  // No profile yet. The two seed Owners self-bootstrap as full Owners on
  // first login. Everyone else with a valid domain email self-bootstraps as
  // a disabled, powerless Viewer "pending" record — this is what makes them
  // visible to an Owner in the Users page for approval. Nothing about this
  // record grants any access: isActiveUser() (and everything built on it)
  // requires disabled !== true, so a pending account can read or write
  // nothing until an Owner explicitly activates it.
  if (SEED_OWNERS.includes(email)) {
    const profile = {
      email,
      displayName: firebaseUser.displayName || email,
      role: ROLES.OWNER,
      assignedCentres: [], // Owners see all centres regardless of this list
      disabled: false,
      createdAt: serverTimestamp(),
      workspacePreferences: {}
    };
    await setDoc(userRef, profile);
    return { uid: firebaseUser.uid, ...profile };
  }

  // Pre-provisioned by an Owner via Users → Invite User (/invites/{email},
  // created ahead of time with a role already picked). If one exists for
  // this email, skip the disabled "pending approval" limbo entirely and
  // activate them immediately with the role the Owner already chose — this
  // is what makes an invite actually mean something rather than just being
  // a note to self for the Owner.
  const inviteRef = doc(db, "invites", email);
  const inviteSnap = await getDoc(inviteRef);
  if (inviteSnap.exists()) {
    const invite = inviteSnap.data();
    const profile = {
      email,
      displayName: firebaseUser.displayName || email,
      role: invite.role,
      assignedCentres: invite.assignedCentres || [],
      disabled: false,
      pendingApproval: false,
      createdAt: serverTimestamp(),
      workspacePreferences: {}
    };
    await setDoc(userRef, profile);
    // Consumed — clean it up so it doesn't linger in the Users page's
    // "Invited" list looking unresolved. Non-fatal if this fails; the
    // invite is harmless once the /users doc already exists.
    await deleteDoc(inviteRef).catch((err) => console.warn("[auth] Couldn't clean up consumed invite:", err));
    return { uid: firebaseUser.uid, ...profile };
  }

  const pendingProfile = {
    email,
    displayName: firebaseUser.displayName || email,
    role: ROLES.VIEWER,
    assignedCentres: [],
    disabled: true,
    pendingApproval: true,
    createdAt: serverTimestamp(),
    workspacePreferences: {}
  };
  await setDoc(userRef, pendingProfile);
  return "pending"; // Still denied — Owner must activate them in the Users page.
}

/**
 * Subscribe to auth state. Callback receives either a resolved Inventory OS
 * profile object, or null (not signed in / access denied) plus an issue
 * object describing why, when there's something more specific to say than
 * "denied" (pending Owner approval, or explicitly disabled).
 */
export function onAuthReady(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    try {
      const result = await resolveUserProfile(firebaseUser);
      if (result === "pending" || result === "disabled") {
        await signOut(auth);
        callback(null, result === "pending" ? { pending: true } : { disabledByOwner: true });
        return;
      }
      if (!result) {
        await signOut(auth);
        callback(null, { denied: true });
        return;
      }
      callback(result);
    } catch (err) {
      console.error("[auth] Failed to resolve user profile:", err);
      await signOut(auth);
      callback(null, { error: true });
    }
  });
}

/** Guard for index.html and future authenticated pages. */
export function requireAuth(onReady) {
  onAuthReady((profile, issue) => {
    if (!profile) {
      const params = issue?.pending ? "?pending=1" : issue?.disabledByOwner ? "?disabled=1" : issue?.denied ? "?denied=1" : issue?.error ? "?error=1" : "";
      window.location.href = `login.html${params}`;
      return;
    }
    onReady(profile);
  });
}

/** Guard for login.html — bounce already-authenticated users straight in. */
export function requireGuest(onSignedIn) {
  onAuthReady((profile) => {
    if (profile) onSignedIn(profile);
  });
}
