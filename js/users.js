// =============================================================================
// Inventory OS — Users (Owner-only)
// Chapter 3: Owners provision every non-Owner account. Since a brand new
// team member's Firestore document can only exist once they've signed in at
// least once (its ID is their Firebase Auth UID, which nobody knows ahead of
// time), the flow is: they sign in, auth.js self-bootstraps them as a
// disabled, powerless "pending" Viewer, and they land here for an Owner to
// review — set a real role, assign centre(s) if Centre Admin, and activate.
// Nothing about the pending record itself grants any access.
// =============================================================================

import { db } from "./firebase.js";
import { collection, doc, getDocs, updateDoc, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, renderEmptyState, formatDate } from "./utils.js";

const ROLE_LABELS = { owner: "Owner", centre_admin: "Centre Admin", viewer: "Viewer" };

/** Used by the notification bell — Owners should hear about new sign-ins waiting on them. */
export async function listPendingUsers() {
  const snap = await getDocs(query(collection(db, "users"), where("pendingApproval", "==", true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.disabled);
}

export async function renderUsersPage(container, state) {
  container.innerHTML = "";
  container.appendChild(el("div", { style: "font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;" }, "Users"));
  container.appendChild(el("div", { style: "font-size:12px;color:var(--text-faint);margin-bottom:14px;" },
    "New sign-ins from any @artiumacademy.com account show up here, disabled, until you approve them."));

  const listWrap = el("div", {});
  container.appendChild(listWrap);

  await load();

  async function load() {
    listWrap.innerHTML = "<div style=\"padding:20px;color:var(--text-faint);font-size:12.5px;\">Loading…</div>";
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listWrap.innerHTML = "";

    if (!users.length) {
      renderEmptyState(listWrap, { title: "No users found", subtitle: "This shouldn't happen — at least your own account should be here." });
      return;
    }

    const pending = users.filter((u) => u.pendingApproval && u.disabled);
    const rest = users.filter((u) => !(u.pendingApproval && u.disabled));

    if (pending.length) {
      listWrap.appendChild(el("div", { style: "font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;" }, "Pending Approval"));
      pending.forEach((u) => listWrap.appendChild(userCard(u, state, load)));
      listWrap.appendChild(el("div", { style: "height:8px;" }));
    }

    listWrap.appendChild(el("div", { style: "font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;" }, "All Users"));
    rest.forEach((u) => listWrap.appendChild(userCard(u, state, load)));
  }
}

function userCard(u, state, reload) {
  const isSelf = u.id === state.profile.uid;
  const isPending = u.pendingApproval && u.disabled;

  let roleSelect, centresWrap;

  const card = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:10px;" });

  const header = el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;" }, [
    el("div", {}, [
      el("div", { style: "font-size:13px;font-weight:700;color:var(--text);" }, [
        u.displayName || u.email,
        isSelf ? el("span", { style: "font-weight:600;color:var(--text-faint);font-size:11px;margin-left:6px;" }, "(You)") : null
      ].filter(Boolean)),
      el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-top:1px;" }, u.email),
      u.createdAt ? el("div", { style: "font-size:10.5px;color:var(--text-faint);margin-top:2px;" }, `Joined ${formatDate(u.createdAt)}`) : null
    ].filter(Boolean)),
    statusBadge(u, isPending)
  ]);
  card.appendChild(header);

  if (isSelf) {
    card.appendChild(el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-top:10px;" }, "You can't change your own role or access here — ask another Owner if this needs to change."));
    return card;
  }

  const controls = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;" });

  const roleField = el("div", { class: "field-group", style: "width:auto;" }, [
    el("div", { class: "field-label" }, "Role"),
    roleSelect = el("select", { class: "field-input", style: "width:auto;" }, [
      new Option("Viewer", "viewer"),
      new Option("Centre Admin", "centre_admin"),
      new Option("Owner", "owner")
    ])
  ]);
  roleSelect.value = isPending ? "viewer" : u.role;
  controls.appendChild(roleField);

  centresWrap = el("div", { class: "field-group", style: "width:auto;min-width:200px;" }, [
    el("div", { class: "field-label" }, "Assigned Centres")
  ]);
  controls.appendChild(centresWrap);

  function renderCentreCheckboxes() {
    centresWrap.querySelectorAll(".centre-check").forEach((n) => n.remove());
    if (roleSelect.value !== "centre_admin") {
      centresWrap.appendChild(el("div", { class: "centre-check", style: "font-size:11.5px;color:var(--text-faint);" }, "Not applicable for this role"));
      return;
    }
    (state.centres || []).forEach((c) => {
      const checked = (u.assignedCentres || []).includes(c.id);
      centresWrap.appendChild(el("label", { class: "centre-check", style: "display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);margin-bottom:3px;" }, [
        el("input", { type: "checkbox", value: c.id, checked: checked ? "checked" : null }),
        c.name
      ]));
    });
  }
  renderCentreCheckboxes();
  roleSelect.addEventListener("change", renderCentreCheckboxes);

  const actionBtn = el("button", {
    class: "btn btn-primary btn-sm",
    onclick: async (e) => {
      const role = roleSelect.value;
      const assignedCentres = role === "centre_admin"
        ? Array.from(centresWrap.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value)
        : [];
      e.target.disabled = true;
      try {
        await updateDoc(doc(db, "users", u.id), {
          role, assignedCentres, disabled: false, pendingApproval: false
        });
        showToast(isPending ? "User activated" : "User updated", "green");
        await reload();
      } catch (err) {
        console.error("[users] Update failed:", err);
        showToast("Couldn't update user. Check your permissions.", "red");
        e.target.disabled = false;
      }
    }
  }, isPending ? "Activate" : "Save");
  controls.appendChild(actionBtn);

  if (!isPending) {
    controls.appendChild(el("button", {
      class: "btn btn-ghost btn-sm",
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await updateDoc(doc(db, "users", u.id), { disabled: !u.disabled });
          showToast(u.disabled ? "User re-enabled" : "User disabled", u.disabled ? "green" : "amber");
          await reload();
        } catch (err) {
          console.error("[users] Toggle disable failed:", err);
          showToast("Couldn't update user. Check your permissions.", "red");
          e.target.disabled = false;
        }
      }
    }, u.disabled ? "Re-enable" : "Disable"));
  }

  card.appendChild(controls);
  return card;
}

function statusBadge(u, isPending) {
  if (isPending) return el("span", { class: "badge badge-amber" }, [el("span", { class: "badge-dot" }), "Pending Approval"]);
  if (u.disabled) return el("span", { class: "badge badge-gray" }, [el("span", { class: "badge-dot" }), "Disabled"]);
  return el("span", { class: "badge badge-blue" }, [el("span", { class: "badge-dot" }), ROLE_LABELS[u.role] || u.role]);
}
