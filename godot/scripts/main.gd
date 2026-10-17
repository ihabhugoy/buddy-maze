extends Node3D
## Buddy, the Godot remake. The maze hides: stones only rise around you, then sink back; find the key, then the
## portal. Values and rules follow the web game (game/main.js) so it plays the same.

const TILE_W := 0.88
const WALL_H := 1.1          # full wall rise
const STUB_H := 0.44         # rise of walls between the camera and the character
const CLIP_Y := -0.18        # everything below is hidden by the floor, so flat stones read as a thin slab
const CHAR_H := 0.85
const STEP_TIME := 0.17
const VIEW_W := 4.4          # the view's height in tiles
const SUN_OFFSET := Vector3(-6.5, 9, -6)
const FILL_POS := Vector3(7, 3, 6)
const AHEAD := Vector3(-0.9, 0, -0.9) # keep more maze visible above the character
var CAM_DIR := Vector3(1, tan(deg_to_rad(54)) * sqrt(2.0), 1).normalized()
# keys follow the screen: the camera looks down a diagonal
const KEYS := { KEY_UP: [-1, 0], KEY_W: [-1, 0], KEY_RIGHT: [0, -1], KEY_D: [0, -1], KEY_DOWN: [1, 0], KEY_S: [1, 0], KEY_LEFT: [0, 1], KEY_A: [0, 1] }
const BIOMES := {
	"woods": { "bg": "#f5f1ea", "floor": "#f4efe7", "hemi": ["#fff3e2", "#d9bf9c", 0.75], "fill": ["#ffc792", 1.25], "sun": ["#ffdcae", 2.9] },
	"desert": { "bg": "#f7efe3", "floor": "#f6ecdc", "hemi": ["#fff4e0", "#e6c79c", 0.8], "fill": ["#ffc58a", 1.2], "sun": ["#ffd59a", 3.0] },
	"snow": { "bg": "#eef3f8", "floor": "#f2f6fb", "hemi": ["#f4f8ff", "#c9d6e6", 0.85], "fill": ["#cfe3ff", 1.0], "sun": ["#fff6ea", 2.6] },
	"autumn": { "bg": "#f6eee4", "floor": "#f5ece0", "hemi": ["#fff1de", "#d9b48c", 0.75], "fill": ["#ffb978", 1.3], "sun": ["#ffcf95", 2.8] },
}
const SAVE_PATH := "user://save.cfg"

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
var sets := {}                 # biome -> { stones: [Mesh], caps: [Mesh], door: Mesh }
var walls_mm := []             # one MultiMesh per stone variant (raised stones, full mesh)
var caps_mm := []              # one MultiMesh per stone variant (flat stones, top only)
var player: Node3D
var body: Node3D
var walk_mats: Array[ShaderMaterial] = []
var walk_phase := 0.0
var walk_amp := 0.0
var st := { "gx": 0, "gz": 0, "fx": 0, "fz": 0, "tx": 0, "tz": 0, "t": 1.0, "moving": false, "facing": PI * 0.75, "bump": -1.0, "bdx": 0, "bdz": 0 }
var key_at := [0, 0]
var has_key := false
var key_node: Node3D
var portal: Node3D
var portal_mat: ShaderMaterial
var won := false
var win_t := 0.0
var steps := 0
var held_dir = null
var queued = null
var anchor = null
var cam: Camera3D
var cam_target := Vector3()
var cam_w := VIEW_W
var sun: DirectionalLight3D
var fill: DirectionalLight3D
var env: Environment
var ground: MeshInstance3D
var ui := {}
var sfx: Node
var shot_path := ""
var shot_t := -1.0
var auto_walk := false


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="): shot_path = a.substr(7); shot_t = 7.0
		if a == "--autowalk": auto_walk = true
		if a.begins_with("--level="): L = int(a.substr(8))
	_setup_world()
	sfx = preload("res://scripts/sfx.gd").new()
	add_child(sfx)
	_setup_ui()
	_load_player("buddy")
	if L == 0: L = _load_progress()
	build_level(L)
	sfx.music()


# ---------- world: camera, lights, sky, floor ----------
func _setup_world() -> void:
	cam = Camera3D.new()
	cam.fov = 28.0
	cam.near = 0.5; cam.far = 200.0
	add_child(cam)
	var we := WorldEnvironment.new()
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 0.95
	env.adjustment_enabled = true; env.adjustment_contrast = 1.06; env.adjustment_saturation = 1.08
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_light_energy = 1.0
	env.fog_sun_scatter = 0.0
	env.fog_density = 1.0
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.shadow_blur = 1.5
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 26.0
	sun.shadow_bias = 0.03
	add_child(sun)
	fill = DirectionalLight3D.new()
	add_child(fill)
	ground = MeshInstance3D.new()
	var pm := PlaneMesh.new(); pm.size = Vector2(400, 400)
	ground.mesh = pm
	var gm := StandardMaterial3D.new(); gm.roughness = 0.9
	ground.material_override = gm
	ground.position.y = CLIP_Y - 0.02
	add_child(ground)


func apply_biome(b: String) -> void:
	biome = b
	var B: Dictionary = BIOMES.get(b, BIOMES.woods)
	env.background_color = Color(B.bg)
	env.fog_light_color = Color(B.bg)
	env.ambient_light_color = Color(B.hemi[0]).lerp(Color(B.hemi[1]), 0.35)
	env.ambient_light_energy = B.hemi[2] * 0.72
	sun.light_color = Color(B.sun[0]); sun.light_energy = B.sun[1] * 0.4
	fill.light_color = Color(B.fill[0]); fill.light_energy = B.fill[1] * 0.2
	(ground.material_override as StandardMaterial3D).albedo_color = Color(B.floor)


# ---------- stones ----------
func load_set(b: String) -> Dictionary:
	if sets.has(b): return sets[b]
	var scn: Node = load("res://assets/baked/%s.glb" % b).instantiate()
	var s := { "stones": [], "caps": [], "door": null }
	var found := {}
	for n in scn.find_children("*", "MeshInstance3D", true, false):
		found[n.name] = (n as MeshInstance3D).mesh
	var i := 0
	while found.has("stone%d" % i):
		s.stones.append(found["stone%d" % i]); s.caps.append(found["cap%d" % i]); i += 1
	s.door = found.get("door")
	scn.free()
	sets[b] = s
	return s


func build_level(level: int) -> void:
	L = level
	var plan := Maze.level_plan(L)
	var world: Dictionary = Maze.WORLDS[plan.world]
	apply_biome(world.biome)
	var s := load_set(world.biome)
	maze = Maze.for_level(L)
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
	# you, the key, the portal
	st.gx = maze.start[0]; st.gz = maze.start[1]; st.tx = st.gx; st.tz = st.gz; st.fx = st.gx; st.fz = st.gz
	st.t = 1.0; st.moving = false; st.facing = PI * 0.75
	player.position = tile_pos(st.gx, st.gz)
	player.scale = Vector3.ONE
	key_at = maze.key; has_key = false; won = false; steps = 0
	_make_key(); _make_portal(s)
	update_targets(true)
	for i in T: heights[i] = targets[i]
	cam_target = player.position + AHEAD
	ui.level.text = "%d-%d" % [plan.world + 1, L % Maze.LEVELS_PER_WORLD + 1]
	ui.steps.text = "0"
	ui.win.visible = false
	ui.key.modulate.a = 0.35


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
			if not silent and targets[i] == 0.0 and t > 0.0: rising += 1
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
func _load_player(id: String) -> void:
	if player: player.queue_free()
	player = Node3D.new(); add_child(player)
	body = Node3D.new(); player.add_child(body)
	var scn: Node3D = load("res://assets/baked/char_%s.glb" % id).instantiate()
	body.add_child(scn)
	var meta: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/baked/chars.json"))[id]
	var shader := preload("res://scripts/walk.gdshader")
	walk_mats.clear()
	var box := AABB(); var first := true
	for mi in scn.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var src := m.mesh.surface_get_material(0) as BaseMaterial3D
		var sm := ShaderMaterial.new(); sm.shader = shader
		if src and src.albedo_texture: sm.set_shader_parameter("albedo_tex", src.albedo_texture)
		for p in ["hip", "sho", "drop", "top", "bot", "neck", "len", "baked", "ears"]:
			if meta.has(p) and meta[p] != null: sm.set_shader_parameter(p, float(meta[p]))
		if meta.has("armZ"): sm.set_shader_parameter("armz", float(meta.armZ))
		m.material_override = sm
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		walk_mats.append(sm)
		var b := m.global_transform * m.get_aabb() if m.is_inside_tree() else m.transform * m.get_aabb()
		box = b if first else box.merge(b); first = false
	var sc := CHAR_H / box.size.y
	scn.scale = Vector3.ONE * sc
	scn.position = Vector3(-(box.position.x + box.size.x / 2) * sc, -box.position.y * sc, -(box.position.z + box.size.z / 2) * sc)


func try_move(d: Array) -> bool:
	if won or ui.win.visible: return false
	if st.moving:
		queued = d; return false
	var nx: int = st.gx + d[0]; var nz: int = st.gz + d[1]
	st.facing = atan2(-d[1], d[0]) # the model faces +X
	if is_wall(nx, nz):
		if st.bump < 0.0 or st.bump > 0.45:
			st.bump = 0.0; st.bdx = d[0]; st.bdz = d[1]; sfx.play("bump", 0.3)
		return false
	st.fx = st.gx; st.fz = st.gz; st.tx = nx; st.tz = nz; st.t = 0.0; st.moving = true
	steps += 1; ui.steps.text = str(steps)
	update_targets(false)
	return true


func update_player(dt: float, time: float) -> void:
	if won: # hop into the portal: drift to its middle, spin and shrink away
		win_t += dt
		var k := minf(1.0, win_t / 0.7); var e := k * k
		player.position = player.position.lerp(Vector3(portal.position.x, 0.25 * sin(PI * k), portal.position.z), minf(1.0, dt * 8))
		body.rotation.y += dt * (4 + 14 * e)
		player.scale = Vector3.ONE * maxf(0.001, 1 - e)
		if k >= 1.0 and not ui.win.visible: _show_win()
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
			if st.gx == maze.goal[0] and st.gz == maze.goal[1] and has_key:
				won = true; win_t = 0.0; sfx.ui("chime", 0.5); _save_progress(L + 1)
			var nxt = queued if queued != null else held_dir
			queued = null
			if nxt != null: try_move(nxt)
	else:
		x = st.gx; z = st.gz
		sq = 1.0 + sin(time * 3) * 0.02 # breathing
	var bump := Vector3()
	if st.bump >= 0.0: # a little bonk against the wall
		st.bump += dt
		var bk: float = st.bump / 0.35
		if bk >= 1.0: st.bump = -1.0
		else: bump = Vector3(st.bdx, 0, st.bdz) * sin(PI * bk) * 0.12
	player.position = tile_pos(x, z) + Vector3(0, y, 0) + bump
	var want: float = st.facing
	body.rotation.y = lerp_angle(body.rotation.y, want, minf(1.0, dt * 16))
	body.scale = Vector3(1.0 / sqrt(sq), sq, 1.0 / sqrt(sq))
	walk_amp = move_toward(walk_amp, 1.0 if st.moving else 0.0, dt * 6)
	if st.moving: walk_phase += dt * PI / STEP_TIME
	for m in walk_mats:
		m.set_shader_parameter("phase", walk_phase); m.set_shader_parameter("amp", walk_amp)


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
	ui.key.modulate.a = 1.0
	if portal_mat: portal_mat.set_shader_parameter("on", 1.0)


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


# ---------- camera ----------
func update_camera(dt: float) -> void:
	var want := player.position * Vector3(1, 0, 1) + AHEAD
	cam_target = cam_target.lerp(want, 1.0 - exp(-6.0 * dt))
	var vp := get_viewport().get_visible_rect().size
	var aspect := vp.x / maxf(1.0, vp.y)
	var half := tan(deg_to_rad(cam.fov / 2))
	var dist := maxf((cam_w / 2) / (half * minf(aspect, 1.0)), 7.0)
	cam.position = cam_target + CAM_DIR * dist
	cam.look_at(cam_target, Vector3.UP)
	env.fog_depth_begin = dist * 0.95; env.fog_depth_end = dist * 2.2
	sun.look_at_from_position(cam_target + SUN_OFFSET, cam_target, Vector3.UP)
	fill.look_at_from_position(cam_target + FILL_POS, cam_target, Vector3.UP)


# ---------- input: keys follow the screen; on a phone, swipe and hold ----------
func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey:
		var k: InputEventKey = e
		if KEYS.has(k.keycode):
			if k.pressed and not k.echo:
				held_dir = KEYS[k.keycode]; try_move(held_dir)
			elif not k.pressed and held_dir == KEYS[k.keycode]:
				held_dir = null
	elif e is InputEventScreenTouch:
		var t: InputEventScreenTouch = e
		if t.pressed: anchor = t.position
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


# ---------- loop ----------
var _time := 0.0
var _auto_t := 0.0
func _process(dt: float) -> void:
	dt = minf(dt, 1.0 / 20.0)
	_time += dt
	update_player(dt, _time)
	update_stones(dt)
	update_camera(dt)
	if key_node and not has_key:
		key_node.get_node("spin").rotation.y += dt * 1.6
		key_node.position.y = 0.42 + sin(_time * 2.2) * 0.05
	if portal_mat: portal_mat.set_shader_parameter("time", _time)
	if auto_walk:
		_auto_t += dt
		if _auto_t > 0.22:
			_auto_t = 0.0; try_move(Maze.DIRS[randi() % 4])
	if shot_t > 0.0:
		shot_t -= dt
		if shot_t <= 0.0:
			get_viewport().get_texture().get_image().save_png(shot_path)
			print("shot saved ", shot_path, " fps ", Engine.get_frames_per_second())
			get_tree().quit()


# ---------- UI ----------
func _setup_ui() -> void:
	var layer := CanvasLayer.new(); add_child(layer)
	var bar := HBoxContainer.new(); bar.position = Vector2(24, 20); bar.add_theme_constant_override("separation", 14)
	layer.add_child(bar)
	ui.level = _chip(bar, "1-1"); ui.key = _chip(bar, "Key"); ui.steps = _chip(bar, "0")
	var win := PanelContainer.new(); win.custom_minimum_size = Vector2(320, 190)
	var sb := StyleBoxFlat.new(); sb.bg_color = Color("#fffaf1"); sb.set_corner_radius_all(28); sb.border_color = Color("#ead9bd"); sb.set_border_width_all(3)
	sb.shadow_color = Color(0.35, 0.22, 0.1, 0.25); sb.shadow_size = 18
	win.add_theme_stylebox_override("panel", sb)
	var vb := VBoxContainer.new(); vb.alignment = BoxContainer.ALIGNMENT_CENTER; vb.add_theme_constant_override("separation", 16); win.add_child(vb)
	var title := Label.new(); title.text = "Well done!"; title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 34); title.add_theme_color_override("font_color", Color("#5aa548")); vb.add_child(title)
	var next := Button.new(); next.text = "  Next level  "; next.add_theme_font_size_override("font_size", 22)
	next.pressed.connect(func(): sfx.ui("pop", 0.4); build_level(L + 1))
	vb.add_child(next)
	win.visible = false
	var center := CenterContainer.new(); center.set_anchors_preset(Control.PRESET_FULL_RECT); center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(center); center.add_child(win)
	ui.win = win


func _chip(parent: Control, text: String) -> Label:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new(); sb.bg_color = Color("#fffaf1"); sb.set_corner_radius_all(999)
	sb.content_margin_left = 18; sb.content_margin_right = 18; sb.content_margin_top = 8; sb.content_margin_bottom = 10
	sb.shadow_color = Color(0.4, 0.25, 0.1, 0.18); sb.shadow_size = 8
	p.add_theme_stylebox_override("panel", sb)
	var l := Label.new(); l.text = text; l.add_theme_font_size_override("font_size", 20); l.add_theme_color_override("font_color", Color("#4a3a2a"))
	p.add_child(l); parent.add_child(p)
	return l


func _show_win() -> void:
	ui.win.visible = true


func _save_progress(next_level: int) -> void:
	var cf := ConfigFile.new(); cf.load(SAVE_PATH)
	cf.set_value("progress", "level", maxi(next_level, int(cf.get_value("progress", "level", 0))))
	cf.save(SAVE_PATH)


func _load_progress() -> int:
	var cf := ConfigFile.new()
	if cf.load(SAVE_PATH) != OK: return 0
	return int(cf.get_value("progress", "level", 0))
