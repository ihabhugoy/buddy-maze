class_name Save
extends RefCounted
## Progress and settings, kept on the device (stars per level, character, outfit color, volumes)

const PATH := "user://save.cfg"
static var cf: ConfigFile


static func _cfg() -> ConfigFile:
	if cf == null:
		cf = ConfigFile.new(); cf.load(PATH)
	return cf


static func stars(L: int) -> int:
	return int(_cfg().get_value("stars", str(L), 0))


static func set_stars(L: int, s: int) -> void:
	if s > stars(L):
		_cfg().set_value("stars", str(L), s); _cfg().save(PATH)


static func total_stars() -> int:
	var t := 0
	for k in _cfg().get_section_keys("stars") if _cfg().has_section("stars") else []: t += int(_cfg().get_value("stars", k))
	return t


static func next_level() -> int:
	for L in Maze.WORLDS.size() * Maze.LEVELS_PER_WORLD:
		if stars(L) == 0: return L
	return Maze.WORLDS.size() * Maze.LEVELS_PER_WORLD - 1


static func get_opt(key: String, def):
	return _cfg().get_value("opts", key, def)


static func set_opt(key: String, v) -> void:
	_cfg().set_value("opts", key, v); _cfg().save(PATH)
