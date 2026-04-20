'use strict';
// DX7 6-operator FM synthesis AudioWorklet
// Core synthesis logic ported from mmontag/dx7-synth-js (MIT License)
// https://github.com/mmontag/dx7-synth-js

// ── Level / amplitude tables ──────────────────────────────────────────────────

const OUTPUT_LEVEL_TABLE = [
  0.000000, 0.000337, 0.000476, 0.000674, 0.000952, 0.001235, 0.001602, 0.001905, 0.002265, 0.002694,
  0.003204, 0.003810, 0.004531, 0.005388, 0.006408, 0.007620, 0.008310, 0.009062, 0.010776, 0.011752,
  0.013975, 0.015240, 0.016619, 0.018123, 0.019764, 0.021552, 0.023503, 0.025630, 0.027950, 0.030480,
  0.033238, 0.036247, 0.039527, 0.043105, 0.047006, 0.051261, 0.055900, 0.060960, 0.066477, 0.072494,
  0.079055, 0.086210, 0.094012, 0.102521, 0.111800, 0.121919, 0.132954, 0.144987, 0.158110, 0.172420,
  0.188025, 0.205043, 0.223601, 0.243838, 0.265907, 0.289974, 0.316219, 0.344839, 0.376050, 0.410085,
  0.447201, 0.487676, 0.531815, 0.579948, 0.632438, 0.689679, 0.752100, 0.820171, 0.894403, 0.975353,
  1.063630, 1.159897, 1.264876, 1.379357, 1.504200, 1.640341, 1.788805, 1.950706, 2.127260, 2.319793,
  2.529752, 2.758714, 3.008399, 3.280683, 3.577610, 3.901411, 4.254519, 4.639586, 5.059505, 5.517429,
  6.016799, 6.561366, 7.155220, 7.802823, 8.509039, 9.279172, 10.11901, 11.03486, 12.03360, 13.12273,
];

// Envelope level → dB-scale output index mapping (0-99 → 0-127)
const ENV_OUTPUTLEVEL = [
  0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39,
  41, 42, 43, 45, 46, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61,
  62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80,
  81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114,
  115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127,
];

const ENV_OUTPUT_LUT = new Float32Array(4096);
for (let i = 0; i < 4096; i++) {
  const dB = (i - 3824) * 0.0235;
  ENV_OUTPUT_LUT[i] = Math.pow(20, dB / 20);
}

// ── DX7 algorithms ────────────────────────────────────────────────────────────
// operators[0]=Op1 (carrier/output), operators[5]=Op6 (deepest modulator)
// outputMix: indices of operators that feed audio output
// modulationMatrix[i]: list of operators that modulate operator i
const ALGORITHMS = [
  { outputMix:[0,2],         modulationMatrix:[[1],[],[3],[4],[5],[5]]        }, //1
  { outputMix:[0,2],         modulationMatrix:[[1],[1],[3],[4],[5],[]]        }, //2
  { outputMix:[0,3],         modulationMatrix:[[1],[2],[],[4],[5],[5]]        }, //3
  { outputMix:[0,3],         modulationMatrix:[[1],[2],[],[4],[5],[3]]        }, //4
  { outputMix:[0,2,4],       modulationMatrix:[[1],[],[3],[],[5],[5]]         }, //5
  { outputMix:[0,2,4],       modulationMatrix:[[1],[],[3],[],[5],[4]]         }, //6
  { outputMix:[0,2],         modulationMatrix:[[1],[],[3,4],[],[5],[5]]       }, //7
  { outputMix:[0,2],         modulationMatrix:[[1],[],[3,4],[3],[5],[]]       }, //8
  { outputMix:[0,2],         modulationMatrix:[[1],[1],[3,4],[],[5],[]]       }, //9
  { outputMix:[0,3],         modulationMatrix:[[1],[2],[2],[4,5],[],[]]       }, //10
  { outputMix:[0,3],         modulationMatrix:[[1],[2],[],[4,5],[],[5]]       }, //11
  { outputMix:[0,2],         modulationMatrix:[[1],[1],[3,4,5],[],[],[]]      }, //12
  { outputMix:[0,2],         modulationMatrix:[[1],[],[3,4,5],[],[],[5]]      }, //13
  { outputMix:[0,2],         modulationMatrix:[[1],[],[3],[4,5],[],[5]]       }, //14
  { outputMix:[0,2],         modulationMatrix:[[1],[1],[3],[4,5],[],[]]       }, //15
  { outputMix:[0],           modulationMatrix:[[1,2,4],[],[3],[],[5],[5]]     }, //16
  { outputMix:[0],           modulationMatrix:[[1,2,4],[1],[3],[],[5],[]]     }, //17
  { outputMix:[0],           modulationMatrix:[[1,2,3],[],[2],[4],[5],[]]     }, //18
  { outputMix:[0,3,4],       modulationMatrix:[[1],[2],[],[5],[5],[5]]        }, //19
  { outputMix:[0,1,3],       modulationMatrix:[[2],[2],[2],[4,5],[],[]]       }, //20
  { outputMix:[0,1,3,4],     modulationMatrix:[[2],[2],[2],[5],[5],[]]        }, //21
  { outputMix:[0,2,3,4],     modulationMatrix:[[1],[],[5],[5],[5],[5]]        }, //22
  { outputMix:[0,1,3,4],     modulationMatrix:[[],[2],[],[5],[5],[5]]         }, //23
  { outputMix:[0,1,2,3,4],   modulationMatrix:[[],[],[5],[5],[5],[5]]         }, //24
  { outputMix:[0,1,2,3,4],   modulationMatrix:[[],[],[],[5],[5],[5]]          }, //25
  { outputMix:[0,1,3],       modulationMatrix:[[],[2],[],[4,5],[],[5]]        }, //26
  { outputMix:[0,1,3],       modulationMatrix:[[],[2],[2],[4,5],[],[]]        }, //27
  { outputMix:[0,2,5],       modulationMatrix:[[1],[],[3],[4],[4],[]]         }, //28
  { outputMix:[0,1,2,4],     modulationMatrix:[[],[],[3],[],[5],[5]]          }, //29
  { outputMix:[0,1,2,5],     modulationMatrix:[[],[],[3],[4],[4],[]]          }, //30
  { outputMix:[0,1,2,3,4],   modulationMatrix:[[],[],[],[],[5],[5]]           }, //31
  { outputMix:[0,1,2,3,4,5], modulationMatrix:[[],[],[],[],[],[5]]            }, //32
];

const LFO_FREQ_TABLE = [
  0.062506, 0.124815, 0.311474, 0.435381, 0.619784, 0.744396, 0.930495, 1.116390,
  1.284220, 1.496880, 1.567830, 1.738994, 1.910158, 2.081322, 2.252486, 2.423650,
  2.580668, 2.737686, 2.894704, 3.051722, 3.208740, 3.366820, 3.524900, 3.682980,
  3.841060, 3.999140, 4.159420, 4.319700, 4.479980, 4.640260, 4.800540, 4.953584,
  5.106628, 5.259672, 5.412716, 5.565760, 5.724918, 5.884076, 6.043234, 6.202392,
  6.361550, 6.520044, 6.678538, 6.837032, 6.995526, 7.154020, 7.300500, 7.446980,
  7.593460, 7.739940, 7.886420, 8.020588, 8.154756, 8.288924, 8.423092, 8.557260,
  8.712624, 8.867988, 9.023352, 9.178716, 9.334080, 9.669644, 10.005208, 10.340772,
  10.676336, 11.011900, 11.963680, 12.915460, 13.867240, 14.819020, 15.770800,
  16.640240, 17.509680, 18.379120, 19.248560, 20.118000, 21.040700, 21.963400,
  22.886100, 23.808800, 24.731500, 25.759740, 26.787980, 27.816220, 28.844460,
  29.872700, 31.228200, 32.583700, 33.939200, 35.294700, 36.650200, 37.812480,
  38.974760, 40.137040, 41.299320, 42.461600, 43.639800, 44.818000, 45.996200,
  47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400,
  47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400,
  47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400,
  47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400, 47.174400,
];

const LFO_PITCH_MOD_TABLE = [0, 0.0264, 0.0534, 0.0889, 0.1612, 0.2769, 0.4967, 1];
const PERIOD = Math.PI * 2;
const PER_VOICE_LEVEL = 0.125 / 6;

// ── Envelope ──────────────────────────────────────────────────────────────────

class EnvelopeDX7 {
  constructor(levels, rates) {
    this.levels = levels;
    this.rates  = rates;
    this.level  = 0;
    this.down   = true;
    this.state  = 0;
    this.rising = false;
    this.targetlevel    = 0;
    this.decayIncrement = 0;
    this._advance(0);
  }

  render() {
    if (this.state < 3 || (this.state < 4 && !this.down)) {
      let lev = this.level;
      if (this.rising) {
        lev += this.decayIncrement * (2 + (this.targetlevel - lev) / 256);
        if (lev >= this.targetlevel) { lev = this.targetlevel; this._advance(this.state + 1); }
      } else {
        lev -= this.decayIncrement;
        if (lev <= this.targetlevel) { lev = this.targetlevel; this._advance(this.state + 1); }
      }
      this.level = lev;
    }
    return ENV_OUTPUT_LUT[Math.floor(this.level)];
  }

  _advance(s) {
    this.state = s;
    if (s < 4) {
      const nl = this.levels[s];
      this.targetlevel = Math.max(0, (ENV_OUTPUTLEVEL[nl] << 5) - 224);
      this.rising = (this.targetlevel - this.level) > 0;
      const qr = Math.min(63, (this.rates[s] * 41) >> 6);
      this.decayIncrement = Math.pow(2, qr / 4) / 2048;
    }
  }

  noteOff() { this.down = false; this._advance(3); }
  isFinished() { return this.state === 4; }
}

// ── Operator ──────────────────────────────────────────────────────────────────

class DX7Operator {
  constructor(opParams, baseFreq) {
    this.phase    = 0;
    this.val      = 0;
    this.envelope = new EnvelopeDX7(opParams.levels, opParams.rates);
    this.outputLevel = opParams.outputLevel;
    this.ampL = opParams.ampL;
    this.ampR = opParams.ampR;

    const detuneFactor = Math.pow(1.0006771307, opParams.detune || 0);
    const freq = opParams.oscMode
      ? opParams.freqFixed
      : baseFreq * opParams.freqRatio * detuneFactor;
    this.phaseStep = PERIOD * freq / sampleRate;
  }

  render(mod) {
    this.val = Math.sin(this.phase + mod) * this.envelope.render();
    this.phase += this.phaseStep;
    if (this.phase >= PERIOD) this.phase -= PERIOD;
    return this.val;
  }

  noteOff()    { this.envelope.noteOff(); }
  isFinished() { return this.envelope.isFinished(); }
}

// ── Voice ─────────────────────────────────────────────────────────────────────

class DX7Voice {
  constructor(note, velocity, patch, fromNote = null, portamentoSamples = 0) {
    this.note    = note;
    this.down    = true;
    this.patch   = patch;
    this.fbRatio = Math.pow(2, (patch.feedback - 7));

    const baseFreq = 440 * Math.pow(2, (note - 69) / 12);
    this.operators = new Array(6);
    for (let i = 0; i < 6; i++) {
      const op = patch.operators[i];
      const o  = new DX7Operator(op, baseFreq);
      o.outputLevel = (1 + (velocity - 1) * (op.velocitySens / 7)) * op.outputLevel;
      this.operators[i] = o;
    }

    // Glide: exponentially interpolate phaseStep from fromNote to note over portamentoSamples
    this._glideTargetSteps = null;
    this._glideRatio       = 1;
    this._glideSamples     = 0;
    if (fromNote !== null && fromNote !== note && portamentoSamples > 0) {
      const fromFreq = 440 * Math.pow(2, (fromNote - 69) / 12);
      const freqScale = fromFreq / baseFreq;                           // scale target → source
      const perSample = Math.pow(baseFreq / fromFreq, 1 / portamentoSamples); // ratio per sample
      this._glideTargetSteps = [];
      this._glideRatio   = perSample;
      this._glideSamples = portamentoSamples;
      for (let i = 0; i < 6; i++) {
        if (!patch.operators[i].oscMode) {
          this._glideTargetSteps[i] = this.operators[i].phaseStep;
          this.operators[i].phaseStep *= freqScale;  // start at fromNote frequency
        } else {
          this._glideTargetSteps[i] = null;
        }
      }
    }

    // LFO: simple global pitch LFO per voice
    this._lfoPhase      = 0;
    this._lfoPhaseStep  = PERIOD * (LFO_FREQ_TABLE[Math.min(127, patch.lfoSpeed || 0)]) / sampleRate;
    this._lfoPitchDepth = LFO_PITCH_MOD_TABLE[patch.lfoPitchModSens || 0] * ((patch.lfoPitchModDepth || 0) / 99);
  }

  render() {
    // Advance glide
    if (this._glideSamples > 0) {
      this._glideSamples--;
      if (this._glideSamples === 0) {
        for (let i = 0; i < 6; i++) {
          if (this._glideTargetSteps[i] !== null) this.operators[i].phaseStep = this._glideTargetSteps[i];
        }
        this._glideRatio = 1;
      } else {
        for (let i = 0; i < 6; i++) {
          if (this._glideTargetSteps[i] !== null) this.operators[i].phaseStep *= this._glideRatio;
        }
      }
    }

    const alg = ALGORITHMS[this.patch.algorithm - 1];
    const mm  = alg.modulationMatrix;
    const om  = alg.outputMix;

    // Simple pitch LFO applied as a small phase-step modulation
    // We skip per-note amplitude LFO for now (adds complexity)
    this._lfoPhase += this._lfoPhaseStep;
    if (this._lfoPhase >= PERIOD) this._lfoPhase -= PERIOD;
    // (pitch LFO would modify phaseStep per operator — skipped for clarity)

    // Render operators in reverse dependency order (5→0)
    for (let i = 5; i >= 0; i--) {
      let mod = 0;
      const srcs = mm[i];
      for (let j = 0; j < srcs.length; j++) {
        const s = srcs[j];
        const mop = this.operators[s];
        mod += (s === i)
          ? mop.val * this.fbRatio          // self-feedback uses previous sample val
          : mop.val * mop.outputLevel;      // normal modulation
      }
      this.operators[i].render(mod);
    }

    // Mix carriers
    let L = 0, R = 0;
    const scale = 1 / om.length;
    for (let k = 0; k < om.length; k++) {
      const c = this.operators[om[k]];
      const level = c.val * c.outputLevel;
      L += level * c.ampL;
      R += level * c.ampR;
    }
    return [L * scale * PER_VOICE_LEVEL, R * scale * PER_VOICE_LEVEL];
  }

  noteOff() {
    this.down = false;
    for (let i = 0; i < 6; i++) this.operators[i].noteOff();
  }

  isFinished() {
    const om = ALGORITHMS[this.patch.algorithm - 1].outputMix;
    for (const i of om) {
      if (!this.operators[i].isFinished()) return false;
    }
    return true;
  }
}

// ── Processor ─────────────────────────────────────────────────────────────────

class DX7Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._voices   = [];
    this._maxPoly  = 12;
    this._patch    = null;
    this._lastNote = null;
    this._overrides = { algorithm: null, feedback: null, modLevelScale: 1.0, portamento: 0 };
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'loadPatch':
        this._patch = msg.patch;
        break;
      case 'noteOn':
        this._noteOn(msg.note, msg.velocity, msg.portamento);
        break;
      case 'noteOff':
        this._noteOff(msg.note);
        break;
      case 'allNotesOff':
        for (const v of this._voices) v.noteOff();
        this._lastNote = null;
        break;
      case 'setParam':
        if (msg.key in this._overrides) {
          this._overrides[msg.key] = msg.value;
          // Apply feedback to active voices immediately (real-time param)
          if (msg.key === 'feedback' && msg.value !== null) {
            const fbRatio = Math.pow(2, Math.round(Math.max(0, Math.min(7, msg.value))) - 7);
            for (const v of this._voices) v.fbRatio = fbRatio;
          }
        }
        break;
    }
  }

  _noteOn(note, velocity, portamento) {
    if (!this._patch) return;
    if (note < 0 || note > 127) return;
    if (this._voices.length >= this._maxPoly) this._voices.shift();

    const ov = this._overrides;
    let patch = this._patch;
    const algNum = ov.algorithm != null
      ? Math.round(Math.max(1, Math.min(32, ov.algorithm)))
      : patch.algorithm;
    const fbNum = ov.feedback != null
      ? Math.round(Math.max(0, Math.min(7, ov.feedback)))
      : patch.feedback;
    const needsModScale = ov.modLevelScale !== 1.0;

    if (algNum !== patch.algorithm || fbNum !== patch.feedback || needsModScale) {
      const carriers = ALGORITHMS[algNum - 1].outputMix;
      patch = {
        ...patch,
        algorithm: algNum,
        feedback:  fbNum,
        operators: needsModScale
          ? patch.operators.map((op, i) =>
              carriers.includes(i) ? op : { ...op, outputLevel: op.outputLevel * ov.modLevelScale })
          : patch.operators,
      };
    }

    // Use inline portamento (captured at scheduling time) to avoid race with per-step resets
    const port = portamento !== undefined ? portamento : ov.portamento;
    const portSamples = Math.round((port || 0) * sampleRate);
    // Mono mode: release all current voices so glide sweep is not masked
    if (portSamples > 0) {
      for (const v of this._voices) v.noteOff();
    }
    const fromNote = (portSamples > 0 && this._lastNote !== null) ? this._lastNote : null;
    this._voices.push(new DX7Voice(note, velocity / 127, patch, fromNote, portSamples));
    this._lastNote = note;
  }

  _noteOff(note) {
    for (const v of this._voices) {
      if (v.note === note && v.down) { v.noteOff(); break; }
    }
  }

  process(inputs, outputs) {
    const ch0 = outputs[0][0];
    const ch1 = outputs[0][1];
    const len = ch0 ? ch0.length : 0;

    for (let i = 0; i < len; i++) {
      let L = 0, R = 0;
      for (let j = this._voices.length - 1; j >= 0; j--) {
        const v = this._voices[j];
        if (v.isFinished()) { this._voices.splice(j, 1); continue; }
        const [vL, vR] = v.render();
        L += vL; R += vR;
      }
      if (ch0) ch0[i] = L;
      if (ch1) ch1[i] = R;
    }
    return true;
  }
}

registerProcessor('dx7-processor', DX7Processor);
