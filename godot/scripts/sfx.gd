extends Node
## Sounds: pools of recorded variations (footsteps, stones rising and settling), soft UI sounds and the music.

const POOLS := {
	"rise": [["s03", 3], ["s09", 3], ["s01", 1], ["s02", 1], ["s04", 1], ["s05", 1]],
	"land": [["s10", 3], ["s11", 3], ["s06", 1], ["s07", 1]],
	"bump": [["bump", 1]],
}
var streams := {}
var players: Array[AudioStreamPlayer] = []
var next := 0
var music_player: AudioStreamPlayer
var vol_music := 0.5
var vol_fx := 0.8
var muted := false


func _ready() -> void:
	var steps := []
	for i in range(1, 22): steps.append(["f%02d" % i, 1])
	var pools := POOLS.duplicate(); pools["step"] = steps
	for k in pools:
		var list := []
		for e in pools[k]:
			var path := "res://assets/sfx/%s.wav" % e[0]
			if ResourceLoader.exists(path):
				for w in e[1]: list.append(load(path))
		streams[k] = list
	for u in ["pop", "chime", "hover", "modal", "toggle", "whoosh"]:
		var p := "res://assets/sfx/ui_%s.wav" % u
		if ResourceLoader.exists(p): streams["ui_" + u] = [load(p)]
	for i in 10:
		var a := AudioStreamPlayer.new(); add_child(a); players.append(a)


func play(kind: String, vol := 0.6) -> void:
	var list: Array = streams.get(kind, [])
	if list.is_empty(): return
	var a := players[next]; next = (next + 1) % players.size()
	a.stream = list[randi() % list.size()]
	a.volume_db = linear_to_db(maxf(0.0001, vol * vol_fx * (0.0 if muted else 1.0)))
	a.pitch_scale = randf_range(0.94, 1.06)
	a.play()


func ui(kind: String, vol := 0.4) -> void:
	play("ui_" + kind, vol)


func music() -> void:
	if music_player: return
	var m: AudioStream = load("res://assets/music/cozy.mp3")
	if m is AudioStreamMP3: (m as AudioStreamMP3).loop = true
	music_player = AudioStreamPlayer.new(); music_player.stream = m; music_player.volume_db = _music_db()
	add_child(music_player); music_player.play()


func _music_db() -> float:
	return linear_to_db(maxf(0.0001, 0.36 * vol_music * (0.0 if muted else 1.0)))


func set_volumes(music_v: float, fx_v: float, mute: bool) -> void:
	vol_music = music_v; vol_fx = fx_v; muted = mute
	if music_player: music_player.volume_db = _music_db()
