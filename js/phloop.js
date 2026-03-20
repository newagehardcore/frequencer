    // ════════════════════════════════════════════════════
    // PLAYHEAD ANIMATION LOOP
    // ════════════════════════════════════════════════════
    function phLoop() {
      for (const [id, s] of samples) {
        const ph = document.getElementById('ph' + id);
        if (!ph) continue;
        if (!s.playing) { ph.style.display = 'none'; continue; }
        const pos = s.playheadPos();
        if (pos === null) { ph.style.display = 'none'; continue; }
        // PS mode: pos is 0..1 of PS buffer; tile waveform shows PS buffer (x=0..TW), so use pos directly
        const tileX = pos * TW;
        ph.style.left = tileX + 'px';
        ph.style.display = 'block';
      }

      // Card playheads — one per open card
      for (const [cid, cardInfo] of openCards) {
        const si = samples.get(cid);
        const cph = cardInfo.phEl?.();
        if (!cph) continue;
        if (!(si instanceof Sample) || !si.playing) { cph.style.display = 'none'; continue; }
        const wrap = cardInfo.waveWrap?.();
        const W = wrap ? (wrap.clientWidth || 284) - 20 : 264;
        const pos = si.playheadPos();
        if (pos === null) { cph.style.display = 'none'; continue; }
        if (pos !== null) {
          // pos is 0..1 within the loop region; map to full-buffer absolute position (works for both PS and normal mode)
          const absPos = si.loopStart + pos * (si.loopEnd - si.loopStart);
          const { start: vs, width: vw } = cardInfo.getZView?.() ?? { start: 0, width: 1 };
          const viewPos = (absPos - vs) / vw;
          if (viewPos >= 0 && viewPos <= 1) {
            cph.style.left = viewPos * W + 'px';
            cph.style.display = 'block';
          } else {
            cph.style.display = 'none';
          }
        } else cph.style.display = 'none';
      }

      // Master VU meter
      if (masterMeter) {
        const mvc = document.getElementById('master-vu');
        if (mvc) drawVU(mvc, { meter: masterMeter });
      }

      // VU meters for open cards
      for (const [cid, cardInfo] of openCards) {
        const si = samples.get(cid);
        if (!(si instanceof Sample) || !si.meter) continue;
        const vuC = cardInfo.vuCanvas?.();
        if (vuC) drawVU(vuC, si);
      }

      // VU meters for all tiles
      for (const [sid, si] of samples) {
        if (!(si instanceof Sample) || !si.meter) continue;
        const tile = document.getElementById('t' + sid);
        if (!tile) continue;
        const vuC = tile.querySelector('.tile-vu-canvas');
        if (vuC) drawVU(vuC, si);
      }

      // Synth tiles: oscilloscope + VU
      for (const [sid, synth] of synths) {
        if (!(synth instanceof SynthInstrument)) continue;
        const tile = document.getElementById('t' + sid);
        if (tile) {
          const wc = tile.querySelector('.tile-canvas');
          if (wc) drawSynthScope(wc, synth);
          const vuC = tile.querySelector('.tile-vu-canvas');
          if (vuC) drawVU(vuC, synth);
        }
        // Also draw to open card scope canvas
        const cardInfo = openCards.get(sid);
        if (cardInfo) {
          const cardScope = cardInfo.el.querySelector('.synth-scope-canvas');
          if (cardScope) drawSynthScope(cardScope, synth);
        }
      }
      // Drum tiles: mini step grid + VU + step highlight
      for (const [did, drum] of drums) {
        if (!(drum instanceof DrumMachine)) continue;
        const tile = document.getElementById('t' + did);
        if (tile) {
          const wc  = tile.querySelector('.tile-canvas');
          if (wc) drawDrumMiniGrid(wc, drum);
          const vuC = tile.querySelector('.tile-vu-canvas');
          if (vuC) drawVU(vuC, drum);
        }
        // Highlight current step in open card
        const cardInfo = openCards.get(did);
        if (cardInfo) {
          const step = drum.currentStep;
          cardInfo.el.querySelectorAll('.dm-step').forEach(btn => {
            btn.classList.toggle('dm-step-head', drum.isPlaying && parseInt(btn.dataset.step) === step);
          });
        }
      }

      // Granular mini tile grain viz
      for (const [_gsid, _gs] of samples) {
        if (!(_gs instanceof Sample) || !_gs.granular) continue;
        // Mini tile grain canvas
        const _gtile = document.getElementById('t' + _gsid);
        if (!_gtile) continue;
        const _tgc = _gtile.querySelector('.tile-gran-canvas');
        if (!_tgc) continue;
        if (!_gs.playing) { _tgc._tgParticles = null; continue; }
        const _tgW = TW, _tgH = TH;
        const _tgCtx = _tgc.getContext('2d');
        if (!_tgc._tgParticles) _tgc._tgParticles = [];
        const _tgP = _tgc._tgParticles;
        // Spawn grains scattered around position within loop
        const _spawnN = Math.max(1, Math.round(_gs.grainDensity * 3));
        for (let _si = 0; _si < _spawnN; _si++) {
          const _center = _gs.loopStart + (_gs.loopEnd - _gs.loopStart) * _gs.grainPosition;
          const _spreadN = (_gs.loopEnd - _gs.loopStart) * _gs.grainSpread;
          const _norm = Math.max(_gs.loopStart, Math.min(_gs.loopEnd, _center + (Math.random() * 2 - 1) * _spreadN * 0.5));
          const _hue = (_gs.grainPitch / 24) * 60;
          _tgP.push({ x: _norm * _tgW, life: 1.0, hue: _hue, h: 4 + (_gs.grainRelease * 0.5 + 0.1) * _tgH * 0.4 });
        }
        // Age particles
        for (let _pi = _tgP.length - 1; _pi >= 0; _pi--) {
          _tgP[_pi].life -= 0.08 + Math.random() * 0.04;
          if (_tgP[_pi].life <= 0) { _tgP.splice(_pi, 1); }
        }
        // Cap pool size
        if (_tgP.length > 60) _tgP.splice(0, _tgP.length - 60);
        // Draw
        _tgCtx.clearRect(0, 0, _tgW, _tgH);
        const [_br, _bg, _bb] = hexToRgbArr(_gs.color || '#ffffff');
        for (const _tp of _tgP) {
          const _op = Math.max(0, _tp.life) * 0.8;
          const [_cr, _cg, _cb] = shiftHue(_br, _bg, _bb, _tp.hue);
          _tgCtx.globalAlpha = _op;
          _tgCtx.fillStyle = `rgb(${_cr},${_cg},${_cb})`;
          const _cy = _tgH * 0.5 - _tp.h * 0.5 + (Math.random() - 0.5) * 2;
          _tgCtx.fillRect(Math.round(_tp.x), _cy, 1, _tp.h);
        }
        _tgCtx.globalAlpha = 1;
      }

      // LFO modulation tick
      lfoModulationTick();
      updateLfoWires();

      requestAnimationFrame(phLoop);
    }

    function drawVU(canvas, s) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width || 20, H = canvas.height || 80;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      let levels = s.meter.getValue();
      if (!Array.isArray(levels)) levels = [levels, levels];
      const barW = Math.floor((W - 3) / 2);
      const gap = W - barW * 2;
      for (let ch = 0; ch < 2; ch++) {
        const raw = levels[ch];
        const db = (raw === -Infinity || !isFinite(raw)) ? -60 : Math.max(-60, Math.min(6, raw));
        const normalized = (db + 60) / 66;
        const barH = Math.round(normalized * (H - 2));
        const x = ch === 0 ? 0 : barW + gap;
        ctx.fillStyle = '#111';
        ctx.fillRect(x, 1, barW, H - 2);
        if (barH > 0) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(x, H - 1 - barH, barW, barH);
        }
      }
    }

