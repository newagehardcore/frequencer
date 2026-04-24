    function openSynthCard(id, tile) {
      const synth = synths.get(id) || drums.get(id);
      if (!(synth instanceof SynthInstrument)) return;
      if (openCards.has(id)) { openCards.get(id).el.style.zIndex = ++cardZTop; return; }
      if (!tile) tile = document.getElementById('t' + id);
      createSynthCard(synth, tile);
      updateSampleList();
    }

    function closeSynthCard(id) {
      const info = openCards.get(id);
      if (!info) return;
      info.el.remove();
      openCards.delete(id);
      const tile = document.getElementById('t' + id);
      if (tile) {
        tile.classList.remove('active', 'expanded');
        syncParamPorts(tile, null);
      }
      const synth = synths.get(id) || drums.get(id);
      if (synth) synth._refreshSf2List = null;
      updateSampleList();
    }

    function _positionCard(el, tile, w, h) {
      // Cards are position:absolute in #cv — use world coordinates so they scroll with the canvas
      const cvRect = cv.getBoundingClientRect();
      const r = tile ? tile.getBoundingClientRect() : null;
      const x = r ? Math.max(0, Math.min(WORLD_W - w, r.left - cvRect.left + cv.scrollLeft)) : (cv.scrollLeft + 20);
      const y = r ? Math.max(0, Math.min(WORLD_H - h, r.top  - cvRect.top  + cv.scrollTop))  : (cv.scrollTop  + 60);
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
      el.style.zIndex = ++cardZTop;
    }

    // Sync tile port positions to the actual rendered card dimensions (call after cv.appendChild)
    function _syncTilePorts(tile, cardEl) {
      if (!tile) return;
      const w = cardEl.offsetWidth;
      const h = cardEl.scrollHeight; // scrollHeight works even when max-height:0 clips offsetHeight
      const midY = (h / 2) + 'px';
      const inP  = tile.querySelector('.tile-in-port');
      const outP = tile.querySelector('.tile-out-port');
      if (inP)  inP.style.top  = midY;
      if (outP) { outP.style.top = midY; outP.style.left = (w - 7) + 'px'; }
    }

    function _makeSynthCardDrag(el, synth) {
      el._tbDragged = false;
      el.addEventListener('mousedown', () => el.style.zIndex = ++cardZTop);
      el.querySelector('.card-titlebar').addEventListener('mousedown', e => {
        if (e.button !== 0 || e.target.closest('button') || e.target.closest('select')) return;
        e.preventDefault();
        el._tbDragged = false;
        const ox = e.clientX, oy = e.clientY;
        const oL = parseFloat(el.style.left) || 0, oT = parseFloat(el.style.top) || 0;
        const tileEl = document.getElementById('t' + synth.id);
        const mm = ev => {
          if (Math.abs(ev.clientX - ox) + Math.abs(ev.clientY - oy) > 3) el._tbDragged = true;
          const cw = el.offsetWidth, ch = el.offsetHeight;
          const nx = Math.max(0, Math.min(WORLD_W - cw, oL + (ev.clientX - ox)));
          const ny = Math.max(0, Math.min(WORLD_H - ch, oT + (ev.clientY - oy)));
          el.style.left = nx + 'px';
          el.style.top  = ny + 'px';
          if (tileEl) {
            tileEl.style.left = nx + 'px';
            tileEl.style.top  = ny + 'px';
          }
          synth.x = nx + TW / 2;
          synth.y = ny + TH / 2;
          updateLfoWires();
        };
        const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
    }

    function buildPianoKeyboard(container, synth) {
      container.style.setProperty('--card-color', synth.color);
      const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const WHITE_IN_OCT = [0,2,4,5,7,9,11]; // semitones that are white keys
      const BLACK_IN_OCT = [1,3,6,8,10];
      // Black key offsets relative to white key index within octave
      // C#=after C(0), D#=after D(1), F#=after F(3), G#=after G(4), A#=after A(5)
      const BLACK_WHITE_IDX = { 1:0, 3:1, 6:3, 8:4, 10:5 };

      let kbdOctave = 3; // base octave (shows two octaves: kbdOctave and kbdOctave+1)
      const kbdEl = document.createElement('div');
      kbdEl.className = 'synth-keyboard';
      kbdEl.style.setProperty('--card-color', synth.color);

      // Keyboard wraps full width, controls row below
      const kbdWrap = document.createElement('div');
      kbdWrap.className = 'synth-kbd-wrap';
      kbdWrap.appendChild(kbdEl);

      const kbdCtrl = document.createElement('div');
      kbdCtrl.className = 'synth-kbd-ctrl';
      const octDown = document.createElement('button');
      octDown.className = 'synth-oct-btn'; octDown.textContent = '◂';
      const octLbl = document.createElement('span');
      octLbl.className = 'synth-oct-lbl';
      const octUp = document.createElement('button');
      octUp.className = 'synth-oct-btn'; octUp.textContent = '▸';
      kbdCtrl.appendChild(octDown); kbdCtrl.appendChild(octLbl); kbdCtrl.appendChild(octUp);

      function buildKeys() {
        kbdEl.innerHTML = '';
        octLbl.textContent = 'C' + kbdOctave;
        const notes = [];
        for (let oct = kbdOctave; oct <= kbdOctave + 1; oct++) {
          WHITE_IN_OCT.forEach((semi, wOctIdx) => {
            notes.push({ note: NOTE_NAMES[semi] + oct, white: true, wIdx: (oct - kbdOctave) * 7 + wOctIdx });
          });
          BLACK_IN_OCT.forEach(semi => {
            notes.push({ note: NOTE_NAMES[semi] + oct, white: false, wIdx: (oct - kbdOctave) * 7 + BLACK_WHITE_IDX[semi] });
          });
        }
        const whites = notes.filter(n => n.white).sort((a,b) => a.wIdx - b.wIdx);
        const blacks = notes.filter(n => !n.white);
        whites.forEach(n => {
          const k = document.createElement('div');
          k.className = 'sk-key-white'; k.dataset.note = n.note;
          kbdEl.appendChild(k);
        });
        const wKeyW = 100 / 14;
        blacks.forEach(n => {
          const k = document.createElement('div');
          k.className = 'sk-key-black'; k.dataset.note = n.note;
          k.style.left = ((n.wIdx + 0.65) * wKeyW) + '%';
          kbdEl.appendChild(k);
        });
        wireEvents();
      }

      const activeNotes = new Set();
      function wireEvents() {
        kbdEl.querySelectorAll('.sk-key-white, .sk-key-black').forEach(k => {
          const note = k.dataset.note;
          k.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); kbdNoteOn(note, k); });
          k.addEventListener('mouseenter', e => { if (e.buttons === 1) kbdNoteOn(note, k); });
          k.addEventListener('mouseleave', () => kbdNoteOff(note, k));
          k.addEventListener('mouseup', () => kbdNoteOff(note, k));
        });
      }
      const kbdNoteOn = (note, el) => {
        if (activeNotes.has(note)) return;
        activeNotes.add(note);
        if (el) el.classList.add('skact');
        const tNote = globalTranspose ? midiToNoteName(noteToSemis(note) + globalTranspose) : note;
        synth.noteOn(tNote, 100);
      };
      const kbdNoteOff = (note, el) => {
        if (!activeNotes.has(note)) return;
        activeNotes.delete(note);
        if (el) el.classList.remove('skact');
        const tNote = globalTranspose ? midiToNoteName(noteToSemis(note) + globalTranspose) : note;
        synth.noteOff(tNote);
      };
      document.addEventListener('mouseup', () => {
        activeNotes.forEach(note => {
          const k = kbdEl.querySelector(`[data-note="${note}"]`);
          if (k) k.classList.remove('skact');
          const tNote = globalTranspose ? midiToNoteName(noteToSemis(note) + globalTranspose) : note;
          synth.noteOff(tNote);
        });
        activeNotes.clear();
      });

      octDown.addEventListener('click', e => { e.stopPropagation(); if (kbdOctave > 0) { kbdOctave--; buildKeys(); } });
      octUp.addEventListener('click',   e => { e.stopPropagation(); if (kbdOctave < 8) { kbdOctave++; buildKeys(); } });

      // Wire synth._noteHighlight so external triggers (seq, etc.) light up keys
      synth._noteHighlight = (note, on) => {
        const k = kbdEl.querySelector(`[data-note="${note}"]`);
        if (k) k.classList.toggle('skact', on);
      };

      buildKeys();
      container.appendChild(kbdWrap);
      container.appendChild(kbdCtrl);
    }

    function _populateSynthTypeBody(synth, cardEl) {
      const typeBody = cardEl.querySelector('.synth-type-body');
      if (!typeBody) return;
      typeBody.innerHTML = '';
      const qs  = sel => typeBody.querySelector(sel);
      const qas = sel => typeBody.querySelectorAll(sel);
      const mkCsl = (cls, min, max, step, val) =>
        `<div class="cslider"><input type="range" class="${cls}" min="${min}" max="${max}" step="${step}" value="${val}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div>`;

      if (synth.synthType === 'analog') {
        typeBody.innerHTML = `
          <div class="card-accordion">
            <div class="card-acc-hdr">PRESETS</div>
            <div class="card-acc-body"><div class="csec"><div class="sc-preset-list"></div><button class="sc-save-preset-btn" style="margin-top:6px;width:100%;padding:4px 0;font-size:9px;background:#1a1a1a;border:1px solid #444;color:#aaa;border-radius:3px;cursor:pointer;letter-spacing:0.05em">+ SAVE CURRENT AS PRESET</button></div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">OSCILLATOR + FILTER</div>
            <div class="card-acc-body"><div class="csec">
              <div class="synth-btn-row" style="margin-bottom:8px">
                <button class="synth-btn ${synth.oscType==='sine'?'act':''}"     data-osc="sine">Sine</button>
                <button class="synth-btn ${synth.oscType==='sawtooth'?'act':''}" data-osc="sawtooth">Saw</button>
                <button class="synth-btn ${synth.oscType==='square'?'act':''}"   data-osc="square">Square</button>
                <button class="synth-btn ${synth.oscType==='triangle'?'act':''}" data-osc="triangle">Tri</button>
                <button class="synth-btn ${synth.oscType==='pulse'?'act':''}"    data-osc="pulse">PW</button>
              </div>
              <div class="crow"><span class="clbl sc-texture-lbl">${synth.oscType==='pulse'?'Width':'Texture'}</span>${mkCsl('sc-texture','0','1','0.01',synth.texture??0)}</div>
              <div class="synth-row" style="margin-bottom:6px">
                <div class="synth-lbl">Type</div>
                <div class="synth-btn-row" style="flex:1">
                  <button class="synth-btn ${synth.filterType==='lowpass'?'act':''}"  data-flt="lowpass">LP</button>
                  <button class="synth-btn ${synth.filterType==='highpass'?'act':''}" data-flt="highpass">HP</button>
                  <button class="synth-btn ${synth.filterType==='bandpass'?'act':''}" data-flt="bandpass">BP</button>
                </div>
              </div>
              <div class="crow"><span class="clbl">Cutoff</span>${mkCsl('sc-ffreq','20','20000','1',synth.filterFreq)}</div>
              <div class="crow"><span class="clbl">Reso</span>${mkCsl('sc-fq','0.01','20','0.01',synth.filterQ)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">ENVELOPE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Attack</span>${mkCsl('sc-atk','0.001','5','0.001',synth.attack)}</div>
              <div class="crow"><span class="clbl">Decay</span>${mkCsl('sc-dec','0.001','5','0.001',synth.decay)}</div>
              <div class="crow"><span class="clbl">Sustain</span>${mkCsl('sc-sus','0','1','0.01',synth.sustain)}</div>
              <div class="crow"><span class="clbl">Release</span>${mkCsl('sc-rel','0.001','8','0.001',synth.release)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">GLIDE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Time</span>${mkCsl('sc-glide','0','1','0.001',synth.portamento)}</div>
            </div></div>
          </div>`;

        const ANALOG_BANK_ORDER = ['Bass','Lead','Keys','Pluck','Pad','Brass','FX','Init'];
        const _syncAnalogSliders = () => {
          qas('[data-osc]').forEach(b => b.classList.toggle('act', b.dataset.osc === synth.oscType));
          qas('[data-flt]').forEach(b => b.classList.toggle('act', b.dataset.flt === synth.filterType));
          const propMap = { 'sc-ffreq':'filterFreq','sc-fq':'filterQ','sc-atk':'attack','sc-dec':'decay','sc-sus':'sustain','sc-rel':'release' };
          Object.keys(propMap).forEach(cls => { const sl=qs('.'+cls); if(sl){sl.value=synth[propMap[cls]]; sl.closest('.cslider')?._syncPos?.();} });
          const stl = qs('.sc-texture'); if (stl) { stl.value = synth.texture ?? 0; stl.closest('.cslider')?._syncPos?.(); }
          const lbl = qs('.sc-texture-lbl'); if (lbl) lbl.textContent = synth.oscType === 'pulse' ? 'Width' : 'Texture';
        };
        const renderAnalogPresets = () => {
          const list = qs('.sc-preset-list'); if (!list) return;
          list.innerHTML = '';
          // User presets bank
          const userPresets = getUserAnalogPresets();
          if (userPresets.length) {
            const det = document.createElement('details');
            det.className = 'preset-bank'; det.open = true;
            const sum = document.createElement('summary'); sum.textContent = 'User'; det.appendChild(sum);
            userPresets.forEach((p, ui) => {
              const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center';
              const item = document.createElement('div');
              item.className = 'fm-preset-item'; item.textContent = p.name; item.style.flex = '1';
              item.addEventListener('click', () => {
                synth.currentPreset = -1; synth.loadAnalogPreset(p); renderAnalogPresets(); _syncAnalogSliders();
              });
              const del = document.createElement('button');
              del.textContent = '✕'; del.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:9px;padding:0 4px;flex-shrink:0';
              del.addEventListener('click', e => { e.stopPropagation(); deleteUserAnalogPreset(ui); renderAnalogPresets(); });
              row.appendChild(item); row.appendChild(del); det.appendChild(row);
            });
            list.appendChild(det);
          }
          // Built-in presets by category
          const byBank = {};
          ANALOG_PRESETS.forEach((p, i) => { const c = p.cat||'Other'; (byBank[c]||(byBank[c]=[])).push({p,i}); });
          ANALOG_BANK_ORDER.forEach(cat => {
            const entries = byBank[cat]; if (!entries) return;
            const det = document.createElement('details');
            det.className = 'preset-bank';
            if (entries.some(({i}) => i === synth.currentPreset)) det.open = true;
            const sum = document.createElement('summary');
            sum.textContent = cat;
            det.appendChild(sum);
            entries.forEach(({p, i}) => {
              const item = document.createElement('div');
              item.className = 'fm-preset-item' + (i === synth.currentPreset ? ' fm-preset-active' : '');
              item.textContent = p.name;
              item.addEventListener('click', () => {
                synth.currentPreset = i; synth.loadAnalogPreset(p); renderAnalogPresets(); _syncAnalogSliders();
              });
              det.appendChild(item);
            });
            list.appendChild(det);
          });
        };
        renderAnalogPresets();

        const fmtFreq = v => v >= 1000 ? (v/1000).toFixed(1)+' kHz' : Math.round(v)+' Hz';
        const fmtPct  = v => Math.round(v*100)+'%';
        const fmtGlide = v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v));
        initCslider(qs('.sc-ffreq').closest('.cslider'), fmtFreq);
        initCslider(qs('.sc-fq').closest('.cslider'),    v => v.toFixed(2));
        initCslider(qs('.sc-atk').closest('.cslider'),   fmtFade);
        initCslider(qs('.sc-dec').closest('.cslider'),   fmtFade);
        initCslider(qs('.sc-sus').closest('.cslider'),   fmtPct);
        initCslider(qs('.sc-rel').closest('.cslider'),   fmtFade);
        initCslider(qs('.sc-glide').closest('.cslider'), fmtGlide);
        initCslider(qs('.sc-texture').closest('.cslider'), fmtPct);

        qas('[data-osc]').forEach(btn => btn.addEventListener('click', () => {
          synth.oscType = btn.dataset.osc;
          qas('[data-osc]').forEach(b => b.classList.toggle('act', b.dataset.osc === synth.oscType));
          const lbl = qs('.sc-texture-lbl'); if (lbl) lbl.textContent = synth.oscType === 'pulse' ? 'Width' : 'Texture';
          synth.updateOscType();
        }));
        qas('[data-flt]').forEach(btn => btn.addEventListener('click', () => {
          synth.filterType = btn.dataset.flt;
          qas('[data-flt]').forEach(b => b.classList.toggle('act', b.dataset.flt === synth.filterType));
          synth.updateFilter();
        }));
        qs('.sc-ffreq').addEventListener('input', () => { synth.filterFreq  = parseFloat(qs('.sc-ffreq').value);  synth.updateFilter(); });
        qs('.sc-fq').addEventListener('input',    () => { synth.filterQ     = parseFloat(qs('.sc-fq').value);     synth.updateFilter(); });
        qs('.sc-atk').addEventListener('input',   () => { synth.attack      = parseFloat(qs('.sc-atk').value);    synth.updateEnvelope(); });
        qs('.sc-dec').addEventListener('input',   () => { synth.decay       = parseFloat(qs('.sc-dec').value);    synth.updateEnvelope(); });
        qs('.sc-sus').addEventListener('input',   () => { synth.sustain     = parseFloat(qs('.sc-sus').value);    synth.updateEnvelope(); });
        qs('.sc-rel').addEventListener('input',   () => { synth.release     = parseFloat(qs('.sc-rel').value);    synth.updateEnvelope(); });
        qs('.sc-glide').addEventListener('input', () => { synth.portamento  = parseFloat(qs('.sc-glide').value); synth.updatePortamento(); });
        qs('.sc-texture').addEventListener('input', () => { synth.texture = parseFloat(qs('.sc-texture').value); synth.updateTexture(); });
        qs('.sc-save-preset-btn').addEventListener('click', () => {
          const name = prompt('Preset name:', synth.name);
          if (!name) return;
          saveUserAnalogPreset({ name, cat:'User', oscType:synth.oscType, texture:synth.texture??0,
            filterType:synth.filterType, filterFreq:synth.filterFreq, filterQ:synth.filterQ,
            attack:synth.attack, decay:synth.decay, sustain:synth.sustain, release:synth.release });
          renderAnalogPresets();
        });

      } else if (synth.synthType === 'fm') {
        const _fmAlgVal  = () => synth.fmAlgorithmOverride ?? synth._currentPatch?.algorithm ?? 1;
        const _fmFbVal   = () => synth.fmFeedbackOverride  ?? synth._currentPatch?.feedback  ?? 7;
        typeBody.innerHTML = `
          <div class="card-accordion">
            <div class="card-acc-hdr">DX7 PATCHES
              <span class="dx7-status-badge" style="opacity:0.5;font-weight:400;text-transform:none;letter-spacing:0;font-size:8px;margin-left:4px"></span>
            </div>
            <div class="card-acc-body"><div class="csec">
              <div class="dx7-bank-filter" style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px;max-height:72px;overflow-y:auto"></div>
              <div class="dx7-patch-info" style="font-size:8px;color:#666;margin-bottom:4px;min-height:14px"></div>
              <div class="fm-preset-list"></div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">VOICE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Algorithm</span>${mkCsl('dx7-algorithm','1','32','0.1',_fmAlgVal())}</div>
              <div class="crow"><span class="clbl">Feedback</span>${mkCsl('dx7-feedback','0','7','0.1',_fmFbVal())}</div>
              <div class="crow"><span class="clbl">Mod Depth</span>${mkCsl('dx7-modlevel','0','2','0.01',synth.fmModLevel)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">FILTER</div>
            <div class="card-acc-body"><div class="csec">
              <div class="synth-row" style="margin-bottom:6px">
                <div class="synth-lbl">Type</div>
                <div class="synth-btn-row" style="flex:1">
                  <button class="synth-btn ${synth.fmFilterType==='lowpass'?'act':''}"  data-fmflt="lowpass">LP</button>
                  <button class="synth-btn ${synth.fmFilterType==='highpass'?'act':''}" data-fmflt="highpass">HP</button>
                  <button class="synth-btn ${synth.fmFilterType==='bandpass'?'act':''}" data-fmflt="bandpass">BP</button>
                </div>
              </div>
              <div class="crow"><span class="clbl">Cutoff</span>${mkCsl('dx7-cutoff','20','20000','1',synth.fmFilterFreq)}</div>
              <div class="crow"><span class="clbl">Reso</span>${mkCsl('dx7-reso','0.01','20','0.01',synth.fmFilterQ)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">GLIDE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Time</span>${mkCsl('fm-glide','0','1','0.001',synth.portamento)}</div>
            </div></div>
          </div>`;

        const statusBadge  = qs('.dx7-status-badge');
        const patchInfo    = qs('.dx7-patch-info');
        const bankFilter   = qs('.dx7-bank-filter');
        let   activeBankFilter = 'ALL';

        const _buildBankBtns = () => {
          bankFilter.innerHTML = '';
          const banks = ['ALL', ...Object.keys(_DX7_ROM_DATA || {})];
          banks.forEach(b => {
            const btn = document.createElement('button');
            btn.textContent = b;
            btn.style.cssText = 'font-size:8px;padding:2px 5px;border-radius:2px;cursor:pointer;border:1px solid #333;background:' +
              (b === activeBankFilter ? 'var(--card-color,#4af)' : '#111') + ';color:' +
              (b === activeBankFilter ? '#000' : '#aaa') + ';letter-spacing:0.04em';
            btn.addEventListener('click', () => {
              activeBankFilter = b;
              _buildBankBtns();
              renderFMPresets();
            });
            bankFilter.appendChild(btn);
          });
        };

        const _updatePatchInfo = () => {
          const p = synth._currentPatch;
          if (!p) { patchInfo.textContent = ''; return; }
          const parts = [];
          if (p.bank) parts.push(p.bank);
          if (p.algorithm != null) parts.push(`Alg ${p.algorithm}`);
          if (p.feedback   != null) parts.push(`FB ${p.feedback}`);
          patchInfo.textContent = parts.join('  ·  ');
        };

        const renderFMPresets = () => {
          const list = qs('.fm-preset-list'); if (!list) return;
          list.innerHTML = '';
          const allPatches = synth.presetList;
          if (!synth._engineReady) {
            statusBadge.textContent = 'Loading…';
            list.innerHTML = '<div style="color:#555;font-size:9px;padding:4px 0">Initialising DX7 engine…</div>';
            return;
          }
          if (!allPatches.length) {
            statusBadge.textContent = 'Loading…';
            list.innerHTML = '<div style="color:#555;font-size:9px;padding:4px 0">Fetching patches…</div>';
            return;
          }

          // Filter by selected bank
          const visible = activeBankFilter === 'ALL'
            ? allPatches
            : allPatches.filter(p => p.bank === activeBankFilter);

          statusBadge.textContent = visible.length + (activeBankFilter === 'ALL' ? '' : '/' + allPatches.length) + ' patches';

          if (activeBankFilter === 'ALL') {
            // Categorized view
            const catOrder = (typeof DX7_CATEGORY_ORDER !== 'undefined') ? DX7_CATEGORY_ORDER : ['Other'];
            const bycat = {};
            allPatches.forEach((p, i) => { const c = p.cat || 'Other'; (bycat[c] || (bycat[c] = [])).push({ p, i }); });
            catOrder.forEach(cat => {
              const entries = bycat[cat]; if (!entries) return;
              const det = document.createElement('details');
              det.className = 'preset-bank';
              if (entries.some(({ i }) => i === synth.currentPreset)) det.open = true;
              const sum = document.createElement('summary');
              sum.textContent = `${cat} (${entries.length})`;
              det.appendChild(sum);
              entries.forEach(({ p, i }) => _appendPatchItem(det, p, i));
              list.appendChild(det);
            });
          } else {
            // Flat list for single-bank view
            visible.forEach(p => {
              const i = allPatches.indexOf(p);
              _appendPatchItem(list, p, i);
            });
          }
          _updatePatchInfo();
        };

        const _appendPatchItem = (parent, p, i) => {
          const item = document.createElement('div');
          item.className = 'fm-preset-item' + (i === synth.currentPreset ? ' fm-preset-active' : '');
          item.textContent = p.name || `Patch ${i + 1}`;
          item.addEventListener('click', () => {
            synth.currentPreset = i;
            synth.loadPreset(p);
            renderFMPresets();
            _updatePatchInfo();
            setTimeout(() => _syncVoiceSliders?.(), 0);
          });
          parent.appendChild(item);
        };

        _buildBankBtns();
        renderFMPresets();

        // Re-render when async engine/banks finish loading
        const _onDX7Updated = e => {
          if (e.detail && e.detail.id !== synth.id) return;
          if (!typeBody.isConnected) { document.removeEventListener('dx7-updated', _onDX7Updated); return; }
          _buildBankBtns();
          renderFMPresets();
        };
        document.addEventListener('dx7-updated', _onDX7Updated);

        // VOICE sliders
        const fmtAlg = v => 'Alg ' + Math.round(v);
        const fmtFb  = v => 'FB ' + parseFloat(v).toFixed(1);
        const fmtLvl = v => parseFloat(v).toFixed(2) + '×';
        initCslider(qs('.dx7-algorithm').closest('.cslider'), fmtAlg);
        initCslider(qs('.dx7-feedback').closest('.cslider'),  fmtFb);
        initCslider(qs('.dx7-modlevel').closest('.cslider'),  fmtLvl);

        qs('.dx7-algorithm').addEventListener('input', () => {
          synth.fmAlgorithmOverride = Math.round(parseFloat(qs('.dx7-algorithm').value));
          synth.updateFMVoiceParam();
        });
        qs('.dx7-feedback').addEventListener('input', () => {
          synth.fmFeedbackOverride = parseFloat(qs('.dx7-feedback').value);
          synth.updateFMVoiceParam();
        });
        qs('.dx7-modlevel').addEventListener('input', () => {
          synth.fmModLevel = parseFloat(qs('.dx7-modlevel').value);
          synth.updateFMVoiceParam();
        });

        // FILTER sliders
        const fmtHz = v => v >= 1000 ? (v/1000).toFixed(1)+' kHz' : Math.round(v)+' Hz';
        initCslider(qs('.dx7-cutoff').closest('.cslider'), fmtHz);
        initCslider(qs('.dx7-reso').closest('.cslider'),   v => parseFloat(v).toFixed(2));

        qas('[data-fmflt]').forEach(btn => btn.addEventListener('click', () => {
          synth.fmFilterType = btn.dataset.fmflt;
          qas('[data-fmflt]').forEach(b => b.classList.toggle('act', b.dataset.fmflt === synth.fmFilterType));
          synth.updateFMFilter();
        }));
        qs('.dx7-cutoff').addEventListener('input', () => {
          synth.fmFilterFreq = parseFloat(qs('.dx7-cutoff').value);
          synth.updateFMFilter();
        });
        qs('.dx7-reso').addEventListener('input', () => {
          synth.fmFilterQ = parseFloat(qs('.dx7-reso').value);
          synth.updateFMFilter();
        });

        // GLIDE slider
        const fmtGlide = v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v));
        initCslider(qs('.fm-glide').closest('.cslider'), fmtGlide);
        qs('.fm-glide').addEventListener('input', () => {
          synth.portamento = parseFloat(qs('.fm-glide').value);
          synth.updatePortamento();
        });

        // Sync VOICE sliders when a new preset is loaded (only if no user override yet)
        const _syncVoiceSliders = () => {
          const p = synth._currentPatch;
          if (!p) return;
          if (synth.fmAlgorithmOverride === null) {
            const sl = qs('.dx7-algorithm');
            if (sl) { sl.value = p.algorithm; sl.closest('.cslider')?._syncPos?.(); }
          }
          if (synth.fmFeedbackOverride === null) {
            const sl = qs('.dx7-feedback');
            if (sl) { sl.value = p.feedback; sl.closest('.cslider')?._syncPos?.(); }
          }
        };
        // Re-sync voice sliders whenever dx7-updated fires (covers initial preset load)
        const _onDX7VoiceSync = () => {
          if (!typeBody.isConnected) { document.removeEventListener('dx7-updated', _onDX7VoiceSync); return; }
          _syncVoiceSliders();
        };
        document.addEventListener('dx7-updated', _onDX7VoiceSync);

      } else if (synth.synthType === 'wavetable') {
        typeBody.innerHTML = `
          <div class="card-accordion">
            <div class="card-acc-hdr open">WAVETABLE</div>
            <div class="card-acc-body open"><div class="csec">
              <div class="fm-preset-list wt-preset-list"></div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">OSCILLATOR</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Detune 1</span>${mkCsl('wt-d1','-50','50','0.1',synth.detune1||0)}</div>
              <div class="crow"><span class="clbl">Detune 2</span>${mkCsl('wt-d2','-50','50','0.1',synth.detune2||0)}</div>
              <div class="crow"><span class="clbl">Osc2 Oct</span>${mkCsl('wt-oct','-24','24','12',synth.osc2octave||0)}</div>
              <div class="crow"><span class="clbl">Width</span>${mkCsl('wt-width','0','1','0.01',synth.width||0)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">FILTER</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Cutoff</span>${mkCsl('wt-cutoff','0','1','0.001',synth.cutoff)}</div>
              <div class="crow"><span class="clbl">Reso</span>${mkCsl('wt-reso','0.1','20','0.1',synth.resonance)}</div>
              <div class="crow"><span class="clbl">Env Amt</span>${mkCsl('wt-envamt','0','1','0.001',synth.envAmount)}</div>
              <div class="crow"><span class="clbl">F. Attack</span>${mkCsl('wt-fatk','0.001','5','0.001',synth.filterAttack)}</div>
              <div class="crow"><span class="clbl">F. Decay</span>${mkCsl('wt-fdec','0.001','5','0.001',synth.filterDecay)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">AMPLITUDE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Attack</span>${mkCsl('wt-atk','0.001','5','0.001',synth.attack)}</div>
              <div class="crow"><span class="clbl">Decay</span>${mkCsl('wt-dec','0.001','5','0.001',synth.decay)}</div>
              <div class="crow"><span class="clbl">Sustain</span>${mkCsl('wt-sus','0','1','0.01',synth.sustain)}</div>
              <div class="crow"><span class="clbl">Release</span>${mkCsl('wt-rel','0.001','8','0.001',synth.release)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">GLIDE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Time</span>${mkCsl('wt-glide','0','1','0.001',synth.portamento)}</div>
            </div></div>
          </div>`;

        // Wave preset list
        const wtList = qs('.wt-preset-list');
        const renderWTPresets = () => {
          wtList.innerHTML = '';
          WT_BANKS.forEach(bank => {
            const det = document.createElement('details');
            det.className = 'preset-bank';
            if (bank.items.some(n => WT_NAMES.indexOf(n) === synth.currentWave)) det.open = true;
            const sum = document.createElement('summary');
            sum.textContent = bank.name;
            det.appendChild(sum);
            bank.items.forEach(name => {
              const i = WT_NAMES.indexOf(name);
              if (i === -1) return;
              const item = document.createElement('div');
              item.className = 'fm-preset-item' + (i === synth.currentWave ? ' fm-preset-active' : '');
              item.dataset.waveIdx = i;
              item.textContent = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
              item.addEventListener('click', () => {
                synth.currentWave = i; synth.updateWave();
                wtList.querySelectorAll('.fm-preset-item').forEach(el =>
                  el.classList.toggle('fm-preset-active', parseInt(el.dataset.waveIdx) === i));
              });
              det.appendChild(item);
            });
            wtList.appendChild(det);
          });
          const active = wtList.querySelector('.fm-preset-active');
          if (active) active.scrollIntoView({ block: 'nearest' });
        };
        renderWTPresets();

        const fmtPct  = v => Math.round(v*100)+'%';
        initCslider(qs('.wt-d1').closest('.cslider'),     v => parseFloat(v).toFixed(1)+' ct');
        initCslider(qs('.wt-d2').closest('.cslider'),     v => parseFloat(v).toFixed(1)+' ct');
        initCslider(qs('.wt-oct').closest('.cslider'),    v => (parseFloat(v)>0?'+':'')+parseInt(v)+' st');
        initCslider(qs('.wt-width').closest('.cslider'),  fmtPct);
        initCslider(qs('.wt-cutoff').closest('.cslider'), v => {
          const hz = 20 * Math.pow(2, parseFloat(v) * 10);
          return hz >= 1000 ? (hz/1000).toFixed(1)+' kHz' : Math.round(hz)+' Hz';
        });
        initCslider(qs('.wt-reso').closest('.cslider'),   v => parseFloat(v).toFixed(1));
        initCslider(qs('.wt-envamt').closest('.cslider'), fmtPct);
        initCslider(qs('.wt-fatk').closest('.cslider'),   fmtFade);
        initCslider(qs('.wt-fdec').closest('.cslider'),   fmtFade);
        initCslider(qs('.wt-atk').closest('.cslider'),    fmtFade);
        initCslider(qs('.wt-dec').closest('.cslider'),    fmtFade);
        initCslider(qs('.wt-sus').closest('.cslider'),    fmtPct);
        initCslider(qs('.wt-rel').closest('.cslider'),    fmtFade);
        const fmtGlide = v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v));
        initCslider(qs('.wt-glide').closest('.cslider'), fmtGlide);

        qs('.wt-d1').addEventListener('input',     () => { synth.detune1      = parseFloat(qs('.wt-d1').value);     synth.updateDetune(); });
        qs('.wt-d2').addEventListener('input',     () => { synth.detune2      = parseFloat(qs('.wt-d2').value);     synth.updateDetune(); });
        qs('.wt-oct').addEventListener('input',    () => { synth.osc2octave   = parseFloat(qs('.wt-oct').value);    synth.updateDetune(); });
        qs('.wt-width').addEventListener('input',  () => { synth.width        = parseFloat(qs('.wt-width').value);  });
        qs('.wt-cutoff').addEventListener('input', () => { synth.cutoff       = parseFloat(qs('.wt-cutoff').value); synth.updateFilter(); });
        qs('.wt-reso').addEventListener('input',   () => { synth.resonance    = parseFloat(qs('.wt-reso').value);   synth.updateFilter(); });
        qs('.wt-envamt').addEventListener('input', () => { synth.envAmount    = parseFloat(qs('.wt-envamt').value); });
        qs('.wt-fatk').addEventListener('input',   () => { synth.filterAttack = parseFloat(qs('.wt-fatk').value);   });
        qs('.wt-fdec').addEventListener('input',   () => { synth.filterDecay  = parseFloat(qs('.wt-fdec').value);   });
        qs('.wt-atk').addEventListener('input',    () => { synth.attack       = parseFloat(qs('.wt-atk').value);    });
        qs('.wt-dec').addEventListener('input',    () => { synth.decay        = parseFloat(qs('.wt-dec').value);    });
        qs('.wt-sus').addEventListener('input',   () => { synth.sustain    = parseFloat(qs('.wt-sus').value);    });
        qs('.wt-rel').addEventListener('input',   () => { synth.release    = parseFloat(qs('.wt-rel').value);    });
        qs('.wt-glide').addEventListener('input', () => { synth.portamento = parseFloat(qs('.wt-glide').value); synth.updatePortamento(); });

      } else if (synth.synthType === 'karplus') {
        const fmtD2 = v => parseFloat(v).toFixed(2);
        typeBody.innerHTML = `
          <div class="card-accordion">
            <div class="card-acc-hdr open">STRING</div>
            <div class="card-acc-body open"><div class="csec">
              <div class="crow"><span class="clbl">Str Damp</span>${mkCsl('kp-sdamp','0','1','0.01',synth.stringDamping)}</div>
              <div class="crow"><span class="clbl">Damp Var</span>${mkCsl('kp-sdampvar','0','1','0.01',synth.stringDampingVariation)}</div>
              <div class="crow"><span class="clbl">Tension</span>${mkCsl('kp-tension','0','0.99','0.01',synth.stringTension)}</div>
              <div class="synth-row" style="margin-bottom:6px;margin-top:4px">
                <div class="synth-lbl">Damp Calc</div>
                <div class="synth-btn-row" style="flex:1">
                  <button class="synth-btn ${synth.stringDampingCalc==='magic'?'act':''}"  data-sdcalc="magic">Magic</button>
                  <button class="synth-btn ${synth.stringDampingCalc==='direct'?'act':''}" data-sdcalc="direct">Direct</button>
                </div>
              </div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr open">PLUCK</div>
            <div class="card-acc-body open"><div class="csec">
              <div class="crow"><span class="clbl">Plk Damp</span>${mkCsl('kp-pdamp','0','1','0.01',synth.pluckDamping)}</div>
              <div class="crow"><span class="clbl">Plk Var</span>${mkCsl('kp-pdampvar','0','1','0.01',synth.pluckDampingVariation)}</div>
              <div class="crow"><span class="clbl">Char Var</span>${mkCsl('kp-charvar','0','1','0.01',synth.characterVariation)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">OUTPUT</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Spread</span>${mkCsl('kp-spread','0','1','0.01',synth.stereoSpread)}</div>
              <div class="synth-row" style="margin-bottom:6px;margin-top:4px">
                <div class="synth-lbl">Body Res</div>
                <div class="synth-btn-row" style="flex:1">
                  <button class="synth-btn ${synth.bodyResonation==='none'?'act':''}"   data-body="none">None</button>
                  <button class="synth-btn ${synth.bodyResonation==='simple'?'act':''}" data-body="simple">Simple</button>
                </div>
              </div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">GLIDE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Time</span>${mkCsl('kp-glide','0','1','0.001',synth.portamento)}</div>
            </div></div>
          </div>`;

        const fmtGlide = v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v));
        initCslider(qs('.kp-sdamp').closest('.cslider'),    fmtD2);
        initCslider(qs('.kp-sdampvar').closest('.cslider'), fmtD2);
        initCslider(qs('.kp-tension').closest('.cslider'),  fmtD2);
        initCslider(qs('.kp-pdamp').closest('.cslider'),    fmtD2);
        initCslider(qs('.kp-pdampvar').closest('.cslider'), fmtD2);
        initCslider(qs('.kp-charvar').closest('.cslider'),  fmtD2);
        initCslider(qs('.kp-spread').closest('.cslider'),   fmtD2);
        initCslider(qs('.kp-glide').closest('.cslider'),    fmtGlide);

        qas('[data-sdcalc]').forEach(btn => btn.addEventListener('click', () => {
          synth.stringDampingCalc = btn.dataset.sdcalc;
          qas('[data-sdcalc]').forEach(b => b.classList.toggle('act', b.dataset.sdcalc === synth.stringDampingCalc));
        }));
        qas('[data-body]').forEach(btn => btn.addEventListener('click', () => {
          synth.bodyResonation = btn.dataset.body;
          qas('[data-body]').forEach(b => b.classList.toggle('act', b.dataset.body === synth.bodyResonation));
        }));
        qs('.kp-sdamp').addEventListener('input',    () => { synth.stringDamping          = parseFloat(qs('.kp-sdamp').value); });
        qs('.kp-sdampvar').addEventListener('input', () => { synth.stringDampingVariation = parseFloat(qs('.kp-sdampvar').value); });
        qs('.kp-tension').addEventListener('input',  () => { synth.stringTension          = parseFloat(qs('.kp-tension').value); });
        qs('.kp-pdamp').addEventListener('input',    () => { synth.pluckDamping           = parseFloat(qs('.kp-pdamp').value); });
        qs('.kp-pdampvar').addEventListener('input', () => { synth.pluckDampingVariation  = parseFloat(qs('.kp-pdampvar').value); });
        qs('.kp-charvar').addEventListener('input',  () => { synth.characterVariation     = parseFloat(qs('.kp-charvar').value); });
        qs('.kp-spread').addEventListener('input',  () => { synth.stereoSpread = parseFloat(qs('.kp-spread').value); });
        qs('.kp-glide').addEventListener('input',   () => { synth.portamento  = parseFloat(qs('.kp-glide').value);  synth.updatePortamento(); });

      } else if (synth.synthType === 'rompler') {
        const fmtFreq = v => parseFloat(v) >= 1000 ? (parseFloat(v)/1000).toFixed(1)+' kHz' : Math.round(parseFloat(v))+' Hz';
        const isSf2 = synth.romplerType === 'sf2';
        const statusTxt = synth._smplrLoading ? 'Loading…' : synth._smplr ? (isSf2 ? (synth._sf2InstrumentNames.length + ' inst') : 'Ready') : '—';
        typeBody.innerHTML = `
          <div class="card-accordion">
            <div class="card-acc-hdr open">PRESETS</div>
            <div class="card-acc-body open"><div class="csec">
              <div class="synth-btn-row" style="margin-bottom:8px">
                <button class="synth-btn ${!isSf2?'act':''}" data-rtype="sf1">Soundfont</button>
                <button class="synth-btn ${isSf2?'act':''}"  data-rtype="sf2">Soundfont 2</button>
              </div>
              <div class="rom-sf1-wrap" style="${isSf2?'display:none':''}">
                <div class="synth-row" style="margin-bottom:6px;align-items:center;gap:6px">
                  <div class="synth-lbl">Bank</div>
                  <select class="rom-bank-sel" style="flex:1;background:var(--b1);color:var(--hi);border:1px solid var(--b3);border-radius:3px;padding:2px 4px;font-size:10px;font-family:inherit">
                    ${ROMPLER_BANKS.map(b=>`<option value="${b}"${b===synth.romplerBank?' selected':''}>${b}</option>`).join('')}
                  </select>
                  <span class="rompler-status" style="font-size:9px;color:var(--mid);flex-shrink:0;min-width:36px;text-align:right">${isSf2?'—':statusTxt}</span>
                </div>
                <div class="fm-preset-list rom-preset-list"></div>
              </div>
              <div class="rom-sf2-wrap" style="${!isSf2?'display:none':''}">
                <div class="synth-row" style="margin-bottom:6px;align-items:center;gap:6px">
                  <div class="synth-lbl">File</div>
                  <select class="rom-sf2-sel" style="flex:1;background:var(--b1);color:var(--hi);border:1px solid var(--b3);border-radius:3px;padding:2px 4px;font-size:10px;font-family:inherit">
                    ${ROMPLER_SF2_FILES.map(f=>`<option value="${f.url}"${f.url===synth.romplerSf2Url?' selected':''}>${f.name}</option>`).join('')}
                  </select>
                  <span class="rompler-status" style="font-size:9px;color:var(--mid);flex-shrink:0;min-width:36px;text-align:right">${isSf2?statusTxt:'—'}</span>
                </div>
                <div class="fm-preset-list rom-sf2-preset-list"></div>
              </div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">FILTER</div>
            <div class="card-acc-body"><div class="csec">
              <div class="synth-row" style="margin-bottom:6px">
                <div class="synth-lbl">Type</div>
                <div class="synth-btn-row" style="flex:1">
                  <button class="synth-btn ${synth.filterType==='lowpass'?'act':''}"  data-rflt="lowpass">LP</button>
                  <button class="synth-btn ${synth.filterType==='highpass'?'act':''}" data-rflt="highpass">HP</button>
                  <button class="synth-btn ${synth.filterType==='bandpass'?'act':''}" data-rflt="bandpass">BP</button>
                </div>
              </div>
              <div class="crow"><span class="clbl">Cutoff</span>${mkCsl('rm-ffreq','20','20000','1',synth.filterFreq)}</div>
              <div class="crow"><span class="clbl">Reso</span>${mkCsl('rm-fq','0.01','20','0.01',synth.filterQ)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">ENVELOPE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Release</span>${mkCsl('rm-rel','0.01','10','0.01',synth.release)}</div>
            </div></div>
          </div>
          <div class="card-accordion">
            <div class="card-acc-hdr">GLIDE</div>
            <div class="card-acc-body"><div class="csec">
              <div class="crow"><span class="clbl">Time</span>${mkCsl('rm-glide','0','1','0.001',synth.portamento)}</div>
            </div></div>
          </div>`;

        const updateStatusLocal = txt => qas('.rompler-status').forEach(b => { b.textContent = txt; });

        // SF1 preset list
        const renderSf1Presets = () => {
          const list = qs('.rom-preset-list'); if (!list) return;
          list.innerHTML = '';
          ROMPLER_GM_BANKS.forEach(bank => {
            const det = document.createElement('details');
            det.className = 'preset-bank';
            if (bank.items.includes(synth.romplerInstrument)) det.open = true;
            const sum = document.createElement('summary');
            sum.textContent = bank.name;
            det.appendChild(sum);
            bank.items.forEach(inst => {
              const item = document.createElement('div');
              item.className = 'fm-preset-item' + (inst === synth.romplerInstrument ? ' fm-preset-active' : '');
              item.dataset.inst = inst;
              item.textContent = inst.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
              item.addEventListener('click', () => {
                synth.romplerInstrument = inst;
                updateStatusLocal('Loading…');
                synth._romplerLoad();
                list.querySelectorAll('.fm-preset-item').forEach(el =>
                  el.classList.toggle('fm-preset-active', el.dataset.inst === inst));
              });
              det.appendChild(item);
            });
            list.appendChild(det);
          });
          const active = list.querySelector('.fm-preset-active');
          if (active) active.scrollIntoView({ block: 'nearest' });
        };

        // SF2 instrument list (dynamic — populated after SF2 loads)
        const renderSf2Presets = () => {
          const list = qs('.rom-sf2-preset-list'); if (!list) return;
          list.innerHTML = '';
          const names = synth._sf2InstrumentNames || [];
          if (!names.length) {
            const ph = document.createElement('div');
            ph.className = 'fm-preset-item';
            ph.style.opacity = '0.4';
            ph.textContent = synth._smplrLoading ? 'Loading SF2…' : 'Select a file above';
            list.appendChild(ph);
            return;
          }
          names.forEach(inst => {
            const item = document.createElement('div');
            item.className = 'fm-preset-item' + (inst === synth.romplerSf2Instrument ? ' fm-preset-active' : '');
            item.textContent = inst;
            item.addEventListener('click', () => {
              synth.romplerSf2Instrument = inst;
              if (synth._smplr) synth._smplr.loadInstrument(inst).catch(e => {});
              list.querySelectorAll('.fm-preset-item').forEach(el => el.classList.toggle('fm-preset-active', el.textContent === inst));
            });
            list.appendChild(item);
          });
          const active = list.querySelector('.fm-preset-active');
          if (active) active.scrollIntoView({ block: 'nearest' });
        };

        // Callback so _romplerLoad can refresh the SF2 list when file finishes loading
        synth._refreshSf2List = () => {
          renderSf2Presets();
          updateStatusLocal((synth._sf2InstrumentNames?.length || 0) + ' inst');
        };

        // Show the right section initially
        if (synth.romplerType === 'sf2') { renderSf2Presets(); }
        else { renderSf1Presets(); }

        // SF1 / SF2 type toggle
        qas('[data-rtype]').forEach(btn => btn.addEventListener('click', () => {
          const newType = btn.dataset.rtype;
          if (synth.romplerType === newType) return;
          synth.romplerType = newType;
          qas('[data-rtype]').forEach(b => b.classList.toggle('act', b.dataset.rtype === newType));
          qs('.rom-sf1-wrap').style.display = newType === 'sf2' ? 'none' : '';
          qs('.rom-sf2-wrap').style.display = newType === 'sf2' ? '' : 'none';
          if (newType === 'sf2') {
            // If SF2 not loaded yet for current URL, load it
            if (!synth._smplr || synth._sf2InstrumentNames.length === 0) synth._romplerLoad();
            else renderSf2Presets();
          } else {
            synth._romplerLoad();
          }
        }));

        // SF1 bank selector
        qs('.rom-bank-sel').addEventListener('change', e => {
          synth.romplerBank = e.target.value;
          updateStatusLocal('Loading…');
          synth._romplerLoad();
        });

        // SF2 file selector
        qs('.rom-sf2-sel').addEventListener('change', e => {
          synth.romplerSf2Url = e.target.value;
          synth._sf2InstrumentNames = [];
          synth.romplerSf2Instrument = null;
          renderSf2Presets();
          synth._romplerLoad();
        });

        const fmtGlide = v => parseFloat(v) < 0.001 ? 'Off' : fmtFade(parseFloat(v));
        initCslider(qs('.rm-ffreq').closest('.cslider'), fmtFreq);
        initCslider(qs('.rm-fq').closest('.cslider'),    v => parseFloat(v).toFixed(2));
        initCslider(qs('.rm-rel').closest('.cslider'),   fmtFade);
        initCslider(qs('.rm-glide').closest('.cslider'), fmtGlide);

        qas('[data-rflt]').forEach(btn => btn.addEventListener('click', () => {
          synth.filterType = btn.dataset.rflt;
          qas('[data-rflt]').forEach(b => b.classList.toggle('act', b.dataset.rflt === synth.filterType));
          synth.updateFilter();
        }));
        qs('.rm-ffreq').addEventListener('input',  () => { synth.filterFreq  = parseFloat(qs('.rm-ffreq').value);  synth.updateFilter(); });
        qs('.rm-fq').addEventListener('input',     () => { synth.filterQ     = parseFloat(qs('.rm-fq').value);     synth.updateFilter(); });
        qs('.rm-rel').addEventListener('input',    () => { synth.release     = parseFloat(qs('.rm-rel').value); });
        qs('.rm-glide').addEventListener('input',  () => { synth.portamento  = parseFloat(qs('.rm-glide').value);  synth.updatePortamento(); });
      }
    }

    function createSynthCard(synth, tile) {
      if (synth.synthType === 'drums') { createDrumCard(synth, tile); return; }
      const el = document.createElement('div');
      el.className = 'synth-card';
      el.style.setProperty('--card-color', synth.color);

      const mkCsl = (cls, min, max, step, val) =>
        `<div class="cslider"><input type="range" class="${cls}" min="${min}" max="${max}" step="${step}" value="${val}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div>`;

      el.innerHTML = `
        <div class="card-titlebar">
          <div class="card-color-dot" style="background:${synth.color};width:10px;height:10px;border-radius:50%;flex-shrink:0"></div>
          <div class="card-name">${synth.name}</div>
          <span class="midi-dev-lbl">MIDI From</span>
          <select class="midi-input-sel" data-instr-id="${synth.id}">
            <option value="all">ALL</option>
            <option value="keyboard">KEYBOARD</option>
          </select>
          <button class="card-dup" title="Duplicate">&#x29C9;</button>
          <button class="card-remove" title="Remove">&#x1F5D1;</button>
          <button class="card-close" title="Close">&#x2715;</button>
        </div>
        <div class="synth-type-row">
          <span class="synth-type-lbl">Type</span>
          <select class="synth-type-sel">
            <option value="analog"${synth.synthType==='analog'?' selected':''}>Analog</option>
            <option value="fm"${synth.synthType==='fm'?' selected':''}>FM</option>
            <option value="wavetable"${synth.synthType==='wavetable'?' selected':''}>Wavetable</option>
            <option value="karplus"${synth.synthType==='karplus'?' selected':''}>Karplus</option>
            <option value="rompler"${synth.synthType==='rompler'?' selected':''}>Rompler</option>
          </select>
        </div>
        <div class="vp-scope-row">
          <div class="vp-scope-wrap">
            <canvas class="synth-scope-canvas" width="240" height="80"></canvas>
          </div>
          <div class="vp-vol-wrap lfo-slot">
            <input type="range" class="synth-vol" min="-60" max="6" step="0.1" value="${(synth._currentDb||0).toFixed(1)}">
          </div>
        </div>
        <div class="card-pan-row lfo-slot">
          <input type="range" class="synth-pan vp-pan" min="-1" max="1" step="0.01" value="${(synth._currentPan||0).toFixed(2)}">
        </div>
        <div class="synth-card-body">
          <div class="synth-type-body"></div>
          <div class="card-accordion">
            <div class="card-acc-hdr">EFFECTS</div>
            <div class="card-acc-body">
              <div class="fx-section" id="fx-section-${synth.id}"></div>
            </div>
          </div>
          <div id="sc-kbd-${synth.id}"></div>
        </div>`;

      const q = sel => el.querySelector(sel);

      // Accordion toggle (delegated on card)
      el.addEventListener('click', e => {
        const hdr = e.target.closest('.card-acc-hdr');
        if (!hdr || !el.contains(hdr)) return;
        hdr.classList.toggle('open');
        hdr.nextElementSibling?.classList.toggle('open');
        requestAnimationFrame(() => {
          syncParamPorts(document.getElementById('t' + synth.id), el);
          updateLfoWires();
        });
      });

      q('.synth-vol').addEventListener('input', () => { synth._currentDb  = parseFloat(q('.synth-vol').value); synth._applyVol(); });
      q('.synth-pan').addEventListener('input', () => { synth._currentPan = parseFloat(q('.synth-pan').value); synth._applyPan(); });

      // Type selector
      q('.synth-type-sel').addEventListener('change', e => {
        synth.changeSynthType(e.target.value);
        _populateSynthTypeBody(synth, el);
        requestAnimationFrame(updateLfoWires);
      });

      // MIDI input selector
      populateMidiSelect(q('.midi-input-sel'), synth.midiInput ?? 'all');
      q('.midi-input-sel').addEventListener('change', e => { synth.midiInput = e.target.value; });

      q('.card-close').addEventListener('click',  () => closeSynthCard(synth.id));
      q('.card-remove').addEventListener('click', e => { e.stopPropagation(); removeSynth(synth.id); });
      q('.card-dup').addEventListener('click',    e => { e.stopPropagation(); duplicateSynth(synth); });

      q('.card-titlebar').addEventListener('click', e => {
        if (e.target.closest('button, select') || el._tbDragged) return;
        closeSynthCard(synth.id);
      });

      _populateSynthTypeBody(synth, el);
      _positionCard(el, tile, 300, 520);
      _makeSynthCardDrag(el, synth);
      cv.appendChild(el);
      initVpSliders(el);
      _syncTilePorts(tile, el);
      requestAnimationFrame(() => { syncParamPorts(tile, el); updateLfoWires(); });
      requestAnimationFrame(() => el.classList.add('open'));
      openCards.set(synth.id, { el });
      if (tile) tile.classList.add('active', 'expanded');
      requestAnimationFrame(() => buildPianoKeyboard(q(`#sc-kbd-${synth.id}`), synth));
      buildFxSection(el, synth);
    }

    function createAnalogSynthCard(synth, tile) {
      const el = document.createElement('div');
      el.className = 'synth-card';
      el.style.setProperty('--card-color', synth.color);

      const mkCsl = (cls, min, max, step, val) =>
        `<div class="cslider"><input type="range" class="${cls}" min="${min}" max="${max}" step="${step}" value="${val}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div>`;

      el.innerHTML = `
        <div class="card-titlebar">
          <div class="card-color-dot" style="background:${synth.color};width:10px;height:10px;border-radius:50%;flex-shrink:0"></div>
          <div class="card-name">ANALOG · ${synth.name}</div>
          <button class="card-dup" title="Duplicate">⧉</button>
          <button class="card-remove" title="Remove">🗑</button>
          <button class="card-close" title="Close">✕</button>
        </div>
        <div style="padding:8px 10px 4px">
          <canvas class="synth-scope-canvas" width="260" height="72"></canvas>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">PRESETS</div>
          <div class="card-acc-body">
            <div class="csec"><div class="fm-preset-list sc-preset-list"></div><button class="sc-save-preset-btn" style="margin-top:6px;width:100%;padding:4px 0;font-size:9px;background:#1a1a1a;border:1px solid #444;color:#aaa;border-radius:3px;cursor:pointer;letter-spacing:0.05em">+ SAVE CURRENT AS PRESET</button></div>
          </div>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">OSCILLATOR + FILTER</div>
          <div class="card-acc-body">
            <div class="csec">
              <div class="synth-btn-row" style="margin-bottom:8px">
                <button class="synth-btn ${synth.oscType==='sine'?'act':''}"     data-osc="sine">Sine</button>
                <button class="synth-btn ${synth.oscType==='sawtooth'?'act':''}" data-osc="sawtooth">Saw</button>
                <button class="synth-btn ${synth.oscType==='square'?'act':''}"   data-osc="square">Square</button>
                <button class="synth-btn ${synth.oscType==='triangle'?'act':''}" data-osc="triangle">Tri</button>
                <button class="synth-btn ${synth.oscType==='pulse'?'act':''}"    data-osc="pulse">PW</button>
              </div>
              <div class="crow"><span class="clbl sc-texture-lbl">${synth.oscType==='pulse'?'Width':'Texture'}</span>${mkCsl('sc-texture','0','1','0.01',synth.texture??0)}</div>
              <div class="synth-row" style="margin-bottom:6px">
                <div class="synth-lbl">Type</div>
                <div class="synth-btn-row" style="flex:1">
                  <button class="synth-btn ${synth.filterType==='lowpass'?'act':''}"  data-flt="lowpass">LP</button>
                  <button class="synth-btn ${synth.filterType==='highpass'?'act':''}" data-flt="highpass">HP</button>
                  <button class="synth-btn ${synth.filterType==='bandpass'?'act':''}" data-flt="bandpass">BP</button>
                </div>
              </div>
              <div class="crow"><span class="clbl">Cutoff</span>${mkCsl('sc-ffreq','20','20000','1',synth.filterFreq)}</div>
              <div class="crow"><span class="clbl">Reso</span>${mkCsl('sc-fq','0.01','20','0.01',synth.filterQ)}</div>
            </div>
          </div>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">ENVELOPE</div>
          <div class="card-acc-body">
            <div class="csec">
              <div class="crow"><span class="clbl">Attack</span>${mkCsl('sc-atk','0.001','5','0.001',synth.attack)}</div>
              <div class="crow"><span class="clbl">Decay</span>${mkCsl('sc-dec','0.001','5','0.001',synth.decay)}</div>
              <div class="crow"><span class="clbl">Sustain</span>${mkCsl('sc-sus','0','1','0.01',synth.sustain)}</div>
              <div class="crow"><span class="clbl">Release</span>${mkCsl('sc-rel','0.001','8','0.001',synth.release)}</div>
            </div>
          </div>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">EFFECTS</div>
          <div class="card-acc-body">
            <div class="fx-section" id="fx-section-${synth.id}"></div>
          </div>
        </div>
        <div id="sc-kbd-${synth.id}"></div>`;

      const q = sel => el.querySelector(sel), qa = sel => el.querySelectorAll(sel);

      const _syncAnalogSliders = () => {
        qa('[data-osc]').forEach(b => b.classList.toggle('act', b.dataset.osc === synth.oscType));
        qa('[data-flt]').forEach(b => b.classList.toggle('act', b.dataset.flt === synth.filterType));
        const propMap = { 'sc-ffreq':'filterFreq','sc-fq':'filterQ','sc-atk':'attack','sc-dec':'decay','sc-sus':'sustain','sc-rel':'release' };
        Object.keys(propMap).forEach(cls => { const sl=q('.'+cls); if(sl){sl.value=synth[propMap[cls]]; sl.closest('.cslider')?._syncPos?.();} });
        const stl = q('.sc-texture'); if (stl) { stl.value = synth.texture ?? 0; stl.closest('.cslider')?._syncPos?.(); }
        const lbl = q('.sc-texture-lbl'); if (lbl) lbl.textContent = synth.oscType === 'pulse' ? 'Width' : 'Texture';
      };
      const ANALOG_BANK_ORDER2 = ['Bass','Lead','Keys','Pluck','Pad','Brass','FX','Init'];
      const renderAnalogPresets = () => {
        const list = q('.sc-preset-list');
        if (!list) return;
        list.innerHTML = '';
        // User presets bank
        const userPresets = getUserAnalogPresets();
        if (userPresets.length) {
          const det = document.createElement('details');
          det.className = 'preset-bank'; det.open = true;
          const sum = document.createElement('summary'); sum.textContent = 'User'; det.appendChild(sum);
          userPresets.forEach((p, ui) => {
            const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center';
            const item = document.createElement('div');
            item.className = 'fm-preset-item'; item.textContent = p.name; item.style.flex = '1';
            item.addEventListener('click', () => {
              synth.currentPreset = -1; synth.loadPreset(p); renderAnalogPresets(); _syncAnalogSliders();
            });
            const del = document.createElement('button');
            del.textContent = '✕'; del.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:9px;padding:0 4px;flex-shrink:0';
            del.addEventListener('click', e => { e.stopPropagation(); deleteUserAnalogPreset(ui); renderAnalogPresets(); });
            row.appendChild(item); row.appendChild(del); det.appendChild(row);
          });
          list.appendChild(det);
        }
        // Built-in presets grouped by category
        const byBank = {};
        ANALOG_PRESETS.forEach((p, i) => { const c = p.cat||'Other'; (byBank[c]||(byBank[c]=[])).push({p,i}); });
        ANALOG_BANK_ORDER2.forEach(cat => {
          const entries = byBank[cat]; if (!entries) return;
          const det = document.createElement('details');
          det.className = 'preset-bank';
          if (entries.some(({i}) => i === synth.currentPreset)) det.open = true;
          const sum = document.createElement('summary'); sum.textContent = cat; det.appendChild(sum);
          entries.forEach(({p, i}) => {
            const item = document.createElement('div');
            item.className = 'fm-preset-item' + (i === synth.currentPreset ? ' fm-preset-active' : '');
            item.textContent = p.name;
            item.addEventListener('click', () => {
              synth.currentPreset = i; synth.loadPreset(p); renderAnalogPresets(); _syncAnalogSliders();
            });
            det.appendChild(item);
          });
          list.appendChild(det);
        });
      };
      renderAnalogPresets();

      q('.card-close').addEventListener('click',  () => closeSynthCard(synth.id));
      q('.card-remove').addEventListener('click', (e) => { e.stopPropagation(); removeSynth(synth.id); });
      q('.sc-save-preset-btn').addEventListener('click', () => {
        const name = prompt('Preset name:', synth.name);
        if (!name) return;
        saveUserAnalogPreset({ name, cat:'User', oscType:synth.oscType, texture:synth.texture??0,
          filterType:synth.filterType, filterFreq:synth.filterFreq, filterQ:synth.filterQ,
          attack:synth.attack, decay:synth.decay, sustain:synth.sustain, release:synth.release });
        renderAnalogPresets();
      });

      qa('[data-osc]').forEach(btn => btn.addEventListener('click', () => {
        synth.oscType = btn.dataset.osc;
        qa('[data-osc]').forEach(b => b.classList.toggle('act', b.dataset.osc === synth.oscType));
        const lbl = q('.sc-texture-lbl'); if (lbl) lbl.textContent = synth.oscType === 'pulse' ? 'Width' : 'Texture';
        synth.updateOscType();
      }));
      qa('[data-flt]').forEach(btn => btn.addEventListener('click', () => {
        synth.filterType = btn.dataset.flt;
        qa('[data-flt]').forEach(b => b.classList.toggle('act', b.dataset.flt === synth.filterType));
        synth.updateFilter();
      }));

      const fmtFreq = v => v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz';
      const fmtPct  = v => Math.round(v * 100) + '%';

      initCslider(q('.sc-ffreq').closest('.cslider'), fmtFreq);
      initCslider(q('.sc-fq').closest('.cslider'),    v => v.toFixed(2));
      initCslider(q('.sc-atk').closest('.cslider'),   fmtFade);
      initCslider(q('.sc-dec').closest('.cslider'),   fmtFade);
      initCslider(q('.sc-sus').closest('.cslider'),   fmtPct);
      initCslider(q('.sc-rel').closest('.cslider'),   fmtFade);
      initCslider(q('.sc-texture').closest('.cslider'), fmtPct);

      q('.sc-ffreq').addEventListener('input', () => { synth.filterFreq = parseFloat(q('.sc-ffreq').value); synth.updateFilter(); });
      q('.sc-fq').addEventListener('input',    () => { synth.filterQ    = parseFloat(q('.sc-fq').value);    synth.updateFilter(); });
      q('.sc-atk').addEventListener('input',   () => { synth.attack     = parseFloat(q('.sc-atk').value);   synth.updateEnvelope(); });
      q('.sc-dec').addEventListener('input',   () => { synth.decay      = parseFloat(q('.sc-dec').value);   synth.updateEnvelope(); });
      q('.sc-sus').addEventListener('input',   () => { synth.sustain    = parseFloat(q('.sc-sus').value);   synth.updateEnvelope(); });
      q('.sc-rel').addEventListener('input',   () => { synth.release    = parseFloat(q('.sc-rel').value);   synth.updateEnvelope(); });
      q('.sc-texture').addEventListener('input', () => { synth.texture = parseFloat(q('.sc-texture').value); synth.updateTexture(); });

      // Accordion toggles
      qa('.card-acc-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => {
          hdr.classList.toggle('open');
          const body = hdr.nextElementSibling;
          if (body) body.classList.toggle('open');
          requestAnimationFrame(updateLfoWires);
        });
      });

      // Duplicate
      q('.card-dup').addEventListener('click', e => { e.stopPropagation(); duplicateSynth(synth); });

      _positionCard(el, tile, 300, 500);
      _makeSynthCardDrag(el, synth);
      cv.appendChild(el);
      _syncTilePorts(tile, el);
      requestAnimationFrame(() => el.classList.add('open'));
      openCards.set(synth.id, { el });
      if (tile) tile.classList.add('active', 'expanded');
      requestAnimationFrame(() => buildPianoKeyboard(q(`#sc-kbd-${synth.id}`), synth));
      buildFxSection(el, synth);
    }

    function duplicateSynth(synth) {
      const id = nextId++;
      const offset = 24;
      let dup;
      if (synth.synthType === 'analog') {
        dup = new AnalogSynth(id, synth.name, synth.x + offset, synth.y + offset);
        dup.oscType = synth.oscType; dup.attack = synth.attack; dup.decay = synth.decay;
        dup.sustain = synth.sustain; dup.release = synth.release;
        dup.filterType = synth.filterType; dup.filterFreq = synth.filterFreq; dup.filterQ = synth.filterQ;
        dup.texture = synth.texture ?? 0;
        dup.updateOscType(); dup.updateEnvelope(); dup.updateFilter(); dup.updateTexture();
      } else if (synth.synthType === 'fm') {
        dup = new FMSynthInstrument(id, synth.name, synth.x + offset, synth.y + offset);
        dup.currentPreset = synth.currentPreset;
        if (synth._currentPatch) dup.loadPreset(synth._currentPatch);
      } else if (synth.synthType === 'wavetable') {
        dup = new WavetableSynth(id, synth.name, synth.x + offset, synth.y + offset);
        Object.assign(dup, {
          currentWave: synth.currentWave, detune1: synth.detune1, detune2: synth.detune2,
          osc2octave: synth.osc2octave, width: synth.width,
          cutoff: synth.cutoff, resonance: synth.resonance, envAmount: synth.envAmount,
          filterAttack: synth.filterAttack, filterDecay: synth.filterDecay,
          attack: synth.attack, decay: synth.decay, sustain: synth.sustain, release: synth.release,
        });
        dup.updateWave();
      } else if (synth.synthType === 'karplus') {
        dup = new KarplusSynth(id, synth.name, synth.x + offset, synth.y + offset);
        Object.assign(dup, {
          characterVariation: synth.characterVariation,
          stringDamping: synth.stringDamping, stringDampingVariation: synth.stringDampingVariation,
          stringDampingCalc: synth.stringDampingCalc, stringTension: synth.stringTension,
          pluckDamping: synth.pluckDamping, pluckDampingVariation: synth.pluckDampingVariation,
          stereoSpread: synth.stereoSpread, bodyResonation: synth.bodyResonation,
        });
      } else if (synth.synthType === 'drums') {
        dup = new DrumMachine(id, synth.name, synth.x + offset, synth.y + offset);
        dup.kitId    = synth.kitId;
        dup.kitName  = synth.kitName;
        dup.numSteps = synth.numSteps;
        for (const lane of (synth.lanes || [])) {
          if (synth.patterns[lane.id]) dup.patterns[lane.id] = [...synth.patterns[lane.id]];
          if (synth.pitches[lane.id]  !== undefined) dup.pitches[lane.id]  = synth.pitches[lane.id];
          if (synth.laneVols[lane.id] !== undefined) dup.laneVols[lane.id] = synth.laneVols[lane.id];
        }
        // Copy lane variant selections
        const sels = {};
        for (const lane of (synth.lanes || [])) {
          if (lane.options.length > 1) sels[lane.id] = lane.selectedSlot;
        }
        if (Object.keys(sels).length) dup._pendingLaneSelections = sels;
        dup.gridSync  = synth.gridSync;
        dup.subdiv    = synth.subdiv;
        dup.rate      = synth.rate;
        dup.swing     = synth.swing  || 0;
        dup.nudgeMs   = synth.nudgeMs || 0;
        for (const lane of (synth.lanes || [])) {
          if (synth.laneVelScales[lane.id] !== undefined) dup.laneVelScales[lane.id] = synth.laneVelScales[lane.id];
        }
        // Share already-loaded kit buffers
        dup._kitCache = synth._kitCache;
        drums.set(id, dup);
        dup._currentDb = synth._currentDb;
        dup._currentPan = synth._currentPan;
        dup._applyVol(); dup._applyPan();
        createSynthTile(dup);
        updateSampleList();
        return;
      } else if (synth.synthType === 'rompler') {
        dup = new RomplerInstrument(id, synth.name, synth.x + offset, synth.y + offset);
        dup.romplerBank = synth.romplerBank;
        dup.romplerInstrument = synth.romplerInstrument;
        dup.release = synth.release;
        dup.filterType = synth.filterType; dup.filterFreq = synth.filterFreq; dup.filterQ = synth.filterQ;
        dup.updateFilter();
        // Share loaded smplr instance if available, otherwise reload
        if (synth._smplr) {
          dup._smplrLoading = false;
          // Reload independently so destination wires correctly to dup's bridge
          dup._romplerLoad();
        }
      } else { return; }
      dup._currentDb = synth._currentDb;
      dup._currentPan = synth._currentPan;
      dup._applyVol(); dup._applyPan();
      synths.set(id, dup);
      const t = createSynthTile(dup);
      updateSampleList();
    }

    function createFMSynthCard(synth, tile) {
      const el = document.createElement('div');
      el.className = 'synth-card';
      el.style.setProperty('--card-color', synth.color);

      const renderPresetList = () => {
        const list = el.querySelector('.fm-preset-list');
        if (!list) return;
        list.innerHTML = '';
        synth.presetList.forEach((p, i) => {
          const item = document.createElement('div');
          item.className = 'fm-preset-item' + (i === synth.currentPreset ? ' fm-preset-active' : '');
          item.textContent = p.name;
          item.addEventListener('click', () => {
            synth.currentPreset = i;
            synth.loadPreset(p);
            renderPresetList();
            syncFMSliders();
          });
          list.appendChild(item);
        });
      };

      const fmtHarm = v => v.toFixed(2);
      const fmtModI = v => v.toFixed(1);

      el.innerHTML = `
        <div class="card-titlebar">
          <div class="card-color-dot" style="background:${synth.color};width:10px;height:10px;border-radius:50%;flex-shrink:0"></div>
          <div class="card-name">FM · ${synth.name}</div>
          <button class="card-dup" title="Duplicate">⧉</button>
          <button class="card-remove" title="Remove">🗑</button>
          <button class="card-close" title="Close">✕</button>
        </div>
        <div style="padding:8px 10px 4px">
          <canvas class="synth-scope-canvas" width="260" height="72"></canvas>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">PRESETS <span style="opacity:0.4;font-weight:400;text-transform:none;letter-spacing:0;font-size:8px;margin-left:4px">${synth._usingCustom ? 'Custom SysEx' : 'Built-in'}</span></div>
          <div class="card-acc-body">
            <div class="csec">
              <div class="fm-preset-list"></div>
              <button class="fm-sysx-btn">Load DX7 SysEx (.syx) ▸</button>
            </div>
          </div>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">FM PARAMETERS</div>
          <div class="card-acc-body">
            <div class="csec">
              <div class="crow"><span class="clbl">Harm.</span><div class="cslider"><input type="range" class="fm-harm" min="0.1" max="20" step="0.01" value="${synth.harmonicity}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
              <div class="crow"><span class="clbl">Mod Idx</span><div class="cslider"><input type="range" class="fm-modi" min="0" max="20" step="0.1" value="${synth.modulationIndex}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
            </div>
          </div>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">CARRIER ENVELOPE</div>
          <div class="card-acc-body">
            <div class="csec">
              <div class="crow"><span class="clbl">Attack</span><div class="cslider"><input type="range" class="fm-atk" min="0.001" max="5" step="0.001" value="${synth.attack}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
              <div class="crow"><span class="clbl">Decay</span><div class="cslider"><input type="range" class="fm-dec" min="0.001" max="5" step="0.001" value="${synth.decay}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
              <div class="crow"><span class="clbl">Sustain</span><div class="cslider"><input type="range" class="fm-sus" min="0" max="1" step="0.01" value="${synth.sustain}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
              <div class="crow"><span class="clbl">Release</span><div class="cslider"><input type="range" class="fm-rel" min="0.001" max="8" step="0.001" value="${synth.release}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
            </div>
          </div>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">MODULATOR ENVELOPE</div>
          <div class="card-acc-body">
            <div class="csec">
              <div class="crow"><span class="clbl">Attack</span><div class="cslider"><input type="range" class="fm-matk" min="0.001" max="5" step="0.001" value="${synth.modAttack}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
              <div class="crow"><span class="clbl">Decay</span><div class="cslider"><input type="range" class="fm-mdec" min="0.001" max="5" step="0.001" value="${synth.modDecay}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
              <div class="crow"><span class="clbl">Sustain</span><div class="cslider"><input type="range" class="fm-msus" min="0" max="1" step="0.01" value="${synth.modSustain}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
              <div class="crow"><span class="clbl">Release</span><div class="cslider"><input type="range" class="fm-mrel" min="0.001" max="8" step="0.001" value="${synth.modRelease}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
            </div>
          </div>
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">EFFECTS</div>
          <div class="card-acc-body">
            <div class="fx-section" id="fx-section-${synth.id}"></div>
          </div>
        </div>
        <div id="fm-kbd-${synth.id}"></div>`;

      const q = sel => el.querySelector(sel), qa = sel => el.querySelectorAll(sel);

      const syncFMSliders = () => {
        const pairs = [
          ['.fm-harm',  'harmonicity',     fmtHarm],
          ['.fm-modi',  'modulationIndex', fmtModI],
          ['.fm-atk',   'attack',          fmtFade],
          ['.fm-dec',   'decay',           fmtFade],
          ['.fm-sus',   'sustain',         v => (v*100).toFixed(0)+'%'],
          ['.fm-rel',   'release',         fmtFade],
          ['.fm-matk',  'modAttack',       fmtFade],
          ['.fm-mdec',  'modDecay',        fmtFade],
          ['.fm-msus',  'modSustain',      v => (v*100).toFixed(0)+'%'],
          ['.fm-mrel',  'modRelease',      fmtFade],
        ];
        pairs.forEach(([cls, prop]) => {
          const sl = q(cls);
          if (sl) { sl.value = synth[prop]; sl.closest('.cslider')?._syncPos?.(); }
        });
      };

      q('.card-close').addEventListener('click',  () => closeSynthCard(synth.id));
      q('.card-remove').addEventListener('click', (e) => { e.stopPropagation(); removeSynth(synth.id); });

      const fmtPct = v => Math.round(v * 100) + '%';

      initCslider(q('.fm-harm').closest('.cslider'),  fmtHarm);
      initCslider(q('.fm-modi').closest('.cslider'),  fmtModI);
      initCslider(q('.fm-atk').closest('.cslider'),   fmtFade);
      initCslider(q('.fm-dec').closest('.cslider'),   fmtFade);
      initCslider(q('.fm-sus').closest('.cslider'),   fmtPct);
      initCslider(q('.fm-rel').closest('.cslider'),   fmtFade);
      initCslider(q('.fm-matk').closest('.cslider'),  fmtFade);
      initCslider(q('.fm-mdec').closest('.cslider'),  fmtFade);
      initCslider(q('.fm-msus').closest('.cslider'),  fmtPct);
      initCslider(q('.fm-mrel').closest('.cslider'),  fmtFade);

      q('.fm-harm').addEventListener('input',  () => { synth.harmonicity     = parseFloat(q('.fm-harm').value);  synth.updateFMParams(); });
      q('.fm-modi').addEventListener('input',  () => { synth.modulationIndex = parseFloat(q('.fm-modi').value);  synth.updateFMParams(); });
      q('.fm-atk').addEventListener('input',   () => { synth.attack          = parseFloat(q('.fm-atk').value);   synth.updateEnvelope(); });
      q('.fm-dec').addEventListener('input',   () => { synth.decay           = parseFloat(q('.fm-dec').value);   synth.updateEnvelope(); });
      q('.fm-sus').addEventListener('input',   () => { synth.sustain         = parseFloat(q('.fm-sus').value);   synth.updateEnvelope(); });
      q('.fm-rel').addEventListener('input',   () => { synth.release         = parseFloat(q('.fm-rel').value);   synth.updateEnvelope(); });
      q('.fm-matk').addEventListener('input',  () => { synth.modAttack       = parseFloat(q('.fm-matk').value);  synth.updateModEnv(); });
      q('.fm-mdec').addEventListener('input',  () => { synth.modDecay        = parseFloat(q('.fm-mdec').value);  synth.updateModEnv(); });
      q('.fm-msus').addEventListener('input',  () => { synth.modSustain      = parseFloat(q('.fm-msus').value);  synth.updateModEnv(); });
      q('.fm-mrel').addEventListener('input',  () => { synth.modRelease      = parseFloat(q('.fm-mrel').value);  synth.updateModEnv(); });

      // Accordion toggles
      qa('.card-acc-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => {
          hdr.classList.toggle('open');
          const body = hdr.nextElementSibling;
          if (body) body.classList.toggle('open');
          requestAnimationFrame(updateLfoWires);
        });
      });

      // Duplicate
      q('.card-dup').addEventListener('click', e => { e.stopPropagation(); duplicateSynth(synth); });

      // SysEx loader
      q('.fm-sysx-btn').addEventListener('click', () => {
        const inp = document.getElementById('syx-input');
        // Store reference so we know which synth to load into
        inp._targetSynthId = synth.id;
        inp.click();
      });

      renderPresetList();
      _positionCard(el, tile, 300, 540);
      _makeSynthCardDrag(el, synth);
      cv.appendChild(el);
      _syncTilePorts(tile, el);
      requestAnimationFrame(() => el.classList.add('open'));
      openCards.set(synth.id, { el });
      if (tile) tile.classList.add('active', 'expanded');
      requestAnimationFrame(() => buildPianoKeyboard(q(`#fm-kbd-${synth.id}`), synth));
      buildFxSection(el, synth);
    }

    function createDrumCard(drum, tile) {
      const el = document.createElement('div');
      el.className = 'synth-card drum-card';
      el.style.setProperty('--card-color', drum.color);

      const mkCsl = (cls, min, max, step, val) =>
        `<div class="cslider"><input type="range" class="${cls}" min="${min}" max="${max}" step="${step}" value="${val}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div>`;

      const fmtPitch = v => (parseFloat(v) >= 0 ? '+' : '') + Math.round(parseFloat(v)) + ' st';
      const fmtVol   = v => (parseFloat(v) >= 0 ? '+' : '') + parseFloat(v).toFixed(1) + ' dB';
      const fmtBpm   = v => Math.round(parseFloat(v)) + ' BPM';

      // Category display names for lane labels
      const CAT_NAMES = {kick:'Kick',snare:'Snare',clap:'Clap',rim:'Rim',
        hh_closed:'HH Cl',hh_open:'HH Op',tom_hi:'Tom H',tom_low:'Tom L',cowbell:'Cbell',ride:'Ride'};

      const buildGridHtml = () => {
        const lbls = drum.lanes.map(lane => {
          const catName = CAT_NAMES[lane.category] || lane.category;
          if (lane.options.length > 1) {
            const opts = lane.options.map(s =>
              `<option value="${s}"${s===lane.selectedSlot?' selected':''}>${drum.kitFiles[s]||s}</option>`
            ).join('');
            return `<div class="dm-lane-lbl dm-lane-lbl-sel">
              <select class="dm-lane-sel" data-lane="${lane.id}">${opts}</select>
              <span class="dm-lane-arrow">▾</span>
            </div>`;
          }
          const lbl = drum.kitFiles[lane.selectedSlot] || catName;
          return `<div class="dm-lane-lbl">${lbl}</div>`;
        }).join('');

        const stepsRows = drum.lanes.map(lane => {
          const btns = Array.from({length: drum.numSteps}, (_, i) => {
            const vel = (drum.patterns[lane.id] || [])[i] || 0;
            const onCls = vel > 0 ? ' dm-on' : '';
            const barH = Math.round(vel * 100);
            return `<button class="dm-step${onCls}" data-lane="${lane.id}" data-step="${i}" data-vel="${vel}" style="--lane-col:${drum.color}"><div class="dm-step-vel" style="height:${barH}%"></div></button>`;
          }).join('');
          return `<div class="dm-lane-steps" data-lane="${lane.id}">${btns}</div>`;
        }).join('');

        const fmtVelScale = v => Math.round(parseFloat(v) * 100) + '%';
        const pvCols = drum.lanes.map(lane => {
          const pitch    = drum.pitches[lane.id] || 0;
          const vol      = drum.laneVols[lane.id] || 0;
          const velScale = drum.laneVelScales[lane.id] ?? 1.0;
          return `<div class="dm-pv-wrap">
            <div class="lfo-slot dm-lane-pitch-slot">
              <input type="range" class="dm-pitch-input dm-pitch-${lane.id}" data-lane="${lane.id}" min="-12" max="12" step="0.5" value="${pitch}" title="Pitch: ${fmtPitch(pitch)}">
            </div>
            <div class="lfo-slot dm-lane-vol-slot">
              <input type="range" class="dm-vol-input dm-lvol-${lane.id}" data-lane="${lane.id}" min="-40" max="6" step="0.5" value="${vol}" title="Vol: ${fmtVol(vol)}">
            </div>
          </div>`;
        }).join('');

        return `<div class="dm-lbls-col">${lbls}</div><div class="dm-steps-scroll">${stepsRows}</div><div class="dm-pv-col">${pvCols}</div>`;
      };

      el.innerHTML = `
        <div class="card-titlebar">
          <div class="card-color-dot" style="background:${drum.color};width:10px;height:10px;border-radius:50%;flex-shrink:0"></div>
          <div class="card-name">DRUMS · ${drum.name}</div>
          <span class="midi-dev-lbl">MIDI From</span>
          <select class="midi-input-sel" data-instr-id="${drum.id}">
            <option value="all">ALL</option>
            <option value="keyboard">KEYBOARD</option>
          </select>
          <button class="card-dup" title="Duplicate">&#x29C9;</button>
          <button class="card-remove" title="Remove">&#x1F5D1;</button>
          <button class="card-close" title="Close">&#x2715;</button>
        </div>
        <div class="dm-controls">
          <select class="dm-kit-sel">
            ${DRUM_KITS.map(k => `<option value="${k.id}"${k.id===drum.kitId?' selected':''}>${k.name}</option>`).join('')}
          </select>
          <button class="dm-play-btn${drum.isPlaying?' dm-playing':''}">${drum.isPlaying?'&#x25A0;':'&#x25B6;'}</button>
          <button class="dm-clr-btn" title="Clear all steps">CLR</button>
          <button class="dm-sync-btn${drum.gridSync?' synced':''}">GRID</button>
          <select class="dm-subdiv-sel" style="display:${drum.gridSync?'block':'none'}">
            ${['32n','16n','8n','4n'].map(s=>`<option value="${s}"${s===drum.subdiv?' selected':''}>${s}</option>`).join('')}
          </select>
          <div class="cslider dm-rate-slider" style="display:${!drum.gridSync?'flex':'none'}">
            <input type="range" class="dm-rate-input" min="20" max="400" step="1" value="${drum.rate}">
            <div class="cslider-thumb"><span class="cslider-lbl">${fmtBpm(drum.rate)}</span><input class="cslider-edit" type="text"></div>
          </div>
          <div class="dm-steps-ctrl">
            <button class="dm-steps-dec">−</button>
            <span class="dm-steps-val">${drum.numSteps}</span>
            <button class="dm-steps-inc">+</button>
          </div>
          <span class="dm-kit-status">${drum._kitLoading?'Loading…':''}</span>
        </div>
        <div class="dm-timing">
          <div class="crow"><span class="clbl">Swing</span><div class="cslider lfo-slot"><input type="range" class="dm-swing" min="0" max="0.5" step="0.01" value="${(drum.swing||0).toFixed(2)}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
          <div class="crow"><span class="clbl">Nudge</span><div class="cslider lfo-slot"><input type="range" class="dm-nudge" min="-500" max="500" step="1" value="${(drum.nudgeMs||0).toFixed(0)}"><div class="cslider-thumb"><span class="cslider-lbl"></span><input class="cslider-edit" type="text"></div></div></div>
        </div>
        <div class="dm-body">
          <div class="dm-grid">${buildGridHtml()}</div>
          <div class="vp-vol-wrap lfo-slot">
            <input type="range" class="synth-vol" min="-60" max="6" step="0.1" value="${(drum._currentDb||0).toFixed(1)}">
          </div>
        </div>
        <div class="card-pan-row dm-pan-row lfo-slot">
          <input type="range" class="synth-pan vp-pan" min="-1" max="1" step="0.01" value="${(drum._currentPan||0).toFixed(2)}">
        </div>
        <div class="card-accordion">
          <div class="card-acc-hdr">EFFECTS</div>
          <div class="card-acc-body">
            <div class="fx-section" id="fx-section-${drum.id}"></div>
          </div>
        </div>`;

      const q = sel => el.querySelector(sel);

      // Accordion toggle
      el.addEventListener('click', e => {
        const hdr = e.target.closest('.card-acc-hdr');
        if (!hdr || !el.contains(hdr)) return;
        hdr.classList.toggle('open');
        hdr.nextElementSibling?.classList.toggle('open');
        requestAnimationFrame(() => {
          syncParamPorts(document.getElementById('t' + drum.id), el);
          updateLfoWires();
        });
      });

      // Step button state helper
      function updateStepBtn(b, vel) {
        const v = Math.max(0, Math.min(1.0, vel));
        drum.patterns[b.dataset.lane][parseInt(b.dataset.step)] = v;
        b.dataset.vel = v;
        b.classList.toggle('dm-on', v > 0);
        const bar = b.querySelector('.dm-step-vel');
        if (bar) bar.style.height = (v * 100) + '%';
      }

      function attachStepListeners() {
        el.querySelectorAll('.dm-step').forEach(btn => {
          btn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const startX = e.clientX, startY = e.clientY;
            const startVel = parseFloat(btn.dataset.vel) || 0;
            const wasActive = startVel > 0;
            const paintAction = wasActive ? 'erase' : 'draw';
            const paintedSet = new Set();
            let mode = null; // null | 'vel' | 'paint'

            const onMove = mv => {
              const dx = mv.clientX - startX;
              const dy = startY - mv.clientY; // positive = upward drag
              if (mode === null) {
                if (Math.abs(dy) > 4) {
                  mode = 'vel';
                  if (!wasActive) updateStepBtn(btn, 1.0); // turn on before dragging vel
                } else if (Math.abs(dx) > 4) {
                  mode = 'paint';
                  const key = btn.dataset.lane + '-' + btn.dataset.step;
                  paintedSet.add(key);
                  updateStepBtn(btn, paintAction === 'draw' ? 1.0 : 0);
                } else return;
              }
              if (mode === 'vel') {
                const baseVel = wasActive ? startVel : 1.0;
                updateStepBtn(btn, Math.max(0.05, Math.min(1.0, baseVel + dy / 60)));
              } else if (mode === 'paint') {
                const target = document.elementFromPoint(mv.clientX, mv.clientY);
                const stepBtn = target?.closest?.('.dm-step');
                if (stepBtn && el.contains(stepBtn)) {
                  const key = stepBtn.dataset.lane + '-' + stepBtn.dataset.step;
                  if (!paintedSet.has(key)) {
                    paintedSet.add(key);
                    updateStepBtn(stepBtn, paintAction === 'draw' ? 1.0 : 0);
                  }
                }
              }
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              if (mode === null) updateStepBtn(btn, wasActive ? 0 : 1.0);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
        });
      }
      attachStepListeners();

      // Rebuild grid when numSteps or kit changes
      function rebuildGrid() {
        q('.dm-grid').innerHTML = buildGridHtml();
        attachPvListeners();
        attachStepListeners();
        attachLaneSelListeners();
        applyCardOverrides(drum.id);
      }

      function attachPvListeners() {
        el.querySelectorAll('.dm-pitch-input').forEach(inp => {
          inp.addEventListener('input', e => {
            const laneId = e.target.dataset.lane;
            drum.pitches[laneId] = parseFloat(e.target.value);
            e.target.title = 'Pitch: ' + fmtPitch(e.target.value);
          });
        });
        el.querySelectorAll('.dm-vol-input').forEach(inp => {
          inp.addEventListener('input', e => {
            const laneId = e.target.dataset.lane;
            drum.laneVols[laneId] = parseFloat(e.target.value);
            e.target.title = 'Vol: ' + fmtVol(e.target.value);
          });
        });
      }

      function attachLaneSelListeners() {
        el.querySelectorAll('.dm-lane-sel').forEach(sel => {
          sel.addEventListener('change', e => {
            e.stopPropagation();
            const laneId = e.target.dataset.lane;
            const lane = drum.lanes.find(l => l.id === laneId);
            if (lane) {
              lane.selectedSlot = e.target.value;
              // Preload the selected slot's buffer if not already cached
              const bufs = drum._kitCache[drum.kitId];
              if (bufs && !bufs[lane.selectedSlot]) {
                fetch(`${DRUM_SAMPLE_BASE}${drum.kitId}/${lane.selectedSlot}.wav`)
                  .then(r => r.arrayBuffer())
                  .then(ab => Tone.context.rawContext.decodeAudioData(ab))
                  .then(buf => { bufs[lane.selectedSlot] = buf; })
                  .catch(() => {});
              }
            }
          });
        });
      }

      // Kit selector — await loadKit so INSTRUMENTS is updated before grid rebuild
      q('.dm-kit-sel').addEventListener('change', async e => {
        const kitId = e.target.value;
        await drum.loadKit(kitId);
        rebuildGrid();
      });

      // Play/stop
      q('.dm-play-btn').addEventListener('click', e => {
        e.stopPropagation();
        const btn = q('.dm-play-btn');
        if (drum.isPlaying) {
          drum.stopSequencer();
          btn.innerHTML = '&#x25B6;';
          btn.classList.remove('dm-playing');
        } else {
          drum.startSequencer();
          btn.innerHTML = '&#x25A0;';
          btn.classList.add('dm-playing');
        }
      });

      // Clear all steps
      q('.dm-clr-btn').addEventListener('click', e => {
        e.stopPropagation();
        for (const lane of drum.lanes) drum.patterns[lane.id].fill(0);
        rebuildGrid();
      });

      // GRID toggle (on = synced to transport, off = free rate)
      q('.dm-sync-btn').addEventListener('click', e => {
        e.stopPropagation();
        drum.gridSync = !drum.gridSync;
        q('.dm-sync-btn').classList.toggle('synced', drum.gridSync);
        q('.dm-subdiv-sel').style.display  = drum.gridSync ? 'block' : 'none';
        q('.dm-rate-slider').style.display = drum.gridSync ? 'none'  : 'flex';
        if (drum.isPlaying) drum.startSequencer();
      });

      // Subdivision
      q('.dm-subdiv-sel').addEventListener('change', e => {
        drum.subdiv = e.target.value;
        if (drum.isPlaying) drum.startSequencer();
      });

      // Free rate cslider
      const rateSlider = q('.dm-rate-slider');
      initCslider(rateSlider, fmtBpm);
      q('.dm-rate-input').addEventListener('input', e => {
        drum.rate = parseFloat(e.target.value);
        if (drum.isPlaying) drum.startSequencer();
      });

      // Steps +/−
      q('.dm-steps-dec').addEventListener('click', e => {
        e.stopPropagation();
        if (drum.numSteps > 1) {
          drum.numSteps--;
          q('.dm-steps-val').textContent = drum.numSteps;
          rebuildGrid();
          if (drum.isPlaying) drum.startSequencer();
        }
      });
      q('.dm-steps-inc').addEventListener('click', e => {
        e.stopPropagation();
        if (drum.numSteps < 64) {
          drum.numSteps++;
          q('.dm-steps-val').textContent = drum.numSteps;
          rebuildGrid();
          if (drum.isPlaying) drum.startSequencer();
        }
      });

      // Swing + Nudge csliders
      const fmtSwing = v => Math.round(parseFloat(v) * 100) + '%';
      const fmtNudge = v => { const ms = Math.round(parseFloat(v)); return (ms >= 0 ? '+' : '') + ms + ' ms'; };
      initCslider(q('.dm-swing').closest('.cslider'), fmtSwing);
      initCslider(q('.dm-nudge').closest('.cslider'), fmtNudge);
      q('.dm-swing').addEventListener('input', e => { drum.swing = parseFloat(e.target.value); });
      q('.dm-nudge').addEventListener('input', e => { drum.nudgeMs = parseFloat(e.target.value); });

      // Initial pitch/vol/vel slider listeners
      attachPvListeners();
      attachLaneSelListeners();

      q('.synth-vol').addEventListener('input', () => { drum._currentDb  = parseFloat(q('.synth-vol').value); drum._applyVol(); });
      q('.synth-pan').addEventListener('input', () => { drum._currentPan = parseFloat(q('.synth-pan').value); drum._applyPan(); });

      // MIDI input selector
      populateMidiSelect(q('.midi-input-sel'), drum.midiInput ?? 'all');
      q('.midi-input-sel').addEventListener('change', e => { drum.midiInput = e.target.value; });

      // Titlebar drag/close
      q('.card-titlebar').addEventListener('click', e => {
        if (e.target.closest('button, select') || el._tbDragged) return;
        closeSynthCard(drum.id);
      });

      q('.card-close').addEventListener('click',  () => closeSynthCard(drum.id));
      q('.card-remove').addEventListener('click', e => { e.stopPropagation(); removeSynth(drum.id); });
      q('.card-dup').addEventListener('click',    e => { e.stopPropagation(); duplicateSynth(drum); });

      _positionCard(el, tile, 500, 560);
      _makeSynthCardDrag(el, drum);
      cv.appendChild(el);
      initVpSliders(el);
      _syncTilePorts(tile, el);
      requestAnimationFrame(() => { syncParamPorts(tile, el); updateLfoWires(); });
      requestAnimationFrame(() => el.classList.add('open'));
      openCards.set(drum.id, { el });
      if (tile) tile.classList.add('active', 'expanded');
      buildFxSection(el, drum);
      applyCardOverrides(drum.id);
    }

    function duplicateSample(src) {
      const id = nextId++;
      const offset = 24;
      const s = new Sample(id, src.name, src.raw, src.x + offset, src.y + offset);

      // Copy all settings
      s.color = src.color;
      s.loopStart = src.loopStart;
      s.loopEnd = src.loopEnd;
      s._origLoopEnd = src._origLoopEnd ?? src.loopEnd;
      s.filePosition = src.filePosition;
      s.reversed = src.reversed;
      if (src.reversed && src._revBuf) s._revBuf = src._revBuf; // share reversed buffer
      s.setPitch(src.pitchST);
      s.setFine(src.fineST || 0);
      s.setStretch(src.stretchST);
      if (src.psStretch > 1) s.setPsStretch(src.psStretch);
      s._initRb();
      s.setClipGain(src.clipGainDb);
      s.gridSync = src.gridSync;
      s.subdiv = src.subdiv;
      s.subdivFactor = src.subdivFactor;
      s.gridMulti = src.gridMulti;
      s._nudgeMs = src._nudgeMs || 0;
      s.attackTime = src.attackTime;
      s.releaseTime = src.releaseTime;
      s.crossfadeTime = src.crossfadeTime;
      s.muted = src.muted;
      // Copy granular settings
      s.grainPosition = src.grainPosition;
      s.grainSpread   = src.grainSpread;
      s.grainDensity  = src.grainDensity;
      s.grainAttack   = src.grainAttack;
      s.grainRelease  = src.grainRelease;
      s.grainPitch    = src.grainPitch;
      if (src.granular) s.setGranularMode(true);

      // Copy EQ bands
      src.eqBands.forEach((b, i) => {
        s.eqBands[i] = { ...b };
        s.eqFilters[i].frequency.value = b.freq;
        s.eqFilters[i].Q.value = b.q;
        if (b.type === 'peaking') s.eqFilters[i].gain.value = b.gain || 0;
      });

      // Copy FX chain
      src.fxChain.forEach(inst => {
        const copy = s.addFxInstance(inst.type);
        if (!copy) return;
        if (inst.type === 'eq' && inst.eqData) {
          inst.eqData.bands.forEach((b, i) => {
            copy.eqData.bands[i] = { ...b };
            copy.eqData.applyBand(i);
          });
        } else if (inst.params) {
          Object.assign(copy.params, inst.params);
          applyFxNodeParams(copy);
        }
        if (inst.postFader) {
          copy.postFader = true;
          s.rebuildFxChain();
        }
      });

      s._currentDb = src._currentDb;
      s._currentPan = src._currentPan;
      s.updateVol();
      s.updatePan();
      samples.set(id, s);
      createTile(s);
      startSample(s);
      updateEmpty();
      openCard(id);

      // Reposition the new card so it's visibly offset from the source card
      const srcInfo = openCards.get(src.id);
      const newInfo = openCards.get(id);
      if (srcInfo && newInfo) {
        const ox = parseFloat(srcInfo.el.style.left) || 0;
        const oy = parseFloat(srcInfo.el.style.top) || 0;
        const step = 30;
        const nx = Math.max(8, Math.min(window.innerWidth - 288, ox + step));
        const ny = Math.max(48, Math.min(window.innerHeight - 480, oy + step));
        newInfo.el.style.left = nx + 'px';
        newInfo.el.style.top = ny + 'px';
      }
    }

    function updateEmpty() {
      const total = samples.size + synths.size + drums.size;
      document.getElementById('empty').classList.toggle('gone', total > 0);
      const scEl = document.getElementById('sc'); if (scEl) scEl.textContent = samples.size;
      updateSampleList();
    }

    function updateSampleList() {
      const el = document.getElementById('sample-list');
      el.innerHTML = '';
      const addItem = (id, name, closer, opener) => {
        const item = document.createElement('div');
        item.className = 'slist-item' + (openCards.has(id) ? ' open' : '');
        item.textContent = (name.length > 20 ? name.slice(0, 20) : name);
        item.addEventListener('click', () => {
          if (openCards.has(id)) { closer(id); } else { opener(id); }
          updateSampleList();
        });
        el.appendChild(item);
      };
      for (const [id, s] of samples) addItem(id, s.name, closeCard, openCard);
      for (const [id, s] of synths)  addItem(id, s.name, closeSynthCard, openSynthCard);
      for (const [id, s] of drums)   addItem(id, s.name, closeSynthCard, openSynthCard);
    }

