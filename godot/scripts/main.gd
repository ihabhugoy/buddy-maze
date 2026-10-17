extends Node3D
## Buddy, the Godot remake: the screens (title, map, outfit, settings, help, pause, win) around the playing field.

const T = preload("res://scripts/ui_theme.gd")
const STAGE_POS := Vector3(0, 0, 400)    # the menus' character stands far from the maze

var cam: Camera3D
var env: Environment
var world: Node3D
var stage: Node3D
var sfx: Node
var ui: CanvasLayer
var bg_layer: CanvasLayer
var screens := {}
var state := ""
var back_from := "title"
var char_id := "buddy"
var skin := 0
var hud := {}
var win_ui := {}
var drag_x = null
var shot_path := ""
var shot_t := -1.0
var shot_state := ""
var auto_walk := false
var _auto_t := 0.0
var test_level := -1
var test_cave := false


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="): shot_path = a.substr(7); shot_t = 6.0
		if a.begins_with("--state="): shot_state = a.substr(8)
		if a == "--autowalk": auto_walk = true
		if a.begins_with("--level="): test_level = int(a.substr(8))
		if a == "--cave": test_cave = true
	char_id = str(Save.get_opt("char", "buddy")); skin = int(Save.get_opt("skin", 0))
	cam = Camera3D.new(); cam.near = 0.05; cam.far = 200.0; add_child(cam)
	var we := WorldEnvironment.new(); env = Environment.new()
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.tonemap_mode = Environment.TONE_MAPPER_ACES; env.tonemap_exposure = 0.95
	env.adjustment_enabled = true; env.adjustment_contrast = 1.06; env.adjustment_saturation = 1.08
	env.fog_enabled = true; env.fog_mode = Environment.FOG_MODE_DEPTH; env.fog_sun_scatter = 0.0
	env.background_canvas_max_layer = -1
	we.environment = env; add_child(we)
	sfx = preload("res://scripts/sfx.gd").new(); add_child(sfx)
	world = preload("res://scripts/world.gd").new(); add_child(world)
	world.char_id = char_id; world.skin = skin
	world.setup(cam, env, sfx)
	world.won.connect(_on_won)
	world.key_got.connect(func(): hud.key.modulate = Color(1, 1, 1, 1))
	world.steps_changed.connect(func(n): hud.steps.text = str(n))
	stage = preload("res://scripts/stage.gd").new(); add_child(stage); stage.position = STAGE_POS
	stage.show_char(char_id, skin)
	_build_ui()
	_apply_volumes()
	sfx.music()
	if shot_state == "play":
		play_level(test_level if test_level >= 0 else Save.next_level())
		if test_cave: world.build_level(world.L, "cave", null, true)
	else: show_screen(shot_state if shot_state != "" else "title")


# ---------- screens ----------
func show_screen(name: String) -> void:
	state = name
	for k in screens: screens[k].visible = k == name or (k == "hud" and name in ["play", "pause", "win"])
	var menu: bool = name in ["title", "outfit", "settings", "help", "worlds"]
	world.visible = not menu
	world.playing = name == "play"
	stage.visible = menu and name != "worlds"
	stage.still = name == "outfit"
	bg_layer.visible = menu
	if menu:
		env.background_mode = Environment.BG_CANVAS
		env.fog_enabled = false
		env.ambient_light_color = Color("#fff3e2"); env.ambient_light_energy = 0.55
		stage.frame(cam, name == "outfit")
	else:
		env.fog_enabled = true
		world.apply_biome(world.biome if world.biome != "" else "woods")
	if name == "title": _refresh_title()
	if name == "worlds": _refresh_map()
	if name == "outfit": _refresh_outfit()


func play_level(L: int) -> void:
	if world.char_id != char_id or world.skin != skin: world.set_character(char_id, skin)
	world.build_level(L)
	var plan := Maze.level_plan(L)
	hud.level.text = "%d-%d" % [plan.world + 1, L % Maze.LEVELS_PER_WORLD + 1]
	hud.world_icon.texture = load("res://assets/icons/i-w-%s.svg" % Maze.WORLDS[plan.world].biome)
	hud.key.modulate = Color(1, 1, 1, 0.35)
	hud.steps.text = "0"
	show_screen("play")


func _on_won(stats: Dictionary) -> void:
	Save.set_stars(world.L, stats.stars)
	for i in 3: win_ui.stars[i].modulate = T.HONEY if i < stats.stars else Color(0.85, 0.8, 0.72)
	win_ui.steps.text = "%d steps" % stats.steps
	win_ui.time.text = _fmt(int(stats.time))
	win_ui.best.text = "best %d" % stats.best
	show_screen("win")


func _fmt(s: int) -> String:
	return "%d:%02d" % [s / 60, s % 60]


# ---------- building the interface ----------
func _build_ui() -> void:
	bg_layer = CanvasLayer.new(); bg_layer.layer = -1; add_child(bg_layer)
	var bg := TextureRect.new(); bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	var gt := GradientTexture2D.new(); gt.fill = GradientTexture2D.FILL_RADIAL; gt.fill_from = Vector2(0.5, 0.46); gt.fill_to = Vector2(1.1, 1.0)
	var gr := Gradient.new(); gr.set_color(0, Color("#fffaf1")); gr.add_point(0.55, Color("#fbf0dd")); gr.set_color(gr.get_point_count() - 1, Color("#f1dfc1")); gt.gradient = gr
	bg.texture = gt; bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE; bg.stretch_mode = TextureRect.STRETCH_SCALE
	bg_layer.add_child(bg)
	ui = CanvasLayer.new(); add_child(ui)
	screens.title = _title_screen()
	screens.hud = _hud()
	screens.pause = _modal("Paused", [["Resume", "i-play", T.LEAF, T.LEAF_LIP, func(): show_screen("play")],
		["Restart", "i-redo", T.SKY, T.SKY_LIP, func(): play_level(world.L)],
		["Map", "i-map", T.HONEY, T.HONEY_LIP, func(): show_screen("worlds")],
		["Settings", "i-sound", T.CARD, T.LIP, func(): back_from = "pause"; show_screen("settings")]])[0]
	screens.win = _win_screen()
	screens.worlds = _map_screen()
	screens.outfit = _outfit_screen()
	screens.settings = _settings_screen()
	screens.help = _help_screen()
	for k in screens: ui.add_child(screens[k])


func _full() -> Control:
	var c := Control.new(); c.set_anchors_preset(Control.PRESET_FULL_RECT); c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c


func _margin(child: Control, l := 18, t := 18, r := 18, b := 18) -> MarginContainer:
	var m := MarginContainer.new(); m.set_anchors_preset(Control.PRESET_FULL_RECT); m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for k in [["left", l], ["top", t], ["right", r], ["bottom", b]]: m.add_theme_constant_override("margin_" + k[0], k[1])
	m.add_child(child)
	return m


func _round(icon: String, cb: Callable, size := 58) -> Button:
	var b := Button.new(); b.custom_minimum_size = Vector2(size, size)
	T.style_button(b, T.CARD, T.LIP, T.INK, 20, 18)
	var ic := T.icon(icon, int(size * 0.42), T.INK_SOFT)
	ic.set_anchors_preset(Control.PRESET_FULL_RECT)
	b.add_child(ic)
	b.pressed.connect(func(): sfx.ui("pop", 0.3); cb.call())
	return b


func _chip(icon: String, text: String, icon_color := T.HONEY) -> Array:
	var p := PanelContainer.new(); p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new(); sb.bg_color = T.CARD; sb.set_corner_radius_all(999); sb.border_color = T.EDGE; sb.set_border_width_all(2); sb.border_width_bottom = 5
	sb.content_margin_left = 8; sb.content_margin_right = 16; sb.content_margin_top = 6; sb.content_margin_bottom = 9
	sb.shadow_color = Color(0.43, 0.28, 0.12, 0.12); sb.shadow_size = 8
	p.add_theme_stylebox_override("panel", sb)
	var h := HBoxContainer.new(); h.add_theme_constant_override("separation", 8); p.add_child(h)
	var dot := PanelContainer.new(); var ds := StyleBoxFlat.new(); ds.bg_color = icon_color; ds.set_corner_radius_all(999)
	ds.content_margin_left = 6; ds.content_margin_right = 6; ds.content_margin_top = 6; ds.content_margin_bottom = 6
	dot.add_theme_stylebox_override("panel", ds)
	var ic := T.icon(icon, 20, Color("#6b4706") if icon_color == T.HONEY else Color.WHITE); dot.add_child(ic); h.add_child(dot)
	var l := T.label(text, 20); h.add_child(l)
	return [p, l, ic]


func _menu_button(text: String, sub: String, icon: String, color: Color, lip: Color, big: bool, cb: Callable) -> Array:
	var b := Button.new()
	if big: T.style_button(b, color, lip, Color.WHITE, 26, 24)
	else: T.style_button(b, T.CARD, T.LIP, T.INK, 19, 22)
	b.custom_minimum_size = Vector2(0, 76 if big else 66)
	var h := HBoxContainer.new(); h.set_anchors_preset(Control.PRESET_FULL_RECT); h.alignment = BoxContainer.ALIGNMENT_CENTER if big else BoxContainer.ALIGNMENT_BEGIN
	h.add_theme_constant_override("separation", 12); h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if not big:
		var pad := Control.new(); pad.custom_minimum_size = Vector2(4, 0); pad.mouse_filter = Control.MOUSE_FILTER_IGNORE; h.add_child(pad)
	var tile := PanelContainer.new(); tile.mouse_filter = Control.MOUSE_FILTER_IGNORE; tile.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var ts := StyleBoxFlat.new(); ts.bg_color = Color(1, 1, 1, 0.25) if big else color; ts.set_corner_radius_all(14)
	ts.content_margin_left = 9; ts.content_margin_right = 9; ts.content_margin_top = 9; ts.content_margin_bottom = 9
	tile.add_theme_stylebox_override("panel", ts); tile.add_child(T.icon(icon, 24)); h.add_child(tile)
	var v := VBoxContainer.new(); v.alignment = BoxContainer.ALIGNMENT_CENTER; v.add_theme_constant_override("separation", -2); v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var tl := T.label(text.to_upper(), 24 if big else 18, Color.WHITE if big else T.INK); tl.mouse_filter = Control.MOUSE_FILTER_IGNORE; v.add_child(tl)
	var sl: Label = null
	if sub != "":
		sl = T.label(sub.to_upper(), 13, Color(1, 1, 1, 0.85) if big else T.INK_SOFT); sl.mouse_filter = Control.MOUSE_FILTER_IGNORE; v.add_child(sl)
	h.add_child(v)
	b.add_child(h)
	b.pressed.connect(func(): sfx.ui("pop", 0.35); cb.call())
	return [b, sl]


var title_ui := {}
func _title_screen() -> Control:
	var root := _full()
	var col := VBoxContainer.new(); col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_margin(col, 16, 14, 16, 18))
	var top := HBoxContainer.new(); top.mouse_filter = Control.MOUSE_FILTER_IGNORE; top.add_theme_constant_override("separation", 10); col.add_child(top)
	var stars := _chip("i-star", "0"); top.add_child(stars[0]); title_ui.stars = stars[1]
	var sp := Control.new(); sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL; sp.mouse_filter = Control.MOUSE_FILTER_IGNORE; top.add_child(sp)
	top.add_child(_round("i-help", func(): back_from = "title"; show_screen("help")))
	top.add_child(_round("i-sound", func(): back_from = "title"; show_screen("settings")))
	var logo := T.sticker_title("Buddy", 92); logo.mouse_filter = Control.MOUSE_FILTER_IGNORE; col.add_child(logo)
	var pill := PanelContainer.new(); pill.size_flags_horizontal = Control.SIZE_SHRINK_CENTER; pill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ps := StyleBoxFlat.new(); ps.bg_color = Color(1, 0.99, 0.965, 0.85); ps.set_corner_radius_all(999)
	ps.content_margin_left = 20; ps.content_margin_right = 20; ps.content_margin_top = 5; ps.content_margin_bottom = 8
	pill.add_theme_stylebox_override("panel", ps)
	pill.add_child(T.label("REMEMBER THE WAY", 15, T.INK_SOFT)); col.add_child(pill)
	var grow := Control.new(); grow.size_flags_vertical = Control.SIZE_EXPAND_FILL; grow.mouse_filter = Control.MOUSE_FILTER_IGNORE; col.add_child(grow)
	# the menu: Race and Outfit stacked beside a tall Friends, a wide Adventure underneath
	var row := HBoxContainer.new(); row.add_theme_constant_override("separation", 10); row.mouse_filter = Control.MOUSE_FILTER_IGNORE; col.add_child(row)
	var left := VBoxContainer.new(); left.size_flags_horizontal = Control.SIZE_EXPAND_FILL; left.add_theme_constant_override("separation", 10); row.add_child(left)
	left.add_child(_menu_button("Race", "", "i-flag", T.CORAL, T.LIP, false, func(): _toast("Race is coming to this version next"))[0])
	left.add_child(_menu_button("Outfit", "", "i-shirt", T.LILAC, T.LIP, false, func(): show_screen("outfit"))[0])
	var friends: Button = _menu_button("Friends", "Play together", "i-heart", T.BERRY, T.BERRY.darkened(0.18), true, func(): _toast("Friends is coming to this version next"))[0]
	friends.size_flags_horizontal = Control.SIZE_EXPAND_FILL; row.add_child(friends)
	var sp2 := Control.new(); sp2.custom_minimum_size = Vector2(0, 10); sp2.mouse_filter = Control.MOUSE_FILTER_IGNORE; col.add_child(sp2)
	var adv := _menu_button("Adventure", "Level 1-1", "i-map", T.LEAF, T.LEAF_LIP, true, func(): show_screen("worlds"))
	adv[0].custom_minimum_size = Vector2(0, 84); col.add_child(adv[0]); title_ui.adv_sub = adv[1]
	return root


func _refresh_title() -> void:
	title_ui.stars.text = str(Save.total_stars())
	var n := Save.next_level()
	title_ui.adv_sub.text = "LEVEL %d-%d" % [n / Maze.LEVELS_PER_WORLD + 1, n % Maze.LEVELS_PER_WORLD + 1]


func _hud() -> Control:
	var root := _full()
	var top := HBoxContainer.new(); top.add_theme_constant_override("separation", 10); top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := _margin(top, 14, 14, 14, 14); root.add_child(m)
	top.add_child(_round("i-pause", func(): show_screen("pause"), 54))
	var lvl := _chip("i-w-woods", "1-1", T.LEAF); top.add_child(lvl[0]); hud.level = lvl[1]; hud.world_icon = lvl[2]
	var key := _chip("i-key", "Key"); top.add_child(key[0]); hud.key = key[0]
	var steps := _chip("i-steps", "0", T.SKY); top.add_child(steps[0]); hud.steps = steps[1]
	top.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	# zoom and peek, bottom right
	var br := VBoxContainer.new(); br.add_theme_constant_override("separation", 12)
	br.anchor_left = 1; br.anchor_top = 1; br.anchor_right = 1; br.anchor_bottom = 1
	br.offset_left = -76; br.offset_top = -150; br.offset_right = -16; br.offset_bottom = -20
	br.add_child(_round("i-zoom", func(): world.next_zoom(), 58))
	var peek := _round("i-eye", func(): pass, 58)
	peek.button_down.connect(func(): world.peek = true); peek.button_up.connect(func(): world.peek = false)
	br.add_child(peek)
	root.add_child(br)
	return root


## a centered card with a title and a column of buttons: returns [root, column]
func _modal(title: String, buttons: Array) -> Array:
	var root := _full(); root.mouse_filter = Control.MOUSE_FILTER_STOP
	var shade := ColorRect.new(); shade.color = Color(0.25, 0.17, 0.08, 0.28); shade.set_anchors_preset(Control.PRESET_FULL_RECT); root.add_child(shade)
	var center := CenterContainer.new(); center.set_anchors_preset(Control.PRESET_FULL_RECT); root.add_child(center)
	var card := PanelContainer.new(); card.add_theme_stylebox_override("panel", T.card()); card.custom_minimum_size = Vector2(330, 0); center.add_child(card)
	var v := VBoxContainer.new(); v.add_theme_constant_override("separation", 12); card.add_child(v)
	v.add_child(T.sticker_title(title, 46, T.LEAF))
	for b in buttons:
		var btn := Button.new(); btn.text = b[0]
		var dark: bool = b[2] == T.CARD
		T.style_button(btn, b[2], b[3], T.INK if dark else Color.WHITE, 22)
		btn.icon = load("res://assets/icons/%s.svg" % b[1]); btn.expand_icon = false; btn.add_theme_constant_override("icon_max_width", 26)
		if dark: btn.add_theme_color_override("icon_normal_color", T.INK_SOFT)
		btn.custom_minimum_size = Vector2(0, 58)
		var cb: Callable = b[4]
		btn.pressed.connect(func(): sfx.ui("pop", 0.3); cb.call())
		v.add_child(btn)
	return [root, v]


func _win_screen() -> Control:
	var r := _modal("Well done!", [["Next level", "i-next", T.LEAF, T.LEAF_LIP, func(): play_level(world.L + 1)],
		["Replay", "i-redo", T.CARD, T.LIP, func(): play_level(world.L)],
		["Map", "i-map", T.HONEY, T.HONEY_LIP, func(): show_screen("worlds")]])
	var v: VBoxContainer = r[1]
	var stars := HBoxContainer.new(); stars.alignment = BoxContainer.ALIGNMENT_CENTER; stars.add_theme_constant_override("separation", 6)
	win_ui.stars = []
	for i in 3:
		var s := T.icon("i-star", 56 if i == 1 else 46, T.HONEY); stars.add_child(s); win_ui.stars.append(s)
	v.add_child(stars); v.move_child(stars, 1)
	var chips := HBoxContainer.new(); chips.alignment = BoxContainer.ALIGNMENT_CENTER; chips.add_theme_constant_override("separation", 8)
	for c in [["i-steps", "steps", T.SKY], ["i-clock", "time", T.LILAC], ["i-flag", "best", T.CORAL]]:
		var ch := _chip(c[0], "", c[2]); (ch[1] as Label).add_theme_font_size_override("font_size", 16)
		chips.add_child(ch[0]); win_ui[c[1]] = ch[1]
	v.add_child(chips); v.move_child(chips, 2)
	return r[0]


## a page with a back button and a title: returns [root, column]
func _page(title: String, back := "title") -> Array:
	var root := _full()
	var col := VBoxContainer.new(); col.add_theme_constant_override("separation", 12); col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_margin(col, 16, 14, 16, 16))
	var head := HBoxContainer.new(); head.add_theme_constant_override("separation", 14); head.mouse_filter = Control.MOUSE_FILTER_IGNORE; col.add_child(head)
	head.add_child(_round("i-back", func(): show_screen(back_from if back == "" else back), 56))
	var t := T.sticker_title(title, 44, T.LEAF); t.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT; head.add_child(t)
	return [root, col]


func _map_screen() -> Control:
	var p := _page("Adventure"); var col: VBoxContainer = p[1]
	var scroll := ScrollContainer.new(); scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL; scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(scroll)
	var list := VBoxContainer.new(); list.size_flags_horizontal = Control.SIZE_EXPAND_FILL; list.add_theme_constant_override("separation", 14)
	scroll.add_child(list); map_list = list
	return p[0]
var map_list: VBoxContainer


func _refresh_map() -> void:
	for c in map_list.get_children(): c.queue_free()
	var colors := [T.LEAF, Color("#f2a53a"), Color("#58b4e8"), Color("#e8823a")]
	var nxt := Save.next_level()
	for w in Maze.WORLDS.size():
		var card := PanelContainer.new(); card.add_theme_stylebox_override("panel", T.card(26, T.CARD, 6)); map_list.add_child(card)
		var v := VBoxContainer.new(); v.add_theme_constant_override("separation", 10); card.add_child(v)
		var h := HBoxContainer.new(); h.add_theme_constant_override("separation", 10); v.add_child(h)
		var tile := PanelContainer.new(); var ts := StyleBoxFlat.new(); ts.bg_color = colors[w]; ts.set_corner_radius_all(14)
		ts.content_margin_left = 8; ts.content_margin_right = 8; ts.content_margin_top = 8; ts.content_margin_bottom = 8
		tile.add_theme_stylebox_override("panel", ts); tile.add_child(T.icon("i-w-" + Maze.WORLDS[w].biome, 28)); h.add_child(tile)
		h.add_child(T.label(Maze.WORLDS[w].name, 24, T.INK, true))
		var grid := GridContainer.new(); grid.columns = 5; grid.add_theme_constant_override("h_separation", 8); grid.add_theme_constant_override("v_separation", 8); v.add_child(grid)
		for k in Maze.LEVELS_PER_WORLD:
			var L := w * Maze.LEVELS_PER_WORLD + k
			var open := OS.is_debug_build() or L == 0 or Save.stars(L - 1) > 0
			var s := Save.stars(L)
			var b := Button.new(); b.custom_minimum_size = Vector2(54, 54); b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			b.text = str(k + 1) + ("  " + "★".repeat(s) if s > 0 else "")
			if L == nxt: T.style_button(b, T.LEAF, T.LEAF_LIP, Color.WHITE, 17, 16)
			elif s > 0: T.style_button(b, T.HONEY, T.HONEY_LIP, Color("#6b4706"), 15, 16)
			else: T.style_button(b, T.CARD if open else T.WELL, T.LIP, T.INK if open else T.INK_SOFT, 17, 16)
			b.disabled = not open
			b.pressed.connect(func(): sfx.ui("pop", 0.35); play_level(L))
			grid.add_child(b)


var outfit_ui := {}
func _outfit_screen() -> Control:
	var p := _page("Outfit"); var col: VBoxContainer = p[1]
	var grow := Control.new(); grow.size_flags_vertical = Control.SIZE_EXPAND_FILL; grow.mouse_filter = Control.MOUSE_FILTER_IGNORE; col.add_child(grow)
	var card := PanelContainer.new(); card.add_theme_stylebox_override("panel", T.card()); col.add_child(card)
	var v := VBoxContainer.new(); v.add_theme_constant_override("separation", 12); card.add_child(v)
	v.add_child(T.label("CHARACTERS", 16, T.INK_SOFT))
	var chars := HBoxContainer.new(); chars.add_theme_constant_override("separation", 8); v.add_child(chars)
	outfit_ui.chars = []
	for c in Chars.LIST:
		var b := Button.new(); b.text = c.name; b.custom_minimum_size = Vector2(0, 52); b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.set_meta("id", c.id); b.clip_text = true
		var cid: String = c.id
		b.pressed.connect(func(): _set_char(cid))
		chars.add_child(b); outfit_ui.chars.append(b)
	v.add_child(T.label("COLORS (BUDDY)", 16, T.INK_SOFT))
	var sw := HBoxContainer.new(); sw.add_theme_constant_override("separation", 8); v.add_child(sw); outfit_ui.skins = sw
	for i in T.SKINS.size():
		var b := Button.new(); b.custom_minimum_size = Vector2(0, 44); b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		T.style_button(b, Color(T.SKINS[i]), Color(T.SKINS[i]).darkened(0.25), Color.WHITE, 16, 14)
		var idx := i
		b.pressed.connect(func(): _set_skin(idx))
		sw.add_child(b)
	return p[0]


func _refresh_outfit() -> void:
	for b in outfit_ui.chars:
		var on: bool = b.get_meta("id") == char_id
		T.style_button(b, T.LEAF if on else T.CARD, T.LEAF_LIP if on else T.LIP, Color.WHITE if on else T.INK, 15, 16)
	outfit_ui.skins.modulate.a = 1.0 if char_id == "buddy" else 0.4
	for i in outfit_ui.skins.get_child_count():
		outfit_ui.skins.get_child(i).text = "✓" if i == skin else ""


func _set_char(id: String) -> void:
	char_id = id; Save.set_opt("char", id); sfx.ui("pop", 0.35)
	stage.show_char(id, skin); _refresh_outfit()


func _set_skin(i: int) -> void:
	if char_id != "buddy": return
	skin = i; Save.set_opt("skin", i); sfx.ui("toggle", 0.35)
	stage.set_skin(i); _refresh_outfit()


func _settings_screen() -> Control:
	var p := _page("Settings", ""); var col: VBoxContainer = p[1]
	var card := PanelContainer.new(); card.add_theme_stylebox_override("panel", T.card()); col.add_child(card)
	var v := VBoxContainer.new(); v.add_theme_constant_override("separation", 14); card.add_child(v)
	for s in [["Music", "music", 0.5], ["Effects", "fx", 0.8]]:
		var row := HBoxContainer.new(); row.add_theme_constant_override("separation", 12); v.add_child(row)
		var l := T.label(s[0], 20); l.custom_minimum_size = Vector2(110, 0); row.add_child(l)
		var sl := HSlider.new(); sl.min_value = 0; sl.max_value = 1; sl.step = 0.01; sl.value = float(Save.get_opt(s[1], s[2])); sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var key: String = s[1]
		sl.value_changed.connect(func(x): Save.set_opt(key, x); _apply_volumes())
		row.add_child(sl)
	for opt in [["Mute", "mute"], ["Fullscreen", "full"]]:
		if opt[1] == "full" and OS.has_feature("mobile"): continue
		var cb := CheckButton.new(); cb.text = opt[0]
		cb.add_theme_font_override("font", T.body()); cb.add_theme_font_size_override("font_size", 20); cb.add_theme_color_override("font_color", T.INK)
		if opt[1] == "mute":
			cb.button_pressed = bool(Save.get_opt("mute", false))
			cb.toggled.connect(func(on): Save.set_opt("mute", on); _apply_volumes())
		else:
			cb.toggled.connect(func(on): DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if on else DisplayServer.WINDOW_MODE_WINDOWED))
		v.add_child(cb)
	return p[0]


func _apply_volumes() -> void:
	sfx.set_volumes(float(Save.get_opt("music", 0.5)), float(Save.get_opt("fx", 0.8)), bool(Save.get_opt("mute", false)))


func _help_screen() -> Control:
	var p := _page("How to play", ""); var col: VBoxContainer = p[1]
	var card := PanelContainer.new(); card.add_theme_stylebox_override("panel", T.card()); col.add_child(card)
	var v := VBoxContainer.new(); v.add_theme_constant_override("separation", 12); card.add_child(v)
	for tip in [["i-steps", "Walk", "Swipe the way you want to go and keep your finger down to keep walking (or use the arrow keys)."],
		["i-eye", "The maze is hidden", "Walls only rise around you, then sink back down. Remember the way you came!"],
		["i-key", "Find the golden key", "It waits at the end of a side path somewhere in the maze."],
		["i-portal", "Then the portal", "With the key, the stone portal wakes up. Walk into it to finish the level."],
		["i-star", "Stars", "Fewer steps, more stars. Can you find the shortest way?"]]:
		var row := HBoxContainer.new(); row.add_theme_constant_override("separation", 12); v.add_child(row)
		var tile := PanelContainer.new(); var ts := StyleBoxFlat.new(); ts.bg_color = T.WELL; ts.set_corner_radius_all(14)
		ts.content_margin_left = 10; ts.content_margin_right = 10; ts.content_margin_top = 10; ts.content_margin_bottom = 10
		tile.add_theme_stylebox_override("panel", ts); tile.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tile.add_child(T.icon(tip[0], 26, T.LEAF)); row.add_child(tile)
		var tv := VBoxContainer.new(); tv.size_flags_horizontal = Control.SIZE_EXPAND_FILL; row.add_child(tv)
		tv.add_child(T.label(tip[1], 19))
		var d := T.label(tip[2], 15, T.INK_SOFT); d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART; tv.add_child(d)
	return p[0]


var _toast_box: PanelContainer
var _toast_label: Label
func _toast(text: String) -> void:
	if _toast_box == null:
		_toast_label = T.label("", 18, T.INK)
		_toast_box = PanelContainer.new(); var sb := StyleBoxFlat.new(); sb.bg_color = T.CARD; sb.set_corner_radius_all(999)
		sb.content_margin_left = 18; sb.content_margin_right = 18; sb.content_margin_top = 8; sb.content_margin_bottom = 10; sb.shadow_color = Color(0.4, 0.25, 0.1, 0.2); sb.shadow_size = 10
		_toast_box.add_theme_stylebox_override("panel", sb); _toast_box.add_child(_toast_label); _toast_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var c := CenterContainer.new(); c.anchor_right = 1; c.offset_top = 110; c.offset_bottom = 160; c.mouse_filter = Control.MOUSE_FILTER_IGNORE
		c.add_child(_toast_box); ui.add_child(c)
	_toast_label.text = text
	_toast_box.modulate.a = 1.0
	var tw := create_tween(); tw.tween_interval(1.6); tw.tween_property(_toast_box, "modulate:a", 0.0, 0.4)


# ---------- input and loop ----------
func _unhandled_input(e: InputEvent) -> void:
	if state == "play":
		if e is InputEventKey and e.pressed and (e as InputEventKey).keycode == KEY_ESCAPE:
			show_screen("pause"); return
		world.handle_input(e)
	elif state in ["title", "outfit"]: # drag sideways to spin the character
		if e is InputEventScreenTouch: drag_x = e.position.x if e.pressed else null
		elif e is InputEventScreenDrag and drag_x != null:
			stage.spin_want += (e.position.x - drag_x) * 0.012; drag_x = e.position.x
	elif state == "pause" and e is InputEventKey and e.pressed and (e as InputEventKey).keycode == KEY_ESCAPE:
		show_screen("play")


func _process(dt: float) -> void:
	dt = minf(dt, 1.0 / 20.0)
	if world.visible and not world.st.is_empty(): world.tick(dt)
	if stage.visible:
		stage.tick(dt); stage.frame(cam, state == "outfit")
	if auto_walk and state == "play":
		_auto_t += dt
		if _auto_t > 0.22:
			_auto_t = 0.0; world.try_move(Maze.DIRS[randi() % 4])
	if shot_t > 0.0:
		shot_t -= dt
		if shot_t <= 0.0:
			print("cam ", cam.global_position, " state ", state, " world ", world.visible, " bg ", env.background_mode, " N ", world.N)
			var img := get_viewport().get_texture().get_image(); img.convert(Image.FORMAT_RGB8); img.save_png(shot_path)
			print("shot saved ", shot_path, " fps ", Engine.get_frames_per_second())
			get_tree().quit()
