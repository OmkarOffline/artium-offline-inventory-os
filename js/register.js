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
import { listAssetTypes } from "./assetMaster.js";
import { assetTypeIconFor } from "./icons.js";

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

// Default: most recently purchased asset first — older assets sink to the
// bottom. A user can still click any column header to sort differently;
// this only governs what's shown before they've made their own choice.
let sortState = { key: "purchaseDate", dir: "desc" };
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

  // Drill-down view state — local to this render, so it always resets back
  // to the Asset Type grid whenever you navigate into the Register or a
  // Room fresh (grid is the "home" state; typeFilter/forceListView are how
  // you get to the flat table, either by clicking a tile or the List View
  // toggle).
  let typeFilter = null; // { code, name } once a tile has been clicked
  let forceListView = false;

  const gridListToggleBtn = el("button", { class: "btn btn-secondary btn-sm" }, "View as List");
  gridListToggleBtn.addEventListener("click", () => {
    forceListView = !forceListView;
    typeFilter = null;
    load();
  });

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
      gridListToggleBtn,
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
          typeFilter = null;
          renderFilterChip();
          load();
          saveRegisterPrefs(state, { roomFilterId: null, roomFilterName: null });
        },
        onkeydown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          state.registerRoomFilter = null;
          typeFilter = null;
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

  /**
   * The Register (and a room's asset list, which is just the Register with
   * a room filter applied) lands on an Asset Type grid first — "1
   * microphone, 1 upright stand, 1 Bluetooth speaker..." at a glance —
   * rather than a flat table. Clicking a tile, searching, or the List View
   * toggle drops into the familiar sortable/exportable table, scoped to
   * whatever got you there.
   */
  async function load() {
    tableWrap.innerHTML = "<div style=\"padding:20px;color:var(--text-faint);font-size:12.5px;\">Loading…</div>";

    const [assetsSnap, rooms, vendors, assetTypes] = await Promise.all([
      getDocs(query(collection(db, "assets"), where("centreId", "==", state.activeCentreId))),
      getRoomsForCentre(state.activeCentreId),
      getVendors(),
      listAssetTypes()
    ]);

    const roomNames = Object.fromEntries(rooms.map((r) => [r.id, roomDisplayName(r.name)]));
    const vendorNames = Object.fromEntries(vendors.map((v) => [v.id, v.companyName]));
    const typeNames = Object.fromEntries(assetTypes.map((t) => [t.code, t.name]));

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

    // The room/centre-scoped set, before search or a type-tile filter —
    // this is what the grid groups by type, and what gets exported when
    // there's nothing narrower currently on screen.
    const scopedAssets = assets;

    // Only meaningful at the "top level" (grid, or the forced full list) —
    // once you've drilled into one type via a tile, the breadcrumb below is
    // the way back, so hide this to avoid two controls doing similar things.
    gridListToggleBtn.style.display = (searchTerm || typeFilter) ? "none" : "";
    gridListToggleBtn.textContent = forceListView ? "View as Grid" : "View as List";

    tableWrap.innerHTML = "";

    if (!scopedAssets.length && !searchTerm) {
      currentAssets = [];
      const roomFiltered = !!state.registerRoomFilter;
      renderEmptyState(tableWrap, {
        title: roomFiltered
          ? `${roomDisplayName(state.registerRoomFilter.name)} is looking a little bare`
          : "No assets in this centre yet",
        subtitle: roomFiltered
          ? "Nothing's living here yet — add an asset, or transfer one in from another room."
          : "Add the first asset to get started.",
        actionLabel: "Add Asset",
        onAction: () => openAddAssetModal(state, () => load())
      });
      return;
    }

    // Grid view — the default landing state. Search and the List View
    // toggle both bypass it; clicking a tile sets typeFilter and re-loads
    // into list view scoped to that type.
    if (!searchTerm && !typeFilter && !forceListView) {
      currentAssets = scopedAssets;
      tableWrap.appendChild(buildTypeGrid(scopedAssets, typeNames, (group) => {
        typeFilter = group;
        load();
      }));
      return;
    }

    // List view — either from search, the List View toggle, or a clicked
    // Asset Type tile. Breadcrumb back to the grid only makes sense when
    // there's no active search (search already shows every match flatly).
    let listAssets = scopedAssets;
    if (typeFilter) listAssets = listAssets.filter((a) => a.assetTypeCode === typeFilter.code);
    if (searchTerm) {
      listAssets = listAssets.filter((a) => {
        const haystack = [a.assetId, a.assetName, a.brand, a.model, a.manufacturerSerialNumber, a.currentCustodian, a.remarks]
          .join(" ").toLowerCase();
        return haystack.includes(searchTerm);
      });
    }

    listAssets.sort((a, b) => {
      const av = (a[sortState.key] ?? "").toString().toLowerCase();
      const bv = (b[sortState.key] ?? "").toString().toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortState.dir === "asc" ? cmp : -cmp;
    });

    currentAssets = listAssets;

    if (!searchTerm && typeFilter) {
      tableWrap.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:10px;" }, [
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => { typeFilter = null; load(); } }, "‹ Asset Types"),
        el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);" }, `${typeFilter.name} (${typeFilter.code}) · ${listAssets.length} asset${listAssets.length === 1 ? "" : "s"}`)
      ]));
    } else if (!searchTerm && forceListView) {
      tableWrap.appendChild(el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:10px;" }, `All Assets · ${listAssets.length}`));
    }

    if (!listAssets.length) {
      renderEmptyState(tableWrap, {
        title: searchTerm ? "No assets match your search" : "No assets of this type",
        subtitle: searchTerm ? "Try a different search term." : "Nothing here yet.",
        actionLabel: searchTerm ? null : "Add Asset",
        onAction: searchTerm ? null : () => openAddAssetModal(state, () => load())
      });
      return;
    }

    tableWrap.appendChild(buildTable(listAssets, state, load));
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

/**
 * The Asset Type grid — groups the current scope (centre, or a room within
 * it) by assetTypeCode and shows a count per type, split into Assigned (has
 * a Current Custodian — a specific person responsible) vs In Stock (sitting
 * in the room, nobody named yet). No per-type icon set exists yet, so each
 * tile uses a plain code badge as a placeholder visual.
 */
function buildTypeGrid(assets, typeNames, onSelect) {
  const groups = {};
  assets.forEach((a) => {
    const code = a.assetTypeCode || "—";
    if (!groups[code]) groups[code] = { code, name: typeNames[code] || code, items: [] };
    groups[code].items.push(a);
  });

  const tiles = Object.values(groups)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => {
      const total = g.items.length;
      const assigned = g.items.filter((a) => a.currentCustodian).length;
      const inStock = total - assigned;
      const iconUrl = assetTypeIconFor(g.name);
      const visual = iconUrl
        ? el("div", { style: "width:52px;height:52px;border-radius:var(--radius-sm);background:var(--bg-input);border:1px solid var(--border-soft);overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;" }, [
            el("img", { src: iconUrl, alt: "", style: "width:100%;height:100%;object-fit:cover;", loading: "lazy" })
          ])
        : el("div", {
            style: "width:52px;height:52px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;letter-spacing:-.02em;flex:none;"
          }, g.code);
      return el("div", {
        style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;transition:box-shadow .15s ease, transform .1s ease;display:flex;flex-direction:column;gap:12px;",
        role: "button", tabindex: "0", "aria-label": `View ${g.name}`,
        onclick: () => onSelect(g),
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g); } },
        onmouseenter: (e) => { e.currentTarget.style.boxShadow = "var(--emboss-hover)"; e.currentTarget.style.transform = "translateY(-1px)"; },
        onmouseleave: (e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }
      }, [
        el("div", { style: "display:flex;align-items:center;gap:10px;" }, [
          visual,
          el("div", { style: "min-width:0;" }, [
            el("div", { style: "font-size:13px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" }, g.name),
            el("div", { style: "font-size:11px;color:var(--text-faint);" }, `${total} asset${total === 1 ? "" : "s"}`)
          ])
        ]),
        el("div", { style: "display:flex;gap:10px;font-size:11px;padding-top:8px;border-top:1px solid var(--border-soft);" }, [
          el("span", { style: "color:var(--green);font-weight:700;" }, `${assigned} assigned`),
          el("span", { style: "color:var(--blue);font-weight:700;" }, `${inStock} in stock`)
        ])
      ]);
    });

  return el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;" }, tiles);
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
