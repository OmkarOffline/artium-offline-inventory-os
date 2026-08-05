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
export const CLOSE_ICON = iconUrl("Close.png");
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

// Matched by substring against the Asset Type's name (never its code — the
// code is just a short ID, the name is the human-readable "Microphone",
// "Bluetooth Speaker" etc. these were actually drawn for). Order matters:
// more specific multi-word rules (the two mic stands, guitar stand) must be
// checked before their broader single-word cousins ("microphone", "guitar")
// or every stand would just render as a plain mic/guitar.
const ASSET_TYPE_ICON_RULES = [
  { test: /upright.*mic|mic.*upright/i, file: "upright-microphone-stand.png" },
  { test: /floor.*mic|mic.*floor/i, file: "floor-microphone-stand.png" },
  { test: /guitar.*stand|stand.*guitar/i, file: "guitar-stand.png" },
  { test: /notation/i, file: "notation-stand.png" },
  { test: /bluetooth|speaker/i, file: "bluetooth-speaker.png" },
  { test: /tanpura/i, file: "electronic-tanpura.png" },
  { test: /tablet/i, file: "android-tablet.png" },
  { test: /capo/i, file: "capo.png" },
  { test: /guitar/i, file: "guitar.png" },
  { test: /keyboard/i, file: "keyboard.png" },
  { test: /laptop/i, file: "laptop.png" },
  { test: /microphone|\bmic\b/i, file: "microphone.png" },
  { test: /smartphone|\bphone\b/i, file: "smartphone.png" },
  { test: /television|\btv\b/i, file: "television.png" }
];

/** Returns an icon URL for an Asset Type's name, or null if nothing matches (caller falls back to a plain code badge). */
export function assetTypeIconFor(typeName) {
  if (!typeName) return null;
  const rule = ASSET_TYPE_ICON_RULES.find((r) => r.test.test(typeName));
  return rule ? iconUrl(`asset-types/${rule.file}`) : null;
}
