# Blackjack Chip Tracker

Chip-balance tracker for **in-person** Blackjack (real cards, no digital game).
Every player bets alone against the dealer; there is no shared pot.

- Win pays 1:1, Blackjack pays 3:2, Push returns the wager, Loss loses it.
- Wagers larger than a player's balance are rejected.
- Recent hands list, **Undo Last Hand**, **Add chips** (logged), add/remove players, reset balances.
- Works offline on one phone (saved in the browser).

## Online table (host + players)
- The dealer taps **Host an online table** and gets a 5-letter code (or **Copy invite link**).
- Players open the site, join with the code, then **take their own seat** with their own name and buy-in.
- **A player can only change their own seat**: their wager, win/blackjack/push/loss, added chips, undo of their own last hand, or leaving. They can only watch everyone else.
- The server enforces this (not just the screen), so it can't be bypassed by editing the page.
- The host can change any seat, undo any hand, remove anyone and reset the table. Host tools: **Pause players** (everyone can watch, nobody but the host can change anything) and **Max buy-in** (caps new seats and added chips).
- When the host stops hosting, the game stays on their phone as a normal local table.

Live site: https://corbinplayz.github.io/blackjack/

## Files
- `index.html` - the whole app (vanilla HTML/CSS/JS, no dependencies).
- `worker/` - Cloudflare Worker + Durable Objects (`Room` = a table and its rules, `Registry` = who is allowed in).
- Site is served by GitHub Pages straight from `main` (Settings -> Pages -> Deploy from a branch -> `main` / root).

## Access control (invite-only)
When the online service is configured, the app is invite-only:
- A new device sees only a "Request access" screen (enter your name). The host approves or blocks from the **Admin** panel at the bottom of the app.
- Approved devices open the app automatically and keep working offline. Blocked devices are locked out within about 15 seconds and the server refuses them.
- Admin = whoever knows the `ADMIN_KEY` secret. Sign in with it from the gate screen ("Admin sign-in") or the Admin panel.
- Note: the page's code is public on GitHub Pages, so the lock protects the online tables and the saved-approval flow, not the HTML file itself.

## Online service
`worker/` is deployed as the Cloudflare Worker `blackjack-table` (Durable Objects `Room` + `Registry`).
Set or change the admin key with `npx wrangler secret put ADMIN_KEY` (or the Cloudflare dashboard). The key is never stored in git.
`index.html` points at `https://blackjack-table.camc-cf76.workers.dev` via `ONLINE_URL`; set it to `''` for a fully offline copy.
Tables expire after 24 hours idle. Hosting uses a secret token that only the host's phone has.
