    // ════════════════════════════════════════════════════
    // PROJECT SAVE / LOAD
    // ════════════════════════════════════════════════════
    function audioBufferToWavBase64(buffer) {
      const numCh = buffer.numberOfChannels;
      const sr = buffer.sampleRate;
      const len = buffer.length;
      const byteRate = sr * numCh * 2;
      const blockAlign = numCh * 2;
      const dataSize = len * numCh * 2;
      const ab = new ArrayBuffer(44 + dataSize);
      const view = new DataView(ab);
      const ws = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
      ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
      ws(8, 'WAVE'); ws(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
      view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      ws(36, 'data'); view.setUint32(40, dataSize, true);
      let off = 44;
      for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < numCh; ch++) {
          const v = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
          view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
          off += 2;
        }
      }
      const bytes = new Uint8Array(ab);
      let bin = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk)
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
      return btoa(bin);
    }

    function saveProject() {
      const projectData = { version: 1, bpm: Tone.Transport.bpm.value, globalTranspose, samples: [], synths: [], lfos: [], riffs: [], drums: [], chords: [] };
      for (const [, s] of samples) {
        if (!(s instanceof Sample)) continue;
        const fxChainData = s.fxChain.map(inst => {
          if (inst.type === 'eq') return { type: 'eq', bands: inst.eqData.bands.map(b => ({ ...b })) };
          return { type: inst.type, params: { ...inst.params }, postFader: !!inst.postFader };
        });
        projectData.samples.push({
          id: s.id,
          name: s.name, x: s.x, y: s.y, color: s.color,
          volDb: s._currentDb, panPos: s._currentPan,
          pitchST: s.pitchST, stretchST: s.stretchST, psStretch: s.psStretch, reversed: s.reversed,
          loopStart: s.loopStart, loopEnd: s.loopEnd, _origLoopEnd: s._origLoopEnd, filePosition: s.filePosition,
          muted: s.muted, gridSync: s.gridSync, subdiv: s.subdiv,
          subdivFactor: s.subdivFactor, gridMulti: s.gridMulti, nudgeMs: s._nudgeMs || 0,
          attackTime: s.attackTime, releaseTime: s.releaseTime,
          crossfadeTime: s.crossfadeTime, clipGainDb: s.clipGainDb,
          triggerMode: s.triggerMode,
          granular: s.granular,
          grainPosition: s.grainPosition, grainSpread: s.grainSpread,
          grainDensity: s.grainDensity, grainAttack: s.grainAttack,
          grainRelease: s.grainRelease, grainPitch: s.grainPitch,
          syncActive: s._syncActive,
          syncBpm: s._syncBpm,
          syncMode: s._syncMode,
          syncRateMult: s._syncRateMult,
          syncFftSize: s._syncFftSize,
          syncOrigLoopStart: s._syncOrigLoopStart,
          syncOrigLoopEnd: s._syncOrigLoopEnd,
          eqBands: s.eqBands.map(b => ({ ...b })),
          fxChain: fxChainData,
          audioB64: audioBufferToWavBase64(s.raw)
        });
      }
      // Save drum machines
      for (const [, drum] of drums) {
        if (!(drum instanceof DrumMachine)) continue;
        const fxChainData = drum.fxChain.map(inst => {
          if (inst.type === 'eq') return { type: 'eq', bands: inst.eqData.bands.map(b => ({ ...b })) };
          return { type: inst.type, params: { ...inst.params }, postFader: !!inst.postFader };
        });
        const patternsData = {};
        const pitchesData  = {};
        for (const n of drum.INSTRUMENTS) {
          patternsData[n] = [...drum.patterns[n]];
          pitchesData[n]  = drum.pitches[n];
        }
        projectData.drums.push({
          id: drum.id, name: drum.name, x: drum.x, y: drum.y, color: drum.color,
          kitId: drum.kitId, kitName: drum.kitName,
          patterns: patternsData, pitches: pitchesData,
          gridSync: drum.gridSync, subdiv: drum.subdiv, rate: drum.rate, numSteps: drum.numSteps,
          volDb: drum._currentDb, panPos: drum._currentPan,
          fxChain: fxChainData,
        });
      }
      // Save synths
      for (const [, synth] of synths) {
        if (!(synth instanceof SynthInstrument)) continue;
        const fxChainData = synth.fxChain.map(inst => {
          if (inst.type === 'eq') return { type: 'eq', bands: inst.eqData.bands.map(b => ({ ...b })) };
          return { type: inst.type, params: { ...inst.params }, postFader: !!inst.postFader };
        });
        const sd = {
          id: synth.id, name: synth.name, x: synth.x, y: synth.y, color: synth.color,
          synthType: synth.synthType, muted: synth.muted,
          volDb: synth._currentDb, panPos: synth._currentPan,
          fxChain: fxChainData,
        };
        if (synth.synthType === 'analog') {
          Object.assign(sd, {
            oscType: synth.oscType, filterType: synth.filterType, filterFreq: synth.filterFreq, filterQ: synth.filterQ,
            attack: synth.attack, decay: synth.decay, sustain: synth.sustain, release: synth.release,
            portamento: synth.portamento, currentPreset: synth.currentPreset,
          });
        } else if (synth.synthType === 'fm') {
          Object.assign(sd, {
            harmonicity: synth.harmonicity, modulationIndex: synth.modulationIndex,
            attack: synth.attack, decay: synth.decay, sustain: synth.sustain, release: synth.release,
            modAttack: synth.modAttack, modDecay: synth.modDecay, modSustain: synth.modSustain, modRelease: synth.modRelease,
            currentPreset: synth.currentPreset, _usingCustom: synth._usingCustom,
            _customPresets: synth._usingCustom ? synth._customPresets.map(p => ({ ...p })) : [],
          });
        } else if (synth.synthType === 'wavetable') {
          Object.assign(sd, {
            currentWave: synth.currentWave, detune1: synth.detune1, detune2: synth.detune2,
            osc2octave: synth.osc2octave, width: synth.width,
            cutoff: synth.cutoff, resonance: synth.resonance, envAmount: synth.envAmount,
            filterAttack: synth.filterAttack, filterDecay: synth.filterDecay,
            attack: synth.attack, decay: synth.decay, sustain: synth.sustain, release: synth.release,
          });
        } else if (synth.synthType === 'karplus') {
          Object.assign(sd, {
            characterVariation: synth.characterVariation, stringDamping: synth.stringDamping,
            stringDampingVariation: synth.stringDampingVariation, stringDampingCalc: synth.stringDampingCalc,
            stringTension: synth.stringTension, pluckDamping: synth.pluckDamping,
            pluckDampingVariation: synth.pluckDampingVariation,
            stereoSpread: synth.stereoSpread, bodyResonation: synth.bodyResonation,
          });
        } else if (synth.synthType === 'rompler') {
          Object.assign(sd, {
            romplerType: synth.romplerType, romplerBank: synth.romplerBank,
            romplerInstrument: synth.romplerInstrument, romplerSf2Url: synth.romplerSf2Url,
            romplerSf2Instrument: synth.romplerSf2Instrument,
            release: synth.release, filterType: synth.filterType, filterFreq: synth.filterFreq, filterQ: synth.filterQ,
          });
        }
        projectData.synths.push(sd);
      }
      // Save LFOs
      for (const [, lfo] of lfos) {
        projectData.lfos.push({
          id: lfo.id, name: lfo.name, x: lfo.x, y: lfo.y, color: lfo.color,
          shape: lfo.shape.map(p => ({ x: p.x, y: p.y })),
          rate: lfo.rate, gridSync: lfo.gridSync, subdiv: lfo.subdiv,
          _activePreset: lfo._activePreset,
          destinations: lfo.destinations.map(d => {
            let fxIdx = null;
            if (d.fxUid != null) {
              const inst = samples.get(d.sampleId) || synths.get(d.sampleId) || drums.get(d.sampleId);
              if (inst) fxIdx = inst.fxChain.findIndex(i => i.uid === d.fxUid);
            }
            return { sampleId: d.sampleId, param: d.param, min: d.min, max: d.max, fxIdx };
          })
        });
      }
      // Save riffs
      for (const [, riff] of riffs) {
        projectData.riffs.push({
          id: riff.id, name: riff.name, x: riff.x, y: riff.y, color: riff.color,
          mode: riff.mode, numSteps: riff.numSteps,
          steps: riff.steps.map(s => ({ ...s })),
          notes: riff.notes.map(n => ({ ...n })),
          subdiv: riff.subdiv, gridSync: riff.gridSync, rate: riff.rate,
          loopBars: riff.loopBars, quantize: riff.quantize,
          scale: riff.scale, scaleRoot: riff.scaleRoot, harmony: riff.harmony,
          destinations: [...riff.destinations]
        });
      }
      // Save chords
      for (const [, ch] of chords) {
        if (!(ch instanceof ChordsSequencer)) continue;
        projectData.chords.push({
          id: ch.id, name: ch.name, x: ch.x, y: ch.y, color: ch.color,
          numSteps: ch.numSteps,
          steps: ch.steps.map(s => ({ tokenId: s.tokenId, enabled: s.enabled })),
          subdiv: ch.subdiv, gridSync: ch.gridSync, rate: ch.rate,
          voicingMode: ch.voicingMode, transposeOffset: ch.transposeOffset, voiceLeading: ch.voiceLeading,
          playMode: ch.playMode, strumSpeed: ch.strumSpeed, strumDir: ch.strumDir,
          arpMode: ch.arpMode, arpRate: ch.arpRate, arpOctaves: ch.arpOctaves, arpHold: ch.arpHold,
          stepArp: ch.stepArp, stepArpSteps: ch.stepArpSteps, stepArpPattern: ch.stepArpPattern.map(col => [...col]),
          scaleRoot: ch.scaleRoot, scale: ch.scale,
          genre: ch.genre, decade: ch.decade,
          destinations: [...ch.destinations]
        });
      }
      const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'frequencer-project.json';
      a.click(); URL.revokeObjectURL(url);
    }

    function applyFxNodeParams(inst) {
      const { type, node, params: p } = inst;
      switch (type) {
        case 'reverb': node.decay = p.decay; node.preDelay = p.preDelay; node.wet.value = p.wet; break;
        case 'delay': node.delayTime.value = p.delayTime; node.feedback.value = p.feedback; node.wet.value = p.wet; break;
        case 'tremolo': node.frequency.value = p.frequency; node.depth.value = p.depth; node.wet.value = p.wet; break;
        case 'dist': node.distortion = p.distortion; node.wet.value = p.wet; break;
        case 'chorus': node.frequency.value = p.frequency; node.delayTime = p.delayTime; node.depth = p.depth; node.wet.value = p.wet; break;
        case 'phaser': node.frequency.value = p.frequency; node.octaves = p.octaves; node.baseFrequency = p.baseFrequency; node.wet.value = p.wet; break;
        case 'bitcrush': node.bits = p.bits; node.wet.value = p.wet; break;
      }
    }

    async function loadProject(jsonText) {
      let data;
      try { data = JSON.parse(jsonText); } catch (e) { alert('Invalid project file.'); return; }
      if (!data.samples) { alert('Not a valid Frequencer project file.'); return; }

      // Clear existing session
      [...samples.keys()].forEach(id => removeSample(id));
      for (const sid of [...synths.keys()]) removeSynth(sid);
      soloId = null;

      // Restore BPM
      if (typeof data.bpm === 'number') {
        Tone.Transport.bpm.value = data.bpm;
        document.getElementById('bpm-val').textContent = Math.round(data.bpm);
      }
      // Restore global transpose
      applyGlobalTranspose(typeof data.globalTranspose === 'number' ? data.globalTranspose : 0);

      // idMap: old saved sample id → new runtime id (for reconnecting LFO/seq cables)
      const idMap = {};

      // Restore samples
      for (const sd of data.samples) {
        if (!sd.audioB64) continue;
        try {
          const bin = atob(sd.audioB64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const decoded = await new Promise((res, rej) =>
            Tone.context.rawContext.decodeAudioData(bytes.buffer, res, rej)
          );
          const id = nextId++;
          if (sd.id != null) idMap[sd.id] = id;
          const s = new Sample(id, sd.name, decoded, sd.x, sd.y);

          // Restore color
          if (sd.color) s.color = sd.color;

          // Restore settings via built-in setters
          s.setPitch(sd.pitchST || 0);
          s.setStretch(sd.stretchST || 0);
          if (sd.psStretch > 1) s.setPsStretch(sd.psStretch);
          s.setClipGain(sd.clipGainDb || 0);
          s.loopStart = sd.loopStart ?? 0;
          s.loopEnd = sd.loopEnd ?? 1;
          s._origLoopEnd = sd._origLoopEnd ?? sd.loopEnd ?? 1;
          s.filePosition = sd.filePosition ?? s.loopStart;
          s.gridSync = sd.gridSync ?? true;
          s.subdiv = sd.subdiv === 'sample' ? 'sample' : (sd.subdiv || 'sample');
          s.subdivFactor = sd.subdivFactor || 1;
          s.gridMulti = sd.gridMulti || 1;
          s._nudgeMs = sd.nudgeMs || 0;
          s.attackTime = sd.attackTime || 0;
          s.releaseTime = sd.releaseTime || 0;
          s.crossfadeTime = sd.crossfadeTime || 0;
          if (sd.reversed) s.setReverse(true);
          // Restore granular state
          if (sd.grainPosition != null) s.grainPosition = sd.grainPosition;
          if (sd.grainSpread   != null) s.grainSpread   = sd.grainSpread;
          if (sd.grainDensity  != null) s.grainDensity  = sd.grainDensity;
          if (sd.grainAttack   != null) s.grainAttack   = sd.grainAttack;
          if (sd.grainRelease  != null) s.grainRelease  = sd.grainRelease;
          if (sd.grainPitch    != null) s.grainPitch    = sd.grainPitch;
          if (sd.triggerMode) s.triggerMode = true;
          if (sd.granular) s.setGranularMode(true);
          // Restore sync state (audio is already baked into audioB64 for digital mode)
          if (sd.syncActive) {
            s._syncActive        = true;
            s._syncBpm           = sd.syncBpm || null;
            s._syncMode          = sd.syncMode || 'analog';
            s._syncRateMult      = sd.syncRateMult ?? 1;
            s._syncFftSize       = sd.syncFftSize ?? 2048;
            s._syncOrigLoopStart = sd.syncOrigLoopStart ?? s.loopStart;
            s._syncOrigLoopEnd   = sd.syncOrigLoopEnd   ?? s.loopEnd;
            // For analog: re-apply rate immediately
            if (s._syncMode === 'analog' && s._syncBpm) {
              s._syncRate = (Tone.Transport.bpm.value / s._syncBpm) * s._syncRateMult;
            }
          }

          // Restore main 5-band EQ
          if (Array.isArray(sd.eqBands) && sd.eqBands.length === 5) {
            sd.eqBands.forEach((b, i) => {
              s.eqBands[i] = { ...b };
              s.eqFilters[i].frequency.value = b.freq;
              s.eqFilters[i].Q.value = b.q;
              if (b.type === 'peaking') s.eqFilters[i].gain.value = b.gain || 0;
            });
          }

          // Restore FX rack
          if (Array.isArray(sd.fxChain)) {
            for (const fxd of sd.fxChain) {
              const inst = s.addFxInstance(fxd.type);
              if (!inst) continue;
              if (fxd.type === 'eq' && Array.isArray(fxd.bands)) {
                fxd.bands.forEach((b, i) => {
                  inst.eqData.bands[i] = { ...b };
                  inst.eqData.applyBand(i);
                });
              } else if (fxd.params) {
                Object.assign(inst.params, fxd.params);
                applyFxNodeParams(inst);
              }
              if (fxd.postFader) {
                inst.postFader = true;
                s.rebuildFxChain();
              }
            }
          }

          // Restore vol/pan (new fields; backward-compat: derive from old position if missing)
          if (sd.volDb != null) {
            s._currentDb = sd.volDb;
          } else if (sd.y != null) {
            const _ratio = Math.max(0, Math.min(1, sd.y / 500));
            s._currentDb = Math.max(-60, Math.min(6, 6 - Math.pow(_ratio / 0.88, 1.6) * 66));
          }
          if (sd.panPos != null) {
            s._currentPan = sd.panPos;
          } else if (sd.x != null) {
            s._currentPan = Math.max(-1, Math.min(1, (sd.x / 800) * 2 - 1));
          }
          s.updateVol(); s.updatePan();

          // Restore mute (must come after vol init)
          if (sd.muted) { s.muted = true; s.updateVol(); }

          samples.set(id, s);
          createTile(s);
          startSample(s);
        } catch (err) {
          console.error('Failed to restore sample:', sd.name, err);
        }
      }

      // Restore drum machines
      for (const did of [...drums.keys()]) removeSynth(did);
      if (Array.isArray(data.drums)) {
        for (const dd of data.drums) {
          try {
            const id = nextId++;
            if (dd.id != null) idMap[dd.id] = id;
            const drum = new DrumMachine(id, dd.name || ('DRUMS ' + id), dd.x || 300, dd.y || 300);
            if (dd.color) drum.color = dd.color;
            if (dd.kitId) { drum.kitId = dd.kitId; drum.kitName = dd.kitName || dd.kitId; }
            drum.numSteps = dd.numSteps || 16;
            for (const n of drum.INSTRUMENTS) {
              if (dd.patterns?.[n]) {
                const loaded = dd.patterns[n].slice(0, 64);
                // Pad to 64 if needed
                while (loaded.length < 64) loaded.push(0);
                drum.patterns[n] = loaded;
              }
              if (dd.pitches?.[n] !== undefined) drum.pitches[n] = dd.pitches[n];
            }
            drum.gridSync = dd.gridSync !== undefined ? dd.gridSync : true;
            drum.subdiv   = dd.subdiv || '16n';
            drum.rate     = dd.rate   || 120;
            drum._currentDb  = dd.volDb  ?? 0;
            drum._currentPan = dd.panPos ?? 0;
            drum._applyVol(); drum._applyPan();
            // Restore fx chain
            if (Array.isArray(dd.fxChain)) {
              for (const fi of dd.fxChain) {
                const inst = drum.addFxInstance(fi.type);
                if (!inst) continue;
                if (fi.type === 'eq' && fi.bands) {
                  fi.bands.forEach((b, i) => { inst.eqData.bands[i] = { ...b }; inst.eqData.applyBand(i); });
                } else if (fi.params) {
                  Object.assign(inst.params, fi.params);
                  applyFxNodeParams(inst);
                }
                if (fi.postFader) { inst.postFader = true; drum.rebuildFxChain(); }
              }
            }
            drums.set(id, drum);
            createSynthTile(drum);
            drum.loadKit(drum.kitId);
            drum.startSequencer();
          } catch(e) { console.error('Failed to restore drum machine:', e); }
        }
      }
      // Restore synths
      if (Array.isArray(data.synths)) {
        for (const sd of data.synths) {
          try {
            const id = nextId++;
            if (sd.id != null) idMap[sd.id] = id;
            let synth;
            if (sd.synthType === 'analog') {
              synth = new AnalogSynth(id, sd.name || ('Synth ' + id), sd.x || 300, sd.y || 300);
              if (sd.oscType) { synth.oscType = sd.oscType; synth.updateOscType(); }
              if (sd.filterType) synth.filterType = sd.filterType;
              if (sd.filterFreq != null) synth.filterFreq = sd.filterFreq;
              if (sd.filterQ    != null) synth.filterQ    = sd.filterQ;
              synth.updateFilter();
              if (sd.attack  != null) synth.attack  = sd.attack;
              if (sd.decay   != null) synth.decay   = sd.decay;
              if (sd.sustain != null) synth.sustain = sd.sustain;
              if (sd.release != null) synth.release = sd.release;
              synth.updateEnvelope();
              if (sd.portamento != null) { synth.portamento = sd.portamento; if (synth._poly) synth._poly.set({ portamento: sd.portamento }); }
              if (sd.currentPreset != null) synth.currentPreset = sd.currentPreset;
            } else if (sd.synthType === 'fm') {
              synth = new FMSynthInstrument(id, sd.name || ('FM Synth ' + id), sd.x || 300, sd.y || 300);
              if (sd.harmonicity     != null) synth.harmonicity     = sd.harmonicity;
              if (sd.modulationIndex != null) synth.modulationIndex = sd.modulationIndex;
              synth.updateFMParams();
              if (sd.attack    != null) synth.attack    = sd.attack;
              if (sd.decay     != null) synth.decay     = sd.decay;
              if (sd.sustain   != null) synth.sustain   = sd.sustain;
              if (sd.release   != null) synth.release   = sd.release;
              synth.updateEnvelope();
              if (sd.modAttack   != null) synth.modAttack   = sd.modAttack;
              if (sd.modDecay    != null) synth.modDecay    = sd.modDecay;
              if (sd.modSustain  != null) synth.modSustain  = sd.modSustain;
              if (sd.modRelease  != null) synth.modRelease  = sd.modRelease;
              synth.updateModEnv();
              if (sd.currentPreset != null) synth.currentPreset = sd.currentPreset;
              if (sd._usingCustom && Array.isArray(sd._customPresets) && sd._customPresets.length) {
                synth._customPresets = sd._customPresets.map(p => ({ ...p }));
                synth._usingCustom = true;
              }
            } else if (sd.synthType === 'wavetable') {
              synth = new WavetableSynth(id, sd.name || ('Wavetable ' + id), sd.x || 300, sd.y || 300);
              if (sd.currentWave  != null) { synth.currentWave  = sd.currentWave;  synth.updateWave(); }
              if (sd.detune1      != null)   synth.detune1      = sd.detune1;
              if (sd.detune2      != null)   synth.detune2      = sd.detune2;
              if (sd.osc2octave   != null)   synth.osc2octave   = sd.osc2octave;
              if (sd.width        != null)   synth.width        = sd.width;
              if (sd.cutoff       != null)   synth.cutoff       = sd.cutoff;
              if (sd.resonance    != null) { synth.resonance    = sd.resonance;    synth.updateFilter(); }
              if (sd.envAmount    != null)   synth.envAmount    = sd.envAmount;
              if (sd.filterAttack != null)   synth.filterAttack = sd.filterAttack;
              if (sd.filterDecay  != null)   synth.filterDecay  = sd.filterDecay;
              if (sd.attack       != null)   synth.attack       = sd.attack;
              if (sd.decay        != null)   synth.decay        = sd.decay;
              if (sd.sustain      != null)   synth.sustain      = sd.sustain;
              if (sd.release      != null)   synth.release      = sd.release;
            } else if (sd.synthType === 'karplus') {
              synth = new KarplusSynth(id, sd.name || ('Karplus ' + id), sd.x || 300, sd.y || 300);
              if (sd.characterVariation     != null) synth.characterVariation     = sd.characterVariation;
              if (sd.stringDamping          != null) synth.stringDamping          = sd.stringDamping;
              if (sd.stringDampingVariation != null) synth.stringDampingVariation = sd.stringDampingVariation;
              if (sd.stringDampingCalc)              synth.stringDampingCalc      = sd.stringDampingCalc;
              if (sd.stringTension          != null) synth.stringTension          = sd.stringTension;
              if (sd.pluckDamping           != null) synth.pluckDamping           = sd.pluckDamping;
              if (sd.pluckDampingVariation  != null) synth.pluckDampingVariation  = sd.pluckDampingVariation;
              if (sd.stereoSpread           != null) synth.stereoSpread           = sd.stereoSpread;
              if (sd.bodyResonation)                 synth.bodyResonation         = sd.bodyResonation;
            } else if (sd.synthType === 'rompler') {
              synth = new RomplerInstrument(id, sd.name || ('Rompler ' + id), sd.x || 300, sd.y || 300);
              if (sd.romplerType)              synth.romplerType          = sd.romplerType;
              if (sd.romplerBank)              synth.romplerBank          = sd.romplerBank;
              if (sd.romplerInstrument)        synth.romplerInstrument    = sd.romplerInstrument;
              if (sd.romplerSf2Url)            synth.romplerSf2Url        = sd.romplerSf2Url;
              if (sd.romplerSf2Instrument)     synth.romplerSf2Instrument = sd.romplerSf2Instrument;
              if (sd.release   != null) synth.release   = sd.release;
              if (sd.filterType)         synth.filterType = sd.filterType;
              if (sd.filterFreq != null) synth.filterFreq = sd.filterFreq;
              if (sd.filterQ    != null) synth.filterQ    = sd.filterQ;
              synth.updateFilter();
              synth._romplerLoad();
            } else {
              continue; // unknown type
            }
            if (sd.color) synth.color = sd.color;
            synth._currentDb  = sd.volDb  ?? 0;
            synth._currentPan = sd.panPos ?? 0;
            synth._applyVol(); synth._applyPan();
            if (sd.muted) { synth.muted = true; synth._applyVol(); }
            // Restore FX chain
            if (Array.isArray(sd.fxChain)) {
              for (const fi of sd.fxChain) {
                const inst = synth.addFxInstance(fi.type);
                if (!inst) continue;
                if (fi.type === 'eq' && fi.bands) {
                  fi.bands.forEach((b, i) => { inst.eqData.bands[i] = { ...b }; inst.eqData.applyBand(i); });
                } else if (fi.params) {
                  Object.assign(inst.params, fi.params);
                  applyFxNodeParams(inst);
                }
                if (fi.postFader) { inst.postFader = true; synth.rebuildFxChain(); }
              }
            }
            synths.set(id, synth);
            createSynthTile(synth);
          } catch(e) { console.error('Failed to restore synth:', sd.name, e); }
        }
      }

      // Restore chords
      for (const cid of [...chords.keys()]) removeChords(cid);
      if (Array.isArray(data.chords)) {
        for (const cd of data.chords) {
          const cid = nextChordsId++;
          const ch = new ChordsSequencer(cid, cd.x || 400, cd.y || 300);
          ch.name = cd.name || ('Chords ' + cid);
          if (cd.color) ch.color = cd.color;
          ch.numSteps = cd.numSteps || 8;
          if (Array.isArray(cd.steps)) {
            const loaded = cd.steps.slice(0, 16).map(s => ({ tokenId: s.tokenId ?? null, enabled: !!s.enabled }));
            while (loaded.length < 16) loaded.push({ tokenId: null, enabled: false });
            ch.steps = loaded;
          }
          ch.subdiv = cd.subdiv || '4n';
          ch.gridSync = cd.gridSync !== undefined ? cd.gridSync : true;
          ch.rate = cd.rate || 0.5;
          ch.voicingMode = cd.voicingMode || 0;
          ch.transposeOffset = cd.transposeOffset || 0;
          ch.playMode = cd.playMode || 'off';
          ch.strumSpeed = cd.strumSpeed || 0.015;
          ch.strumDir = cd.strumDir || 'dn';
          ch.arpMode = cd.arpMode || 'up';
          ch.arpRate = cd.arpRate || '8n';
          ch.arpOctaves = cd.arpOctaves || 1;
          ch.arpHold = !!cd.arpHold;
          ch.stepArp = !!cd.stepArp;
          ch.stepArpSteps = cd.stepArpSteps || 8;
          ch.stepArpPattern = Array.isArray(cd.stepArpPattern)
            ? cd.stepArpPattern.map(col => Array.isArray(col) ? [...col] : Array(6).fill(false))
            : Array.from({length: ch.stepArpSteps}, () => Array(6).fill(false));
          ch.voiceLeading = !!cd.voiceLeading;
          ch.scaleRoot = cd.scaleRoot || 'C';
          ch.scale = cd.scale || 'Chromatic';
          ch.genre = cd.genre || '';
          ch.decade = cd.decade || '';
          chords.set(cid, ch);
          createChordsNode(ch);
          document.getElementById('chords-' + cid)?.classList.add('collapsed');
          if (Array.isArray(cd.destinations)) {
            for (const oldId of cd.destinations) {
              const targetId = idMap[oldId] ?? (getInstrument(oldId) ? oldId : null);
              if (targetId != null) {
                ch.addDestination(targetId);
                chordsNodes.get(cid)?.updateDestList();
              }
            }
          }
        }
      }
      // Restore riffs
      for (const rid of [...riffs.keys()]) removeRiff(rid);
      if (Array.isArray(data.riffs)) {
        for (const rd of data.riffs) {
          const rid = nextRiffId++;
          const riff = new RiffSequencer(rid, rd.x || 400, rd.y || 300);
          riff.name = rd.name || ('Riff ' + rid);
          if (rd.color) riff.color = rd.color;
          riff.mode = rd.mode || 'step';
          riff.numSteps = rd.numSteps || 16;
          if (Array.isArray(rd.steps)) {
            const loaded = rd.steps.slice(0, 64).map(s => ({ note: s.note || null, vel: s.vel ?? 1.0 }));
            while (loaded.length < 64) loaded.push({ note: null, vel: 1.0 });
            riff.steps = loaded;
          }
          if (Array.isArray(rd.notes)) riff.notes = rd.notes.map(n => ({ ...n }));
          riff.subdiv = rd.subdiv || '16n';
          riff.gridSync = rd.gridSync !== undefined ? rd.gridSync : true;
          riff.rate = rd.rate || 0.125;
          riff.loopBars = rd.loopBars || 1;
          riff.scale = rd.scale || 'Chromatic';
          riff.scaleRoot = rd.scaleRoot || 'C';
          riff.harmony = rd.harmony || 0;
          riff.quantize = rd.quantize !== false;
          riffs.set(rid, riff);
          createRiffNode(riff);
          document.getElementById('riff-' + rid)?.classList.add('collapsed');
          if (Array.isArray(rd.destinations)) {
            for (const oldId of rd.destinations) {
              const targetId = idMap[oldId] ?? (getInstrument(oldId) ? oldId : null);
              if (targetId != null) {
                riff.addDestination(targetId);
                riffNodes.get(rid)?.updateDestList();
              }
            }
          }
          updateLfoWires();
        }
      }

      // Restore LFOs
      // Clear existing LFOs first
      for (const lid of [...lfos.keys()]) removeLfo(lid);
      if (Array.isArray(data.lfos)) {
        for (const ld of data.lfos) {
          const lid = nextLfoId++;
          const lfo = new LFO(lid, ld.x || 400, ld.y || 300);
          lfo.name = ld.name || ('LFO ' + lid);
          if (ld.color) lfo.color = ld.color;
          if (Array.isArray(ld.shape)) lfo.shape = ld.shape.map(p => ({ x: p.x, y: p.y }));
          lfo.rate = ld.rate || 2;
          lfo.gridSync = ld.gridSync || false;
          lfo.subdiv = ld.subdiv || 1;
          lfo._activePreset = ld._activePreset || null;
          // Restore LFO→sample destinations, remapping old IDs and fxUid via chain index
          if (Array.isArray(ld.destinations)) {
            for (const dd of ld.destinations) {
              const targetId = idMap[dd.sampleId] ??
                (samples.has(dd.sampleId) || synths.has(dd.sampleId) || drums.has(dd.sampleId) ? dd.sampleId : null);
              if (targetId == null) continue;
              let fxUid = null;
              if (dd.fxIdx != null && dd.fxIdx >= 0) {
                const inst = samples.get(targetId) || synths.get(targetId) || drums.get(targetId);
                if (inst && inst.fxChain[dd.fxIdx]) fxUid = inst.fxChain[dd.fxIdx].uid;
              }
              lfo.addDestination(targetId, dd.param, dd.min, dd.max, fxUid);
            }
          }
          lfos.set(lid, lfo);
          createLfoNode(lfo);
          document.getElementById('lfo-' + lid)?.classList.add('collapsed');
        }
      }
      updateEmpty();
      playAll();
    }

