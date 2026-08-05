// =============================================================================
// Inventory OS — Room Transfer & Centre Transfer
// Chapter 4 rules, implemented exactly:
//  - Room Transfer: Internal Asset Number and serial number unchanged, only
//    the Room Code segment of the Asset ID regenerates.
//  - Centre Transfer: Internal Asset Number retained, new Asset ID generated
//    against the destination centre's own serial counter for that Type.
// Both preserve every historical record, retain previous Asset IDs, and flag
// Label Reprint Required.
// =============================================================================

import { db } from "./firebase.js";
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, roomDisplayName } from "./utils.js";
import { logActivity } from "./activity.js";
import { nextSequence, buildAssetId } from "./addAsset.js";
import { listAssetTypes } from "./assetMaster.js";
import { CLOSE_ICON } from "./icons.js";

/** The sequence segment is always the last '-'-delimited part of the Asset ID. */
function currentSequence(assetId) {
  return assetId.split("-").pop();
}

export async function openRoomTransferModal(asset, state, onDone) {
  const roomsSnap = await getDocs(query(collection(db, "rooms"), where("centreId", "==", asset.centreId)));
  const rooms = roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.id !== asset.roomId);

  if (!rooms.length) { showToast("No other rooms in this centre to transfer to.", "amber"); return; }

  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const select = el("select", { class: "field-input" }, rooms.map((r) => new Option(roomDisplayName(r.name), r.id)));
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Transfer Room"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { style: "font-size:12px;color:var(--text-faint);" }, `Moving ${asset.assetId} within Bangalore – Borewell Road. A new Asset ID will be generated and the physical label will need reprinting.`),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "New Room"), select])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        e.target.disabled = true;
        try {
          const newRoom = rooms.find((r) => r.id === select.value);
          const oldAssetId = asset.assetId;
          const newAssetId = buildAssetId(asset.centreId, newRoom.code, asset.assetTypeCode, currentSequence(oldAssetId));

          await updateDoc(doc(db, "assets", asset.id), {
            assetId: newAssetId,
            previousAssetIds: arrayUnion(oldAssetId),
            roomId: newRoom.id,
            labelReprintRequired: true,
            lastModifiedBy: state.profile.uid,
            lastModifiedAt: serverTimestamp()
          });
          await logActivity(state, {
            type: "room_transfer", assetId: asset.id, centreId: asset.centreId,
            summary: `${oldAssetId} moved to ${newRoom.name} — new ID ${newAssetId}`
          });
          showToast(`Transferred — new Asset ID ${newAssetId}`, "green");
          overlay.remove();
          if (onDone) onDone();
        } catch (err) {
          console.error("[transfer] Room transfer failed:", err);
          showToast("Couldn't transfer room. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, "Transfer")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Owner-only correction for an asset that was created with the wrong Asset
 * Type (e.g. a data-entry slip picked "CAP" for a smartphone instead of
 * "PHN" — see the bug that motivated this). This is deliberately separate
 * from editing an Asset Master: a Master change only affects assets
 * created from it going forward, but an already-created asset's own
 * assetTypeCode and Asset ID need a direct, explicit correction. Follows
 * the same pattern as Room/Centre Transfer: allocate a fresh sequence
 * number under the corrected type's own counter, regenerate the Asset ID,
 * and keep the old one in previousAssetIds so history is never lost.
 */
export async function openCorrectAssetTypeModal(asset, state, onDone) {
  const assetTypes = await listAssetTypes();
  const options = assetTypes.filter((t) => t.code !== asset.assetTypeCode);
  if (!options.length) { showToast("No other Asset Types exist to correct this to.", "amber"); return; }

  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const select = el("select", { class: "field-input" }, options.map((t) => new Option(`${t.code} — ${t.name}`, t.code)));
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Correct Asset Type"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { style: "font-size:12px;color:var(--text-faint);" },
        `${asset.assetId} is currently typed "${asset.assetTypeCode}". Choosing a different type here regenerates this asset's own Asset ID with the corrected code — its previous ID is kept in history, and the physical label will need reprinting.`),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Correct Asset Type"), select])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        e.target.disabled = true;
        try {
          const roomSnap = await getDoc(doc(db, "rooms", asset.roomId));
          if (!roomSnap.exists()) throw new Error("Room not found");
          const roomCode = roomSnap.data().code;
          const newTypeCode = select.value;
          const oldAssetId = asset.assetId;
          const newSeq = await nextSequence(asset.centreId, newTypeCode);
          const newAssetId = buildAssetId(asset.centreId, roomCode, newTypeCode, newSeq);

          await updateDoc(doc(db, "assets", asset.id), {
            assetId: newAssetId,
            assetTypeCode: newTypeCode,
            previousAssetIds: arrayUnion(oldAssetId),
            labelReprintRequired: true,
            lastModifiedBy: state.profile.uid,
            lastModifiedAt: serverTimestamp()
          });
          await logActivity(state, {
            type: "asset_type_corrected", assetId: asset.id, centreId: asset.centreId,
            summary: `${oldAssetId} corrected from type ${asset.assetTypeCode} to ${newTypeCode} — new ID ${newAssetId}`
          });
          showToast(`Corrected — new Asset ID ${newAssetId}`, "green");
          overlay.remove();
          if (onDone) onDone();
        } catch (err) {
          console.error("[transfer] Asset Type correction failed:", err);
          showToast("Couldn't correct Asset Type. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, "Correct")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export async function openCentreTransferModal(asset, state, onDone) {
  const destinationCentres = state.centres.filter((c) => c.id !== asset.centreId);
  if (!destinationCentres.length) { showToast("No other centres to transfer to.", "amber"); return; }

  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const centreSelect = el("select", { class: "field-input" }, destinationCentres.map((c) => new Option(c.name, c.id)));
  const roomSelectWrap = el("div", { class: "field-group" }, [
    el("div", { class: "field-label" }, "New Room"),
    el("select", { class: "field-input", id: "ct_room" })
  ]);

  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Transfer Centre"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { style: "font-size:12px;color:var(--text-faint);" }, `Permanently moving ${asset.assetId} to a different centre. A new Asset ID will be generated using the destination centre's own numbering, and the physical label will need reprinting. Full history is preserved.`),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Destination Centre"), centreSelect]),
      roomSelectWrap
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", id: "ct_confirm" }, "Transfer")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let destRooms = [];
  async function loadRooms() {
    const snap = await getDocs(query(collection(db, "rooms"), where("centreId", "==", centreSelect.value)));
    destRooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const roomSelect = document.getElementById("ct_room");
    roomSelect.innerHTML = "";
    if (!destRooms.length) { roomSelect.appendChild(new Option("No rooms configured there", "")); return; }
    destRooms.forEach((r) => roomSelect.appendChild(new Option(roomDisplayName(r.name), r.id)));
  }
  centreSelect.addEventListener("change", loadRooms);
  await loadRooms();

  document.getElementById("ct_confirm").addEventListener("click", async (e) => {
    const destCentre = destinationCentres.find((c) => c.id === centreSelect.value);
    const roomId = document.getElementById("ct_room").value;
    const newRoom = destRooms.find((r) => r.id === roomId);
    if (!newRoom) { showToast("Select a destination room", "red"); return; }

    e.target.disabled = true;
    try {
      const oldAssetId = asset.assetId;
      const newSeq = await nextSequence(destCentre.id, asset.assetTypeCode);
      const newAssetId = buildAssetId(destCentre.id, newRoom.code, asset.assetTypeCode, newSeq);

      await updateDoc(doc(db, "assets", asset.id), {
        assetId: newAssetId,
        previousAssetIds: arrayUnion(oldAssetId),
        centreId: destCentre.id,
        roomId: newRoom.id,
        labelReprintRequired: true,
        lastModifiedBy: state.profile.uid,
        lastModifiedAt: serverTimestamp()
      });
      // Logged against the destination centre — this is where the asset
      // (and whoever's tracking it) lives from now on.
      await logActivity(state, {
        type: "centre_transfer", assetId: asset.id, centreId: destCentre.id,
        summary: `${oldAssetId} transferred from another centre to ${destCentre.name} / ${newRoom.name} — new ID ${newAssetId}`
      });
      showToast(`Transferred to ${destCentre.name} — new Asset ID ${newAssetId}`, "green");
      overlay.remove();
      if (onDone) onDone();
    } catch (err) {
      console.error("[transfer] Centre transfer failed:", err);
      showToast("Couldn't transfer centre. Check your permissions.", "red");
      e.target.disabled = false;
    }
  });
}
