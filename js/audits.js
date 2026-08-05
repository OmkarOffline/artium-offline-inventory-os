// =============================================================================
// Inventory OS — Audit Module
// Chapter 7/11: an Owner walks a room, confirms every active asset expected
// there is Present, Missing or Damaged, and submits one immutable /audits
// record. Missing/Damaged findings each get their own /auditFlags record —
// that's what surfaces "notify the Owners" in the notification bell. Audits
// report facts only; they never auto-create a Repair or Disposal request —
// that follow-up is always a deliberate, separate action from the Asset
// Profile.
// =============================================================================

import { db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, formatDateTime, renderEmptyState, roomDisplayName } from "./utils.js";
import { logActivity } from "./activity.js";

export async function listAudits(centreId) {
  const snap = await getDocs(query(collection(db, "audits"), where("centreId", "==", centreId), orderBy("completedAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listAuditFlagsForAsset(assetId) {
  const snap = await getDocs(query(collection(db, "auditFlags"), where("assetId", "==", assetId)));
  const flags = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  flags.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return flags;
}

/** Every unacknowledged Missing/Damaged flag an Owner can see — powers the bell. */
export async function listUnacknowledgedFlags(state) {
  if (state.profile.role !== "owner") return [];
  const snap = await getDocs(query(collection(db, "auditFlags"), where("acknowledged", "==", false)));
  const flags = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  flags.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return flags;
}

export async function acknowledgeFlag(flagId, state) {
  await updateDoc(doc(db, "auditFlags", flagId), {
    acknowledged: true,
    acknowledgedBy: state.profile.uid,
    acknowledgedAt: serverTimestamp()
  });
}

export function openStartAuditModal(state, onDone) {
  if (!state.activeCentreId) { showToast("Select a centre first", "amber"); return; }

  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const roomSelect = el("select", { class: "field-input", id: "aud_room" });
  const bodyWrap = el("div", { class: "modal-body", id: "aud_body" }, [
    el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Room"), roomSelect]),
    el("div", { id: "aud_checklist" })
  ]);

  const modal = el("div", { class: "modal", style: "max-width:560px;" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Start Audit"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, "×")]),
    bodyWrap,
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", id: "aud_submit" }, "Submit Audit")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let rooms = [];
  let assets = [];

  async function loadRooms() {
    const snap = await getDocs(query(collection(db, "rooms"), where("centreId", "==", state.activeCentreId)));
    rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    roomSelect.innerHTML = "";
    if (!rooms.length) { roomSelect.appendChild(new Option("No rooms configured", "")); return; }
    rooms.forEach((r) => roomSelect.appendChild(new Option(roomDisplayName(r.name), r.id)));
    await loadChecklist();
  }

  async function loadChecklist() {
    const checklist = document.getElementById("aud_checklist");
    checklist.innerHTML = "<div style=\"padding:10px 0;color:var(--text-faint);font-size:12px;\">Loading assets…</div>";
    const roomId = roomSelect.value;
    if (!roomId) { checklist.innerHTML = ""; assets = []; return; }

    const snap = await getDocs(query(
      collection(db, "assets"),
      where("roomId", "==", roomId),
      where("currentStatus", "==", "active")
    ));
    assets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    checklist.innerHTML = "";
    if (!assets.length) {
      checklist.appendChild(el("div", { style: "font-size:12px;color:var(--text-faint);padding:8px 0;" }, "No active assets expected in this room."));
      return;
    }
    assets.forEach((a) => {
      checklist.appendChild(el("div", { style: "border-bottom:1px solid var(--border-soft);padding:8px 0;" }, [
        el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;" }, [
          el("div", {}, [
            el("div", { style: "font-size:12.5px;font-weight:700;" }, a.assetName),
            el("div", { style: "font-size:11px;color:var(--text-faint);" }, a.assetId)
          ]),
          el("select", { class: "field-input", style: "width:auto;", id: `aud_status_${a.id}` }, [
            new Option("Present", "verified"),
            new Option("Missing", "missing"),
            new Option("Damaged", "damaged")
          ])
        ]),
        el("input", { class: "field-input", style: "margin-top:6px;", placeholder: "Notes (optional)", id: `aud_notes_${a.id}` })
      ]));
    });
  }

  roomSelect.addEventListener("change", loadChecklist);
  loadRooms();

  document.getElementById("aud_submit").addEventListener("click", async (e) => {
    if (!assets.length) { showToast("Nothing to audit in this room.", "amber"); return; }
    const room = rooms.find((r) => r.id === roomSelect.value);
    e.target.disabled = true;
    try {
      const items = assets.map((a) => ({
        assetId: a.id,
        assetIdLabel: a.assetId,
        assetName: a.assetName,
        status: document.getElementById(`aud_status_${a.id}`).value,
        notes: document.getElementById(`aud_notes_${a.id}`).value.trim()
      }));
      const presentCount = items.filter((i) => i.status === "verified").length;
      const missingCount = items.filter((i) => i.status === "missing").length;
      const damagedCount = items.filter((i) => i.status === "damaged").length;

      const auditRef = await addDoc(collection(db, "audits"), {
        centreId: state.activeCentreId,
        roomId: room.id,
        roomName: roomDisplayName(room.name),
        conductedBy: state.profile.uid,
        conductedByName: state.profile.displayName || state.profile.email,
        status: "completed",
        items,
        presentCount, missingCount, damagedCount,
        completedAt: serverTimestamp()
      });

      // One flag per Missing/Damaged finding — this is what notifies the Owners.
      for (const item of items) {
        if (item.status !== "missing" && item.status !== "damaged") continue;
        await addDoc(collection(db, "auditFlags"), {
          auditId: auditRef.id,
          assetId: item.assetId,
          assetIdLabel: item.assetIdLabel,
          assetName: item.assetName,
          roomId: room.id,
          roomName: roomDisplayName(room.name),
          centreId: state.activeCentreId,
          status: item.status,
          notes: item.notes,
          createdBy: state.profile.uid,
          createdByName: state.profile.displayName || state.profile.email,
          createdAt: serverTimestamp(),
          acknowledged: false,
          acknowledgedBy: null,
          acknowledgedAt: null
        });
      }

      await logActivity(state, {
        type: "audit_completed", centreId: state.activeCentreId,
        summary: `Audit completed — ${room.name}: ${presentCount} present, ${missingCount} missing, ${damagedCount} damaged`
      });

      const flaggedCount = missingCount + damagedCount;
      showToast(
        flaggedCount ? `Audit submitted — ${flaggedCount} item(s) flagged for Owners` : "Audit submitted — all present",
        flaggedCount ? "amber" : "green"
      );
      overlay.remove();
      if (onDone) onDone();
    } catch (err) {
      console.error("[audits] Submit failed:", err);
      showToast("Couldn't submit audit. Check your permissions.", "red");
      e.target.disabled = false;
    }
  });
}

export async function renderAuditsPage(container, state) {
  container.innerHTML = "";
  const isOwner = state.profile.role === "owner";

  const header = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;" }, [
    el("div", { style: "font-size:13px;font-weight:700;color:var(--text);" }, "Audits"),
    isOwner ? el("button", { class: "btn btn-primary btn-sm", onclick: () => openStartAuditModal(state, () => renderAuditsPage(container, state)) }, "+ Start Audit") : null
  ].filter(Boolean));
  container.appendChild(header);

  if (!state.activeCentreId) {
    renderEmptyState(container, { title: "No centre selected", subtitle: "Assign yourself a centre before audits can be shown here." });
    return;
  }

  const listWrap = el("div", {});
  container.appendChild(listWrap);

  let audits;
  try {
    audits = await listAudits(state.activeCentreId);
  } catch (err) {
    console.error("[audits] Failed to load audits:", err);
    renderEmptyState(listWrap, {
      title: "Couldn't load audits",
      subtitle: "This can happen the first time this query runs — check the browser console for a Firestore \"create index\" link and click it."
    });
    return;
  }

  if (!audits.length) {
    renderEmptyState(listWrap, {
      title: "No audits recorded yet",
      subtitle: isOwner ? "Start an audit to check a room's assets against the Register." : "Only Owners can conduct audits."
    });
    return;
  }

  audits.forEach((a) => {
    listWrap.appendChild(el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:10px;" }, [
      el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;" }, [
        el("div", {}, [
          el("div", { style: "font-size:13px;font-weight:700;" }, a.roomName),
          el("div", { style: "font-size:11px;color:var(--text-faint);margin-top:2px;" },
            `Conducted by ${a.conductedByName} · ${formatDateTime(a.completedAt)}`)
        ]),
        el("div", { style: "display:flex;gap:6px;" }, [
          statChip(a.presentCount, "green", "Present"),
          statChip(a.missingCount, "red", "Missing"),
          statChip(a.damagedCount, "amber", "Damaged")
        ])
      ])
    ]));
  });
}

function statChip(count, color, label) {
  if (!count) return null;
  return el("span", { class: `badge badge-${color}` }, [el("span", { class: "badge-dot" }), `${count} ${label}`]);
}
