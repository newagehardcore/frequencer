    // ════════════════════════════════════════════════════
    // RECORDING  — MediaRecorder → decodeAudioData → WAV
    // AudioWorklet and ScriptProcessorNode both fail from
    // file:// context; MediaStreamDestination works fine.
    // The recorded buffer is decoded back to PCM and written
    // as a standard 16-bit WAV so DAWs open it natively.
    // ════════════════════════════════════════════════════
    let isRecording = false;
    let recRaf = null;
    let recStartTime = null;
    let recTs = '';
    let recMixState = null;            // { rec, chunks, dest, sources }
    const recStems = new Map();        // sampleId → { rec, chunks, dest, src, name }

    document.getElementById('btn-rec').addEventListener('click', async () => {
      await ensureAudio();
      if (isRecording) stopRecording();
      else startRecording();
    });

    function startRecording() {
      // Collect all instruments that have a .vol node (samples + synths + drums)
      const active = [
        ...[...samples.values()].filter(s => s instanceof Sample),
        ...[...synths.values()].filter(s => s instanceof SynthInstrument),
        ...[...drums.values()].filter(s => s instanceof SynthInstrument),
      ];
      if (!active.length) return;

      isRecording = true;
      recStartTime = Date.now();
      recTs = recTimestampStr();

      const ctx = Tone.context.rawContext;

      // Mix: all output taps → one MediaStreamDestination (captures full fx chain)
      const mixDest = ctx.createMediaStreamDestination();
      for (const s of active) s._outputTap.connect(mixDest);
      const mixRec = new MediaRecorder(mixDest.stream);
      const mixChunks = [];
      mixRec.ondataavailable = e => { if (e.data.size > 0) mixChunks.push(e.data); };
      mixRec.start();
      recMixState = { rec: mixRec, chunks: mixChunks, dest: mixDest, sources: [...active] };

      // Stems: one MediaStreamDestination per instrument
      recStems.clear();
      for (const s of active) {
        const dest = ctx.createMediaStreamDestination();
        s._outputTap.connect(dest);
        const rec = new MediaRecorder(dest.stream);
        const chunks = [];
        rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        rec.start();
        recStems.set(s.id, { rec, chunks, dest, src: s._outputTap, name: s.name });
      }

      document.getElementById('btn-rec').classList.add('recording');
      document.getElementById('rec-timer').classList.add('active');
      recTimerTick();

      // Start MIDI capture (after audio recording is confirmed started)
      try {
        const midiBpm = Tone.Transport.bpm.value;
        const midiStartTime = ctx.currentTime;
        for (const [, riff] of riffs) {
          riff._midiCapture = new MidiCapture(riff.name, midiBpm);
          riff._midiCapture.start(midiStartTime);
        }
        for (const [, ch] of chords) {
          ch._midiCapture = new MidiCapture(ch.name, midiBpm);
          ch._midiCapture.start(midiStartTime);
        }
      } catch (e) { console.warn('MIDI capture init failed:', e); }
    }

    function stopRecording() {
      if (!isRecording) return;
      isRecording = false;
      cancelAnimationFrame(recRaf);

      const ts = recTs;
      const ctx = Tone.context.rawContext;

      // Track mix and stems separately so the modal knows which is which
      let mixJob = null;
      const stemJobList = [];

      if (recMixState) {
        const { rec, chunks, dest, sources } = recMixState;
        const p = new Promise(res => { rec.onstop = res; });
        rec.stop();
        mixJob = {
          p, chunks, mimeType: rec.mimeType,
          cleanup: () => { for (const s of sources) { try { s._outputTap.disconnect(dest); } catch (e) { } } }
        };
        recMixState = null;
      }

      for (const [, cap] of recStems) {
        const { rec, chunks, dest, src, name } = cap;
        const p = new Promise(res => { rec.onstop = res; });
        rec.stop();
        stemJobList.push({
          p, chunks, mimeType: rec.mimeType,
          safeName: name.replace(/[^a-z0-9_\-\.]/gi, '_'),
          cleanup: () => { try { src.disconnect(dest); } catch (e) { } }
        });
      }
      recStems.clear();

      // Helper: disconnect nodes, decode webm → AudioBuffer → WAV blob
      const decodeToWAV = async (job) => {
        job.cleanup();
        const raw = new Blob(job.chunks, { type: job.mimeType });
        try {
          const audioBuf = await ctx.decodeAudioData(await raw.arrayBuffer());
          return audioBufToWAV(audioBuf);
        } catch {
          return raw; // fallback to raw webm if decode fails
        }
      };

      // Collect MIDI files from riffs and chords
      const midiFiles = [];
      for (const [, riff] of riffs) {
        if (riff._midiCapture && riff._midiCapture.events.length) {
          const safeName = riff.name.replace(/[^a-z0-9_\-\.]/gi, '_');
          midiFiles.push({ blob: riff._midiCapture.toMidiBlob(), filename: `${ts}_${safeName}.mid` });
        }
        riff._midiCapture = null;
      }
      for (const [, ch] of chords) {
        if (ch._midiCapture && ch._midiCapture.events.length) {
          const safeName = ch.name.replace(/[^a-z0-9_\-\.]/gi, '_');
          midiFiles.push({ blob: ch._midiCapture.toMidiBlob(), filename: `${ts}_${safeName}.mid` });
        }
        ch._midiCapture = null;
      }

      const allJobs = [mixJob, ...stemJobList].filter(Boolean);
      Promise.all(allJobs.map(j => j.p)).then(async () => {
        const mixWav = mixJob ? await decodeToWAV(mixJob) : null;
        const stemWavs = await Promise.all(
          stemJobList.map(async job => ({
            wav: await decodeToWAV(job),
            filename: `${ts}_${job.safeName}.wav`
          }))
        );
        showRecModal(ts, mixWav, stemWavs, midiFiles);
      });

      document.getElementById('btn-rec').classList.remove('recording');
      const timerEl = document.getElementById('rec-timer');
      timerEl.classList.remove('active');
      timerEl.textContent = '--:--';
    }

    function showRecModal(ts, mixWav, stemWavs, midiFiles = []) {
      const modal = document.getElementById('rec-modal');
      modal.style.display = 'flex';

      const close = () => { modal.style.display = 'none'; };

      const dlMix = () => {
        if (mixWav) recDownload(mixWav, `${ts}_mix.wav`);
      };

      const dlStems = async () => {
        const zip = new JSZip();
        for (const { wav, filename } of stemWavs) zip.file(filename, wav);
        for (const { blob, filename } of midiFiles) zip.file(filename, blob);
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        recDownload(zipBlob, `${ts}_stems.zip`);
      };

      const dlMidi = () => {
        for (const { blob, filename } of midiFiles) recDownload(blob, filename);
      };

      // Show/hide MIDI button based on whether there are MIDI files
      const midiBtn = document.getElementById('rec-dl-midi');
      if (midiBtn) midiBtn.style.display = midiFiles.length ? '' : 'none';

      document.getElementById('rec-dl-both').onclick = async () => { close(); dlMix(); await dlStems(); };
      document.getElementById('rec-dl-mix').onclick = () => { close(); dlMix(); };
      document.getElementById('rec-dl-stems').onclick = async () => { close(); await dlStems(); };
      if (midiBtn) midiBtn.onclick = () => { close(); dlMidi(); };
      document.getElementById('rec-dl-cancel').onclick = () => { close(); };
    }

    // Encode an AudioBuffer as a 16-bit PCM WAV blob
    function audioBufToWAV(audioBuf) {
      const sr = audioBuf.sampleRate;
      const nCh = Math.min(2, audioBuf.numberOfChannels);
      const nFrames = audioBuf.length;
      const bps = 16, blockAlign = nCh * (bps / 8);
      const dataBytes = nFrames * blockAlign;
      const buf = new ArrayBuffer(44 + dataBytes);
      const v = new DataView(buf);
      const ws = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true);
      ws(8, 'WAVE'); ws(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); // PCM
      v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
      v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true);
      v.setUint16(34, bps, true); ws(36, 'data'); v.setUint32(40, dataBytes, true);
      const channels = Array.from({ length: nCh }, (_, c) => audioBuf.getChannelData(c));
      let off = 44;
      for (let i = 0; i < nFrames; i++) {
        for (let c = 0; c < nCh; c++) {
          v.setInt16(off, Math.max(-1, Math.min(1, channels[c][i])) * 0x7FFF, true);
          off += 2;
        }
      }
      return new Blob([buf], { type: 'audio/wav' });
    }

    function recTimestampStr() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    }

    function recDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    }

    function recTimerTick() {
      const el = document.getElementById('rec-timer');
      const tick = () => {
        if (!isRecording) return;
        const sec = Math.floor((Date.now() - recStartTime) / 1000);
        el.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
        recRaf = requestAnimationFrame(tick);
      };
      recRaf = requestAnimationFrame(tick);
    }

