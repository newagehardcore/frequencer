function startWireDrag(lfo, startEvent, portEl) {
      const wiresSvg = document.getElementById('lfo-wires');
      const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.classList.add('lfo-wire-temp');
      wiresSvg.appendChild(tempLine);

      const port = portEl || lfoNodes.get(lfo.id)?.el.querySelector('.lfo-wire-port');
      const portRect = port.getBoundingClientRect();
      const sx = portRect.left + portRect.width / 2;
      const sy = portRect.top + portRect.height / 2;

      // Highlight potential targets: sample card sliders, synth card sliders
      document.querySelectorAll('.sample-card .cslider, .synth-card .cslider, .sample-card .lfo-slot, .synth-card .lfo-slot').forEach(sl => {
        sl.style.outline = '1px dashed rgba(255,255,255,0.2)';
      });

      const mm = ev => {
        const ex = ev.clientX, ey = ev.clientY;
        const cx1 = sx, cy1 = sy + 30, cx2 = ex, cy2 = ey - 30;
        tempLine.setAttribute('d', `M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${ex},${ey}`);
      };

      const mu = ev => {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
        tempLine.remove();
        // Remove highlights
        document.querySelectorAll('.sample-card .cslider, .synth-card .cslider, .sample-card .lfo-slot, .synth-card .lfo-slot').forEach(sl => { sl.style.outline = ''; });

        // Check if dropped on a target
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!target) return;

        // Check for tile input port or tile — connect to volume
        const tileInPort = target.closest('.tile-in-port');
        const tileEl = tileInPort ? tileInPort.closest('.tile') : target.closest('.tile');
        if (tileEl && !target.closest('.cslider, .lfo-slot')) {
          const instrId = parseInt(tileEl.id.slice(1));
          if (!isNaN(instrId)) {
            const paramClass = samples.has(instrId) ? 'card-vol' : 'synth-vol';
            const pInfo = LFO_PARAM_MAP[paramClass];
            if (pInfo) {
              const existing = isParamModulated(instrId, paramClass, null);
              if (existing) {
                existing.removeDestination(instrId, paramClass, null);
                lfoNodes.get(existing.id)?.updateDestList();
              }
              lfo.addDestination(instrId, paramClass, pInfo.min, pInfo.max, null);
              applyParamOverride(instrId, paramClass, lfo, null);
              lfoNodes.get(lfo.id)?.updateDestList();
              updateLfoWires();
            }
          }
          return;
        }

        const sliderWrap = target.closest('.cslider, .lfo-slot');
        const eqCanvas = target.classList.contains('card-eq-canvas') ? target : target.closest('.card-eq-canvas');
        if (!sliderWrap && !eqCanvas) return;

        const cardEl = (sliderWrap || eqCanvas).closest('.sample-card, .synth-card');
        if (!cardEl) return;

        let paramClass = null;
        if (sliderWrap) {
          const native = sliderWrap.querySelector('input[type=range]');
          if (native) {
            for (const cls of native.classList) {
              if (LFO_PARAM_MAP[cls]) { paramClass = cls; break; }
            }
          }
        }

        // Drop on EQ canvas?
        if (!paramClass && eqCanvas) {
          const rect = eqCanvas.getBoundingClientRect();
          const mx = ev.clientX - rect.left;
          const bandWidth = rect.width / 5;
          const bandIdx = Math.floor(mx / bandWidth);
          const eqParams = ['eq-hp-freq', 'eq-pk1-freq', 'eq-pk2-freq', 'eq-pk3-freq', 'eq-lp-freq'];
          paramClass = eqParams[Math.max(0, Math.min(4, bandIdx))];
        }

        if (!paramClass) return;

        // Determine FX UID if it's an FX or EQ in an FX panel
        const fxPanel = sliderWrap ? sliderWrap.closest('.fx-panel') : target.closest('.fx-panel');
        const fxUid = fxPanel ? parseInt(fxPanel.dataset.fxUid) : null;

        // Find the sample
        const sampleId = findSampleIdFromCard(cardEl);
        if (!sampleId) return;

        // Check not already linked from another LFO
        const existing = isParamModulated(sampleId, paramClass, fxUid);
        if (existing) {
          existing.removeDestination(sampleId, paramClass, fxUid);
          const existNode = lfoNodes.get(existing.id);
          if (existNode) existNode.updateDestList();
        }

        const pInfo = LFO_PARAM_MAP[paramClass];
        lfo.addDestination(sampleId, paramClass, pInfo.min, pInfo.max, fxUid);
        applyParamOverride(sampleId, paramClass, lfo, fxUid);
        lfoNodes.get(lfo.id)?.updateDestList();
        updateLfoWires();
      };

      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    }

    function findSampleIdFromCard(cardEl) {
      for (const [id, info] of openCards) {
        if (info.el === cardEl) return id;
      }
      return null;
    }

    // ── Wire rendering ──
    // SVG is position:fixed at (0,0) so all coordinates are raw viewport coords
    function _wire(svg, cls, color, sx, sy, ex, ey) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.classList.add('lfo-wire-line', cls);
      p.style.stroke = color;
      p.setAttribute('d', `M${sx},${sy} L${ex},${ey}`);
      svg.appendChild(p);
    }

    // Compute tile port center in viewport coords.
    // Reads the actual port element so position updates (card open/close) are reflected.
    function _tilePortVP(tileEl, side = 'left') {
      const port = tileEl.querySelector(side === 'right' ? '.tile-out-port' : '.tile-in-port');
      if (port) {
        const r = port.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      // fallback
      const cvRect = cv.getBoundingClientRect();
      const wx = parseFloat(tileEl.style.left) || 0;
      const wy = parseFloat(tileEl.style.top)  || 0;
      return { x: cvRect.left + wx - cv.scrollLeft, y: cvRect.top + wy - cv.scrollTop + TH / 2 };
    }

    // Choose which port side to use based on relative world positions.
    // Returns { srcSide, tileSide } — 'left' or 'right'.
    function _portSides(srcEl, srcW, tileEl) {
      const srcCx = parseFloat(srcEl.style.left) + srcW / 2;
      const tileCx = parseFloat(tileEl.style.left) + TW / 2;
      return srcCx <= tileCx
        ? { srcSide: 'right', tileSide: 'left' }
        : { srcSide: 'left',  tileSide: 'right' };
    }

    function updateLfoWires() {
      const svg = document.getElementById('lfo-wires');
      svg.querySelectorAll('.lfo-wire-line').forEach(w => w.remove());

      // ── LFO → sample/synth wires ──
      for (const [, lfo] of lfos) {
        const nodeInfo = lfoNodes.get(lfo.id);
        if (!nodeInfo) continue;

        for (const d of lfo.destinations) {
          const tileEl = document.getElementById('t' + d.sampleId);
          if (!tileEl) continue;
          const { srcSide, tileSide } = _portSides(nodeInfo.el, LFO_W, tileEl);
          const portSel = srcSide === 'right' ? '.lfo-wire-port:not(.lfo-wire-port-left)' : '.lfo-wire-port-left';
          const port = nodeInfo.el.querySelector(portSel) || nodeInfo.el.querySelector('.lfo-wire-port');
          const portR = port.getBoundingClientRect();
          const sx = portR.left + portR.width / 2, sy = portR.top + portR.height / 2;
          const { x: ex, y: ey } = _tilePortVP(tileEl, tileSide);
          _wire(svg, 'lfo-wire-line', lfo.color, sx, sy, ex, ey);
        }
      }

      // ── Riff → sample/synth wires ──
      svg.querySelectorAll('.riff-wire-line').forEach(w => w.remove());
      for (const [, riff] of riffs) {
        const nodeInfo = riffNodes.get(riff.id);
        if (!nodeInfo || !riff.destinations.length) continue;
        for (const instrId of riff.destinations) {
          const tileEl = document.getElementById('t' + instrId);
          if (!tileEl) continue;
          const { srcSide, tileSide } = _portSides(nodeInfo.el, RIFF_W, tileEl);
          const portSel = srcSide === 'right' ? '.riff-wire-port:not(.riff-wire-port-left)' : '.riff-wire-port-left';
          const riffPort = nodeInfo.el.querySelector(portSel) || nodeInfo.el.querySelector('.riff-wire-port');
          const riffPR = riffPort.getBoundingClientRect();
          const sx = riffPR.left + riffPR.width / 2, sy = riffPR.top + riffPR.height / 2;
          const { x: ex, y: ey } = _tilePortVP(tileEl, tileSide);
          _wire(svg, 'riff-wire-line', riff.color, sx, sy, ex, ey);
        }
      }

      // ── Chords → sample/synth wires ──
      svg.querySelectorAll('.chords-wire-line').forEach(w => w.remove());
      for (const [, ch] of chords) {
        const nodeInfo = chordsNodes.get(ch.id);
        if (!nodeInfo || !ch.destinations.length) continue;
        for (const instrId of ch.destinations) {
          const tileEl = document.getElementById('t' + instrId);
          if (!tileEl) continue;
          const { srcSide, tileSide } = _portSides(nodeInfo.el, CHORDS_NODE_W, tileEl);
          const portSel = srcSide === 'right' ? '.chords-wire-port:not(.chords-wire-port-left)' : '.chords-wire-port-left';
          const chordsPort = nodeInfo.el.querySelector(portSel) || nodeInfo.el.querySelector('.chords-wire-port');
          const chPR = chordsPort.getBoundingClientRect();
          const csx = chPR.left + chPR.width / 2, csy = chPR.top + chPR.height / 2;
          const { x: ex, y: ey } = _tilePortVP(tileEl, tileSide);
          _wire(svg, 'chords-wire-line', ch.color, csx, csy, ex, ey);
        }
      }
    }

    // ── Apply/remove override styling on a slider ──
    function applyParamOverride(sampleId, paramClass, lfo, fxUid = null) {
      const cardInfo = openCards.get(sampleId);
      if (!cardInfo) return;
      let targetWrap = null;
      const pInfo = LFO_PARAM_MAP[paramClass];

      if (fxUid) {
        const panel = cardInfo.el.querySelector(`.fx-panel[data-fx-uid="${fxUid}"]`);
        if (panel) {
          if (pInfo.isEq) targetWrap = panel.querySelector('.card-eq-canvas');
          else targetWrap = panel.querySelector('.' + paramClass)?.closest('.cslider');
        }
      } else if (pInfo && pInfo.isEq) {
        targetWrap = cardInfo.el.querySelector('.card-eq-canvas');
      } else {
        const slider = cardInfo.el.querySelector('.' + paramClass);
        if (slider) targetWrap = slider.closest('.cslider, .lfo-slot');
      }

      if (!targetWrap) return;
      targetWrap.classList.add('lfo-override');
      targetWrap.style.setProperty('--lfo-color', lfo.color);
      // Add badge if not present and not a canvas
      if (targetWrap.classList.contains('cslider')) {
        const row = targetWrap.closest('.crow');
        if (row && !row.querySelector('.lfo-badge')) {
          const badge = document.createElement('span');
          badge.className = 'lfo-badge';
          badge.textContent = 'LFO';
          badge.style.setProperty('color', lfo.color);
          row.appendChild(badge);
        }
      }
    }

    function unlinkParamOverride(sampleId, paramClass, fxUid = null) {
      const cardInfo = openCards.get(sampleId);
      if (!cardInfo) return;
      let targetWrap = null;
      const pInfo = LFO_PARAM_MAP[paramClass];

      if (fxUid) {
        const panel = cardInfo.el.querySelector(`.fx-panel[data-fx-uid="${fxUid}"]`);
        if (panel) {
          if (pInfo.isEq) targetWrap = panel.querySelector('.card-eq-canvas');
          else targetWrap = panel.querySelector('.' + paramClass)?.closest('.cslider');
        }
      } else if (pInfo && pInfo.isEq) {
        targetWrap = cardInfo.el.querySelector('.card-eq-canvas');
      } else {
        const slider = cardInfo.el.querySelector('.' + paramClass);
        if (slider) targetWrap = slider.closest('.cslider, .lfo-slot');
      }

      if (!targetWrap) return;
      targetWrap.classList.remove('lfo-override');
      targetWrap.style.removeProperty('--lfo-color');
      const row = targetWrap.closest('.crow');
      if (row) {
        const badge = row.querySelector('.lfo-badge');
        if (badge) badge.remove();
      }
    }

    // ── Reapply overrides when a card is opened ──
    function applyCardOverrides(sampleId) {
      for (const [, lfo] of lfos) {
        for (const d of lfo.destinations) {
          if (d.sampleId === sampleId) {
            applyParamOverride(sampleId, d.param, lfo, d.fxUid);
          }
        }
      }
    }

    // ── Modulation tick — call from phLoop ──
    function lfoModulationTick() {
      const now = performance.now() / 1000;
      for (const [, lfo] of lfos) {
        if (isPlaying) lfo.tick(now);
        else lfo._lastTime = now; // keep lastTime fresh so tick doesn't jump on resume

        // Update playhead on the LFO node
        const nodeInfo = lfoNodes.get(lfo.id);
        if (nodeInfo) {
          const ph = nodeInfo.el.querySelector('.lfo-playhead');
          if (ph) {
            if (!isPlaying) { ph.style.display = 'none'; continue; }
            const shapeWrap = nodeInfo.el.querySelector('.lfo-shape-wrap');
            const sw = shapeWrap ? shapeWrap.clientWidth : 200;
            ph.style.left = (lfo._phase * sw) + 'px';
            ph.style.display = '';
          }
        }

        if (!isPlaying) continue;
        const val = lfo.evaluate(lfo._phase);

        // Apply modulation to destinations
        for (const d of lfo.destinations) {
          const s = samples.get(d.sampleId) || synths.get(d.sampleId) || drums.get(d.sampleId);
          if (!s) continue;
          const pInfo = LFO_PARAM_MAP[d.param];
          if (!pInfo) continue;

          const modVal = d.min + val * (d.max - d.min);

          // Drum machine pitch/vol modulation
          if (pInfo.isDrum && s instanceof DrumMachine) {
            s[pInfo.prop][pInfo.subProp] = modVal;
            const cardInfo = openCards.get(d.sampleId);
            if (cardInfo) {
              const slider = cardInfo.el.querySelector('.' + d.param);
              if (slider) slider.value = modVal;
            }
            continue;
          }

          // Synth instrument modulation
          if (pInfo.isSynth && s instanceof SynthInstrument) {
            s[pInfo.prop] = modVal;
            if (pInfo.updater && typeof s[pInfo.updater] === 'function') s[pInfo.updater]();
            const cardInfo = openCards.get(d.sampleId);
            if (cardInfo) {
              const slider = cardInfo.el.querySelector('.' + d.param);
              if (slider) { slider.value = modVal; slider.closest('.cslider')?._syncPos?.(); }
            }
            continue;
          }
          // Allow FX chain modulation on synths too; skip only for sample-specific paths
          if (!(s instanceof Sample) && !d.fxUid) continue;

          // Apply to Sample / FX / EQ
          if (d.fxUid) {
            const inst = s.fxChain.find(i => i.uid === d.fxUid);
            if (inst) {
              if (pInfo.isEq) {
                const band = inst.eqData.bands[pInfo.bandIdx];
                band[pInfo.prop] = modVal;
                inst.eqData.applyBand(pInfo.bandIdx);
              } else {
                inst.params[pInfo.prop] = modVal;
                const targetNode = inst.fxLfoNode || inst.node;
                const nodeParam = targetNode[pInfo.prop];
                if (nodeParam && typeof nodeParam === 'object' && 'value' in nodeParam) {
                  nodeParam.value = modVal;
                } else {
                  targetNode[pInfo.prop] = modVal;
                }
              }
            }
          } else if (pInfo.isEq) {
            const band = s.eqBands[pInfo.bandIdx];
            band[pInfo.prop] = modVal;
            const filter = s.eqFilters[pInfo.bandIdx];
            if (pInfo.prop === 'freq') filter.frequency.value = modVal;
            else if (pInfo.prop === 'gain') filter.gain.value = modVal;
          } else if (pInfo.setter && typeof s[pInfo.setter] === 'function') {
            s[pInfo.setter](modVal);
          } else if (pInfo.prop === '_psSlider') {
            const ratio = modVal < 0.25 ? 1 : Math.pow(200, modVal / 100);
            s.setPsStretch(ratio);
          } else {
            s[pInfo.prop] = modVal;
            if (pInfo.prop === 'attackTime' || pInfo.prop === 'releaseTime' || pInfo.prop === 'crossfadeTime') {
              s._fadedBuf = null; s._psFadedBuf = null;
            }
          }

          // Update open card UI
          const cardInfo = openCards.get(d.sampleId);
          if (cardInfo) {
            let context = cardInfo.el;
            if (d.fxUid) context = cardInfo.el.querySelector(`.fx-panel[data-fx-uid="${d.fxUid}"]`) || cardInfo.el;

            if (pInfo.isEq) {
              const canvas = context.querySelector('.card-eq-canvas');
              if (canvas && canvas._redraw) canvas._redraw();
            } else {
              const slider = context.querySelector('.' + d.param);
              if (slider) {
                slider.value = modVal;
                const wrap = slider.closest('.cslider');
                if (wrap?._syncPos) wrap._syncPos();
              }
            }
          }
        }
      }
    }

    // ── Remove LFO ──
    function duplicateLfo(srcLfo) {
      if (lfos.size >= MAX_LFOS) return null;
      const id = nextLfoId++;
      const lfo = new LFO(id, srcLfo.x + 20, srcLfo.y + 20);
      lfo.rate = srcLfo.rate;
      lfo.gridSync = srcLfo.gridSync;
      lfo.subdiv = srcLfo.subdiv;
      lfo.shape = JSON.parse(JSON.stringify(srcLfo.shape));
      lfo._activePreset = srcLfo._activePreset;
      lfos.set(id, lfo);
      createLfoNode(lfo);
      return lfo;
    }

    function removeLfo(id) {
      const lfo = lfos.get(id);
      if (!lfo) return;
      // Unlink all destinations
      for (const d of [...lfo.destinations]) {
        unlinkParamOverride(d.sampleId, d.param);
      }
      lfo.destinations = [];
      // Remove node
      const nodeInfo = lfoNodes.get(id);
      if (nodeInfo) nodeInfo.el.remove();
      lfoNodes.delete(id);
      lfos.delete(id);
      updateLfoWires();
    }

    // ── Add LFO button ──
    // ── + SAMPLER / + SYNTH / + DRUMS buttons ──
    document.getElementById('btn-add-sampler').addEventListener('click', async () => {
      await ensureAudio();
      document.getElementById('file-input').click();
    });

    document.getElementById('btn-add-synth').addEventListener('click', async () => {
      await ensureAudio();
      const id = nextId++;
      const pos = findFreePosition(300, 520);
      const x = pos.x + TW / 2, y = pos.y + TH / 2;
      const synth = new AnalogSynth(id, 'SYNTH ' + id, x, y);
      synths.set(id, synth);
      const t = createSynthTile(synth);
      openSynthCard(id, t);
    });

    document.getElementById('btn-add-drums').addEventListener('click', async () => {
      await ensureAudio();
      const id = nextId++;
      const pos = findFreePosition(500, 560);
      const x = pos.x + TW / 2, y = pos.y + TH / 2;
      const drum = new DrumMachine(id, 'DRUMS ' + id, x, y);
      drums.set(id, drum);
      const t = createSynthTile(drum);
      if (!isPlaying) playAll(); else drum.startSequencer();
      openSynthCard(id, t);
    });

    // SysEx file loader
    document.getElementById('syx-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      const buf = await file.arrayBuffer();
      const targetId = document.getElementById('syx-input')._targetSynthId;
      const synth = synths.get(targetId);
      if (!(synth instanceof SynthInstrument) || synth.synthType !== 'fm') return;
      if (!synth.loadSysEx(buf)) { alert('Could not parse SysEx file. Expected DX7 32-voice bank (.syx, 4104 bytes).'); return; }
      // Refresh open card's preset list
      const cardInfo = openCards.get(targetId);
      if (cardInfo) _populateSynthTypeBody(synth, cardInfo.el);
    });

    document.getElementById('btn-add-lfo').addEventListener('click', () => {
      const id = nextLfoId++;
      const pos = findFreePosition(LFO_W, 200);
      const lfo = new LFO(id, pos.x + LFO_W / 2, pos.y + 100);
      lfos.set(id, lfo);
      createLfoNode(lfo);
    });

    // ── Add Riff button ──
    document.getElementById('btn-add-riff').addEventListener('click', async () => {
      await ensureAudio();
      if (riffs.size >= MAX_RIFFS) return;
      const id = nextRiffId++;
      const pos = findFreePosition(RIFF_W, 360);
      const riff = new RiffSequencer(id, pos.x + RIFF_W / 2, pos.y + 160);
      riffs.set(id, riff);
      createRiffNode(riff);
      if (!isPlaying) playAll(); else riff.reschedule();
    });

    // ── Add Chords button ──
    document.getElementById('btn-add-chords').addEventListener('click', async () => {
      await ensureAudio();
      const id = nextChordsId++;
      const pos = findFreePosition(CHORDS_NODE_W, 300);
      const ch = new ChordsSequencer(id, pos.x + CHORDS_NODE_W / 2, pos.y + 100);
      chords.set(id, ch);
      createChordsNode(ch);
      initChordsAI();
      if (!isPlaying) playAll(); else ch.schedule();
    });

