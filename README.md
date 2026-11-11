# Blackjack Chip Tracker

Chip-balance tracker for **in-person** Blackjack (real cards, no digital game).
Every player bets alone against the dealer; there is no shared pot.

- Win pays 1:1, Blackjack pays 3:2, Push returns the wager, Loss loses it.
- Wagers larger than a player's balance are rejected.
- Recent hands list and **Undo Last Hand** (reverses only that hand's player).
- Add / remove players, reset balances. Saved in the browser, works offline.
- **Online table (optional):** the dealer's phone hosts and gets a 5-letter code;
  everyone else opens the site, enters the code and watches live balances read-only.

Live site: https://corbinplayz.github.io/blackjack/

## Files
- `index.html` — the whole app (vanilla HTML/CSS/JS, no dependencies).
- `worker/` — tiny Cloudflare Worker + Durable Object that relays the table state.
- Site is served by GitHub Pages straight from `main` (Settings → Pages → Deploy from a branch → `main` / root).

## Turn on the online table (one-time)
1. Cloudflare dashboard → create an **API token** (template: "Edit Cloudflare Workers") and note your **Account ID**.
2. GitHub repo → Settings → Secrets and variables → Actions → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Actions tab → run **Deploy online-table Worker**. Its log prints the worker URL
   (`https://blackjack-table.<your-subdomain>.workers.dev`).
4. (Done for this repo.) `index.html` points at `https://blackjack-table.camc-cf76.workers.dev`.

Until step 4 the app is fully offline and the online buttons just say it isn't set up.
Tables expire after 24 hours idle. Only the host's secret token can change a table.
