    // ════════════════════════════════════════════════════
    // AUDIO UNLOCK
    // ════════════════════════════════════════════════════
    // ensureAudio() initializes the AudioContext on the first call (requires a
    // user gesture). Subsequent calls resolve immediately. Every action handler
    // awaits this before doing anything, so the very first click — on any button
    // or on the canvas — both unlocks audio AND performs the intended action.

    async function _createRbNodeForSample() {
      try {
        await Tone.context.addAudioWorkletModule(RB_PROCESSOR_URL);
      } catch (e) { return null; }
      try {
        const node = Tone.context.createAudioWorkletNode('rubberband-processor', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        });
        node.setPitch = ratio => node.port.postMessage(JSON.stringify(['pitch', ratio]));
        return node;
      } catch (e) { return null; }
    }

    let _audioInitPromise = null;
    async function ensureAudio() {
      if (audioReady) return;
      if (!_audioInitPromise) {
        _audioInitPromise = (async () => {
          await Tone.start();
          audioReady = true;
          playAll();  // auto-start transport + visual state on first user gesture
        })();
      }
      return _audioInitPromise;
    }
    // Catch-all: bare canvas / background clicks also unlock audio
    document.addEventListener('click', () => ensureAudio());
