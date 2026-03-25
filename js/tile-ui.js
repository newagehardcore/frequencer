    // ════════════════════════════════════════════════════
    // TILE CREATION & WAVEFORM
    // ════════════════════════════════════════════════════
    function createTile(s) {
      const t = document.createElement('div');
      t.className = 'tile';
      t.id = 't' + s.id;
      t.style.left = (s.x - TW / 2) + 'px';
      t.style.top = (s.y - TH / 2) + 'px';
      t.style.setProperty('--col', s.color);

      const wc = document.createElement('canvas');
      wc.className = 'tile-canvas';
      wc.width = TW; wc.height = TH;
      t.appendChild(wc);

      const vu = document.createElement('canvas');
      vu.className = 'tile-vu-canvas';
      vu.width = 10; vu.height = 42;
      t.appendChild(vu);

      const ph = document.createElement('div');
      ph.className = 'tile-ph';
      ph.id = 'ph' + s.id;
      ph.style.background = '#fff';
      t.appendChild(ph);

      const gb = document.createElement('div');
      gb.className = 'tile-gbadge';
      gb.textContent = 'GRID';
      t.appendChild(gb);

      const granBadge = document.createElement('div');
      granBadge.className = 'tile-gran-badge';
      granBadge.textContent = 'GRAN';
      t.appendChild(granBadge);

      const tgc = document.createElement('canvas');
      tgc.className = 'tile-gran-canvas';
      tgc.width = TW; tgc.height = TH;
      t.appendChild(tgc);

      const lb = document.createElement('div');
      lb.className = 'tile-lbl';
      lb.textContent = s.name;
      t.appendChild(lb);

      const mbtn = document.createElement('button');
      mbtn.className = 'tile-mbtn';
      mbtn.textContent = 'M';
      mbtn.title = 'Mute';
      if (s.muted) mbtn.classList.add('mute-on');
      mbtn.onclick = (e) => {
        e.stopPropagation();
        s.muted = !s.muted;
        s.vol.volume.value = s._effectiveDb();
        s._renderTile();
      };
      t.appendChild(mbtn);

      const sbtn = document.createElement('button');
      sbtn.className = 'tile-sbtn';
      sbtn.textContent = 'S';
      sbtn.title = 'Solo';
      if (soloId === s.id) sbtn.classList.add('solo-on');
      sbtn.onclick = (e) => {
        e.stopPropagation();
        soloId = (soloId === s.id) ? null : s.id;
        applyAllVols();
        refreshSoloVis();
      };
      t.appendChild(sbtn);

      const inPort = document.createElement('div');
      inPort.className = 'tile-in-port';
      inPort.title = 'Drop LFO here to modulate volume';
      t.appendChild(inPort);

      const outPort = document.createElement('div');
      outPort.className = 'tile-out-port';
      outPort.title = 'Drop LFO here to modulate volume';
      t.appendChild(outPort);

      requestAnimationFrame(() => drawTileWave(wc, s));

      makeDraggable(t, s);

      // Single click → open card, or close if already open
      t.addEventListener('click', (e) => {
        if (!t._dragged) {
          if (openCards.has(s.id)) closeCard(s.id);
          else openCard(s.id, t);
        }
      });

      // Double-click → play/stop
      t.addEventListener('dblclick', (e) => {
        e.preventDefault();
        togglePlay(s.id);
      });

      // Right-click → also open card (same as click)
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCard(s.id, t);
      });

      cv.appendChild(t);
      updateEmpty();
      return t;
    }

    function drawTileWave(canvas, s) {
      const ctx = canvas.getContext('2d');
      const W = TW, H = TH;
      ctx.clearRect(0, 0, W, H);

      const labelH = 14;
      const drawH = H - labelH;
      const mid = drawH / 2;

      const peaks = s.getHiResPeaks();
      const startIdx = s.loopStart * peaks.length;
      const endIdx = s.loopEnd * peaks.length;
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
        const barH = Math.max(1, scaledAmp * drawH * 0.85);
        ctx.fillStyle = s.color;
        ctx.fillRect(i, mid - barH / 2, 1, barH);
      }

      ctx.fillStyle = hexToRgba(s.color, 0.25);
      ctx.fillRect(0, mid, W, 1);

      // ── Fade overlays on tile ──
      const loopRange = Math.max(0.001, s.loopEnd - s.loopStart);
      const _tileDur = s._activeDur;
      if (s.attackTime > 0) {
        const atkPx = Math.min(W * 0.45, (s.attackTime / _tileDur) / loopRange * W);
        if (atkPx > 0) {
          const g = ctx.createLinearGradient(0, 0, atkPx, 0);
          g.addColorStop(0, 'rgba(0,0,0,0.75)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, atkPx, drawH);
        }
      }
      if (s.releaseTime > 0) {
        const relPx = Math.min(W * 0.45, (s.releaseTime / _tileDur) / loopRange * W);
        if (relPx > 0) {
          const g = ctx.createLinearGradient(W - relPx, 0, W, 0);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, 'rgba(0,0,0,0.75)');
          ctx.fillStyle = g;
          ctx.fillRect(W - relPx, 0, relPx, drawH);
        }
      }
      if (s.crossfadeTime > 0) {
        const xfdPx = Math.min(W * 0.45, (s.crossfadeTime / _tileDur) / loopRange * W);
        if (xfdPx > 0) {
          const ge = ctx.createLinearGradient(W - xfdPx, 0, W, 0);
          ge.addColorStop(0, 'rgba(255,255,255,0)');
          ge.addColorStop(1, 'rgba(255,255,255,0.38)');
          ctx.fillStyle = ge; ctx.fillRect(W - xfdPx, 0, xfdPx, drawH);
          const gs = ctx.createLinearGradient(0, 0, xfdPx, 0);
          gs.addColorStop(0, 'rgba(255,255,255,0.38)');
          gs.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gs; ctx.fillRect(0, 0, xfdPx, drawH);
        }
      }
    }

    function refreshTileWave(s) {
      const t = document.getElementById('t' + s.id);
      if (!t) return;
      const wc = t.querySelector('.tile-canvas');
      if (wc) drawTileWave(wc, s);
    }

    function drawSynthScope(canvas, synth) {
      const W = canvas.width, H = canvas.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (!synth._analyser) return;
      const data = synth._analyser.getValue();
      if (!data || data.length < 2) return;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      ctx.strokeStyle = synth.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * W;
        const y = (0.5 - data[i] * 0.85) * H;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function drawDrumMiniGrid(canvas, drum) {
      const W = canvas.width, H = canvas.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      const lanes = drum.INSTRUMENTS;
      const nLanes = lanes.length;
      const nSteps = drum.numSteps;
      const padX = 3, padY = 3;
      const gapX = 1, gapY = 1;
      const cellW = (W - padX * 2 - gapX * (nSteps - 1)) / nSteps;
      const cellH = (H - padY * 2 - gapY * (nLanes - 1)) / nLanes;

      for (let li = 0; li < nLanes; li++) {
        const name = lanes[li];
        const y = padY + li * (cellH + gapY);
        for (let si = 0; si < nSteps; si++) {
          const x = padX + si * (cellW + gapX);
          const vel = drum.patterns[name][si];
          if (vel === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
          } else if (vel === 1) {
            ctx.fillStyle = drum.color + '88';
          } else {
            ctx.fillStyle = drum.color;
          }
          ctx.fillRect(x, y, Math.max(cellW, 1), Math.max(cellH, 1));
        }
      }
      // Playhead
      if (drum.isPlaying && drum.currentStep >= 0) {
        const si = drum.currentStep;
        const x = padX + si * (cellW + gapX);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x, 0, Math.max(cellW, 1), H);
      }
    }

    function createSynthTile(synth) {
      const t = document.createElement('div');
      t.className = 'tile synth-tile';
      t.id = 't' + synth.id;
      t.style.left = (synth.x - TW / 2) + 'px';
      t.style.top  = (synth.y - TH / 2) + 'px';
      t.style.setProperty('--col', synth.color);
      const wc = document.createElement('canvas');
      wc.className = 'tile-canvas'; wc.width = TW; wc.height = TH;
      t.appendChild(wc);

      const vu = document.createElement('canvas');
      vu.className = 'tile-vu-canvas'; vu.width = 10; vu.height = 42;
      t.appendChild(vu);

      const badge = document.createElement('div');
      badge.className = 'tile-synth-badge';
      badge.textContent = synth.synthType.toUpperCase();
      t.appendChild(badge);

      const lb = document.createElement('div');
      lb.className = 'tile-lbl';
      lb.textContent = synth.name;
      t.appendChild(lb);

      const mbtn = document.createElement('button');
      mbtn.className = 'tile-mbtn'; mbtn.textContent = 'M'; mbtn.title = 'Mute';
      if (synth.muted) mbtn.classList.add('mute-on');
      mbtn.onclick = (e) => {
        e.stopPropagation();
        synth.muted = !synth.muted;
        synth.vol.volume.value = synth._effectiveDb();
        synth._renderTile();
      };
      t.appendChild(mbtn);

      const sbtn = document.createElement('button');
      sbtn.className = 'tile-sbtn'; sbtn.textContent = 'S'; sbtn.title = 'Solo';
      if (soloId === synth.id) sbtn.classList.add('solo-on');
      sbtn.onclick = (e) => {
        e.stopPropagation();
        soloId = (soloId === synth.id) ? null : synth.id;
        applyAllVols(); refreshSoloVis();
      };
      t.appendChild(sbtn);

      const inPort = document.createElement('div');
      inPort.className = 'tile-in-port';
      inPort.title = 'Drop LFO here to modulate volume';
      t.appendChild(inPort);

      const outPort = document.createElement('div');
      outPort.className = 'tile-out-port';
      outPort.title = 'Drop LFO here to modulate volume';
      t.appendChild(outPort);

      requestAnimationFrame(() => drawSynthScope(wc, synth));
      makeDraggable(t, synth);

      t.addEventListener('click', (e) => {
        if (!t._dragged) {
          if (openCards.has(synth.id)) closeSynthCard(synth.id);
          else openSynthCard(synth.id, t);
        }
      });
      t.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const note = 'C4';
        synth.noteOn(note, 100);
        setTimeout(() => synth.noteOff(note), 600);
      });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); openSynthCard(synth.id, t); });

      cv.appendChild(t);
      updateEmpty();
      return t;
    }

    function hexToRgba(hex, alpha) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }

    function makeDraggable(tile, s) {
      let ox, oy, oL, oT, moved;
      tile.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (tile.classList.contains('expanded')) return;
        e.preventDefault(); e.stopPropagation();
        ox = e.clientX; oy = e.clientY;
        oL = parseInt(tile.style.left);
        oT = parseInt(tile.style.top);
        moved = false; tile._dragged = false;
        tile.style.zIndex = ++cardZTop;
        tile.classList.add('dragging');

        const mm = (ev) => {
          const dx = ev.clientX - ox, dy = ev.clientY - oy;
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          if (!moved) return;
          const nl = Math.max(0, Math.min(WORLD_W - TW, oL + dx));
          const nt = Math.max(0, Math.min(WORLD_H - TH, oT + dy));
          tile.style.left = nl + 'px';
          tile.style.top = nt + 'px';
          s.x = nl + TW / 2; s.y = nt + TH / 2;
          updateLfoWires();
        };
        const mu = () => {
          tile.classList.remove('dragging');
          tile._dragged = moved;
          document.removeEventListener('mousemove', mm);
          document.removeEventListener('mouseup', mu);
          setTimeout(() => { tile._dragged = false; }, 60);
        };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
    }

    // ════════════════════════════════════════════════════
    // COLOR HELPERS (shared by gran viz in phLoop and in card)
    // ════════════════════════════════════════════════════
    function hexToRgbArr(hex) {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return [r, g, b];
    }
    function shiftHue(r, g, b, hueDeg) {
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
