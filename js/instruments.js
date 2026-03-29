    // SYNTH INSTRUMENTS
    // ════════════════════════════════════════════════════

    class SynthInstrument {
      constructor(id, name, x, y) {
        this.id = id; this.name = name; this.x = x; this.y = y;
        this.color = nextColor();
        this.muted = false;
        this._currentDb = 0;
        this.synthType = 'base';

        this._currentDb = 0;
        this._currentPan = 0;
        this._poly = null; this._filter = null;
        this.currentPreset = 0; this._customPresets = []; this._usingCustom = false;

        this._outputTap = new Tone.Gain(1).connect(masterSamplesGain);
        this.vol      = new Tone.Volume(0).connect(this._outputTap);
        this.meter    = new Tone.Meter({ channelCount: 2, normalRange: false, smoothing: 0.85 });
        this.vol.connect(this.meter);
        this.pan      = new Tone.Panner(0).connect(this.vol);
        this._analyser = new Tone.Analyser('waveform', 128);
        this.vol.connect(this._analyser);

        this.fxCatalog = [
          { id: 'eq', name: 'EQ' },
          { id: 'reverb', name: 'Reverb' },
          { id: 'delay', name: 'Delay' },
          { id: 'tremolo', name: 'Tremolo' },
          { id: 'dist', name: 'Distortion' },
          { id: 'chorus', name: 'Chorus' },
          { id: 'phaser', name: 'Phaser' },
          { id: 'bitcrush', name: 'Bit Crush' },
        ];
        this.fxChain = [];
        this._fxUidCounter = 0;
      }
      updateVol() { this.vol.volume.value = this._effectiveDb(); }
      updatePan() { this.pan.pan.value = this._currentPan; }
      _noteHighlight(note, on) {}  // wired up by buildPianoKeyboard
      triggerAtTime(note, dur, time, vel) {
        this._noteHighlight(note, true);
        try { if (this._poly) this._poly.triggerAttackRelease(note, dur, time, vel); } catch(e) {}
        setTimeout(() => this._noteHighlight(note, false), (dur + 0.05) * 1000);
      }
      _effectiveDb() {
        if (this.muted) return -Infinity;
        if (soloId !== null && soloId !== this.id) return -Infinity;
        return this._currentDb;
      }
      _renderTile() {
        const tile = document.getElementById('t' + this.id);
        if (!tile) return;
        tile.classList.toggle('muted', this.muted);
        tile.style.borderColor = '';
        const mbtn = tile.querySelector('.tile-mbtn');
        if (mbtn) mbtn.classList.toggle('mute-on', this.muted);
      }
      noteOn(note, vel = 100) {
        if (this._poly) this._poly.triggerAttack(note, Tone.now(), vel / 127);
      }
      noteOff(note) {
        if (this._poly) this._poly.triggerRelease(note, Tone.now());
      }
      allNotesOff() {
        if (this._poly) try { this._poly.releaseAll(); } catch(e) {}
      }
      updateOscType()  { if (this._poly && this.synthType === 'analog') try { this._poly.set({ oscillator: { type: this.oscType } }); } catch(e) {} }
      updateEnvelope() { if (this._poly) this._poly.set({ envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release } }); }
      updateFilter()   { if (this._filter) this._filter.set({ frequency: this.filterFreq, Q: this.filterQ, type: this.filterType }); }
      updateFMParams() { if (this._poly && this.synthType === 'fm') this._poly.set({ harmonicity: this.harmonicity, modulationIndex: this.modulationIndex }); }
      updateModEnv()   { if (this._poly && this.synthType === 'fm') this._poly.set({ modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease } }); }
      updateDetune()   { if (this._poly) try { this._poly.set({ detune: this.detune || 0 }); } catch(e) {} }
      _applyVol() { this.vol.volume.value = this._effectiveDb(); }
      _applyPan() { this.pan.pan.value = this._currentPan; }
      loadAnalogPreset(p) {
        Object.assign(this, { oscType: p.oscType, filterType: p.filterType, filterFreq: p.filterFreq, filterQ: p.filterQ, attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release });
        this.updateOscType(); this.updateFilter(); this.updateEnvelope();
      }
      loadFMPreset(preset) {
        Object.assign(this, { harmonicity: preset.harmonicity, modulationIndex: preset.modulationIndex, attack: preset.attack, decay: preset.decay, sustain: preset.sustain, release: preset.release, modAttack: preset.modAttack, modDecay: preset.modDecay, modSustain: preset.modSustain, modRelease: preset.modRelease });
        if (this._poly) this._poly.set({ harmonicity: this.harmonicity, modulationIndex: this.modulationIndex, envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release }, modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease } });
      }
      loadSysEx(data) {
        const presets = parseDX7SysEx(data);
        if (!presets || !presets.length) return false;
        this._customPresets = presets; this._usingCustom = true; this.currentPreset = 0;
        this.loadFMPreset(presets[0]); return true;
      }
      _disposeTypeNodes() {
        // Stop wavetable native voices (supports both old 2-src and new 4-src structure)
        if (this._voices) {
          const ctx = Tone.context.rawContext; const now = ctx.currentTime;
          for (const v of this._voices) {
            try { v.envGain.gain.cancelScheduledValues(now); v.envGain.gain.setValueAtTime(0, now); } catch(e) {}
            ['srcA','srcAoct','srcB','srcBoct'].forEach(k => { try { v[k].stop(now + 0.001); } catch(e) {} });
          }
          this._voices = null;
        }
        if (this._wtFilter) { try { this._wtFilter.disconnect(); } catch(e) {} this._wtFilter = null; }
        if (this._wtBridge) { try { this._wtBridge.dispose(); } catch(e) {} this._wtBridge = null; }
        if (this._poly) { try { this._poly.releaseAll(); this._poly.dispose(); } catch(e) {} this._poly = null; }
        if (this._filter) { try { this._filter.dispose(); } catch(e) {} this._filter = null; }
        // Karplus voices
        if (this._kpVoices) {
          const _kctx = Tone.context.rawContext; const _know = _kctx.currentTime;
          for (const v of this._kpVoices) {
            try { v.envGain.gain.cancelScheduledValues(_know); v.envGain.gain.setValueAtTime(0, _know); } catch(e) {}
            try { v.src.stop(_know + 0.001); } catch(e) {}
          }
          this._kpVoices = null;
        }
        if (this._kpBridge) { try { this._kpBridge.dispose(); } catch(e) {} this._kpBridge = null; }
        // Rompler
        if (this._smplr) { try { this._smplr.stop(); } catch(e) {} this._smplr = null; }
        if (this._romplerBridge) { try { this._romplerBridge.dispose(); } catch(e) {} this._romplerBridge = null; }
      }
      // Shared smplr loader — handles both SF1 (Soundfont) and SF2 (Soundfont2Sampler)
      _romplerLoad() {
        const updateStatus = txt => {
          const cardInfo = openCards.get(this.id);
          if (cardInfo) { cardInfo.el.querySelectorAll('.rompler-status').forEach(b => { b.textContent = txt; }); }
        };
        const getSmplr = () => window._smplrLib
          ? Promise.resolve(window._smplrLib)
          : import('https://unpkg.com/smplr/dist/index.mjs').then(m => { window._smplrLib = m; return m; });
        if (this._smplr) { try { this._smplr.stop(); } catch(e) {} this._smplr = null; }
        this._smplrLoading = true;
        updateStatus('Loading…');

        if (this.romplerType === 'sf2') {
          const getSf2 = () => window._sf2Lib
            ? Promise.resolve(window._sf2Lib)
            : import('https://esm.sh/soundfont2').then(m => { window._sf2Lib = m; return m; });
          Promise.all([getSmplr(), getSf2()]).then(([smplrMod, sf2Mod]) => {
            const { Soundfont2Sampler } = smplrMod;
            const SoundFont2Cls = sf2Mod.SoundFont2 || sf2Mod.default?.SoundFont2 || sf2Mod.default;
            try {
              const sampler = new Soundfont2Sampler(Tone.context.rawContext, {
                url: this.romplerSf2Url,
                createSoundfont: (data) => new SoundFont2Cls(data),
                destination: this._romplerBridge.input,
              });
              sampler.load.then(() => {
                if (this.synthType !== 'rompler') return;
                this._smplr = sampler;
                this._sf2InstrumentNames = sampler.instrumentNames || [];
                this._smplrLoading = false;
                updateStatus(this._sf2InstrumentNames.length + ' inst');
                if (!this.romplerSf2Instrument || !this._sf2InstrumentNames.includes(this.romplerSf2Instrument)) {
                  this.romplerSf2Instrument = this._sf2InstrumentNames[0] || null;
                }
                if (this.romplerSf2Instrument) sampler.loadInstrument(this.romplerSf2Instrument).catch(e => {});
                this._refreshSf2List?.();
              }).catch(e => { this._smplrLoading = false; updateStatus('Error'); console.error('SF2 load:', e); });
            } catch(e) { this._smplrLoading = false; updateStatus('Error'); console.error('SF2 init:', e); }
          }).catch(e => { this._smplrLoading = false; updateStatus('Error'); console.error('SF2 deps:', e); });
        } else {
          getSmplr().then(mod => {
            const { Soundfont } = mod;
            try {
              const sf = new Soundfont(Tone.context.rawContext, {
                instrument: this.romplerInstrument,
                kit: this.romplerBank,
                destination: this._romplerBridge.input,
              });
              sf.load.then(() => {
                if (this.synthType !== 'rompler') return;
                this._smplr = sf;
                this._smplrLoading = false;
                updateStatus('Ready');
              }).catch(e => { this._smplrLoading = false; updateStatus('Error'); console.error('SF1 load:', e); });
            } catch(e) { this._smplrLoading = false; updateStatus('Error'); console.error('SF1 init:', e); }
          }).catch(e => { this._smplrLoading = false; updateStatus('Error'); console.error('smplr import:', e); });
        }
      }
      changeSynthType(newType) {
        if (this.synthType === newType) return;
        this._disposeTypeNodes();
        if (newType === 'analog') {
          this.oscType = 'sawtooth'; this.filterType = 'lowpass'; this.filterFreq = 2500;
          this.filterQ = 1.0; this.portamento = 0; this.currentPreset = 0;
          this.attack = 0.01; this.decay = 0.15; this.sustain = 0.6; this.release = 0.4;
          this._glideSynth = null; this._glideLastFreq = null;
          this.synthType = 'analog';
          this._filter = new Tone.Filter({ type: this.filterType, frequency: this.filterFreq, Q: this.filterQ }).connect(this.pan);
          this._poly = new Tone.PolySynth(Tone.Synth, { oscillator: { type: this.oscType }, envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release } }).connect(this._filter);
          this._poly.maxPolyphony = 16;
          ['noteOn','noteOff','allNotesOff','triggerAtTime','updatePortamento','updateEnvelope','updateOscType'].forEach(m => {
            this[m] = AnalogSynth.prototype[m].bind(this);
          });
        } else if (newType === 'fm') {
          this.harmonicity = 3.0; this.modulationIndex = 8.0;
          this.attack = 0.001; this.decay = 1.2; this.sustain = 0.15; this.release = 0.8;
          this.modAttack = 0.001; this.modDecay = 0.8; this.modSustain = 0.2; this.modRelease = 0.5;
          this.currentPreset = 0; this._customPresets = []; this._usingCustom = false;
          this.portamento = 0; this._glideSynth = null; this._glideLastFreq = null;
          this.synthType = 'fm';
          this._poly = new Tone.PolySynth(Tone.FMSynth, { harmonicity: this.harmonicity, modulationIndex: this.modulationIndex, portamento: 0, envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release }, modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease } }).connect(this.pan);
          this._poly.maxPolyphony = 16;
          ['noteOn','noteOff','allNotesOff','triggerAtTime','updatePortamento','updateEnvelope','updateFMParams','updateModEnv'].forEach(m => {
            this[m] = FMSynthInstrument.prototype[m].bind(this);
          });
          if (typeof DX7_PRESETS !== 'undefined') this.loadFMPreset(DX7_PRESETS[0]);
        } else if (newType === 'wavetable') {
          this.synthType = 'wavetable';
          this.currentWave = 0; this.detune1 = 4.5; this.detune2 = -2.5;
          this.osc2octave = 0; this.width = 0.6;
          this.cutoff = 0.2; this.resonance = 4.0; this.envAmount = 0.4;
          this.filterAttack = 0.056; this.filterDecay = 0.991;
          this.attack = 0.056; this.decay = 0.5; this.sustain = 0.7; this.release = 0.3;
          this.portamento = 0; this._glideLastFreq = null;
          this._wt = null; this._voices = [];
          this._wtBridge = new Tone.Gain(0.25).connect(this.pan);
          // Bind WavetableSynth voice methods onto this instance
          ['noteOn','noteOff','allNotesOff','_releaseVoice','_stopVoice','_makeVoice','_cutoffHz',
           'updateWave','updateFilter','updateDetune','updateEnvelope','updatePortamento','triggerAtTime'].forEach(m => {
            this[m] = WavetableSynth.prototype[m].bind(this);
          });
          this.updateWave();
        } else if (newType === 'karplus') {
          this.synthType = 'karplus';
          this.characterVariation = 0.5; this.stringDamping = 0.5;
          this.stringDampingVariation = 0.25; this.stringDampingCalc = 'magic';
          this.stringTension = 0.0; this.pluckDamping = 0.5;
          this.pluckDampingVariation = 0.25; this.stereoSpread = 0.2;
          this.bodyResonation = 'simple';
          this.portamento = 0; this._glideLastFreq = null;
          this._kpVoices = [];
          this._kpBridge = new Tone.Gain(0.5).connect(this.pan);
          ['noteOn','noteOff','allNotesOff','triggerAtTime','updatePortamento',
           '_lp','_smoothingFactor','_pluckCoeff','_generateBuffer','_makeVoice'].forEach(m => {
            this[m] = KarplusSynth.prototype[m].bind(this);
          });
        } else if (newType === 'rompler') {
          this.synthType = 'rompler';
          this.romplerType = this.romplerType || 'sf1';
          this.romplerBank = this.romplerBank || 'MusyngKite';
          this.romplerInstrument = this.romplerInstrument || 'acoustic_grand_piano';
          this.romplerSf2Url = this.romplerSf2Url || ROMPLER_SF2_FILES[0].url;
          this.romplerSf2Instrument = this.romplerSf2Instrument || null;
          this._sf2InstrumentNames = this._sf2InstrumentNames || [];
          this.release = 1.5;
          this.filterType = 'lowpass'; this.filterFreq = 20000; this.filterQ = 1.0;
          this._smplr = null; this._smplrLoading = false; this._refreshSf2List = null;
          this.portamento = 0; this._glideShifter = null; this._glideRaf = null; this._glideLastMidi = null;
          this._filter = new Tone.Filter({ type: this.filterType, frequency: this.filterFreq, Q: this.filterQ }).connect(this.pan);
          this._romplerBridge = new Tone.Gain(1).connect(this._filter);
          ['noteOn','noteOff','allNotesOff','triggerAtTime','updateFilter','updatePortamento'].forEach(m => {
            this[m] = RomplerInstrument.prototype[m].bind(this);
          });
          this._romplerLoad();
        }
        const badge = document.querySelector(`#t${this.id} .tile-synth-badge`);
        if (badge) badge.textContent = newType.toUpperCase();
      }
      rebuildFxChain() {
        try { this.vol.disconnect(); } catch(e) {}
        try { this._outputTap.disconnect(); } catch(e) {}
        for (const inst of this.fxChain) {
          try { (inst.outputNode || inst.node).disconnect(); } catch(e) {}
        }
        let prev = this.vol;
        for (const inst of this.fxChain) {
          if (!inst.node) continue;
          prev.connect(inst.node);
          prev = inst.outputNode || inst.node;
        }
        prev.connect(this._outputTap);
        this._outputTap.connect(masterSamplesGain);
        this.vol.connect(this.meter);
        this.vol.connect(this._analyser);
      }

      _fxDefaultParams(type) {
        const d = {
          reverb:   { mode: 'algorithmic', roomSize: 0.7, dampening: 3000, decay: 2.5, preDelay: 0.01, shimmerAmount: 0.35, shimmerPitch: 12, irType: 'hall', irDecay: 2.0, irPreDelay: 0.005, tailFilterType: 'none', tailFilterFreq: 20000, wet: 0.4 },
          delay:    { mode: 'mono', delayTime: 0.25, feedback: 0.35, wet: 0.4, filterFreq: 2000, filterType: 'lowpass', syncMode: false, subdivision: '4n' },
          tremolo:  { frequency: 4, depth: 0.7, wet: 1 },
          dist:     { distortion: 0.4, wet: 0.8 },
          chorus:   { frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0.5 },
          phaser:   { frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0.6 },
          bitcrush: { bits: 8, wet: 0.8 },
        };
        return { ...(d[type] || {}) };
      }

      _createFxNode(type, params) {
        switch (type) {
          case 'delay':    return new Tone.FeedbackDelay({ delayTime: params.delayTime, feedback: params.feedback, wet: params.wet });
          case 'tremolo':  return new Tone.Tremolo({ frequency: params.frequency, depth: params.depth, wet: params.wet }).start();
          case 'dist':     return new Tone.Distortion({ distortion: params.distortion, wet: params.wet });
          case 'chorus':   return new Tone.Chorus({ frequency: params.frequency, delayTime: params.delayTime, depth: params.depth, wet: params.wet }).start();
          case 'phaser':   return new Tone.Phaser({ frequency: params.frequency, octaves: params.octaves, baseFrequency: params.baseFrequency, wet: params.wet });
          case 'bitcrush': return new Tone.BitCrusher({ bits: params.bits, wet: params.wet });
          default: return null;
        }
      }

      _createEqInstance() {
        const defaultBands = [
          { type: 'highpass', freq: 20, q: 0.707 },
          { type: 'peaking', freq: 200, gain: 0, q: 1 },
          { type: 'peaking', freq: 1000, gain: 0, q: 1 },
          { type: 'peaking', freq: 8000, gain: 0, q: 1 },
          { type: 'lowpass', freq: 22050, q: 0.707 },
        ];
        const bands = defaultBands.map(b => ({ ...b }));
        const filters = bands.map(b => {
          const f = new Tone.Filter({ type: b.type, frequency: b.freq, Q: b.q });
          if (b.type === 'peaking') f.gain.value = 0;
          return f;
        });
        for (let i = 3; i >= 0; i--) filters[i].connect(filters[i + 1]);
        const applyBand = (i) => {
          const f = filters[i], b = bands[i];
          f.frequency.value = b.freq;
          f.Q.value = b.q;
          if (b.type === 'peaking') f.gain.value = b.gain || 0;
        };
        return { node: filters[0], outputNode: filters[4], bands, filters, applyBand };
      }

      addFxInstance(type) {
        let inst;
        if (type === 'eq') {
          const eq = this._createEqInstance();
          inst = { uid: ++this._fxUidCounter, type: 'eq', node: eq.node, outputNode: eq.outputNode, eqData: eq, params: {}, postFader: true };
        } else if (type === 'reverb') {
          const params = this._fxDefaultParams(type);
          const created = _createReverbNodes(params);
          inst = { uid: ++this._fxUidCounter, type, node: created.node, outputNode: created.outputNode, fxLfoNode: created.fxLfoNode, reverbData: created.reverbData, params, postFader: true };
        } else if (type === 'delay') {
          const params = this._fxDefaultParams(type);
          const created = _createDelayNodes(params);
          inst = { uid: ++this._fxUidCounter, type, node: created.node, outputNode: created.outputNode, fxLfoNode: created.fxLfoNode, delayData: created.delayData, params, postFader: true };
        } else {
          const params = this._fxDefaultParams(type);
          const node = this._createFxNode(type, params);
          if (!node) return null;
          inst = { uid: ++this._fxUidCounter, type, node, params, postFader: true };
        }
        this.fxChain.push(inst);
        this.rebuildFxChain();
        return inst;
      }

      removeFxInstance(uid) {
        const idx = this.fxChain.findIndex(i => i.uid === uid);
        if (idx < 0) return;
        const inst = this.fxChain[idx];
        if (inst.eqData) {
          for (const f of inst.eqData.filters) { try { f.disconnect(); f.dispose(); } catch(e) {} }
        } else if (inst.reverbData) {
          _disposeReverbData(inst.reverbData);
        } else if (inst.delayData) {
          _disposeDelayData(inst.delayData);
        } else {
          try { inst.node.disconnect(); } catch(e) {}
          try { inst.node.dispose(); } catch(e) {}
        }
        this.fxChain.splice(idx, 1);
        this.rebuildFxChain();
      }

      dispose() {
        if (this._filter) { try { this._filter.dispose(); } catch(e) {} this._filter = null; }
        for (const inst of this.fxChain) {
          if (inst.eqData) { for (const f of inst.eqData.filters) { try { f.disconnect(); f.dispose(); } catch(e) {} } }
          else { try { inst.node.disconnect(); inst.node.dispose(); } catch(e) {} }
        }
        try { this.pan.dispose(); } catch(e) {}
        try { this.vol.dispose(); } catch(e) {}
        try { this._outputTap.dispose(); } catch(e) {}
        try { this.meter.dispose(); } catch(e) {}
        try { this._analyser.dispose(); } catch(e) {}
      }
    }

    class AnalogSynth extends SynthInstrument {
      constructor(id, name, x, y) {
        super(id, name, x, y);
        this.synthType    = 'analog';
        this.oscType      = 'sawtooth';
        this.attack       = 0.01;
        this.decay        = 0.15;
        this.sustain      = 0.6;
        this.release      = 0.4;
        this.filterType   = 'lowpass';
        this.filterFreq   = 2500;
        this.filterQ      = 1.0;
        this.portamento   = 0;
        this.currentPreset = 0;
        this._glideSynth   = null;
        this._glideLastFreq = null;

        this._filter = new Tone.Filter({ type: this.filterType, frequency: this.filterFreq, Q: this.filterQ }).connect(this.pan);
        this._poly = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: this.oscType },
          envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release },
          portamento: 0,
        }).connect(this._filter);
        this._poly.maxPolyphony = 16;
      }
      get presetList() { return ANALOG_PRESETS; }
      loadPreset(p) {
        Object.assign(this, { oscType: p.oscType, filterType: p.filterType, filterFreq: p.filterFreq, filterQ: p.filterQ, attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release });
        this.updateOscType(); this.updateFilter(); this.updateEnvelope();
      }
      noteOn(note, vel = 100) {
        const now = Tone.now();
        const targetFreq = Tone.Frequency(note).toFrequency();
        if (this.portamento > 0 && this._glideSynth) {
          // triggerAttack sets frequency.setValueAtTime(targetFreq, now) internally.
          // We then override with setValueAtTime(lastFreq, now) — same-time last-write wins.
          this._glideSynth.triggerAttack(note, now, vel / 127);
          if (this._glideLastFreq != null) {
            this._glideSynth.frequency.setValueAtTime(this._glideLastFreq, now);
            this._glideSynth.frequency.exponentialRampToValueAtTime(Math.max(1e-6, targetFreq), now + this.portamento);
          }
          this._glideLastFreq = targetFreq;
        } else {
          if (this._poly) this._poly.triggerAttack(note, now, vel / 127);
        }
      }
      noteOff(note) {
        if (this.portamento > 0 && this._glideSynth) {
          this._glideSynth.triggerRelease(Tone.now());
        } else {
          if (this._poly) this._poly.triggerRelease(note, Tone.now());
        }
      }
      allNotesOff() {
        if (this._poly) try { this._poly.releaseAll(); } catch(e) {}
        if (this._glideSynth) try { this._glideSynth.triggerRelease(Tone.now()); } catch(e) {}
      }
      triggerAtTime(note, dur, time, vel) {
        this._noteHighlight(note, true);
        const targetFreq = Tone.Frequency(note).toFrequency();
        if (this.portamento > 0 && this._glideSynth) {
          // Same-time override: triggerAttack sets freq=targetFreq at time, we overwrite with lastFreq.
          this._glideSynth.triggerAttack(note, time, vel);
          if (this._glideLastFreq != null) {
            this._glideSynth.frequency.setValueAtTime(this._glideLastFreq, time);
            this._glideSynth.frequency.exponentialRampToValueAtTime(Math.max(1e-6, targetFreq), time + this.portamento);
          }
          this._glideSynth.triggerRelease(time + dur);
        } else {
          try { if (this._poly) this._poly.triggerAttackRelease(note, dur, time, vel); } catch(e) {}
        }
        this._glideLastFreq = targetFreq;
        setTimeout(() => this._noteHighlight(note, false), (dur + 0.05) * 1000);
      }
      updateOscType() {
        if (this._poly && this._filter) try { this._poly.set({ oscillator: { type: this.oscType } }); } catch(e) {}
        if (this._glideSynth) try { this._glideSynth.set({ oscillator: { type: this.oscType } }); } catch(e) {}
      }
      updateEnvelope() {
        if (this._poly) this._poly.set({ envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release } });
        if (this._glideSynth) this._glideSynth.set({ envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release } });
      }
      updateFilter() { if (this._filter) this._filter.set({ frequency: this.filterFreq, Q: this.filterQ, type: this.filterType }); }
      updatePortamento() {
        if (!this._filter) return;
        if (this.portamento > 0) {
          if (!this._glideSynth) {
            this._glideSynth = new Tone.Synth({
              oscillator: { type: this.oscType },
              envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release },
              portamento: 0,
            }).connect(this._filter);
          }
        } else {
          if (this._glideSynth) {
            try { this._glideSynth.triggerRelease(); } catch(e) {}
            try { this._glideSynth.dispose(); } catch(e) {}
            this._glideSynth = null;
          }
          this._glideLastFreq = null;
        }
      }
      dispose() {
        this.allNotesOff();
        if (this._glideSynth) { try { this._glideSynth.dispose(); } catch(e) {} this._glideSynth = null; }
        try { this._poly.dispose(); } catch(e) {}
        try { this._filter.dispose(); } catch(e) {}
        super.dispose();
      }
    }

    class FMSynthInstrument extends SynthInstrument {
      constructor(id, name, x, y) {
        super(id, name, x, y);
        this.synthType       = 'fm';
        this.harmonicity     = 3.0;
        this.modulationIndex = 8.0;
        this.attack          = 0.001;
        this.decay           = 1.2;
        this.sustain         = 0.15;
        this.release         = 0.8;
        this.modAttack       = 0.001;
        this.modDecay        = 0.8;
        this.modSustain      = 0.2;
        this.modRelease      = 0.5;
        this.currentPreset   = 0;
        this._customPresets  = [];
        this._usingCustom    = false;
        this.portamento      = 0;
        this._glideSynth     = null;
        this._glideLastFreq  = null;

        this._poly = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: this.harmonicity,
          modulationIndex: this.modulationIndex,
          portamento: 0,
          envelope:           { attack: this.attack,    decay: this.decay,    sustain: this.sustain,    release: this.release },
          modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease },
        }).connect(this.pan);
        this._poly.maxPolyphony = 16;
        this.loadPreset(DX7_PRESETS[0]);
      }
      noteOn(note, vel = 100) {
        const now = Tone.now();
        const targetFreq = Tone.Frequency(note).toFrequency();
        if (this.portamento > 0 && this._glideSynth) {
          // FMSynth has no built-in portamento. triggerAttack sets frequency.setValueAtTime(targetFreq, now).
          // We then override with setValueAtTime(lastFreq, now) — same-time last-write wins per Web Audio spec.
          this._glideSynth.triggerAttack(note, now, vel / 127);
          if (this._glideLastFreq != null) {
            this._glideSynth.frequency.setValueAtTime(this._glideLastFreq, now);
            this._glideSynth.frequency.exponentialRampToValueAtTime(Math.max(1e-6, targetFreq), now + this.portamento);
          }
          this._glideLastFreq = targetFreq;
        } else {
          if (this._poly) this._poly.triggerAttack(note, now, vel / 127);
        }
      }
      noteOff(note) {
        if (this.portamento > 0 && this._glideSynth) {
          this._glideSynth.triggerRelease(Tone.now());
        } else {
          if (this._poly) this._poly.triggerRelease(note, Tone.now());
        }
      }
      allNotesOff() {
        if (this._poly) try { this._poly.releaseAll(); } catch(e) {}
        if (this._glideSynth) try { this._glideSynth.triggerRelease(Tone.now()); } catch(e) {}
      }
      triggerAtTime(note, dur, time, vel) {
        this._noteHighlight(note, true);
        const targetFreq = Tone.Frequency(note).toFrequency();
        if (this.portamento > 0 && this._glideSynth) {
          // Same-time override: triggerAttack sets freq=targetFreq at time, we overwrite with lastFreq
          // then schedule exponential ramp. No cancelScheduledValues needed.
          this._glideSynth.triggerAttack(note, time, vel);
          if (this._glideLastFreq != null) {
            this._glideSynth.frequency.setValueAtTime(this._glideLastFreq, time);
            this._glideSynth.frequency.exponentialRampToValueAtTime(Math.max(1e-6, targetFreq), time + this.portamento);
          }
          this._glideSynth.triggerRelease(time + dur);
        } else {
          try { if (this._poly) this._poly.triggerAttackRelease(note, dur, time, vel); } catch(e) {}
        }
        this._glideLastFreq = targetFreq;
        setTimeout(() => this._noteHighlight(note, false), (dur + 0.05) * 1000);
      }
      updateFMParams() {
        if (this._poly) this._poly.set({ harmonicity: this.harmonicity, modulationIndex: this.modulationIndex });
        if (this._glideSynth) try { this._glideSynth.set({ harmonicity: this.harmonicity, modulationIndex: this.modulationIndex }); } catch(e) {}
      }
      updateEnvelope() {
        if (this._poly) this._poly.set({ envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release } });
        if (this._glideSynth) this._glideSynth.set({ envelope: { attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release } });
      }
      updateModEnv() {
        if (this._poly) this._poly.set({ modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease } });
        if (this._glideSynth) try { this._glideSynth.set({ modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease } }); } catch(e) {}
      }
      updatePortamento() {
        if (this.portamento > 0) {
          if (!this._glideSynth) {
            this._glideSynth = new Tone.FMSynth({
              harmonicity: this.harmonicity,
              modulationIndex: this.modulationIndex,
              envelope:           { attack: this.attack,    decay: this.decay,    sustain: this.sustain,    release: this.release },
              modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease },
              portamento: 0,
            }).connect(this.pan);
          }
        } else {
          if (this._glideSynth) {
            try { this._glideSynth.triggerRelease(); } catch(e) {}
            try { this._glideSynth.dispose(); } catch(e) {}
            this._glideSynth = null;
          }
          this._glideLastFreq = null;
        }
      }
      get presetList() { return this._usingCustom ? this._customPresets : DX7_PRESETS; }
      loadPreset(preset) {
        Object.assign(this, {
          harmonicity: preset.harmonicity, modulationIndex: preset.modulationIndex,
          attack: preset.attack, decay: preset.decay, sustain: preset.sustain, release: preset.release,
          modAttack: preset.modAttack, modDecay: preset.modDecay, modSustain: preset.modSustain, modRelease: preset.modRelease,
        });
        const fmPresetParams = {
          harmonicity: this.harmonicity, modulationIndex: this.modulationIndex,
          envelope:           { attack: this.attack,    decay: this.decay,    sustain: this.sustain,    release: this.release },
          modulationEnvelope: { attack: this.modAttack, decay: this.modDecay, sustain: this.modSustain, release: this.modRelease },
        };
        this._poly.set(fmPresetParams);
        if (this._glideSynth) try { this._glideSynth.set(fmPresetParams); } catch(e) {}
      }
      loadSysEx(data) {
        const presets = parseDX7SysEx(data);
        if (!presets || !presets.length) return false;
        this._customPresets = presets;
        this._usingCustom = true;
        this.currentPreset = 0;
        this.loadPreset(presets[0]);
        return true;
      }
      dispose() {
        this.allNotesOff();
        if (this._glideSynth) { try { this._glideSynth.dispose(); } catch(e) {} this._glideSynth = null; }
        try { this._poly.dispose(); } catch(e) {}
        super.dispose();
      }
    }

    class WavetableSynth extends SynthInstrument {
      constructor(id, name, x, y) {
        super(id, name, x, y);
        this.synthType     = 'wavetable';
        this.currentWave   = 0;
        // Oscillator
        this.detune1       = 4.5;    // cents — osc pair 1 spread
        this.detune2       = -2.5;   // cents — osc pair 2 spread
        this.osc2octave    = 0;      // semitones for 2nd osc pair (0 = unison)
        this.width         = 0.6;    // stereo spread 0–1
        // Filter + envelope
        this.cutoff        = 0.2;    // normalized 0–1 (log-mapped to Hz)
        this.resonance     = 4.0;    // filter Q
        this.envAmount     = 0.4;    // filter env depth (0–1)
        this.filterAttack  = 0.056;
        this.filterDecay   = 0.991;
        // Amplitude envelope
        this.attack        = 0.056;
        this.decay         = 0.5;
        this.sustain       = 0.7;
        this.release       = 0.3;
        // Glide
        this.portamento    = 0;
        this._glideLastFreq = null;

        this._voices       = [];
        this._wt           = null;

        // Bridge from native chain into Tone.js pan → vol → master
        // Gain of 0.25: 4 oscillators sum into envGain, so divide by 4 to prevent clipping
        this._wtBridge = new Tone.Gain(0.25).connect(this.pan);
        this.updateWave();
      }

      _cutoffHz() { return 20 * Math.pow(2, this.cutoff * 10); }

      _makeVoice(freq, time) {
        const ctx = Tone.context.rawContext;
        const wt  = this._wt;
        const pitchRate = freq * wt.getRateScale();
        const d1 = Math.pow(2,  this.detune1 / 1200);
        const d2 = Math.pow(2,  this.detune2 / 1200);
        const oc = Math.pow(2,  this.osc2octave / 12);

        const mkSrc = (rate) => {
          const s = ctx.createBufferSource();
          s.loop = true;
          s.buffer = wt.getWaveDataForPitch(rate);
          s.playbackRate.value = rate;
          return s;
        };
        // 4 oscillators: two detuned pairs spread stereo
        // Mirrors Google ChromeLabs formula: osc1=-d1, osc1Oct=+d2(inv), osc2=+d1, osc2Oct=-d2
        const srcA    = mkSrc(pitchRate / d1);        // flat by detune1
        const srcAoct = mkSrc(pitchRate / d2 * oc);  // sharp by |detune2|
        const srcB    = mkSrc(pitchRate * d1);        // sharp by detune1
        const srcBoct = mkSrc(pitchRate * d2 * oc);  // flat by |detune2|

        const pan1 = ctx.createStereoPanner(); pan1.pan.value = -this.width;
        const pan2 = ctx.createStereoPanner(); pan2.pan.value = +this.width;
        srcA.connect(pan1); srcAoct.connect(pan1);
        srcB.connect(pan2); srcBoct.connect(pan2);

        const envGain = ctx.createGain(); envGain.gain.value = 0;
        pan1.connect(envGain); pan2.connect(envGain);

        // Per-voice filter with envelope sweep
        const vf = ctx.createBiquadFilter();
        vf.type = 'lowpass';
        vf.Q.value = this.resonance;
        const baseCutoff = this._cutoffHz();
        const peakCutoff = baseCutoff * Math.pow(2, this.envAmount * 7);
        vf.frequency.setValueAtTime(baseCutoff, time);
        vf.frequency.setTargetAtTime(peakCutoff, time, Math.max(this.filterAttack * 0.33, 0.003));
        vf.frequency.setTargetAtTime(baseCutoff, time + this.filterAttack * 1.5, Math.max(this.filterDecay * 0.33, 0.01));
        envGain.connect(vf);

        const bridgeIn = this._wtBridge.input;
        try { vf.connect(bridgeIn); } catch(e) { console.warn('WT voice filter connect failed', e); }

        srcA.start(time); srcAoct.start(time); srcB.start(time); srcBoct.start(time);
        return { freq, envGain, vf, srcA, srcAoct, srcB, srcBoct };
      }

      noteOn(note, vel = 100) {
        if (!this._wt) return;
        this._noteHighlight(note, true);
        const ctx = Tone.context.rawContext;
        const targetFreq = Tone.Frequency(note).toFrequency();
        const amp = (vel / 127) * 0.45;

        // LEGATO portamento: glide an existing sounding voice to the new pitch
        if (this.portamento > 0 && this._voices.length > 0) {
          const now = ctx.currentTime;
          const v = this._voices[this._voices.length - 1];
          const wt = this._wt;
          const targetRate = targetFreq * wt.getRateScale();
          const d1 = Math.pow(2, this.detune1 / 1200);
          const d2 = Math.pow(2, this.detune2 / 1200);
          const oc = Math.pow(2, this.osc2octave / 12);
          const glideEnd = now + this.portamento;
          const glide = (param, target) => {
            const cur = Math.max(1e-6, param.value);
            param.cancelScheduledValues(now);
            param.setValueAtTime(cur, now);
            param.exponentialRampToValueAtTime(Math.max(1e-6, target), glideEnd);
          };
          glide(v.srcA.playbackRate,    targetRate / d1);
          glide(v.srcAoct.playbackRate, targetRate / d2 * oc);
          glide(v.srcB.playbackRate,    targetRate * d1);
          glide(v.srcBoct.playbackRate, targetRate * d2 * oc);
          v.note = note; v.freq = targetFreq;
          v.envGain.gain.cancelScheduledValues(now);
          v.envGain.gain.setValueAtTime(Math.max(0, v.envGain.gain.value), now);
          v.envGain.gain.setTargetAtTime(amp, now, Math.max(this.attack * 0.33, 0.003));
          v.envGain.gain.setTargetAtTime(amp * this.sustain, now + this.attack * 1.5, Math.max(this.decay * 0.33, 0.01));
          this._glideLastFreq = targetFreq;
          return;
        }

        // Create new voice (may be glided from previous freq in non-legato mode)
        const now0 = ctx.currentTime;
        if (this._voices.length >= 16) this._stopVoice(this._voices.shift(), now0);
        const v = this._makeVoice(targetFreq, now0);
        v.note = note;

        // NON-LEGATO portamento: voice just spawned — ramp playbackRates from old freq to new
        if (this.portamento > 0 && this._glideLastFreq != null && this._glideLastFreq !== targetFreq) {
          const now2 = ctx.currentTime; // fresh after buffer creation
          const wt = this._wt;
          const oldRate = this._glideLastFreq * wt.getRateScale();
          const newRate = targetFreq * wt.getRateScale();
          const d1 = Math.pow(2, this.detune1 / 1200);
          const d2 = Math.pow(2, this.detune2 / 1200);
          const oc = Math.pow(2, this.osc2octave / 12);
          const glideEnd = now2 + this.portamento;
          const ramp = (param, oldVal, newVal) => {
            param.cancelScheduledValues(now2);
            param.setValueAtTime(Math.max(1e-6, oldVal), now2);
            param.exponentialRampToValueAtTime(Math.max(1e-6, newVal), glideEnd);
          };
          ramp(v.srcA.playbackRate,    oldRate / d1,      newRate / d1);
          ramp(v.srcAoct.playbackRate, oldRate / d2 * oc, newRate / d2 * oc);
          ramp(v.srcB.playbackRate,    oldRate * d1,      newRate * d1);
          ramp(v.srcBoct.playbackRate, oldRate * d2 * oc, newRate * d2 * oc);
          // Start gain from silence at now2 so ramp begins before any audible output at wrong pitch
          v.envGain.gain.cancelScheduledValues(now2);
          v.envGain.gain.setValueAtTime(0, now2);
          v.envGain.gain.setTargetAtTime(amp, now2, Math.max(this.attack * 0.33, 0.003));
          v.envGain.gain.setTargetAtTime(amp * this.sustain, now2 + this.attack * 1.5, Math.max(this.decay * 0.33, 0.01));
        } else {
          v.envGain.gain.setTargetAtTime(amp, now0, Math.max(this.attack * 0.33, 0.003));
          v.envGain.gain.setTargetAtTime(amp * this.sustain, now0 + this.attack * 1.5, Math.max(this.decay * 0.33, 0.01));
        }

        this._glideLastFreq = targetFreq;
        this._voices.push(v);
      }

      noteOff(note) {
        this._noteHighlight(note, false);
        const idx = this._voices.findIndex(v => v.note === note);
        if (idx < 0) return;
        this._releaseVoice(this._voices.splice(idx, 1)[0]);
      }

      allNotesOff() { this._voices.splice(0).forEach(v => this._releaseVoice(v)); }

      _releaseVoice(v) {
        const ctx = Tone.context.rawContext;
        const now = ctx.currentTime;
        const rel = Math.max(this.release, 0.01);
        v.envGain.gain.cancelScheduledValues(now);
        v.envGain.gain.setValueAtTime(v.envGain.gain.value, now);
        v.envGain.gain.setTargetAtTime(0, now, rel * 0.33);
        const stopAt = now + rel * 4;
        ['srcA','srcAoct','srcB','srcBoct'].forEach(k => { try { v[k].stop(stopAt); } catch(e) {} });
      }

      _stopVoice(v, now) {
        v.envGain.gain.cancelScheduledValues(now);
        v.envGain.gain.setValueAtTime(0, now);
        ['srcA','srcAoct','srcB','srcBoct'].forEach(k => { try { v[k].stop(now + 0.001); } catch(e) {} });
      }

      triggerAtTime(note, dur, time, vel) {
        if (!this._wt) return;
        this._noteHighlight(note, true);
        const targetFreq = Tone.Frequency(note).toFrequency();
        const v = this._makeVoice(targetFreq, time);
        // vel from riff/seq is 0–1 normalized (unlike noteOn which receives 0–127)
        const amp = Math.min(vel, 1.0) * 0.45;

        // NON-LEGATO portamento anchored at scheduled time
        if (this.portamento > 0 && this._glideLastFreq != null && this._glideLastFreq !== targetFreq) {
          const wt = this._wt;
          const oldRate = this._glideLastFreq * wt.getRateScale();
          const newRate = targetFreq * wt.getRateScale();
          const d1 = Math.pow(2, this.detune1 / 1200);
          const d2 = Math.pow(2, this.detune2 / 1200);
          const oc = Math.pow(2, this.osc2octave / 12);
          const glideEnd = time + this.portamento;
          const ramp = (param, oldVal, newVal) => {
            param.cancelScheduledValues(time);
            param.setValueAtTime(Math.max(1e-6, oldVal), time);
            param.exponentialRampToValueAtTime(Math.max(1e-6, newVal), glideEnd);
          };
          ramp(v.srcA.playbackRate,    oldRate / d1,      newRate / d1);
          ramp(v.srcAoct.playbackRate, oldRate / d2 * oc, newRate / d2 * oc);
          ramp(v.srcB.playbackRate,    oldRate * d1,      newRate * d1);
          ramp(v.srcBoct.playbackRate, oldRate * d2 * oc, newRate * d2 * oc);
        }

        this._glideLastFreq = targetFreq;
        v.envGain.gain.setValueAtTime(0, time);
        v.envGain.gain.setTargetAtTime(amp, time, Math.max(this.attack * 0.33, 0.003));
        v.envGain.gain.setTargetAtTime(amp * this.sustain, time + this.attack * 1.5, Math.max(this.decay * 0.33, 0.01));
        const rel = Math.max(this.release, 0.01);
        v.envGain.gain.setTargetAtTime(0, time + dur, rel * 0.33);
        const stopAt = time + dur + rel * 4;
        ['srcA','srcAoct','srcB','srcBoct'].forEach(k => { try { v[k].stop(stopAt); } catch(e) {} });
        setTimeout(() => this._noteHighlight(note, false), (dur + 0.05) * 1000);
      }

      updateWave() {
        const name = WT_NAMES[this.currentWave]; if (!name) return;
        _wtLoadWave(name, wt => {
          this._wt = wt;
          const d1 = Math.pow(2, this.detune1 / 1200);
          const d2 = Math.pow(2, this.detune2 / 1200);
          const oc = Math.pow(2, this.osc2octave / 12);
          for (const v of this._voices) {
            const pr = v.freq * wt.getRateScale();
            v.srcA.playbackRate.value    = pr / d1;
            v.srcAoct.playbackRate.value = pr / d2 * oc;
            v.srcB.playbackRate.value    = pr * d1;
            v.srcBoct.playbackRate.value = pr * d2 * oc;
          }
        });
      }

      updateFilter() {
        for (const v of this._voices) if (v.vf) v.vf.Q.value = this.resonance;
      }

      updateDetune() {
        if (!this._wt) return;
        const d1 = Math.pow(2, this.detune1 / 1200);
        const d2 = Math.pow(2, this.detune2 / 1200);
        const oc = Math.pow(2, this.osc2octave / 12);
        for (const v of this._voices) {
          const pr = v.freq * this._wt.getRateScale();
          v.srcA.playbackRate.value    = pr / d1;
          v.srcAoct.playbackRate.value = pr / d2 * oc;
          v.srcB.playbackRate.value    = pr * d1;
          v.srcBoct.playbackRate.value = pr * d2 * oc;
        }
      }

      updateEnvelope()   { /* applied on next noteOn */ }
      updatePortamento() { /* portamento value is read directly in noteOn */ }

      dispose() {
        this.allNotesOff();
        if (this._wtBridge) { try { this._wtBridge.dispose(); } catch(e) {} this._wtBridge = null; }
        super.dispose();
      }
    }

    // ── Karplus-Strong physical modeling synth ──
    // Algorithm ported from mrahtz/javascript-karplus-strong (MIT)
    class KarplusSynth extends SynthInstrument {
      constructor(id, name, x, y) {
        super(id, name, x, y);
        this.synthType              = 'karplus';
        // String parameters
        this.characterVariation     = 0.5;   // noise randomness (0–1)
        this.stringDamping          = 0.5;   // decay speed (0–1)
        this.stringDampingVariation = 0.25;  // per-note decay variation (0–1)
        this.stringDampingCalc      = 'magic'; // 'magic' | 'direct'
        this.stringTension          = 0.0;   // inharmonicity (0–1)
        // Pluck parameters
        this.pluckDamping           = 0.5;   // spectral brightness of pluck (0–1)
        this.pluckDampingVariation  = 0.25;  // per-note brightness variation (0–1)
        // Output
        this.stereoSpread           = 0.2;   // L/R spread (0–1)
        this.bodyResonation         = 'simple'; // 'none' | 'simple'
        // Glide
        this.portamento             = 0;
        this._glideLastFreq         = null;
        this._kpVoices              = [];
        this._kpBridge              = new Tone.Gain(0.5).connect(this.pan);
      }

      // Low-pass filter: sf * input + (1-sf) * lastOutput
      _lp(lastOut, input, sf) { return sf * input + (1 - sf) * lastOut; }

      // Compute smoothing factor from stringDamping + per-note variation
      _smoothingFactor(N) {
        let sf;
        if (this.stringDampingCalc === 'direct') {
          sf = Math.max(0.1, Math.min(0.99, this.stringDamping));
        } else {
          // "magic": normalise per period so all pitches feel equally damped
          // target per-period gain G = stringDamping, convert to per-sample sf
          const G = Math.max(0.001, Math.min(0.9999, this.stringDamping));
          sf = Math.pow(G, 1 / N);
        }
        // Apply variation (range ± variation * (distance to limits))
        if (this.stringDampingVariation > 0) {
          const lo = sf - (sf - 0.1) * this.stringDampingVariation;
          const hi = sf + (0.9999 - sf) * this.stringDampingVariation;
          sf = lo + Math.random() * (hi - lo);
        }
        return Math.max(0.1, Math.min(0.9999, sf));
      }

      // Compute pluck damping coefficient with variation
      _pluckCoeff() {
        const pd = Math.max(0.1, Math.min(0.9, this.pluckDamping));
        const v  = this.pluckDampingVariation;
        const lo = pd - (pd - 0.1) * v;
        const hi = pd + (0.9 - pd) * v;
        return lo + Math.random() * (hi - lo);
      }

      _generateBuffer(freq, vel) {
        const ctx = Tone.context.rawContext;
        const sr  = ctx.sampleRate;
        const N   = Math.max(2, Math.round(sr / freq)); // one period

        // Seed noise (one period of random values)
        const seed = new Float32Array(N);
        for (let i = 0; i < N; i++) seed[i] = Math.random() * 2 - 1;

        const sf    = this._smoothingFactor(N);
        const pc    = this._pluckCoeff();
        const skip  = Math.floor(this.stringTension * N); // tension: skip samples
        const cv    = this.characterVariation;

        // Fixed 2-second output buffer
        const sampleCount = Math.round(sr * 2);
        const output = new Float32Array(sampleCount);
        let lastOut = 0, curIn = 0;

        for (let i = 0; i < sampleCount; i++) {
          if (i < N) {
            // First period: feed pluck-damped noise as excitation
            let noise = seed[i];
            noise = noise * (1 - cv) + cv * (Math.random() * 2 - 1);
            noise *= vel;
            curIn = this._lp(curIn, noise, pc);
          } else if (this.stringTension < 1.0) {
            // Feedback from ~one period ago with tension offset
            curIn = output[i - N + skip] || 0;
          } else {
            curIn = 0;
          }
          const out = this._lp(lastOut, curIn, sf);
          output[i] = out;
          lastOut = out;
        }

        // Body resonation (simple mode — two biquad resonators + DC-remove)
        if (this.bodyResonation === 'simple') {
          let r00=0,f00=0,r10=0,f10=0,f0=0,hpOut=0,hpIn=0;
          const c0 = 2*Math.sin(Math.PI*3.4375/44100);
          const c1 = 2*Math.sin(Math.PI*6.124928687214833/44100);
          const r0=0.98, r1=0.98, hpSF=0.999;
          for (let i = 0; i < sampleCount; i++) {
            r00 = r00*r0 + (f0-f00)*c0;
            f00 = f00 + r00 - f00*f00*f00*0.16667;
            r10 = r10*r1 + (f0-f10)*c1;
            f10 = f10 + r10 - f10*f10*f10*0.16667;
            f0 = output[i];
            const res = f0 + (f00+f10)*2;
            const hp = hpSF*hpOut + hpSF*(res-hpIn);
            output[i] = hp; hpOut = hp; hpIn = res;
          }
        }

        // Fade last 10% to prevent clicks at buffer end
        const tailSamples = Math.floor(sampleCount * 0.1);
        const tailStart   = sampleCount - tailSamples;
        for (let i = 0; i < tailSamples; i++) {
          output[tailStart + i] *= 1 - i / tailSamples;
        }

        const buf = ctx.createBuffer(1, sampleCount, sr);
        buf.getChannelData(0).set(output);
        return buf;
      }

      _makeVoice(freq, time, vel) {
        const ctx = Tone.context.rawContext;
        const buf = this._generateBuffer(freq, vel);

        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = false;

        // Stereo: L/R split via a stereo panner
        const spread = (Math.random() * 2 - 1) * this.stereoSpread;
        const panner = ctx.createStereoPanner();
        panner.pan.value = spread;

        const envGain = ctx.createGain();
        envGain.gain.value = 1;

        src.connect(panner);
        panner.connect(envGain);
        envGain.connect(this._kpBridge.input);
        src.start(time);
        // auto-cleanup after buffer finishes
        src.onended = () => {
          try { panner.disconnect(); envGain.disconnect(); } catch(e) {}
          const idx = this._kpVoices.indexOf(voice);
          if (idx >= 0) this._kpVoices.splice(idx, 1);
        };
        const voice = { freq, src, panner, envGain };
        return voice;
      }

      noteOn(note, vel = 100) {
        this._noteHighlight(note, true);
        if (this._kpVoices.length >= 16) {
          const old = this._kpVoices.shift();
          try { old.envGain.gain.setValueAtTime(0, Tone.context.rawContext.currentTime); } catch(e) {}
        }
        const now = Tone.context.rawContext.currentTime;
        const targetFreq = Tone.Frequency(note).toFrequency();
        const v = this._makeVoice(targetFreq, now, vel / 127 * 0.8);
        // Portamento: buffer is at targetFreq pitch; start playbackRate at old/new ratio and ramp to 1.0.
        // Use a FRESH timestamp after buffer generation to avoid past-time scheduling issues.
        if (this.portamento > 0 && this._glideLastFreq != null) {
          const now2 = Tone.context.rawContext.currentTime;
          const startRate = Math.max(1e-6, this._glideLastFreq / targetFreq);
          v.src.playbackRate.cancelScheduledValues(now2);
          v.src.playbackRate.setValueAtTime(startRate, now2);
          v.src.playbackRate.exponentialRampToValueAtTime(1.0, now2 + this.portamento);
        }
        this._glideLastFreq = targetFreq;
        v.note = note;
        this._kpVoices.push(v);
      }
      updatePortamento() { /* portamento value is read directly in noteOn */ }

      noteOff(note) {
        // Plucked strings ring out naturally — just unhighlight the key
        this._noteHighlight(note, false);
      }

      allNotesOff() {
        const now = Tone.context.rawContext.currentTime;
        for (const v of this._kpVoices) {
          try { v.envGain.gain.setTargetAtTime(0, now, 0.05); v.src.stop(now + 0.3); } catch(e) {}
        }
        this._kpVoices = [];
      }

      triggerAtTime(note, dur, time, vel) {
        this._noteHighlight(note, true);
        const targetFreq = Tone.Frequency(note).toFrequency();
        const v = this._makeVoice(targetFreq, time, Math.min(vel, 1.0) * 0.8);
        // Portamento anchored at scheduled time: ramp playbackRate from old/new ratio → 1.0
        if (this.portamento > 0 && this._glideLastFreq != null) {
          const startRate = Math.max(1e-6, this._glideLastFreq / targetFreq);
          v.src.playbackRate.cancelScheduledValues(time);
          v.src.playbackRate.setValueAtTime(startRate, time);
          v.src.playbackRate.exponentialRampToValueAtTime(1.0, time + this.portamento);
        }
        this._glideLastFreq = targetFreq;
        v.note = note;
        this._kpVoices.push(v);
        setTimeout(() => this._noteHighlight(note, false), (dur + 0.05) * 1000);
      }

      dispose() {
        this.allNotesOff();
        if (this._kpBridge) { try { this._kpBridge.dispose(); } catch(e) {} this._kpBridge = null; }
        super.dispose();
      }
    }

    // ── Rompler (Soundfont) instrument list ──
    const ROMPLER_INSTRUMENTS = [
      // Piano
      'acoustic_grand_piano','bright_acoustic_piano','electric_grand_piano','honkytonk_piano',
      'electric_piano_1','electric_piano_2','harpsichord','clavinet',
      // Chromatic Perc
      'celesta','glockenspiel','music_box','vibraphone','marimba','xylophone','tubular_bells','dulcimer',
      // Organ
      'drawbar_organ','percussive_organ','rock_organ','church_organ','reed_organ','accordion','harmonica','tango_accordion',
      // Guitar
      'acoustic_guitar_nylon','acoustic_guitar_steel','electric_guitar_jazz','electric_guitar_clean',
      'electric_guitar_muted','overdriven_guitar','distortion_guitar','guitar_harmonics',
      // Bass
      'acoustic_bass','electric_bass_finger','electric_bass_pick','fretless_bass',
      'slap_bass_1','slap_bass_2','synth_bass_1','synth_bass_2',
      // Strings
      'violin','viola','cello','contrabass','tremolo_strings','pizzicato_strings','orchestral_harp','timpani',
      // Ensemble
      'string_ensemble_1','string_ensemble_2','synth_strings_1','synth_strings_2',
      'choir_aahs','voice_oohs','synth_choir','orchestra_hit',
      // Brass
      'trumpet','trombone','tuba','muted_trumpet','french_horn','brass_section','synth_brass_1','synth_brass_2',
      // Reed
      'soprano_sax','alto_sax','tenor_sax','baritone_sax','oboe','english_horn','bassoon','clarinet',
      // Pipe
      'piccolo','flute','recorder','pan_flute','blown_bottle','shakuhachi','whistle','ocarina',
      // Synth Lead
      'lead_1_square','lead_2_sawtooth','lead_3_calliope','lead_4_chiff',
      'lead_5_charang','lead_6_voice','lead_7_fifths','lead_8_bass__lead',
      // Synth Pad
      'pad_1_new_age','pad_2_warm','pad_3_polysynth','pad_4_choir',
      'pad_5_bowed','pad_6_metallic','pad_7_halo','pad_8_sweep',
      // Synth FX
      'fx_1_rain','fx_2_soundtrack','fx_3_crystal','fx_4_atmosphere',
      'fx_5_brightness','fx_6_goblins','fx_7_echoes','fx_8_scifi',
      // Ethnic
      'sitar','banjo','shamisen','koto','kalimba','bagpipe','fiddle','shanai',
      // Percussive
      'tinkle_bell','agogo','steel_drums','woodblock','taiko_drum','melodic_tom','synth_drum','reverse_cymbal',
      // Sound FX
      'guitar_fret_noise','breath_noise','seashore','bird_tweet','telephone_ring','helicopter','applause','gunshot',
    ];
    const ROMPLER_BANKS = ['MusyngKite', 'FluidR3_GM'];
    const ROMPLER_SF2_FILES = [
      { name: 'Galaxy Electric Pianos', url: 'https://smpldsnds.github.io/soundfonts/soundfonts/galaxy-electric-pianos.sf2' },
      { name: 'GIGA HQ FM GM',          url: 'https://smpldsnds.github.io/soundfonts/soundfonts/giga-hq-fm-gm.sf2' },
      { name: 'Supersaw Collection',    url: 'https://smpldsnds.github.io/soundfonts/soundfonts/supersaw-collection.sf2' },
      { name: 'Yamaha Grand Lite',      url: 'https://smpldsnds.github.io/soundfonts/soundfonts/yamaha-grand-lite.sf2' },
    ];

    class RomplerInstrument extends SynthInstrument {
      constructor(id, name, x, y) {
        super(id, name, x, y);
        this.synthType            = 'rompler';
        this.romplerType          = 'sf1';   // 'sf1' | 'sf2'
        this.romplerBank          = 'MusyngKite';
        this.romplerInstrument    = 'acoustic_grand_piano';
        this.romplerSf2Url        = ROMPLER_SF2_FILES[0].url;
        this.romplerSf2Instrument = null;
        this._sf2InstrumentNames  = [];
        this.release              = 1.5;
        this.filterType           = 'lowpass';
        this.filterFreq           = 20000;
        this.filterQ              = 1.0;
        this._smplr               = null;
        this._smplrLoading        = false;
        this._refreshSf2List      = null;
        // Glide
        this.portamento           = 0;
        this._glideShifter        = null;
        this._glideRaf            = null;
        this._glideLastMidi       = null;

        this._filter = new Tone.Filter({ type: this.filterType, frequency: this.filterFreq, Q: this.filterQ }).connect(this.pan);
        this._romplerBridge = new Tone.Gain(1).connect(this._filter);
        this._romplerLoad();
      }

      noteOn(note, vel = 100) {
        if (!this._smplr || this._smplrLoading) return;
        this._noteHighlight(note, true);
        const newMidi = Tone.Frequency(note).toMidi();
        if (this.portamento > 0 && this._glideLastMidi != null && this._glideShifter) {
          const startSemitones = this._glideLastMidi - newMidi;
          this._glideShifter.pitch = startSemitones;
          const startTime = performance.now();
          const duration = this.portamento * 1000;
          if (this._glideRaf) cancelAnimationFrame(this._glideRaf);
          const animate = () => {
            const progress = Math.min((performance.now() - startTime) / duration, 1);
            if (this._glideShifter) this._glideShifter.pitch = startSemitones * (1 - progress);
            if (progress < 1) this._glideRaf = requestAnimationFrame(animate);
            else { this._glideRaf = null; if (this._glideShifter) this._glideShifter.pitch = 0; }
          };
          this._glideRaf = requestAnimationFrame(animate);
        }
        this._glideLastMidi = newMidi;
        try { this._smplr.start({ note, velocity: vel, stopId: note }); } catch(e) {}
      }

      updatePortamento() {
        if (this.portamento > 0) {
          if (!this._glideShifter && this._romplerBridge && this._filter) {
            this._glideShifter = new Tone.PitchShift(0);
            try { this._romplerBridge.disconnect(); } catch(e) {}
            this._romplerBridge.connect(this._glideShifter);
            this._glideShifter.connect(this._filter);
          }
        } else {
          if (this._glideRaf) { cancelAnimationFrame(this._glideRaf); this._glideRaf = null; }
          if (this._glideShifter) {
            try { this._romplerBridge.disconnect(); } catch(e) {}
            try { this._glideShifter.disconnect(); } catch(e) {}
            try { this._glideShifter.dispose(); } catch(e) {}
            this._glideShifter = null;
            try { this._romplerBridge.connect(this._filter); } catch(e) {}
          }
        }
      }

      noteOff(note) {
        this._noteHighlight(note, false);
        if (!this._smplr) return;
        try { this._smplr.stop({ stopId: note }); } catch(e) {}
      }

      allNotesOff() {
        if (!this._smplr) return;
        try { this._smplr.stop(); } catch(e) {}
      }

      triggerAtTime(note, dur, time, vel) {
        if (!this._smplr || this._smplrLoading) return;
        this._noteHighlight(note, true);
        const newMidi = Tone.Frequency(note).toMidi();
        if (this.portamento > 0 && this._glideLastMidi != null && this._glideShifter) {
          const startSemitones = this._glideLastMidi - newMidi;
          // Delay the rAF animation to start when the note actually plays
          const delayMs = Math.max(0, (time - Tone.context.currentTime) * 1000);
          const portamento = this.portamento;
          const shifter = this._glideShifter;
          setTimeout(() => {
            if (!shifter) return;
            shifter.pitch = startSemitones;
            const t0 = performance.now();
            const glideDur = portamento * 1000;
            if (this._glideRaf) cancelAnimationFrame(this._glideRaf);
            const animate = () => {
              const progress = Math.min((performance.now() - t0) / glideDur, 1);
              if (shifter) shifter.pitch = startSemitones * (1 - progress);
              if (progress < 1) this._glideRaf = requestAnimationFrame(animate);
              else { this._glideRaf = null; if (shifter) shifter.pitch = 0; }
            };
            this._glideRaf = requestAnimationFrame(animate);
          }, delayMs);
        }
        this._glideLastMidi = newMidi;
        const velocity = Math.round(Math.min(vel, 1.0) * 127);
        try {
          this._smplr.start({ note, velocity, time, duration: dur, ampRelease: this.release });
        } catch(e) {}
        setTimeout(() => this._noteHighlight(note, false), (dur + 0.05) * 1000);
      }

      updateFilter() {
        if (this._filter) this._filter.set({ frequency: this.filterFreq, Q: this.filterQ, type: this.filterType });
      }

      dispose() {
        if (this._glideRaf) { cancelAnimationFrame(this._glideRaf); this._glideRaf = null; }
        if (this._glideShifter) { try { this._glideShifter.dispose(); } catch(e) {} this._glideShifter = null; }
        if (this._smplr) { try { this._smplr.stop(); } catch(e) {} this._smplr = null; }
        if (this._romplerBridge) { try { this._romplerBridge.dispose(); } catch(e) {} this._romplerBridge = null; }
        if (this._filter) { try { this._filter.dispose(); } catch(e) {} this._filter = null; }
        super.dispose();
      }
    }

    // ── Kit definitions ──────────────────────────────────────────────────────
    // Samples live at  sounds/<id>/<slot>.wav  (generated by scripts/download-kits.py)
    // To add a new kit: run the script with the new kit id, then add an entry here.
    // slots + files come from sounds/manifest.json (generated by scripts/download-kits.py --labels)
    // files maps slot → original sample filename (no extension) — used as lane label in the UI
    const DRUM_KITS = [
      {id: "tr808", name: "Roland TR-808",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "rim", "rim2", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "hh_open2", "hh_open3", "tom_hi", "tom_low", "tom_low2", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "Conga02", "Conga03", "Conga04", "Conga05", "Tom04", "Tom05", "Tom06", "Tom07"],
       files: {"kick":"Kick01", "kick2":"Kick02", "kick3":"Kick03", "kick4":"Kick04", "snare":"Snare01", "snare2":"Snare02", "snare3":"Snare03", "snare4":"Snare04", "clap":"Clap01", "clap2":"Clap02", "rim":"Rim01", "rim2":"Rim02", "hh_closed":"Hat_C01", "hh_closed2":"Hat_C02", "hh_closed3":"Hat_C03", "hh_closed4":"Hat_C04", "hh_open":"Hat_O01", "hh_open2":"Hat_O02", "hh_open3":"Hat_O03", "tom_hi":"Tom01", "tom_low":"Tom02", "tom_low2":"Tom03", "cowbell":"Clave", "cowbell2":"Conga01", "cowbell3":"Cow", "cowbell4":"Shaker01", "ride":"Ride01", "ride2":"Ride02", "ride3":"Ride03", "ride4":"Ride04", "Conga02":"Conga02", "Conga03":"Conga03", "Conga04":"Conga04", "Conga05":"Conga05", "Tom04":"Tom04", "Tom05":"Tom05", "Tom06":"Tom06", "Tom07":"Tom07"}},
      {id: "tr909", name: "Roland TR-909",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "clap4", "rim", "rim2", "rim3", "rim4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "hh_open2", "hh_open3", "hh_open4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "tom_low", "tom_low2", "tom_low3", "tom_low4", "ride", "ride2", "ride3", "ride4", "BT0A0A7", "BT0A0D0", "BT0A0D3", "BT0A0DA", "BT0AAD0", "BT0AADA", "BT3A0D0", "BT3A0D3", "BT3A0D7", "BT3A0DA", "BT3AAD0", "BT3AADA", "BT7A0D0", "BT7A0D3", "BT7A0D7", "BT7A0DA", "BT7AAD0", "BT7AADA", "BTAA0D0", "BTAA0D3", "BTAA0D7", "BTAA0DA", "BTAAAD0", "BTAAADA", "CLOP1", "CLOP2", "CLOP3", "CLOP4", "CSHD0", "CSHD2", "CSHD4", "CSHD6", "CSHD8", "CSHDA", "HANDCLP1", "HANDCLP2", "HHCD0", "HHCD2", "HHCD4", "HHCD6", "HHCD8", "HHCDA", "HHOD0", "HHOD2", "HHOD4", "HHOD6", "HHOD8", "HHODA", "HTAD0", "HTAD3", "HTAD7", "HTADA", "LTAD0", "LTAD3", "LTAD7", "LTADA", "MT0D0", "MT0D3", "MT0D7", "MT0DA", "MT3D0", "MT3D3", "MT3D7", "MT3DA", "MT7D0", "MT7D3", "MT7D7", "MT7DA", "MTAD0", "MTAD3", "MTAD7", "MTADA", "Mt01", "Mt02", "Mt03", "Mt04", "Mt05", "Mt06", "Mt07", "Mt08", "Mt09", "Mt10", "Mt11", "Mt12", "Mt13", "Mt14", "Mt15", "Mt16", "Mt17", "Mt18", "Mt19", "Mt20", "Mt21", "Mt22", "Mt23", "OPCL1", "OPCL2", "OPCL3", "OPCL4", "ST0T0S0", "ST0T0S3", "ST0T0S7", "ST0T0SA", "ST0T3S3", "ST0T3S7", "ST0T3SA", "ST0T7S3", "ST0T7S7", "ST0T7SA", "ST0TAS3", "ST0TAS7", "ST0TASA", "ST3T0S0", "ST3T0S3", "ST3T0S7", "ST3T0SA", "ST3T3S3", "ST3T3S7", "ST3T3SA", "ST3T7S3", "ST3T7S7", "ST3T7SA", "ST3TAS3", "ST3TAS7", "ST3TASA", "ST7T0S0", "ST7T0S3", "ST7T0S7", "ST7T0SA", "ST7T3S3", "ST7T3S7", "ST7T3SA", "ST7T7S3", "ST7T7S7", "ST7T7SA", "ST7TAS3", "ST7TAS7", "ST7TASA", "STAT0S0", "STAT0S3", "STAT0S7", "STAT0SA", "STAT3S3", "STAT3S7", "STAT3SA", "STAT7S3", "STAT7S7", "STAT7SA", "STATAS3", "STATAS7", "STATASA", "TOM10", "TOM11", "TOM12", "TOM13", "TOM14", "TOM15", "TOM16", "TOM17", "TOM18", "TOM19", "TOM20", "TOM21", "TOM22", "TOM4", "TOM5", "TOM6", "TOM7", "TOM8", "TOM9"],
       files: {"kick":"BDRUM1", "kick2":"BDRUM10", "kick3":"BDRUM11", "kick4":"BDRUM12", "snare":"SNARE1", "snare2":"SNARE10", "snare3":"SNARE11", "snare4":"SNARE12", "clap":"CLAP1", "clap2":"CLAP2", "clap3":"Clp01", "clap4":"Clp02", "rim":"RIM127", "rim2":"RIM63", "rim3":"RIMSHOT", "rim4":"Rs01", "hh_closed":"Ch01", "hh_closed2":"Ch02", "hh_closed3":"Ch03", "hh_closed4":"Ch04", "hh_open":"HHOPEN1", "hh_open2":"HHOPEN2", "hh_open3":"HHOPEN3", "hh_open4":"HHOPEN4", "tom_hi":"HT0D0", "tom_hi2":"HT0D3", "tom_hi3":"HT0D7", "tom_hi4":"HT0DA", "tom_low":"LT0D0", "tom_low2":"LT0D3", "tom_low3":"LT0D7", "tom_low4":"LT0DA", "ride":"CRASH1", "ride2":"CRASH2", "ride3":"CRASH3", "ride4":"CRASH4", "BT0A0A7":"BT0A0A7", "BT0A0D0":"BT0A0D0", "BT0A0D3":"BT0A0D3", "BT0A0DA":"BT0A0DA", "BT0AAD0":"BT0AAD0", "BT0AADA":"BT0AADA", "BT3A0D0":"BT3A0D0", "BT3A0D3":"BT3A0D3", "BT3A0D7":"BT3A0D7", "BT3A0DA":"BT3A0DA", "BT3AAD0":"BT3AAD0", "BT3AADA":"BT3AADA", "BT7A0D0":"BT7A0D0", "BT7A0D3":"BT7A0D3", "BT7A0D7":"BT7A0D7", "BT7A0DA":"BT7A0DA", "BT7AAD0":"BT7AAD0", "BT7AADA":"BT7AADA", "BTAA0D0":"BTAA0D0", "BTAA0D3":"BTAA0D3", "BTAA0D7":"BTAA0D7", "BTAA0DA":"BTAA0DA", "BTAAAD0":"BTAAAD0", "BTAAADA":"BTAAADA", "CLOP1":"CLOP1", "CLOP2":"CLOP2", "CLOP3":"CLOP3", "CLOP4":"CLOP4", "CSHD0":"CSHD0", "CSHD2":"CSHD2", "CSHD4":"CSHD4", "CSHD6":"CSHD6", "CSHD8":"CSHD8", "CSHDA":"CSHDA", "HANDCLP1":"HANDCLP1", "HANDCLP2":"HANDCLP2", "HHCD0":"HHCD0", "HHCD2":"HHCD2", "HHCD4":"HHCD4", "HHCD6":"HHCD6", "HHCD8":"HHCD8", "HHCDA":"HHCDA", "HHOD0":"HHOD0", "HHOD2":"HHOD2", "HHOD4":"HHOD4", "HHOD6":"HHOD6", "HHOD8":"HHOD8", "HHODA":"HHODA", "HTAD0":"HTAD0", "HTAD3":"HTAD3", "HTAD7":"HTAD7", "HTADA":"HTADA", "LTAD0":"LTAD0", "LTAD3":"LTAD3", "LTAD7":"LTAD7", "LTADA":"LTADA", "MT0D0":"MT0D0", "MT0D3":"MT0D3", "MT0D7":"MT0D7", "MT0DA":"MT0DA", "MT3D0":"MT3D0", "MT3D3":"MT3D3", "MT3D7":"MT3D7", "MT3DA":"MT3DA", "MT7D0":"MT7D0", "MT7D3":"MT7D3", "MT7D7":"MT7D7", "MT7DA":"MT7DA", "MTAD0":"MTAD0", "MTAD3":"MTAD3", "MTAD7":"MTAD7", "MTADA":"MTADA", "Mt01":"Mt01", "Mt02":"Mt02", "Mt03":"Mt03", "Mt04":"Mt04", "Mt05":"Mt05", "Mt06":"Mt06", "Mt07":"Mt07", "Mt08":"Mt08", "Mt09":"Mt09", "Mt10":"Mt10", "Mt11":"Mt11", "Mt12":"Mt12", "Mt13":"Mt13", "Mt14":"Mt14", "Mt15":"Mt15", "Mt16":"Mt16", "Mt17":"Mt17", "Mt18":"Mt18", "Mt19":"Mt19", "Mt20":"Mt20", "Mt21":"Mt21", "Mt22":"Mt22", "Mt23":"Mt23", "OPCL1":"OPCL1", "OPCL2":"OPCL2", "OPCL3":"OPCL3", "OPCL4":"OPCL4", "ST0T0S0":"ST0T0S0", "ST0T0S3":"ST0T0S3", "ST0T0S7":"ST0T0S7", "ST0T0SA":"ST0T0SA", "ST0T3S3":"ST0T3S3", "ST0T3S7":"ST0T3S7", "ST0T3SA":"ST0T3SA", "ST0T7S3":"ST0T7S3", "ST0T7S7":"ST0T7S7", "ST0T7SA":"ST0T7SA", "ST0TAS3":"ST0TAS3", "ST0TAS7":"ST0TAS7", "ST0TASA":"ST0TASA", "ST3T0S0":"ST3T0S0", "ST3T0S3":"ST3T0S3", "ST3T0S7":"ST3T0S7", "ST3T0SA":"ST3T0SA", "ST3T3S3":"ST3T3S3", "ST3T3S7":"ST3T3S7", "ST3T3SA":"ST3T3SA", "ST3T7S3":"ST3T7S3", "ST3T7S7":"ST3T7S7", "ST3T7SA":"ST3T7SA", "ST3TAS3":"ST3TAS3", "ST3TAS7":"ST3TAS7", "ST3TASA":"ST3TASA", "ST7T0S0":"ST7T0S0", "ST7T0S3":"ST7T0S3", "ST7T0S7":"ST7T0S7", "ST7T0SA":"ST7T0SA", "ST7T3S3":"ST7T3S3", "ST7T3S7":"ST7T3S7", "ST7T3SA":"ST7T3SA", "ST7T7S3":"ST7T7S3", "ST7T7S7":"ST7T7S7", "ST7T7SA":"ST7T7SA", "ST7TAS3":"ST7TAS3", "ST7TAS7":"ST7TAS7", "ST7TASA":"ST7TASA", "STAT0S0":"STAT0S0", "STAT0S3":"STAT0S3", "STAT0S7":"STAT0S7", "STAT0SA":"STAT0SA", "STAT3S3":"STAT3S3", "STAT3S7":"STAT3S7", "STAT3SA":"STAT3SA", "STAT7S3":"STAT7S3", "STAT7S7":"STAT7S7", "STAT7SA":"STAT7SA", "STATAS3":"STATAS3", "STATAS7":"STATAS7", "STATASA":"STATASA", "TOM10":"TOM10", "TOM11":"TOM11", "TOM12":"TOM12", "TOM13":"TOM13", "TOM14":"TOM14", "TOM15":"TOM15", "TOM16":"TOM16", "TOM17":"TOM17", "TOM18":"TOM18", "TOM19":"TOM19", "TOM20":"TOM20", "TOM21":"TOM21", "TOM22":"TOM22", "TOM4":"TOM4", "TOM5":"TOM5", "TOM6":"TOM6", "TOM7":"TOM7", "TOM8":"TOM8", "TOM9":"TOM9"}},
      {id: "tr606", name: "Roland TR-606",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "hh_open2", "hh_open3", "hh_open4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "tom_low", "tom_low2", "tom_low3", "tom_low4", "ride", "ride2", "ride3", "ride4", "Hat_C_OD", "Hat_O_OD", "Hat_P01", "Hat_P02", "Hat_P03", "Hat_P04", "Hat_P05", "Hat_P_OD"],
       files: {"kick":"Kick01", "kick2":"Kick02", "kick3":"Kick03", "kick4":"Kick04", "snare":"Snare01", "snare2":"Snare02", "snare3":"Snare03", "snare4":"Snare04", "hh_closed":"Hat_C01", "hh_closed2":"Hat_C02", "hh_closed3":"Hat_C03", "hh_closed4":"Hat_C04", "hh_open":"Hat_O01", "hh_open2":"Hat_O02", "hh_open3":"Hat_O03", "hh_open4":"Hat_O04", "tom_hi":"TomHi01", "tom_hi2":"TomHi02", "tom_hi3":"TomHi03", "tom_hi4":"TomHi04", "tom_low":"TomLo01", "tom_low2":"TomLo02", "tom_low3":"TomLo03", "tom_low4":"TomLo04", "ride":"Cymb01", "ride2":"Cymb02", "ride3":"Cymb03", "ride4":"Cymb04", "Hat_C_OD":"Hat_C_OD", "Hat_O_OD":"Hat_O_OD", "Hat_P01":"Hat_P01", "Hat_P02":"Hat_P02", "Hat_P03":"Hat_P03", "Hat_P04":"Hat_P04", "Hat_P05":"Hat_P05", "Hat_P_OD":"Hat_P_OD"}},
      {id: "tr707", name: "Roland TR-707",
       slots: ["kick", "kick2", "snare", "snare2", "clap", "rim", "hh_closed", "hh_closed2", "tom_hi", "tom_low", "cowbell", "ride", "ride2", "Mt", "Tam"],
       files: {"kick":"Bd0", "kick2":"Bd1", "snare":"Sd0", "snare2":"Sd1", "clap":"Hcp", "rim":"Rim", "hh_closed":"HH_c", "hh_closed2":"HH_o", "tom_hi":"Ht", "tom_low":"Lt", "cowbell":"Cow", "ride":"Crs", "ride2":"Rid", "Mt":"Mt", "Tam":"Tam"}},
      {id: "cr78", name: "Roland CR-78",
       slots: ["LOOP1", "LOOP2", "SAMPLE10", "SAMPLE11", "SAMPLE12", "SAMPLE13", "SAMPLE21", "SAMPLE22", "SAMPLE5", "SAMPLE6", "SAMPLE7", "SAMPLE8", "SAMPLE9"],
       files: {"LOOP1":"LOOP1", "LOOP2":"LOOP2", "SAMPLE10":"SAMPLE10", "SAMPLE11":"SAMPLE11", "SAMPLE12":"SAMPLE12", "SAMPLE13":"SAMPLE13", "SAMPLE21":"SAMPLE21", "SAMPLE22":"SAMPLE22", "SAMPLE5":"SAMPLE5", "SAMPLE6":"SAMPLE6", "SAMPLE7":"SAMPLE7", "SAMPLE8":"SAMPLE8", "SAMPLE9":"SAMPLE9"}},
      {id: "linndrum", name: "Linn LinnDrum",
       slots: ["kick", "kick2", "snare", "snare2", "snare3", "clap", "hh_closed", "hh_closed2", "hh_closed3", "hh_open", "tom_hi", "tom_hi2", "tom_low", "tom_low2", "cowbell", "cowbell2", "ride", "ride2", "Cabasa", "Conga", "Congah", "Congahh", "Congal", "Congall", "Congalll", "Reallinn", "Sst", "Ssth", "Sstl", "Tom"],
       files: {"kick":"Kick", "kick2":"Kickme", "snare":"SnareDrum", "snare2":"SnareDrumh", "snare3":"SnareDruml", "clap":"Clap", "hh_closed":"Chh", "hh_closed2":"Chhl", "hh_closed3":"Chhs", "hh_open":"Ohh", "tom_hi":"Tomh", "tom_hi2":"Tomhh", "tom_low":"Toml", "tom_low2":"Tomll", "cowbell":"Cowb", "cowbell2":"Tamb", "ride":"Crash", "ride2":"Ride", "Cabasa":"Cabasa", "Conga":"Conga", "Congah":"Congah", "Congahh":"Congahh", "Congal":"Congal", "Congall":"Congall", "Congalll":"Congalll", "Reallinn":"Reallinn", "Sst":"Sst", "Ssth":"Ssth", "Sstl":"Sstl", "Tom":"Tom"}},
      {id: "linn9000", name: "Linn 9000",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "rim", "rim2", "rim3", "rim4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "hh_open2", "hh_open3", "hh_open4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "tom_low", "tom_low2", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "Cabasa", "Cabasa2", "Conga_1", "Conga_2", "Crsh", "Etom", "Hi-Cong", "Hiconga", "Lo-Cong", "Lowconga", "Midconga", "Pec1", "Pec2", "Pec3", "Ping", "Stick", "Tom", "Tom4", "Tom5"],
       files: {"kick":"BassDrumrum1", "kick2":"BassDrumrum1kai", "kick3":"BassDrumrum2", "kick4":"BassDrumrum3", "snare":"Snare 2", "snare2":"Snare", "snare3":"Snare1", "snare4":"Snare2", "clap":"Clap 1", "clap2":"Clap 2", "clap3":"Clap", "rim":"Rim 2", "rim2":"Rim", "rim3":"Rim1", "rim4":"Rim2", "hh_closed":"Clhh 2", "hh_closed2":"Clhh", "hh_closed3":"Clhh_1", "hh_closed4":"Hhclose1", "hh_open":"Hhopen1", "hh_open2":"Hhopen2", "hh_open3":"Oph2", "hh_open4":"Ophh 2", "tom_hi":"Tom 1", "tom_hi2":"Tom 2", "tom_hi3":"Tom 3", "tom_hi4":"Tom 4", "tom_low":"Tom2", "tom_low2":"Tom3", "cowbell":"Cowbell", "cowbell2":"Cowbell1", "cowbell3":"Cowbell2", "cowbell4":"Tamb 2", "ride":"Crash 2", "ride2":"Crash 3", "ride3":"Crash", "ride4":"Crash1", "Cabasa":"Cabasa", "Cabasa2":"Cabasa2", "Conga_1":"Conga 1", "Conga_2":"Conga 2", "Crsh":"Crsh", "Etom":"Etom", "Hi-Cong":"Hi-Cong", "Hiconga":"Hiconga", "Lo-Cong":"Lo-Cong", "Lowconga":"Lowconga", "Midconga":"Midconga", "Pec1":"Pec1", "Pec2":"Pec2", "Pec3":"Pec3", "Ping":"Ping", "Stick":"Stick", "Tom":"Tom", "Tom4":"Tom4", "Tom5":"Tom5"}},
      {id: "dmx", name: "Oberheim DMX",
       slots: ["kick", "kick2", "snare", "snare2", "snare3", "clap", "rim", "hh_closed", "hh_open", "tom_hi", "tom_low", "cowbell", "ride", "ride2", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "Cabasa", "TimbaleHi", "TimbaleLo", "TomMid"],
       files: {"kick":"Kick01", "kick2":"Kick02", "snare":"Snare01", "snare2":"Snare02", "snare3":"Snare03", "clap":"Clap", "rim":"Rim", "hh_closed":"Hat_C", "hh_open":"Hat_O", "tom_hi":"TomHi", "tom_low":"TomLo", "cowbell":"Tamborine", "ride":"Crash", "ride2":"Ride", "01":"01", "02":"02", "03":"03", "04":"04", "05":"05", "06":"06", "07":"07", "08":"08", "09":"09", "10":"10", "11":"11", "12":"12", "Cabasa":"Cabasa", "TimbaleHi":"TimbaleHi", "TimbaleLo":"TimbaleLo", "TomMid":"TomMid"}},
      {id: "dr55", name: "Boss DR-55",
       slots: ["kick", "kick2", "snare", "rim", "rim2", "hh_closed", "Hat"],
       files: {"kick":"Kick", "kick2":"Kik", "snare":"Snar", "rim":"Rim", "rim2":"Rim1", "hh_closed":"Chh", "Hat":"Hat"}},
      {id: "drumtraks", name: "Sequential Drumtraks",
       slots: ["kick", "snare", "clap", "rim", "hh_closed", "hh_open", "tom_hi", "tom_low", "cowbell", "cowbell2", "ride", "ride2", "Cabasa"],
       files: {"kick":"Kick", "snare":"Snare", "clap":"Clap", "rim":"Rimshot", "hh_closed":"Closedhat", "hh_open":"Openhat", "tom_hi":"Tom01", "tom_low":"Tom02", "cowbell":"Cowbell", "cowbell2":"Tamborine", "ride":"Crash", "ride2":"Ride", "Cabasa":"Cabasa"}},
      {id: "sr16", name: "Alesis SR-16",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "rim", "rim2", "rim3", "rim4", "hh_closed", "hh_open", "hh_open2", "tom_hi", "tom_low", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "231bSmplHld", "231cSmplHld", "231dSmplHld", "Ambntelc", "Backn4th", "Backwrdz", "Balladkk", "Bamboo", "Batterrm", "Bigbalad", "Bluefoot", "Bmbocmbo", "Britrmkk", "Brt_Hall", "Brtpicrm", "Brtpunch", "Brushhit", "Cabasa", "Chromesn", "Cmbocrsh", "Coldblok", "Dbl_Head", "Dblhd_Rm", "Dynconga", "Dynohlsn", "Edge_Hat", "Electrnc", "Firecrkr", "Fishstik", "Flabbyrm", "Flngcrsh", "Flngtm", "Flrambtm", "Flrbighl", "Flrhltom", "Flrrmtom", "Flrtmdry", "Fngrsnap", "Frogfish", "Garagekk", "Half_Hat", "Hallfoot", "Hard_Hat", "Head_Pnch", "Hi_Agogo", "Hi_Clave", "Hi_Conga", "Hi_Crash", "Hi_Elect", "Hi_Foot", "Hi_Stomp", "Hiambtom", "Hibig_Hl", "Hiblock", "Hican_Hl", "Hicannon", "Hicgaslp", "Hielectm", "Hiflathl", "Hiflatrm", "Hiflattm", "Hiflngtm", "Hihalltm", "Hipic_Rm", "Hipiccolo", "Hipopsht", "Hipuresn", "Hiroomtm", "Histicks", "Hisuprtm", "Hitimbli", "Hititesn", "Hitruesn", "Honst_Rm", "Impact", "Liverid2", "Lo_Block", "Lo_Clave", "Lo_Conga", "Lo_Crash", "Lo_Fish", "Lo_Foot", "Lo_Honst", "Lo_Stab", "Lo_Stomp", "Loagogo", "Loambflr", "Loambtom", "Lobig_Hl", "Lobkwrdz", "Locan_Hl", "Locannon", "Locgaslp", "Lochrome", "Lodblhrm", "Lodyncga", "Lodynsn2", "Loelect", "Loelectm", "Loflathl", "Loflatrm", "Loflattm", "Loflr_Hl", "Loflr_Rm", "Loflrbhl", "Loflrdry", "Lohalltm", "Lohnstrm", "Lopic_Rm", "Lopiccolo", "Lopopsht", "Lopuresn", "Loroomk1", "Loroomk2", "Loroomsn", "Loroomtm", "Lostabrm", "Losticks", "Losuprtm", "Lotimbli", "Lotitesn", "Lotruesn", "Low_Wood", "Lowetsid", "Md_Block", "Md_Crash", "Md_Stomp", "Mdambtom", "Mdbig_Hl", "Mdcan_Hl", "Mdcannon", "Mdelectm", "Mdflathl", "Mdflatrm", "Mdflattm", "Mdflngtm", "Mdhalltm", "Mdroomtm", "Mdsuprtm", "Mdtimbli", "Mdtomdry", "Medbalad", "Medpicrm", "Nstysnrm", "Old_Wood", "Platesn2", "Platesn3", "Pop_Room", "Pop_Shot", "Pop_Side", "Punch_Rm", "Randmhat", "Shotroom", "Sidestik", "Smallhat", "SmplHld", "Solid_Hl", "Sprpicrm", "Stab_Rm", "Stbkwrdz", "Superpic", "Sweethat", "Techgate", "Thin_Hat", "Tightdbl", "Tighthat", "Trshcrsh", "Vari_Hat", "Verynsty", "Wet_Hat1", "Wet_Hat2", "Wet_Side", "Wetclave", "Wetflngk", "Wetflngs", "Wetnflby", "Wetrandm", "Widefngr", "Xlocanhl", "Xlocanon", "Xlsuprtm"],
       files: {"kick":"Ambntkik", "kick2":"Flngekik", "kick3":"Hirapkik", "kick4":"Honstkik", "snare":"Alloysnr", "snare2":"Flngesnr", "snare3":"Frngesnr", "snare4":"Hall_Snr", "clap":"Hi_Claps", "clap2":"Lo_Claps", "rim":"Cntr2rim", "rim2":"Dynorim1", "rim3":"Dynorim2", "rim4":"Rim2cntr", "hh_closed":"Closdhat", "hh_open":"Open_Hat", "hh_open2":"Openhat2", "tom_hi":"Hitomdry", "tom_low":"Lotomdry", "cowbell":"Drapcow", "cowbell2":"Hicowbel", "cowbell3":"Hirapcow", "cowbell4":"Locowbel", "ride":"Flngride", "ride2":"Hardride", "ride3":"Liveride", "ride4":"Ridebell", "231bSmplHld":"231bSmplHld", "231cSmplHld":"231cSmplHld", "231dSmplHld":"231dSmplHld", "Ambntelc":"Ambntelc", "Backn4th":"Backn4th", "Backwrdz":"Backwrdz", "Balladkk":"Balladkk", "Bamboo":"Bamboo", "Batterrm":"Batterrm", "Bigbalad":"Bigbalad", "Bluefoot":"Bluefoot", "Bmbocmbo":"Bmbocmbo", "Britrmkk":"Britrmkk", "Brt_Hall":"Brt_Hall", "Brtpicrm":"Brtpicrm", "Brtpunch":"Brtpunch", "Brushhit":"Brushhit", "Cabasa":"Cabasa", "Chromesn":"Chromesn", "Cmbocrsh":"Cmbocrsh", "Coldblok":"Coldblok", "Dbl_Head":"Dbl_Head", "Dblhd_Rm":"Dblhd_Rm", "Dynconga":"Dynconga", "Dynohlsn":"Dynohlsn", "Edge_Hat":"Edge_Hat", "Electrnc":"Electrnc", "Firecrkr":"Firecrkr", "Fishstik":"Fishstik", "Flabbyrm":"Flabbyrm", "Flngcrsh":"Flngcrsh", "Flngtm":"Flngtm", "Flrambtm":"Flrambtm", "Flrbighl":"Flrbighl", "Flrhltom":"Flrhltom", "Flrrmtom":"Flrrmtom", "Flrtmdry":"Flrtmdry", "Fngrsnap":"Fngrsnap", "Frogfish":"Frogfish", "Garagekk":"Garagekk", "Half_Hat":"Half_Hat", "Hallfoot":"Hallfoot", "Hard_Hat":"Hard_Hat", "Head_Pnch":"Head_Pnch", "Hi_Agogo":"Hi_Agogo", "Hi_Clave":"Hi_Clave", "Hi_Conga":"Hi_Conga", "Hi_Crash":"Hi_Crash", "Hi_Elect":"Hi_Elect", "Hi_Foot":"Hi_Foot", "Hi_Stomp":"Hi_Stomp", "Hiambtom":"Hiambtom", "Hibig_Hl":"Hibig_Hl", "Hiblock":"Hiblock", "Hican_Hl":"Hican_Hl", "Hicannon":"Hicannon", "Hicgaslp":"Hicgaslp", "Hielectm":"Hielectm", "Hiflathl":"Hiflathl", "Hiflatrm":"Hiflatrm", "Hiflattm":"Hiflattm", "Hiflngtm":"Hiflngtm", "Hihalltm":"Hihalltm", "Hipic_Rm":"Hipic_Rm", "Hipiccolo":"Hipiccolo", "Hipopsht":"Hipopsht", "Hipuresn":"Hipuresn", "Hiroomtm":"Hiroomtm", "Histicks":"Histicks", "Hisuprtm":"Hisuprtm", "Hitimbli":"Hitimbli", "Hititesn":"Hititesn", "Hitruesn":"Hitruesn", "Honst_Rm":"Honst_Rm", "Impact":"Impact", "Liverid2":"Liverid2", "Lo_Block":"Lo_Block", "Lo_Clave":"Lo_Clave", "Lo_Conga":"Lo_Conga", "Lo_Crash":"Lo_Crash", "Lo_Fish":"Lo_Fish", "Lo_Foot":"Lo_Foot", "Lo_Honst":"Lo_Honst", "Lo_Stab":"Lo_Stab", "Lo_Stomp":"Lo_Stomp", "Loagogo":"Loagogo", "Loambflr":"Loambflr", "Loambtom":"Loambtom", "Lobig_Hl":"Lobig_Hl", "Lobkwrdz":"Lobkwrdz", "Locan_Hl":"Locan_Hl", "Locannon":"Locannon", "Locgaslp":"Locgaslp", "Lochrome":"Lochrome", "Lodblhrm":"Lodblhrm", "Lodyncga":"Lodyncga", "Lodynsn2":"Lodynsn2", "Loelect":"Loelect", "Loelectm":"Loelectm", "Loflathl":"Loflathl", "Loflatrm":"Loflatrm", "Loflattm":"Loflattm", "Loflr_Hl":"Loflr_Hl", "Loflr_Rm":"Loflr_Rm", "Loflrbhl":"Loflrbhl", "Loflrdry":"Loflrdry", "Lohalltm":"Lohalltm", "Lohnstrm":"Lohnstrm", "Lopic_Rm":"Lopic_Rm", "Lopiccolo":"Lopiccolo", "Lopopsht":"Lopopsht", "Lopuresn":"Lopuresn", "Loroomk1":"Loroomk1", "Loroomk2":"Loroomk2", "Loroomsn":"Loroomsn", "Loroomtm":"Loroomtm", "Lostabrm":"Lostabrm", "Losticks":"Losticks", "Losuprtm":"Losuprtm", "Lotimbli":"Lotimbli", "Lotitesn":"Lotitesn", "Lotruesn":"Lotruesn", "Low_Wood":"Low_Wood", "Lowetsid":"Lowetsid", "Md_Block":"Md_Block", "Md_Crash":"Md_Crash", "Md_Stomp":"Md_Stomp", "Mdambtom":"Mdambtom", "Mdbig_Hl":"Mdbig_Hl", "Mdcan_Hl":"Mdcan_Hl", "Mdcannon":"Mdcannon", "Mdelectm":"Mdelectm", "Mdflathl":"Mdflathl", "Mdflatrm":"Mdflatrm", "Mdflattm":"Mdflattm", "Mdflngtm":"Mdflngtm", "Mdhalltm":"Mdhalltm", "Mdroomtm":"Mdroomtm", "Mdsuprtm":"Mdsuprtm", "Mdtimbli":"Mdtimbli", "Mdtomdry":"Mdtomdry", "Medbalad":"Medbalad", "Medpicrm":"Medpicrm", "Nstysnrm":"Nstysnrm", "Old_Wood":"Old_Wood", "Platesn2":"Platesn2", "Platesn3":"Platesn3", "Pop_Room":"Pop_Room", "Pop_Shot":"Pop_Shot", "Pop_Side":"Pop_Side", "Punch_Rm":"Punch_Rm", "Randmhat":"Randmhat", "Shotroom":"Shotroom", "Sidestik":"Sidestik", "Smallhat":"Smallhat", "SmplHld":"SmplHld", "Solid_Hl":"Solid_Hl", "Sprpicrm":"Sprpicrm", "Stab_Rm":"Stab_Rm", "Stbkwrdz":"Stbkwrdz", "Superpic":"Superpic", "Sweethat":"Sweethat", "Techgate":"Techgate", "Thin_Hat":"Thin_Hat", "Tightdbl":"Tightdbl", "Tighthat":"Tighthat", "Trshcrsh":"Trshcrsh", "Vari_Hat":"Vari_Hat", "Verynsty":"Verynsty", "Wet_Hat1":"Wet_Hat1", "Wet_Hat2":"Wet_Hat2", "Wet_Side":"Wet_Side", "Wetclave":"Wetclave", "Wetflngk":"Wetflngk", "Wetflngs":"Wetflngs", "Wetnflby":"Wetnflby", "Wetrandm":"Wetrandm", "Widefngr":"Widefngr", "Xlocanhl":"Xlocanhl", "Xlocanon":"Xlocanon", "Xlsuprtm":"Xlsuprtm"}},
      {id: "r8", name: "Roland R-8",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "rim", "rim2", "rim3", "rim4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "hh_open2", "hh_open3", "hh_open4", "tom_hi", "tom_hi2", "tom_hi3", "tom_low", "tom_low2", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "BBend", "Bell", "BellD", "Bells", "Block1", "Block2", "Block3", "BongoHi", "BongoLo", "Brush01", "Brush02", "Brush03", "Brush04", "Brush05", "Brush06", "Cabasa", "Can", "Castanet", "Caxixi", "Chime", "Chinese", "Concert", "CongHi", "CongLo", "CongMut", "Cuica1", "Cuica2", "Daiko1", "Daiko2", "Daiko3", "Darbuka1", "Darbuka2", "Deep", "Djembe1", "Djembe2", "Djembe3", "FingerCym", "Flex", "Gong", "Guiro1", "Guiro2", "Hat_P01", "HiQ", "Kalimba", "Log", "Noise", "Ohkawa", "OpenDrum", "Pandiero1", "Pandiero2", "Pandiero3", "Satellite", "Slap", "Sleigh", "Spark", "Splash01", "Splash02", "Surdo1", "Surdo2", "Tabla1", "Tabla2", "Tabla3", "Tabla4", "Taiko", "Talk1", "Talk2", "Thriller", "TimbaleHi", "TimbaleLo", "Timpani", "Tom04", "Tom05", "Tom06", "Tom07", "Tom08", "Tom09", "Tom10", "Tom11", "Tom12", "Tom13", "Tom14", "Tom15", "Tom16", "Tom17", "Tom18", "Tom19", "Tom20", "Tom21", "Tom22", "Tom23", "Tom24", "Tom25", "Tom26", "Tom27", "Tom28", "Tom29", "Tom30", "Tom31", "Tom32", "Tom33", "Tom34", "Tom35", "Tom36", "Tom37", "Tom38", "TomB", "TomE", "TsuzumiHi", "TsuzumiLo", "Vibra", "Whistle1", "Whistle2"],
       files: {"kick":"Kick01", "kick2":"Kick02", "kick3":"Kick03", "kick4":"Kick04", "snare":"Snare01", "snare2":"Snare02", "snare3":"Snare03", "snare4":"Snare04", "clap":"Clap01", "clap2":"Clap02", "clap3":"FingerSnap", "rim":"Rim01", "rim2":"Rim02", "rim3":"Rim03", "rim4":"Rim04", "hh_closed":"Hat_C01", "hh_closed2":"Hat_C02", "hh_closed3":"Hat_C03", "hh_closed4":"Hat_C04", "hh_open":"Hat_O01", "hh_open2":"Hat_O02", "hh_open3":"Hat_O03", "hh_open4":"Hat_O04", "tom_hi":"Tom01", "tom_hi2":"TomH2", "tom_hi3":"TomHeavy", "tom_low":"Tom02", "tom_low2":"Tom03", "cowbell":"Agogo", "cowbell2":"Clave", "cowbell3":"Cow1", "cowbell4":"Cow2", "ride":"Crash01", "ride2":"Crash02", "ride3":"Crash03", "ride4":"Crash04", "BBend":"BBend", "Bell":"Bell", "BellD":"BellD", "Bells":"Bells", "Block1":"Block1", "Block2":"Block2", "Block3":"Block3", "BongoHi":"BongoHi", "BongoLo":"BongoLo", "Brush01":"Brush01", "Brush02":"Brush02", "Brush03":"Brush03", "Brush04":"Brush04", "Brush05":"Brush05", "Brush06":"Brush06", "Cabasa":"Cabasa", "Can":"Can", "Castanet":"Castanet", "Caxixi":"Caxixi", "Chime":"Chime", "Chinese":"Chinese", "Concert":"Concert", "CongHi":"CongHi", "CongLo":"CongLo", "CongMut":"CongMut", "Cuica1":"Cuica1", "Cuica2":"Cuica2", "Daiko1":"Daiko1", "Daiko2":"Daiko2", "Daiko3":"Daiko3", "Darbuka1":"Darbuka1", "Darbuka2":"Darbuka2", "Deep":"Deep", "Djembe1":"Djembe1", "Djembe2":"Djembe2", "Djembe3":"Djembe3", "FingerCym":"FingerCym", "Flex":"Flex", "Gong":"Gong", "Guiro1":"Guiro1", "Guiro2":"Guiro2", "Hat_P01":"Hat_P01", "HiQ":"HiQ", "Kalimba":"Kalimba", "Log":"Log", "Noise":"Noise", "Ohkawa":"Ohkawa", "OpenDrum":"OpenDrum", "Pandiero1":"Pandiero1", "Pandiero2":"Pandiero2", "Pandiero3":"Pandiero3", "Satellite":"Satellite", "Slap":"Slap", "Sleigh":"Sleigh", "Spark":"Spark", "Splash01":"Splash01", "Splash02":"Splash02", "Surdo1":"Surdo1", "Surdo2":"Surdo2", "Tabla1":"Tabla1", "Tabla2":"Tabla2", "Tabla3":"Tabla3", "Tabla4":"Tabla4", "Taiko":"Taiko", "Talk1":"Talk1", "Talk2":"Talk2", "Thriller":"Thriller", "TimbaleHi":"TimbaleHi", "TimbaleLo":"TimbaleLo", "Timpani":"Timpani", "Tom04":"Tom04", "Tom05":"Tom05", "Tom06":"Tom06", "Tom07":"Tom07", "Tom08":"Tom08", "Tom09":"Tom09", "Tom10":"Tom10", "Tom11":"Tom11", "Tom12":"Tom12", "Tom13":"Tom13", "Tom14":"Tom14", "Tom15":"Tom15", "Tom16":"Tom16", "Tom17":"Tom17", "Tom18":"Tom18", "Tom19":"Tom19", "Tom20":"Tom20", "Tom21":"Tom21", "Tom22":"Tom22", "Tom23":"Tom23", "Tom24":"Tom24", "Tom25":"Tom25", "Tom26":"Tom26", "Tom27":"Tom27", "Tom28":"Tom28", "Tom29":"Tom29", "Tom30":"Tom30", "Tom31":"Tom31", "Tom32":"Tom32", "Tom33":"Tom33", "Tom34":"Tom34", "Tom35":"Tom35", "Tom36":"Tom36", "Tom37":"Tom37", "Tom38":"Tom38", "TomB":"TomB", "TomE":"TomE", "TsuzumiHi":"TsuzumiHi", "TsuzumiLo":"TsuzumiLo", "Vibra":"Vibra", "Whistle1":"Whistle1", "Whistle2":"Whistle2"}},
      {id: "tr505", name: "Roland TR-505",
       slots: ["kick", "snare", "clap", "clap2", "rim", "rim2", "hh_closed", "hh_closed2", "hh_open", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "tom_low", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "Conga_Hi", "Conga_Lo", "High_Conga", "Low_Conga", "Mid_Tom-Tom", "Timbale"],
       files: {"kick":"Kick", "snare":"Snare", "clap":"Clap", "clap2":"Hand Clap", "rim":"Rim Shot", "rim2":"Rim", "hh_closed":"Closed Hihat", "hh_closed2":"Hat C", "hh_open":"Open Hihat", "tom_hi":"High Tom-Tom", "tom_hi2":"Tom Hi", "tom_hi3":"Tom Lo", "tom_hi4":"Tom Mid", "tom_low":"Low Tom-Tom", "cowbell":"Cow Hi", "cowbell2":"Cow Lo", "cowbell3":"High Cowbell", "cowbell4":"Low Cowbell", "ride":"Crash Cymbal", "ride2":"Crash", "ride3":"Ride Cymbal", "ride4":"Ride", "Conga_Hi":"Conga Hi", "Conga_Lo":"Conga Lo", "High_Conga":"High Conga", "Low_Conga":"Low Conga", "Mid_Tom-Tom":"Mid Tom-Tom", "Timbale":"Timbale"}},
      {id: "kr55", name: "Korg KR-55",
       slots: ["kick", "snare", "rim", "hh_closed", "cowbell", "ride", "Clav", "Conga", "Hat", "Tom"],
       files: {"kick":"Kick", "snare":"Snare", "rim":"Rim", "hh_closed":"Chat", "cowbell":"Cowb", "ride":"Cymb", "Clav":"Clav", "Conga":"Conga", "Hat":"Hat", "Tom":"Tom"}},
      {id: "dr110", name: "Boss DR-110",
       slots: ["Chh", "Cht", "Clp", "Cym", "Kik", "Ohh", "Oht", "Snr"],
       files: {"Chh":"Chh", "Cht":"Cht", "Clp":"Clp", "Cym":"Cym", "Kik":"Kik", "Ohh":"Ohh", "Oht":"Oht", "Snr":"Snr"}},
      {id: "rx5", name: "Yamaha RX-5",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "rim", "rim2", "hh_closed", "hh_closed2", "hh_closed3", "tom_hi", "tom_low", "tom_low2", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "Bongo_H", "Bongo_L", "Castinet", "China", "Conga_H1", "Conga_H2", "Conga_L", "Cuica", "Cup", "Edge", "Etom1", "Etom2", "Etom3", "Etom4", "Fmperc1", "Fwperc2", "Glass", "Heavy_K1", "Heavy_K2", "Heavy_K3", "Heavy_S1", "Heavy_S2", "Heavy_S3", "Heavy_T1", "Heavy_T2", "Heavy_T3", "Heavy_T4", "Mallet_Crash", "Timbale_H", "Timbale_L", "Timpani", "Tom4", "Whistle"],
       files: {"kick":"BassDrum 1", "kick2":"BassDrum 2", "kick3":"BassDrum 3", "kick4":"Kick1", "snare":"Snare1", "snare2":"Snare2", "snare3":"Snare3", "snare4":"SnareDrum 1", "clap":"Clap", "clap2":"Claps", "rim":"Rim 1", "rim2":"Rim 2", "hh_closed":"Hh Cl", "hh_closed2":"Hh Op 1", "hh_closed3":"Hh Pedal", "tom_hi":"Tom1", "tom_low":"Tom2", "tom_low2":"Tom3", "cowbell":"Agogo H", "cowbell2":"Agogo L", "cowbell3":"Cowbell", "cowbell4":"Cowbell2", "ride":"Crash 2", "ride2":"Crash", "Bongo_H":"Bongo H", "Bongo_L":"Bongo L", "Castinet":"Castinet", "China":"China", "Conga_H1":"Conga H1", "Conga_H2":"Conga H2", "Conga_L":"Conga L", "Cuica":"Cuica", "Cup":"Cup", "Edge":"Edge", "Etom1":"Etom1", "Etom2":"Etom2", "Etom3":"Etom3", "Etom4":"Etom4", "Fmperc1":"Fmperc1", "Fwperc2":"Fwperc2", "Glass":"Glass", "Heavy_K1":"Heavy K1", "Heavy_K2":"Heavy K2", "Heavy_K3":"Heavy K3", "Heavy_S1":"Heavy S1", "Heavy_S2":"Heavy S2", "Heavy_S3":"Heavy S3", "Heavy_T1":"Heavy T1", "Heavy_T2":"Heavy T2", "Heavy_T3":"Heavy T3", "Heavy_T4":"Heavy T4", "Mallet_Crash":"Mallet Crash", "Timbale_H":"Timbale H", "Timbale_L":"Timbale L", "Timpani":"Timpani", "Tom4":"Tom4", "Whistle":"Whistle"}},
      {id: "drumulator", name: "EMU Drumulator",
       slots: ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55"],
       files: {"00":"00", "01":"01", "02":"02", "03":"03", "04":"04", "05":"05", "06":"06", "07":"07", "08":"08", "09":"09", "10":"10", "11":"11", "12":"12", "13":"13", "14":"14", "15":"15", "16":"16", "17":"17", "18":"18", "19":"19", "20":"20", "21":"21", "22":"22", "23":"23", "24":"24", "25":"25", "26":"26", "27":"27", "28":"28", "29":"29", "30":"30", "31":"31", "32":"32", "33":"33", "34":"34", "35":"35", "36":"36", "37":"37", "38":"38", "39":"39", "40":"40", "41":"41", "42":"42", "43":"43", "44":"44", "45":"45", "46":"46", "47":"47", "48":"48", "49":"49", "50":"50", "51":"51", "52":"52", "53":"53", "54":"54", "55":"55"}},
      {id: "mpc3000", name: "Akai MPC3000",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "clap", "clap2", "rim", "hh_closed", "hh_closed2", "hh_closed3", "hh_open", "hh_open2", "hh_open3", "tom_hi", "tom_low", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "51e_Shaker", "Ago_Go_35ed", "Ago_Go_36ed", "Bobby_Sn", "Bongo_Hi_Op", "Bongo_Hi_Slap", "Bongo_Lo_Op", "Bongo_Lo_Slap", "Cabasa", "Castanet", "Chekere_Shot", "Chekereshake", "Cl_Hat_3001", "Claves", "Conga_Cl_Mt", "Conga_Hi_Op", "Conga_L_Toe", "Conga_Op", "Cuica_Hi", "Cuica_Lo", "Fx_Cabasa", "Fx_Mix_Tom", "Fx_Sn_2", "Fx_Syn_Sn", "Gatesn_3002", "Gtd_Cabasa", "Gtd_H_Con_Rl", "Gtd_L_Con_Rl", "Gtd_M_Con_Rl", "Gtd_Timb_Hi", "Gtd_Timb_Lo", "Gtd_W_Block", "Guiro", "Guiro_Shot", "Huge_Tom", "Jv_Cymb_L", "Log_Drum_Hi", "Log_Drum_Low", "Marktree_L_H", "Md_Hat_3001", "Metal_Flange", "Mh_Amb_Sn1", "Mix_Hat_Pedl", "Mix_Sn28gtd", "Op_Hat_3001", "Picolo_Sn_3001", "Res_Noise", "Rl_N_Tomf", "Rl_N_Tomm", "S2_Tamb1_Eq", "Slay_Bell", "Splash_3001", "Std_Timb_H", "Std_Timb_L", "Syn_Mix_Tom", "Talking_Down", "Talking_Hi", "Talking_Low", "Talking_Up", "Thumb_Noiz", "Whistle_High", "Wood_Block", "_Splash"],
       files: {"kick":"Dance_Kick", "kick2":"Heavy_Kick", "kick3":"Mg_Kick_10", "kick4":"Mh_Heavy_Kik", "snare":"Snare_3002", "clap":"Finger_Snaps", "clap2":"Gtd_Clap", "rim":"Side_Stick", "hh_closed":"Cm_Hat_Cl", "hh_closed2":"Fx_Hh_Cl", "hh_closed3":"Syn_Hh_Cl", "hh_open":"Cm_Hat_Op", "hh_open2":"Fx_Hat_Op", "hh_open3":"Syn_Hh_Op", "tom_hi":"Rl_N_Tomh", "tom_low":"Rl_N_Toml", "cowbell":"Agogo_Fx_Hi", "cowbell2":"Agogo_Fx_Low", "cowbell3":"Cowbell_3001", "cowbell4":"Gtd_Cowbell", "ride":"Cymbal_3001", "ride2":"Cymbal_3002", "ride3":"Cymbal_3003", "ride4":"Fx_Cymbal", "51e_Shaker":"51e_Shaker", "Ago_Go_35ed":"Ago_Go_35ed", "Ago_Go_36ed":"Ago_Go_36ed", "Bobby_Sn":"Bobby_Sn", "Bongo_Hi_Op":"Bongo_Hi_Op", "Bongo_Hi_Slap":"Bongo_Hi_Slap", "Bongo_Lo_Op":"Bongo_Lo_Op", "Bongo_Lo_Slap":"Bongo_Lo_Slap", "Cabasa":"Cabasa", "Castanet":"Castanet", "Chekere_Shot":"Chekere_Shot", "Chekereshake":"Chekereshake", "Cl_Hat_3001":"Cl_Hat_3001", "Claves":"Claves", "Conga_Cl_Mt":"Conga_Cl_Mt", "Conga_Hi_Op":"Conga_Hi_Op", "Conga_L_Toe":"Conga_L_Toe", "Conga_Op":"Conga_Op", "Cuica_Hi":"Cuica_Hi", "Cuica_Lo":"Cuica_Lo", "Fx_Cabasa":"Fx_Cabasa", "Fx_Mix_Tom":"Fx_Mix_Tom", "Fx_Sn_2":"Fx_Sn_2", "Fx_Syn_Sn":"Fx_Syn_Sn", "Gatesn_3002":"Gatesn_3002", "Gtd_Cabasa":"Gtd_Cabasa", "Gtd_H_Con_Rl":"Gtd_H_Con_Rl", "Gtd_L_Con_Rl":"Gtd_L_Con_Rl", "Gtd_M_Con_Rl":"Gtd_M_Con_Rl", "Gtd_Timb_Hi":"Gtd_Timb_Hi", "Gtd_Timb_Lo":"Gtd_Timb_Lo", "Gtd_W_Block":"Gtd_W_Block", "Guiro":"Guiro", "Guiro_Shot":"Guiro_Shot", "Huge_Tom":"Huge_Tom", "Jv_Cymb_L":"Jv_Cymb_L", "Log_Drum_Hi":"Log_Drum_Hi", "Log_Drum_Low":"Log_Drum_Low", "Marktree_L_H":"Marktree_L_H", "Md_Hat_3001":"Md_Hat_3001", "Metal_Flange":"Metal_Flange", "Mh_Amb_Sn1":"Mh_Amb_Sn1", "Mix_Hat_Pedl":"Mix_Hat_Pedl", "Mix_Sn28gtd":"Mix_Sn28gtd", "Op_Hat_3001":"Op_Hat_3001", "Picolo_Sn_3001":"Picolo_Sn_3001", "Res_Noise":"Res_Noise", "Rl_N_Tomf":"Rl_N_Tomf", "Rl_N_Tomm":"Rl_N_Tomm", "S2_Tamb1_Eq":"S2_Tamb1_Eq", "Slay_Bell":"Slay_Bell", "Splash_3001":"Splash_3001", "Std_Timb_H":"Std_Timb_H", "Std_Timb_L":"Std_Timb_L", "Syn_Mix_Tom":"Syn_Mix_Tom", "Talking_Down":"Talking_Down", "Talking_Hi":"Talking_Hi", "Talking_Low":"Talking_Low", "Talking_Up":"Talking_Up", "Thumb_Noiz":"Thumb_Noiz", "Whistle_High":"Whistle_High", "Wood_Block":"Wood_Block", "_Splash":"_Splash"}},
      {id: "mpc2000", name: "Akai MPC2000",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "clap", "clap2", "rim", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "tom_hi", "tom_low", "ride", "ride2", "ride3", "ride4", "Efex_Cy02_Sa", "Hip_HH_1", "Hip_LHH", "Hip_S_Sn", "Hip_Sn_7", "Houc_Tom_Sa", "Mhbb_Sn", "New_Fx1tom", "Nori_Sn_0", "Nr_Crs_A", "Nr_HH_L_A5", "Nr_Splash", "Nr_Tom_F", "Nr_Tom_M", "Pw_Mix_Sd02s", "Reso_Cyn_1", "Rev_Slap", "St_Ambsn7", "Sy_Tom_1", "Thin_Crash1", "Thin_HH_Ft", "Tt_HH12_F8"],
       files: {"kick":"808_Kick", "kick2":"808_Lng_Kick", "kick3":"Hip_Kick", "kick4":"Kick_F", "snare":"808_Snare", "clap":"F_Clap_1", "clap2":"F_Clap_2", "rim":"P_Sn_Rim", "hh_closed":"808_HH_Cl", "hh_closed2":"HH_Thin", "hh_closed3":"HH_Thin_Op", "hh_closed4":"Nr_HH_C_A1", "hh_open":"808_HH_Op", "tom_hi":"Nr_Tom_H", "tom_low":"Nr_Tom_L", "ride":"Crash_1", "ride2":"Crash_Cym", "ride3":"M16_Ride", "ride4":"Thin_Ride", "Efex_Cy02_Sa":"Efex_Cy02_Sa", "Hip_HH_1":"Hip_HH_1", "Hip_LHH":"Hip_LHH", "Hip_S_Sn":"Hip_S_Sn", "Hip_Sn_7":"Hip_Sn_7", "Houc_Tom_Sa":"Houc_Tom_Sa", "Mhbb_Sn":"Mhbb_Sn", "New_Fx1tom":"New_Fx1tom", "Nori_Sn_0":"Nori_Sn_0", "Nr_Crs_A":"Nr_Crs_A", "Nr_HH_L_A5":"Nr_HH_L_A5", "Nr_Splash":"Nr_Splash", "Nr_Tom_F":"Nr_Tom_F", "Nr_Tom_M":"Nr_Tom_M", "Pw_Mix_Sd02s":"Pw_Mix_Sd02s", "Reso_Cyn_1":"Reso_Cyn_1", "Rev_Slap":"Rev_Slap", "St_Ambsn7":"St_Ambsn7", "Sy_Tom_1":"Sy_Tom_1", "Thin_Crash1":"Thin_Crash1", "Thin_HH_Ft":"Thin_HH_Ft", "Tt_HH12_F8":"Tt_HH12_F8"}},
      {id: "sp1200", name: "EMU SP-1200",
       slots: ["kick", "kick2", "snare", "snare2", "snare3", "rim", "hh_closed", "hh_closed2", "hh_open", "tom_hi", "tom_low", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "Cabasa1", "Cabasa2", "China", "Conga2", "Conga3", "Conga4", "Finger", "Guiro1", "Guiro2", "Per1", "Per2", "Per3", "Per4", "Per5", "Per6", "Timb1", "Timb2", "Vibra"],
       files: {"kick":"Kick1", "kick2":"Kick2", "snare":"Snare1", "snare2":"Snare2", "snare3":"Snare3", "rim":"Rim", "hh_closed":"Clhh1", "hh_closed2":"Clhh2", "hh_open":"Ophh1", "tom_hi":"Tom1", "tom_low":"Tom2", "cowbell":"Agogo1", "cowbell2":"Clave1", "cowbell3":"Clave2", "cowbell4":"Conga1", "ride":"Cymb", "ride2":"Ride1", "Cabasa1":"Cabasa1", "Cabasa2":"Cabasa2", "China":"China", "Conga2":"Conga2", "Conga3":"Conga3", "Conga4":"Conga4", "Finger":"Finger", "Guiro1":"Guiro1", "Guiro2":"Guiro2", "Per1":"Per1", "Per2":"Per2", "Per3":"Per3", "Per4":"Per4", "Per5":"Per5", "Per6":"Per6", "Timb1":"Timb1", "Timb2":"Timb2", "Vibra":"Vibra"}},
      {id: "sp12", name: "EMU SP-12",
       slots: ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31"],
       files: {"00":"00", "01":"01", "02":"02", "03":"03", "04":"04", "05":"05", "06":"06", "07":"07", "08":"08", "09":"09", "10":"10", "11":"11", "12":"12", "13":"13", "14":"14", "15":"15", "16":"16", "17":"17", "18":"18", "19":"19", "20":"20", "21":"21", "22":"22", "23":"23", "24":"24", "25":"25", "26":"26", "27":"27", "28":"28", "29":"29", "30":"30", "31":"31"}},
      {id: "asrx", name: "Ensoniq ASR-X",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "ride", "ride2", "ride3", "ride4", "Hat_01", "Hat_02", "Hat_03", "Hat_04", "Hat_05", "Hat_06", "Hat_07", "Hat_08", "Hat_09", "Hat_10", "Hat_11", "Hat_12", "Hat_13", "Hat_14", "Hat_15", "Hat_16"],
       files: {"kick":"Kick 01", "kick2":"Kick 02", "kick3":"Kick 03", "kick4":"Kick 04", "snare":"Snare 01", "snare2":"Snare 02", "snare3":"Snare 03", "snare4":"Snare 04", "ride":"Crash 1", "ride2":"Ride 01", "ride3":"Ride 02", "ride4":"Ride 03", "Hat_01":"Hat 01", "Hat_02":"Hat 02", "Hat_03":"Hat 03", "Hat_04":"Hat 04", "Hat_05":"Hat 05", "Hat_06":"Hat 06", "Hat_07":"Hat 07", "Hat_08":"Hat 08", "Hat_09":"Hat 09", "Hat_10":"Hat 10", "Hat_11":"Hat 11", "Hat_12":"Hat 12", "Hat_13":"Hat 13", "Hat_14":"Hat 14", "Hat_15":"Hat 15", "Hat_16":"Hat 16"}},
      {id: "mirage", name: "Ensoniq Mirage",
       slots: ["kick", "kick2", "snare", "snare2", "clap", "clap2", "rim", "hh_open", "hh_open2", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "cowbell", "cowbell2", "cowbell3", "ride", "ride2", "ride3", "ride4", "Cabasa_Louder", "Cabasa", "Hat_1a", "Hat_1b", "Hat_1c"],
       files: {"kick":"Kick 1a", "kick2":"Kick 1b", "snare":"Snare 1a", "snare2":"Snare 1b", "clap":"Clap Filter", "clap2":"Clap", "rim":"Rim", "hh_open":"Hat Open 1a", "hh_open2":"Hat Open 1b", "tom_hi":"Tom Hi Mid", "tom_hi2":"Tom Hi", "tom_hi3":"Tom Lo Mid", "tom_hi4":"Tom Lo", "cowbell":"Cowbell", "cowbell2":"Tamb Hi", "cowbell3":"Tamb Lo", "ride":"Crash 1a", "ride2":"Crash 1b", "ride3":"Crash 1c", "ride4":"Crash 1d", "Cabasa_Louder":"Cabasa Louder", "Cabasa":"Cabasa", "Hat_1a":"Hat 1a", "Hat_1b":"Hat 1b", "Hat_1c":"Hat 1c"}},
      {id: "sds5", name: "Simmons SDS-5",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "rim", "rim2", "rim3", "rim4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "tom_low", "tom_low2", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "Crack", "Tom10", "Tom11", "Tom12", "Tom13", "Tom14", "Tom15", "Tom16", "Tom17", "Tom4", "Tom5", "Tom6", "Tom7", "Tom8", "Tom9"],
       files: {"kick":"BassDrumrum1", "kick2":"BassDrumrum10", "kick3":"BassDrumrum11", "kick4":"BassDrumrum12", "snare":"Snare Hi 1", "snare2":"Snare Hi 2", "snare3":"Snare Lo", "snare4":"Snare Mid", "rim":"Rimshot1", "rim2":"Rimshot2", "rim3":"Rimshot3", "rim4":"Rimshot4", "hh_closed":"HH_close1", "hh_closed2":"HH_close2", "hh_closed3":"HH_close3", "hh_closed4":"HH_open1", "tom_hi":"Tom 1", "tom_hi2":"Tom 2", "tom_hi3":"Tom 3", "tom_hi4":"Tom 4", "tom_low":"Tom2", "tom_low2":"Tom3", "01":"01", "02":"02", "03":"03", "04":"04", "05":"05", "06":"06", "07":"07", "08":"08", "09":"09", "10":"10", "11":"11", "12":"12", "13":"13", "14":"14", "15":"15", "16":"16", "17":"17", "18":"18", "19":"19", "20":"20", "21":"21", "22":"22", "23":"23", "24":"24", "25":"25", "26":"26", "27":"27", "28":"28", "29":"29", "30":"30", "31":"31", "32":"32", "Crack":"Crack", "Tom10":"Tom10", "Tom11":"Tom11", "Tom12":"Tom12", "Tom13":"Tom13", "Tom14":"Tom14", "Tom15":"Tom15", "Tom16":"Tom16", "Tom17":"Tom17", "Tom4":"Tom4", "Tom5":"Tom5", "Tom6":"Tom6", "Tom7":"Tom7", "Tom8":"Tom8", "Tom9":"Tom9"}},
      {id: "sds9", name: "Simmons SDS-9",
       slots: ["kick", "kick2", "snare", "snare2", "snare3", "snare4", "rim", "rim2", "rim3", "rim4", "tom_hi", "tom_hi2", "tom_low", "tom_low2", "MT", "MT"],
       files: {"kick":"BD", "kick2":"BD", "snare":"SD", "snare2":"SN", "snare3":"SN", "snare4":"Sn1", "rim":"RM", "rim2":"RM", "rim3":"RM1_B", "rim4":"RM2_A", "tom_hi":"HT", "tom_hi2":"HT", "tom_low":"LT", "tom_low2":"LT", "MT":"MT"}},
      {id: "machinedrum", name: "Elektron MachineDrum",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "clap4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "Hats_0000", "Hats_0001", "Hats_0002", "Hats_0003", "Hats_0004", "Hats_0005", "Hats_0006", "Hats_0007", "Hats_0008", "Hats_0009", "Hats_0010", "Hats_0011", "Hats_0012", "Hats_0013", "Hats_0014", "Hats_0015", "Hats_0016", "Hats_0017", "Hats_0018", "Hats_0019", "Hats_0020", "Hats_0021", "Hats_0022", "Hats_0023", "Hats_0024", "Hats_0025", "Hats_0026", "Hats_0027", "Hats_0028", "Hats_0029", "Hats_0030", "Hats_0031", "Hats_0032", "Hats_0033", "Hats_0034", "Hats_0035", "Hats_0036", "Hats_0037", "Hats_0038", "Hats_0039", "Hats_0040", "Hats_0041", "Hats_0042", "Hats_0043", "Hats_0044", "Hats_0045", "Hats_0046", "Hats_0047", "Hats_0048", "Hats_0049", "Hats_0050", "Hats_0051", "Hats_0052", "Hats_0053", "Hats_0054", "Hats_0055", "Hats_0056", "Hats_0057", "Hats_0058", "Stabs_0000", "Stabs_0001", "Stabs_0002", "Stabs_0003", "Stabs_0004", "Stabs_0005", "Stabs_0006", "Stabs_0007", "Stabs_0008", "Stabs_0009", "Stabs_0010", "Stabs_0011", "Stabs_0012", "Stabs_0013", "Stabs_0014", "Stabs_0015", "Stabs_0016", "Stabs_0017", "Stabs_0018", "Stabs_0019", "Stabs_0020", "Stabs_0021", "Stabs_0022", "Stabs_0023", "Stabs_0024", "Stabs_0025", "Stabs_0026", "Stabs_0027", "Stabs_0028", "Stabs_0029", "Stabs_0030", "Stabs_0031", "Stabs_0032", "Stabs_0033", "Stabs_0034"],
       files: {"kick":"Kicks 0000", "kick2":"Kicks 0001", "kick3":"Kicks 0002", "kick4":"Kicks 0003", "snare":"Snares 0000", "snare2":"Snares 0001", "snare3":"Snares 0002", "snare4":"Snares 0003", "clap":"Claps 0000", "clap2":"Claps 0001", "clap3":"Claps 0002", "clap4":"Claps 0003", "tom_hi":"Toms 0000", "tom_hi2":"Toms 0001", "tom_hi3":"Toms 0002", "tom_hi4":"Toms 0003", "cowbell":"Percs 0000", "cowbell2":"Percs 0001", "cowbell3":"Percs 0002", "cowbell4":"Percs 0003", "ride":"Cymbals 0000", "ride2":"Cymbals 0001", "ride3":"Cymbals 0002", "ride4":"Cymbals 0003", "Hats_0000":"Hats 0000", "Hats_0001":"Hats 0001", "Hats_0002":"Hats 0002", "Hats_0003":"Hats 0003", "Hats_0004":"Hats 0004", "Hats_0005":"Hats 0005", "Hats_0006":"Hats 0006", "Hats_0007":"Hats 0007", "Hats_0008":"Hats 0008", "Hats_0009":"Hats 0009", "Hats_0010":"Hats 0010", "Hats_0011":"Hats 0011", "Hats_0012":"Hats 0012", "Hats_0013":"Hats 0013", "Hats_0014":"Hats 0014", "Hats_0015":"Hats 0015", "Hats_0016":"Hats 0016", "Hats_0017":"Hats 0017", "Hats_0018":"Hats 0018", "Hats_0019":"Hats 0019", "Hats_0020":"Hats 0020", "Hats_0021":"Hats 0021", "Hats_0022":"Hats 0022", "Hats_0023":"Hats 0023", "Hats_0024":"Hats 0024", "Hats_0025":"Hats 0025", "Hats_0026":"Hats 0026", "Hats_0027":"Hats 0027", "Hats_0028":"Hats 0028", "Hats_0029":"Hats 0029", "Hats_0030":"Hats 0030", "Hats_0031":"Hats 0031", "Hats_0032":"Hats 0032", "Hats_0033":"Hats 0033", "Hats_0034":"Hats 0034", "Hats_0035":"Hats 0035", "Hats_0036":"Hats 0036", "Hats_0037":"Hats 0037", "Hats_0038":"Hats 0038", "Hats_0039":"Hats 0039", "Hats_0040":"Hats 0040", "Hats_0041":"Hats 0041", "Hats_0042":"Hats 0042", "Hats_0043":"Hats 0043", "Hats_0044":"Hats 0044", "Hats_0045":"Hats 0045", "Hats_0046":"Hats 0046", "Hats_0047":"Hats 0047", "Hats_0048":"Hats 0048", "Hats_0049":"Hats 0049", "Hats_0050":"Hats 0050", "Hats_0051":"Hats 0051", "Hats_0052":"Hats 0052", "Hats_0053":"Hats 0053", "Hats_0054":"Hats 0054", "Hats_0055":"Hats 0055", "Hats_0056":"Hats 0056", "Hats_0057":"Hats 0057", "Hats_0058":"Hats 0058", "Stabs_0000":"Stabs 0000", "Stabs_0001":"Stabs 0001", "Stabs_0002":"Stabs 0002", "Stabs_0003":"Stabs 0003", "Stabs_0004":"Stabs 0004", "Stabs_0005":"Stabs 0005", "Stabs_0006":"Stabs 0006", "Stabs_0007":"Stabs 0007", "Stabs_0008":"Stabs 0008", "Stabs_0009":"Stabs 0009", "Stabs_0010":"Stabs 0010", "Stabs_0011":"Stabs 0011", "Stabs_0012":"Stabs 0012", "Stabs_0013":"Stabs 0013", "Stabs_0014":"Stabs 0014", "Stabs_0015":"Stabs 0015", "Stabs_0016":"Stabs 0016", "Stabs_0017":"Stabs 0017", "Stabs_0018":"Stabs 0018", "Stabs_0019":"Stabs 0019", "Stabs_0020":"Stabs 0020", "Stabs_0021":"Stabs 0021", "Stabs_0022":"Stabs 0022", "Stabs_0023":"Stabs 0023", "Stabs_0024":"Stabs 0024", "Stabs_0025":"Stabs 0025", "Stabs_0026":"Stabs 0026", "Stabs_0027":"Stabs 0027", "Stabs_0028":"Stabs 0028", "Stabs_0029":"Stabs 0029", "Stabs_0030":"Stabs 0030", "Stabs_0031":"Stabs 0031", "Stabs_0032":"Stabs 0032", "Stabs_0033":"Stabs 0033", "Stabs_0034":"Stabs 0034"}},
      {id: "xbase09", name: "Jomox Xbase 09",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "rim", "rim2", "hh_closed", "hh_closed2", "hh_closed3", "hh_open", "hh_open2", "hh_open3", "ride", "ride2", "ride3", "ride4", "Breath01", "Breath02", "Breath03", "Breath04", "LFOOphh", "LongBassDrum01", "LongBassDrum02", "LongBassDrum03"],
       files: {"kick":"Bassdrum1", "kick2":"Bassdrum10", "kick3":"Bassdrum11", "kick4":"Bassdrum12", "snare":"Snare01", "snare2":"Snare02", "snare3":"Snare03", "snare4":"Snare04", "clap":"Clap01", "clap2":"Clap02", "rim":"Rim01", "rim2":"Rim02", "hh_closed":"Clhh01", "hh_closed2":"Clhh02", "hh_closed3":"Clhh03", "hh_open":"Ophh01", "hh_open2":"Ophh02", "hh_open3":"Ophh03", "ride":"Crash01", "ride2":"Crash02", "ride3":"Crash03", "ride4":"Ride01", "Breath01":"Breath01", "Breath02":"Breath02", "Breath03":"Breath03", "Breath04":"Breath04", "LFOOphh":"LFOOphh", "LongBassDrum01":"LongBassDrum01", "LongBassDrum02":"LongBassDrum02", "LongBassDrum03":"LongBassDrum03"}},
      {id: "er1", name: "Korg Electribe ER-1",
       slots: ["kick", "kick2", "snare", "snare2", "clap", "clap2", "hh_closed", "hh_open", "tom_hi", "ride", "Bleep_2", "Bleep_3", "Bleep", "Blip_2", "Blip_3", "Blip", "Boom", "Chime", "Chink", "Clank", "Glitch", "Hat", "Hi_Hat", "Laser", "Muted_Crash", "Tom", "Warble_2", "Warble"],
       files: {"kick":"Kick 2", "kick2":"Kick", "snare":"Snare 2", "snare2":"Snare", "clap":"Clap", "clap2":"Muted Clap", "hh_closed":"Hi Hat Closed", "hh_open":"Hi Hat Open", "tom_hi":"Tom 2", "ride":"Crash", "Bleep_2":"Bleep 2", "Bleep_3":"Bleep 3", "Bleep":"Bleep", "Blip_2":"Blip 2", "Blip_3":"Blip 3", "Blip":"Blip", "Boom":"Boom", "Chime":"Chime", "Chink":"Chink", "Clank":"Clank", "Glitch":"Glitch", "Hat":"Hat", "Hi_Hat":"Hi Hat", "Laser":"Laser", "Muted_Crash":"Muted Crash", "Tom":"Tom", "Warble_2":"Warble 2", "Warble":"Warble"}},
      {id: "emx1", name: "Korg Electribe EMX-1",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "clap4", "rim", "rim2", "rim3", "rim4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "cowbell", "cowbell2", "cowbell3", "cowbell4", "ride", "ride2", "ride3", "ride4", "Baya-Ghe", "Baya-Mt1", "Baya-Mt2", "Bigbreak", "Bng-Hi", "Bng-Lo1", "Bng-Lo2", "Bng-Slap", "Cabasa1", "Cabasa2", "Cabasa3", "Chachabl", "Claves", "Cng-Hi1", "Cng-Hi2", "Cng-Himt", "Cng-Lo1", "Cng-Lo2", "Cng-Lomt", "Cng-Lynnh", "Cng-Lynnl", "Djmb-1a", "Djmb-1b", "Djmb-1c", "Djmb-2a", "Djmb-2b", "Djmb-2c", "Gtrwah", "Guiro-L", "Guiro-S", "Junk1", "Junk2", "Mambobel", "Rev-BassDrum", "Rev-Crsh", "Rev-Sd1", "Rev-Sd2", "Scratch1", "Scratch2", "Scratch3", "Sleighbl", "Synperc1", "Synperc2", "Synperc3", "Synperc4", "Synperc5", "Synperc6", "Taiko-Op", "Taiko-Rm", "Tbla-Mt1", "Tbla-Mt2", "Tbla-Na", "Tbla-Tin", "Timb-Hi1", "Timb-Hi2", "Timb-Lo1", "Timb-Lo2", "Tsuzumi", "Udu", "Wbl-Dddh", "Wbl-Dddl", "Whistle", "Zap1", "Zap2"],
       files: {"kick":"BassDrum-88-1", "kick2":"BassDrum-88-2", "kick3":"BassDrum-99-1", "kick4":"BassDrum-99-2", "snare":"Sd-77", "snare2":"Sd-88-1", "snare3":"Sd-88-2", "snare4":"Sd-88-3", "clap":"Clp-88-1", "clap2":"Clp-88-2", "clap3":"Clp-99-1", "clap4":"Clp-99-2", "rim":"Rm-88", "rim2":"Rm-Ambi1", "rim3":"Rm-Ambi2", "rim4":"Rm-Ddd", "hh_closed":"Hh-88-C", "hh_closed2":"Hh-88-O", "hh_closed3":"Hh-99-1c", "hh_closed4":"Hh-99-1o", "tom_hi":"Tom-88", "tom_hi2":"Tom-99", "tom_hi3":"Tom-Jazz", "tom_hi4":"Tom-Nrmf", "cowbell":"Agogo", "cowbell2":"Cowbell", "cowbell3":"Shaker1", "cowbell4":"Shaker2", "ride":"Crs-99-1", "ride2":"Crs-99-2", "ride3":"Crs-Norm", "ride4":"Crs-Spls", "Baya-Ghe":"Baya-Ghe", "Baya-Mt1":"Baya-Mt1", "Baya-Mt2":"Baya-Mt2", "Bigbreak":"Bigbreak", "Bng-Hi":"Bng-Hi", "Bng-Lo1":"Bng-Lo1", "Bng-Lo2":"Bng-Lo2", "Bng-Slap":"Bng-Slap", "Cabasa1":"Cabasa1", "Cabasa2":"Cabasa2", "Cabasa3":"Cabasa3", "Chachabl":"Chachabl", "Claves":"Claves", "Cng-Hi1":"Cng-Hi1", "Cng-Hi2":"Cng-Hi2", "Cng-Himt":"Cng-Himt", "Cng-Lo1":"Cng-Lo1", "Cng-Lo2":"Cng-Lo2", "Cng-Lomt":"Cng-Lomt", "Cng-Lynnh":"Cng-Lynnh", "Cng-Lynnl":"Cng-Lynnl", "Djmb-1a":"Djmb-1a", "Djmb-1b":"Djmb-1b", "Djmb-1c":"Djmb-1c", "Djmb-2a":"Djmb-2a", "Djmb-2b":"Djmb-2b", "Djmb-2c":"Djmb-2c", "Gtrwah":"Gtrwah", "Guiro-L":"Guiro-L", "Guiro-S":"Guiro-S", "Junk1":"Junk1", "Junk2":"Junk2", "Mambobel":"Mambobel", "Rev-BassDrum":"Rev-BassDrum", "Rev-Crsh":"Rev-Crsh", "Rev-Sd1":"Rev-Sd1", "Rev-Sd2":"Rev-Sd2", "Scratch1":"Scratch1", "Scratch2":"Scratch2", "Scratch3":"Scratch3", "Sleighbl":"Sleighbl", "Synperc1":"Synperc1", "Synperc2":"Synperc2", "Synperc3":"Synperc3", "Synperc4":"Synperc4", "Synperc5":"Synperc5", "Synperc6":"Synperc6", "Taiko-Op":"Taiko-Op", "Taiko-Rm":"Taiko-Rm", "Tbla-Mt1":"Tbla-Mt1", "Tbla-Mt2":"Tbla-Mt2", "Tbla-Na":"Tbla-Na", "Tbla-Tin":"Tbla-Tin", "Timb-Hi1":"Timb-Hi1", "Timb-Hi2":"Timb-Hi2", "Timb-Lo1":"Timb-Lo1", "Timb-Lo2":"Timb-Lo2", "Tsuzumi":"Tsuzumi", "Udu":"Udu", "Wbl-Dddh":"Wbl-Dddh", "Wbl-Dddl":"Wbl-Dddl", "Whistle":"Whistle", "Zap1":"Zap1", "Zap2":"Zap2"}},
      {id: "vermona", name: "Vermona DRM1 MK3",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "clap4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "tom_hi", "tom_low", "tom_low2", "FX01", "FX02", "FX03", "FX04", "FX05", "FX06", "FX07", "FX08", "FX09", "FX10", "Tom04", "Tom05", "Tom06", "Tom07", "Tom08", "Tom09", "Tom10", "Tom11", "Tom12", "Tom13", "Tom14"],
       files: {"kick":"BassDrum01", "kick2":"BassDrum02", "kick3":"BassDrum03", "kick4":"BassDrum04", "snare":"SnareDrum01", "snare2":"SnareDrum02", "snare3":"SnareDrum03", "snare4":"SnareDrum04", "clap":"Clap01", "clap2":"Clap02", "clap3":"Clap03", "clap4":"Clap04", "hh_closed":"HH01", "hh_closed2":"HH02", "hh_closed3":"HH03", "hh_closed4":"HH04", "tom_hi":"Tom01", "tom_low":"Tom02", "tom_low2":"Tom03", "FX01":"FX01", "FX02":"FX02", "FX03":"FX03", "FX04":"FX04", "FX05":"FX05", "FX06":"FX06", "FX07":"FX07", "FX08":"FX08", "FX09":"FX09", "FX10":"FX10", "Tom04":"Tom04", "Tom05":"Tom05", "Tom06":"Tom06", "Tom07":"Tom07", "Tom08":"Tom08", "Tom09":"Tom09", "Tom10":"Tom10", "Tom11":"Tom11", "Tom12":"Tom12", "Tom13":"Tom13", "Tom14":"Tom14"}},
      {id: "norddrum", name: "Clavia Nord Drum",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "cowbell", "Noisetom1", "Noisetom2", "Noisetom3", "Perc2", "Perc3", "Perc4", "Perc5", "Perc6", "Perc7"],
       files: {"kick":"Kick1", "kick2":"Kick10", "kick3":"Kick2", "kick4":"Kick3", "snare":"Snare1", "snare2":"Snare10", "snare3":"Snare11", "snare4":"Snare12", "clap":"Noiseclap1", "cowbell":"Perc1", "Noisetom1":"Noisetom1", "Noisetom2":"Noisetom2", "Noisetom3":"Noisetom3", "Perc2":"Perc2", "Perc3":"Perc3", "Perc4":"Perc4", "Perc5":"Perc5", "Perc6":"Perc6", "Perc7":"Perc7"}},
      {id: "basimilus", name: "Basimilus Iteritas",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "clap4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "hh_open2", "hh_open3", "hh_open4", "cowbell", "cowbell2", "cowbell3"],
       files: {"kick":"Kick-01", "kick2":"Kick-02", "kick3":"Kick-03", "kick4":"Kick-04", "snare":"Snare-01", "snare2":"Snare-02", "snare3":"Snare-03", "snare4":"Snare-04", "clap":"Clap-01", "clap2":"Clap-02", "clap3":"Clap-03", "clap4":"Clap-04", "hh_closed":"HH-01", "hh_closed2":"HH-02", "hh_closed3":"HH-03", "hh_closed4":"HH-04", "hh_open":"OH-01", "hh_open2":"OH-02", "hh_open3":"OH-03", "hh_open4":"OH-04", "cowbell":"Perc-01", "cowbell2":"Perc-02", "cowbell3":"Perc-03"}},
      {id: "rhythmace", name: "Acetone Rhythm Ace",
       slots: ["kick", "kick2", "kick3", "snare", "snare2", "snare3", "hh_open", "cowbell", "cowbell2", "HHcl", "Perc2", "Perc3", "Perc4", "Perc5", "Perc6", "Perc7"],
       files: {"kick":"Kick1", "kick2":"Kick2", "kick3":"Kick3", "snare":"Snare1", "snare2":"Snare2", "snare3":"Snare3", "hh_open":"HHop", "cowbell":"Clave", "cowbell2":"Perc1", "HHcl":"HHcl", "Perc2":"Perc2", "Perc3":"Perc3", "Perc4":"Perc4", "Perc5":"Perc5", "Perc6":"Perc6", "Perc7":"Perc7"}},
      {id: "cr8000", name: "Roland CR-8000",
       slots: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29"],
       files: {"01":"01", "02":"02", "03":"03", "04":"04", "05":"05", "06":"06", "07":"07", "08":"08", "09":"09", "10":"10", "11":"11", "12":"12", "13":"13", "14":"14", "15":"15", "16":"16", "17":"17", "18":"18", "19":"19", "20":"20", "21":"21", "22":"22", "23":"23", "24":"24", "25":"25", "26":"26", "27":"27", "28":"28", "29":"29"}},
      {id: "autovari", name: "Hammond Auto-Vari 64",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "CLAV1", "CLAV2", "CYM1", "CYM2", "HHO1", "HHO2", "HHO4", "SHA1", "SHA2", "SHA3", "SHA4"],
       files: {"kick":"BassDrum 1", "kick2":"BassDrum 2", "kick3":"BassDrum 3", "kick4":"BassDrum 4", "snare":"SD1.1", "snare2":"SD1.3", "snare3":"SD1.4", "snare4":"SD2.1", "hh_closed":"HH 1", "hh_closed2":"HH 2", "hh_closed3":"HH 3", "hh_closed4":"HH 4", "tom_hi":"TOM A1", "tom_hi2":"TOM A2", "tom_hi3":"TOM B1", "tom_hi4":"TOM B2", "CLAV1":"CLAV1", "CLAV2":"CLAV2", "CYM1":"CYM1", "CYM2":"CYM2", "HHO1":"HHO1", "HHO2":"HHO2", "HHO4":"HHO4", "SHA1":"SHA1", "SHA2":"SHA2", "SHA3":"SHA3", "SHA4":"SHA4"}},
      {id: "minipops", name: "Korg Minipops",
       slots: ["kick", "kick2", "kick3", "snare", "snare2", "snare3", "tom_hi", "tom_low", "Hihat1", "Hihat2", "Sdfx", "Wood1", "Wood2"],
       files: {"kick":"BassDrum1", "kick2":"BassDrum2", "kick3":"BassDrum3", "snare":"Sd1", "snare2":"Sd2", "snare3":"Sd3", "tom_hi":"Tom1", "tom_low":"Tom2", "Hihat1":"Hihat1", "Hihat2":"Hihat2", "Sdfx":"Sdfx", "Wood1":"Wood1", "Wood2":"Wood2"}},
      {id: "rz1", name: "Casio RZ-1",
       slots: ["kick", "snare", "clap", "rim", "hh_closed", "hh_open", "tom_hi", "tom_hi2", "tom_hi3", "cowbell", "ride", "ride2"],
       files: {"kick":"Bassdrum", "snare":"Snaredrum", "clap":"Clap", "rim":"Rim Shot", "hh_closed":"Hat Closed", "hh_open":"Hat Open", "tom_hi":"Tom H", "tom_hi2":"Tom L", "tom_hi3":"Tom M", "cowbell":"Cowbell", "ride":"Crash", "ride2":"Ride"}},
      {id: "fairlight", name: "Fairlight CMI IIx",
       slots: ["kick", "kick2", "kick3", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "rim", "hh_closed", "hh_open", "tom_hi", "tom_hi2", "tom_low", "tom_low2", "tom_low3", "cowbell", "cowbell2", "cowbell3", "ride", "ride2", "ride3", "Bbdrum1", "Bbdrum2", "Bigtom", "Cabasa", "Claves", "Collinsr", "Conga", "Crosstix", "Cym1", "Cym2", "Cym3", "Cymshort", "Deeptom", "Drumbo", "Finger", "Fish", "Fishs", "Gorgon", "Hhpedal", "Hhtamb", "Hicrash", "K1", "K2", "K3", "K4", "K5", "Milbdrum", "Opclhat", "Pang", "Percstk", "Ssnre", "Ssnre1", "Stick", "Symsnre1", "Symsnre2", "Symtom", "Tabla", "Timb", "Timbale", "Ttom", "Tymp"],
       files: {"kick":"Bd1", "kick2":"Bdrum", "kick3":"Symkick", "snare":"Bobsnare", "snare2":"Sn2", "snare3":"Sn3", "snare4":"Sn4", "clap":"Clap", "clap2":"Claps", "clap3":"Claptrap", "rim":"Rim", "hh_closed":"Hhclosed", "hh_open":"Hhopen", "tom_hi":"Symtomhi", "tom_hi2":"Tom1", "tom_low":"Floortom", "tom_low2":"Symtomlo", "tom_low3":"Tom2", "cowbell":"Cowbell1", "cowbell2":"Cowbell2", "cowbell3":"Tambour", "ride":"Crashcym", "ride2":"Cymride", "ride3":"Ridecym", "Bbdrum1":"Bbdrum1", "Bbdrum2":"Bbdrum2", "Bigtom":"Bigtom", "Cabasa":"Cabasa", "Claves":"Claves", "Collinsr":"Collinsr", "Conga":"Conga", "Crosstix":"Crosstix", "Cym1":"Cym1", "Cym2":"Cym2", "Cym3":"Cym3", "Cymshort":"Cymshort", "Deeptom":"Deeptom", "Drumbo":"Drumbo", "Finger":"Finger", "Fish":"Fish", "Fishs":"Fishs", "Gorgon":"Gorgon", "Hhpedal":"Hhpedal", "Hhtamb":"Hhtamb", "Hicrash":"Hicrash", "K1":"K1", "K2":"K2", "K3":"K3", "K4":"K4", "K5":"K5", "Milbdrum":"Milbdrum", "Opclhat":"Opclhat", "Pang":"Pang", "Percstk":"Percstk", "Ssnre":"Ssnre", "Ssnre1":"Ssnre1", "Stick":"Stick", "Symsnre1":"Symsnre1", "Symsnre2":"Symsnre2", "Symtom":"Symtom", "Tabla":"Tabla", "Timb":"Timb", "Timbale":"Timbale", "Ttom":"Ttom", "Tymp":"Tymp"}},
      {id: "lsdj", name: "Nintendo Gameboy LSDJ",
       slots: ["kick", "kick2", "kick3", "kick4", "1", "10", "11", "12", "13", "14", "15", "2", "3", "4", "5", "6", "7", "8", "9", "1", "10", "11", "12", "13", "14", "15", "16", "2", "3", "4_to_the_dirty_Floor_138BpM-01", "4_to_the_dirty_Floor_138BpM-02", "4_to_the_dirty_Floor_138BpM-03", "4", "5", "6", "7", "8", "9", "Acid_1", "Acid_10", "Acid_11", "Acid_12", "Acid_13", "Acid_14", "Acid_2", "Acid_3", "Acid_4", "Acid_5", "Acid_6", "Acid_7", "Acid_8", "Acid_9", "Animals_1", "Animals_2", "Animals_3", "Animals_4", "Animals_5", "Animals_6", "Rock_Rhythm_117BpM-01", "Rock_Rhythm_117BpM-02", "Wonkin_Ass_129BpM-01", "Wonkin_Ass_129BpM-02", "Wonkin_Ass_129BpM-03", "Wonkin_Ass_129BpM-04", "Wonkin_Ass_129BpM-05", "Wonkin_Ass_129BpM-06", "Wonkin_Ass_129BpM-07", "Wonkin_Ass_129BpM-08", "Wonkin_Bits_Synth_129BpM-01", "Wonkin_Bits_Synth_129BpM-02", "Wonkin_Grummel_129BpM-01", "Wonkin_Grummel_129BpM-02", "Wonkin_Loop_136BpM-01", "Wonkin_Loop_136BpM-02", "Wonkin_Loop_136BpM-03", "Wonkin_Loop_136BpM-04", "Wonkin_Loop_136BpM-05", "Wonkin_Loop_136BpM-06", "Wonkin_Loop_136BpM-07", "Wonkin_Loop_136BpM-08", "Wonkin_Loop_136BpM-09"],
       files: {"kick":"Kick Square A - 1", "kick2":"Kick Square A - 2", "kick3":"Kick Square A - 3", "kick4":"Kick Square A - 4", "1":"1", "10":"10", "11":"11", "12":"12", "13":"13", "14":"14", "15":"15", "2":"2", "3":"3", "4":"4", "5":"5", "6":"6", "7":"7", "8":"8", "9":"9", "16":"16", "4_to_the_dirty_Floor_138BpM-01":"4 to the dirty Floor_138BpM-01", "4_to_the_dirty_Floor_138BpM-02":"4 to the dirty Floor_138BpM-02", "4_to_the_dirty_Floor_138BpM-03":"4 to the dirty Floor_138BpM-03", "Acid_1":"Acid 1", "Acid_10":"Acid 10", "Acid_11":"Acid 11", "Acid_12":"Acid 12", "Acid_13":"Acid 13", "Acid_14":"Acid 14", "Acid_2":"Acid 2", "Acid_3":"Acid 3", "Acid_4":"Acid 4", "Acid_5":"Acid 5", "Acid_6":"Acid 6", "Acid_7":"Acid 7", "Acid_8":"Acid 8", "Acid_9":"Acid 9", "Animals_1":"Animals 1", "Animals_2":"Animals 2", "Animals_3":"Animals 3", "Animals_4":"Animals 4", "Animals_5":"Animals 5", "Animals_6":"Animals 6", "Rock_Rhythm_117BpM-01":"Rock Rhythm_117BpM-01", "Rock_Rhythm_117BpM-02":"Rock Rhythm_117BpM-02", "Wonkin_Ass_129BpM-01":"Wonkin' Ass_129BpM-01", "Wonkin_Ass_129BpM-02":"Wonkin' Ass_129BpM-02", "Wonkin_Ass_129BpM-03":"Wonkin' Ass_129BpM-03", "Wonkin_Ass_129BpM-04":"Wonkin' Ass_129BpM-04", "Wonkin_Ass_129BpM-05":"Wonkin' Ass_129BpM-05", "Wonkin_Ass_129BpM-06":"Wonkin' Ass_129BpM-06", "Wonkin_Ass_129BpM-07":"Wonkin' Ass_129BpM-07", "Wonkin_Ass_129BpM-08":"Wonkin' Ass_129BpM-08", "Wonkin_Bits_Synth_129BpM-01":"Wonkin' Bits Synth_129BpM-01", "Wonkin_Bits_Synth_129BpM-02":"Wonkin' Bits Synth_129BpM-02", "Wonkin_Grummel_129BpM-01":"Wonkin' Grummel_129BpM-01", "Wonkin_Grummel_129BpM-02":"Wonkin' Grummel_129BpM-02", "Wonkin_Loop_136BpM-01":"Wonkin' Loop_136BpM-01", "Wonkin_Loop_136BpM-02":"Wonkin' Loop_136BpM-02", "Wonkin_Loop_136BpM-03":"Wonkin' Loop_136BpM-03", "Wonkin_Loop_136BpM-04":"Wonkin' Loop_136BpM-04", "Wonkin_Loop_136BpM-05":"Wonkin' Loop_136BpM-05", "Wonkin_Loop_136BpM-06":"Wonkin' Loop_136BpM-06", "Wonkin_Loop_136BpM-07":"Wonkin' Loop_136BpM-07", "Wonkin_Loop_136BpM-08":"Wonkin' Loop_136BpM-08", "Wonkin_Loop_136BpM-09":"Wonkin' Loop_136BpM-09"}},
      {id: "synare3", name: "Star Synare-3",
       slots: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "100", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112", "113", "115", "116", "117", "118", "119", "12", "120", "121", "122", "123", "124", "125", "126", "127", "128", "129", "130", "131", "132", "133", "134", "135", "137", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "56", "57", "58", "59", "60", "63", "64", "65", "66", "68", "69", "70", "71", "72", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"],
       files: {"01":"01", "02":"02", "03":"03", "04":"04", "05":"05", "06":"06", "07":"07", "08":"08", "09":"09", "10":"10", "100":"100", "102":"102", "103":"103", "104":"104", "105":"105", "106":"106", "107":"107", "108":"108", "109":"109", "110":"110", "111":"111", "112":"112", "113":"113", "115":"115", "116":"116", "117":"117", "118":"118", "119":"119", "12":"12", "120":"120", "121":"121", "122":"122", "123":"123", "124":"124", "125":"125", "126":"126", "127":"127", "128":"128", "129":"129", "130":"130", "131":"131", "132":"132", "133":"133", "134":"134", "135":"135", "137":"137", "15":"15", "16":"16", "17":"17", "18":"18", "19":"19", "20":"20", "21":"21", "22":"22", "23":"23", "24":"24", "25":"25", "26":"26", "27":"27", "28":"28", "29":"29", "30":"30", "31":"31", "32":"32", "33":"33", "34":"34", "40":"40", "41":"41", "42":"42", "43":"43", "44":"44", "45":"45", "46":"46", "47":"47", "48":"48", "49":"49", "50":"50", "51":"51", "53":"53", "54":"54", "56":"56", "57":"57", "58":"58", "59":"59", "60":"60", "63":"63", "64":"64", "65":"65", "66":"66", "68":"68", "69":"69", "70":"70", "71":"71", "72":"72", "74":"74", "75":"75", "76":"76", "77":"77", "78":"78", "79":"79", "80":"80", "81":"81", "82":"82", "83":"83", "84":"84", "85":"85", "86":"86", "87":"87", "88":"88", "89":"89", "90":"90", "91":"91", "92":"92", "93":"93", "94":"94", "95":"95", "96":"96", "97":"97", "98":"98", "99":"99"}},
      {id: "syndrum", name: "Pollard Syndrum",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "tom_low", "tom_low2", "tom_low3", "tom_low4", "FX_1", "FX_10", "FX_11", "FX_12", "FX_13", "FX_14", "FX_15", "FX_16", "FX_17", "FX_18", "FX_19", "FX_2", "FX_20", "FX_21", "FX_22", "FX_23", "FX_24", "FX_25", "FX_26", "FX_27", "FX_28", "FX_29", "FX_3", "FX_30", "FX_31", "FX_32", "FX_33", "FX_34", "FX_35", "FX_36", "FX_37", "FX_38", "FX_39", "FX_4", "FX_40", "FX_41", "FX_42", "FX_43", "FX_44", "FX_45", "FX_5", "FX_6", "FX_7", "FX_8", "FX_9", "Perc_1", "Perc_10", "Perc_11", "Perc_12", "Perc_13", "Perc_14", "Perc_15", "Perc_16", "Perc_17", "Perc_18", "Perc_19", "Perc_2", "Perc_20", "Perc_21", "Perc_22", "Perc_23", "Perc_24", "Perc_25", "Perc_26", "Perc_27", "Perc_28", "Perc_29", "Perc_3", "Perc_30", "Perc_31", "Perc_32", "Perc_33", "Perc_34", "Perc_35", "Perc_36", "Perc_37", "Perc_38", "Perc_4", "Perc_5", "Perc_6", "Perc_7", "Perc_8", "Perc_9", "Sub_1", "Sub_10", "Sub_11", "Sub_12", "Sub_13", "Sub_14", "Sub_15", "Sub_2", "Sub_3", "Sub_4", "Sub_5", "Sub_6", "Sub_7", "Sub_8", "Sub_9"],
       files: {"kick":" Kick 1", "kick2":" Kick 2", "kick3":" Kick 3", "kick4":" Kick 4", "snare":" Snare 1", "snare2":" Snare 2", "snare3":" Snare 3", "snare4":" Snare 4", "tom_hi":" Tom 1a Hi", "tom_hi2":" Tom 1b Hi Mid", "tom_hi3":" Tom 2a Hi", "tom_hi4":" Tom 2b Hi Mid", "tom_low":" Tom 1c Lo Mid", "tom_low2":" Tom 1d Lo", "tom_low3":" Tom 2c Lo Mid", "tom_low4":" Tom 2d Lo", "FX_1":" FX 1", "FX_10":" FX 10", "FX_11":" FX 11", "FX_12":" FX 12", "FX_13":" FX 13", "FX_14":" FX 14", "FX_15":" FX 15", "FX_16":" FX 16", "FX_17":" FX 17", "FX_18":" FX 18", "FX_19":" FX 19", "FX_2":" FX 2", "FX_20":" FX 20", "FX_21":" FX 21", "FX_22":" FX 22", "FX_23":" FX 23", "FX_24":" FX 24", "FX_25":" FX 25", "FX_26":" FX 26", "FX_27":" FX 27", "FX_28":" FX 28", "FX_29":" FX 29", "FX_3":" FX 3", "FX_30":" FX 30", "FX_31":" FX 31", "FX_32":" FX 32", "FX_33":" FX 33", "FX_34":" FX 34", "FX_35":" FX 35", "FX_36":" FX 36", "FX_37":" FX 37", "FX_38":" FX 38", "FX_39":" FX 39", "FX_4":" FX 4", "FX_40":" FX 40", "FX_41":" FX 41", "FX_42":" FX 42", "FX_43":" FX 43", "FX_44":" FX 44", "FX_45":" FX 45", "FX_5":" FX 5", "FX_6":" FX 6", "FX_7":" FX 7", "FX_8":" FX 8", "FX_9":" FX 9", "Perc_1":" Perc 1", "Perc_10":" Perc 10", "Perc_11":" Perc 11", "Perc_12":" Perc 12", "Perc_13":" Perc 13", "Perc_14":" Perc 14", "Perc_15":" Perc 15", "Perc_16":" Perc 16", "Perc_17":" Perc 17", "Perc_18":" Perc 18", "Perc_19":" Perc 19", "Perc_2":" Perc 2", "Perc_20":" Perc 20", "Perc_21":" Perc 21", "Perc_22":" Perc 22", "Perc_23":" Perc 23", "Perc_24":" Perc 24", "Perc_25":" Perc 25", "Perc_26":" Perc 26", "Perc_27":" Perc 27", "Perc_28":" Perc 28", "Perc_29":" Perc 29", "Perc_3":" Perc 3", "Perc_30":" Perc 30", "Perc_31":" Perc 31", "Perc_32":" Perc 32", "Perc_33":" Perc 33", "Perc_34":" Perc 34", "Perc_35":" Perc 35", "Perc_36":" Perc 36", "Perc_37":" Perc 37", "Perc_38":" Perc 38", "Perc_4":" Perc 4", "Perc_5":" Perc 5", "Perc_6":" Perc 6", "Perc_7":" Perc 7", "Perc_8":" Perc 8", "Perc_9":" Perc 9", "Sub_1":" Sub 1", "Sub_10":" Sub 10", "Sub_11":" Sub 11", "Sub_12":" Sub 12", "Sub_13":" Sub 13", "Sub_14":" Sub 14", "Sub_15":" Sub 15", "Sub_2":" Sub 2", "Sub_3":" Sub 3", "Sub_4":" Sub 4", "Sub_5":" Sub 5", "Sub_6":" Sub 6", "Sub_7":" Sub 7", "Sub_8":" Sub 8", "Sub_9":" Sub 9"}},
      {id: "drumbuddy", name: "Quintronics Drum Buddy",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "Bass1", "Bass10", "Bass11", "Bass12", "Bass13", "Bass2", "Bass3", "Bass4", "Bass5", "Bass6", "Bass7", "Bass8", "Bass9", "Low1", "Low2", "Low3", "Low4", "Low5", "Low6", "Misc1", "Misc2", "Scratch1", "Scratch2", "Scratch3", "Scratch4", "Scratch5", "Scratch6", "Scratch7", "Scratch8", "Space1", "Space10", "Space2", "Space3", "Space4", "Space5", "Space6", "Space7", "Space8", "Space9"],
       files: {"kick":"Kick1", "kick2":"Kick10", "kick3":"Kick11", "kick4":"Kick12", "snare":"Snare1", "snare2":"Snare2", "snare3":"Snare3", "snare4":"Snare4", "Bass1":"Bass1", "Bass10":"Bass10", "Bass11":"Bass11", "Bass12":"Bass12", "Bass13":"Bass13", "Bass2":"Bass2", "Bass3":"Bass3", "Bass4":"Bass4", "Bass5":"Bass5", "Bass6":"Bass6", "Bass7":"Bass7", "Bass8":"Bass8", "Bass9":"Bass9", "Low1":"Low1", "Low2":"Low2", "Low3":"Low3", "Low4":"Low4", "Low5":"Low5", "Low6":"Low6", "Misc1":"Misc1", "Misc2":"Misc2", "Scratch1":"Scratch1", "Scratch2":"Scratch2", "Scratch3":"Scratch3", "Scratch4":"Scratch4", "Scratch5":"Scratch5", "Scratch6":"Scratch6", "Scratch7":"Scratch7", "Scratch8":"Scratch8", "Space1":"Space1", "Space10":"Space10", "Space2":"Space2", "Space3":"Space3", "Space4":"Space4", "Space5":"Space5", "Space6":"Space6", "Space7":"Space7", "Space8":"Space8", "Space9":"Space9"}},
      {id: "po12", name: "TE PO-12",
       slots: ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014", "015", "016"],
       files: {"001":"001", "002":"002", "003":"003", "004":"004", "005":"005", "006":"006", "007":"007", "008":"008", "009":"009", "010":"010", "011":"011", "012":"012", "013":"013", "014":"014", "015":"015", "016":"016"}},
      {id: "ms10", name: "Korg MS-10",
       slots: ["kick", "snare", "snare2", "clap", "tom_hi", "tom_hi2", "tom_hi3", "ride", "HHC", "HHO"],
       files: {"kick":"Kick", "snare":"Snare1", "snare2":"Snare2", "clap":"Clap", "tom_hi":"Tom 1", "tom_hi2":"Tom 2", "tom_hi3":"Tom 3", "ride":"Crash", "HHC":"HHC", "HHO":"HHO"}},
      {id: "triton", name: "Korg Triton",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "rim", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "hh_open", "hh_open2", "hh_open3", "hh_open4", "tom_hi", "tom_hi2", "tom_hi3", "tom_hi4", "tom_low", "tom_low2", "tom_low3", "tom_low4", "20070829175616_c13f0000", "20070829175625_c17f0000", "20070829175644_c13f0000", "20070829175651_c17f0000", "20070829175657_c13f0000", "20070829175704_c17f0000", "20070829175710_d13f0000", "20070829175717_d17f0000", "20070829175724_d13f0000", "20070829175730_d17f0000", "20070829175737_e13f0000", "20070829175744_e17f0000", "20070829175751_f13f0000", "20070829175757_f17f0000", "20070829175804_f13f0000", "20070829175811_f17f0000", "20070829175817_g13f0000", "20070829175824_g17f0000", "20070829175830_g13f0000", "20070829175837_g17f0000", "20070829175844_a13f0000", "20070829175850_a17f0000", "20070829175857_a13f0000", "20070829175904_a17f0000", "20070829175910_b13f0000", "20070829175917_b17f0000", "20070829175924_c23f0000", "20070829175931_c27f0000", "20070829175937_c23f0000", "20070829175944_c27f0000", "20070829175951_d23f0000", "20070829175957_d27f0000", "20070829180004_d23f0000", "20070829180011_d27f0000", "20070829180017_e23f0000", "20070829180024_e27f0000", "20070829180031_f23f0000", "20070829180040_f27f0000", "20070829180046_f23f0000", "20070829180053_f27f0000", "20070829180100_g23f0000", "20070829180108_g27f0000", "20070829180115_g23f0000", "20070829180124_g27f0000", "20070829180131_a23f0000", "20070829180137_a27f0000", "20070829180144_a23f0000", "20070829180153_a27f0000", "20070829180200_b23f0000", "20070829180206_b27f0000", "20070829180213_c33f0000", "20070829180220_c37f0000", "20070829180228_c33f0000", "20070829180237_c37f0000", "20070829180244_d33f0000", "20070829180251_d37f0000", "20070829180300_d33f0000", "20070829180311_d37f0000", "20070829180317_e33f0000", "20070829180326_e37f0000", "20070829180342_f37f0000", "20070829180348_f33f0000", "20070829180355_f37f0000", "20070829180402_g33f0000", "20070829180408_g37f0000", "20070829180415_g33f0000", "20070829180422_g37f0000", "20070829180431_a33f0000", "20070829180439_a37f0000", "20070829180446_a33f0000", "20070829180453_a37f0000", "20070829180459_b33f0000", "20070829180508_b37f0000", "20070829180515_c43f0000", "20070829180522_c47f0000", "20070829180528_c43f0000", "20070829180535_c47f0000", "20070829180542_d43f0000", "20070829180548_d47f0000", "20070829180555_d43f0000", "20070829180602_d47f0000", "20070829180609_e43f0000", "20070829180615_e47f0000", "20070829180622_f43f0000", "20070829180629_f47f0000", "20070829180636_f43f0000", "20070829180642_f47f0000", "20070829180649_g43f0000", "20070829180656_g47f0000", "20070829180702_g43f0000", "20070829180709_g47f0000", "20070829180716_a43f0000", "20070829180722_a47f0000", "20070829180729_a43f0000", "20070829180736_a47f0000", "20070829180749_b47f0000", "20070829180802_c57f0000", "20070829180815_c57f0000", "20070829180829_d57f0000", "20070829180835_d53f0000", "20070829180842_d57f0000", "20070829180849_e53f0000", "20070829180855_e57f0000", "20070829180908_f57f0000", "20070829180915_f53f0000", "20070829180922_f57f0000", "20070829180928_g53f0000", "20070829180935_g57f0000", "20070829180942_g53f0000", "20070829180948_g57f0000", "20070829180955_a53f0000", "20070829181002_a57f0000", "20070829181008_a53f0000", "20070829181015_a57f0000", "20070829181026_b53f0000", "20070829181037_b57f0000", "20070829181044_c63f0000", "20070829181053_c67f0000", "20080612235947_e-27f0000", "20080612235959_f-27f0000", "20080613000117_c07f0000", "20080613000128_c07f0000", "20080613000139_d07f0000", "20080613000150_d07f0000", "20080613000201_e07f0000", "20080613000212_f07f0000", "20080613000223_f07f0000", "20080613000234_g07f0000", "20080613000245_g07f0000", "20080613000256_a07f0000", "20080613000307_a07f0000", "20080613000318_b07f0000", "20080613000329_c17f0000", "20080613000340_c17f0000", "20080613000351_d17f0000", "20080613000402_d17f0000", "20080613000415_e17f0000", "20080613000425_f17f0000", "20080613000436_f17f0000", "20080613000447_g17f0000", "20080613000458_g17f0000", "20080613000509_a17f0000", "20080613000520_a17f0000", "20080613000531_b17f0000", "20080613000542_c27f0000", "20080613000552_c27f0000", "20080613000603_d27f0000", "20080613000614_d27f0000", "20080613000625_e27f0000", "20080613000636_f27f0000", "20080613000647_f27f0000", "20080613000658_g27f0000", "20080613000709_g27f0000", "20080613000719_a27f0000", "20080613000730_a27f0000", "20080613000741_b27f0000", "20080613000752_c37f0000", "20080613000803_c37f0000", "20080613000814_d37f0000", "20080613000825_d37f0000", "20080613000838_e37f0000", "20080613000849_f37f0000", "20080613000900_f37f0000", "20080613000913_g37f0000", "20080613000923_g37f0000", "20080613000934_a37f0000", "20080613000945_a37f0000", "20080613000956_b37f0000", "20080613001007_c47f0000", "20080613001020_c47f0000", "20080613001031_d47f0000", "20080613001042_d47f0000", "20080613001053_e47f0000", "20080613001104_f47f0000", "20080613001115_f47f0000", "20080613001125_g47f0000", "20080613001136_g47f0000", "20080613001147_a47f0000", "20080613001158_a47f0000", "20080613001209_b47f0000", "20080613001220_c57f0000", "20080613001231_c57f0000", "20080613001241_d57f0000", "20080613001252_d57f0000", "20080613001303_e57f0000", "20080613001314_f57f0000", "20080613001325_f57f0000", "20080613001336_g57f0000", "20080613001347_g57f0000", "20080613001358_a57f0000", "20080613001408_a57f0000", "20080613001419_b57f0000", "20080613001430_c67f0000", "20080613001441_c67f0000", "20080613001452_d67f0000", "20080613001503_d67f0000", "20080613001514_e67f0000", "20080613001525_f67f0000", "20080613001535_f67f0000", "20080613001546_g67f0000", "20080613001559_g67f0000", "20080613001610_a67f0000", "20080613001623_a67f0000", "20080613001637_b67f0000", "20080613001653_c77f0000", "20080613002353_c07f0000", "20080613002508_c07f0000", "20080613002519_c07f0000", "20080613002541_d07f0000", "20080613002554_d07f0000", "20080613002605_e07f0000", "20080613002616_f07f0000", "20080613002627_f07f0000", "20080613002637_g07f0000", "20080613002648_g07f0000", "20080613002712_a07f0000", "20080613002723_a07f0000", "20080613002734_b07f0000", "20080613002745_c17f0000", "20080613002805_c17f0000", "20080613002822_d17f0000", "20080613002833_d17f0000", "20080613002844_e17f0000", "20080613002855_f17f0000", "20080613002906_f17f0000", "20080613002917_g17f0000", "20080613002930_g17f0000", "20080613002941_a17f0000", "20080613002956_a17f0000", "20080613003007_b17f0000", "20080613003020_c27f0000", "20080613003031_c27f0000", "20080613003042_d27f0000", "20080613003057_d27f0000", "20080613003108_e27f0000", "20080613003119_f27f0000", "20080613003130_f27f0000", "20080613003143_g27f0000", "20080613003154_g27f0000", "20080613003207_a27f0000", "20080613003218_a27f0000", "20080613003229_b27f0000", "20080613003239_c37f0000", "20080613003250_c37f0000", "20080613003301_d37f0000", "20080613003319_d37f0000", "20080613003332_e37f0000", "20080613003409_f37f0000", "20080613003429_f37f0000", "20080613003440_g37f0000", "20080613003451_g37f0000", "20080613003508_a37f0000", "20080613003521_a37f0000", "20080613003532_b37f0000", "20080613003543_c47f0000", "20080613003554_c47f0000", "20080613003605_d47f0000", "20080613003616_d47f0000", "20080613003626_e47f0000", "20080613003637_f47f0000", "20080613003653_f47f0000", "20080613003706_g47f0000", "20080613003717_g47f0000", "20080613003728_a47f0000", "20080613003738_a47f0000", "20080613003749_b47f0000", "20080613003802_c57f0000", "20080613003827_c57f0000", "20080613003844_d57f0000", "20080613003855_d57f0000", "20080613003906_e57f0000", "20080613003919_f57f0000", "20080613003930_f57f0000", "20080613003941_g57f0000", "20080613003952_g57f0000", "20080613004003_a57f0000", "20080613004018_a57f0000", "20080613004029_b57f0000", "20080613004040_c67f0000", "20080613004051_c67f0000", "20080613004110_d67f0000", "20080613004121_d67f0000", "20080613004134_e67f0000", "20080613004145_f67f0000", "20080613004156_f67f0000", "20080613004207_g67f0000", "20080613004218_g67f0000", "20080613004235_a67f0000", "20080613004246_a67f0000", "20080613004259_b67f0000", "20080613004315_c77f0000", "20080613004538_c07f0000", "20080613004549_c07f0000", "20080613004600_d07f0000", "20080613004611_d07f0000", "20080613004624_e07f0000", "20080613004640_f07f0000", "20080613004650_f07f0000", "20080613004701_g07f0000", "20080613004712_g07f0000", "20080613004725_a07f0000", "20080613004745_a07f0000", "20080613004756_b07f0000", "20080613004807_c17f0000", "20080613004818_c17f0000", "20080613004831_d17f0000", "20080613004844_d17f0000", "20080613004857_e17f0000", "20080613004908_f17f0000", "20080613004921_f17f0000", "20080613004936_g17f0000", "20080613004949_g17f0000", "20080613005002_a17f0000", "20080613005013_a17f0000", "20080613005024_b17f0000", "20080613005035_c27f0000", "20080613005046_c27f0000", "20080613005059_d27f0000", "20080613005110_d27f0000", "20080613005121_e27f0000", "20080613005131_f27f0000", "20080613005142_f27f0000", "20080613005153_g27f0000", "20080613005204_g27f0000", "20080613005215_a27f0000", "20080613005228_a27f0000", "20080613005239_b27f0000", "20080613005250_c37f0000", "20080613005303_c37f0000", "20080613005318_d37f0000", "20080613005334_d37f0000", "20080613005347_e37f0000", "20080613005411_f37f0000", "20080613005424_f37f0000", "20080613005437_g37f0000", "20080613005450_g37f0000", "20080613005508_a37f0000", "20080613005523_a37f0000", "20080613005541_b37f0000", "20080613005552_c47f0000", "20080613005603_c47f0000", "20080613005613_d47f0000", "20080613005624_d47f0000", "20080613005635_e47f0000", "20080613005648_f47f0000", "20080613005659_f47f0000", "20080613005714_g47f0000", "20080613005730_g47f0000", "20080613005741_a47f0000", "20080613005751_a47f0000", "20080613005802_b47f0000", "20080613005813_c57f0000", "20080613005824_c57f0000", "20080613005835_d57f0000", "20080613005846_d57f0000", "20080613005857_e57f0000", "20080613005908_f57f0000", "20080613005918_f57f0000", "20080613005929_g57f0000", "20080613005940_g57f0000", "20080613005951_a57f0000", "20080613010002_a57f0000", "20080613010013_b57f0000", "20080613010024_c67f0000", "20080613010035_c67f0000", "20080613010045_d67f0000", "20080613010059_d67f0000", "20080613010113_e67f0000", "20080613010124_f67f0000", "20080613010137_f67f0000", "20080613010148_g67f0000", "20080613010158_g67f0000", "20080613010209_a67f0000", "20080613010222_a67f0000", "20080613010235_b67f0000", "20080613010246_c77f0000", "20080613011335_c07f0000", "20080613011346_c07f0000", "20080613011357_d07f0000", "20080613011408_d07f0000", "20080613011419_e07f0000", "20080613011436_f07f0000", "20080613011447_f07f0000", "20080613011458_g07f0000", "20080613011509_g07f0000", "20080613011520_a07f0000", "20080613011531_a07f0000", "20080613011541_b07f0000", "20080613011552_c17f0000", "20080613011603_c17f0000", "20080613011614_d17f0000", "20080613011625_d17f0000", "20080613011636_e17f0000", "20080613011647_f17f0000", "20080613011657_f17f0000", "20080613011708_g17f0000", "20080613011719_g17f0000", "20080613011730_a17f0000", "20080613011741_a17f0000", "20080613011752_b17f0000", "20080613011803_c27f0000", "20080613011813_c27f0000", "20080613011824_d27f0000", "20080613011835_d27f0000", "20080613011846_e27f0000", "20080613011857_f27f0000", "20080613011908_f27f0000", "20080613011919_g27f0000", "20080613011929_g27f0000", "20080613011940_a27f0000", "20080613011956_a27f0000", "20080613012007_b27f0000", "20080613012017_c37f0000", "20080613012028_c37f0000", "20080613012039_d37f0000", "20080613012050_d37f0000", "20080613012101_e37f0000", "20080613012112_f37f0000", "20080613012123_f37f0000", "20080613012133_g37f0000", "20080613012144_g37f0000", "20080613012155_a37f0000", "20080613012206_a37f0000", "20080613012217_b37f0000", "20080613012228_c47f0000", "20080613012239_c47f0000", "20080613012249_d47f0000", "20080613012300_d47f0000", "20080613012311_e47f0000", "20080613012322_f47f0000", "20080613012333_f47f0000", "20080613012344_g47f0000", "20080613012355_g47f0000", "20080613012405_a47f0000", "20080613012416_a47f0000", "20080613012427_b47f0000", "20080613012438_c57f0000", "20080613012449_c57f0000", "20080613012500_d57f0000", "20080613012513_d57f0000", "20080613012524_e57f0000", "20080613012535_f57f0000", "20080613012545_f57f0000", "20080613012556_g57f0000", "20080613012607_g57f0000", "20080613012618_a57f0000", "20080613012631_a57f0000", "20080613012642_b57f0000", "20080613012653_c67f0000", "20080613013504_c07f0000", "20080613013515_c07f0000", "20080613013526_d07f0000", "20080613013537_d07f0000", "20080613013547_e07f0000", "20080613013558_f07f0000", "20080613013609_f07f0000", "20080613013620_g07f0000", "20080613013631_g07f0000", "20080613013642_a07f0000", "20080613013655_a07f0000", "20080613013712_b07f0000", "20080613013723_c17f0000", "20080613013734_c17f0000", "20080613013745_d17f0000", "20080613013756_d17f0000", "20080613013807_e17f0000", "20080613013817_f17f0000", "20080613013828_f17f0000", "20080613013839_g17f0000", "20080613013850_g17f0000", "20080613013901_a17f0000", "20080613013912_a17f0000", "20080613013923_b17f0000", "20080613013934_c27f0000", "20080613013947_c27f0000", "20080613014004_d27f0000", "20080613014017_d27f0000", "20080613014028_e27f0000", "20080613014039_f27f0000", "20080613014050_f27f0000", "20080613014101_g27f0000", "20080613014113_g27f0000", "20080613014124_a27f0000", "20080613014139_a27f0000", "20080613014150_b27f0000", "20080613014201_c37f0000", "20080613014212_c37f0000", "20080613014223_d37f0000", "20080613014234_d37f0000", "20080613014245_e37f0000", "20080613014256_f37f0000", "20080613014307_f37f0000", "20080613014318_g37f0000", "20080613014330_g37f0000", "20080613014341_a37f0000", "20080613014352_a37f0000", "20080613014402_b37f0000", "20080613014413_c47f0000", "20080613014424_c47f0000", "20080613014435_d47f0000", "20080613014446_d47f0000", "20080613014457_e47f0000", "20080613014508_f47f0000", "20080613014519_f47f0000", "20080613014535_g47f0000", "20080613014546_g47f0000", "20080613014557_a47f0000", "20080613014608_a47f0000", "20080613014628_b47f0000", "20080613014641_c57f0000", "20080613014652_c57f0000", "20080613014703_d57f0000", "20080613014723_d57f0000", "20080613014734_e57f0000", "20080613014745_f57f0000", "20080613014756_f57f0000", "20080613014807_g57f0000", "20080613014820_g57f0000", "20080613014831_a57f0000", "20080613014846_a57f0000", "20080613014857_b57f0000", "20080613014913_c67f0000", "20080613014947_d67f0000", "20080613015327_c07f0000", "20080613015338_c07f0000", "20080613015349_d07f0000", "20080613015400_d07f0000", "20080613015411_e07f0000", "20080613015422_f07f0000", "20080613015433_f07f0000", "20080613015446_g07f0000", "20080613015457_g07f0000", "20080613015508_a07f0000", "20080613015519_a07f0000", "20080613015530_b07f0000", "20080613015541_c17f0000", "20080613015552_c17f0000", "20080613015603_d17f0000", "20080613015613_d17f0000", "20080613015624_e17f0000", "20080613015635_f17f0000", "20080613015646_f17f0000", "20080613015657_g17f0000", "20080613015708_g17f0000", "20080613015719_a17f0000", "20080613015730_a17f0000", "20080613015741_b17f0000", "20080613015751_c27f0000", "20080613015802_c27f0000", "20080613015813_d27f0000", "20080613015824_d27f0000", "20080613015844_e27f0000", "20080613015855_f27f0000", "20080613015910_f27f0000", "20080613015921_g27f0000", "20080613015932_g27f0000", "20080613015943_a27f0000", "20080613015954_a27f0000", "20080613020005_b27f0000", "20080613020015_c37f0000", "20080613020029_c37f0000", "20080613020040_d37f0000", "20080613020053_d37f0000", "20080613020106_e37f0000", "20080613020119_f37f0000", "20080613020130_f37f0000", "20080613020143_g37f0000", "20080613020156_g37f0000", "20080613020209_a37f0000", "20080613020220_a37f0000", "20080613020233_b37f0000", "20080613020244_c47f0000", "20080613020255_c47f0000", "20080613020306_d47f0000", "20080613020317_d47f0000", "20080613020328_e47f0000", "20080613020339_f47f0000", "20080613020350_f47f0000", "20080613020401_g47f0000", "20080613020411_g47f0000", "20080613020422_a47f0000", "20080613020433_a47f0000", "20080613020444_b47f0000", "20080613020455_c57f0000", "20080613020506_c57f0000", "20080613020517_d57f0000", "20080613020528_d57f0000", "20080613020539_e57f0000", "20080613020550_f57f0000", "20080613020601_f57f0000", "20080613020611_g57f0000", "20080613020622_g57f0000", "20080613020633_a57f0000", "20080613020644_a57f0000", "20080613020659_b57f0000", "20080613020713_c67f0000", "20080613020723_c67f0000", "20080613020734_d67f0000", "20080613020747_d67f0000", "20080613020801_e67f0000", "20080613020812_f67f0000", "20080613020822_f67f0000", "20080613020833_g67f0000", "20080613020847_g67f0000", "20080613020857_a67f0000", "20080613020911_a67f0000", "20080613020936_b67f0000", "20080613020954_c77f0000", "20080613021038_c07f0000", "20080613021049_c07f0000", "20080613021102_d07f0000", "20080613021113_d07f0000", "20080613021124_e07f0000", "20080613021135_f07f0000", "20080613021146_f07f0000", "20080613021157_g07f0000", "20080613021207_g07f0000", "20080613021218_a07f0000", "20080613021229_a07f0000", "20080613021240_b07f0000", "20080613021251_c17f0000", "20080613021302_c17f0000", "20080613021313_d17f0000", "20080613021324_d17f0000", "20080613021339_e17f0000", "20080613021352_f17f0000", "20080613021403_f17f0000", "20080613021421_g17f0000", "20080613021432_g17f0000", "20080613021445_a17f0000", "20080613021456_a17f0000", "20080613021507_b17f0000", "20080613021517_c27f0000", "20080613021528_c27f0000", "20080613021539_d27f0000", "20080613021550_d27f0000", "20080613021601_e27f0000", "20080613021612_f27f0000", "20080613021623_f27f0000", "20080613021634_g27f0000", "20080613021645_g27f0000", "20080613021658_a27f0000", "20080613021709_a27f0000", "20080613021722_b27f0000", "20080613021733_c37f0000", "20080613021744_c37f0000", "20080613021755_d37f0000", "20080613021806_d37f0000", "20080613021816_e37f0000", "20080613021827_f37f0000", "20080613021838_f37f0000", "20080613021849_g37f0000", "20080613021900_g37f0000", "20080613021920_a37f0000", "20080613021931_a37f0000", "20080613021941_b37f0000", "20080613021952_c47f0000", "20080613022005_c47f0000", "20080613022016_d47f0000", "20080613022027_d47f0000", "20080613022038_e47f0000", "20080613022049_f47f0000", "20080613022100_f47f0000", "20080613022111_g47f0000", "20080613022122_g47f0000", "20080613022133_a47f0000", "20080613022143_a47f0000", "20080613022154_b47f0000", "20080613022205_c57f0000", "20080613022216_c57f0000", "20080613022227_d57f0000", "20080613022238_d57f0000", "20080613022251_e57f0000", "20080613022302_f57f0000", "20080613022319_f57f0000", "20080613022330_g57f0000", "20080613022341_g57f0000", "20080613022352_a57f0000", "20080613022403_a57f0000", "20080613022414_b57f0000", "20080613022425_c67f0000", "20080613022436_c67f0000", "20080613022446_d67f0000", "20080613022915_c07f0000", "20080613022926_c07f0000", "20080613022952_d07f0000", "20080613023003_d07f0000", "20080613023013_e07f0000", "20080613023029_f07f0000", "20080613023040_f07f0000", "20080613023053_g07f0000", "20080613023104_g07f0000", "20080613023114_a07f0000", "20080613023125_a07f0000", "20080613023136_b07f0000", "20080613023149_c17f0000", "20080613023200_c17f0000", "20080613023211_d17f0000", "20080613023222_d17f0000", "20080613023233_e17f0000", "20080613023246_f17f0000", "20080613023257_f17f0000", "20080613023308_g17f0000", "20080613023319_g17f0000", "20080613023330_a17f0000", "20080613023341_a17f0000", "20080613023352_b17f0000", "20080613023405_c27f0000", "20080613023416_c27f0000", "20080613023427_d27f0000", "20080613023437_d27f0000", "20080613023448_e27f0000", "20080613023459_f27f0000", "20080613023510_f27f0000", "20080613023521_g27f0000", "20080613023532_g27f0000", "20080613023543_a27f0000", "20080613023554_a27f0000", "20080613023604_b27f0000", "20080613023615_c37f0000", "20080613023626_c37f0000", "20080613023637_d37f0000", "20080613023648_d37f0000", "20080613023659_e37f0000", "20080613023710_f37f0000", "20080613023720_f37f0000", "20080613023731_g37f0000", "20080613023742_g37f0000", "20080613023753_a37f0000", "20080613023804_a37f0000", "20080613023815_b37f0000", "20080613023826_c47f0000", "20080613023837_c47f0000", "20080613023847_d47f0000", "20080613023858_d47f0000", "20080613023909_e47f0000", "20080613023920_f47f0000", "20080613023931_f47f0000", "20080613023942_g47f0000", "20080613023953_g47f0000", "20080613024004_a47f0000", "20080613024014_a47f0000", "20080613024025_b47f0000", "20080613024036_c57f0000", "20080613024047_c57f0000", "20080613024058_d57f0000", "20080613024109_d57f0000", "20080613024120_e57f0000", "20080613024131_f57f0000", "20080613024141_f57f0000", "20080613024152_g57f0000", "20080613024203_g57f0000", "20080613024214_a57f0000", "20080613024225_a57f0000", "20080613024238_b57f0000", "20080613024244_c67f0000", "20080613024255_c67f0000", "20080613024302_d67f0000", "20080613024313_d67f0000", "20080613024319_e67f0000", "20080613024326_f67f0000", "20080613024341_f67f0000", "20080613024354_g67f0000", "20080613024401_g67f0000", "20080613024407_a67f0000", "20080613024414_a67f0000", "20080613024422_b67f0000", "20080613024444_c77f0000", "HHat-AmbCrackle", "HHat-Ambi", "HHat-Chili", "HHat-Grange", "HHat-Hip1", "HHat-Hip2", "HHat-Tight1", "HHat-Tight2", "HHat-Vintage1", "HHat-Vintage2", "HHat-Whispy", "HHat1-Foot", "HHat1-Sizzle", "HHat2-Foot", "HHat2-Sizzle"],
       files: {"kick":"BassDrum-Ambi", "kick2":"BassDrum-AmbiCrackle", "kick3":"BassDrum-AmbiRocker", "kick4":"BassDrum-AmbiSoft", "snare":"SD-AmbCrackle1", "snare2":"SD-AmbCrackle2", "snare3":"SD-AmbCrackle3", "snare4":"SD-AmbHouse", "rim":"Tom-JazzHiRim", "hh_closed":"HHat-AlpoClosed", "hh_closed2":"HHat-CrispCL-1", "hh_closed3":"HHat-CrispCL-2", "hh_closed4":"HHat-OldCL-1", "hh_open":"HHat-ClangyOpen", "hh_open2":"HHat-CrispOpen", "hh_open3":"HHat-OldOpen", "hh_open4":"HHat1-FootOpen", "tom_hi":"Tom-BrushFloor", "tom_hi2":"Tom-BrushHi", "tom_hi3":"Tom-DirtyFunk", "tom_hi4":"Tom-JazzFloor", "tom_low":"Tom2-Floor", "tom_low2":"Tom2-Lo", "tom_low3":"Tom3-Floor", "tom_low4":"Tom3-Lo", "20070829175616_c13f0000":"20070829175616_c13f0000", "20070829175625_c17f0000":"20070829175625_c17f0000", "20070829175644_c13f0000":"20070829175644_c13f0000", "20070829175651_c17f0000":"20070829175651_c17f0000", "20070829175657_c13f0000":"20070829175657_c#13f0000", "20070829175704_c17f0000":"20070829175704_c#17f0000", "20070829175710_d13f0000":"20070829175710_d13f0000", "20070829175717_d17f0000":"20070829175717_d17f0000", "20070829175724_d13f0000":"20070829175724_d#13f0000", "20070829175730_d17f0000":"20070829175730_d#17f0000", "20070829175737_e13f0000":"20070829175737_e13f0000", "20070829175744_e17f0000":"20070829175744_e17f0000", "20070829175751_f13f0000":"20070829175751_f13f0000", "20070829175757_f17f0000":"20070829175757_f17f0000", "20070829175804_f13f0000":"20070829175804_f#13f0000", "20070829175811_f17f0000":"20070829175811_f#17f0000", "20070829175817_g13f0000":"20070829175817_g13f0000", "20070829175824_g17f0000":"20070829175824_g17f0000", "20070829175830_g13f0000":"20070829175830_g#13f0000", "20070829175837_g17f0000":"20070829175837_g#17f0000", "20070829175844_a13f0000":"20070829175844_a13f0000", "20070829175850_a17f0000":"20070829175850_a17f0000", "20070829175857_a13f0000":"20070829175857_a#13f0000", "20070829175904_a17f0000":"20070829175904_a#17f0000", "20070829175910_b13f0000":"20070829175910_b13f0000", "20070829175917_b17f0000":"20070829175917_b17f0000", "20070829175924_c23f0000":"20070829175924_c23f0000", "20070829175931_c27f0000":"20070829175931_c27f0000", "20070829175937_c23f0000":"20070829175937_c#23f0000", "20070829175944_c27f0000":"20070829175944_c#27f0000", "20070829175951_d23f0000":"20070829175951_d23f0000", "20070829175957_d27f0000":"20070829175957_d27f0000", "20070829180004_d23f0000":"20070829180004_d#23f0000", "20070829180011_d27f0000":"20070829180011_d#27f0000", "20070829180017_e23f0000":"20070829180017_e23f0000", "20070829180024_e27f0000":"20070829180024_e27f0000", "20070829180031_f23f0000":"20070829180031_f23f0000", "20070829180040_f27f0000":"20070829180040_f27f0000", "20070829180046_f23f0000":"20070829180046_f#23f0000", "20070829180053_f27f0000":"20070829180053_f#27f0000", "20070829180100_g23f0000":"20070829180100_g23f0000", "20070829180108_g27f0000":"20070829180108_g27f0000", "20070829180115_g23f0000":"20070829180115_g#23f0000", "20070829180124_g27f0000":"20070829180124_g#27f0000", "20070829180131_a23f0000":"20070829180131_a23f0000", "20070829180137_a27f0000":"20070829180137_a27f0000", "20070829180144_a23f0000":"20070829180144_a#23f0000", "20070829180153_a27f0000":"20070829180153_a#27f0000", "20070829180200_b23f0000":"20070829180200_b23f0000", "20070829180206_b27f0000":"20070829180206_b27f0000", "20070829180213_c33f0000":"20070829180213_c33f0000", "20070829180220_c37f0000":"20070829180220_c37f0000", "20070829180228_c33f0000":"20070829180228_c#33f0000", "20070829180237_c37f0000":"20070829180237_c#37f0000", "20070829180244_d33f0000":"20070829180244_d33f0000", "20070829180251_d37f0000":"20070829180251_d37f0000", "20070829180300_d33f0000":"20070829180300_d#33f0000", "20070829180311_d37f0000":"20070829180311_d#37f0000", "20070829180317_e33f0000":"20070829180317_e33f0000", "20070829180326_e37f0000":"20070829180326_e37f0000", "20070829180342_f37f0000":"20070829180342_f37f0000", "20070829180348_f33f0000":"20070829180348_f#33f0000", "20070829180355_f37f0000":"20070829180355_f#37f0000", "20070829180402_g33f0000":"20070829180402_g33f0000", "20070829180408_g37f0000":"20070829180408_g37f0000", "20070829180415_g33f0000":"20070829180415_g#33f0000", "20070829180422_g37f0000":"20070829180422_g#37f0000", "20070829180431_a33f0000":"20070829180431_a33f0000", "20070829180439_a37f0000":"20070829180439_a37f0000", "20070829180446_a33f0000":"20070829180446_a#33f0000", "20070829180453_a37f0000":"20070829180453_a#37f0000", "20070829180459_b33f0000":"20070829180459_b33f0000", "20070829180508_b37f0000":"20070829180508_b37f0000", "20070829180515_c43f0000":"20070829180515_c43f0000", "20070829180522_c47f0000":"20070829180522_c47f0000", "20070829180528_c43f0000":"20070829180528_c#43f0000", "20070829180535_c47f0000":"20070829180535_c#47f0000", "20070829180542_d43f0000":"20070829180542_d43f0000", "20070829180548_d47f0000":"20070829180548_d47f0000", "20070829180555_d43f0000":"20070829180555_d#43f0000", "20070829180602_d47f0000":"20070829180602_d#47f0000", "20070829180609_e43f0000":"20070829180609_e43f0000", "20070829180615_e47f0000":"20070829180615_e47f0000", "20070829180622_f43f0000":"20070829180622_f43f0000", "20070829180629_f47f0000":"20070829180629_f47f0000", "20070829180636_f43f0000":"20070829180636_f#43f0000", "20070829180642_f47f0000":"20070829180642_f#47f0000", "20070829180649_g43f0000":"20070829180649_g43f0000", "20070829180656_g47f0000":"20070829180656_g47f0000", "20070829180702_g43f0000":"20070829180702_g#43f0000", "20070829180709_g47f0000":"20070829180709_g#47f0000", "20070829180716_a43f0000":"20070829180716_a43f0000", "20070829180722_a47f0000":"20070829180722_a47f0000", "20070829180729_a43f0000":"20070829180729_a#43f0000", "20070829180736_a47f0000":"20070829180736_a#47f0000", "20070829180749_b47f0000":"20070829180749_b47f0000", "20070829180802_c57f0000":"20070829180802_c57f0000", "20070829180815_c57f0000":"20070829180815_c#57f0000", "20070829180829_d57f0000":"20070829180829_d57f0000", "20070829180835_d53f0000":"20070829180835_d#53f0000", "20070829180842_d57f0000":"20070829180842_d#57f0000", "20070829180849_e53f0000":"20070829180849_e53f0000", "20070829180855_e57f0000":"20070829180855_e57f0000", "20070829180908_f57f0000":"20070829180908_f57f0000", "20070829180915_f53f0000":"20070829180915_f#53f0000", "20070829180922_f57f0000":"20070829180922_f#57f0000", "20070829180928_g53f0000":"20070829180928_g53f0000", "20070829180935_g57f0000":"20070829180935_g57f0000", "20070829180942_g53f0000":"20070829180942_g#53f0000", "20070829180948_g57f0000":"20070829180948_g#57f0000", "20070829180955_a53f0000":"20070829180955_a53f0000", "20070829181002_a57f0000":"20070829181002_a57f0000", "20070829181008_a53f0000":"20070829181008_a#53f0000", "20070829181015_a57f0000":"20070829181015_a#57f0000", "20070829181026_b53f0000":"20070829181026_b53f0000", "20070829181037_b57f0000":"20070829181037_b57f0000", "20070829181044_c63f0000":"20070829181044_c63f0000", "20070829181053_c67f0000":"20070829181053_c67f0000", "20080612235947_e-27f0000":"20080612235947_e-27f0000", "20080612235959_f-27f0000":"20080612235959_f-27f0000", "20080613000117_c07f0000":"20080613000117_c07f0000", "20080613000128_c07f0000":"20080613000128_c#07f0000", "20080613000139_d07f0000":"20080613000139_d07f0000", "20080613000150_d07f0000":"20080613000150_d#07f0000", "20080613000201_e07f0000":"20080613000201_e07f0000", "20080613000212_f07f0000":"20080613000212_f07f0000", "20080613000223_f07f0000":"20080613000223_f#07f0000", "20080613000234_g07f0000":"20080613000234_g07f0000", "20080613000245_g07f0000":"20080613000245_g#07f0000", "20080613000256_a07f0000":"20080613000256_a07f0000", "20080613000307_a07f0000":"20080613000307_a#07f0000", "20080613000318_b07f0000":"20080613000318_b07f0000", "20080613000329_c17f0000":"20080613000329_c17f0000", "20080613000340_c17f0000":"20080613000340_c#17f0000", "20080613000351_d17f0000":"20080613000351_d17f0000", "20080613000402_d17f0000":"20080613000402_d#17f0000", "20080613000415_e17f0000":"20080613000415_e17f0000", "20080613000425_f17f0000":"20080613000425_f17f0000", "20080613000436_f17f0000":"20080613000436_f#17f0000", "20080613000447_g17f0000":"20080613000447_g17f0000", "20080613000458_g17f0000":"20080613000458_g#17f0000", "20080613000509_a17f0000":"20080613000509_a17f0000", "20080613000520_a17f0000":"20080613000520_a#17f0000", "20080613000531_b17f0000":"20080613000531_b17f0000", "20080613000542_c27f0000":"20080613000542_c27f0000", "20080613000552_c27f0000":"20080613000552_c#27f0000", "20080613000603_d27f0000":"20080613000603_d27f0000", "20080613000614_d27f0000":"20080613000614_d#27f0000", "20080613000625_e27f0000":"20080613000625_e27f0000", "20080613000636_f27f0000":"20080613000636_f27f0000", "20080613000647_f27f0000":"20080613000647_f#27f0000", "20080613000658_g27f0000":"20080613000658_g27f0000", "20080613000709_g27f0000":"20080613000709_g#27f0000", "20080613000719_a27f0000":"20080613000719_a27f0000", "20080613000730_a27f0000":"20080613000730_a#27f0000", "20080613000741_b27f0000":"20080613000741_b27f0000", "20080613000752_c37f0000":"20080613000752_c37f0000", "20080613000803_c37f0000":"20080613000803_c#37f0000", "20080613000814_d37f0000":"20080613000814_d37f0000", "20080613000825_d37f0000":"20080613000825_d#37f0000", "20080613000838_e37f0000":"20080613000838_e37f0000", "20080613000849_f37f0000":"20080613000849_f37f0000", "20080613000900_f37f0000":"20080613000900_f#37f0000", "20080613000913_g37f0000":"20080613000913_g37f0000", "20080613000923_g37f0000":"20080613000923_g#37f0000", "20080613000934_a37f0000":"20080613000934_a37f0000", "20080613000945_a37f0000":"20080613000945_a#37f0000", "20080613000956_b37f0000":"20080613000956_b37f0000", "20080613001007_c47f0000":"20080613001007_c47f0000", "20080613001020_c47f0000":"20080613001020_c#47f0000", "20080613001031_d47f0000":"20080613001031_d47f0000", "20080613001042_d47f0000":"20080613001042_d#47f0000", "20080613001053_e47f0000":"20080613001053_e47f0000", "20080613001104_f47f0000":"20080613001104_f47f0000", "20080613001115_f47f0000":"20080613001115_f#47f0000", "20080613001125_g47f0000":"20080613001125_g47f0000", "20080613001136_g47f0000":"20080613001136_g#47f0000", "20080613001147_a47f0000":"20080613001147_a47f0000", "20080613001158_a47f0000":"20080613001158_a#47f0000", "20080613001209_b47f0000":"20080613001209_b47f0000", "20080613001220_c57f0000":"20080613001220_c57f0000", "20080613001231_c57f0000":"20080613001231_c#57f0000", "20080613001241_d57f0000":"20080613001241_d57f0000", "20080613001252_d57f0000":"20080613001252_d#57f0000", "20080613001303_e57f0000":"20080613001303_e57f0000", "20080613001314_f57f0000":"20080613001314_f57f0000", "20080613001325_f57f0000":"20080613001325_f#57f0000", "20080613001336_g57f0000":"20080613001336_g57f0000", "20080613001347_g57f0000":"20080613001347_g#57f0000", "20080613001358_a57f0000":"20080613001358_a57f0000", "20080613001408_a57f0000":"20080613001408_a#57f0000", "20080613001419_b57f0000":"20080613001419_b57f0000", "20080613001430_c67f0000":"20080613001430_c67f0000", "20080613001441_c67f0000":"20080613001441_c#67f0000", "20080613001452_d67f0000":"20080613001452_d67f0000", "20080613001503_d67f0000":"20080613001503_d#67f0000", "20080613001514_e67f0000":"20080613001514_e67f0000", "20080613001525_f67f0000":"20080613001525_f67f0000", "20080613001535_f67f0000":"20080613001535_f#67f0000", "20080613001546_g67f0000":"20080613001546_g67f0000", "20080613001559_g67f0000":"20080613001559_g#67f0000", "20080613001610_a67f0000":"20080613001610_a67f0000", "20080613001623_a67f0000":"20080613001623_a#67f0000", "20080613001637_b67f0000":"20080613001637_b67f0000", "20080613001653_c77f0000":"20080613001653_c77f0000", "20080613002353_c07f0000":"20080613002353_c07f0000", "20080613002508_c07f0000":"20080613002508_c07f0000", "20080613002519_c07f0000":"20080613002519_c#07f0000", "20080613002541_d07f0000":"20080613002541_d07f0000", "20080613002554_d07f0000":"20080613002554_d#07f0000", "20080613002605_e07f0000":"20080613002605_e07f0000", "20080613002616_f07f0000":"20080613002616_f07f0000", "20080613002627_f07f0000":"20080613002627_f#07f0000", "20080613002637_g07f0000":"20080613002637_g07f0000", "20080613002648_g07f0000":"20080613002648_g#07f0000", "20080613002712_a07f0000":"20080613002712_a07f0000", "20080613002723_a07f0000":"20080613002723_a#07f0000", "20080613002734_b07f0000":"20080613002734_b07f0000", "20080613002745_c17f0000":"20080613002745_c17f0000", "20080613002805_c17f0000":"20080613002805_c#17f0000", "20080613002822_d17f0000":"20080613002822_d17f0000", "20080613002833_d17f0000":"20080613002833_d#17f0000", "20080613002844_e17f0000":"20080613002844_e17f0000", "20080613002855_f17f0000":"20080613002855_f17f0000", "20080613002906_f17f0000":"20080613002906_f#17f0000", "20080613002917_g17f0000":"20080613002917_g17f0000", "20080613002930_g17f0000":"20080613002930_g#17f0000", "20080613002941_a17f0000":"20080613002941_a17f0000", "20080613002956_a17f0000":"20080613002956_a#17f0000", "20080613003007_b17f0000":"20080613003007_b17f0000", "20080613003020_c27f0000":"20080613003020_c27f0000", "20080613003031_c27f0000":"20080613003031_c#27f0000", "20080613003042_d27f0000":"20080613003042_d27f0000", "20080613003057_d27f0000":"20080613003057_d#27f0000", "20080613003108_e27f0000":"20080613003108_e27f0000", "20080613003119_f27f0000":"20080613003119_f27f0000", "20080613003130_f27f0000":"20080613003130_f#27f0000", "20080613003143_g27f0000":"20080613003143_g27f0000", "20080613003154_g27f0000":"20080613003154_g#27f0000", "20080613003207_a27f0000":"20080613003207_a27f0000", "20080613003218_a27f0000":"20080613003218_a#27f0000", "20080613003229_b27f0000":"20080613003229_b27f0000", "20080613003239_c37f0000":"20080613003239_c37f0000", "20080613003250_c37f0000":"20080613003250_c#37f0000", "20080613003301_d37f0000":"20080613003301_d37f0000", "20080613003319_d37f0000":"20080613003319_d#37f0000", "20080613003332_e37f0000":"20080613003332_e37f0000", "20080613003409_f37f0000":"20080613003409_f37f0000", "20080613003429_f37f0000":"20080613003429_f#37f0000", "20080613003440_g37f0000":"20080613003440_g37f0000", "20080613003451_g37f0000":"20080613003451_g#37f0000", "20080613003508_a37f0000":"20080613003508_a37f0000", "20080613003521_a37f0000":"20080613003521_a#37f0000", "20080613003532_b37f0000":"20080613003532_b37f0000", "20080613003543_c47f0000":"20080613003543_c47f0000", "20080613003554_c47f0000":"20080613003554_c#47f0000", "20080613003605_d47f0000":"20080613003605_d47f0000", "20080613003616_d47f0000":"20080613003616_d#47f0000", "20080613003626_e47f0000":"20080613003626_e47f0000", "20080613003637_f47f0000":"20080613003637_f47f0000", "20080613003653_f47f0000":"20080613003653_f#47f0000", "20080613003706_g47f0000":"20080613003706_g47f0000", "20080613003717_g47f0000":"20080613003717_g#47f0000", "20080613003728_a47f0000":"20080613003728_a47f0000", "20080613003738_a47f0000":"20080613003738_a#47f0000", "20080613003749_b47f0000":"20080613003749_b47f0000", "20080613003802_c57f0000":"20080613003802_c57f0000", "20080613003827_c57f0000":"20080613003827_c#57f0000", "20080613003844_d57f0000":"20080613003844_d57f0000", "20080613003855_d57f0000":"20080613003855_d#57f0000", "20080613003906_e57f0000":"20080613003906_e57f0000", "20080613003919_f57f0000":"20080613003919_f57f0000", "20080613003930_f57f0000":"20080613003930_f#57f0000", "20080613003941_g57f0000":"20080613003941_g57f0000", "20080613003952_g57f0000":"20080613003952_g#57f0000", "20080613004003_a57f0000":"20080613004003_a57f0000", "20080613004018_a57f0000":"20080613004018_a#57f0000", "20080613004029_b57f0000":"20080613004029_b57f0000", "20080613004040_c67f0000":"20080613004040_c67f0000", "20080613004051_c67f0000":"20080613004051_c#67f0000", "20080613004110_d67f0000":"20080613004110_d67f0000", "20080613004121_d67f0000":"20080613004121_d#67f0000", "20080613004134_e67f0000":"20080613004134_e67f0000", "20080613004145_f67f0000":"20080613004145_f67f0000", "20080613004156_f67f0000":"20080613004156_f#67f0000", "20080613004207_g67f0000":"20080613004207_g67f0000", "20080613004218_g67f0000":"20080613004218_g#67f0000", "20080613004235_a67f0000":"20080613004235_a67f0000", "20080613004246_a67f0000":"20080613004246_a#67f0000", "20080613004259_b67f0000":"20080613004259_b67f0000", "20080613004315_c77f0000":"20080613004315_c77f0000", "20080613004538_c07f0000":"20080613004538_c07f0000", "20080613004549_c07f0000":"20080613004549_c#07f0000", "20080613004600_d07f0000":"20080613004600_d07f0000", "20080613004611_d07f0000":"20080613004611_d#07f0000", "20080613004624_e07f0000":"20080613004624_e07f0000", "20080613004640_f07f0000":"20080613004640_f07f0000", "20080613004650_f07f0000":"20080613004650_f#07f0000", "20080613004701_g07f0000":"20080613004701_g07f0000", "20080613004712_g07f0000":"20080613004712_g#07f0000", "20080613004725_a07f0000":"20080613004725_a07f0000", "20080613004745_a07f0000":"20080613004745_a#07f0000", "20080613004756_b07f0000":"20080613004756_b07f0000", "20080613004807_c17f0000":"20080613004807_c17f0000", "20080613004818_c17f0000":"20080613004818_c#17f0000", "20080613004831_d17f0000":"20080613004831_d17f0000", "20080613004844_d17f0000":"20080613004844_d#17f0000", "20080613004857_e17f0000":"20080613004857_e17f0000", "20080613004908_f17f0000":"20080613004908_f17f0000", "20080613004921_f17f0000":"20080613004921_f#17f0000", "20080613004936_g17f0000":"20080613004936_g17f0000", "20080613004949_g17f0000":"20080613004949_g#17f0000", "20080613005002_a17f0000":"20080613005002_a17f0000", "20080613005013_a17f0000":"20080613005013_a#17f0000", "20080613005024_b17f0000":"20080613005024_b17f0000", "20080613005035_c27f0000":"20080613005035_c27f0000", "20080613005046_c27f0000":"20080613005046_c#27f0000", "20080613005059_d27f0000":"20080613005059_d27f0000", "20080613005110_d27f0000":"20080613005110_d#27f0000", "20080613005121_e27f0000":"20080613005121_e27f0000", "20080613005131_f27f0000":"20080613005131_f27f0000", "20080613005142_f27f0000":"20080613005142_f#27f0000", "20080613005153_g27f0000":"20080613005153_g27f0000", "20080613005204_g27f0000":"20080613005204_g#27f0000", "20080613005215_a27f0000":"20080613005215_a27f0000", "20080613005228_a27f0000":"20080613005228_a#27f0000", "20080613005239_b27f0000":"20080613005239_b27f0000", "20080613005250_c37f0000":"20080613005250_c37f0000", "20080613005303_c37f0000":"20080613005303_c#37f0000", "20080613005318_d37f0000":"20080613005318_d37f0000", "20080613005334_d37f0000":"20080613005334_d#37f0000", "20080613005347_e37f0000":"20080613005347_e37f0000", "20080613005411_f37f0000":"20080613005411_f37f0000", "20080613005424_f37f0000":"20080613005424_f#37f0000", "20080613005437_g37f0000":"20080613005437_g37f0000", "20080613005450_g37f0000":"20080613005450_g#37f0000", "20080613005508_a37f0000":"20080613005508_a37f0000", "20080613005523_a37f0000":"20080613005523_a#37f0000", "20080613005541_b37f0000":"20080613005541_b37f0000", "20080613005552_c47f0000":"20080613005552_c47f0000", "20080613005603_c47f0000":"20080613005603_c#47f0000", "20080613005613_d47f0000":"20080613005613_d47f0000", "20080613005624_d47f0000":"20080613005624_d#47f0000", "20080613005635_e47f0000":"20080613005635_e47f0000", "20080613005648_f47f0000":"20080613005648_f47f0000", "20080613005659_f47f0000":"20080613005659_f#47f0000", "20080613005714_g47f0000":"20080613005714_g47f0000", "20080613005730_g47f0000":"20080613005730_g#47f0000", "20080613005741_a47f0000":"20080613005741_a47f0000", "20080613005751_a47f0000":"20080613005751_a#47f0000", "20080613005802_b47f0000":"20080613005802_b47f0000", "20080613005813_c57f0000":"20080613005813_c57f0000", "20080613005824_c57f0000":"20080613005824_c#57f0000", "20080613005835_d57f0000":"20080613005835_d57f0000", "20080613005846_d57f0000":"20080613005846_d#57f0000", "20080613005857_e57f0000":"20080613005857_e57f0000", "20080613005908_f57f0000":"20080613005908_f57f0000", "20080613005918_f57f0000":"20080613005918_f#57f0000", "20080613005929_g57f0000":"20080613005929_g57f0000", "20080613005940_g57f0000":"20080613005940_g#57f0000", "20080613005951_a57f0000":"20080613005951_a57f0000", "20080613010002_a57f0000":"20080613010002_a#57f0000", "20080613010013_b57f0000":"20080613010013_b57f0000", "20080613010024_c67f0000":"20080613010024_c67f0000", "20080613010035_c67f0000":"20080613010035_c#67f0000", "20080613010045_d67f0000":"20080613010045_d67f0000", "20080613010059_d67f0000":"20080613010059_d#67f0000", "20080613010113_e67f0000":"20080613010113_e67f0000", "20080613010124_f67f0000":"20080613010124_f67f0000", "20080613010137_f67f0000":"20080613010137_f#67f0000", "20080613010148_g67f0000":"20080613010148_g67f0000", "20080613010158_g67f0000":"20080613010158_g#67f0000", "20080613010209_a67f0000":"20080613010209_a67f0000", "20080613010222_a67f0000":"20080613010222_a#67f0000", "20080613010235_b67f0000":"20080613010235_b67f0000", "20080613010246_c77f0000":"20080613010246_c77f0000", "20080613011335_c07f0000":"20080613011335_c07f0000", "20080613011346_c07f0000":"20080613011346_c#07f0000", "20080613011357_d07f0000":"20080613011357_d07f0000", "20080613011408_d07f0000":"20080613011408_d#07f0000", "20080613011419_e07f0000":"20080613011419_e07f0000", "20080613011436_f07f0000":"20080613011436_f07f0000", "20080613011447_f07f0000":"20080613011447_f#07f0000", "20080613011458_g07f0000":"20080613011458_g07f0000", "20080613011509_g07f0000":"20080613011509_g#07f0000", "20080613011520_a07f0000":"20080613011520_a07f0000", "20080613011531_a07f0000":"20080613011531_a#07f0000", "20080613011541_b07f0000":"20080613011541_b07f0000", "20080613011552_c17f0000":"20080613011552_c17f0000", "20080613011603_c17f0000":"20080613011603_c#17f0000", "20080613011614_d17f0000":"20080613011614_d17f0000", "20080613011625_d17f0000":"20080613011625_d#17f0000", "20080613011636_e17f0000":"20080613011636_e17f0000", "20080613011647_f17f0000":"20080613011647_f17f0000", "20080613011657_f17f0000":"20080613011657_f#17f0000", "20080613011708_g17f0000":"20080613011708_g17f0000", "20080613011719_g17f0000":"20080613011719_g#17f0000", "20080613011730_a17f0000":"20080613011730_a17f0000", "20080613011741_a17f0000":"20080613011741_a#17f0000", "20080613011752_b17f0000":"20080613011752_b17f0000", "20080613011803_c27f0000":"20080613011803_c27f0000", "20080613011813_c27f0000":"20080613011813_c#27f0000", "20080613011824_d27f0000":"20080613011824_d27f0000", "20080613011835_d27f0000":"20080613011835_d#27f0000", "20080613011846_e27f0000":"20080613011846_e27f0000", "20080613011857_f27f0000":"20080613011857_f27f0000", "20080613011908_f27f0000":"20080613011908_f#27f0000", "20080613011919_g27f0000":"20080613011919_g27f0000", "20080613011929_g27f0000":"20080613011929_g#27f0000", "20080613011940_a27f0000":"20080613011940_a27f0000", "20080613011956_a27f0000":"20080613011956_a#27f0000", "20080613012007_b27f0000":"20080613012007_b27f0000", "20080613012017_c37f0000":"20080613012017_c37f0000", "20080613012028_c37f0000":"20080613012028_c#37f0000", "20080613012039_d37f0000":"20080613012039_d37f0000", "20080613012050_d37f0000":"20080613012050_d#37f0000", "20080613012101_e37f0000":"20080613012101_e37f0000", "20080613012112_f37f0000":"20080613012112_f37f0000", "20080613012123_f37f0000":"20080613012123_f#37f0000", "20080613012133_g37f0000":"20080613012133_g37f0000", "20080613012144_g37f0000":"20080613012144_g#37f0000", "20080613012155_a37f0000":"20080613012155_a37f0000", "20080613012206_a37f0000":"20080613012206_a#37f0000", "20080613012217_b37f0000":"20080613012217_b37f0000", "20080613012228_c47f0000":"20080613012228_c47f0000", "20080613012239_c47f0000":"20080613012239_c#47f0000", "20080613012249_d47f0000":"20080613012249_d47f0000", "20080613012300_d47f0000":"20080613012300_d#47f0000", "20080613012311_e47f0000":"20080613012311_e47f0000", "20080613012322_f47f0000":"20080613012322_f47f0000", "20080613012333_f47f0000":"20080613012333_f#47f0000", "20080613012344_g47f0000":"20080613012344_g47f0000", "20080613012355_g47f0000":"20080613012355_g#47f0000", "20080613012405_a47f0000":"20080613012405_a47f0000", "20080613012416_a47f0000":"20080613012416_a#47f0000", "20080613012427_b47f0000":"20080613012427_b47f0000", "20080613012438_c57f0000":"20080613012438_c57f0000", "20080613012449_c57f0000":"20080613012449_c#57f0000", "20080613012500_d57f0000":"20080613012500_d57f0000", "20080613012513_d57f0000":"20080613012513_d#57f0000", "20080613012524_e57f0000":"20080613012524_e57f0000", "20080613012535_f57f0000":"20080613012535_f57f0000", "20080613012545_f57f0000":"20080613012545_f#57f0000", "20080613012556_g57f0000":"20080613012556_g57f0000", "20080613012607_g57f0000":"20080613012607_g#57f0000", "20080613012618_a57f0000":"20080613012618_a57f0000", "20080613012631_a57f0000":"20080613012631_a#57f0000", "20080613012642_b57f0000":"20080613012642_b57f0000", "20080613012653_c67f0000":"20080613012653_c67f0000", "20080613013504_c07f0000":"20080613013504_c07f0000", "20080613013515_c07f0000":"20080613013515_c#07f0000", "20080613013526_d07f0000":"20080613013526_d07f0000", "20080613013537_d07f0000":"20080613013537_d#07f0000", "20080613013547_e07f0000":"20080613013547_e07f0000", "20080613013558_f07f0000":"20080613013558_f07f0000", "20080613013609_f07f0000":"20080613013609_f#07f0000", "20080613013620_g07f0000":"20080613013620_g07f0000", "20080613013631_g07f0000":"20080613013631_g#07f0000", "20080613013642_a07f0000":"20080613013642_a07f0000", "20080613013655_a07f0000":"20080613013655_a#07f0000", "20080613013712_b07f0000":"20080613013712_b07f0000", "20080613013723_c17f0000":"20080613013723_c17f0000", "20080613013734_c17f0000":"20080613013734_c#17f0000", "20080613013745_d17f0000":"20080613013745_d17f0000", "20080613013756_d17f0000":"20080613013756_d#17f0000", "20080613013807_e17f0000":"20080613013807_e17f0000", "20080613013817_f17f0000":"20080613013817_f17f0000", "20080613013828_f17f0000":"20080613013828_f#17f0000", "20080613013839_g17f0000":"20080613013839_g17f0000", "20080613013850_g17f0000":"20080613013850_g#17f0000", "20080613013901_a17f0000":"20080613013901_a17f0000", "20080613013912_a17f0000":"20080613013912_a#17f0000", "20080613013923_b17f0000":"20080613013923_b17f0000", "20080613013934_c27f0000":"20080613013934_c27f0000", "20080613013947_c27f0000":"20080613013947_c#27f0000", "20080613014004_d27f0000":"20080613014004_d27f0000", "20080613014017_d27f0000":"20080613014017_d#27f0000", "20080613014028_e27f0000":"20080613014028_e27f0000", "20080613014039_f27f0000":"20080613014039_f27f0000", "20080613014050_f27f0000":"20080613014050_f#27f0000", "20080613014101_g27f0000":"20080613014101_g27f0000", "20080613014113_g27f0000":"20080613014113_g#27f0000", "20080613014124_a27f0000":"20080613014124_a27f0000", "20080613014139_a27f0000":"20080613014139_a#27f0000", "20080613014150_b27f0000":"20080613014150_b27f0000", "20080613014201_c37f0000":"20080613014201_c37f0000", "20080613014212_c37f0000":"20080613014212_c#37f0000", "20080613014223_d37f0000":"20080613014223_d37f0000", "20080613014234_d37f0000":"20080613014234_d#37f0000", "20080613014245_e37f0000":"20080613014245_e37f0000", "20080613014256_f37f0000":"20080613014256_f37f0000", "20080613014307_f37f0000":"20080613014307_f#37f0000", "20080613014318_g37f0000":"20080613014318_g37f0000", "20080613014330_g37f0000":"20080613014330_g#37f0000", "20080613014341_a37f0000":"20080613014341_a37f0000", "20080613014352_a37f0000":"20080613014352_a#37f0000", "20080613014402_b37f0000":"20080613014402_b37f0000", "20080613014413_c47f0000":"20080613014413_c47f0000", "20080613014424_c47f0000":"20080613014424_c#47f0000", "20080613014435_d47f0000":"20080613014435_d47f0000", "20080613014446_d47f0000":"20080613014446_d#47f0000", "20080613014457_e47f0000":"20080613014457_e47f0000", "20080613014508_f47f0000":"20080613014508_f47f0000", "20080613014519_f47f0000":"20080613014519_f#47f0000", "20080613014535_g47f0000":"20080613014535_g47f0000", "20080613014546_g47f0000":"20080613014546_g#47f0000", "20080613014557_a47f0000":"20080613014557_a47f0000", "20080613014608_a47f0000":"20080613014608_a#47f0000", "20080613014628_b47f0000":"20080613014628_b47f0000", "20080613014641_c57f0000":"20080613014641_c57f0000", "20080613014652_c57f0000":"20080613014652_c#57f0000", "20080613014703_d57f0000":"20080613014703_d57f0000", "20080613014723_d57f0000":"20080613014723_d#57f0000", "20080613014734_e57f0000":"20080613014734_e57f0000", "20080613014745_f57f0000":"20080613014745_f57f0000", "20080613014756_f57f0000":"20080613014756_f#57f0000", "20080613014807_g57f0000":"20080613014807_g57f0000", "20080613014820_g57f0000":"20080613014820_g#57f0000", "20080613014831_a57f0000":"20080613014831_a57f0000", "20080613014846_a57f0000":"20080613014846_a#57f0000", "20080613014857_b57f0000":"20080613014857_b57f0000", "20080613014913_c67f0000":"20080613014913_c67f0000", "20080613014947_d67f0000":"20080613014947_d#67f0000", "20080613015327_c07f0000":"20080613015327_c07f0000", "20080613015338_c07f0000":"20080613015338_c#07f0000", "20080613015349_d07f0000":"20080613015349_d07f0000", "20080613015400_d07f0000":"20080613015400_d#07f0000", "20080613015411_e07f0000":"20080613015411_e07f0000", "20080613015422_f07f0000":"20080613015422_f07f0000", "20080613015433_f07f0000":"20080613015433_f#07f0000", "20080613015446_g07f0000":"20080613015446_g07f0000", "20080613015457_g07f0000":"20080613015457_g#07f0000", "20080613015508_a07f0000":"20080613015508_a07f0000", "20080613015519_a07f0000":"20080613015519_a#07f0000", "20080613015530_b07f0000":"20080613015530_b07f0000", "20080613015541_c17f0000":"20080613015541_c17f0000", "20080613015552_c17f0000":"20080613015552_c#17f0000", "20080613015603_d17f0000":"20080613015603_d17f0000", "20080613015613_d17f0000":"20080613015613_d#17f0000", "20080613015624_e17f0000":"20080613015624_e17f0000", "20080613015635_f17f0000":"20080613015635_f17f0000", "20080613015646_f17f0000":"20080613015646_f#17f0000", "20080613015657_g17f0000":"20080613015657_g17f0000", "20080613015708_g17f0000":"20080613015708_g#17f0000", "20080613015719_a17f0000":"20080613015719_a17f0000", "20080613015730_a17f0000":"20080613015730_a#17f0000", "20080613015741_b17f0000":"20080613015741_b17f0000", "20080613015751_c27f0000":"20080613015751_c27f0000", "20080613015802_c27f0000":"20080613015802_c#27f0000", "20080613015813_d27f0000":"20080613015813_d27f0000", "20080613015824_d27f0000":"20080613015824_d#27f0000", "20080613015844_e27f0000":"20080613015844_e27f0000", "20080613015855_f27f0000":"20080613015855_f27f0000", "20080613015910_f27f0000":"20080613015910_f#27f0000", "20080613015921_g27f0000":"20080613015921_g27f0000", "20080613015932_g27f0000":"20080613015932_g#27f0000", "20080613015943_a27f0000":"20080613015943_a27f0000", "20080613015954_a27f0000":"20080613015954_a#27f0000", "20080613020005_b27f0000":"20080613020005_b27f0000", "20080613020015_c37f0000":"20080613020015_c37f0000", "20080613020029_c37f0000":"20080613020029_c#37f0000", "20080613020040_d37f0000":"20080613020040_d37f0000", "20080613020053_d37f0000":"20080613020053_d#37f0000", "20080613020106_e37f0000":"20080613020106_e37f0000", "20080613020119_f37f0000":"20080613020119_f37f0000", "20080613020130_f37f0000":"20080613020130_f#37f0000", "20080613020143_g37f0000":"20080613020143_g37f0000", "20080613020156_g37f0000":"20080613020156_g#37f0000", "20080613020209_a37f0000":"20080613020209_a37f0000", "20080613020220_a37f0000":"20080613020220_a#37f0000", "20080613020233_b37f0000":"20080613020233_b37f0000", "20080613020244_c47f0000":"20080613020244_c47f0000", "20080613020255_c47f0000":"20080613020255_c#47f0000", "20080613020306_d47f0000":"20080613020306_d47f0000", "20080613020317_d47f0000":"20080613020317_d#47f0000", "20080613020328_e47f0000":"20080613020328_e47f0000", "20080613020339_f47f0000":"20080613020339_f47f0000", "20080613020350_f47f0000":"20080613020350_f#47f0000", "20080613020401_g47f0000":"20080613020401_g47f0000", "20080613020411_g47f0000":"20080613020411_g#47f0000", "20080613020422_a47f0000":"20080613020422_a47f0000", "20080613020433_a47f0000":"20080613020433_a#47f0000", "20080613020444_b47f0000":"20080613020444_b47f0000", "20080613020455_c57f0000":"20080613020455_c57f0000", "20080613020506_c57f0000":"20080613020506_c#57f0000", "20080613020517_d57f0000":"20080613020517_d57f0000", "20080613020528_d57f0000":"20080613020528_d#57f0000", "20080613020539_e57f0000":"20080613020539_e57f0000", "20080613020550_f57f0000":"20080613020550_f57f0000", "20080613020601_f57f0000":"20080613020601_f#57f0000", "20080613020611_g57f0000":"20080613020611_g57f0000", "20080613020622_g57f0000":"20080613020622_g#57f0000", "20080613020633_a57f0000":"20080613020633_a57f0000", "20080613020644_a57f0000":"20080613020644_a#57f0000", "20080613020659_b57f0000":"20080613020659_b57f0000", "20080613020713_c67f0000":"20080613020713_c67f0000", "20080613020723_c67f0000":"20080613020723_c#67f0000", "20080613020734_d67f0000":"20080613020734_d67f0000", "20080613020747_d67f0000":"20080613020747_d#67f0000", "20080613020801_e67f0000":"20080613020801_e67f0000", "20080613020812_f67f0000":"20080613020812_f67f0000", "20080613020822_f67f0000":"20080613020822_f#67f0000", "20080613020833_g67f0000":"20080613020833_g67f0000", "20080613020847_g67f0000":"20080613020847_g#67f0000", "20080613020857_a67f0000":"20080613020857_a67f0000", "20080613020911_a67f0000":"20080613020911_a#67f0000", "20080613020936_b67f0000":"20080613020936_b67f0000", "20080613020954_c77f0000":"20080613020954_c77f0000", "20080613021038_c07f0000":"20080613021038_c07f0000", "20080613021049_c07f0000":"20080613021049_c#07f0000", "20080613021102_d07f0000":"20080613021102_d07f0000", "20080613021113_d07f0000":"20080613021113_d#07f0000", "20080613021124_e07f0000":"20080613021124_e07f0000", "20080613021135_f07f0000":"20080613021135_f07f0000", "20080613021146_f07f0000":"20080613021146_f#07f0000", "20080613021157_g07f0000":"20080613021157_g07f0000", "20080613021207_g07f0000":"20080613021207_g#07f0000", "20080613021218_a07f0000":"20080613021218_a07f0000", "20080613021229_a07f0000":"20080613021229_a#07f0000", "20080613021240_b07f0000":"20080613021240_b07f0000", "20080613021251_c17f0000":"20080613021251_c17f0000", "20080613021302_c17f0000":"20080613021302_c#17f0000", "20080613021313_d17f0000":"20080613021313_d17f0000", "20080613021324_d17f0000":"20080613021324_d#17f0000", "20080613021339_e17f0000":"20080613021339_e17f0000", "20080613021352_f17f0000":"20080613021352_f17f0000", "20080613021403_f17f0000":"20080613021403_f#17f0000", "20080613021421_g17f0000":"20080613021421_g17f0000", "20080613021432_g17f0000":"20080613021432_g#17f0000", "20080613021445_a17f0000":"20080613021445_a17f0000", "20080613021456_a17f0000":"20080613021456_a#17f0000", "20080613021507_b17f0000":"20080613021507_b17f0000", "20080613021517_c27f0000":"20080613021517_c27f0000", "20080613021528_c27f0000":"20080613021528_c#27f0000", "20080613021539_d27f0000":"20080613021539_d27f0000", "20080613021550_d27f0000":"20080613021550_d#27f0000", "20080613021601_e27f0000":"20080613021601_e27f0000", "20080613021612_f27f0000":"20080613021612_f27f0000", "20080613021623_f27f0000":"20080613021623_f#27f0000", "20080613021634_g27f0000":"20080613021634_g27f0000", "20080613021645_g27f0000":"20080613021645_g#27f0000", "20080613021658_a27f0000":"20080613021658_a27f0000", "20080613021709_a27f0000":"20080613021709_a#27f0000", "20080613021722_b27f0000":"20080613021722_b27f0000", "20080613021733_c37f0000":"20080613021733_c37f0000", "20080613021744_c37f0000":"20080613021744_c#37f0000", "20080613021755_d37f0000":"20080613021755_d37f0000", "20080613021806_d37f0000":"20080613021806_d#37f0000", "20080613021816_e37f0000":"20080613021816_e37f0000", "20080613021827_f37f0000":"20080613021827_f37f0000", "20080613021838_f37f0000":"20080613021838_f#37f0000", "20080613021849_g37f0000":"20080613021849_g37f0000", "20080613021900_g37f0000":"20080613021900_g#37f0000", "20080613021920_a37f0000":"20080613021920_a37f0000", "20080613021931_a37f0000":"20080613021931_a#37f0000", "20080613021941_b37f0000":"20080613021941_b37f0000", "20080613021952_c47f0000":"20080613021952_c47f0000", "20080613022005_c47f0000":"20080613022005_c#47f0000", "20080613022016_d47f0000":"20080613022016_d47f0000", "20080613022027_d47f0000":"20080613022027_d#47f0000", "20080613022038_e47f0000":"20080613022038_e47f0000", "20080613022049_f47f0000":"20080613022049_f47f0000", "20080613022100_f47f0000":"20080613022100_f#47f0000", "20080613022111_g47f0000":"20080613022111_g47f0000", "20080613022122_g47f0000":"20080613022122_g#47f0000", "20080613022133_a47f0000":"20080613022133_a47f0000", "20080613022143_a47f0000":"20080613022143_a#47f0000", "20080613022154_b47f0000":"20080613022154_b47f0000", "20080613022205_c57f0000":"20080613022205_c57f0000", "20080613022216_c57f0000":"20080613022216_c#57f0000", "20080613022227_d57f0000":"20080613022227_d57f0000", "20080613022238_d57f0000":"20080613022238_d#57f0000", "20080613022251_e57f0000":"20080613022251_e57f0000", "20080613022302_f57f0000":"20080613022302_f57f0000", "20080613022319_f57f0000":"20080613022319_f#57f0000", "20080613022330_g57f0000":"20080613022330_g57f0000", "20080613022341_g57f0000":"20080613022341_g#57f0000", "20080613022352_a57f0000":"20080613022352_a57f0000", "20080613022403_a57f0000":"20080613022403_a#57f0000", "20080613022414_b57f0000":"20080613022414_b57f0000", "20080613022425_c67f0000":"20080613022425_c67f0000", "20080613022436_c67f0000":"20080613022436_c#67f0000", "20080613022446_d67f0000":"20080613022446_d67f0000", "20080613022915_c07f0000":"20080613022915_c07f0000", "20080613022926_c07f0000":"20080613022926_c#07f0000", "20080613022952_d07f0000":"20080613022952_d07f0000", "20080613023003_d07f0000":"20080613023003_d#07f0000", "20080613023013_e07f0000":"20080613023013_e07f0000", "20080613023029_f07f0000":"20080613023029_f07f0000", "20080613023040_f07f0000":"20080613023040_f#07f0000", "20080613023053_g07f0000":"20080613023053_g07f0000", "20080613023104_g07f0000":"20080613023104_g#07f0000", "20080613023114_a07f0000":"20080613023114_a07f0000", "20080613023125_a07f0000":"20080613023125_a#07f0000", "20080613023136_b07f0000":"20080613023136_b07f0000", "20080613023149_c17f0000":"20080613023149_c17f0000", "20080613023200_c17f0000":"20080613023200_c#17f0000", "20080613023211_d17f0000":"20080613023211_d17f0000", "20080613023222_d17f0000":"20080613023222_d#17f0000", "20080613023233_e17f0000":"20080613023233_e17f0000", "20080613023246_f17f0000":"20080613023246_f17f0000", "20080613023257_f17f0000":"20080613023257_f#17f0000", "20080613023308_g17f0000":"20080613023308_g17f0000", "20080613023319_g17f0000":"20080613023319_g#17f0000", "20080613023330_a17f0000":"20080613023330_a17f0000", "20080613023341_a17f0000":"20080613023341_a#17f0000", "20080613023352_b17f0000":"20080613023352_b17f0000", "20080613023405_c27f0000":"20080613023405_c27f0000", "20080613023416_c27f0000":"20080613023416_c#27f0000", "20080613023427_d27f0000":"20080613023427_d27f0000", "20080613023437_d27f0000":"20080613023437_d#27f0000", "20080613023448_e27f0000":"20080613023448_e27f0000", "20080613023459_f27f0000":"20080613023459_f27f0000", "20080613023510_f27f0000":"20080613023510_f#27f0000", "20080613023521_g27f0000":"20080613023521_g27f0000", "20080613023532_g27f0000":"20080613023532_g#27f0000", "20080613023543_a27f0000":"20080613023543_a27f0000", "20080613023554_a27f0000":"20080613023554_a#27f0000", "20080613023604_b27f0000":"20080613023604_b27f0000", "20080613023615_c37f0000":"20080613023615_c37f0000", "20080613023626_c37f0000":"20080613023626_c#37f0000", "20080613023637_d37f0000":"20080613023637_d37f0000", "20080613023648_d37f0000":"20080613023648_d#37f0000", "20080613023659_e37f0000":"20080613023659_e37f0000", "20080613023710_f37f0000":"20080613023710_f37f0000", "20080613023720_f37f0000":"20080613023720_f#37f0000", "20080613023731_g37f0000":"20080613023731_g37f0000", "20080613023742_g37f0000":"20080613023742_g#37f0000", "20080613023753_a37f0000":"20080613023753_a37f0000", "20080613023804_a37f0000":"20080613023804_a#37f0000", "20080613023815_b37f0000":"20080613023815_b37f0000", "20080613023826_c47f0000":"20080613023826_c47f0000", "20080613023837_c47f0000":"20080613023837_c#47f0000", "20080613023847_d47f0000":"20080613023847_d47f0000", "20080613023858_d47f0000":"20080613023858_d#47f0000", "20080613023909_e47f0000":"20080613023909_e47f0000", "20080613023920_f47f0000":"20080613023920_f47f0000", "20080613023931_f47f0000":"20080613023931_f#47f0000", "20080613023942_g47f0000":"20080613023942_g47f0000", "20080613023953_g47f0000":"20080613023953_g#47f0000", "20080613024004_a47f0000":"20080613024004_a47f0000", "20080613024014_a47f0000":"20080613024014_a#47f0000", "20080613024025_b47f0000":"20080613024025_b47f0000", "20080613024036_c57f0000":"20080613024036_c57f0000", "20080613024047_c57f0000":"20080613024047_c#57f0000", "20080613024058_d57f0000":"20080613024058_d57f0000", "20080613024109_d57f0000":"20080613024109_d#57f0000", "20080613024120_e57f0000":"20080613024120_e57f0000", "20080613024131_f57f0000":"20080613024131_f57f0000", "20080613024141_f57f0000":"20080613024141_f#57f0000", "20080613024152_g57f0000":"20080613024152_g57f0000", "20080613024203_g57f0000":"20080613024203_g#57f0000", "20080613024214_a57f0000":"20080613024214_a57f0000", "20080613024225_a57f0000":"20080613024225_a#57f0000", "20080613024238_b57f0000":"20080613024238_b57f0000", "20080613024244_c67f0000":"20080613024244_c67f0000", "20080613024255_c67f0000":"20080613024255_c#67f0000", "20080613024302_d67f0000":"20080613024302_d67f0000", "20080613024313_d67f0000":"20080613024313_d#67f0000", "20080613024319_e67f0000":"20080613024319_e67f0000", "20080613024326_f67f0000":"20080613024326_f67f0000", "20080613024341_f67f0000":"20080613024341_f#67f0000", "20080613024354_g67f0000":"20080613024354_g67f0000", "20080613024401_g67f0000":"20080613024401_g#67f0000", "20080613024407_a67f0000":"20080613024407_a67f0000", "20080613024414_a67f0000":"20080613024414_a#67f0000", "20080613024422_b67f0000":"20080613024422_b67f0000", "20080613024444_c77f0000":"20080613024444_c77f0000", "HHat-AmbCrackle":"HHat-AmbCrackle", "HHat-Ambi":"HHat-Ambi", "HHat-Chili":"HHat-Chili", "HHat-Grange":"HHat-Grange", "HHat-Hip1":"HHat-Hip1", "HHat-Hip2":"HHat-Hip2", "HHat-Tight1":"HHat-Tight1", "HHat-Tight2":"HHat-Tight2", "HHat-Vintage1":"HHat-Vintage1", "HHat-Vintage2":"HHat-Vintage2", "HHat-Whispy":"HHat-Whispy", "HHat1-Foot":"HHat1-Foot", "HHat1-Sizzle":"HHat1-Sizzle", "HHat2-Foot":"HHat2-Foot", "HHat2-Sizzle":"HHat2-Sizzle"}},
      {id: "z1", name: "Korg Z1",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "hh_closed", "hh_closed2", "hh_closed3", "hh_open", "hh_open2", "hh_open3", "ride", "Blip_Perc_1", "Blip_Perc_10", "Blip_Perc_11", "Blip_Perc_12", "Blip_Perc_13", "Blip_Perc_2", "Blip_Perc_3", "Blip_Perc_4", "Blip_Perc_5", "Blip_Perc_6", "Blip_Perc_7", "Blip_Perc_8", "Blip_Perc_9", "Blipp_1", "Blipp_2", "Blipp_3", "Blipp_4", "Blipp_5", "Blipp_6", "Blipp_7", "Sonar", "Tjokk_1", "Tjupp_1", "Tjupp_2", "Tjupp_3", "Tjupp_4", "Tjupp_5", "Tjupp_6", "Tjupp_7", "Tjupp_8", "Tjupp_9", "WaveDrum_C3", "WaveDrum_C4", "WaveDrum_C5", "WaveDrum_C6"],
       files: {"kick":"Kick 1", "kick2":"Kick 2", "kick3":"Kick 3 Rev", "kick4":"Kick 3", "snare":"Snare 1", "snare2":"Snare 10", "snare3":"Snare 11", "snare4":"Snare 12", "hh_closed":"Chh 2", "hh_closed2":"Chh 3", "hh_closed3":"Chh", "hh_open":"Ohh 2", "hh_open2":"Ohh 3", "hh_open3":"Ohh", "ride":"Crash 1", "Blip_Perc_1":"Blip Perc 1", "Blip_Perc_10":"Blip Perc 10", "Blip_Perc_11":"Blip Perc 11", "Blip_Perc_12":"Blip Perc 12", "Blip_Perc_13":"Blip Perc 13", "Blip_Perc_2":"Blip Perc 2", "Blip_Perc_3":"Blip Perc 3", "Blip_Perc_4":"Blip Perc 4", "Blip_Perc_5":"Blip Perc 5", "Blip_Perc_6":"Blip Perc 6", "Blip_Perc_7":"Blip Perc 7", "Blip_Perc_8":"Blip Perc 8", "Blip_Perc_9":"Blip Perc 9", "Blipp_1":"Blipp 1", "Blipp_2":"Blipp 2", "Blipp_3":"Blipp 3", "Blipp_4":"Blipp 4", "Blipp_5":"Blipp 5", "Blipp_6":"Blipp 6", "Blipp_7":"Blipp 7", "Sonar":"Sonar", "Tjokk_1":"Tjokk 1", "Tjupp_1":"Tjupp 1", "Tjupp_2":"Tjupp 2", "Tjupp_3":"Tjupp 3", "Tjupp_4":"Tjupp 4", "Tjupp_5":"Tjupp 5", "Tjupp_6":"Tjupp 6", "Tjupp_7":"Tjupp 7", "Tjupp_8":"Tjupp 8", "Tjupp_9":"Tjupp 9", "WaveDrum_C3":"WaveDrum C3", "WaveDrum_C4":"WaveDrum C4", "WaveDrum_C5":"WaveDrum C5", "WaveDrum_C6":"WaveDrum C6"}},
      {id: "dx7", name: "Yamaha DX7",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "clap2", "clap3", "clap4", "rim", "rim2", "tom_hi", "tom_low", "tom_low2", "cowbell", "cowbell2", "cowbell3", "cowbell4", "Beep1", "Beep2", "Beep3", "Beep4", "Cym1", "Cym2", "Efx1", "Efx10", "Efx11", "Efx12", "Efx13", "Efx14", "Efx15", "Efx16", "Efx17", "Efx18", "Efx19", "Efx2", "Efx20", "Efx3", "Efx4", "Efx5", "Efx6", "Efx7", "Efx8", "Efx9", "Hat1", "Hat2", "Hat3", "Hat4", "Hat5", "Met1", "Met2", "Met3", "Met4", "Met5", "Met6", "Met7", "Met8", "Zip1", "Zip2", "Zip3"],
       files: {"kick":"Kick1", "kick2":"Kick2", "kick3":"Kick3", "kick4":"Kick4", "snare":"Snare1", "snare2":"Snare2", "snare3":"Snare3", "snare4":"Snare4", "clap":"Clap1", "clap2":"Clap2", "clap3":"Clap3", "clap4":"Clap4", "rim":"Rim1", "rim2":"Rim2", "tom_hi":"Tom1", "tom_low":"Tom2", "tom_low2":"Tom3", "cowbell":"Clave", "cowbell2":"Cow1", "cowbell3":"Cow2", "cowbell4":"Cow3", "Beep1":"Beep1", "Beep2":"Beep2", "Beep3":"Beep3", "Beep4":"Beep4", "Cym1":"Cym1", "Cym2":"Cym2", "Efx1":"Efx1", "Efx10":"Efx10", "Efx11":"Efx11", "Efx12":"Efx12", "Efx13":"Efx13", "Efx14":"Efx14", "Efx15":"Efx15", "Efx16":"Efx16", "Efx17":"Efx17", "Efx18":"Efx18", "Efx19":"Efx19", "Efx2":"Efx2", "Efx20":"Efx20", "Efx3":"Efx3", "Efx4":"Efx4", "Efx5":"Efx5", "Efx6":"Efx6", "Efx7":"Efx7", "Efx8":"Efx8", "Efx9":"Efx9", "Hat1":"Hat1", "Hat2":"Hat2", "Hat3":"Hat3", "Hat4":"Hat4", "Hat5":"Hat5", "Met1":"Met1", "Met2":"Met2", "Met3":"Met3", "Met4":"Met4", "Met5":"Met5", "Met6":"Met6", "Met7":"Met7", "Met8":"Met8", "Zip1":"Zip1", "Zip2":"Zip2", "Zip3":"Zip3"}},
      {id: "ex5", name: "Yamaha EX-5",
       slots: ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "020", "021", "022", "023", "024", "025", "026", "027", "028", "029", "030", "031", "032", "033", "034", "035", "036", "037", "038", "039", "040", "041", "042", "043", "044", "EX5B_001", "EX5B_002", "EX5B_003", "EX5B_004", "EX5B_005", "EX5B_006", "EX5B_007", "EX5B_008", "EX5B_009", "EX5B_010", "EX5B_011", "EX5B_012", "EX5B_013", "EX5B_014", "EX5B_015", "EX5B_016", "EX5B_017", "EX5B_018", "EX5B_019", "EX5B_020", "EX5B_021", "EX5B_022", "EX5B_023", "EX5B_024", "EX5B_025", "EX5B_026", "EX5B_027", "EX5B_028", "EX5B_029", "EX5B_030", "EX5C_001", "EX5C_002", "EX5C_003", "EX5C_004", "EX5C_005", "EX5C_006", "EX5C_007", "EX5C_008", "EX5C_009", "EX5C_010", "EX5C_011", "EX5C_012", "EX5C_013", "EX5C_014", "EX5C_015", "EX5C_016", "EX5C_017", "EX5C_018", "EX5C_019", "EX5C_020", "EX5C_021", "EX5C_022", "EX5C_023", "EX5C_024", "EX5C_025", "EX5C_026", "EX5C_027", "EX5C_028", "EX5C_029", "EX5C_030", "EX5C_031", "EX5D_001", "EX5D_002", "EX5D_003", "EX5D_004", "EX5D_005", "EX5D_006", "EX5D_007", "EX5D_008", "EX5D_009", "EX5D_010", "EX5D_011", "EX5D_012", "EX5D_013", "EX5D_014", "EX5D_015", "EX5D_016", "EX5D_017", "EX5D_018", "EX5D_019", "EX5D_020", "EX5D_021", "EX5D_022", "EX5D_023", "EX5D_024"],
       files: {"001":"001", "002":"002", "003":"003", "004":"004", "005":"005", "006":"006", "007":"007", "008":"008", "009":"009", "010":"010", "011":"011", "012":"012", "013":"013", "014":"014", "015":"015", "016":"016", "017":"017", "018":"018", "019":"019", "020":"020", "021":"021", "022":"022", "023":"023", "024":"024", "025":"025", "026":"026", "027":"027", "028":"028", "029":"029", "030":"030", "031":"031", "032":"032", "033":"033", "034":"034", "035":"035", "036":"036", "037":"037", "038":"038", "039":"039", "040":"040", "041":"041", "042":"042", "043":"043", "044":"044", "EX5B_001":"EX5B 001", "EX5B_002":"EX5B 002", "EX5B_003":"EX5B 003", "EX5B_004":"EX5B 004", "EX5B_005":"EX5B 005", "EX5B_006":"EX5B 006", "EX5B_007":"EX5B 007", "EX5B_008":"EX5B 008", "EX5B_009":"EX5B 009", "EX5B_010":"EX5B 010", "EX5B_011":"EX5B 011", "EX5B_012":"EX5B 012", "EX5B_013":"EX5B 013", "EX5B_014":"EX5B 014", "EX5B_015":"EX5B 015", "EX5B_016":"EX5B 016", "EX5B_017":"EX5B 017", "EX5B_018":"EX5B 018", "EX5B_019":"EX5B 019", "EX5B_020":"EX5B 020", "EX5B_021":"EX5B 021", "EX5B_022":"EX5B 022", "EX5B_023":"EX5B 023", "EX5B_024":"EX5B 024", "EX5B_025":"EX5B 025", "EX5B_026":"EX5B 026", "EX5B_027":"EX5B 027", "EX5B_028":"EX5B 028", "EX5B_029":"EX5B 029", "EX5B_030":"EX5B 030", "EX5C_001":"EX5C 001", "EX5C_002":"EX5C 002", "EX5C_003":"EX5C 003", "EX5C_004":"EX5C 004", "EX5C_005":"EX5C 005", "EX5C_006":"EX5C 006", "EX5C_007":"EX5C 007", "EX5C_008":"EX5C 008", "EX5C_009":"EX5C 009", "EX5C_010":"EX5C 010", "EX5C_011":"EX5C 011", "EX5C_012":"EX5C 012", "EX5C_013":"EX5C 013", "EX5C_014":"EX5C 014", "EX5C_015":"EX5C 015", "EX5C_016":"EX5C 016", "EX5C_017":"EX5C 017", "EX5C_018":"EX5C 018", "EX5C_019":"EX5C 019", "EX5C_020":"EX5C 020", "EX5C_021":"EX5C 021", "EX5C_022":"EX5C 022", "EX5C_023":"EX5C 023", "EX5C_024":"EX5C 024", "EX5C_025":"EX5C 025", "EX5C_026":"EX5C 026", "EX5C_027":"EX5C 027", "EX5C_028":"EX5C 028", "EX5C_029":"EX5C 029", "EX5C_030":"EX5C 030", "EX5C_031":"EX5C 031", "EX5D_001":"EX5D 001", "EX5D_002":"EX5D 002", "EX5D_003":"EX5D 003", "EX5D_004":"EX5D 004", "EX5D_005":"EX5D 005", "EX5D_006":"EX5D 006", "EX5D_007":"EX5D 007", "EX5D_008":"EX5D 008", "EX5D_009":"EX5D 009", "EX5D_010":"EX5D 010", "EX5D_011":"EX5D 011", "EX5D_012":"EX5D 012", "EX5D_013":"EX5D 013", "EX5D_014":"EX5D 014", "EX5D_015":"EX5D 015", "EX5D_016":"EX5D 016", "EX5D_017":"EX5D 017", "EX5D_018":"EX5D 018", "EX5D_019":"EX5D 019", "EX5D_020":"EX5D 020", "EX5D_021":"EX5D 021", "EX5D_022":"EX5D 022", "EX5D_023":"EX5D 023", "EX5D_024":"EX5D 024"}},
      {id: "moog55", name: "Moog Modular 55",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "rim", "rim2", "rim3", "hh_closed", "hh_closed2", "hh_closed3", "hh_closed4", "BL1", "BL2", "PC1", "PC2", "ST1", "ST2", "ST3", "ST4"],
       files: {"kick":"BassDrum1", "kick2":"BassDrum10", "kick3":"BassDrum11", "kick4":"BassDrum12", "snare":"SnareDrum1", "snare2":"SnareDrum2", "snare3":"SnareDrum3", "snare4":"SnareDrum4", "rim":"RM1", "rim2":"RM2", "rim3":"RM3", "hh_closed":"HH1", "hh_closed2":"HH2", "hh_closed3":"HH3", "hh_closed4":"HH4", "BL1":"BL1", "BL2":"BL2", "PC1":"PC1", "PC2":"PC2", "ST1":"ST1", "ST2":"ST2", "ST3":"ST3", "ST4":"ST4"}},
      {id: "nordmodular", name: "Clavia Nord Modular",
       slots: ["kick", "kick2", "kick3", "kick4", "snare", "snare2", "snare3", "snare4", "clap", "rim", "hh_closed", "hh_open", "cowbell", "cowbell2", "ride", "ride2", "ride3", "Bell", "Block", "GatedRezBurst", "Hihat", "Hihat1", "Hihat2", "Hihat3", "Key", "Long_808ish", "Metal", "Noise", "NordCymb1", "NordCymb2", "NordCymb3", "NordCymb4", "NordCymb5", "NordPerc1", "NordPerc2", "NordPerc3", "NordPerc4", "NordPerc5", "NordPerc6", "NordTom1-1", "NordTom1-2", "NordTom1-3", "NordTom2-1", "NordTom2-2", "NordTom2-3", "NordTom3-1", "NordTom3-2", "NordTom3-3", "Perc2", "Perc3", "Perc4", "Stab", "Synth", "Tom"],
       files: {"kick":"Kick", "kick2":"Kick1", "kick3":"Kick2", "kick4":"Nord Descending Kick (ST)", "snare":"Nord Metalic Snare (ST)", "snare2":"Nord Noise Snare (ST)", "snare3":"NordSnare1", "snare4":"NordSnare2", "clap":"Clap", "rim":"Rim", "hh_closed":"Nord HH Closed (ST)", "hh_open":"Nord HH Open (ST)", "cowbell":"Perc1", "cowbell2":"Shaker", "ride":"Crash", "ride2":"Cymbal", "ride3":"Ride", "Bell":"Bell", "Block":"Block", "GatedRezBurst":"GatedRezBurst", "Hihat":"Hihat", "Hihat1":"Hihat1", "Hihat2":"Hihat2", "Hihat3":"Hihat3", "Key":"Key", "Long_808ish":"Long 808ish", "Metal":"Metal", "Noise":"Noise", "NordCymb1":"NordCymb1", "NordCymb2":"NordCymb2", "NordCymb3":"NordCymb3", "NordCymb4":"NordCymb4", "NordCymb5":"NordCymb5", "NordPerc1":"NordPerc1", "NordPerc2":"NordPerc2", "NordPerc3":"NordPerc3", "NordPerc4":"NordPerc4", "NordPerc5":"NordPerc5", "NordPerc6":"NordPerc6", "NordTom1-1":"NordTom1-1", "NordTom1-2":"NordTom1-2", "NordTom1-3":"NordTom1-3", "NordTom2-1":"NordTom2-1", "NordTom2-2":"NordTom2-2", "NordTom2-3":"NordTom2-3", "NordTom3-1":"NordTom3-1", "NordTom3-2":"NordTom3-2", "NordTom3-3":"NordTom3-3", "Perc2":"Perc2", "Perc3":"Perc3", "Perc4":"Perc4", "Stab":"Stab", "Synth":"Synth", "Tom":"Tom"}},
    ];
    const DRUM_SAMPLE_BASE = 'sounds/';

    // ── Lane building ──
    // Groups a kit's slots into logical lanes: max 2 per standard category,
    // each lane carrying a dropdown of all variants in that category.
    // All-mode kits (no standard-category slots) get up to 20 individual lanes.
    const LANE_CATS = ['kick','snare','clap','rim','hh_closed','hh_open','tom_hi','tom_low','cowbell','ride'];
    function _slotBaseCat(slot) {
      for (const c of LANE_CATS) {
        if (slot === c) return c;
        if (slot.startsWith(c) && /^\d+$/.test(slot.slice(c.length))) return c;
      }
      return null;
    }
    function buildLanes(kit) {
      const byCategory = {};
      let hasStd = false;
      for (const slot of kit.slots) {
        const cat = _slotBaseCat(slot);
        if (cat) { hasStd = true; (byCategory[cat] = byCategory[cat] || []).push(slot); }
      }
      if (hasStd) {
        // One lane per category — dropdown lets user pick among variants
        return LANE_CATS
          .filter(cat => byCategory[cat])
          .map(cat => ({id: cat, category: cat, selectedSlot: byCategory[cat][0], options: byCategory[cat]}));
      }
      // All-mode kit: each slot is its own lane, first 20
      return kit.slots.slice(0, 20).map(slot =>
        ({id: slot, category: slot, selectedSlot: slot, options: [slot]}));
    }

    class DrumMachine extends SynthInstrument {
      constructor(id, name, x, y) {
        super(id, name, x, y);
        this.synthType   = 'drums';
        this.name        = name || 'DRUMS';

        // Kit state
        this.kitId      = 'tr808';
        this.kitName    = 'Roland TR-808';
        this.lanes      = buildLanes(DRUM_KITS[0]);  // [{id, category, selectedSlot, options}]
        this.INSTRUMENTS = this.lanes.map(l => l.id); // lane IDs — backward-compat alias
        this.kitFiles    = DRUM_KITS[0].files || {};
        this._kitCache  = {};   // kitId → { slot: AudioBuffer, ... }
        this._kitLoading = false;
        this._pendingLaneSelections = null;  // applied by loadKit() on first load

        // Patterns: 0=off 1=soft 2=accent, up to 64 steps per lane ID
        this.numSteps = 16;
        this.patterns = {};
        this.pitches  = {};
        this.laneVols = {};  // per-lane volume, dB
        // Pre-init so drawDrumMiniGrid never hits undefined before loadKit() resolves
        for (const lane of this.lanes) {
          this.patterns[lane.id] = Array(64).fill(0);
          this.pitches[lane.id]  = 0;
          this.laneVols[lane.id] = 0;
        }

        // Playback
        this.isPlaying    = false;
        this.currentStep  = -1;
        this.gridSync     = true;
        this.subdiv       = '16n';
        this.rate         = 120;   // BPM when unsynced
        this._seq         = null;
        this._activeSrcs  = [];    // pending AudioBufferSourceNodes — cancelled on stop

        // Audio entry point: drum hits → _drumBus → pan → vol → fx
        this._drumBus = new Tone.Gain(1);
        this._drumBus.connect(this.pan);

        // Load default kit async
        this.loadKit('tr808');
      }

      // ── Kit loading ──
      async loadKit(kitId) {
        const kit = DRUM_KITS.find(k => k.id === kitId) || DRUM_KITS[0];
        kitId = kit.id;
        this._kitLoading = true;
        this._updateLoadStatus('Loading…');
        if (!this._kitCache[kitId]) this._kitCache[kitId] = {};
        const bufs = this._kitCache[kitId];
        // Snapshot all existing pattern/pitch/vol data — will be merged back after lane update
        const savedPatterns = Object.assign({}, this.patterns);
        const savedPitches  = Object.assign({}, this.pitches);
        const savedLaneVols = Object.assign({}, this.laneVols);
        // Only fetch slots that will actually be used in lanes
        const newLanes = buildLanes(kit);
        const neededSlots = [...new Set(newLanes.flatMap(l => l.options))];
        await Promise.all(neededSlots.map(async (slot) => {
          if (bufs[slot]) return;
          try {
            const ab   = await fetch(`${DRUM_SAMPLE_BASE}${kitId}/${slot}.wav`).then(r => r.arrayBuffer());
            bufs[slot] = await Tone.context.rawContext.decodeAudioData(ab);
          } catch(e) { console.warn(`DrumMachine: failed to load ${kitId}/${slot}`, e); }
        }));
        this.kitId    = kitId;
        this.kitName  = kit.name;
        this.kitFiles = kit.files || {};
        // Preserve existing lane selections when switching kits
        for (const lane of newLanes) {
          const prev = (this.lanes || []).find(l => l.id === lane.id);
          if (prev && lane.options.includes(prev.selectedSlot)) lane.selectedSlot = prev.selectedSlot;
        }
        // Apply pending lane selections (set by load/dup before first loadKit)
        if (this._pendingLaneSelections) {
          for (const lane of newLanes) {
            const sel = this._pendingLaneSelections[lane.id];
            if (sel && lane.options.includes(sel)) lane.selectedSlot = sel;
          }
          this._pendingLaneSelections = null;
        }
        this.lanes       = newLanes;
        this.INSTRUMENTS = this.lanes.map(l => l.id);
        // Restore all previously saved data (never lose patterns on kit switch),
        // then ensure every current lane ID has an entry
        Object.assign(this.patterns, savedPatterns);
        Object.assign(this.pitches,  savedPitches);
        Object.assign(this.laneVols, savedLaneVols);
        for (const lane of this.lanes) {
          if (!this.patterns[lane.id]) this.patterns[lane.id] = Array(64).fill(0);
          if (this.pitches[lane.id]  === undefined) this.pitches[lane.id] = 0;
          if (this.laneVols[lane.id] === undefined) this.laneVols[lane.id] = 0;
        }
        this._kitLoading = false;
        this._updateLoadStatus('');
      }

      _updateLoadStatus(msg) {
        const info = openCards.get(this.id);
        if (!info) return;
        const el = info.el.querySelector('.dm-kit-status');
        if (el) el.textContent = msg;
      }

      // ── Trigger one hit ──
      triggerInstrument(name, velocity, time) {
        const bufs = this._kitCache[this.kitId];
        if (!bufs) return;
        // Resolve which buffer to play via the lane's selected slot
        const lane = this.lanes?.find(l => l.id === name);
        const slot = lane ? lane.selectedSlot : name;
        if (!bufs[slot]) return;
        const ctx = Tone.context.rawContext;
        const at  = typeof time === 'number' ? time : ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer             = bufs[slot];
        src.playbackRate.value = Math.pow(2, (this.pitches[name] || 0) / 12);
        const hg = ctx.createGain();
        const velGain  = velocity === 1 ? 0.45 : 1.0;
        const laneGain = Math.pow(10, (this.laneVols[name] || 0) / 20);
        hg.gain.value  = velGain * laneGain;
        src.connect(hg);
        hg.connect(this._drumBus.input);
        this._activeSrcs.push(src);
        src.start(at);
        src.onended = () => {
          src.disconnect(); hg.disconnect();
          const i = this._activeSrcs.indexOf(src);
          if (i !== -1) this._activeSrcs.splice(i, 1);
        };
      }

      // ── Sequencer ──
      startSequencer() {
        if (this._seq) { try { this._seq.stop(); this._seq.dispose(); } catch(e){} this._seq = null; }
        const interval = this.gridSync ? this.subdiv : `${60 / (this.rate * 4)}s`;
        this._seq = new Tone.Sequence((time, step) => {
          this.currentStep = step;
          for (const name of this.INSTRUMENTS) {
            const vel = this.patterns[name][step];
            if (vel > 0) this.triggerInstrument(name, vel, time);
          }
        }, Array.from({length: this.numSteps}, (_, i) => i), interval);
        // Always start at transport position 0 so the sequence is phase-locked to the
        // transport origin. Tone.js fires events at 0, I, 2I, … so any currently-running
        // transport will pick up at the correct step for the current position, and the
        // sequence loops back to step 1 exactly when the next full cycle completes.
        this._seq.start(0);
        this.isPlaying = true;
      }

      stopSequencer() {
        if (this._seq) { try { this._seq.stop(); this._seq.dispose(); } catch(e){} this._seq = null; }
        // Cancel any hits that were pre-scheduled into the Web Audio lookahead buffer
        for (const src of this._activeSrcs) { try { src.stop(); } catch(e){} }
        this._activeSrcs  = [];
        this.isPlaying    = false;
        this.currentStep  = -1;
      }

      noteOn() {} noteOff() {} allNotesOff() {}

      dispose() {
        this.stopSequencer();
        if (this._drumBus) { try { this._drumBus.dispose(); } catch(e){} this._drumBus = null; }
        super.dispose();
      }
    }
