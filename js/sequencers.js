    // CHORDS SYSTEM
    const chords = new Map();
    let nextChordsId = 1;
    const chordsNodes = new Map();
    let _chordsColorIdx = 0;
    const CHORDS_COLORS = ['#00cccc','#ff6600','#cc00cc','#0099ff','#00cc66','#ff0066','#ffcc00','#6600ff'];
    function nextChordsColor() { return CHORDS_COLORS[_chordsColorIdx++ % CHORDS_COLORS.length]; }

    // Returns { startTime, startStep } for quantized scheduling when transport is running.
    // If transport was just started (tPos < one step) or is stopped, returns immediate start at step 0.
    function _seqSyncOffset(interval) {
      // Always anchor to transport position 0 (same as DrumMachine seq.start(0)).
      // scheduleRepeat(cb, I, 0) fires at 0, I, 2I… so when transport is already at T,
      // the first fire lands at ceil(T/I)*I — the correct phase-locked step boundary.
      const startStep = Tone.Transport.state === 'started'
        ? Math.ceil(Tone.Transport.seconds / Tone.Time(interval).toSeconds())
        : 0;
      return { startTime: 0, startStep };
    }

    class RiffSequencer {
      constructor(id, x, y) {
        this.id = id;
        this.name = 'Riff ' + id;
        this.x = x; this.y = y;
        this.color = nextRiffColor();
        this.mode = 'step';           // 'step' | 'record'
        this.numSteps = 16;
        this.steps = Array.from({length: 64}, () => ({ note: null, vel: 1.0, slide: false, glideMs: 50 })); // null = rest
        this.notes = [];              // [{note, time, duration}] seconds — record mode
        this.subdiv = '16n';
        this.gridSync = true;
        this.rate = 0.125;    // seconds per step (free mode)
        this.harmony = 0;     // semitones for harmony voice (0 = off)
        this.loopBars = 1;
        this.quantize = true;
        this.scaleRoot = 'C';
        this.scale = 'Chromatic';
        this.destinations = [];       // array of instrument IDs
        this.midiInput = 'all';
        this._scheduleId = null;
        this._part = null;
        this._seqPhaseTransport = null;
        this.recording = false;
        this._recordStartWall = 0;
        this._activeRecordNotes = new Map(); // note → wallStartSec
        this._recordedNotes = [];
        this._midiCapture = null;
        // Orbit mode
        this.seqMode = 'grid';   // 'grid' | 'orbit'
        this.orbitNumRings = 2;
        this.orbitRings = [
          { numSteps: 8, speedRatio: 1.0, steps: Array.from({length: 16}, () => ({note: null, vel: 1.0})) },
          { numSteps: 6, speedRatio: 2.0, steps: Array.from({length: 16}, () => ({note: null, vel: 1.0})) },
          { numSteps: 5, speedRatio: 3.0, steps: Array.from({length: 16}, () => ({note: null, vel: 1.0})) },
          { numSteps: 7, speedRatio: 1.5, steps: Array.from({length: 16}, () => ({note: null, vel: 1.0})) },
        ];
        this._orbitScheduleIds = [];
        this._orbitStepIdx = [0, 0, 0, 0];
        this.orbitDestinations = [[], [], [], []]; // per-ring destination arrays
      }

      addOrbitDestination(ringIdx, instrId) {
        if (!this.orbitDestinations[ringIdx]) this.orbitDestinations[ringIdx] = [];
        if (!this.orbitDestinations[ringIdx].includes(instrId)) this.orbitDestinations[ringIdx].push(instrId);
      }
      removeOrbitDestination(ringIdx, instrId) {
        if (!this.orbitDestinations[ringIdx]) return;
        this.orbitDestinations[ringIdx] = this.orbitDestinations[ringIdx].filter(d => d !== instrId);
      }

      schedule() {
        this.unschedule();
        if (!audioReady) return;
        if (this.seqMode === 'orbit') { this._scheduleOrbit(); return; }
        if (this.mode === 'step') this._scheduleStep();
        else this._schedulePart();
      }

      _scheduleStep() {
        this._seqPhaseTransport = null;
        const interval = this.gridSync ? this.subdiv : this.rate;
        const { startTime, startStep } = _seqSyncOffset(interval);
        let stepIdx = startStep;
        this._scheduleId = Tone.Transport.scheduleRepeat((time) => {
          const step = stepIdx % this.numSteps;
          if (step === 0) {
            const lookahead = time - Tone.context.rawContext.currentTime;
            this._seqPhaseTransport = Tone.Transport.seconds + lookahead;
          }
          stepIdx++;
          riffNodes.get(this.id)?.setPlayStep(step);
          const stepData = this.steps[step];
          if (!stepData || !stepData.note) return;
          const stepDur = this.gridSync
            ? Tone.Time(this.subdiv).toSeconds()
            : this.rate;
          // Cap note duration to just under one step so voices always free before the next trigger
          const noteDur = Math.min(stepDur * 0.85, stepDur - 0.01);
          const vel = stepData.vel ?? 1.0;
          const notes = [stepData.note];
          if (this.harmony) {
            const harmMidi = noteToSemis(stepData.note) + this.harmony;
            const harmRaw = midiToNoteName(harmMidi);
            const intervals = RIFF_SCALES[this.scale] || RIFF_SCALES['Chromatic'];
            notes.push(snapToScale(harmRaw, this.scaleRoot, intervals));
          }
          // Apply global transpose at output (non-destructive to stored notes)
          const tNotes = globalTranspose
            ? notes.map(n => midiToNoteName(noteToSemis(n) + globalTranspose))
            : notes;
          // Light up keyboard keys for played notes
          const kbdProxy = riffKbdProxies.get(this.id);
          for (const n of tNotes) {
            kbdProxy?._noteHighlight?.(n, true);
            setTimeout(() => kbdProxy?._noteHighlight?.(n, false), (noteDur + 0.05) * 1000);
          }
          for (const instrId of this.destinations) {
            const instr = getInstrument(instrId);
            if (!instr || instr.muted) continue;
            // Per-step glide: slide steps temporarily override portamento; non-slide steps
            // leave it unchanged so the global GLIDE slider remains in effect.
            let savedPort = null;
            if (instr instanceof SynthInstrument && stepData.slide) {
              const stepPort = (stepData.glideMs ?? 50) / 1000;
              if (instr.portamento !== stepPort) {
                savedPort = instr.portamento;
                instr.portamento = stepPort;
                if (instr.updatePortamento) instr.updatePortamento();
              }
            }
            for (const n of tNotes) {
              if (instr instanceof SynthInstrument) {
                instr.triggerAtTime(n, noteDur, time, vel);
              } else if (instr instanceof Sample) {
                const semis = noteToSemis(n) - noteToSemis('C4');
                instr.triggerAtTime(time, 0.8, vel, semis);
              }
            }
            // Restore global portamento — triggerAtTime already captured the step value
            if (savedPort !== null) instr.portamento = savedPort;
          }
          if (this._midiCapture) {
            for (const n of tNotes) {
              const midi = noteToSemis(n);
              this._midiCapture.noteOn(time, midi, Math.round(vel * 100));
              this._midiCapture.noteOff(time + noteDur, midi);
            }
          }
        }, interval);
      }

      _schedulePart() {
        if (!this.notes.length) return;
        const bpm = Tone.Transport.bpm.value;
        const loopDurSec = this.loopBars * 4 * (60 / bpm);
        const events = this.notes.map(n => ({ time: n.time, note: n.note, duration: n.duration }));
        this._part = new Tone.Part((time, val) => {
          const tNote = globalTranspose ? midiToNoteName(noteToSemis(val.note) + globalTranspose) : val.note;
          for (const instrId of this.destinations) {
            const instr = getInstrument(instrId);
            if (!instr || instr.muted) continue;
            if (instr instanceof SynthInstrument) {
              instr.triggerAtTime(tNote, val.duration, time, 1.0);
              instr._noteHighlight?.(tNote, true);
              Tone.Transport.scheduleOnce(() => instr._noteHighlight?.(tNote, false), '+' + val.duration);
            } else if (instr instanceof Sample) {
              const semis = noteToSemis(tNote) - noteToSemis('C4');
              instr.triggerAtTime(time, val.duration, 1.0, semis);
            }
          }
          if (this._midiCapture) {
            const midi = noteToSemis(val.note);
            this._midiCapture.noteOn(time, midi, 100);
            this._midiCapture.noteOff(time + (typeof val.duration === 'string' ? Tone.Time(val.duration).toSeconds() : val.duration), midi);
          }
        }, events);
        this._part.loop = true;
        this._part.loopStart = 0;
        this._part.loopEnd = loopDurSec;
        this._part.start(0);
      }

      _scheduleOrbit() {
        const baseSec = this.gridSync ? Tone.Time(this.subdiv).toSeconds() : this.rate;
        this._orbitScheduleIds = [];
        for (let ri = 0; ri < this.orbitNumRings; ri++) {
          const ring = this.orbitRings[ri];
          const interval = Math.max(0.02, baseSec / ring.speedRatio);
          let stepIdx = 0;
          const riCopy = ri;
          const id = Tone.Transport.scheduleRepeat((time) => {
            const step = stepIdx % ring.numSteps;
            stepIdx++;
            this._orbitStepIdx[riCopy] = step;
            riffNodes.get(this.id)?.setOrbitPlayStep?.(riCopy, step);
            const stepData = ring.steps[step];
            if (!stepData?.note) return;
            riffNodes.get(this.id)?.flashOrbitPort?.(riCopy);
            const noteDur = Math.min(interval * 0.85, interval - 0.01);
            const vel = stepData.vel ?? 1.0;
            const notes = [stepData.note];
            if (this.harmony) {
              const harmMidi = noteToSemis(stepData.note) + this.harmony;
              const intervals = RIFF_SCALES[this.scale] || RIFF_SCALES['Chromatic'];
              notes.push(snapToScale(midiToNoteName(harmMidi), this.scaleRoot, intervals));
            }
            const tNotes = globalTranspose ? notes.map(n => midiToNoteName(noteToSemis(n) + globalTranspose)) : notes;
            const kbdProxy = riffKbdProxies.get(this.id);
            for (const n of tNotes) {
              kbdProxy?._noteHighlight?.(n, true);
              setTimeout(() => kbdProxy?._noteHighlight?.(n, false), (noteDur + 0.05) * 1000);
            }
            const ringDests = this.orbitDestinations[riCopy] || [];
            for (const instrId of ringDests) {
              const instr = getInstrument(instrId);
              if (!instr || instr.muted) continue;
              for (const n of tNotes) {
                if (instr instanceof SynthInstrument) instr.triggerAtTime(n, noteDur, time, vel);
                else if (instr instanceof Sample) instr.triggerAtTime(time, 0.8, vel, noteToSemis(n) - noteToSemis('C4'));
              }
            }
            if (this._midiCapture) {
              for (const n of tNotes) {
                const midi = noteToSemis(n);
                this._midiCapture.noteOn(time, midi, Math.round(vel * 100));
                this._midiCapture.noteOff(time + noteDur, midi);
              }
            }
          }, interval, 0);
          this._orbitScheduleIds.push(id);
        }
      }

      unschedule() {
        if (this._scheduleId !== null) {
          Tone.Transport.clear(this._scheduleId);
          this._scheduleId = null;
        }
        if (this._part) {
          this._part.stop();
          this._part.dispose();
          this._part = null;
        }
        for (const id of this._orbitScheduleIds) Tone.Transport.clear(id);
        this._orbitScheduleIds = [];
        this._orbitStepIdx = [0, 0, 0, 0];
        this._seqPhaseTransport = null;
        // Release all voices on connected synths so no voice gets stuck between reschedules
        for (const instrId of this.destinations) {
          const instr = getInstrument(instrId);
          if (instr instanceof SynthInstrument) {
            try { instr.allNotesOff(); } catch(e) {}
          }
        }
      }

      reschedule() { if (audioReady) this.schedule(); }

      startRecording() {
        this._recordedNotes = [];
        this._activeRecordNotes.clear();
        this._recordStartWall = performance.now() / 1000;
        this.recording = true;
      }

      recordNoteOn(note) {
        if (!this.recording) return;
        const t = performance.now() / 1000 - this._recordStartWall;
        this._activeRecordNotes.set(note, t);
      }

      recordNoteOff(note) {
        if (!this.recording) return;
        const t = performance.now() / 1000 - this._recordStartWall;
        const start = this._activeRecordNotes.get(note);
        if (start !== undefined) {
          this._recordedNotes.push({ note, time: start, duration: Math.max(0.05, t - start) });
          this._activeRecordNotes.delete(note);
        }
      }

      stopRecording() {
        this.recording = false;
        // Close any held notes
        const now = performance.now() / 1000 - this._recordStartWall;
        for (const [note, start] of this._activeRecordNotes) {
          this._recordedNotes.push({ note, time: start, duration: Math.max(0.05, now - start) });
        }
        this._activeRecordNotes.clear();

        if (this.quantize) {
          const bpm = Tone.Transport.bpm.value;
          const subdivSec = Tone.Time(this.subdiv).toSeconds();
          this._recordedNotes = this._recordedNotes.map(n => {
            const qt = Math.round(n.time / subdivSec) * subdivSec;
            const qd = Math.max(subdivSec * 0.5, Math.round(n.duration / subdivSec) * subdivSec);
            return { ...n, time: qt, duration: qd };
          });
        }

        this.notes = this._recordedNotes.slice();
        this._recordedNotes = [];
        this.reschedule();
      }

      addDestination(id) { if (!this.destinations.includes(id)) this.destinations.push(id); }
      removeDestination(id) { this.destinations = this.destinations.filter(d => d !== id); }
    }

    class ChordsSequencer {
      constructor(id, x, y) {
        this.id = id;
        this.name = 'Chords ' + id;
        this.x = x; this.y = y;
        this.color = nextChordsColor();
        this.numSteps = 16;
        this.steps = Array.from({length: 64}, () => ({ tokenId: null, enabled: false }));
        this.subdiv = '8n';
        this.gridSync = true;
        this.rate = 0.5;
        this.voicingMode = 0;     // -2=Drop2 -1=Drop1 0=Root +1=Inv1 +2=Inv2
        this.transposeOffset = 0; // semitones, applied to whole sequence
        this.voiceLeading = false;
        this.scaleRoot = 'C';
        this.scale = 'Chromatic';
        this.genre = '';
        this.decade = '';
        this.destinations = [];
        // Playback mode
        this.playMode = 'off';   // 'off' | 'strum' | 'arp'
        this.strumSpeed = 0.015; // seconds between each note in strum
        this.strumDir = 'dn';    // 'dn' | 'up' | 'ud' | 'rand'
        this.arpMode = 'up';
        this.arpRate = '8n';
        this.arpOctaves = 1;
        this.arpHold = true;
        this.stepArp = false;
        this.stepArpSteps = 8;
        this.stepArpPattern = Array.from({length: 8}, () => Array(6).fill(false));
        this._scheduleId = null; this._arpSeqId = null;
        this._currentStep = -1; this._prevNotes = null;
        this._arpNotes = []; this._arpIdx = 0; this._stepArpIdx = 0;
        this._midiCapture = null;
      }

      addDestination(id) { if (!this.destinations.includes(id)) this.destinations.push(id); }
      removeDestination(id) { this.destinations = this.destinations.filter(d => d !== id); }

      getStepMidi(stepIdx) {
        const sd = this.steps[stepIdx];
        if (!sd || sd.tokenId === null) return [];
        const token = CHORD_VOCAB[sd.tokenId];
        if (!token) return [];
        let notes = applyVoicing(token.notes, this.voicingMode);
        if (this.transposeOffset) notes = notes.map(n => n + this.transposeOffset);
        if (this.voiceLeading && this._prevNotes && this._prevNotes.length) {
          notes = applyVoiceLeadingToChord(this._prevNotes, notes);
        }
        if (this.scale !== 'Chromatic') {
          const intervals = RIFF_SCALES[this.scale] || [];
          notes = notes.map(n => {
            const nm = midiToNoteName(n);
            return noteToSemis(snapToScale(nm, this.scaleRoot, intervals));
          });
        }
        return notes;
      }

      schedule() {
        this.unschedule();
        if (!audioReady) return;

        const playNotes = (midiNotes, time, dur) => {
          const tMidi = globalTranspose ? midiNotes.map(n => n + globalTranspose) : midiNotes;
          for (const instrId of this.destinations) {
            const instr = getInstrument(instrId);
            if (!instr || instr.muted) continue;
            if (instr instanceof SynthInstrument) {
              for (const n of tMidi.map(midiToNoteName)) instr.triggerAtTime(n, dur, time, 0.75);
            } else if (instr instanceof Sample) {
              const semis = noteToSemis(midiToNoteName(tMidi[0])) - noteToSemis('C4');
              instr.triggerAtTime(time, dur, 0.75, semis);
            }
          }
          if (this._midiCapture) {
            for (const midi of tMidi) {
              this._midiCapture.noteOn(time, midi, 75);
              this._midiCapture.noteOff(time + dur, midi);
            }
          }
        };

        const interval = this.gridSync ? this.subdiv : this.rate;
        const { startTime, startStep } = _seqSyncOffset(interval);
        const { startTime: arpStartTime } = _seqSyncOffset(this.arpRate);

        if (this.playMode === 'arp') {
          this._arpNotes = [];
          this._arpIdx = 0;
          this._stepArpIdx = 0;
          if (this.stepArp) {
            // Step arp: each column fires at arpRate, active rows = notes played
            this._arpSeqId = Tone.Transport.scheduleRepeat((time) => {
              const col = this._stepArpIdx % this.stepArpSteps;
              this._stepArpIdx++;
              chordsNodes.get(this.id)?.updateStepArpPlayhead?.(col);
              if (!this._arpNotes.length) return;
              const colPat = this.stepArpPattern[col] || [];
              const notesToPlay = [];
              for (let row = 0; row < colPat.length; row++) {
                if (colPat[row] && row < this._arpNotes.length) notesToPlay.push(this._arpNotes[row]);
              }
              if (!notesToPlay.length) return;
              const dur = Math.max(0.05, Tone.Time(this.arpRate).toSeconds() * 0.8);
              playNotes(notesToPlay, time, dur);
            }, this.arpRate, arpStartTime);
          } else {
            this._arpSeqId = Tone.Transport.scheduleRepeat((time) => {
              if (!this._arpNotes.length) return;
              let noteIdx;
              if (this.arpMode === 'random') {
                noteIdx = Math.floor(Math.random() * this._arpNotes.length);
              } else {
                noteIdx = this._arpIdx % this._arpNotes.length;
                this._arpIdx++;
              }
              const arpDur = Math.max(0.05, Tone.Time(this.arpRate).toSeconds() * 0.8);
              playNotes([this._arpNotes[noteIdx]], time, arpDur);
            }, this.arpRate, arpStartTime);
          }
        }

        let stepIdx = startStep;
        this._scheduleId = Tone.Transport.scheduleRepeat((time) => {
          const step = stepIdx % this.numSteps;
          stepIdx++;
          this._currentStep = step;
          chordsNodes.get(this.id)?.setPlayStep(step);
          const sd = this.steps[step];
          const hasChord = sd && sd.enabled && sd.tokenId !== null;

          if (!hasChord) {
            if (this.playMode === 'arp' && !this.arpHold) { this._arpNotes = []; }
            return;
          }

          const midiNotes = this.getStepMidi(step);
          if (!midiNotes.length) return;
          this._prevNotes = midiNotes;

          const stepDur = this.gridSync ? Tone.Time(this.subdiv).toSeconds() : this.rate;
          const noteDur = Math.min(stepDur * 0.85, stepDur - 0.01);

          if (this.playMode === 'strum') {
            const sorted = this.strumDir === 'up'  ? [...midiNotes].reverse()
                         : this.strumDir === 'rand' ? shuffled(midiNotes)
                         : [...midiNotes]; // 'dn' = low to high
            const seq = this.strumDir === 'ud'
              ? [...sorted, ...sorted.slice(1, -1).reverse()]
              : sorted;
            seq.forEach((midi, i) => {
              playNotes([midi], time + i * this.strumSpeed, Math.max(0.05, noteDur - i * this.strumSpeed));
            });
          } else if (this.playMode === 'arp') {
            this._arpNotes = this.stepArp
              ? [...midiNotes].sort((a, b) => a - b)
              : buildArpSequence(midiNotes, this.arpMode, this.arpOctaves);
            this._arpIdx = 0;
          } else {
            playNotes(midiNotes, time, noteDur);
          }
        }, interval, startTime);
      }

      unschedule() {
        if (this._scheduleId !== null) { Tone.Transport.clear(this._scheduleId); this._scheduleId = null; }
        if (this._arpSeqId  !== null) { Tone.Transport.clear(this._arpSeqId);  this._arpSeqId  = null; }
        this._arpNotes = []; this._arpIdx = 0;
        this._currentStep = -1;
        for (const instrId of this.destinations) {
          const instr = getInstrument(instrId);
          if (instr instanceof SynthInstrument) try { instr.allNotesOff(); } catch(e) {}
        }
      }

      reschedule() { if (audioReady) this.schedule(); }
    }

    // ── Chord vocabulary and recommendation engine ──
    const CHORD_ROOTS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const CHORD_TYPE_DEFS = [
      {suffix:'',      intervals:[0,4,7]},
      {suffix:'m',     intervals:[0,3,7]},
      {suffix:'7',     intervals:[0,4,7,10]},
      {suffix:'maj7',  intervals:[0,4,7,11]},
      {suffix:'m7',    intervals:[0,3,7,10]},
      {suffix:'dim',   intervals:[0,3,6]},
      {suffix:'dim7',  intervals:[0,3,6,9]},
      {suffix:'aug',   intervals:[0,4,8]},
      {suffix:'m7b5',  intervals:[0,3,6,10]},
      {suffix:'sus4',  intervals:[0,5,7]},
      {suffix:'sus2',  intervals:[0,2,7]},
      {suffix:'9',     intervals:[0,4,7,10,14]},
      {suffix:'maj9',  intervals:[0,4,7,11,14]},
      {suffix:'m9',    intervals:[0,3,7,10,14]},
      {suffix:'11',    intervals:[0,4,7,10,14,17]},
      {suffix:'m11',   intervals:[0,3,7,10,14,17]},
      {suffix:'maj11', intervals:[0,4,7,11,14,17]},
      {suffix:'13',    intervals:[0,4,7,10,14,21]},
      {suffix:'6',     intervals:[0,4,7,9]},
      {suffix:'m6',    intervals:[0,3,7,9]},
      {suffix:'add9',  intervals:[0,2,4,7]},
      {suffix:'mmaj7', intervals:[0,3,7,11]},
      {suffix:'7sus4', intervals:[0,5,7,10]},
      {suffix:'5',     intervals:[0,7]},
      {suffix:'aug7',  intervals:[0,4,8,10]},
    ];

    // Generate CHORD_VOCAB: 300 tokens (12 roots × 25 types)
    const CHORD_VOCAB = [];
    for (let ri = 0; ri < 12; ri++) {
      for (let ti = 0; ti < CHORD_TYPE_DEFS.length; ti++) {
        const root = CHORD_ROOTS[ri];
        const def = CHORD_TYPE_DEFS[ti];
        const id = ri * CHORD_TYPE_DEFS.length + ti;
        // notes: root at C3 = MIDI 48
        const notes = def.intervals.map(iv => 48 + ri + iv);
        CHORD_VOCAB.push({ id, name: root + def.suffix, root: ri, rootName: root, suffix: def.suffix, typeIdx: ti, intervals: def.intervals, notes });
      }
    }

    // Apply chord voicing: mode -2=Drop2, -1=Drop1, 0=Root, +1=Inv1, +2=Inv2
    function applyVoicing(notes, mode) {
      let voiced = [...notes].sort((a, b) => a - b);
      if (mode === 0) return voiced;
      if (mode > 0) {
        // Inversions: raise the lowest note(s) up one octave each step
        for (let i = 0; i < mode; i++) {
          let minIdx = 0;
          for (let j = 1; j < voiced.length; j++) if (voiced[j] < voiced[minIdx]) minIdx = j;
          voiced[minIdx] += 12;
        }
      } else {
        // Drop voicings: lower the highest note(s) down one octave each step
        for (let i = 0; i < -mode; i++) {
          let maxIdx = 0;
          for (let j = 1; j < voiced.length; j++) if (voiced[j] > voiced[maxIdx]) maxIdx = j;
          voiced[maxIdx] -= 12;
        }
      }
      return voiced.sort((a, b) => a - b);
    }

    function applyVoiceLeadingToChord(prevNotes, nextNotes) {
      // Greedy voice leading: for each next note, find the octave placement
      // that minimizes distance to nearest prev note. Keep within MIDI 36-84.
      const result = nextNotes.map(n => {
        const pc = ((n % 12) + 12) % 12;
        // Try octaves to find closest to any prev note
        let best = n, bestDist = Infinity;
        for (let oct = 2; oct <= 7; oct++) {
          const candidate = pc + oct * 12;
          if (candidate < 36 || candidate > 84) continue;
          const dist = Math.min(...prevNotes.map(p => Math.abs(candidate - p)));
          if (dist < bestDist) { bestDist = dist; best = candidate; }
        }
        return best;
      });
      return result.sort((a, b) => a - b);
    }

    // Diatonic scale intervals (semitones from root)
    const MAJOR_SCALE = [0,2,4,5,7,9,11];
    const MINOR_SCALE = [0,2,3,5,7,8,10];
    // Diatonic chord roots (scale degrees 0-6) in major: I ii iii IV V vi vii
    const MAJOR_DEGREE_ROOTS = [0,2,4,5,7,9,11];
    // Diatonic chord types for major scale degrees (triad types: maj=0 min=1 dim=5)
    const MAJOR_DEGREE_TYPES = [0,1,1,0,0,1,5]; // I=maj ii=min iii=min IV=maj V=maj vi=min vii=dim
    // Diatonic 7th types per degree in major
    const MAJOR_DEGREE_7TH   = [3,4,4,3,2,4,8]; // Imaj7 iim7 iiim7 IVmaj7 V7 vim7 viim7b5

    function getChordsRecommendations(prevTokenId, allPrevTokenIds, scaleRoot, scaleName, genre, decade) {
      const rootNM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
      const keyRoot = rootNM[scaleRoot] ?? 0;

      // Genre type preferences: type index → bonus score
      const genreTypeBonus = {};
      const genreProgBonus = {}; // token id pairs → score
      if (genre === 'Jazz') {
        [2,3,4,8,11,12,13,14,15,16,17].forEach(t => { genreTypeBonus[t] = 0.25; });
      } else if (genre === 'Blues') {
        [2].forEach(t => { genreTypeBonus[t] = 0.3; });
      } else if (genre === 'Pop' || genre === 'Country' || genre === 'Folk') {
        [0,1,18,19].forEach(t => { genreTypeBonus[t] = 0.2; });
      } else if (genre === 'R&B/Soul' || genre === 'Hip Hop') {
        [2,4,11,12,13].forEach(t => { genreTypeBonus[t] = 0.2; });
      } else if (genre === 'Rock' || genre === 'Metal') {
        [0,23].forEach(t => { genreTypeBonus[t] = 0.2; });
        [1].forEach(t => { genreTypeBonus[t] = 0.1; });
      } else if (genre === 'Classical') {
        [0,1,2,3,4,5,6].forEach(t => { genreTypeBonus[t] = 0.1; });
      }

      // Decade: older → simpler chords
      let decadeSimpleBonus = 0;
      let decadeExtBonus = 0;
      if (decade === '1950s' || decade === '1960s') { decadeSimpleBonus = 0.15; decadeExtBonus = -0.1; }
      else if (decade === '1970s' || decade === '1980s') { decadeSimpleBonus = 0.05; decadeExtBonus = 0; }
      else if (decade === '2000s' || decade === '2010s' || decade === '2020s') { decadeSimpleBonus = -0.05; decadeExtBonus = 0.1; }
      const simpleTypes = new Set([0,1,18,19,9,10,23]); // triads, 6ths, sus, power
      const extTypes = new Set([11,12,13,14,15,16,17]); // 9th, 11th, 13th extensions

      // Common progressions as root-interval pairs: [fromRoot, toRoot] (relative to key)
      // stored as [fromDegree, toDegree]
      const commonProgDegrees = [];
      if (genre === 'Pop') {
        commonProgDegrees.push(...[[0,4],[0,3],[5,3],[4,0],[3,4],[5,4],[4,5]]); // I-V I-IV vi-IV V-I
      } else if (genre === 'Jazz') {
        commonProgDegrees.push(...[[1,4],[4,0],[4,4],[0,3],[3,6]]); // ii-V-I, tritone
      } else if (genre === 'Blues') {
        commonProgDegrees.push(...[[0,3],[3,0],[4,3],[4,0],[0,4]]);
      } else if (genre === 'Rock') {
        commonProgDegrees.push(...[[0,6],[6,3],[3,0],[0,4],[0,3]]);
      } else if (genre === 'Country' || genre === 'Folk') {
        commonProgDegrees.push(...[[0,3],[3,4],[4,0],[0,4],[0,5]]);
      } else {
        // Generic common progressions
        commonProgDegrees.push(...[[0,4],[0,3],[5,3],[4,0],[1,4]]);
      }

      // Build diatonic scale set for key
      const useMinor = (scaleName || '').toLowerCase().includes('minor') || (scaleName || '').toLowerCase().includes('aeolian');
      const scaleDeg = useMinor ? MINOR_SCALE : MAJOR_SCALE;
      const inKeySet = new Set(scaleDeg.map(d => (keyRoot + d) % 12));

      const scores = new Float32Array(CHORD_VOCAB.length);

      // Base diatonic score
      for (let i = 0; i < CHORD_VOCAB.length; i++) {
        const tok = CHORD_VOCAB[i];
        // Check if root is diatonic to key
        if (inKeySet.has(tok.root)) scores[i] += 0.3;
        // Check if all intervals are diatonic
        let allInKey = true;
        for (const iv of tok.intervals) {
          const pc = (tok.root + iv) % 12;
          if (!inKeySet.has(pc)) { allInKey = false; break; }
        }
        if (allInKey) scores[i] += 0.25;
        // Genre bonuses
        if (genreTypeBonus[tok.typeIdx] !== undefined) scores[i] += genreTypeBonus[tok.typeIdx];
        // Decade bonuses
        if (simpleTypes.has(tok.typeIdx)) scores[i] += decadeSimpleBonus;
        if (extTypes.has(tok.typeIdx)) scores[i] += decadeExtBonus;
      }

      if (prevTokenId !== null && prevTokenId !== undefined) {
        const prev = CHORD_VOCAB[prevTokenId];
        if (prev) {
          // Voice leading score
          for (let i = 0; i < CHORD_VOCAB.length; i++) {
            const tok = CHORD_VOCAB[i];
            // average min semitone distance between chord tones
            let totalDist = 0;
            for (const iv of tok.intervals) {
              const pc = (tok.root + iv) % 12;
              let minD = Infinity;
              for (const piv of prev.intervals) {
                const ppc = (prev.root + piv) % 12;
                const d = Math.min(Math.abs(pc - ppc), 12 - Math.abs(pc - ppc));
                if (d < minD) minD = d;
              }
              totalDist += minD;
            }
            const avgDist = totalDist / tok.intervals.length;
            scores[i] += Math.max(0, 0.4 - avgDist * 0.05);
          }

          // Common progression bonuses: check if prev→this matches a common pair
          for (const [fromDeg, toDeg] of commonProgDegrees) {
            const fromRoot = (keyRoot + scaleDeg[fromDeg % scaleDeg.length]) % 12;
            const toRoot = (keyRoot + scaleDeg[toDeg % scaleDeg.length]) % 12;
            if (prev.root === fromRoot) {
              for (let i = 0; i < CHORD_VOCAB.length; i++) {
                if (CHORD_VOCAB[i].root === toRoot) scores[i] += 0.3;
              }
            }
          }

          // Penalize same chord repeat
          scores[prevTokenId] = Math.max(0, scores[prevTokenId] - 0.2);
        }
      } else {
        // First chord: genre+scale+decade aware starting chord suggestions
        // Each entry: [scaleDegreeIdx, typeIdx, weight]
        const firstChordTargets = [];
        const isMinorKey = useMinor;

        if (genre === 'Blues') {
          // Blues nearly always starts on I7
          firstChordTargets.push([0, 2, 1.2]); // I dom7
          firstChordTargets.push([0, 0, 0.5]); // I maj (older blues)
          firstChordTargets.push([3, 2, 0.4]); // IV7
        } else if (genre === 'Jazz') {
          firstChordTargets.push([0, 3, 1.0]); // Imaj7
          firstChordTargets.push([1, 4, 0.8]); // iim7
          firstChordTargets.push([3, 3, 0.6]); // IVmaj7
          firstChordTargets.push([0, 4, 0.5]); // Im7 (minor jazz)
          firstChordTargets.push([5, 4, 0.5]); // vim7
        } else if (genre === 'R&B/Soul' || genre === 'Hip Hop') {
          firstChordTargets.push([0, isMinorKey ? 4 : 3, 1.0]); // Im7 or Imaj7
          firstChordTargets.push([5, 4, 0.7]);  // vim7
          firstChordTargets.push([3, 4, 0.6]);  // IVm7 or IVmaj7
          firstChordTargets.push([0, isMinorKey ? 1 : 0, 0.5]);
        } else if (genre === 'Rock' || genre === 'Metal') {
          firstChordTargets.push([0, 0, 1.2]);  // I maj (or i power)
          firstChordTargets.push([0, 23, 0.9]); // I5 power chord
          firstChordTargets.push([0, 1, 0.7]);  // i minor
          firstChordTargets.push([5, 0, 0.5]);  // VI (bVI in minor)
          firstChordTargets.push([6, 0, 0.5]);  // bVII
        } else if (genre === 'Classical') {
          firstChordTargets.push([0, 0, 1.2]);  // I
          firstChordTargets.push([0, 1, 0.9]);  // i minor
          firstChordTargets.push([4, 0, 0.5]);  // V
          firstChordTargets.push([3, 0, 0.4]);  // IV
        } else if (genre === 'Country' || genre === 'Folk') {
          firstChordTargets.push([0, 0, 1.2]);  // I
          firstChordTargets.push([3, 0, 0.6]);  // IV
          firstChordTargets.push([4, 0, 0.5]);  // V
        } else {
          // Pop / generic: I, vi, IV depending on decade
          firstChordTargets.push([0, isMinorKey ? 1 : 0, 1.0]); // I or i
          firstChordTargets.push([5, 1, 0.7]);  // vi
          firstChordTargets.push([3, isMinorKey ? 1 : 0, 0.6]); // IV or iv
          firstChordTargets.push([4, 0, 0.4]);  // V
        }
        // Decade: newer eras lean toward vi/minor starts, older toward I
        const decadeViBonus = decade === '2010s' || decade === '2020s' ? 0.2
                            : decade === '1950s' || decade === '1960s' ? -0.1 : 0;
        for (const [deg, typeIdx, w] of firstChordTargets) {
          const r = (keyRoot + scaleDeg[deg % scaleDeg.length]) % 12;
          for (let i = 0; i < CHORD_VOCAB.length; i++) {
            const tok = CHORD_VOCAB[i];
            if (tok.root === r) {
              let bonus = w * 0.5;
              if (tok.typeIdx === typeIdx) bonus += w * 0.5;
              // vi bonus from decade
              if (deg === 5) bonus += decadeViBonus;
              scores[i] += bonus;
            }
          }
        }
      }

      // Build sorted top-12 list
      const indexed = Array.from(scores, (s, i) => [i, s]);
      indexed.sort((a, b) => b[1] - a[1]);
      return indexed.slice(0, 12).map(([id, score]) => ({ token: CHORD_VOCAB[id], score: Math.min(1, Math.max(0, score)) }));
    }

    let _chordsOnnxSession = null;
    let _chordsAiLoading = false;
    let _chordsTokenMap = null;

    function initChordsAI() {
      if (_chordsOnnxSession || _chordsAiLoading) return;
      _chordsAiLoading = true;
      // Lazy-load ONNX Runtime Web + chord-seq-ai model
      (async () => {
        try {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
          const mapResp = await fetch('https://raw.githubusercontent.com/PetrIvan/chord-seq-ai-app/main/src/data/token_to_chord.ts');
          if (mapResp.ok) {
            // parse basic mapping from TS source
            const txt = await mapResp.text();
            const m = txt.match(/\{([^}]+)\}/);
            if (m) {
              _chordsTokenMap = {};
              for (const pair of m[1].matchAll(/(\d+):\s*"([^"]+)"/g))
                _chordsTokenMap[parseInt(pair[1])] = pair[2];
            }
          }
          const modelResp = await fetch('https://raw.githubusercontent.com/PetrIvan/chord-seq-ai-app/main/public/models/recurrent_net.onnx');
          if (modelResp.ok) {
            const buf = await modelResp.arrayBuffer();
            _chordsOnnxSession = await window.ort.InferenceSession.create(buf);
          }
        } catch(e) {
          // silently fall back to theory engine
        }
        _chordsAiLoading = false;
      })();
    }

    function playChordPreview(tokenId, chordsInst) {
      const token = CHORD_VOCAB[tokenId];
      if (!token || !chordsInst) return;
      let notes = applyVoicing(token.notes, chordsInst.voicingMode || 0);
      if (chordsInst.transposeOffset) notes = notes.map(n => n + chordsInst.transposeOffset);
      const noteNames = notes.map(midiToNoteName);
      for (const instrId of chordsInst.destinations) {
        const instr = getInstrument(instrId);
        if (!instr || instr.muted) continue;
        if (instr instanceof SynthInstrument) {
          for (const n of noteNames) instr.triggerAtTime(n, 0.6, Tone.now(), 0.65);
        } else if (instr instanceof Sample) {
          const semis = noteToSemis(noteNames[0]) - noteToSemis('C4');
          instr.triggerAtTime(Tone.now(), 0.5, 0.65, semis);
        }
      }
    }

    // Maps cslider CSS classes to { prop, min, max, label }
    const LFO_PARAM_MAP = {
      'card-pitch':   { prop: 'pitchST',  min: -24, max: 24, label: 'Pitch', setter: 'setPitch',  fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'card-fine':    { prop: 'fineST',   min: -2,  max: 2,  label: 'Fine',  setter: 'setFine',   fmtVal: v => parseFloat(v).toFixed(2) + ' st' },
      'card-stretch': { prop: 'stretchST', min: -24, max: 24, label: 'Tape', setter: 'setStretch', fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'card-attack': { prop: 'attackTime', min: 0, max: 4, label: 'Attack', setter: null, fmtVal: v => fmtFade(v) },
      'card-release': { prop: 'releaseTime', min: 0, max: 4, label: 'Release', setter: null, fmtVal: v => fmtFade(v) },
      'card-xfade': { prop: 'crossfadeTime', min: 0, max: 4, label: 'X-Fade', setter: null, fmtVal: v => fmtFade(v) },
      'card-loopstart': { prop: 'loopStart', min: 0, max: 1, label: 'Start', setter: null, fmtVal: v => (+v).toFixed(3) + 's' },
      'card-loopend': { prop: 'loopEnd', min: 0, max: 1, label: 'End', setter: null, fmtVal: v => (+v).toFixed(3) + 's' },
      'card-filepos': { prop: 'filePosition', min: 0, max: 1, label: 'FilePos', setter: 'setFilePosition', fmtVal: v => (+v).toFixed(3) + 's' },
      'card-ps': { prop: '_psSlider', min: 0, max: 100, label: 'PaulStr', setter: null, fmtVal: v => { const r = Math.pow(200, v / 100); return v < 0.25 ? 'Off' : (r < 10 ? r.toFixed(1) : Math.round(r)) + '×'; } },
      'card-vol': { prop: '_currentDb', min: -60, max: 6, label: 'Volume', setter: 'setVolPos', fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'card-pan': { prop: '_currentPan', min: -1, max: 1, label: 'Pan', setter: 'setPanPos', fmtVal: v => v < -0.01 ? 'L' + Math.round(-v * 100) : v > 0.01 ? 'R' + Math.round(v * 100) : 'C' },
      // FX & EQ
      // Reverb (multi-mode) — targets fxLfoNode (the actual reverb node, not shimmerInput)
      'fx-r-roomsize': { prop: 'roomSize',  min: 0,   max: 1,     label: 'Room Size', isFx: true },
      'fx-r-damping':  { prop: 'dampening', min: 200, max: 10000, label: 'Damping',   isFx: true },
      'fx-r-wet':      { prop: 'wet',       min: 0,   max: 1,     label: 'Rev Wet',   isFx: true },
      'fx-r-decay':    { prop: 'decay',     min: 0.1, max: 30,    label: 'Decay',     isFx: true },  // algorithmic mode
      'fx-r-shimamt':  { prop: 'shimmerAmount', min: 0, max: 0.95, label: 'Shimmer',  isFx: true },
      // Delay (multi-mode)
      'fx-d-time':     { prop: 'delayTime', min: 0, max: 2,    label: 'Dly Time',  isFx: true },
      'fx-d-fb':       { prop: 'feedback',  min: 0, max: 0.99, label: 'Feedback',  isFx: true },
      'fx-d-wet':      { prop: 'wet',       min: 0, max: 1,    label: 'Dly Wet',   isFx: true },
      'fx-d-filtfreq': { prop: 'frequency', min: 100, max: 12000, label: 'Filt Hz', isFx: true }, // filtered mode — targets feedbackFilter via fxLfoNode
      'fx-tr-rate': { prop: 'frequency', min: 0.1, max: 20, label: 'Rate', isFx: true },
      'fx-tr-depth': { prop: 'depth', min: 0, max: 1, label: 'Depth', isFx: true },
      'fx-tr-wet': { prop: 'wet', min: 0, max: 1, label: 'Wet', isFx: true },
      'fx-di-drive': { prop: 'distortion', min: 0, max: 1, label: 'Drive', isFx: true },
      'fx-di-wet': { prop: 'wet', min: 0, max: 1, label: 'Wet', isFx: true },
      // MOD - phaser mode
      'fx-mod-ph-rate': { prop: 'phFrequency', min: 0.1, max: 20, label: 'PH Rate', isFx: true },
      'fx-mod-ph-oct':  { prop: 'phOctaves',   min: 0, max: 8, label: 'Octaves', isFx: true },
      'fx-mod-ph-base': { prop: 'phBase',       min: 100, max: 4000, label: 'Base Hz', isFx: true },
      // MOD - chorus mode
      'fx-mod-ch-rate':  { prop: 'chFrequency', min: 0.1, max: 10, label: 'CH Rate', isFx: true },
      'fx-mod-ch-dly':   { prop: 'chDelay',     min: 2, max: 20, label: 'Delay', isFx: true },
      'fx-mod-ch-depth': { prop: 'chDepth',     min: 0, max: 1, label: 'Depth', isFx: true },
      // MOD - flanger mode
      'fx-mod-fl-rate':  { prop: 'flFrequency', min: 0.1, max: 10, label: 'FL Rate', isFx: true },
      'fx-mod-fl-depth': { prop: 'flDepth',     min: 0, max: 0.015, label: 'FL Depth', isFx: true },
      'fx-mod-fl-fb':    { prop: 'flFeedback',  min: 0, max: 0.9, label: 'Feedback', isFx: true },
      // MOD - shared wet
      'fx-mod-wet': { prop: 'wet', min: 0, max: 1, label: 'MOD Wet', isFx: true },
      // FLTR
      'fx-flt-cutoff': { prop: 'frequency', min: 20, max: 20000, label: 'Cutoff', isFx: true },
      'fx-flt-reso':   { prop: 'Q',         min: 0.1, max: 20, label: 'Resonance', isFx: true },
      'fx-bc-bits': { prop: 'bits', min: 1, max: 16, label: 'Bits', isFx: true },
      'fx-bc-wet': { prop: 'wet', min: 0, max: 1, label: 'Wet', isFx: true },
      'eq-hp-freq': { prop: 'freq', min: 20, max: 20000, label: 'HP Freq', isEq: true, bandIdx: 0 },
      'eq-pk1-freq': { prop: 'freq', min: 40, max: 10000, label: 'Pk1 Freq', isEq: true, bandIdx: 1 },
      'eq-pk2-freq': { prop: 'freq', min: 100, max: 18000, label: 'Pk2 Freq', isEq: true, bandIdx: 2 },
      'eq-pk3-freq': { prop: 'freq', min: 200, max: 20000, label: 'Pk3 Freq', isEq: true, bandIdx: 3 },
      'eq-lp-freq': { prop: 'freq', min: 20, max: 20000, label: 'LP Freq', isEq: true, bandIdx: 4 },
      // Granular params
      'card-grain-position': { prop: 'grainPosition', min: 0, max: 1, label: 'GrPos',     setter: 'setGrainPosition', fmtVal: v => Math.round(v * 100) + '%', isGran: true },
      'card-grain-spread':   { prop: 'grainSpread',   min: 0, max: 1, label: 'GrSpread',  setter: 'setGrainSpread',   fmtVal: v => Math.round(v * 100) + '%', isGran: true },
      'card-grain-density':  { prop: 'grainDensity',  min: 0, max: 1, label: 'GrDensity', setter: 'setGrainDensity',  fmtVal: v => Math.round(v * 100) + '%', isGran: true },
      // Wavetable synth params
      'wt-d1':     { prop: 'detune1',      min: -50,   max: 50,  label: 'Detune1',   isSynth: true, updater: 'updateDetune', fmtVal: v => parseFloat(v).toFixed(1) + ' ct' },
      'wt-d2':     { prop: 'detune2',      min: -50,   max: 50,  label: 'Detune2',   isSynth: true, updater: 'updateDetune', fmtVal: v => parseFloat(v).toFixed(1) + ' ct' },
      'wt-width':  { prop: 'width',        min: 0,     max: 1,   label: 'Width',     isSynth: true, fmtVal: v => Math.round(v*100)+'%' },
      'wt-cutoff': { prop: 'cutoff',       min: 0,     max: 1,   label: 'Cutoff',    isSynth: true, updater: 'updateFilter', fmtVal: v => { const hz=20*Math.pow(2,v*10); return hz>=1000?(hz/1000).toFixed(1)+' kHz':Math.round(hz)+' Hz'; } },
      'wt-reso':   { prop: 'resonance',    min: 0.1,   max: 20,  label: 'Reso',      isSynth: true, updater: 'updateFilter', fmtVal: v => parseFloat(v).toFixed(1) },
      'wt-envamt': { prop: 'envAmount',    min: 0,     max: 1,   label: 'EnvAmt',    isSynth: true, fmtVal: v => Math.round(v*100)+'%' },
      'wt-fatk':   { prop: 'filterAttack', min: 0.001, max: 5,   label: 'FiltAtk',   isSynth: true, fmtVal: v => fmtFade(v) },
      'wt-fdec':   { prop: 'filterDecay',  min: 0.001, max: 5,   label: 'FiltDec',   isSynth: true, fmtVal: v => fmtFade(v) },
      'wt-atk':    { prop: 'attack',       min: 0.001, max: 5,   label: 'Attack',    isSynth: true, fmtVal: v => fmtFade(v) },
      'wt-dec':    { prop: 'decay',        min: 0.001, max: 5,   label: 'Decay',     isSynth: true, fmtVal: v => fmtFade(v) },
      'wt-sus':    { prop: 'sustain',      min: 0,     max: 1,   label: 'Sustain',   isSynth: true, fmtVal: v => Math.round(v*100)+'%' },
      'wt-rel':    { prop: 'release',      min: 0.001, max: 8,   label: 'Release',   isSynth: true, fmtVal: v => fmtFade(v) },
      // Synth mixer params
      'synth-vol': { prop: '_currentDb',  min: -60, max: 6,  label: 'Volume', isSynth: true, updater: '_applyVol', fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'synth-pan': { prop: '_currentPan', min: -1,  max: 1,  label: 'Pan',    isSynth: true, updater: '_applyPan', fmtVal: v => parseFloat(v).toFixed(2) },
      // Analog synth params
      'sc-atk':   { prop: 'attack',      min: 0.001, max: 5,     label: 'Attack',    isSynth: true, updater: 'updateEnvelope', fmtVal: v => fmtFade(v) },
      'sc-dec':   { prop: 'decay',       min: 0.001, max: 5,     label: 'Decay',     isSynth: true, updater: 'updateEnvelope', fmtVal: v => fmtFade(v) },
      'sc-sus':   { prop: 'sustain',     min: 0,     max: 1,     label: 'Sustain',   isSynth: true, updater: 'updateEnvelope', fmtVal: v => Math.round(v * 100) + '%' },
      'sc-rel':   { prop: 'release',     min: 0.001, max: 8,     label: 'Release',   isSynth: true, updater: 'updateEnvelope', fmtVal: v => fmtFade(v) },
      'sc-ffreq': { prop: 'filterFreq',  min: 20,    max: 20000, label: 'Cutoff',    isSynth: true, updater: 'updateFilter',   fmtVal: v => v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz' },
      'sc-fq':    { prop: 'filterQ',     min: 0.01,  max: 20,    label: 'Reso',      isSynth: true, updater: 'updateFilter',   fmtVal: v => v.toFixed(2) },
      // FM synth params
      'fm-harm':  { prop: 'harmonicity',     min: 0.1, max: 20, label: 'Harmonicity',  isSynth: true, updater: 'updateFMParams', fmtVal: v => v.toFixed(2) },
      'fm-modi':  { prop: 'modulationIndex', min: 0,   max: 20, label: 'Mod Index',    isSynth: true, updater: 'updateFMParams', fmtVal: v => v.toFixed(1) },
      'fm-atk':   { prop: 'attack',      min: 0.001, max: 5, label: 'Car. Attack',  isSynth: true, updater: 'updateEnvelope', fmtVal: v => fmtFade(v) },
      'fm-dec':   { prop: 'decay',       min: 0.001, max: 5, label: 'Car. Decay',   isSynth: true, updater: 'updateEnvelope', fmtVal: v => fmtFade(v) },
      'fm-sus':   { prop: 'sustain',     min: 0,     max: 1, label: 'Car. Sustain', isSynth: true, updater: 'updateEnvelope', fmtVal: v => Math.round(v * 100) + '%' },
      'fm-rel':   { prop: 'release',     min: 0.001, max: 8, label: 'Car. Release', isSynth: true, updater: 'updateEnvelope', fmtVal: v => fmtFade(v) },
      'fm-matk':  { prop: 'modAttack',   min: 0.001, max: 5, label: 'Mod. Attack',  isSynth: true, updater: 'updateModEnv',   fmtVal: v => fmtFade(v) },
      'fm-mdec':  { prop: 'modDecay',    min: 0.001, max: 5, label: 'Mod. Decay',   isSynth: true, updater: 'updateModEnv',   fmtVal: v => fmtFade(v) },
      'fm-msus':  { prop: 'modSustain',  min: 0,     max: 1, label: 'Mod. Sustain', isSynth: true, updater: 'updateModEnv',   fmtVal: v => Math.round(v * 100) + '%' },
      'fm-mrel':  { prop: 'modRelease',  min: 0.001, max: 8, label: 'Mod. Release', isSynth: true, updater: 'updateModEnv',   fmtVal: v => fmtFade(v) },
      // Karplus-Strong synth params
      'kp-charvar':   { prop: 'characterVariation',    min: 0, max: 1, label: 'Char Var',  isSynth: true, fmtVal: v => parseFloat(v).toFixed(2) },
      'kp-sdamp':     { prop: 'stringDamping',         min: 0, max: 1, label: 'Str Damp',  isSynth: true, fmtVal: v => parseFloat(v).toFixed(2) },
      'kp-sdampvar':  { prop: 'stringDampingVariation',min: 0, max: 1, label: 'StrDmpVar', isSynth: true, fmtVal: v => parseFloat(v).toFixed(2) },
      'kp-pdamp':     { prop: 'pluckDamping',          min: 0, max: 1, label: 'Plk Damp',  isSynth: true, fmtVal: v => parseFloat(v).toFixed(2) },
      'kp-pdampvar':  { prop: 'pluckDampingVariation', min: 0, max: 1, label: 'PlkDmpVar', isSynth: true, fmtVal: v => parseFloat(v).toFixed(2) },
      'kp-tension':   { prop: 'stringTension',         min: 0, max: 1, label: 'Tension',   isSynth: true, fmtVal: v => parseFloat(v).toFixed(2) },
      'kp-spread':    { prop: 'stereoSpread',          min: 0, max: 1, label: 'Spread',    isSynth: true, fmtVal: v => parseFloat(v).toFixed(2) },
      // Rompler params
      'rm-ffreq': { prop: 'filterFreq', min: 20, max: 20000, label: 'Cutoff',  isSynth: true, updater: 'updateFilter', fmtVal: v => v >= 1000 ? (v/1000).toFixed(1)+' kHz' : Math.round(v)+' Hz' },
      'rm-fq':    { prop: 'filterQ',   min: 0.01, max: 20,  label: 'Reso',    isSynth: true, updater: 'updateFilter', fmtVal: v => parseFloat(v).toFixed(2) },
      'rm-rel':   { prop: 'release',   min: 0.01, max: 10,  label: 'Release', isSynth: true, fmtVal: v => fmtFade(v) },
      // Glide / portamento (all synth types)
      'sc-glide': { prop: 'portamento', min: 0, max: 1, label: 'Glide', isSynth: true, updater: 'updatePortamento', fmtVal: v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v)) },
      'fm-glide': { prop: 'portamento', min: 0, max: 1, label: 'Glide', isSynth: true, updater: 'updatePortamento', fmtVal: v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v)) },
      // DX7 voice override params
      'dx7-algorithm': { prop: 'fmAlgorithmOverride', min: 1, max: 32, label: 'DX7 Alg',     isSynth: true, updater: 'updateFMVoiceParam', fmtVal: v => 'Alg ' + Math.round(v) },
      'dx7-feedback':  { prop: 'fmFeedbackOverride',  min: 0, max: 7,  label: 'DX7 Feedback', isSynth: true, updater: 'updateFMVoiceParam', fmtVal: v => 'FB ' + parseFloat(v).toFixed(1) },
      'dx7-modlevel':  { prop: 'fmModLevel',          min: 0, max: 2,  label: 'DX7 Mod Dep', isSynth: true, updater: 'updateFMVoiceParam', fmtVal: v => parseFloat(v).toFixed(2) + '×' },
      // DX7 post-filter params
      'dx7-cutoff':    { prop: 'fmFilterFreq', min: 20,   max: 20000, label: 'DX7 Cutoff', isSynth: true, updater: 'updateFMFilter', fmtVal: v => v >= 1000 ? (v/1000).toFixed(1)+' kHz' : Math.round(v)+' Hz' },
      'dx7-reso':      { prop: 'fmFilterQ',    min: 0.01, max: 20,    label: 'DX7 Reso',   isSynth: true, updater: 'updateFMFilter', fmtVal: v => parseFloat(v).toFixed(2) },
      'wt-glide': { prop: 'portamento', min: 0, max: 1, label: 'Glide', isSynth: true, updater: 'updatePortamento', fmtVal: v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v)) },
      'kp-glide': { prop: 'portamento', min: 0, max: 1, label: 'Glide', isSynth: true, updater: 'updatePortamento', fmtVal: v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v)) },
      'rm-glide': { prop: 'portamento', min: 0, max: 1, label: 'Glide', isSynth: true, updater: 'updatePortamento', fmtVal: v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v)) },
      // Drum machine global params
      'dm-swing': { prop: 'swing',   min: 0,    max: 0.5, label: 'Swing', isDrumDirect: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-nudge': { prop: 'nudgeMs', min: -500, max: 500, label: 'Nudge', isDrumDirect: true, fmtVal: v => (Math.round(v) >= 0 ? '+' : '') + Math.round(v) + ' ms' },
      // Drum machine per-lane velocity scale params (10 lanes)
      'dm-vel-kick':      { prop: 'laneVelScales', subProp: 'kick',      min: 0, max: 2, label: 'Kick Vel',    isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-snare':     { prop: 'laneVelScales', subProp: 'snare',     min: 0, max: 2, label: 'Snare Vel',   isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-clap':      { prop: 'laneVelScales', subProp: 'clap',      min: 0, max: 2, label: 'Clap Vel',    isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-rim':       { prop: 'laneVelScales', subProp: 'rim',       min: 0, max: 2, label: 'Rim Vel',     isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-hh_closed': { prop: 'laneVelScales', subProp: 'hh_closed', min: 0, max: 2, label: 'CH Vel',      isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-hh_open':   { prop: 'laneVelScales', subProp: 'hh_open',   min: 0, max: 2, label: 'OH Vel',      isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-tom_hi':    { prop: 'laneVelScales', subProp: 'tom_hi',    min: 0, max: 2, label: 'Tom H Vel',   isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-tom_low':   { prop: 'laneVelScales', subProp: 'tom_low',   min: 0, max: 2, label: 'Tom L Vel',   isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-cowbell':   { prop: 'laneVelScales', subProp: 'cowbell',   min: 0, max: 2, label: 'Cowbell Vel', isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      'dm-vel-ride':      { prop: 'laneVelScales', subProp: 'ride',      min: 0, max: 2, label: 'Ride Vel',    isDrum: true, fmtVal: v => Math.round(v * 100) + '%' },
      // Drum machine pitch params (10 lanes)
      'dm-pitch-kick':      { prop: 'pitches', subProp: 'kick',      min: -12, max: 12, label: 'Kick Pitch',    isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-snare':     { prop: 'pitches', subProp: 'snare',     min: -12, max: 12, label: 'Snare Pitch',   isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-clap':      { prop: 'pitches', subProp: 'clap',      min: -12, max: 12, label: 'Clap Pitch',    isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-rim':       { prop: 'pitches', subProp: 'rim',       min: -12, max: 12, label: 'Rim Pitch',     isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-hh_closed': { prop: 'pitches', subProp: 'hh_closed', min: -12, max: 12, label: 'CH Pitch',      isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-hh_open':   { prop: 'pitches', subProp: 'hh_open',   min: -12, max: 12, label: 'OH Pitch',      isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-tom_hi':    { prop: 'pitches', subProp: 'tom_hi',    min: -12, max: 12, label: 'Tom H Pitch',   isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-tom_low':   { prop: 'pitches', subProp: 'tom_low',   min: -12, max: 12, label: 'Tom L Pitch',   isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-cowbell':   { prop: 'pitches', subProp: 'cowbell',   min: -12, max: 12, label: 'Cowbell Pitch', isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      'dm-pitch-ride':      { prop: 'pitches', subProp: 'ride',      min: -12, max: 12, label: 'Ride Pitch',    isDrum: true, fmtVal: v => (v >= 0 ? '+' : '') + Math.round(v) + ' st' },
      // Drum machine lane volume params (10 lanes)
      'dm-lvol-kick':      { prop: 'laneVols', subProp: 'kick',      min: -40, max: 6, label: 'Kick Vol',    isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-snare':     { prop: 'laneVols', subProp: 'snare',     min: -40, max: 6, label: 'Snare Vol',   isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-clap':      { prop: 'laneVols', subProp: 'clap',      min: -40, max: 6, label: 'Clap Vol',    isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-rim':       { prop: 'laneVols', subProp: 'rim',       min: -40, max: 6, label: 'Rim Vol',     isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-hh_closed': { prop: 'laneVols', subProp: 'hh_closed', min: -40, max: 6, label: 'CH Vol',      isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-hh_open':   { prop: 'laneVols', subProp: 'hh_open',   min: -40, max: 6, label: 'OH Vol',      isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-tom_hi':    { prop: 'laneVols', subProp: 'tom_hi',    min: -40, max: 6, label: 'Tom H Vol',   isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-tom_low':   { prop: 'laneVols', subProp: 'tom_low',   min: -40, max: 6, label: 'Tom L Vol',   isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-cowbell':   { prop: 'laneVols', subProp: 'cowbell',   min: -40, max: 6, label: 'Cowbell Vol', isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
      'dm-lvol-ride':      { prop: 'laneVols', subProp: 'ride',      min: -40, max: 6, label: 'Ride Vol',    isDrum: true, fmtVal: v => parseFloat(v).toFixed(1) + ' dB' },
    };

    // LFO preset shape generators (return breakpoint arrays [{x:0..1, y:0..1}])
    const LFO_PRESETS = {
      sine: () => {
        const pts = [];
        for (let i = 0; i <= 32; i++) {
          const x = i / 32;
          pts.push({ x, y: 0.5 + 0.5 * Math.sin(x * Math.PI * 2) });
        }
        return pts;
      },
      square: () => [
        { x: 0, y: 1 }, { x: 0.499, y: 1 }, { x: 0.5, y: 0 }, { x: 0.999, y: 0 }, { x: 1, y: 1 }
      ],
      triangle: () => [
        { x: 0, y: 0.5 }, { x: 0.25, y: 1 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0 }, { x: 1, y: 0.5 }
      ],
      random: () => {
        const pts = [{ x: 0, y: Math.random() }];
        const n = 8 + Math.floor(Math.random() * 8);
        for (let i = 1; i < n; i++) pts.push({ x: i / n, y: Math.random() });
        pts.push({ x: 1, y: pts[0].y }); // loop-friendly
        return pts;
      },
      blank: () => [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]
    };

    class LFO {
      constructor(id, x, y) {
        this.id = id;
        this.name = 'LFO ' + id;
        this.x = x; this.y = y;
        this.color = nextLfoColor();
        this.shape = LFO_PRESETS.sine(); // default sine
        this.rate = 2; // seconds per cycle
        this.gridSync = false;
        this.subdiv = 1; // same scale as sample grid (1 = 1 bar)
        this.destinations = []; // { sampleId, param, min, max }
        this._phase = 0;
        this._lastTime = performance.now() / 1000;
        this._activePreset = 'sine';
      }

      evaluate(phase) {
        const pts = this.shape;
        if (!pts || pts.length < 2) return 0.5;
        const p = phase % 1;
        for (let i = 0; i < pts.length - 1; i++) {
          if (p >= pts[i].x && p <= pts[i + 1].x) {
            const seg = pts[i + 1].x - pts[i].x;
            if (seg < 0.0001) return pts[i].y;
            const t = (p - pts[i].x) / seg;
            return pts[i].y + t * (pts[i + 1].y - pts[i].y);
          }
        }
        return pts[pts.length - 1].y;
      }

      // Get cycle duration based on mode
      getCycleDuration() {
        if (this.gridSync) {
          const bpm = Tone.Transport.bpm.value;
          const beatSec = 60 / bpm;
          const barSec = beatSec * 4;
          return barSec / this.subdiv;
        }
        return this.rate;
      }

      tick(now) {
        const dt = now - this._lastTime;
        this._lastTime = now;
        if (dt <= 0 || dt > 1) return; // skip huge jumps
        const cycleDur = this.getCycleDuration();
        if (cycleDur > 0) {
          this._phase += dt / cycleDur;
          if (this._phase >= 1) this._phase -= Math.floor(this._phase);
        }
      }

      resetPhase() {
        this._phase = 0;
        this._lastTime = performance.now() / 1000;
      }

      addDestination(sampleId, param, min, max, fxUid) {
        // Don't duplicate
        if (this.destinations.find(d => d.sampleId === sampleId && d.param === param && d.fxUid === fxUid)) return;
        this.destinations.push({ sampleId, param, min, max, fxUid });
      }

      removeDestination(sampleId, param, fxUid) {
        this.destinations = this.destinations.filter(d => !(d.sampleId === sampleId && d.param === param && d.fxUid === fxUid));
      }

    }

    // Check if a parameter is being modulated by any LFO
    function isParamModulated(sampleId, paramClass, fxUid = null) {
      for (const [, lfo] of lfos) {
        for (const d of lfo.destinations) {
          if (d.sampleId === sampleId && d.param === paramClass && d.fxUid === fxUid) return lfo;
        }
      }
      return null;
    }
