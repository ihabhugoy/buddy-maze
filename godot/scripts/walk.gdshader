// Procedural walk, ported from the web game's addWalk: the models have no skeleton, so legs and arms swing here.
// Model space: height -0.5..0.5, facing +X, legs and arms split along Z. Animals have their arms posed down already
// (baked), with the arm weight in the red vertex color (0.5 = body); Buddy's arms are found by position.
shader_type spatial;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform float phase = 0.0;
uniform float amp = 0.0;
uniform float hurt = 0.0;
uniform float hip = -0.28;
uniform float sho = 0.03;
uniform float armz = 0.14;
uniform float drop = 0.28;
uniform float top = 0.08;
uniform float bot = -0.36;
uniform float neck = 0.06;
uniform float len = 0.36;
uniform float baked = 0.0;
uniform float ears = 0.0;
uniform vec3 tint : source_color = vec3(0.36, 0.42, 0.25);
uniform float tint_on = 0.0;
uniform float rim = 1.0;

vec2 rot2(vec2 p, float a) { return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); }

void vertex() {
	float sw = sin(phase) * amp;
	vec3 q = VERTEX;
	// legs: pivot at the hip, opposite legs swing opposite ways
	float wl = smoothstep(hip + 0.03, hip - 0.05, q.y) * clamp(q.z / 0.04, -1.0, 1.0);
	q.xy = rot2(q.xy - vec2(0.0, hip), 0.6 * sw * wl) + vec2(0.0, hip);
	if (ears > 0.5) { // ears and head trail a little behind when walking, and bob on each step
		float ear = smoothstep(neck + 0.1, neck + 0.32, q.y);
		q.x -= 0.035 * amp * ear; q.z += sin(phase * 2.0 - 1.1) * 0.022 * amp * ear;
	}
	float side; float wa;
	if (baked > 0.5) { float a = COLOR.r * 2.0 - 1.0; side = sign(a + q.z * 1e-4); wa = abs(a); }
	else { side = sign(q.z); wa = smoothstep(armz - 0.015, armz + 0.02, abs(q.z)) * smoothstep(top, top - 0.07, q.y) * step(bot, q.y); }
	vec2 yz = rot2(vec2(q.y - sho, abs(q.z) - armz), (drop - 1.2 * hurt) * wa);
	q.y = yz.x + sho; q.z = side * (yz.y + armz);
	float along = clamp((sho - q.y) / len, 0.0, 1.0); // 0 at the shoulder, 1 at the hand
	float wig = sin(phase * 2.0 - along * 2.6) * along * amp;
	q.xy = rot2(q.xy - vec2(0.0, sho), (-0.85 * sw * side - 0.45 * wig) * wa) + vec2(0.0, sho);
	VERTEX = q;
}

void fragment() {
	vec3 c = texture(albedo_tex, UV).rgb;
	// outfit color: the olive hood and jacket pixels are recolored (hue ~0.2, saturated), keeping their shading
	float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn, hue = 0.0;
	if (d > 1e-4) {
		if (mx == c.r) hue = mod((c.g - c.b) / d, 6.0);
		else if (mx == c.g) hue = (c.b - c.r) / d + 2.0;
		else hue = (c.r - c.g) / d + 4.0;
		hue /= 6.0;
	}
	float sat = d / max(mx, 1e-4);
	float m = smoothstep(0.075, 0.035, abs(hue - 0.2)) * smoothstep(0.25, 0.45, sat) * tint_on;
	float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
	ALBEDO = mix(c, tint * clamp(lum / 0.16, 0.0, 1.4), m);
	// warm rim light so the character pops off the stone
	EMISSION = vec3(1.0, 0.78, 0.5) * pow(1.0 - max(dot(NORMAL, VIEW), 0.0), 2.5) * 0.4 * rim;
	ROUGHNESS = 0.78;
	METALLIC = 0.0;
	SPECULAR = 0.3;
}
