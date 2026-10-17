extends Node3D
## The menus' character: standing on a soft contact shadow in the middle of the screen, swaying gently, and
## turning when you drag sideways (the web game's menu "face" renderer)

var holder: Node3D
var model: Node3D
var mats: Array = []
var id := "buddy"
var spin := 0.0
var spin_want := 0.0
var _t := 0.0
var still := false


func _ready() -> void:
	for d in [[Vector3(-2, 3, 4), Color("#fff1dc"), 1.25], [Vector3(3, 1, 3), Color("#eaf6dc"), 0.35], [Vector3(2, 3, -3), Color.WHITE, 0.9]]:
		var l := DirectionalLight3D.new(); l.light_color = d[1]; l.light_energy = d[2]
		add_child(l); l.look_at_from_position(d[0], Vector3.ZERO, Vector3.UP)
	var sh := MeshInstance3D.new(); var qm := QuadMesh.new(); qm.size = Vector2(0.62, 0.48); qm.orientation = PlaneMesh.FACE_Y; sh.mesh = qm
	var g := GradientTexture2D.new(); g.fill = GradientTexture2D.FILL_RADIAL; g.fill_from = Vector2(0.5, 0.5); g.fill_to = Vector2(0.5, 0.0)
	var gr := Gradient.new(); gr.set_color(0, Color(0.39, 0.27, 0.14, 0.5)); gr.add_point(0.45, Color(0.39, 0.27, 0.14, 0.22)); gr.set_color(gr.get_point_count() - 1, Color(0.39, 0.27, 0.14, 0)); g.gradient = gr
	var m := StandardMaterial3D.new(); m.albedo_texture = g; m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA; m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sh.material_override = m; sh.position.y = 0.002; add_child(sh)
	holder = Node3D.new(); add_child(holder)


func show_char(char_id: String, skin: int) -> void:
	id = char_id
	if model: model.queue_free()
	var c := Chars.make(char_id, 1.0, skin)
	model = c.node; mats = c.mats
	model.rotation.y = -PI / 2 # the model faces +X; turn it to face the camera
	holder.add_child(model)
	spin = 0.0; spin_want = 0.0


func set_skin(skin: int) -> void:
	Chars.set_skin(mats, id, skin)


func frame(cam: Camera3D, low := false) -> void:
	cam.fov = 24.0
	var vp := get_viewport().get_visible_rect().size
	var aspect := vp.x / maxf(1.0, vp.y)
	var fit := maxf(0.95 / 0.2126, 0.62 / (0.2126 * aspect)) * (1.15 if low else 1.0)
	cam.position = global_position + Vector3(0, 0.9, fit)
	cam.look_at(global_position + Vector3(0, 0.78 if low else 0.62, 0), Vector3.UP)


func tick(dt: float) -> void:
	_t += dt
	spin = lerpf(spin, spin_want, minf(1.0, dt * 8))
	holder.rotation.y = spin
	holder.rotation.z = 0.0 if still else sin(_t * 1.4) * 0.025 # a gentle sway from the feet
	var sq := 1.0 if still else 1.0 + sin(_t * 3.0) * 0.006
	holder.scale = Vector3(1.0 / sqrt(sq), sq, 1.0 / sqrt(sq))
