    // ════════════════════════════════════════════════════
    // PLAYBACK CONTROL
    // ════════════════════════════════════════════════════
    function startSample(s) {
      if (!(s instanceof Sample)) return;
      if (s.triggerMode) return; // waiting for manual/external trigger
      // Respect solo
      if (soloId !== null && soloId !== s.id) return;
      if (s.gridSync) s.playGrid();
      else s.play();
    }

    async function togglePlay(id) {
      const s = samples.get(id);
      if (!(s instanceof Sample)) return;
      await ensureAudio();
      if (s.playing) s.stop();
      else startSample(s);
    }

    function refreshSoloVis() {
      const allIds = [...samples.keys(), ...synths.keys(), ...drums.keys()];
      for (const id of allIds) {
        const t = document.getElementById('t' + id);
        if (!t) continue;
        t.classList.toggle('soloed', soloId !== null && id === soloId);
        t.classList.toggle('solo-dim', soloId !== null && id !== soloId);
        const sbtn = t.querySelector('.tile-sbtn');
        if (sbtn) sbtn.classList.toggle('solo-on', soloId === id);
        if (openCards.has(id)) {
          const card = openCards.get(id).el;
          const btn = card.querySelector('.card-solo-btn');
          if (btn) btn.classList.toggle('solo-on', soloId === id);
        }
      }
    }

    function applyAllVols() {
      for (const [, s] of samples) { if (s instanceof Sample) s.vol.volume.value = s._effectiveDb(); }
      for (const [, s] of synths)  { if (s instanceof SynthInstrument) s.vol.volume.value = s._effectiveDb(); }
      for (const [, s] of drums)   { if (s instanceof SynthInstrument) s.vol.volume.value = s._effectiveDb(); }
    }

    function removeSample(id) {
      const s = samples.get(id);
      if (s instanceof Sample) s.dispose();
      const t = document.getElementById('t' + id) || document.getElementById('stub' + id);
      if (t) t.remove();
      samples.delete(id);
      if (openCards.has(id)) closeCard(id);
      if (soloId === id) { soloId = null; applyAllVols(); refreshSoloVis(); }
      // Clean up LFO destinations referencing this sample
      for (const [, lfo] of lfos) {
        const before = lfo.destinations.length;
        lfo.destinations = lfo.destinations.filter(d => d.sampleId !== id);
        if (lfo.destinations.length !== before) {
          const nodeInfo = lfoNodes.get(lfo.id);
          if (nodeInfo) nodeInfo.updateDestList();
        }
      }
      updateLfoWires();
      updateEmpty();
    }

    function removeSynth(id) {
      const synth = synths.get(id) || drums.get(id);
      if (synth instanceof SynthInstrument) synth.dispose();
      const t = document.getElementById('t' + id);
      if (t) t.remove();
      synths.delete(id);
      drums.delete(id);
      if (openCards.has(id)) closeSynthCard(id);
      if (soloId === id) { soloId = null; applyAllVols(); refreshSoloVis(); }
      updateEmpty();
    }

