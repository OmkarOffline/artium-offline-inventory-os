// =============================================================================
// Inventory OS — Illustrated Icon Set
// Milestone 6: swaps the placeholder stroke-SVG icons for the Launch-OS-style
// illustrated PNGs (see /Icons). Originals were ~1.4MB each (1254×1254) —
// Icons/web/ holds resized, optimized copies (~70KB, 240×240) generated once
// for actual use in the app; the full-resolution originals are left
// untouched in /Icons for reference/reuse elsewhere.
// =============================================================================

const BASE = "Icons/web/";

function iconUrl(filename) {
  return BASE + encodeURIComponent(filename).replace(/%2F/g, "/");
}

export const NOTIFICATIONS_ICON = iconUrl("Notifications.png");
export const SIGNOUT_ICON = iconUrl("Sign-out.png");
export const BACK_ICON = iconUrl("Back.png");
export const HOME_ICON = iconUrl("Home.png");
export const ADD_ICON = iconUrl("Add.png");
export const EDIT_ICON = iconUrl("Edit.png");
export const DELETE_ICON = iconUrl("Delete.png");
export const SEARCH_ICON = iconUrl("Search.png");

// Matched by substring against the room's actual name, case-insensitively —
// robust to whatever exact wording a centre's real room list uses, rather
// than depending on an exact string match to the seed data.
const ROOM_ICON_RULES = [
  { test: /head.*cabin|cabin.*head|centre head/i, file: "Centre Head Cabin.png" },
  { test: /guitar/i, file: "Guitar Classroom.png" },
  { test: /keyboard/i, file: "Keyboard Classroom.png" },
  { test: /north.*vocal/i, file: "North Vocals Classroom.png" },
  { test: /south.*vocal/i, file: "South Vocals Classroom.png" },
  { test: /western.*vocal/i, file: "Western Vocals Classroom.png" },
  { test: /pantry/i, file: "Pantry.png" },
  { test: /reception/i, file: "Reception.png" },
  { test: /stage/i, file: "Stage.png" }
];

/** Returns an icon URL for a room name, or null if nothing matches (caller keeps its generic fallback). */
export function roomIconFor(roomName) {
  if (!roomName) return null;
  const rule = ROOM_ICON_RULES.find((r) => r.test.test(roomName));
  return rule ? iconUrl(rule.file) : null;
}

// Matches the three fixed values in ASSET_CATEGORIES (assetMaster.js).
const CATEGORY_ICON_RULES = [
  { test: /musical/i, file: "Musical Instruments.png" },
  { test: /electronic/i, file: "Electronics.png" },
  { test: /accessor/i, file: "Accessories.png" }
];

/** Returns an icon URL for an asset category, or null if nothing matches. */
export function categoryIconFor(category) {
  if (!category) return null;
  const rule = CATEGORY_ICON_RULES.find((r) => r.test.test(category));
  return rule ? iconUrl(rule.file) : null;
}
