// =============================================================================
// Inventory OS — Repair Module
// Chapter 5/7/11: repairs are tracked as their own permanent records,
// referencing the asset's Internal Asset Number (its Firestore doc id) —
// never the Asset ID, since that can change while the repair is open.
// An asset may have many repairs over its lifetime; each is immutable once
// created except for the transition from in-progress to completed.
// =============================================================================

import { db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, formatDate } from "./utils.js";
import { logActivity } from "./activity.js";
import { listVendors, openVendorModal } from "./vendors.js";
import { CLOSE_ICON } from "./icons.js";

export async function listRepairsForAsset(internalAssetNumber) {
  const snap = await getDocs(query(
    collection(db, "repairs"),
    where("assetId", "==", internalAssetNumber),
    orderBy("reportedDate", "desc")
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function openSendForRepairModal(asset, state, onDone) {
  let vendors = await listVendors();
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });

  const vendorSelect = el("select", { class: "field-input", id: "rep_vendor" }, vendors.map((v) => new Option(v.companyName, v.id)));
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Send for Repair"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "field-group" }, [
        el("div", { class: "field-label" }, "Vendor"),
        el("div", { style: "display:flex;gap:6px;" }, [
          vendorSelect,
          el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => {
            openVendorModal(null, state, async (newVendorId) => {
              vendors = await listVendors();
              vendorSelect.innerHTML = "";
              vendors.forEach((v) => vendorSelect.appendChild(new Option(v.companyName, v.id)));
              vendorSelect.value = newVendorId;
            });
          } }, "+ New")
        ])
      ]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Description of Issue"),
        el("textarea", { class: "field-input", id: "rep_description" })]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Estimated Cost (₹, optional)"),
        el("input", { class: "field-input", id: "rep_estimatedCost", type: "number" })]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Remarks"),
        el("textarea", { class: "field-input", id: "rep_remarks" })])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        const description = document.getElementById("rep_description").value.trim();
        if (!description) { showToast("Describe the issue first", "red"); return; }
        e.target.disabled = true;
        try {
          await addDoc(collection(db, "repairs"), {
            assetId: asset.id, // Internal Asset Number — never the mutable Asset ID.
            centreId: asset.centreId,
            reportedBy: state.profile.uid,
            reportedDate: new Date().toISOString().slice(0, 10),
            vendorId: document.getElementById("rep_vendor").value || null,
            description,
            estimatedCost: Number(document.getElementById("rep_estimatedCost").value) || null,
            actualCost: null,
            status: "in_progress",
            completionDate: null,
            remarks: document.getElementById("rep_remarks").value.trim(),
            createdAt: serverTimestamp()
          });
          await updateDoc(doc(db, "assets", asset.id), {
            currentStatus: "under_repair",
            lastModifiedBy: state.profile.uid,
            lastModifiedAt: serverTimestamp()
          });
          await logActivity(state, { type: "repair_started", assetId: asset.id, centreId: asset.centreId, summary: `${asset.assetId} sent for repair` });
          showToast("Sent for repair", "amber");
          overlay.remove();
          if (onDone) onDone();
        } catch (err) {
          console.error("[repairs] Send for repair failed:", err);
          showToast("Couldn't save repair record. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, "Send for Repair")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export async function openReturnFromRepairModal(asset, state, onDone) {
  const openRepairs = (await listRepairsForAsset(asset.id)).filter((r) => r.status !== "completed");
  if (!openRepairs.length) {
    showToast("No open repair record found for this asset.", "amber");
    return;
  }
  const activeRepair = openRepairs[0]; // Most recent, per the desc ordering.

  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Return from Repair"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { style: "font-size:12px;color:var(--text-faint);" }, `Closing the repair reported on ${formatDate(activeRepair.reportedDate)}.`),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Actual Cost (₹)"),
        el("input", { class: "field-input", id: "ret_actualCost", type: "number" })]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Completion Notes"),
        el("textarea", { class: "field-input", id: "ret_notes" })])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        e.target.disabled = true;
        try {
          await updateDoc(doc(db, "repairs", activeRepair.id), {
            status: "completed",
            actualCost: Number(document.getElementById("ret_actualCost").value) || null,
            completionDate: new Date().toISOString().slice(0, 10),
            remarks: (activeRepair.remarks || "") + (document.getElementById("ret_notes").value ? `\n${document.getElementById("ret_notes").value.trim()}` : "")
          });
          await updateDoc(doc(db, "assets", asset.id), {
            currentStatus: "active",
            lastModifiedBy: state.profile.uid,
            lastModifiedAt: serverTimestamp()
          });
          await logActivity(state, { type: "repair_completed", assetId: asset.id, centreId: asset.centreId, summary: `${asset.assetId} returned from repair` });
          showToast("Marked as returned from repair", "green");
          overlay.remove();
          if (onDone) onDone();
        } catch (err) {
          console.error("[repairs] Return from repair failed:", err);
          showToast("Couldn't close repair record. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, "Mark Returned")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export function repairStatusLabel(status) {
  return status === "completed" ? "Completed" : "In Progress";
}
