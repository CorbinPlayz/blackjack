# Handoff: Blackjack Chip Tracker (friends-only, no real money)

## What it is
A chip tracker for an in-person blackjack game (the cards are physical, only chips live in the app).
- `index.html`: the whole client, one file, vanilla JS. Script 1 = `Core` (offline rules, localStorage). Script 2 = UI IIFE. `<script type="text/plain" id="triviaData">` holds 594 trivia questions (`#Category` lines, then `question|correct|wrong|wrong|wrong`).
- `worker/src/index.js`: Cloudflare Worker `blackjack-table` (Durable Objects `Room` = one table, `Registry` = approved devices/Google accounts + vaults). Secret `ADMIN_KEY` (held by the user, NOT in the repo).
- Hosted on GitHub Pages (from `main`); the worker URL is the `ONLINE_URL` constant in `index.html` (blackjack-table.camc-cf76.workers.dev). Google Client ID is in both files (`GOOGLE_CLIENT_ID`).
- The server is the referee: `applyAction(table, actor, action, ctx)`. The client polls every 1.5s and mostly just renders the snapshot.

## Features already shipped (on main + deployed)
Invite-only access (Google sign-in or name request, admin approves), seats (players only touch their own chips, host/dealer touch all), rounds (wager -> dealer Start -> hands -> next round), double down, dealer hand-over (request/accept/reject/set), trivia (max 20% of buy-in, host-set), bank fee + trip limit, vault (savings per account), insurance, standings/net profit, effects + sound, tab layout (Table / Board / Me / Host / Admin) with bottom nav.

## Quick-round update (deployed 2026-11-14)
Worker (with autoBet, start-anyway, finish, undo-reopens-round, in-page confirm support) is deployed and the branch is merged to `main`.
- `window.confirm` replaced by `askConfirm()` (#confirmModal): likely cause of "can't stop hosting" / "can't remove players". Not yet confirmed on a real phone.
- Quick rounds: auto-repeat wager (Host tab toggle), quick-bet buttons, dealer settle board, "Start now without X", "Push all remaining hands", undo reopens a just-finished round, 1.5s polling.

## Google required + Google admins (deployed 2026-11-14)
- Admin = holder of the `ADMIN_KEY` secret OR a signed-in Google account whose email is in the `ADMIN_EMAILS` Worker secret (comma-separated, case-insensitive, never put emails in the repo). Admin emails are auto-approved on sign-in, and the client shows the Admin tab without a key (`isAdminAcct`, `adminHdr()`).
- To make someone admin: the user sends the Google email; set `ADMIN_EMAILS` via Cloudflare API (PUT script secret `secret_text`) with the full comma list. STILL PENDING: user has not yet sent the email(s).
- The owner's own device can still be approved with the key (`/api/admin/self`, `owner:true`).
- Tests: `tests/admin.test.mjs` (13), `tests/google.test.mjs` (17). `tests/test2.js` is LEGACY (tests the retired name flow) and fails by design.
- Keep this file updated with EVERY change (user request).

## TO DO next
1. Ask the user to retest on real phones: stop hosting after a refresh, remove a player, a full quick round.
2. Get the rest of the "lots of bugs" list from the first play session.
3. Known loose ends: offline mode has no rounds (by design); trivia answer check is client-side (honor system, capped); Google button needs the Pages origin in the Google Cloud OAuth client and testers added while in Testing mode.
4. Deploying the worker: Cloudflare connector tool `mcp__cloudflare__execute`: PUT `/accounts/{id}/workers/scripts/blackjack-table` multipart, metadata `{"main_module":"worker.js","keep_bindings":["secret_text"],"compatibility_date":"2024-09-23","bindings":[ROOM, REGISTRY durable_object_namespace]}`, code embedded via `String.raw` (no backticks or `${` in the file; strip comments). Then GET `/settings` and check ADMIN_KEY, REGISTRY, ROOM. Deploy the worker BEFORE merging client changes that need new actions.

## Working style the user wants
Decide and keep going rather than asking multiple-choice questions; phone-first; keep it simple for friends; no real money.
