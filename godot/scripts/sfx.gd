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
	a.volume_db = linear_to_db(vol)
	a.pitch_scale = randf_range(0.94, 1.06)
	a.play()


func ui(kind: String, vol := 0.4) -> void:
	play("ui_" + kind, vol)


func music() -> void:
	if music_player: return
	var m: AudioStream = load("res://assets/music/cozy.mp3")
	if m is AudioStreamMP3: (m as AudioStreamMP3).loop = true
	music_player = AudioStreamPlayer.new(); music_player.stream = m; music_player.volume_db = linear_to_db(0.18)
	add_child(music_player); music_player.play()
