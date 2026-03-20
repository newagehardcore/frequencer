    function startWireDrag(lfo, startEvent) {
      const wiresSvg = document.getElementById('lfo-wires');
      const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.classList.add('lfo-wire-temp');
      wiresSvg.appendChild(tempLine);

      const port = lfoNodes.get(lfo.id)?.el.querySelector('.lfo-wire-port');
      const portRect = port.getBoundingClientRect();
      const sx = portRect.left + portRect.width / 2;
      const sy = portRect.top + portRect.height / 2;

      // Highlight potential targets: sample card sliders, synth card sliders
      document.querySelectorAll('.sample-card .cslider, .synth-card .cslider').forEach(sl => {
        sl.style.outline = '1px dashed rgba(255,255,255,0.2)';
      });

      const mm = ev => {
        const ex = ev.clientX;
        const ey = ev.clientY;
        const cx1 = sx, cy1 = sy + 30;
        const cx2 = ex, cy2 = ey - 30;
        tempLine.setAttribute('d', `M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${ex},${ey}`);
      };

      const mu = ev => {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
        tempLine.remove();
        // Remove highlights
        document.querySelectorAll('.sample-card .cslider, .synth-card .cslider').forEach(sl => { sl.style.outline = ''; });

        // Check if dropped on a target
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!target) return;
        const sliderWrap = target.closest('.cslider');
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

    function updateLfoWires() {
      const svg = document.getElementById('lfo-wires');
      svg.querySelectorAll('.lfo-wire-line').forEach(w => w.remove());

      // ── LFO → sample/synth wires ──
      for (const [, lfo] of lfos) {
        const nodeInfo = lfoNodes.get(lfo.id);
        if (!nodeInfo) continue;
        const port = nodeInfo.el.querySelector('.lfo-wire-port');
        let sx, sy;
        if (nodeInfo.el.classList.contains('collapsed') || !port) {
          const r = nodeInfo.el.getBoundingClientRect();
          sx = r.left + r.width / 2; sy = r.top + r.height / 2;
        } else {
          const r = port.getBoundingClientRect();
          sx = r.left + r.width / 2; sy = r.top + r.height / 2;
        }

        for (const d of lfo.destinations) {
          const cardInfo = openCards.get(d.sampleId);
          let targetEl = null;

          if (cardInfo) {
            const pInfo = LFO_PARAM_MAP[d.param];
            if (pInfo && pInfo.isEq && !d.fxUid) {
              targetEl = cardInfo.el.querySelector('.card-eq-canvas');
            } else if (d.fxUid) {
              const panel = cardInfo.el.querySelector(`.fx-panel[data-fx-uid="${d.fxUid}"]`);
              if (panel) {
                if (pInfo && pInfo.isEq) targetEl = panel.querySelector('.card-eq-canvas');
                else targetEl = panel.querySelector('.' + d.param)?.closest('.cslider');
              }
            } else {
              const slider = cardInfo.el.querySelector('.' + d.param);
              if (slider) targetEl = slider.closest('.cslider') || slider;
            }
            if (targetEl) {
              const r = targetEl.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) targetEl = null;
            }
            if (!targetEl) targetEl = cardInfo.el;
          } else {
            targetEl = document.getElementById('t' + d.sampleId);
          }

          if (!targetEl) continue;
          const tr = targetEl.getBoundingClientRect();
          _wire(svg, 'lfo-wire-line', lfo.color, sx, sy, tr.left + tr.width / 2, tr.top + tr.height / 2);
        }
      }

      // ── Riff → sample/synth wires ──
      svg.querySelectorAll('.riff-wire-line').forEach(w => w.remove());
      for (const [, riff] of riffs) {
        const nodeInfo = riffNodes.get(riff.id);
        if (!nodeInfo || !riff.destinations.length) continue;
        const port = nodeInfo.el.querySelector('.riff-wire-port');
        let sx, sy;
        if (nodeInfo.el.classList.contains('collapsed') || !port) {
          const r = nodeInfo.el.getBoundingClientRect();
          sx = r.left + r.width / 2; sy = r.top + r.height / 2;
        } else {
          const r = port.getBoundingClientRect();
          sx = r.left + r.width / 2; sy = r.top + r.height / 2;
        }
        for (const instrId of riff.destinations) {
          const cardInfo = openCards.get(instrId);
          let targetEl = cardInfo
            ? (() => { const c = cardInfo.el.querySelector('.card-wave-canvas, .synth-scope-canvas'); return (c && c.offsetParent !== null) ? c : cardInfo.el; })()
            : document.getElementById('t' + instrId);
          if (!targetEl) continue;
          const tr = targetEl.getBoundingClientRect();
          _wire(svg, 'riff-wire-line', riff.color, sx, sy, tr.left + tr.width / 2, tr.top + tr.height / 2);
        }
      }

      // ── Chords → sample/synth wires ──
      svg.querySelectorAll('.chords-wire-line').forEach(w => w.remove());
      for (const [, ch] of chords) {
        const nodeInfo = chordsNodes.get(ch.id);
        if (!nodeInfo || !ch.destinations.length) continue;
        const port = nodeInfo.el.querySelector('.chords-wire-port');
        let sx, sy;
        if (nodeInfo.el.classList.contains('collapsed') || !port) {
          const r = nodeInfo.el.getBoundingClientRect();
          sx = r.left + r.width / 2; sy = r.top + r.height / 2;
        } else {
          const r = port.getBoundingClientRect();
          sx = r.left + r.width / 2; sy = r.top + r.height / 2;
        }
        for (const instrId of ch.destinations) {
          const cardInfo = openCards.get(instrId);
          let targetEl = cardInfo
            ? (() => { const c = cardInfo.el.querySelector('.card-wave-canvas, .synth-scope-canvas'); return (c && c.offsetParent !== null) ? c : cardInfo.el; })()
            : document.getElementById('t' + instrId);
          if (!targetEl) continue;
          const tr = targetEl.getBoundingClientRect();
          _wire(svg, 'chords-wire-line', ch.color, sx, sy, tr.left + tr.width / 2, tr.top + tr.height / 2);
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
        if (slider) targetWrap = slider.closest('.cslider');
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
        if (slider) targetWrap = slider.closest('.cslider');
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
        lfo.tick(now);
        const val = lfo.evaluate(lfo._phase);

        // Update playhead on the LFO node
        const nodeInfo = lfoNodes.get(lfo.id);
        if (nodeInfo) {
          const ph = nodeInfo.el.querySelector('.lfo-playhead');
          if (ph) {
            const shapeWrap = nodeInfo.el.querySelector('.lfo-shape-wrap');
            const sw = shapeWrap ? shapeWrap.clientWidth : 200;
            ph.style.left = (lfo._phase * sw) + 'px';
          }
        }

        // Apply modulation to destinations
        for (const d of lfo.destinations) {
          const s = samples.get(d.sampleId) || synths.get(d.sampleId) || drums.get(d.sampleId);
          if (!s) continue;
          const pInfo = LFO_PARAM_MAP[d.param];
          if (!pInfo) continue;

          const modVal = d.min + val * (d.max - d.min);

          // Drum machine pitch modulation
          if (pInfo.isDrum && s instanceof DrumMachine) {
            s.pitches[pInfo.subProp] = modVal;
            const cardInfo = openCards.get(d.sampleId);
            if (cardInfo) {
              const slider = cardInfo.el.querySelector('.' + d.param);
              if (slider) { slider.value = modVal; slider.closest('.cslider')?._syncPos?.(); }
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
                const nodeParam = inst.node[pInfo.prop];
                if (nodeParam && typeof nodeParam === 'object' && 'value' in nodeParam) {
                  nodeParam.value = modVal;
                } else {
                  inst.node[pInfo.prop] = modVal;
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
      const pos = findFreePosition(TW, TH);
      const x = pos.x + TW / 2, y = pos.y + TH / 2;
      const synth = new AnalogSynth(id, 'SYNTH ' + id, x, y);
      synths.set(id, synth);
      const t = createSynthTile(synth);
      openSynthCard(id, t);
    });

    document.getElementById('btn-add-drums').addEventListener('click', async () => {
      await ensureAudio();
      const id = nextId++;
      const pos = findFreePosition(TW, TH);
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

