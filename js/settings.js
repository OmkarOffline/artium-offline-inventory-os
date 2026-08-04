// =============================================================================
// Inventory OS — Settings
// Milestone 5: Owner-only "Export Full Snapshot" is the Backup half of
// Backup/Restore — a downloadable JSON dump of every collection, meant as an
// external safety net. Restore is deliberately not built (see the Milestone
// 5 pre-build summary): nothing in Inventory OS ever hard-deletes data, so a
// blanket database-overwrite tool would be a bigger risk than the problem it
// solves. If a real recovery scenario ever comes up, it should be scoped
// narrowly against that scenario rather than built speculatively now.
// =============================================================================

import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { el, showToast } from "./utils.js";
import { downloadJSON } from "./csv.js";

const BACKUP_COLLECTIONS = [
  "centres", "rooms", "assetTypes", "assetMasters", "vendors", "assets",
  "repairs", "audits", "auditFlags", "disposalRequests", "counters",
  "activities", "users", "settings", "system"
];

export async function renderSettingsPage(container, state) {
  container.innerHTML = "";
  const isOwner = state.profile.role === "owner";

  container.appendChild(el("div", { style: "font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px;" }, "Settings"));

  const account = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:14px;" }, [
    el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:10px;" }, "Your Account"),
    detailRow("Name", state.profile.displayName || "—"),
    detailRow("Email", state.profile.email),
    detailRow("Role", state.profile.role === "owner" ? "Owner" : state.profile.role === "centre_admin" ? "Centre Admin" : "Viewer")
  ]);
  container.appendChild(account);

  if (!isOwner) return;

  const backupCard = el("div", { style: "background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;" }, [
    el("div", { style: "font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px;" }, "Data Backup"),
    el("div", { style: "font-size:11.5px;color:var(--text-faint);margin-bottom:12px;" },
      "Downloads every collection as one JSON file — a safety net you can store externally. Inventory OS never deletes data on its own, so this exists purely as an extra precaution, not a routine requirement."),
    el("button", { class: "btn btn-primary btn-sm", id: "exportSnapshotBtn" }, "Export Full Snapshot")
  ]);
  container.appendChild(backupCard);

  document.getElementById("exportSnapshotBtn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Exporting…";
    try {
      const snapshot = {};
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        snapshot[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      downloadJSON(`inventory-os-backup-${new Date().toISOString().slice(0, 10)}`, snapshot);
      showToast("Backup exported", "green");
    } catch (err) {
      console.error("[settings] Backup export failed:", err);
      showToast("Couldn't export backup. Check your permissions.", "red");
    }
    e.target.disabled = false;
    e.target.textContent = "Export Full Snapshot";
  });
}

function detailRow(label, value) {
  return el("div", { style: "display:flex;justify-content:space-between;padding:5px 0;font-size:12px;" }, [
    el("span", { style: "color:var(--text-faint);" }, label),
    el("span", { style: "color:var(--text-dim);" }, value || "—")
  ]);
}
