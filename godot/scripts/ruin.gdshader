// ruins around the maze: their own (world-recolored) texture, fading into the floor color near the ground
shader_type spatial;
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap;
uniform vec3 haze : source_color = vec3(0.96, 0.94, 0.9);
uniform float floor_y = -0.2;
uniform float haze_top = 1.0;
varying float wy;
void vertex() { wy = (MODEL_MATRIX * vec4(VERTEX, 1.0)).y; }
void fragment() {
	vec3 c = texture(albedo_tex, UV).rgb;
	ALBEDO = mix(haze, c, smoothstep(0.0, haze_top, wy - floor_y));
	ROUGHNESS = 0.92;
	SPECULAR = 0.25;
}
