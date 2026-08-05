// =============================================================================
// Inventory OS — Staff Directory
// Per-centre teacher/staff registry. Built so assigning a room's teacher
// (Settings → Rooms) can be a pick-from-a-list instead of free text, and so
// the org has one place to see who's active where. Course info is a
// Teacher-only field and is intentionally scoped to this directory — other
// screens that reference a staff member (Room assignment) only ever show
// the short course codes, never the long-form names, per how this was
// specified.
// =============================================================================

import { db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, renderEmptyState, showToast } from "./utils.js";
import { CLOSE_ICON } from "./icons.js";

export const DESIGNATIONS = ["Teacher", "Academic Counsellor", "Centre Head", "HR", "Marketing Executive"];

// code = short form shown outside the directory; full = long form shown only inside it.
export const COURSES = [
  { code: "PFM - Tam", full: "Popular Film Music - Tamil" },
  { code: "PFM - Hin", full: "Popular Film Music - Hindi" },
  { code: "PFM - Tel", full: "Popular Film Music - Telugu" },
  { code: "PFM - Kan", full: "Popular Film Music - Kannada" },
  { code: "HC", full: "Hindustani Classical" },
  { code: "CC", full: "Carnatic Classical" },
  { code: "WV", full: "Western Vocals" },
  { code: "GTR", full: "Guitar" },
  { code: "KB", full: "Keyboard" }
];

/** "PFM - Tam + CC" — the short-code join used everywhere outside the directory itself. */
export function courseCodesLabel(courses) {
  if (!courses || !courses.length) return "";
  return courses.join(" + ");
}

/** "Popular Film Music - Tamil + Carnatic Classical" — long form, directory-only. */
export function courseFullLabel(courses) {
  if (!courses || !courses.length) return "";
  return courses.map((code) => COURSES.find((c) => c.code === code)?.full || code).join(" + ");
}

export async function listStaff(centreId) {
  const snap = await getDocs(query(collection(db, "staff"), where("centreId", "==", centreId)));
  const staff = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  staff.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return staff;
}

export async function listActiveStaff(centreId) {
  const staff = await listStaff(centreId);
  return staff.filter((s) => s.status === "active");
}

export async function createStaff(data, currentUser) {
  const ref = await addDoc(collection(db, "staff"), {
    centreId: data.centreId,
    name: data.name.trim(),
    designation: data.designation,
    status: data.status || "active",
    courses: data.designation === "Teacher" ? (data.courses || []) : [],
    createdBy: currentUser.uid,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateStaff(id, data) {
  await updateDoc(doc(db, "staff", id), {
    name: data.name.trim(),
    designation: data.designation,
    status: data.status,
    courses: data.designation === "Teacher" ? (data.courses || []) : []
  });
}

export async function renderStaffDirectory(container, state) {
  container.innerHTML = "";

  if (!state.activeCentreId) {
    renderEmptyState(container, {
      title: "No centre assigned",
      subtitle: "Ask an Owner to assign you to a centre before the Staff Directory can be shown."
    });
    return;
  }

  const header = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;" }, [
    el("div", { style: "font-size:13px;font-weight:700;color:var(--text);" }, "Staff Directory"),
    el("button", { class: "btn btn-primary btn-sm", onclick: () => openStaffModal(null, state, () => renderStaffDirectory(container, state)) }, "+ Add Staff")
  ]);
  container.appendChild(header);

  const listEl = el("div", { class: "card-grid" });
  container.appendChild(listEl);

  const staff = await listStaff(state.activeCentreId);
  if (!staff.length) {
    renderEmptyState(container, {
      title: "No staff added yet",
      subtitle: "Add teachers and staff here — it also makes assigning a room's teacher a pick-from-a-list instead of typing a name.",
      actionLabel: "Add Staff",
      onAction: () => openStaffModal(null, state, () => renderStaffDirectory(container, state))
    });
    return;
  }

  listEl.innerHTML = "";
  staff.forEach((person) => {
    const courseBadge = person.designation === "Teacher" ? courseCodesLabel(person.courses) : "";
    listEl.appendChild(
      el("div", { class: "room-card", onclick: () => openStaffModal(person, state, () => renderStaffDirectory(container, state)) }, [
        el("div", { class: "room-card-icon" }, initials(person.name)),
        el("div", { class: "room-card-name" }, person.name),
        el("div", { class: "room-card-count" }, person.designation + (courseBadge ? ` · ${courseBadge}` : "")),
        el("span", { class: `badge ${person.status === "active" ? "badge-green" : "badge-gray"}`, style: "margin-top:2px;" },
          [el("span", { class: "badge-dot" }), person.status === "active" ? "Active" : "Inactive"])
      ])
    );
  });
}

export function openStaffModal(existing, state, onSaved) {
  const overlay = el("div", { class: "modal-overlay show", role: "dialog", "aria-modal": "true" });

  const nameInput = el("input", { class: "field-input", type: "text", value: existing?.name || "" });
  const designationSelect = el("select", { class: "field-input" }, [
    el("option", { value: "" }, "Select designation"),
    ...DESIGNATIONS.map((d) => { const o = new Option(d, d); if (existing?.designation === d) o.selected = true; return o; })
  ]);
  const statusSelect = el("select", { class: "field-input" }, [
    new Option("Active", "active"),
    new Option("Inactive", "inactive")
  ]);
  statusSelect.value = existing?.status || "active";

  const coursesWrap = el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Courses")]);

  function renderCourseCheckboxes() {
    coursesWrap.querySelectorAll(".course-check").forEach((n) => n.remove());
    if (designationSelect.value !== "Teacher") {
      coursesWrap.appendChild(el("div", { class: "course-check", style: "font-size:11.5px;color:var(--text-faint);" }, "NA — not a teaching role"));
      return;
    }
    COURSES.forEach((c) => {
      const checked = (existing?.courses || []).includes(c.code);
      coursesWrap.appendChild(el("label", { class: "course-check", style: "display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);margin-bottom:4px;" }, [
        el("input", { type: "checkbox", value: c.code, checked: checked ? "checked" : null }),
        `${c.full} (${c.code})`
      ]));
    });
  }
  renderCourseCheckboxes();
  designationSelect.addEventListener("change", renderCourseCheckboxes);

  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-header" }, [
      el("h2", {}, existing ? "Edit Staff" : "Add Staff"),
      el("button", { class: "btn-icon-only", "aria-label": "Close", onclick: () => overlay.remove() }, [el("img", { src: CLOSE_ICON, alt: "", class: "icon-img", loading: "lazy" })])
    ]),
    el("div", { class: "modal-body" }, [
      el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Name"), nameInput]),
      el("div", { class: "field-row" }, [
        el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Designation"), designationSelect]),
        el("div", { class: "field-group" }, [el("div", { class: "field-label" }, "Status"), statusSelect])
      ]),
      coursesWrap
    ]),
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", onclick: () => overlay.remove() }, "Cancel"),
      el("button", { class: "btn btn-primary", onclick: async (e) => {
        const name = nameInput.value.trim();
        const designation = designationSelect.value;
        if (!name) { showToast("Name is required", "red"); return; }
        if (!designation) { showToast("Select a designation", "red"); return; }
        const courses = Array.from(coursesWrap.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value);
        const data = { centreId: state.activeCentreId, name, designation, status: statusSelect.value, courses };

        e.target.disabled = true;
        try {
          if (existing) {
            await updateStaff(existing.id, data);
          } else {
            await createStaff(data, state.profile);
          }
          showToast(existing ? "Staff updated" : "Staff added", "green");
          overlay.remove();
          if (onSaved) onSaved();
        } catch (err) {
          console.error("[staff] Save failed:", err);
          showToast("Couldn't save staff. Check your permissions.", "red");
          e.target.disabled = false;
        }
      } }, existing ? "Save" : "Add")
    ])
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}
