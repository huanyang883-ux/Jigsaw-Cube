export class GameAudio {
  constructor(enabled = false) { this.enabled = enabled; this.active = true; }
  setActive(active) {
    this.active = active;
    if (!active) this.context?.suspend().catch(() => {});
    else this.unlock();
  }
  unlock() {
    if (!this.enabled || !this.active) return;
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch { this.enabled = false; }
  }
  play(kind) {
    if (!this.enabled || !this.active) return;
    this.unlock();
    if (!this.context) return;
    const notes = kind === 'win' ? [523.25, 659.25, 783.99, 1046.5] : kind === 'merge' ? [659.25, 880] : [440];
    notes.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator(), gain = this.context.createGain();
      const start = this.context.currentTime + index * .11;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.045, start + .012); gain.gain.exponentialRampToValueAtTime(.0001, start + .25);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(start); oscillator.stop(start + .28);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }
  destroy() { this.context?.close().catch(() => {}); }
}
