// =============================================================================
// Inventory OS — Global Search (topbar)
// The topbar has always had a "Search assets, vendors, custodians…" box with
// a ⌘K hint, but it was never wired to anything — pure decoration. This
// module makes it real: debounced search across the active centre's assets
// (by Asset ID, name, brand, model, serial, custodian) and vendors (by
// company name, contact person), rendered as a dropdown under the box.
// Picking a result opens the same Asset Profile / Vendor Profile panels
// used everywhere else in the app — no separate "search results page".
// =============================================================================

import { db } from "./firebase.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getVendors } from "./refcache.js";
import { openVendorProfile } from "./vendors.js";

const MAX_ASSET_RESULTS = 6;
const MAX_VENDOR_RESULTS = 4;
const DEBOUNCE_MS = 250;

export function mountGlobalSearch(state) {
  const input = document.getElementById("globalSearchInput");
  const shell = input?.closest(".search-wrap");
  if (!input || !shell) return; // topbar not mounted yet — nothing to wire up.

  shell.style.position = "relative";

  const dropdown = document.createElement("div");
  dropdown.setAttribute("role", "listbox");
  dropdown.style.cssText = "display:none;position:absolute;top:calc(100% + 8px);left:0;right:0;max-height:420px;overflow-y:auto;background:var(--bg-card,#fff);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.18));z-index:70;padding:6px;";
  shell.appendChild(dropdown);

  let debounceTimer = null;
  let requestToken = 0;
  let open = false;

  function closeDropdown() {
    open = false;
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  }

  function showDropdown() {
    open = true;
    dropdown.style.display = "block";
  }

  // Asset Profile is loaded lazily (dynamic import) purely to avoid pulling
  // its whole dependency chain into every page load just for the topbar.
  async function openAsset(assetId) {
    const { openAssetProfile } = await import("./assetProfile.js");
    closeDropdown();
    input.value = "";
    openAssetProfile(assetId, state, () => {});
  }

  function openVendor(vendor) {
    closeDropdown();
    input.value = "";
    openVendorProfile(vendor, state, () => {});
  }

  async function runSearch(term) {
    const token = ++requestToken;
    dropdown.innerHTML = "<div style=\"font-size:12px;color:var(--text-faint);padding:10px;\">Searching…</div>";
    showDropdown();

    let assets = [];
    try {
      if (state.activeCentreId) {
        const snap = await getDocs(query(collection(db, "assets"), where("centreId", "==", state.activeCentreId)));
        assets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
    } catch (err) {
      console.error("[globalSearch] Failed to load assets:", err);
    }

    let vendors = [];
    try {
      vendors = await getVendors();
    } catch (err) {
      console.error("[globalSearch] Failed to load vendors:", err);
    }

    if (token !== requestToken) return; // a newer keystroke superseded this search

    const needle = term.toLowerCase();
    const matchedAssets = assets.filter((a) =>
      [a.assetId, a.assetName, a.brand, a.model, a.manufacturerSerialNumber, a.currentCustodian]
        .filter(Boolean).join(" ").toLowerCase().includes(needle)
    ).slice(0, MAX_ASSET_RESULTS);

    const matchedVendors = vendors.filter((v) =>
      [v.companyName, v.contactPerson].filter(Boolean).join(" ").toLowerCase().includes(needle)
    ).slice(0, MAX_VENDOR_RESULTS);

    render(matchedAssets, matchedVendors, term);
  }

  function resultRow(title, sub, onClick) {
    const row = document.createElement("div");
    row.setAttribute("role", "option");
    row.style.cssText = "padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;";
    row.innerHTML = `<div style="font-size:12.5px;font-weight:600;color:var(--text);">${escapeHtml(title)}</div><div style="font-size:11px;color:var(--text-faint);margin-top:1px;">${escapeHtml(sub)}</div>`;
    row.addEventListener("mouseenter", () => { row.style.background = "var(--bg-hover, var(--bg-input))"; });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    row.addEventListener("click", onClick);
    return row;
  }

  function sectionLabel(text) {
    const div = document.createElement("div");
    div.style.cssText = "font-size:10.5px;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;padding:6px 10px 4px;";
    div.textContent = text;
    return div;
  }

  function render(matchedAssets, matchedVendors, term) {
    dropdown.innerHTML = "";

    if (!matchedAssets.length && !matchedVendors.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "font-size:12px;color:var(--text-faint);padding:12px 10px;";
      empty.textContent = state.activeCentreId
        ? `No assets or vendors match "${term}".`
        : `No vendors match "${term}". Select a centre to also search its assets.`;
      dropdown.appendChild(empty);
      return;
    }

    if (matchedAssets.length) {
      dropdown.appendChild(sectionLabel("Assets"));
      matchedAssets.forEach((a) => {
        dropdown.appendChild(resultRow(
          a.assetName || a.assetId,
          `${a.assetId}${a.currentCustodian ? " · " + a.currentCustodian : ""}`,
          () => openAsset(a.id)
        ));
      });
    }

    if (matchedVendors.length) {
      dropdown.appendChild(sectionLabel("Vendors"));
      matchedVendors.forEach((v) => {
        dropdown.appendChild(resultRow(
          v.companyName,
          [v.vendorType, v.contactPerson].filter(Boolean).join(" · ") || "Vendor",
          () => openVendor(v)
        ));
      });
    }
  }

  input.addEventListener("input", (e) => {
    const term = e.target.value.trim();
    clearTimeout(debounceTimer);
    if (!term) { closeDropdown(); return; }
    debounceTimer = setTimeout(() => runSearch(term), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDropdown(); input.blur(); }
  });

  document.addEventListener("click", (e) => {
    if (open && !shell.contains(e.target)) closeDropdown();
  });

  // ⌘K / Ctrl+K focuses search from anywhere in the app, matching the hint
  // already shown in the box.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
