    // ════════════════════════════════════════════════════
    // TRANSPORT
    // ════════════════════════════════════════════════════
    let metroPart = null;
    let beatRaf;

    Tone.Transport.bpm.value = 120;

    document.getElementById('btn-play').addEventListener('click', async () => {
      await ensureAudio();
      isPlaying ? stopAll() : playAll();
    });
    document.getElementById('btn-stop').addEventListener('click', async () => {
      await ensureAudio();
      stopAll();
    });
    document.getElementById('btn-trans-dn').addEventListener('click', () => applyGlobalTranspose(globalTranspose - 1));
    document.getElementById('btn-trans-up').addEventListener('click', () => applyGlobalTranspose(globalTranspose + 1));
    document.getElementById('trans-val').addEventListener('click', () => {
      const v = prompt('Transpose (semitones, −24 to +24):', globalTranspose);
      if (v !== null && !isNaN(parseInt(v))) applyGlobalTranspose(parseInt(v));
    });

    function playAll() {
      isPlaying = true;
      document.getElementById('btn-play').classList.add('playing');
      for (const [, lfo] of lfos) lfo.resetPhase();
      // Register sample grids FIRST while transport is still at position 0.
      // playGrid() detects Transport.state !== 'started' and schedules
      // the first fire at transport time 0.001 (bar 1, cold-start path).
      // Starting transport after ensures drums/riffs/metro start with the
      // clock already running.
      for (const [, s] of samples) {
        if (s instanceof Sample && !s.playing) {
          try { startSample(s); } catch (e) { console.warn('startSample failed:', s.id, e); }
        }
      }
      Tone.Transport.start();
      for (const [, riff] of riffs) riff.reschedule();
      for (const [, ch] of chords) if (ch instanceof ChordsSequencer) ch.reschedule();
      for (const [, drum] of drums) {
        if (drum instanceof DrumMachine) {
          drum.startSequencer();
          const cardInfo = openCards.get(drum.id);
          if (cardInfo) {
            cardInfo.el.querySelector('.dm-play-btn')?.classList.add('dm-playing');
            const btn = cardInfo.el.querySelector('.dm-play-btn');
            if (btn) btn.innerHTML = '&#x25A0;';
          }
        }
      }
      buildMetro(); // always build for beat-flash; audio gated by metroOn flag
      beatTick();
    }

    function pauseAll() {
      isPlaying = false;
      document.getElementById('btn-play').classList.remove('playing');
      Tone.Transport.pause();
      for (const [, s] of samples) if (s instanceof Sample) s.stop();
      for (const [, drum] of drums) {
        if (drum instanceof DrumMachine) {
          drum.stopSequencer();
          const cardInfo = openCards.get(drum.id);
          if (cardInfo) {
            cardInfo.el.querySelector('.dm-play-btn')?.classList.remove('dm-playing');
            const btn = cardInfo.el.querySelector('.dm-play-btn');
            if (btn) btn.innerHTML = '&#x25B6;';
          }
        }
      }
    }

    function stopAll() {
      isPlaying = false;
      document.getElementById('btn-play').classList.remove('playing');
      Tone.Transport.stop();
      Tone.Transport.position = 0;
      for (const [, lfo] of lfos) lfo.resetPhase();
      for (const [, s] of samples) if (s instanceof Sample) s.stop();
      for (const [, riff] of riffs) riff.unschedule();
      for (const [, ch] of chords) if (ch instanceof ChordsSequencer) ch.unschedule();
      for (const [, drum] of drums) {
        if (drum instanceof DrumMachine) {
          drum.stopSequencer();
          const cardInfo = openCards.get(drum.id);
          if (cardInfo) {
            cardInfo.el.querySelector('.dm-play-btn')?.classList.remove('dm-playing');
            const btn = cardInfo.el.querySelector('.dm-play-btn');
            if (btn) btn.innerHTML = '&#x25B6;';
          }
        }
      }
      // beat-pos removed
      cancelAnimationFrame(beatRaf);
    }

    function applyGlobalTranspose(st) {
      globalTranspose = Math.max(-24, Math.min(24, st));

      // Update footer display
      const transVal = document.getElementById('trans-val');
      if (transVal) transVal.textContent = (globalTranspose >= 0 ? '+' : '') + globalTranspose;

      // Samples: re-apply pitch with new offset
      for (const [, s] of samples) if (s instanceof Sample) s.setPitch(s.pitchST);

      // Riffs: update root dropdown in open cards + keyboard highlight
      for (const [, riff] of riffs) {
        const cardInfo = openCards.get(riff.id);
        if (!cardInfo) continue;
        const sel = cardInfo.el.querySelector('.riff-root-sel');
        if (sel) sel.value = transposeRoot(riff.scaleRoot, globalTranspose);
        const kbdEl = cardInfo.el.querySelector('.synth-keyboard');
        if (kbdEl) {
          const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
          applyScaleToKeyboard(kbdEl, transposeRoot(riff.scaleRoot, globalTranspose), intervals);
        }
      }

      // Chords: update root dropdown + step labels in open cards
      for (const [, ch] of chords) {
        if (!(ch instanceof ChordsSequencer)) continue;
        const cardInfo = openCards.get(ch.id);
        if (!cardInfo) continue;
        const sel = cardInfo.el.querySelector('.chords-root-sel');
        if (sel) sel.value = transposeRoot(ch.scaleRoot, globalTranspose);
        // Update each step label to show transposed chord name
        cardInfo.el.querySelectorAll('.chords-step[data-idx]').forEach(cell => {
          const idx = parseInt(cell.dataset.idx);
          const step = ch.steps[idx];
          if (step && step.tokenId !== null) {
            const chord = CHORD_VOCAB[step.tokenId];
            if (chord) {
              const lbl = cell.querySelector('.chords-step-label');
              if (lbl) lbl.textContent = transposeRoot(chord.rootName, globalTranspose) + chord.suffix;
            }
          }
        });
      }
    }

    function beatTick() {
      cancelAnimationFrame(beatRaf);
      const up = () => {
        if (!isPlaying) return;
        const p = Tone.Transport.position.split(':');
        const bar = (parseInt(p[0]) || 0) + 1;
        const beat = (parseInt(p[1]) || 0) + 1;
        const tick = parseInt(parseFloat(p[2] || 0));
        beatRaf = requestAnimationFrame(up);
      };
      beatRaf = requestAnimationFrame(up);
    }

    function buildMetro() {
      if (metroPart) { try { metroPart.stop(); metroPart.dispose(); } catch(e){} metroPart = null; }
      const ctx = Tone.context.rawContext;
      metroPart = new Tone.Sequence((time, i) => {
        // Visual flash — always, regardless of metroOn
        Tone.Draw.schedule(() => {
          const d = document.getElementById('metro-dot');
          if (!d) return;
          d.classList.add('flash');
          setTimeout(() => d.classList.remove('flash'), i === 0 ? 90 : 55);
        }, time);
        // Clave audio — only when metroOn
        if (!metroOn) return;
        const isDown = i === 0;
        const vol = isDown ? 0.5 : 0.34;
        const decay = isDown ? 0.11 : 0.075;
        // Clave: two sine partials (fundamental + harmonic) for a hollow wooden click
        const freqs = isDown ? [2500, 3500] : [2100, 2940];
        for (let h = 0; h < 2; h++) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freqs[h], time);
          g.gain.setValueAtTime(vol * (h === 0 ? 0.68 : 0.32), time);
          g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(time);
          osc.stop(time + decay + 0.01);
        }
      }, [0, 1, 2, 3], '4n');
      metroPart.start(0);
    }

    document.getElementById('tog-metro').addEventListener('click', () => {
      metroOn = !metroOn;
      document.getElementById('tog-metro').classList.toggle('playing', metroOn);
      // No rebuild needed — sequence always runs, audio gated inside the callback
    });

    // BPM — drag to change, double-click to type
    const bpmEl = document.getElementById('bpm-val');
    let bpmY0, bpmV0;
    bpmEl.addEventListener('mousedown', e => {
      if (e.detail > 1) return;
      e.preventDefault();
      bpmY0 = e.clientY; bpmV0 = Tone.Transport.bpm.value;
      const mm = ev => {
        const bpm = Math.max(20, Math.min(300, Math.round(bpmV0 + (bpmY0 - ev.clientY) * 0.5)));
        Tone.Transport.bpm.value = bpm;
        bpmEl.textContent = bpm;
        _notifySyncBpmChange(bpm);
      };
      const mu = () => {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
    bpmEl.addEventListener('dblclick', () => {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.value = Tone.Transport.bpm.value;
      inp.style.cssText =
        'background:#000;border:1px solid #fff;color:#fff;' +
        'font-family:Courier New,monospace;font-size:22px;font-weight:700;' +
        'width:70px;text-align:center;padding:1px;';
      bpmEl.replaceWith(inp); inp.focus(); inp.select();
      let _doneCalled = false;
      const done = () => {
        if (_doneCalled) return; _doneCalled = true;
        const v = Math.max(20, Math.min(300, parseInt(inp.value) || 120));
        Tone.Transport.bpm.value = v;
        bpmEl.textContent = v;
        if (inp.parentNode) inp.replaceWith(bpmEl);
        _notifySyncBpmChange(v);
      };
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
    });

    // ── MIDI capture ──
    function vlq(value) {
      if (value < 128) return [value];
      const bytes = [];
      bytes.unshift(value & 0x7F);
      value >>= 7;
      while (value > 0) { bytes.unshift((value & 0x7F) | 0x80); value >>= 7; }
      return bytes;
    }

    class MidiCapture {
      constructor(name, bpm, ticksPerBeat = 480) {
        this.name = name; this.bpm = bpm; this.ticksPerBeat = ticksPerBeat;
        this.events = []; this.startTime = null;
      }
      start(t) { this.startTime = t; this.events = []; }
      _tick(t) { return Math.round(Math.max(0, t - this.startTime) * this.ticksPerBeat * this.bpm / 60); }
      noteOn(t, note, vel = 100) {
        if (this.startTime === null) return;
        this.events.push({ tick: this._tick(t), type: 0x90, note: note & 0x7F, vel: vel & 0x7F });
      }
      noteOff(t, note) {
        if (this.startTime === null) return;
        this.events.push({ tick: this._tick(t), type: 0x80, note: note & 0x7F, vel: 0 });
      }
      toMidiBlob() {
        const sorted = [...this.events].sort((a, b) => a.tick - b.tick || (a.type === 0x80 ? -1 : 1));
        const tpb = this.ticksPerBeat;
        const tempo = Math.round(60000000 / this.bpm);
        const track = [...vlq(0), 0xFF, 0x51, 0x03, (tempo>>16)&0xFF, (tempo>>8)&0xFF, tempo&0xFF];
        let last = 0;
        for (const ev of sorted) {
          track.push(...vlq(ev.tick - last)); last = ev.tick;
          track.push(ev.type, ev.note, ev.vel);
        }
        track.push(0x00, 0xFF, 0x2F, 0x00);
        const tl = track.length;
        const bytes = new Uint8Array([
          0x4D,0x54,0x68,0x64, 0,0,0,6, 0,0, 0,1, tpb>>8,tpb&0xFF,
          0x4D,0x54,0x72,0x6B, (tl>>24)&0xFF,(tl>>16)&0xFF,(tl>>8)&0xFF,tl&0xFF,
          ...track
        ]);
        return new Blob([bytes], { type: 'audio/midi' });
      }
    }
