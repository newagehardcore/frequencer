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

    // ── Kit definitions (Shiny Drum Machine kits) ──
    const DRUM_KITS = [
      {id: 'R8',             name: 'Roland R-8'},
      {id: 'CR78',           name: 'Roland CR-78'},
      {id: 'KPR77',          name: 'Korg KPR-77'},
      {id: 'LINN',           name: 'LinnDrum'},
      {id: 'Kit3',           name: 'Kit 3'},
      {id: 'Kit8',           name: 'Kit 8'},
      {id: 'Techno',         name: 'Techno'},
      {id: 'Stark',          name: 'Stark'},
      {id: 'breakbeat8',     name: 'Breakbeat 8'},
      {id: 'breakbeat9',     name: 'Breakbeat 9'},
      {id: 'breakbeat13',    name: 'Breakbeat 13'},
      {id: 'acoustic-kit',   name: 'Acoustic Kit'},
      {id: '4OP-FM',         name: '4OP-FM'},
      {id: 'TheCheebacabra1',name: 'Cheebacabra 1'},
      {id: 'TheCheebacabra2',name: 'Cheebacabra 2'},
    ];
    const DRUM_SAMPLE_BASE = 'https://googlechromelabs.github.io/web-audio-samples/sounds/drum-samples/';
    const DRUM_INSTRUMENTS = ['Kick','Snare','HiHat','Tom1','Tom2','Tom3'];

    class DrumMachine extends SynthInstrument {
      constructor(id, name, x, y) {
        super(id, name, x, y);
        this.synthType   = 'drums';
        this.name        = name || 'DRUMS';
        this.INSTRUMENTS = DRUM_INSTRUMENTS;

        // Kit state
        this.kitId      = 'R8';
        this.kitName    = 'Roland R-8';
        this._kitCache  = {};   // kitId → { Kick: AudioBuffer, ... }
        this._kitLoading = false;

        // Patterns: 0=off 1=soft 2=accent, up to 64 steps × 6 lanes
        this.numSteps = 16;
        this.patterns = {};
        for (const n of this.INSTRUMENTS) this.patterns[n] = Array(64).fill(0);

        // Per-lane pitch in semitones (-12 to +12)
        this.pitches = {};
        for (const n of this.INSTRUMENTS) this.pitches[n] = 0;

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
        this.loadKit('R8');
      }

      // ── Kit loading ──
      async loadKit(kitId) {
        this._kitLoading = true;
        this._updateLoadStatus('Loading…');
        if (!this._kitCache[kitId]) this._kitCache[kitId] = {};
        const bufs = this._kitCache[kitId];
        await Promise.all(this.INSTRUMENTS.map(async (name) => {
          if (bufs[name]) return;
          try {
            const url = `${DRUM_SAMPLE_BASE}${kitId}/${name.toLowerCase()}.wav`;
            const res  = await fetch(url);
            const ab   = await res.arrayBuffer();
            bufs[name] = await Tone.context.rawContext.decodeAudioData(ab);
          } catch(e) { console.warn(`DrumMachine: failed to load ${kitId}/${name}`, e); }
        }));
        this.kitId      = kitId;
        this.kitName    = DRUM_KITS.find(k => k.id === kitId)?.name || kitId;
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
        if (!bufs || !bufs[name]) return;
        const ctx = Tone.context.rawContext;
        const at  = typeof time === 'number' ? time : ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer             = bufs[name];
        src.playbackRate.value = Math.pow(2, (this.pitches[name] || 0) / 12);
        const hg = ctx.createGain();
        hg.gain.value = velocity === 1 ? 0.45 : 1.0;
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
