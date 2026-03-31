    // ════════════════════════════════════════════════════
    // DRAG & DROP
    // ════════════════════════════════════════════════════
    let dn = 0;
    document.addEventListener('dragenter', e => {
      e.preventDefault(); dn++;
      document.getElementById('drop-overlay').classList.add('active');
    });
    document.addEventListener('dragleave', e => {
      if (--dn <= 0) { dn = 0; document.getElementById('drop-overlay').classList.remove('active'); }
    });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', async e => {
      e.preventDefault(); dn = 0;
      document.getElementById('drop-overlay').classList.remove('active');
      await ensureAudio();
      const files = e.dataTransfer.files;
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
        loadProject(await files[0].text());
        return;
      }
      const dropPos = { x: e.clientX, y: e.clientY };
      if (e.dataTransfer.items?.length) await importFromDT(e.dataTransfer.items, e.dataTransfer.files, dropPos);
      else importList(e.dataTransfer.files, dropPos);
    });

document.getElementById('file-input').addEventListener('change', async e => {
      importList(e.target.files); e.target.value = '';
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
      await ensureAudio();
      if (samples.size === 0 && synths.size === 0 && drums.size === 0 && riffs.size === 0 && chords.size === 0) { alert('Nothing to save — add some instruments or sequences first.'); return; }
      saveProject();
    });
    document.getElementById('open-btn').addEventListener('click', async () => {
      await ensureAudio();
      document.getElementById('project-input').click();
    });
    document.getElementById('project-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) { loadProject(await file.text()); }
      e.target.value = '';
    });

    // ════════════════════════════════════════════════════
    // KEYBOARD
    // ════════════════════════════════════════════════════
    // Intercept Space on selects/buttons before the browser consumes it.
    // Space must always mean global play/stop, nothing else.
    document.addEventListener('keydown', e => {
      if (e.code !== 'Space') return;
      const tag = e.target.tagName;
      if (tag === 'SELECT' || tag === 'BUTTON') {
        e.preventDefault();
        e.stopPropagation();
        e.target.blur();
        if (audioReady) isPlaying ? stopAll() : playAll();
      }
    }, { capture: true });

    // Track held QWERTY notes so we don't re-trigger on keydown repeat
    const _riffHeldKeys = new Set();

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      // ── Delete/Backspace → active chords node ──
      if (_activeChordsId !== null && (e.code === 'Delete' || e.code === 'Backspace') && !e.ctrlKey && !e.metaKey) {
        const nodeInfo = chordsNodes.get(_activeChordsId);
        if (nodeInfo?.clearSelectedStep) {
          e.preventDefault();
          nodeInfo.clearSelectedStep();
          return;
        }
      }

      // ── QWERTY keyboard → active riff ──
      if (_activeRiffId !== null && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const riff = riffs.get(_activeRiffId);
        if (riff && riff.midiInput !== 'all' && riff.midiInput !== 'keyboard') return;
        const proxy = riffKbdProxies.get(_activeRiffId);
        const nodeInfo = riffNodes.get(_activeRiffId);
        if (riff && proxy && nodeInfo) {
          // Octave shift: z / x
          if (e.code === 'KeyZ') {
            e.preventDefault();
            const oct = nodeInfo.el.querySelector('.synth-oct-btn:first-child');
            if (oct) oct.click();
            return;
          }
          if (e.code === 'KeyX') {
            e.preventDefault();
            const oct = nodeInfo.el.querySelector('.synth-oct-btn:last-child');
            if (oct) oct.click();
            return;
          }
          // Delete / Backspace → clear selected/cursor step
          if ((e.code === 'Delete' || e.code === 'Backspace') && !e.repeat) {
            e.preventDefault();
            nodeInfo.clearSelectedStep?.();
            return;
          }
          // R → rest (advance without assigning a note)
          if (e.code === 'KeyR' && !e.repeat) {
            e.preventDefault();
            nodeInfo.advanceRest?.();
            return;
          }
          // Arrow left/right → move step selection
          if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            e.preventDefault();
            nodeInfo.moveSelection?.(e.code === 'ArrowRight' ? 1 : -1);
            return;
          }
          // Arrow up/down → transpose selected step by one semitone (scale-snapped)
          if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            e.preventDefault();
            nodeInfo.transposeSelectedStep?.(e.code === 'ArrowUp' ? 1 : -1);
            return;
          }
          const mapping = RIFF_QWERTY_MAP[e.code];
          if (mapping && !e.repeat) {
            e.preventDefault();
            if (_riffHeldKeys.has(e.code)) return;
            _riffHeldKeys.add(e.code);
            // Compute full note name from current keyboard octave
            const kbdEl = nodeInfo.el.querySelector('.synth-keyboard');
            const firstKey = kbdEl?.querySelector('.sk-key-white');
            const baseOct = firstKey ? parseInt(firstKey.dataset.note.replace(/[A-Za-z#b]/g,'')) : 3;
            const note = mapping[0] + (baseOct + mapping[1]);
            proxy.noteOn(note, 100);
            proxy._noteHighlight?.(proxy.snapNote?.(note) ?? note, true);
            return;
          }
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (audioReady) isPlaying ? stopAll() : playAll();
      }
      if (e.key === '.') stopAll();
      if (e.key === 'Escape') {
        for (const id of [...openCards.keys()]) closeCard(id);
        setRiffFocus(null);
      }
    });

    document.addEventListener('keyup', e => {
      if (_activeRiffId === null) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const mapping = RIFF_QWERTY_MAP[e.code];
      if (!mapping) return;
      _riffHeldKeys.delete(e.code);
      const riff = riffs.get(_activeRiffId);
      if (riff && riff.midiInput !== 'all' && riff.midiInput !== 'keyboard') return;
      const proxy = riffKbdProxies.get(_activeRiffId);
      const nodeInfo = riffNodes.get(_activeRiffId);
      if (!riff || !proxy || !nodeInfo) return;
      const kbdEl = nodeInfo.el.querySelector('.synth-keyboard');
      const firstKey = kbdEl?.querySelector('.sk-key-white');
      const baseOct = firstKey ? parseInt(firstKey.dataset.note.replace(/[A-Za-z#b]/g,'')) : 3;
      const note = mapping[0] + (baseOct + mapping[1]);
      proxy.noteOff(note);
      proxy._noteHighlight?.(proxy.snapNote?.(note) ?? note, false);
    });

    // Clicking away from riff nodes clears focus (but not if clicking inside a riff)
    document.addEventListener('mousedown', e => {
      if (_activeRiffId !== null && !e.target.closest('.riff-node')) {
        setRiffFocus(null);
      }
    }, true);

