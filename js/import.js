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

      // Collect occupied rects in canvas world coordinates
      const occupied = [];
      document.querySelectorAll('.tile, .lfo-node, .seq-node').forEach(el => {
        const r = el.getBoundingClientRect();
        occupied.push({ x: r.left - cvRect.left + scrollX, y: r.top - cvRect.top + scrollY, w: r.width, h: r.height });
      });
      document.querySelectorAll('.sample-card.open').forEach(el => {
        const r = el.getBoundingClientRect();
        occupied.push({ x: r.left - cvRect.left + scrollX, y: r.top - cvRect.top + scrollY, w: r.width, h: r.height });
      });

      for (let i = 0; i < 80; i++) {
        const x = minX + Math.random() * Math.max(0, maxX - minX);
        const y = minY + Math.random() * Math.max(0, maxY - minY);
        let ok = true;
        for (const o of occupied) {
          if (x < o.x + o.w + margin && x + w + margin > o.x &&
              y < o.y + o.h + margin && y + h + margin > o.y) {
            ok = false; break;
          }
        }
        if (ok) return { x, y };
      }
      // Fallback: diagonal cascade within visible area
      const n = occupied.length;
      return {
        x: Math.min(minX + (n * 48) % Math.max(1, maxX - minX), maxX),
        y: Math.min(minY + (n * 32) % Math.max(1, maxY - minY), maxY)
      };
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
        const pos = findFreePosition(TW, TH);
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

