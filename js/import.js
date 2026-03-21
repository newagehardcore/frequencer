    // ════════════════════════════════════════════════════
    // IMPORT
    // ════════════════════════════════════════════════════
    const AUDIO_EXTS = new Set(['wav', 'mp3', 'ogg', 'flac', 'aiff', 'aif', 'm4a', 'opus', 'webm', 'weba']);
    const isAudio = n => AUDIO_EXTS.has((n.split('.').pop() || '').toLowerCase());

    // Returns a top-left {x, y} in canvas world coordinates that doesn't overlap existing elements,
    // placed within the currently visible viewport area.
    function findFreePosition(w, h) {
      const margin = 20;
      const scrollX = cv.scrollLeft, scrollY = cv.scrollTop;
      const viewW = cv.clientWidth || 800, viewH = cv.clientHeight || 500;
      const minX = scrollX + margin;
      const minY = scrollY + margin;
      const maxX = scrollX + viewW - w - margin;
      const maxY = scrollY + viewH - h - margin;
      const cvRect = cv.getBoundingClientRect();

      // Collect occupied rects in canvas world coordinates (all canvas-positioned nodes + open viewport cards)
      const occupied = [];
      document.querySelectorAll('.tile, .lfo-node, .riff-node, .chords-node').forEach(el => {
        const r = el.getBoundingClientRect();
        occupied.push({ x: r.left - cvRect.left + scrollX, y: r.top - cvRect.top + scrollY, w: r.width, h: r.height });
      });
      // Check all open cards directly from openCards map (avoids .open RAF timing issue)
      for (const [, info] of openCards) {
        const el = info.el;
        if (!el || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        const ew = el.offsetWidth || r.width || w;
        const knownH = el.classList.contains('drum-card') ? 560
                     : el.classList.contains('sample-card') ? 420 : 520;
        const eh = Math.max(el.offsetHeight, knownH);
        occupied.push({ x: r.left - cvRect.left + scrollX, y: r.top - cvRect.top + scrollY, w: ew, h: eh });
      }

      function noOverlap(x, y) {
        for (const o of occupied) {
          if (x < o.x + o.w + margin && x + w + margin > o.x &&
              y < o.y + o.h + margin && y + h + margin > o.y) return false;
        }
        return true;
      }

      // 1. Try random positions in visible viewport
      for (let i = 0; i < 200; i++) {
        const x = minX + Math.random() * Math.max(0, maxX - minX);
        const y = minY + Math.random() * Math.max(0, maxY - minY);
        if (noOverlap(x, y)) return { x, y };
      }
      // 2. Systematic grid scan of viewport
      const step = Math.min(w, h, 32);
      for (let y = minY; y <= Math.max(minY, maxY); y += step) {
        for (let x = minX; x <= Math.max(minX, maxX); x += step) {
          if (noOverlap(x, y)) return { x, y };
        }
      }
      // 3. Place below all occupied elements — guaranteed no overlap, canvas is large enough
      const belowAll = occupied.reduce((m, o) => Math.max(m, o.y + o.h), scrollY) + margin;
      return { x: minX, y: Math.min(belowAll, WORLD_H - h - margin) };
    }

    // Returns a top-left {x, y} in viewport (screen) coordinates for a floating card
    // that doesn't overlap any open cards or canvas tiles/nodes visible in the viewport.
    function findFreeCardPosition(w, h) {
      const margin = 12;
      const hdrH = 44; // header bar height
      const vw = window.innerWidth, vh = window.innerHeight;
      const minX = margin;
      const minY = hdrH + margin;
      const maxX = vw - w - margin;
      const maxY = vh - h - margin;

      // Build list of occupied rects in viewport space.
      // Cards use scrollHeight for true height since max-height:0 animation makes
      // getBoundingClientRect().height = 0 before the .open class is applied.
      const occupied = [];

      document.querySelectorAll('.sample-card, .synth-card').forEach(el => {
        const r = el.getBoundingClientRect();
        const ew = r.width || el.offsetWidth || w;
        // offsetHeight/scrollHeight are both 0 when max-height:0 + overflow:hidden.
        // Use a conservative minimum so newly-placed cards don't stack on existing ones.
        const knownH = el.classList.contains('drum-card') ? 560
                     : el.classList.contains('sample-card') ? 420 : 520;
        const eh = Math.max(el.offsetHeight, knownH);
        const rect = { left: r.left, top: r.top, right: r.left + ew, bottom: r.top + eh };
        if (rect.right > minX && rect.left < vw && rect.bottom > minY && rect.top < vh) {
          occupied.push(rect);
        }
      });

      document.querySelectorAll('.tile, .lfo-node, .riff-node, .chords-node').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right > minX && r.left < vw && r.bottom > minY && r.top < vh) {
          occupied.push(r);
        }
      });

      // Try random positions first (fast path)
      for (let i = 0; i < 400; i++) {
        const x = minX + Math.random() * Math.max(1, maxX - minX);
        const y = minY + Math.random() * Math.max(1, maxY - minY);
        let ok = true;
        for (const o of occupied) {
          if (x < o.right + margin && x + w + margin > o.left &&
              y < o.bottom + margin && y + h + margin > o.top) {
            ok = false; break;
          }
        }
        if (ok) return { x, y };
      }
      // Systematic grid scan as fallback
      const step = 32;
      for (let y = minY; y <= Math.max(minY, maxY); y += step) {
        for (let x = minX; x <= Math.max(minX, maxX); x += step) {
          let ok = true;
          for (const o of occupied) {
            if (x < o.right + margin && x + w + margin > o.left &&
                y < o.bottom + margin && y + h + margin > o.top) {
              ok = false; break;
            }
          }
          if (ok) return { x: Math.min(x, Math.max(minX, maxX)), y: Math.min(y, Math.max(minY, maxY)) };
        }
      }
      return { x: minX, y: minY };
    }

    async function importFile(file, dropPos = null) {
      if (!isAudio(file.name)) return;

      const id = nextId++;
      const name = file.name.replace(/\.[^.]+$/, '');
      let x, y;
      if (dropPos) {
        const cvRect = cv.getBoundingClientRect();
        x = dropPos.x - cvRect.left + cv.scrollLeft;
        y = dropPos.y - cvRect.top + cv.scrollTop;
      } else {
        // Find space for the full card footprint (280×420) so tile+card won't overlap anything
        const pos = findFreePosition(280, 420);
        x = pos.x + TW / 2;
        y = pos.y + TH / 2;
      }

      // Placeholder tile while decoding
      const stub = document.createElement('div');
      stub.className = 'tile';
      stub.id = 'stub' + id;
      stub.style.cssText = `left:${x - TW / 2}px;top:${y - TH / 2}px;
    display:flex;align-items:center;justify-content:center;opacity:0.3;`;
      stub.innerHTML = `<div style="font-size:9px;color:#555555;letter-spacing:.1em;font-weight:700;text-transform:uppercase">Decoding…</div>`;
      cv.appendChild(stub);
      samples.set(id, { id, name, x, y, playing: false, muted: false, gridSync: false });
      updateEmpty();

      try {
        const ab = await file.arrayBuffer();
        const decoded = await new Promise((res, rej) =>
          Tone.context.rawContext.decodeAudioData(ab.slice(0), res, rej)
        );

        if (stub.parentNode) stub.remove();

        const s = new Sample(id, name, decoded, x, y);
        samples.set(id, s);
        createTile(s);

        // Auto-play immediately on load
        startSample(s);
        openCard(id);

      } catch (err) {
        console.error('Import failed:', file.name, err.message || err);
        if (stub.parentNode) stub.remove();
        samples.delete(id);
        updateEmpty();
      }
    }

    async function importList(list, dropPos = null) {
      const audioFiles = Array.from(list).filter(f => isAudio(f.name));
      const pos = audioFiles.length === 1 ? dropPos : null;
      audioFiles.forEach(f => importFile(f, pos));
    }

    async function importFromDT(items, fallbackFiles, dropPos = null) {
      const files = [];
      const readEntry = e => new Promise(res => {
        if (!e) return res();
        if (e.isFile) {
          e.file(f => { files.push(f); res(); }, res);
        } else if (e.isDirectory) {
          const r = e.createReader();
          const readAll = () => r.readEntries(async en => {
            if (!en.length) return res();
            await Promise.all(en.map(readEntry));
            readAll();
          }, res);
          readAll();
        } else res();
      });
      const entries = Array.from(items)
        .map(i => i.webkitGetAsEntry && i.webkitGetAsEntry())
        .filter(Boolean);
      await Promise.all(entries.map(readEntry));
      // If File System API gave us nothing (e.g. local file:// quirk), fall back
      if (files.length === 0 && fallbackFiles && fallbackFiles.length) {
        importList(fallbackFiles, dropPos);
      } else {
        importList(files, dropPos);
      }
    }

