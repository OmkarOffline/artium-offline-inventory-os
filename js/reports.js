// =============================================================================
// Inventory OS — Reports
// Chapter 8: every view here is computed live from existing collections —
// nothing is stored twice, matching how Vendor stats already work. Scoped to
// the active centre, same as Dashboard and Register, so switching centres in
// the topbar switches the reports too. Each section has its own CSV export.
// =============================================================================

import { db } from "./firebase.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, formatDate, formatCurrency, statusBadge, renderEmptyState, roomDisplayName } from "./utils.js";
import { downloadCSV } from "./csv.js";
import { getRoomsForCentre, getVendors } from "./refcache.js";

export async function renderReportsPage(container, state) {
  container.innerHTML = "";

  if (!state.activeCentreId) {
    renderEmptyState(container, {
      title: "No centre selected",
      subtitle: "Assign yourself a centre before reports can be shown here."
    });
    return;
  }

  container.appendChild(el("div", { style: "font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px;" }, "Reports"));

  const loadingNote = el("div", { style: "font-size:12.5px;color:var(--text-faint);" }, "Loading report data…");
  container.appendChild(loadingNote);

  const [assetsSnap, rooms, vendors, repairsSnap, disposalsSnap] = await Promise.all([
    getDocs(query(collection(db, "assets"), where("centreId", "==", state.activeCentreId))),
    getRoomsForCentre(state.activeCentreId),
    getVendors(),
    getDocs(query(collection(db, "repairs"), where("centreId", "==", state.activeCentreId))),
    getDocs(query(collection(db, "disposalRequests"), where("centreId", "==", state.activeCentreId)))
  ]);

  loadingNote.remove();

  const assets = assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const roomNames = Object.fromEntries(rooms.map((r) => [r.id, roomDisplayName(r.name)]));
  const vendorNames = Object.fromEntries(vendors.map((v) => [v.id, v.companyName]));
  const repairs = repairsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const disposals = disposalsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.status !== "pending");

  container.appendChild(assetBreakdownSection(assets, roomNames, state));
  container.appendChild(warrantyExpirySection(assets, state));
  container.appendChild(repairSpendSection(repairs, vendorNames, state));
  container.appendChild(disposalHistorySection(disposals, state));
  container.appendChild(labelBacklogSection(assets, state));
}

function sectionCard(title, exportFn) {
  const card = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:14px;" });
  card.appendChild(el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;" }, [
    el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);" }, title),
    exportFn ? el("button", { class: "btn btn-secondary btn-sm", onclick: exportFn }, "Export CSV") : null
  ].filter(Boolean)));
  return card;
}

function simpleTable(columns, rows) {
  if (!rows.length) return el("div", { style: "font-size:12px;color:var(--text-faint);" }, "No data yet.");
  const table = el("table", { style: "width:100%;border-collapse:collapse;font-size:12px;" });
  table.appendChild(el("thead", {}, [
    el("tr", {}, columns.map((c) => el("th", { style: "text-align:left;padding:6px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint);border-bottom:1px solid var(--border);" }, c.label)))
  ]));
  const tbody = el("tbody", {}, rows.map((row) => el("tr", { style: "border-bottom:1px solid var(--border-soft);" },
    columns.map((c) => el("td", { style: "padding:6px 8px;color:var(--text-dim);" }, row[c.key] ?? "—"))
  )));
  table.appendChild(tbody);
  return el("div", { class: "table-scroll" }, [table]);
}

// -----------------------------------------------------------------------
function assetBreakdownSection(assets, roomNames, state) {
  const byRoom = {};
  const byStatus = {};
  const byCategory = {};
  assets.forEach((a) => {
    const room = roomNames[a.roomId] || "Unassigned";
    byRoom[room] = (byRoom[room] || 0) + 1;
    byStatus[a.currentStatus] = (byStatus[a.currentStatus] || 0) + 1;
    const cat = a.category || "Uncategorised";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });

  const rows = [
    ...Object.entries(byRoom).map(([k, v]) => ({ group: "Room", value: k, count: v })),
    ...Object.entries(byStatus).map(([k, v]) => ({ group: "Status", value: statusBadge(k).label, count: v })),
    ...Object.entries(byCategory).map(([k, v]) => ({ group: "Category", value: k, count: v }))
  ];

  const card = sectionCard(`Asset Breakdown (${assets.length} total)`, () =>
    downloadCSV(`asset-breakdown-${state.activeCentreId}`, [
      { key: "group", label: "Group" }, { key: "value", label: "Value" }, { key: "count", label: "Count" }
    ], rows)
  );
  card.appendChild(simpleTable([
    { key: "group", label: "Group" }, { key: "value", label: "Value" }, { key: "count", label: "Count" }
  ], rows));
  return card;
}

// -----------------------------------------------------------------------
function warrantyExpirySection(assets, state) {
  const now = new Date();
  const withWarranty = assets
    .filter((a) => a.warrantyApplicable && a.warrantyExpiry)
    .map((a) => ({ ...a, _expiry: new Date(a.warrantyExpiry) }))
    .sort((a, b) => a._expiry - b._expiry);

  const rows = withWarranty.map((a) => ({
    assetId: a.assetId,
    assetName: a.assetName,
    warrantyExpiry: formatDate(a.warrantyExpiry),
    status: a._expiry < now ? "Expired" : "Active"
  }));

  const card = sectionCard("Warranty Expiry", () =>
    downloadCSV(`warranty-expiry-${state.activeCentreId}`, [
      { key: "assetId", label: "Asset ID" }, { key: "assetName", label: "Asset Name" },
      { key: "warrantyExpiry", label: "Warranty Expiry" }, { key: "status", label: "Status" }
    ], rows)
  );
  card.appendChild(simpleTable([
    { key: "assetId", label: "Asset ID" }, { key: "assetName", label: "Asset Name" },
    { key: "warrantyExpiry", label: "Warranty Expiry" }, { key: "status", label: "Status" }
  ], rows));
  return card;
}

// -----------------------------------------------------------------------
function repairSpendSection(repairs, vendorNames, state) {
  const byVendor = {};
  repairs.forEach((r) => {
    const name = vendorNames[r.vendorId] || "Unknown Vendor";
    if (!byVendor[name]) byVendor[name] = { vendor: name, repairCount: 0, totalSpend: 0 };
    byVendor[name].repairCount += 1;
    byVendor[name].totalSpend += Number(r.actualCost ?? r.estimatedCost ?? 0);
  });
  const rows = Object.values(byVendor).map((v) => ({ ...v, totalSpend: formatCurrency(v.totalSpend) }));

  const card = sectionCard(`Repair Spend by Vendor (${repairs.length} repairs)`, () =>
    downloadCSV(`repair-spend-${state.activeCentreId}`, [
      { key: "vendor", label: "Vendor" }, { key: "repairCount", label: "Repairs" }, { key: "totalSpend", label: "Total Spend" }
    ], rows)
  );
  card.appendChild(simpleTable([
    { key: "vendor", label: "Vendor" }, { key: "repairCount", label: "Repairs" }, { key: "totalSpend", label: "Total Spend" }
  ], rows));
  return card;
}

// -----------------------------------------------------------------------
function disposalHistorySection(disposals, state) {
  const rows = disposals.map((d) => ({
    assetId: d.assetIdLabel,
    reason: d.reason,
    status: d.status[0].toUpperCase() + d.status.slice(1),
    requestedBy: d.requestedByName,
    decidedAt: d.decidedAt ? formatDate(d.decidedAt.toDate ? d.decidedAt.toDate() : d.decidedAt) : "—"
  }));

  const card = sectionCard("Disposal History", () =>
    downloadCSV(`disposal-history-${state.activeCentreId}`, [
      { key: "assetId", label: "Asset ID" }, { key: "reason", label: "Reason" }, { key: "status", label: "Status" },
      { key: "requestedBy", label: "Requested By" }, { key: "decidedAt", label: "Decided" }
    ], rows)
  );
  card.appendChild(simpleTable([
    { key: "assetId", label: "Asset ID" }, { key: "reason", label: "Reason" }, { key: "status", label: "Status" },
    { key: "requestedBy", label: "Requested By" }, { key: "decidedAt", label: "Decided" }
  ], rows));
  return card;
}

// -----------------------------------------------------------------------
function labelBacklogSection(assets, state) {
  const rows = assets.filter((a) => a.labelReprintRequired).map((a) => ({ assetId: a.assetId, assetName: a.assetName }));

  const card = sectionCard(`Label Reprint Backlog (${rows.length})`, () =>
    downloadCSV(`label-backlog-${state.activeCentreId}`, [
      { key: "assetId", label: "Asset ID" }, { key: "assetName", label: "Asset Name" }
    ], rows)
  );
  card.appendChild(simpleTable([
    { key: "assetId", label: "Asset ID" }, { key: "assetName", label: "Asset Name" }
  ], rows));
  return card;
}
