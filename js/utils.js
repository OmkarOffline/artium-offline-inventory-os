// =============================================================================
// Inventory OS — Shared Utilities
// Generic helpers with no dependency on any specific module's business logic.
// If a helper starts encoding Asset/Vendor/Repair rules, it belongs in that
// module instead, not here.
// =============================================================================

/** Format a Firestore Timestamp, Date, or ISO string as "4 Aug 2026". */
export function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Format a Firestore Timestamp, Date, or ISO string as "4 Aug 2026, 6:42 PM". */
export function formatDateTime(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Format a number as Indian Rupees, e.g. ₹18,400. */
export function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

/** Small DOM creation helper to avoid repetitive document.createElement chains. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Show a toast notification. Kind controls the accent dot colour and should
 * be one of: "green" (success), "amber" (warning), "red" (error), "blue" (info).
 * Toasts are lightweight and self-dismiss — never block interaction.
 */
export function showToast(message, kind = "blue", duration = 3200) {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = el("div", { class: "toast-stack" });
    document.body.appendChild(stack);
  }
  const toast = el("div", { class: "toast" }, [
    el("span", { class: `toast-dot ${kind}` }),
    document.createTextNode(message)
  ]);
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

/**
 * Render a standard empty state into a container. Every module should use
 * this rather than leaving a blank screen (Blueprint Chapter 9).
 */
export function renderEmptyState(container, { title, subtitle, actionLabel, onAction }) {
  container.innerHTML = "";
  const children = [
    el("div", { class: "empty-state-icon" }, "—"),
    el("div", { class: "empty-state-title" }, title)
  ];
  if (subtitle) children.push(el("div", { class: "empty-state-sub" }, subtitle));
  if (actionLabel && onAction) {
    children.push(el("button", { class: "btn btn-primary btn-sm", onclick: onAction }, actionLabel));
  }
  container.appendChild(el("div", { class: "empty-state" }, children));
}

/** Map an Asset/Repair/Disposal status string to its badge colour + label. */
export function statusBadge(status) {
  const map = {
    active: { color: "green", label: "Active" },
    under_repair: { color: "amber", label: "Under Repair" },
    pending_disposal: { color: "red", label: "Pending Disposal" },
    disposed: { color: "gray", label: "Disposed" },
    archived: { color: "gray", label: "Archived" },
    verified: { color: "green", label: "Verified" },
    missing: { color: "red", label: "Missing" },
    damaged: { color: "amber", label: "Damaged" }
  };
  return map[status] || { color: "gray", label: status || "Unknown" };
}

/** Debounce helper for search inputs. */
export function debounce(fn, wait = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
