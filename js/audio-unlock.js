    // ════════════════════════════════════════════════════
    // AUDIO UNLOCK
    // ════════════════════════════════════════════════════
    // ensureAudio() initializes the AudioContext on the first call (requires a
    // user gesture). Subsequent calls resolve immediately. Every action handler
    // awaits this before doing anything, so the very first click — on any button
    // or on the canvas — both unlocks audio AND performs the intended action.
    let _audioInitPromise = null;
    async function ensureAudio() {
      if (audioReady) return;
      if (!_audioInitPromise) {
        _audioInitPromise = (async () => {
          await Tone.start();
          masterMeter = new Tone.Meter({ channels: 2, normalRange: false, smoothing: 0.85 });
          masterSamplesGain.connect(masterMeter);
          audioReady = true;
          playAll();  // auto-start transport + visual state on first user gesture
        })();
      }
      return _audioInitPromise;
    }
    // Catch-all: bare canvas / background clicks also unlock audio
    document.addEventListener('click', () => ensureAudio());
