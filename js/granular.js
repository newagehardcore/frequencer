    // ════════════════════════════════════════════════════
    // SAMPLE CLASS
    // ════════════════════════════════════════════════════
    // Micro fade-in applied at every sample start to eliminate digital click from
    // cutting into audio mid-waveform. Short enough (<5 ms) to leave transients intact.
    const DECLICK_S = 0.005;

    class GranularEngine {
      constructor(options = {}) {
        this._listeners = {};
        this.state = {
          isBufferSet: false,
          envelope: {
            attack: (options.envelope && options.envelope.attack != null) ? options.envelope.attack : 0.1,
            release: (options.envelope && options.envelope.release != null) ? options.envelope.release : 0.4
          },
          density: options.density != null ? options.density : 0.85,
          spread: options.spread != null ? options.spread : 0,
          pitch: options.pitch != null ? options.pitch : 1,
          voices: []
        };
        this._idCounter = 0;
        this.context = options.audioContext || new AudioContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = 1;
        // Do NOT auto-connect to destination — caller must call connect()
      }

      on(event, listener) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(listener);
      }
      off(event, listener) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(l => l !== listener);
      }
      _fire(event, data) {
        if (!this._listeners[event]) return;
        this._listeners[event].forEach(l => l(data));
      }

      connect(audioNode) {
        // audioNode can be a raw AudioNode or a Tone.js node (has .input property)
        const dest = (audioNode && audioNode.input !== undefined) ? audioNode.input : audioNode;
        this.gain.connect(dest);
      }
      disconnect() {
        this.gain.disconnect();
      }

      set(state) {
        // shallow merge with deep merge for envelope
        for (const key of Object.keys(state)) {
          if (key === 'envelope' && typeof state[key] === 'object') {
            this.state.envelope = Object.assign({}, this.state.envelope, state[key]);
          } else {
            this.state[key] = state[key];
          }
        }
      }

      setBuffer(data) {
        this.set({ isBufferSet: false });
        this._fire('settingBuffer', { buffer: data });
        if (data instanceof AudioBuffer) {
          this.buffer = data;
          this.set({ isBufferSet: true });
          this._fire('bufferSet', { buffer: data });
          return;
        }
        return new Promise(resolve => {
          this.context.decodeAudioData(data, buffer => {
            this.buffer = buffer;
            this.set({ isBufferSet: true });
            this._fire('bufferSet', { buffer });
            resolve(buffer);
          });
        });
      }

      startVoice(options = {}) {
        if (!this.state.isBufferSet) return;
        const self = this;
        const id = ++this._idCounter;

        let position = options.position != null ? options.position : 0;
        let volume = options.volume != null ? options.volume : 1;

        let timeout = null;
        let active = true;

        function scheduleNext() {
          if (!active) return;
          self.createGrain(position, volume);
          const density = (1 - self.state.density) * 500 + 15;
          timeout = setTimeout(scheduleNext, density);
        }

        scheduleNext();

        this.state.voices = [...this.state.voices, {
          id,
          get position() { return position; },
          set position(v) { position = v; },
          get volume() { return volume; },
          set volume(v) { volume = v; },
          stop() { active = false; clearTimeout(timeout); }
        }];

        return id;
      }

      updateVoice(id, options = {}) {
        const v = this.state.voices.find(v => v.id === id);
        if (!v) return;
        if (options.position != null) v.position = options.position;
        if (options.volume != null) v.volume = options.volume;
      }

      stopVoice(id) {
        const v = this.state.voices.find(v => v.id === id);
        if (v) v.stop();
        this.state.voices = this.state.voices.filter(v => v.id !== id);
      }

      stopAllVoices() {
        this.state.voices.forEach(v => v.stop());
        this.state.voices = [];
      }

      createGrain(position, volume) {
        if (!this.buffer) return;
        const now = this.context.currentTime;
        const source = this.context.createBufferSource();
        source.playbackRate.value = this.state.pitch;
        source.buffer = this.buffer;

        const grainGain = this.context.createGain();
        source.connect(grainGain);
        grainGain.connect(this.gain);

        // position 0-1 → buffer seconds offset
        const offset = position * this.buffer.duration;
        // random scatter in seconds around offset
        const randomOffset = (Math.random() * this.state.spread) - (this.state.spread / 2);
        const startOffset = Math.max(0, Math.min(this.buffer.duration - 0.01, offset + randomOffset));

        const attack = this.state.envelope.attack * 0.4;
        const release = Math.max(0.05, this.state.envelope.release * 1.5);
        const grainDuration = attack + release;

        volume = Math.min(1, Math.max(0, volume));

        source.start(now, startOffset, grainDuration);
        grainGain.gain.setValueAtTime(0, now);
        grainGain.gain.linearRampToValueAtTime(volume, now + attack);
        grainGain.gain.linearRampToValueAtTime(0, now + grainDuration);
        source.stop(now + grainDuration + 0.05);

        setTimeout(() => { try { grainGain.disconnect(); } catch(e){} }, (grainDuration + 0.3) * 1000);

        this._fire('grainCreated', { position, volume, pitch: this.state.pitch });
      }

      dispose() {
        this.stopAllVoices();
        try { this.gain.disconnect(); } catch(e){}
      }
    }
