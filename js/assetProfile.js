// =============================================================================
// Inventory OS — Asset Profile (right-side panel)
// The Asset Workspace: every action on this asset originates here rather
// than sending the user elsewhere (Chapter 6's "Asset Workspace" framing).
// Sections: Identity, Current Assignment, Purchase Information, Photo,
// Notes, History (Room/Centre Transfer, Asset ID, Repair, Audit, Disposal),
// Assignment History, and the full Activity Timeline.
// =============================================================================

import { db } from "./firebase.js";
import { doc, getDoc, updateDoc, collection, query, where, orderBy, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, formatDate, formatDateTime, formatCurrency, statusBadge, showToast, roomDisplayName } from "./utils.js";
import { logActivity } from "./activity.js";
import { openRoomTransferModal, openCentreTransferModal, openCorrectAssetTypeModal } from "./transfer.js";
import { listRepairsForAsset, openSendForRepairModal, openReturnFromRepairModal, repairStatusLabel } from "./repairs.js";
import { listVendors } from "./vendors.js";
import { openDisposalRequestModal } from "./disposal.js";
import { listAuditFlagsForAsset } from "./audits.js";
import { categoryIconFor, CLOSE_ICON } from "./icons.js";

export async function openAssetProfile(assetId, state, onChanged) {
  const overlay = el("div", { class: "overlay show", role: "dialog", "aria-modal": "true" });
  const panel = el("div", { class: "panel show" });
  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  function close() { overlay.remove(); panel.remove(); if (onChanged) onChanged(); }
  overlay.addEventListener("click", close);

  panel.innerHTML = "";
  panel.appendChild(el("div", { class: "panel-body" }, [renderInlineEmpty("Loading…")]));

  let asset, roomName, vendorName, masterImage, activities, repairs, vendorsById, auditFlags;
  const initial = await getDoc(doc(db, "assets", assetId));
  if (!initial.exists()) {
    panel.innerHTML = "";
    panel.appendChild(el("div", { class: "panel-body" }, [renderInlineEmpty("This asset couldn't be found.")]));
    return;
  }
  asset = { id: initial.id, ...initial.data() };

  let editMode = false;

  try {
    await reload();
    render();
  } catch (err) {
    console.error("[assetProfile] Failed to load asset profile:", err);
    panel.innerHTML = "";
    panel.appendChild(el("div", { class: "panel-body" }, [
      renderInlineEmpty("Couldn't load this asset's profile. Check the browser console for details — this may need a Firestore index (look for a create-index link) or a permissions issue.")
    ]));
  }

  // ---------------------------------------------------------------------
  // Refetches everything the panel displays: the asset doc itself (room,
  // status, IDs may have changed via transfer), its activity log, its
  // repair records, and lookup names. Called after every mutating action
  // so the panel always reflects real Firestore state, not local guesses.
  // ---------------------------------------------------------------------
  async function reload() {
    const assetSnap = await getDoc(doc(db, "assets", assetId));
    asset = { id: assetSnap.id, ...assetSnap.data() };

    const [roomSnap, vendorSnap, masterSnap, vendorList, repairList, flagList] = await Promise.all([
      asset.roomId ? getDoc(doc(db, "rooms", asset.roomId)) : Promise.resolve(null),
      asset.vendorId ? getDoc(doc(db, "vendors", asset.vendorId)) : Promise.resolve(null),
      asset.assetMasterId ? getDoc(doc(db, "assetMasters", asset.assetMasterId)) : Promise.resolve(null),
      listVendors(),
      listRepairsForAsset(asset.id).catch((err) => { console.error("[assetProfile] Failed to load repairs:", err); return null; }),
      listAuditFlagsForAsset(asset.id).catch((err) => { console.error("[assetProfile] Failed to load audit flags:", err); return null; })
    ]);
    roomName = roomSnap?.exists() ? roomDisplayName(roomSnap.data().name) : "—";
    vendorName = vendorSnap?.exists() ? vendorSnap.data().companyName : "—";
    masterImage = masterSnap?.exists() ? masterSnap.data().driveImageLink : "";
    vendorsById = Object.fromEntries(vendorList.map((v) => [v.id, v.companyName]));
    repairs = repairList;
    auditFlags = flagList; // null = load error, [] = genuinely none.

    try {
      const snap = await getDocs(query(collection(db, "activities"), where("assetId", "==", asset.id), orderBy("timestamp", "desc")));
      activities = snap.docs.map((d) => d.data());
    } catch (err) {
      console.error("[assetProfile] Failed to load activity:", err);
      activities = null; // null = load error, [] = genuinely empty; rendered differently below.
    }
  }

  function canEdit() {
    return state.profile.role === "owner" ||
      (state.profile.role === "centre_admin" && state.profile.assignedCentres?.includes(asset.centreId));
  }

  function render() {
    panel.innerHTML = "";
    const badge = statusBadge(asset.currentStatus);
    const categoryIcon = categoryIconFor(asset.category);

    panel.appendChild(el("div", { class: "panel-header" }, [
      el("button", { class: "btn-icon-only", "aria-label": "Close", title: "Close", style: "margin-bottom:6px;", onclick: close }, [
        el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })
      ]),
      el("div", { class: "panel-crumb" }, "Register  ›  " + roomName),
      el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-top:6px;" }, [
        el("div", { style: "display:flex;align-items:center;gap:12px;min-width:0;" }, [
          categoryIcon
            ? el("div", { style: "width:56px;height:56px;flex:none;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(25,28,50,.06);display:flex;align-items:center;justify-content:center;overflow:hidden;" }, [
                el("img", { src: categoryIcon, alt: "", style: "width:100%;height:100%;object-fit:contain;" })
              ])
            : null,
          el("div", { style: "min-width:0;" }, [
            el("div", { style: "font-size:19px;font-weight:700;" }, asset.assetName || "Untitled Asset"),
            el("div", { style: "font-size:12px;color:var(--text-faint);margin-top:2px;" }, asset.assetId)
          ])
        ].filter(Boolean)),
        el("span", { class: `badge badge-${badge.color}` }, [el("span", { class: "badge-dot" }), badge.label])
      ]),
      el("div", { class: "quick-glance" }, [
        glanceItem("Room", roomName),
        glanceItem("Custodian", asset.currentCustodian || "—"),
        glanceItem("Vendor", vendorName)
      ]),
      !editMode ? actionBar() : null
    ].filter(Boolean)));

    const body = el("div", { class: "panel-body" });
    body.appendChild(sectionTitle("Identity"));
    body.appendChild(readonlyGrid([
      ["Asset ID", asset.assetId],
      ["Category", asset.category],
      ["Asset Type", asset.assetTypeCode],
      ["Brand", asset.brand],
      ["Model", asset.model],
      state.profile.role === "owner" ? ["Internal Asset Number (Owner only)", asset.id] : null
    ].filter(Boolean)));

    body.appendChild(sectionTitle("Current Assignment"));
    if (editMode) {
      body.appendChild(editableGrid([
        ["Manufacturer Serial Number", "manufacturerSerialNumber", asset.manufacturerSerialNumber],
        ["Condition", "condition", asset.condition]
      ]));
    } else {
      body.appendChild(readonlyGrid([
        ["Manufacturer Serial Number", asset.manufacturerSerialNumber],
        ["Room", roomName],
        ["Current Custodian", asset.currentCustodian],
        ["Condition", asset.condition],
        ["Label Status", asset.labelReprintRequired ? "Label Reprint Required" : "Up to date"]
      ]));
    }

    body.appendChild(sectionTitle("Purchase Information"));
    if (editMode) {
      body.appendChild(editableGrid([
        ["Purchase Date", "purchaseDate", asset.purchaseDate, "date"],
        ["Purchase Cost", "purchaseCost", asset.purchaseCost, "number"],
        asset.warrantyApplicable ? ["Warranty Expiry", "warrantyExpiry", asset.warrantyExpiry, "date"] : null
      ].filter(Boolean)));
    } else {
      body.appendChild(readonlyGrid([
        ["Purchase Date", formatDate(asset.purchaseDate)],
        ["Purchase Cost", formatCurrency(asset.purchaseCost)],
        ["Vendor", vendorName],
        asset.warrantyApplicable ? ["Warranty Expiry", formatDate(asset.warrantyExpiry)] : ["Warranty", "Not applicable"]
      ].filter(Boolean)));
    }

    body.appendChild(sectionTitle("Photo"));
    const photoLink = asset.driveImageLink || masterImage;
    if (editMode) {
      body.appendChild(editableGrid([["Photo Link (optional)", "driveImageLink", asset.driveImageLink]]));
    } else if (photoLink) {
      body.appendChild(el("a", { href: photoLink, target: "_blank", class: "btn btn-secondary btn-sm" }, "Open link ↗"));
    } else {
      body.appendChild(renderInlineEmpty("No photo linked yet."));
    }

    body.appendChild(sectionTitle("Notes"));
    if (editMode) {
      body.appendChild(el("textarea", { class: "field-input", id: "f_remarks" }, asset.remarks || ""));
    } else {
      body.appendChild(el("div", { style: "font-size:12.5px;color:var(--text-dim);white-space:pre-wrap;" }, asset.remarks || "No remarks yet."));
    }

    body.appendChild(sectionTitle("History"));
    body.appendChild(subsectionLabel("Room / Centre Transfer History"));
    renderActivityList(body, filterActivities(["room_transfer", "centre_transfer"]), "No transfers recorded yet.");

    body.appendChild(subsectionLabel("Asset ID History"));
    renderAssetIdHistory(body);

    body.appendChild(subsectionLabel("Repair History"));
    renderRepairHistory(body);

    body.appendChild(subsectionLabel("Audit History"));
    renderAuditHistory(body);

    body.appendChild(subsectionLabel("Disposal History"));
    renderActivityList(body, filterActivities(["disposal_requested", "disposal_approved", "disposal_rejected"]), "No disposal activity recorded yet.");

    body.appendChild(sectionTitle("Assignment History"));
    renderActivityList(body, filterActivities(["custodian_changed"]), "No custodian changes recorded yet.");

    body.appendChild(sectionTitle("Activity Timeline"));
    renderActivityList(body, activities, "No activity recorded yet.");

    panel.appendChild(body);

    const footer = el("div", { class: "panel-footer" });
    if (editMode) {
      footer.appendChild(el("button", { class: "btn btn-ghost", onclick: () => { editMode = false; render(); } }, "Cancel"));
      footer.appendChild(el("button", { class: "btn btn-primary", onclick: saveEdits }, "Save Changes"));
    } else {
      if (canEdit()) footer.appendChild(el("button", { class: "btn btn-secondary", onclick: () => { editMode = true; render(); } }, "Edit"));
      footer.appendChild(el("button", { class: "btn btn-ghost", onclick: close }, "Close"));
    }
    panel.appendChild(footer);
  }

  // ---------------------------------------------------------------------
  // Header action bar — the Asset Workspace's control centre (Chapter 6's
  // reframing). Every operation on this asset starts from one of these
  // buttons rather than requiring the user to leave the panel. Actions
  // only appear when they're both permitted and operationally valid
  // (e.g. "Return from Repair" only shows once an asset is actually
  // Under Repair) — no dead buttons per Chapter 12.
  // ---------------------------------------------------------------------
  function actionBar() {
    if (!canEdit()) return null;
    const buttons = [];

    buttons.push(el("button", { class: "btn btn-secondary btn-sm", onclick: openChangeCustodianModal }, "Change Custodian"));
    buttons.push(el("button", { class: "btn btn-secondary btn-sm", onclick: () => openRoomTransferModal(asset, state, refresh) }, "Transfer Room"));
    buttons.push(el("button", { class: "btn btn-secondary btn-sm", onclick: () => openCentreTransferModal(asset, state, refresh) }, "Transfer Centre"));

    if (state.profile.role === "owner") {
      buttons.push(el("button", { class: "btn btn-secondary btn-sm", onclick: () => openCorrectAssetTypeModal(asset, state, refresh) }, "Correct Asset Type"));
    }

    if (asset.currentStatus === "under_repair") {
      buttons.push(el("button", { class: "btn btn-secondary btn-sm", onclick: () => openReturnFromRepairModal(asset, state, refresh) }, "Return from Repair"));
    } else if (asset.currentStatus === "active") {
      buttons.push(el("button", { class: "btn btn-secondary btn-sm", onclick: () => openSendForRepairModal(asset, state, refresh) }, "Send for Repair"));
    }

    if (asset.labelReprintRequired) {
      buttons.push(el("button", { class: "btn btn-secondary btn-sm", onclick: markLabelReprinted }, "Mark Label Reprinted"));
    }

    if (asset.currentStatus === "active" || asset.currentStatus === "under_repair") {
      buttons.push(el("button", { class: "btn btn-ghost btn-sm", onclick: () => openDisposalRequestModal(asset, state, refresh) }, "Request Disposal"));
    }

    return el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;" }, buttons);
  }

  async function refresh() {
    try {
      await reload();
      render();
    } catch (err) {
      console.error("[assetProfile] Failed to refresh asset profile:", err);
      showToast("Couldn't refresh this asset's details. Check the browser console for details.", "red");
    }
  }

  async function markLabelReprinted() {
    try {
      await updateDoc(doc(db, "assets", asset.id), {
        labelReprintRequired: false,
        lastModifiedBy: state.profile.uid,
        lastModifiedAt: serverTimestamp()
      });
      await logActivity(state, { type: "label_reprinted", assetId: asset.id, centreId: asset.centreId, summary: `${asset.assetId} label reprinted` });
      showToast("Label marked as reprinted", "green");
      await refresh();
    } catch (err) {
      console.error("[assetProfile] Failed to mark label reprinted:", err);
      showToast("Couldn't update label status. Check your permissions.", "red");
    }
  }

  function openChangeCustodianModal() {
    const modalOverlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
    const input = el("input", { class: "field-input", type: "text", value: asset.currentCustodian || "" });
    const modal = el("div", { class: "modal" }, [
      el("div", { class: "modal-header" }, [el("h2", {}, "Change Custodian"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => modalOverlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
      el("div", { class: "modal-body" }, [
        el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Assign To"), input])
      ]),
      el("div", { class: "modal-footer" }, [
        el("button", { class: "btn btn-ghost", onclick: () => modalOverlay.remove() }, "Cancel"),
        el("button", { class: "btn btn-primary", onclick: async (e) => {
          const newCustodian = input.value.trim();
          const oldCustodian = asset.currentCustodian || "Unassigned";
          if (newCustodian === (asset.currentCustodian || "")) { modalOverlay.remove(); return; }
          e.target.disabled = true;
          try {
            await updateDoc(doc(db, "assets", asset.id), {
              currentCustodian: newCustodian,
              lastModifiedBy: state.profile.uid,
              lastModifiedAt: serverTimestamp()
            });
            await logActivity(state, {
              type: "custodian_changed", assetId: asset.id, centreId: asset.centreId,
              summary: `${asset.assetId}: Custodian: ${oldCustodian} → ${newCustodian || "Unassigned"}`
            });
            showToast("Custodian updated", "green");
            modalOverlay.remove();
            await refresh();
          } catch (err) {
            console.error("[assetProfile] Change custodian failed:", err);
            showToast("Couldn't update custodian. Check your permissions.", "red");
            e.target.disabled = false;
          }
        } }, "Save")
      ])
    ]);
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);
  }

  function filterActivities(types) {
    if (!activities) return null;
    return activities.filter((a) => types.includes(a.type));
  }

  function renderAssetIdHistory(container) {
    const prev = asset.previousAssetIds || [];
    if (!prev.length) {
      container.appendChild(renderInlineEmpty("No previous Asset IDs — this is the only ID this asset has had."));
      return;
    }
    const chain = [...prev, asset.assetId];
    container.appendChild(el("div", { style: "font-size:12px;color:var(--text-dim);display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;" },
      chain.map((id, i) => i === chain.length - 1
        ? el("span", { style: "font-weight:700;color:var(--text);" }, id)
        : el("span", {}, `${id} →`)
      )
    ));
  }

  function renderRepairHistory(container) {
    if (repairs === null) {
      container.appendChild(renderInlineEmpty("Couldn't load — this may need a Firestore index (check the browser console for a create-index link)."));
      return;
    }
    if (!repairs.length) {
      container.appendChild(renderInlineEmpty("No repairs recorded yet."));
      return;
    }
    repairs.forEach((r) => {
      container.appendChild(el("div", { style: "background:var(--bg-input);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px;" }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:8px;" }, [
          el("div", { style: "font-size:12px;font-weight:700;color:var(--text);" }, vendorsById[r.vendorId] || "Unknown Vendor"),
          el("span", { class: `badge badge-${r.status === "completed" ? "green" : "amber"}` }, [el("span", { class: "badge-dot" }), repairStatusLabel(r.status)])
        ]),
        el("div", { style: "font-size:11.5px;color:var(--text-dim);margin-top:4px;" }, r.description),
        el("div", { style: "font-size:11px;color:var(--text-faint);margin-top:4px;" },
          `Reported ${formatDate(r.reportedDate)}${r.completionDate ? ` · Completed ${formatDate(r.completionDate)}` : ""} · Est. ${formatCurrency(r.estimatedCost)}${r.actualCost ? ` · Actual ${formatCurrency(r.actualCost)}` : ""}`)
      ]));
    });
  }

  function renderAuditHistory(container) {
    if (auditFlags === null) {
      container.appendChild(renderInlineEmpty("Couldn't load — this may need a Firestore index (check the browser console for a create-index link)."));
      return;
    }
    if (!auditFlags.length) {
      container.appendChild(renderInlineEmpty("No audit findings — this asset has always been marked Present in every audit it's been part of."));
      return;
    }
    auditFlags.forEach((f) => {
      container.appendChild(el("div", { style: "background:var(--bg-input);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px;" }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:8px;" }, [
          el("div", { style: "font-size:12px;font-weight:700;color:var(--text);" }, f.status === "missing" ? "Missing" : "Damaged"),
          el("span", { class: `badge badge-${f.acknowledged ? "green" : "amber"}` }, [el("span", { class: "badge-dot" }), f.acknowledged ? "Acknowledged" : "Awaiting Owner review"])
        ]),
        f.notes ? el("div", { style: "font-size:11.5px;color:var(--text-dim);margin-top:4px;" }, f.notes) : null,
        el("div", { style: "font-size:11px;color:var(--text-faint);margin-top:4px;" },
          `Found by ${f.createdByName} · ${formatDateTime(f.createdAt)}`)
      ].filter(Boolean)));
    });
  }

  async function saveEdits() {
    const val = (id) => document.getElementById(id)?.value;
    const updates = {
      manufacturerSerialNumber: val("f_manufacturerSerialNumber") ?? asset.manufacturerSerialNumber,
      condition: val("f_condition") ?? asset.condition,
      purchaseDate: val("f_purchaseDate") ?? asset.purchaseDate,
      purchaseCost: val("f_purchaseCost") !== undefined ? Number(val("f_purchaseCost")) : asset.purchaseCost,
      warrantyExpiry: val("f_warrantyExpiry") ?? asset.warrantyExpiry,
      driveImageLink: val("f_driveImageLink") ?? asset.driveImageLink,
      remarks: val("f_remarks") ?? asset.remarks,
      lastModifiedBy: state.profile.uid,
      lastModifiedAt: serverTimestamp()
    };
    const changeSummary = describeChanges(asset, updates);
    if (!changeSummary) {
      editMode = false;
      render();
      return; // Nothing actually changed — no point writing an update or activity record.
    }
    try {
      await updateDoc(doc(db, "assets", asset.id), updates);
      await logActivity(state, { type: "asset_edited", assetId: asset.id, centreId: asset.centreId, summary: `${asset.assetId}: ${changeSummary}` });
      editMode = false;
      showToast("Asset updated", "green");
      await refresh();
    } catch (err) {
      console.error("[assetProfile] Save failed:", err);
      showToast("Couldn't save changes. Check your permissions.", "red");
    }
  }
}

// -----------------------------------------------------------------------
// Builds a human-readable "Field: old → new" summary for the activity log,
// so the timeline says what actually changed rather than a generic
// "details updated" (Chapter 6/7: activity records should be meaningful,
// not just noise). Long free-text fields (remarks, links) are called out
// by name only, without dumping their full contents into the log.
// Custodian is intentionally excluded here — it now has its own dedicated
// Change Custodian action and activity type ("custodian_changed").
// -----------------------------------------------------------------------
const CHANGE_FIELD_LABELS = {
  manufacturerSerialNumber: "Serial Number",
  condition: "Condition",
  purchaseDate: "Purchase Date",
  purchaseCost: "Purchase Cost",
  warrantyExpiry: "Warranty Expiry"
};
const CHANGE_FIELD_FORMATTERS = {
  purchaseDate: formatDate,
  warrantyExpiry: formatDate,
  purchaseCost: formatCurrency
};
const QUIET_FIELDS = { driveImageLink: "Photo link", remarks: "Remarks" };

function describeChanges(before, after) {
  const parts = [];
  for (const [key, label] of Object.entries(CHANGE_FIELD_LABELS)) {
    const oldVal = before[key] ?? "";
    const newVal = after[key] ?? "";
    if (String(oldVal) === String(newVal)) continue;
    const fmt = CHANGE_FIELD_FORMATTERS[key] || ((v) => v || "—");
    parts.push(`${label}: ${fmt(oldVal)} → ${fmt(newVal)}`);
  }
  for (const [key, label] of Object.entries(QUIET_FIELDS)) {
    const oldVal = before[key] ?? "";
    const newVal = after[key] ?? "";
    if (String(oldVal) !== String(newVal)) parts.push(`${label} updated`);
  }
  return parts.join("; ");
}

function renderActivityList(container, items, emptyText) {
  if (items === null) {
    container.appendChild(renderInlineEmpty("Couldn't load — this may need a Firestore index (check the browser console for a create-index link)."));
    return;
  }
  if (!items.length) {
    container.appendChild(renderInlineEmpty(emptyText));
    return;
  }
  items.forEach((a) => {
    container.appendChild(el("div", { class: "activity-item", style: "margin-bottom:8px;" }, [
      el("span", { class: "activity-dot" }),
      el("div", {}, [
        el("div", { style: "color:var(--text-dim);" }, a.summary),
        el("div", { style: "font-size:11px;color:var(--text-faint);margin-top:1px;" }, [
          el("span", { style: "font-weight:700;color:var(--text-dim);" }, a.userName),
          ` · ${formatDateTime(a.timestamp)}`
        ])
      ])
    ]));
  });
}

function sectionTitle(text) {
  return el("div", { class: "panel-section-title", style: "margin-top:4px;" }, text);
}
function subsectionLabel(text) {
  return el("div", { style: "font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;margin:8px 0 4px;" }, text);
}
function glanceItem(label, value) {
  return el("div", { class: "qg-item" }, [
    el("div", { class: "qg-label" }, label),
    el("div", { class: "qg-value" }, value || "—")
  ]);
}
function readonlyGrid(pairs) {
  return el("div", { class: "field-row", style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
    pairs.map(([label, value]) => el("div", { class: "field-group" }, [
      el("div", { class: "field-label" }, label),
      el("div", { style: "font-size:12.5px;color:var(--text);" }, value || "—")
    ]))
  );
}
function editableGrid(fields) {
  return el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;" },
    fields.map(([label, key, value, type = "text"]) => el("div", { class: "field-group" }, [
      el("div", { class: "field-label" }, label),
      el("input", { id: `f_${key}`, class: "field-input", type, value: value ?? "" })
    ]))
  );
}
function renderInlineEmpty(text) {
  return el("div", { style: "font-size:11.5px;color:var(--text-faint);padding:6px 0;" }, text);
}
