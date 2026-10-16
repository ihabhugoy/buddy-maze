# Buddy — project handoff

A cozy, relaxing **PC (landscape)** 3D maze game built with Three.js, with no build step. You play Buddy, a little hooded explorer.

**Core idea:** the maze is hidden as a flat floor of stone tiles. The walls only rise near Buddy and sink back after he passes, so you have to remember the way to the key.

Everything is in `game/`:
- `index.html`: all UI markup and CSS.
- `main.js`: the whole game, about 2,500 lines.
- `assets/`: models, sounds, music and the map painting.

---

## 1. Run it

```bash
cd game
python3 -m http.server 8770
```

Then open http://localhost:8770.

- **No bundler:** Three.js r0.169 and meshoptimizer load from jsdelivr through an import map in `index.html`.
- **Preview server and ~/Documents:** in the old setup, the Claude Code preview server could not read `~/Documents` (macOS privacy). The game was served from a copy in the session scratchpad, re-synced with `rsync` after every edit. If you hit "permission denied" or empty responses, do the same: copy `game/` somewhere readable (e.g. `/tmp`) and serve that.
- **Cache-busting:** append `?v=N` to the URL after edits.
- **Background throttling:** a hidden browser pane or background tab drops to ~1–2 fps. The level intro then crawls and movement looks broken. It isn't a real performance problem; check with the pane visible.

### URL parameters (testing)
- `?zoom=N`: camera view height in tiles (overrides the camera button).
- `?r=N`: reveal radius (how far walls rise around Buddy).
- `?nosimp`: skip mesh simplification (debug).

### Test hooks (`window.__game`)
- Main fields: `st` (player state: `gx`, `gz`, `moving`), `maze`, `tryMove(dx, dz)`, `play(level)`, `renderer`, `scene`.
- Also: `stoneSet(biome)`, `cave(level)` (jumps straight into the cave of a gateway level), `atmosphere`, `sfx`, `face`, `assets`.

---

## 2. Owner's preferences (important)

**How they work:**
- The owner talks by voice. Transcripts can be garbled ("women" = "luminous", "words" = "worlds"); read for intent.
- They generate art themselves (Seedream images → Trellis 3D GLBs) and send files to integrate.
- When asked for image prompts, always give the **full prompt**, never a diff.
- They want short replies: what changed, whether it worked, and why if not. Verify in the browser before reporting.

**Game style:**
- PC, landscape, relaxing, cute, minimalist "with details but not many".
- A soft 3D look in the spirit of Party Animals / Eggy Party menus.

**Current UI (they reset all earlier UI preferences; this is what they asked for last):**
- **Menu backdrop:** cream (`.warm` in CSS).
- **Logo:** "Buddy" in **Bagel Fat One**, green, big, centered at the top. Body font: **Nunito** 800/900.
- **Main menu layout:**
  - Buddy stands in the middle with no pedestal, just a soft floor shadow. He does a waiting idle: rocks foot to foot, small bounce, arms swinging, head follows the mouse, blinks.
  - Left: a text menu (ADVENTURE, RACE, OUTFIT, SOUND). The selected item is a white pill with an orange arrow; it works with hover, arrow keys / W S and Enter.
  - Right: a "Continue" card (purple ribbon, world icon, level, Play button that starts the next level).
  - Top right: star and world counters.
- **Adventure:** opens the **map**. It must not start a level directly.
- **Pause:** a cream card with a list (Resume green, Restart, Map, Sound, Main menu).
- **Cards and buttons:** soft white cards; candy buttons (green / yellow / blue) with a darker bottom lip. No ink outlines, no gradients on buttons.

**World look:**
- Warm light from the far side (top of screen), soft shadows.
- Tilt-shift depth of field: the middle band around Buddy is sharp.
- Subtle sounds; music "Cozy Game Time" loops (quieter in menus).

**Controls:** keys follow the **screen**. The camera looks down a diagonal, so:
- Up / W = the tile up-left.
- Right / D = up-right.
- Down / S = down-right.
- Left / A = down-left.

Mouse or touch swipes also map by screen direction.

**Things they rejected (don't bring back):**
- squashing tiles;
- god rays / light shafts;
- bright glow spots;
- random tile twist or rotation;
- hexagons;
- multicolor logo;
- dark brown or high-contrast stones;
- grey stones in snow;
- purple cave tint;
- always-on glowing moss in the cave;
- the pedestal under Buddy;
- the orange menu backdrop (now cream).

---

## 3. Game structure

### Levels
- 4 worlds × 25 levels = 100 (`WORLDS`, `LEVELS_PER_WORLD = 25`).

| World | Biome |
|---|---|
| Mossy Woods | woods |
| Sunny Dunes | desert |
| Frost Peak | snow |
| Autumn Grove | autumn |

- **Difficulty:**
  - Maze size grows every 8 levels, from 9×9 to 31×31 tiles (`levelCells`).
  - Within a world the reveal radius shrinks (`world.reveal - 0.35 * progress`).
- **Shaped mazes** from level 12 on: circle, twin squares with bridges, heart, three circles (`SHAPES`, `levelShape`, `genShapedMaze`). An empty tile is `maze.empty[i] = 1`.
- **Stars:** 1–3, based on steps vs the optimal path. Saved in `localStorage`, key `hidden-maze`.

### Gateway / door levels (`isGateway = L >= 5 && L % 4 === 1`)
- **Surface:** the maze is two separate halves with an **open gap** between them (`genSplitMaze`). Buddy starts in the lower half; the key is in the upper half.
- **Going down:** door A (a tree door block) in Buddy's half leads down to a **cave** maze (`genCaveMaze`).
- **Coming back up:** cave door B leads back up to door B in the key's half, like Mario pipes.
- **Transition:** fade to dark while the camera lifts (`startWarp` / `warpSwap` / `updateWarp`, `#fader`).
- **Door facing:** each door's cave mouth faces the tile you step out to. It's detected automatically (`prepDoor`, per-side depth grid) and rotated with `door.yaw`.
- **Cave goal:** `[-9, -9]`, i.e. no key in the cave.

### Race mode
- 2–4 Buddies on a fair, mirrored maze (`genFairRaceMaze`); the key is in the middle.
- **Setup:** teammates (team race), rival speed Easy / Normal / Hard / Pro (`RIVAL_PACE`).
- **Maze growth:** the race maze grows every 2 wins (`hidden-maze-race-wins`).
- **During the race:** intro (key → each rival → you → 3-2-1-GO), edge arrows and name tags for off-screen rivals, live and final ranking.

### Biomes (`BIOMES` in main.js)
Each biome has:
- stone models, a door model, colors (bg / floor / mirror);
- lights (hemi / fill / sun), a moss / glow profile;
- dust and puff colors, weather;
- a CSS color grade (`body[data-biome=...] .grade.*`).

**Assets** (`assets/biomes/nNN.glb`):

| File | Use |
|---|---|
| n01 | cave door (mushroom on a stone; shown pink and glowing) |
| n02 | snow door (snowy pine) |
| n03 | autumn door (orange tree) |
| n04 | green-tree door, used for **woods and desert** (see TODO) |
| n05–n11 | autumn stones (**n08 excluded**: face marks and crooked) |
| n12–n17 | snow stones |
| n18–n23 | desert stones |
| n24–n28 | cave stones |
| `assets/pillar*.glb` | woods stones |

**Other assets:**
- `assets/decor/d01–d17.glb`: scenery; only the big "arch" kinds are placed around the maze.
- `assets/map/woods.webp`: painted map and title backdrop.
- `assets/sfx/`: s01–s11 stone sounds, f01–f21 footsteps, bump.
- `assets/music/cozy.mp3`.
- `assets/character.glb`: Buddy; the model faces +X.

### Stone pipeline (`stoneSet(name)`, cached per biome)
1. **Load and normalize:** load the GLBs. `prepPillar` / `prepDoor` normalize size (by the stone body; moss sticking out is ignored) and **auto-straighten** turned models.
2. **Simplify:** about 95k → 15k triangles with meshoptimizer `simplify` and the `LockBorder` flag. Without that flag, UV seams tear and black holes appear.
3. **Color harmonizing** (canvas pixel work):
   - `matchRock` and `tintRock` pull every stone (and the door) to one rock color per biome. They also compress contrast and repaint near-black spots; doors keep their own shading and dark mouth.
   - `scaleRock` matches brightness. `matchMoss` / `tintMoss` unify the moss.
   - Per-biome knobs: `rockColor`, `rockGain`, `contrast`, `tint`, `moss{hue,width,sat}`.
4. **Tops of flat tiles:**
   - Tiles near the camera are drawn with **real 3D caps** (`v.cap`: only the triangles above the floor cut), instanced.
   - Far tiles use a **baked top-view atlas** (`bakeFloor`), so tiles are never squashed.
5. **Wall motion:** walls rise and sink by **position only** (spring on height). There is a subtle tremble; no rotation, no squash.

### Cave specifics (latest work)
- **Look:** dark blue, matte floor (no sun spot), blue rim light.
- **Glowing parts keep their original colors** (cyan, teal, purple):
  - `captureGlow` / `restoreGlow` build a glow mask (bright and saturated pixels) and a `glowTex` per stone.
  - **They only glow where Buddy steps** (`addStepGlow`, per-tile instanced `aGlow`, `tileGlow[]`): they light up underfoot and dim slowly after; otherwise only a faint glow.
- **Puffs** in the cave use each stone's glow color (`dustAt`).
- **Mushroom door:** pink and glowing via a shader (`doorPlant`).
- **Particles:** fewer spores in mixed colors.

### Other systems
- **Weather per biome** (`atmosphere.setWeather`):
  - woods: dandelion fluff;
  - desert: blowing sand;
  - snow: slow snowflakes with a faint cool edge;
  - autumn: a few slowly falling leaves;
  - cave: spores.
- **Ground under the maze:**
  - woods: a grass patch cut from the map painting;
  - autumn: a procedural fallen-leaf carpet (`leafLitter`).
- **Post-processing:** EffectComposer with tilt-shift (`tiltH` / `tiltV`, strength `4.2 / w`) and OutputPass.
- **Camera:** close / medium / wide button (`CAM_STEPS = [4.4, 6.2, 8.6]` tiles of view height), plus a hold-to-zoom-out "peek" button.
- **Audio** (Web Audio): pooled sound effects with pitch / pan variation, music ducking in menus, settings saved in `hidden-maze-sound`.
- **Outfit:** 9 colors recolor the olive parts of Buddy (`SKINS`, `setSkin`, shader `addOutfit`).
- **Title character:** a second WebGL renderer (`face`) for the menu Buddy: idle sway and arm swing (`uIdle`), head-follow, blink.

### UI gotchas we hit
- **Hidden screens must not catch clicks:** `.screen:not(.show) * { pointer-events: none !important }`. Without it, the map's Back button sat under the pause button and sent you home.
- **No `backdrop-filter`** on modals over the WebGL canvas; it made the pause card invisible.
- **Shader cache keys:** the cave is detected by an explicit `G.cave` flag, not by glow strength. Lowering `amt` once switched the cave to the warm surface rim.

---

## 4. Open TODO

1. **Desert doorway:** the owner will send a **cactus doorway GLB**. Then:
   - add it as `assets/biomes/n29.glb` (or similar);
   - set `BIOMES.desert.door` to it;
   - check that the stone color matches the desert (door tint runs automatically) and that the cactus stays green (it's protected as "moss" if green; check);
   - check that the mouth faces the exit (`prepDoor` reach values).
2. **Cave glow check:** verify the glow mask catches all luminous bits (owner said some weren't); thresholds are in `captureGlow`.
3. **Map art:** only Mossy Woods has a painted map; the other worlds use a flat color plus emoji decoration.
4. **Optional cleanup:** remove the debug `?nosimp` switch and `__game.cave` once no longer needed.
