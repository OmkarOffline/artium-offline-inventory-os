// =============================================================================
// Inventory OS — Register View
// Chapter 8: search, filter, sort, configurable columns, saved views, CSV
// export, click-through to Asset Profile. Filters/sort/columns and the last
// room filter persist per-user via workspace.js (Milestone 5) so they follow
// the user across sessions and devices, not just within one browser tab.
// =============================================================================

import { db } from "./firebase.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, formatDate, formatCurrency, statusBadge, renderEmptyState, debounce, roomDisplayName } from "./utils.js";
import { CLOSE_ICON } from "./icons.js";
import { openAddAssetModal } from "./addAsset.js";
import { openAssetProfile } from "./assetProfile.js";
import { downloadCSV } from "./csv.js";
import { getRegisterPrefs, saveRegisterPrefs, listSavedViews, saveView, deleteView } from "./workspace.js";
import { getRoomsForCentre, getVendors } from "./refcache.js";

const COLUMNS = [
  { key: "assetId", label: "Asset ID", locked: true },
  { key: "assetName", label: "Asset Name", locked: true },
  { key: "brand", label: "Brand" },
  { key: "roomName", label: "Room" },
  { key: "currentCustodian", label: "Custodian" },
  { key: "currentStatus", label: "Status" },
  { key: "purchaseDate", label: "Purchase Date" },
  { key: "purchaseCost", label: "Purchase Cost" },
  { key: "vendorName", label: "Vendor" }
];
const ALL_COLUMN_KEYS = COLUMNS.map((c) => c.key);

let sortState = { key: "assetId", dir: "asc" };
let searchTerm = "";
let visibleColumns = [...ALL_COLUMN_KEYS];
let prefsAppliedThisSession = false;

export async function renderRegister(container, state) {
  container.innerHTML = "";

  if (!state.activeCentreId) {
    renderEmptyState(container, {
      title: "No centre selected",
      subtitle: "Assign yourself a centre, or ask an Owner to, before assets can be shown here."
    });
    return;
  }

  // Seed from persisted preferences exactly once per session — after that,
  // the explicit "×" on the room-filter chip and the in-page controls are
  // the source of truth, not what was saved last time.
  if (!prefsAppliedThisSession) {
    prefsAppliedThisSession = true;
    const saved = getRegisterPrefs(state);
    if (saved) {
      searchTerm = saved.searchTerm || "";
      if (saved.sortKey) sortState = { key: saved.sortKey, dir: saved.sortDir || "asc" };
      if (saved.columns?.length) visibleColumns = saved.columns.filter((k) => ALL_COLUMN_KEYS.includes(k));
      if (!state.registerRoomFilter && saved.roomFilterId) {
        state.registerRoomFilter = { id: saved.roomFilterId, name: saved.roomFilterName };
      }
    }
  }

  const header = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap;" }, [
    el("div", { class: "search-wrap", style: "max-width:340px;" }, [
      el("input", {
        type: "text", placeholder: "Search this centre's assets…", id: "registerSearch", value: searchTerm,
        oninput: debounce((e) => {
          searchTerm = e.target.value.toLowerCase();
          load();
          saveRegisterPrefs(state, { searchTerm });
        }, 200)
      })
    ]),
    el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;" }, [
      savedViewsControl(state, () => load()),
      columnsControl(state, () => load()),
      el("button", { class: "btn btn-secondary btn-sm", onclick: () => exportCurrentView() }, "Export CSV"),
      el("button", { class: "btn btn-primary btn-sm", onclick: () => openAddAssetModal(state, () => load()) }, "+ Add Asset")
    ])
  ]);
  container.appendChild(header);

  const filterChipRow = el("div", { id: "registerFilterChips", style: "margin-bottom:10px;" });
  container.appendChild(filterChipRow);
  renderFilterChip();

  function renderFilterChip() {
    filterChipRow.innerHTML = "";
    if (!state.registerRoomFilter) return;
    filterChipRow.appendChild(el("div", { class: "filter-chip" }, [
      `Room: ${roomDisplayName(state.registerRoomFilter.name)}`,
      el("span", {
        class: "chip-remove", role: "button", tabindex: "0", "aria-label": "Remove room filter",
        onclick: () => {
          state.registerRoomFilter = null;
          renderFilterChip();
          load();
          saveRegisterPrefs(state, { roomFilterId: null, roomFilterName: null });
        },
        onkeydown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          state.registerRoomFilter = null;
          renderFilterChip();
          load();
          saveRegisterPrefs(state, { roomFilterId: null, roomFilterName: null });
        }
      }, " ×")
    ]));
  }

  const tableWrap = el("div", { id: "registerTableWrap" });
  container.appendChild(tableWrap);

  let currentAssets = [];

  async function load() {
    tableWrap.innerHTML = "<div style=\"padding:20px;color:var(--text-faint);font-size:12.5px;\">Loading…</div>";

    const [assetsSnap, rooms, vendors] = await Promise.all([
      getDocs(query(collection(db, "assets"), where("centreId", "==", state.activeCentreId))),
      getRoomsForCentre(state.activeCentreId),
      getVendors()
    ]);

    const roomNames = Object.fromEntries(rooms.map((r) => [r.id, roomDisplayName(r.name)]));
    const vendorNames = Object.fromEntries(vendors.map((v) => [v.id, v.companyName]));

    let assets = assetsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        roomName: roomNames[data.roomId] || "—",
        vendorName: vendorNames[data.vendorId] || "—"
      };
    });

    if (state.registerRoomFilter) {
      assets = assets.filter((a) => a.roomId === state.registerRoomFilter.id);
    }

    if (searchTerm) {
      assets = assets.filter((a) => {
        const haystack = [a.assetId, a.assetName, a.brand, a.model, a.manufacturerSerialNumber, a.currentCustodian, a.remarks]
          .join(" ").toLowerCase();
        return haystack.includes(searchTerm);
      });
    }

    assets.sort((a, b) => {
      const av = (a[sortState.key] ?? "").toString().toLowerCase();
      const bv = (b[sortState.key] ?? "").toString().toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortState.dir === "asc" ? cmp : -cmp;
    });

    currentAssets = assets;

    tableWrap.innerHTML = "";
    if (!assets.length) {
      renderEmptyState(tableWrap, {
        title: searchTerm ? "No assets match your search" : "No assets in this centre yet",
        subtitle: searchTerm ? "Try a different search term." : "Add the first asset to get started.",
        actionLabel: searchTerm ? null : "Add Asset",
        onAction: searchTerm ? null : () => openAddAssetModal(state, () => load())
      });
      return;
    }

    tableWrap.appendChild(buildTable(assets, state, load));
  }

  function exportCurrentView() {
    if (!currentAssets.length) return;
    const cols = COLUMNS.filter((c) => visibleColumns.includes(c.key));
    const rows = currentAssets.map((a) => ({
      assetId: a.assetId, assetName: a.assetName, brand: a.brand, roomName: a.roomName,
      currentCustodian: a.currentCustodian || "—", currentStatus: statusBadge(a.currentStatus).label,
      purchaseDate: formatDate(a.purchaseDate), purchaseCost: a.purchaseCost ?? "", vendorName: a.vendorName
    }));
    downloadCSV(`register-${state.activeCentreId}`, cols, rows);
  }

  await load();
}

function buildTable(assets, state, reload) {
  const cols = COLUMNS.filter((c) => visibleColumns.includes(c.key));
  const table = el("table", { style: "width:100%;border-collapse:collapse;font-size:12.5px;" });
  const thead = el("thead", {}, [
    el("tr", {}, cols.map((col) => headerCell(col, reload, state)))
  ]);
  const tbody = el("tbody", {}, assets.map((asset) => rowFor(asset, state, reload, cols)));
  table.appendChild(thead);
  table.appendChild(tbody);
  return el("div", { class: "table-scroll" }, [table]);
}

function headerCell(col, reload, state) {
  const arrow = sortState.key === col.key ? (sortState.dir === "asc" ? " ↑" : " ↓") : "";
  return el("th", {
    style: "text-align:left;padding:9px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint);border-bottom:1px solid var(--border);cursor:pointer;user-select:none;",
    onclick: () => {
      if (sortState.key === col.key) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      else sortState = { key: col.key, dir: "asc" };
      reload();
      saveRegisterPrefs(state, { sortKey: sortState.key, sortDir: sortState.dir });
    }
  }, col.label + arrow);
}

function rowFor(asset, state, reload, cols) {
  const badge = statusBadge(asset.currentStatus);
  const cellRenderers = {
    assetId: () => el("td", { style: "padding:9px 10px;color:var(--text-dim);" }, [
      asset.assetId,
      asset.labelReprintRequired
        ? el("span", { title: "Label Reprint Required", style: "display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--purple);margin-left:6px;vertical-align:middle;" })
        : null
    ].filter(Boolean)),
    assetName: () => cell(asset.assetName),
    brand: () => cell(asset.brand),
    roomName: () => cell(asset.roomName),
    currentCustodian: () => cell(asset.currentCustodian || "—"),
    currentStatus: () => el("td", { style: "padding:9px 10px;" }, [
      el("span", { class: `badge badge-${badge.color}` }, [el("span", { class: "badge-dot" }), badge.label])
    ]),
    purchaseDate: () => cell(formatDate(asset.purchaseDate)),
    purchaseCost: () => cell(formatCurrency(asset.purchaseCost)),
    vendorName: () => cell(asset.vendorName)
  };

  const tr = el("tr", {
    style: "border-bottom:1px solid var(--border-soft);cursor:pointer;transition:background .1s ease;",
    onclick: () => openAssetProfile(asset.id, state, reload),
    onmouseenter: (e) => e.currentTarget.style.background = "var(--bg-hover)",
    onmouseleave: (e) => e.currentTarget.style.background = "transparent"
  }, cols.map((col) => cellRenderers[col.key]()));
  return tr;
}

function cell(text) {
  return el("td", { style: "padding:9px 10px;color:var(--text-dim);" }, text || "—");
}

// -----------------------------------------------------------------------
// Column visibility popover
// -----------------------------------------------------------------------
function columnsControl(state, onChange) {
  const wrap = el("div", { style: "position:relative;" });
  const btn = el("button", { class: "btn btn-secondary btn-sm" }, "Columns");
  const popover = el("div", {
    style: "display:none;position:absolute;top:calc(100% + 6px);left:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.18));padding:8px;z-index:50;min-width:180px;"
  });
  wrap.appendChild(btn);
  wrap.appendChild(popover);

  let open = false;
  function renderPopover() {
    popover.innerHTML = "";
    COLUMNS.forEach((col) => {
      const checked = visibleColumns.includes(col.key);
      popover.appendChild(el("label", { style: "display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim);padding:4px 2px;" }, [
        el("input", {
          type: "checkbox", checked: checked ? "checked" : null, disabled: col.locked ? "disabled" : null,
          onchange: (e) => {
            if (e.target.checked) visibleColumns = [...visibleColumns, col.key];
            else visibleColumns = visibleColumns.filter((k) => k !== col.key);
            onChange();
            saveRegisterPrefs(state, { columns: visibleColumns });
          }
        }),
        col.label
      ]));
    });
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open = !open;
    popover.style.display = open ? "block" : "none";
    if (open) renderPopover();
  });
  document.addEventListener("click", (e) => {
    if (open && !wrap.contains(e.target)) { open = false; popover.style.display = "none"; }
  });

  return wrap;
}

// -----------------------------------------------------------------------
// Saved Views popover — save the current search/sort/room filter/columns
// as a named preset, or apply/delete an existing one.
// -----------------------------------------------------------------------
function savedViewsControl(state, onChange) {
  const wrap = el("div", { style: "position:relative;" });
  const btn = el("button", { class: "btn btn-secondary btn-sm" }, "Saved Views");
  const popover = el("div", {
    style: "display:none;position:absolute;top:calc(100% + 6px);left:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.18));padding:8px;z-index:50;min-width:220px;"
  });
  wrap.appendChild(btn);
  wrap.appendChild(popover);

  let open = false;

  function applyView(v) {
    searchTerm = v.searchTerm || "";
    sortState = { key: v.sortKey || "assetId", dir: v.sortDir || "asc" };
    visibleColumns = v.columns?.length ? v.columns : [...ALL_COLUMN_KEYS];
    state.registerRoomFilter = v.roomFilterId ? { id: v.roomFilterId, name: v.roomFilterName } : null;
    closePopover();
    state.navigateTo("register", state.registerRoomFilter ? { roomId: state.registerRoomFilter.id, roomName: state.registerRoomFilter.name } : {});
  }

  function renderPopover() {
    popover.innerHTML = "";
    const views = listSavedViews(state);
    popover.appendChild(el("button", {
      class: "btn btn-primary btn-sm", style: "width:100%;margin-bottom:6px;",
      onclick: () => { closePopover(); openSaveViewModal(state, onChange); }
    }, "+ Save Current as View"));

    if (!views.length) {
      popover.appendChild(el("div", { style: "font-size:11.5px;color:var(--text-faint);padding:4px 2px;" }, "No saved views yet."));
      return;
    }
    views.forEach((v) => {
      popover.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 2px;" }, [
        el("span", {
          style: "font-size:12px;color:var(--text-dim);cursor:pointer;", role: "button", tabindex: "0", "aria-label": `Apply saved view ${v.name}`,
          onclick: () => applyView(v),
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applyView(v); } }
        }, v.name),
        el("span", {
          style: "cursor:pointer;color:var(--text-faint);font-size:12px;", role: "button", tabindex: "0", "aria-label": `Delete saved view ${v.name}`,
          onclick: async () => { await deleteView(state, v.id); renderPopover(); },
          onkeydown: async (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); await deleteView(state, v.id); renderPopover(); } }
        }, "×")
      ]));
    });
  }

  function closePopover() { open = false; popover.style.display = "none"; }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open = !open;
    popover.style.display = open ? "block" : "none";
    if (open) renderPopover();
  });
  document.addEventListener("click", (e) => {
    if (open && !wrap.contains(e.target)) closePopover();
  });

  return wrap;
}

function openSaveViewModal(state, onChange) {
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const nameInput = el("input", { class: "field-input", type: "text", placeholder: "e.g. My Room, Under Repair" });
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Save Current View"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "View Name"), nameInput])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        const name = nameInput.value.trim();
        if (!name) return;
        e.target.disabled = true;
        await saveView(state, {
          name,
          searchTerm,
          sortKey: sortState.key,
          sortDir: sortState.dir,
          roomFilterId: state.registerRoomFilter?.id || null,
          roomFilterName: state.registerRoomFilter?.name || null,
          columns: visibleColumns
        });
        overlay.remove();
        if (onChange) onChange();
      } }, "Save")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
