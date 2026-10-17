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
- **3D menus:** the title's side menu, the Continue card and the Outfit panel stand tilted like open doors around Buddy
  (`--tilt` in CSS, perspective on the screen) and sway with the mouse (`--mx`, `--my`). The logo letters sit on a gentle arch.
- **Adventure map** (`map3d.js`): horizontal, in the game's own look (no quilt, no Buddy): the warm white floor, each
  world a soft patch of its ground fading into the white (meadow / sand / snow / leaves, mirror-tiled), the path made
  of that world's real scanned stones (next level's stone risen like a wall), the world's door block at the start,
  risen stone groups and (woods) the arches. Worlds build when you scroll near (each loads its stone set).
  Level badges are small HTML chips (white / gold done / green next). Wheel, drag, A / D.
- **Portal** (`makePortal`): built from the level's own stones at their true proportions (uniform scale), measured
  from the vertices they use so they stack flush: a sunk stone-top plinth, two pillars of two upright stones, a lintel
  of three stones laid on their side; a calm swirl in milky biome tints (`PORTAL_TINTS`).
- **Key** (`makeKey`): lies flat and turns, soft shadow, no glow. Pickup: hops over Buddy's head, then flies as an
  icon up into the HUD key slot (`flyKeyToHud`).
- **Beta:** `BETA_ALL_OPEN = true` opens every level. Set it to false for release.
- **Ground textures** (`groundTexture`): seamless procedural grass (woods green / autumn golden), sand with wind ripples,
  snow. Used on the map (finely tiled + fade mask) and as the autumn floor in play (the leaf litter was disliked).
- **Desert stones** keep their natural colored layers (`tint 0.12`, `matchStrength 0.45`); the cactus door stays green.
  The map places big cacti (the door model, stone sunk) and the woods' arches far back with a hazy lower half.
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

### UI design system (index.html, rewritten 2026-10-17)
- Warm storybook palette as CSS tokens (`--cream`, `--card`, `--edge`, `--lip`, `--ink` cocoa, `--leaf`, `--honey`,
  `--sky`, `--coral`, `--berry`, `--lilac`). Cards: cream with a lip and a dashed stitched seam (`.card::before`).
  Titles: Bagel Fat One with a white sticker outline (`.sticker`). Chips with icon badges (`.chip` + `.cbadge`).
- No emoji anywhere: custom SVG symbols (`i-w-woods/desert/snow/autumn/cave`, `i-steps`, `i-clock`, `i-portal`,
  `i-trophy`, `i-music`, `i-sparkle`, `i-wind`, `i-mute`, `i-eye`, `i-sprout`...).
- Secondary motion: menu motes, per-letter logo bob + swaying sprout, icon wiggles, staggered entrances, confetti and
  bouncing stars on the win card, twinkling key chip.
- Continue card shows a real render of the world's doorway (`doorPreview`, rendered once into an image).
- First-steps guide (`coach`): level 1-1 walks through move / hidden maze / key / portal; the first door level and
  first cave get one tip each. Seen tips are stored in `hidden-maze-tut`.
- Narrow windows (aspect < 5:4) tuck the title panels into the corners; short windows get compact cards.

### Animation rules (owner's)
- Buddy never jumps or waves on his own (no idle hops, no idle wave). The intro wave stays.
- Title Buddy: feet planted, upper body sways gently from the hips, arms relaxed and away from the body (clipping
  otherwise), small amplitudes so the mesh never looks bent.
- In play: springy steps (stretch at the top, squash on landing), breathing, a gentle sway when still; bumping a wall
  gives a squash, a hop and dizzy stars.

## 3. Game structure

### Levels (`levelPlan(L)` in main.js)
- 4 worlds × 25 levels = 100. Each world is **5 chapters of 5 levels**, a saw-tooth curve:
  1. breather (square, easier reveal, key near the way);
  2. a mix of shapes you already know;
  3. the chapter's new shape;
  4. a door level (from world 1 chapter 2 on);
  5. a challenge: the new shape, bigger, less reveal.
- Size: `BASE_CELLS[world] + chapter` (+1 on challenges and the world finale). Level 1-1 is 3×3 cells.
- Reveal radius, key detour (how far off the way the key hides) also grow with chapter and world.
- Themed shapes per world (`WORLD_SHAPES`): woods circle/gem/plus/tree/flower; desert triangle/hourglass/cactus/crescent/twin;
  snow ring/snowflake/frame/islands/star; autumn mushroom/heart/snake/circles/leaf. Shapes are drawn in screen space
  (`shape2`, X right, Y up); the maze grows in the shape's biggest connected part, thin bits are trimmed.
- **Goal:** find the **key** (on a side path, `keyTile`), then walk into the **portal** (`makePortal`) at the far end. The
  portal sleeps (dim) until you hold the key. HUD shows a key chip; a toast says "Find the key" if you reach it early.
- **Stars:** 1–3, based on steps vs the optimal path (start → key → portal). Saved in `localStorage`, key `hidden-maze`.

### Gateway / door levels (`isGateway = L >= 5 && L % 4 === 1`)
- **Surface:** the maze is two separate halves with an **open gap** between them (`genSplitMaze`). Buddy starts in the lower half; the key is in the upper half.
- **Going down:** door A (a tree door block) in Buddy's half leads down to a **cave** maze (`genCaveMaze`).
- **Coming back up:** cave door B leads back up to door B in the key's half, like Mario pipes.
- **Transition:** fade to dark while the camera lifts (`startWarp` / `warpSwap` / `updateWarp`, `#fader`).
- **Door facing:** each door's cave mouth faces the tile you step out to. It's detected automatically (`prepDoor`, per-side depth grid) and rotated with `door.yaw`.
- **The key of a door level waits in the cave** (between the two cave doors); the portal is on the surface in the far half.

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
| n04 | green-tree door (woods) |
| n29 | cactus doorway (desert) |
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

### Cave specifics
- **Unlit, the cave stones look like plain rock**: the glowing moss is repainted as rock (`neonGlow`), baked white
  highlights are flattened (`flattenHighlights`).
- **Only the tile Buddy steps on lights up**: its moss specks glow fluorescent green-to-teal (`glowHues`, one per stone),
  pulsing a little, then fade back to dark (`TRAIL_GLOW = 0`). Glow mask = anything that differs from the stone's own
  rock color and isn't darker (`captureGlow`).
- **Mushroom door:** keeps its own mushroom colors pushed to neon, a light wave runs up the stalks (`door-neon` shader),
  a violet haze sprite, a point light, and spores drifting up (`doorSpores`).
- Texture canvases are filled opaque first (`canvasTexture`): see-through specks rendered as black dots.
- Dust puffs are soft billboards now (`puffMat`), additive (glowing) in the cave.

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
  - Music starts with the first click (quietly under the menus).
  - Per-biome mixes (`MIX`): snow = snow crunch steps (`sn01-20`) + faint footsteps, rise = rock + snow + gravel; desert adds
    sand (`sd`) and pebbles (`pb`); the cave adds pebbles/gravel, a soft echo, and rare distant pebble trickles.
  - Ambience (`AMB`, `assets/ambience/`): wind/leaves (woods, autumn, snow, cave filtered deep) and desert night. Very
    quiet; Sound settings has an Ambience slider + on/off.
  - Soft UI sounds (`ui_*`, from the Cozy UI pack; sharp ones left out; the owner disliked the confirm sound, removed).
    The pack's license forbids publishing the raw files (don't push them to a public repo).
- **Outfit:** 9 colors recolor the olive parts of Buddy (`SKINS`, `setSkin`, shader `addOutfit`).
- **Title character:** a second WebGL renderer (`face`) for the menu Buddy: idle sway and arm swing (`uIdle`), head-follow, blink.

### Performance rules (phones crashed after 2–3 levels)
- **Build once, reuse:** a world's stone meshes (`setMeshes`), the floor pair (`floorMeshes`), its portal
  (`set.portal`), the key and the maze grass are made once and reused by every level. Don't create or dispose GPU
  objects per level: phones (iOS Safari) don't free that memory fast and close the page.
- Stone geometries are `userData.shared`: `freeTree` must never dispose them.
- **Light count stays fixed:** the cave door glow uses the two permanent `doorLights`. Adding/removing a light
  recompiles every shader.
- The floor atlas is baked lazily (`floorMatOf`) when a world is played, not when the map loads it; half size on
  phones, freed on phones when you leave the world (`trimGPU`).
- Loop: ~60 fps cap (120 Hz screens), the paused scene is drawn once, pixel ratio max 1.5.
- Mesh simplification (phones) is normal-aware (`simplifyWithAttributes`) so it leaves no dark holes.

### UI gotchas we hit
- **Hidden screens must not catch clicks:** `.screen:not(.show) * { pointer-events: none !important }`. Without it, the map's Back button sat under the pause button and sent you home.
- **No `backdrop-filter`** on modals over the WebGL canvas; it made the pause card invisible.
- **Shader cache keys:** the cave is detected by an explicit `G.cave` flag, not by glow strength. Lowering `amt` once switched the cave to the warm surface rim.

---

## 4. Open TODO

1. **Puzzles:** the owner plans to add puzzles later (the key stays for now).
2. **Map polish:** islands could use more props and per-world landmarks; locked worlds aren't greyed out yet.
3. **Portal look:** the cream frame can blend into light stones; maybe a pastel accent per world.
4. **Old saves:** star records are by level index, and the levels changed (sizes and shapes), so old stars may not match.
5. **Optional cleanup:** remove the debug `?nosimp` switch and the `__game` test hooks once no longer needed.

## Online

- Netlify (main): https://buddy-maze.netlify.app (deploy: `netlify deploy --prod --dir game --site 6edc3228-2263-424c-a079-7b943b571002`)
- GitHub Pages (backup): https://ihabhugoy.github.io/buddy-maze/
