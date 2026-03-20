    class Sample {
      constructor(id, name, rawBuf, x = 0, y = 0) {
        this.id = id;
        this.name = name;
        this.raw = rawBuf;
        this.duration = rawBuf.duration;
        this.peaks = null;

        this.x = x; this.y = y;
        this.color = nextColor();
        this.pitchST = 0;
        this.stretchST = 0;
        this.reversed = false;
        this._revBuf = null;
        this.loopStart = 0;  // normalized 0..1
        this.loopEnd = 1;
        this._origLoopEnd = 1;  // user's manually-set loop end (not modified by subdivision snapping)
        this.filePosition = 0; // normalized 0..1, initial playback start within loop
        this.muted = false;
        this.gridSync = false;
        this.subdiv = 'sample';
        this.subdivFactor = 1; // 1 = normal, 1.5 = dotted, 0.667 = triplet
        this.gridMulti = 1;   // 1 = every, 2 = every other, 3 = every 3rd
        this._nudgeMs = 0;    // timing offset in ms, applied to every grid fire (±150ms)

        this.attackTime = 0;    // seconds
        this.releaseTime = 0;   // seconds
        this.crossfadeTime = 0; // seconds
        this.clipGainDb = 0;    // clip gain in dB, -12..+12

        this.triggerMode = false; // one-shot on trigger, no auto-loop

        // Granular mode state
        this.granular    = false;
        this.grainPosition = 0.5;  // 0..1 within loop region
        this.grainSpread   = 0.3;  // 0..1 → scatter in seconds around position
        this.grainDensity  = 0.85; // 0..1 → grain trigger rate (0=sparse ~515ms, 1=dense ~15ms)
        this.grainAttack   = 0.1;  // 0..1 → grain attack (×0.4 s)
        this.grainRelease  = 0.4;  // 0..1 → grain release (×1.5 s)
        this.grainPitch    = 0;    // semitones, –24..+24
        this._gran         = null; // GranularEngine instance
        this._granGain     = null; // raw GainNode for output fade control
        this._granVoiceId  = null; // active voice ID

        this.playing = false;
        this._anchorAcTime = null; // AudioContext.currentTime tracking anchor
        this._anchorBufferPos = 0; // Absolute buffer seconds tracking anchor
        this._gridLoopBufDur = 0; // buffer-seconds per grid loop period (set by playGrid)
        this._gridNativeLoop = false; // true when player.loop=true is active (no envelope)
        this._gridEv = null;
        this._filePosTimer = null;
        this._pendingRestart = false; // set to restart on the next loop wrap boundary
        this._seqTrigVer = 0; // incremented on each seq trigger/stop to guard stale Draw callbacks
        this._lastStepVol = 1.0; // tracks last per-step volume for crossfade at trigger boundary
        this._currentDb = 0;
        this._currentPan = 0;

        // Audio chain: Player → fadeGain → PitchShift → EQ → Panner → Volume → [postFx] → _outputTap → masterSamplesGain
        this._outputTap = new Tone.Gain(1).connect(masterSamplesGain);
        this.vol = new Tone.Volume(0).connect(this._outputTap);
        this.meter = new Tone.Meter({ channels: 2, normalRange: false, smoothing: 0.85 });
        this.vol.connect(this.meter);
        this.pan = new Tone.Panner(0).connect(this.vol);

        // 5-band EQ: HP · Low bell · Mid bell · Hi bell · LP (always in chain, flat by default)
        this.eqBands = [
          { type: 'highpass', freq: 20, q: 0.707 },
          { type: 'peaking', freq: 200, gain: 0, q: 1 },
          { type: 'peaking', freq: 1000, gain: 0, q: 1 },
          { type: 'peaking', freq: 8000, gain: 0, q: 1 },
          { type: 'lowpass', freq: 22050, q: 0.707 },
        ];
        this.eqFilters = this.eqBands.map(b => {
          const f = new Tone.Filter({ type: b.type, frequency: b.freq, Q: b.q });
          if (b.type === 'peaking') f.gain.value = 0;
          return f;
        });
        for (let i = 3; i >= 0; i--) this.eqFilters[i].connect(this.eqFilters[i + 1]);
        this.ps = new Tone.PitchShift(0).connect(this.eqFilters[0]);

        // FX catalog (available types) + dynamic instance chain
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
        this.fxChain = []; // active instances: { uid, type, node, params }
        this._fxUidCounter = 0;
        this.rebuildFxChain();

        this.clipGain = new Tone.Gain(1).connect(this.ps);
        this.fadeGain = new Tone.Gain(1).connect(this.clipGain);
        this.player = new Tone.Player().connect(this.fadeGain);
        this._fadedBuf = null; // cached baked-fade buffer; null = needs rebuild
        this._xfTimeout = null;

        // ── PaulStretch state ──
        this.psStretch = 1;       // ratio (1 = off, >1 = time-stretch)
        this._psBuffer = null;    // stretched AudioBuffer (null until rendered)
        this._psWorker = null;    // in-progress render Worker
        this._psRendering = false;
        this._psPlayingBuffer = false; // true when player is running _psBuffer
        this._psBuildTimer = null;

        // ── Sync state ──
        this._syncActive = false;
        this._syncBpm = null;         // detected BPM of loop region
        this._syncMode = 'analog';    // 'analog' | 'digital'
        this._syncRate = 1;           // analog: projectBPM/syncBpm multiplier on playbackRate
        this._syncRateMult = 1;       // ×2 / ÷2 octave correction
        this._syncFftSize = 2048;     // digital: phase vocoder FFT window (512/2048/4096)
        this._syncSrcBuf = null;      // digital: original buffer before stretch (for re-sync)
        this._syncOrigLoopStart = 0;  // 0-1 loop bounds before sync (to restore on clear)
        this._syncOrigLoopEnd = 1;
        this._syncResyncTimer = null;
        this._onBpmChange = null;     // set by applySync(); called on project BPM change
        this._psFadedBuf = null;  // cached faded-loop buffer for PS mode (attack/release/xfade baked in)
        this._psSrcStart = 0;     // loopStart saved at render time (source region)
        this._psSrcEnd = 1;       // loopEnd saved at render time

        // Second player for crossfade overlap — both xfGain and fadeGain feed into this.ps
        this.xfGain = new Tone.Gain(0).connect(this.ps);
        this.xfPlayer = new Tone.Player().connect(this.xfGain);

        // Load buffer into both players
        if (typeof this.player.buffer.set === 'function') {
          this.player.buffer.set(rawBuf);
        } else {
          this.player.buffer._buffer = rawBuf;
        }
        if (typeof this.xfPlayer.buffer.set === 'function') {
          this.xfPlayer.buffer.set(rawBuf);
        } else {
          this.xfPlayer.buffer._buffer = rawBuf;
        }
        this.player.loop = false;
        this.xfPlayer.loop = false;
      }

      // ── Computed helpers ──
      get startSec() { return this.loopStart * this.duration; }
      get endSec() { return this.loopEnd * this.duration; }
      get lenSec() { return Math.max(1e-4, (this.loopEnd - this.loopStart) * this.duration); }
      get filePosSec() { return this.filePosition * this.duration; }
      get _srcBuf() { return this.reversed ? this._revBuf : this.raw; }
      get _revStart() { return this.reversed ? (this.duration - this.endSec) : this.startSec; }
      get _revEnd() { return this.reversed ? (this.duration - this.startSec) : this.endSec; }
      get _revFilePos() {
        const raw = this.reversed ? (this.duration - this.filePosSec) : this.filePosSec;
        return Math.max(0, Math.min(this._revEnd - 0.001, raw));
      }
      get _pbRate() { return Math.pow(2, this.stretchST / 12) * (this._syncRate || 1); }
      // Duration of the active buffer (PS buffer when PS is live, else raw source)
      get _activeDur() { return (this.psStretch > 1 && this._psBuffer) ? this._psBuffer.duration : this.duration; }

      updateVol() { this.vol.volume.value = this._effectiveDb(); }
      updatePan() { this.pan.pan.value = this._currentPan; }
      _effectiveDb() {
        if (this.muted) return -Infinity;
        if (soloId !== null && soloId !== this.id) return -Infinity;
        return this._currentDb;
      }

      setPitch(st) {
        this.pitchST = st;
        this.ps.pitch = st + globalTranspose;
      }

      setStretch(st) {
        this.stretchST = st;
        const rate = Math.pow(2, st / 12);
        this.player.playbackRate = rate;
        this.xfPlayer.playbackRate = rate;
      }

      setPsStretch(ratio) {
        this.psStretch = ratio;
        clearTimeout(this._psBuildTimer);
        if (ratio <= 1) {
          if (this._psWorker) { this._psWorker.terminate(); this._psWorker = null; }
          this._psRendering = false;
          this._psBuffer = null;
          this._psPlayingBuffer = false;
          this._psFadedBuf = null;
          this._hiPeaks = null;
          // Restore source loop bounds that were saved before the PS render
          this.loopStart = this._psSrcStart;
          this.loopEnd = this._psSrcEnd;
          this.filePosition = this._psSrcStart;
          this._fadedBuf = null;
          if (this.playing) this.play();
          refreshTileWave(this);
          // Refresh card sliders/waveform if open
          if (openCards.has(this.id)) {
            const info = openCards.get(this.id);
            if (typeof info._drawWave === 'function') info._drawWave();
          }
          return;
        }
        // debounce: wait 400ms after last slider move before rendering
        this._psBuildTimer = setTimeout(() => buildPsBuffer(this), 400);
      }

      setClipGain(db) {
        this.clipGainDb = Math.max(-12, Math.min(12, db));
        this.clipGain.gain.value = Math.pow(10, this.clipGainDb / 20);
      }

      setVolPos(db) {
        this._currentDb = Math.max(-60, Math.min(6, db));
        this.vol.volume.value = this._effectiveDb();
      }

      setPanPos(p) {
        this._currentPan = Math.max(-1, Math.min(1, p));
        this.pan.pan.value = this._currentPan;
      }

      _updateTilePos() {
        if (openCards.has(this.id)) return; // don't move physical tile while card is open
        const t = document.getElementById('t' + this.id);
        if (t && !t.classList.contains('dragging') && !t.classList.contains('expanded')) {
          t.style.left = (this.x - TW / 2) + 'px';
          t.style.top = (this.y - TH / 2) + 'px';
        }
      }

      setReverse(val) {
        this.reversed = val;
        this._fadedBuf = null;
        if (val && !this._revBuf) {
          const ctx = Tone.context.rawContext;
          const src = this.raw;
          const buf = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
          for (let c = 0; c < src.numberOfChannels; c++) {
            const srcData = src.getChannelData(c);
            const dstData = buf.getChannelData(c);
            const len = srcData.length;
            for (let i = 0; i < len; i++) dstData[i] = srcData[len - 1 - i];
          }
          this._revBuf = buf;
        }
        if (this.playing) {
          if (this.gridSync) { this._cancelGrid(); this._stopPlayer(); this.playGrid(); }
          else { this.play(); }
        }
      }

      // ── Granular mode (GranularEngine) ──
      setGranularMode(val) {
        if (this.granular === val) return;
        this.granular = val;
        this._fadedBuf = null;
        if (val) {
          if (this.reversed) this.reversed = false;
          this._cancelGrid();
          this.player.loop = false;
          this.xfPlayer.loop = false;
          this._stopPlayer();
          this._stopXfLoop();
          this._anchorAcTime = null; // hide regular playhead immediately
          try { this.player.disconnect(); } catch(e) {}
          try { this.xfPlayer.disconnect(); } catch(e) {}
          const ctx = Tone.context.rawContext;
          // Keep fadeGain at 0 — player is disconnected; this ensures zero bleed
          this.fadeGain.gain.cancelScheduledValues(ctx.currentTime);
          this.fadeGain.gain.setValueAtTime(0, ctx.currentTime);
          // Route granular signal directly into clipGain, bypassing fadeGain entirely
          this._granGain = ctx.createGain();
          this._granGain.gain.value = 0;
          const clipIn = this.clipGain.input || this.clipGain;
          try { this._granGain.connect(clipIn); } catch(e) {
            try { this._granGain.connect(this.clipGain); } catch(e2) {}
          }
          const buf = (this.psStretch > 1 && this._psBuffer) ? this._psBuffer : this.raw;
          this._gran = new GranularEngine({ audioContext: ctx });
          this._gran.setBuffer(buf);
          this._gran.connect(this._granGain);
          this._gran.set(this._granParams());
          if (this.playing) {
            this._granGain.gain.setValueAtTime(0, ctx.currentTime);
            this._granGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.12);
            this._granVoiceId = this._gran.startVoice({ position: this._granPos(), volume: 1 });
          }
        } else {
          this._granTeardown(this.playing ? 0.04 : 0);
          try { this.player.connect(this.fadeGain); } catch(e) {}
          try { this.xfPlayer.connect(this.xfGain); } catch(e) {}
          if (this.playing) {
            if (this.gridSync) { this._cancelGrid(); this.playGrid(); }
            else this.play();
          }
        }
        this._renderTile();
      }

      // 0-1 buffer position for the grain voice center
      _granPos() {
        return this.loopStart + (this.loopEnd - this.loopStart) * this.grainPosition;
      }

      // Spread in seconds: grainSpread fraction of loop span
      _granSpreadSec() {
        return (this.loopEnd - this.loopStart) * this._activeDur * this.grainSpread;
      }

      // Build params object for GranularEngine.set()
      _granParams() {
        return {
          spread: this._granSpreadSec(),
          density: this.grainDensity,
          envelope: { attack: this.grainAttack, release: this.grainRelease },
          pitch: Math.pow(2, this.grainPitch / 12)
        };
      }

      // Fade out and dispose — xfade=0 for immediate
      _granTeardown(xfade) {
        if (!this._gran) return;
        const ctx = Tone.context.rawContext;
        if (xfade > 0 && this._granGain) {
          const gg = this._granGain;
          gg.gain.cancelScheduledValues(ctx.currentTime);
          gg.gain.setValueAtTime(gg.gain.value, ctx.currentTime);
          gg.gain.linearRampToValueAtTime(0, ctx.currentTime + xfade);
          const g = this._gran;
          setTimeout(() => { try { g.dispose(); gg.disconnect(); } catch(e){} }, (xfade + 0.1) * 1000);
        } else {
          try { this._gran.dispose(); } catch(e) {}
          try { this._granGain && this._granGain.disconnect(); } catch(e) {}
        }
        this._gran = null;
        this._granGain = null;
        this._granVoiceId = null;
      }

      // Apply current params to running engine
      _granApply() {
        if (!this._gran) return;
        this._gran.set(this._granParams());
        if (this._granVoiceId != null)
          this._gran.updateVoice(this._granVoiceId, { position: this._granPos() });
      }

      setGrainPosition(v) { this.grainPosition = Math.max(0, Math.min(1, v)); this._granApply(); }
      setGrainSpread(v)   { this.grainSpread   = Math.max(0, Math.min(1, v)); this._granApply(); }
      setGrainDensity(v)  { this.grainDensity  = Math.max(0, Math.min(1, v)); this._granApply(); }
      setGrainAttack(v)   { this.grainAttack   = Math.max(0, Math.min(1, v)); this._granApply(); }
      setGrainRelease(v)  { this.grainRelease  = Math.max(0, Math.min(1, v)); this._granApply(); }
      setGrainPitch(v)    { this.grainPitch    = Math.max(-24, Math.min(24, v)); this._granApply(); }

      // ── Internal: stop the player node without changing state ──
      _stopPlayer() {
        const now = Tone.context.rawContext.currentTime;
        const fg = this.fadeGain.gain;
        fg.cancelScheduledValues(now);
        fg.setValueAtTime(fg.value, now);
        fg.linearRampToValueAtTime(0, now + DECLICK_S);
        try { this.player.stop(now + DECLICK_S); } catch (e) {
          try { this.player.stop(); } catch (e2) { }
        }
      }

      // ── Internal: cancel the two-player crossfade loop ──
      _stopXfLoop() {
        clearTimeout(this._xfTimeout);
        this._xfTimeout = null;
        try { this.xfPlayer.stop(); } catch (e) { }
        const now = Tone.context.rawContext.currentTime;
        this.xfGain.gain.cancelScheduledValues(now);
        this.xfGain.gain.setValueAtTime(0, now);
      }

      // ── Apply fade gain automation for grid one-shots ──
      _applyFadeGain(time, dur) {
        const atk = Math.min(this.attackTime, dur * 0.45);
        const rel = Math.min(this.releaseTime, dur * 0.45);
        const fg = this.fadeGain.gain;
        fg.cancelScheduledValues(time);
        if (atk > 0) {
          fg.setValueAtTime(0, time);
          fg.linearRampToValueAtTime(1, time + atk);
        } else {
          fg.setValueAtTime(0, time);
          fg.linearRampToValueAtTime(1, time + DECLICK_S);
        }
        if (rel > 0) {
          const rStart = time + Math.max(atk, dur - rel);
          fg.setValueAtTime(1, rStart);
          fg.linearRampToValueAtTime(0, time + dur);
        }
      }

      // ── Build a baked AudioBuffer with fades written into sample data ──
      // Fades are written directly into a copy of the loop region so that
      // native player.loop = true gives a perfectly seamless, click-free loop.
      _buildFadedLoopBuffer(overrideBuf, overrideStartSec, overrideEndSec) {
        const ctx = Tone.context.rawContext;
        const sr = ctx.sampleRate;
        const srcBuf = overrideBuf !== undefined ? overrideBuf : this._srcBuf;
        const startSec = overrideStartSec !== undefined ? overrideStartSec : this._revStart;
        const durSec = overrideEndSec !== undefined ? (overrideEndSec - overrideStartSec) : this.lenSec;
        const startSample = Math.round(startSec * sr);
        const loopLen = Math.round(durSec * sr);
        if (loopLen <= 0) return null;

        const nCh = srcBuf.numberOfChannels;
        const buf = ctx.createBuffer(nCh, loopLen, sr);
        const maxFade = Math.floor(loopLen * 0.45);
        const atkS = Math.min(Math.round(this.attackTime * sr), maxFade);
        const relS = Math.min(Math.round(this.releaseTime * sr), maxFade);
        // Crossfade is mutually exclusive with attack/release
        const xfdS = (atkS > 0 || relS > 0) ? 0
          : Math.min(Math.round(this.crossfadeTime * sr), maxFade);
        // Inaudible micro-fade (~1ms) at the loop boundary to eliminate the wrap-point
        // click without any perceptible silence — below the ~5ms auditory threshold.
        const microS = xfdS > 0
          ? Math.min(Math.round(sr * 0.001), Math.floor(loopLen * 0.005))
          : 0;

        for (let c = 0; c < nCh; c++) {
          const src = srcBuf.getChannelData(c);
          const dst = buf.getChannelData(c);
          for (let i = 0; i < loopLen; i++) dst[i] = src[startSample + i] || 0;

          // Crossfade: equal-power blend of tail (fading out) into head (fading in).
          // Only the tail region is modified; head stays as pure loop-start content.
          if (xfdS > 0) {
            const tailOff = loopLen - xfdS;
            for (let i = 0; i < xfdS; i++) {
              const t = i / xfdS;
              const tailGain = Math.cos(t * 0.5 * Math.PI); // 1 → 0
              const headGain = Math.sin(t * 0.5 * Math.PI); // 0 → 1
              dst[tailOff + i] = dst[tailOff + i] * tailGain + dst[i] * headGain;
            }
          }

          // Attack: explicit fade-in from silence
          if (atkS > 0) {
            for (let i = 0; i < atkS; i++) dst[i] *= i / atkS;
          }
          // Release: explicit fade-out to silence
          if (relS > 0) {
            for (let i = 0; i < relS; i++) dst[loopLen - 1 - i] *= i / relS;
          }

          // Micro-fade at wrap boundary: guarantees last ≈ first ≈ 0 so the
          // native loop wrap is click-free. 1ms is below auditory perception.
          if (microS > 0) {
            for (let i = 0; i < microS; i++) {
              dst[i] *= i / microS;
              dst[loopLen - 1 - i] *= i / microS;
            }
          }
        }
        return buf;
      }

      // ── True crossfade loop using two overlapping players ──
      // Player A plays the loop content. xfdTime before it ends, Player B starts
      // from the loop beginning and fades in (equal-power) while A fades out.
      // At the crossfade midpoint both are playing simultaneously — constant amplitude.
      // After the fade, A is stopped and B takes its role; the cycle repeats.
      _playCrossfadeLoop(startAt, overrideBuf, overrideLoopStart, overrideLoopEnd, overrideFilePosOffset) {
        const ctx = Tone.context.rawContext;
        const pbRate = this._pbRate;
        const srcBuf = overrideBuf !== undefined ? overrideBuf : this._srcBuf;
        const loopStart = overrideLoopStart !== undefined ? overrideLoopStart : this._revStart;
        const loopEnd = overrideLoopEnd !== undefined ? overrideLoopEnd : this._revEnd;
        const loopLen = (loopEnd - loopStart) / pbRate;
        const xfdTime = Math.min(this.crossfadeTime / pbRate, loopLen * 0.45);
        const startSec = loopStart;

        this._stopXfLoop();

        // Reload source buffer into both players (in case baked buf was previously in place)
        const setBuf = (pl) => {
          if (typeof pl.buffer.set === 'function') pl.buffer.set(srcBuf);
          else pl.buffer._buffer = srcBuf;
        };
        setBuf(this.player);
        setBuf(this.xfPlayer);
        this.player.loop = false;
        this.xfPlayer.loop = false;

        const now = startAt !== undefined ? startAt : ctx.currentTime + 0.005;
        const firstStartSec = overrideFilePosOffset !== undefined ? overrideFilePosOffset : this._revFilePos;

        // Reset gains: current=1, incoming=0
        this.fadeGain.gain.cancelScheduledValues(now);
        this.fadeGain.gain.setValueAtTime(1, now);
        this.xfGain.gain.cancelScheduledValues(now);
        this.xfGain.gain.setValueAtTime(0, now);

        // players[0]/gains[0] = currently audible, players[1]/gains[1] = next to fade in
        let players = [this.player, this.xfPlayer];
        let gains = [this.fadeGain, this.xfGain];

        // Start the first player from filePosition
        try { players[0].start(now, firstStartSec); } catch (e) { console.warn('xf start', e); }

        this._anchorAcTime = now;
        this._anchorBufferPos = firstStartSec;
        this.playing = true;
        this._renderTile();

        // Schedule the repeating crossfade
        // iterLen/iterXfd allow the first (potentially shorter) iteration to differ from subsequent ones
        const scheduleXf = (iterStartTime, iterLen, iterXfd) => {
          if (!this.playing) return;

          const xfStartTime = iterStartTime + iterLen - iterXfd;
          const xfEndTime = iterStartTime + iterLen;

          // Equal-power fade curves via N-step setValueAtTime
          const N = 32;
          for (let i = 0; i <= N; i++) {
            const t = i / N;
            const tAc = xfStartTime + t * iterXfd;
            gains[0].gain.setValueAtTime(Math.cos(t * 0.5 * Math.PI), tAc); // 1 → 0
            gains[1].gain.setValueAtTime(Math.sin(t * 0.5 * Math.PI), tAc); // 0 → 1
          }

          // Incoming player always starts from the loop start (not filePos)
          try { players[1].start(xfStartTime, startSec); } catch (e) { console.warn('xf incoming start', e); }

          // After fade completes: stop old player, swap roles, schedule next iteration
          const swapDelay = (xfEndTime - ctx.currentTime + 0.05) * 1000;
          this._xfTimeout = setTimeout(() => {
            if (!this.playing) return;

            // Gain is ~0 on players[0] — safe to stop silently
            try { players[0].stop(); } catch (e) { }
            gains[0].gain.cancelScheduledValues(ctx.currentTime);
            gains[0].gain.setValueAtTime(0, ctx.currentTime);

            // Swap: incoming becomes current, current becomes next incoming
            [players[0], players[1]] = [players[1], players[0]];
            [gains[0], gains[1]] = [gains[1], gains[0]];

            // Subsequent iterations use the full loop length
            scheduleXf(xfStartTime, loopLen, xfdTime);
          }, swapDelay);
        };

        // First iteration may be shorter if filePos is inside the loop
        const firstLen = (loopEnd - firstStartSec) / pbRate;
        const firstXfd = Math.min(xfdTime, firstLen * 0.45);
        scheduleXf(now, firstLen, firstXfd);
      }

      // ── Internal: cancel any pending grid schedule event ──
      _cancelGrid() {
        if (this._gridEv !== null) {
          try { Tone.Transport.clear(this._gridEv); } catch (e) { }
          this._gridEv = null;
        }
      }

      // ── Free-running loop (no grid) ──
      play() {
        ++this._seqTrigVer; // invalidate any pending seq Draw callbacks
        this._cancelGrid();
        this._stopPlayer();
        this._stopXfLoop();
        clearTimeout(this._filePosTimer);
        clearTimeout(this._granStopTimer);
        this._filePosTimer = null;
        this._pendingRestart = false;

        // ── Granular mode ──
        if (this.granular && this._gran) {
          const _fgCtx = Tone.context.rawContext;
          // Keep fadeGain at 0 — player is not connected in gran mode
          this.fadeGain.gain.cancelScheduledValues(_fgCtx.currentTime);
          this.fadeGain.gain.setValueAtTime(0, _fgCtx.currentTime);
          // Ramp up granGain
          if (this._granGain) {
            const _gg = this._granGain.gain;
            _gg.cancelScheduledValues(_fgCtx.currentTime);
            _gg.setValueAtTime(_gg.value, _fgCtx.currentTime);
            _gg.linearRampToValueAtTime(1, _fgCtx.currentTime + 0.08);
          }
          if (this._granVoiceId == null) {
            this._gran.set(this._granParams());
            this._granVoiceId = this._gran.startVoice({ position: this._granPos(), volume: 1 });
          } else {
            this._granApply();
          }
          this._anchorAcTime = null;
          this.playing = true;
          this._renderTile();
          return;
        }

        // ── PaulStretch mode: play the pre-rendered stretched buffer ──
        // loopStart/loopEnd and filePosition are all 0..1 relative to the PS buffer.
        if (this.psStretch > 1 && this._psBuffer && !this._psRendering) {
          const psBuf = this._psBuffer;
          const psDur = psBuf.duration;
          const psStart = this.loopStart * psDur;
          const psEnd = this.loopEnd * psDur;
          // filePosition is 0..1 of PS buffer; clamp into loop region
          const psOffset = Math.max(psStart, Math.min(psEnd - 0.001, this.filePosition * psDur));
          const startAt = Tone.context.rawContext.currentTime + 0.005;

          // True crossfade loop (two overlapping players)
          if (this.crossfadeTime > 0 && this.attackTime === 0 && this.releaseTime === 0) {
            this._playCrossfadeLoop(startAt, psBuf, psStart, psEnd, psOffset);
            this._psPlayingBuffer = true;
            return;
          }

          // Attack / Release — bake fades into a copy of the PS loop region
          const hasPsFades = this.attackTime > 0 || this.releaseTime > 0;
          if (hasPsFades) {
            if (!this._psFadedBuf) this._psFadedBuf = this._buildFadedLoopBuffer(psBuf, psStart, psEnd);
            const fb = this._psFadedBuf;
            if (fb) {
              if (typeof this.player.buffer.set === 'function') this.player.buffer.set(fb);
              else this.player.buffer._buffer = fb;
              this.player.loopStart = 0;
              this.player.loopEnd = fb.duration;
              this.player.loop = true;
              this.player.playbackRate = this._pbRate;
              const fileOffset = Math.max(0, Math.min(fb.duration - 0.001, psOffset - psStart));
              try {
                this.player.start(startAt, fileOffset);
                this._anchorAcTime = startAt;
                this._anchorBufferPos = psStart + fileOffset;
                this._psPlayingBuffer = true;
                this.playing = true;
              } catch (e) { console.warn('play() ps fades failed', e); }
              this._renderTile();
              return;
            }
          }

          // Plain loop (no fades / crossfade)
          if (typeof this.player.buffer.set === 'function') this.player.buffer.set(psBuf);
          else this.player.buffer._buffer = psBuf;
          this.player.loopStart = psStart;
          this.player.loopEnd = psEnd;
          this.player.loop = true;
          this.player.playbackRate = this._pbRate;
          this.fadeGain.gain.setValueAtTime(0, startAt);
          this.fadeGain.gain.linearRampToValueAtTime(1, startAt + DECLICK_S);
          try {
            this.player.start(startAt, psOffset);
            this._anchorAcTime = startAt;
            this._anchorBufferPos = psOffset;
            this._psPlayingBuffer = true;
            this.playing = true;
          } catch (e) { console.warn('play() ps failed', e); }
          this._renderTile();
          return;
        }
        this._psPlayingBuffer = false;

        // True crossfade: two overlapping players — only when no attack/release
        if (this.crossfadeTime > 0 && this.attackTime === 0 && this.releaseTime === 0) {
          this._playCrossfadeLoop();
          return;
        }

        const hasFades = this.attackTime > 0 || this.releaseTime > 0;
        const startAt = Tone.context.rawContext.currentTime + 0.005;
        // If filePosition is before loopStart, the initial pass plays pre-loop content —
        // we must use the source buffer directly so native loopStart acts as the wrap point.
        const filePosBeforeLoop = this._revFilePos < this._revStart;

        if (hasFades && !filePosBeforeLoop) {
          // Bake fades directly into a copy of the loop region buffer,
          // then use native player.loop = true for a perfectly seamless loop.
          if (!this._fadedBuf) this._fadedBuf = this._buildFadedLoopBuffer();
          const fb = this._fadedBuf;
          if (fb) {
            if (typeof this.player.buffer.set === 'function') {
              this.player.buffer.set(fb);
            } else {
              this.player.buffer._buffer = fb;
            }
            this.player.loopStart = 0;
            this.player.loopEnd = fb.duration;
            this.player.loop = true;
            const fileOffset = Math.max(0, Math.min(fb.duration - 0.001, this._revFilePos - this._revStart));
            try {
              this.player.start(startAt, fileOffset);
              this._anchorAcTime = startAt;
              this._anchorBufferPos = this._revStart + fileOffset;
              this.playing = true;
            } catch (e) { console.warn('play() failed', e); }
            this._renderTile();
            return;
          }
          // fallthrough to native loop if build failed
        }

        // Native loop with source buffer
        if (typeof this.player.buffer.set === 'function') {
          this.player.buffer.set(this._srcBuf);
        } else {
          this.player.buffer._buffer = this._srcBuf;
        }
        this.player.loopStart = this._revStart;
        this.player.loopEnd = this._revEnd;
        this.player.loop = true;
        this.fadeGain.gain.setValueAtTime(0, startAt);
        this.fadeGain.gain.linearRampToValueAtTime(1, startAt + DECLICK_S);
        try {
          this.player.start(startAt, this._revFilePos);
          this._anchorAcTime = startAt;
          this._anchorBufferPos = this._revFilePos;
          this.playing = true;
        } catch (e) { console.warn('play() failed', e); }
        this._renderTile();
      }

      // ── Grid-synced loop ──
      // Uses Tone.Transport.scheduleRepeat to fire precisely on grid boundaries.
      // Each fire: stop previous player, start new one-shot for min(loopLen, subdivSec).
      // 'wait' mode: sample plays once, then silence until next subdivision fires.
      // 'cut' mode: always cut to subdivSec length regardless of sample length.
      playGrid(continuePlayer = false) {
        ++this._seqTrigVer; // invalidate any pending seq Draw callbacks
        this._cancelGrid();
        if (!continuePlayer) {
          this._stopPlayer();
          this._stopXfLoop();
        }
        // Granular mode: use play() instead (no grid quantization for granular)
        if (this.granular && this._gran) { this.play(); return; }

        if (!continuePlayer) {
          // Bail early if there's no audio data to play (e.g. buffer still loading)
          if (!this._srcBuf) return;
          // Restore source buffer in case a faded buffer was previously loaded
          const setBuf = (pl) => {
            try {
              if (typeof pl.buffer.set === 'function') pl.buffer.set(this._srcBuf);
              else pl.buffer._buffer = this._srcBuf;
            } catch (e) { console.warn('playGrid: setBuf failed', e); }
          };
          setBuf(this.player);
          setBuf(this.xfPlayer);
        }
        this.player.loop = false;
        this.xfPlayer.loop = false;

        const ctx = Tone.context.rawContext;
        const bpm = Tone.Transport.bpm.value;
        const barSec = (60 / bpm) * 4;
        let subdivSec, quantizeSec, gridPeriod;
        if (this.subdiv === 'sample') {
          // Sample mode: snap gridPeriod to the nearest whole number of bars.
          // This keeps every repeat phase-locked to the bar grid (no drift).
          // The sample plays its natural length; any gap before the next bar is silence.
          const rawDur = Math.max(0.01, this.lenSec / this._pbRate);
          const nBars = Math.max(1, Math.ceil(rawDur / barSec));
          subdivSec = nBars * barSec;
          gridPeriod = subdivSec;
          quantizeSec = barSec;
        } else {
          subdivSec = (60 / bpm) * (4 / this.subdiv) * this.subdivFactor;
          gridPeriod = subdivSec * this.gridMulti;
          // Snap first fire to the smaller of barSec or gridPeriod.
          // This ensures: (a) for super-bar subdivisions (2.5 bars, 3 bars, etc.) the first
          // fire always lands on a bar boundary rather than a non-bar 2.5-bar boundary;
          // (b) for sub-bar subdivisions the snap is still to the subdivision boundary.
          quantizeSec = Math.min(barSec, gridPeriod);
        }
        this._loopLen = this.lenSec;

        // Compute the ABSOLUTE transport position of the next grid boundary.
        // Using absolute time (not '+relative') keeps samples phase-locked to
        // Tone.Sequence events (drum machine, metronome) which also fire at
        // absolute transport positions 0, period, 2*period, ...
        const transportPos = Tone.Transport.seconds;
        const nudgeSec = (this._nudgeMs || 0) * 0.001;
        const psLatencySec = this.ps.windowSize || 0.1;
        const secsSinceBeat = transportPos % quantizeSec;
        const prevBoundary = transportPos - secsSinceBeat;
        // Snap to current boundary if within 10ms, otherwise next boundary.
        const nextBoundary = (secsSinceBeat < 0.01 ? prevBoundary : prevBoundary + quantizeSec) + nudgeSec;
        // Apply PS latency compensation: schedule the player psLatencySec early so
        // audio emerges from the PitchShift chain exactly on the beat.
        // If compensation puts us in the past (e.g. transport just started, or triggered
        // within psLatencySec of a boundary), fire immediately — the first fire's audio
        // will emerge up to psLatencySec late, but every subsequent fire is bar-locked.
        let firstFireAt = nextBoundary - psLatencySec;
        if (firstFireAt <= transportPos) {
          firstFireAt = transportPos + 0.001;
        }

        if (this.crossfadeTime > 0 && this.attackTime === 0 && this.releaseTime === 0) {
          // Convert absolute transport position → audio context time for the crossfade path
          const timeFromNow = Math.max(0.003, firstFireAt - transportPos);
          this._playCrossfadeLoop(ctx.currentTime + timeFromNow);
          return;
        }

        // ── Non-crossfade grid mode (original scheduleRepeat approach) ──
        // Ensure Transport is running — play() is Transport-independent but
        // scheduleRepeat requires it. If the user stopped the transport while a
        // free-running sample was still playing, grid mode would register the
        // event but it would never fire.
        if (Tone.Transport.state !== 'started') Tone.Transport.start();

        // Buffer seconds that exactly fills one grid period at the current playback rate.
        // Tone.js Player.start duration = buffer seconds; real-time = bufSec / _pbRate.
        const periodBufDur = gridPeriod * this._pbRate;
        // Loop region: clamp to actual available buffer (in case _pbRate > 1 would exceed it).
        const loopBufDur = Math.min(Math.max(0.001, this._revEnd - this._revStart), periodBufDur);

        // Store for playheadPos() wrapping logic (set before fire() runs).
        this._gridLoopBufDur = loopBufDur;
        this._gridNativeLoop = !(this.attackTime > 0 || this.releaseTime > 0);

        // After the first fire the player runs via its own native loop (or one-shot repeat).
        // 'firstFirePending' tells fire() whether to set everything up or just refresh anchors.
        let firstFirePending = true;

        const fire = (time) => {
          const isFirst = firstFirePending;
          firstFirePending = false;

          const hasEnvelope = this.attackTime > 0 || this.releaseTime > 0;
          const fg = this.fadeGain.gain;

          if (isFirst) {
            // ── First fire: stop any previous player and start fresh ──
            try { this.player.stop(time); } catch (e) {}
            try { this.xfPlayer.stop(time); } catch (e) {}
            // Cancel any pending "stopped" state transitions in Tone.js Player's internal
            // timeline (e.g. from _stopPlayer() declick stops scheduled at now+5ms).
            // Without this, the declick-stop from a preceding stop()+playGrid() cycle
            // fires ~4ms after fire() starts the new playback, silently cutting it off.
            if (this.player._state?.cancel) this.player._state.cancel(time);
            if (this.xfPlayer._state?.cancel) this.xfPlayer._state.cancel(time);
            this.xfGain.gain.cancelScheduledValues(time);
            this.xfGain.gain.setValueAtTime(0, time);
            fg.cancelScheduledValues(time);

            if (!hasEnvelope) {
              // Native loop: WebAudio handles the loop splice at the sample level —
              // no ABSN stop/start at loop boundaries, no amplitude gap.
              this.player.loopStart = this._revStart;
              this.player.loopEnd   = this._revStart + loopBufDur;
              this.player.loop = true;
              // Brief declick only on first entry (cutting into audio from silence).
              fg.setValueAtTime(0, time);
              fg.linearRampToValueAtTime(1, time + DECLICK_S);
              try { this.player.start(time, this._revStart); } catch (e) { console.warn('Grid start failed', e); }
            } else {
              // Envelope mode: one-shot per grid period, full fade applied.
              const dur = Math.max(0.01, loopBufDur / this._pbRate);
              this._applyFadeGain(time, dur);
              this.player.loop = false;
              try { this.player.start(time, this._revStart, loopBufDur); } catch (e) { console.warn('Grid start failed', e); }
            }
          } else if (hasEnvelope) {
            // ── Loop-back, envelope mode: stop/restart without the declick ramp ──
            // (The declick ramp is only needed when starting from silence; seamless
            //  loop-backs have no discontinuity so no ramp is needed — it only causes
            //  a 5ms amplitude dropout that creates the audible "hiccup".)
            try { this.player.stop(time); } catch (e) {}
            try { this.xfPlayer.stop(time); } catch (e) {}
            this.xfGain.gain.cancelScheduledValues(time);
            this.xfGain.gain.setValueAtTime(0, time);
            fg.cancelScheduledValues(time);
            const dur = Math.max(0.01, loopBufDur / this._pbRate);
            // Apply release fade if set; no attack/declick ramp for loop-backs.
            fg.setValueAtTime(1, time);
            if (this.releaseTime > 0) {
              const rel = Math.min(this.releaseTime, dur * 0.45);
              const rStart = time + Math.max(0, dur - rel);
              fg.setValueAtTime(1, rStart);
              fg.linearRampToValueAtTime(0, time + dur);
            }
            this.player.loop = false;
            try { this.player.start(time, this._revStart, loopBufDur); } catch (e) { console.warn('Grid start failed', e); }
          }
          // else: no-envelope loop-back — native loop is running, nothing to do for audio.

          // Always update the visual playhead anchor so the waveform display resets.
          Tone.Draw.schedule(() => {
            this._anchorAcTime = time;
            this._anchorBufferPos = this._revStart;
          }, time);
        };

        this._gridEv = Tone.Transport.scheduleRepeat(fire, gridPeriod, firstFireAt);
        this.playing = true;
        this._renderTile();
      }

      stop() {
        ++this._seqTrigVer; // invalidate any pending seq Draw callbacks
        this._cancelGrid();
        this._stopPlayer();
        this._stopXfLoop();
        if (this._gran && this._granGain) {
          const now = Tone.context.rawContext.currentTime;
          const _gg = this._granGain.gain;
          _gg.cancelScheduledValues(now);
          _gg.setValueAtTime(_gg.value, now);
          _gg.linearRampToValueAtTime(0, now + 0.04);
          const _vid = this._granVoiceId, _g = this._gran;
          setTimeout(() => { try { if (_vid != null) _g.stopVoice(_vid); } catch(e){} }, 80);
          this._granVoiceId = null;
        }
        clearTimeout(this._filePosTimer);
        this._filePosTimer = null;
        this._pendingRestart = false;
        this.playing = false;
        this._anchorAcTime = null;
        this._renderTile();
      }

      // ── Step-sequencer trigger: start a one-shot at AudioContext time `acTime` ──
      // Handles PS / faded / native buffers correctly and updates playhead state.
      // Returns the natural play duration in seconds.
      // gateLength: 0..1 fraction of loop region to play; null or 1 = play until next trigger.
      triggerAtTime(acTime, gateLength = null, stepVolume = 1.0, stepPitch = 0) {
        const pitchRatio = stepPitch !== 0 ? Math.pow(2, stepPitch / 12) : 1;
        ++this._seqTrigVer;
        const ver = this._seqTrigVer;

        // Stop anything currently playing
        try { this.player.stop(acTime); } catch (e) { }
        try { this.xfPlayer.stop(acTime); } catch (e) { }

        // Crossfade at trigger boundary: ramp out old note, ramp in new note
        const vol = Math.max(0, Math.min(1, stepVolume));
        const fg = this.fadeGain.gain;
        this.xfGain.gain.cancelScheduledValues(acTime - DECLICK_S);
        this.xfGain.gain.setValueAtTime(0, acTime);
        fg.cancelScheduledValues(acTime - DECLICK_S);
        fg.setValueAtTime(this._lastStepVol, acTime - DECLICK_S);
        fg.linearRampToValueAtTime(0, acTime);
        fg.setValueAtTime(0, acTime);
        fg.linearRampToValueAtTime(vol, acTime + DECLICK_S);
        this._lastStepVol = vol;

        let playDur;

        let anchorPos; // buffer position (seconds) where playback actually starts — used for playhead

        if (this.psStretch > 1 && this._psBuffer && !this._psRendering) {
          // ── PaulStretch one-shot ──
          const psBuf = this._psBuffer;
          const psStart = this.loopStart * psBuf.duration;
          const psEnd = this.loopEnd * psBuf.duration;
          const psDur = psEnd - psStart;
          const psRate = this._pbRate * pitchRatio;
          playDur = psDur / psRate;
          // Start from filePosition within the PS loop (clamped to loop bounds)
          const psFilePos = Math.max(psStart, Math.min(psEnd - 0.001, this.filePosition * psBuf.duration));
          anchorPos = psFilePos;
          const hasFades = this.attackTime > 0 || this.releaseTime > 0;
          let buf = psBuf, offset = psFilePos;
          if (hasFades) {
            if (!this._psFadedBuf) this._psFadedBuf = this._buildFadedLoopBuffer(psBuf, psStart, psEnd);
            if (this._psFadedBuf) {
              buf = this._psFadedBuf;
              offset = Math.max(0, Math.min(this._psFadedBuf.duration - 0.001, psFilePos - psStart));
            }
          }
          if (typeof this.player.buffer.set === 'function') this.player.buffer.set(buf);
          else this.player.buffer._buffer = buf;
          this.player.loop = false;
          this.player.playbackRate = psRate;
          try { this.player.start(acTime, offset, playDur); } catch (e) { }
          this._psPlayingBuffer = true;
        } else {
          // ── Normal one-shot ──
          this._psPlayingBuffer = false;
          const startPos = this._revFilePos; // trigger from filePosition, not loop start
          anchorPos = startPos;
          const endPos = this._revEnd;
          const rawDur = endPos - startPos;
          const stepRate = this._pbRate * pitchRatio;
          playDur = rawDur / stepRate;
          let fadedOk = false;
          if (this.attackTime > 0 || this.releaseTime > 0) {
            if (!this._fadedBuf) this._fadedBuf = this._buildFadedLoopBuffer();
            if (this._fadedBuf) {
              const fb = this._fadedBuf;
              if (typeof this.player.buffer.set === 'function') this.player.buffer.set(fb);
              else this.player.buffer._buffer = fb;
              this.player.loop = false;
              this.player.playbackRate = stepRate;
              const fbOffset = Math.max(0, Math.min(fb.duration - 0.001, startPos - this._revStart));
              playDur = (fb.duration - fbOffset) / stepRate;
              try { this.player.start(acTime, fbOffset, playDur); } catch (e) { }
              fadedOk = true;
            }
          }
          if (!fadedOk) {
            if (typeof this.player.buffer.set === 'function') this.player.buffer.set(this._srcBuf);
            else this.player.buffer._buffer = this._srcBuf;
            this.player.loop = false;
            this.player.playbackRate = stepRate;
            try { this.player.start(acTime, startPos, playDur); } catch (e) { }
          }
        }

        // Gate: fraction of loop region to play.
        // PS mode: gate is relative to the stretched buffer duration (not the source lenSec).
        const loopRealSec = (this.psStretch > 1 && this._psBuffer && this._psPlayingBuffer)
          ? (this.loopEnd - this.loopStart) * this._psBuffer.duration / (this._pbRate * pitchRatio)
          : this.lenSec / (this._pbRate * pitchRatio);
        const gateDur = loopRealSec * (gateLength ?? 1);
        const stopAt = acTime + gateDur;
        try { this.player.stop(stopAt); } catch (e) { }
        try { this.xfPlayer.stop(stopAt); } catch (e) { }

        // Update playhead on trigger (skip if play()/stop() has since been called)
        Tone.Draw.schedule(() => {
          if (this._seqTrigVer !== ver) return;
          this._anchorAcTime = acTime;
          this._anchorBufferPos = anchorPos; // actual start position in buffer seconds
          this.playing = true;
          this._renderTile();
        }, acTime);

        // Update playhead on stop
        Tone.Draw.schedule(() => {
          if (this._seqTrigVer !== ver) return;
          this.playing = false;
          this._anchorAcTime = null;
          this._renderTile();
        }, stopAt);

        return playDur;
      }

      // ── Step-sequencer stop: cut playback at AudioContext time `acTime` ──
      stopAtTime(acTime) {
        ++this._seqTrigVer;
        const ver = this._seqTrigVer;
        try { this.player.stop(acTime); } catch (e) { }
        try { this.xfPlayer.stop(acTime); } catch (e) { }
        this.fadeGain.gain.cancelScheduledValues(acTime);
        this.fadeGain.gain.setValueAtTime(1, acTime);
        Tone.Draw.schedule(() => {
          if (this._seqTrigVer !== ver) return;
          this.playing = false;
          this._anchorAcTime = null;
          this._renderTile();
        }, acTime);
      }

      updateBufferAnchor() {
        if (!this.playing || this._anchorAcTime === null) return;
        // Grid mode: fire() resets the anchor authoritatively via Tone.Draw.schedule — don't clobber it.
        // Exception: PS mode uses player.loop=true (no fire()), so always needs anchor tracking.
        const isPS = this.psStretch > 1 && this._psBuffer && this._psPlayingBuffer;
        if (!isPS && this.gridSync && this._xfTimeout === null) return;
        const acNow = Tone.context.rawContext.currentTime;
        let elapsed = acNow - this._anchorAcTime;
        if (elapsed <= 0) return;

        let pos = this._anchorBufferPos + elapsed * this._pbRate;
        if (this.psStretch > 1 && this._psBuffer && this._psPlayingBuffer) {
          const psStart = this.loopStart * this._psBuffer.duration;
          const psEnd = this.loopEnd * this._psBuffer.duration;
          const psLen = Math.max(0.001, psEnd - psStart);
          if (pos >= psEnd) pos = psStart + ((pos - psStart) % psLen);
        } else {
          if (pos >= this._revEnd) pos = this._revStart + ((pos - this._revStart) % this.lenSec);
        }
        this._anchorAcTime = acNow;
        this._anchorBufferPos = pos;
      }

      playheadPos() {
        if (!this.playing || this._anchorAcTime === null) return null;
        const acNow = Tone.context.rawContext.currentTime;
        let elapsed = Math.max(0, acNow - this._anchorAcTime);
        // ── PaulStretch mode playhead ──
        if (this.psStretch > 1 && this._psBuffer && this._psPlayingBuffer) {
          const psDur = this._psBuffer.duration;
          const psStart = this.loopStart * psDur;
          const psEnd = this.loopEnd * psDur;
          const psLen = Math.max(0.001, psEnd - psStart);
          let pos = this._anchorBufferPos + elapsed * this._pbRate;
          if (pos >= psEnd) {
            pos = psStart + ((pos - psStart) % psLen);
            this._anchorAcTime = acNow;
            this._anchorBufferPos = pos;
          }
          // Return 0..1 within the loop region (same contract as normal mode)
          return Math.max(0, Math.min(1, (pos - psStart) / psLen));
        }

        let pos = this._anchorBufferPos + elapsed * this._pbRate;
        const rStart = this._revStart, rEnd = this._revEnd;

        if (this.gridSync && this._xfTimeout === null) {
          if (this._gridNativeLoop && this._gridLoopBufDur > 0) {
            // Native loop (player.loop=true, no envelope): WebAudio handles the splice
            // sample-accurately. Wrap elapsed buffer position modulo the loop length so
            // the playhead stays smooth even during the Tone.Draw race window (~scheduleAheadTime).
            const rawBuf = (elapsed * this._pbRate) % this._gridLoopBufDur;
            const fwd = Math.max(0, Math.min(1, rawBuf / this.lenSec));
            return this.reversed ? 1 - fwd : fwd;
          }
          // Envelope mode: player stops/restarts each period — clamp to prevent overshoot.
          const startPos = this._anchorBufferPos; // = _revStart captured via Tone.Draw.schedule
          const gridDur = Math.max(0.01, this.lenSec / this._pbRate);
          const seg1Dur = Math.max(0.001, (rEnd - startPos) / this._pbRate);
          const t = Math.min(elapsed, gridDur);
          let visPos;
          if (t <= seg1Dur) {
            visPos = Math.min(startPos + t * this._pbRate, rEnd);
          } else {
            visPos = rStart + (t - seg1Dur) * this._pbRate;
            visPos = Math.min(visPos, rEnd);
          }
          const fwd = Math.max(0, Math.min(1, (visPos - rStart) / this.lenSec));
          return this.reversed ? 1 - fwd : fwd;
        }

        if (pos >= rEnd) {
          let over = pos - rStart;
          if (over >= 0 && this.lenSec > 0) {
            pos = rStart + (over % this.lenSec);
            this._anchorAcTime = acNow;
            this._anchorBufferPos = pos;
          }
          // Loop boundary crossed — fire any pending restart now
          if (this._pendingRestart) {
            this._pendingRestart = false;
            clearTimeout(this._filePosTimer);
            this._filePosTimer = null;
            this.play();
          }
        }
        const fwd = Math.max(0, Math.min(1, (pos - rStart) / this.lenSec));
        return this.reversed ? 1 - fwd : fwd;
      }

      // Automatically syncs WebAudio loop nodes & visually correct relative playhead phase without jumping
      setLoopBounds(start, end) {
        this.updateBufferAnchor();
        const oldStart = this.loopStart;
        this.loopStart = start;
        this.loopEnd = end;

        // ── PS-live mode: loop handles operate on the stretched buffer ──
        // No re-render — just move the playback loop window within the PS buffer.
        if (this.psStretch > 1 && this._psBuffer && !this._psRendering) {
          const psDur = this._psBuffer.duration;
          if (this.filePosition > end) this.filePosition = Math.max(start, end - 0.001 / Math.max(0.001, psDur));
          if (this.filePosition < start) this.filePosition = start;
          this._psFadedBuf = null; // loop region changed — rebuild faded buffer on next play
          if (!this.playing) return;
          if (this.gridSync) {
            this._cancelGrid();
            this._stopPlayer();
            this.play(); // playGrid() would restore the source buffer, breaking PS mode
          } else {
            this.filePosition = start;
            this.play();
          }
          return;
        }

        // ── Normal / rendering mode: source region changed ──
        this._fadedBuf = null;
        this._psFadedBuf = null;
        // Invalidate PS buffer — source loop region changed, must re-render
        if (this._psWorker) { this._psWorker.terminate(); this._psWorker = null; }
        this._psRendering = false;
        this._psBuffer = null;
        this._psPlayingBuffer = false;
        this._hiPeaks = null;
        if (this.psStretch > 1) {
          clearTimeout(this._psBuildTimer);
          this._psBuildTimer = setTimeout(() => buildPsBuffer(this), 600);
        }

        // Only clamp filePosition at the upper end (it can be below loopStart for pre-loop playthrough)
        if (this.filePosition >= end) this.filePosition = Math.max(0, end - 0.001 / Math.max(0.001, this.duration));

        // Clamp filePosition to the new bounds (preserve custom filePos within region)
        if (this.filePosition < start) this.filePosition = start;

        if (!this.playing) return;

        // Granular: update position/spread to reflect new loop bounds — no restart
        if (this.granular && this._gran) {
          this._granApply();
          return;
        }

        if (this.gridSync) {
          this._cancelGrid();
          this._stopPlayer();
          this.playGrid();
        } else {
          this.play();
        }
      }

      // Set file position (normalized 0..1), immediately restarting from the new position
      setFilePosition(norm) {
        clearTimeout(this._filePosTimer);
        this._filePosTimer = null;
        this._pendingRestart = false;
        this.filePosition = Math.max(0, Math.min(this.loopEnd - 0.001 / Math.max(0.001, this.duration), norm));
        if (!this.playing) return;
        if (this.gridSync) return; // fire() reads _revFilePos fresh each tick — no restart needed
        if (this.granular) return; // granular engine manages position via grainPosition param
        this.play();
      }

      dispose() {
        this.stop();
        this._granTeardown(0);
        setTimeout(() => {
          try { this.player.dispose(); } catch (e) { }
          try { this.xfPlayer.dispose(); } catch (e) { }
          try { this.fadeGain.dispose(); } catch (e) { }
          try { this.clipGain.dispose(); } catch (e) { }
          try { this.xfGain.dispose(); } catch (e) { }
          try { this.ps.dispose(); } catch (e) { }
          if (this.eqFilters) this.eqFilters.forEach(f => { try { f.dispose(); } catch (e) { } });
          try { this.pan.dispose(); } catch (e) { }
          try { this.vol.dispose(); } catch (e) { }
          try { this._outputTap.dispose(); } catch (e) { }
          try { this.meter.dispose(); } catch (e) { }
        }, 300);
      }

      computePeaks(bins) {
        const ch = this.raw.getChannelData(0);
        const bsz = Math.max(1, Math.floor(ch.length / bins));
        const p = new Float32Array(bins);
        for (let i = 0; i < bins; i++) {
          let mx = 0, off = i * bsz;
          for (let j = 0; j < bsz; j++) {
            const v = Math.abs(ch[off + j] || 0);
            if (v > mx) mx = v;
          }
          p[i] = mx;
        }
        this.peaks = p;
        return p;
      }

      getHiResPeaks() {
        if (this._hiPeaks) return this._hiPeaks;
        const bins = 8192;
        const buf = (this.psStretch > 1 && this._psBuffer) ? this._psBuffer : this.raw;
        const ch = buf.getChannelData(0);
        const bsz = Math.max(1, Math.floor(ch.length / bins));
        const p = new Float32Array(bins);
        for (let i = 0; i < bins; i++) {
          let mx = 0, off = i * bsz;
          for (let j = 0; j < bsz; j++) {
            const v = Math.abs(ch[off + j] || 0);
            if (v > mx) mx = v;
          }
          p[i] = mx;
        }
        this._hiPeaks = p;
        return p;
      }

      applyEqBand(i) {
        const f = this.eqFilters[i], b = this.eqBands[i];
        f.frequency.value = b.freq;
        f.Q.value = b.q;
        if (b.type === 'peaking') f.gain.value = b.gain || 0;
      }

      rebuildFxChain() {
        try { this.eqFilters[4].disconnect(); } catch (e) { }
        try { this.pan.disconnect(); } catch (e) { }
        try { this.vol.disconnect(); } catch (e) { }
        try { this._outputTap.disconnect(); } catch (e) { }
        for (const inst of this.fxChain) {
          try { (inst.outputNode || inst.node).disconnect(); } catch (e) { }
        }
        const preFx = this.fxChain.filter(i => !i.postFader);
        const postFx = this.fxChain.filter(i => i.postFader);
        let prev = this.eqFilters[4];
        for (const inst of preFx) {
          if (!inst.node) continue;
          prev.connect(inst.node);
          prev = inst.outputNode || inst.node;
        }
        prev.connect(this.pan);
        this.pan.connect(this.vol);
        prev = this.vol;
        for (const inst of postFx) {
          if (!inst.node) continue;
          prev.connect(inst.node);
          prev = inst.outputNode || inst.node;
        }
        prev.connect(this._outputTap);
        this._outputTap.connect(masterSamplesGain);
        this.vol.connect(this.meter);
      }

      _fxDefaultParams(type) {
        const d = {
          reverb: { decay: 2.5, preDelay: 0.01, wet: 0.4 },
          delay: { delayTime: 0.25, feedback: 0.35, wet: 0.4 },
          tremolo: { frequency: 4, depth: 0.7, wet: 1 },
          dist: { distortion: 0.4, wet: 0.8 },
          chorus: { frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0.5 },
          phaser: { frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0.6 },
          bitcrush: { bits: 8, wet: 0.8 },
        };
        return { ...(d[type] || {}) };
      }

      _createFxNode(type, params) {
        switch (type) {
          case 'reverb': return new Tone.Reverb({ decay: params.decay, preDelay: params.preDelay, wet: params.wet });
          case 'delay': return new Tone.FeedbackDelay({ delayTime: params.delayTime, feedback: params.feedback, wet: params.wet });
          case 'tremolo': return new Tone.Tremolo({ frequency: params.frequency, depth: params.depth, wet: params.wet }).start();
          case 'dist': return new Tone.Distortion({ distortion: params.distortion, wet: params.wet });
          case 'chorus': return new Tone.Chorus({ frequency: params.frequency, delayTime: params.delayTime, depth: params.depth, wet: params.wet }).start();
          case 'phaser': return new Tone.Phaser({ frequency: params.frequency, octaves: params.octaves, baseFrequency: params.baseFrequency, wet: params.wet });
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
          for (const f of inst.eqData.filters) { try { f.disconnect(); f.dispose(); } catch (e) { } }
        } else {
          try { inst.node.disconnect(); } catch (e) { }
          try { inst.node.dispose(); } catch (e) { }
        }
        this.fxChain.splice(idx, 1);
        this.rebuildFxChain();
      }

      _renderTile() {
        const tile = document.getElementById('t' + this.id);
        if (!tile) return;
        tile.style.setProperty('--card-color', this.color);
        tile.classList.toggle('playing', this.playing);
        tile.classList.toggle('muted', this.muted);
        tile.classList.toggle('grid-on', this.gridSync);
        tile.classList.toggle('gran-on', this.granular);

        const mbtn = tile.querySelector('.tile-mbtn');
        if (mbtn) mbtn.classList.toggle('mute-on', this.muted);

        if (openCards.has(this.id)) {
          const card = openCards.get(this.id).el;
          const cardM = card.querySelector('.card-mute-btn');
          if (cardM) cardM.classList.toggle('mute-on', this.muted);
        }

        tile.style.borderColor = '';
        refreshSoloVis();
      }
    }

