    'use strict';

    // ════════════════════════════════════════════════════
    // CONSTANTS & GLOBALS
    // ════════════════════════════════════════════════════
    const TW = 136, TH = 56;
    const cv = document.getElementById('cv');

    let audioReady = false;
    let isPlaying = false;
    let metroOn = false;
    let masterMeter = null;
    const masterSamplesGain = new Tone.Gain(1).toDestination();

    const WAVE_ZOOM_MAX = 1e7;
    let soloId = null;
    const openCards = new Map(); // sampleId → { el, getZView, drawWave, updateLoopReg }
    let cardZTop = 10; // unified z-index counter for all floating elements
    let nextId = 1;

    const samples = new Map();
    const synths  = new Map();
    const drums   = new Map();

    function getInstrument(id) { return samples.get(id) || synths.get(id) || drums.get(id) || riffs.get(id) || chords.get(id); }

    // Pure saturated colors — primary & secondary, then variations in saturation/lightness for 7+
    const COLORS = [
      '#ff0000', // red
      '#0066ff', // blue
      '#00cc00', // green
      '#ffcc00', // yellow
      '#ff6600', // orange
      '#cc00cc', // magenta
      '#00cccc', // cyan
      // extras: punchy variants
      '#ff0066', // hot pink
      '#6600ff', // violet
      '#00ff66', // spring green
      '#ff3300', // vermillion
      '#0099ff', // sky blue
    ];
    let colorIdx = 0;
    function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }

    // ════════════════════════════════════════════════════
    // LFO SYSTEM
    // ════════════════════════════════════════════════════
    const lfos = new Map();
    let nextLfoId = 1;
    const MAX_LFOS = 8;
    const LFO_W = 220, LFO_H_MIN = 200;
    const lfoNodes = new Map(); // lfoId → { el, drawShape, updateDestList, ... }
    let _wiringLfo = null; // set during wire-drag: { lfoId, tempLine }
    let _lfoColorIdx = 0;
    const LFO_COLORS = ['#ff6040', '#40b0ff', '#aaee44', '#cc55ff', '#ffaa00', '#00ddcc', '#ff4499', '#88aaff'];
    function nextLfoColor() { return LFO_COLORS[_lfoColorIdx++ % LFO_COLORS.length]; }

    function midiToNoteName(midi) {
      const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const octave = Math.floor(midi / 12) - 1;
      return notes[midi % 12] + octave;
    }

    // ════════════════════════════════════════════════════
    // RIFF SEQUENCER SYSTEM
    // ════════════════════════════════════════════════════
    const riffs = new Map();
    let nextRiffId = 1;
    const MAX_RIFFS = 8;
    const RIFF_W = 340;
    const riffNodes = new Map(); // riffId → { el, updateDestList, setPlayStep }
    let _riffColorIdx = 0;
    const RIFF_COLORS = ['#ff6600','#cc00cc','#0099ff','#00cc66','#ff0066','#ffcc00','#6600ff','#00cccc'];
    function nextRiffColor() { return RIFF_COLORS[_riffColorIdx++ % RIFF_COLORS.length]; }

    let _activeRiffId = null; // which riff node receives QWERTY input
    let _activeChordsId = null; // which chords node has keyboard focus
    let globalTranspose = 0;   // semitones, -24…+24

    // QWERTY → note-within-octave mapping (code → [noteName, octaveOffset])
    const RIFF_QWERTY_MAP = {
      'KeyA': ['C',  0], 'KeyW': ['C#', 0], 'KeyS': ['D',  0], 'KeyE': ['D#', 0],
      'KeyD': ['E',  0], 'KeyF': ['F',  0], 'KeyT': ['F#', 0], 'KeyG': ['G',  0],
      'KeyY': ['G#', 0], 'KeyH': ['A',  0], 'KeyU': ['A#', 0], 'KeyJ': ['B',  0],
      'KeyK': ['C',  1], 'KeyO': ['C#', 1], 'KeyL': ['D',  1], 'KeyP': ['D#', 1],
    };

    // Helper: convert note name to absolute semitone (C0 = 0)
    function noteToSemis(noteName) {
      const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
      const m = noteName.match(/^([A-Ga-g][#b]?)(\d+)$/);
      if (!m) return 60;
      return (parseInt(m[2]) + 1) * 12 + (NM[m[1]] ?? 0);
    }

    // Scale definitions — semitone intervals from root (0–11)
    const RIFF_SCALES = {
      // ── Western diatonic & modes ──
      'Chromatic':           [0,1,2,3,4,5,6,7,8,9,10,11],
      'Major (Ionian)':      [0,2,4,5,7,9,11],
      'Dorian':              [0,2,3,5,7,9,10],
      'Phrygian':            [0,1,3,5,7,8,10],
      'Lydian':              [0,2,4,6,7,9,11],
      'Mixolydian':          [0,2,4,5,7,9,10],
      'Natural Minor (Aeolian)': [0,2,3,5,7,8,10],
      'Locrian':             [0,1,3,5,6,8,10],
      // ── Minor variants ──
      'Harmonic Minor':      [0,2,3,5,7,8,11],
      'Melodic Minor':       [0,2,3,5,7,9,11],
      'Dorian ♭2 (Phrygian ♮6)': [0,1,3,5,7,9,10],
      'Lydian Augmented':    [0,2,4,6,8,9,11],
      'Lydian Dominant':     [0,2,4,6,7,9,10],
      'Mixolydian ♭6':       [0,2,4,5,7,8,10],
      'Locrian ♮2':          [0,2,3,5,6,8,10],
      'Altered (Super Locrian)': [0,1,3,4,6,8,10],
      // ── Pentatonic & blues ──
      'Pentatonic Major':    [0,2,4,7,9],
      'Pentatonic Minor':    [0,3,5,7,10],
      'Blues':               [0,3,5,6,7,10],
      'Blues Major':         [0,2,3,4,7,9],
      // ── Symmetrical ──
      'Whole Tone':          [0,2,4,6,8,10],
      'Diminished (HW)':     [0,1,3,4,6,7,9,10],
      'Diminished (WH)':     [0,2,3,5,6,8,9,11],
      'Augmented':           [0,3,4,7,8,11],
      // ── Middle Eastern & Mediterranean ──
      'Double Harmonic (Byzantine)': [0,1,4,5,7,8,11],
      'Hungarian Minor':     [0,2,3,6,7,8,11],
      'Hungarian Major':     [0,3,4,6,7,9,10],
      'Phrygian Dominant':   [0,1,4,5,7,8,10],
      'Flamenco':            [0,1,4,5,7,8,11],
      'Arabic (Hijaz Kar)':  [0,2,4,5,6,8,10],
      'Persian':             [0,1,4,5,6,8,11],
      'Enigmatic':           [0,1,4,6,8,10,11],
      'Neapolitan Minor':    [0,1,3,5,7,8,11],
      'Neapolitan Major':    [0,1,3,5,7,9,11],
      // ── Eastern European ──
      'Ukrainian Dorian':    [0,2,3,6,7,9,10],
      'Romanian Minor':      [0,2,3,6,7,9,10],
      'Gypsy (Hungarian)':   [0,1,4,5,7,8,10],
      // ── Asian & world ──
      'Hirajoshi (Japan)':   [0,2,3,7,8],
      'In (Japan)':          [0,1,5,7,8],
      'Insen (Japan)':       [0,1,5,7,10],
      'Iwato (Japan)':       [0,1,5,6,10],
      'Yo (Japan)':          [0,2,5,7,9],
      'Okinawan Rykyu':      [0,4,5,7,11],
      'Pelog (Bali)':        [0,1,3,7,8],
      'Slendro (Java)':      [0,2,5,7,10],
      'Chinese':             [0,4,6,7,11],
      'Mongolian':           [0,2,4,7,9],
      'Egyptian':            [0,2,5,7,10],
      'Balinese':            [0,1,3,7,8],
      // ── Misc & experimental ──
      'Prometheus':          [0,2,4,6,9,10],
      'Acoustic':            [0,2,4,6,7,9,10],
      'Tritone':             [0,1,4,6,7,10],
      'Leading Whole Tone':  [0,2,4,6,8,10,11],
      'Bebop Dominant':      [0,2,4,5,7,9,10,11],
      'Bebop Major':         [0,2,4,5,7,8,9,11],
    };
    const RIFF_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

    // Shift a pitch-class root name by st semitones
    function transposeRoot(root, st) {
      const i = RIFF_NOTE_NAMES.indexOf(root);
      return i === -1 ? root : RIFF_NOTE_NAMES[((i + st) % 12 + 12) % 12];
    }

    // Snap a note name to the nearest note in the given scale semitones (relative to root)
    function snapToScale(noteName, rootName, scaleIntervals) {
      if (!scaleIntervals || scaleIntervals.length === 12) return noteName; // chromatic = pass through
      const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
      const m = noteName.match(/^([A-Ga-g][#b]?)(\d+)$/);
      if (!m) return noteName;
      const notePC = NM[m[1]] ?? 0;
      const oct = parseInt(m[2]);
      const rootPC = NM[rootName] ?? 0;
      // Semitone offset from root (mod 12)
      const offset = ((notePC - rootPC) % 12 + 12) % 12;
      // Find nearest scale interval
      let best = scaleIntervals[0], bestDist = 12;
      for (const si of scaleIntervals) {
        const d = Math.min(Math.abs(si - offset), 12 - Math.abs(si - offset));
        if (d < bestDist) { bestDist = d; best = si; }
      }
      // Reconstruct note name
      const snappedPC = (rootPC + best) % 12;
      return RIFF_NOTE_NAMES[snappedPC] + oct;
    }

    // Mark keyboard keys as in/out of scale
    function applyScaleToKeyboard(kbdEl, rootName, scaleIntervals) {
      if (!kbdEl) return;
      const NM = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
      const rootPC = NM[rootName] ?? 0;
      const isChromatic = !scaleIntervals || scaleIntervals.length === 12;
      kbdEl.querySelectorAll('.sk-key-white, .sk-key-black').forEach(k => {
        const nm = k.dataset.note?.match(/^([A-Ga-g][#b]?)/);
        if (!nm) return;
        const pc = NM[nm[1]] ?? 0;
        const offset = ((pc - rootPC) % 12 + 12) % 12;
        const inScale = isChromatic || scaleIntervals.includes(offset);
        k.classList.toggle('sk-out-scale', !isChromatic && !inScale);
      });
    }

