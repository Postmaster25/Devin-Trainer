/** Wall-clock timer engine based on performance.now(); survives pauses and frame throttling. */
export type EngineState = 'idle' | 'running' | 'paused' | 'finished';

export class TimerEngine {
  private startedAt = 0;
  private accumulated = 0;
  state: EngineState = 'idle';

  constructor(readonly totalSec: number, private now: () => number = () => performance.now()) {}

  start(fromSec = 0) {
    this.accumulated = fromSec * 1000;
    this.startedAt = this.now();
    this.state = 'running';
  }

  pause() {
    if (this.state !== 'running') return;
    this.accumulated += this.now() - this.startedAt;
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') return;
    this.startedAt = this.now();
    this.state = 'running';
  }

  finish() {
    if (this.state === 'running') this.accumulated += this.now() - this.startedAt;
    this.state = 'finished';
  }

  /** Elapsed seconds, clamped to the total. Marks the engine finished at the end. */
  elapsed(): number {
    const ms = this.state === 'running' ? this.accumulated + (this.now() - this.startedAt) : this.accumulated;
    const sec = ms / 1000;
    if (sec >= this.totalSec && this.state === 'running') {
      this.accumulated = this.totalSec * 1000;
      this.state = 'finished';
    }
    return Math.min(sec, this.totalSec);
  }
}
