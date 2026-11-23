# Card Game Sandbox

A local tabletop for making and playing custom card games. Open `index.html` in a browser. The sample game, High Score Card Game, is ready to play.

## Create a game

1. Open **Game editor**. Set the number of players, their opening hand size, and how many cards they draw at the beginning of each turn, including the first.
2. Edit the sample cards or add your own. Give each card a name, optional text, a copy count, and optional PNG, JPEG, WebP, or GIF artwork.
3. Under **Theme**, pick playmat, menu, and button colors. You can also attach a playmat image, card back, and interface font. Fonts can be WOFF2, WOFF, TTF, or OTF up to 2 MB. Choose **Start new table** to apply the theme. Clear the font file and start a new table to restore the system font.
   Under **Typography**, set a separate font, size (12–36 px), and optional text color for cards, menus, and victor screens. The live preview updates while you edit. A section without its own font uses the shared interface font or the built-in typeface. Presets include all three sets of typography controls.
4. Under **Automatic rules**, set starting-turn points or enable either win condition. Give individual cards a draw effect, a points effect, or both. Use the **Rulebook** for any rules players apply themselves.
5. In **Tabletop layout and labels**, change the header, zone names, card size, or grid arrangement. In **Player scoreboard**, name each player and optionally enable the manual +1 and −1 buttons. Scores start at zero and never go below zero. Manual and automatic points count toward the same win target.
6. Choose **Start new table** to preview your design and deal the deck.

## Share a game preset

To try a built-in game, choose **Default presets** beside **Import game preset**. Select **High Score Card Game** for a simple points game or **Two-Player Card Combat** for a duel with Attack statistics, 12 Health per player, and an **Arena Champion** screen when a player reaches zero Health. Choose **Load preset**, then **Start new table**, or edit and download your own version.

Choose **Download game preset** in the editor and share the resulting `.preset.json` file. It carries the cards, setup, rules, player labels, layout, theme, artwork, and audio. To play someone else's game, choose **Import game preset**, select their file, then choose **Start new table**. Older sandbox JSON files still work and fill in any missing settings with defaults. Presets save designs and settings. Each new table starts with fresh scores and a fresh deck.

## Audio

Under **Audio**, attach looping background music (up to 5 MB) or effects for drawing, moving, flipping, and winning (up to 300 KB each). Supported file types are MP3, WAV, Ogg, and M4A. MP3 is a good choice for sharing across browsers. Audio is embedded in the game export and restored on import.

On the tabletop, tap **Enable sound** to allow playback. **Mute sound** pauses it, and opening the editor pauses it while you edit. When one move triggers several events, the win sound takes priority over draw and move sounds.

Each card design can also have its own **Card play sound** (up to 300 KB). It plays when the card moves face up from the active hand to the table and takes priority over general sounds for that move. Card sounds travel with the preset.

## Position zones

Under **Tabletop layout and labels**, choose **Position zones**. Drag the deck, hand, table, or discard area to move it. Drag its bottom-right handle to resize it. You can also enter X, Y, width, and height directly as whole percentages of the playmat. X and Y are measured from the top-left corner. **Apply custom layout** saves the positions to the draft, and **Start new table** uses them. The responsive grid and stacked layouts remain available, and **Reset positions** restores the starting coordinates in the pop-up.

## Automatic rules

- The active player gets turn-start draws and points on their first turn and every turn after that.
- Moving a face-up card from the active hand to the table triggers its effects. Draws resolve before points and the win check. A card returned to a hand can trigger its effects again when replayed.
- Set **Points to win** to a positive number to end the game when a player reaches that total. Enable **Win by playing your last card** to end the game if the hand is empty after resolving that card's draw effect. With both enabled, either can end the game.

## Card statistics and player counters

Define up to eight card statistics and eight counters per player. Give each a label and starting value. On each card design, open **Statistics and play interactions** to override a starting value, omit a statistic from that card, or add up to ten ordered effects.

For example, create an **Attack** statistic and a **Health** counter. Set a card's Attack to 3 and add an interaction with target **Next player**, change **Health**, operation **Subtract**, and amount from **Attack**. Playing that card face up from hand applies the effect. Effects can also target the active player's counters or the played card's own statistics. Each physical card copy has its own current statistics.

Use Add, Subtract, Multiply, Divide, or Set with a fixed amount or a statistic on the played card. Values stay between 0 and 999,999. Division rounds down. Effects skip absent statistics and a zero divisor read from a statistic. Each player can adjust their counters with the scoreboard buttons.

## Counter triggers and victory

Add a rule under **Counter triggers and victory**. Choose a counter, **At or below** or **At or above**, and a threshold. For example, set **Health → At or below → 0 → Eliminate this player**. In a two-player game, the remaining player wins immediately. With more players, play continues and turn order and next-player effects skip eliminated players. In a solo game, elimination ends the match without a winner.

Other outcomes declare the counter's owner the winner or show a screen and continue. Each rule can have its own title, message, and artwork. Rules fire once per player when the counter crosses into range during play, including from card effects and manual adjustments. Starting values alone do not trigger rules. If a change crosses multiple rules, they resolve in editor order until a rule eliminates the player or ends the match. Presets include all counter rules and artwork.

## Victor displays

Add up to ten displays in the editor. Each has a unique point threshold, title, optional message, optional artwork, and an **End the match** checkbox. Manual and automatic points trigger displays. If a score jumps past several thresholds, displays appear in order until the first win condition. Each threshold appears once per player per match, even if points are later removed. Existing win conditions display a generic victory screen when there is no matching custom screen. Presets include all displays and their artwork.

## Local HTTP preview

With Node.js installed, run `node serve-local.cjs`, then open `http://127.0.0.1:8765/`. The preview binds to loopback and serves a fixed list of static files plus the room API. Local tabletop presets and media stay in the browser. Starting an online room sends the current preset to the room server.

## Online two-player rooms

Open the sandbox through its Node server. In **Game editor**, load or create a two-player preset, then choose **Start online room**. Copy the private, single-use invite link and send it to the second player. They open it on their device and choose **Join online room**. Each player sees their own hand, and the current player controls the turn. You can refresh the same browser tab and return to your seat. Leaving closes the room for both players.

The localhost address is for testing from two tabs on the same computer. For internet play, deploy this folder as a single Node.js 22+ service behind an HTTPS host. Use `npm start` or `node serve-local.cjs` as the start command, set `PUBLIC_ORIGIN` to the site's HTTPS origin, and let the host provide `PORT` or use 8765. The same host serves the page and the room API. GitHub Pages can serve the local tabletop, but internet rooms need the Node service. Online presets currently have a 3 MB limit. Rooms are held in memory and expire after two hours without requests or when the server restarts.

## Play

Share one browser and pass the screen at each turn. The active player reveals their hand, selects a card, and moves it to the table, deck, or discard pile. Use **Flip card** to change its face on the table, in discard, or in your hand. Select the deck to move its top card, or use **Draw card** to move it directly into your hand.

The tabletop supports manual draws in addition to automatic turn draws. Export saves the game design. Matches and editor drafts live in the current browser tab until it reloads or closes.

## Files

- `index.html` contains the tabletop and editor markup and styles. If you edit the inline style block, update its SHA-256 hash in the page's Content Security Policy. Hash the exact text between the style tags with LF line endings, then encode it as base64.
- `tabletop.js` contains the sample design, format validation, and tabletop mechanics. It can run independently of the webpage.
- `app.js` connects the page to the tabletop, handles artwork, and reads and writes game files.

## Publish

Put the contents of this folder at the root of your GitHub repository. In **Settings → Pages**, choose **Deploy from a branch** and select the branch and root folder containing `index.html`.
