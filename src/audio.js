// Tiny WebAudio synth for game feedback (no audio files to download).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('rp_muted') === '1'; } catch { /* storage blocked */ }
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }
  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('rp_muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    return this.muted;
  }
  tone(freq, dur, type = 'sine', vol = 0.5, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  hit(strength) { this.tone(140 + strength * 0.05, 0.16, 'triangle', Math.min(0.9, 0.3 + strength / 3000), 0.5); this.tone(900, 0.05, 'square', 0.08); }
  bounce(speed) { this.tone(320 + Math.min(speed, 1500) * 0.15, 0.07, 'sine', Math.min(0.35, speed / 2500)); }
  net() { this.tone(110, 0.25, 'sawtooth', 0.2, 0.6); }
  pad(big) { this.tone(big ? 520 : 760, big ? 0.22 : 0.08, 'triangle', 0.18, 1.6); }
  jump() { this.tone(260, 0.08, 'triangle', 0.12, 1.5); }
  point(good) { if (good) { this.tone(660, 0.12, 'triangle', 0.3); setTimeout(() => this.tone(990, 0.2, 'triangle', 0.3), 110); } else { this.tone(300, 0.25, 'sawtooth', 0.18, 0.6); } }
}
