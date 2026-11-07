// Ping pong / pickleball rally rules on top of the physics events.
// Sides: -1 = player (south, y < 0), +1 = bot (north, y > 0).
import { inCourt, sideOf } from '../physics/arena.js';

export const MODES = {
  quick: { target: 7, winBy: 1, label: 'Quick game — first to 7' },
  full: { target: 11, winBy: 2, label: 'Full game — first to 11, win by 2' },
};

export const SERVE_SWITCH_EVERY = 2;          // ping pong: alternate serve every 2 points
export const SERVE_MAX_OWN_BOUNCES = 2;       // the dropped serve may bounce twice on the server's side
export const SERVE_TIME_LIMIT = 8;            // s for the server to make contact
export const RALLY_STALL_LIMIT = 12;          // s without a legal event -> let (replay point)
const BOUNCE_EVENT_MIN_SPEED = 30;            // floor contacts slower than this are rolling, not bounces
const ROLLING_DEAD_TIME = 0.25;               // continuous floor contact this long counts as a bounce

export function makeMatch(mode = 'quick') {
  return {
    mode,
    score: { [-1]: 0, [1]: 0 },
    server: -1,
    pointsPlayed: 0,
    over: false,
    winner: 0,
    rally: null,
    lastCall: null,
  };
}

export function startRally(match) {
  match.rally = {
    phase: 'serve',     // 'serve' -> 'rally' -> 'dead'
    hitter: 0,          // side that touched last
    bounced: false,     // has the current shot legally bounced on the receiver's side
    netTouched: false,
    serveBounces: 0,
    hits: 0,            // touches that changed possession (rally count)
    time: 0,
    lastLegalTime: 0,
    floorContact: 0,    // continuous floor contact time
  };
  return match.rally;
}

/** Points needed check, including win-by-2 for full games. */
function checkGameOver(match) {
  const m = MODES[match.mode];
  const a = match.score[-1], b = match.score[1];
  if ((a >= m.target || b >= m.target) && Math.abs(a - b) >= m.winBy) {
    match.over = true;
    match.winner = a > b ? -1 : 1;
  }
}

function nextServer(match) {
  const m = MODES[match.mode];
  // deuce in a win-by-2 game: alternate every point (ping pong)
  const deuce = m.winBy > 1 && match.score[-1] >= m.target - 1 && match.score[1] >= m.target - 1;
  if (deuce || match.pointsPlayed % SERVE_SWITCH_EVERY === 0) match.server = -match.server;
}

/**
 * End the rally. `winner` gets the point. `kind`: 'point' or 'fault'. Returns the call.
 */
export function awardPoint(match, winner, kind, reason) {
  const r = match.rally;
  if (!r || r.phase === 'dead') return null;
  r.phase = 'dead';
  match.score[winner]++;
  match.pointsPlayed++;
  const call = { winner, kind, reason, rally: r.hits, score: { ...match.score } };
  match.lastCall = call;
  checkGameOver(match);
  if (!match.over) nextServer(match);
  return call;
}

/** Replay the point without scoring (R key / stalled ball). */
export function letRally(match) {
  if (match.rally) match.rally.phase = 'dead';
  match.lastCall = { winner: 0, kind: 'let', reason: 'LET — REPLAY', rally: 0, score: { ...match.score } };
  return match.lastCall;
}

/**
 * Feed one tick of physics events. Returns a call object when the rally ends, else null.
 * events: { type: 'touch', team } | { type: 'floor'|'wall'|'ceiling'|'net', pos, speed }
 */
export function processEvents(match, events, dt, ballPos) {
  const r = match.rally;
  if (!r || r.phase === 'dead' || match.over) return null;
  r.time += dt;

  let floorThisTick = false;
  for (const e of events) {
    let call = null;
    if (e.type === 'touch') call = onTouch(match, e.team);
    else if (e.type === 'floor') { floorThisTick = true; call = onFloor(match, e); }
    else if (e.type === 'wall' || e.type === 'ceiling') call = onWall(match, e);
    else if (e.type === 'net') r.netTouched = true;
    if (call) return call;
  }

  // rolling ball: continuous contact counts as a bounce after a short time
  if (floorThisTick) {
    r.floorContact += dt;
    if (r.floorContact >= ROLLING_DEAD_TIME && r.floorContact - dt < ROLLING_DEAD_TIME) {
      const call = onFloor(match, { pos: ballPos, speed: BOUNCE_EVENT_MIN_SPEED, rolling: true });
      if (call) return call;
    }
  } else {
    r.floorContact = 0;
  }

  if (r.phase === 'serve' && r.time > SERVE_TIME_LIMIT) {
    return awardPoint(match, -match.server, 'fault', 'SERVE TIME');
  }
  if (r.time - r.lastLegalTime > RALLY_STALL_LIMIT) return letRally(match);
  return null;
}

function onTouch(match, side) {
  const r = match.rally;
  r.lastLegalTime = r.time;
  if (r.phase === 'serve') {
    if (side !== match.server) return null; // receiver cannot reach the server's half
    r.phase = 'rally';
    r.hitter = side;
    r.bounced = false;
    r.netTouched = false;
    r.hits = 1;
    return null;
  }
  if (side !== r.hitter) {
    // a return (after the bounce, or a volley — pickleball allows volleys)
    r.hitter = side;
    r.bounced = false;
    r.netTouched = false;
    r.hits++;
  }
  // same-side extra touches (dribbles, double taps) are allowed; the shot must still land over the net
  return null;
}

function onFloor(match, e) {
  const r = match.rally;
  const rolling = !!e.rolling;
  if (!rolling && e.speed < BOUNCE_EVENT_MIN_SPEED) return null;
  if (!rolling && r.floorContact > 0) return null; // still the same contact
  const side = sideOf(e.pos.y);

  if (r.phase === 'serve') {
    // the dropped serve may bounce on the server's own side before the server hits it
    r.serveBounces++;
    if (r.serveBounces > SERVE_MAX_OWN_BOUNCES || rolling) {
      return awardPoint(match, -match.server, 'fault', 'MISSED SERVE');
    }
    return null;
  }

  const hitter = r.hitter, receiver = -hitter;
  if (r.bounced) {
    // second bounce anywhere before the receiver returned it: hitter wins the point
    r.lastLegalTime = r.time;
    return awardPoint(match, hitter, 'point', r.hits >= 2 ? 'NOT RETURNED' : 'ACE');
  }
  if (side === hitter) {
    return awardPoint(match, receiver, 'fault', r.netTouched ? 'NET' : 'OWN SIDE');
  }
  if (!inCourt(e.pos.x, e.pos.y)) {
    return awardPoint(match, receiver, 'fault', 'OUT');
  }
  r.bounced = true;
  r.lastLegalTime = r.time;
  return null;
}

function onWall(match, e) {
  const r = match.rally;
  if (r.phase === 'serve') return null;
  // Ping pong: the shot must land on the opponent's court before touching anything else.
  if (!r.bounced) return awardPoint(match, -r.hitter, 'fault', 'OUT — WALL');
  return null; // after a legal bounce the ball stays live off walls (wall shots)
}
