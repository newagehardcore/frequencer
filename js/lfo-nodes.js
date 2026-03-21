    // ════════════════════════════════════════════════════
    // LFO NODE CREATION & MANAGEMENT
    // ════════════════════════════════════════════════════

    function createLfoNode(lfo) {
      const el = document.createElement('div');
      el.className = 'lfo-node';
      el.id = 'lfo-' + lfo.id;
      el.style.left = (lfo.x - LFO_W / 2) + 'px';
      el.style.top = (lfo.y - LFO_H_MIN / 2) + 'px';

      el.innerHTML = `
        <div class="lfo-titlebar" title="Click to collapse/expand">
          <div class="lfo-color-dot"></div>
          <div class="lfo-name">${lfo.name}</div>
          <button class="lfo-dup" title="Duplicate">⧉</button>
          <button class="lfo-remove" title="Remove">🗑</button>
          <button class="lfo-min" title="Minimize">✕</button>
        </div>
        <div class="lfo-shape-wrap">
          <canvas class="lfo-shape-canvas"></canvas>
          <div class="lfo-playhead"></div>
        </div>
        <div class="lfo-min-footer">${lfo.name}</div>
        <div class="lfo-preset-row">
          <button class="lfo-preset-btn" data-preset="sine">SIN</button>
          <button class="lfo-preset-btn" data-preset="square">SQR</button>
          <button class="lfo-preset-btn" data-preset="triangle">TRI</button>
          <button class="lfo-preset-btn" data-preset="random">RND</button>
          <button class="lfo-preset-btn" data-preset="blank">BLNK</button>
        </div>
        <div class="lfo-controls">
          <div class="crow">
            <span class="clbl">Rate</span>
            <div class="cslider lfo-rate-slider">
              <input type="range" class="lfo-rate-input" min="0.1" max="30" step="0.1" value="${lfo.rate}">
              <div class="cslider-thumb"><span class="cslider-lbl">${lfo.rate.toFixed(1)}s</span><input class="cslider-edit" type="text"></div>
            </div>
          </div>
        </div>
        <div class="lfo-grid-row">
          <button class="cbtn lfo-grid-btn" style="flex:0 0 auto;padding:4px 8px;font-size:9px">Grid</button>
          <select class="lfo-subdiv-sel">
            <option value="0.25">4 bars</option>
            <option value="0.333">3 bars</option>
            <option value="0.5">2 bars</option>
            <option value="1" selected>1 bar</option>
            <option value="2">1/2</option>
            <option value="4">1/4</option>
            <option value="8">1/8</option>
            <option value="16">1/16</option>
            <option value="32">1/32</option>
          </select>
        </div>
        <div class="lfo-wire-port" title="Drag to connect to a parameter"></div>
        <div class="lfo-dest-list"></div>
      `;

      const q = sel => el.querySelector(sel);
      q('.lfo-color-dot').style.background = lfo.color;
      q('.lfo-playhead').style.background = lfo.color;

      // ── Shape canvas ──
      const shapeCanvas = q('.lfo-shape-canvas');
      const shapeWrap = q('.lfo-shape-wrap');

      function drawShape() {
        const W = shapeCanvas.clientWidth || 200;
        const H = shapeCanvas.clientHeight || 60;
        shapeCanvas.width = W; shapeCanvas.height = H;
        const ctx = shapeCanvas.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

        // Draw grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          const gy = H * i / 4;
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
        }
        for (let i = 1; i < 4; i++) {
          const gx = W * i / 4;
          ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
        }

        // Draw shape
        const pts = lfo.shape;
        if (pts.length >= 2) {
          ctx.strokeStyle = lfo.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pts[0].x * W, (1 - pts[0].y) * H);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x * W, (1 - pts[i].y) * H);
          }
          ctx.stroke();

          // Fill under curve
          ctx.fillStyle = lfo.color + '18';
          ctx.beginPath();
          ctx.moveTo(pts[0].x * W, H);
          for (const p of pts) ctx.lineTo(p.x * W, (1 - p.y) * H);
          ctx.lineTo(pts[pts.length - 1].x * W, H);
          ctx.closePath();
          ctx.fill();
        }

        // Draw breakpoints
        for (const p of pts) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(p.x * W - 2, (1 - p.y) * H - 2, 5, 5);
        }
      }
      requestAnimationFrame(drawShape);

      // ── Breakpoint editing ──
      let _dragBpIdx = -1;
      shapeWrap.addEventListener('mousedown', e => {
        if (el.classList.contains('collapsed')) return;
        e.stopPropagation();
        const rect = shapeCanvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width;
        const my = 1 - (e.clientY - rect.top) / rect.height;

        // Check if clicking near an existing breakpoint
        const pts = lfo.shape;
        let hitIdx = -1;
        for (let i = 0; i < pts.length; i++) {
          const dx = (mx - pts[i].x) * rect.width;
          const dy = (my - pts[i].y) * rect.height;
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { hitIdx = i; break; }
        }

        if (e.shiftKey && hitIdx >= 0) {
          // Shift+click removes a breakpoint (not first/last)
          if (hitIdx > 0 && hitIdx < pts.length - 1) {
            pts.splice(hitIdx, 1);
            lfo._activePreset = null;
            updatePresetButtons();
            drawShape();
          }
          return;
        }

        if (hitIdx >= 0) {
          // Drag existing breakpoint
          _dragBpIdx = hitIdx;
          const mm = ev => {
            const nmx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            const nmy = Math.max(0, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
            // Constrain x: can't go past neighbors
            const prevX = _dragBpIdx > 0 ? pts[_dragBpIdx - 1].x + 0.005 : 0;
            const nextX = _dragBpIdx < pts.length - 1 ? pts[_dragBpIdx + 1].x - 0.005 : 1;
            pts[_dragBpIdx].x = Math.max(prevX, Math.min(nextX, nmx));
            pts[_dragBpIdx].y = nmy;
            lfo._activePreset = null;
            updatePresetButtons();
            drawShape();
          };
          const mu = () => {
            _dragBpIdx = -1;
            document.removeEventListener('mousemove', mm);
            document.removeEventListener('mouseup', mu);
          };
          document.addEventListener('mousemove', mm);
          document.addEventListener('mouseup', mu);
          return;
        }

        // Click on empty space: add a breakpoint
        const newPt = { x: Math.max(0, Math.min(1, mx)), y: Math.max(0, Math.min(1, my)) };
        // Insert sorted by x
        let insertIdx = pts.length;
        for (let i = 0; i < pts.length; i++) {
          if (pts[i].x > newPt.x) { insertIdx = i; break; }
        }
        pts.splice(insertIdx, 0, newPt);
        lfo._activePreset = null;
        updatePresetButtons();
        drawShape();
      });

      // ── Presets ──
      function updatePresetButtons() {
        el.querySelectorAll('.lfo-preset-btn').forEach(btn => {
          btn.classList.toggle('act', btn.dataset.preset === lfo._activePreset);
        });
      }
      el.querySelectorAll('.lfo-preset-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const preset = btn.dataset.preset;
          lfo.shape = LFO_PRESETS[preset]();
          lfo._activePreset = preset;
          updatePresetButtons();
          drawShape();
        });
      });
      updatePresetButtons();

      // ── Rate slider ──
      const rateSlider = q('.lfo-rate-slider');
      const rateInput = q('.lfo-rate-input');
      initCslider(rateSlider, v => parseFloat(v).toFixed(1) + 's');
      rateInput.addEventListener('input', e => {
        lfo.rate = parseFloat(e.target.value);
      });

      // ── Grid sync ──
      const gridBtn = q('.lfo-grid-btn');
      const subdivSel = q('.lfo-subdiv-sel');
      gridBtn.classList.toggle('act', lfo.gridSync);
      subdivSel.value = lfo.subdiv;
      function updateGridUI() {
        const on = lfo.gridSync;
        rateSlider.style.opacity = on ? '0.3' : '1';
        rateSlider.style.pointerEvents = on ? 'none' : 'all';
        subdivSel.style.opacity = on ? '1' : '0.4';
        subdivSel.style.pointerEvents = on ? 'all' : 'none';
      }
      updateGridUI();
      gridBtn.addEventListener('click', e => {
        e.stopPropagation();
        lfo.gridSync = !lfo.gridSync;
        gridBtn.classList.toggle('act', lfo.gridSync);
        updateGridUI();
      });
      subdivSel.addEventListener('change', e => {
        e.stopPropagation();
        lfo.subdiv = parseFloat(e.target.value);
      });

      // ── Wire port drag ──
      q('.lfo-wire-port').addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        startWireDrag(lfo, e);
      });

      // ── Header buttons ──
      q('.lfo-remove').addEventListener('click', e => {
        e.stopPropagation();
        removeLfo(lfo.id);
      });
      q('.lfo-dup').addEventListener('click', e => {
        e.stopPropagation();
        duplicateLfo(lfo);
      });
      q('.lfo-min').addEventListener('click', e => {
        e.stopPropagation();
        el.classList.toggle('collapsed');
      });

      // ── Titlebar drag & Click to collapse ──
      let titleMoved = false;
      q('.lfo-titlebar').addEventListener('mousedown', e => {
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
          const nl = Math.max(0, Math.min(WORLD_W - el.offsetWidth,  oL + dx));
          const nt = Math.max(0, Math.min(WORLD_H - el.offsetHeight, oT + dy));
          el.style.left = nl + 'px'; el.style.top = nt + 'px';
          lfo.x = nl + LFO_W / 2; lfo.y = nt + LFO_H_MIN / 2;
          updateLfoWires();
        };
        const mu = () => {
          el.classList.remove('dragging');
          document.removeEventListener('mousemove', mm);
          document.removeEventListener('mouseup', mu);
        };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
      // Header click to toggle collapse (only if not moved)
      q('.lfo-titlebar').addEventListener('click', e => {
        if (e.target.closest('button')) return;
        if (!titleMoved) {
          e.stopPropagation();
          el.classList.toggle('collapsed');
        }
      });

      // ── Dragging & clicking when collapsed ──
      let minMoved = false;
      el.addEventListener('mousedown', e => {
        if (!el.classList.contains('collapsed')) return;
        e.preventDefault(); e.stopPropagation();
        el.style.zIndex = ++cardZTop;
        minMoved = false;
        const ox = e.clientX, oy = e.clientY;
        const oL = parseInt(el.style.left), oT = parseInt(el.style.top);
        el.classList.add('dragging');
        const mm = ev => {
          const dx = ev.clientX - ox, dy = ev.clientY - oy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) minMoved = true;
          const nl = Math.max(0, Math.min(WORLD_W - el.offsetWidth,  oL + dx));
          const nt = Math.max(0, Math.min(WORLD_H - el.offsetHeight, oT + dy));
          el.style.left = nl + 'px'; el.style.top = nt + 'px';
          lfo.x = nl + 136 / 2;  // use collapsed width for center tracking
          lfo.y = nt + 56 / 2;
          updateLfoWires();
        };
        const mu = () => {
          el.classList.remove('dragging');
          document.removeEventListener('mousemove', mm);
          document.removeEventListener('mouseup', mu);
        };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
      el.addEventListener('click', e => {
        if (!el.classList.contains('collapsed')) return;
        if (!minMoved) el.classList.remove('collapsed');
      });

      // ── Destination list ──
      function updateDestList() {
        const list = q('.lfo-dest-list');
        list.innerHTML = '';
        for (const d of lfo.destinations) {
          const s = samples.get(d.sampleId) || synths.get(d.sampleId) || drums.get(d.sampleId);
          const pInfo = LFO_PARAM_MAP[d.param];
          if (!s || !pInfo) continue;

          let targetLbl = pInfo.label;
          if (d.fxUid) {
            const inst = s.fxChain.find(i => i.uid === d.fxUid);
            if (inst) {
              const fxName = (s.fxCatalog.find(f => f.id === inst.type)?.name || inst.type).toUpperCase().slice(0, 3);
              targetLbl = `${fxName} · ${pInfo.label}`;
            }
          }

          const item = document.createElement('div');
          item.className = 'lfo-dest-item';
          item.innerHTML = `
            <span class="lfo-dest-name" title="${s.name} · ${targetLbl}">${s.name.substring(0, 8)}: ${targetLbl}</span>
            <input class="lfo-dest-field lfo-dest-min" type="text" value="${d.min}" title="Min">
            <input class="lfo-dest-field lfo-dest-max" type="text" value="${d.max}" title="Max">
            <button class="lfo-dest-unlink" title="Unlink">✕</button>
          `;
          const minF = item.querySelector('.lfo-dest-min');
          const maxF = item.querySelector('.lfo-dest-max');
          minF.addEventListener('change', () => {
            const v = parseFloat(minF.value);
            if (!isNaN(v)) d.min = v;
            else minF.value = d.min;
          });
          maxF.addEventListener('change', () => {
            const v = parseFloat(maxF.value);
            if (!isNaN(v)) d.max = v;
            else maxF.value = d.max;
          });
          [minF, maxF].forEach(f => {
            f.addEventListener('mousedown', e => e.stopPropagation());
            f.addEventListener('click', e => e.stopPropagation());
            f.addEventListener('keydown', e => { if (e.key === 'Enter') f.blur(); e.stopPropagation(); });
          });
          item.querySelector('.lfo-dest-unlink').addEventListener('click', e => {
            e.stopPropagation();
            lfo.removeDestination(d.sampleId, d.param, d.fxUid);
            unlinkParamOverride(d.sampleId, d.param, d.fxUid);
            updateDestList();
            updateLfoWires();
          });
          list.appendChild(item);
        }
      }

      el.style.zIndex = ++cardZTop;
      cv.appendChild(el);
      const nodeInfo = { el, drawShape, updateDestList };
      lfoNodes.set(lfo.id, nodeInfo);
      updateLfoWires();
      return nodeInfo;
    }
