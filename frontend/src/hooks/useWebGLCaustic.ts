import { useEffect, useRef } from "react";

interface UseWebGLCausticOptions {
  heightField: number[][] | null;
  n: number;
  thickness: number;
  projDist: number;
  physicalSizeX: number;
  physicalSizeY: number;
}

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;

uniform sampler2D u_heightField;
uniform float u_maxHeight;
uniform float u_alpha_x;   // L*(n-1)/Sx²
uniform float u_alpha_y;   // L*(n-1)/Sy²
uniform float u_resolution;

varying vec2 v_uv;

float sampleH(vec2 uv) {
  return texture2D(u_heightField, clamp(uv, 0.0, 1.0)).r * u_maxHeight;
}

void main() {
  float px = 1.0 / u_resolution;

  float hC = sampleH(v_uv);
  float hL = sampleH(v_uv - vec2(px, 0.0));
  float hR = sampleH(v_uv + vec2(px, 0.0));
  float hD = sampleH(v_uv - vec2(0.0, px));
  float hU = sampleH(v_uv + vec2(0.0, px));

  float h_uu = (hL + hR - 2.0 * hC) / (px * px);
  float h_vv = (hD + hU - 2.0 * hC) / (px * px);

  float J = 1.0 + u_alpha_x * h_uu + u_alpha_y * h_vv;
  J = clamp(J, 0.02, 50.0);

  float out_val = clamp((1.0 / J) * 0.4, 0.0, 1.0);
  gl_FragColor = vec4(vec3(out_val), 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const prog = gl.createProgram();
  if (!prog) throw new Error("Failed to create program");
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

/**
 * WebGL caustic preview using the gather-based fragment shader.
 * Returns a ref to attach to the <canvas> element.
 */
export function useWebGLCaustic({ heightField, n, thickness, projDist, physicalSizeX, physicalSizeY }: UseWebGLCausticOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heightField || heightField.length === 0) return;

    const gl = canvas.getContext("webgl");
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }

    let prog: WebGLProgram;
    try {
      prog = buildProgram(gl);
    } catch (e) {
      console.error("WebGL shader error:", e);
      return;
    }

    const ny = heightField.length;
    const nx = heightField[0].length;
    const resolution = Math.max(nx, ny);

    // Resize canvas buffer to match physical aspect ratio
    const maxRes = 512;
    const aspect = physicalSizeX / physicalSizeY;
    if (aspect >= 1) {
      canvas.width = maxRes;
      canvas.height = Math.max(1, Math.round(maxRes / aspect));
    } else {
      canvas.height = maxRes;
      canvas.width = Math.max(1, Math.round(maxRes * aspect));
    }

    // Find max height for normalization
    let maxH = 0;
    for (const row of heightField) {
      for (const v of row) {
        if (v > maxH) maxH = v;
      }
    }
    if (maxH < 1e-12) maxH = 1.0;

    // Upload height field as R32 texture (float)
    // WebGL 1.0 doesn't support R32F without extensions, use RGBA8 with packing
    // Store normalized h in red channel of RGBA UNSIGNED_BYTE texture
    const texData = new Uint8Array(nx * ny * 4);
    for (let i = 0; i < ny; i++) {
      for (let j = 0; j < nx; j++) {
        const idx = (i * nx + j) * 4;
        const normalized = heightField[i][j] / maxH;
        texData[idx] = Math.round(normalized * 255);   // R
        texData[idx + 1] = 0;
        texData[idx + 2] = 0;
        texData[idx + 3] = 255;
      }
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nx, ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Full-screen quad
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    gl.useProgram(prog);

    const aPosLoc = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    const alphaX = (projDist * (n - 1.0)) / (physicalSizeX * physicalSizeX);
    const alphaY = (projDist * (n - 1.0)) / (physicalSizeY * physicalSizeY);

    gl.uniform1i(gl.getUniformLocation(prog, "u_heightField"), 0);
    gl.uniform1f(gl.getUniformLocation(prog, "u_maxHeight"), maxH);
    gl.uniform1f(gl.getUniformLocation(prog, "u_alpha_x"), alphaX);
    gl.uniform1f(gl.getUniformLocation(prog, "u_alpha_y"), alphaY);
    gl.uniform1f(gl.getUniformLocation(prog, "u_resolution"), resolution);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return () => {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [heightField, n, thickness, projDist, physicalSizeX, physicalSizeY]);

  return canvasRef;
}
