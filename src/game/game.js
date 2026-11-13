// Game orchestration: fixed-tick world + rules + serve flow + bot. Used by the browser build and
// by the headless tests (bot vs bot / scripted players).
import * as K from '../physics/constants.js';
import { v3 } from '../physics/vec.js';
import { makeWorld, stepWorld, PLAYER_SPAWN, BOT_SPAWN } from '../physics/world.js';
import { resetCar, neutralControls } from '../physics/car.js';
import { makeMatch, startRally, processEvents, letRally } from './rules.js';
import { BotAI } from './ai.js';

export const SERVE_FREEZE = 1.0;    // s the ball hangs before dropping (cars can position)
export const POINT_PAUSE = 2.0;     // s showing the call before the next serve
// Game settings, not RL values. Tuned by bot-vs-bot sweep: a higher drop bounces higher, so the server
// strikes a rising ball and sends a loopier serve the receiver can reach and return. 650/1900 averaged
// 1.55 hits a point; anywhere in ~1125-1350 high x 1700-1900 deep gives ~2.1-2.3.
export const SERVE_DROP_HEIGHT = 1275;
export const SERVE_DROP_DEPTH = 1800;

export class Game {
  /**
   * opts.mode 'quick' | 'full'; opts.playerAI: BotAI options to make the player side a bot (tests);
   * opts.rng: seeded random; opts.playerProfile: control profile for the human car.
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.rng = opts.rng || Math.random;
    this.world = makeWorld({ playerProfile: opts.playerProfile });
    this.match = makeMatch(opts.mode || 'quick');
    this.bot = new BotAI(1, { rng: this.rng, ...(opts.botOptions || {}) });
    this.playerBot = opts.playerAI ? new BotAI(-1, { rng: this.rng, ...opts.playerAI }) : null;
    this.state = 'serve';      // 'serve' | 'live' | 'point' | 'over'
    this.stateTime = 0;
    this.time = 0;
    this.lastCall = null;
    this.feed = [];            // render/audio events since last drain
    this.playerControls = neutralControls();
    this.serveDropHeight = opts.serveDropHeight ?? SERVE_DROP_HEIGHT;
    this.serveDropDepth = opts.serveDropDepth ?? SERVE_DROP_DEPTH;
    this.setupServe();
  }

  setupServe() {
    const w = this.world;
    const [p, b] = w.cars;
    resetCar(p, PLAYER_SPAWN.pos, PLAYER_SPAWN.yaw);
    resetCar(b, BOT_SPAWN.pos, BOT_SPAWN.yaw);
    p.boost = K.BOOST_START; b.boost = K.BOOST_START;
    for (const pad of w.pads) pad.timer = 0;
    const s = this.match.server;
    const x = (this.rng() - 0.5) * 900;
    w.ball.pos = v3(x, s * this.serveDropDepth, this.serveDropHeight);
    w.ball.vel = v3();
    w.ball.ang = v3();
    w.ball.frozen = true;
    startRally(this.match);
    this.state = 'serve';
    this.stateTime = 0;
    this.feed.push({ type: 'serve', server: s });
  }

  /** Re-serve the current point (R key). Counts as a let. */
  reserve() {
    if (this.state === 'over') return;
    letRally(this.match);
    this.setupServe();
  }

  tick() {
    const dt = K.DT;
    const w = this.world;
    this.time += dt;
    this.stateTime += dt;

    if (this.state === 'serve' && this.stateTime >= SERVE_FREEZE) {
      w.ball.frozen = false;
      this.state = 'live';
      this.stateTime = 0;
    }

    // controls
    w.controls[0] = this.playerBot ? { ...this.playerBot.update(w, this.match, this.time) } : this.playerControls;
    w.controls[1] = { ...this.bot.update(w, this.match, this.time) };
    if (this.state === 'over') { w.controls[1] = neutralControls(); if (this.playerBot) w.controls[0] = neutralControls(); }

    w.events.length = 0;
    stepWorld(w);
    for (const c of w.cars) for (const e of c.events) this.feed.push({ type: e, team: c.team });
    for (const e of w.events) {
      if (e.type === 'touch' || e.type === 'pad' || ((e.type === 'floor' || e.type === 'wall' || e.type === 'net') && e.speed > 60)) {
        this.feed.push(e);
      }
    }

    if (this.state === 'live') {
      const call = processEvents(this.match, w.events, dt, w.ball.pos);
      if (call) {
        this.lastCall = call;
        this.feed.push({ type: 'call', call });
        this.state = this.match.over ? 'over' : 'point';
        this.stateTime = 0;
      }
    } else if (this.state === 'point' && this.stateTime >= POINT_PAUSE) {
      this.setupServe();
    }
  }

  drainFeed() {
    const f = this.feed;
    this.feed = [];
    return f;
  }
}
