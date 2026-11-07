import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, startRally, processEvents, awardPoint } from '../src/game/rules.js';

const DT = 1 / 120;
const floor = (x, y, speed = 500) => ({ type: 'floor', pos: { x, y, z: 93 }, speed });
const touch = (team) => ({ type: 'touch', team });
const run = (m, seq) => {
  let call = null;
  for (const evs of seq) {
    call = processEvents(m, evs, DT, { x: 0, y: 0, z: 300 }) || call;
    processEvents(m, [], DT, { x: 0, y: 0, z: 300 }); // a tick without contact between bounces
    if (call) break;
  }
  return call;
};

test('full rally: serve, cross, bounce, return, bounce, not returned -> point', () => {
  const m = makeMatch('quick'); startRally(m);
  assert.equal(m.server, -1);
  const call = run(m, [
    [floor(0, -1900)],          // dropped serve bounces on server side (allowed)
    [touch(-1)],                // serve
    [floor(200, 2000)],         // lands in on the bot side
    [touch(1)],                 // bot returns
    [floor(-300, -1500)],       // lands in on the player side
    [touch(-1)],                // player returns
    [floor(500, 2500)],         // in
    [floor(500, 3300)],         // second bounce: bot failed to return
  ]);
  assert.equal(call.winner, -1);
  assert.equal(call.kind, 'point');
  assert.equal(call.rally, 3);
  assert.deepEqual(call.score, { [-1]: 1, [1]: 0 });
});

test('faults: own side / net, out, wall before bounce, missed serve', () => {
  let m = makeMatch(); startRally(m);
  let c = run(m, [[touch(-1)], [{ type: 'net', pos: { x: 0, y: -50, z: 150 }, speed: 900 }], [floor(0, -300)]]);
  assert.equal(c.winner, 1); assert.equal(c.reason, 'NET');

  m = makeMatch(); startRally(m);
  c = run(m, [[touch(-1)], [floor(2400, 2000)]]);
  assert.equal(c.winner, 1); assert.equal(c.reason, 'OUT');

  m = makeMatch(); startRally(m);
  c = run(m, [[touch(-1)], [floor(0, 3500)]]);
  assert.equal(c.reason, 'OUT', 'past the baseline is out');

  m = makeMatch(); startRally(m);
  c = run(m, [[touch(-1)], [{ type: 'wall', pos: { x: 2700, y: 1000, z: 500 }, speed: 900 }]]);
  assert.equal(c.winner, 1); assert.equal(c.reason, 'OUT — WALL');

  m = makeMatch(); startRally(m);
  c = run(m, [[touch(-1)], [floor(0, 2000)], [{ type: 'wall', pos: { x: 0, y: 4200, z: 300 }, speed: 900 }], [touch(1)]]);
  assert.equal(c, null, 'after a legal bounce the ball stays live off the walls');

  m = makeMatch(); startRally(m);
  c = run(m, [[floor(0, -1900)], [floor(0, -1900)], [floor(0, -1900)]]);
  assert.equal(c.winner, 1); assert.equal(c.reason, 'MISSED SERVE');
});

test('volleys are legal (pickleball), line counts as in', () => {
  const m = makeMatch(); startRally(m);
  const c = run(m, [[touch(-1)], [touch(1)], [floor(2050, -3400)], [floor(0, -2000)]]);
  assert.equal(c.winner, 1); assert.equal(c.kind, 'point');
});

test('serve alternates every 2 points; first to 7 ends a quick game', () => {
  const m = makeMatch('quick');
  const servers = [];
  while (!m.over) {
    startRally(m);
    servers.push(m.server);
    awardPoint(m, 1, 'point', 'TEST');
  }
  assert.deepEqual(servers, [-1, -1, 1, 1, -1, -1, 1]);
  assert.equal(m.score[1], 7);
  assert.equal(m.winner, 1);
});

test('full game: first to 11, win by 2, serve alternates every point at deuce', () => {
  const m = makeMatch('full');
  for (let i = 0; i < 10; i++) { startRally(m); awardPoint(m, -1, 'point', 'T'); startRally(m); awardPoint(m, 1, 'point', 'T'); }
  assert.equal(m.over, false);
  startRally(m); awardPoint(m, -1, 'point', 'T'); // 11-10
  assert.equal(m.over, false, '11-10 is not a win');
  const s1 = m.server;
  startRally(m); awardPoint(m, 1, 'point', 'T'); // 11-11
  assert.notEqual(m.server, s1, 'deuce: serve swaps every point');
  startRally(m); awardPoint(m, -1, 'point', 'T');
  startRally(m); awardPoint(m, -1, 'point', 'T'); // 13-11
  assert.equal(m.over, true);
  assert.equal(m.winner, -1);
});
