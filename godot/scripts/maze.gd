class_name Maze
extends RefCounted
## Maze generation and the level plan, ported line for line from the web game (game/main.js), with the same seeded
## random numbers, so every level is the same maze as on the web.

const LEVELS_PER_WORLD := 25
const WORLDS := [
	{ "name": "Mossy Woods", "biome": "woods", "tint": Color(1, 1, 1), "reveal": 2.3 },
	{ "name": "Sunny Dunes", "biome": "desert", "tint": Color(1.07, 0.96, 0.8), "reveal": 2.1 },
	{ "name": "Frost Peak", "biome": "snow", "tint": Color(0.9, 0.97, 1.08), "reveal": 1.9 },
	{ "name": "Autumn Grove", "biome": "autumn", "tint": Color(1, 1, 1), "reveal": 1.7 },
]
const WORLD_SHAPES := {
	"woods": ["circle", "gem", "plus", "tree", "flower"],
	"desert": ["triangle", "hourglass", "cactus", "crescent", "twin"],
	"snow": ["ring", "snowflake", "frame", "islands", "star"],
	"autumn": ["mushroom", "heart", "snake", "circles", "leaf"],
}
const BASE_CELLS := [4, 5, 6, 7]
const DIRS := [[1, 0], [-1, 0], [0, 1], [0, -1]]


## mulberry32, bit for bit like the JavaScript one (32-bit unsigned math done by hand)
class Rng:
	var a: int
	func _init(seed: int) -> void:
		a = seed & 0xFFFFFFFF
	static func imul(x: int, y: int) -> int:
		x &= 0xFFFFFFFF; y &= 0xFFFFFFFF
		return (x * (y & 0xFFFF) + (((x * (y >> 16)) & 0xFFFF) << 16)) & 0xFFFFFFFF
	func next() -> float:
		a = (a + 0x6D2B79F5) & 0xFFFFFFFF
		var t := imul(a ^ (a >> 15), 1 | a)
		t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
		return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
	func pick(n: int) -> int:
		return int(floor(next() * n))


static var _plans := {}

## Each world is 5 chapters of 5 levels: a gentle level, a mix, the chapter's new shape, a door level, a bigger one.
static func level_plan(L: int) -> Dictionary:
	if _plans.has(L):
		return _plans[L]
	var w := L / LEVELS_PER_WORLD
	var k := L % LEVELS_PER_WORLD
	var c := k / 5
	var p := k % 5
	var world: Dictionary = WORLDS[w]
	var shapes: Array = WORLD_SHAPES[world.biome]
	var rnd := Rng.new(L * 131 + 7)
	var cells: int = BASE_CELLS[w] + c + (1 if p == 4 else 0) - (1 if p == 0 and c > 0 else 0)
	if w == 0 and c == 0:
		cells = [3, 4, 4, 5, 5][p]
	if k == LEVELS_PER_WORLD - 1:
		cells += 1
	var shape = null
	var gateway := false
	if p == 3 and (w > 0 or c > 0):
		gateway = true
	elif p == 2 or p == 4:
		shape = shapes[c]
	elif p == 1 and (c > 0 or w > 0):
		var known: Array = shapes.slice(0, c + 1) + (WORLD_SHAPES[WORLDS[w - 1].biome] if w > 0 else []) if w > 0 else shapes.slice(0, c)
		shape = known[int(floor(rnd.next() * known.size()))] if known.size() > 0 else null
	if shape != null and cells < 5:
		cells = 5
	var reveal: float = max(1.4, world.reveal - 0.08 * c - (0.12 if p == 4 else 0.0) + (0.15 if p == 0 else 0.0))
	var detour: float = 0.15 if p == 0 else min(0.85, 0.2 + 0.1 * c + 0.06 * w + (0.1 if p == 4 else 0.0))
	var plan := { "cells": cells, "shape": shape, "gateway": gateway, "reveal": reveal, "detour": detour, "chapter": c, "world": w }
	_plans[L] = plan
	return plan


static func gen_maze(cells: int, rnd: Rng) -> Dictionary:
	var N := cells * 2 + 1
	var g := PackedByteArray(); g.resize(N * N); g.fill(1)
	var stack := [[1, 1]]
	g[1 * N + 1] = 0
	while stack.size() > 0:
		var top: Array = stack[stack.size() - 1]
		var x: int = top[0]; var z: int = top[1]
		var opts := []
		for d in [[2, 0], [-2, 0], [0, 2], [0, -2]]:
			var nx: int = x + d[0]; var nz: int = z + d[1]
			if nx > 0 and nz > 0 and nx < N - 1 and nz < N - 1 and g[nz * N + nx] == 1:
				opts.append(d)
		if opts.is_empty():
			stack.pop_back(); continue
		var d: Array = opts[rnd.pick(opts.size())]
		g[(z + d[1] / 2) * N + x + d[0] / 2] = 0
		g[(z + d[1]) * N + x + d[0]] = 0
		stack.append([x + d[0], z + d[1]])
	for k in cells: # a few loops so there is more than one way and memory matters
		var x := 1 + rnd.pick(N - 2)
		var z := 1 + rnd.pick(N - 2)
		if g[z * N + x] == 1 and ((x % 2 == 1) != (z % 2 == 1)):
			g[z * N + x] = 0
	return { "N": N, "g": g }


# ---------- shapes (u, v run -1..1 across the maze; screen shapes are drawn in rotated axes) ----------
static func uv(c: int, C: int) -> float:
	return ((c + 0.5) / C) * 2.0 - 1.0

static func scr(cx: int, cz: int, C: int) -> Vector2:
	var u := uv(cx, C); var v := uv(cz, C)
	return Vector2((u - v) / sqrt(2.0), -(u + v) / sqrt(2.0))

static func disc(X: float, Y: float, x: float, y: float, r: float) -> bool:
	return (X - x) * (X - x) + (Y - y) * (Y - y) <= r * r

static func link(X: float, Y: float, a: Vector2, b: Vector2, C: float) -> bool:
	var dx := b.x - a.x; var dy := b.y - a.y
	var t := clampf(((X - a.x) * dx + (Y - a.y) * dy) / (dx * dx + dy * dy), 0.0, 1.0)
	return Vector2(X - (a.x + dx * t), Y - (a.y + dy * t)).length() < 1.3 / C

static func twin_rows(C: int) -> Array:
	var rows := []
	var r := int(ceil(0.28 * C))
	while r < 0.72 * C:
		rows.append(r); r += 2
	return rows

static func inside(shape: String, cx: int, cz: int, C: int) -> bool:
	var u := uv(cx, C); var v := uv(cz, C)
	var s := scr(cx, cz, C); var X := s.x; var Y := s.y
	match shape:
		"circle": return u * u + v * v <= 0.95
		"heart":
			var a := (u - v) / sqrt(2.0) * 1.22
			var b := -(u + v) / sqrt(2.0) * 1.22 + 0.18
			return pow(a * a + b * b - 1.0, 3) - a * a * pow(b, 3) <= 0.0
		"twin":
			if cx < 0.4 * C: return cz < 0.72 * C
			if cx >= 0.6 * C: return cz >= 0.28 * C
			return twin_rows(C).has(cz)
		"circles":
			var R := [Vector2(-0.5, -0.5), Vector2(0.52, -0.42), Vector2(-0.02, 0.52)]
			for r in R:
				if (u - r.x) * (u - r.x) + (v - r.y) * (v - r.y) <= 0.44 * 0.44: return true
			for pr in [[0, 1], [1, 2], [2, 0]]:
				var A: Vector2 = R[pr[0]]; var B: Vector2 = R[pr[1]]
				var dx := B.x - A.x; var dz := B.y - A.y
				var t := clampf(((u - A.x) * dx + (v - A.y) * dz) / (dx * dx + dz * dz), 0.0, 1.0)
				if Vector2(u - (A.x + dx * t), v - (A.y + dz * t)).length() < 1.1 / C: return true
			return false
		"gem": return absf(X) <= 0.72 and absf(Y) <= 0.72
		"plus": return (absf(X) < 0.32 and absf(Y) < 0.98) or (absf(Y) < 0.32 and absf(X) < 0.98)
		"tree": return (Y > -0.55 and absf(X) <= (1.05 - Y) * 0.62 and Y < 1.02) or (absf(X) < 0.2 and Y <= -0.55 and Y > -0.98)
		"flower":
			if disc(X, Y, 0, 0, 0.36): return true
			for k in 5:
				var a := PI / 2 + k * 1.2566
				if disc(X, Y, cos(a) * 0.6, sin(a) * 0.6, 0.3): return true
			return false
		"triangle": return Y >= -0.62 and absf(X) <= (0.98 - Y) * 0.6
		"hourglass": return absf(Y) <= 0.95 and absf(X) <= 0.22 + 0.62 * absf(Y)
		"cactus":
			return (absf(X) < 0.27 and Y > -0.98 and Y < 0.95) \
				or (X < 0 and X > -0.78 and Y > -0.32 and Y < 0.04) or (X > -0.8 and X < -0.44 and Y > -0.32 and Y < 0.58) \
				or (X > 0 and X < 0.78 and Y > -0.06 and Y < 0.3) or (X > 0.44 and X < 0.8 and Y > -0.06 and Y < 0.6)
		"crescent": return disc(X, Y, 0, 0, 0.98) and not disc(X, Y, 0.42, 0.3, 0.66)
		"ring": return disc(X, Y, 0, 0, 0.98) and not disc(X, Y, 0, 0, 0.4)
		"snowflake": return disc(X, Y, 0, 0, 0.98) and (disc(X, Y, 0, 0, 0.3) or absf(X) < 0.17 or absf(Y) < 0.17 or absf(absf(X) - absf(Y)) < 0.2)
		"frame": return maxf(absf(u), absf(v)) >= 0.42
		"islands":
			var R2 := [Vector2(0, 0.68), Vector2(0.68, 0), Vector2(0, -0.68), Vector2(-0.68, 0)]
			for r in R2:
				if disc(X, Y, r.x, r.y, 0.42): return true
			for k in 4:
				if link(X, Y, R2[k], R2[(k + 1) % 4], 14.0): return true
			return false
		"star":
			var rr := Vector2(X, Y).length(); var an := atan2(Y, X) - PI / 2
			return rr <= 0.42 + 0.56 * pow(0.5 + 0.5 * cos(5 * an), 1.6)
		"mushroom": return (Y >= -0.05 and disc(X, Y, 0, -0.05, 0.98)) or (absf(X) < 0.3 and Y < 0 and Y > -0.95)
		"snake": return absf(X) < 0.98 and absf(Y - 0.5 * sin(X * 2.8)) < 0.4
		"leaf":
			var a2 := (X + Y) / sqrt(2.0); var b2 := (Y - X) / sqrt(2.0)
			return disc(a2, b2, 0, 0.42, 0.97) and disc(a2, b2, 0, -0.42, 0.97)
	return true

static func bridges(shape: String, C: int) -> Array:
	if shape != "twin": return []
	var out := []
	for r in twin_rows(C):
		var cells := []
		for c in C:
			if c >= 0.4 * C - 1 and c < 0.6 * C + 1: cells.append([c, r])
		out.append(cells)
	return out


static func gen_shaped_maze(cells: int, rnd: Rng, shape: String) -> Dictionary:
	var C := cells; var N := C * 2 + 1
	var g := PackedByteArray(); g.resize(N * N); g.fill(1)
	var ok := func(cx: int, cz: int) -> bool: return cx >= 0 and cz >= 0 and cx < C and cz < C and inside(shape, cx, cz, C)
	var cells_in := []
	for cz in C:
		for cx in C:
			if ok.call(cx, cz): cells_in.append([cx, cz])
	# grow the maze in the shape's biggest connected part
	var comp := PackedInt32Array(); comp.resize(C * C); comp.fill(-1)
	var sizes := []
	for c0 in cells_in:
		if comp[c0[1] * C + c0[0]] >= 0: continue
		var id := sizes.size(); var q := [c0]; comp[c0[1] * C + c0[0]] = id
		var h := 0
		while h < q.size():
			for d in DIRS:
				var x: int = q[h][0] + d[0]; var z: int = q[h][1] + d[1]
				if ok.call(x, z) and comp[z * C + x] < 0:
					comp[z * C + x] = id; q.append([x, z])
			h += 1
		sizes.append(q.size())
	var big := sizes.find(sizes.max())
	var main := []
	for c0 in cells_in:
		if comp[c0[1] * C + c0[0]] == big: main.append(c0)
	var s0: Array = main[rnd.pick(main.size())]
	var stack := [s0]
	g[(2 * s0[1] + 1) * N + 2 * s0[0] + 1] = 0
	while stack.size() > 0:
		var top: Array = stack[stack.size() - 1]
		var cx: int = top[0]; var cz: int = top[1]
		var opts := []
		for d in DIRS:
			if ok.call(cx + d[0], cz + d[1]) and g[(2 * (cz + d[1]) + 1) * N + 2 * (cx + d[0]) + 1] == 1: opts.append(d)
		if opts.is_empty():
			stack.pop_back(); continue
		var d: Array = opts[rnd.pick(opts.size())]
		g[(2 * cz + 1 + d[1]) * N + 2 * cx + 1 + d[0]] = 0
		g[(2 * (cz + d[1]) + 1) * N + 2 * (cx + d[0]) + 1] = 0
		stack.append([cx + d[0], cz + d[1]])
	for br in bridges(shape, C):
		var in_br := []
		for b in br:
			if ok.call(b[0], b[1]): in_br.append(b)
		for k in range(1, in_br.size()):
			g[(in_br[k - 1][1] + in_br[k][1] + 1) * N + in_br[k - 1][0] + in_br[k][0] + 1] = 0
	for k in C: # a few loops inside the shape
		var m: Array = main[rnd.pick(main.size())]
		var d: Array = [[1, 0], [0, 1]][rnd.pick(2)]
		if ok.call(m[0] + d[0], m[1] + d[1]) and comp[(m[1] + d[1]) * C + m[0] + d[0]] == big:
			g[(2 * m[1] + 1 + d[1]) * N + 2 * m[0] + 1 + d[0]] = 0
	# empty floor: tiles not next to any open path stay empty (the walls hug the shape)
	var empty := PackedByteArray(); empty.resize(N * N)
	for z in N:
		for x in N:
			var near := false
			for dz in range(-1, 2):
				for dx in range(-1, 2):
					var X := x + dx; var Z := z + dz
					if X >= 0 and Z >= 0 and X < N and Z < N and g[Z * N + X] == 0: near = true
			if not near: empty[z * N + x] = 1
	# start on the open tile nearest the camera; the goal on the open tile furthest away by walking distance
	var start = null
	for z in N:
		for x in N:
			if g[z * N + x] == 0 and (start == null or x + z > start[0] + start[1]): start = [x, z]
	var dist := bfs({ "N": N, "g": g }, start)
	var far: int = start[1] * N + start[0]
	for i in N * N:
		if dist[i] > dist[far]: far = i
	return { "N": N, "g": g, "empty": empty, "start": start, "goal": [far % N, far / N] }


static func bfs(m: Dictionary, s: Array) -> PackedInt32Array:
	var N: int = m.N; var g: PackedByteArray = m.g
	var d := PackedInt32Array(); d.resize(N * N); d.fill(-1)
	var q := [s[1] * N + s[0]]; d[q[0]] = 0
	var h := 0
	while h < q.size():
		var i: int = q[h]; var x := i % N; var z := i / N
		for dd in DIRS:
			var X: int = x + dd[0]; var Z: int = z + dd[1]; var j := Z * N + X
			if X >= 0 and Z >= 0 and X < N and Z < N and g[j] == 0 and d[j] < 0:
				d[j] = d[i] + 1; q.append(j)
		h += 1
	return d


## the key: a dead end off the way, about `detour` of the walk longer than going straight
static func key_tile(m: Dictionary, a: Array, b: Array, detour := 0.5) -> Array:
	var da := bfs(m, a); var db := bfs(m, b)
	var N: int = m.N; var g: PackedByteArray = m.g
	var D := da[b[1] * N + b[0]]
	var best = null; var best_s := INF
	for i in N * N:
		if g[i] == 1 or da[i] < 3 or db[i] < 3: continue
		var x := i % N; var z := i / N
		var open := 0
		for d in DIRS:
			var X: int = x + d[0]; var Z: int = z + d[1]
			if X >= 0 and Z >= 0 and X < N and Z < N and g[Z * N + X] == 0: open += 1
		var sc := absf(da[i] + db[i] - D - detour * D) + (0.0 if open == 1 else 6.0)
		if sc < best_s:
			best_s = sc; best = [x, z]
	return best if best != null else [b[0], b[1]]


## a door level: two halves pulled apart, each with a door into the cave underneath (one in, one out)
static func gen_split_maze(C: int, rnd: Rng) -> Dictionary:
	var N := C * 2 + 1; var h := C / 2; var z_div := 2 * h
	var g := PackedByteArray(); g.resize(N * N); g.fill(1)
	for half in 2:
		var in_half := func(cz: int) -> bool: return cz < h if half == 0 else cz >= h
		var cells := []
		for cz in C:
			for cx in C:
				if in_half.call(cz): cells.append([cx, cz])
		var ok := func(cx: int, cz: int) -> bool: return cx >= 0 and cx < C and cz >= 0 and cz < C and in_half.call(cz)
		var s0: Array = cells[rnd.pick(cells.size())]
		var stack := [s0]
		g[(2 * s0[1] + 1) * N + 2 * s0[0] + 1] = 0
		while stack.size() > 0:
			var top: Array = stack[stack.size() - 1]
			var cx: int = top[0]; var cz: int = top[1]
			var opts := []
			for d in DIRS:
				if ok.call(cx + d[0], cz + d[1]) and g[(2 * (cz + d[1]) + 1) * N + 2 * (cx + d[0]) + 1] == 1: opts.append(d)
			if opts.is_empty():
				stack.pop_back(); continue
			var d: Array = opts[rnd.pick(opts.size())]
			g[(2 * cz + 1 + d[1]) * N + 2 * cx + 1 + d[0]] = 0
			g[(2 * (cz + d[1]) + 1) * N + 2 * (cx + d[0]) + 1] = 0
			stack.append([cx + d[0], cz + d[1]])
	var xA := N - 2 - 2 * rnd.pick(2); var xB := 1 + 2 * rnd.pick(2)
	# pull the two halves apart with an open gap between them, so you can see they are not connected
	var GAP := 3; var M := N + GAP + 1; var ox := (GAP + 1) / 2; var dz := GAP + 1
	var g2 := PackedByteArray(); g2.resize(M * M); g2.fill(1)
	var empty := PackedByteArray(); empty.resize(M * M); empty.fill(1)
	for z in range(0, z_div + 1):
		for x in N:
			g2[z * M + x + ox] = g[z * N + x]; empty[z * M + x + ox] = 0
	for z in range(z_div, N):
		for x in N:
			g2[(z + dz) * M + x + ox] = g[z * N + x]; empty[(z + dz) * M + x + ox] = 0
	return { "N": M, "g": g2, "empty": empty, "start": [N - 2 + ox, N - 2 + dz], "goal": [1 + ox, 1],
		"doors": [{ "id": "A", "x": xA + ox, "z": z_div + dz, "out": [xA + ox, z_div + dz + 1] }, { "id": "B", "x": xB + ox, "z": z_div, "out": [xB + ox, z_div - 1] }] }


## the cave under a door level: door A near the bottom corner, door B at the far corner
static func gen_cave_maze(L: int) -> Dictionary:
	var m := gen_maze(4 + mini(4, L / 10), Rng.new(L * 7919 + 3))
	var N: int = m.N
	m.doors = [{ "id": "A", "x": N - 2, "z": N - 1, "out": [N - 2, N - 2] }, { "id": "B", "x": 1, "z": 0, "out": [1, 1] }]
	m.empty = PackedByteArray(); m.start = [N - 2, N - 2]
	return m


static func dist(m: Dictionary, a: Array, b: Array) -> int:
	return bfs(m, a)[b[1] * m.N + b[0]]


## the maze of level L (for a door level: its surface, or with cave = true the cave underneath)
static func for_level(L: int, cave := false) -> Dictionary:
	var plan := level_plan(L)
	var rnd := Rng.new(L * 9973 + 17)
	var m: Dictionary
	if plan.gateway:
		m = gen_cave_maze(L) if cave else gen_split_maze(plan.cells, rnd)
		if cave: m.key = key_tile(m, m.doors[0].out, m.doors[1].out, plan.detour)
		return m
	if plan.shape != null:
		m = gen_shaped_maze(plan.cells, rnd, plan.shape)
	else:
		m = gen_maze(plan.cells, rnd)
	var N: int = m.N
	if not m.has("start"): m.start = [N - 2, N - 2]
	if not m.has("goal"): m.goal = [1, 1]
	if not m.has("empty"): m.empty = PackedByteArray()
	m.key = key_tile(m, m.start, m.goal, plan.detour)
	return m
