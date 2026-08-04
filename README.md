# Inventory OS

Internal asset lifecycle management platform for Artium Academy's Offline Centres.
Built against **Inventory OS – Product Blueprint v1.0** (12 chapters + Executive Summary).
The blueprint is the authoritative specification — this README only covers setup and status.

## Status

**Milestone 1 — Foundation: in progress.**
See the implementation summary provided at the end of this milestone for exact scope, files touched, and known limitations.

## Setup

### 1. Firebase project

Inventory OS ships with **placeholder Firebase config** in `js/firebase.js`. Nothing will
authenticate or read/write data until you replace it with your real project config:

1. Create a Firebase project (or use an existing Artium one).
2. Enable **Authentication → Google** sign-in provider.
3. Enable **Cloud Firestore** and **Firebase Storage**.
4. Firebase Console → Project Settings → General → Your apps → Web app → copy the config object.
5. Paste the six values into the `firebaseConfig` object at the top of `js/firebase.js`.

### 2. Seed Owners

The first sign-in from `omkar@artiumacademy.com` or `padma@artiumacademy.com` automatically
creates their `/users` document with the `owner` role. Every other account must be added
manually by an Owner (Users module — later milestone) before they can sign in; unrecognized
`@artiumacademy.com` accounts are otherwise denied access with a friendly message.

### 3. Run locally

This is a static site with no build step. Serve the folder with any static file server, e.g.:

```
npx serve .
```

or Python:

```
python3 -m http.server 8080
```

Open `http://localhost:8080/login.html`. (Opening `index.html`/`login.html` directly via
`file://` will not work — Firebase Auth popups and ES module imports both require a real
HTTP origin.)

### 4. Deploy

Designed for GitHub Pages — push to a repo, enable Pages on the `main` branch, no build step
required.

## Folder Structure

```
inventory-os/
├── index.html        Authenticated app shell
├── login.html         Public sign-in screen
├── css/
│   ├── theme.css       Design tokens (colours, shadows, radii, type) — inherited from Launch OS
│   ├── layout.css       App shell layout (sidebar + main region)
│   └── components.css   Reusable component library (buttons, badges, cards, panels, modals, toasts...)
├── js/
│   ├── firebase.js      Firebase init — single source of app/auth/db/storage instances
│   ├── auth.js           Google Sign-In, domain restriction, role resolution
│   ├── app.js             Shell bootstrap — sidebar, topbar, navigation, routing
│   ├── dashboard.js       Dashboard module
│   └── utils.js           Shared helpers (formatting, toasts, empty states)
└── assets/
    ├── icons/
    ├── illustrations/
    └── logos/
```

Each future milestone adds its own `js/<module>.js` and `css/<module>.css` rather than
growing the existing files — see Blueprint Chapter 10 for the full module boundaries.

## Design System

Visual language is inherited directly from Artium Launch OS
(https://omkaroffline.github.io/offline-centre-launch-os/) — purple accent, soft embossed
shadows, rounded corners, Inter typeface. `css/theme.css` holds the token layer; no page
should hardcode a colour, shadow, or radius outside of it.

Icons are currently minimal inline SVG placeholders (no PNG assets have been generated yet).
Swap them for Launch OS's illustrated 3D sticker-style icons in `js/app.js` (`iconHome()` etc.)
once those assets exist — nothing else about the sidebar needs to change.
