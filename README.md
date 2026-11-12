---
title: NASUR
emoji: 🦺
colorFrom: green
colorTo: blue
sdk: static
pinned: false
short_description: Offline-first HSE operating system with JARVIS
---

# NASUR – HSE Operating System

NASUR is a personal, offline-first industrial HSE (health, safety and environment) workspace with an assistant called JARVIS. It runs entirely in your browser. Your records are stored on your own device, and the app keeps working without an internet connection.

Created by Nasur.

## Build status

NASUR is being built in 12 phases. This is **Phase 1: Foundation**.

| Works now | Coming next |
| --- | --- |
| App shell with light, dark and automatic themes | Phase 2: Home command center, clock, weather, JARVIS drawer |
| Home screen and a list of all planned modules | Phase 3: Settings, careers, industries, projects |
| Offline storage (IndexedDB) with 51 stores | Phase 4 onward: Observations, Actions, Inspections, Learning and more |
| Offline start-up through a service worker | |

Modules marked **Planned** inside the app open a "not available yet" page.

## Privacy

- Records stay in your browser on this device. There is no NASUR server and no account.
- No analytics and no hard-coded keys.
- AI features are off by default. When they arrive, you will be able to add your own API key, and only the minimum context you allow will be sent.

## Important limits

- NASUR is a learning and record-keeping aid. It does not replace your site procedures, permits, legal requirements or the judgement of competent people.
- Data lives in the browser. If you clear site data, use a different browser, or the device runs out of space, records can be lost. Backup and restore arrive in Phase 12. Until then, treat the data as temporary.
- Dates and records are kept per browser profile. There is no sync between devices.

## Deploying on Hugging Face Spaces

1. Create a new Space and choose **Static** as the SDK.
2. Upload every file with the folder layout below (drag the folders into the Files page, or use git).
3. Open the **direct** address of the Space, which looks like `https://<owner>-<space>.hf.space`. The offline mode and "Install app" only work there, not inside the framed page on huggingface.co.
4. Load it once while online. After that it can start without a connection.

To update, upload the changed files again. Online visits always fetch the newest files. Open the app once online after an update so the offline copy refreshes.

## Folder layout (Phase 1)

```
index.html
manifest.webmanifest
sw.js
README.md
icons/icon.svg
css/tokens.css
css/base.css
css/components.css
js/core/config.js
js/core/eventbus.js
js/core/router.js
js/core/app.js
js/services/sanitize.js
js/services/db.js
js/services/repo.js
js/services/config.js
data/modules.json
data/hooks/manufacturing-hooks.json
tests/runner.html
```

## Running it locally

Opening `index.html` directly from the file system does not work, because browsers block ES modules there. From the folder that contains `index.html`, run `python -m http.server 8000` and open `http://localhost:8000`.

## Tests

Open `tests/runner.html` on the same address as the app (for example `https://<owner>-<space>.hf.space/tests/runner.html`). The tests use their own scratch database and never touch your real data.