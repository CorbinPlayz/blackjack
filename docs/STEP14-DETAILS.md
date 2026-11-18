# Step 14: the detail bible (planning only, nothing here is built yet)

Rule from the user: "The small things matter always will." Add so much unnecessary detail that nobody forgets it.
Step 15 builds from this file. Every item is CSS, inline SVG or WebAudio (no libraries). Real-world facts were checked against
casino.org (roulette facts, blackjack glossary) and pokerlistings.com (craps glossary); items marked (gk) are from general knowledge.

## 0. House style for every table
- Palette: felt `#0b5d3b` to `#0e7a4d` radial, rail leather `#2a1710` with a 1px `#5b3a26` highlight, brass `#c9a24b` to `#8a6a22`, neon `#ff3b6b` and `#27e1ff`.
- Felt texture: SVG feTurbulence noise at 6% opacity plus a faint diagonal weave. Soft vignette so the middle is brightest.
- Light: one pendant-lamp spotlight cone from above (radial gradient), brightness wobbles +-3% every 2 to 5 seconds (like a bulb on a long cord). The lamp sways 0.4 degrees.
- Room behind the table: dark carpet pattern blurred 6px, 3 slot-machine silhouettes with twinkling lights, a neon "OPEN" sign that buzzes (opacity dips twice every ~40s), a few floating dust motes (12 dots, 40 to 90s drift loops).
- Timing language: small moves 180 to 260ms `cubic-bezier(.2,.8,.2,1)`; card throws 320ms; big moments 900ms. Nothing blocks input.
- Fancy / Lite switch: Fancy = all of this. Lite = no motes, no flicker, no blur, shorter moves. Auto-drop to Lite when 20 frames in a row take over 40ms. Pause every loop when the tab is hidden. `prefers-reduced-motion` forces Lite with no loops.

## 1. Blackjack
Table furniture
- Printed arcs on the felt: "BLACKJACK PAYS 3 TO 2", "DEALER MUST STAND ON ALL 17s", "INSURANCE PAYS 2 TO 1" (insurance line drawn as a half-ring in front of the bet circles).
- Bet circle per seat with the seat number; the circle glows brass when it is your turn to bet.
- Chip rack (grooved tray) in front of the dealer holding stacks in denomination colours; a stack is 20 chips (real dealers push 20-chip stacks).
- Discard tray on the dealer's side that fills with cards over the night; shoe on the other side with a visible card slab that gets thinner; a red plastic cut card shown near the bottom when it is reached, then "Last hand" banner and the shuffle after the round.
- Cup holder and a tiny "Est. 2026 · table CODE" brass plaque on the rail.
Dealing choreography (real order)
- Burn card on a fresh shuffle (one card flicked to the discard tray, face down).
- Round: one card to each seat left to right, dealer up card, one more to each seat, dealer hole card. 140ms between cards; each card arcs from the shoe with 2 to 4 degrees of random tilt and 1 to 3px random offset, soft shadow that shrinks as it lands, tiny 4% overshoot.
- Dealer peek on ace or ten up: the hole card's corner lifts and bends for 600ms, then drops. If blackjack, the flip and a short "Dealer has blackjack" bubble.
- Hand signals when you act: Hit = a fingertip tap puff on the felt behind your cards (ripple), Stand = a flat palm wave (a hand sweeps over the cards), Double = the extra chips slide next to the bet and the new card lands sideways (turned 90 degrees), Split = cards slide apart and a second bet circle appears.
- Dealer hole-card flip is a real 3D flip (rotateY with a mid-flip highlight).
Seats and people
- Up to 6 seats on an arc (or the number chosen). Brass nameplate with the name engraved, round initial avatar in a stable colour from the name, chip stack drawn from the real balance with denomination colours (stack height capped at 12 visible chips plus "+").
- Empty seat: ghosted stool with "+ Sit here". Sitting down: the stool slides in 250ms and the nameplate "clicks" on. Leaving: chips slide into the rack, stool fades.
- Turn ring: a glowing arc around the active seat that shrinks over the real timer; the last 5 seconds pulse.
- Colour up (gk): when you leave with many small chips the rack "colours you up" into big chips before the cash-out number counts into your bank balance.
Outcomes
- Win: chips come from the rack and slide next to your bet, a "+$" label floats up. Lose: the dealer's hand sweeps your chips and cards away. Push: both pulse once.
- Blackjack: gold ring burst around the two cards, "BLACKJACK" banner on the felt, small gold confetti (24 pieces), soft chime. Bust: cards shake 6px, desaturate, red "BUST" stamp rotated -6 degrees.
- Balance and chip numbers count up/down over 600ms instead of jumping.
Dealer
- Named dealer (rotating pool such as Dee, Marco, Priya, Lou) with a tiny bust illustration and a speech bubble: "Place your bets", "Dealer shows 17", "Insurance?", "Bust! Better luck next hand", "Cards in the air" at the 5-second countdown. Tap the dealer for a random quip (12 lines, never the same twice in a row).
- Shuffle: riffle animation (two half-decks interleave), 1.2 seconds, with "Shuffling…" and the cut card visibly inserted.
- Toke (gk): a "Tip the dealer" chip button. It is cosmetic only (a thank-you bubble), no money moves, unless we decide to route it into the casino pot (decision below).

## 2. Roulette
Wheel (SVG, 38 pockets in real American order)
- Anatomy to draw: outer wooden bowl with a brass rim, the ball track, 8 diamond-shaped deflectors ("canoes" or frets, they scatter the ball as it drops), the pocket ring with thin metal separators, a cone with a spinning turret and a brass cross handle.
- Wheel stays in perpetual motion the whole time between spins (never stops, as at real tables); the ball is launched in the opposite direction to the wheel. After every spin the direction flips (European-style) so the motion never looks repeated.
- Spin: ball launched fast on the rim (about 1.1 turns per second, slowing), drops through the deflectors with 2 to 3 bounces (damped bounces at roughly 180ms, 120ms, 70ms) and settles in the server's `roul.num`. Motion blur on the ball track at speed (SVG blur 1.5px that fades). Light sweep reflection crossing the rim every revolution.
- Sound: a tick per pocket passed that slows down, 3 short clacks for the bounces, one soft "thunk" in the pocket. Each is a WebAudio blip (square 1.6kHz, 18ms).
- Timing from the server: the ball is released when the window closes; the animation lasts about 5 seconds and the results text, win amounts and history only appear after the ball lands. Worker change: results phase 8s to 12s.
Croupier and table
- "No more bets" banner and a hand-wave sweep across the felt when the window closes; the board dims to 60% brightness and chips lock.
- The dolly marker (a glowing brass block) drops onto the winning number and stays until the next window. Losing chips are swept ("mucked") in a stack slide; winners are paid in neat 20-chip stacks next to their bets.
- Chip colours (gk): each player gets a distinct chip colour at roulette (so the croupier can tell whose bets are whose), taken from the same colour as their avatar. Roulette chips have no fixed value; ours keep the $5/$10/$25/$50/$100 labels.
- History board above the wheel: last 20 numbers on a dark sign with red/black/green and a hot/cold count (most and least seen in the last 50).
- Picture-bet names as hover tips (gk and casino.org): Mickey Mouse, Deck of Cards, Basket, Picture Frame, Dinner for Two, shown only if someone makes that chip pattern (tiny "You made a Picture Frame!" toast).
- Countdown ring around the wheel (stroke-dashoffset), turns amber at 10s and red at 5s.

## 3. Craps
- Printed layout in felt: Pass Line, Don't Pass Bar, Field, Any 7 and Any Craps boxes in the middle, point numbers (4, 5, SIX, 8, NINE, 10) along the top, a padded rail with a grooved chip rack.
- Puck: black "OFF" side and white "ON" side (real). On the come-out it rests in the Don't Come box; when a point is set it flips with a 3D turn and slides onto the point number; when the point or a 7 ends it, it flips back and slides home.
- Dice: tumble across the felt with a visible shadow, hit the back wall (a short wooden bump sound), bounce 2 times, random pips show while tumbling, then land. Rolls begin from the shooter side of the table. Stickman with a bent stick hooks the dice back into view (a stick sweeps in).
- Stickman calls on every roll (bubble over the table): 2 "Snake eyes! Craps." 3 "Ace deuce, three craps." 4 "Little Joe." (hard four: "Little Joe from Kokomo") 5 "No field five." 6 "Easy six." (gk) 7 "Seven out! Pay the don'ts." or "Seven, winner winner, pay the line." (the real wording avoids saying 7 as the word when possible: "Big Red") 8 "Eight, a square pair" (gk) 9 "Nina from Pasadena" (gk) 10 "Ten, the big one on the end" (gk) 11 "Yo-leven!" 12 "Midnight! Boxcars." Calls marked (gk) are standard stickman patter, not from the glossary.
- Results: pass-line winners get chips from the rack and a green wash; seven-out gets a quick red flash across the felt and the chips swept.
- Hot streak: if the same point is made 3 times in a row, the lamp flares and the stickman says "Hot table!".

## 4. Video poker
- Arcade cabinet frame: dark bezel, marquee lights chasing every 120ms, a "COIN" slot and a ticket printer slot that prints a little "ticket" on a win.
- Cards: 3D flip on deal (80ms stagger), HELD cards slide up 10px with a gold tag and a click sound, replaced cards flip in again.
- Pay table: the winning row pulses and a coin counter ticks up 1 unit every 20ms; royal flush = fireworks (5 bursts), a siren sweep and "ROYAL!" in gold.
- Bet chips behave like coins dropping into the slot.

## 5. Lobby and everywhere else
- Lobby floor: a map-like row per table with a tiny live preview (dots for seated players, the point puck, the last roulette number), table lamps glow when busy.
- Sit-down moment: a short camera-zoom (scale 1.04 over 300ms) toward your seat.
- Ambient sound: low casino murmur and soft jazz, OFF by default with a speaker button, cross-fades between games (jazz for blackjack, a quieter hum for roulette, brighter for craps).
- WebAudio sfx (no files): card slap (noise burst 40ms, lowpass), chip clack (two short sine blips 2.4kHz and 3.1kHz), shuffle (filtered noise 1.2s with 8 amplitude pulses), win chime (major triad arpeggio), bust thud.
- Haptics: `navigator.vibrate(8)` on deal and chip place, `[10,30,10]` on win, `[40]` on bust, only when available and Fancy is on.
- Small secrets: rare golden card (1 in 100) shine sweep; tap the pendant lamp to switch mood (warm, blue, neon); seasonal string lights around the rail in December; a lucky-charm token (clover) on your nameplate if you have won three hands in a row; flame next to a name on a 5-win streak; "Tonight's biggest win" ticker in the lobby; footprints? no. Tapping the neon OPEN sign makes it say "CLOSED" for a second.

## 6. Decisions to confirm with the user (defaults in brackets)
1. View: flat top-down [flat].
2. Look: modern [modern with a hint of classic brass].
3. Speed: snappy [snappy, 320ms card throws].
4. Seats: up to [6].
5. Build order: [blackjack, then roulette, then craps and poker, then the small-details pass].
6. Tip the dealer button: cosmetic only [cosmetic only; routing into the pot would change the money invariant tests].
