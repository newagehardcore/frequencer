    // ════════════════════════════════════════════════════
    // FLOATING SAMPLE CARDS (multi-open)
    // ════════════════════════════════════════════════════

    function fmtFade(secs) {
      if (secs < 0.0005) return '0 ms';
      if (secs < 1) return Math.round(secs * 1000) + ' ms';
      return secs.toFixed(2) + ' s';
    }

    function openCard(id, tile) {
      // Route to synth/drum card if applicable
      if (synths.has(id) || drums.has(id)) { openSynthCard(id, tile); return; }

      const s = samples.get(id);
      if (!(s instanceof Sample)) return;

      // If already open, just bring to front
      if (openCards.has(id)) {
        const info = openCards.get(id);
        info.el.style.zIndex = ++cardZTop;
        return;
      }

      if (!tile) tile = document.getElementById('t' + id);
      createCardForSample(s, tile);
      // Reapply LFO overrides on the newly opened card
      requestAnimationFrame(() => applyCardOverrides(id));
      updateSampleList();
    }

    function closeCard(id) {
      const info = openCards.get(id);
      if (!info) return;
      if (typeof info._stopGranAnim === 'function') info._stopGranAnim();
      info.el.remove();
      openCards.delete(id);
      const tile = document.getElementById('t' + id);
      if (tile) {
        tile.classList.remove('active', 'expanded');
        for (const cls of ['.tile-in-port', '.tile-out-port']) {
          const p = tile.querySelector(cls);
          if (p) { p.style.top = ''; p.style.left = ''; }
        }
      }
      updateSampleList();
    }

    // ── BPM detection: spectral flux onset + autocorrelation + multi-candidate octave resolution ──
    function _detectBpm(audioBuffer) {
      const sr = audioBuffer.sampleRate;
      // Limit to 30s so long files don't take forever
      const maxLen = Math.min(audioBuffer.length, Math.round(30 * sr));

      // Mix to mono
      const mono = new Float32Array(maxLen);
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const d = audioBuffer.getChannelData(c);
        for (let i = 0; i < maxLen; i++) mono[i] += d[i] / audioBuffer.numberOfChannels;
      }

      // === Spectral flux onset detection ===
      // Much more sensitive to transient attacks than simple RMS.
      // For each 10ms frame, compute FFT and sum positive spectral magnitude increases.
      const hopSec = 0.01;
      const hop = Math.round(hopSec * sr);
      const N = 1024; // FFT window
      const numFrames = Math.max(8, Math.floor((maxLen - N) / hop) + 1);

      // Hann window
      const hann = new Float32Array(N);
      for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));

      const flux = new Float32Array(numFrames);
      const prevMag = new Float32Array(N >> 1);

      for (let f = 0; f < numFrames; f++) {
        const s0 = f * hop;
        const re = new Float32Array(N), im = new Float32Array(N);
        for (let i = 0; i < N && s0 + i < maxLen; i++) re[i] = mono[s0 + i] * hann[i];
        _fft(re, im, false);
        let sf = 0;
        for (let k = 1; k < N >> 1; k++) {
          const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
          const diff = mag - prevMag[k];
          if (diff > 0) sf += diff;
          prevMag[k] = mag;
        }
        flux[f] = Math.log1p(sf * 20);
      }

      // Adaptive mean subtraction: suppress slow-moving background energy
      const avgW = Math.round(0.4 / hopSec);
      const onset = new Float32Array(numFrames);
      for (let f = 0; f < numFrames; f++) {
        let sum = 0, cnt = 0;
        for (let j = Math.max(0, f - avgW); j <= Math.min(numFrames - 1, f + avgW); j++) { sum += flux[j]; cnt++; }
        onset[f] = Math.max(0, flux[f] - (sum / cnt) * 0.88);
      }

      // === Normalized autocorrelation over 50–240 BPM range ===
      const lagMin = Math.max(1, Math.round(60 / 240 / hopSec));
      const lagMax = Math.round(60 / 50 / hopSec);

      let mean = 0;
      for (let f = 0; f < numFrames; f++) mean += onset[f];
      mean /= numFrames;
      let variance = 0;
      for (let f = 0; f < numFrames; f++) { const d = onset[f] - mean; variance += d * d; }
      variance = variance / numFrames || 1e-9;

      const ac = new Float32Array(lagMax + 1);
      for (let lag = lagMin; lag <= lagMax; lag++) {
        let sum = 0;
        const n = numFrames - lag;
        for (let f = 0; f < n; f++) sum += (onset[f] - mean) * (onset[f + lag] - mean);
        ac[lag] = sum / (n * variance);
      }

      // === Score a BPM by how well its harmonic series matches the autocorrelation ===
      // Checks ×1 (full), ×2 (sub-half), ×3, ×4, and ×0.5 (double-time)
      function scoreBpm(bpm) {
        let score = 0;
        const lag1 = 60 / bpm / hopSec;
        const harmonics = [[1, 1.0], [2, 0.45], [3, 0.25], [4, 0.12], [0.5, 0.35]];
        for (const [mult, w] of harmonics) {
          const l = Math.round(lag1 * mult);
          if (l >= lagMin && l <= lagMax) score += w * Math.max(0, ac[l]);
        }
        return score;
      }

      // Collect local maxima in AC as candidate periods
      const candidates = [];
      for (let lag = lagMin + 1; lag < lagMax; lag++) {
        if (ac[lag] > 0 && ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1])
          candidates.push(60 / (lag * hopSec));
      }
      // Always include global argmax as a fallback candidate
      let gMax = lagMin;
      for (let lag = lagMin; lag <= lagMax; lag++) if (ac[lag] > ac[gMax]) gMax = lag;
      candidates.push(60 / (gMax * hopSec));

      // For each candidate, test the BPM itself plus common octave multiples.
      // Score each via harmonic consistency, then apply a soft preference for
      // the 90–140 BPM range — this resolves ×2/÷2 ambiguity toward musically
      // common tempos without overriding a clearly stronger score outside the range.
      const octaveMults = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
      let bestBpm = 120, bestScore = -Infinity;
      for (const c of candidates) {
        for (const m of octaveMults) {
          const b = c * m;
          if (b < 58 || b > 210) continue;
          const rawScore = scoreBpm(b);
          // Soft range preference: 15% boost inside 90–140, 8% boost for 70–90 / 140–180
          const rangeBoost = (b >= 90 && b <= 140) ? 1.15
                           : (b >= 70 && b <= 180) ? 1.08 : 1.0;
          const s = rawScore * rangeBoost;
          if (s > bestScore) { bestScore = s; bestBpm = b; }
        }
      }

      return Math.round(bestBpm * 10) / 10;
    }

    // ── Detect first significant transient onset (seconds from buffer start) ──
    // Used for auto-nudge: shifts the sample so its downbeat lands on the grid.
    //
    // Two-stage approach:
    //   Stage 1 — Spectral flux (N=256, 1/k low-freq weighting): finds the STRONGEST
    //     onset in the search window — kick/downbeat wins over hi-hat pickup.
    //   Stage 2 — Backward amplitude refinement: starting from the spectral-flux
    //     estimate, walks backward to the first sample where amplitude rises above
    //     the noise floor. This corrects the ~5-15ms late-detection bias of spectral
    //     flux (which measures when energy is rising most, not when it first appeared).
    function _detectFirstOnset(audioBuffer, beatPeriodSec) {
      const sr = audioBuffer.sampleRate;
      // Search window: one beat period, capped at 750ms
      const searchSec = beatPeriodSec ? Math.min(beatPeriodSec, 0.75) : 0.5;
      const maxLen = Math.min(audioBuffer.length, Math.round(Math.max(searchSec * 2, 1) * sr));

      // Mix to mono
      const mono = new Float32Array(maxLen);
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const d = audioBuffer.getChannelData(c);
        for (let i = 0; i < maxLen; i++) mono[i] += d[i] / audioBuffer.numberOfChannels;
      }

      // ── Stage 1: Spectral flux ──
      // N=256 gives ~5.8ms window (vs 11.6ms with N=512) — better temporal localisation
      // with the same 2ms hop, at the cost of frequency resolution (fine for onset detection).
      const hopSec = 0.002;
      const hop = Math.round(hopSec * sr);
      const N = 256;
      const numFrames = Math.max(4, Math.floor((maxLen - N) / hop) + 1);
      const searchFrames = Math.min(numFrames - 1, Math.ceil(searchSec / hopSec));

      const hann = new Float32Array(N);
      for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));

      const flux = new Float32Array(numFrames);
      const prevMag = new Float32Array(N >> 1);

      // Warm-up: prime prevMag from frame 0 so frame 0 doesn't get an artificial spike
      // (prevents false onset detection at t=0 for samples that start mid-phrase).
      {
        const re = new Float32Array(N), im = new Float32Array(N);
        for (let i = 0; i < N; i++) re[i] = mono[i] * hann[i];
        _fft(re, im, false);
        for (let k = 1; k < N >> 1; k++) prevMag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      }

      for (let f = 0; f < numFrames; f++) {
        const s0 = f * hop;
        const re = new Float32Array(N), im = new Float32Array(N);
        for (let i = 0; i < N && s0 + i < maxLen; i++) re[i] = mono[s0 + i] * hann[i];
        _fft(re, im, false);
        let sf = 0;
        for (let k = 1; k < N >> 1; k++) {
          const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
          const diff = mag - prevMag[k];
          if (diff > 0) sf += diff / k; // 1/k: heavy low-freq weighting (kick >> hi-hat)
          prevMag[k] = mag;
        }
        flux[f] = Math.log1p(sf * 20);
      }

      // Adaptive mean subtraction
      const avgW = Math.round(0.4 / hopSec);
      const onset = new Float32Array(numFrames);
      for (let f = 0; f < numFrames; f++) {
        let sum = 0, cnt = 0;
        for (let j = Math.max(0, f - avgW); j <= Math.min(numFrames - 1, f + avgW); j++) { sum += flux[j]; cnt++; }
        onset[f] = Math.max(0, flux[f] - (sum / cnt) * 0.88);
      }

      // Collect local peaks in search window
      const peaks = [];
      for (let f = 1; f < searchFrames; f++) {
        if (onset[f] > onset[f - 1] && onset[f] >= onset[f + 1] && onset[f] > 0)
          peaks.push({ f, v: onset[f] });
      }
      if (peaks.length === 0) return 0;

      // Strongest peak — most likely the downbeat, not a soft pickup
      let best = peaks[0];
      for (const p of peaks) if (p.v > best.v) best = p;

      // Parabolic sub-frame interpolation
      const fi = best.f;
      let subOffset = 0;
      if (fi > 0 && fi < numFrames - 1) {
        const alpha = onset[fi - 1], beta = onset[fi], gamma = onset[fi + 1];
        const denom = alpha - 2 * beta + gamma;
        if (denom !== 0) subOffset = 0.5 * (alpha - gamma) / denom;
      }

      // Spectral flux peaks when transient is ~N/4 into the Hann window.
      // The Hann correction converts frame index → true onset position.
      const hannCorrSec = N / (4.0 * sr);
      const roughSec = Math.max(0, (fi + subOffset) * hopSec + hannCorrSec);
      const roughSample = Math.round(roughSec * sr);

      // ── Stage 2: Backward amplitude refinement ──
      // Spectral flux detects when energy is rising most rapidly — slightly AFTER the
      // true attack onset. Walk backward from roughSample in 3ms steps to find the
      // exact sample where amplitude first rose above the noise floor.
      //
      // Threshold = max(3× noise floor, 8% of local peak).
      // If no sub-threshold window is found (very dense/noisy signal), fall back to
      // the spectral flux estimate.
      if (roughSample < 3) return roughSec;

      const refWin = Math.max(1, Math.round(0.003 * sr)); // 3ms windows
      const searchBack = Math.round(0.050 * sr);           // look up to 50ms before peak
      const refStart = Math.max(0, roughSample - searchBack);

      // Noise floor: RMS of first 20ms of the search zone (presumed pre-onset silence)
      const noiseLen = Math.min(refStart, Math.round(0.020 * sr));
      let noiseRms = 0;
      if (noiseLen > 0) {
        let nsum = 0;
        for (let i = refStart - noiseLen; i < refStart; i++) nsum += mono[i] * mono[i];
        noiseRms = Math.sqrt(nsum / noiseLen);
      }

      // Peak RMS in the ±50ms window around roughSample
      let peakRms = 1e-6;
      for (let s = refStart; s + refWin <= roughSample + refWin && s + refWin <= mono.length; s += refWin) {
        let psum = 0;
        for (let i = 0; i < refWin; i++) psum += mono[s + i] * mono[s + i];
        peakRms = Math.max(peakRms, Math.sqrt(psum / refWin));
      }

      const threshold = Math.max(noiseRms * 3, peakRms * 0.08);

      // Walk backward from roughSample: stop when a 3ms window drops below threshold
      let refinedSample = roughSample;
      let found = false;
      for (let s = roughSample; s > refStart; s -= refWin) {
        const from = Math.max(0, s - refWin);
        let rsum = 0;
        for (let i = 0; i < refWin; i++) {
          const idx = from + i;
          if (idx < mono.length) rsum += mono[idx] * mono[idx];
        }
        if (Math.sqrt(rsum / refWin) < threshold) {
          refinedSample = s; // s is the first window above threshold going forward
          found = true;
          break;
        }
        refinedSample = from;
      }
      if (!found) refinedSample = roughSample; // fallback: spectral flux estimate

      return Math.max(0, refinedSample / sr);
    }

    // ── Inline radix-2 FFT (in-place, real + imaginary Float32Arrays) ──
    function _fft(re, im, inverse) {
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
        const ang = (inverse ? -1 : 1) * 2 * Math.PI / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cRe = 1, cIm = 0;
          for (let k = 0; k < (len >> 1); k++) {
            const aRe = re[i + k], aIm = im[i + k];
            const h = i + k + (len >> 1);
            const bRe = re[h] * cRe - im[h] * cIm;
            const bIm = re[h] * cIm + im[h] * cRe;
            re[i + k] = aRe + bRe; im[i + k] = aIm + bIm;
            re[h] = aRe - bRe;     im[h] = aIm - bIm;
            const nRe = cRe * wRe - cIm * wIm;
            cIm = cRe * wIm + cIm * wRe; cRe = nRe;
          }
        }
      }
      if (inverse) { for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
    }

    // ── Phase-vocoder time stretch (pitch-preserving, Hermitian-symmetric) ──
    function _phaseVocoderStretch(inputBuf, timeRatio, fftSize = 2048) {
      const sr = inputBuf.sampleRate, channels = inputBuf.numberOfChannels;
      const N = fftSize, hopA = N >> 2;
      const hopS = Math.max(1, Math.round(hopA * timeRatio));
      const inLen = inputBuf.length;
      const outLen = Math.max(1, Math.round(inLen * timeRatio));
      const outBuf = new AudioBuffer({ numberOfChannels: channels, length: outLen, sampleRate: sr });

      const hann = new Float32Array(N);
      for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / N));
      const TWO_PI = 2 * Math.PI;
      const HALF = N >> 1;

      for (let ch = 0; ch < channels; ch++) {
        const inData  = inputBuf.getChannelData(ch);
        const outData = new Float32Array(outLen);
        const outNorm = new Float32Array(outLen);
        const re = new Float32Array(N), im = new Float32Array(N);
        // Only track phases for positive-freq bins (0..N/2)
        const prevPhase = new Float32Array(HALF + 1);
        const phaseAcc  = new Float32Array(HALF + 1);

        let outPos = 0;
        for (let inPos = 0; outPos < outLen; inPos += hopA) {
          // Analysis frame
          for (let i = 0; i < N; i++) {
            re[i] = (inPos + i < inLen ? inData[inPos + i] : 0) * hann[i];
            im[i] = 0;
          }
          _fft(re, im, false);

          // Phase vocoder — positive bins only
          for (let k = 0; k <= HALF; k++) {
            const mag   = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            const phase = Math.atan2(im[k], re[k]);
            let dPhase  = phase - prevPhase[k] - TWO_PI * k * hopA / N;
            dPhase -= TWO_PI * Math.round(dPhase / TWO_PI);
            phaseAcc[k]  += (TWO_PI * k / N + dPhase / hopA) * hopS;
            prevPhase[k]  = phase;
            re[k] = mag * Math.cos(phaseAcc[k]);
            im[k] = mag * Math.sin(phaseAcc[k]);
          }
          // Enforce Hermitian symmetry → real-valued IFFT output
          for (let k = 1; k < HALF; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
          im[0] = 0; im[HALF] = 0;

          _fft(re, im, true);

          for (let i = 0; i < N; i++) {
            const p = outPos + i;
            if (p >= outLen) break;
            outData[p] += re[i] * hann[i];
            outNorm[p] += hann[i] * hann[i];
          }
          outPos += hopS;
        }

        for (let i = 0; i < outLen; i++) { if (outNorm[i] > 1e-8) outData[i] /= outNorm[i]; }
        outBuf.getChannelData(ch).set(outData);
      }
      return outBuf;
    }

    // Beat-onset extraction: snap BPM grid to nearest energy peaks
    function _notifySyncBpmChange(newBpm) {
      for (const s of samples.values()) {
        if (s._syncActive && typeof s._onBpmChange === 'function') s._onBpmChange(newBpm);
      }
    }

    function createCardForSample(s, tile) {
      const cardEl = document.createElement('div');
      cardEl.className = 'sample-card';
      cardEl.style.setProperty('--card-color', s.color);

      let waveZoom = 1.0;
      let waveZoomCenter = 0.5;
      let _cardDragged = false;

      function getZView() {
        const w = 1 / waveZoom;
        let sv = waveZoomCenter - w / 2;
        let ev = sv + w;
        if (sv < 0) { sv = 0; ev = w; }
        if (ev > 1) { ev = 1; sv = Math.max(0, 1 - w); }
        return { start: sv, end: ev, width: ev - sv };
      }

      function updateZoomLbl() {
        const lbl = cardEl.querySelector('.card-zoom-label');
        if (!lbl) return;
        if (waveZoom <= 1.005) lbl.classList.remove('visible');
        else { lbl.textContent = waveZoom.toFixed(1) + '\u00d7'; lbl.classList.add('visible'); }
      }

      cardEl.innerHTML = `
        <div class="card-titlebar">
          <div class="card-color-dot"></div>
          <div class="card-name">SAMPLE</div>
          <button class="card-dup" title="Duplicate">⧉</button>
          <button class="card-remove" title="Remove">🗑</button>
          <button class="card-close">✕</button>
        </div>
        <div class="card-mode-row">
          <button class="playmode-btn card-mode-loop act">LOOP</button>
          <button class="playmode-btn card-mode-rev">REV</button>
          <button class="playmode-btn card-mode-gran">GRAN</button>
          <button class="playmode-btn card-mode-trig">TRIG</button>
        </div>
        <div class="card-wave-row">
          <div class="card-gain-strip">
            <div class="card-gain-line"></div>
            <div class="card-gain-handle"></div>
          </div>
          <div class="card-wave-wrap">
            <canvas class="card-wave-canvas"></canvas>
            <canvas class="card-gran-canvas"></canvas>
            <div class="card-loop-reg">
              <div class="lh clh-s"></div>
              <div class="lh clh-e"></div>
            </div>
            <div class="card-fp"></div>
            <div class="card-ph"></div>
            <div class="card-zoom-label"></div>
          </div>
          <div class="vp-vol-wrap lfo-slot">
            <input type="range" class="card-vol" min="-60" max="6" step="0.1" value="0">
          </div>
        </div>
        <div class="card-pan-row lfo-slot">
          <input type="range" class="card-pan vp-pan" min="-1" max="1" step="0.01" value="0">
        </div>
        <div class="card-body">
          <div class="csec">
            <div class="crow">
              <button class="cbtn act card-play" style="flex:2">&#9654; Play</button>
              <button class="cbtn card-stop" style="flex:2">&#9632; Stop</button>
              <button class="cbtn ms-btn card-mute-btn">M</button>
              <button class="cbtn ms-btn card-solo-btn">S</button>
            </div>
            <div class="crow" style="padding-top:2px;gap:3px">
              <button class="cbtn card-sync-btn" style="flex:0 0 auto;padding:4px 10px">SYNC</button>
              <input class="card-sync-bpm" type="number" min="20" max="400" step="0.1" placeholder="BPM" style="width:52px;flex:0 0 auto;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:3px;padding:2px 4px;font-size:10px;text-align:center;-moz-appearance:textfield" title="Sample BPM — edit to override auto-detection">
              <button class="cbtn card-sync-mode-btn" style="flex:1">Analog</button>
            </div>
            <div class="crow" style="padding-top:0;padding-bottom:2px;gap:3px">
              <span style="font-size:8px;color:rgba(255,255,255,0.35);align-self:center;padding-left:4px;flex:0 0 auto">BPM:</span>
              <button class="cbtn card-sync-d2" title="Detected BPM is too slow — treat as 2× faster (×2 BPM)">×2</button>
              <button class="cbtn card-sync-d32" title="Detected BPM is too slow — treat as 1.5× faster (×1.5 BPM)">×1.5</button>
              <button class="cbtn card-sync-x32" title="Detected BPM is too fast — treat as 1.5× slower (÷1.5 BPM)">÷1.5</button>
              <button class="cbtn card-sync-x2" title="Detected BPM is too fast — treat as 2× slower (÷2 BPM)">÷2</button>
            </div>
            <div class="card-sync-dig-ctrls crow" style="display:none;padding-top:0;padding-bottom:4px;gap:3px">
              <span style="font-size:8px;color:rgba(255,255,255,0.35);align-self:center;padding-left:4px">Quality:</span>
              <button class="cbtn card-sync-quality" data-q="512" title="Crisp transients, smaller window">Crisp</button>
              <button class="cbtn card-sync-quality act" data-q="2048" title="Balanced">Bal</button>
              <button class="cbtn card-sync-quality" data-q="4096" title="Smooth, larger window">Smooth</button>
            </div>
            <div class="crow" style="padding-top:0;padding-bottom:2px;min-height:0">
              <span class="card-sync-status" style="font-size:8px;color:rgba(255,255,255,0.5);padding-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;line-height:1.2"></span>
            </div>
          </div>
          <div class="csec loop-grid-section" style="border-top:1px solid rgba(255,255,255,0.08);border-bottom:none;padding:6px 8px">
            <div class="crow">
              <button class="cbtn card-grid" style="flex:0 0 auto;padding:6px 8px">Grid</button>
              <select class="card-subdiv" style="flex:1">
                <option value="sample" selected>Sample</option>
                <option value="0.25">4 bars</option>
                <option value="0.333">3 bars</option>
                <option value="0.4">2.5 bars</option>
                <option value="0.5">2 bars</option>
                <option value="0.667">1.5 bars</option>
                <option value="1">1 bar</option>
                <option value="2">1/2</option>
                <option value="4">1/4</option>
                <option value="8">1/8</option>
                <option value="16">1/16</option>
                <option value="32">1/32</option>
              </select>
              <button class="cbtn ms-btn card-dot-btn">Dot</button>
              <button class="cbtn ms-btn card-tri-btn">3let</button>
              <button class="cbtn ms-btn card-skip2-btn">÷2</button>
              <button class="cbtn ms-btn card-skip3-btn">÷3</button>
            </div>
            <div class="crow" style="padding-top:4px;gap:5px">
              <span class="clbl" style="flex:0 0 36px;font-size:8px">Nudge</span>
              <input type="range" class="card-nudge" min="-300" max="300" step="1" value="0" style="flex:1;height:3px;accent-color:#fff">
              <span class="card-nudge-val" style="font-size:8px;color:rgba(255,255,255,0.5);width:38px;text-align:right;flex:0 0 38px">0 ms</span>
            </div>
            <div class="crow" style="padding-top:3px;gap:4px;align-items:center">
              <span class="clbl" style="flex:0 0 36px;font-size:8px">Shift</span>
              <button class="cbtn card-beat-dn" style="padding:0 6px;font-size:11px;line-height:16px">◀</button>
              <select class="card-beat-subdiv" style="flex:1;font-size:8px;background:#1a1a1a;color:#ccc;border:1px solid #444;border-radius:3px;padding:1px 3px">
                <option value="4">1/4</option>
                <option value="8">1/8</option>
                <option value="16">1/16</option>
              </select>
              <button class="cbtn card-beat-up" style="padding:0 6px;font-size:11px;line-height:16px">▶</button>
              <span class="card-beat-val" style="font-size:8px;color:rgba(255,255,255,0.5);width:34px;text-align:right;flex:0 0 34px">0</span>
              <button class="cbtn card-beat-clr" style="padding:0 5px;font-size:9px;line-height:16px;opacity:0.6" title="Reset shift">✕</button>
            </div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">PLAYBACK</div>
            <div class="card-acc-body">
              <div class="card-times" style="padding:4px 8px 0">
                <span class="ct-s">Start: 0.000s</span>
                <span class="ct-e">End: 0.000s</span>
              </div>
              <div class="csec tight" style="border:none;padding:4px 8px 6px">
                <div class="crow">
                  <span class="clbl">Start</span>
                  <div class="cslider">
                    <input type="range" class="card-loopstart" min="0" max="1" step="0.0001" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">0.000s</span><input class="cslider-edit" type="text"></div>
                  </div>
                </div>
                <div class="crow">
                  <span class="clbl">End</span>
                  <div class="cslider">
                    <input type="range" class="card-loopend" min="0" max="1" step="0.0001" value="1">
                    <div class="cslider-thumb"><span class="cslider-lbl">0.000s</span><input class="cslider-edit" type="text"></div>
                  </div>
                </div>
                <div class="crow">
                  <span class="clbl">File Pos</span>
                  <div class="cslider">
                    <input type="range" class="card-filepos" min="0" max="1" step="0.0001" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">0.000s</span><input class="cslider-edit" type="text"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="csec tight gran-sliders">
            <div class="crow">
              <span class="clbl">Position</span>
              <input type="text" class="rng-field" value="0%">
              <div class="cslider">
                <input type="range" class="card-grain-position" min="0" max="1" step="0.01" value="0.5">
                <div class="cslider-thumb"><span class="cslider-lbl">50%</span><input class="cslider-edit" type="text"></div>
              </div>
              <input type="text" class="rng-field" value="100%">
            </div>
            <div class="crow">
              <span class="clbl">Spread</span>
              <input type="text" class="rng-field" value="0%">
              <div class="cslider">
                <input type="range" class="card-grain-spread" min="0" max="1" step="0.01" value="0.3">
                <div class="cslider-thumb"><span class="cslider-lbl">30%</span><input class="cslider-edit" type="text"></div>
              </div>
              <input type="text" class="rng-field" value="100%">
            </div>
            <div class="crow">
              <span class="clbl">Density</span>
              <input type="text" class="rng-field" value="0%">
              <div class="cslider">
                <input type="range" class="card-grain-density" min="0" max="1" step="0.01" value="0.85">
                <div class="cslider-thumb"><span class="cslider-lbl">85%</span><input class="cslider-edit" type="text"></div>
              </div>
              <input type="text" class="rng-field" value="100%">
            </div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">ENVELOPE</div>
            <div class="card-acc-body">
              <div class="csec tight" style="border:none">
                <div class="crow">
                  <span class="clbl">Attack</span>
                  <input type="text" class="rng-field" value="0">
                  <div class="cslider">
                    <input type="range" class="card-attack" min="0" max="4" step="0.01" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">0 ms</span><input class="cslider-edit" type="text"></div>
                  </div>
                  <input type="text" class="rng-field" value="4">
                </div>
                <div class="crow">
                  <span class="clbl">Release</span>
                  <input type="text" class="rng-field" value="0">
                  <div class="cslider">
                    <input type="range" class="card-release" min="0" max="4" step="0.01" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">0 ms</span><input class="cslider-edit" type="text"></div>
                  </div>
                  <input type="text" class="rng-field" value="4">
                </div>
                <div class="crow">
                  <span class="clbl">X-Fade</span>
                  <input type="text" class="rng-field" value="0">
                  <div class="cslider">
                    <input type="range" class="card-xfade" min="0" max="4" step="0.01" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">0 ms</span><input class="cslider-edit" type="text"></div>
                  </div>
                  <input type="text" class="rng-field" value="4">
                </div>
              </div>
            </div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">PITCH+TIME</div>
            <div class="card-acc-body">
              <div class="csec tight" style="border:none">
                <div class="crow">
                  <span class="clbl">Pitchshift</span>
                  <input type="text" class="rng-field" value="-24">
                  <div class="cslider">
                    <input type="range" class="card-pitch" min="-24" max="24" step="1" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">0 st</span><input class="cslider-edit" type="text"></div>
                  </div>
                  <input type="text" class="rng-field" value="24">
                </div>
                <div class="crow">
                  <span class="clbl">Timestretch</span>
                  <input type="text" class="rng-field" value="-24">
                  <div class="cslider">
                    <input type="range" class="card-stretch" min="-24" max="24" step="1" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">0 st</span><input class="cslider-edit" type="text"></div>
                  </div>
                  <input type="text" class="rng-field" value="24">
                </div>
                <div class="crow">
                  <span class="clbl">Paulstretch</span>
                  <div class="cslider">
                    <input type="range" class="card-ps" min="0" max="100" step="0.5" value="0">
                    <div class="cslider-thumb"><span class="cslider-lbl">Off</span><input class="cslider-edit" type="text"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">EFFECTS</div>
            <div class="card-acc-body">
              <div class="fx-section" id="fx-section-${s.id}"></div>
            </div>
          </div>
        </div>`;

      const q = sel => cardEl.querySelector(sel);

      // Set initial values
      cardEl.style.borderColor = '#fff';
      q('.card-color-dot').style.background = s.color;
      q('.card-ph').style.background = '#fff';
      q('.card-name').textContent = s.name.toUpperCase();
      q('.card-pitch').value = s.pitchST;
      q('.card-stretch').value = s.stretchST;
      // Convert stored ratio back to slider position: sliderVal = log(ratio)/log(200)*100
      q('.card-ps').value = s.psStretch > 1 ? Math.log(s.psStretch) / Math.log(200) * 100 : 0;
      // Granular initial values
      q('.card-grain-position').value = s.grainPosition;
      q('.card-grain-spread').value   = s.grainSpread;
      q('.card-grain-density').value  = s.grainDensity;
      // Playback mode buttons
      q('.card-mode-loop').classList.toggle('act', !s.reversed && !s.granular && !s.triggerMode);
      q('.card-mode-rev').classList.toggle('act', s.reversed && !s.triggerMode);
      q('.card-mode-gran').classList.toggle('act', s.granular && !s.triggerMode);
      q('.card-mode-trig').classList.toggle('act', s.triggerMode);
      if (s.granular && !s.triggerMode) q('.gran-sliders').classList.add('visible');
      if (s.granular || s.triggerMode) q('.loop-grid-section').classList.add('hidden');
      q('.card-subdiv').value = s.subdiv;
      q('.card-dot-btn').classList.toggle('act', s.subdivFactor === 1.5);
      q('.card-tri-btn').classList.toggle('act', s.subdivFactor < 1);
      q('.card-skip2-btn').classList.toggle('act', s.gridMulti === 2);
      q('.card-skip3-btn').classList.toggle('act', s.gridMulti === 3);
      const _nudgeMs0 = s._nudgeMs || 0;
      q('.card-nudge').value = _nudgeMs0;
      q('.card-nudge-val').textContent = (_nudgeMs0 === 0 ? '0' : (_nudgeMs0 > 0 ? '+' + _nudgeMs0 : _nudgeMs0)) + ' ms';
      const _beatShiftMs0 = s._beatShiftMs || 0;
      q('.card-beat-val').textContent = _beatShiftMs0 === 0 ? '0' : (_beatShiftMs0 > 0 ? '+' + _beatShiftMs0 : _beatShiftMs0);
      q('.card-mute-btn').classList.toggle('mute-on', s.muted);
      q('.card-solo-btn').classList.toggle('solo-on', soloId === s.id);
      q('.card-grid').classList.toggle('act', s.gridSync);
      q('.card-attack').value = s.attackTime;
      q('.card-release').value = s.releaseTime;
      q('.card-xfade').value = s.crossfadeTime;

      q('.card-vol').value = s._currentDb;
      q('.card-pan').value = s._currentPan;

      // init sync pos for visual
      cardEl.querySelectorAll('.cslider').forEach(w => w._syncPos && w._syncPos());

      function setGridUI(on) {
        const isSample = on && s.subdiv === 'sample';
        const sub = q('.card-subdiv');
        sub.style.opacity = on ? '1' : '0.4';
        sub.style.pointerEvents = on ? 'all' : 'none';
        // In sample mode the user controls their own loop end
        const lockEnd = on && !isSample;
        q('.clh-e').style.pointerEvents = lockEnd ? 'none' : 'all';
        q('.clh-e').style.opacity = lockEnd ? '0.35' : '1';
        const leRow = q('.card-loopend')?.closest('.crow');
        if (leRow) { leRow.style.opacity = lockEnd ? '0.35' : '1'; leRow.style.pointerEvents = lockEnd ? 'none' : 'all'; }
        // Dot/triplet/skip modifiers don't apply in sample mode
        ['.card-dot-btn', '.card-tri-btn', '.card-skip2-btn', '.card-skip3-btn'].forEach(sel => {
          const active = on && !isSample;
          q(sel).style.opacity = active ? '1' : '0.4';
          q(sel).style.pointerEvents = active ? 'all' : 'none';
        });
      }
      setGridUI(s.gridSync);

      function updateFadeDisabled() {
        const hasAtk = s.attackTime > 0 || s.releaseTime > 0;
        const hasXfd = s.crossfadeTime > 0;
        const xfEl = q('.card-xfade');
        xfEl.disabled = hasAtk;
        xfEl.closest('.crow').style.opacity = hasAtk ? '0.35' : '1';
        ['card-attack', 'card-release'].forEach(cls => {
          const el = q('.' + cls);
          el.disabled = hasXfd;
          el.closest('.crow').style.opacity = hasXfd ? '0.35' : '1';
        });
      }
      updateFadeDisabled();

      // ── Clip gain strip ──
      function updateGainHandle() {
        const handle = q('.card-gain-handle');
        const strip = q('.card-gain-strip');
        if (!handle || !strip) return;
        const H = strip.clientHeight || 80;
        // +12dB = top (norm 0), -12dB = bottom (norm 1)
        const norm = (12 - s.clipGainDb) / 24;
        handle.style.top = Math.round(norm * H) + 'px';
      }

      q('.card-gain-strip').addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        const strip = q('.card-gain-strip');
        const rect = strip.getBoundingClientRect();
        const startY = e.clientY;
        const startDb = s.clipGainDb;
        const H = rect.height;
        const mm = ev => {
          const dy = ev.clientY - startY;
          // full strip height = 24dB range; drag up = gain up
          const dbDelta = -(dy / H) * 24;
          s.setClipGain(startDb + dbDelta);
          updateGainHandle();
          drawWave();
          refreshTileWave(s);
        };
        const mu = () => {
          document.removeEventListener('mousemove', mm);
          document.removeEventListener('mouseup', mu);
        };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });

      function drawWave() {
        const wrap = q('.card-wave-wrap');
        const W = (wrap.clientWidth || 284), H = wrap.clientHeight || 80;
        const c = q('.card-wave-canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const peaks = s.getHiResPeaks();
        const { start: vs, end: ve } = getZView();
        const startIdx = vs * peaks.length;
        const endIdx = ve * peaks.length;
        const range = endIdx - startIdx;
        const step = range / W;
        const clipScale = Math.pow(10, s.clipGainDb / 20);
        for (let i = 0; i < W; i++) {
          const binStart = Math.floor(startIdx + i * step);
          const binEnd = Math.ceil(startIdx + (i + 1) * step);
          let amp = 0;
          for (let b = binStart; b < binEnd && b < peaks.length; b++) {
            if (peaks[b] > amp) amp = peaks[b];
          }
          const scaledAmp = Math.min(1, amp * clipScale);
          const barH = Math.max(1, scaledAmp * H * 0.88);
          ctx.fillStyle = s.color;
          ctx.fillRect(i, H / 2 - barH / 2, 1, barH);
        }
        ctx.fillStyle = hexToRgba(s.color, 0.25);
        ctx.fillRect(0, H / 2, W, 1);
        const vw = ve - vs;
        const toX = norm => (norm - vs) / vw * W;

        const _cardDur = s._activeDur;
        const _psActive = s.psStretch > 1 && s._psBuffer;

        if (s.attackTime > 0) {
          const atkEndNorm = Math.min(s.loopEnd, s.loopStart + s.attackTime / _cardDur);
          const x0 = Math.max(0, toX(s.loopStart));
          const x1 = Math.min(W, Math.max(x0, toX(atkEndNorm)));
          if (x1 > x0) {
            const g = ctx.createLinearGradient(x0, 0, x1, 0);
            g.addColorStop(0, 'rgba(0,0,0,0.78)'); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.fillRect(x0, 0, x1 - x0, H);
          }
        }
        if (s.releaseTime > 0) {
          const relStartNorm = Math.max(s.loopStart, s.loopEnd - s.releaseTime / _cardDur);
          const x0 = Math.max(0, Math.min(W, toX(relStartNorm)));
          const x1 = Math.min(W, toX(s.loopEnd));
          if (x1 > x0) {
            const g = ctx.createLinearGradient(x0, 0, x1, 0);
            g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.78)');
            ctx.fillStyle = g; ctx.fillRect(x0, 0, x1 - x0, H);
          }
        }
        if (s.crossfadeTime > 0) {
          const xfdNorm = s.crossfadeTime / _cardDur;
          // In PS mode the loop is the whole content — no pre/post region to borrow from
          const preAvail = _psActive ? false : s.loopStart * _cardDur >= s.crossfadeTime;
          const postAvail = _psActive ? false : (1 - s.loopEnd) * _cardDur >= s.crossfadeTime;
          const sxOut = toX(s.loopStart - xfdNorm), sxMid = toX(s.loopStart), sxIn = toX(s.loopStart + xfdNorm);
          if (preAvail && sxMid > sxOut) {
            const g = ctx.createLinearGradient(Math.max(0, sxOut), 0, sxMid, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.5)');
            ctx.fillStyle = g; ctx.fillRect(Math.max(0, sxOut), 0, sxMid - Math.max(0, sxOut), H);
          }
          if (sxIn > sxMid) {
            const g = ctx.createLinearGradient(sxMid, 0, Math.min(W, sxIn), 0);
            g.addColorStop(0, preAvail ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.fillRect(sxMid, 0, Math.min(W, sxIn) - sxMid, H);
          }
          const exIn = toX(s.loopEnd - xfdNorm), exMid = toX(s.loopEnd), exOut = toX(s.loopEnd + xfdNorm);
          if (exMid > exIn) {
            const g = ctx.createLinearGradient(Math.max(0, exIn), 0, exMid, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, postAvail ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)');
            ctx.fillStyle = g; ctx.fillRect(Math.max(0, exIn), 0, exMid - Math.max(0, exIn), H);
          }
          if (postAvail && exOut > exMid) {
            const g = ctx.createLinearGradient(exMid, 0, Math.min(W, exOut), 0);
            g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.fillRect(exMid, 0, Math.min(W, exOut) - exMid, H);
          }
        }
      }

      // ── Grain cloud visualization ──
      let granAnimId = null;
      const granParticles = [];

      function hexToRgbArr(hex) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return [r, g, b];
      }

      function shiftHue(r, g, b, hueDeg) {
        // Simple hue rotation using HSL
        const rn = r/255, gn = g/255, bn = b/255;
        const max = Math.max(rn,gn,bn), min = Math.min(rn,gn,bn), l = (max+min)/2;
        if (max === min) return [r,g,b];
        const d = max - min;
        const s = l > 0.5 ? d/(2-max-min) : d/(max+min);
        let h = max===rn ? (gn-bn)/d+(gn<bn?6:0) : max===gn ? (bn-rn)/d+2 : (rn-gn)/d+4;
        h = (h/6 + hueDeg/360) % 1;
        if (h < 0) h += 1;
        function hue2rgb(p,q,t) { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; }
        const q2 = l < 0.5 ? l*(1+s) : l+s-l*s, p2 = 2*l-q2;
        return [Math.round(hue2rgb(p2,q2,h+1/3)*255), Math.round(hue2rgb(p2,q2,h)*255), Math.round(hue2rgb(p2,q2,h-1/3)*255)];
      }

      function drawGranCanvas() {
        const gc = q('.card-gran-canvas');
        if (!gc) return;
        const wrap = q('.card-wave-wrap');
        const W = (wrap.clientWidth || 284), H = wrap.clientHeight || 80;
        gc.width = W; gc.height = H;
        const ctx = gc.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        const { start: vs, width: vw } = getZView();
        const toX = norm => (norm - vs) / vw * W;
        const [br, bg, bb] = hexToRgbArr(s.color || '#ffffff');

        for (const p of granParticles) {
          const x = toX(p.norm);
          const glowR = p.w * 0.5; // half-glow radius in px
          if (x < -glowR - 2 || x > W + glowR + 2) continue;
          const [cr, cg, cb] = shiftHue(br, bg, bb, p.hueDeg);
          const color = `${cr},${cg},${cb}`;

          // Soft glow halo — gradient whose radius scales with grain size
          if (glowR > 1) {
            const grd = ctx.createLinearGradient(x - glowR, 0, x + glowR, 0);
            grd.addColorStop(0,   `rgba(${color},0)`);
            grd.addColorStop(0.4, `rgba(${color},${(p.opacity * 0.18).toFixed(3)})`);
            grd.addColorStop(0.5, `rgba(${color},${(p.opacity * 0.22).toFixed(3)})`);
            grd.addColorStop(0.6, `rgba(${color},${(p.opacity * 0.18).toFixed(3)})`);
            grd.addColorStop(1,   `rgba(${color},0)`);
            ctx.fillStyle = grd;
            ctx.globalAlpha = 1;
            ctx.fillRect(x - glowR, 0, glowR * 2, H);
          }

          // Crisp 1px center line
          ctx.globalAlpha = p.opacity * 0.9;
          ctx.fillStyle = `rgb(${color})`;
          ctx.fillRect(Math.round(x), 0, 1, H);
        }
        ctx.globalAlpha = 1;
      }

      function tickGranParticles() {
        if (!s.granular) return;
        const now = performance.now();
        const loopSpan = s.loopEnd - s.loopStart;
        // Grain life: derived from release param (0..1 → up to ~1.5s), minimum 80ms
        const grainLifeMs = Math.max(80, s.grainRelease * 1500);

        // Age and remove dead particles
        for (let i = granParticles.length - 1; i >= 0; i--) {
          const p = granParticles[i];
          const age = now - p.born;
          if (age >= grainLifeMs) { granParticles.splice(i, 1); continue; }
          const t = age / grainLifeMs; // 0..1 lifetime
          // Envelope: fade in first 20%, sustain, fade out last 20%
          p.opacity = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
        }

        // Spawn new grains only when playing
        if (!s.playing) { drawGranCanvas(); return; }
        // Maintain a pool sized to density: 0..1 → 1..8 simultaneous grains
        const targetCount = Math.max(1, Math.round(1 + s.grainDensity * 7));
        const needed = targetCount - granParticles.length;
        for (let i = 0; i < needed; i++) {
          // Position within loop, modulated by spread
          const center = s.loopStart + loopSpan * s.grainPosition;
          const spreadNorm = s.grainSpread * loopSpan * 0.5;
          let norm = center + (Math.random() * 2 - 1) * spreadNorm;
          norm = Math.max(s.loopStart, Math.min(s.loopEnd, norm));
          // Grain width scaled by spread
          const wrap2 = q('.card-wave-wrap');
          const W2 = wrap2 ? (wrap2.clientWidth || 284) : 284;
          const minW = 1, maxW = W2 * 0.4;
          const w = minW + s.grainSpread * (maxW - minW);
          // Hue shift based on pitch offset
          const hueDeg = s.grainPitch !== 0 ? (Math.random() * 2 - 1) * Math.abs(s.grainPitch / 24) * 60 : 0;
          granParticles.push({ born: now + Math.random() * grainLifeMs * 0.8, norm, w: Math.max(1, w), opacity: 0, hueDeg });
        }
        drawGranCanvas();
      }

      function granAnimLoop() {
        if (!s.granular) { granAnimId = null; return; }
        tickGranParticles();
        granAnimId = requestAnimationFrame(granAnimLoop);
      }

      function startGranAnim() {
        if (granAnimId) return;
        granParticles.length = 0;
        granAnimId = requestAnimationFrame(granAnimLoop);
      }

      function stopGranAnim() {
        if (granAnimId) { cancelAnimationFrame(granAnimId); granAnimId = null; }
        granParticles.length = 0;
        const gc = q('.card-gran-canvas');
        if (gc) { const ctx = gc.getContext('2d'); ctx.clearRect(0, 0, gc.width, gc.height); }
      }

      // Start anim immediately if granular is already active
      if (s.granular) startGranAnim();

      // ── SYNC ──
      const setSync = txt => { const sl = q('.card-sync-status'); if (sl) sl.textContent = txt; };

      function _setSyncBuf(newBuf, loopStartSec, loopEndSec) {
        s.raw = newBuf;
        s.duration = newBuf.duration;
        s.peaks = null; s._fadedBuf = null; s._psBuffer = null; s._psPlayingBuffer = false;
        s.loopStart = loopStartSec / newBuf.duration;
        s.loopEnd   = loopEndSec / newBuf.duration;
        if (typeof s.player.buffer.set === 'function') s.player.buffer.set(newBuf);
        else s.player.buffer._buffer = newBuf;
        if (typeof s.xfPlayer.buffer.set === 'function') s.xfPlayer.buffer.set(newBuf);
        else s.xfPlayer.buffer._buffer = newBuf;
        updateLoopReg();
        refreshTileWave(s);
      }

      async function applySync() {
        const isFirstSync = !s._syncActive;
        const mode = s._syncMode;
        const src = s._syncSrcBuf || s.raw;   // always stretch from original
        const sr = src.sampleRate, ch = src.numberOfChannels;

        // Restore original loop bounds when re-syncing from _syncSrcBuf
        const loopStart0 = s._syncActive ? s._syncOrigLoopStart : s.loopStart;
        const loopEnd0   = s._syncActive ? s._syncOrigLoopEnd   : s.loopEnd;
        const loopStartSec = loopStart0 * src.duration;
        const loopEndSec   = loopEnd0   * src.duration;
        const startSample  = Math.floor(loopStart0 * src.length);
        const endSample    = Math.ceil(loopEnd0   * src.length);
        const regionLen    = endSample - startSample;

        if (regionLen < sr * 0.5) { setSync('Region too short'); return; }

        const regionBuf = new AudioBuffer({ numberOfChannels: ch, length: regionLen, sampleRate: sr });
        for (let c = 0; c < ch; c++)
          regionBuf.getChannelData(c).set(src.getChannelData(c).subarray(startSample, endSample));

        // Detect BPM — priority: manual input > stored value > auto-detect
        const bpmInputEl = q('.card-sync-bpm');
        const manualBpm = bpmInputEl ? parseFloat(bpmInputEl.value) : NaN;
        let detectedBpm;
        if (!isNaN(manualBpm) && manualBpm >= 20 && manualBpm <= 400) {
          detectedBpm = manualBpm;
        } else if (s._syncBpm) {
          detectedBpm = s._syncBpm;
        } else {
          setSync('Analyzing…');
          await new Promise(r => setTimeout(r, 0));
          try {
            detectedBpm = _detectBpm(regionBuf);
            if (!detectedBpm || detectedBpm < 20 || detectedBpm > 400) throw new Error('Bad BPM: ' + detectedBpm);
            if (bpmInputEl) bpmInputEl.value = detectedBpm.toFixed(1);
          } catch (err) {
            setSync('BPM failed'); console.error(err); return;
          }
        }

        const projectBpm = Tone.Transport.bpm.value;

        // Save state (idempotent — safe to call on re-sync)
        s._syncBpm = detectedBpm;   // always update in case user changed manual BPM
        if (!s._syncActive) {
          s._syncOrigLoopStart = loopStart0;
          s._syncOrigLoopEnd   = loopEnd0;
          s._syncActive = true;
        }
        // Always ensure _syncSrcBuf is set before digital stretching
        // (may be cleared by mode-switch reset even when already active)
        if (mode === 'digital' && !s._syncSrcBuf) {
          s._syncSrcBuf = s.raw;
        }

        const rateMult = s._syncRateMult || 1;
        const effectiveRatio = (projectBpm / detectedBpm) * rateMult;

        // Auto-nudge: detect first transient and shift sample so its downbeat lands on beat 1.
        // Applied every time SYNC is pressed (not on BPM-change re-syncs).
        // The onset is detected from the original regionBuf; the real-time offset differs by mode:
        //   Analog: buffer plays at effectiveRatio speed   → realTime = bufTime / effectiveRatio
        //   Digital: buffer is stretched by effectiveRatio → realTime = bufTime * effectiveRatio
        {
          const onsetBuf = _detectFirstOnset(regionBuf, 60 / detectedBpm);
          if (onsetBuf > 0.010) { // < 10ms → already on beat 1, skip
            const realOnsetSec = mode === 'analog'
              ? onsetBuf / effectiveRatio
              : onsetBuf * effectiveRatio;
            const nudgeMs = Math.max(-300, Math.round(-realOnsetSec * 1000));
            s._nudgeMs = nudgeMs;
            const nudgeEl = q('.card-nudge');
            const nudgeValEl = q('.card-nudge-val');
            if (nudgeEl) nudgeEl.value = nudgeMs;
            if (nudgeValEl) nudgeValEl.textContent = nudgeMs + ' ms';
          }
        }

        // Auto-enable grid sync so loop stays locked to transport
        if (!s.gridSync) {
          s.gridSync = true;
          const gridBtn = q('.card-grid');
          if (gridBtn) gridBtn.classList.add('act');
          setGridUI(true);
          s._renderTile();
        }

        const multLabel = rateMult === 2 ? ' ÷2' : rateMult === 0.5 ? ' ×2' : rateMult === 1.5 ? ' ÷1.5' : rateMult < 0.68 ? ' ×1.5' : '';
        const isUnity = Math.abs(effectiveRatio - 1.0) < 0.002; // < 0.2% — transparent, skip processing

        if (mode === 'analog') {
          // Adjust playback rate — pitch shifts with tempo (vinyl-style)
          s._syncRate = isUnity ? 1 : effectiveRatio;
          setSync(`${detectedBpm.toFixed(1)} BPM${multLabel}  ANA`);
          // Update loop end handle to reflect the new _pbRate before rescheduling
          if (s.gridSync) { snapEndToSubdiv(); }
          if (s.playing) {
            s.player.playbackRate = s._pbRate;
            s.xfPlayer.playbackRate = s._pbRate;
            s._reschedule();
          }
        } else {
          // Digital: pitch-preserving time stretch — bake into buffer
          // At unity ratio, skip the vocoder entirely to preserve original audio quality
          if (isUnity) {
            // Restore source buffer directly (no DSP artifacts)
            _setSyncBuf(src, loopStartSec, loopEndSec);
            setSync(`${detectedBpm.toFixed(1)} BPM${multLabel}  DIG`);
            if (s.gridSync) { snapEndToSubdiv(); }
            s._reschedule();
          } else {
            setSync('Stretching…');
            await new Promise(r => setTimeout(r, 0));
            let stretchedBuf;
            try {
              stretchedBuf = _phaseVocoderStretch(regionBuf, effectiveRatio, s._syncFftSize || 2048);
            } catch (err) { setSync('Stretch failed'); console.error(err); return; }

            const preLen = startSample;
            const newLen = preLen + stretchedBuf.length + Math.max(0, src.length - endSample);
            const newBuf = new AudioBuffer({ numberOfChannels: ch, length: newLen, sampleRate: sr });
            for (let c = 0; c < ch; c++) {
              const nd = newBuf.getChannelData(c);
              nd.set(src.getChannelData(c).subarray(0, preLen), 0);
              nd.set(stretchedBuf.getChannelData(c), preLen);
              nd.set(src.getChannelData(c).subarray(endSample), preLen + stretchedBuf.length);
            }

            _setSyncBuf(newBuf, loopStartSec, loopStartSec + stretchedBuf.length / sr);
            setSync(`${detectedBpm.toFixed(1)} BPM${multLabel}  DIG`);
            if (s.gridSync) { snapEndToSubdiv(); }
            s._reschedule();
          }
        }

        // Install BPM-change hook so transport tempo updates propagate
        s._onBpmChange = async (newBpm) => {
          if (!s._syncActive) return;
          if (s._syncMode === 'analog') {
            s._syncRate = (newBpm / s._syncBpm) * (s._syncRateMult || 1);
            const ml = s._syncRateMult === 2 ? ' ÷2' : s._syncRateMult === 0.5 ? ' ×2' : '';
            setSync(`${s._syncBpm.toFixed(1)} BPM${ml}  ANA`);
            if (s.gridSync) { snapEndToSubdiv(); }
            if (s.playing) {
              s.player.playbackRate = s._pbRate;
              s.xfPlayer.playbackRate = s._pbRate;
              // Debounced reschedule: BPM drags fire on every mouse pixel
              s._reschedule(100);
            }
          } else {
            // Debounced re-bake for digital mode
            clearTimeout(s._syncResyncTimer);
            s._syncResyncTimer = setTimeout(() => applySync(), 450);
          }
        };
      }

      function clearSync() {
        if (!s._syncActive) return;
        clearTimeout(s._syncResyncTimer);
        s._onBpmChange = null;
        const wasPlaying = s.playing;
        if (wasPlaying) { s._cancelGrid?.(); s._stopPlayer(); }

        // Restore original buffer if digital had baked a modified version
        if (s._syncSrcBuf && s.raw !== s._syncSrcBuf) {
          const origBuf = s._syncSrcBuf;
          const origStartSec = s._syncOrigLoopStart * origBuf.duration;
          const origEndSec   = s._syncOrigLoopEnd   * origBuf.duration;
          _setSyncBuf(origBuf, origStartSec, origEndSec);
        }

        // Reset analog rate and player speed
        s._syncRate = 1;
        s.player.playbackRate = s._pbRate;
        s.xfPlayer.playbackRate = s._pbRate;
        s._syncActive = false;
        s._syncBpm = null;
        s._syncSrcBuf = null;
        s._syncResyncTimer = null;
        s._onBpmChange = null;
        setSync('');

        // Reset auto-nudge that was applied on sync activation
        s._nudgeMs = 0;
        const nudgeEl = q('.card-nudge');
        const nudgeValEl = q('.card-nudge-val');
        if (nudgeEl) nudgeEl.value = 0;
        if (nudgeValEl) nudgeValEl.textContent = '0 ms';

        if (wasPlaying) {
          if (s.gridSync) s._reschedule();
          else s.play();
        }
      }

      function updateFpHandle() {
        const fpEl = q('.card-fp');
        if (!fpEl) return;
        const W = (q('.card-wave-wrap').clientWidth || 284) - 20;
        const { start: vs, width: vw } = getZView();
        const fpX = (s.filePosition - vs) / vw * W;
        // Show whenever it's within view (can be left of loop region now)
        const inView = fpX >= -7 && fpX <= W + 7;
        fpEl.style.display = inView ? '' : 'none';
        if (inView) fpEl.style.left = Math.round(fpX) + 'px';
      }

      function updateLoopReg() {
        const W = (q('.card-wave-wrap').clientWidth || 284) - 20;
        const { start: vs, width: vw } = getZView();
        const reg = q('.card-loop-reg');
        const regStart = (s.loopStart - vs) / vw;
        const regEnd = (s.loopEnd - vs) / vw;
        reg.style.left = regStart * W + 'px';
        reg.style.width = Math.max(0, (regEnd - regStart) * W) + 'px';
        q('.ct-s').textContent = 'Start: ' + (s.loopStart * s._activeDur).toFixed(3) + 's';
        q('.ct-e').textContent = 'End: ' + (s.loopEnd * s._activeDur).toFixed(3) + 's';
        drawWave();
        refreshTileWave(s);
        updateFpHandle();
        if (typeof updateFilePosSlider === 'function') updateFilePosSlider();
        if (typeof updateBoundSliders === 'function') updateBoundSliders();
      }

      function snapEndToSubdiv() {
        const bpm = Tone.Transport.bpm.value;
        const barSec = (60 / bpm) * 4;
        let bufDur;
        if (s.subdiv === 'sample') {
          // In sample mode, use the user's original (pre-subdivision) loop end so that
          // switching back to "sample" always restores the full sample length.
          const origEnd = s._origLoopEnd !== undefined ? s._origLoopEnd : s.loopEnd;
          const origBufSec = Math.max(0, (origEnd - s.loopStart)) * s.duration;
          const rawDur = Math.max(0.01, origBufSec / s._pbRate);
          const nBars = Math.max(1, Math.ceil(rawDur / barSec));
          bufDur = nBars * barSec * s._pbRate;
        } else {
          const subdivSec = (60 / bpm) * (4 / s.subdiv) * s.subdivFactor;
          // Multiply by _pbRate: we need subdivSec * _pbRate buffer-seconds so that
          // the player (running at _pbRate) produces exactly subdivSec of real audio.
          bufDur = subdivSec * s._pbRate;
        }
        const snappedEnd = Math.min(1, s.loopStart + bufDur / s.duration);
        s.setLoopBounds(s.loopStart, snappedEnd);
        updateLoopReg();
      }

      function bringToFront() { cardEl.style.zIndex = ++cardZTop; }

      // Cards are position:absolute in #cv — use world coordinates so they scroll with the canvas
      const CW = 280, CH = 420;
      const cvRect = cv.getBoundingClientRect();
      const tileR = tile ? tile.getBoundingClientRect() : null;
      const wx = tileR ? Math.max(0, Math.min(WORLD_W - CW, tileR.left - cvRect.left + cv.scrollLeft)) : (cv.scrollLeft + 20);
      const wy = tileR ? Math.max(0, Math.min(WORLD_H - CH, tileR.top  - cvRect.top  + cv.scrollTop))  : (cv.scrollTop  + 60);
      cardEl.style.left = wx + 'px';
      cardEl.style.top  = wy + 'px';
      cardEl.style.zIndex = ++cardZTop;

      if (tile) tile.classList.add('active', 'expanded');
      cv.appendChild(cardEl);
      if (tile) {
        const midY = (cardEl.offsetHeight / 2) + 'px';
        const inP  = tile.querySelector('.tile-in-port');
        const outP = tile.querySelector('.tile-out-port');
        if (inP)  inP.style.top  = midY;
        if (outP) { outP.style.top = midY; outP.style.left = (cardEl.offsetWidth - 7) + 'px'; }
      }
      initVpSliders(cardEl);
      requestAnimationFrame(() => cardEl.classList.add('open'));
      requestAnimationFrame(() => { drawWave(); updateLoopReg(); updateGainHandle(); });

      // Store in openCards with references needed by phLoop
      openCards.set(s.id, { el: cardEl, getZView, phEl: () => q('.card-ph'), waveWrap: () => q('.card-wave-wrap'), vuCanvas: () => q('.card-vu-canvas'), _drawWave: () => { drawWave(); updateLoopReg(); }, _stopGranAnim: stopGranAnim });

      // ── Titlebar drag ──
      q('.card-titlebar').addEventListener('mousedown', e => {
        if (e.button !== 0 || e.target.classList.contains('card-close') || e.target.classList.contains('card-dup') || e.target.classList.contains('card-remove')) return;
        e.preventDefault(); e.stopPropagation();
        bringToFront();
        _cardDragged = false;
        const sx = e.clientX, sy = e.clientY;
        const cx0 = parseFloat(cardEl.style.left) || 0;
        const cy0 = parseFloat(cardEl.style.top) || 0;
        const tileEl = document.getElementById('t' + s.id);
        const mm = ev => {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) _cardDragged = true;
          const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
          const nx = Math.max(0, Math.min(WORLD_W - cw, cx0 + (ev.clientX - sx)));
          const ny = Math.max(0, Math.min(WORLD_H - ch, cy0 + (ev.clientY - sy)));
          cardEl.style.left = nx + 'px';
          cardEl.style.top  = ny + 'px';
          if (tileEl) {
            tileEl.style.left = nx + 'px';
            tileEl.style.top  = ny + 'px';
          }
          s.x = nx + TW / 2;
          s.y = ny + TH / 2;
        };
        const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      });

      q('.card-titlebar').addEventListener('click', e => {
        if (e.target.classList.contains('card-close') || e.target.classList.contains('card-dup') || e.target.classList.contains('card-remove')) return;
        if (!_cardDragged) closeCard(s.id);
      });

      q('.card-close').addEventListener('click', e => { e.stopPropagation(); closeCard(s.id); });
      q('.card-dup').addEventListener('click', e => { e.stopPropagation(); duplicateSample(s); });
      cardEl.addEventListener('mousedown', () => bringToFront());

      // ── Loop handles ──
      ['.clh-s', '.clh-e'].forEach(sel => {
        const isStart = sel === '.clh-s';
        q(sel).addEventListener('mousedown', e => {
          e.stopPropagation();
          if (!isStart && s.gridSync) return;
          clearSync();
          const wrap = q('.card-wave-wrap');
          const rect = wrap.getBoundingClientRect(), W = rect.width;
          const mm = ev => {
            const relView = Math.max(0, Math.min(1, (ev.clientX - rect.left) / W));
            const { start: vs, width: vw } = getZView();
            const rel = Math.max(0, Math.min(1, vs + relView * vw));
            // Live update: move loop bounds seamlessly without restarting
            if (isStart) {
              s.loopStart = Math.min(rel, s.loopEnd - 1e-4);
              if (s.playing && !s.gridSync) {
                if (s.psStretch > 1 && s._psBuffer && s._psPlayingBuffer)
                  s.player.loopStart = s.loopStart * s._psBuffer.duration;
                else
                  s.player.loopStart = s._revStart;
              }
            } else {
              s.loopEnd = Math.max(rel, s.loopStart + 1e-4);
              if (s.playing && !s.gridSync) {
                if (s.psStretch > 1 && s._psBuffer && s._psPlayingBuffer)
                  s.player.loopEnd = s.loopEnd * s._psBuffer.duration;
                else
                  s.player.loopEnd = s._revEnd;
              }
            }
            updateLoopReg();
          };
          const mu = () => {
            document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
            if (isStart && s.gridSync) { snapEndToSubdiv(); return; }
            // Save user's manually-set loop end (before any subdivision snapping modifies it)
            if (!isStart) s._origLoopEnd = s.loopEnd;
            // Single restart on mouseup with final bounds
            s.setLoopBounds(s.loopStart, s.loopEnd);
          };
          document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
        });
      });

      // ── Waveform zoom/pan ──
      // Cursor hint: crosshair over waveform bars, zoom-in over empty space
      q('.card-wave-wrap').addEventListener('mousemove', e => {
        if (e.buttons !== 0) return;
        const wrap = q('.card-wave-wrap');
        const rect = wrap.getBoundingClientRect();
        const W = rect.width, H = rect.height;
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (mx < 0 || mx >= W) return;
        const { start: vs, width: vw } = getZView();
        const norm = vs + (mx / W) * vw;
        const peaks = s.getHiResPeaks();
        const clipScale = Math.pow(10, s.clipGainDb / 20);
        const idx = Math.max(0, Math.min(peaks.length - 1, Math.round(norm * peaks.length)));
        const scaledAmp = Math.min(1, (peaks[idx] || 0) * clipScale);
        const barH = Math.max(1, scaledAmp * H * 0.88);
        const onBar = my >= H / 2 - barH / 2 && my <= H / 2 + barH / 2 && scaledAmp > 0.02;
        wrap.style.cursor = onBar ? 'crosshair' : 'zoom-in';
      });

      q('.card-wave-wrap').addEventListener('mousedown', e => {
        if (e.button !== 0 || e.target.closest('.lh') || e.target.closest('.card-fp') || e.target.closest('.vp-vol') || e.target.closest('.vp-pan')) return;
        e.preventDefault(); e.stopPropagation();
        const wrap = q('.card-wave-wrap');
        const rect = wrap.getBoundingClientRect();
        const W = rect.width, H = rect.height;
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const mouseViewX = Math.max(0, Math.min(1, mx / W));
        const { start: vs, end: ve, width: vw } = getZView();

        // Detect whether click lands on a waveform bar
        const norm = vs + mouseViewX * vw;
        const peaks = s.getHiResPeaks();
        const clipScale = Math.pow(10, s.clipGainDb / 20);
        const idx = Math.max(0, Math.min(peaks.length - 1, Math.round(norm * peaks.length)));
        const scaledAmp = Math.min(1, (peaks[idx] || 0) * clipScale);
        const barH = Math.max(1, scaledAmp * H * 0.88);
        const onWaveform = my >= H / 2 - barH / 2 && my <= H / 2 + barH / 2 && scaledAmp > 0.02;

        if (onWaveform) {
          // ── SELECTION MODE: drag to set loop region ──
          wrap.style.cursor = 'crosshair';
          let selStart = norm, selEnd = norm;

          const drawSel = () => {
            drawWave();
            updateLoopReg();
            const c = q('.card-wave-canvas');
            const ctx = c.getContext('2d');
            const { start: cvs, width: cvw } = getZView();
            const x1 = (selStart - cvs) / cvw * W;
            const x2 = (selEnd - cvs) / cvw * W;
            const xL = Math.min(x1, x2), xR = Math.max(x1, x2);
            if (xR > xL) {
              ctx.fillStyle = 'rgba(255,255,255,0.12)';
              ctx.fillRect(xL, 0, xR - xL, H);
              ctx.strokeStyle = 'rgba(255,255,255,0.55)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(Math.round(xL) + 0.5, 0);
              ctx.lineTo(Math.round(xL) + 0.5, H);
              ctx.moveTo(Math.round(xR) + 0.5, 0);
              ctx.lineTo(Math.round(xR) + 0.5, H);
              ctx.stroke();
            }
          };

          const mm = ev => {
            const cur = vs + Math.max(0, Math.min(1, (ev.clientX - rect.left) / W)) * vw;
            selStart = Math.min(norm, cur);
            selEnd = Math.max(norm, cur);
            drawSel();
          };
          const mu = () => {
            wrap.style.cursor = '';
            document.removeEventListener('mousemove', mm);
            document.removeEventListener('mouseup', mu);
            if (selEnd - selStart > 0.002) {
              s.setLoopBounds(selStart, selEnd);
              s.filePosition = selStart;
              updateFpHandle();
            }
            updateLoopReg();
            drawWave();
          };
          document.addEventListener('mousemove', mm);
          document.addEventListener('mouseup', mu);

        } else {
          // ── ZOOM MODE: existing drag-to-zoom/pan ──
          const mouseAbsPos = vs + mouseViewX * vw;
          const startX = e.clientX, startY = e.clientY, startZoom = waveZoom;
          const mm = ev => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            wrap.style.cursor = 'all-scroll';
            const newZoom = Math.max(1, Math.min(WAVE_ZOOM_MAX, startZoom * Math.pow(1.025, dy)));
            waveZoom = newZoom;
            const newVW = 1 / newZoom;
            let newVS = mouseAbsPos - mouseViewX * newVW + (dx / W) * newVW;
            newVS = Math.max(0, Math.min(1 - newVW, newVS));
            waveZoomCenter = newVS + newVW / 2;
            drawWave(); updateLoopReg(); updateZoomLbl();
          };
          const mu = () => {
            wrap.style.cursor = '';
            document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
            const blockClick = ev => { ev.stopPropagation(); document.removeEventListener('click', blockClick, true); };
            document.addEventListener('click', blockClick, true);
          };
          document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
        }
      });

      q('.card-wave-wrap').addEventListener('dblclick', e => {
        if (e.target.closest('.lh') || e.target.closest('.card-fp')) return;
        waveZoom = 1.0; waveZoomCenter = 0.5;
        drawWave(); updateLoopReg(); updateZoomLbl();
      });

      // ── Controls ──
      q('.card-play').addEventListener('click', async e => {
        e.stopPropagation();
        if (s.triggerMode) {
          await ensureAudio();
          s.triggerAtTime(Tone.context.rawContext.currentTime + 0.005, null);
          return;
        }
        togglePlay(s.id);
        q('.card-play').classList.toggle('act', s.playing);
      });
      q('.card-stop').addEventListener('click', e => {
        e.stopPropagation();
        s.stop(); q('.card-play').classList.remove('act');
      });
      q('.card-mute-btn').addEventListener('click', e => {
        e.stopPropagation();
        s.muted = !s.muted;
        q('.card-mute-btn').classList.toggle('mute-on', s.muted);
        s.vol.volume.value = s._effectiveDb(); s._renderTile();
      });
      q('.card-solo-btn').addEventListener('click', e => {
        e.stopPropagation();
        soloId = (soloId === s.id) ? null : s.id;
        q('.card-solo-btn').classList.toggle('solo-on', soloId === s.id);
        applyAllVols(); refreshSoloVis();
      });
      // ── Playback Mode (LOOP / REV / GRAN / TRIG) ──
      function syncModeButtons() {
        q('.card-mode-loop').classList.toggle('act', !s.reversed && !s.granular && !s.triggerMode);
        q('.card-mode-rev').classList.toggle('act', s.reversed && !s.triggerMode);
        q('.card-mode-gran').classList.toggle('act', s.granular && !s.triggerMode);
        q('.card-mode-trig').classList.toggle('act', s.triggerMode);
        q('.gran-sliders').classList.toggle('visible', s.granular && !s.triggerMode);
        q('.loop-grid-section').classList.toggle('hidden', s.granular || s.triggerMode);
      }
      function setPlaybackMode(mode) {
        const wasGran = s.granular;
        if (mode === 'trig') {
          if (s.granular) s.setGranularMode(false);
          if (s.reversed) s.setReverse(false);
          s.triggerMode = true;
          s.stop();
        } else {
          s.triggerMode = false;
          if (mode === 'loop') {
            if (s.granular) s.setGranularMode(false);
            if (s.reversed) s.setReverse(false);
          } else if (mode === 'rev') {
            if (s.granular) s.setGranularMode(false);
            if (!s.reversed) s.setReverse(true);
          } else if (mode === 'gran') {
            if (s.reversed) s.setReverse(false);
            if (!s.granular) s.setGranularMode(true);
          }
        }
        syncModeButtons();
        if (s.granular !== wasGran) stopGranAnim();
        if (s.granular && !s.triggerMode) startGranAnim();
        // If leaving trigger mode and transport is running, start playing
        if (mode !== 'trig' && audioReady && isPlaying && !s.playing) startSample(s);
      }
      q('.card-mode-loop').addEventListener('click', e => { e.stopPropagation(); setPlaybackMode('loop'); });
      q('.card-mode-rev').addEventListener('click', e => { e.stopPropagation(); setPlaybackMode('rev'); });
      q('.card-mode-gran').addEventListener('click', e => { e.stopPropagation(); setPlaybackMode('gran'); });
      q('.card-mode-trig').addEventListener('click', e => { e.stopPropagation(); setPlaybackMode('trig'); });

      // ── Accordion sections ──
      cardEl.querySelectorAll('.card-acc-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => {
          e.stopPropagation();
          hdr.classList.toggle('open');
          hdr.nextElementSibling.classList.toggle('open');
        });
      });

      // ── Granular sliders ──
      function initGranSlider(cls, setter, fmt) {
        const wrap = q('.' + cls)?.closest('.cslider');
        if (wrap) initCslider(wrap, fmt);
        q('.' + cls)?.addEventListener('input', e => {
          const v = parseFloat(e.target.value);
          s[setter](v);
          const lbl = e.target.closest('.cslider')?.querySelector('.cslider-lbl');
          if (lbl && fmt) lbl.textContent = fmt(v);
        });
      }
      initGranSlider('card-grain-position', 'setGrainPosition', v => Math.round(v * 100) + '%');
      initGranSlider('card-grain-spread',   'setGrainSpread',   v => Math.round(v * 100) + '%');
      initGranSlider('card-grain-density',  'setGrainDensity',  v => Math.round(v * 100) + '%');

      q('.card-pitch').addEventListener('input', e => {
        s.setPitch(parseInt(e.target.value));
      });
      q('.card-vol').addEventListener('input', e => {
        s.setVolPos(parseFloat(e.target.value));
      });
      q('.card-pan').addEventListener('input', e => {
        s.setPanPos(parseFloat(e.target.value));
      });
      q('.card-stretch').addEventListener('input', e => {
        s.setStretch(parseInt(e.target.value));
      });
      q('.card-ps').addEventListener('input', e => {
        const sliderVal = parseFloat(e.target.value);
        const ratio = sliderVal < 0.25 ? 1 : Math.pow(200, sliderVal / 100);
        s.setPsStretch(ratio);
        // Update the progress label if currently rendering
        const psLbl = e.target.closest('.crow').querySelector('.card-ps-status');
        if (psLbl && s._psRendering) psLbl.textContent = 'rendering…';
        else if (psLbl) psLbl.textContent = '';
      });
      // ── SYNC controls ──
      function syncRefreshUI() {
        const active = s._syncActive;
        const mode = s._syncMode;
        q('.card-sync-btn').classList.toggle('act', active);
        const modeBtn = q('.card-sync-mode-btn');
        if (modeBtn) modeBtn.textContent = mode === 'digital' ? 'Digital' : 'Analog';
        const digEl = q('.card-sync-dig-ctrls');
        if (digEl) digEl.style.display = mode === 'digital' ? 'flex' : 'none';
        q('.card-sync-x2').classList.toggle('act', s._syncRateMult === 2);
        q('.card-sync-d2').classList.toggle('act', s._syncRateMult === 0.5);
        q('.card-sync-x32').classList.toggle('act', s._syncRateMult === 1.5);
        q('.card-sync-d32').classList.toggle('act', s._syncRateMult < 0.68 && s._syncRateMult !== 0.5);
        const fftQ = String(s._syncFftSize || 2048);
        q('.card-body').querySelectorAll('.card-sync-quality').forEach(b => b.classList.toggle('act', b.dataset.q === fftQ));
        const bpmInputEl = q('.card-sync-bpm');
        if (active && s._syncBpm) {
          const ml = s._syncRateMult === 2 ? ' ÷2' : s._syncRateMult === 0.5 ? ' ×2' : s._syncRateMult === 1.5 ? ' ÷1.5' : s._syncRateMult < 0.68 ? ' ×1.5' : '';
          setSync(`${s._syncBpm.toFixed(1)} BPM${ml}  ${mode === 'digital' ? 'DIG' : 'ANA'}`);
          if (bpmInputEl && !bpmInputEl.value) bpmInputEl.value = s._syncBpm.toFixed(1);
        } else if (!active && bpmInputEl) {
          bpmInputEl.value = '';
        }
      }
      syncRefreshUI();

      // SYNC toggle
      q('.card-sync-btn').addEventListener('click', async e => {
        e.stopPropagation();
        if (s._syncActive) {
          clearSync();
          syncRefreshUI();
          return;
        }
        await ensureAudio();
        const btn = q('.card-sync-btn');
        btn.disabled = true;
        try { await applySync(); syncRefreshUI(); } finally { btn.disabled = false; }
      });

      // Analog / Digital mode toggle button
      q('.card-sync-mode-btn').addEventListener('click', async e => {
        e.stopPropagation();
        const newMode = s._syncMode === 'analog' ? 'digital' : 'analog';
        s._syncMode = newMode;
        if (s._syncActive) {
          // Clean reset before switching: restore original buffer and zero the analog rate.
          // This ensures neither mode inherits the other's modifications.
          if (s._syncSrcBuf) {
            // Digital had baked a buffer — restore the original
            const origStart = s._syncOrigLoopStart * s._syncSrcBuf.duration;
            const origEnd   = s._syncOrigLoopEnd   * s._syncSrcBuf.duration;
            _setSyncBuf(s._syncSrcBuf, origStart, origEnd);
            s._syncSrcBuf = null; // cleared; will be re-set by applySync for digital
          }
          s._syncRate = 1; // remove any analog rate multiplier
          s.player.playbackRate = s._pbRate;
          s.xfPlayer.playbackRate = s._pbRate;

          const btn = q('.card-sync-btn');
          btn.disabled = true;
          try { await applySync(); } finally { btn.disabled = false; }
        }
        syncRefreshUI();
      });

      // Tempo rate multiplier buttons (toggle: click active button to reset to ×1)
      q('.card-sync-x2').addEventListener('click', async e => {
        e.stopPropagation();
        s._syncRateMult = s._syncRateMult === 2 ? 1 : 2;
        if (s._syncActive) await applySync();
        syncRefreshUI();
      });
      q('.card-sync-d2').addEventListener('click', async e => {
        e.stopPropagation();
        s._syncRateMult = s._syncRateMult === 0.5 ? 1 : 0.5;
        if (s._syncActive) await applySync();
        syncRefreshUI();
      });
      q('.card-sync-x32').addEventListener('click', async e => {
        e.stopPropagation();
        s._syncRateMult = s._syncRateMult === 1.5 ? 1 : 1.5;
        if (s._syncActive) await applySync();
        syncRefreshUI();
      });
      q('.card-sync-d32').addEventListener('click', async e => {
        e.stopPropagation();
        const d32 = 2 / 3;
        s._syncRateMult = s._syncRateMult < 0.68 && s._syncRateMult !== 0.5 ? 1 : d32;
        if (s._syncActive) await applySync();
        syncRefreshUI();
      });

      // Digital quality (FFT window size)
      q('.card-body').querySelectorAll('.card-sync-quality').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          s._syncFftSize = parseInt(btn.dataset.q);
          if (s._syncActive && s._syncMode === 'digital') await applySync();
          syncRefreshUI();
        });
      });

      // Manual BPM input — re-sync on Enter or blur if value changed
      const _syncBpmEl = q('.card-sync-bpm');
      if (_syncBpmEl) {
        _syncBpmEl.addEventListener('keydown', async e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            _syncBpmEl.blur();
            if (s._syncActive) {
              const btn = q('.card-sync-btn');
              btn.disabled = true;
              try { await applySync(); syncRefreshUI(); } finally { btn.disabled = false; }
            }
          }
        });
        _syncBpmEl.addEventListener('change', async () => {
          if (s._syncActive) {
            const btn = q('.card-sync-btn');
            btn.disabled = true;
            try { await applySync(); syncRefreshUI(); } finally { btn.disabled = false; }
          }
        });
        // Prevent canvas drag when clicking input
        _syncBpmEl.addEventListener('mousedown', e => e.stopPropagation());
        _syncBpmEl.addEventListener('click', e => e.stopPropagation());
      }
      q('.card-grid').addEventListener('click', e => {
        e.stopPropagation();
        s.gridSync = !s.gridSync;
        q('.card-grid').classList.toggle('act', s.gridSync);
        if (s.gridSync) snapEndToSubdiv();
        setGridUI(s.gridSync); s._renderTile();
        if (s.playing) { s._cancelGrid(); s._stopPlayer(); s.player.loop = false; if (s.gridSync) s._reschedule(); else s.play(); }
      });
      q('.card-subdiv').addEventListener('change', e => {
        e.stopPropagation();
        const val = e.target.value;
        s.subdiv = val === 'sample' ? 'sample' : parseFloat(val);
        if (s.gridSync) { snapEndToSubdiv(); setGridUI(true); }
        // continuePlayer=true: keep audio running until the new schedule's first fire
        s._reschedule(0, true);
      });
      function setSubdivMod(factor) {
        s.subdivFactor = (s.subdivFactor === factor) ? 1 : factor;
        q('.card-dot-btn').classList.toggle('act', s.subdivFactor === 1.5);
        q('.card-tri-btn').classList.toggle('act', s.subdivFactor < 1);
        if (s.gridSync) snapEndToSubdiv();
        s._reschedule(0, true);
      }
      q('.card-dot-btn').addEventListener('click', e => { e.stopPropagation(); setSubdivMod(1.5); });
      q('.card-tri-btn').addEventListener('click', e => { e.stopPropagation(); setSubdivMod(2 / 3); });
      function setGridMulti(n) {
        s.gridMulti = (s.gridMulti === n) ? 1 : n;
        q('.card-skip2-btn').classList.toggle('act', s.gridMulti === 2);
        q('.card-skip3-btn').classList.toggle('act', s.gridMulti === 3);
        s._reschedule(0, true);
      }
      q('.card-skip2-btn').addEventListener('click', e => { e.stopPropagation(); setGridMulti(2); });
      q('.card-skip3-btn').addEventListener('click', e => { e.stopPropagation(); setGridMulti(3); });

      // Nudge slider — space key: forward to global play/stop, not page scroll
      q('.card-nudge').addEventListener('keydown', e => {
        if (e.code === 'Space') {
          e.preventDefault();
          e.stopPropagation();
          document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
        }
      });

      // Nudge slider — debounced 250ms so rapid drags don't stack reschedules
      q('.card-nudge').addEventListener('input', e => {
        e.stopPropagation();
        s._nudgeMs = parseInt(e.target.value);
        const ms = s._nudgeMs;
        q('.card-nudge-val').textContent = (ms === 0 ? '0' : (ms > 0 ? '+' + ms : ms)) + ' ms';
        s._reschedule(250);
      });
      q('.card-nudge').addEventListener('dblclick', e => {
        e.stopPropagation();
        s._nudgeMs = 0;
        q('.card-nudge').value = 0;
        q('.card-nudge-val').textContent = '0 ms';
        s._reschedule();
      });

      // Beat shift: ◀/▶ step by one subdivision, debounced 150ms
      function _applyBeatShift(dir) {
        const subdiv = parseInt(q('.card-beat-subdiv').value);
        const stepMs = Math.round((4 / subdiv) * (60000 / Tone.Transport.bpm.value));
        s._beatShiftMs = (s._beatShiftMs || 0) + dir * stepMs;
        const ms = s._beatShiftMs;
        q('.card-beat-val').textContent = ms === 0 ? '0' : (ms > 0 ? '+' + ms : ms);
        s._reschedule(150);
      }
      q('.card-beat-dn').addEventListener('click', e => { e.stopPropagation(); _applyBeatShift(-1); });
      q('.card-beat-up').addEventListener('click', e => { e.stopPropagation(); _applyBeatShift(+1); });
      q('.card-beat-clr').addEventListener('click', e => {
        e.stopPropagation();
        s._beatShiftMs = 0;
        q('.card-beat-val').textContent = '0';
        s._reschedule();
      });

      q('.card-remove').addEventListener('click', e => { e.stopPropagation(); removeSample(s.id); });

      ['attack', 'release', 'xfade'].forEach(key => {
        q('.card-' + key).addEventListener('input', e => {
          e.stopPropagation();
          const v = parseFloat(e.target.value);
          const prop = key === 'xfade' ? 'crossfadeTime' : key + 'Time';
          if (key === 'xfade' && v > 0) {
            s.attackTime = 0; s.releaseTime = 0;
            setFadeSl('card-attack', 0); setFadeSl('card-release', 0);
          } else if (key !== 'xfade' && v > 0) {
            s.crossfadeTime = 0;
            setFadeSl('card-xfade', 0);
          }
          s[prop] = v; s._fadedBuf = null; s._psFadedBuf = null;
          const lbl = e.target.closest('.cslider')?.querySelector('.cslider-lbl');
          if (lbl) lbl.textContent = fmtFade(v);
          updateFadeDisabled(); drawWave(); updateLoopReg();
          if (s.playing && !s.gridSync) {
            // Apply on next loop boundary — no position jump
            s._pendingRestart = true;
            clearTimeout(s._filePosTimer);
            const _pos = s.playheadPos();
            const _fwd = _pos !== null ? (s.reversed ? 1 - _pos : _pos) : 1;
            const _rem = Math.max(0, (1 - _fwd) * s.lenSec / s._pbRate);
            s._filePosTimer = setTimeout(() => {
              if (s.playing && !s.gridSync && s._pendingRestart) {
                s._pendingRestart = false;
                s.play();
              }
            }, _rem * 1000 + 300);
          }
        });
      });

      // ── Custom envelope sliders ──
      function setFadeSl(cls, val) {
        const sl = q('.' + cls);
        if (!sl) return;
        sl.value = val;
        const wrap = sl.closest('.cslider');
        if (wrap) {
          if (wrap._syncPos) wrap._syncPos();
          const lbl = wrap.querySelector('.cslider-lbl');
          if (lbl) lbl.textContent = fmtFade(val);
        }
      }

      const fmtST = v => (v >= 0 ? '+' : '') + Math.round(v) + ' st';
      const fmtPS = v => {
        const ratio = Math.pow(200, v / 100);
        if (v < 0.25) return 'Off';
        return (ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)) + '×';
      };
      initCslider(q('.card-pitch').closest('.cslider'), fmtST);
      initCslider(q('.card-stretch').closest('.cslider'), fmtST);
      initCslider(q('.card-ps').closest('.cslider'), fmtPS);
      initCslider(q('.card-attack').closest('.cslider'));
      initCslider(q('.card-release').closest('.cslider'));
      initCslider(q('.card-xfade').closest('.cslider'));


      // ── Loop Start / End sliders ──
      const fmtPos = v => (+v).toFixed(3) + 's';
      const lsSlider = q('.card-loopstart');
      const leSlider = q('.card-loopend');
      lsSlider.min = leSlider.min = 0;
      lsSlider.max = leSlider.max = s._activeDur;
      lsSlider.step = leSlider.step = Math.max(0.001, s._activeDur / 10000);
      lsSlider.value = s.loopStart * s._activeDur;
      leSlider.value = s.loopEnd * s._activeDur;
      initCslider(lsSlider.closest('.cslider'), fmtPos);
      initCslider(leSlider.closest('.cslider'), fmtPos);

      function updateBoundSliders() {
        const dur = s._activeDur;
        lsSlider.max = leSlider.max = dur;
        lsSlider.step = leSlider.step = Math.max(0.001, dur / 10000);
        lsSlider.value = s.loopStart * dur;
        leSlider.value = s.loopEnd * dur;
        lsSlider.closest('.cslider')?._syncPos?.();
        leSlider.closest('.cslider')?._syncPos?.();
      }
      updateBoundSliders();

      lsSlider.addEventListener('input', e => {
        e.stopPropagation();
        clearSync();
        const dur = s._activeDur;
        const sec = Math.min(parseFloat(e.target.value), s.loopEnd * dur - 1e-4);
        s.setLoopBounds(sec / dur, s.loopEnd);
        updateLoopReg();
      });

      leSlider.addEventListener('input', e => {
        e.stopPropagation();
        clearSync();
        const dur = s._activeDur;
        const sec = Math.max(parseFloat(e.target.value), s.loopStart * dur + 1e-4);
        s.setLoopBounds(s.loopStart, sec / dur);
        updateLoopReg();
      });

      // ── File Position slider ──
      const fpSlider = q('.card-filepos');
      fpSlider.min = 0;
      fpSlider.max = s._activeDur;
      fpSlider.step = Math.max(0.001, s._activeDur / 10000);
      fpSlider.value = s.filePosition * s._activeDur;
      initCslider(fpSlider.closest('.cslider'), fmtPos);

      function updateFilePosSlider() {
        fpSlider.min = 0;
        fpSlider.max = s._activeDur;
        fpSlider.step = Math.max(0.001, s._activeDur / 10000);
        fpSlider.value = s.filePosition * s._activeDur;
        const wrap = fpSlider.closest('.cslider');
        if (wrap?._syncPos) wrap._syncPos();
        updateFpHandle();
      }
      updateFilePosSlider();

      fpSlider.addEventListener('input', e => {
        e.stopPropagation();
        const sec = parseFloat(e.target.value);
        s.setFilePosition(sec / s._activeDur);
        updateFpHandle();
        const lbl = e.target.closest('.cslider')?.querySelector('.cslider-lbl');
        if (lbl) lbl.textContent = fmtPos(sec);
      });

      // ── File position handle drag (triangle on waveform) ──
      q('.card-fp').addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        const wrap = q('.card-wave-wrap');
        const rect = wrap.getBoundingClientRect();
        const W = rect.width;
        const mm = ev => {
          const relView = Math.max(0, Math.min(1, (ev.clientX - rect.left) / W));
          const { start: vs, width: vw } = getZView();
          const norm = Math.max(0, Math.min(s.loopEnd, vs + relView * vw));
          // Set directly (no restart scheduling during drag)
          s.filePosition = norm;
          updateFpHandle();
          // Sync the slider
          fpSlider.value = norm * s._activeDur;
          if (fpSlider.closest('.cslider')?._syncPos) fpSlider.closest('.cslider')._syncPos();
          const lbl = fpSlider.closest('.cslider')?.querySelector('.cslider-lbl');
          if (lbl) lbl.textContent = fmtPos(norm * s._activeDur);
        };
        const mu = () => {
          document.removeEventListener('mousemove', mm);
          document.removeEventListener('mouseup', mu);
          // On release, apply with restart-scheduling behaviour
          s.setFilePosition(s.filePosition);
        };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });

      // ── Editable range fields (min/max) for each slider ──
      function wireRangeFields(sliderSel) {
        const slider = q(sliderSel);
        if (!slider) return;
        const fields = Array.from(slider.closest('.crow').querySelectorAll('.rng-field'));
        if (fields.length < 2) return;
        const [minF, maxF] = fields;
        [minF, maxF].forEach((f, i) => {
          f.addEventListener('mousedown', e => e.stopPropagation());
          f.addEventListener('click', e => e.stopPropagation());
          f.addEventListener('keydown', e => { if (e.key === 'Enter') f.blur(); e.stopPropagation(); });
          f.addEventListener('change', () => {
            const v = parseFloat(f.value);
            if (isNaN(v)) { f.value = i === 0 ? slider.min : slider.max; return; }
            if (i === 0) {
              slider.min = v;
              if (parseFloat(slider.value) < v) { slider.value = v; slider.dispatchEvent(new Event('input')); }
            } else {
              slider.max = v;
              if (parseFloat(slider.value) > v) { slider.value = v; slider.dispatchEvent(new Event('input')); }
            }
          });
        });
      }
      wireRangeFields('.card-pitch');
      wireRangeFields('.card-stretch');
      wireRangeFields('.card-attack');
      wireRangeFields('.card-release');
      wireRangeFields('.card-xfade');

      // ── FX Section ──
      buildFxSection(cardEl, s);

      return cardEl;
    }

    function buildFxSection(cardEl, s) {
      const fxSection = cardEl.querySelector('.fx-section');
      if (!fxSection) return;

      // Emit a full cslider row matching the existing card slider style
      function sliderRow(label, cls, min, max, val, step) {
        return `<div class="crow">
          <span class="clbl">${label}</span>
          <input type="text" class="rng-field" value="${min}">
          <div class="cslider">
            <input type="range" class="${cls}" min="${min}" max="${max}" step="${step}" value="${val}">
            <div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div>
          </div>
          <input type="text" class="rng-field" value="${max}">
        </div>`;
      }

      // Init all csliders in body and wire range-field inputs
      function initFxSliders(body, fmtMap) {
        body.querySelectorAll('.cslider').forEach(wrap => {
          const native = wrap.querySelector('input[type=range]');
          const cls = Array.from(native.classList).find(c => fmtMap[c]);
          initCslider(wrap, cls ? fmtMap[cls] : (v => parseFloat(v).toFixed(2)));
          const fields = Array.from(wrap.closest('.crow').querySelectorAll('.rng-field'));
          if (fields.length < 2) return;
          const [minF, maxF] = fields;
          [minF, maxF].forEach((f, i) => {
            f.addEventListener('mousedown', e => e.stopPropagation());
            f.addEventListener('click', e => e.stopPropagation());
            f.addEventListener('keydown', e => { if (e.key === 'Enter') f.blur(); e.stopPropagation(); });
            f.addEventListener('change', () => {
              const v = parseFloat(f.value);
              if (isNaN(v)) { f.value = i === 0 ? native.min : native.max; return; }
              if (i === 0) {
                native.min = v;
                if (parseFloat(native.value) < v) { native.value = v; native.dispatchEvent(new Event('input')); }
              } else {
                native.max = v;
                if (parseFloat(native.value) > v) { native.value = v; native.dispatchEvent(new Event('input')); }
              }
              wrap._syncPos?.();
            });
          });
        });
      }

      const fmt2 = v => parseFloat(v).toFixed(2);
      const fmtHz = v => Math.round(parseFloat(v)) + 'Hz';
      const fmtHz1 = v => parseFloat(v).toFixed(1) + 'Hz';
      const fmtSec = v => parseFloat(v).toFixed(2) + 's';
      const fmtMs = v => Math.round(parseFloat(v) * 1000) + 'ms';
      const fmtInt = v => String(Math.round(parseFloat(v)));

      const FX_PANELS = {
        reverb: {
          build(body, p, node, inst, s) {
            function buildHTML() {
              let h = sliderRow('Decay', 'fx-r-decay', 0.1, 30, p.decay ?? 2.5, 0.1);
              h += sliderRow('Pre-Dly', 'fx-r-predly', 0, 0.5, p.preDelay ?? 0.01, 0.001);
              h += sliderRow('Wet', 'fx-r-wet', 0, 1, p.wet ?? 0.4, 0.01);
              const tfTypes = ['none', 'lowpass', 'highpass'];
              h += `<div class="crow" style="margin-top:3px;margin-bottom:2px"><span class="clbl" style="font-size:8px">Tail</span><div style="display:flex;gap:2px">` +
                tfTypes.map(t => `<button class="cbtn fx-r-tf-btn" data-tf="${t}" style="font-size:8px;padding:2px 5px;${(p.tailFilterType || 'none') === t ? 'border-color:#888;color:#fff' : ''}">${t === 'none' ? 'FLAT' : t === 'lowpass' ? 'LP' : 'HP'}</button>`).join('') +
                `</div></div>`;
              if (p.tailFilterType && p.tailFilterType !== 'none') {
                const tfMin = p.tailFilterType === 'highpass' ? 40 : 200;
                const tfMax = p.tailFilterType === 'highpass' ? 4000 : 20000;
                const tfDef = p.tailFilterType === 'highpass' ? 400 : 20000;
                h += sliderRow('T.Freq', 'fx-r-tffreq', tfMin, tfMax, p.tailFilterFreq ?? tfDef, 1);
              }
              return h;
            }

            function wire() {
              const qb = cls => body.querySelector('.' + cls);
              qb('fx-r-decay')?.addEventListener('input', e => {
                p.decay = parseFloat(e.target.value);
                if (inst.reverbData?.reverbNode) inst.reverbData.reverbNode.decay = p.decay;
              });
              qb('fx-r-predly')?.addEventListener('input', e => {
                p.preDelay = parseFloat(e.target.value);
                if (inst.reverbData?.reverbNode) inst.reverbData.reverbNode.preDelay = p.preDelay;
              });
              qb('fx-r-wet')?.addEventListener('input', e => {
                p.wet = parseFloat(e.target.value);
                if (inst.reverbData?.reverbNode) inst.reverbData.reverbNode.wet.value = p.wet;
              });
              body.querySelectorAll('.fx-r-tf-btn').forEach(btn => {
                btn.addEventListener('click', ev => {
                  ev.stopPropagation();
                  p.tailFilterType = btn.dataset.tf;
                  const tf = inst.reverbData?.tailFilter;
                  if (tf) {
                    if (p.tailFilterType === 'none') { tf.type = 'lowpass'; tf.frequency.value = 20000; p.tailFilterFreq = 20000; }
                    else { tf.type = p.tailFilterType; const df = p.tailFilterType === 'highpass' ? 400 : 8000; if (!p.tailFilterFreq || p.tailFilterFreq === 20000) p.tailFilterFreq = df; tf.frequency.value = p.tailFilterFreq; }
                  }
                  rebuild();
                });
              });
              qb('fx-r-tffreq')?.addEventListener('input', e => {
                p.tailFilterFreq = parseFloat(e.target.value);
                if (inst.reverbData?.tailFilter) inst.reverbData.tailFilter.frequency.value = p.tailFilterFreq;
              });
              initFxSliders(body, { 'fx-r-decay': fmtSec, 'fx-r-predly': fmtMs, 'fx-r-wet': fmt2, 'fx-r-tffreq': fmtHz });
            }

            function rebuild() { body.innerHTML = buildHTML(); wire(); }
            rebuild();
          }
        },
        delay: {
          build(body, p, node, inst, s) {
            if (!p.syncMode) p.syncMode = false;
            if (!p.subdivision) p.subdivision = '4n';
            if (!p.mode) p.mode = 'mono';
            const subdivBeats = {
              '2n': 2, '2n.': 3, '2t': 4 / 3,
              '4n': 1, '4n.': 1.5, '4t': 2 / 3,
              '8n': 0.5, '8n.': 0.75, '8t': 1 / 3,
              '16n': 0.25, '16n.': 0.375, '16t': 1 / 6,
            };
            const subdivList = [
              ['2n.', '1/2·'], ['2n', '1/2'], ['4n.', '1/4·'], ['2t', '1/2T'],
              ['4n', '1/4'], ['8n.', '1/8·'], ['4t', '1/4T'], ['8n', '1/8'],
              ['16n.', '1/16·'], ['8t', '1/8T'], ['16n', '1/16'], ['16t', '1/16T'],
            ];

            function buildHTML() {
              const mode = p.mode || 'mono';
              const modeLabels = { mono: 'MONO', pingpong: 'PING-PONG', filtered: 'TAPE' };
              let h = `<div class="crow" style="margin-bottom:6px;gap:2px">` +
                Object.entries(modeLabels).map(([m, lbl]) =>
                  `<button class="cbtn fx-d-mode-btn" data-mode="${m}" style="font-size:8px;padding:2px 5px;${mode === m ? 'border-color:#888;color:#fff' : ''}">${lbl}</button>`
                ).join('') + `</div>`;
              h += sliderRow('Time', 'fx-d-time', 0, 2, p.delayTime ?? 0.25, 0.01);
              h += `<div class="fx-d-subdiv-row" style="display:none;flex-wrap:wrap;gap:2px;margin:0 -10px 8px;padding:4px 8px;border-top:1px solid #161616;border-bottom:1px solid #161616">` +
                subdivList.map(([k, lbl]) => `<button class="cbtn fx-subdiv-btn" data-sub="${k}" style="background:none;font-size:8px;padding:3px 2px;min-width:0">${lbl}</button>`).join('') +
                `</div>`;
              h += sliderRow('Feedback', 'fx-d-fb', 0, 0.99, p.feedback ?? 0.35, 0.01);
              if (mode === 'filtered') {
                h += `<div class="crow" style="margin-bottom:4px"><span class="clbl" style="font-size:8px">Filter</span><div style="display:flex;gap:2px">` +
                  [['lowpass', 'LP'], ['highpass', 'HP'], ['bandpass', 'BP']].map(([t, l]) =>
                    `<button class="cbtn fx-d-ft-btn" data-ft="${t}" style="font-size:8px;padding:2px 5px;${(p.filterType || 'lowpass') === t ? 'border-color:#888;color:#fff' : ''}">${l}</button>`
                  ).join('') + `</div></div>`;
                h += sliderRow('Filt Hz', 'fx-d-filtfreq', 100, 12000, p.filterFreq ?? 2000, 1);
              }
              h += sliderRow('Wet', 'fx-d-wet', 0, 1, p.wet ?? 0.4, 0.01);
              h += `<div class="crow" style="margin-top:2px"><span class="clbl" style="font-size:8px">Sync</span><button class="cbtn fx-sync-toggle" style="font-size:8px;padding:2px 8px">FREE</button></div>`;
              return h;
            }

            function wire() {
              const timeRow  = body.querySelector('.fx-d-time')?.closest('.crow');
              const subdivRow = body.querySelector('.fx-d-subdiv-row');
              const syncBtn  = body.querySelector('.fx-sync-toggle');

              function applyDelayTime(val) {
                p.delayTime = val;
                if (inst.delayData) { inst.delayData.delay.delayTime.linearRampTo(val, 0.05); }
                else { inst.node.delayTime.linearRampTo(val, 0.05); }
              }
              function applySubdiv(sub) {
                p.subdivision = sub;
                const sec = (60 / Tone.Transport.bpm.value) * (subdivBeats[sub] ?? 1);
                applyDelayTime(Math.min(sec, 2));
                body.querySelectorAll('.fx-subdiv-btn').forEach(b => {
                  b.style.color = b.dataset.sub === sub ? '#e0e0e0' : '';
                  b.style.borderColor = b.dataset.sub === sub ? '#686868' : '';
                });
              }
              function setSyncMode(on) {
                p.syncMode = on;
                if (syncBtn) syncBtn.textContent = on ? 'TEMPO' : 'FREE';
                if (timeRow) timeRow.style.display = on ? 'none' : '';
                if (subdivRow) subdivRow.style.display = on ? 'flex' : 'none';
                if (on) applySubdiv(p.subdivision);
              }

              body.querySelectorAll('.fx-d-mode-btn').forEach(btn => {
                btn.addEventListener('click', ev => {
                  ev.stopPropagation();
                  if (p.mode === btn.dataset.mode) return;
                  _switchDelayMode(inst, btn.dataset.mode, s);
                  rebuild();
                });
              });
              syncBtn?.addEventListener('click', e => { e.stopPropagation(); setSyncMode(!p.syncMode); });
              body.querySelectorAll('.fx-subdiv-btn').forEach(btn => {
                btn.addEventListener('click', e => { e.stopPropagation(); applySubdiv(btn.dataset.sub); });
              });
              body.querySelector('.fx-d-time')?.addEventListener('input', e => { applyDelayTime(parseFloat(e.target.value)); });
              body.querySelector('.fx-d-fb')?.addEventListener('input', e => {
                p.feedback = parseFloat(e.target.value);
                if (inst.delayData) { inst.delayData.feedbackGain.gain.value = p.feedback; }
                else { inst.node.feedback.value = p.feedback; }
              });
              body.querySelectorAll('.fx-d-ft-btn').forEach(btn => {
                btn.addEventListener('click', ev => {
                  ev.stopPropagation();
                  p.filterType = btn.dataset.ft;
                  if (inst.delayData?.feedbackFilter) inst.delayData.feedbackFilter.type = p.filterType;
                  body.querySelectorAll('.fx-d-ft-btn').forEach(b => { b.style.color = b === btn ? '#fff' : ''; b.style.borderColor = b === btn ? '#888' : ''; });
                });
              });
              body.querySelector('.fx-d-filtfreq')?.addEventListener('input', e => {
                p.filterFreq = parseFloat(e.target.value);
                if (inst.delayData?.feedbackFilter) inst.delayData.feedbackFilter.frequency.value = p.filterFreq;
              });
              body.querySelector('.fx-d-wet')?.addEventListener('input', e => {
                p.wet = parseFloat(e.target.value);
                if (inst.delayData) { inst.delayData.wetGain.gain.value = p.wet; inst.delayData.dryGain.gain.value = 1 - p.wet; }
                else { inst.node.wet.value = p.wet; }
              });
              initFxSliders(body, { 'fx-d-time': fmtSec, 'fx-d-fb': fmt2, 'fx-d-filtfreq': fmtHz, 'fx-d-wet': fmt2 });
              setSyncMode(p.syncMode);
            }

            function rebuild() { body.innerHTML = buildHTML(); wire(); }
            rebuild();
          }
        },
        tremolo: {
          build(body, p, node) {
            body.innerHTML =
              sliderRow('Rate', 'fx-tr-rate', 0.1, 20, p.frequency, 0.1) +
              sliderRow('Depth', 'fx-tr-depth', 0, 1, p.depth, 0.01) +
              sliderRow('Wet', 'fx-tr-wet', 0, 1, p.wet, 0.01);
            body.querySelector('.fx-tr-rate').addEventListener('input', e => {
              p.frequency = parseFloat(e.target.value); node.frequency.value = p.frequency;
            });
            body.querySelector('.fx-tr-depth').addEventListener('input', e => {
              p.depth = parseFloat(e.target.value); node.depth.value = p.depth;
            });
            body.querySelector('.fx-tr-wet').addEventListener('input', e => {
              p.wet = parseFloat(e.target.value); node.wet.value = p.wet;
            });
            initFxSliders(body, { 'fx-tr-rate': fmtHz1, 'fx-tr-depth': fmt2, 'fx-tr-wet': fmt2 });
          }
        },
        dist: {
          build(body, p, node) {
            body.innerHTML =
              sliderRow('Drive', 'fx-di-drive', 0, 1, p.distortion, 0.01) +
              sliderRow('Wet', 'fx-di-wet', 0, 1, p.wet, 0.01);
            body.querySelector('.fx-di-drive').addEventListener('input', e => {
              p.distortion = parseFloat(e.target.value); node.distortion = p.distortion;
            });
            body.querySelector('.fx-di-wet').addEventListener('input', e => {
              p.wet = parseFloat(e.target.value); node.wet.value = p.wet;
            });
            initFxSliders(body, { 'fx-di-drive': fmt2, 'fx-di-wet': fmt2 });
          }
        },
        chorus: {
          build(body, p, node) {
            body.innerHTML =
              sliderRow('Rate', 'fx-ch-rate', 0.1, 10, p.frequency, 0.1) +
              sliderRow('Delay', 'fx-ch-dly', 2, 20, p.delayTime, 0.1) +
              sliderRow('Depth', 'fx-ch-depth', 0, 1, p.depth, 0.01) +
              sliderRow('Wet', 'fx-ch-wet', 0, 1, p.wet, 0.01);
            body.querySelector('.fx-ch-rate').addEventListener('input', e => {
              p.frequency = parseFloat(e.target.value); node.frequency.value = p.frequency;
            });
            body.querySelector('.fx-ch-dly').addEventListener('input', e => {
              p.delayTime = parseFloat(e.target.value); node.delayTime = p.delayTime;
            });
            body.querySelector('.fx-ch-depth').addEventListener('input', e => {
              p.depth = parseFloat(e.target.value); node.depth.value = p.depth;
            });
            body.querySelector('.fx-ch-wet').addEventListener('input', e => {
              p.wet = parseFloat(e.target.value); node.wet.value = p.wet;
            });
            initFxSliders(body, { 'fx-ch-rate': fmtHz1, 'fx-ch-dly': v => parseFloat(v).toFixed(1) + 'ms', 'fx-ch-depth': fmt2, 'fx-ch-wet': fmt2 });
          }
        },
        phaser: {
          build(body, p, node) {
            body.innerHTML =
              sliderRow('Rate', 'fx-ph-rate', 0.1, 20, p.frequency, 0.1) +
              sliderRow('Octaves', 'fx-ph-oct', 0, 8, p.octaves, 0.1) +
              sliderRow('Base Hz', 'fx-ph-base', 100, 4000, p.baseFrequency, 1) +
              sliderRow('Wet', 'fx-ph-wet', 0, 1, p.wet, 0.01);
            body.querySelector('.fx-ph-rate').addEventListener('input', e => {
              p.frequency = parseFloat(e.target.value); node.frequency.value = p.frequency;
            });
            body.querySelector('.fx-ph-oct').addEventListener('input', e => {
              p.octaves = parseFloat(e.target.value); node.octaves = p.octaves;
            });
            body.querySelector('.fx-ph-base').addEventListener('input', e => {
              p.baseFrequency = parseFloat(e.target.value); node.baseFrequency = p.baseFrequency;
            });
            body.querySelector('.fx-ph-wet').addEventListener('input', e => {
              p.wet = parseFloat(e.target.value); node.wet.value = p.wet;
            });
            initFxSliders(body, { 'fx-ph-rate': fmtHz1, 'fx-ph-oct': fmt2, 'fx-ph-base': fmtHz, 'fx-ph-wet': fmt2 });
          }
        },
        bitcrush: {
          build(body, p, node) {
            body.innerHTML =
              sliderRow('Bits', 'fx-bc-bits', 1, 16, p.bits, 1) +
              sliderRow('Wet', 'fx-bc-wet', 0, 1, p.wet, 0.01);
            body.querySelector('.fx-bc-bits').addEventListener('input', e => {
              p.bits = Math.round(parseFloat(e.target.value)); node.bits = p.bits;
            });
            body.querySelector('.fx-bc-wet').addEventListener('input', e => {
              p.wet = parseFloat(e.target.value); node.wet.value = p.wet;
            });
            initFxSliders(body, { 'fx-bc-bits': fmtInt, 'fx-bc-wet': fmt2 });
          }
        },
      };

      const shortNames = { eq: 'EQ', reverb: 'REV', delay: 'DLY', tremolo: 'TRM', dist: 'DST', chorus: 'CHR', phaser: 'PHS', bitcrush: 'BIT' };

      const btnRow = document.createElement('div');
      btnRow.className = 'fx-btn-row';

      const panelsEl = document.createElement('div');

      // Build a panel DOM element for an existing or newly-created fx instance
      function buildFxPanel(inst) {
        const fxType = inst.type;
        const defName = s.fxCatalog.find(d => d.id === fxType)?.name || fxType;
        const panelEl = document.createElement('div');
        panelEl.className = 'fx-panel';
        panelEl.dataset.fxUid = inst.uid;
        panelEl.style.setProperty('--fx-color', s.color);
        const hdr = document.createElement('div');
        hdr.className = 'fx-panel-hdr';
        hdr.innerHTML = `<span class="fx-panel-lbl">${defName}</span>`;
        const hdrRight = document.createElement('div');
        hdrRight.style.cssText = 'display:flex;align-items:center;gap:2px';
        const faderBtn = document.createElement('button');
        faderBtn.className = 'fx-fader-btn' + (inst.postFader ? ' active' : '');
        faderBtn.textContent = inst.postFader ? 'POST' : 'PRE';
        faderBtn.title = 'Toggle pre/post volume fader';
        faderBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          inst.postFader = !inst.postFader;
          faderBtn.textContent = inst.postFader ? 'POST' : 'PRE';
          faderBtn.classList.toggle('active', inst.postFader);
          s.rebuildFxChain();
        });
        hdrRight.appendChild(faderBtn);
        const removeBtn = document.createElement('button');
        removeBtn.className = 'fx-panel-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          s.removeFxInstance(inst.uid);
          panelEl.remove();
        });
        hdrRight.appendChild(removeBtn);
        hdr.appendChild(hdrRight);
        const body = document.createElement('div');
        body.className = 'fx-body-inner';
        panelEl.appendChild(hdr);
        panelEl.appendChild(body);
        if (fxType === 'eq') {
          body.innerHTML = `
            <div class="crow" style="margin-bottom:5px;justify-content:flex-end">
              <button class="cbtn card-eq-clear" style="padding:3px 8px;font-size:9px">Clear</button>
            </div>
            <canvas class="card-eq-canvas" height="80" style="width:100%;display:block"></canvas>
            <div class="eq-hint">drag bands · scroll = Q</div>`;
          panelsEl.appendChild(panelEl);
          const canvas = body.querySelector('.card-eq-canvas');
          requestAnimationFrame(() => initEqCanvas(canvas, inst.eqData.bands, i => inst.eqData.applyBand(i), s.color));
        } else {
          FX_PANELS[fxType].build(body, inst.params, inst.node, inst, s);
          panelsEl.appendChild(panelEl);
        }
      }

      for (const def of s.fxCatalog) {
        const btn = document.createElement('button');
        btn.className = 'fx-btn';
        btn.style.setProperty('--fx-color', s.color);
        btn.textContent = shortNames[def.id] || def.id.toUpperCase().slice(0, 3);
        btnRow.appendChild(btn);

        btn.addEventListener('click', e => {
          e.stopPropagation();
          const inst = s.addFxInstance(def.id);
          if (!inst) return;
          buildFxPanel(inst);
        });
      }

      // Restore panels for effects already on this instrument
      for (const inst of s.fxChain) buildFxPanel(inst);

      fxSection.appendChild(btnRow);
      fxSection.appendChild(panelsEl);
    }

    // ── EQ Canvas (shared, called from buildFxSection) ──
    function initEqCanvas(eqCanvas, eqBands, applyBandFn, color) {
      const eqCtx = eqCanvas.getContext('2d');
      const MIN_F = 20, MAX_F = 20000, MAX_G = 18;
      let dragBand = -1;

      function fToX(f, W) {
        return Math.log10(f / MIN_F) / Math.log10(MAX_F / MIN_F) * W;
      }
      function xToF(x, W) {
        return MIN_F * Math.pow(MAX_F / MIN_F, Math.max(0, Math.min(1, x / W)));
      }
      function gToY(g, H) { return (MAX_G - g) / (MAX_G * 2) * H; }
      function yToG(y, H) { return MAX_G - y / H * (MAX_G * 2); }

      function initCanvas() {
        eqCanvas.width = eqCanvas.offsetWidth || 264;
        eqCanvas.height = 80;
        draw();
      }

      function draw() {
        const W = eqCanvas.width, H = eqCanvas.height;
        if (!W || !H) return;
        const ctx = eqCtx;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // Grid
        const y0 = gToY(0, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
        [100, 1000, 10000].forEach(f => {
          const x = Math.round(fToX(f, W)) + 0.5;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        });

        // Compute aggregate frequency response via temp BiquadFilterNodes
        const ac = Tone.context.rawContext;
        const freqs = new Float32Array(W);
        for (let i = 0; i < W; i++) freqs[i] = xToF(i, W);
        const totalDb = new Float32Array(W);
        eqBands.forEach(band => {
          const node = ac.createBiquadFilter();
          node.type = band.type;
          node.frequency.value = band.freq;
          node.Q.value = band.q;
          if (band.type === 'peaking') node.gain.value = band.gain || 0;
          const mag = new Float32Array(W);
          node.getFrequencyResponse(freqs, mag, new Float32Array(W));
          for (let i = 0; i < W; i++) totalDb[i] += 20 * Math.log10(Math.max(1e-6, mag[i]));
        });

        // Fill between curve and 0dB
        const col = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let i = 0; i < W; i++) ctx.lineTo(i, Math.max(0, Math.min(H, gToY(totalDb[i], H))));
        ctx.lineTo(W, y0);
        ctx.closePath();
        ctx.fillStyle = col + '18';
        ctx.fill();

        // Response curve
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < W; i++) {
          const y = Math.max(0, Math.min(H, gToY(totalDb[i], H)));
          if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
        }
        ctx.stroke();

        // Freq labels
        ctx.font = '8px Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        [[100, '100'], [1000, '1k'], [10000, '10k']].forEach(([f, l]) => {
          ctx.fillText(l, fToX(f, W), H - 1);
        });

        // dB labels
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        [12, -12].forEach(db => {
          ctx.fillText((db > 0 ? '+' : '') + db, 2, gToY(db, H));
        });

        // Band handles
        eqBands.forEach((band, i) => {
          const bx = Math.max(6, Math.min(W - 6, fToX(band.freq, W)));
          const by = band.type === 'peaking'
            ? Math.max(6, Math.min(H - 6, gToY(band.gain || 0, H)))
            : H / 2;
          const isHP = band.type === 'highpass';
          const isLP = band.type === 'lowpass';
          const isActive = isHP ? band.freq > 25
            : isLP ? band.freq < 19000
              : Math.abs(band.gain || 0) > 0.1;
          const r = dragBand === i ? 7 : 5;

          if (isHP) {
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(bx, 0); ctx.lineTo(bx, H); ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fillStyle = isActive ? col + '12' : '#ffffff06';
            ctx.fill();
          }
          if (isLP) {
            ctx.beginPath();
            ctx.moveTo(bx, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(bx, H);
            ctx.closePath();
            ctx.fillStyle = isActive ? col + '12' : '#ffffff06';
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fillStyle = isActive ? '#fff' : '#262626';
          ctx.fill();
          ctx.strokeStyle = isActive ? '#fff' : 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          ctx.stroke();

          if (isHP || isLP) {
            ctx.font = '7px Courier New';
            ctx.textAlign = isHP ? 'right' : 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isActive ? '#fff' : 'rgba(255,255,255,0.2)';
            const label = isHP ? 'HP' : 'LP';
            ctx.fillText(label, isHP ? bx - r - 3 : bx + r + 3, by);
          }
        });
      }

      function getBandAt(mx, my) {
        const W = eqCanvas.width, H = eqCanvas.height;
        let best = -1, bestDist = Infinity;
        eqBands.forEach((band, i) => {
          const bx = Math.max(6, Math.min(W - 6, fToX(band.freq, W)));
          const by = band.type === 'peaking'
            ? Math.max(6, Math.min(H - 6, gToY(band.gain || 0, H)))
            : H / 2;
          const d = Math.hypot(mx - bx, my - by);
          if (d < bestDist) { bestDist = d; best = i; }
        });
        return bestDist < 20 ? best : -1;
      }

      eqCanvas.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        const rect = eqCanvas.getBoundingClientRect();
        const sx = eqCanvas.width / rect.width, sy = eqCanvas.height / rect.height;
        const mx = (e.clientX - rect.left) * sx;
        const my = (e.clientY - rect.top) * sy;
        dragBand = getBandAt(mx, my);
        if (dragBand < 0) return;
        draw();

        const W = eqCanvas.width, H = eqCanvas.height;
        const onMove = ev => {
          const mx2 = (ev.clientX - rect.left) * sx;
          const my2 = (ev.clientY - rect.top) * sy;
          const band = eqBands[dragBand];
          band.freq = Math.max(MIN_F, Math.min(MAX_F, xToF(mx2, W)));
          if (band.type === 'peaking') {
            band.gain = Math.max(-MAX_G, Math.min(MAX_G, yToG(my2, H)));
          }
          applyBandFn(dragBand);
          draw();
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          dragBand = -1;
          draw();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      eqCanvas.addEventListener('mousemove', e => {
        if (dragBand >= 0) return;
        const rect = eqCanvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (eqCanvas.width / rect.width);
        const my = (e.clientY - rect.top) * (eqCanvas.height / rect.height);
        eqCanvas.style.cursor = getBandAt(mx, my) >= 0 ? 'grab' : 'crosshair';
      });

      eqCanvas.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = eqCanvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (eqCanvas.width / rect.width);
        const my = (e.clientY - rect.top) * (eqCanvas.height / rect.height);
        const bi = getBandAt(mx, my);
        if (bi < 0 || eqBands[bi].type !== 'peaking') return;
        const band = eqBands[bi];
        band.q = Math.max(0.1, Math.min(20, band.q * (e.deltaY > 0 ? 1.25 : 0.8)));
        applyBandFn(bi);
        draw();
      }, { passive: false });

      const clearBtn = eqCanvas.closest('.fx-body-inner')?.querySelector('.card-eq-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', e => {
          e.stopPropagation();
          eqBands[0].freq = 20; eqBands[0].q = 0.707;
          eqBands[1].freq = 200; eqBands[1].gain = 0; eqBands[1].q = 1;
          eqBands[2].freq = 1000; eqBands[2].gain = 0; eqBands[2].q = 1;
          eqBands[3].freq = 8000; eqBands[3].gain = 0; eqBands[3].q = 1;
          eqBands[4].freq = 22050; eqBands[4].q = 0.707;
          for (let i = 0; i < 5; i++) applyBandFn(i);
          draw();
        });
      }

      eqCanvas._redraw = draw;
      requestAnimationFrame(initCanvas);
    }

    function initCslider(wrap, fmt) {
      if (!fmt) fmt = fmtFade;
      const native = wrap.querySelector('input[type=range]');
      const thumb = wrap.querySelector('.cslider-thumb');
      const lbl = wrap.querySelector('.cslider-lbl');
      const edit = wrap.querySelector('.cslider-edit');

      function syncPos() {
        const min = parseFloat(native.min), max = parseFloat(native.max);
        const val = parseFloat(native.value);
        const norm = max > min ? (val - min) / (max - min) : 0;
        thumb.style.left = (Math.max(0, Math.min(1, norm)) * 100) + '%';
        lbl.textContent = fmt(val);
      }
      wrap._syncPos = syncPos;
      native.addEventListener('input', syncPos);
      syncPos();

      wrap.addEventListener('mousedown', e => {
        if (wrap.classList.contains('editing') || native.disabled) return;
        e.preventDefault(); e.stopPropagation();
        const rect = wrap.getBoundingClientRect();
        function update(ev) {
          const min = parseFloat(native.min), max = parseFloat(native.max);
          const step = parseFloat(native.step) || 0.001;
          const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          const raw = min + t * (max - min);
          const stepped = Math.round(raw / step) * step;
          native.value = Math.max(min, Math.min(max, stepped));
          native.dispatchEvent(new Event('input'));
        }
        update(e);
        const mm = ev => update(ev);
        const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });

      thumb.addEventListener('dblclick', e => {
        e.stopPropagation();
        if (native.disabled) return;
        wrap.classList.add('editing');
        edit.value = parseFloat(native.value).toFixed(3);
        edit.focus(); edit.select();
      });

      edit.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') edit.blur();
      });
      edit.addEventListener('blur', () => {
        wrap.classList.remove('editing');
        const v = parseFloat(edit.value);
        if (!isNaN(v)) {
          const min = parseFloat(native.min), max = parseFloat(native.max);
          native.value = Math.max(min, Math.min(max, v));
          native.dispatchEvent(new Event('input'));
        }
      });
      edit.addEventListener('click', e => e.stopPropagation());
      edit.addEventListener('mousedown', e => e.stopPropagation());
    }

    // Tile click opens/closes card for that sample
    function openInspector(id) {
      const t = document.getElementById('t' + id);
      if (t) openCard(id, t);
    }
    function closeInspector(id) { closeCard(id); }
