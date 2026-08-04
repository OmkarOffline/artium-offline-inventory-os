// =============================================================================
// Inventory OS — Activity Logging
// Chapter 7/11: Activity records are system-generated only — no module should
// let a user hand-write one. Every other module that performs a meaningful
// operational action calls logActivity() rather than writing to
// /activities directly, so the shape stays consistent everywhere.
// =============================================================================

import { db } from "./firebase.js";
import { collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * @param {object} state - app state (needs state.profile)
 * @param {{type:string, assetId?:string, centreId:string, summary:string}} entry
 */
export async function logActivity(state, entry) {
  await addDoc(collection(db, "activities"), {
    type: entry.type,
    assetId: entry.assetId || null,
    centreId: entry.centreId,
    userId: state.profile.uid,
    userName: state.profile.displayName || state.profile.email,
    summary: entry.summary,
    timestamp: serverTimestamp()
  });
}

export async function listRecentActivity(centreId, count = 10) {
  const q = query(
    collection(db, "activities"),
    where("centreId", "==", centreId),
    orderBy("timestamp", "desc"),
    limit(count)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
