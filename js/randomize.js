    // ════════════════════════════════════════════════════
    // RANDOMIZATION ENGINE — Riff & Chords
    // ════════════════════════════════════════════════════

    function weightedRandom(items, weights) {
      let total = 0;
      for (const w of weights) total += w;
      let r = Math.random() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    }

    // Consonance weight by semitone interval from tonic — works for any scale
    const CONSONANCE_MAP = { 0:5, 7:4, 4:3, 3:3, 9:2.5, 8:2.5, 5:2, 2:1.5, 10:1.5, 11:1, 1:1, 6:1 };

    function subdivToStepsPerBar(subdiv) {
      const s = (subdiv || '16n').replace(/[.t]$/, '');
      return { '1n':1, '2n':2, '4n':4, '8n':8, '16n':16, '32n':32 }[s] || 16;
    }

    // Beat strength for a step position in the bar (1.0 = beat 1, down to ~0.18 for off-beats)
    function getBeatStrength(stepIdx, stepsPerBar) {
      if (stepsPerBar <= 1) return 1.0;
      const pos = stepIdx % stepsPerBar;
      if (pos === 0)                                                        return 1.0;
      if (pos === stepsPerBar / 2)                                          return 0.72;
      if (stepsPerBar >= 4  && pos % (stepsPerBar / 4)  === 0)             return 0.50;
      if (stepsPerBar >= 8  && pos % (stepsPerBar / 8)  === 0)             return 0.35;
      if (stepsPerBar >= 16 && pos % (stepsPerBar / 16) === 0)             return 0.22;
      return 0.18;
    }

    // Build note candidates with separate oct and consonance weight arrays.
    // octSpread 0 = only octave 4, 1.0 = full 3-octave spread with center bias.
    function _buildRiffCandidates(riff, octSpread) {
      const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
      const rootPC  = NM[riff.scaleRoot] ?? 0;
      const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
      const mode      = riff.randMode || 'musical';
      const outerW    = (octSpread ?? 1.0); // 0 = center only, 1 = full spread

      const notes = [], octWeights = [], consWeights = [];
      const OCT_W = [outerW, 3, outerW]; // [oct3, oct4, oct5]

      for (let oi = 0; oi < 3; oi++) {
        const oct = oi + 3;
        const ow  = Math.max(0, OCT_W[oi]);
        if (ow < 0.001 && oi !== 1) continue;
        for (const interval of intervals) {
          const pc       = (rootPC + interval) % 12;
          const noteName = RIFF_NOTE_NAMES[pc] + oct;
          const midi     = noteToSemis(noteName);
          if (midi < 12 || midi > 107) continue;

          const cw = mode === 'neutral'  ? 1
                   : mode === 'musical'  ? (CONSONANCE_MAP[interval] ?? 1)
                   : (6 - (CONSONANCE_MAP[interval] ?? 1)); // chaotic: invert

          notes.push(noteName);
          octWeights.push(Math.max(0.01, oi === 1 ? 3 : ow));
          consWeights.push(Math.max(0.01, cw));
        }
      }
      return { notes, octWeights, consWeights };
    }

    // Pick one note, applying stepwise bias, direction momentum, and beat-strength consonance boost.
    function _pickNoteForStep(notes, octWeights, consWeights, prevMidi, prevDirection, mode, beatStr) {
      // On strong beats, sharpen consonance preference by raising it to a higher power
      const beatBoost = mode === 'musical' ? (beatStr - 0.2) * 1.4 : 0;
      const stepBias  = mode === 'musical' ? 4.0 : 0.5;

      const weights = notes.map((note, i) => {
        const midi = noteToSemis(note);
        let w = octWeights[i] * Math.pow(consWeights[i], 1 + beatBoost);

        if (prevMidi !== null) {
          const dist = Math.abs(midi - prevMidi);
          if (dist === 0) return 0.25 * w; // avoid exact repeat

          const isStep = dist <= 3;
          if (mode === 'musical') {
            w *= isStep ? (1 + stepBias) : Math.max(0.08, 1 - stepBias * 0.25);
            // Direction momentum: keep moving in the same direction for a couple steps
            if (prevDirection !== 0) {
              const dir = Math.sign(midi - prevMidi);
              w *= dir === prevDirection ? 1.5 : (dir === -prevDirection ? 0.55 : 0.85);
            }
          } else if (mode === 'chaotic') {
            w *= isStep ? Math.max(0.08, 1 - stepBias) : (1 + stepBias);
          }
        }

        return Math.max(0.01, w);
      });

      return weightedRandom(notes, weights);
    }

    function rollRiffMelody(riff) {
      const density      = riff.randDensity ?? 0.6;
      const mode         = riff.randMode    || 'musical';
      const stepsPerBar  = subdivToStepsPerBar(riff.subdiv);
      const { notes, octWeights, consWeights } = _buildRiffCandidates(riff, riff.randOctSpread ?? 1.0);
      if (!notes.length) return;

      function rollSteps(steps, numSteps, isOrbit) {
        // Pre-compute raw beat strengths for the whole pattern
        const rawBeat = Array.from({length: numSteps}, (_, i) => isOrbit
          ? (i === 0 ? 1.0 : i % 2 === 0 ? 0.55 : 0.28)
          : getBeatStrength(i, stepsPerBar));

        // Normalize so the average beat weight = 1.0.
        // This means density directly equals the expected fill fraction:
        // 50% density → ~50% of steps active, 100% → ~all steps active.
        // (Clamping at 1.0 means very strong beats hit 100% first, which is fine.)
        const avgBeat = rawBeat.reduce((s, v) => s + v, 0) / numSteps;

        let prevMidi = null, prevDirection = 0;
        for (let i = 0; i < numSteps; i++) {
          const beatStr  = rawBeat[i];
          const stepProb = mode === 'musical'
            ? Math.min(1.0, density * (beatStr / avgBeat))
            : density;

          if (Math.random() > stepProb) {
            steps[i].note = null;
            prevDirection = 0;
          } else {
            const note    = _pickNoteForStep(notes, octWeights, consWeights, prevMidi, prevDirection, mode, beatStr);
            const newMidi = noteToSemis(note);
            prevDirection = prevMidi !== null ? Math.sign(newMidi - prevMidi) : 0;
            prevMidi      = newMidi;
            steps[i].note = note;
          }
        }
      }

      if (riff.seqMode === 'grid') {
        rollSteps(riff.steps, riff.numSteps, false);
      } else {
        for (let r = 0; r < riff.orbitNumRings; r++) {
          const ring = riff.orbitRings[r];
          rollSteps(ring.steps, ring.numSteps, true);
        }
      }
    }

    // randOctSpread: 0 = only center octave, 1.0 = full spread (current behavior)
    function rollRiffOctaves(riff) {
      const spread  = riff.randOctSpread ?? 1.0;
      const outerW  = spread;
      const allOcts = [3, 4, 5];
      const allW    = [outerW, 3, outerW];
      const validOcts = allOcts.filter((_, i) => allW[i] > 0.001);
      const validW    = allW.filter(w => w > 0.001);

      function reassign(step) {
        if (!step.note) return;
        const m = step.note.match(/^([A-G]#?)(\d+)$/);
        if (m) step.note = m[1] + weightedRandom(validOcts, validW);
      }

      if (riff.seqMode === 'grid') {
        for (let i = 0; i < riff.numSteps; i++) reassign(riff.steps[i]);
      } else {
        for (let r = 0; r < riff.orbitNumRings; r++) {
          const ring = riff.orbitRings[r];
          for (let i = 0; i < ring.numSteps; i++) reassign(ring.steps[i]);
        }
      }
    }

    // randVelRange: 0 = all notes at vel 1.0 (no variation), 1.0 = full 0.2–1.0 span
    function rollRiffVelocities(riff) {
      const range  = riff.randVelRange ?? 1.0;
      const span   = range * 0.8;
      const minVel = 1.0 - span;

      function roll(step) {
        if (step.note) step.vel = Math.round((minVel + Math.random() * span) * 100) / 100;
      }

      if (riff.seqMode === 'grid') {
        for (let i = 0; i < riff.numSteps; i++) roll(riff.steps[i]);
      } else {
        for (let r = 0; r < riff.orbitNumRings; r++) {
          const ring = riff.orbitRings[r];
          for (let i = 0; i < ring.numSteps; i++) roll(ring.steps[i]);
        }
      }
    }

    // randGlideAmount: 0 = no glide, 1.0 = 30% chance + up to 300ms (current max)
    function rollRiffGlide(riff) {
      const amount = riff.randGlideAmount ?? 1.0;
      const chance = amount * 0.3;
      const maxMs  = 20 + amount * 280;

      function roll(step) {
        if (!step.note) return;
        step.slide   = Math.random() < chance;
        step.glideMs = step.slide ? Math.round(20 + Math.random() * (maxMs - 20)) : 50;
      }

      if (riff.seqMode === 'grid') {
        for (let i = 0; i < riff.numSteps; i++) roll(riff.steps[i]);
      } else {
        for (let r = 0; r < riff.orbitNumRings; r++) {
          const ring = riff.orbitRings[r];
          for (let i = 0; i < ring.numSteps; i++) roll(ring.steps[i]);
        }
      }
    }

    function rollChords(chordsInst) {
      // Slider 0–1 maps to 0–50% of slots filled (good harmonic rhythm stays sparse).
      // This makes the percent on the slider proportional within that range.
      const slotDensity = (chordsInst.randDensity ?? 0.7) * 0.5;
      const variety     = chordsInst.randVariety ?? 0.5;
      const numSteps    = chordsInst.numSteps;

      // Clear all steps first
      for (let i = 0; i < numSteps; i++) {
        chordsInst.steps[i].enabled = false;
        chordsInst.steps[i].tokenId = null;
      }

      // minDur=2 gives ~8 slots for 16 steps → 50% fill = ~4 chords (one per bar at 16n)
      const minDur = Math.max(2, Math.floor(numSteps / 8));

      function pickChord(allPrev) {
        const prevTokenId = allPrev.length > 0 ? allPrev[allPrev.length - 1] : null;
        const recs = getChordsRecommendations(prevTokenId, [...allPrev], chordsInst.scaleRoot, chordsInst.scale, chordsInst.genre, chordsInst.decade);
        if (!recs.length) return null;
        const numChoices = Math.max(1, Math.min(recs.length, Math.round(1 + variety * (recs.length - 1))));
        const pool    = recs.slice(0, numChoices);
        const power   = 1 + (1 - variety) * 3;
        const weights = pool.map(r => Math.pow(Math.max(0.01, r.score), power));
        return weightedRandom(pool, weights).token;
      }

      const allPrev = [];
      const slotStarts = [];
      let pos = 0;
      while (pos < numSteps) {
        const remaining = numSteps - pos;
        const maxJitter = Math.max(0, Math.floor(variety * minDur));
        const dur = Math.min(remaining, minDur + Math.floor(Math.random() * (maxJitter + 1)));

        if (Math.random() < slotDensity) {
          const token = pickChord(allPrev);
          if (token) {
            chordsInst.steps[pos].enabled = true;
            chordsInst.steps[pos].tokenId = token.id;
            allPrev.push(token.id);
            slotStarts.push(pos);
          }
        } else {
          slotStarts.push(pos); // track empty slots for fallback
        }

        pos += dur;
      }

      // Guarantee at least one chord — fill the first slot if nothing was placed
      if (allPrev.length === 0 && slotStarts.length > 0) {
        const fillPos = slotStarts[0];
        const token = pickChord([]);
        if (token) {
          chordsInst.steps[fillPos].enabled = true;
          chordsInst.steps[fillPos].tokenId = token.id;
        }
      }
    }
