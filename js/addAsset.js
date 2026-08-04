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
import { el, showToast } from "./utils.js";
import { listAssetMasters, listAssetTypes, createAssetType, createAssetMaster, ASSET_CATEGORIES } from "./assetMaster.js";
import { listVendors, openVendorModal } from "./vendors.js";
import { logActivity } from "./activity.js";

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

  const centreOptions = (state.profile.role === "owner")
    ? state.centres
    : state.centres.filter((c) => state.profile.assignedCentres?.includes(c.id));

  modal.appendChild(el("div", { class: "modal-header" }, [
    el("h2", {}, "Add Asset"),
    el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, "×")
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
    document.getElementById("f_assetMaster").addEventListener("change", onMasterChange);
    document.getElementById("newAssetMasterBtn").addEventListener("click", openNewAssetMasterModal);
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
        el("button", { class: "btn btn-secondary btn-sm", id: "newAssetMasterBtn", type: "button" }, "+ New")
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
      field("Photo (Google Drive link, optional)", input("f_driveLink")),
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
    rooms.forEach((r) => roomSelect.appendChild(new Option(r.name, r.id)));
  }

  async function onMasterChange() {
    const masterId = document.getElementById("f_assetMaster").value;
    selectedMaster = assetMasters.find((m) => m.id === masterId) || null;
    const infoEl = document.getElementById("masterInfo");
    const copyEl = document.getElementById("copyFromSection");
    const manualEl = document.getElementById("manualFields");

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

  function openNewAssetMasterModal() {
    const innerOverlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
    const typeSelectId = "nm_assetType";
    const inner = el("div", { class: "modal" }, [
      el("div", { class: "modal-header" }, [el("h2", {}, "New Asset Master"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => innerOverlay.remove() }, "×")]),
      el("div", { class: "modal-body" }, [
        field("Asset Name", input("nm_assetName")),
        el("div", { class: "field-row" }, [
          field("Category", selectEl("nm_category", ASSET_CATEGORIES.map((c) => ({ value: c, label: c })))),
          field("Asset Type", (() => {
            const wrap = el("div", { style: "display:flex;gap:6px;" }, [
              selectEl(typeSelectId, assetTypes.map((t) => ({ value: t.code, label: `${t.code} — ${t.name}` }))),
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
        field("Standard Image (Google Drive link, optional)", input("nm_driveImageLink")),
        field("Description / Remarks", (() => { const t = document.createElement("textarea"); t.id = "nm_description"; t.className = "field-input"; return t; })())
      ]),
      el("div", { class: "modal-footer" }, [
        el("button", { class: "btn btn-ghost", onclick: () => innerOverlay.remove() }, "Cancel"),
        el("button", { class: "btn btn-primary", onclick: async (e) => {
          const name = document.getElementById("nm_assetName").value.trim();
          if (!name) { showToast("Asset Name is required", "red"); return; }
          e.target.disabled = true;
          try {
            const masterData = {
              assetName: name,
              category: document.getElementById("nm_category").value,
              assetTypeCode: document.getElementById(typeSelectId).value,
              brand: document.getElementById("nm_brand").value,
              model: document.getElementById("nm_model").value,
              warrantyApplicable: document.getElementById("nm_warrantyApplicable").checked,
              defaultVendorId: document.getElementById("nm_defaultVendor").value || null,
              driveImageLink: document.getElementById("nm_driveImageLink").value,
              description: document.getElementById("nm_description").value
            };
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
            innerOverlay.remove();
          } catch (err) {
            console.error("[addAsset] Failed to create Asset Master:", err);
            showToast("Couldn't create Asset Master. Check your permissions.", "red");
            e.target.disabled = false;
          }
        } }, "Create")
      ])
    ]);
    innerOverlay.appendChild(inner);
    document.body.appendChild(innerOverlay);
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
