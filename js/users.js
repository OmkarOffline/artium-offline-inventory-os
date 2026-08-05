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
import { collection, doc, getDocs, updateDoc, setDoc, deleteDoc, query, orderBy, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast, renderEmptyState, formatDate } from "./utils.js";
import { CLOSE_ICON } from "./icons.js";

const ROLE_LABELS = { owner: "Owner", centre_admin: "Centre Admin", viewer: "Viewer" };
const ALLOWED_DOMAIN = "artiumacademy.com";

/** Used by the notification bell — Owners should hear about new sign-ins waiting on them. */
export async function listPendingUsers() {
  const snap = await getDocs(query(collection(db, "users"), where("pendingApproval", "==", true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.disabled);
}

export async function renderUsersPage(container, state) {
  container.innerHTML = "";

  const header = el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:14px;" }, [
    el("div", {}, [
      el("div", { style: "font-size:13px;font-weight:700;color:var(--text);" }, "Users"),
      el("div", { style: "font-size:12px;color:var(--text-faint);margin-top:2px;" },
        "New sign-ins from any @artiumacademy.com account show up here, disabled, until you approve them — or invite someone ahead of time below.")
    ]),
    el("button", { class: "btn btn-primary btn-sm", onclick: () => openInviteModal(state, load) }, "+ Invite User")
  ]);
  container.appendChild(header);

  const listWrap = el("div", {});
  container.appendChild(listWrap);

  await load();

  async function load() {
    listWrap.innerHTML = "<div style=\"padding:20px;color:var(--text-faint);font-size:12.5px;\">Loading…</div>";
    const [snap, invitesSnap] = await Promise.all([
      getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"))),
      getDocs(collection(db, "invites"))
    ]);
    const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const invites = invitesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listWrap.innerHTML = "";

    if (invites.length) {
      listWrap.appendChild(el("div", { style: "font-size:11px;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;" }, "Invited — Not Yet Signed In"));
      invites.forEach((inv) => listWrap.appendChild(inviteCard(inv, state, load)));
      listWrap.appendChild(el("div", { style: "height:8px;" }));
    }

    if (!users.length) {
      if (!invites.length) {
        renderEmptyState(listWrap, { title: "No users found", subtitle: "This shouldn't happen — at least your own account should be here." });
      }
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

/**
 * The invite message + mailto link, shared between the "just invited"
 * follow-up and the "Copy Invite" button on an existing invite card, so the
 * wording is identical either way.
 */
function inviteMessage(invite, state) {
  const siteUrl = `${window.location.href.replace(/[^/]*$/, "")}login.html`;
  const roleLabel = ROLE_LABELS[invite.role] || invite.role;
  const subject = "Access to Inventory OS";
  const body = `Hi,\n\nYou've been given access to Inventory OS as a ${roleLabel}. Please sign in with your Artium Google account here:\n\n${siteUrl}\n\n— ${state.profile.displayName || state.profile.email}`;
  return { subject, body, mailto: `mailto:${invite.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

function inviteCard(inv, state, reload) {
  const card = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:10px;" });
  card.appendChild(el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;" }, [
    el("div", {}, [
      el("div", { style: "font-size:13px;font-weight:700;color:var(--text);" }, inv.email),
      el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-top:1px;" },
        `Invited as ${ROLE_LABELS[inv.role] || inv.role}${inv.invitedByName ? ` by ${inv.invitedByName}` : ""}${inv.invitedAt ? ` · ${formatDate(inv.invitedAt)}` : ""}`)
    ]),
    el("span", { class: "badge badge-amber" }, [el("span", { class: "badge-dot" }), "Invited"])
  ]));
  card.appendChild(el("div", { style: "display:flex;gap:8px;margin-top:12px;" }, [
    el("button", { class: "btn btn-secondary btn-sm", onclick: () => openCopyInviteModal(inv, state) }, "Copy Invite"),
    el("button", {
      class: "btn btn-ghost btn-sm",
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await deleteDoc(doc(db, "invites", inv.id));
          showToast("Invite cancelled", "amber");
          await reload();
        } catch (err) {
          console.error("[users] Failed to cancel invite:", err);
          showToast("Couldn't cancel invite. Check your permissions.", "red");
          e.target.disabled = false;
        }
      }
    }, "Cancel Invite")
  ]));
  return card;
}

function openInviteModal(state, onDone) {
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const emailInput = el("input", { class: "field-input", type: "email", placeholder: "name@artiumacademy.com" });
  const roleSelect = el("select", { class: "field-input" }, [
    new Option("Viewer", "viewer"),
    new Option("Centre Admin", "centre_admin"),
    new Option("Owner", "owner")
  ]);
  const centresWrap = el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Assigned Centres")]);

  function renderCentreCheckboxes() {
    centresWrap.querySelectorAll(".centre-check").forEach((n) => n.remove());
    if (roleSelect.value !== "centre_admin") {
      centresWrap.appendChild(el("div", { class: "centre-check", style: "font-size:11.5px;color:var(--text-faint);" }, "Not applicable for this role"));
      return;
    }
    (state.centres || []).forEach((c) => {
      centresWrap.appendChild(el("label", { class: "centre-check", style: "display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);margin-bottom:3px;" }, [
        el("input", { type: "checkbox", value: c.id }),
        c.name
      ]));
    });
  }
  renderCentreCheckboxes();
  roleSelect.addEventListener("change", renderCentreCheckboxes);

  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Invite User"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-bottom:4px;" },
        "Sets their role ahead of time — the moment they sign in with this Google account, they're activated automatically, no approval step needed. You'll get a ready-to-send message afterward; Inventory OS doesn't email them for you."),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Artium Email"), emailInput]),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Role"), roleSelect]),
      centresWrap
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
          showToast(`Must be an @${ALLOWED_DOMAIN} address`, "red");
          return;
        }
        const role = roleSelect.value;
        const assignedCentres = role === "centre_admin"
          ? Array.from(centresWrap.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value)
          : [];

        e.target.disabled = true;
        try {
          const existingUser = await getDocs(query(collection(db, "users"), where("email", "==", email)));
          if (!existingUser.empty) {
            showToast("This person already has an account — edit their role below instead", "amber");
            e.target.disabled = false;
            return;
          }
          const invite = {
            email, role, assignedCentres,
            invitedBy: state.profile.uid,
            invitedByName: state.profile.displayName || state.profile.email,
            invitedAt: serverTimestamp()
          };
          await setDoc(doc(db, "invites", email), invite);
          showToast("Invite created", "green");
          overlay.remove();
          if (onDone) await onDone();
          openCopyInviteModal(invite, state);
        } catch (err) {
          console.error("[users] Failed to create invite:", err);
          showToast("Couldn't create invite. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, "Create Invite")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function openCopyInviteModal(invite, state) {
  const { body, mailto } = inviteMessage(invite, state);
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });
  const textarea = el("textarea", { class: "field-input", rows: "7", readonly: "readonly" });
  textarea.value = body;
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [el("h2", {}, "Invite Ready"), el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])]),
    el("div", { class: "modal-body" }, [
      el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-bottom:10px;" },
        `${invite.email} is set up and will be activated the moment they sign in. Send them this however you'd like:`),
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Message"), textarea])
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Done"),
      el("a", { class: "btn btn-secondary", href: mailto }, "Open in Email App"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        try {
          await navigator.clipboard.writeText(body);
          showToast("Message copied", "green");
        } catch {
          showToast("Couldn't copy — select the text manually", "amber");
        }
      } }, "Copy Message")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
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
