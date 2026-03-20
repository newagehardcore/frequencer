    function createChordsNode(chordsInst) {
      const el = document.createElement('div');
      el.className = 'chords-node';
      el.id = 'chords-' + chordsInst.id;
      el.style.left = (chordsInst.x - CHORDS_NODE_W / 2) + 'px';
      el.style.top  = (chordsInst.y - 100) + 'px';
      el.style.setProperty('--chords-color', chordsInst.color);

      // Build select option HTML helpers
      const genreOptions = ['','Rock','Folk','Pop','Soundtrack','R&B/Soul','Country','Jazz','Experimental','Reggae','Hip Hop','Electronic','Metal','Blues','Classical'];
      const decadeOptions = ['','1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s'];
      const scaleOptsHtml = Object.keys(RIFF_SCALES).map(name =>
        `<option value="${name}"${name === chordsInst.scale ? ' selected' : ''}>${name}</option>`
      ).join('');
      const _chEffRoot = transposeRoot(chordsInst.scaleRoot, globalTranspose);
      const rootOptsHtml = RIFF_NOTE_NAMES.map(n =>
        `<option value="${n}"${n === _chEffRoot ? ' selected' : ''}>${n}</option>`
      ).join('');
      const genreOptsHtml = genreOptions.map(g =>
        `<option value="${g}"${g === chordsInst.genre ? ' selected' : ''}>${g || 'Any Genre'}</option>`
      ).join('');
      const decadeOptsHtml = decadeOptions.map(d =>
        `<option value="${d}"${d === chordsInst.decade ? ' selected' : ''}>${d || 'Any Decade'}</option>`
      ).join('');

      el.innerHTML = `
        <div class="chords-titlebar">
          <div class="chords-color-dot"></div>
          <div class="chords-name">${chordsInst.name}</div>
          <button class="chords-hdr-btn chords-dup-btn" title="Duplicate">⧉</button>
          <button class="chords-hdr-btn chords-remove-btn" title="Remove">🗑</button>
          <button class="chords-hdr-btn chords-min-btn" title="Minimize">✕</button>
        </div>
        <div class="chords-mini-grid"></div>
        <div class="chords-min-footer">${chordsInst.name}</div>
        <div class="chords-body">
          <!-- Step grid -->
          <div class="chords-step-row"></div>
          <!-- Controls row: play · grid · subdiv/rate · steps -->
          <div class="chords-row" style="gap:4px;padding-top:4px">
            <button class="riff-step-btn chords-play-btn" style="flex:0 0 auto;padding:4px 10px">&#9654;</button>
            <button class="cbtn chords-grid-btn" style="flex:0 0 auto;padding:4px 8px;font-size:9px">Grid</button>
            <select class="chords-sel chords-subdiv-sel" style="flex:1">
              <option value="1n">1 bar</option>
              <option value="2n">1/2</option>
              <option value="4n">1/4</option>
              <option value="4n.">1/4 .</option>
              <option value="8n">1/8</option>
              <option value="8n.">1/8 .</option>
              <option value="16n">1/16</option>
            </select>
            <div class="chords-rate-row" style="flex:1;display:none">
              <div class="cslider chords-rate-slider">
                <input type="range" class="chords-rate-input" min="0.1" max="4" step="0.05" value="${chordsInst.rate}">
                <div class="cslider-thumb"><span class="cslider-lbl">${chordsInst.rate.toFixed(2)}s</span><input class="cslider-edit" type="text"></div>
              </div>
            </div>
            <div class="chords-steps-ctrl">
              <button class="chords-steps-dec">−</button>
              <span class="chords-steps-val">${chordsInst.numSteps}</span>
              <button class="chords-steps-inc">+</button>
            </div>
          </div>
          <!-- Inline chord suggestions panel -->
          <div class="chords-suggestions"></div>
          <!-- Root / Scale / Transpose row -->
          <div class="chords-row sep" style="gap:3px;flex-wrap:wrap">
            <span class="chords-lbl">Root</span>
            <select class="chords-sel chords-root-sel" style="flex:0 0 auto;width:46px">${rootOptsHtml}</select>
            <select class="chords-sel chords-scale-sel" style="flex:1;min-width:80px">${scaleOptsHtml}</select>
            <span class="chords-lbl" style="margin-left:2px">Oct</span>
            <button class="chords-xfm-btn chords-oct-dn" title="Octave down">▼</button>
            <button class="chords-xfm-btn chords-oct-up" title="Octave up">▲</button>
            <span class="chords-lbl">Semi</span>
            <button class="chords-xfm-btn chords-semi-dn" title="Semitone down">▼</button>
            <button class="chords-xfm-btn chords-semi-up" title="Semitone up">▲</button>
            <span class="chords-transpose-lbl" style="font-size:9px;color:rgba(255,255,255,0.5)">${chordsInst.transposeOffset >= 0 ? '+' : ''}${chordsInst.transposeOffset} st</span>
          </div>
          <!-- Genre / Decade row -->
          <div class="chords-row">
            <span class="chords-lbl">Genre</span>
            <select class="chords-sel chords-genre-sel" style="flex:1">${genreOptsHtml}</select>
            <span class="chords-lbl">Era</span>
            <select class="chords-sel chords-decade-sel" style="flex:0 0 auto;width:72px">${decadeOptsHtml}</select>
          </div>
          <!-- Voicing row -->
          <div class="chords-row sep">
            <span class="chords-lbl">Voicing</span>
            <div class="cslider chords-voicing-slider" style="flex:1">
              <input type="range" class="chords-voicing-input" min="-2" max="2" step="1" value="${chordsInst.voicingMode}">
              <div class="cslider-thumb"><span class="cslider-lbl">${['Drop2','Drop1','Root','Inv1','Inv2'][chordsInst.voicingMode + 2]}</span><input class="cslider-edit" type="text"></div>
            </div>
            <label style="display:flex;align-items:center;gap:4px;font-size:9px;color:rgba(255,255,255,0.5);cursor:pointer;flex-shrink:0">
              <input type="checkbox" class="chords-vl-check" ${chordsInst.voiceLeading ? 'checked' : ''} style="cursor:pointer">
              VL
            </label>
          </div>
          <!-- Playback row -->
          <div class="chords-row sep">
            <span class="chords-lbl">Play</span>
            <div style="display:flex;gap:3px;flex:1">
              <button class="chords-pm-btn chords-pm-off${chordsInst.playMode==='off'?' act':''}">Off</button>
              <button class="chords-pm-btn chords-pm-strum${chordsInst.playMode==='strum'?' act':''}">Strum</button>
              <button class="chords-pm-btn chords-pm-arp${chordsInst.playMode==='arp'?' act':''}">Arp</button>
            </div>
          </div>
          <!-- Strum controls -->
          <div class="chords-strum-body chords-playback-body" style="display:${chordsInst.playMode==='strum'?'flex':'none'}">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="chords-lbl">Speed</span>
              <div class="cslider chords-strum-speed-slider" style="flex:1">
                <input type="range" class="chords-strum-speed-input" min="3" max="80" step="1" value="${Math.round(chordsInst.strumSpeed*1000)}">
                <div class="cslider-thumb"><span class="cslider-lbl">${Math.round(chordsInst.strumSpeed*1000)}ms</span><input class="cslider-edit" type="text"></div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px">
              <span class="chords-lbl">Dir</span>
              <button class="chords-strum-dir-btn${chordsInst.strumDir==='dn'?' act':''}" data-dir="dn" title="Down (low→high)">↓</button>
              <button class="chords-strum-dir-btn${chordsInst.strumDir==='up'?' act':''}" data-dir="up" title="Up (high→low)">↑</button>
              <button class="chords-strum-dir-btn${chordsInst.strumDir==='ud'?' act':''}" data-dir="ud" title="Down then up">↕</button>
              <button class="chords-strum-dir-btn${chordsInst.strumDir==='rand'?' act':''}" data-dir="rand" title="Random">?</button>
            </div>
          </div>
          <!-- Arp controls -->
          <div class="chords-arp-body chords-playback-body" style="display:${chordsInst.playMode==='arp'?'flex':'none'}">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="chords-lbl">Rate</span>
              <select class="chords-sel chords-arp-rate-sel">
                <option value="32n">1/32</option>
                <option value="16n"${chordsInst.arpRate==='16n'?' selected':''}>1/16</option>
                <option value="8n"${chordsInst.arpRate==='8n'?' selected':''}>1/8</option>
                <option value="8n."${chordsInst.arpRate==='8n.'?' selected':''}>1/8 .</option>
                <option value="8t"${chordsInst.arpRate==='8t'?' selected':''}>1/8 T</option>
                <option value="4n"${chordsInst.arpRate==='4n'?' selected':''}>1/4</option>
                <option value="4n."${chordsInst.arpRate==='4n.'?' selected':''}>1/4 .</option>
                <option value="4t"${chordsInst.arpRate==='4t'?' selected':''}>1/4 T</option>
              </select>
              <span class="chords-lbl">Oct</span>
              ${[1,2,3,4].map(o=>`<button class="chords-arp-oct-btn${chordsInst.arpOctaves===o?' act':''}" data-oct="${o}">${o}</button>`).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="chords-lbl">Mode</span>
              <select class="chords-sel chords-arp-mode-sel" style="flex:1">
                <option value="up"${chordsInst.arpMode==='up'?' selected':''}>Up</option>
                <option value="down"${chordsInst.arpMode==='down'?' selected':''}>Down</option>
                <option value="updown"${chordsInst.arpMode==='updown'?' selected':''}>Up/Down</option>
                <option value="downup"${chordsInst.arpMode==='downup'?' selected':''}>Down/Up</option>
                <option value="random"${chordsInst.arpMode==='random'?' selected':''}>Random</option>
                <option value="order"${chordsInst.arpMode==='order'?' selected':''}>Order</option>
                <option value="thumb-up"${chordsInst.arpMode==='thumb-up'?' selected':''}>Thumb Up</option>
                <option value="thumb-dn"${chordsInst.arpMode==='thumb-dn'?' selected':''}>Thumb Down</option>
              </select>
              <button class="chords-arp-hold-btn cbtn${chordsInst.arpHold?' act':''}">Hold</button>
              <button class="chords-arp-step-btn cbtn${chordsInst.stepArp?' act':''}">Step</button>
            </div>
          </div>
          <!-- Step Arp grid -->
          <div class="chords-sarp-body${chordsInst.stepArp && chordsInst.playMode==='arp' ? ' open' : ''}">
            <div style="display:flex;align-items:center;gap:4px;padding-bottom:2px">
              <span class="chords-lbl" style="flex:1;opacity:0.5">Step Pattern</span>
              <div class="chords-steps-ctrl">
                <button class="sarp-steps-dec">−</button>
                <span class="sarp-steps-val">${chordsInst.stepArpSteps}</span>
                <button class="sarp-steps-inc">+</button>
              </div>
            </div>
            <div class="chords-sarp-grid"></div>
          </div>
          <!-- Wire row -->
          <div class="chords-wire-row sep">
            <div class="chords-wire-port" title="Drag to connect to a synth or sampler"></div>
            <div class="chords-dest-list"></div>
          </div>
        </div>
      `;

      const q = sel => el.querySelector(sel);
      let selectedStep = -1;

      // ── Build step grid ──
      function buildStepRow() {
        const row = q('.chords-step-row');
        row.style.gridTemplateColumns = `repeat(${chordsInst.numSteps}, 1fr)`;
        row.innerHTML = '';
        for (let i = 0; i < chordsInst.numSteps; i++) {
          const sd = chordsInst.steps[i];
          const cell = document.createElement('div');
          cell.className = 'chords-step' + (sd.enabled ? ' enabled' : '');
          if (i === selectedStep) cell.classList.add('selected');
          cell.dataset.idx = i;

          const numSpan = document.createElement('span');
          numSpan.className = 'chords-step-num';
          numSpan.textContent = i + 1;
          cell.appendChild(numSpan);

          const lbl = document.createElement('div');
          lbl.className = 'chords-step-label';
          lbl.textContent = sd.tokenId !== null
            ? (CHORD_VOCAB[sd.tokenId] ? transposeRoot(CHORD_VOCAB[sd.tokenId].root, globalTranspose) + CHORD_VOCAB[sd.tokenId].suffix : '—')
            : '—';
          cell.appendChild(lbl);

          const vel = document.createElement('div');
          vel.className = 'chords-step-vel';
          cell.appendChild(vel);

          // Left click: select step and open inline suggestions
          cell.addEventListener('click', e => {
            e.stopPropagation();
            _activeChordsId = chordsInst.id;
            selectStep(i);
          });

          // Right click: toggle enabled/disabled
          cell.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            sd.enabled = !sd.enabled;
            cell.classList.toggle('enabled', sd.enabled);
            if (!sd.enabled) {
              sd.tokenId = null;
              lbl.textContent = '—';
              if (selectedStep === i) closeSuggestions();
            }
            updateMiniGrid();
          });

          row.appendChild(cell);
        }
      }

      function selectStep(idx) {
        // Deselect previous
        q(`.chords-step[data-idx="${selectedStep}"]`)?.classList.remove('selected');
        selectedStep = idx;
        q(`.chords-step[data-idx="${idx}"]`)?.classList.add('selected');
        openSuggestionsPanel(idx);
      }

      function closeSuggestions() {
        q(`.chords-step[data-idx="${selectedStep}"]`)?.classList.remove('selected');
        selectedStep = -1;
        const panel = q('.chords-suggestions');
        panel.classList.remove('open');
        panel.innerHTML = '';
      }

      function openSuggestionsPanel(stepIdx) {
        const panel = q('.chords-suggestions');
        panel.innerHTML = '';
        panel.classList.add('open');

        // Header
        const hdr = document.createElement('div');
        hdr.className = 'chords-sug-hdr';
        const stepName = chordsInst.steps[stepIdx].tokenId !== null
          ? `Step ${stepIdx + 1} · ${CHORD_VOCAB[chordsInst.steps[stepIdx].tokenId]?.name}`
          : `Step ${stepIdx + 1} · Empty`;
        hdr.innerHTML = `<span>${stepName}</span><span class="chords-sug-hdr-del">DEL to clear</span>`;
        panel.appendChild(hdr);

        // Gather prev enabled tokens for recommendation context
        // Walk backward to find the last assigned chord (not just step-1, so suggestions
        // work correctly for any empty step after an assigned chord)
        let prevTokenId = null;
        for (let i = stepIdx - 1; i >= 0; i--) {
          if (chordsInst.steps[i].tokenId !== null) { prevTokenId = chordsInst.steps[i].tokenId; break; }
        }
        const allPrev = chordsInst.steps.slice(0, stepIdx).map(s => s.tokenId).filter(t => t !== null);
        const recs = getChordsRecommendations(
          stepIdx > 0 ? prevTokenId : null,
          allPrev,
          chordsInst.scaleRoot, chordsInst.scale,
          chordsInst.genre, chordsInst.decade
        );

        const currentTokenId = chordsInst.steps[stepIdx].tokenId;
        for (const {token, score} of recs) {
          const item = document.createElement('div');
          item.className = 'chords-pick-item' + (token.id === currentTokenId ? ' active-chord' : '');
          item.innerHTML = `
            <span class="chords-pick-name">${token.name}</span>
            <div class="chords-pick-bar-wrap"><div class="chords-pick-bar" style="width:${Math.round(score * 100)}%"></div></div>
            <button class="chords-pick-play" title="Preview">&#9654;</button>
          `;
          item.querySelector('.chords-pick-play').addEventListener('click', e => {
            e.stopPropagation();
            playChordPreview(token.id, chordsInst);
          });
          item.addEventListener('click', e => {
            if (e.target.closest('.chords-pick-play')) return;
            chordsInst.steps[stepIdx].tokenId = token.id;
            chordsInst.steps[stepIdx].enabled = true;
            // Update step cell
            const cell = q(`.chords-step[data-idx="${stepIdx}"]`);
            if (cell) {
              cell.querySelector('.chords-step-label').textContent = transposeRoot(token.root, globalTranspose) + token.suffix;
              cell.classList.add('enabled');
            }
            updateMiniGrid();
            // Refresh the panel with updated selection + updated recs for adjacent steps
            openSuggestionsPanel(stepIdx);
          });
          panel.appendChild(item);
        }
      }

      function clearSelectedStep() {
        if (selectedStep < 0) return;
        const sd = chordsInst.steps[selectedStep];
        sd.tokenId = null;
        const cell = q(`.chords-step[data-idx="${selectedStep}"]`);
        if (cell) cell.querySelector('.chords-step-label').textContent = '—';
        updateMiniGrid();
        openSuggestionsPanel(selectedStep); // refresh panel header
      }

      function updateMiniGrid() {
        const mini = q('.chords-mini-grid');
        mini.innerHTML = '';
        for (let i = 0; i < chordsInst.numSteps; i++) {
          const sd = chordsInst.steps[i];
          const cell = document.createElement('div');
          cell.className = 'chords-mini-step' + (sd.enabled ? ' enabled' : '');
          cell.dataset.idx = i;
          cell.textContent = sd.tokenId !== null ? (CHORD_VOCAB[sd.tokenId]?.name || '') : '';
          mini.appendChild(cell);
        }
      }

      // setPlayStep - called by ChordsSequencer.schedule
      function setPlayStep(step) {
        el.querySelectorAll('.chords-step.playing').forEach(c => c.classList.remove('playing'));
        q(`.chords-step[data-idx="${step}"]`)?.classList.add('playing');
        el.querySelectorAll('.chords-mini-step.playing').forEach(c => c.classList.remove('playing'));
        q(`.chords-mini-step[data-idx="${step}"]`)?.classList.add('playing');
      }

      function updateDestList() {
        const list = q('.chords-dest-list');
        list.innerHTML = '';
        for (const instrId of chordsInst.destinations) {
          const instr = getInstrument(instrId);
          if (!instr) continue;
          const item = document.createElement('div');
          item.className = 'chords-dest-item';
          item.innerHTML = `<span class="chords-dest-name">${(instr.name||'').substring(0,14)}</span><button class="chords-dest-unlink" title="Disconnect">✕</button>`;
          item.querySelector('.chords-dest-unlink').addEventListener('click', e => {
            e.stopPropagation();
            chordsInst.removeDestination(instrId);
            updateDestList();
            updateLfoWires();
          });
          list.appendChild(item);
        }
      }

      // ── Controls ──
      // Play/stop button
      q('.chords-play-btn').addEventListener('click', e => {
        e.stopPropagation();
        if (chordsInst._scheduleId !== null) {
          chordsInst.unschedule();
          q('.chords-play-btn').innerHTML = '&#9654;';
        } else {
          chordsInst.schedule();
          q('.chords-play-btn').innerHTML = '&#9646;&#9646;';
        }
      });

      // Steps +/-
      q('.chords-steps-dec').addEventListener('click', e => {
        e.stopPropagation();
        if (chordsInst.numSteps > 1) {
          chordsInst.numSteps--;
          q('.chords-steps-val').textContent = chordsInst.numSteps;
          buildStepRow(); updateMiniGrid();
        }
      });
      q('.chords-steps-inc').addEventListener('click', e => {
        e.stopPropagation();
        if (chordsInst.numSteps < 16) {
          chordsInst.numSteps++;
          q('.chords-steps-val').textContent = chordsInst.numSteps;
          buildStepRow(); updateMiniGrid();
        }
      });

      // Grid sync
      const gridBtn = q('.chords-grid-btn');
      function applyGridMode() {
        gridBtn.classList.toggle('act', chordsInst.gridSync);
        q('.chords-subdiv-sel').style.display = chordsInst.gridSync ? '' : 'none';
        q('.chords-rate-row').style.display = chordsInst.gridSync ? 'none' : 'flex';
      }
      q('.chords-subdiv-sel').value = chordsInst.subdiv;
      gridBtn.addEventListener('click', e => {
        e.stopPropagation();
        chordsInst.gridSync = !chordsInst.gridSync;
        applyGridMode(); chordsInst.reschedule();
      });
      q('.chords-subdiv-sel').addEventListener('change', e => {
        e.stopPropagation(); chordsInst.subdiv = e.target.value; chordsInst.reschedule();
      });
      q('.chords-rate-input').addEventListener('input', e => {
        chordsInst.rate = parseFloat(e.target.value);
        chordsInst.reschedule();
      });
      applyGridMode();

      // Voicing slider — must use initCslider so the thumb tracks
      const VOICING_NAMES = ['Drop2','Drop1','Root','Inv1','Inv2'];
      initCslider(q('.chords-voicing-slider'), v => VOICING_NAMES[parseInt(v) + 2] || 'Root');
      q('.chords-voicing-input').addEventListener('input', e => {
        chordsInst.voicingMode = parseInt(e.target.value);
      });

      // Transpose buttons
      q('.chords-oct-dn').addEventListener('click', e => {
        e.stopPropagation();
        chordsInst.transposeOffset -= 12;
        q('.chords-transpose-lbl').textContent = (chordsInst.transposeOffset >= 0 ? '+' : '') + chordsInst.transposeOffset + ' st';
      });
      q('.chords-oct-up').addEventListener('click', e => {
        e.stopPropagation();
        chordsInst.transposeOffset += 12;
        q('.chords-transpose-lbl').textContent = (chordsInst.transposeOffset >= 0 ? '+' : '') + chordsInst.transposeOffset + ' st';
      });
      q('.chords-semi-dn').addEventListener('click', e => {
        e.stopPropagation();
        chordsTransposeSemi(chordsInst, -1);
        q('.chords-transpose-lbl').textContent = (chordsInst.transposeOffset >= 0 ? '+' : '') + chordsInst.transposeOffset + ' st';
      });
      q('.chords-semi-up').addEventListener('click', e => {
        e.stopPropagation();
        chordsTransposeSemi(chordsInst, 1);
        q('.chords-transpose-lbl').textContent = (chordsInst.transposeOffset >= 0 ? '+' : '') + chordsInst.transposeOffset + ' st';
      });

      // Play mode buttons
      const updatePlayMode = (mode) => {
        chordsInst.playMode = mode;
        q('.chords-pm-off').classList.toggle('act', mode === 'off');
        q('.chords-pm-strum').classList.toggle('act', mode === 'strum');
        q('.chords-pm-arp').classList.toggle('act', mode === 'arp');
        q('.chords-strum-body').style.display = mode === 'strum' ? 'flex' : 'none';
        q('.chords-arp-body').style.display   = mode === 'arp'   ? 'flex' : 'none';
        q('.chords-sarp-body').classList.toggle('open', mode === 'arp' && chordsInst.stepArp);
        chordsInst.reschedule();
      };
      q('.chords-pm-off').addEventListener('click',   e => { e.stopPropagation(); updatePlayMode('off'); });
      q('.chords-pm-strum').addEventListener('click', e => { e.stopPropagation(); updatePlayMode('strum'); });
      q('.chords-pm-arp').addEventListener('click',   e => { e.stopPropagation(); updatePlayMode('arp'); });

      // Strum controls
      initCslider(q('.chords-strum-speed-slider'), v => parseInt(v) + 'ms');
      q('.chords-strum-speed-input').addEventListener('input', e => {
        chordsInst.strumSpeed = parseInt(e.target.value) / 1000;
      });
      q('.chords-strum-body').querySelectorAll('.chords-strum-dir-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          chordsInst.strumDir = btn.dataset.dir;
          q('.chords-strum-body').querySelectorAll('.chords-strum-dir-btn').forEach(b => b.classList.toggle('act', b === btn));
        });
      });

      // Arp controls
      q('.chords-arp-rate-sel').addEventListener('change', e => {
        e.stopPropagation(); chordsInst.arpRate = e.target.value; chordsInst.reschedule();
      });
      q('.chords-arp-mode-sel').addEventListener('change', e => {
        e.stopPropagation(); chordsInst.arpMode = e.target.value;
        if (chordsInst.playMode === 'arp') {
          chordsInst._arpNotes = buildArpSequence(chordsInst._arpNotes.length ? chordsInst._arpNotes : [], chordsInst.arpMode, chordsInst.arpOctaves);
          chordsInst._arpIdx = 0;
        }
      });
      q('.chords-arp-body').querySelectorAll('.chords-arp-oct-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          chordsInst.arpOctaves = parseInt(btn.dataset.oct);
          q('.chords-arp-body').querySelectorAll('.chords-arp-oct-btn').forEach(b => b.classList.toggle('act', b === btn));
          if (chordsInst.playMode === 'arp') chordsInst.reschedule();
        });
      });
      q('.chords-arp-hold-btn').addEventListener('click', e => {
        e.stopPropagation();
        chordsInst.arpHold = !chordsInst.arpHold;
        q('.chords-arp-hold-btn').classList.toggle('act', chordsInst.arpHold);
      });

      // Step Arp
      const SARP_ROWS = 6;
      function buildSarpGrid() {
        const grid = q('.chords-sarp-grid');
        grid.innerHTML = '';
        for (let col = 0; col < chordsInst.stepArpSteps; col++) {
          if (!chordsInst.stepArpPattern[col]) chordsInst.stepArpPattern[col] = Array(SARP_ROWS).fill(false);
          const colEl = document.createElement('div');
          colEl.className = 'sarp-col';
          colEl.dataset.col = col;
          // Render rows top=high note, bottom=low note
          for (let row = SARP_ROWS - 1; row >= 0; row--) {
            const cell = document.createElement('div');
            cell.className = 'sarp-cell' + (chordsInst.stepArpPattern[col][row] ? ' on' : '');
            cell.dataset.col = col; cell.dataset.row = row;
            cell.addEventListener('click', e => {
              e.stopPropagation();
              const c = parseInt(cell.dataset.col), r = parseInt(cell.dataset.row);
              chordsInst.stepArpPattern[c][r] = !chordsInst.stepArpPattern[c][r];
              cell.classList.toggle('on', chordsInst.stepArpPattern[c][r]);
            });
            colEl.appendChild(cell);
          }
          grid.appendChild(colEl);
        }
        q('.sarp-steps-val').textContent = chordsInst.stepArpSteps;
      }
      buildSarpGrid();

      q('.chords-arp-step-btn').addEventListener('click', e => {
        e.stopPropagation();
        chordsInst.stepArp = !chordsInst.stepArp;
        q('.chords-arp-step-btn').classList.toggle('act', chordsInst.stepArp);
        q('.chords-sarp-body').classList.toggle('open', chordsInst.stepArp && chordsInst.playMode === 'arp');
        chordsInst.reschedule();
      });

      q('.sarp-steps-dec').addEventListener('click', e => {
        e.stopPropagation();
        if (chordsInst.stepArpSteps > 1) {
          chordsInst.stepArpSteps--;
          chordsInst.stepArpPattern.length = chordsInst.stepArpSteps;
          buildSarpGrid(); if (chordsInst.playMode === 'arp' && chordsInst.stepArp) chordsInst.reschedule();
        }
      });
      q('.sarp-steps-inc').addEventListener('click', e => {
        e.stopPropagation();
        if (chordsInst.stepArpSteps < 16) {
          chordsInst.stepArpSteps++;
          if (!chordsInst.stepArpPattern[chordsInst.stepArpSteps - 1])
            chordsInst.stepArpPattern[chordsInst.stepArpSteps - 1] = Array(SARP_ROWS).fill(false);
          buildSarpGrid(); if (chordsInst.playMode === 'arp' && chordsInst.stepArp) chordsInst.reschedule();
        }
      });

      // Rate slider
      initCslider(q('.chords-rate-slider'), v => parseFloat(v).toFixed(2) + 's');

      // Voice leading checkbox
      q('.chords-vl-check').addEventListener('change', e => {
        chordsInst.voiceLeading = e.target.checked;
      });

      // Genre / Decade — refresh suggestions if a step is selected
      q('.chords-genre-sel').addEventListener('change', e => {
        e.stopPropagation(); chordsInst.genre = e.target.value;
        if (selectedStep >= 0) openSuggestionsPanel(selectedStep);
      });
      q('.chords-decade-sel').addEventListener('change', e => {
        e.stopPropagation(); chordsInst.decade = e.target.value;
        if (selectedStep >= 0) openSuggestionsPanel(selectedStep);
      });

      // Scale/root — also refresh suggestions
      q('.chords-root-sel').addEventListener('change', e => {
        e.stopPropagation();
        chordsInst.scaleRoot = transposeRoot(e.target.value, -globalTranspose);
        e.target.value = transposeRoot(chordsInst.scaleRoot, globalTranspose);
        if (selectedStep >= 0) openSuggestionsPanel(selectedStep);
      });
      q('.chords-scale-sel').addEventListener('change', e => {
        e.stopPropagation(); chordsInst.scale = e.target.value;
        if (selectedStep >= 0) openSuggestionsPanel(selectedStep);
      });

      // Wire port drag
      q('.chords-wire-port').addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        startChordsWireDrag(chordsInst, e, e.currentTarget);
      });

      // Dup / Remove / Min
      q('.chords-dup-btn').addEventListener('click', e => { e.stopPropagation(); duplicateChords(chordsInst); });
      q('.chords-remove-btn').addEventListener('click', e => { e.stopPropagation(); removeChords(chordsInst.id); });
      q('.chords-min-btn').addEventListener('click', e => { e.stopPropagation(); el.classList.toggle('collapsed'); });

      // Titlebar drag
      let titleMoved = false;
      q('.chords-titlebar').addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        e.preventDefault(); e.stopPropagation();
        el.style.zIndex = ++cardZTop;
        titleMoved = false;
        const ox = e.clientX, oy = e.clientY;
        const oL = parseInt(el.style.left), oT = parseInt(el.style.top);
        el.classList.add('dragging');
        const mm = ev => {
          const dx = ev.clientX - ox, dy = ev.clientY - oy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) titleMoved = true;
          el.style.left = (oL + dx) + 'px'; el.style.top = (oT + dy) + 'px';
          chordsInst.x = oL + dx + CHORDS_NODE_W / 2; chordsInst.y = oT + dy;
          updateLfoWires();
        };
        const mu = () => { el.classList.remove('dragging'); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
      q('.chords-titlebar').addEventListener('click', e => {
        if (!e.target.closest('button') && !titleMoved) el.classList.toggle('collapsed');
      });

      // Collapsed drag
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
          el.style.left = (oL + dx) + 'px'; el.style.top = (oT + dy) + 'px';
          chordsInst.x = oL + dx + CHORDS_NODE_W / 2; chordsInst.y = oT + dy;
        };
        const mu = () => { el.classList.remove('dragging'); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      });
      el.addEventListener('click', e => { if (el.classList.contains('collapsed') && !minMoved) el.classList.remove('collapsed'); });

      // Clicking anywhere on node sets this as active chords node
      el.addEventListener('mousedown', () => { _activeChordsId = chordsInst.id; }, true);

      el.style.zIndex = ++cardZTop;
      cv.appendChild(el);
      buildStepRow();
      updateMiniGrid();
      updateDestList();

      function updateStepArpPlayhead(col) {
        el.querySelectorAll('.sarp-col').forEach((c, i) => c.classList.toggle('playing', i === col));
      }
      const nodeInfo = { el, setPlayStep, updateDestList, clearSelectedStep, updateStepArpPlayhead };
      chordsNodes.set(chordsInst.id, nodeInfo);
      updateLfoWires();
      return nodeInfo;
    }

    function removeChords(id) {
      const ch = chords.get(id);
      if (ch) ch.unschedule();
      chordsNodes.get(id)?.el.remove();
      chordsNodes.delete(id);
      chords.delete(id);
      updateLfoWires();
    }

    function duplicateChords(src) {
      const id = nextChordsId++;
      const ch = new ChordsSequencer(id, src.x + 20, src.y + 20);
      ch.numSteps = src.numSteps;
      ch.steps = src.steps.map(s => ({ ...s }));
      ch.subdiv = src.subdiv;
      ch.gridSync = src.gridSync;
      ch.rate = src.rate;
      ch.voicingMode = src.voicingMode;
      ch.transposeOffset = src.transposeOffset;
      ch.voiceLeading = src.voiceLeading;
      ch.playMode = src.playMode;
      ch.strumSpeed = src.strumSpeed;
      ch.strumDir = src.strumDir;
      ch.arpMode = src.arpMode;
      ch.arpRate = src.arpRate;
      ch.arpOctaves = src.arpOctaves;
      ch.arpHold = src.arpHold;
      ch.stepArp = src.stepArp;
      ch.stepArpSteps = src.stepArpSteps;
      ch.stepArpPattern = src.stepArpPattern.map(col => [...col]);
      ch.scaleRoot = src.scaleRoot;
      ch.scale = src.scale;
      ch.genre = src.genre;
      ch.decade = src.decade;
      chords.set(id, ch);
      createChordsNode(ch);
      if (isPlaying) ch.schedule();
    }

    function startChordsWireDrag(chordsInst, startEvent, portEl) {
      const wiresSvg = document.getElementById('lfo-wires');
      const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.classList.add('riff-wire-temp');
      tempLine.style.stroke = chordsInst.color || '#00cccc';
      wiresSvg.appendChild(tempLine);

      const port = portEl || startEvent.target;
      const portRect = port.getBoundingClientRect();
      const sx = portRect.left + portRect.width / 2;
      const sy = portRect.top + portRect.height / 2;
      tempLine.setAttribute('d', `M${sx},${sy} L${startEvent.clientX},${startEvent.clientY}`);

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
        const card = target.closest('.sample-card, .synth-card');
        if (card) {
          const instrId = findSampleIdFromCard(card);
          if (instrId !== null && (samples.has(instrId) || synths.has(instrId))) {
            chordsInst.addDestination(instrId);
            chordsNodes.get(chordsInst.id)?.updateDestList();
            updateLfoWires();
          }
          return;
        }
        const tile = target.closest('.tile');
        if (!tile) return;
        const instrId = parseInt(tile.id.slice(1));
        if (isNaN(instrId) || (!samples.has(instrId) && !synths.has(instrId))) return;
        chordsInst.addDestination(instrId);
        chordsNodes.get(chordsInst.id)?.updateDestList();
        updateLfoWires();
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    }

    // ── Wire drag system ──
