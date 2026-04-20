// Caustic forward simulation — WebGL fragment shader
// Renders the caustic pattern produced by a lens height field on a projection screen.
//
// Strategy: for each output screen pixel, accumulate contributions from nearby
// lens grid cells whose deflected rays land near this pixel.
// This is a gather pass: for each output pixel P, iterate over a neighborhood
// of lens texels and check if their deflected ray hits near P.
//
// Uniform layout:
//   u_heightField  — sampler2D, R32F, height field (normalized [0,1])
//   u_maxHeight    — actual max height in meters
//   u_n            — refractive index
//   u_thickness    — lens thickness (meters)
//   u_projDist     — projection distance (meters)
//   u_resolution   — height field texture resolution (float)

precision highp float;

uniform sampler2D u_heightField;
uniform float u_maxHeight;
uniform float u_n;
uniform float u_thickness;
uniform float u_projDist;
uniform float u_resolution;

varying vec2 v_uv;  // screen UV in [0,1]²

// Bilinear sample of height field
float sampleH(vec2 uv) {
    return texture2D(u_heightField, uv).r * u_maxHeight;
}

// Central-difference gradient of h at uv
vec2 gradH(vec2 uv) {
    float px = 1.0 / u_resolution;                    // one texel step
    float dhdx = (sampleH(uv + vec2(px, 0.0)) - sampleH(uv - vec2(px, 0.0))) / (2.0 * px);
    float dhdy = (sampleH(uv + vec2(0.0, px)) - sampleH(uv - vec2(0.0, px))) / (2.0 * px);
    return vec2(dhdx, dhdy);
}

void main() {
    float px = 1.0 / u_resolution;
    float prefactor = (u_n - 1.0) * u_thickness;     // (n-1)*d
    float alpha = u_projDist * prefactor;             // L*(n-1)*d

    float energy = 0.0;

    // Gather: iterate over local neighbourhood of lens cells
    // Each lens cell at uv_lens deflects to screen position:
    //   screen_pos = uv_lens + alpha * gradH(uv_lens)
    // We check if screen_pos is close to this fragment's v_uv.
    //
    // Use a 5×5 grid search around the inverse-mapped lens position.
    // Approximate inverse: uv_lens_guess = v_uv - alpha * gradH(v_uv)

    // Coarse inverse: start at current pixel's UV, subtract deflection
    vec2 grad0 = gradH(v_uv);
    vec2 uv_center = v_uv - alpha * grad0;            // initial guess for source in lens

    // Search radius: 3 texels in each direction
    int R = 3;
    for (int di = -3; di <= 3; di++) {
        for (int dj = -3; dj <= 3; dj++) {
            vec2 uv_lens = uv_center + vec2(float(dj), float(di)) * px;

            // Skip out-of-bounds lens cells
            if (uv_lens.x < 0.0 || uv_lens.x > 1.0 || uv_lens.y < 0.0 || uv_lens.y > 1.0)
                continue;

            // Where does this lens cell deflect to on screen?
            vec2 g = gradH(uv_lens);
            vec2 screen_hit = uv_lens + alpha * g;    // Φ(uv_lens)

            // Distance from screen_hit to this fragment
            vec2 diff = screen_hit - v_uv;
            float dist2 = dot(diff, diff);

            // Gaussian splat: σ = 1.2 texels in output space
            float sigma = 1.5 * px;
            float sigma2 = sigma * sigma;
            energy += exp(-dist2 / (2.0 * sigma2));  // gaussian kernel
        }
    }

    // Jacobian of transport at this lens center (for energy normalization)
    // J ≈ 1 + alpha * Laplacian(h)
    // We approximate Laplacian at uv_center from gradient samples
    vec2 gx_plus  = gradH(uv_center + vec2(px, 0.0));
    vec2 gx_minus = gradH(uv_center - vec2(px, 0.0));
    vec2 gy_plus  = gradH(uv_center + vec2(0.0, px));
    vec2 gy_minus = gradH(uv_center - vec2(0.0, px));
    float laplacian = (gx_plus.x - gx_minus.x + gy_plus.y - gy_minus.y) / (2.0 * px);

    // Tone-map: scale by accumulation count for consistent brightness
    float norm_energy = energy / float((2 * R + 1) * (2 * R + 1));

    // Output: grayscale caustic
    gl_FragColor = vec4(vec3(norm_energy), 1.0);
}
