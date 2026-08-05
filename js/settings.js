// =============================================================================
// Inventory OS — Settings
// Milestone 5: Owner-only "Export Full Snapshot" is the Backup half of
// Backup/Restore — a downloadable JSON dump of every collection, meant as an
// external safety net. Restore is deliberately not built (see the Milestone
// 5 pre-build summary): nothing in Inventory OS ever hard-deletes data, so a
// blanket database-overwrite tool would be a bigger risk than the problem it
// solves. If a real recovery scenario ever comes up, it should be scoped
// narrowly against that scenario rather than built speculatively now.
// =============================================================================

import { db } from "./firebase.js";
import { collection, addDoc, updateDoc, doc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast } from "./utils.js";
import { downloadJSON } from "./csv.js";
import { invalidateRoomsCache } from "./refcache.js";

const BACKUP_COLLECTIONS = [
  "centres", "rooms", "assetTypes", "assetMasters", "vendors", "assets",
  "repairs", "audits", "auditFlags", "disposalRequests", "counters",
  "activities", "users", "settings", "system"
];

export async function renderSettingsPage(container, state) {
  container.innerHTML = "";
  const isOwner = state.profile.role === "owner";

  container.appendChild(el("div", { style: "font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px;" }, "Settings"));

  const account = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:14px;" }, [
    el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:10px;" }, "Your Account"),
    detailRow("Name", state.profile.displayName || "—"),
    detailRow("Email", state.profile.email),
    detailRow("Role", state.profile.role === "owner" ? "Owner" : state.profile.role === "centre_admin" ? "Centre Admin" : "Viewer")
  ]);
  container.appendChild(account);

  if (!isOwner) return;

  const roomsCard = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:14px;" });
  container.appendChild(roomsCard);
  await renderRoomsCard(roomsCard, state);

  const backupCard = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;" }, [
    el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px;" }, "Data Backup"),
    el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-bottom:12px;" },
      "Downloads every collection as one JSON file — a safety net you can store externally. Inventory OS never deletes data on its own, so this exists purely as an extra precaution, not a routine requirement."),
    el("button", { class: "btn btn-primary btn-sm", id: "exportSnapshotBtn" }, "Export Full Snapshot")
  ]);
  container.appendChild(backupCard);

  document.getElementById("exportSnapshotBtn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Exporting…";
    try {
      const snapshot = {};
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        snapshot[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      downloadJSON(`inventory-os-backup-${new Date().toISOString().slice(0, 10)}`, snapshot);
      showToast("Backup exported", "green");
    } catch (err) {
      console.error("[settings] Backup export failed:", err);
      showToast("Couldn't export backup. Check your permissions.", "red");
    }
    e.target.disabled = false;
    e.target.textContent = "Export Full Snapshot";
  });
}

// ---------------------------------------------------------------------------
// Rooms — Owner-managed reference data. Every centre needs at least one
// room configured before assets can be added there (Add Asset requires
// picking a Room), and previously the only way to create one was a one-time
// seed script — new centres like Alwarpet and Thoraipakkam had no path to
// get rooms configured at all. Room Code is the short segment used in every
// Asset ID generated for that room (e.g. "OFF", "GTR") — keep it short.
// ---------------------------------------------------------------------------
async function renderRoomsCard(card, state) {
  card.innerHTML = "";
  card.appendChild(el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px;" }, "Rooms"));
  card.appendChild(el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-bottom:12px;" },
    "Every centre needs at least one room before assets can be added there. Room Code is the short segment used in that room's Asset IDs (e.g. \"OFF\", \"GTR\") — pick something short and won't need to change."));

  const centreSelect = el("select", { class: "field-input", style: "max-width:280px;" },
    state.centres.map((c) => new Option(c.name, c.id)));
  card.appendChild(el("div", { class: "field-group", style: "max-width:280px;" }, [
    el("div", { class: "field-label" }, "Centre"),
    centreSelect
  ]));

  const listWrap = el("div", { style: "margin-top:10px;" });
  card.appendChild(listWrap);

  const addBtn = el("button", { class: "btn btn-secondary btn-sm", style: "margin-top:10px;" }, "+ Add Room");
  card.appendChild(addBtn);

  async function loadRooms() {
    listWrap.innerHTML = "<div style=\"font-size:12px;color:var(--text-faint);padding:8px 0;\">Loading…</div>";
    const snap = await getDocs(query(collection(db, "rooms"), where("centreId", "==", centreSelect.value)));
    const rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listWrap.innerHTML = "";
    if (!rooms.length) {
      listWrap.appendChild(el("div", { style: "font-size:12px;color:var(--text-faint);padding:8px 0;" },
        "No rooms configured for this centre yet — add one below before registering assets here."));
      return;
    }
    rooms.forEach((r) => {
      listWrap.appendChild(el("div", {
        style: "display:flex;justify-content:space-between;align-items:center;background:var(--bg-input);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:6px;"
      }, [
        el("div", {}, [
          el("span", { style: "font-size:12.5px;font-weight:600;color:var(--text);" }, r.name),
          el("span", { style: "font-size:11px;color:var(--text-faint);margin-left:8px;" }, r.code)
        ]),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openRoomFormModal(r, state, centreSelect.value, loadRooms) }, "Edit")
      ]));
    });
  }

  centreSelect.addEventListener("change", loadRooms);
  addBtn.addEventListener("click", () => openRoomFormModal(null, state, centreSelect.value, loadRooms));

  await loadRooms();
}

function openRoomFormModal(existing, state, centreId, onDone) {
  const isEdit = !!existing;
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const nameInput = el("input", { class: "field-input", type: "text", value: existing?.name || "" });
  const codeInput = el("input", { class: "field-input", type: "text", value: existing?.code || "", style: "text-transform:uppercase;" });

  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, isEdit ? "Edit Room" : "Add Room"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, "×")]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Room Name"), nameInput]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Room Code (used in Asset IDs)"), codeInput]),
      isEdit ? el("div", { style: "font-size:11.5px;color:var(--text-faint);" },
        "Changing the code only affects new Asset IDs from now on — existing assets in this room keep their current IDs until individually transferred.") : null
    ].filter(Boolean)),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        const name = nameInput.value.trim();
        const code = codeInput.value.trim().toUpperCase();
        if (!name) { showToast("Room Name is required", "red"); return; }
        if (!code) { showToast("Room Code is required", "red"); return; }
        e.target.disabled = true;
        try {
          if (isEdit) {
            await updateDoc(doc(db, "rooms", existing.id), { name, code });
          } else {
            await addDoc(collection(db, "rooms"), { centreId, name, code });
          }
          invalidateRoomsCache(centreId);
          showToast(isEdit ? "Room updated" : "Room added", "green");
          overlay.remove();
          if (onDone) onDone();
        } catch (err) {
          console.error("[settings] Failed to save room:", err);
          showToast("Couldn't save room. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, isEdit ? "Save" : "Add")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function detailRow(label, value) {
  return el("div", { style: "display:flex;justify-content:space-between;padding:5px 0;font-size:12px;" }, [
    el("span", { style: "color:var(--text-faint);" }, label),
    el("span", { style: "color:var(--text-dim);" }, value || "—")
  ]);
}
