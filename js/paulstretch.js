    // ════════════════════════════════════════════════════
    // PAULSTRETCH ENGINE
    // ════════════════════════════════════════════════════

    const MAX_PS_SECONDS = 600; // 10-minute output cap per channel

    // Self-contained PaulStretch Worker: Cooley-Tukey FFT + overlap-add phase randomisation.
    // Receives: { channels: Float32Array[], ratio: number, winSize: number }
    // Sends:    { type:'progress', pct } | { type:'done', channels: Float32Array[] }
    const PS_WORKER_CODE = `(function(){
      function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
          let bit = n >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
          }
        }
        for (let len = 2; len <= n; len <<= 1) {
          const ang = -2 * Math.PI / len;
          const wRe = Math.cos(ang), wIm = Math.sin(ang);
          for (let i = 0; i < n; i += len) {
            let cRe = 1, cIm = 0;
            for (let j = 0; j < (len >> 1); j++) {
              const uRe = re[i+j], uIm = im[i+j];
              const h = len >> 1;
              const vRe = re[i+j+h]*cRe - im[i+j+h]*cIm;
              const vIm = re[i+j+h]*cIm + im[i+j+h]*cRe;
              re[i+j] = uRe+vRe; im[i+j] = uIm+vIm;
              re[i+j+h] = uRe-vRe; im[i+j+h] = uIm-vIm;
              const nr = cRe*wRe - cIm*wIm;
              cIm = cRe*wIm + cIm*wRe; cRe = nr;
            }
          }
        }
      }
      function ifft(re, im) {
        const n = re.length;
        for (let i = 0; i < n; i++) im[i] = -im[i];
        fft(re, im);
        for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
      }
      function paulstretch(input, ratio, winSize) {
        const halfWin = winSize >> 1;
        const outLen = Math.ceil(input.length * ratio);
        const output = new Float32Array(outLen);
        // Tukey window: (1 - x^2)^1.25  x in [-1, 1]
        const win = new Float32Array(winSize);
        for (let i = 0; i < winSize; i++) {
          const x = (i / (winSize - 1)) * 2 - 1;
          win[i] = Math.pow(Math.max(0, 1 - x * x), 1.25);
        }
        // Precompute per-slot OLA normalisation (sum of win^2 at 50% overlap)
        const normTable = new Float32Array(halfWin);
        for (let i = 0; i < halfWin; i++)
          normTable[i] = win[i]*win[i] + win[i+halfWin]*win[i+halfWin];
        const inputHop = halfWin / ratio;
        const re = new Float32Array(winSize);
        const im = new Float32Array(winSize);
        let inputPos = 0, outputPos = 0, lastPct = 0;
        while (outputPos < outLen) {
          const center = Math.round(inputPos);
          for (let i = 0; i < winSize; i++) {
            const si = center - halfWin + i;
            re[i] = (si >= 0 && si < input.length) ? input[si] * win[i] : 0;
            im[i] = 0;
          }
          fft(re, im);
          // Randomise phases, preserve magnitudes
          for (let i = 0; i <= halfWin; i++) {
            const mag = Math.sqrt(re[i]*re[i] + im[i]*im[i]);
            const ph  = Math.random() * 6.283185307;
            re[i] = mag * Math.cos(ph); im[i] = mag * Math.sin(ph);
          }
          // Hermitian symmetry for real IFFT
          for (let i = halfWin + 1; i < winSize; i++) {
            re[i] =  re[winSize - i];
            im[i] = -im[winSize - i];
          }
          ifft(re, im);
          // Overlap-add with window and OLA normalisation
          for (let i = 0; i < winSize; i++) {
            const oi = outputPos + i;
            if (oi < outLen) {
              const w = win[i];
              const n = normTable[oi % halfWin] || 1;
              output[oi] += re[i] * w / n;
            }
          }
          inputPos += inputHop;
          outputPos += halfWin;
          const pct = Math.min(1, outputPos / outLen);
          if (pct - lastPct >= 0.02) { lastPct = pct; self.postMessage({ type:'progress', pct }); }
        }
        return output;
      }
      self.onmessage = function(e) {
        const { channels, ratio, winSize } = e.data;
        const ws = winSize || 8192;
        const result = channels.map(ch => paulstretch(ch, ratio, ws));
        self.postMessage({ type:'done', channels: result }, result.map(c => c.buffer));
      };
    })();`;

    function buildPsBuffer(s) {
      // Cancel any in-progress render
      if (s._psWorker) { s._psWorker.terminate(); s._psWorker = null; }
      if (s.psStretch <= 1) return;

      // Save which source region we are stretching
      s._psSrcStart = s.loopStart;
      s._psSrcEnd = s.loopEnd;

      const sr = s.raw.sampleRate;
      const startSample = Math.round(s.loopStart * s.duration * sr);
      const endSample = Math.round(s.loopEnd * s.duration * sr);
      const loopLen = Math.max(1, endSample - startSample);

      // Cap ratio so output never exceeds MAX_PS_SECONDS
      const maxSamples = MAX_PS_SECONDS * sr;
      const ratio = Math.min(s.psStretch, maxSamples / loopLen);

      // Extract the loop region for each channel
      const channels = [];
      for (let c = 0; c < s.raw.numberOfChannels; c++) {
        const src = s.raw.getChannelData(c);
        channels.push(src.slice(startSample, endSample));
      }

      // Show loading overlay on tile
      const tile = document.getElementById('t' + s.id);
      if (tile) {
        let ov = tile.querySelector('.tile-ps-loading');
        if (!ov) {
          ov = document.createElement('div');
          ov.className = 'tile-ps-loading';
          ov.innerHTML = '<span class="tile-ps-lbl">PS</span><div class="tile-ps-bar-wrap"><div class="tile-ps-bar"></div></div>';
          tile.appendChild(ov);
        }
        ov.style.display = '';
        const bar = ov.querySelector('.tile-ps-bar');
        if (bar) bar.style.width = '0%';
      }
      s._psRendering = true;
      s._psBuffer = null;
      s._hiPeaks = null;
      s._psPlayingBuffer = false;

      const blob = new Blob([PS_WORKER_CODE], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      s._psWorker = worker;

      // Transfer copies so the originals stay usable on the main thread
      const transfers = channels.map(c => c.buffer);
      worker.postMessage({ channels, ratio, winSize: 8192 }, transfers);

      worker.onmessage = function (ev) {
        if (ev.data.type === 'progress') {
          const pct = ev.data.pct;
          const bar = document.querySelector('#t' + s.id + ' .tile-ps-bar');
          if (bar) bar.style.width = Math.round(pct * 100) + '%';
          return;
        }
        if (ev.data.type === 'done') {
          worker.terminate();
          s._psWorker = null;
          s._psRendering = false;

          // Build AudioBuffer from result
          const outCh = ev.data.channels;
          const outLen = outCh[0].length;
          const audioCtx = Tone.context.rawContext;
          const buf = audioCtx.createBuffer(outCh.length, outLen, sr);
          for (let c = 0; c < outCh.length; c++) buf.copyToChannel(outCh[c], c);
          s._psBuffer = buf;
          s._psFadedBuf = null; // new PS buffer — rebuild faded buffer on next play
          s._hiPeaks = null; // recompute from psBuffer

          // Reset loop region to the full PS buffer so handles work on stretched audio
          s.loopStart = 0;
          s.loopEnd = 1;
          s.filePosition = 0;
          s._fadedBuf = null;

          // Hide loading overlay
          const t = document.getElementById('t' + s.id);
          if (t) { const ov = t.querySelector('.tile-ps-loading'); if (ov) ov.style.display = 'none'; }

          refreshTileWave(s);
          // Refresh open card waveform
          if (openCards.has(s.id)) {
            const info = openCards.get(s.id);
            const wc = info.el.querySelector('.card-wave-canvas');
            if (wc) {
              const wrap = info.el.querySelector('.card-wave-wrap');
              const W = (wrap ? wrap.clientWidth : 284) - 20;
              const H = wrap ? wrap.clientHeight : 80;
              wc.width = W; wc.height = H;
            }
            // Trigger a redraw by dispatching a resize-like event
            const drawFn = info._drawWave;
            if (typeof drawFn === 'function') drawFn();
          }

          // Restart granular engine with new buffer if gran mode is active
          if (s.granular && s._gran) {
            s.setGranularMode(false);
            s.setGranularMode(true);
          }
          // Restart playback using the stretched buffer
          if (s.playing) s.play();
        }
      };

      worker.onerror = function (err) {
        console.error('PaulStretch worker error', err);
        s._psRendering = false; s._psWorker = null;
        const t = document.getElementById('t' + s.id);
        if (t) { const ov = t.querySelector('.tile-ps-loading'); if (ov) ov.style.display = 'none'; }
      };
    }

