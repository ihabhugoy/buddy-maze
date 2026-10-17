class_name Chars
extends RefCounted
## The playable characters: Buddy and the four animals, exported from the web game with their arms already posed.
## make() returns a node standing on y = 0, facing +X, `height` tall, with the walk shader on every mesh.

const LIST := [
	{ "id": "buddy", "name": "Buddy", "world": -1 },
	{ "id": "frog", "name": "Frog", "world": 0 },
	{ "id": "fennec", "name": "Fennec", "world": 1 },
	{ "id": "bear", "name": "Polar Bear", "world": 2 },
	{ "id": "cat", "name": "Cat", "world": 3 },
]
static var _meta := {}


static func meta(id: String) -> Dictionary:
	if _meta.is_empty():
		_meta = JSON.parse_string(FileAccess.get_file_as_string("res://assets/baked/chars.json"))
	return _meta.get(id, {})


## { "node": Node3D, "mats": [ShaderMaterial] }
static func make(id: String, height: float, skin := 0) -> Dictionary:
	var root := Node3D.new()
	var scn: Node3D = load("res://assets/baked/char_%s.glb" % id).instantiate()
	root.add_child(scn)
	var m := meta(id)
	var shader: Shader = preload("res://scripts/walk.gdshader")
	var mats: Array[ShaderMaterial] = []
	var box := AABB(); var first := true
	for node in scn.find_children("*", "MeshInstance3D", true, false):
		var mi := node as MeshInstance3D
		var src := mi.mesh.surface_get_material(0) as BaseMaterial3D
		var sm := ShaderMaterial.new(); sm.shader = shader
		if src and src.albedo_texture: sm.set_shader_parameter("albedo_tex", src.albedo_texture)
		for p in ["hip", "sho", "drop", "top", "bot", "neck", "len", "baked", "ears"]:
			if m.has(p) and m[p] != null: sm.set_shader_parameter(p, float(m[p]))
		if m.has("armZ"): sm.set_shader_parameter("armz", float(m.armZ))
		if id == "buddy" and skin > 0:
			sm.set_shader_parameter("tint", Color(UiTheme.SKINS[skin])); sm.set_shader_parameter("tint_on", 1.0)
		mi.material_override = sm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		mats.append(sm)
		var b: AABB = _local_xform(mi, scn) * mi.get_aabb()
		box = b if first else box.merge(b); first = false
	var s := height / box.size.y
	scn.scale = Vector3.ONE * s
	scn.position = Vector3(-(box.position.x + box.size.x / 2) * s, -box.position.y * s, -(box.position.z + box.size.z / 2) * s)
	return { "node": root, "mats": mats }


static func _local_xform(n: Node3D, top: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	var c: Node = n
	while c and c != top:
		if c is Node3D: t = (c as Node3D).transform * t
		c = c.get_parent()
	return t


static func set_skin(mats: Array, id: String, skin: int) -> void:
	for sm in mats:
		sm.set_shader_parameter("tint", Color(UiTheme.SKINS[skin]))
		sm.set_shader_parameter("tint_on", 1.0 if id == "buddy" and skin > 0 else 0.0)
