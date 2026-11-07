// Arena geometry as an analytic signed-distance field (inside of a rounded box) plus the net.
import {
  ARENA_HALF_X, ARENA_HALF_Y, ARENA_HEIGHT, ARENA_CORNER_RADIUS,
  NET_HEIGHT, NET_THICKNESS, COURT_HALF_X, COURT_HALF_Y,
} from './constants.js';

const CZ = ARENA_HEIGHT / 2;
const R = ARENA_CORNER_RADIUS;
const IX = ARENA_HALF_X - R, IY = ARENA_HALF_Y - R, IZ = CZ - R;

/**
 * Distance from p to the arena boundary (positive inside) and the inward surface normal at the
 * closest boundary point. Reuses `out` to avoid allocation in hot loops.
 */
export function arenaQuery(p, out = { d: 0, n: { x: 0, y: 0, z: 1 } }) {
  const px = p.x, py = p.y, pz = p.z - CZ;
  const sx = px < 0 ? -1 : 1, sy = py < 0 ? -1 : 1, sz = pz < 0 ? -1 : 1;
  const qx = Math.abs(px) - IX, qy = Math.abs(py) - IY, qz = Math.abs(pz) - IZ;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  const outerLen = Math.sqrt(mx * mx + my * my + mz * mz);
  const inner = Math.min(Math.max(qx, qy, qz), 0);
  const sd = outerLen + inner - R; // negative inside
  out.d = -sd;
  if (outerLen > 1e-6) {
    out.n.x = -sx * mx / outerLen; out.n.y = -sy * my / outerLen; out.n.z = -sz * mz / outerLen;
  } else if (qx >= qy && qx >= qz) {
    out.n.x = -sx; out.n.y = 0; out.n.z = 0;
  } else if (qy >= qz) {
    out.n.x = 0; out.n.y = -sy; out.n.z = 0;
  } else {
    out.n.x = 0; out.n.y = 0; out.n.z = -sz;
  }
  return out;
}

/** Net is an axis-aligned slab across the full arena width at y = 0. */
export const NET_BOX = {
  min: { x: -ARENA_HALF_X, y: -NET_THICKNESS / 2, z: 0 },
  max: { x: ARENA_HALF_X, y: NET_THICKNESS / 2, z: NET_HEIGHT },
};

/** Sphere vs net box. Returns null or { n (outward from net), depth }. */
export function netQuery(c, radius) {
  const b = NET_BOX;
  const cx = Math.min(Math.max(c.x, b.min.x), b.max.x);
  const cy = Math.min(Math.max(c.y, b.min.y), b.max.y);
  const cz = Math.min(Math.max(c.z, b.min.z), b.max.z);
  const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= radius * radius) return null;
  const d = Math.sqrt(d2);
  if (d > 1e-6) return { n: { x: dx / d, y: dy / d, z: dz / d }, depth: radius - d };
  // centre inside the slab (tunnelled): push out along y toward the side it came from / top
  const toTop = b.max.z - c.z;
  if (toTop < NET_THICKNESS) return { n: { x: 0, y: 0, z: 1 }, depth: radius + toTop };
  const sy = c.y >= 0 ? 1 : -1;
  return { n: { x: 0, y: sy, z: 0 }, depth: radius + (b.max.y - Math.abs(c.y)) };
}

/** Floor point is inside the painted court lines (ball's contact point, line counts as in). */
export function inCourt(x, y) {
  return Math.abs(x) <= COURT_HALF_X && Math.abs(y) <= COURT_HALF_Y;
}

/** Which half a y position belongs to: -1 = player (south), +1 = bot (north). */
export const sideOf = (y) => (y < 0 ? -1 : 1);

/** True when an inward normal belongs to the flat floor (not a ramp/wall/ceiling). */
export const isFloorNormal = (n) => n.z > 0.985;
