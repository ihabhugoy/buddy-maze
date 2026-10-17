class_name UiTheme
extends RefCounted
## The cozy look of the web game: cream cards with a warm edge and a soft lip, candy buttons, Bagel Fat One titles

const CREAM := Color("#fff8ec")
const PAPER := Color("#fbf0dd")
const CARD := Color("#fffcf6")
const EDGE := Color("#f2e3c9")
const LIP := Color("#ead7b6")
const WELL := Color("#f8eedd")
const INK := Color("#5b4535")
const INK_SOFT := Color("#a48b72")
const LEAF := Color("#6cc15a")
const LEAF_LIP := Color("#4fa343")
const HONEY := Color("#ffc64a")
const HONEY_LIP := Color("#e9a21e")
const SKY := Color("#6dbef0")
const SKY_LIP := Color("#4c9fd6")
const CORAL := Color("#ff8c6b")
const BERRY := Color("#f27ba6")
const LILAC := Color("#9c84ee")
const SKINS := ["#5d6b3f", "#2f6fe0", "#e2453a", "#ff8a1f", "#ff5fa8", "#8a55e0", "#ffd23f", "#1fb5a5", "#f4f1ea"]

static var title_font: Font = preload("res://assets/fonts/BagelFatOne.ttf")
static var body_font: FontVariation


static func body() -> Font:
	if body_font == null:
		body_font = FontVariation.new(); body_font.base_font = preload("res://assets/fonts/Nunito.ttf")
		body_font.variation_opentype = { TextServerManager.get_primary_interface().name_to_tag("wght"): 850 }
	return body_font


static func card(radius := 28, bg := CARD, lip := 7) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg; s.set_corner_radius_all(radius)
	s.border_color = EDGE; s.set_border_width_all(3); s.border_width_bottom = 3 + lip
	s.shadow_color = Color(0.43, 0.28, 0.12, 0.16); s.shadow_size = 16; s.shadow_offset = Vector2(0, 8)
	s.content_margin_left = 22; s.content_margin_right = 22; s.content_margin_top = 18; s.content_margin_bottom = 18 + lip
	return s


static func candy(color: Color, lip_color: Color, radius := 22, pressed := false) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = color; s.set_corner_radius_all(radius)
	s.border_color = lip_color; s.border_width_bottom = 3 if pressed else 7
	s.shadow_color = Color(0.43, 0.28, 0.12, 0.14); s.shadow_size = 8; s.shadow_offset = Vector2(0, 3)
	s.content_margin_left = 18; s.content_margin_right = 18; s.content_margin_top = 12 + (4 if pressed else 0); s.content_margin_bottom = 14
	return s


static func style_button(b: Button, color: Color, lip_color: Color, text_color := Color.WHITE, size := 24, radius := 22) -> Button:
	b.add_theme_stylebox_override("normal", candy(color, lip_color, radius))
	b.add_theme_stylebox_override("hover", candy(color.lightened(0.06), lip_color, radius))
	b.add_theme_stylebox_override("pressed", candy(color.darkened(0.04), lip_color, radius, true))
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.add_theme_font_override("font", body()); b.add_theme_font_size_override("font_size", size)
	for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]: b.add_theme_color_override(k, text_color)
	b.add_theme_constant_override("h_separation", 12)
	return b


static func label(text: String, size := 20, color := INK, title := false) -> Label:
	var l := Label.new(); l.text = text
	l.add_theme_font_override("font", title_font if title else body())
	l.add_theme_font_size_override("font_size", size); l.add_theme_color_override("font_color", color)
	return l


static func sticker_title(text: String, size := 64, color := LEAF) -> Label:
	var l := label(text, size, color, true)
	l.add_theme_color_override("font_outline_color", Color.WHITE); l.add_theme_constant_override("outline_size", int(size * 0.18))
	l.add_theme_color_override("font_shadow_color", Color(0.43, 0.28, 0.12, 0.22)); l.add_theme_constant_override("shadow_offset_y", int(size * 0.09))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return l


static func icon(name: String, size := 26, color := Color.WHITE) -> TextureRect:
	var t := TextureRect.new(); t.texture = load("res://assets/icons/%s.svg" % name)
	t.custom_minimum_size = Vector2(size, size); t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE; t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	t.modulate = color; t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return t
