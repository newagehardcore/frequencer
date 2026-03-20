    // ════════════════════════════════════════════════════
    // ANALOG PRESET LIBRARY
    // ════════════════════════════════════════════════════
    const ANALOG_PRESETS = [
      { name: 'Init',        oscType:'sawtooth', filterType:'lowpass',  filterFreq:8000, filterQ:1.0,  attack:0.001, decay:0.3,  sustain:0.8,  release:0.5  },
      { name: 'Acid Bass',   oscType:'sawtooth', filterType:'lowpass',  filterFreq:400,  filterQ:12.0, attack:0.001, decay:0.2,  sustain:0.0,  release:0.1  },
      { name: 'Sub Bass',    oscType:'sine',     filterType:'lowpass',  filterFreq:200,  filterQ:1.0,  attack:0.001, decay:0.5,  sustain:0.0,  release:0.15 },
      { name: 'Reese Bass',  oscType:'sawtooth', filterType:'lowpass',  filterFreq:300,  filterQ:2.0,  attack:0.001, decay:0.8,  sustain:0.7,  release:0.2  },
      { name: 'Saw Lead',    oscType:'sawtooth', filterType:'lowpass',  filterFreq:3500, filterQ:3.0,  attack:0.01,  decay:0.2,  sustain:0.6,  release:0.3  },
      { name: 'Sq Lead',     oscType:'square',   filterType:'lowpass',  filterFreq:2000, filterQ:2.0,  attack:0.005, decay:0.15, sustain:0.5,  release:0.2  },
      { name: 'Tri Lead',    oscType:'triangle', filterType:'lowpass',  filterFreq:4000, filterQ:1.5,  attack:0.005, decay:0.2,  sustain:0.55, release:0.25 },
      { name: 'PWM Keys',    oscType:'square',   filterType:'lowpass',  filterFreq:1500, filterQ:1.5,  attack:0.02,  decay:0.5,  sustain:0.7,  release:0.4  },
      { name: 'Pluck',       oscType:'sawtooth', filterType:'lowpass',  filterFreq:5000, filterQ:8.0,  attack:0.001, decay:0.18, sustain:0.0,  release:0.12 },
      { name: 'Strings',     oscType:'sawtooth', filterType:'lowpass',  filterFreq:1800, filterQ:1.0,  attack:0.35,  decay:0.4,  sustain:0.8,  release:0.9  },
      { name: 'Brass',       oscType:'sawtooth', filterType:'lowpass',  filterFreq:2500, filterQ:4.0,  attack:0.08,  decay:0.3,  sustain:0.75, release:0.2  },
      { name: 'Warm Pad',    oscType:'sawtooth', filterType:'lowpass',  filterFreq:800,  filterQ:1.5,  attack:0.6,   decay:0.5,  sustain:0.9,  release:1.5  },
      { name: 'Hollow Pad',  oscType:'triangle', filterType:'lowpass',  filterFreq:1200, filterQ:2.0,  attack:0.4,   decay:0.4,  sustain:0.85, release:1.2  },
      { name: 'Sweep',       oscType:'sawtooth', filterType:'lowpass',  filterFreq:600,  filterQ:5.0,  attack:1.0,   decay:0.6,  sustain:0.7,  release:1.8  },
      { name: 'Organ',       oscType:'sine',     filterType:'lowpass',  filterFreq:8000, filterQ:1.0,  attack:0.001, decay:2.0,  sustain:1.0,  release:0.05 },
      { name: 'Bell',        oscType:'sine',     filterType:'bandpass', filterFreq:1500, filterQ:10.0, attack:0.001, decay:2.5,  sustain:0.0,  release:1.2  },
      { name: 'HP Zap',      oscType:'sawtooth', filterType:'highpass', filterFreq:3000, filterQ:6.0,  attack:0.001, decay:0.12, sustain:0.0,  release:0.08 },
    ];

    // ════════════════════════════════════════════════════
    // DX7 PRESET LIBRARY + SYSEX PARSER
    // ════════════════════════════════════════════════════
    const DX7_PRESETS = [
      { name: 'E.PIANO 1',    harmonicity: 2.0, modulationIndex: 8.0,  attack: 0.001, decay: 1.2, sustain: 0.15, release: 0.8,  modAttack: 0.001, modDecay: 0.8,  modSustain: 0.20, modRelease: 0.5 },
      { name: 'E.PIANO 2',    harmonicity: 3.0, modulationIndex: 10.0, attack: 0.001, decay: 0.8, sustain: 0.10, release: 0.6,  modAttack: 0.001, modDecay: 0.5,  modSustain: 0.15, modRelease: 0.4 },
      { name: 'BRIGHT PIANO', harmonicity: 1.0, modulationIndex: 5.0,  attack: 0.001, decay: 1.5, sustain: 0.05, release: 1.0,  modAttack: 0.001, modDecay: 1.0,  modSustain: 0.10, modRelease: 0.7 },
      { name: 'BRASS 1',      harmonicity: 1.0, modulationIndex: 3.0,  attack: 0.05,  decay: 0.5, sustain: 0.80, release: 0.15, modAttack: 0.05,  modDecay: 0.3,  modSustain: 0.70, modRelease: 0.1 },
      { name: 'BRASS 2',      harmonicity: 2.0, modulationIndex: 4.5,  attack: 0.03,  decay: 0.4, sustain: 0.90, release: 0.12, modAttack: 0.03,  modDecay: 0.25, modSustain: 0.80, modRelease: 0.1 },
      { name: 'STRINGS',      harmonicity: 3.5, modulationIndex: 2.5,  attack: 0.20,  decay: 0.8, sustain: 0.85, release: 0.6,  modAttack: 0.10,  modDecay: 0.5,  modSustain: 0.75, modRelease: 0.4 },
      { name: 'VELO STRINGS', harmonicity: 2.0, modulationIndex: 3.0,  attack: 0.15,  decay: 0.6, sustain: 0.90, release: 0.5,  modAttack: 0.08,  modDecay: 0.4,  modSustain: 0.80, modRelease: 0.35},
      { name: 'BASS 1',       harmonicity: 2.0, modulationIndex: 6.0,  attack: 0.001, decay: 0.6, sustain: 0.00, release: 0.1,  modAttack: 0.001, modDecay: 0.35, modSustain: 0.00, modRelease: 0.08},
      { name: 'SLAP BASS',    harmonicity: 1.5, modulationIndex: 8.0,  attack: 0.001, decay: 0.3, sustain: 0.00, release: 0.08, modAttack: 0.001, modDecay: 0.2,  modSustain: 0.00, modRelease: 0.05},
      { name: 'SYN BASS',     harmonicity: 1.0, modulationIndex: 9.0,  attack: 0.001, decay: 0.4, sustain: 0.00, release: 0.1,  modAttack: 0.001, modDecay: 0.25, modSustain: 0.00, modRelease: 0.08},
      { name: 'MARIMBA',      harmonicity: 4.0, modulationIndex: 14.0, attack: 0.001, decay: 0.5, sustain: 0.00, release: 0.3,  modAttack: 0.001, modDecay: 0.3,  modSustain: 0.00, modRelease: 0.2 },
      { name: 'BELL',         harmonicity: 7.0, modulationIndex: 12.0, attack: 0.001, decay: 3.5, sustain: 0.00, release: 1.5,  modAttack: 0.001, modDecay: 2.5,  modSustain: 0.00, modRelease: 1.0 },
      { name: 'CHURCH BELL',  harmonicity: 5.0, modulationIndex: 16.0, attack: 0.001, decay: 5.0, sustain: 0.00, release: 2.5,  modAttack: 0.001, modDecay: 4.0,  modSustain: 0.00, modRelease: 2.0 },
      { name: 'VIBRAPHONE',   harmonicity: 6.0, modulationIndex: 8.0,  attack: 0.001, decay: 2.5, sustain: 0.15, release: 1.2,  modAttack: 0.001, modDecay: 2.0,  modSustain: 0.10, modRelease: 0.9 },
      { name: 'CLAVINET',     harmonicity: 3.0, modulationIndex: 12.0, attack: 0.001, decay: 0.3, sustain: 0.10, release: 0.08, modAttack: 0.001, modDecay: 0.15, modSustain: 0.00, modRelease: 0.06},
      { name: 'ORGAN 1',      harmonicity: 2.0, modulationIndex: 0.8,  attack: 0.001, decay: 2.0, sustain: 1.00, release: 0.04, modAttack: 0.001, modDecay: 2.0,  modSustain: 1.00, modRelease: 0.04},
      { name: 'ORGAN 2',      harmonicity: 4.0, modulationIndex: 1.2,  attack: 0.001, decay: 2.0, sustain: 1.00, release: 0.04, modAttack: 0.001, modDecay: 2.0,  modSustain: 1.00, modRelease: 0.04},
      { name: 'FLUTE',        harmonicity: 1.0, modulationIndex: 2.5,  attack: 0.10,  decay: 0.2, sustain: 0.90, release: 0.2,  modAttack: 0.05,  modDecay: 0.15, modSustain: 0.80, modRelease: 0.15},
      { name: 'OBOE',         harmonicity: 3.0, modulationIndex: 5.0,  attack: 0.04,  decay: 0.3, sustain: 0.85, release: 0.2,  modAttack: 0.02,  modDecay: 0.2,  modSustain: 0.70, modRelease: 0.15},
      { name: 'CHOIR',        harmonicity: 1.0, modulationIndex: 3.5,  attack: 0.35,  decay: 0.5, sustain: 0.90, release: 0.8,  modAttack: 0.20,  modDecay: 0.4,  modSustain: 0.80, modRelease: 0.6 },
      { name: 'PAD 1',        harmonicity: 0.5, modulationIndex: 2.0,  attack: 0.50,  decay: 0.8, sustain: 0.90, release: 1.0,  modAttack: 0.30,  modDecay: 0.6,  modSustain: 0.70, modRelease: 0.8 },
      { name: 'WARM PAD',     harmonicity: 0.5, modulationIndex: 1.5,  attack: 0.40,  decay: 0.7, sustain: 0.95, release: 1.2,  modAttack: 0.25,  modDecay: 0.5,  modSustain: 0.85, modRelease: 1.0 },
      { name: 'SWEEP PAD',    harmonicity: 2.0, modulationIndex: 5.0,  attack: 0.80,  decay: 1.0, sustain: 0.80, release: 1.5,  modAttack: 0.50,  modDecay: 0.8,  modSustain: 0.60, modRelease: 1.2 },
      { name: 'LEAD SYNTH',   harmonicity: 1.0, modulationIndex: 7.0,  attack: 0.01,  decay: 0.3, sustain: 0.70, release: 0.25, modAttack: 0.01,  modDecay: 0.2,  modSustain: 0.50, modRelease: 0.2 },
      { name: 'GUITAR',       harmonicity: 1.0, modulationIndex: 4.5,  attack: 0.001, decay: 1.8, sustain: 0.00, release: 0.5,  modAttack: 0.001, modDecay: 0.9,  modSustain: 0.00, modRelease: 0.3 },
      { name: 'HARMONICA',    harmonicity: 2.0, modulationIndex: 8.0,  attack: 0.04,  decay: 0.2, sustain: 0.80, release: 0.12, modAttack: 0.02,  modDecay: 0.12, modSustain: 0.60, modRelease: 0.1 },
      { name: 'METALLIC',     harmonicity: 7.0, modulationIndex: 18.0, attack: 0.001, decay: 1.5, sustain: 0.05, release: 0.8,  modAttack: 0.001, modDecay: 1.0,  modSustain: 0.00, modRelease: 0.5 },
      { name: 'PLUCK',        harmonicity: 5.0, modulationIndex: 11.0, attack: 0.001, decay: 0.4, sustain: 0.00, release: 0.2,  modAttack: 0.001, modDecay: 0.25, modSustain: 0.00, modRelease: 0.15},
      { name: 'TINE',         harmonicity: 3.0, modulationIndex: 7.0,  attack: 0.001, decay: 1.8, sustain: 0.08, release: 0.9,  modAttack: 0.001, modDecay: 1.2,  modSustain: 0.05, modRelease: 0.6 },
      { name: 'DIGITAL RAIN', harmonicity: 3.0, modulationIndex: 15.0, attack: 0.40,  decay: 0.8, sustain: 0.50, release: 1.0,  modAttack: 0.20,  modDecay: 0.6,  modSustain: 0.30, modRelease: 0.8 },
      { name: 'CRYSTAL',      harmonicity: 9.0, modulationIndex: 20.0, attack: 0.001, decay: 2.0, sustain: 0.00, release: 1.0,  modAttack: 0.001, modDecay: 1.5,  modSustain: 0.00, modRelease: 0.7 },
    ];

    function getDX7CarrierModPair(alg) {
      const pairs = [
        {ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:2},{ci:0,mi:2},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},
        {ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},
        {ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:1},{ci:0,mi:2},{ci:0,mi:2},{ci:0,mi:3},{ci:0,mi:3},{ci:0,mi:3},
        {ci:0,mi:3},{ci:0,mi:3},{ci:0,mi:3},{ci:0,mi:3},{ci:0,mi:4},{ci:0,mi:4},{ci:0,mi:4},{ci:0,mi:5},
      ];
      return pairs[Math.max(0, Math.min(31, alg))];
    }

    function parseDX7SysEx(data) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      let voiceData = null;
      if (bytes.length >= 4104 && bytes[0] === 0xF0 && bytes[1] === 0x43 && bytes[3] === 0x09) {
        voiceData = bytes.slice(6, 6 + 4096);
      } else if (bytes.length >= 4096) {
        voiceData = bytes.slice(0, 4096);
      } else { return null; }
      const presets = [];
      for (let v = 0; v < 32; v++) {
        const base = v * 128;
        let name = '';
        for (let i = 118; i < 128; i++) { const c = voiceData[base + i] & 0x7F; name += (c >= 32 && c < 127) ? String.fromCharCode(c) : ' '; }
        name = name.trim() || ('PATCH ' + (v + 1));
        const algorithm = voiceData[base + 110] & 0x1F;
        const ops = [];
        for (let op = 0; op < 6; op++) {
          const ob = base + op * 17;
          ops.push({ egR: [voiceData[ob],voiceData[ob+1],voiceData[ob+2],voiceData[ob+3]], egL: [voiceData[ob+4],voiceData[ob+5],voiceData[ob+6],voiceData[ob+7]], level: voiceData[ob+14]&0x7F, coarse: (voiceData[ob+15]&0x1F)||1 });
        }
        const { ci, mi } = getDX7CarrierModPair(algorithm);
        const car = ops[ci], mod = ops[mi];
        const t = (r, max) => Math.max(0.001, ((99 - Math.max(0, r)) / 99) * max);
        presets.push({
          name,
          harmonicity:     Math.max(0.1, Math.min(20, mod.coarse / car.coarse)),
          modulationIndex: Math.max(0,   Math.min(20, (mod.level / 99) * 20)),
          attack:    t(car.egR[0], 5.0), decay:     t(car.egR[1], 4.0), sustain: car.egL[2]/99, release:    t(car.egR[3], 5.0),
          modAttack: t(mod.egR[0], 5.0), modDecay:  t(mod.egR[1], 4.0), modSustain: mod.egL[2]/99, modRelease: t(mod.egR[3], 5.0),
        });
      }
      return presets;
    }

    // ════════════════════════════════════════════════════
    // WAVETABLE ENGINE — FFT (Corban Brook, MIT License)
    //                    WaveTable (Google Chrome Labs, BSD License)
    // ════════════════════════════════════════════════════
    function _WT_FourierTransform(bufferSize, sampleRate) {
      this.bufferSize = bufferSize; this.sampleRate = sampleRate;
      this.real = new Float32Array(bufferSize); this.imag = new Float32Array(bufferSize);
    }
    function _WT_FFT(bufferSize, sampleRate) {
      _WT_FourierTransform.call(this, bufferSize, sampleRate);
      this.reverseTable = new Uint32Array(bufferSize);
      var limit = 1, bit = bufferSize >> 1, i;
      while (limit < bufferSize) {
        for (i = 0; i < limit; i++) this.reverseTable[i + limit] = this.reverseTable[i] + bit;
        limit <<= 1; bit >>= 1;
      }
      this.sinTable = new Float32Array(bufferSize);
      this.cosTable = new Float32Array(bufferSize);
      for (i = 0; i < bufferSize; i++) {
        this.sinTable[i] = Math.sin(-Math.PI / i);
        this.cosTable[i] = Math.cos(-Math.PI / i);
      }
    }
    _WT_FFT.prototype.inverse = function(real, imag) {
      var n = this.bufferSize, i;
      real = real || this.real; imag = imag || this.imag;
      var nyquist = imag[0]; imag[0] = 0; real[n>>1] = nyquist; imag[n>>1] = 0;
      for (i = 1 + (n>>1); i < n; i++) { real[i] = real[n-i]; imag[i] = -imag[n-i]; }
      for (i = 0; i < n; i++) imag[i] *= -1;
      var revReal = new Float32Array(n), revImag = new Float32Array(n);
      for (i = 0; i < n; i++) { revReal[i] = real[this.reverseTable[i]]; revImag[i] = imag[this.reverseTable[i]]; }
      real = revReal; imag = revImag;
      var halfSize = 1, off, tr, ti, tmpReal, psr, psi, csr, csi;
      while (halfSize < n) {
        psr = this.cosTable[halfSize]; psi = this.sinTable[halfSize];
        csr = 1; csi = 0;
        for (var fftStep = 0; fftStep < halfSize; fftStep++) {
          i = fftStep;
          while (i < n) {
            off = i + halfSize;
            tr = csr * real[off] - csi * imag[off];
            ti = csr * imag[off] + csi * real[off];
            real[off] = real[i] - tr; imag[off] = imag[i] - ti;
            real[i] += tr; imag[i] += ti;
            i += halfSize << 1;
          }
          tmpReal = csr;
          csr = tmpReal * psr - csi * psi;
          csi = tmpReal * psi + csi * psr;
        }
        halfSize <<= 1;
      }
      var buf = new Float32Array(n);
      for (i = 0; i < n; i++) buf[i] = real[i] / n;
      return buf;
    };

    function _WT_WaveTable(name, audioCtx) {
      this.name = name; this.context = audioCtx; this.sampleRate = audioCtx.sampleRate;
      this.waveTableSize = 4096; this.numberOfResampleRanges = 11; this.buffers = null;
    }
    _WT_WaveTable.prototype.getRateScale = function() { return this.waveTableSize / this.sampleRate; };
    _WT_WaveTable.prototype.getNumberOfPartialsForRange = function(j) {
      var n = Math.pow(2, 1 + this.numberOfResampleRanges - j);
      if (this.sampleRate > 48000) n *= 2; return n;
    };
    _WT_WaveTable.prototype.getWaveDataForPitch = function(pitchFrequency) {
      var nyquist = 0.5 * this.sampleRate;
      var lowestFundamental = nyquist / this.getNumberOfPartialsForRange(0);
      var ratio = pitchFrequency / lowestFundamental;
      var range = ratio === 0 ? 0 : Math.floor(Math.log(ratio) / Math.LN2);
      return this.buffers[Math.max(0, Math.min(this.numberOfResampleRanges - 1, range))];
    };
    _WT_WaveTable.prototype.createBuffers = function() {
      this.buffers = [];
      var f = this.frequencyData, finalScale = 1, n = this.waveTableSize, halfN = n >> 1, i, j;
      for (j = 0; j < this.numberOfResampleRanges; j++) {
        var frame = new _WT_FFT(n, this.sampleRate);
        for (i = 0; i < halfN; i++) { frame.real[i] = n * f.real[i]; frame.imag[i] = n * f.imag[i]; }
        var npartials = this.getNumberOfPartialsForRange(j);
        for (i = npartials + 1; i < halfN; i++) { frame.real[i] = 0; frame.imag[i] = 0; }
        if (npartials < halfN) frame.imag[0] = 0;
        frame.real[0] = 0;
        if (j === 0) {
          var power = 0;
          for (i = 1; i < halfN; i++) { var x = frame.real[i], y = frame.imag[i]; power += x*x + y*y; }
          power = Math.sqrt(power) / n;
          finalScale = power > 0 ? 0.5 / power : 1;
        }
        var data = frame.inverse();
        var abuf = this.context.createBuffer(1, data.length, this.sampleRate);
        var ch = abuf.getChannelData(0);
        for (i = 0; i < data.length; i++) ch[i] = finalScale * data[i];
        this.buffers[j] = abuf;
      }
    };

    // Cache: name → _WT_WaveTable; pending: name → [callbacks]
    const _wtPending = {};
    function _wtLoadWave(name, callback) {
      if (_wtCache[name]) { callback(_wtCache[name]); return; }
      if (_wtPending[name]) { _wtPending[name].push(callback); return; }
      _wtPending[name] = [callback];
      fetch(WT_BASE_URL + encodeURIComponent(name))
        .then(r => r.text())
        .then(txt => {
          const f = eval('(' + txt + ')');
          const ctx = Tone.context.rawContext;
          const wt = new _WT_WaveTable(name, ctx);
          const len = f.real.length;
          wt.frequencyData = { real: new Float32Array(len), imag: new Float32Array(len) };
          for (let i = 0; i < len; i++) { wt.frequencyData.real[i] = f.real[i]; wt.frequencyData.imag[i] = f.imag[i]; }
          wt.createBuffers();
          _wtCache[name] = wt;
          (_wtPending[name] || []).forEach(cb => cb(wt));
          delete _wtPending[name];
        })
        .catch(e => { console.warn('WT load failed:', name, e); delete _wtPending[name]; });
    }

    // ════════════════════════════════════════════════════
    // WAVETABLE PRESETS (Google Chrome Labs wave-tables)
    // ════════════════════════════════════════════════════
    const WT_BASE_URL = 'https://googlechromelabs.github.io/web-audio-samples/demos/wavetable-synth/wave-tables/';
    // Exact filenames as they appear on the Google Chrome Labs server
    const WT_NAMES = [
      '01_Saw','02_Triangle','03_Square','04_Noise','05_Pulse',
      '06_Warm_Saw','07_Warm_Triangle','08_Warm_Square','09_Dropped_Saw','10_Dropped_Square',
      '11_TB303_Square','Bass','Bass_Amp360','Bass_Fuzz','Bass_Fuzz_ 2','Bass_Sub_Dub','Bass_Sub_Dub_2',
      'Brass','Brit_Blues','Brit_Blues_Driven','Buzzy_1','Buzzy_2','Celeste','Chorus_Strings',
      'Dissonant Piano','Dissonant_1','Dissonant_2','Dyna_EP_Bright','Dyna_EP_Med','Ethnic_33',
      'Full_1','Full_2','Guitar_Fuzz','Harsh','Mkl_Hard','Organ_2','Organ_3',
      'Phoneme_ah','Phoneme_bah','Phoneme_ee','Phoneme_o','Phoneme_ooh','Phoneme_pop_ahhhs',
      'Piano','Putney_Wavering','Throaty','Trombone','Twelve String Guitar 1','Twelve_OpTines',
      'Wurlitzer','Wurlitzer_2',
    ];
    // Cache for loaded _WT_WaveTable objects keyed by wave name
    const _wtCache = {};

