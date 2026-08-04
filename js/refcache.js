// =============================================================================
// Inventory OS — Reference Data Cache
// Milestone 6 performance pass: Rooms and Vendors barely change (rooms are
// fixed per centre; vendors change only when someone explicitly adds one),
// yet Register was re-fetching both on every single keystroke, and
// Dashboard/Reports re-fetched them on every visit. This is a short-TTL
// in-memory cache for exactly those two lookups — never for Assets, Repairs,
// Activities or anything else that needs to be live on every read.
// =============================================================================

import { db } from "./firebase.js";
import { collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TTL_MS = 60_000;

const roomsCache = new Map(); // centreId -> { data, ts }
let vendorsCache = null; // { data, ts }

export async function getRoomsForCentre(centreId) {
  const cached = roomsCache.get(centreId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  const snap = await getDocs(query(collection(db, "rooms"), where("centreId", "==", centreId)));
  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  roomsCache.set(centreId, { data, ts: Date.now() });
  return data;
}

export async function getVendors() {
  if (vendorsCache && Date.now() - vendorsCache.ts < TTL_MS) return vendorsCache.data;
  const snap = await getDocs(query(collection(db, "vendors"), orderBy("companyName")));
  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  vendorsCache = { data, ts: Date.now() };
  return data;
}

/** Called after creating/editing a vendor so the new one shows up immediately instead of waiting out the TTL. */
export function invalidateVendorsCache() {
  vendorsCache = null;
}

export function invalidateRoomsCache(centreId) {
  if (centreId) roomsCache.delete(centreId);
  else roomsCache.clear();
}
