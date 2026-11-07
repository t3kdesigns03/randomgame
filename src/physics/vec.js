// Minimal 3D vector / matrix helpers for the physics sim.
// Physics world is Z-up, right-handed, units are Unreal units (1 uu = 1 cm),
// matching the Rocket League community docs. Car local frame: x forward, y left, z up.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const clone = (a) => ({ x: a.x, y: a.y, z: a.z });
export const set = (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const len2 = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
};
export const clampLen = (a, max) => {
  const l = len(a);
  return l > max ? scale(a, max / l) : a;
};
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Rotate vector v about unit axis k by angle (Rodrigues). */
export function rotateAxis(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return {
    x: v.x * c + kv.x * s + k.x * kd,
    y: v.y * c + kv.y * s + k.y * kd,
    z: v.z * c + kv.z * s + k.z * kd,
  };
}

/** Piecewise-linear curve lookup: pts = [[x0,y0],[x1,y1],...] sorted by x. */
export function curve(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
}

// ---- Orientation: stored as world-space basis vectors {f (forward), l (left), u (up)} ----

export const basisIdentity = () => ({ f: v3(1, 0, 0), l: v3(0, 1, 0), u: v3(0, 0, 1) });
export const toLocal = (R, v) => ({ x: dot(v, R.f), y: dot(v, R.l), z: dot(v, R.u) });
export const toWorld = (R, lv) => ({
  x: R.f.x * lv.x + R.l.x * lv.y + R.u.x * lv.z,
  y: R.f.y * lv.x + R.l.y * lv.y + R.u.y * lv.z,
  z: R.f.z * lv.x + R.l.z * lv.y + R.u.z * lv.z,
});

/** Re-orthonormalise a basis keeping forward as the primary axis. */
export function orthonormalize(R) {
  const f = norm(R.f);
  let u = sub(R.u, scale(f, dot(R.u, f)));
  u = norm(u);
  const l = cross(u, f);
  R.f = f; R.u = u; R.l = l;
  return R;
}

/** Integrate world-space angular velocity w over dt. */
export function integrateBasis(R, w, dt) {
  const wl = len(w);
  if (wl < 1e-9) return R;
  const k = scale(w, 1 / wl);
  const a = wl * dt;
  R.f = rotateAxis(R.f, k, a);
  R.l = rotateAxis(R.l, k, a);
  R.u = rotateAxis(R.u, k, a);
  return orthonormalize(R);
}

/** Basis whose up is n and whose forward is as close as possible to fHint. */
export function basisFromUpForward(n, fHint) {
  let f = sub(fHint, scale(n, dot(fHint, n)));
  if (len2(f) < 1e-6) {
    // fHint parallel to n: pick any perpendicular
    f = Math.abs(n.z) < 0.9 ? cross(n, v3(0, 0, 1)) : cross(n, v3(1, 0, 0));
  }
  f = norm(f);
  return { f, u: clone(n), l: cross(n, f) };
}

// ---- 3x3 matrices as row-major arrays of 9 numbers ----

export const m3 = (a = [1, 0, 0, 0, 1, 0, 0, 0, 1]) => a.slice();
export const m3mulv = (m, v) => ({
  x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
  y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
  z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
});
export function m3inv(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const s = 1 / det;
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ];
}

/** World inverse-inertia tensor for a body with local principal inverse inertia invI = {x,y,z}. */
export function worldInvInertia(R, invI) {
  // M = R diag(invI) R^T, where R columns are f, l, u
  const c = [R.f, R.l, R.u];
  const d = [invI.x, invI.y, invI.z];
  const m = new Array(9).fill(0);
  const comp = ['x', 'y', 'z'];
  for (let r = 0; r < 3; r++) {
    for (let s = 0; s < 3; s++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += c[k][comp[r]] * d[k] * c[k][comp[s]];
      m[r * 3 + s] = sum;
    }
  }
  return m;
}
