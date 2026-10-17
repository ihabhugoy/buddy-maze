// the ground around the maze: this world's grass/sand/snow texture, tiled in world space, faded out by a soft mask
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back;
uniform sampler2D ground : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D mask : filter_linear, repeat_disable;
uniform float size = 20.0;
uniform float strength = 0.85;
varying vec3 wp;
void vertex() { wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	ALBEDO = texture(ground, wp.xz / 4.5).rgb;
	ALPHA = smoothstep(0.03, 0.65, texture(mask, UV).r) * strength;
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
}
