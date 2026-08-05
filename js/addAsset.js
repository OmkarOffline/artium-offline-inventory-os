// =============================================================================
// Inventory OS — Add Asset workflow & Asset ID generation
// Implements Chapter 4/5 exactly: Centre -> Room -> Asset Master (or Copy
// From Existing) -> auto-populate -> minimal manual entry -> system
// generates Internal Asset Number + Asset ID -> save. Users never type an
// identifier themselves.
// =============================================================================

import { db } from "./firebase.js";
import {
  collection, doc, addDoc, getDoc, getDocs, query, where,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, roomDisplayName } from "./utils.js";
import { listAssetMasters, listAssetTypes, createAssetType, createAssetMaster, updateAssetMaster, ASSET_CATEGORIES } from "./assetMaster.js";
import { listVendors, openVendorModal } from "./vendors.js";
import { logActivity } from "./activity.js";
import { CLOSE_ICON } from "./icons.js";

/**
 * Atomically allocate the next sequence number for a Centre + Asset Type
 * combination (Chapter 4: serials are independent per Centre+Type, NOT per
 * Room). A transaction prevents two simultaneous Add Asset submissions from
 * colliding on the same number.
 */
export async function nextSequence(centreId, assetTypeCode) {
  const counterId = `${centreId}_${assetTypeCode}`;
  const counterRef = doc(db, "counters", counterId);
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const last = snap.exists() ? (snap.data().lastSeq || 0) : 0;
    const next = last + 1;
    tx.set(counterRef, { centreId, assetTypeCode, lastSeq: next }, { merge: true });
    return next;
  });
  return String(seq).padStart(4, "0");
}

export function buildAssetId(centreId, roomCode, assetTypeCode, seqStr) {
  return `${centreId}-${roomCode}-${assetTypeCode}-${seqStr}`;
}

export function openAddAssetModal(state, onSaved) {
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const modal = el("div", { class: "modal", style: "width:560px;" });

  let rooms = [];
  let assetMasters = [];
  let assetTypes = [];
  let vendors = [];
  let selectedMaster = null;
  let copiedFields = {};
  // True until the user manually types into Custodian — lets the room's
  // assigned teacher keep auto-filling as they change rooms, but backs off
  // the moment they've deliberately typed something themselves.
  let custodianAutoFilled = true;

  const centreOptions = (state.profile.role === "owner")
    ? state.centres
    : state.centres.filter((c) => state.profile.assignedCentres?.includes(c.id));

  modal.appendChild(el("div", { class: "modal-header" }, [
    el("h2", {}, "Add Asset"),
    el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])
  ]));

  const body = el("div", { class: "modal-body" });
  modal.appendChild(body);

  const footer = el("div", { class: "modal-footer" }, [
    el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
    el("button", { class: "btn btn-primary", id: "addAssetSaveBtn" }, "Save")
  ]);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  build();

  async function build() {
    body.innerHTML = "<div>Loading…</div>";
    [assetMasters, assetTypes, vendors] = await Promise.all([listAssetMasters(), listAssetTypes(), listVendors()]);
    body.innerHTML = "";

    body.appendChild(field("Centre", selectEl("f_centre", centreOptions.map((c) => ({ value: c.id, label: c.name })), state.activeCentreId)));
    body.appendChild(field("Room", selectEl("f_room", [], null, "Select a centre first")));
    body.appendChild(assetMasterField());
    body.appendChild(el("div", { id: "masterInfo" }));
    body.appendChild(el("div", { id: "copyFromSection" }));

    const manualSection = el("div", { id: "manualFields", class: "hidden" }, manualFieldsMarkup());
    body.appendChild(manualSection);

    document.getElementById("f_centre").addEventListener("change", onCentreChange);
    document.getElementById("f_room").addEventListener("change", applyRoomDefaultCustodian);
    document.getElementById("f_custodian").addEventListener("input", () => { custodianAutoFilled = false; });
    document.getElementById("f_assetMaster").addEventListener("change", onMasterChange);
    document.getElementById("newAssetMasterBtn").addEventListener("click", () => openAssetMasterFormModal(null));
    document.getElementById("editAssetMasterBtn").addEventListener("click", () => {
      if (!selectedMaster) { showToast("Select an Asset Master to edit first", "red"); return; }
      openAssetMasterFormModal(selectedMaster);
    });
    document.getElementById("editAssetMasterBtn").disabled = true;
    document.getElementById("newVendorBtn").addEventListener("click", () => {
      openVendorModal(null, state, async (newVendorId) => {
        vendors = await listVendors();
        const vendorSelect = document.getElementById("f_vendor");
        vendorSelect.innerHTML = "";
        vendors.forEach((v) => vendorSelect.appendChild(new Option(v.companyName, v.id)));
        vendorSelect.value = newVendorId;
        showToast("Vendor added — selected for this asset", "green");
      });
    });

    document.getElementById("addAssetSaveBtn").addEventListener("click", handleSave);

    await onCentreChange();
  }

  function assetMasterField() {
    return el("div", { class: "field-group" }, [
      el("div", { class: "field-label" }, "Asset Master"),
      el("div", { style: "display:flex;gap:8px;" }, [
        selectEl("f_assetMaster", assetMasters.map((m) => ({ value: m.id, label: `${m.assetName}${m.brand ? " — " + m.brand : ""}` })), null, "Select an Asset Master"),
        el("button", { class: "btn btn-secondary btn-sm", id: "newAssetMasterBtn", type: "button" }, "+ New"),
        el("button", { class: "btn btn-secondary btn-sm", id: "editAssetMasterBtn", type: "button" }, "Edit")
      ])
    ]);
  }

  function manualFieldsMarkup() {
    return [
      el("div", { class: "field-row" }, [
        field("Manufacturer Serial Number", input("f_serial")),
        field("Current Custodian", input("f_custodian"))
      ]),
      el("div", { class: "field-row" }, [
        field("Purchase Date", input("f_purchaseDate", "date")),
        field("Purchase Cost (₹)", input("f_purchaseCost", "number"))
      ]),
      el("div", { class: "field-row" }, [
        el("div", { class: "field-group" }, [
          el("div", { class: "field-label" }, "Vendor"),
          el("div", { style: "display:flex;gap:6px;" }, [
            selectEl("f_vendor", vendors.map((v) => ({ value: v.id, label: v.companyName })), null, "Select vendor"),
            el("button", { class: "btn btn-secondary btn-sm", type: "button", id: "newVendorBtn" }, "+ New")
          ])
        ]),
        field("Warranty Expiry", input("f_warrantyExpiry", "date"))
      ]),
      field("Photo (link, optional)", input("f_driveLink")),
      field("Remarks", (() => { const t = document.createElement("textarea"); t.id = "f_remarks"; t.className = "field-input"; return t; })())
    ];
  }

  async function onCentreChange() {
    const centreId = document.getElementById("f_centre").value;
    const roomSnap = await getDocs(query(collection(db, "rooms"), where("centreId", "==", centreId)));
    rooms = roomSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const roomSelect = document.getElementById("f_room");
    roomSelect.innerHTML = "";
    if (!rooms.length) {
      roomSelect.appendChild(new Option("No rooms configured for this centre", ""));
      return;
    }
    rooms.forEach((r) => roomSelect.appendChild(new Option(roomDisplayName(r.name), r.id)));
    applyRoomDefaultCustodian();
  }

  /**
   * Pre-fills Custodian from the selected room's assigned teacher (set via
   * Settings → Rooms). Only ever overwrites a value it filled in itself —
   * never something the user actually typed — and only fills forward, so
   * switching rooms mid-form keeps the field in sync with whichever room is
   * currently selected.
   */
  function applyRoomDefaultCustodian() {
    if (!custodianAutoFilled) return;
    const custodianField = document.getElementById("f_custodian");
    const room = rooms.find((r) => r.id === document.getElementById("f_room").value);
    custodianField.value = room?.defaultCustodian || "";
  }

  async function onMasterChange() {
    const masterId = document.getElementById("f_assetMaster").value;
    selectedMaster = assetMasters.find((m) => m.id === masterId) || null;
    const infoEl = document.getElementById("masterInfo");
    const copyEl = document.getElementById("copyFromSection");
    const manualEl = document.getElementById("manualFields");
    document.getElementById("editAssetMasterBtn").disabled = !selectedMaster;

    if (!selectedMaster) {
      infoEl.innerHTML = "";
      copyEl.innerHTML = "";
      manualEl.classList.add("hidden");
      return;
    }

    infoEl.innerHTML = "";
    infoEl.appendChild(el("div", { style: "background:var(--bg-input);border-radius:var(--radius-sm);padding:10px 12px;font-size:12px;color:var(--text-dim);" },
      `Inherited from Asset Master: ${selectedMaster.brand || "—"} ${selectedMaster.model || ""} · ${selectedMaster.category} · Type ${selectedMaster.assetTypeCode} · Warranty ${selectedMaster.warrantyApplicable ? "applicable" : "not applicable"}`
    ));

    // Copy From Existing — scoped to the same Asset Master (Ch.4/5).
    const existingSnap = await getDocs(query(collection(db, "assets"), where("assetMasterId", "==", selectedMaster.id)));
    copyEl.innerHTML = "";
    if (!existingSnap.empty) {
      const options = [{ value: "", label: "Create New (no copy)" }].concat(
        existingSnap.docs.map((d) => ({ value: d.id, label: d.data().assetId }))
      );
      copyEl.appendChild(field("Copy From Existing (optional)", selectEl("f_copyFrom", options, "")));
      document.getElementById("f_copyFrom").addEventListener("change", async (e) => {
        if (!e.target.value) { copiedFields = {}; return; }
        const srcSnap = await getDoc(doc(db, "assets", e.target.value));
        const src = srcSnap.data();
        // Only reusable fields copy — never identity, serial, purchase date/cost,
        // room, custodian, or history (Ch.5's explicit exclusion list).
        copiedFields = { vendorId: src.vendorId, remarks: src.remarks, driveImageLink: src.driveImageLink };
        document.getElementById("f_vendor").value = src.vendorId || "";
        document.getElementById("f_remarks").value = src.remarks || "";
        document.getElementById("f_driveLink").value = src.driveImageLink || "";
        showToast("Copied reusable fields — review before saving", "blue");
      });
    }

    // Pre-fill vendor default from the Asset Master, warranty field visibility.
    if (selectedMaster.defaultVendorId) {
      document.getElementById("f_vendor").value = selectedMaster.defaultVendorId;
    }
    document.getElementById("f_warrantyExpiry").closest(".field-group").style.display =
      selectedMaster.warrantyApplicable ? "" : "none";

    manualEl.classList.remove("hidden");
  }

  /**
   * Same form for creating a new Asset Master and correcting an existing
   * one (e.g. it was saved with the wrong Asset Type, which previously had
   * no fix short of a support request — see feedback that led to this).
   * Pass an existing Master to edit it in place; pass null to create new.
   */
  function openAssetMasterFormModal(existing) {
    const isEdit = !!existing;
    const innerOverlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
    const typeSelectId = "nm_assetType";
    const inner = el("div", { class: "modal" }, [
      el("div", { class: "modal-header" }, [el("h2", {}, isEdit ? "Edit Asset Master" : "New Asset Master"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => innerOverlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
      el("div", { class: "modal-body" }, [
        field("Asset Name", input("nm_assetName")),
        el("div", { class: "field-row" }, [
          field("Category", selectEl("nm_category", ASSET_CATEGORIES.map((c) => ({ value: c, label: c })))),
          field("Asset Type", (() => {
            const wrap = el("div", { style: "display:flex;gap:6px;" }, [
              selectEl(typeSelectId, assetTypes.map((t) => ({ value: t.code, label: `${t.code} — ${t.name}` })), null, "Select a type"),
              el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: async () => {
                const code = window.prompt("New Asset Type code (e.g. AMP):");
                if (!code) return;
                const name = window.prompt("Name for this type (e.g. Amplifier):", code);
                if (!name) return;
                const created = await createAssetType(code, name);
                assetTypes.push(created);
                const sel = document.getElementById(typeSelectId);
                sel.appendChild(new Option(`${created.code} — ${created.name}`, created.code));
                sel.value = created.code;
              } }, "+ New Type")
            ]);
            return wrap;
          })())
        ]),
        el("div", { class: "field-row" }, [field("Brand", input("nm_brand")), field("Model", input("nm_model"))]),
        el("label", { style: "display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-dim);" }, [
          el("input", { type: "checkbox", id: "nm_warrantyApplicable" }), "Warranty applicable"
        ]),
        field("Default Vendor (optional)", selectEl("nm_defaultVendor", [{ value: "", label: "None" }].concat(vendors.map((v) => ({ value: v.id, label: v.companyName }))))),
        field("Standard Image (link, optional)", input("nm_driveImageLink")),
        field("Description / Remarks", (() => { const t = document.createElement("textarea"); t.id = "nm_description"; t.className = "field-input"; return t; })()),
        isEdit ? el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-top:2px;" },
          "Changing the Asset Type here only affects future assets created from this Master — Asset IDs already generated (like ones using the wrong code) don't get renamed automatically. Correct those individually via Room/Centre history if needed, or contact your Owner.") : null
      ].filter(Boolean)),
      el("div", { class: "modal-footer" }, [
        el("button", { class: "btn btn-ghost", onclick: () => innerOverlay.remove() }, "Cancel"),
        el("button", { class: "btn btn-primary", onclick: async (e) => {
          const name = document.getElementById("nm_assetName").value.trim();
          if (!name) { showToast("Asset Name is required", "red"); return; }
          const assetTypeCode = document.getElementById(typeSelectId).value;
          if (!assetTypeCode) { showToast("Select an Asset Type — this sets the code used in every Asset ID for this master", "red"); return; }
          e.target.disabled = true;
          const masterData = {
            assetName: name,
            category: document.getElementById("nm_category").value,
            assetTypeCode,
            brand: document.getElementById("nm_brand").value,
            model: document.getElementById("nm_model").value,
            warrantyApplicable: document.getElementById("nm_warrantyApplicable").checked,
            defaultVendorId: document.getElementById("nm_defaultVendor").value || null,
            driveImageLink: document.getElementById("nm_driveImageLink").value,
            description: document.getElementById("nm_description").value
          };
          try {
            if (isEdit) {
              await updateAssetMaster(existing.id, masterData);
              const updated = { id: existing.id, ...masterData };
              const idx = assetMasters.findIndex((m) => m.id === existing.id);
              if (idx !== -1) assetMasters[idx] = updated;
              const masterSelect = document.getElementById("f_assetMaster");
              const opt = Array.from(masterSelect.options).find((o) => o.value === existing.id);
              if (opt) opt.textContent = `${name}${masterData.brand ? " — " + masterData.brand : ""}`;
              if (selectedMaster?.id === existing.id) { selectedMaster = updated; await onMasterChange(); }
              showToast("Asset Master updated", "green");
            } else {
              const id = await createAssetMaster(masterData, state.profile);
              // Keep the full record locally (not just id/name) — this is what
              // selectedMaster reads from immediately after creation, and every
              // field on it (brand, type, warranty...) feeds directly into the
              // asset being saved. Missing fields here previously became
              // `undefined` values, which Firestore's SDK silently rejects.
              const newMaster = { id, ...masterData };
              assetMasters.push(newMaster);
              const masterSelect = document.getElementById("f_assetMaster");
              masterSelect.appendChild(new Option(name, id));
              masterSelect.value = id;
              await onMasterChange();
              showToast("Asset Master created", "green");
            }
            innerOverlay.remove();
          } catch (err) {
            console.error(`[addAsset] Failed to ${isEdit ? "update" : "create"} Asset Master:`, err);
            showToast(`Couldn't ${isEdit ? "update" : "create"} Asset Master. Check your permissions.`, "red");
            e.target.disabled = false;
          }
        } }, isEdit ? "Save" : "Create")
      ])
    ]);
    innerOverlay.appendChild(inner);
    document.body.appendChild(innerOverlay);

    if (isEdit) {
      document.getElementById("nm_assetName").value = existing.assetName || "";
      document.getElementById("nm_category").value = existing.category || "";
      document.getElementById(typeSelectId).value = existing.assetTypeCode || "";
      document.getElementById("nm_brand").value = existing.brand || "";
      document.getElementById("nm_model").value = existing.model || "";
      document.getElementById("nm_warrantyApplicable").checked = !!existing.warrantyApplicable;
      document.getElementById("nm_defaultVendor").value = existing.defaultVendorId || "";
      document.getElementById("nm_driveImageLink").value = existing.driveImageLink || "";
      document.getElementById("nm_description").value = existing.description || "";
    }
  }

  async function handleSave() {
    const saveBtn = document.getElementById("addAssetSaveBtn");
    const centreId = document.getElementById("f_centre").value;
    const roomId = document.getElementById("f_room").value;

    if (!selectedMaster) { showToast("Select an Asset Master first", "red"); return; }
    if (!roomId) { showToast("Select a room", "red"); return; }

    const room = rooms.find((r) => r.id === roomId);
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      const seqStr = await nextSequence(centreId, selectedMaster.assetTypeCode);
      const assetId = buildAssetId(centreId, room.code, selectedMaster.assetTypeCode, seqStr);

      const assetData = {
        assetId,
        previousAssetIds: [],
        assetMasterId: selectedMaster.id,
        assetTypeCode: selectedMaster.assetTypeCode,
        category: selectedMaster.category,
        assetName: selectedMaster.assetName,
        brand: selectedMaster.brand,
        model: selectedMaster.model,
        manufacturerSerialNumber: document.getElementById("f_serial").value.trim(),
        centreId,
        roomId,
        currentStatus: "active",
        currentCustodian: document.getElementById("f_custodian").value.trim(),
        condition: "Good",
        labelReprintRequired: false,
        purchaseDate: document.getElementById("f_purchaseDate").value || null,
        purchaseCost: Number(document.getElementById("f_purchaseCost").value) || 0,
        vendorId: document.getElementById("f_vendor").value || null,
        warrantyApplicable: selectedMaster.warrantyApplicable,
        warrantyExpiry: selectedMaster.warrantyApplicable ? (document.getElementById("f_warrantyExpiry").value || null) : null,
        driveImageLink: document.getElementById("f_driveLink").value.trim(),
        remarks: document.getElementById("f_remarks").value.trim(),
        createdBy: state.profile.uid,
        createdAt: serverTimestamp(),
        lastModifiedBy: state.profile.uid,
        lastModifiedAt: serverTimestamp()
      };

      const ref = await addDoc(collection(db, "assets"), assetData);
      await logActivity(state, { type: "asset_created", assetId: ref.id, centreId, summary: `${assetId} added to ${room.name}` });

      showToast(`Asset ${assetId} created`, "green");
      overlay.remove();
      if (onSaved) onSaved();
    } catch (err) {
      console.error("[addAsset] Save failed:", err);
      showToast("Couldn't save asset. Check the required fields and your permissions.", "red");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }
}

// ---------------------------------------------------------------------------
// Small form-building helpers local to this module.
// ---------------------------------------------------------------------------
function field(label, control) {
  return el("div", { class: "field-group" }, [el("div", { class: "field-label" }, label), control]);
}
function input(id, type = "text") {
  return el("input", { id, class: "field-input", type });
}
function selectEl(id, options, selected = null, placeholder = null) {
  const select = el("select", { id, class: "field-input" });
  if (placeholder) select.appendChild(new Option(placeholder, ""));
  options.forEach((opt) => select.appendChild(new Option(opt.label, opt.value)));
  if (selected) select.value = selected;
  return select;
}
