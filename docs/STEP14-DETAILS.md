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

---
# PART 2: even more detail (2026-11-18, "MORE DETAIL TO EVERYTHING, THE BACKGROUND, EVERYTHING")
Same rules: planning only, CSS / SVG / WebAudio only, everything cosmetic (no money moves), everything switchable off by the Lite mode.

## A. The room behind the tables (the background, in layers)
Parallax in 4 layers; each layer shifts 2 to 10px with device tilt (phones) or pointer position (desktop), 0 in Lite.
1. Far wall: dark burgundy wallpaper with a damask pattern, gold-leaf crown molding, three framed paintings that are actually tiny SVG scenes (a horse race, a sailing ship, a hand of cards) with picture lights that glow. Mirrored pillars show a faint reflection of the lamps.
2. Mid ground: a long bar with a bartender silhouette polishing a glass, rows of bottles that catch a slow colour sweep, a neon cocktail glass sign. Slot-machine row: 6 cabinets, each screen cycles symbols (cherry, bar, 7, bell, diamond) at a different rhythm, a "JACKPOT" light that chases. A velvet-rope VIP corner with a "RESERVED" brass sign (empty; tapping it says "Reserved for the high roller").
3. Moving figures (all silhouettes, never clickable, 3 to 5 at most): a cocktail waitress crosses with a tray every ~3 minutes, a pit boss paces behind the dealer with arms crossed and glances at the table, a patron walks by in the far aisle. They never block the UI and stop in Lite.
4. Foreground: the table, plus a soft blurred chandelier at the top edge with crystal sparkles (small star twinkles on a random crystal every 600ms).
Ceiling and sky: a security dome ("the eye in the sky") with a tiny red light that blinks every 2s and swivels slightly toward whichever seat just won big.
Big sign above the tables: "PROGRESSIVE POT $X" showing the live casino pot with a slot-machine style rolling odometer, and a "Pit open since HH:MM" clock-free line (real casinos have no clocks, so there is no clock; tapping the sign says "Time is not on the menu").
Floor: carpet pattern with a repeating tiny dice-and-spade motif, a worn path (lighter strip) leading to the table, a dropped red chip in the corner that nobody picks up (tap it: "Finders keepers, not really").
Windows: none (on purpose). A "No windows. No clocks." plaque on the wall.
Time of night (uses the viewer's local clock, purely visual): 6pm to 9pm warm and bright, 9pm to 2am deepest gold with the most neon, 2am to 6am "last call": dim, the bartender yawns, fewer figures, a mop-bucket cart parked far away, 6am to 6pm "early shift": lights on a dim daylight setting and a quiet murmur.
Weather-of-the-night sprinkles: December adds string lights and a small tree by the bar; Halloween (Oct 31) adds a cobweb on the lamp and pumpkin chips on the rail; New Year's Eve countdown confetti at midnight local time.
Ambient layers: murmur (filtered noise), distant slot jingles (random 2 to 4 note blips every 8 to 20s), a faint glass clink, distant laughter blip. Each layer has its own gain and all duck 40% for 1.5s when somebody at the table wins big.

## B. The felt and the table surface
- Center watermark: a faint engraved crest with the table code and the game name; for blackjack the dealer-side arc text reads "DEALER MUST STAND ON ALL 17s".
- Wear and life: subtle scuffs near each seat, a faint round drink-ring near the cup holder, three chip-dust specks on the felt, a single dropped card corner shadow that never moves.
- Leather rail with stitching, brass studs every 40px that catch a highlight when the lamp wobbles, a small brass table-number plate, tiny cigarette-burn? no (keep it friendly); instead a polished brass ashtray-lid used as a coaster for the dealer's glass of water.
- Your seat has a beverage: pick a drink in settings (soda, coffee, club soda, tea, mocktail); a tiny glass with steam or bubbles animating on the rail by your seat.
- Table colour options (cosmetic unlockables, see N): green, blue, burgundy, black-and-gold.

## C. Cards (the stars)
- Card back: a navy and gold lattice with the app's spade-chip crest in the middle; a 1px inner border; slight sheen sweep when dealt.
- Faces: crisp corner index (rank and suit) top-left and bottom-right rotated; centre pips laid out correctly for 2 to 10; J, Q, K drawn as simple flat SVG figures in two colours; ace of spades extra large and ornate.
- Edge thickness: a 1px lighter edge on the bottom so a stack looks 3D; stacks at the shoe have a visible slab thickness proportional to the cards left.
- Sound per card: three slap variants, random pitch +-6%, volume tied to the throw distance (far seats are a touch quieter).
- Cards cling: when a split pair is dealt, the second card sits 8px lower and 6px right, like real hand-fanned cards.
- 4-colour deck option (accessibility): spades black, hearts red, diamonds blue, clubs green.
- Result tint: a winning hand's cards get a thin gold underline glow, a losing hand dims to 70% and slides 6px away from the bet.

## D. Chips
- Design: a face with 8 edge spots (rotating pattern per denomination), an inner ring with the value in engraved type, the crest in the middle. Colours: $5 red, $10 blue, $25 green, $50 orange, $100 black, $500 purple, $1,000 yellow; bigger stacks mix colours using a greedy colour-up.
- Stack drawing: each chip is offset by 1 to 2px randomly in x, rotated +-2 degrees, 3px high; a faint contact shadow beneath each stack; stacks of over 20 are split in two (the dealer rule).
- Chip riffling: when you sit idle for 20s your top chips do a tiny finger-flip animation, and the dealer's rack settles with a click.
- Chip sounds scale with stack size: one chip is a light tick, five is a clatter, twenty is a cascade (3 overlapped clack bursts).
- Win flight: payout chips fly from the rack on a curved path (a quadratic bezier), 40ms apart, landing with a slight bounce.
- Long-press any chip stack to see its total value in a small tooltip (a paper slip).

## E. People and idle life
- Dealer idle moves (every 6 to 12s, one random): straightens bow tie, glances at a seat then another, riffles a stack of chips, wipes the felt with a hand, taps the table twice.
- Seat avatars blink every 3 to 6s, and get a small sweat-drop when they are on 20 or more with a dealer up card of 10.
- Emotes: tap a seat's avatar to send a quick reaction (clap, fire, grimace, sunglasses, heart, "gg"); the emoji floats up from that seat for 1.5s; max 1 every 3s; no free text (kid-safe and spam-safe). Everyone sees it.
- Table chatter bubbles (from presets only): "Nice hand!", "Ouch.", "Hit me!", "Feeling lucky", "Last one, I swear".
- Dealer personalities (random per table, shown on a tiny name card): Dee (warm, jokes), Marco (dry), Priya (cheerful), Lou (old-school, says "kid"). Each has their own lines (20 per dealer) for deal, win, lose, bust, blackjack, shuffle, idle, and a goodbye when you leave.
- Pit boss: appears at the edge of the table when a pot-limit message shows ("The pit boss says that is over the limit.").

## F. Roulette extras
- Wheel lacquer: highlights that slide as the wheel turns, the lamp reflected as a soft white arc on the polished ring, the pocket numbers engraved in gold with a slight inset shadow.
- Ball: a small glossy white ball with a tiny moving glint; it casts a short shadow on the pocket ring; when it rattles, tiny sparks (2px dots) fly at each deflector hit.
- Turret: spinning brass cross with a faint rainbow reflection in Fancy mode.
- Racetrack (the oval betting area beside the main grid): Voisins du Zéro, Tiers du Cylindre, Orphelins labels as quick-bet shortcuts (American version: simple "Neighbors of 0" group bets are optional later).
- Hot/cold: flame icon on numbers hit twice in a row in the last 20 spins, snowflake on numbers not seen in 50.
- Result sign: an LED panel above the wheel flashes the winning number with colour and "ODD / EVEN / LOW / HIGH" tags, then dims and keeps the last 20 as a ticker.
- Croupier rake: a long rake sweeps the board to clear losing chips, with a swish sound.
- Dealer says the number: "Seventeen, black." in a bubble; "Double zero, green." for 00; "Zero." for 0.
- "Chip colours" per player via a coloured rim stripe to tell bets apart on the shared board.

## G. Craps extras
- Dice: translucent red cubes with white pips and a thin serial number etched on a face (decorative), real CSS 3D cubes tumbling with random axes (three rotations), rounded corners, the shadow squashing as they bounce.
- Shooter: a hand silhouette tosses from the table edge nearest the active seat; the shooter's name plate lights up and a "Shooter" sash appears.
- Table staff: stickman (bent stick and a bow tie), a boxman seated at the center with a chip stack, two base dealers; tiny sweat/pose animations.
- Proposition box in the middle with illustrated bets (hard ways with dice icons, horn, whirl icon), printed even if some are not playable yet (they show "coming soon" with a ribbon).
- Sound: dice rattle in the hand (filtered noise 400ms), a hit on the back wall (a short wood knock with a rubbery decay), skitter on felt, a chip toss.
- Crowd: when a point is made, a soft cheer blip; on a seven-out, a mock groan.
- Points board: the six point numbers with little brass marker discs; "ON" puck slides with a small wooden clack.

## H. Video poker extras
- Screen: CRT scanlines at 4% opacity, a slight screen curve with an inner vignette, a very faint flicker (every 8s one 60ms dim), glass reflection streak across the top left.
- Seven-segment credit and bet readouts that count; button panel with real-looking plastic buttons (HOLD under each card, DEAL/DRAW, BET ONE, BET MAX) that depress 2px with a click.
- Attract mode: after 45s idle the cards flash a demo royal flush, the marquee goes faster, and a "PRESS DEAL TO PLAY" text blinks.
- Payout: a coin hopper sound burst and coins spill into a tray at the bottom of the cabinet (tiny SVG coins piling up, shown for 3s).
- Ticket printer: a paper ticket slides out with the date, table code and the win amount; it stays in the corner and tapping it tears it off.

## I. The rest of the app, themed as a casino (every tab is part of the building)
- Opening: first time you arrive, the doors slide open (two big wooden doors) onto a red carpet with a doorman "Welcome in. First time? Look around." The doors play only once per device, then skip.
- Lobby ("the floor"): table cards laid out like a floor map; a busy table has a warm lamp and a small crowd dot count; the empty ones are dim. A "Pit boss recommends" star on the busiest table.
- Table tab simplified: "Take a seat" is a sign with brass letters; the host's table code on a brass plate you can tap to copy.
- Board (leaderboard): framed portraits on a wall; top 3 get gold, silver and bronze frames with a little light above each, the rest hang as smaller frames; names on brass plates; a "Hall of fame" for past-lockdown survivors.
- Bank tab ("the cage"): a teller window with a brass grill, a counter with money-counting animation, your ledger as thermal-paper receipts with zigzag torn edges and a monospace font; a stamp animation ("PAID", "RECEIVED") when a transfer lands; a tiny "NEXT WINDOW PLEASE" sign.
- Loans: a casino marker slip with a handwriting-style signature that draws itself, a due date stamp in red; overdue turns the slip red with a "PAST DUE" stamp and the pit boss icon looks at you.
- Daily bonus: a "COMP" coupon tearing off a perforated strip, with a sparkle; or a fortune-cookie crack that reveals a one-line fortune ("A pair of eights is nothing to split about") and the bonus amount.
- Trivia: the "pit boss quiz" with a buzzer sound and a game-show style countdown bar.
- Lockdown screen: rolling steel shutters come down across the whole screen with a rattle, a "CLOSED FOR RENOVATION" sign swings on a chain, the countdown glows in neon, and a tiny crew of paint-roller silhouettes work behind the shutter; at zero the shutters roll up and the doors slide open with fanfare.
- Onboarding: a host greeter bubble that points at things with a golden arrow ("Tap here to take a seat").
- Me tab: your player card as a membership card (the casino's rewards club), with your name, tier (Bronze, Silver, Gold, Platinum by hands played, cosmetic only), a barcode-like pattern, and a member-since date.
- Empty states have a character: "No tables open. The floor is quiet. Start one?" with a sleepy dealer.
- Loading: a spinning chip with rotating lines ("Shuffling 6 decks…", "Counting the chips…", "Dusting the felt…", "Waking the dealer…", "Polishing the roulette ball…").
- Errors in voice: "The pit boss says no: that bet is too big." / "The cage is closed for a moment. Try again." / "Lost the connection. The dealer is holding your seat."

## J. Typography, colour and copy
- Fonts (system stacks only, no downloads): engraved brass plates use `Georgia, "Times New Roman", serif` uppercase with 0.12em tracking; neon uses `"Arial Rounded MT Bold", system-ui` with a glow text-shadow; receipts use `ui-monospace, Menlo, Consolas`; scoring digits are tabular.
- Neon: double text-shadow (tight and wide) in the same hue, 2 to 3 second slow flicker with a rare double-blink, never faster than 3 flashes per second (photosensitivity).
- Colour tokens kept in CSS variables so a seasonal or table theme only swaps the variables.
- Voice: warm, a little cheeky, never insulting. Every message under 12 words. No exclamation spam.

## K. Sound design sheet (all WebAudio, no files; master volume and mute remembered in localStorage inside try/catch)
| Sound | Recipe | Notes |
| --- | --- | --- |
| Card slap | white noise 35ms, highpass 800Hz, fast decay | 3 variants, pitch +-6% |
| Card flip | two 12ms noise bursts 60ms apart | quieter |
| Chip clack | sines 2.4kHz and 3.1kHz, 25ms each, decay 60ms | pitch up with stack size |
| Chip cascade | 6 clacks over 220ms at random pitch | payouts |
| Shuffle | noise 1.2s, bandpass 1.5kHz, 8 amplitude pulses | riffle |
| Wheel tick | square 1.6kHz, 18ms | rate follows the wheel |
| Ball bounce | sine 900Hz 40ms plus noise 20ms | 3 bounces, decaying |
| Dice rattle | noise 400ms, bandpass 2kHz modulated at 18Hz | |
| Wall knock | sine 180Hz 80ms, fast decay | craps |
| Win chime | C5, E5, G5 arpeggio 90ms apart | triangle wave |
| Blackjack sting | C5 to C6 sweep plus shimmer | gold ring burst |
| Bust thud | sine 90Hz 220ms, pitch drop | |
| Button click | 8ms noise + 1.2kHz blip | UI |
| Buzzer | square 120Hz 300ms | trivia wrong |
| Shutter rattle | filtered noise 1.5s with 12Hz tremolo | lockdown |
Music: a short generated lounge loop (walking bass on triangle, brushed noise hi-hat, a sparse electric piano), 8 bars, OFF by default; ducks when sound effects play.
Every sound also has a visual cue (a captions flash) so sound-off players miss nothing.

## L. Accessibility details
- 4-colour deck option, larger text option, high-contrast felt option.
- Left-handed layout: my-hand action panel on the left.
- Every animated thing has a still equivalent, and `prefers-reduced-motion` removes loops.
- Tap targets 44px, no important info in colour alone (hands have text results, chips have numbers).
- Haptics are optional, off in Lite.

## M. Micro-interactions in the app chrome
- Tab bar: a brass underline slides between tabs (180ms); the active icon gets a soft glow.
- Buttons: press-in 2px with shadow shrink, and a quick 60ms highlight ripple.
- Toggles: a tiny chip flips to show on/off.
- Numbers: every balance counts up or down; a small plus/minus delta chip floats away from it.
- Pull-to-refresh on the lobby: a chip spins and lands flat.
- Toasts are little paper slips that slide in from the top with a slight tilt and a paperclip.
- Copy-code: the plate flashes brass and shows "Copied" for 1.2s.
- Focus rings in brass, 2px.

## N. Cosmetic collection (no money, no advantage)
- Unlocks by playing: card backs (navy, red diamond, black and gold, neon grid), felt colours (green, blue, burgundy, black-and-gold), chip edge styles, nameplate frames (brass, silver, copper, neon), avatar frames, dealer choice at a hosted table, table lamp moods.
- Milestones: first win, first blackjack, 25 and 100 hands, first loan repaid, first craps point made, first royal flush, surviving a lockdown, 7 wins in a row, a visit at 3am.
- Reward is a cosmetic plus a toast; shown on the Me tab membership card.

## O. Easter eggs (never required, always delightful)
- Tap the shoe 7 times: "Lucky 7" confetti and a sparkle on the next card.
- Konami code on the Me tab: the felt turns gold for the session.
- Lose 7 hands in a row: the dealer slides a "sympathy cookie" (cosmetic emoji) and says "On the house."
- Win with exactly 21 using 5 cards: a "Charlie!" banner and bell.
- Tap the neon OPEN sign: it says CLOSED for a second.
- Tap the security dome: the camera waves.
- Seven-out followed by a point made on the next roll: stickman says "Back from the dead".
- Roulette lands the same number twice: "Déjà vu" toast.
- Leave a seat with a profit: the dealer says "Come back soon."

## P. Build budget and guardrails
- Target: 60fps on a mid phone; budget 6ms per frame for effects; use transforms and opacity only; one `requestAnimationFrame` loop shared by every effect; stop when hidden.
- File size: all art is inline SVG symbols reused with `<use>`; keep the added code under about 120KB (the page is one HTML file); lazy-build the heavy parts (wheel, dice, silhouettes) the first time a table of that type opens.
- All new effects register in one `FX` module with `enabled(level)` so Lite/Fancy/Off is one switch.
- Testing: a Playwright run per surface (screenshots in Fancy and Lite), a frame-time check, a reduced-motion check, a check that the page still works with all effects forced off, and the money-invariant suites unchanged.
- Order inside step 15: 15a felt + room, 15b dealing + chips + hand panel, 15c roulette wheel, 15d craps and poker, 15e collectibles, sounds, easter eggs, 15f performance and accessibility pass. Chrome and app-wide theming (section I and M) come with 15e.

---
# PART 3: build-level detail (2026-11-18, "Yes more detail")
Part 1 and 2 say what it looks like. This part says exactly how, so step 15 has no guesswork. Still planning only.

## R. Layout and geometry
Design canvas: the table is one SVG/HTML stage with `viewBox 0 0 360 520` on phones (portrait), `0 0 960 540` on desktop. Everything is positioned in stage units and scaled with `transform: scale()` so the same art fits every screen.
Z-order (bottom to top): 0 room background, 1 far figures, 2 table shadow, 3 rail, 4 felt, 5 printed markings, 6 bet circles, 7 chips on the felt, 8 cards, 9 seat plates, 10 effects (sparkles, confetti), 11 dealer bubble, 12 hand panel and controls, 13 toasts, 14 modals.
Blackjack seats (desktop, stage 960x540): table is an ellipse centered (480,260), radii 400x170; the seat arc follows y = 260 + 170*sin(t), x = 480 + 400*cos(t) for t in [20deg, 160deg]; 6 seats at t = 30, 54, 78, 102, 126, 150 degrees (seat 1 left, seat 6 right). The dealer stands at (480, 70), shoe at (610, 90), discard tray at (350, 90), chip rack at (480, 130).
Phones (stage 360x520): the dealer at the top (180,60), the shoe at (260, 70), discard at (100, 70). The other players sit in a row of small seats at y=190 (up to 5, 56px wide each); MY seat is large at the bottom (180, 360), 150px wide, with cards 48x68. The hand panel docks at the bottom-right (right 12px, bottom 72px above the tab bar, 168px wide) with the cards, total and four 44px buttons in a 2x2 grid. The left-handed setting mirrors the panel to the left.
Bet circles: 44px radius 22 on desktop, 36px on phones, centered 54px in front of each seat. Cards for a seat are stacked with a 22px horizontal fan per card (desktop 26px), up to 8 cards, then they overlap further.
Dealer cards: placed at (dealer x - 30 + 28*i, 112) so the hole card is the second, face down at first.
Safe areas: all controls stay inside `env(safe-area-inset-*)`.

## S. The roulette wheel, exactly
Pockets (American, clockwise from the top, verify against `roulLabel` in the code before building): 0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 00, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2 (38 pockets, 9.4737 degrees each).
Rings (SVG circles, wheel viewBox 0 0 300 300, center 150,150): outer bowl r=146 (wood gradient), brass rim r=140 to r=134, ball track r=132 to r=112 (dark lacquer with a groove), deflector ring at r=112 (8 diamonds), pocket ring r=96 to r=66 (red/black/green wedges with 0.6px metal separators), number ring r=88 (text 9px, gold), inner cone r=60 to r=24, turret r=24 to r=8, cross handle 4 arms.
Rotation: the inner group (pockets, cone, turret) rotates around the center at 0.07 turns per second (about 25 degrees per second) clockwise, never stopping. The ball is a separate group on the track rotating the other way.
Ball timeline for a server result at pocket index k (target angle in the wheel's own frame = k * 9.4737 + 4.74):
- t = 0 to 1.6s: ball at r=122 spins at 1.15 turns/s decelerating by easing `cubic-bezier(.25,.1,.25,1)`, counter to the wheel.
- t = 1.6s to 3.4s: ball spirals inward from r=122 to r=104 while slowing to 0.35 turns/s; wobbles +-1.5px.
- t = 3.4s to 4.3s: the drop: hits the deflector ring (random one of 8) and bounces 3 times: apparent radius changes r=104 -> 99 (bounce 1, 180ms) -> 102 -> 97 (120ms) -> 100 -> 96 (70ms); each bounce also nudges the angle by +-6, +-3, +-1 degrees.
- t = 4.3s to 5.0s: the ball rolls through 1 to 2 adjacent pockets (a half turn of the settle) and drops into pocket k; it then rides with the wheel (the ball group's angle = the wheel's angle + the target) so it stays in its pocket.
- Timing compensation: the poll delay is up to 1.5s and the server clock offset is known (`skew`); the animation starts at the server's spin time (`roul.nextAt - 8000`) minus the skew, so players who see the result late catch the spin partway; if more than 4s late the ball is just placed in the pocket.
- Wheel direction flips each spin (alternating by `roul.n` parity).
Light: a white elliptical highlight (opacity .35) fixed in the screen frame (not rotating) so reflections slide across the rotating lacquer.
Dolly: a 14x14 brass block with a 2px highlight dropped from 60px above the winning number's board cell in 280ms with a small bounce, glow 8px; on the next window it lifts away.

## T. State-diff event model (how the client animates a polled state)
Keep `prev` and `cur` normalised states. A pure function `events(prev, cur)` returns an ordered list; the animation queue plays them without blocking input, and if the queue is longer than 6 seconds of work it fast-forwards (plays at 3x) so the screen never lags behind the truth.
Events (blackjack): `seat-in(seat)`, `seat-out(seat)`, `bet(seat, amount)`, `deal-card(target, index, card|null, faceDown)` (dealing order recovered as seats left to right, dealer up card, seats again, dealer hole), `peek`, `flip-hole`, `hit(seat, handIdx)`, `stand`, `double`, `split`, `insurance`, `bust`, `blackjack`, `dealer-draw`, `settle(seat, net)`, `shuffle`, `cut-card`, `last-hand`.
Rules: if `prev` is null (first snapshot after joining) emit nothing and just draw the final scene (no animation for what is already there); cards that appear in `cur` but not `prev` are "new"; the new cards' order is by (round deal order); a `deal-card` for a face-down dealer card never carries the value; ids come from `players[].id` and `hands[].idx`.
Events (roulette): `window-open`, `bet-placed(seat,kind,sel,amount)`, `no-more-bets`, `spin(num)`, `land(num)`, `settle(seat,net)`, `clear-board`.
Events (craps): `window-open`, `bet-placed`, `roll(d1,d2)`, `point-on(n)`, `point-off`, `settle`.
Events (poker): `deal(hand)`, `hold-toggle` (local only), `draw(hand)`, `result(k,net)`.
Idempotence: events are derived from state, so duplicates after reconnect cannot replay; `lastV` (state version) gates the diff.

## U. What the server would need (small, optional, all cosmetic)
- Blackjack public state could add `shoeLeft` (cards remaining, 0..312), `cutAt` (boolean, true when the cut card has been reached) and `shuffled` (a counter that increments on each reshuffle) so the shoe thickness, cut card and shuffle animation are real. These leak nothing the player cannot already infer.
- Dealer persona: `settings.dealerName` chosen from the 4 on table creation (one field).
- Emotes: an action `emote {e}` (e in a fixed list of 8) stored as `p.em = {e, at}` on the seat, expiring after 3 seconds, rate-limited to one per 3 seconds per seat; no money involved; included in the poll like any other seat field.
- Roulette results phase 8s to 12s (one constant).
- Nothing else; the invariant tests are not touched because none of these move money.
- Client-only for: avatar colour (hash of the name), drink choice, cosmetics (stored in localStorage; a later step could save them to the account in the Registry with a tiny `/cosmetics` route).

## V. The FX module (so it stays tidy)
```
FX = { level: 'fancy' | 'lite' | 'off', on(name), loop(name, fn), once(name, fn), pause(), resume() }
```
One `requestAnimationFrame` loop drives every registered loop with a delta time; each loop has a cost class (1 cheap, 3 heavy) and in Lite only cost 1 loops run. A frame-time monitor counts slow frames and flips Fancy to Lite after 20 slow frames in a row, with a small "Effects: Lite" toast (the player can flip it back).
CSS tokens: `--felt-1 --felt-2 --rail --brass --brass-2 --neon-a --neon-b --lamp --card-back --chip-5 --chip-10 --chip-25 --chip-50 --chip-100 --chip-500 --chip-1000 --shadow-soft --shadow-hard --ease-out --ease-spring --t-fast --t-mid --t-big`. Themes only override tokens.
Sprite sheet: all art is `<symbol>`s in one hidden `<svg>` (chip faces, card pips, face-card figures, dealer busts, slot cabinets, bottles, frames, silhouettes) referenced with `<use href="#id">`.
Sound: one `AudioContext` created on the first user gesture, a master gain, a bus per category (sfx, ambient, music), `play(name, {vol, pitch})`. A tiny scheduler prevents more than 12 simultaneous voices.

## W. Copy library (a starter set; more can be added anytime)
Dealer lines (4 dealers, samples):
- Dee (warm): "Place your bets, friends." / "Ooh, nice one." / "Dealer shows a six. Fingers crossed." / "Bust! It happens to the best of us." / "Come back soon, sweetheart." / "Shuffling, give me a sec."
- Marco (dry): "Bets." / "Seventeen. Standing." / "Well. That was a choice." / "Blackjack. Congratulations, I suppose." / "Cards in the air." / "Table's open."
- Priya (cheerful): "Let's play!" / "Look at that hand!" / "Whoa, bust, shake it off!" / "Twenty-one! Go you!" / "Fresh shoe, fresh luck!" / "Good game, see you next time!"
- Lou (old-school): "Place 'em, kid." / "Dealer's got a face card showing." / "Easy come, easy go." / "Pays three to two. Always has." / "Back in my day, we counted to twenty-one on our fingers." / "Take care of yourself, kid."
Stickman calls (full): 2 "Two, aces, snake eyes. Craps!" / 3 "Three, ace-deuce. Craps, three craps." / 4 "Four, little Joe." (hard: "Four the hard way") / 5 "Five, no field five." / 6 "Six, easy six." / 7 "Seven out! Line away." (on a point: "Seven out, pay the don'ts") / 8 "Eight, a square pair." (hard: "Eight the hard way") / 9 "Nine, Nina from Pasadena." / 10 "Ten, a pair of fives." / 11 "Yo-leven!" / 12 "Twelve, boxcars." Come-out natural: "Winner seven, pay the line." Point: "The point is six."
Roulette croupier: "Place your bets." / "Last bets, please." / "No more bets." / "Seventeen, black." / "Twenty-three, red." / "Zero, green." / "Double zero, green." / "Winning bets paid."
Loading lines (24): Shuffling six decks… / Counting the chips… / Dusting the felt… / Waking the dealer… / Polishing the roulette ball… / Checking the dice for loaded edges… (jokingly) / Warming up the lamp… / Sweeping the carpet… / Stacking the rack… / Calling the pit boss… / Pouring a club soda… / Tuning the slot machines… / Straightening the bow tie… / Oiling the wheel… / Lighting the neon… / Sharpening the pencils at the cage… / Finding your seat… / Locking the doors for the vault… / Cutting the deck… / Folding the napkins… / Pressing the felt… / Counting backwards from 21… / Whistling past the pit… / Almost there…
Errors: "The pit boss says no: that bet is too big." / "The cage is closed for a moment. Try again." / "Lost the connection. The dealer is holding your seat." / "That seat is taken." / "You need more chips for that." / "The table closed. It was a good run." / "Slow down, the dice are still rolling." / "The floor is full. Try another table."
Fortune cookie (daily bonus, 20): "A pair of eights is nothing to split about." / "Fortune favors the patient dealer." / "Hit when the dealer shows a seven." / "Luck is just preparation meeting a good shuffle." / "The ball always lands somewhere." / "Your next hand is the one you are waiting for." / "Stand tall at seventeen." / "A small bet today buys a big laugh tomorrow." / "Never trust a streak, always enjoy one." / "Double down on kindness." / "The house has a bad memory for good luck." / "Count your blessings, not your chips." / "A lucky seven is nearby." / "The dealer smiles at those who greet her." / "Take the long way to the cashier." / "Odds are, you will be fine." / "Press your luck gently." / "The river runs to whoever sits down." / "Every shuffle is a fresh start." / "You will find a $5 chip in an unexpected place."
Achievements (name: how): First Hand (play a hand), Natural (first blackjack), Charlie (five-card 21), Double Trouble (win a double), Splitsville (win both split hands), Ace in the Hole (win with a hole-card ace blackjack), Spin Doctor (win a straight-up number), Red Hot (3 reds in a row), Point Maker (make a point in craps), Pass Master (5 pass wins in a row), Royal Treatment (royal flush), Debt Free (repay a loan), Lender (lend a friend money), Regular (25 hands), High Roller (bet over $100), Survivor (play through a lockdown), Night Owl (play after 3am local), Early Bird (play before 7am), Comeback (win after being under $50), Friendly Table (play with 3 friends).
Plaques and signs: "Est. 2026", "No windows. No clocks.", "The house always smiles", "Please tip your dealer with kindness", "Reserved for the high roller", "Table CODE", "Maximum bet: $X".

## X. Test plan for step 15 (what the Playwright runs assert)
- Blackjack felt: 6 seat anchors are inside the stage; my seat is larger than others; empty seats show "Sit here"; the hand panel is fixed at the bottom-right and does not overlap the tab bar; left-handed puts it left.
- Dealing: with a scripted state sequence the card events arrive in the real deal order; the hole card shows a back until the flip; a join mid-hand animates nothing; the queue fast-forwards when behind; no card face appears for a hidden dealer card (check the DOM text).
- Chips: the rendered stack's total equals the balance (colour-up maths) for 20 random balances; payout and sweep animations end with the same chips on screen as the state says.
- Roulette: the ball's final angle equals pocket k for all 38 pockets (call the pure angle function 38 times); the 38 pocket labels match the order list; the results text appears only after `land`; a late joiner 4s into the spin sees the ball placed.
- Craps: dice pips match d1 and d2 for all 36 combinations; the puck is OFF on the come-out and ON on the point number.
- Poker: the HELD tags match the holds; the pay-table row highlight matches the result.
- Lite/Fancy: Lite removes all loops (no running CSS animation names other than allowed ones); the frame-time monitor flips to Lite under a throttled CPU; reduced-motion shows no animations.
- Accessibility: 4-colour deck changes suit colours; every tap target is at least 44px; contrast of text on felt is at least 4.5:1.
- Money: all existing suites (blackjack, roulette, poker, craps, bank, loans, lobby) still pass unchanged; the new emote/`shoeLeft` fields do not touch balances.
- Performance: a 60-second run of an active blackjack table keeps the median frame under 12ms in Fancy on the test machine.

## Y. Risks and how to avoid them
- Too heavy on old phones: the Lite switch, cost classes, and lazy building.
- Animation falling behind the server: the queue fast-forward and "the state is always the truth" rule (the final scene is drawn from state, animations only decorate the transition).
- Spoilers: roulette and dice results must not show in text before the animation lands (the text waits for `land`); the history strip also waits.
- Motion sickness / photosensitivity: no flashing faster than 3Hz, no full-screen strobes, reduced-motion respected.
- Visual clutter hiding the controls: effects stay behind z-index 12 (controls), and the hand panel never moves.
- Bundle size: shared `<symbol>` sprites, no raster images, no fonts.
- Scope creep: each sub-step (15a to 15f) ships independently and the user can stop after any of them.
