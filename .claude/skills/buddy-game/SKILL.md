---
name: buddy-game
description: The full map of Buddy (the cozy hidden-maze game in game/) — every control, screen, overlay, mode, card, wolf rule, reward and saved key — plus the checklist of places where features collide. Load before changing anything in game/, and before adding a key, a screen, an overlay, a card, a wolf rule or a reward.
---

# Buddy: the game bible

`HANDOFF.md` has the history, the art pipeline and the owner's taste. This file is the map of how the parts fit
together, so a new feature doesn't break an old one. **Update it whenever you add or change one of the things below.**

## 1. Controls (every input the game listens to)

Keys are matched by **position** (`e.code`), never by letter, so they work on any keyboard layout. Anything shown on
screen goes through `keyName(code)` / `WASD()` (main.js, top), which prints the letter on the player's own keyboard
(French AZERTY: walking is Z Q S D, the Lantern card is A).

| Where | Key (e.code) | Does |
|---|---|---|
| play | KeyW/A/S/D, arrows | walk (screen directions: up = up-left tile, right = up-right...) — `KEYS` |
| play | hold a walk key | keep walking |
| play, card armed (Hammer, Wall) | next walk key | aims the card instead of walking (`joker.aim`) |
| play | KeyQ, KeyE, KeyR, KeyT, KeyG | cards: Lantern, Hammer, Wall, Snowflake, Boots — `JOKER_KEYS` |
| play | Digit1-5 | the same cards, in that order |
| play / pause | Escape | pause / resume |
| menus | Escape | back (settings, help, map, outfit, race, friends, end screens) |
| title | ArrowUp/Down, KeyW/S, Enter, Space | move through the menu, pick |
| map | ArrowLeft/Right, KeyA/D, wheel, drag | scroll the worlds |
| anywhere | KeyF | full screen |
| story bubble open | Space, Enter, KeyE, KeyD, ArrowRight / Escape | next line / close (story.js, capture phase: it swallows every key while open) |
| touch | swipe, hold | walk by screen direction, keep walking |

**Never** give a new action one of the walking positions (W A S D Q... check `KEYS` and `JOKER_KEYS` together). Text
fields (`INPUT`) must not trigger game keys.

## 2. Screens (`show(name)`, `body[data-state]`)

title, modes (over title), outfit, worlds (the map), race, friend (online lobby), play, pause, settings, help,
install, win, raceEnd, gameOver, gift (opens over the finished level). Hidden screens never catch clicks
(`.screen:not(.show) *`). The top bar shows on title, modes, outfit, worlds, friend, race.

## 3. Overlays that belong to the play screen only

`#tourCap` (camera-tour captions), `#coach` (hint bubble), `#guide` (pointing hand), `#jokerDock` (cards),
`#goalArrow`, `#raceUI`, `#huntBar`, `#countdown`, `.keyfly`. One CSS rule hides them on every other screen
(`body:not([data-state="play"]) :is(...)` in index.html). **Add any new in-game overlay to that rule.** `#fog` is left
out on purpose (no peeking through the mist from pause). `#story` and `#toast` may show on menus.

Things that wait for the player: the level intro (`intro.t`, `intro.hold`), a camera tour (`tour.shots`), a story
scene (`story.open`, holds the intro). Movement is blocked while any of them runs.

## 4. Modes (`mode`)

- `levels`: the adventure. 4 worlds x 15 levels (`LEVELS_PER_WORLD`), `levelPlan(L)` decides size, shape, doors,
  wolves, puzzle, cards, golden card. Doors split a maze into 2-4 parts with caves between.
- `wolf`: Wolf Chase (solo, endless maps; caught = game over; best in `buddy-wolf-best`).
- `race`: race computer Buddies (or friends online).
- `hunt`: online Wolves vs Animals (best of three, swap sides).

## 5. Wolves

- **Patrols** (`route`, dotted line on the floor): back and forth, see only ahead (`WOLF.see`, a cone) and never
  through walls (`inSight`, body-wide). Seen: "!" then chase; out of sight or too long: "?" then back to the patrol.
- **Crossing patrols** (`crossingRoutes`) cut across the way to the key and portal: you wait beside the line, then slip
  across. **Den wolf** (Wall puzzle) comes out onto your way and sees all round. **Decoy / treasure wolf** guards a
  golden card in a dead end 4-8 steps off the way (`treasureNook`), never steps onto the way itself.
- Rules: two patrols never share a tile (`taken` / `busy` sets), and a patrolling wolf never steps onto another wolf's
  tile (it turns back). Routes are re-chosen with some randomness on every (re)start.
- Caught in `levels`: the level restarts. In `wolf`: game over.

## 6. Cards (jokers)

Lantern (light), Hammer (smash), Wall (build), Snowflake (freeze), Boots (dash). Unlocked at levels `JOKER_AT`
(each has a tutorial level). Bag holds 5 (`buddy-jokers`). Found on the floor (puzzle levels hide the needed card in a
nook), as golden cards guarded by a wolf, in gifts, and for finishing all three daily quests.

Puzzles: `sealed` (key walled in by a cracked stone: Hammer), `den` (grumpy wolf's den: Wall), `misty` (Lantern).

## 7. Rewards

- **Gift:** every `GIFT_EVERY` (4) levels cleared for the first time, the win card shows "Open your gift!" instead of
  Map / Next; it holds one card, then asks Next level or Exit. Meter in `buddy-gift-clears`, shown on the title chip.
  No gifts pop up on the title.
  Opening (`rewards.open`): the present hops; a tap shakes it harder (rising taps), it bursts (flash, rays, sparkles,
  confetti), the card rises face down (`assets/cards/back.webp`) and flips with a shine; it goes into the bag on the
  flip, then its tip and Next level / Exit appear. The `#gift` screen sits above the top bar (z-index 60).
- **Daily quests** (`buddy-quests`): three goals a day; all three = one card.
- **Stars:** 1-3 per level by steps vs the best path (`hidden-maze`).
- **Story** (story.js): friends found at each world's last level; stickers on the map.

## 8. Saved data (localStorage)

hidden-maze (stars), hidden-maze-char / -skin / -cam / -sound / -tut / -race / -race-wins, buddy-story,
buddy-jokers, buddy-quests, buddy-gift-clears, buddy-seen-gold, buddy-seen-wolves, buddy-taught, buddy-wolf-best,
buddy-mode, buddy-role, buddy-exp, buddy-games, buddy-saved, buddy-lite. Wrap every read/write in try/catch.

## 9. Collision checklist (run through it for every change)

1. **Keys:** does the new key share a position with walking (`KEYS`), a card (`JOKER_KEYS`), Escape/F, or the story's
   keys? Is the on-screen label made with `keyName`?
2. **Screens:** does a new overlay hide when paused / at home / on the map? (section 3)
3. **Waits:** can it start during a tour, an intro, a story scene, a door warp (`warp.t`), or after a win / catch
   (`won`, `wolfOver`)? Timers (`setTimeout`) must check the level / mode is still the same when they fire.
4. **Wolves:** does a new route or obstacle overlap a patrol, the den, the golden card's path, the key, the portal or
   a door?
5. **Restart:** does `buildLevel` reset it (`clearWolves`, `joker.clear`, `puzzles.clear`, `tour.shots = null`)?
6. **Online:** does it behave in `hunt` / online `race` (host decides, messages after a game ended are ignored)?
7. **Phones:** touch has no keys (cards are tapped, aiming is the next swipe); check 844x390 landscape.
8. **Rewards:** is it a reward on top of others? The owner wants rewards earned by playing, not handed out.
