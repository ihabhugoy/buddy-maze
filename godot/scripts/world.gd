extends Node3D
## The playing field: the hidden maze, Buddy, the key and the portal, the camera, the ground and the ruins around.
## Values and rules follow the web game (game/main.js) so it plays the same.

signal won(stats: Dictionary)
signal key_got
signal steps_changed(n: int)

const TILE_W := 0.88
const WALL_H := 1.1          # full wall rise
const STUB_H := 0.44         # rise of walls between the camera and the character
const CLIP_Y := -0.18        # everything below is hidden by the floor, so flat stones read as a thin slab
const GROUND_Y := CLIP_Y - 0.02
const CHAR_H := 0.85
const STEP_TIME := 0.17
const CAM_STEPS := [4.4, 6.2, 8.6] # the view's height in tiles: close, medium, wide
const SUN_OFFSET := Vector3(-6.5, 9, -6)
const FILL_POS := Vector3(7, 3, 6)
const AHEAD := Vector3(-0.9, 0, -0.9) # keep more maze visible above the character
const INTRO := [1.2, 3.4, 3.9, 6.4]  # key hold | out to wide | wide hold | down to the character
const KEYS := { KEY_UP: [-1, 0], KEY_W: [-1, 0], KEY_RIGHT: [0, -1], KEY_D: [0, -1], KEY_DOWN: [1, 0], KEY_S: [1, 0], KEY_LEFT: [0, 1], KEY_A: [0, 1] }
const BIOMES := {
	"woods": { "bg": "#f5f1ea", "floor": "#f4efe7", "hemi": ["#fff3e2", "#d9bf9c", 0.75], "fill": ["#ffc792", 1.25], "sun": ["#ffdcae", 2.9], "dust": ["#9d9a92", "#b3afa6", "#c4c0b6"] },
	"desert": { "bg": "#f7efe3", "floor": "#f6ecdc", "hemi": ["#fff4e0", "#e6c79c", 0.8], "fill": ["#ffc58a", 1.2], "sun": ["#ffd59a", 3.0], "dust": ["#e3c79a", "#d4b07c", "#efd9b4"] },
	"snow": { "bg": "#eef3f8", "floor": "#f2f6fb", "hemi": ["#f4f8ff", "#c9d6e6", 0.85], "fill": ["#cfe3ff", 1.0], "sun": ["#fff6ea", 2.6], "dust": ["#ffffff", "#eef4fb", "#dde8f4"] },
	"autumn": { "bg": "#f6eee4", "floor": "#f5ece0", "hemi": ["#fff1de", "#d9b48c", 0.75], "fill": ["#ffb978", 1.3], "sun": ["#ffcf95", 2.8], "dust": ["#c98a4e", "#e0a35f", "#d9b48c"] },
	"cave": { "bg": "#0f1a2a", "floor": "#132236", "hemi": ["#6a8ed0", "#1c2a48", 1.1], "fill": ["#58d0ff", 0.8], "sun": ["#9cc4ff", 1.0], "dust": ["#5fd8ff", "#4a8dff", "#7fe8ff"] },
}
const WARP_IN := 0.45
const WARP_DARK := 1.05
const WARP_END := 1.75
var CAM_DIR := Vector3(1, tan(deg_to_rad(54)) * sqrt(2.0), 1).normalized()

var sfx: Node
var cam: Camera3D
var env: Environment
var sun: DirectionalLight3D
var fill: DirectionalLight3D
var ground: MeshInstance3D
var playing := false         # input and the clock run only while playing
var L := 0
var maze: Dictionary
var N := 0
var origin := 0.0
var heights := PackedFloat32Array()
var vels := PackedFloat32Array()
var targets := PackedFloat32Array()
var var_idx := PackedByteArray()
var rot_idx := PackedByteArray()
var biome := ""
var sets := {}
var walls_mm := []
var caps_mm := []
var player: Node3D
var body: Node3D
var walk_mats: Array = []
var char_id := "buddy"
var skin := 0
var walk_phase := 0.0
var walk_amp := 0.0
var st := {}
var key_at := [0, 0]
var has_key := false
var key_node: Node3D
var portal: Node3D
var portal_mat: ShaderMaterial
var won_t := -1.0
var steps := 0
var optimal := 1
var elapsed := 0.0
var held_dir = null
var queued = null
var anchor = null
var cam_target := Vector3()
var cam_w := 4.4
var cam_step := 0
var peek := false
var intro_t := -1.0
var grass: MeshInstance3D
var ruins := Node3D.new()
var ruin_sets := {}
var puffs: Array[CPUParticles3D] = []
var puff_i := 0
var _time := 0.0
var stage := "surface"       # a door level has a surface and a cave underneath
var door_nodes := {}         # tile index -> the door block standing there
var warp := { "t": -1.0 }
var fade: ColorRect
var gate_optimal := 0


func setup(camera: Camera3D, environment: Environment, sound: Node) -> void:
	cam = camera; env = environment; sfx = sound
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.shadow_blur = 1.5
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 26.0
	sun.shadow_bias = 0.03
	add_child(sun)
	fill = DirectionalLight3D.new(); add_child(fill)
	ground = MeshInstance3D.new()
	var pm := PlaneMesh.new(); pm.size = Vector2(400, 400); ground.mesh = pm
	var gm := StandardMaterial3D.new(); gm.roughness = 0.9; ground.material_override = gm
	ground.position.y = GROUND_Y
	add_child(ground)
	add_child(ruins)
	cam_step = int(Save.get_opt("cam", 0)); cam_w = CAM_STEPS[cam_step]
	var fl := CanvasLayer.new(); fl.layer = 5; add_child(fl)
	fade = ColorRect.new(); fade.color = Color(0.05, 0.08, 0.13, 0); fade.set_anchors_preset(Control.PRESET_FULL_RECT); fade.mouse_filter = Control.MOUSE_FILTER_IGNORE; fl.add_child(fade)
	var tex := _soft_dot()
	for i in 10: # dust puffs: soft billboards that drift up and fade
		var p := CPUParticles3D.new()
		p.emitting = false; p.one_shot = true; p.amount = 10; p.lifetime = 0.7; p.explosiveness = 0.95
		p.direction = Vector3(0, 1, 0); p.spread = 70; p.initial_velocity_min = 0.3; p.initial_velocity_max = 0.9
		p.gravity = Vector3(0, -0.4, 0); p.damping_min = 1.5; p.damping_max = 2.5
		p.scale_amount_min = 0.6; p.scale_amount_max = 1.2
		var curve := Curve.new(); curve.add_point(Vector2(0, 0.4)); curve.add_point(Vector2(0.3, 1)); curve.add_point(Vector2(1, 1.3)); p.scale_amount_curve = curve
		var grad := Gradient.new(); grad.set_color(0, Color(1, 1, 1, 0.75)); grad.set_color(1, Color(1, 1, 1, 0)); p.color_ramp = grad
		var qm := QuadMesh.new(); qm.size = Vector2(0.16, 0.16)
		var mat := StandardMaterial3D.new(); mat.albedo_texture = tex; mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES; mat.vertex_color_use_as_albedo = true
		qm.material = mat; p.mesh = qm
		add_child(p); puffs.append(p)


func _soft_dot() -> Texture2D:
	var g := GradientTexture2D.new(); g.fill = GradientTexture2D.FILL_RADIAL; g.fill_from = Vector2(0.5, 0.5); g.fill_to = Vector2(0.5, 0.0)
	var gr := Gradient.new(); gr.set_color(0, Color(1, 1, 1, 1)); gr.set_color(1, Color(1, 1, 1, 0)); g.gradient = gr
	g.width = 64; g.height = 64
	return g


func puff(at: Vector3, count := 8, up := 0.6) -> void:
	var p := puffs[puff_i]; puff_i = (puff_i + 1) % puffs.size()
	var dust: Array = BIOMES.get(biome, BIOMES.woods).dust
	p.position = at; p.amount = count; p.initial_velocity_max = up + 0.3
	p.color = Color(dust[randi() % dust.size()])
	p.restart(); p.emitting = true


# ---------- biome look ----------
func apply_biome(b: String) -> void:
	biome = b
	var B: Dictionary = BIOMES.get(b, BIOMES.woods)
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(B.bg)
	env.fog_light_color = Color(B.bg)
	env.ambient_light_color = Color(B.hemi[0]).lerp(Color(B.hemi[1]), 0.35)
	env.ambient_light_energy = B.hemi[2] * 0.72
	sun.light_color = Color(B.sun[0]); sun.light_energy = B.sun[1] * 0.4
	fill.light_color = Color(B.fill[0]); fill.light_energy = B.fill[1] * 0.2
	(ground.material_override as StandardMaterial3D).albedo_color = Color(B.floor)


func load_set(b: String) -> Dictionary:
	if sets.has(b): return sets[b]
	var scn: Node = load("res://assets/baked/%s.glb" % b).instantiate()
	var s := { "stones": [], "caps": [], "door": null }
	var found := {}
	for n in scn.find_children("*", "MeshInstance3D", true, false): found[n.name] = (n as MeshInstance3D).mesh
	var i := 0
	while found.has("stone%d" % i):
		s.stones.append(found["stone%d" % i]); s.caps.append(found["cap%d" % i]); i += 1
	s.door = found.get("door")
	s.door_yaw = 0.0
	for n in scn.find_children("door", "Node3D", true, false):
		if n.has_meta("extras"): s.door_yaw = float(n.get_meta("extras").get("yaw", 0.0))
	scn.free()
	sets[b] = s
	return s


# ---------- building a level ----------
func build_level(level: int, stg := "surface", spawn = null, keep := false) -> void:
	L = level; stage = stg
	var plan := Maze.level_plan(L)
	var world: Dictionary = Maze.WORLDS[plan.world]
	var b: String = "cave" if stage == "cave" else world.biome
	apply_biome(b)
	var s := load_set(b)
	maze = Maze.for_level(L, stage == "cave")
	if not maze.has("goal"): maze.goal = [-9, -9] # (no portal in the cave)
	if spawn != null: maze.start = spawn
	N = maze.N; origin = (N - 1) / 2.0
	var T := N * N
	heights = PackedFloat32Array(); heights.resize(T)
	vels = PackedFloat32Array(); vels.resize(T)
	targets = PackedFloat32Array(); targets.resize(T)
	var_idx = PackedByteArray(); var_idx.resize(T)
	rot_idx = PackedByteArray(); rot_idx.resize(T)
	for i in T:
		var_idx[i] = randi() % s.stones.size(); rot_idx[i] = randi() % 4
	for m in walls_mm + caps_mm: m.queue_free()
	walls_mm.clear(); caps_mm.clear()
	for v in s.stones.size():
		walls_mm.append(_multimesh(s.stones[v], T, true))
		caps_mm.append(_multimesh(s.caps[v], T, false))
	st = { "gx": maze.start[0], "gz": maze.start[1], "fx": maze.start[0], "fz": maze.start[1], "tx": maze.start[0], "tz": maze.start[1],
		"t": 1.0, "moving": false, "facing": PI * 0.75, "bump": -1.0, "bdx": 0, "bdz": 0 }
	for d in door_nodes.values(): d.queue_free()
	door_nodes.clear()
	for d in maze.get("doors", []): # door blocks: a stone with a cave mouth (and a tree on top), facing the side you come from
		var mi := MeshInstance3D.new(); mi.mesh = s.door
		mi.rotation.y = s.door_yaw + atan2(-(d.out[1] - d.z), d.out[0] - d.x)
		mi.position = tile_pos(d.x, d.z); add_child(mi)
		door_nodes[d.z * N + d.x] = mi
	if player == null: set_character(char_id, skin)
	player.position = tile_pos(st.gx, st.gz)
	player.scale = Vector3.ONE; body.rotation.y = st.facing
	key_at = maze.get("key", [-9, -9])
	if not keep:
		has_key = false; steps = 0; elapsed = 0.0
	won_t = -1.0; held_dir = null; queued = null
	if plan.gateway and stage == "surface" and not keep: # walk to door A, through the cave to the key and door B, then the portal
		var cave := Maze.for_level(L, true); var a: Dictionary = maze.doors[0]; var bb: Dictionary = maze.doors[1]
		gate_optimal = Maze.dist(maze, maze.start, a.out) + Maze.dist(cave, cave.doors[0].out, cave.key) + Maze.dist(cave, cave.key, cave.doors[1].out) + Maze.dist(maze, bb.out, maze.goal) + 4
	optimal = gate_optimal if plan.gateway else Maze.dist(maze, maze.start, key_at) + Maze.dist(maze, key_at, maze.goal)
	_make_key(); _make_portal(s)
	key_node.visible = key_at[0] >= 0 and not has_key
	portal.visible = stage == "surface"
	if has_key and portal_mat: portal_mat.set_shader_parameter("on", 1.0)
	_make_grass(); _place_ruins()
	update_targets(true)
	for i in T: heights[i] = targets[i]
	cam_target = player.position + AHEAD
	intro_t = -1.0 if keep else 0.0
	steps_changed.emit(steps)


func _multimesh(mesh: Mesh, count: int, shadow: bool) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = count
	mm.visible_instance_count = 0
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi


func tile_pos(x: float, z: float) -> Vector3:
	return Vector3(x - origin, 0, z - origin)


func is_wall(x: int, z: int) -> bool:
	return x < 0 or z < 0 or x >= N or z >= N or maze.g[z * N + x] == 1


func is_empty(i: int) -> bool:
	return maze.empty.size() > 0 and maze.empty[i] == 1


## the ground around the maze: this world's own grass/sand/snow, strongest under the maze and fading out to the floor
func _make_grass() -> void:
	if grass: grass.queue_free()
	var M := N + 10
	var img := Image.create(M, M, false, Image.FORMAT_L8)
	for z in N:
		for x in N:
			if not is_empty(z * N + x): img.set_pixel(x + 5, z + 5, Color(1, 1, 1))
	for pass_i in 3: # soften the edge a few tiles out (a box blur, three times)
		var src := img.duplicate() as Image
		for z in M:
			for x in M:
				var sum := 0.0; var n := 0
				for dz in range(-1, 2):
					for dx in range(-1, 2):
						var X := x + dx; var Z := z + dz
						if X >= 0 and Z >= 0 and X < M and Z < M: sum += src.get_pixel(X, Z).r; n += 1
				img.set_pixel(x, z, Color(sum / n, sum / n, sum / n))
	var sm := ShaderMaterial.new(); sm.shader = preload("res://scripts/grass.gdshader")
	sm.set_shader_parameter("ground", load("res://assets/baked/ground_%s.png" % biome))
	sm.set_shader_parameter("mask", ImageTexture.create_from_image(img))
	sm.set_shader_parameter("size", float(M))
	sm.set_shader_parameter("strength", 0.85 if biome != "snow" else 0.75)
	grass = MeshInstance3D.new()
	var pm := PlaneMesh.new(); pm.size = Vector2(M, M); grass.mesh = pm
	grass.material_override = sm; grass.position.y = GROUND_Y + 0.004
	grass.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(grass)


## ruins around the maze, sunk into the floor with a white haze rising from it (same placement as the web game)
func _place_ruins() -> void:
	for c in ruins.get_children(): c.queue_free()
	if not ruin_sets.has(biome):
		var meshes := []
		var path := "res://assets/baked/ruins_%s.glb" % biome
		if ResourceLoader.exists(path):
			var scn: Node = load(path).instantiate()
			for n in scn.find_children("*", "MeshInstance3D", true, false): meshes.append((n as MeshInstance3D).mesh)
			scn.free()
		ruin_sets[biome] = meshes
	var models: Array = ruin_sets[biome]
	if models.is_empty(): return
	var rnd := Maze.Rng.new(L * 31 + 7)
	var half := N / 2.0; var spots := []
	var placed := 0; var tries := 0
	var count := 3 if OS.has_feature("mobile") else 6
	var floor_col := Color(BIOMES.get(biome, BIOMES.woods).floor)
	while placed < count and tries < 600:
		tries += 1
		var R := half + 11.0
		var x := (rnd.next() * 2 - 1) * R; var z := (rnd.next() * 2 - 1) * R
		var size := 3.0 + rnd.next() * 1.4
		if maxf(absf(x), absf(z)) - size / 2 < half + 3.4 - size / 2: continue
		var clash := false
		for p in spots:
			if Vector2(p[0] - x, p[1] - z).length() < (p[2] + size) / 2 + 1.8: clash = true
		if clash: continue
		spots.append([x, z, size])
		var mesh: Mesh = models[rnd.pick(models.size())]
		var mi := MeshInstance3D.new(); mi.mesh = mesh
		var sm := ShaderMaterial.new(); sm.shader = preload("res://scripts/ruin.gdshader")
		var src := mesh.surface_get_material(0) as BaseMaterial3D
		if src: sm.set_shader_parameter("albedo_tex", src.albedo_texture)
		sm.set_shader_parameter("haze", floor_col); sm.set_shader_parameter("floor_y", GROUND_Y)
		var h := mesh.get_aabb().size.y * size; var sink := 0.1 + rnd.next() * 0.12
		sm.set_shader_parameter("haze_top", h * (1 - sink) * 0.35)
		mi.material_override = sm
		mi.scale = Vector3.ONE * size; mi.rotation.y = rnd.next() * TAU
		mi.position = Vector3(x, GROUND_Y - h * sink, z)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ruins.add_child(mi)
		placed += 1


## walls rise around you (lower between you and the camera, so you stay in view); everything else lies flat
func update_targets(silent: bool) -> void:
	var rising := 0
	var reveal: float = Maze.level_plan(L).reveal
	for z in N:
		for x in N:
			var i := z * N + x
			if maze.g[i] == 0 or is_empty(i):
				targets[i] = 0.0; continue
			var dx: int = x - st.tx; var dz: int = z - st.tz
			var t := 0.0
			if Vector2(dx, dz).length() <= reveal: t = STUB_H if dx + dz > 0 else WALL_H
			if not silent and targets[i] == 0.0 and t > 0.0:
				rising += 1
				if rising <= 3: puff(tile_pos(x, z) + Vector3(0, 0.05, 0), 6, 0.5)
			targets[i] = t
	if rising > 0: sfx.play("rise", min(0.45, 0.26 + rising * 0.04))


func update_stones(dt: float) -> void:
	var T := N * N
	var k := 220.0; var damp := exp(-15.0 * dt)
	var nw := []; var nc := []
	nw.resize(walls_mm.size()); nc.resize(caps_mm.size()); nw.fill(0); nc.fill(0)
	for i in T:
		if is_empty(i): continue
		vels[i] += (targets[i] - heights[i]) * k * dt
		vels[i] *= damp
		heights[i] += vels[i] * dt
		if heights[i] < 0.0:
			if targets[i] == 0.0 and vels[i] < -0.4: sfx.play("land", 0.35)
			heights[i] = 0.0; vels[i] = 0.0
		if door_nodes.has(i): # door blocks move as one piece
			door_nodes[i].position.y = heights[i]; continue
		var v: int = var_idx[i]
		var xf := Transform3D(Basis(Vector3.UP, rot_idx[i] * PI / 2), Vector3(i % N - origin, heights[i], i / N - origin))
		if heights[i] > 0.003:
			walls_mm[v].multimesh.set_instance_transform(nw[v], xf); nw[v] += 1
		else:
			caps_mm[v].multimesh.set_instance_transform(nc[v], xf); nc[v] += 1
	for v in walls_mm.size():
		walls_mm[v].multimesh.visible_instance_count = nw[v]
		caps_mm[v].multimesh.visible_instance_count = nc[v]


# ---------- Buddy ----------
func set_character(id: String, skin_idx: int) -> void:
	char_id = id; skin = skin_idx
	var keep := player.position if player else Vector3()
	if player: player.queue_free()
	player = Node3D.new(); add_child(player)
	body = Node3D.new(); player.add_child(body)
	var c := Chars.make(id, CHAR_H, skin)
	body.add_child(c.node); walk_mats = c.mats
	player.position = keep
	if not st.is_empty(): body.rotation.y = st.facing


func try_move(d: Array) -> bool:
	if not playing or won_t >= 0.0 or warp.t >= 0.0: return false
	if intro_t >= 0.0:
		skip_intro(); return false
	if st.moving:
		queued = d; return false
	var nx: int = st.gx + d[0]; var nz: int = st.gz + d[1]
	st.facing = atan2(-d[1], d[0]) # the model faces +X
	for door in maze.get("doors", []):
		if door.x == nx and door.z == nz:
			_start_warp(door); return false
	if is_wall(nx, nz):
		if st.bump < 0.0 or st.bump > 0.45:
			st.bump = 0.0; st.bdx = d[0]; st.bdz = d[1]; sfx.play("bump", 0.3)
		return false
	st.fx = st.gx; st.fz = st.gz; st.tx = nx; st.tz = nz; st.t = 0.0; st.moving = true
	steps += 1; steps_changed.emit(steps)
	update_targets(false)
	puff(tile_pos(st.gx, st.gz) + Vector3(0, 0.02, 0), 4, 0.25)
	return true


# ---------- going through a door ----------
# Buddy walks into the cave mouth and shrinks into it, the view fades to dark, the other side is built, then the view
# fades back in and Buddy walks out of the matching door
func _start_warp(door: Dictionary) -> void:
	warp = { "t": 0.0, "door": door, "swapped": false, "from": tile_pos(st.gx, st.gz), "to": tile_pos(door.x, door.z) }
	st.facing = atan2(-(door.z - st.gz), door.x - st.gx); held_dir = null; queued = null
	sfx.play("step", 0.62)


func _update_warp(dt: float) -> void:
	warp.t += dt
	var t: float = warp.t
	if t < WARP_IN: # into the cave mouth, shrinking
		var k := t / WARP_IN
		player.position = warp.from.lerp(warp.to, k); player.scale = Vector3.ONE * (1.0 - 0.9 * k)
	fade.color.a = clampf((t - WARP_IN * 0.6) / (WARP_DARK - WARP_IN * 0.6), 0.0, 1.0) if t < WARP_DARK else clampf(1.0 - (t - WARP_DARK) / (WARP_END - WARP_DARK), 0.0, 1.0)
	if t >= WARP_DARK and not warp.swapped:
		warp.swapped = true
		var to_cave := stage != "cave"
		var other := Maze.for_level(L, to_cave)
		var d: Dictionary = {}
		for o in other.doors:
			if o.id == warp.door.id: d = o
		build_level(L, "cave" if to_cave else "surface", d.out, true)
		warp.from = tile_pos(d.x, d.z); warp.to = tile_pos(d.out[0], d.out[1])
		st.facing = atan2(-(d.out[1] - d.z), d.out[0] - d.x); body.rotation.y = st.facing
		cam_target = warp.to + AHEAD
	if warp.swapped: # out of the other door, growing back
		var k2 := clampf((t - WARP_DARK) / (WARP_END - WARP_DARK), 0.0, 1.0)
		player.position = warp.from.lerp(warp.to, k2); player.scale = Vector3.ONE * (0.1 + 0.9 * k2)
	if t >= WARP_END:
		warp.t = -1.0; player.scale = Vector3.ONE; fade.color.a = 0.0


func update_player(dt: float) -> void:
	if warp.t >= 0.0:
		_update_warp(dt); return
	if won_t >= 0.0: # hop into the portal: drift to its middle, spin and shrink away
		won_t += dt
		var k := minf(1.0, won_t / 0.7); var e := k * k
		player.position = player.position.lerp(Vector3(portal.position.x, 0.25 * sin(PI * k), portal.position.z), minf(1.0, dt * 8))
		body.rotation.y += dt * (4 + 14 * e)
		player.scale = Vector3.ONE * maxf(0.001, 1 - e)
		return
	var x: float; var z: float; var y := 0.0; var sq := 1.0
	if st.moving:
		st.t = minf(1.0, st.t + dt / STEP_TIME)
		x = lerpf(st.fx, st.tx, st.t); z = lerpf(st.fz, st.tz, st.t)
		y = absf(sin(walk_phase)) * 0.075 # springy steps: a hop each step, stretched at the top, squashed on landing
		sq = 1.0 - 0.06 * cos(2 * walk_phase)
		if st.t >= 1.0:
			st.moving = false; st.gx = st.tx; st.gz = st.tz
			sfx.play("step", 0.62)
			if not has_key and st.gx == key_at[0] and st.gz == key_at[1]: _collect_key()
			if st.gx == maze.goal[0] and st.gz == maze.goal[1]:
				if has_key:
					_win(); return
			var nxt = queued if queued != null else held_dir
			queued = null
			if nxt != null: try_move(nxt)
	else:
		x = st.gx; z = st.gz
		sq = 1.0 + sin(_time * 3) * 0.02 # breathing
	var bump := Vector3()
	if st.bump >= 0.0: # a little bonk against the wall
		st.bump += dt
		var bk: float = st.bump / 0.35
		if bk >= 1.0: st.bump = -1.0
		else: bump = Vector3(st.bdx, 0, st.bdz) * sin(PI * bk) * 0.12
	player.position = tile_pos(x, z) + Vector3(0, y, 0) + bump
	var want: float = st.facing
	if intro_t >= INTRO[2] and intro_t < INTRO[3]: want = -PI / 4 # looks at the camera while it comes down
	body.rotation.y = lerp_angle(body.rotation.y, want, minf(1.0, dt * 16))
	body.scale = Vector3(1.0 / sqrt(sq), sq, 1.0 / sqrt(sq))
	walk_amp = move_toward(walk_amp, 1.0 if st.moving else 0.0, dt * 6)
	if st.moving: walk_phase += dt * PI / STEP_TIME
	for m in walk_mats:
		m.set_shader_parameter("phase", walk_phase); m.set_shader_parameter("amp", walk_amp)


func _win() -> void:
	won_t = 0.0
	sfx.ui("chime", 0.5)
	var ratio := float(steps) / maxf(1.0, optimal)
	var stars := 3 if ratio <= 1.15 else 2 if ratio <= 1.6 else 1
	get_tree().create_timer(0.8).timeout.connect(func(): won.emit({ "stars": stars, "steps": steps, "time": elapsed, "best": optimal }))


# ---------- the key and the portal ----------
func _make_key() -> void:
	if key_node: key_node.queue_free()
	key_node = Node3D.new(); add_child(key_node)
	var gold := StandardMaterial3D.new()
	gold.albedo_color = Color("#f4c24a"); gold.metallic = 0.35; gold.roughness = 0.32
	gold.emission_enabled = true; gold.emission = Color("#ffae00"); gold.emission_energy_multiplier = 0.25
	var spin := Node3D.new(); spin.name = "spin"; key_node.add_child(spin)
	var ring := MeshInstance3D.new(); var tm := TorusMesh.new(); tm.inner_radius = 0.05; tm.outer_radius = 0.1
	ring.mesh = tm; ring.material_override = gold; ring.position.x = -0.12; spin.add_child(ring)
	var shaft := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(0.22, 0.04, 0.05)
	shaft.mesh = bm; shaft.material_override = gold; shaft.position.x = 0.07; spin.add_child(shaft)
	for k in 2:
		var tooth := MeshInstance3D.new(); var tb := BoxMesh.new(); tb.size = Vector3(0.035, 0.04, 0.07)
		tooth.mesh = tb; tooth.material_override = gold; tooth.position = Vector3(0.12 + k * 0.05, 0, 0.05); spin.add_child(tooth)
	key_node.position = tile_pos(key_at[0], key_at[1]) + Vector3(0, 0.42, 0)


func _collect_key() -> void:
	has_key = true
	sfx.ui("pop", 0.5)
	var tw := create_tween().set_parallel()
	tw.tween_property(key_node, "position:y", key_node.position.y + 1.2, 0.5).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(key_node, "scale", Vector3.ONE * 0.01, 0.5).set_delay(0.25)
	if portal_mat: portal_mat.set_shader_parameter("on", 1.0)
	key_got.emit()


func _make_portal(s: Dictionary) -> void:
	if portal: portal.queue_free()
	portal = Node3D.new(); add_child(portal)
	var stone: Mesh = s.stones[0]
	var cap: Mesh = s.caps[0]
	var base := MeshInstance3D.new(); base.mesh = cap; base.scale = Vector3(1.15, 1, 1.15); base.position.y = 0.08; portal.add_child(base)
	for sx in [-0.33, 0.33]: # two pillars of stacked stones and a lintel across
		for k in 3:
			var p := MeshInstance3D.new(); p.mesh = stone; p.scale = Vector3.ONE * 0.27
			p.position = Vector3(sx, 0.08 + 0.36 * (k + 1), 0); p.rotation.y = k * PI / 2; portal.add_child(p)
	for k in 3:
		var lt := MeshInstance3D.new(); lt.mesh = stone; lt.scale = Vector3(0.27, 0.27, 0.27)
		lt.position = Vector3(-0.27 + k * 0.27, 1.32, 0); lt.rotation = Vector3(0, 0, PI / 2); portal.add_child(lt)
	var disc := MeshInstance3D.new(); var qm := QuadMesh.new(); qm.size = Vector2(0.42, 0.95); disc.mesh = qm
	portal_mat = ShaderMaterial.new(); portal_mat.shader = preload("res://scripts/portal.gdshader")
	disc.material_override = portal_mat; disc.position.y = 0.6; portal.add_child(disc)
	portal.position = tile_pos(maze.goal[0], maze.goal[1])
	portal.rotation.y = _portal_yaw(maze.goal)
	portal.scale = Vector3.ONE * 0.84


func _portal_yaw(g: Array) -> float: # face the open neighbour (the tile you walk in from)
	for d in [[1, 0], [0, 1], [-1, 0], [0, -1]]:
		if not is_wall(g[0] + d[0], g[1] + d[1]): return atan2(d[0], d[1])
	return PI / 4


# ---------- camera: a level intro, then following you ----------
func skip_intro() -> void:
	if intro_t >= 0.0 and intro_t < INTRO[2]: intro_t = INTRO[2]


static func _ease(k: float) -> float: return k * k * k * (k * (k * 6 - 15) + 10)


func update_camera(dt: float) -> void:
	var W := cam_w
	var follow := player.position * Vector3(1, 0, 1) + AHEAD
	if intro_t >= 0.0: # the key (or portal), out to the whole maze, then down to Buddy
		intro_t += minf(dt, 1.0 / 30.0)
		var t := intro_t; var wide_w := N * 1.3
		var keyp := Vector3(key_node.position.x, 0, key_node.position.z)
		var u := func(a: float, b: float) -> float: return clampf((t - a) / (b - a), 0.0, 1.0)
		if t < INTRO[0]:
			cam_target = keyp; W = 3.2
		elif t < INTRO[1]:
			var e := _ease(u.call(INTRO[0], INTRO[1])); cam_target = keyp.lerp(Vector3(), e); W = exp(lerpf(log(3.2), log(wide_w), e))
		elif t < INTRO[2]:
			cam_target = Vector3(); W = wide_w
		elif t < INTRO[3]:
			var e2 := _ease(u.call(INTRO[2], INTRO[3])); cam_target = Vector3().lerp(follow, e2); W = exp(lerpf(log(wide_w), log(cam_w), e2))
		else:
			intro_t = -1.0; cam_target = follow
	else:
		cam_target = cam_target.lerp(follow, 1.0 - exp(-6.0 * dt))
		W = maxf(cam_w, N * 1.25) if peek else cam_w
	_cur_w = lerpf(_cur_w, W, 1.0 - exp(-8.0 * dt)) if intro_t < 0.0 else W
	var vp := get_viewport().get_visible_rect().size
	var aspect := vp.x / maxf(1.0, vp.y)
	var half := tan(deg_to_rad(cam.fov / 2))
	var dist := maxf((_cur_w / 2) / (half * minf(aspect, 1.0)), 7.0)
	cam.position = cam_target + CAM_DIR * dist
	cam.look_at(cam_target, Vector3.UP)
	env.fog_depth_begin = dist * 0.95; env.fog_depth_end = dist * 2.2
	sun.look_at_from_position(cam_target + SUN_OFFSET, cam_target, Vector3.UP)
	fill.look_at_from_position(cam_target + FILL_POS, cam_target, Vector3.UP)
var _cur_w := 4.4


func next_zoom() -> int:
	cam_step = (cam_step + 1) % CAM_STEPS.size(); cam_w = CAM_STEPS[cam_step]; Save.set_opt("cam", cam_step)
	return cam_step


# ---------- input: keys follow the screen; on a phone, swipe and hold ----------
func handle_input(e: InputEvent) -> void:
	if e is InputEventKey:
		var k: InputEventKey = e
		if KEYS.has(k.keycode):
			if k.pressed and not k.echo:
				held_dir = KEYS[k.keycode]; try_move(held_dir)
			elif not k.pressed and held_dir == KEYS[k.keycode]:
				held_dir = null
	elif e is InputEventScreenTouch:
		var t: InputEventScreenTouch = e
		if t.pressed:
			anchor = t.position
			if intro_t >= 0.0: skip_intro()
		else:
			anchor = null; held_dir = null
	elif e is InputEventScreenDrag and anchor != null:
		var dr: InputEventScreenDrag = e
		var d: Vector2 = dr.position - anchor
		if d.length() > 22.0:
			var g := _screen_to_grid(d)
			if held_dir != g:
				held_dir = g; try_move(g)
			anchor = dr.position


func _screen_to_grid(drag: Vector2) -> Array:
	var base := cam.unproject_position(player.position)
	var best: Array = Maze.DIRS[0]; var best_dot := -INF
	for d in Maze.DIRS:
		var p := cam.unproject_position(player.position + Vector3(d[0], 0, d[1]))
		var dot := (p - base).normalized().dot(drag.normalized())
		if dot > best_dot:
			best_dot = dot; best = d
	return best


func tick(dt: float) -> void:
	_time += dt
	if playing and won_t < 0.0 and intro_t < 0.0: elapsed += dt
	update_player(dt)
	update_stones(dt)
	update_camera(dt)
	if key_node and not has_key:
		key_node.get_node("spin").rotation.y += dt * 1.6
		key_node.position.y = 0.42 + sin(_time * 2.2) * 0.05
	if portal_mat: portal_mat.set_shader_parameter("time", _time)
