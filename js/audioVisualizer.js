/**
 * audioVisualizer.js
 * Modular audio processing and canvas rendering for the Web Audio API visualizer.
 */

export class AudioVisualizer {
  /**
   * @param {HTMLCanvasElement} canvas - The canvas element to draw on.
   * @param {HTMLAudioElement}  audio  - The <audio> element used for playback.
   */
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;

    // Web Audio API nodes
    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this.gainNode = null;

    // Rendering state
    this.animFrameId = null;
    /** @type {'bars'|'wave'|'circle'} */
    this.mode = 'bars';
    this.isInitialised = false;

    // Resize handling
    this._resizeObserver = new ResizeObserver(() => this._syncCanvasSize());
    this._resizeObserver.observe(this.canvas);
    this._syncCanvasSize();

    // Draw idle placeholder immediately
    this._drawIdle();
  }

  // ─────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────

  /** Load a File object as the audio source and set up the audio graph. */
  loadFile(file) {
    if (!file || !file.type.startsWith('audio/')) {
      console.warn('AudioVisualizer: rejected non-audio file:', file?.type);
      return;
    }
    // Revoke any previous object URL to avoid memory leaks
    if (this._objectURL) {
      URL.revokeObjectURL(this._objectURL);
    }
    this._objectURL = URL.createObjectURL(file);
    this.audio.src = this._objectURL;
    this._ensureAudioContext();
  }

  /** Set visualisation mode: 'bars' | 'wave' | 'circle' */
  setMode(mode) {
    this.mode = mode;
  }

  /** Set playback volume (0–1). */
  setVolume(value) {
    if (this.gainNode) {
      // 0.02s exponential time constant keeps volume changes smooth, avoiding audio pops/clicks
      this.gainNode.gain.setTargetAtTime(value, this.audioCtx.currentTime, 0.02);
    } else {
      this.audio.volume = value;
    }
  }

  /** Seek to a time (seconds). */
  seek(time) {
    if (isFinite(this.audio.duration)) {
      this.audio.currentTime = time;
    }
  }

  /** Start the render loop (called when audio plays). */
  start() {
    this._ensureAudioContext();
    if (!this.animFrameId) {
      this._renderLoop();
    }
  }

  /** Pause the render loop. */
  pause() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** Stop and tear down. */
  destroy() {
    this.pause();
    this._resizeObserver.disconnect();
    if (this._objectURL) {
      URL.revokeObjectURL(this._objectURL);
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }

  /** Resume the AudioContext if it was suspended (required after a user gesture). */
  async resumeIfSuspended() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  // ─────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────

  _ensureAudioContext() {
    if (this.isInitialised) return;
    this.isInitialised = true;

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82; // Balanced response: fast enough to follow beats, smooth enough to avoid flicker

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = this.audio.volume;

    this.source = this.audioCtx.createMediaElementSource(this.audio);
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
  }

  _syncCanvasSize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width > 0 && height > 0) {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.ctx.scale(dpr, dpr);
    }
  }

  _logicalSize() {
    const dpr = window.devicePixelRatio || 1;
    return {
      w: this.canvas.width / dpr,
      h: this.canvas.height / dpr,
    };
  }

  // ─── Render loop ───────────────────────────

  _renderLoop() {
    this.animFrameId = requestAnimationFrame(() => this._renderLoop());

    const { w, h } = this._logicalSize();
    this.ctx.clearRect(0, 0, w, h);

    if (!this.analyser) {
      this._drawIdle();
      return;
    }

    switch (this.mode) {
      case 'wave':
        this._drawWaveform(w, h);
        break;
      case 'circle':
        this._drawCircle(w, h);
        break;
      default:
        this._drawBars(w, h);
    }
  }

  // ─── Visualisation modes ──────────────────

  // Accent colour endpoints — mirror of CSS --accent (167,139,250) and --accent-2 (96,165,250)
  static get ACCENT_RGB()  { return [167, 139, 250]; }
  static get ACCENT2_RGB() { return [ 96, 165, 250]; }

  _drawBars(w, h) {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    // Cap at 120 bars for visual clarity and consistent performance across all FFT sizes
    const barCount = Math.min(bufferLength, 120);
    const gap = 2;
    const barWidth = (w - gap * (barCount - 1)) / barCount;

    const [r1, g1, b1] = AudioVisualizer.ACCENT_RGB;
    const [r2, g2, b2] = AudioVisualizer.ACCENT2_RGB;

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i];
      const barHeight = (value / 255) * h;
      const x = i * (barWidth + gap);
      const y = h - barHeight;

      // Interpolate from --accent (purple) to --accent-2 (blue) as bar height increases
      const ratio = value / 255;
      const r = Math.round(r1 + (r2 - r1) * ratio);
      const g = Math.round(g1 + (g2 - g1) * ratio);
      const b = Math.round(b1 + (b2 - b1) * ratio);

      const grad = this.ctx.createLinearGradient(x, y, x, h);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.25)`);

      this.ctx.fillStyle = grad;
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
      this.ctx.fill();
    }
  }

  _drawWaveform(w, h) {
    const bufferLength = this.analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);

    this.ctx.lineWidth = 2.5;
    this.ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)';
    this.ctx.shadowColor = 'rgba(167, 139, 250, 0.5)';
    this.ctx.shadowBlur = 8;

    this.ctx.beginPath();
    const sliceWidth = w / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      // 128.0 normalises the byte value (0–255) so that silence ≈ 1.0 (midpoint)
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    this.ctx.lineTo(w, h / 2);
    this.ctx.stroke();

    this.ctx.shadowBlur = 0;
  }

  _drawCircle(w, h) {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const cx = w / 2;
    const cy = h / 2;
    // 0.28 keeps the ring comfortably inside the canvas with room for amplitude spikes
    const baseRadius = Math.min(w, h) * 0.28;
    const step = Math.PI * 2 / bufferLength;

    this.ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      // Limit amplitude to 90% of baseRadius so spikes never reach the canvas edge
      const amplitude = (dataArray[i] / 255) * baseRadius * 0.9;
      const r = baseRadius + amplitude;
      const angle = i * step - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();

    const grad = this.ctx.createRadialGradient(cx, cy, baseRadius * 0.5, cx, cy, baseRadius * 1.8);
    grad.addColorStop(0, 'rgba(167, 139, 250, 0.7)');
    grad.addColorStop(0.5, 'rgba(96, 165, 250, 0.5)');
    grad.addColorStop(1, 'rgba(96, 165, 250, 0)');
    this.ctx.fillStyle = grad;
    this.ctx.fill();

    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = 'rgba(167, 139, 250, 0.85)';
    this.ctx.stroke();
  }

  // ─── Idle placeholder ─────────────────────

  _drawIdle() {
    const { w, h } = this._logicalSize();
    this.ctx.clearRect(0, 0, w, h);

    // Subtle horizontal line
    this.ctx.beginPath();
    this.ctx.moveTo(w * 0.1, h / 2);
    this.ctx.lineTo(w * 0.9, h / 2);
    this.ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // Centered label
    this.ctx.font = '14px system-ui, sans-serif';
    this.ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('Upload an audio file to start the visualizer', w / 2, h / 2);
  }
}
