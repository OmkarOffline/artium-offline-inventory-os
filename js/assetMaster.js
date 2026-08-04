// =============================================================================
// Inventory OS — Asset Master & Asset Type data layer
// Chapter 4: Asset Master is a catalogue of specs, not physical items, and
// sits above individual Asset instances. It has no dedicated sidebar page
// (Chapter 2's nav list doesn't include one) — it's surfaced entirely
// through the Add Asset workflow: pick an existing Master, or create a new
// one inline without leaving the flow. Asset Types work the same way.
// =============================================================================

import { db } from "./firebase.js";
import {
  collection, doc, getDocs, setDoc, addDoc, updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function listAssetTypes() {
  const snap = await getDocs(query(collection(db, "assetTypes"), orderBy("code")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Create a new Asset Type inline. Code is the document id (e.g. "TAB"). */
export async function createAssetType(code, name) {
  const normalizedCode = code.trim().toUpperCase();
  await setDoc(doc(db, "assetTypes", normalizedCode), { code: normalizedCode, name: name.trim() });
  return { id: normalizedCode, code: normalizedCode, name: name.trim() };
}

export async function listAssetMasters() {
  const snap = await getDocs(query(collection(db, "assetMasters"), orderBy("assetName")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Create a new Asset Master. Fields per Chapter 4: identity, classification,
 * manufacturer info, operational (warranty), purchasing (default vendor),
 * documentation (Drive image link standing in for Standard Images), notes.
 */
export async function createAssetMaster(data, currentUser) {
  const ref = await addDoc(collection(db, "assetMasters"), {
    assetName: data.assetName.trim(),
    category: data.category,
    assetTypeCode: data.assetTypeCode,
    brand: data.brand?.trim() || "",
    model: data.model?.trim() || "",
    warrantyApplicable: !!data.warrantyApplicable,
    standardWarrantyDurationMonths: data.standardWarrantyDurationMonths || null,
    expectedUsefulLifeMonths: data.expectedUsefulLifeMonths || null,
    defaultVendorId: data.defaultVendorId || null,
    driveImageLink: data.driveImageLink?.trim() || "",
    description: data.description?.trim() || "",
    remarks: data.remarks?.trim() || "",
    createdBy: currentUser.uid,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

/**
 * Correct an existing Asset Master — e.g. it was created with the wrong
 * Asset Type code and needs to point at the right one. This only ever
 * changes the catalogue entry itself; it does NOT retroactively rename any
 * Asset ID already generated from it (those stay historically accurate —
 * see Ch.4's "Asset ID never changes after creation" rule). Future assets
 * created from this Master will use the corrected values.
 */
export async function updateAssetMaster(masterId, data) {
  await updateDoc(doc(db, "assetMasters", masterId), {
    assetName: data.assetName.trim(),
    category: data.category,
    assetTypeCode: data.assetTypeCode,
    brand: data.brand?.trim() || "",
    model: data.model?.trim() || "",
    warrantyApplicable: !!data.warrantyApplicable,
    defaultVendorId: data.defaultVendorId || null,
    driveImageLink: data.driveImageLink?.trim() || "",
    description: data.description?.trim() || ""
  });
}

export const ASSET_CATEGORIES = [
  "Musical Instruments",
  "Electronics",
  "Accessories"
];
