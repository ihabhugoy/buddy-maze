# Buddy — notes for Claude

Read `HANDOFF.md` first. It covers everything built so far, the owner's preferences and the open TODO list.

Then load the `buddy-game` skill (`.claude/skills/buddy-game/SKILL.md`): every control, screen, overlay, wolf rule,
card and reward, and the checklist of places where features collide. Keep it up to date with every change.

- The game lives in `game/` (`index.html` + `main.js` + `assets/`). Plain ES modules, no build step.
- Run it with `cd game && python3 -m http.server 8770` and open http://localhost:8770 (add `?v=N` to bust the cache).
  - If the preview server can't read this folder (macOS privacy on ~/Documents), copy `game/` to a readable place and serve that copy. Re-sync it after each edit.
- Always check changes in the browser before reporting.
  - Screenshots can lag a frame.
  - A hidden pane or background tab is throttled to ~1–2 fps.
- The owner prefers short replies: what changed, whether it worked, and why if it didn't.
- Match the existing code style: concise comments that explain *why*, and descriptive names.
