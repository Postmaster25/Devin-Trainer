import type { Cue } from './cues';

export type AudioManifest = {
  version: number;
  voice: string;
  rate: string;
  padMs: number;
  maxNumber: number;
  clips: Record<string, { file: string; text: string; durationMs: number }>;
};

type Scheduled = { cue: Cue; sources: AudioBufferSourceNode[]; firstStart: number };

const base = () => `${import.meta.env.BASE_URL}audio/`;

/**
 * Stitches pre-generated clips into spoken cues with Web Audio.
 * All remaining cues are scheduled on the AudioContext clock up front, so they
 * keep playing if iOS throttles JavaScript while the screen is off. A looping
 * silent <audio> element keeps the iOS audio session (and lock-screen controls) alive.
 */
class CuePlayer {
  private ctx?: AudioContext;
  private keepAlive?: HTMLAudioElement;
  private manifestPromise?: Promise<AudioManifest>;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | undefined>>();
  private scheduled: Scheduled[] = [];
  private anchor?: { ctxTime: number; elapsed: number };
  gapMs = 120;

  manifest(): Promise<AudioManifest> {
    this.manifestPromise ??= fetch(`${base()}audio-manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`audio manifest: HTTP ${r.status}`);
      return r.json();
    });
    return this.manifestPromise;
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'playback' });
    }
    return this.ctx;
  }

  /** Must be called synchronously inside a user gesture (tap) on iOS. */
  unlock() {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        /* ignore */
      }
    }
    const ctx = this.context();
    void ctx.resume();
    // A 1-sample silent buffer started in the gesture fully unlocks iOS Web Audio.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    this.startKeepAlive();
  }

  startKeepAlive() {
    if (!this.keepAlive) {
      const el = new Audio(`${base()}silence.mp3`);
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      this.keepAlive = el;
    }
    void this.keepAlive.play().catch(() => undefined);
  }

  stopKeepAlive() {
    this.keepAlive?.pause();
  }

  get state(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none';
  }

  async resumeContext() {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
  }

  onStateChange(fn: () => void): () => void {
    const ctx = this.context();
    ctx.addEventListener('statechange', fn);
    return () => ctx.removeEventListener('statechange', fn);
  }

  async load(ids: string[]): Promise<string[]> {
    const manifest = await this.manifest();
    const ctx = this.context();
    const missing: string[] = [];
    await Promise.all(
      ids.map((id) => {
        if (this.buffers.has(id)) return undefined;
        const entry = manifest.clips[id];
        if (!entry) {
          missing.push(id);
          return undefined;
        }
        let p = this.loading.get(id);
        if (!p) {
          p = fetch(`${base()}${entry.file}`)
            .then((r) => r.arrayBuffer())
            .then((data) => ctx.decodeAudioData(data))
            .then((buf) => {
              this.buffers.set(id, buf);
              return buf;
            })
            .catch(() => {
              missing.push(id);
              return undefined;
            })
            .finally(() => this.loading.delete(id));
          this.loading.set(id, p);
        }
        return p;
      }),
    );
    return missing;
  }

  private play(cue: Cue, when: number): Scheduled {
    const ctx = this.context();
    let t = when;
    const sources: AudioBufferSourceNode[] = [];
    for (const id of cue.clips) {
      const buf = this.buffers.get(id);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(t);
      sources.push(src);
      t += buf.duration + this.gapMs / 1000;
    }
    return { cue, sources, firstStart: when };
  }

  /** Schedule every cue at or after `elapsed` seconds relative to the AudioContext clock. */
  scheduleFrom(cues: Cue[], elapsed: number) {
    this.cancel();
    const ctx = this.context();
    const now = ctx.currentTime + 0.05;
    this.anchor = { ctxTime: now, elapsed };
    for (const cue of cues) {
      if (cue.at < elapsed - 0.05) continue;
      this.scheduled.push(this.play(cue, now + Math.max(0, cue.at - elapsed)));
    }
  }

  /** Elapsed workout time as implied by the audio clock (for drift checks). */
  audioElapsed(): number | undefined {
    if (!this.anchor || !this.ctx) return undefined;
    return this.anchor.elapsed + (this.ctx.currentTime - this.anchor.ctxTime);
  }

  /** Re-time cues that have not started yet, leaving any cue that is mid-sentence alone. */
  resync(cues: Cue[], elapsed: number) {
    const ctx = this.context();
    const now = ctx.currentTime;
    const keep: Scheduled[] = [];
    const playingCues = new Set<Cue>();
    for (const s of this.scheduled) {
      if (s.firstStart <= now + 0.15) {
        keep.push(s);
        playingCues.add(s.cue);
      } else {
        s.sources.forEach((src) => {
          try {
            src.stop();
          } catch {
            /* not started */
          }
        });
      }
    }
    this.scheduled = keep;
    const start = now + 0.05;
    this.anchor = { ctxTime: start, elapsed };
    for (const cue of cues) {
      if (playingCues.has(cue) || cue.at < elapsed + 0.15) continue;
      this.scheduled.push(this.play(cue, start + (cue.at - elapsed)));
    }
  }

  cancel() {
    for (const s of this.scheduled) {
      s.sources.forEach((src) => {
        try {
          src.stop();
        } catch {
          /* not started */
        }
      });
    }
    this.scheduled = [];
    this.anchor = undefined;
  }

  /** Play a one-off cue immediately (e.g. audio test). */
  async say(clips: string[]) {
    await this.load(clips);
    await this.resumeContext();
    this.play({ at: 0, clips, kind: 'phase' }, this.context().currentTime + 0.05);
  }

  clipDurations(manifest: AudioManifest): Record<string, number> {
    return Object.fromEntries(Object.entries(manifest.clips).map(([k, v]) => [k, v.durationMs]));
  }
}

export const cuePlayer = new CuePlayer();
