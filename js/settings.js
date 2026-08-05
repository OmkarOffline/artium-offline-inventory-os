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
import { collection, addDoc, updateDoc, doc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, roomDisplayName, roomNeedsTeacher } from "./utils.js";
import { downloadJSON } from "./csv.js";
import { invalidateRoomsCache } from "./refcache.js";
import { logActivity } from "./activity.js";
import { listStaff, listActiveStaff, courseCodesLabel } from "./staff.js";
import { listAssetTypes, createAssetType, updateAssetType, countAssetMastersUsingType } from "./assetMaster.js";
import { CLOSE_ICON } from "./icons.js";

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

  const assetTypesCard = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:14px;" });
  container.appendChild(assetTypesCard);
  await renderAssetTypesCard(assetTypesCard, state);

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
    const [snap, staff] = await Promise.all([
      getDocs(query(collection(db, "rooms"), where("centreId", "==", centreSelect.value))),
      listStaff(centreSelect.value)
    ]);
    const rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const staffByName = Object.fromEntries(staff.map((s) => [s.name, s]));
    listWrap.innerHTML = "";
    if (!rooms.length) {
      listWrap.appendChild(el("div", { style: "font-size:12px;color:var(--text-faint);padding:8px 0;" },
        "No rooms configured for this centre yet — add one below before registering assets here."));
      return;
    }
    rooms.forEach((r) => {
      const teacher = r.defaultCustodian ? staffByName[r.defaultCustodian] : null;
      const courseBadge = teacher?.designation === "Teacher" ? courseCodesLabel(teacher.courses) : "";
      listWrap.appendChild(el("div", {
        style: "display:flex;justify-content:space-between;align-items:center;background:var(--bg-input);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:6px;"
      }, [
        el("div", {}, [
          el("div", {}, [
            el("span", { style: "font-size:12.5px;font-weight:600;color:var(--text);" }, roomDisplayName(r.name)),
            el("span", { style: "font-size:11px;color:var(--text-faint);margin-left:8px;" }, r.code)
          ]),
          el("div", { style: "font-size:11px;color:var(--text-faint);margin-top:2px;" },
            r.defaultCustodian
              ? `Assigned teacher: ${r.defaultCustodian}${courseBadge ? ` (${courseBadge})` : ""}`
              : (roomNeedsTeacher(r.name) ? "No teacher assigned" : "Not a teaching room"))
        ]),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openRoomFormModal(r, state, centreSelect.value, loadRooms) }, "Edit")
      ]));
    });
  }

  centreSelect.addEventListener("change", loadRooms);
  addBtn.addEventListener("click", () => openRoomFormModal(null, state, centreSelect.value, loadRooms));

  await loadRooms();
}

async function openRoomFormModal(existing, state, centreId, onDone) {
  const isEdit = !!existing;
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const nameInput = el("input", { class: "field-input", type: "text", value: existing?.name || "" });
  const codeInput = el("input", { class: "field-input", type: "text", value: existing?.code || "", style: "text-transform:uppercase;" });

  const activeStaff = await listActiveStaff(centreId);
  const currentName = existing?.defaultCustodian || "";
  // A previously-assigned teacher who's since gone inactive (or been
  // renamed) shouldn't silently vanish from the dropdown and get wiped out
  // the next time this room is saved — keep them selectable, just flagged.
  const staffNames = new Set(activeStaff.map((s) => s.name));
  const teacherSelect = el("select", { class: "field-input" }, [
    new Option("No teacher assigned", ""),
    ...activeStaff.map((s) => {
      const courseBadge = s.designation === "Teacher" ? courseCodesLabel(s.courses) : "";
      const label = `${s.name} — ${s.designation}${courseBadge ? ` (${courseBadge})` : ""}`;
      return new Option(label, s.name);
    }),
    (currentName && !staffNames.has(currentName)) ? new Option(`${currentName} (not active staff)`, currentName) : null
  ].filter(Boolean));
  teacherSelect.value = currentName;

  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, isEdit ? "Edit Room" : "Add Room"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Room Name"), nameInput]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Room Code (used in Asset IDs)"), codeInput]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Assigned Teacher (optional)"), teacherSelect]),
      activeStaff.length ? null : el("div", { style: "font-size:11.5px;color:var(--text-faint);" },
        "No active staff found for this centre yet — add them in Staff Directory first, then come back here to assign one."),
      el("div", { style: "font-size:11.5px;color:var(--text-faint);" },
        "New assets added to this room will have their Custodian pre-filled with this teacher's name automatically."
        + (isEdit ? " Changing this also updates every existing asset currently in this room to this teacher — a one-time bulk reassignment, not a permanent link." : "")),
      isEdit ? el("div", { style: "font-size:11.5px;color:var(--text-faint);" },
        "Changing the Room Code only affects new Asset IDs from now on — existing assets in this room keep their current IDs until individually transferred.") : null
    ].filter(Boolean)),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        const name = nameInput.value.trim();
        const code = codeInput.value.trim().toUpperCase();
        const defaultCustodian = teacherSelect.value;
        if (!name) { showToast("Room Name is required", "red"); return; }
        if (!code) { showToast("Room Code is required", "red"); return; }

        const teacherChanged = isEdit && defaultCustodian !== (existing.defaultCustodian || "");
        if (teacherChanged && defaultCustodian) {
          const ok = window.confirm(
            `This will reassign every existing asset currently in "${name}" to "${defaultCustodian}" as their Custodian. Continue?`
          );
          if (!ok) return;
        }

        e.target.disabled = true;
        try {
          if (isEdit) {
            await updateDoc(doc(db, "rooms", existing.id), { name, code, defaultCustodian });
            if (teacherChanged && defaultCustodian) {
              await reassignRoomAssetsToTeacher(existing.id, centreId, defaultCustodian, state);
            }
          } else {
            await addDoc(collection(db, "rooms"), { centreId, name, code, defaultCustodian });
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

/**
 * Retroactively assigns every non-disposed asset currently in a room to
 * that room's newly-set default teacher — the "already created assets
 * should get assigned too" half of the feature. Logs one custodian_changed
 * activity per affected asset so it shows correctly in that asset's own
 * Assignment History, same as a manual Change Custodian action would.
 */
async function reassignRoomAssetsToTeacher(roomId, centreId, teacherName, state) {
  const snap = await getDocs(query(collection(db, "assets"), where("roomId", "==", roomId)));
  const assets = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.currentStatus !== "disposed" && a.currentCustodian !== teacherName);

  for (const asset of assets) {
    const oldCustodian = asset.currentCustodian || "—";
    await updateDoc(doc(db, "assets", asset.id), {
      currentCustodian: teacherName,
      lastModifiedBy: state.profile.uid,
      lastModifiedAt: serverTimestamp()
    });
    await logActivity(state, {
      type: "custodian_changed", assetId: asset.id, centreId,
      summary: `${asset.assetId}: Custodian: ${oldCustodian} → ${teacherName} (room's assigned teacher)`
    });
  }
}

// ---------------------------------------------------------------------------
// Asset Types — the code/name registry (e.g. "PHN" → Smartphone) used to
// build every Asset ID. Previously this could only be created inline while
// adding an Asset Master, with no way to fix a code afterwards — the "CAP
// instead of PHN" mixup had no cleanup path at the registry level. Note the
// Code is the Firestore document id, so a code change under the hood creates
// a fresh /assetTypes doc and removes the old one — it does not retroactively
// touch any Asset Master or Asset that already copied the old code (same
// "history stays accurate" rule used everywhere else; see updateAssetType).
// ---------------------------------------------------------------------------
async function renderAssetTypesCard(card, state) {
  card.innerHTML = "";
  card.appendChild(el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px;" }, "Asset Types"));
  card.appendChild(el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-bottom:12px;" },
    "The code/name catalogue used to build Asset IDs (e.g. \"PHN\" for Smartphone). Editing a Code here only affects new Asset IDs going forward — Asset Masters or assets already using the old code keep it until edited individually (Edit Asset Master / Correct Asset Type)."));

  const listWrap = el("div", {});
  card.appendChild(listWrap);

  const addBtn = el("button", { class: "btn btn-secondary btn-sm", style: "margin-top:10px;" }, "+ Add Asset Type");
  card.appendChild(addBtn);
  addBtn.addEventListener("click", () => openAssetTypeFormModal(null, loadTypes));

  async function loadTypes() {
    listWrap.innerHTML = "<div style=\"font-size:12px;color:var(--text-faint);padding:8px 0;\">Loading…</div>";
    const types = await listAssetTypes();
    listWrap.innerHTML = "";
    if (!types.length) {
      listWrap.appendChild(el("div", { style: "font-size:12px;color:var(--text-faint);padding:8px 0;" }, "No asset types yet."));
      return;
    }
    types.forEach((t) => {
      listWrap.appendChild(el("div", {
        style: "display:flex;justify-content:space-between;align-items:center;background:var(--bg-input);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:6px;"
      }, [
        el("div", {}, [
          el("span", { style: "font-size:12.5px;font-weight:700;color:var(--accent);" }, t.code),
          el("span", { style: "font-size:12.5px;color:var(--text);margin-left:8px;" }, t.name)
        ]),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => openAssetTypeFormModal(t, loadTypes) }, "Edit")
      ]));
    });
  }

  await loadTypes();
}

async function openAssetTypeFormModal(existing, onDone) {
  const isEdit = !!existing;
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const nameInput = el("input", { class: "field-input", type: "text", value: existing?.name || "" });
  const codeInput = el("input", { class: "field-input", type: "text", value: existing?.code || "", style: "text-transform:uppercase;" });

  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, isEdit ? "Edit Asset Type" : "Add Asset Type"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Type Name"), nameInput]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Code (used in Asset IDs)"), codeInput]),
      isEdit ? el("div", { style: "font-size:11.5px;color:var(--text-faint);" },
        "Changing the Code only affects new Asset IDs from now on. Existing Asset Masters and assets that already used the old code keep it until you edit them individually.") : null
    ].filter(Boolean)),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        const name = nameInput.value.trim();
        const code = codeInput.value.trim().toUpperCase();
        if (!name) { showToast("Type Name is required", "red"); return; }
        if (!code) { showToast("Code is required", "red"); return; }

        e.target.disabled = true;
        try {
          if (isEdit) {
            const codeChanged = code !== existing.code;
            if (codeChanged) {
              const types = await listAssetTypes();
              if (types.some((t) => t.code === code)) {
                showToast(`Code "${code}" is already used by another type`, "red");
                e.target.disabled = false;
                return;
              }
              const usageCount = await countAssetMastersUsingType(existing.code);
              if (usageCount > 0) {
                const ok = window.confirm(
                  `${usageCount} Asset Master${usageCount === 1 ? "" : "s"} currently use${usageCount === 1 ? "s" : ""} the code "${existing.code}". They will keep showing "${existing.code}" until edited individually — this only changes the registry entry and future Asset IDs. Continue?`
                );
                if (!ok) { e.target.disabled = false; return; }
              }
            }
            await updateAssetType(existing.code, { code, name });
          } else {
            const types = await listAssetTypes();
            if (types.some((t) => t.code === code)) {
              showToast(`Code "${code}" already exists`, "red");
              e.target.disabled = false;
              return;
            }
            await createAssetType(code, name);
          }
          showToast(isEdit ? "Asset Type updated" : "Asset Type added", "green");
          overlay.remove();
          if (onDone) onDone();
        } catch (err) {
          console.error("[settings] Failed to save asset type:", err);
          showToast("Couldn't save asset type. Check your permissions.", "red");
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
