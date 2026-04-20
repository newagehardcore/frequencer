    // ════════════════════════════════════════════════════
    // ── Riff note transform helpers ──
    function riffShiftOctave(riff, delta) {
      const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      function shiftNote(note) {
        if (!note) return note;
        const m = note.match(/^([A-G]#?)(\d+)$/);
        if (!m) return note;
        const newOct = parseInt(m[2]) + delta;
        if (newOct < 0 || newOct > 9) return note;
        return m[1] + newOct;
      }
      for (const s of riff.steps) if (s.note) s.note = shiftNote(s.note);
      for (const n of riff.notes) if (n.note) n.note = shiftNote(n.note);
    }

    function riffTranspose(riff, delta) {
      const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
      const isChromatic = intervals.length === 12;
      const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
      const rootPC = NM[riff.scaleRoot] ?? 0;
      const dir = delta >= 0 ? 1 : -1;

      function transposeNote(note) {
        if (!note) return note;
        const target = Math.max(12, Math.min(119, noteToSemis(note) + delta));
        if (isChromatic) return midiToNoteName(target);
        // Walk from target in direction of delta until we land on an in-scale pitch
        for (let d = 0; d <= 12; d++) {
          const candidate = target + d * dir;
          if (candidate < 12 || candidate > 119) break;
          const offset = ((candidate % 12) - rootPC % 12 + 12) % 12;
          if (intervals.includes(offset)) return midiToNoteName(candidate);
        }
        return midiToNoteName(target);
      }
      for (const s of riff.steps) if (s.note) s.note = transposeNote(s.note);
      for (const n of riff.notes) if (n.note) n.note = transposeNote(n.note);
    }

    function shuffled(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    function buildArpSequence(midiNotes, mode, octaves) {
      const base = [...midiNotes].sort((a, b) => a - b);
      let expanded = [];
      for (let o = 0; o < octaves; o++) expanded.push(...base.map(n => n + o * 12));
      if (!expanded.length) return [];
      switch (mode) {
        case 'up':      return expanded;
        case 'down':    return [...expanded].reverse();
        case 'updown':  return expanded.length > 1
          ? [...expanded, ...[...expanded].reverse().slice(1, -1)] : expanded;
        case 'downup': {
          const rev = [...expanded].reverse();
          return expanded.length > 1 ? [...rev, ...[...rev].reverse().slice(1, -1)] : rev;
        }
        case 'random':   return expanded; // caller picks random index
        case 'order':    return [...midiNotes];
        case 'thumb-up': return [expanded[0], ...expanded.slice(1)];
        case 'thumb-dn': return [expanded[expanded.length - 1], ...expanded.slice(0, -1).reverse()];
        default:         return expanded;
      }
    }

    function chordsTransposeSemi(chordsInst, dir) {
      const intervals = RIFF_SCALES[chordsInst.scale] || RIFF_SCALES['Chromatic'];
      const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
      const rootPC = NM[chordsInst.scaleRoot] ?? 0;
      const cur = chordsInst.transposeOffset;
      for (let d = 1; d <= 12; d++) {
        const candidate = cur + d * dir;
        const offset = ((candidate % 12) - rootPC + 1200) % 12;
        if (intervals.includes(offset)) { chordsInst.transposeOffset = candidate; return; }
      }
      chordsInst.transposeOffset = cur + dir; // fallback: chromatic step
    }

    // RIFF NODE
    // ════════════════════════════════════════════════════
    function createRiffNode(riff) {
      const el = document.createElement('div');
      el.className = 'riff-node';
      el.id = 'riff-' + riff.id;
      el.style.left = (riff.x - RIFF_W / 2) + 'px';
      el.style.top  = (riff.y - 160) + 'px';
      el.style.setProperty('--riff-color', riff.color);

      // Build scale options HTML
      const scaleOptsHtml = Object.keys(RIFF_SCALES).map(name =>
        `<option value="${name}"${name === riff.scale ? ' selected' : ''}>${name}</option>`
      ).join('');
      const _riffEffRoot = transposeRoot(riff.scaleRoot, globalTranspose);
      const rootOptsHtml = RIFF_NOTE_NAMES.map(n =>
        `<option value="${n}"${n === _riffEffRoot ? ' selected' : ''}>${n}</option>`
      ).join('');

      const speedOptsHtml = [
        {v:'0.25',l:'÷4'},{v:'0.333',l:'÷3'},{v:'0.5',l:'÷2'},{v:'0.667',l:'÷3:2'},
        {v:'1',l:'×1'},{v:'1.5',l:'×3:2'},{v:'2',l:'×2'},{v:'3',l:'×3'},{v:'4',l:'×4'},
      ].map(o => `<option value="${o.v}">${o.l}</option>`).join('');

      el.innerHTML = `
        <div class="riff-titlebar">
          <div class="riff-color-dot"></div>
          <div class="riff-name">${riff.name}</div>
          <span class="midi-dev-lbl">MIDI From</span>
          <select class="midi-input-sel riff-midi-sel" data-riff-id="${riff.id}">
            <option value="all">ALL</option>
            <option value="keyboard">KEYBOARD</option>
          </select>
          <button class="riff-hdr-btn riff-dup-btn" title="Duplicate">⧉</button>
          <button class="riff-hdr-btn riff-remove-btn" title="Remove">🗑</button>
          <button class="riff-hdr-btn riff-min-btn" title="Minimize">✕</button>
        </div>
        <div class="riff-mode-row">
          <span class="riff-lbl">Mode</span>
          <select class="riff-seqmode-sel riff-sel" style="flex:1">
            <option value="grid"${riff.seqMode === 'grid' ? ' selected' : ''}>Grid</option>
            <option value="orbit"${riff.seqMode === 'orbit' ? ' selected' : ''}>Orbit</option>
          </select>
        </div>
        <div class="riff-mini-grid"></div>
        <canvas class="riff-orbit-mini" width="120" height="40"></canvas>
        <div class="riff-min-footer">${riff.name}</div>
        <div class="riff-body">
          <!-- ORBIT SECTION -->
          <div class="riff-orbit-section${riff.seqMode === 'orbit' ? ' active' : ''}">
            <canvas class="riff-orbit-canvas" width="324" height="200"></canvas>
            <div class="riff-ring-tabbar">
              <button class="riff-ring-tab act" data-ring="0">Ring 1</button>
              <button class="riff-ring-tab" data-ring="1">Ring 2</button>
              <button class="riff-ring-tab${riff.orbitNumRings < 3 ? ' hidden-ring' : ''}" data-ring="2">Ring 3</button>
              <button class="riff-ring-tab${riff.orbitNumRings < 4 ? ' hidden-ring' : ''}" data-ring="3">Ring 4</button>
              <button class="riff-ring-addrm riff-ring-add-btn" title="Add ring">+</button>
              <button class="riff-ring-addrm riff-ring-rem-btn" title="Remove ring">−</button>
            </div>
          </div>
          <!-- STEP GRID -->
          <div class="riff-step-grid"></div>
          <!-- STEP ACTION ROW: REC PATTERN + REC STEP + SHIFT + CLEAR -->
          <div class="riff-row" style="gap:4px;padding-top:4px">
            <button class="riff-step-btn riff-patrec-btn">Rec Pattern</button>
            <button class="riff-step-btn riff-stepentry-btn">Rec Step</button>
            <button class="riff-step-btn riff-clear-btn">Clear</button>
            <span class="riff-lbl" style="margin-left:4px">Shift</span>
            <button class="riff-xfm-btn riff-shift-left">◀</button>
            <button class="riff-xfm-btn riff-shift-right">▶</button>
          </div>
          <!-- GRID + SUBDIVISION/RATE + STEPS ROW -->
          <div class="riff-row" style="padding-bottom:2px">
            <button class="cbtn riff-grid-btn" style="flex:0 0 auto;padding:4px 8px;font-size:9px">Grid</button>
            <select class="riff-subdiv-sel riff-sel" style="flex:1">
              <option value="1n">1 bar</option>
              <option value="1n.">1 bar .</option>
              <option value="2n">1/2</option>
              <option value="2n.">1/2 .</option>
              <option value="2t">1/2 T</option>
              <option value="4n">1/4</option>
              <option value="4n.">1/4 .</option>
              <option value="4t">1/4 T</option>
              <option value="8n">1/8</option>
              <option value="8n.">1/8 .</option>
              <option value="8t">1/8 T</option>
              <option value="16n">1/16</option>
              <option value="16n.">1/16 .</option>
              <option value="16t">1/16 T</option>
              <option value="32n">1/32</option>
              <option value="32n.">1/32 .</option>
              <option value="32t">1/32 T</option>
            </select>
            <span class="riff-lbl riff-rate-lbl">Rate</span>
            <div class="cslider riff-rate-slider" style="flex:1">
              <input type="range" class="riff-rate-input" min="0.04" max="2" step="0.01" value="${riff.rate}">
              <div class="cslider-thumb"><span class="cslider-lbl">${riff.rate.toFixed(2)}s</span><input class="cslider-edit" type="text"></div>
            </div>
            <span class="riff-lbl" style="margin-left:4px">Steps</span>
            <div class="riff-steps-ctrl">
              <button class="riff-steps-dec">−</button>
              <span class="riff-steps-val">${riff.numSteps}</span>
              <button class="riff-steps-inc">+</button>
            </div>
            <span class="riff-lbl riff-speed-lbl" style="margin-left:4px;display:none">Speed</span>
            <select class="riff-speed-sel riff-sel" style="flex:0 0 auto;width:52px;display:none">${speedOptsHtml}</select>
          </div>
          <!-- TRANSFORM ROW -->
          <div class="riff-row sep" style="gap:4px">
            <span class="riff-lbl">Oct</span>
            <button class="riff-xfm-btn riff-oct-dn" title="Octave down">▼</button>
            <button class="riff-xfm-btn riff-oct-up" title="Octave up">▲</button>
            <span class="riff-lbl" style="margin-left:4px">Semi</span>
            <button class="riff-xfm-btn riff-trans-dn" title="Transpose down">▼</button>
            <button class="riff-xfm-btn riff-trans-up" title="Transpose up">▲</button>
            <span class="riff-lbl" style="margin-left:4px">+</span>
            <select class="riff-harm-sel riff-sel" style="flex:1">
              <option value="0">None</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6">6</option>
              <option value="7">7</option>
              <option value="12">8</option>
            </select>
          </div>
          <!-- SCALE ROW -->
          <div class="riff-row">
            <span class="riff-lbl">Root</span>
            <select class="riff-root-sel riff-sel" style="flex:0 0 auto;width:46px">${rootOptsHtml}</select>
            <span class="riff-lbl">Scale</span>
            <select class="riff-scale-sel riff-sel">${scaleOptsHtml}</select>
          </div>
          <!-- KEYBOARD -->
          <div class="riff-kbd-wrap" id="riff-kbd-${riff.id}"></div>
          <div class="riff-kbd-hint">A–J = white keys &nbsp;·&nbsp; W E T Y U = sharps &nbsp;·&nbsp; Z / X = oct ↓↑ &nbsp;·&nbsp; R = rest</div>
          <!-- WIRE DESTINATIONS -->
          <div class="riff-wire-row sep">
            <div class="riff-dest-list"></div>
          </div>
        </div>
        <div class="riff-port-strip riff-port-strip-right"></div>
        <div class="riff-port-strip riff-port-strip-left"></div>
      `;

      const q = sel => el.querySelector(sel);

      // MIDI input selector
      populateMidiSelect(q('.riff-midi-sel'), riff.midiInput ?? 'all');
      q('.riff-midi-sel').addEventListener('mousedown', e => e.stopPropagation());
      q('.riff-midi-sel').addEventListener('click',     e => e.stopPropagation());
      q('.riff-midi-sel').addEventListener('change',    e => { e.stopPropagation(); riff.midiInput = e.target.value; });

      // ── Step-entry state ──
      let selectedStep = -1;
      let stepEntryActive = false;
      let patternRecActive = false;
      let entryCursor = 0; // position during step entry
      let activeRing = 0; // orbit mode: currently edited ring index

      // ── Orbit helpers ──
      function getOrbitRing() { return riff.orbitRings[activeRing]; }
      function getActiveSteps() { return riff.seqMode === 'orbit' ? getOrbitRing().steps : riff.steps; }
      function getActiveNumSteps() { return riff.seqMode === 'orbit' ? getOrbitRing().numSteps : riff.numSteps; }

      // ── Step grid ──
      function buildStepGrid() {
        const grid = q('.riff-step-grid');
        grid.innerHTML = '';
        const numSteps = getActiveNumSteps();
        const steps = getActiveSteps();
        for (let i = 0; i < numSteps; i++) {
          const stepData = steps[i];
          const cell = document.createElement('div');
          cell.className = 'riff-step' + (stepData.note ? ' has-note' : '');
          cell.dataset.idx = i;

          const velBar = document.createElement('div');
          velBar.className = 'riff-step-vel';
          velBar.style.height = ((stepData.vel ?? 1.0) * 100) + '%';
          cell.appendChild(velBar);

          const numSpan = document.createElement('span');
          numSpan.className = 'riff-step-num';
          numSpan.textContent = i + 1;
          cell.appendChild(numSpan);

          const noteSpan = document.createElement('span');
          noteSpan.className = 'riff-step-note';
          noteSpan.textContent = stepData.note || '—';
          cell.appendChild(noteSpan);

          // Glide strip
          const glideStrip = document.createElement('div');
          glideStrip.className = 'riff-glide-strip' + (stepData.slide ? ' on' : '');
          glideStrip.dataset.idx = i;
          const glideFill = document.createElement('div');
          glideFill.className = 'riff-glide-fill';
          const _initMs = stepData.glideMs ?? 50;
          glideFill.style.width = (_initMs / 500 * 100) + '%';
          glideStrip.appendChild(glideFill);
          const glideArrow = document.createElement('span');
          glideArrow.className = 'riff-glide-arrow';
          glideArrow.textContent = '›';
          glideStrip.appendChild(glideArrow);
          const glideValSpan = document.createElement('span');
          glideValSpan.className = 'riff-glide-val';
          glideValSpan.textContent = _initMs + 'ms';
          glideStrip.appendChild(glideValSpan);
          cell.appendChild(glideStrip);

          glideStrip.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
          if (riff.seqMode === 'orbit') glideStrip.style.display = 'none';
          glideStrip.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            const si = parseInt(glideStrip.dataset.idx);
            const curSteps = getActiveSteps();
            const wasOn = curSteps[si].slide;
            if (!wasOn) {
              curSteps[si].slide = true;
              glideStrip.classList.add('on');
              updateGlideStrip(si);
            }
            const startX = e.clientX;
            const startMs = curSteps[si].glideMs ?? 50;
            let dragged = false;
            const onMove = mv => {
              const dx = mv.clientX - startX;
              if (!dragged && Math.abs(dx) > 3) { dragged = true; glideStrip.classList.add('dragging'); }
              if (!dragged) return;
              curSteps[si].glideMs = Math.max(0, Math.min(500, Math.round(startMs + dx * 2)));
              updateGlideStrip(si);
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              glideStrip.classList.remove('dragging');
              if (!dragged && wasOn) {
                curSteps[si].slide = false;
                updateGlideStrip(si);
              } else {
                updateGlideStrip(si);
              }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });

          if (!stepEntryActive && i === selectedStep) cell.classList.add('selected');
          if (stepEntryActive && i === entryCursor) cell.classList.add('entry-cursor');

          cell.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const startY = e.clientY;
            const startVel = getActiveSteps()[i].vel ?? 1.0;
            let dragged = false;

            const onMove = mv => {
              const dy = startY - mv.clientY;
              if (!dragged && Math.abs(dy) > 4) dragged = true;
              if (!dragged) return;
              getActiveSteps()[i].vel = Math.max(0.05, Math.min(1.0, startVel + dy / 70));
              updateVelBar(i);
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              if (!dragged) {
                if (stepEntryActive) { entryCursor = i; refreshEntryCursor(); }
                else toggleStepSelect(i);
              }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
          cell.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); clearStep(i); });

          // Octave transpose buttons
          const mkOctBtn = (dir) => {
            const btn = document.createElement('button');
            btn.className = 'riff-oct-btn ' + (dir > 0 ? 'riff-oct-up' : 'riff-oct-dn');
            btn.textContent = dir > 0 ? '+' : '−';
            btn.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); });
            btn.addEventListener('contextmenu', e => { e.stopPropagation(); e.preventDefault(); });
            btn.addEventListener('click', e => {
              e.stopPropagation();
              const s = getActiveSteps()[i];
              if (!s.note) return;
              const newMidi = Math.max(0, Math.min(127, noteToSemis(s.note) + dir * 12));
              s.note = midiToNoteName(newMidi);
              noteSpan.textContent = s.note;
            });
            return btn;
          };
          cell.appendChild(mkOctBtn(-1));
          cell.appendChild(mkOctBtn(+1));

          grid.appendChild(cell);
        }
        q('.riff-steps-val').textContent = getActiveNumSteps();

        // Rebuild mini grid dots (always show first ring in orbit mode)
        const mini = q('.riff-mini-grid');
        mini.innerHTML = '';
        const miniSteps = riff.seqMode === 'orbit' ? riff.orbitRings[0].steps : riff.steps;
        const miniN = riff.seqMode === 'orbit' ? riff.orbitRings[0].numSteps : riff.numSteps;
        for (let i = 0; i < 64; i++) {
          const dot = document.createElement('div');
          dot.className = 'riff-mini-step' +
            (i < miniN && miniSteps[i].note ? ' has-note' : '') +
            (i >= miniN ? ' inactive' : '');
          dot.style.display = i >= miniN ? 'none' : '';
          dot.dataset.idx = i;
          mini.appendChild(dot);
        }
      }

      function updateVelBar(idx) {
        const cell = q(`.riff-step[data-idx="${idx}"]`);
        if (!cell) return;
        const bar = cell.querySelector('.riff-step-vel');
        if (bar) bar.style.height = ((getActiveSteps()[idx].vel ?? 1.0) * 100) + '%';
      }

      function updateGlideStrip(idx) {
        const strip = q(`.riff-glide-strip[data-idx="${idx}"]`);
        if (!strip) return;
        const stepData = getActiveSteps()[idx];
        const ms = stepData.glideMs ?? 50;
        strip.classList.toggle('on', !!stepData.slide);
        const fill = strip.querySelector('.riff-glide-fill');
        if (fill) fill.style.width = (ms / 500 * 100) + '%';
        const valSpan = strip.querySelector('.riff-glide-val');
        if (valSpan) valSpan.textContent = ms + 'ms';
      }

      function refreshEntryCursor() {
        el.querySelectorAll('.riff-step.entry-cursor').forEach(c => c.classList.remove('entry-cursor'));
        q(`.riff-step[data-idx="${entryCursor}"]`)?.classList.add('entry-cursor');
      }

      function toggleStepSelect(idx) {
        if (selectedStep === idx) {
          selectedStep = -1;
          q(`.riff-step[data-idx="${idx}"]`)?.classList.remove('selected');
        } else {
          if (selectedStep >= 0) q(`.riff-step[data-idx="${selectedStep}"]`)?.classList.remove('selected');
          selectedStep = idx;
          q(`.riff-step[data-idx="${idx}"]`)?.classList.add('selected');
        }
        setRiffFocus(riff.id);
      }

      function clearStep(idx) {
        const s = getActiveSteps()[idx];
        s.note = null; s.vel = 1.0;
        const cell = q(`.riff-step[data-idx="${idx}"]`);
        if (cell) {
          cell.classList.remove('has-note');
          cell.querySelector('.riff-step-note').textContent = '—';
          const bar = cell.querySelector('.riff-step-vel');
          if (bar) bar.style.height = '100%';
        }
        if (riff.seqMode !== 'orbit' || activeRing === 0)
          q(`.riff-mini-step[data-idx="${idx}"]`)?.classList.remove('has-note');
      }

      function assignNoteToStep(idx, note) {
        // Snap to scale
        const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
        note = snapToScale(note, riff.scaleRoot, intervals);
        getActiveSteps()[idx].note = note;
        const cell = q(`.riff-step[data-idx="${idx}"]`);
        if (cell) { cell.classList.add('has-note'); cell.querySelector('.riff-step-note').textContent = note; }
        if (riff.seqMode !== 'orbit' || activeRing === 0)
          q(`.riff-mini-step[data-idx="${idx}"]`)?.classList.add('has-note');
      }

      function advanceEntry() {
        entryCursor = (entryCursor + 1) % getActiveNumSteps();
        refreshEntryCursor();
      }

      // ── Step-entry REC button ──
      const stepEntryBtn = q('.riff-stepentry-btn');
      stepEntryBtn.addEventListener('click', e => {
        e.stopPropagation();
        stepEntryActive = !stepEntryActive;
        stepEntryBtn.classList.toggle('rec-act', stepEntryActive);
        if (stepEntryActive) {
          // Deactivate pattern rec if it was on
          if (patternRecActive) {
            patternRecActive = false;
            q('.riff-patrec-btn').classList.remove('rec-act');
          }
          // Deselect manual selection, start at step 0 (or selectedStep)
          entryCursor = selectedStep >= 0 ? selectedStep : 0;
          selectedStep = -1;
          el.querySelectorAll('.riff-step.selected').forEach(c => c.classList.remove('selected'));
        } else {
          el.querySelectorAll('.riff-step.entry-cursor').forEach(c => c.classList.remove('entry-cursor'));
        }
        buildStepGrid();
        setRiffFocus(riff.id);
      });

      // ── Pattern REC button ──
      const patRecBtn = q('.riff-patrec-btn');
      patRecBtn.addEventListener('click', e => {
        e.stopPropagation();
        patternRecActive = !patternRecActive;
        patRecBtn.classList.toggle('rec-act', patternRecActive);
        if (patternRecActive) {
          // Deactivate step rec if it was on
          if (stepEntryActive) {
            stepEntryActive = false;
            stepEntryBtn.classList.remove('rec-act');
            el.querySelectorAll('.riff-step.entry-cursor').forEach(c => c.classList.remove('entry-cursor'));
            buildStepGrid();
          }
        }
        setRiffFocus(riff.id);
      });

      // ── Clear button ──
      q('.riff-clear-btn').addEventListener('click', e => {
        e.stopPropagation();
        if (riff.seqMode === 'orbit') {
          const ring = getOrbitRing();
          for (let i = 0; i < ring.steps.length; i++) ring.steps[i].note = null;
        } else {
          for (let i = 0; i < riff.steps.length; i++) riff.steps[i].note = null;
          riff.notes = [];
        }
        selectedStep = -1; entryCursor = 0;
        buildStepGrid(); riff.reschedule(); setRiffFocus(riff.id);
      });

      // ── Steps inc/dec ──
      q('.riff-steps-inc').addEventListener('click', e => {
        e.stopPropagation();
        if (riff.seqMode === 'orbit') {
          const ring = getOrbitRing();
          if (ring.numSteps < 16) { ring.numSteps++; buildStepGrid(); riff.reschedule(); }
        } else {
          if (riff.numSteps < 64) { riff.numSteps++; buildStepGrid(); riff.reschedule(); }
        }
      });
      q('.riff-steps-dec').addEventListener('click', e => {
        e.stopPropagation();
        if (riff.seqMode === 'orbit') {
          const ring = getOrbitRing();
          if (ring.numSteps > 2) {
            ring.numSteps--;
            if (selectedStep >= ring.numSteps) selectedStep = -1;
            if (entryCursor >= ring.numSteps) entryCursor = 0;
            buildStepGrid(); riff.reschedule();
          }
        } else {
          if (riff.numSteps > 1) {
            riff.numSteps--;
            if (selectedStep >= riff.numSteps) selectedStep = -1;
            if (entryCursor >= riff.numSteps) entryCursor = 0;
            buildStepGrid(); riff.reschedule();
          }
        }
      });

      // ── Pattern shift ──
      function shiftPattern(dir) {
        const curSteps = getActiveSteps();
        const n = getActiveNumSteps();
        const notes = curSteps.slice(0, n).map(s => ({ note: s.note, vel: s.vel ?? 1.0, slide: s.slide ?? false, glideMs: s.glideMs ?? 50 }));
        for (let i = 0; i < n; i++) {
          const src = notes[((i - dir) % n + n) % n];
          curSteps[i].note = src.note;
          curSteps[i].vel = src.vel;
          curSteps[i].slide = src.slide;
          curSteps[i].glideMs = src.glideMs;
        }
        buildStepGrid();
        if (isPlaying) riff.reschedule();
      }
      q('.riff-shift-left').addEventListener('click', e => { e.stopPropagation(); shiftPattern(-1); setRiffFocus(riff.id); });
      q('.riff-shift-right').addEventListener('click', e => { e.stopPropagation(); shiftPattern(1); setRiffFocus(riff.id); });

      // ── Grid sync ──
      const gridBtn = q('.riff-grid-btn');
      const subdivSel = q('.riff-subdiv-sel');
      subdivSel.value = riff.subdiv;
      gridBtn.classList.toggle('act', riff.gridSync);
      const rateSlider = q('.riff-rate-slider');
      const rateLbl = q('.riff-rate-lbl');
      const rateInput = q('.riff-rate-input');
      initCslider(rateSlider, v => parseFloat(v).toFixed(2) + 's');

      function updateGridUI() {
        const on = riff.gridSync;
        subdivSel.style.display = on ? '' : 'none';
        rateSlider.style.display = on ? 'none' : '';
        rateLbl.style.display = on ? 'none' : '';
      }
      updateGridUI();

      gridBtn.addEventListener('click', e => {
        e.stopPropagation();
        riff.gridSync = !riff.gridSync;
        gridBtn.classList.toggle('act', riff.gridSync);
        updateGridUI();
        riff.reschedule();
      });
      subdivSel.addEventListener('change', e => {
        e.stopPropagation();
        riff.subdiv = subdivSel.value;
        if (riff.gridSync) riff.reschedule();
      });
      rateInput.addEventListener('input', e => {
        riff.rate = parseFloat(e.target.value);
        if (!riff.gridSync) riff.reschedule();
      });

      // ── Scale controls ──
      function applyScale() {
        const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
        if (riff.seqMode === 'orbit') {
          for (const ring of riff.orbitRings) {
            for (const s of ring.steps) if (s.note) s.note = snapToScale(s.note, riff.scaleRoot, intervals);
          }
        } else {
          for (let i = 0; i < riff.steps.length; i++) {
            if (riff.steps[i].note) riff.steps[i].note = snapToScale(riff.steps[i].note, riff.scaleRoot, intervals);
          }
          for (const n of riff.notes) n.note = snapToScale(n.note, riff.scaleRoot, intervals);
        }
        buildStepGrid();
        if (isPlaying) riff.reschedule();
        // Update keyboard highlight using effective (transposed) root
        const kbdEl = el.querySelector('.synth-keyboard');
        applyScaleToKeyboard(kbdEl, transposeRoot(riff.scaleRoot, globalTranspose), intervals);
      }
      q('.riff-root-sel').addEventListener('change', e => {
        // Dropdown always shows the effective (transposed) root; back-compute base root
        riff.scaleRoot = transposeRoot(e.target.value, -globalTranspose);
        e.target.value = transposeRoot(riff.scaleRoot, globalTranspose); // keep showing effective root
        applyScale();
      });
      q('.riff-scale-sel').addEventListener('change', e => { riff.scale = e.target.value; applyScale(); });

      // ── Transform controls ──
      function shiftOctaveActive(delta) {
        if (riff.seqMode === 'orbit') {
          const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
          const ring = getOrbitRing();
          for (const s of ring.steps.slice(0, ring.numSteps)) {
            if (!s.note) continue;
            const m = s.note.match(/^([A-G]#?)(\d+)$/);
            if (!m) continue;
            const newOct = parseInt(m[2]) + delta;
            if (newOct >= 0 && newOct <= 9) s.note = m[1] + newOct;
          }
        } else { riffShiftOctave(riff, delta); }
      }
      function transposeActive(delta) {
        if (riff.seqMode === 'orbit') {
          const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
          const isChromatic = intervals.length === 12;
          const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
          const rootPC = NM[riff.scaleRoot] ?? 0; const dir = delta >= 0 ? 1 : -1;
          const ring = getOrbitRing();
          for (const s of ring.steps.slice(0, ring.numSteps)) {
            if (!s.note) continue;
            const target = Math.max(12, Math.min(119, noteToSemis(s.note) + delta));
            if (isChromatic) { s.note = midiToNoteName(target); continue; }
            for (let d = 0; d <= 12; d++) {
              const cand = target + d * dir;
              if (cand < 12 || cand > 119) break;
              if (intervals.includes(((cand % 12) - rootPC % 12 + 12) % 12)) { s.note = midiToNoteName(cand); break; }
            }
          }
        } else { riffTranspose(riff, delta); }
      }
      q('.riff-oct-dn').addEventListener('click', e => {
        e.stopPropagation(); shiftOctaveActive(-1); buildStepGrid(); riff.reschedule();
      });
      q('.riff-oct-up').addEventListener('click', e => {
        e.stopPropagation(); shiftOctaveActive(1); buildStepGrid(); riff.reschedule();
      });
      q('.riff-trans-dn').addEventListener('click', e => {
        e.stopPropagation(); transposeActive(-1); buildStepGrid(); riff.reschedule();
      });
      q('.riff-trans-up').addEventListener('click', e => {
        e.stopPropagation(); transposeActive(1); buildStepGrid(); riff.reschedule();
      });
      q('.riff-harm-sel').value = riff.harmony;
      q('.riff-harm-sel').addEventListener('change', e => {
        e.stopPropagation();
        riff.harmony = parseInt(e.target.value);
      });

      // ── Piano keyboard ──
      // _snapMap: tracks original note → snapped note so noteOff releases the right pitch
      const _snapMap = new Map();
      const kbdProxy = {
        color: riff.color,
        _noteHighlight: () => {},
        // Returns the snapped version of a note under the current scale (used by QWERTY handler)
        snapNote: (note) => {
          const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
          return snapToScale(note, riff.scaleRoot, intervals);
        },
        noteOn: (note) => {
          setRiffFocus(riff.id);
          const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
          const snapped = snapToScale(note, riff.scaleRoot, intervals);
          _snapMap.set(note, snapped); // remember snap so noteOff can release correctly
          if (riff.recording) riff.recordNoteOn(snapped);
          if (stepEntryActive) {
            assignNoteToStep(entryCursor, snapped);
            advanceEntry();
          } else if (patternRecActive && isPlaying) {
            const subdivSec = riff.gridSync
              ? Tone.Time(riff.subdiv).toSeconds()
              : riff.rate;
            const step = Math.floor(Tone.Transport.seconds / subdivSec) % getActiveNumSteps();
            assignNoteToStep(step, snapped);
          } else if (selectedStep >= 0) {
            assignNoteToStep(selectedStep, snapped);
            const next = (selectedStep + 1) % getActiveNumSteps();
            q(`.riff-step[data-idx="${selectedStep}"]`)?.classList.remove('selected');
            selectedStep = next;
            q(`.riff-step[data-idx="${next}"]`)?.classList.add('selected');
          }
          for (const instrId of riff.destinations) {
            const instr = getInstrument(instrId);
            if (!instr || instr.muted) continue;
            if (instr instanceof SynthInstrument) instr.noteOn(snapped, 100);
            else if (instr instanceof Sample) {
              instr.triggerAtTime(Tone.now(), 0.5, 1.0, noteToSemis(snapped) - noteToSemis('C4'));
            }
          }
        },
        noteOff: (note) => {
          // Use the snapped note that was actually triggered — prevents stuck notes
          const snapped = _snapMap.get(note) ?? note;
          _snapMap.delete(note);
          if (riff.recording) riff.recordNoteOff(snapped);
          for (const instrId of riff.destinations) {
            const instr = getInstrument(instrId);
            if (instr instanceof SynthInstrument) instr.noteOff(snapped);
          }
        }
      };
      requestAnimationFrame(() => {
        buildPianoKeyboard(q(`#riff-kbd-${riff.id}`), kbdProxy);
        requestAnimationFrame(() => applyScale());
      });
      riffKbdProxies.set(riff.id, kbdProxy);

      // ── Port strips (rebuild per mode / ring count) ──
      function rebuildPortStrips() {
        const rightStrip = q('.riff-port-strip-right');
        const leftStrip  = q('.riff-port-strip-left');
        rightStrip.innerHTML = ''; leftStrip.innerHTML = '';
        const n = riff.seqMode === 'orbit' ? riff.orbitNumRings : 1;
        for (let i = 0; i < n; i++) {
          const ringIdx = riff.seqMode === 'orbit' ? i : null;
          const label   = ringIdx !== null ? `Ring ${i + 1} — drag to connect` : 'Drag to connect to a synth or sampler';
          [rightStrip, leftStrip].forEach(strip => {
            const port = document.createElement('div');
            port.className = 'riff-wire-port';
            if (ringIdx !== null) port.dataset.ring = ringIdx;
            port.title = label;
            port.addEventListener('mousedown', e => {
              e.stopPropagation(); e.preventDefault();
              startRiffWireDrag(riff, e, port, ringIdx);
            });
            strip.appendChild(port);
          });
        }
      }
      rebuildPortStrips();

      // ── Dest list ──
      function updateDestList() {
        const list = q('.riff-dest-list');
        list.innerHTML = '';
        if (riff.seqMode === 'orbit') {
          for (let ri = 0; ri < riff.orbitNumRings; ri++) {
            const sec = document.createElement('div');
            sec.className = 'riff-dest-ring-sec';
            const lbl = document.createElement('span');
            lbl.className = 'riff-dest-ring-lbl'; lbl.textContent = `R${ri + 1}`;
            sec.appendChild(lbl);
            for (const instrId of (riff.orbitDestinations[ri] || [])) {
              const instr = getInstrument(instrId);
              if (!instr) continue;
              const item = document.createElement('div');
              item.className = 'riff-dest-item';
              item.innerHTML = `<span class="riff-dest-name">${(instr.name||'').substring(0,14)}</span><button class="riff-dest-unlink" title="Disconnect">✕</button>`;
              item.querySelector('.riff-dest-unlink').addEventListener('click', e => {
                e.stopPropagation();
                riff.removeOrbitDestination(ri, instrId);
                updateDestList(); updateLfoWires();
              });
              sec.appendChild(item);
            }
            list.appendChild(sec);
          }
        } else {
          for (const instrId of riff.destinations) {
            const instr = getInstrument(instrId);
            if (!instr) continue;
            const item = document.createElement('div');
            item.className = 'riff-dest-item';
            item.innerHTML = `<span class="riff-dest-name">${(instr.name||'').substring(0,14)}</span><button class="riff-dest-unlink" title="Disconnect">✕</button>`;
            item.querySelector('.riff-dest-unlink').addEventListener('click', e => {
              e.stopPropagation();
              riff.removeDestination(instrId);
              updateDestList(); updateLfoWires();
            });
            list.appendChild(item);
          }
        }
      }
      updateDestList();

      // ── Remove / Dup / Min ──
      q('.riff-remove-btn').addEventListener('click', e => { e.stopPropagation(); removeRiff(riff.id); });
      q('.riff-dup-btn').addEventListener('click', e => { e.stopPropagation(); duplicateRiff(riff); });
      q('.riff-min-btn').addEventListener('click', e => { e.stopPropagation(); el.classList.toggle('collapsed'); });

      // ── Titlebar drag ──
      let titleMoved = false;
      q('.riff-titlebar').addEventListener('mousedown', e => {
        if (e.target.closest('button, select')) return;
        e.preventDefault(); e.stopPropagation();
        el.style.zIndex = ++cardZTop; titleMoved = false;
        const ox = e.clientX, oy = e.clientY;
        const oL = parseInt(el.style.left), oT = parseInt(el.style.top);
        el.classList.add('dragging');
        const mm = ev => {
          const dx = ev.clientX - ox, dy = ev.clientY - oy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) titleMoved = true;
          const nl = Math.max(0, Math.min(WORLD_W - el.offsetWidth,  oL + dx));
          const nt = Math.max(0, Math.min(WORLD_H - el.offsetHeight, oT + dy));
          el.style.left = nl + 'px'; el.style.top = nt + 'px';
          riff.x = nl + RIFF_W / 2; riff.y = nt; updateLfoWires();
        };
        const mu = () => { el.classList.remove('dragging'); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      });
      q('.riff-titlebar').addEventListener('click', e => {
        if (!e.target.closest('button, select') && !titleMoved) { e.stopPropagation(); el.classList.toggle('collapsed'); }
      });

      // ── Collapsed drag ──
      let minMoved = false;
      el.addEventListener('mousedown', e => {
        if (!el.classList.contains('collapsed')) return;
        e.preventDefault(); e.stopPropagation();
        el.style.zIndex = ++cardZTop; minMoved = false;
        const ox = e.clientX, oy = e.clientY;
        const oL = parseInt(el.style.left), oT = parseInt(el.style.top);
        el.classList.add('dragging');
        const mm = ev => {
          const dx = ev.clientX - ox, dy = ev.clientY - oy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) minMoved = true;
          const nl = Math.max(0, Math.min(WORLD_W - el.offsetWidth,  oL + dx));
          const nt = Math.max(0, Math.min(WORLD_H - el.offsetHeight, oT + dy));
          el.style.left = nl + 'px'; el.style.top = nt + 'px';
          riff.x = nl + RIFF_W / 2; riff.y = nt; updateLfoWires();
        };
        const mu = () => { el.classList.remove('dragging'); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      });
      el.addEventListener('click', e => { if (el.classList.contains('collapsed') && !minMoved) el.classList.remove('collapsed'); });
      el.addEventListener('mousedown', () => setRiffFocus(riff.id));

      el.style.zIndex = ++cardZTop;
      cv.appendChild(el);
      buildStepGrid();

      const nodeInfo = {
        el,
        updateDestList,
        clearSelectedStep: () => {
          // Used by keydown Delete handler
          if (stepEntryActive && entryCursor >= 0) { clearStep(entryCursor); advanceEntry(); return; }
          if (selectedStep >= 0) clearStep(selectedStep);
        },
        advanceRest: () => {
          if (stepEntryActive) { advanceEntry(); return; }
          if (selectedStep >= 0) {
            clearStep(selectedStep);
            const next = (selectedStep + 1) % getActiveNumSteps();
            q(`.riff-step[data-idx="${selectedStep}"]`)?.classList.remove('selected');
            selectedStep = next;
            q(`.riff-step[data-idx="${next}"]`)?.classList.add('selected');
          }
        },
        setPlayStep: (step) => {
          el.querySelectorAll('.riff-step.playing').forEach(c => c.classList.remove('playing'));
          q(`.riff-step[data-idx="${step}"]`)?.classList.add('playing');
          const prevDot = q('.riff-mini-step.cur');
          if (prevDot) prevDot.classList.remove('cur');
          q(`.riff-mini-step[data-idx="${step}"]`)?.classList.add('cur');
        },
        setOrbitPlayStep: (ringIdx, step) => {
          if (ringIdx === 0) {
            const prevDot = q('.riff-mini-step.cur');
            if (prevDot) prevDot.classList.remove('cur');
            q(`.riff-mini-step[data-idx="${step}"]`)?.classList.add('cur');
          }
          if (ringIdx === activeRing) {
            el.querySelectorAll('.riff-step.playing').forEach(c => c.classList.remove('playing'));
            q(`.riff-step[data-idx="${step}"]`)?.classList.add('playing');
          }
        },
        flashOrbitPort: (ringIdx) => {
          el.querySelectorAll(`.riff-wire-port[data-ring="${ringIdx}"]`).forEach(p => {
            p.classList.add('port-active');
            setTimeout(() => p.classList.remove('port-active'), 90);
          });
        },
        moveSelection: (delta) => {
          const n = getActiveNumSteps();
          const base = stepEntryActive ? entryCursor : selectedStep;
          if (base < 0 && !stepEntryActive) return;
          const next = ((base < 0 ? 0 : base) + delta + n) % n;
          if (stepEntryActive) {
            entryCursor = next; refreshEntryCursor();
          } else {
            if (selectedStep >= 0) q(`.riff-step[data-idx="${selectedStep}"]`)?.classList.remove('selected');
            selectedStep = next;
            q(`.riff-step[data-idx="${next}"]`)?.classList.add('selected');
          }
        },
        transposeSelectedStep: (delta) => {
          const idx = stepEntryActive ? entryCursor : selectedStep;
          const curStep = getActiveSteps()[idx];
          if (idx < 0 || !curStep?.note) return;
          const intervals = RIFF_SCALES[riff.scale] || RIFF_SCALES['Chromatic'];
          const isChromatic = intervals.length === 12;
          const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
          const rootPC = NM[riff.scaleRoot] ?? 0;
          const dir = delta >= 0 ? 1 : -1;
          const target = Math.max(12, Math.min(119, noteToSemis(curStep.note) + delta));
          let result = midiToNoteName(target);
          if (!isChromatic) {
            for (let d = 0; d <= 12; d++) {
              const candidate = target + d * dir;
              if (candidate < 12 || candidate > 119) break;
              const offset = ((candidate % 12) - rootPC % 12 + 12) % 12;
              if (intervals.includes(offset)) { result = midiToNoteName(candidate); break; }
            }
          }
          curStep.note = result;
          const cell = q(`.riff-step[data-idx="${idx}"]`);
          if (cell) cell.querySelector('.riff-step-note').textContent = result;
          riff.reschedule();
        }
      };
      riffNodes.set(riff.id, nodeInfo);

      // ── SeqMode selector ──
      const seqModeSel = q('.riff-seqmode-sel');
      const orbitSection = q('.riff-orbit-section');
      const speedLbl = q('.riff-speed-lbl');
      const speedSel = q('.riff-speed-sel');

      function setSeqMode(mode) {
        riff.seqMode = mode;
        const isOrbit = mode === 'orbit';
        orbitSection.classList.toggle('active', isOrbit);
        el.classList.toggle('orbit-mode', isOrbit);
        speedLbl.style.display = isOrbit ? '' : 'none';
        speedSel.style.display = isOrbit ? '' : 'none';
        selectedStep = -1; entryCursor = 0;
        rebuildPortStrips(); updateDestList(); buildStepGrid();
        if (isOrbit) { updateSpeedSel(); requestAnimationFrame(drawOrbit); }
        riff.reschedule();
      }

      seqModeSel.addEventListener('mousedown', e => e.stopPropagation());
      seqModeSel.addEventListener('click', e => e.stopPropagation());
      seqModeSel.addEventListener('change', e => { e.stopPropagation(); setSeqMode(e.target.value); });

      // ── Orbit ring tabs ──
      function setActiveRing(ri) {
        activeRing = ri;
        el.querySelectorAll('.riff-ring-tab').forEach((t, idx) => {
          t.classList.toggle('act', idx === ri);
        });
        selectedStep = -1; entryCursor = 0;
        buildStepGrid();
        updateSpeedSel();
      }

      function updateSpeedSel() {
        const ring = getOrbitRing();
        const v = ring.speedRatio;
        const opts = [0.25, 1/3, 0.5, 2/3, 1, 1.5, 2, 3, 4];
        let best = '1'; let bestDist = Infinity;
        for (const o of opts) {
          if (Math.abs(o - v) < bestDist) { bestDist = Math.abs(o - v); best = String(o); }
        }
        // Match by stored value string keys
        const optStrings = ['0.25', '0.333', '0.5', '0.667', '1', '1.5', '2', '3', '4'];
        const vals = [0.25, 1/3, 0.5, 2/3, 1, 1.5, 2, 3, 4];
        let bestIdx = 0;
        for (let i = 0; i < vals.length; i++) {
          if (Math.abs(vals[i] - v) < Math.abs(vals[bestIdx] - v)) bestIdx = i;
        }
        speedSel.value = optStrings[bestIdx];
      }

      function updateRingTabs() {
        el.querySelectorAll('.riff-ring-tab').forEach((t, idx) => {
          t.classList.toggle('hidden-ring', idx >= riff.orbitNumRings);
        });
        if (activeRing >= riff.orbitNumRings) setActiveRing(riff.orbitNumRings - 1);
        rebuildPortStrips(); updateDestList();
      }

      el.querySelectorAll('.riff-ring-tab').forEach(tab => {
        tab.addEventListener('click', e => { e.stopPropagation(); setActiveRing(parseInt(tab.dataset.ring)); setRiffFocus(riff.id); });
      });
      q('.riff-ring-add-btn').addEventListener('click', e => {
        e.stopPropagation();
        if (riff.orbitNumRings < 4) { riff.orbitNumRings++; updateRingTabs(); riff.reschedule(); }
      });
      q('.riff-ring-rem-btn').addEventListener('click', e => {
        e.stopPropagation();
        if (riff.orbitNumRings > 1) { riff.orbitNumRings--; updateRingTabs(); riff.reschedule(); }
      });

      speedSel.addEventListener('mousedown', e => e.stopPropagation());
      speedSel.addEventListener('click', e => e.stopPropagation());
      speedSel.addEventListener('change', e => {
        e.stopPropagation();
        getOrbitRing().speedRatio = parseFloat(e.target.value);
        riff.reschedule();
      });

      // Initialise speed display
      if (riff.seqMode === 'orbit') { updateSpeedSel(); speedLbl.style.display = ''; speedSel.style.display = ''; }

      // ── Orbit canvas ──
      const orbitCanvas = q('.riff-orbit-canvas');
      const ORBIT_RADII = [34, 56, 73, 87];

      function getNodePos(ri, si, numSteps) {
        const r = ORBIT_RADII[ri];
        const cx = orbitCanvas.width / 2, cy = orbitCanvas.height / 2;
        const angle = (si / numSteps) * Math.PI * 2 - Math.PI / 2;
        return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      }

      function drawOrbit() {
        if (!el.isConnected || riff.seqMode !== 'orbit') return;
        const ctx = orbitCanvas.getContext('2d');
        const W = orbitCanvas.width, H = orbitCanvas.height;
        const cx = W / 2, cy = H / 2;
        ctx.clearRect(0, 0, W, H);

        for (let ri = 0; ri < riff.orbitNumRings; ri++) {
          const ring = riff.orbitRings[ri];
          const r = ORBIT_RADII[ri];
          const isActive = ri === activeRing;
          const alpha = isActive ? 1.0 : 0.45;

          // Ring circle
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${isActive ? 0.1 : 0.05})`;
          ctx.lineWidth = isActive ? 1.5 : 1;
          ctx.stroke();

          // Playhead line
          const playIdx = riff._orbitStepIdx[ri] ?? 0;
          const playAngle = (playIdx / ring.numSteps) * Math.PI * 2 - Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + (r - 10) * Math.cos(playAngle), cy + (r - 10) * Math.sin(playAngle));
          ctx.strokeStyle = isActive ? riff.color : `rgba(255,255,255,0.2)`;
          ctx.lineWidth = isActive ? 1.5 : 1;
          ctx.stroke();

          // Step nodes
          for (let si = 0; si < ring.numSteps; si++) {
            const pos = getNodePos(ri, si, ring.numSteps);
            const stepData = ring.steps[si];
            const isPlaying = playIdx === si;
            const hasNote = !!stepData?.note;
            const isSelected = isActive && selectedStep === si;
            const isCursor = isActive && stepEntryActive && entryCursor === si;

            const nr = isPlaying ? 7 : hasNote ? 5 : 3;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, nr, 0, Math.PI * 2);
            if (isPlaying) {
              ctx.fillStyle = '#fff';
              ctx.globalAlpha = 1;
              ctx.fill();
            } else if (hasNote) {
              ctx.fillStyle = riff.color;
              ctx.globalAlpha = alpha;
              ctx.fill();
              ctx.globalAlpha = 1;
            } else {
              ctx.strokeStyle = `rgba(255,255,255,${isActive ? 0.25 : 0.12})`;
              ctx.lineWidth = 1;
              ctx.stroke();
            }

            if (isSelected || isCursor) {
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, 9, 0, Math.PI * 2);
              ctx.strokeStyle = isCursor ? '#fff' : riff.color;
              ctx.lineWidth = 2;
              ctx.globalAlpha = 1;
              ctx.stroke();
            }
          }
        }

        // Center dot
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,0.2)`;
        ctx.fill();

        // Draw mini canvas (for collapsed state)
        drawOrbitMini();

        requestAnimationFrame(drawOrbit);
      }

      const orbitMiniCanvas = q('.riff-orbit-mini');
      const MINI_RADII = [5, 9, 12, 15];

      function drawOrbitMini() {
        const mctx = orbitMiniCanvas.getContext('2d');
        const MW = orbitMiniCanvas.width, MH = orbitMiniCanvas.height;
        const mcx = MW / 2, mcy = MH / 2;
        mctx.clearRect(0, 0, MW, MH);
        for (let ri = 0; ri < riff.orbitNumRings; ri++) {
          const ring = riff.orbitRings[ri];
          const mr = MINI_RADII[ri];
          mctx.beginPath();
          mctx.arc(mcx, mcy, mr, 0, Math.PI * 2);
          mctx.strokeStyle = 'rgba(255,255,255,0.13)';
          mctx.lineWidth = 0.8;
          mctx.stroke();
          const playIdx = riff._orbitStepIdx[ri] ?? 0;
          for (let si = 0; si < ring.numSteps; si++) {
            const a = (si / ring.numSteps) * Math.PI * 2 - Math.PI / 2;
            const nx = mcx + mr * Math.cos(a), ny = mcy + mr * Math.sin(a);
            const isPlaying = playIdx === si, hasNote = !!ring.steps[si]?.note;
            mctx.beginPath();
            mctx.arc(nx, ny, isPlaying ? 2.2 : hasNote ? 1.6 : 0.9, 0, Math.PI * 2);
            if (isPlaying) { mctx.fillStyle = '#fff'; mctx.fill(); }
            else if (hasNote) { mctx.fillStyle = riff.color; mctx.globalAlpha = 0.85; mctx.fill(); mctx.globalAlpha = 1; }
            else { mctx.strokeStyle = 'rgba(255,255,255,0.15)'; mctx.lineWidth = 0.5; mctx.stroke(); }
          }
          const pa = (playIdx / ring.numSteps) * Math.PI * 2 - Math.PI / 2;
          mctx.beginPath();
          mctx.moveTo(mcx, mcy);
          mctx.lineTo(mcx + (mr - 2) * Math.cos(pa), mcy + (mr - 2) * Math.sin(pa));
          mctx.strokeStyle = ri === 0 ? riff.color : 'rgba(255,255,255,0.2)';
          mctx.lineWidth = 0.8;
          mctx.stroke();
        }
      }

      if (riff.seqMode === 'orbit') { el.classList.add('orbit-mode'); requestAnimationFrame(drawOrbit); }

      orbitCanvas.addEventListener('click', e => {
        e.stopPropagation();
        const rect = orbitCanvas.getBoundingClientRect();
        const sx = orbitCanvas.width / rect.width, sy = orbitCanvas.height / rect.height;
        const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
        let bestRing = -1, bestStep = -1, bestDist = 14;
        for (let ri = 0; ri < riff.orbitNumRings; ri++) {
          const ring = riff.orbitRings[ri];
          for (let si = 0; si < ring.numSteps; si++) {
            const pos = getNodePos(ri, si, ring.numSteps);
            const dist = Math.hypot(mx - pos.x, my - pos.y);
            if (dist < bestDist) { bestDist = dist; bestRing = ri; bestStep = si; }
          }
        }
        if (bestRing < 0) return;
        if (bestRing !== activeRing) setActiveRing(bestRing);
        if (stepEntryActive) { entryCursor = bestStep; refreshEntryCursor(); }
        else toggleStepSelect(bestStep);
        setRiffFocus(riff.id);
      });

      orbitCanvas.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        const rect = orbitCanvas.getBoundingClientRect();
        const sx = orbitCanvas.width / rect.width, sy = orbitCanvas.height / rect.height;
        const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
        const ring = getOrbitRing();
        for (let si = 0; si < ring.numSteps; si++) {
          const pos = getNodePos(activeRing, si, ring.numSteps);
          if (Math.hypot(mx - pos.x, my - pos.y) < 14) { clearStep(si); return; }
        }
      });

      if (isPlaying) riff.schedule();
      return nodeInfo;
    }

    const riffKbdProxies = new Map(); // riffId → kbdProxy (so QWERTY can call noteOn/Off)

    function setRiffFocus(id) {
      if (_activeRiffId === id) return;
      if (_activeRiffId !== null) {
        const prev = riffNodes.get(_activeRiffId);
        if (prev) prev.el.classList.remove('riff-focused');
      }
      _activeRiffId = id;
      if (id !== null) {
        const cur = riffNodes.get(id);
        if (cur) cur.el.classList.add('riff-focused');
      }
    }

    function removeRiff(id) {
      const riff = riffs.get(id);
      if (!riff) return;
      riff.unschedule();
      const nodeInfo = riffNodes.get(id);
      if (nodeInfo) nodeInfo.el.remove();
      riffNodes.delete(id);
      riffKbdProxies.delete(id);
      riffs.delete(id);
      if (_activeRiffId === id) _activeRiffId = null;
      updateLfoWires();
    }

    function duplicateRiff(src) {
      if (riffs.size >= MAX_RIFFS) return;
      const id = nextRiffId++;
      const riff = new RiffSequencer(id, src.x + 20, src.y + 20);
      riff.mode = src.mode;
      riff.numSteps = src.numSteps;
      riff.steps = src.steps.map(s => ({ ...s }));
      riff.notes = src.notes.map(n => ({ ...n }));
      riff.subdiv = src.subdiv;
      riff.gridSync = src.gridSync;
      riff.rate = src.rate;
      riff.loopBars = src.loopBars;
      riff.quantize = src.quantize;
      riff.seqMode = src.seqMode;
      riff.orbitNumRings = src.orbitNumRings;
      riff.orbitRings = src.orbitRings.map(r => ({
        numSteps: r.numSteps, speedRatio: r.speedRatio,
        steps: r.steps.map(s => ({ ...s }))
      }));
      riff.orbitDestinations = src.orbitDestinations.map(d => [...d]);
      riffs.set(id, riff);
      createRiffNode(riff);
    }

    function startRiffWireDrag(riff, startEvent, portEl, ringIdx) {
      const wiresSvg = document.getElementById('lfo-wires');
      const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.classList.add('riff-wire-temp');
      tempLine.style.stroke = riff.color;
      wiresSvg.appendChild(tempLine);

      const port = portEl || riffNodes.get(riff.id)?.el.querySelector('.riff-wire-port');
      const portRect = port.getBoundingClientRect();
      const sx = portRect.left + portRect.width / 2;
      const sy = portRect.top + portRect.height / 2;

      document.querySelectorAll('.tile').forEach(t => { t.style.outline = '2px dashed rgba(255,255,255,0.3)'; });
      document.querySelectorAll('.sample-card, .synth-card').forEach(c => { c.style.outline = '2px dashed rgba(255,255,255,0.3)'; });

      const mm = ev => { tempLine.setAttribute('d', `M${sx},${sy} L${ev.clientX},${ev.clientY}`); };
      const mu = ev => {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
        tempLine.remove();
        document.querySelectorAll('.tile').forEach(t => { t.style.outline = ''; });
        document.querySelectorAll('.sample-card, .synth-card').forEach(c => { c.style.outline = ''; });

        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!target) return;

        const addConn = (instrId) => {
          if (ringIdx !== null) riff.addOrbitDestination(ringIdx, instrId);
          else riff.addDestination(instrId);
          riffNodes.get(riff.id)?.updateDestList();
          updateLfoWires();
        };

        const card = target.closest('.sample-card, .synth-card');
        if (card) {
          const instrId = findSampleIdFromCard(card);
          if (instrId !== null && (samples.has(instrId) || synths.has(instrId) || drums.has(instrId))) addConn(instrId);
          return;
        }
        const tile = target.closest('.tile');
        if (!tile) return;
        const instrId = parseInt(tile.id.slice(1));
        if (isNaN(instrId) || (!samples.has(instrId) && !synths.has(instrId) && !drums.has(instrId))) return;
        addConn(instrId);
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    }

    // ── Chords node ──
    const CHORDS_NODE_W = 420;
