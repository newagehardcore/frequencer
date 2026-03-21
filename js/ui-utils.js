// ════════════════════════════════════════════════════════
// VP SLIDERS — custom vol/pan with label, drag, click-to-edit
// ════════════════════════════════════════════════════════

function fmtDb(db) {
  db = parseFloat(db);
  if (db <= -59) return '-∞';
  if (Math.abs(db) < 0.05) return '0';
  const abs = Math.abs(db);
  const str = abs < 10 ? db.toFixed(1) : Math.round(db).toString();
  return db > 0 ? '+' + str : str;
}

function fmtPan(p) {
  p = parseFloat(p);
  if (Math.abs(p) < 0.01) return 'C';
  return (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100);
}

function parseDbStr(str) {
  str = str.trim().replace(/db$/i, '');
  if (/^-inf/i.test(str) || str === '-∞') return -60;
  const n = parseFloat(str);
  return isNaN(n) ? NaN : n;
}

function parsePanStr(str) {
  str = str.trim().toUpperCase();
  if (str === 'C') return 0;
  if (str.startsWith('L')) { const n = parseFloat(str.slice(1)); return isNaN(n) ? -1 : -Math.min(1, n / 100); }
  if (str.startsWith('R')) { const n = parseFloat(str.slice(1)); return isNaN(n) ?  1 :  Math.min(1, n / 100); }
  const n = parseFloat(str);
  return isNaN(n) ? NaN : Math.max(-1, Math.min(1, n));
}

// Override input.value setter so LFO writes re-render the custom UI
function _overrideValueProp(input, onSet) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    get() { return proto.get.call(this); },
    set(v) { proto.set.call(this, v); onSet(parseFloat(v)); },
    configurable: true,
  });
}

// ── Vertical vol slider ──────────────────────────────────
function initVolSlider(wrap) {
  const input = wrap.querySelector('input[type=range]');
  if (!input || wrap._vpInit) return;
  wrap._vpInit = true;

  const min = parseFloat(input.min) || -60;
  const max = parseFloat(input.max) || 6;
  let val = parseFloat(input.value) || 0;

  const vs = document.createElement('div');
  vs.className = 'vp-vs';
  vs.innerHTML = `
    <div class="vp-vs-track">
      <div class="vp-vs-rail"></div>
      <div class="vp-vs-fill"></div>
      <div class="vp-vs-thumb"></div>
    </div>`;
  wrap.appendChild(vs);

  const track = vs.querySelector('.vp-vs-track');
  const fill  = vs.querySelector('.vp-vs-fill');
  const thumb = vs.querySelector('.vp-vs-thumb');

  function frac(v) { return Math.max(0, Math.min(1, (v - min) / (max - min))); }

  function render(v) {
    const f   = frac(v);
    const tH  = track.clientHeight || 66;
    const thH = 14;
    const bot = f * Math.max(0, tH - thH);
    fill.style.height  = (bot + thH / 2) + 'px';
    thumb.style.bottom = bot + 'px';
    if (!thumb._ed) thumb.textContent = fmtDb(v);
  }

  function applyVal(v, notify = true) {
    val = Math.max(min, Math.min(max, v));
    render(val);
    if (notify) {
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  _overrideValueProp(input, v => { val = Math.max(min, Math.min(max, v)); render(val); });

  // Drag anywhere in the wrap
  vs.addEventListener('mousedown', e => {
    if (thumb._ed) return;
    e.preventDefault(); e.stopPropagation();
    const rect   = track.getBoundingClientRect();
    const tH     = rect.height;
    const thH    = 14;
    const usable = Math.max(1, tH - thH);
    function posToVal(y) {
      const f = 1 - Math.max(0, Math.min(usable, y - rect.top - thH / 2)) / usable;
      return min + f * (max - min);
    }
    applyVal(posToVal(e.clientY));
    const mm = ev => applyVal(posToVal(ev.clientY));
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  // Click thumb → inline edit
  thumb.addEventListener('click', e => {
    if (thumb._ed) return;
    e.stopPropagation();
    thumb._ed = true;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'vp-edit';
    inp.value = val <= -59 ? '-inf' : val.toFixed(1);
    thumb.textContent = '';
    thumb.appendChild(inp);
    inp.focus(); inp.select();
    const commit = () => {
      thumb._ed = false;
      const n = parseDbStr(inp.value);
      if (!isNaN(n)) applyVal(n); else render(val);
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { thumb._ed = false; render(val); inp.blur(); }
      ev.stopPropagation();
    });
    inp.addEventListener('blur', commit);
    inp.addEventListener('mousedown', ev => ev.stopPropagation());
  });

  requestAnimationFrame(() => render(val));
}

// ── Horizontal pan slider ────────────────────────────────
function initPanSlider(wrap) {
  const input = wrap.querySelector('input[type=range]');
  if (!input || wrap._vpInit) return;
  wrap._vpInit = true;

  let val = parseFloat(input.value) || 0;

  const hs = document.createElement('div');
  hs.className = 'vp-hs';
  hs.innerHTML = `
    <div class="vp-hs-track">
      <div class="vp-hs-rail"></div>
      <div class="vp-hs-fill"></div>
      <div class="vp-hs-center"></div>
      <div class="vp-hs-thumb"></div>
    </div>`;
  wrap.appendChild(hs);

  const track = hs.querySelector('.vp-hs-track');
  const fill  = hs.querySelector('.vp-hs-fill');
  const thumb = hs.querySelector('.vp-hs-thumb');

  function render(v) {
    const f = (v + 1) / 2; // 0=L, 0.5=C, 1=R
    thumb.style.left = (f * 100) + '%';
    if (Math.abs(v) < 0.01) {
      fill.style.display = 'none';
    } else if (v < 0) {
      fill.style.display = '';
      fill.style.left  = (f * 100) + '%';
      fill.style.right = '50%';
      fill.style.width = '';
    } else {
      fill.style.display = '';
      fill.style.left  = '50%';
      fill.style.right = (100 - f * 100) + '%';
      fill.style.width = '';
    }
    if (!thumb._ed) thumb.textContent = fmtPan(v);
  }

  function applyVal(v, notify = true) {
    val = Math.max(-1, Math.min(1, v));
    render(val);
    if (notify) {
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  _overrideValueProp(input, v => { val = Math.max(-1, Math.min(1, v)); render(val); });

  hs.addEventListener('mousedown', e => {
    if (thumb._ed) return;
    e.preventDefault(); e.stopPropagation();
    const rect = track.getBoundingClientRect();
    function posToVal(x) { return Math.max(-1, Math.min(1, (x - rect.left) / rect.width * 2 - 1)); }
    applyVal(posToVal(e.clientX));
    const mm = ev => applyVal(posToVal(ev.clientX));
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  thumb.addEventListener('click', e => {
    if (thumb._ed) return;
    e.stopPropagation();
    thumb._ed = true;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'vp-edit';
    inp.value = fmtPan(val);
    thumb.textContent = '';
    thumb.appendChild(inp);
    inp.focus(); inp.select();
    const commit = () => {
      thumb._ed = false;
      const n = parsePanStr(inp.value);
      if (!isNaN(n)) applyVal(n); else render(val);
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { thumb._ed = false; render(val); inp.blur(); }
      ev.stopPropagation();
    });
    inp.addEventListener('blur', commit);
    inp.addEventListener('mousedown', ev => ev.stopPropagation());
  });

  requestAnimationFrame(() => render(val));
}

function initVpSliders(cardEl) {
  cardEl.querySelectorAll('.vp-vol-wrap').forEach(initVolSlider);
  cardEl.querySelectorAll('.card-pan-row, .dm-pan-row').forEach(initPanSlider);
}
