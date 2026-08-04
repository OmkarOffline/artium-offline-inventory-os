// =============================================================================
// Inventory OS — Dashboard Module
// Now backed by real Firestore data: room cards with live counts, quick
// stats computed from the active centre's assets, and a real recent
// activity feed. Room cards click through to the Register pre-filtered to
// that room (Chapter 2's primary navigation pattern).
// =============================================================================

import { db } from "./firebase.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, renderEmptyState, formatDateTime } from "./utils.js";
import { listRecentActivity } from "./activity.js";
import { roomIconFor } from "./icons.js";
import { getRoomsForCentre } from "./refcache.js";

export async function renderDashboard(container, state) {
  container.innerHTML = "";

  if (!state.activeCentreId) {
    renderEmptyState(container, {
      title: "No centre assigned",
      subtitle: "Ask an Owner to assign you to a centre before Dashboard data can be shown."
    });
    return;
  }

  const statGrid = el("div", { class: "stat-grid", id: "dashboardStats" }, [
    statCard("Active Assets", "…", ""),
    statCard("Under Repair", "…", "amber"),
    statCard("Pending Disposal", "…", "red"),
    statCard("Warranty Expiring (30d)", "…", "blue"),
    statCard("Labels to Reprint", "…", "purple")
  ]);

  const roomSection = el("div", {}, [
    sectionHeader("Rooms"),
    el("div", { class: "card-grid", id: "roomCardGrid" })
  ]);

  const activitySection = el("div", {}, [
    sectionHeader("Recent Activity"),
    el("div", { id: "recentActivity" })
  ]);

  container.appendChild(statGrid);
  container.appendChild(el("div", { style: "height:20px" }));
  container.appendChild(roomSection);
  container.appendChild(el("div", { style: "height:20px" }));
  container.appendChild(activitySection);

  const assetsSnap = await getDocs(query(collection(db, "assets"), where("centreId", "==", state.activeCentreId)));
  const assets = assetsSnap.docs.map((d) => d.data());
  renderStats(assets);

  await renderRoomCards(document.getElementById("roomCardGrid"), state, assets);
  await renderActivity(document.getElementById("recentActivity"), state);
}

function renderStats(assets) {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const active = assets.filter((a) => a.currentStatus === "active").length;
  const underRepair = assets.filter((a) => a.currentStatus === "under_repair").length;
  const pendingDisposal = assets.filter((a) => a.currentStatus === "pending_disposal").length;
  const warrantyExpiring = assets.filter((a) => {
    if (!a.warrantyApplicable || !a.warrantyExpiry) return false;
    const expiry = new Date(a.warrantyExpiry);
    return expiry >= now && expiry <= in30Days;
  }).length;
  const labelsToReprint = assets.filter((a) => a.labelReprintRequired).length;

  const grid = document.getElementById("dashboardStats");
  grid.innerHTML = "";
  grid.appendChild(statCard("Active Assets", String(active), ""));
  grid.appendChild(statCard("Under Repair", String(underRepair), "amber"));
  grid.appendChild(statCard("Pending Disposal", String(pendingDisposal), "red"));
  grid.appendChild(statCard("Warranty Expiring (30d)", String(warrantyExpiring), "blue"));
  grid.appendChild(statCard("Labels to Reprint", String(labelsToReprint), "purple"));
}

async function renderRoomCards(container, state, assets) {
  const rooms = await getRoomsForCentre(state.activeCentreId);

  if (!rooms.length) {
    renderEmptyState(container.parentElement, {
      title: "No rooms configured for this centre",
      subtitle: "Rooms are seeded once per centre — ask an Owner to add them."
    });
    return;
  }

  const countByRoom = {};
  assets.forEach((a) => {
    if (a.currentStatus === "active") countByRoom[a.roomId] = (countByRoom[a.roomId] || 0) + 1;
  });

  container.innerHTML = "";
  rooms.forEach((room) => {
    const count = countByRoom[room.id] || 0;
    const iconUrl = roomIconFor(room.name);
    container.appendChild(
      el("div", {
        class: "room-card",
        tabindex: "0",
        role: "button",
        "aria-label": `Open ${room.name || "room"} in Register`,
        onclick: () => state.navigateTo("register", { roomId: room.id, roomName: room.name }),
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.navigateTo("register", { roomId: room.id, roomName: room.name }); } }
      }, [
        el("div", { class: "room-card-icon" }, iconUrl
          ? [el("img", { src: iconUrl, alt: "", loading: "lazy" })]
          : "▢"),
        el("div", { class: "room-card-name" }, room.name || "Untitled Room"),
        el("div", { class: "room-card-count" }, `${count} active asset${count === 1 ? "" : "s"}`)
      ])
    );
  });
}

async function renderActivity(container, state) {
  try {
    const activity = await listRecentActivity(state.activeCentreId, 5);
    if (!activity.length) {
      renderEmptyState(container, {
        title: "No activity yet",
        subtitle: "Every asset action — created, transferred, repaired, disposed — will appear here automatically."
      });
      return;
    }
    container.innerHTML = "";
    activity.forEach((a) => {
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
  } catch (err) {
    console.error("[dashboard] Failed to load activity:", err);
    renderEmptyState(container, {
      title: "Couldn't load recent activity",
      subtitle: "This can happen the first time this query runs — check the browser console for a Firestore \"create index\" link and click it."
    });
  }
}

function statCard(label, value, tone) {
  return el("div", { class: `stat-card${tone ? " " + tone : ""}` }, [
    el("div", { class: "stat-label" }, label),
    el("div", { class: "stat-value" }, value)
  ]);
}

function sectionHeader(title) {
  return el("div", { style: "font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;" }, title);
}
