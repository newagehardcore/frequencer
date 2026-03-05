# FREQUENCER

**A browser-based multi-sample looper canvas**

Load audio samples, position them in 2D space, and let them loop — volume controlled by vertical position, stereo pan by horizontal. Each sample gets its own color, waveform, playhead, and edit card. No installation. No plugins. Open in any modern browser.

---

## Quick Start

### Local (recommended)

**Mac / Linux:**
```bash
cd frequencer/
chmod +x setup.sh
./setup.sh
```

**Windows:**
```
Double-click setup.bat
```

This downloads Tone.js (~1.5MB) into the folder and opens `index.html` in your browser. After that first setup, just open `index.html` directly — no internet needed.

### Manual setup (if the scripts don't work)

1. Download **Tone.js 14.8.49** from:  
   `https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js`
2. Place `Tone.js` in the same folder as `frequencer.html`
3. Open `index.html` in Chrome, Firefox, or Safari

> **Note:** Opening `index.html` directly as a `file://` URL works in most browsers. If you see audio errors in Chrome, try launching Chrome with `--allow-file-access-from-files`, or serve locally with `python3 -m http.server` and open `http://localhost:8000`.

---

## What It Does

FREQUENCER is a **freeform spatial looper**. You drag audio samples onto a 2D canvas. Where you place them determines how they sound:

- **Vertical position → Volume.** Top of canvas = +6 dB. Bottom = silence (–60 dB). The curve is gradual — most of the canvas is audible range, only the bottom ~12% fades to silence.
- **Horizontal position → Stereo pan.** Left edge = hard left. Right edge = hard right. Center = mono.

Every sample loops continuously. You build a mix by arranging samples in space, dragging them up/down to balance volumes and left/right to place them in the stereo field.

---

## Getting Started

### 1. Initialize Audio

When you open the app you'll see the **FREQUENCER** splash screen. Click **"Initialize Audio"** — this is required by browsers before any Web Audio can play. It only happens once per session.

### 2. Load Samples

Three ways to load audio:

| Method | How |
|--------|-----|
| **Drag & drop** | Drag audio files or folders directly onto the canvas |
| **Import button** | Click `+ Import` in the header to open a file picker |
| **Folder drop** | Drop a folder — FREQUENCER recursively finds all audio files inside |

**Supported formats:** WAV · MP3 · OGG · FLAC · AIFF · AIF · M4A · Opus · WebM · WEBA

Each sample **auto-plays immediately** when loaded. It appears as a colored tile on the canvas and begins looping.

### 3. Arrange

Drag tiles anywhere on the canvas. The audio updates in real-time as you drag — you hear the volume and pan change as you move.

---

## The Canvas

```
+6 dB ─────────────────────────────── +6 dB
│                                         │
│          [ SAMPLE A ]                   │
│                   [ SAMPLE B ]          │
│                                         │
│     [ SAMPLE C ]                        │
│                                         │
-inf · L pan ─────────────── R pan · -inf
```

The faint crosshair lines mark the center point (0 dB, center pan).

---

## Sample Tiles

Each sample is a small colored card showing:

- **Waveform** — drawn in the sample's color, amplitude-modulated (louder peaks are brighter)
- **Playhead line** — a vertical line in the sample's color that sweeps through the waveform in sync with audio playback
- **GRID badge** — appears when grid sync is enabled
- **Name label** — filename (without extension), bottom of tile

**Colors** are assigned automatically: red, blue, green, yellow, orange, magenta, cyan, then hot pink, violet, spring green, etc. Every sample gets a distinct pure saturated color.

### Tile Interactions

| Action | Result |
|--------|--------|
| **Click** | Open the sample's edit card |
| **Right-click** | Also opens the edit card |
| **Double-click** | Toggle play / stop for this sample |
| **Drag** | Move sample — volume and pan update live |

---

## The Edit Card

Click any tile to open its **floating edit card** — a small window that appears just below the tile containing all controls for that sample.

The card's border glows in the sample's color. Close it with **✕** or click elsewhere on the canvas.

### Playback Section

| Control | Function |
|---------|----------|
| **▶ Play** | Start looping this sample |
| **■ Stop** | Stop this sample |
| **Mute toggle** | Silence the sample without stopping it (tile fades out) |
| **Solo toggle** | Mute all other samples — only this one is heard |

### Pitch Shift

Shift the pitch up or down in **semitones** (–24 to +24). The sample plays at the same speed but transposed. 12 semitones = one octave.

### Loop Points

Set the **start** and **end** points of the loop region. Values are 0.0–1.0 (normalized position in the file).

- Drag the **white handles** on the waveform directly, or use the sliders
- The shaded region on the waveform shows the active loop
- Time values are shown in seconds below the waveform

Only the region between start and end loops. This is non-destructive — the original file is untouched.

### Fades

Per-sample fade controls. Open the edit card to access them.

| Control | Function |
|---------|----------|
| **Attack** | Fade in from silence at the start of each loop iteration |
| **Release** | Fade out to silence at the end of each loop iteration |
| **Crossfade** | Smooth the loop boundary — end fades out while start fades in simultaneously, constant amplitude |

Fades use equal-power curves (no audible dip in the middle of a crossfade).

**Crossfade vs. Attack/Release:** These are mutually exclusive. Enabling crossfade disables attack and release, and vice versa. Crossfade is for making seamless loops; attack/release are for shaping the volume envelope.

**Crossfade implementation:** Two audio players overlap at the loop boundary — one fades out while the other fades in. The audio never goes silent at the wrap point. The waveform displays gradient overlays showing the crossfade region on each handle.

**With grid sync:** The release fade ends exactly at the subdivision boundary (the end handle is locked to that position — see below).

### Grid Sync

Lock the sample to the global tempo.

| Setting | Behavior |
|---------|----------|
| **Sync to Tempo: off** | Sample loops freely, unrelated to BPM |
| **Sync to Tempo: on** | Sample triggers on grid boundaries, quantized to the subdivision |

**Subdivide** — how often the sample re-triggers:
- `1 Bar` — once per bar
- `½` — every half note
- `¼` — every quarter note (default)
- `⅛` — every eighth note
- `1/16` — every sixteenth note

**Overflow** — what happens if the sample is longer than the subdivision:
- `Wait` — sample plays to its end, then silence until the next grid hit
- `Cut` — sample is hard-cut at the subdivision boundary and restarted

When grid sync is active, multiple synced samples snap to the same grid clock — they start together on subdivision boundaries.

**End handle locking:** When grid sync is turned on, the end loop handle automatically snaps to the subdivision boundary (start + one subdivision length) and becomes non-adjustable. This keeps the release fade and loop end perfectly aligned with the grid. The start handle remains freely movable; moving it re-snaps the end handle to the new position + subdivision. Changing the subdivision also re-snaps the end handle immediately.

### FX Rack

At the bottom of each edit card is a row of effect buttons. Click any button to add an instance of that effect to the chain. Effects are stacked in the order they were added — the chain runs left-to-right, top-to-bottom.

| Button | Effect |
|--------|--------|
| **EQ** | 5-band parametric EQ (HP, 3× peaking, LP) |
| **REV** | Reverb — Decay, Pre-delay, Wet |
| **DLY** | Delay — Time or tempo-synced subdivision, Feedback, Wet |
| **TRM** | Tremolo — Rate, Depth, Wet |
| **DST** | Distortion — Drive, Wet |
| **CHR** | Chorus — Rate, Delay, Depth, Wet |
| **PHS** | Phaser — Rate, Octaves, Base Hz, Wet |
| **BIT** | Bit Crusher — Bits (1–16), Wet |

**Multiple instances:** clicking a button always adds a new instance at the end of the chain, regardless of whether one already exists. You can stack, e.g., two reverbs or three EQs.

**Removing an instance:** click the **✕** in the top-right of any effect panel.

**EQ panel:** drag the band handles horizontally to change frequency, vertically to change gain (peaking bands only). Scroll over a handle to adjust its Q. **Clear** resets all bands to flat. The frequency response curve updates in real time.

**Delay sync:** in the Delay panel, click **FREE** to toggle to **TEMPO** mode. The Time slider is replaced by subdivision buttons (1/1 · 1/2 · 1/4 · 1/8 · 1/8T · 1/16 · 1/16T) that lock the delay time to the global BPM. Click **TEMPO** to switch back to FREE.

### Remove

Permanently removes the sample from the session. The tile disappears and the audio chain is freed.

---

## Transport (Footer Bar)

The footer at the bottom of the screen contains global playback controls.

| Control | Function | Keyboard |
|---------|----------|----------|
| **▶ Play** | Start transport + play all samples | `Space` |
| **■ Stop** | Stop transport + stop all samples, reset position | `.` (period) |
| **BPM** | Global tempo (20–300). Drag up/down to change. Double-click to type | — |
| **Position** | Current playback position as `bar.beat.tick` | — |
| **Metro** | Toggle metronome click (audible + visual flash dot) | — |
| **Samples** | Count of loaded samples | — |

**BPM notes:**
- Drag the BPM number up to increase, down to decrease (0.5 BPM per pixel)
- Double-click to type an exact value, press Enter to confirm
- Changing BPM affects all grid-synced samples immediately

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause all |
| `.` | Stop all (resets position to bar 1) |
| `Escape` | Close edit card |

---

## Audio Engine Details

FREQUENCER uses the **Web Audio API** via **Tone.js 14.8.49**.

Each sample has its own audio chain:

```
AudioBuffer
    │
    ├──► Tone.Player ──► Tone.Gain (fadeGain) ──┐
    │                                            │
    └──► Tone.Player ──► Tone.Gain (xfGain)  ───┤  (crossfade second player)
                                                 │
                                                 ▼
                                         Tone.PitchShift  (semitone shifting, ±24st)
                                                 │
                                                 ▼
                                      5× Tone.Filter  (parametric EQ, always in chain)
                                                 │
                                                 ▼
                                      FX chain  (dynamic, ordered by panel position)
                                      ┌──────────────────────────────────────┐
                                      │  Reverb / Delay / Tremolo / Dist /   │
                                      │  Chorus / Phaser / BitCrusher / EQ   │
                                      │  ... zero or more instances          │
                                      └──────────────────────────────────────┘
                                                 │
                                                 ▼
                                         Tone.Panner  (stereo pan, –1 to +1)
                                                 │
                                                 ▼
                                         Tone.Volume  (dB gain, +6 to –60)
                                                 │
                                                 ▼
                                         AudioContext Destination
```

The second player (`xfGain`) is only active during crossfade transitions. For attack/release, fades are baked directly into a copy of the `AudioBuffer` — the loop plays via a single player with no gain automation needed.

**Volume curve:** The Y-axis maps to dB using a power curve — linear dB over most of the canvas height, with the silent floor pushed to the bottom ~12%. This gives you smooth, usable control across the whole range.

**Grid sync mechanism:** Uses `Tone.Transport.scheduleRepeat()` — fires on exact Transport grid boundaries. Multiple synced samples lock to the same clock and start together. The playhead uses `AudioContext.currentTime` directly (not Tone's lookahead time) for pixel-accurate visual sync.

**Playhead accuracy:** The playhead position is computed from the raw `AudioContext.currentTime` minus the exact time the player was started — no lookahead offset, so the visual line matches what you're hearing.

---

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome / Chromium | ✅ Fully supported |
| Firefox | ✅ Fully supported |
| Safari (macOS / iOS) | ✅ Supported (may require one extra click to unlock audio) |
| Edge | ✅ Fully supported |
| Opera | ✅ Fully supported |

**File access note:** Some browsers restrict Web Audio when opening local `file://` URLs. If you encounter issues, serve the folder locally:

```bash
# Python 3
python3 -m http.server 8080
# then open: http://localhost:8080

# Node.js (if installed)
npx serve .
# then open: http://localhost:3000
```

---

## File Structure

```
frequencer/
├── index.html      ← The entire app (single file, ~3700 lines)
├── Tone.js         ← Audio engine (downloaded by setup script)
├── setup.sh        ← Mac/Linux setup & launch script
├── setup.bat       ← Windows setup & launch script
└── README.md       ← This file
```

The app is entirely self-contained in `index.html`. If you want to share it or use it online, you can also swap the local `./Tone.js` reference back to the CDN URL:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js"></script>
```

---

## Tips & Workflow Ideas

**Building a loop:** Load 4–8 samples, enable grid sync on all of them at the same subdivision (e.g. 1 Bar). They'll all lock to the same clock and loop together in time.

**Live mixing:** Drag samples up and down while playing to fade them in and out. The volume curve is smooth enough to do expressive real-time mix moves.

**Trimming samples:** Open a sample's edit card and drag the loop handles to isolate just the part you want. Good for cutting out silence at the start or isolating a single hit.

**Pitch layering:** Load the same sample multiple times, pitch-shift each to a different interval (+0, +7, +12 semitones = root, fifth, octave), and position them close together in the canvas.

**Stereo width:** Spread related samples left and right to create a wide stereo image. Drums and bass usually sound best centered; melodic content can be panned.

**Solo monitoring:** Use the Solo toggle in the edit card to hear a single sample in isolation while you set its loop points precisely.

**FX chaining:** Add effects in signal-flow order — EQ first to shape tone, then dynamics/time-based effects (reverb, delay), then modulation (chorus, phaser, tremolo). Stack multiple instances of the same effect for stronger processing. Use the ✕ button to remove any instance without affecting others.

---

## Limitations (v1)

- **No save/load** — sessions are not persisted. Refreshing the page clears everything.
- **No audio export** — cannot bounce or record the output.
- **No undo** — changes to loop points and pitch are immediate.
- **No MIDI** — tempo and playback are not MIDI-syncable.
- **No effects persistence** — FX chain instances are not saved; reopening the page resets all effects.
- **No automation** — volume and pan are set by position, not automatable over time.

---

## Credits

Built with:
- [Tone.js](https://tonejs.github.io/) — Web Audio framework by Yotam Mann
- Web Audio API — browser-native audio processing
- Vanilla JavaScript + Canvas API — no frameworks

---

*FREQUENCER — drag samples, make loops.*
