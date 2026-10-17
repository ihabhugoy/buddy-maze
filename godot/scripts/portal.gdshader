// The portal's swirl: asleep it's the color of stone; with the key it wakes up and spins (from the web game)
shader_type spatial;
render_mode unshaded, cull_disabled, blend_mix, depth_draw_never;
uniform float time = 0.0;
uniform float on = 0.0;
uniform vec3 ca : source_color = vec3(0.79, 0.93, 0.78);
uniform vec3 cb : source_color = vec3(1.0, 0.97, 0.86);
uniform vec3 cc : source_color = vec3(0.62, 0.84, 0.74);
uniform vec3 rock : source_color = vec3(0.62, 0.58, 0.52);
void fragment() {
	vec2 sz = vec2(0.42, 0.72), q = abs(UV - 0.5) * sz - (sz * 0.5 - 0.1);
	float d = length(max(q, 0.0)) - 0.1, a = smoothstep(0.008, -0.008, d);
	vec2 p = (UV - vec2(0.5, 0.45)) * sz; float r = length(p), ang = atan(p.y, p.x);
	float spin = time * (0.4 + 1.8 * on);
	float s = 0.5 + 0.5 * sin(ang * 2.0 + r * 22.0 - spin * 2.0);
	vec3 col = mix(ca, cc, s);
	col = mix(col, cb, smoothstep(0.5, 1.0, sin(ang * 3.0 - r * 16.0 + spin * 1.4)) * 0.6);
	col += cb * exp(-r * r * 70.0) * (0.3 + 0.7 * on);
	ALBEDO = mix(rock * (0.62 + 0.1 * s), col, on);
	ALPHA = a * (0.92 + 0.08 * on);
}
