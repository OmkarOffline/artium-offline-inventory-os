// =============================================================================
// Inventory OS — Vendor Directory
// Chapter 7: shared master list, referenced by Assets rather than duplicated.
// Vendor History (assets purchased/repaired, totals) is computed live from
// /assets (and /repairs once Milestone 3 exists) — never stored separately,
// per the "no duplicate reporting database" rule in Chapter 7/11.
// =============================================================================

import { db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, formatCurrency, formatDate, renderEmptyState, showToast } from "./utils.js";
import { invalidateVendorsCache } from "./refcache.js";
import { BACK_ICON } from "./icons.js";

export const VENDOR_TYPES = ["E-commerce Platform", "Distributor", "Retailer", "D2C Brand"];

export async function listVendors() {
  const snap = await getDocs(query(collection(db, "vendors"), orderBy("companyName")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createVendor(data, currentUser) {
  const ref = await addDoc(collection(db, "vendors"), {
    companyName: data.companyName.trim(),
    vendorType: data.vendorType || "",
    contactPerson: data.contactPerson?.trim() || "",
    phone: data.phone?.trim() || "",
    email: data.email?.trim() || "",
    gstNumber: data.gstNumber?.trim() || "",
    address: data.address?.trim() || "",
    website: data.website?.trim() || "",
    productCategories: data.productCategories?.trim() || "",
    preferredVendor: !!data.preferredVendor,
    remarks: data.remarks?.trim() || "",
    createdBy: currentUser.uid,
    createdAt: serverTimestamp()
  });
  invalidateVendorsCache();
  return ref.id;
}

export async function updateVendor(id, data) {
  await updateDoc(doc(db, "vendors", id), data);
  invalidateVendorsCache();
}

/** Live-computed vendor history — never a stored/duplicated field (Ch.7). */
async function computeVendorStats(vendorId) {
  const assetsSnap = await getDocs(query(collection(db, "assets"), where("vendorId", "==", vendorId)));
  let totalPurchaseValue = 0;
  assetsSnap.forEach((d) => { totalPurchaseValue += Number(d.data().purchaseCost) || 0; });
  return {
    assetsPurchased: assetsSnap.size,
    totalPurchaseValue
    // Repairs-by-vendor stats join in once the Repair module (Milestone 3) exists.
  };
}

export async function renderVendorDirectory(container, state) {
  container.innerHTML = "";
  const header = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;" }, [
    el("div", { style: "font-size:13px;font-weight:700;color:var(--text);" }, "Vendor Directory"),
    el("button", { class: "btn btn-primary btn-sm", onclick: () => openVendorModal(null, state, () => renderVendorDirectory(container, state)) }, "+ Add Vendor")
  ]);
  container.appendChild(header);

  const listEl = el("div", { class: "card-grid" });
  container.appendChild(listEl);

  const vendors = await listVendors();
  if (!vendors.length) {
    renderEmptyState(container, {
      title: "No vendors added yet",
      subtitle: "Vendors are shared across every centre — add one here or inline while adding an asset.",
      actionLabel: "Add Vendor",
      onAction: () => openVendorModal(null, state, () => renderVendorDirectory(container, state))
    });
    return;
  }

  listEl.innerHTML = "";
  vendors.forEach((vendor) => {
    listEl.appendChild(
      el("div", { class: "room-card", onclick: () => openVendorProfile(vendor, state, () => renderVendorDirectory(container, state)) }, [
        el("div", { class: "room-card-icon" }, "▤"),
        el("div", { class: "room-card-name" }, vendor.companyName),
        el("div", { class: "room-card-count" }, vendor.vendorType || "—"),
        vendor.preferredVendor ? el("span", { class: "badge badge-purple", style: "margin-top:2px;" }, [el("span", { class: "badge-dot" }), "Preferred"]) : null
      ].filter(Boolean))
    );
  });
}

function vendorFieldsForm(existing = {}) {
  const typeSelect = el("select", { class: "field-input", id: "f_vendorType", required: "required" }, [
    el("option", { value: "" }, "Select vendor type"),
    ...VENDOR_TYPES.map((t) => { const o = new Option(t, t); if (existing.vendorType === t) o.selected = true; return o; })
  ]);
  return el("div", { class: "field-group" }, [
    field("Company Name", "companyName", existing.companyName, true),
    el("div", { class: "field-group" }, [el("label", { class: "field-label" }, "Vendor Type"), typeSelect]),
    el("div", { class: "field-row" }, [
      field("Contact Person", "contactPerson", existing.contactPerson),
      field("Phone Number", "phone", existing.phone)
    ]),
    el("div", { class: "field-row" }, [
      field("Email Address", "email", existing.email),
      field("GST Number", "gstNumber", existing.gstNumber)
    ]),
    field("Address", "address", existing.address, false, "textarea"),
    el("div", { class: "field-row" }, [
      field("Website", "website", existing.website),
      field("Product Categories", "productCategories", existing.productCategories)
    ]),
    el("label", { style: "display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-dim);" }, [
      el("input", { type: "checkbox", id: "f_preferredVendor", checked: existing.preferredVendor ? "checked" : null }),
      "Preferred vendor"
    ]),
    field("Remarks", "remarks", existing.remarks, false, "textarea")
  ]);
}

function field(label, id, value = "", required = false, type = "input") {
  const attrs = { class: "field-input", id: `f_${id}` };
  if (required) attrs.required = "required";
  const control = type === "textarea"
    ? el("textarea", attrs, value || "")
    : el("input", { ...attrs, type: "text", value: value || "" });
  return el("div", { class: "field-group" }, [el("label", { class: "field-label" }, label), control]);
}

function readVendorForm() {
  const val = (id) => document.getElementById(`f_${id}`)?.value || "";
  return {
    companyName: val("companyName"),
    vendorType: val("vendorType"),
    contactPerson: val("contactPerson"),
    phone: val("phone"),
    email: val("email"),
    gstNumber: val("gstNumber"),
    address: val("address"),
    website: val("website"),
    productCategories: val("productCategories"),
    preferredVendor: document.getElementById("f_preferredVendor")?.checked || false,
    remarks: val("remarks")
  };
}

export function openVendorModal(existing, state, onSaved) {
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [
      el("h2", {}, existing ? "Edit Vendor" : "Add Vendor"),
      el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, "×")
    ]),
    el("div", { class: "modal-body" }, [vendorFieldsForm(existing || {})]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          const data = readVendorForm();
          if (!data.companyName.trim()) { showToast("Company name is required", "red"); return; }
          if (!data.vendorType) { showToast("Select a vendor type", "red"); return; }
          e.target.disabled = true;
          try {
            const savedId = existing ? existing.id : await createVendor(data, state.profile);
            if (existing) await updateVendor(existing.id, data);
            showToast(existing ? "Vendor updated" : "Vendor added", "green");
            overlay.remove();
            if (onSaved) onSaved(savedId);
          } catch (err) {
            console.error("[vendors] Save failed:", err);
            showToast("Couldn't save vendor. Check your permissions.", "red");
            e.target.disabled = false;
          }
        }
      }, "Save")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export async function openVendorProfile(vendor, state, onChanged) {
  const overlay = el("div", { class: "overlay show", role: "dialog", "aria-modal": "true" });
  const panel = el("div", { class: "panel show" });
  panel.appendChild(el("div", { class: "panel-header" }, [
    el("button", { class: "btn-icon-only", "aria-label": "Back", title: "Back", style: "margin-bottom:6px;", onclick: () => close() }, [
      el("img", { src: BACK_ICON, alt: "", class: "icon-img", loading: "lazy" })
    ]),
    el("div", { class: "panel-crumb" }, "Vendor Directory"),
    el("div", { style: "font-size:19px;font-weight:700;" }, vendor.companyName)
  ]));

  const body = el("div", { class: "panel-body" }, [el("div", {}, "Loading…")]);
  panel.appendChild(body);

  const footer = el("div", { class: "panel-footer" }, [
    el("button", { class: "btn btn-secondary", onclick: () => { close(); openVendorModal(vendor, state, onChanged); } }, "Edit"),
    el("button", { class: "btn btn-ghost", onclick: () => close() }, "Close")
  ]);
  panel.appendChild(footer);

  function close() { overlay.remove(); panel.remove(); if (onChanged) onChanged(); }
  overlay.addEventListener("click", close);

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  const stats = await computeVendorStats(vendor.id);
  body.innerHTML = "";
  body.appendChild(el("div", { class: "stat-grid" }, [
    statBlock("Assets Purchased", String(stats.assetsPurchased)),
    statBlock("Total Purchase Value", formatCurrency(stats.totalPurchaseValue))
  ]));
  body.appendChild(detailRow("Vendor Type", vendor.vendorType));
  body.appendChild(detailRow("Contact Person", vendor.contactPerson));
  body.appendChild(detailRow("Phone", vendor.phone));
  body.appendChild(detailRow("Email", vendor.email));
  body.appendChild(detailRow("GST Number", vendor.gstNumber));
  body.appendChild(detailRow("Address", vendor.address));
  body.appendChild(detailRow("Website", vendor.website));
  body.appendChild(detailRow("Product Categories", vendor.productCategories));
  body.appendChild(detailRow("Preferred Vendor", vendor.preferredVendor ? "Yes" : "No"));
  body.appendChild(detailRow("Remarks", vendor.remarks));
}

function statBlock(label, value) {
  return el("div", { class: "stat-card" }, [
    el("div", { class: "stat-label" }, label),
    el("div", { class: "stat-value" }, value)
  ]);
}

function detailRow(label, value) {
  return el("div", { class: "field-group" }, [
    el("div", { class: "field-label" }, label),
    el("div", { style: "font-size:12.5px;color:var(--text);" }, value || "—")
  ]);
}
