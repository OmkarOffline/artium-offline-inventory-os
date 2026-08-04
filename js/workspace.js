// =============================================================================
// Inventory OS — Workspace Persistence & Saved Views
// Chapter 8: filters, sort, columns and last-used centre should follow the
// user across sessions and devices, not just survive a page refresh. All of
// this lives inside /users/{uid}.workspacePreferences — a field the Firestore
// rules already let a user write to on their own document (see the /users
// update rule's hasOnly(['workspacePreferences']) clause), so no rules
// change was needed to add this milestone.
// =============================================================================

import { db } from "./firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** Shallow-merges at the top level of workspacePreferences (lastActiveCentreId, register, savedViews). */
export async function updateWorkspacePreferences(state, partial) {
  const merged = { ...(state.profile.workspacePreferences || {}), ...partial };
  state.profile.workspacePreferences = merged; // Optimistic local update — UI doesn't wait on the round trip.
  try {
    await updateDoc(doc(db, "users", state.profile.uid), { workspacePreferences: merged });
  } catch (err) {
    console.error("[workspace] Failed to save preferences:", err);
  }
}

export function getLastActiveCentreId(state) {
  return state.profile.workspacePreferences?.lastActiveCentreId || null;
}

export async function saveLastActiveCentreId(state, centreId) {
  await updateWorkspacePreferences(state, { lastActiveCentreId: centreId });
}

export function getRegisterPrefs(state) {
  return state.profile.workspacePreferences?.register || null;
}

export async function saveRegisterPrefs(state, partial) {
  const current = getRegisterPrefs(state) || {};
  await updateWorkspacePreferences(state, { register: { ...current, ...partial } });
}

export function listSavedViews(state) {
  return state.profile.workspacePreferences?.savedViews || [];
}

/** @param {{id?:string,name:string,searchTerm:string,sortKey:string,sortDir:string,roomFilterId:?string,roomFilterName:?string,columns:string[]}} view */
export async function saveView(state, view) {
  const views = listSavedViews(state);
  const id = view.id || `v_${Date.now()}`;
  const next = [...views.filter((v) => v.id !== id), { ...view, id }];
  await updateWorkspacePreferences(state, { savedViews: next });
  return id;
}

export async function deleteView(state, id) {
  const next = listSavedViews(state).filter((v) => v.id !== id);
  await updateWorkspacePreferences(state, { savedViews: next });
}
