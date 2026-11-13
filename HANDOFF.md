# Handoff: Blackjack Chip Tracker (friends-only, no real money)

## What it is
A chip tracker for an in-person blackjack game (the cards are physical, only chips live in the app).
- `index.html`: the whole client, one file, vanilla JS. Script 1 = `Core` (offline rules, localStorage). Script 2 = UI IIFE. `<script type="text/plain" id="triviaData">` holds 594 trivia questions (`#Category` lines, then `question|correct|wrong|wrong|wrong`).
- `worker/src/index.js`: Cloudflare Worker `blackjack-table` (Durable Objects `Room` = one table, `Registry` = approved devices/Google accounts + vaults). Secret `ADMIN_KEY` (held by the user, NOT in the repo).
- Hosted on GitHub Pages (from `main`); the worker URL is the `ONLINE_URL` constant in `index.html` (blackjack-table.camc-cf76.workers.dev). Google Client ID is in both files (`GOOGLE_CLIENT_ID`).
- The server is the referee: `applyAction(table, actor, action, ctx)`. The client polls every 1.5s and mostly just renders the snapshot.

## Features already shipped (on main + deployed)
Invite-only access (Google sign-in or name request, admin approves), seats (players only touch their own chips, host/dealer touch all), rounds (wager -> dealer Start -> hands -> next round), double down, dealer hand-over (request/accept/reject/set), trivia (max 20% of buy-in, host-set), bank fee + trip limit, vault (savings per account), insurance, standings/net profit, effects + sound, tab layout (Table / Board / Me / Host / Admin) with bottom nav.

## UNFINISHED / UNDEPLOYED (branch `wip-quick-rounds`)
User complaints from the first real play session: (1) host sometimes can't stop hosting, (2) can't remove players, (3) rounds feel slow, "not quick-round compatible" (biggest one).
Done in this branch, tested locally, NOT deployed:
- Root cause guess for 1 and 2: `window.confirm` is silently blocked on some phones/after repeated use. Replaced with an in-page modal `askConfirm()` (#confirmModal). Verified in a real browser. Not confirmed on a real phone.
- Server: `autoBet` setting (default on: each player's last wager is locked in again for the next round), `start` with `force` (start without players who have no wager), `finish` action (push all unsettled hands), undo of the very last hand reopens a just-finished round, `last` field on players.
- Client: one-tap quick-bet buttons on each card (5/10/25/50% of balance), dealer "settle board" (Win/BJ/Push/Loss for every hand in one panel), "Start now without X", "Push all remaining hands", Host-tab toggle "Repeat last wager", 1.5s polling.
- Tests (`tests/`): all passed locally: test2 (172), fx (66), quick (9), google (17), parity (15,000 random actions), rules, rounds. They were run from a scratch folder; fix the paths at the top of each file if you run them from `tests/`. They use a Node vm fake DOM; real-browser checks used Playwright (`tests/shot4.js` mocks the API).

## TO DO next (in order)
1. Deploy the worker from this branch. Cloudflare connector tool `mcp__cloudflare__execute`: PUT `/accounts/{id}/workers/scripts/blackjack-table` as multipart with `metadata` = `{"main_module":"worker.js","keep_bindings":["secret_text"],"compatibility_date":"2024-09-23","bindings":[ROOM and REGISTRY durable_object_namespace]}`. Embed the code via `String.raw` (file has no backticks or `${`; strip comments to shorten). Afterwards GET `/workers/scripts/blackjack-table/settings` and check ADMIN_KEY, REGISTRY, ROOM bindings are still there. The sandbox shell cannot reach the worker URL.
2. Merge the branch to `main` (Pages redeploys). Deploy the worker FIRST, otherwise the new buttons get "Unknown action".
3. Ask the user to retest on real phones: stop hosting after a refresh, remove a player, a full quick round (Start -> settle board -> next round auto-wagers).
4. Remaining complaints are unknown: ask the user for the rest of the "lots of bugs" list from the first play session.
5. Known loose ends: offline mode has no rounds (by design); trivia answer check is client-side (honor system, capped); Google button needs the Pages origin listed in the Google Cloud OAuth client and testers added while in Testing mode.

## Working style the user wants
Decide and keep going rather than asking multiple-choice questions; phone-first; keep it simple for friends; no real money.
