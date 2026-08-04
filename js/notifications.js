// =============================================================================
// Inventory OS — Notification Bell
// Milestone 4: no Cloud Functions / email on the free Firebase plan, so this
// is in-app only — a live dropdown pulling from data that already exists
// (pending disposal requests, warranty expiring, labels to reprint) plus the
// new Audit Flags collection, which is how "notify the Owners" for a
// Missing/Damaged audit finding is actually satisfied: any Owner who opens
// the bell sees it until they acknowledge it, regardless of who ran the
// audit.
// =============================================================================

import { db } from "./firebase.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, formatDate } from "./utils.js";
import { listPendingDisposalRequests } from "./disposal.js";
import { listUnacknowledgedFlags, acknowledgeFlag } from "./audits.js";
import { listPendingUsers } from "./users.js";
import { NOTIFICATIONS_ICON } from "./icons.js";

export function mountNotificationBell(container, state) {
  const wrap = el("div", { style: "position:relative;" });

  const badge = el("span", {
    style: "display:none;position:absolute;top:-3px;right:-3px;background:var(--red,#e5484d);color:#fff;font-size:10px;font-weight:700;line-height:1;border-radius:999px;min-width:16px;height:16px;display:flex;align-items:center;justify-content:center;padding:0 3px;",
    "aria-hidden": "true"
  }, "");

  const btn = el("button", {
    class: "btn-icon-only", title: "Notifications", "aria-label": "Notifications", "aria-haspopup": "true", "aria-expanded": "false",
    style: "position:relative;"
  }, [el("img", { src: NOTIFICATIONS_ICON, alt: "", class: "icon-img", loading: "lazy" })]);
  wrap.appendChild(btn);
  wrap.appendChild(badge);

  const dropdown = el("div", {
    role: "menu", "aria-label": "Notifications",
    style: "display:none;position:absolute;top:calc(100% + 8px);right:0;width:320px;max-height:420px;overflow-y:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.18));z-index:60;padding:8px;"
  });
  wrap.appendChild(dropdown);
  container.appendChild(wrap);

  let open = false;

  async function collect() {
    const isOwner = state.profile.role === "owner";
    const items = [];

    if (isOwner) {
      const [pending, flags, pendingUsers] = await Promise.all([
        listPendingDisposalRequests(state).catch(() => []),
        listUnacknowledgedFlags(state).catch(() => []),
        listPendingUsers().catch(() => [])
      ]);
      pending.forEach((r) => items.push({
        kind: "disposal", tone: "red",
        text: `Disposal requested: ${r.assetIdLabel}`,
        sub: `${r.reason} · requested by ${r.requestedByName}`,
        onClick: () => { closeDropdown(); state.navigateTo("disposals"); }
      }));
      flags.forEach((f) => items.push({
        kind: "auditFlag", tone: f.status === "missing" ? "red" : "amber",
        text: `${f.status === "missing" ? "Missing" : "Damaged"} in audit: ${f.assetIdLabel}`,
        sub: `${f.roomName} · ${f.notes || "no notes"}`,
        flag: f
      }));
      pendingUsers.forEach((u) => items.push({
        kind: "pendingUser", tone: "blue",
        text: `New sign-in awaiting approval: ${u.displayName || u.email}`,
        sub: u.email,
        onClick: () => { closeDropdown(); state.navigateTo("users"); }
      }));
    }

    if (state.activeCentreId) {
      const [assetsSnap] = await Promise.all([
        getDocs(query(collection(db, "assets"), where("centreId", "==", state.activeCentreId)))
      ]);
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      assetsSnap.forEach((d) => {
        const a = d.data();
        if (a.warrantyApplicable && a.warrantyExpiry) {
          const exp = new Date(a.warrantyExpiry);
          if (exp >= now && exp <= in30) {
            items.push({
              kind: "warranty", tone: "blue",
              text: `Warranty expiring: ${a.assetId}`,
              sub: `Expires ${formatDate(a.warrantyExpiry)}`,
              onClick: () => { closeDropdown(); state.navigateTo("register"); }
            });
          }
        }
        if (a.labelReprintRequired) {
          items.push({
            kind: "label", tone: "purple",
            text: `Label reprint needed: ${a.assetId}`,
            sub: a.assetName || "",
            onClick: () => { closeDropdown(); state.navigateTo("register"); }
          });
        }
      });
    }

    return items;
  }

  async function load() {
    dropdown.innerHTML = "<div style=\"font-size:12px;color:var(--text-faint);padding:10px;\">Loading…</div>";
    let items;
    try {
      items = await collect();
    } catch (err) {
      console.error("[notifications] Failed to load:", err);
      dropdown.innerHTML = "";
      dropdown.appendChild(el("div", { style: "font-size:12px;color:var(--text-faint);padding:10px;" }, "Couldn't load notifications."));
      return;
    }

    dropdown.innerHTML = "";
    dropdown.appendChild(el("div", { style: "font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;" }, "Notifications"));

    if (!items.length) {
      dropdown.appendChild(el("div", { style: "font-size:12px;color:var(--text-faint);padding:10px 8px;" }, "You're all caught up."));
      return;
    }

    items.forEach((item) => {
      const row = el("div", {
        style: "display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:var(--radius-sm);cursor:pointer;",
        onclick: item.onClick || (() => {}),
        onmouseenter: (e) => e.currentTarget.style.background = "var(--bg-hover)",
        onmouseleave: (e) => e.currentTarget.style.background = "transparent"
      }, [
        el("span", { style: `width:7px;height:7px;border-radius:50%;background:var(--${item.tone});margin-top:5px;flex-shrink:0;` }),
        el("div", { style: "flex:1;" }, [
          el("div", { style: "font-size:12px;color:var(--text);font-weight:600;" }, item.text),
          el("div", { style: "font-size:11px;color:var(--text-faint);margin-top:1px;" }, item.sub)
        ]),
        item.flag ? el("button", {
          class: "btn btn-ghost btn-sm",
          onclick: async (e) => {
            e.stopPropagation();
            await acknowledgeFlag(item.flag.id, state);
            await load();
          }
        }, "Ack") : null
      ].filter(Boolean));
      dropdown.appendChild(row);
    });
  }

  async function refreshBadge() {
    try {
      const items = await collect();
      if (items.length) {
        badge.textContent = items.length > 9 ? "9+" : String(items.length);
        badge.style.display = "flex";
      } else {
        badge.style.display = "none";
      }
    } catch {
      badge.style.display = "none";
    }
  }

  function closeDropdown() {
    open = false;
    dropdown.style.display = "none";
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    open = !open;
    dropdown.style.display = open ? "block" : "none";
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      await load();
      refreshBadge();
    }
  });
  document.addEventListener("click", (e) => {
    if (open && !wrap.contains(e.target)) closeDropdown();
  });
  document.addEventListener("keydown", (e) => {
    if (open && e.key === "Escape") { closeDropdown(); btn.focus(); }
  });

  refreshBadge();
  return { refreshBadge };
}
