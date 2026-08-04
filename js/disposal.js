// =============================================================================
// Inventory OS — Disposal Workflow
// Chapter 4/7/11: disposal is a workflow, never a delete. A Centre Admin or
// Owner requests disposal with a reason; only an Owner may approve or
// reject. Approval moves the asset to "disposed" — it leaves the active
// Register but the document (and every historical record attached to it)
// is never removed from Firestore. Rejection returns the asset to "active".
// =============================================================================

import { db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, formatDate } from "./utils.js";
import { logActivity } from "./activity.js";

const REASONS = ["Damaged beyond repair", "Lost", "Obsolete / end of life", "Other"];

export async function listDisposalRequests(state) {
  const isOwner = state.profile.role === "owner";
  const q = isOwner
    ? query(collection(db, "disposalRequests"), orderBy("requestedAt", "desc"))
    : query(collection(db, "disposalRequests"), where("centreId", "==", state.activeCentreId), orderBy("requestedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listPendingDisposalRequests(state) {
  const all = await listDisposalRequests(state);
  return all.filter((r) => r.status === "pending");
}

export function openDisposalRequestModal(asset, state, onDone) {
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const reasonSelect = el("select", { class: "field-input", id: "disp_reason" }, REASONS.map((r) => new Option(r, r)));
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Request Disposal"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, "×")]),
    el("div", { class: "modal-body" }, [
      el("div", { style: "font-size:12px;color:var(--text-faint);" }, `Requesting disposal for ${asset.assetId}. This flags it Pending Disposal and sends it to the Owners for approval — nothing is removed until approved.`),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Reason"), reasonSelect]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Notes"), el("textarea", { class: "field-input", id: "disp_notes" })])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        e.target.disabled = true;
        try {
          await addDoc(collection(db, "disposalRequests"), {
            assetId: asset.id,
            assetIdLabel: asset.assetId,
            centreId: asset.centreId,
            status: "pending",
            reason: document.getElementById("disp_reason").value,
            notes: document.getElementById("disp_notes").value.trim(),
            requestedBy: state.profile.uid,
            requestedByName: state.profile.displayName || state.profile.email,
            requestedAt: serverTimestamp(),
            decidedBy: null,
            decidedAt: null,
            decisionNotes: null
          });
          await updateDoc(doc(db, "assets", asset.id), {
            currentStatus: "pending_disposal",
            lastModifiedBy: state.profile.uid,
            lastModifiedAt: serverTimestamp()
          });
          await logActivity(state, {
            type: "disposal_requested", assetId: asset.id, centreId: asset.centreId,
            summary: `${asset.assetId}: Disposal requested — ${document.getElementById("disp_reason").value}`
          });
          showToast("Disposal requested — sent to Owners for approval", "amber");
          overlay.remove();
          if (onDone) onDone();
        } catch (err) {
          console.error("[disposal] Request failed:", err);
          showToast("Couldn't submit disposal request. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, "Submit Request")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export async function approveDisposal(request, state, onDone) {
  try {
    await updateDoc(doc(db, "disposalRequests", request.id), {
      status: "approved",
      decidedBy: state.profile.uid,
      decidedAt: serverTimestamp()
    });
    await updateDoc(doc(db, "assets", request.assetId), {
      currentStatus: "disposed",
      lastModifiedBy: state.profile.uid,
      lastModifiedAt: serverTimestamp()
    });
    await logActivity(state, {
      type: "disposal_approved", assetId: request.assetId, centreId: request.centreId,
      summary: `${request.assetIdLabel}: Disposal approved — asset archived`
    });
    showToast("Disposal approved", "green");
    if (onDone) onDone();
  } catch (err) {
    console.error("[disposal] Approve failed:", err);
    showToast("Couldn't approve disposal. Check your permissions.", "red");
  }
}

export async function rejectDisposal(request, reasonNote, state, onDone) {
  try {
    await updateDoc(doc(db, "disposalRequests", request.id), {
      status: "rejected",
      decidedBy: state.profile.uid,
      decidedAt: serverTimestamp(),
      decisionNotes: reasonNote || ""
    });
    await updateDoc(doc(db, "assets", request.assetId), {
      currentStatus: "active",
      lastModifiedBy: state.profile.uid,
      lastModifiedAt: serverTimestamp()
    });
    await logActivity(state, {
      type: "disposal_rejected", assetId: request.assetId, centreId: request.centreId,
      summary: `${request.assetIdLabel}: Disposal rejected — returned to Active${reasonNote ? ` (${reasonNote})` : ""}`
    });
    showToast("Disposal rejected — asset returned to Active", "blue");
    if (onDone) onDone();
  } catch (err) {
    console.error("[disposal] Reject failed:", err);
    showToast("Couldn't reject disposal. Check your permissions.", "red");
  }
}

export function openRejectDisposalModal(request, state, onDone) {
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Reject Disposal"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, "×")]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Reason (optional)"), el("textarea", { class: "field-input", id: "rej_notes" })])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        e.target.disabled = true;
        await rejectDisposal(request, document.getElementById("rej_notes").value.trim(), state, onDone);
        overlay.remove();
      } }, "Reject")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/** Renders the full Disposal Requests queue — reachable from nav or the bell. */
export async function renderDisposalRequestsPage(container, state) {
  container.innerHTML = "<div style=\"padding:20px;color:var(--text-faint);font-size:12.5px;\">Loading…</div>";
  const requests = await listDisposalRequests(state);
  container.innerHTML = "";

  if (!requests.length) {
    const { renderEmptyState } = await import("./utils.js");
    renderEmptyState(container, {
      title: "No disposal requests",
      subtitle: "Requests submitted from an Asset Profile will appear here."
    });
    return;
  }

  const isOwner = state.profile.role === "owner";
  requests.forEach((r) => {
    const statusColor = r.status === "pending" ? "amber" : r.status === "approved" ? "red" : "blue";
    const card = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:10px;" }, [
      el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;" }, [
        el("div", {}, [
          el("div", { style: "font-size:13px;font-weight:700;" }, r.assetIdLabel),
          el("div", { style: "font-size:11.5px;color:var(--text-dim);margin-top:2px;" }, r.reason),
          r.notes ? el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-top:2px;" }, r.notes) : null,
          el("div", { style: "font-size:11px;color:var(--text-faint);margin-top:6px;" },
            `Requested by ${r.requestedByName} on ${formatDate(r.requestedAt?.toDate ? r.requestedAt.toDate() : r.requestedAt)}`)
        ].filter(Boolean)),
        el("span", { class: `badge badge-${statusColor}` }, [el("span", { class: "badge-dot" }), r.status[0].toUpperCase() + r.status.slice(1)])
      ]),
      r.status === "pending" && isOwner
        ? el("div", { style: "display:flex;gap:6px;margin-top:10px;" }, [
            el("button", { class: "btn btn-primary btn-sm", onclick: async () => { await approveDisposal(r, state, () => renderDisposalRequestsPage(container, state)); } }, "Approve"),
            el("button", { class: "btn btn-secondary btn-sm", onclick: () => openRejectDisposalModal(r, state, () => renderDisposalRequestsPage(container, state)) }, "Reject")
          ])
        : null
    ].filter(Boolean));
    container.appendChild(card);
  });
}
