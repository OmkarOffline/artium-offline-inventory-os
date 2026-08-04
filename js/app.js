// =============================================================================
// Inventory OS — App Shell Bootstrap
// Owns: sidebar render/collapse state, top-level navigation, topbar (user
// menu, centre context), and dispatching to each module's render function.
// Individual modules (register.js, vendors.js, etc.) own their own screen
// content — app.js only owns the shell around them.
// =============================================================================

import { requireAuth, signOutUser, ROLES } from "./auth.js";
import { db, IS_FIREBASE_CONFIGURED } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, renderEmptyState } from "./utils.js";
import { renderDashboard } from "./dashboard.js";
import { renderRegister } from "./register.js";
import { renderVendorDirectory } from "./vendors.js";
import { renderAuditsPage } from "./audits.js";
import { renderDisposalRequestsPage } from "./disposal.js";
import { mountNotificationBell } from "./notifications.js";
import { renderReportsPage } from "./reports.js";
import { renderSettingsPage } from "./settings.js";
import { renderUsersPage } from "./users.js";
import { getLastActiveCentreId, saveLastActiveCentreId } from "./workspace.js";
import { SIGNOUT_ICON } from "./icons.js";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: iconHome() },
  { id: "register", label: "Register", icon: iconGrid() },
  { id: "vendors", label: "Vendor Directory", icon: iconTruck() },
  { id: "audits", label: "Audits", icon: iconCheckShield() },
  { id: "disposals", label: "Disposal Requests", icon: iconTrash() },
  { id: "reports", label: "Reports", icon: iconChart() },
  { id: "users", label: "Users", icon: iconUsers(), ownerOnly: true },
  { id: "settings", label: "Settings", icon: iconSettings() }
];

const SIDEBAR_STATE_KEY = "inventoryos.sidebarCollapsed";

let state = {
  profile: null,
  activePage: "dashboard",
  centres: [],
  activeCentreId: null,
  registerRoomFilter: null,
  navigateTo: (pageId, params) => navigateTo(pageId, params)
};

requireAuth((profile) => {
  state.profile = profile;
  boot();
});

// -----------------------------------------------------------------------
// Global Escape-to-close — every modal and side panel across the app is
// built the same two ways (.modal-overlay.show, .overlay.show for panels),
// so one listener here covers all of them rather than repeating the same
// keydown handler in every module that opens one (Chapter 12: consistent
// interaction patterns, not reinvented per screen).
// -----------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const topModal = document.querySelectorAll(".modal-overlay.show");
  if (topModal.length) { topModal[topModal.length - 1].remove(); return; }
  const topPanelOverlay = document.querySelector(".overlay.show");
  if (topPanelOverlay) topPanelOverlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});

async function boot() {
  renderShell();
  await loadCentres();
  renderCentreSwitcher();
  navigateTo("dashboard");
}

function renderCentreSwitcher() {
  const wrap = document.getElementById("centreSwitcher");
  wrap.innerHTML = "";
  const accessibleCentres = state.profile.role === ROLES.OWNER
    ? state.centres
    : state.centres.filter((c) => state.profile.assignedCentres?.includes(c.id));

  if (accessibleCentres.length <= 1) return; // Nothing to switch between.

  const select = el("select", { class: "field-input", style: "width:auto;max-width:220px;", id: "centreSwitchSelect", "aria-label": "Switch centre" });
  accessibleCentres.forEach((c) => select.appendChild(new Option(c.name, c.id)));
  select.value = state.activeCentreId;
  select.addEventListener("change", (e) => {
    state.activeCentreId = e.target.value;
    saveLastActiveCentreId(state, e.target.value);
    navigateTo(state.activePage);
  });
  wrap.appendChild(select);
}

function renderShell() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const collapsed = localStorage.getItem(SIDEBAR_STATE_KEY) === "1";

  const sidebar = el("div", { class: `sidebar${collapsed ? " collapsed" : ""}`, id: "sidebar" }, [
    el("div", { class: "sidebar-brand" }, [
      el("div", { class: "brand-mark" }, "IOS"),
      el("div", { class: "brand-text" }, [
        el("div", { class: "brand-title" }, "Inventory OS"),
        el("div", { class: "brand-sub" }, "Artium Academy")
      ])
    ]),
    el("div", { class: "sidebar-section" }, [
      el("div", { class: "sidebar-label" }, "Menu"),
      el("div", { class: "nav-list", id: "navList" })
    ]),
    el("div", { class: "sidebar-footer" }, [
      el("button", { class: "sidebar-collapse-btn", id: "collapseBtn", "aria-label": collapsed ? "Expand sidebar" : "Collapse sidebar" }, collapsed ? "Expand" : "Collapse")
    ])
  ]);

  const main = el("div", { class: "main" }, [
    el("div", { class: "topbar" }, [
      el("div", { class: "topbar-title" }, [
        el("h1", { id: "pageTitle" }, "Dashboard"),
        el("div", { class: "meta", id: "pageMeta" }, "")
      ]),
      el("div", { id: "centreSwitcher" }),
      el("div", { class: "search-wrap" }, [
        el("span", { html: iconSearch() }),
        el("input", { type: "text", placeholder: "Search assets, vendors, custodians…", id: "globalSearchInput", "aria-label": "Search assets, vendors, custodians" }),
        el("span", { class: "kbd" }, "⌘K")
      ]),
      el("div", { class: "topbar-actions", id: "topbarActions" }, [
        el("div", { id: "notifBellSlot" }),
        el("div", { class: "owner-avatar", id: "userAvatar", title: state.profile.displayName || state.profile.email }, initials(state.profile)),
        el("button", { class: "btn btn-ghost btn-sm", id: "signOutBtn", "aria-label": "Sign out" }, [
          el("img", { src: SIGNOUT_ICON, alt: "", class: "icon-img", loading: "lazy" }),
          "Sign out"
        ])
      ])
    ]),
    el("div", { class: "content", id: "content" })
  ]);

  app.appendChild(sidebar);
  app.appendChild(main);

  renderNav();
  mountNotificationBell(document.getElementById("notifBellSlot"), state);

  document.getElementById("collapseBtn").addEventListener("click", toggleSidebar);
  document.getElementById("signOutBtn").addEventListener("click", async () => {
    await signOutUser();
    window.location.href = "login.html";
  });
}

function renderNav() {
  const navList = document.getElementById("navList");
  navList.innerHTML = "";
  NAV_ITEMS.forEach((item) => {
    if (item.ownerOnly && state.profile.role !== ROLES.OWNER) return;
    const btn = el("button", {
      class: `nav-item${state.activePage === item.id ? " active" : ""}`,
      onclick: () => navigateTo(item.id)
    }, [
      el("span", { class: "nav-icon" , html: item.icon }),
      el("span", { class: "nav-label" }, item.label),
      el("span", { class: "nav-tooltip" }, item.label)
    ]);
    navList.appendChild(btn);
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const collapsed = sidebar.classList.toggle("collapsed");
  localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? "1" : "0");
  const btn = document.getElementById("collapseBtn");
  btn.textContent = collapsed ? "Expand" : "Collapse";
  btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
}

async function loadCentres() {
  if (!IS_FIREBASE_CONFIGURED) {
    state.centres = [];
    return;
  }
  try {
    const snap = await getDocs(collection(db, "centres"));
    state.centres = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[app] Failed to load centres:", err);
    state.centres = [];
  }
  const accessibleCentres = state.profile.role === ROLES.OWNER
    ? state.centres
    : state.centres.filter((c) => state.profile.assignedCentres?.includes(c.id));

  // Prefer the last centre this user actually worked in, if it's still one
  // they can access — this is what makes the choice follow them across
  // sessions and devices instead of always resetting to the first centre.
  const remembered = getLastActiveCentreId(state);
  if (remembered && accessibleCentres.some((c) => c.id === remembered)) {
    state.activeCentreId = remembered;
  } else if (accessibleCentres.length) {
    state.activeCentreId = accessibleCentres[0].id;
  }
}

function navigateTo(pageId, params = {}) {
  state.activePage = pageId;
  if (pageId === "register") {
    state.registerRoomFilter = params.roomId ? { id: params.roomId, name: params.roomName } : null;
  }
  renderNav();

  const item = NAV_ITEMS.find((n) => n.id === pageId);
  document.getElementById("pageTitle").textContent = item ? item.label : "Dashboard";
  document.getElementById("pageMeta").textContent = roleLabel(state.profile.role);

  const content = document.getElementById("content");
  content.innerHTML = "";
  // Retrigger the fade-in on every navigation (removing then re-adding the
  // class forces the browser to restart the CSS animation from scratch).
  content.classList.remove("page-fade");
  void content.offsetWidth;
  content.classList.add("page-fade");

  if (pageId === "dashboard") {
    renderDashboard(content, state);
    return;
  }
  if (pageId === "register") {
    renderRegister(content, state);
    return;
  }
  if (pageId === "vendors") {
    renderVendorDirectory(content, state);
    return;
  }
  if (pageId === "audits") {
    renderAuditsPage(content, state);
    return;
  }
  if (pageId === "disposals") {
    renderDisposalRequestsPage(content, state);
    return;
  }
  if (pageId === "reports") {
    renderReportsPage(content, state);
    return;
  }
  if (pageId === "settings") {
    renderSettingsPage(content, state);
    return;
  }
  if (pageId === "users") {
    renderUsersPage(content, state);
    return;
  }

  renderEmptyState(content, {
    title: `${item.label} arrives in a later milestone`,
    subtitle: "This module is scoped and specified in the Product Blueprint but hasn't been built yet — it'll land in its planned milestone.",
  });
}

function roleLabel(role) {
  if (role === ROLES.OWNER) return "Owner";
  if (role === ROLES.CENTRE_ADMIN) return "Centre Admin";
  return "Viewer";
}

function initials(profile) {
  const source = profile.displayName || profile.email || "?";
  return source.trim().charAt(0).toUpperCase();
}

// ---------------------------------------------------------------------------
// Minimal inline SVG icon set (stroke-style placeholders). Swap for Launch
// OS's illustrated 3D sticker-style PNGs once those assets are shared —
// nothing else about the sidebar needs to change when that happens.
// ---------------------------------------------------------------------------
function svg(paths) {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
function iconHome() { return svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>'); }
function iconGrid() { return svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'); }
function iconTruck() { return svg('<rect x="1" y="7" width="13" height="9" rx="1.5"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="6" cy="18.5" r="1.6"/><circle cx="17.5" cy="18.5" r="1.6"/>'); }
function iconCheckShield() { return svg('<path d="M12 3l7 3v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6z"/><path d="M9 12l2 2 4-4"/>'); }
function iconChart() { return svg('<path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/>'); }
function iconUsers() { return svg('<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="8.5" r="2.6"/><path d="M15.5 14.2c2.9.4 5 2.6 5 5.8"/>'); }
function iconSettings() { return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z"/>'); }
function iconSearch() { return svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'); }
function iconTrash() { return svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'); }
