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
- To make someone admin: the user sends the Google email; set `ADMIN_EMAILS` via Cloudflare API (PUT script secret `secret_text`) with the full comma list. DONE 2026-11-14: `ADMIN_EMAILS` secret is set to the owner's Google account (c6140259@gmail.com). To add more admins, PUT `/accounts/{id}/workers/scripts/blackjack-table/secrets` body `{name:'ADMIN_EMAILS', text:'a@x.com,b@y.com', type:'secret_text'}` with the FULL list (it replaces the old value). Secrets survive code deploys because of `keep_bindings:['secret_text']`.
- The owner's own device can still be approved with the key (`/api/admin/self`, `owner:true`).
- Tests: `tests/admin.test.mjs` (13), `tests/google.test.mjs` (17). `tests/test2.js` is LEGACY (tests the retired name flow) and fails by design.
- Keep this file updated with EVERY change (user request).

## State of the world (2026-11-14, end of session 1)
- Repo: https://github.com/CorbinPlayz/blackjack, branch `main`, latest commit "Require Google sign-in; Google admins via ADMIN_EMAILS secret; update handoff". Worker deployed = repo code (verified bindings ADMIN_EMAILS, ADMIN_KEY, REGISTRY, ROOM). Nothing is uncommitted.
- The sandbox shell cannot reach the worker URL or the Pages site; verify live behaviour only via the Cloudflare connector or by asking the user.
- Git commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: <session url>`.
- Registry storage keys: `g:<email>` = {ref,name,email,status,requested}; `r:<ref>` -> 'g:<email>' (or a deviceId for legacy/owner); `d:<deviceId>` = {google:email} or {owner:true,...}; `v:<ref>` = vault cents.
- Client: `isAdminAcct` (set from `/api/access/status` `admin`), `adminHdr()` sends the key only if one is stored; `$('gateRequest').hidden = true` always.
- Tests live in `tests/` (run with node): google, admin, quick, parity (15,000 random actions Core vs server), rules, rounds, fx, plus Playwright screenshot scripts. They need a fake DOM / copy of the worker (`w.mjs`); see the head of each file. `test2.js` is legacy and fails by design.
- Preferences from the user: no real money, phone-first, ignores multiple-choice questions (decide and state assumptions), wants HANDOFF.md updated on every change.

## NEXT BIG FEATURE (requested 2026-11-14, NOT started): fake bank accounts, no infinite money
User: "we need this to be a site where people can track their bank accounts 'fake banks' but can't just give themselves infinite money". Plan (assumptions, user ignores multiple-choice questions, so decide and state):
- The existing per-account vault (`v:<ref>` in Registry) becomes the bank account. Add an append-only ledger `l:<ref>:<seq>` {t, type, amount, balanceAfter, counterparty, note} and a global `supply` total.
- Money may only enter via: (a) a one-time signup grant per Google account (fixed amount, e.g. $1,000, flag `granted`), (b) admin "mint" (admin-only, logged with who/why), (c) trivia winnings (already capped per table). Everything else conserves money: transfers between accounts, table buy-in (account -> seat), cash-out (seat -> account), table losses go to the dealer/other players, not deleted.
- Close the holes: table `rebuy` ("bank trip") currently creates chips from nothing (only fee/trip-limited). Make it debit the account instead; `add` by host and `seat` with an arbitrary buy-in must also debit the account (no free chips). Seat balance cash-out must be credited exactly once (server-authoritative, idempotent, e.g. on remove/leave/table end).
- Invariant test: sum of all account balances + chips on live tables == total minted; add it to `parity.test.mjs`-style randomized tests. All balance changes only inside the Registry Durable Object (single-threaded, so no race/double-spend).
- UI: new "Bank" tab (balance, ledger, send money to a friend by email/name, admin mint panel). Client never sends a balance, only intents.
- Open questions to mention to the user, not block on: starting grant size, whether losing at tables moves money between players (recommended: yes, dealer is a player/bank account) and whether an admin can mint freely.
Update this file as each step lands.

## TO DO next
0. Ask the user to confirm Google sign-in works on a phone and that their admin account shows the Admin tab with no key (Google Cloud origin + test users must be set).
1. Ask the user to retest on real phones: stop hosting after a refresh, remove a player, a full quick round.
2. Get the rest of the "lots of bugs" list from the first play session.
3. Known loose ends: offline mode has no rounds (by design); trivia answer check is client-side (honor system, capped); Google button needs the Pages origin in the Google Cloud OAuth client and testers added while in Testing mode.
4. Deploying the worker: Cloudflare connector tool `mcp__cloudflare__execute`: PUT `/accounts/{id}/workers/scripts/blackjack-table` multipart, metadata `{"main_module":"worker.js","keep_bindings":["secret_text"],"compatibility_date":"2024-09-23","bindings":[ROOM, REGISTRY durable_object_namespace]}`, code embedded via `String.raw` (no backticks or `${` in the file; strip comments). Then GET `/settings` and check ADMIN_KEY, REGISTRY, ROOM. Deploy the worker BEFORE merging client changes that need new actions.

## Working style the user wants
Decide and keep going rather than asking multiple-choice questions; phone-first; keep it simple for friends; no real money.
