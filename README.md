# FREQUENCER

A browser-based multi-sample spatial looper. Drag audio files onto a 2D canvas — vertical position controls volume, horizontal position controls stereo pan. Every sample loops continuously. Open `index.html` in any modern browser.

---

## Canvas

- **Y axis → Volume.** Top = +6 dB, bottom = silence.
- **X axis → Stereo pan.** Left edge = hard left, right edge = hard right.

Drag tiles anywhere; audio updates in real time.

---

## Loading Samples

Drag audio files or folders onto the canvas, or click `+ Import`. Supported: WAV · MP3 · OGG · FLAC · AIFF · M4A · Opus · WebM. Samples auto-play on load.

---

## Sample Tiles

Each tile shows a color-coded waveform, a live playhead, and a stereo VU meter. A master VU meter sits in the header.

| Interaction | Result |
|-------------|--------|
| Click | Open edit card |
| Double-click | Toggle play / stop |
| Drag | Move — volume and pan update live |

---

## Edit Card

Click a tile to open its floating edit card. Multiple cards can be open at once.

**Playback** — Play, Stop, Mute, Solo, Reverse (plays buffer backwards).

**Pitch Shift** — ±24 semitones, pitch only (speed unchanged).

**Timestretch** — ±24 semitones of playback rate (changes speed and pitch together).

**Loop Points** — drag white handles on the waveform, or use the **Start** and **End** sliders (full file range, in seconds). The waveform can be zoomed and panned by dragging (drag vertically to zoom, horizontally to pan; double-click to reset).

**File Position** — sets where playback begins each loop iteration. In free mode it acts as a one-time start offset, applied on the next loop boundary. In Grid Sync mode it shifts the playhead start within the grid period without interrupting playback — the new value is picked up silently on the next subdivision trigger.

**Fades** — Attack, Release, or Crossfade (equal-power). Crossfade and Attack/Release are mutually exclusive.

**Grid Sync** — Lock the sample to the global transport:
- Subdivision: `1 Bar · ½ · ¼ · ⅛ · 1/16`
- Dotted (`Dot` button = ×1.5) or triplet (`3let` button = ×⅔) variants
- Grid multiplier: `÷2` fires every other hit, `÷3` every third
- Overflow: `Wait` or `Cut`
- End handle auto-snaps to the subdivision boundary when sync is on
- Loop point and file position changes take effect on the next subdivision — playback is never interrupted mid-loop

**FX Rack** — add unlimited instances of any effect. Each effect panel has a **PRE/POST** toggle (defaults to POST) that routes the effect either before or after the volume/pan fader. Click ✕ to remove.

| Button | Effect |
|--------|--------|
| EQ | 5-band parametric (HP, 3× peaking, LP) |
| REV | Reverb — Decay, Pre-delay, Wet |
| DLY | Delay — Free or tempo-synced, Feedback, Wet |
| TRM | Tremolo — Rate, Depth, Wet |
| DST | Distortion — Drive, Wet |
| CHR | Chorus — Rate, Delay, Depth, Wet |
| PHS | Phaser — Rate, Octaves, Base Hz, Wet |
| BIT | Bit Crusher — Bits (1–16), Wet |

**Remove** — permanently deletes the sample from the session.

---

## Step Sequencer

Add step sequencers to your canvas to trigger samples rhythmically. Connect them to one or more samples via wires.

- **Steps** — 1 to 16 steps per pattern. Each step button toggles on/off. The active step is highlighted in real time, in sync with the audio.
- **Gate** — controls how much of the sample plays each step. At 100% the full loop region plays (capped to the loop end); lower values chop it shorter. The slider uses a curved scale for fine control at short durations.
- **Subdivisions** — lock to the global transport grid: `1 Bar · ½ · ¼ · ⅛ · 1/16 · 1/32` and triplet variants.
- **Grid Sync** — when on, step timing locks to the global BPM and subdivision. When off, use the **Rate** slider to set a free-running step interval in seconds.
- **Wires** — drag from the sequencer port onto a sample tile to connect. A step sequencer can drive multiple samples simultaneously. Cables draw to the waveform on open edit cards.
- **LFO Targeting** — LFO wires can connect to the **Steps** or **Gate** sliders on a sequencer node to modulate pattern length or gate amount over time.
- **Organization** — Minimize, Duplicate, or Delete from the sequencer header.

---

## LFO Modulator System

Add LFOs to your canvas to modulate any sample parameter (Pitch, Stretch, Volume, Pan, Loop Points, or FX parameters).

- **Presets** — Sine, Square, Triangle, Random, and Blank (flat line).
- **Custom Shapes** — Click to add breakpoints, Shift + Click to remove. Drag to reshape.
- **Modulation Wires** — Drag from the LFO port onto any parameter slider or the **EQ canvas** in a sample card to create a link.
- **EQ Sweeping** — Dropping a wire on the EQ canvas targets the nearest frequency band for rhythmic filter sweeps.
- **FX Instance Targeting** — Modulate parameters of specific effect instances in your rack independently.
- **Range Control** — Set Min/Max boundaries for each modulation target.
- **Sync** — Free-running (seconds) or locked to the project grid (bars/subdivisions).
- **Organization** — Minimize (compact tile view), Duplicate (clone all settings), or Delete.
- **Visual Feedback** — Sample tiles physically move across the canvas when Volume or Pan are modulated (while cards are closed). Animated EQ curves and handles show active modulation in real time.

---

## Transport

| Control | Function | Key |
|---------|----------|-----|
| ▶ Play | Start transport + all samples | `Space` |
| ■ Stop | Stop + reset to bar 1 | `.` |
| BPM | Drag up/down or double-click to type | — |
| Metro | Toggle metronome click | — |
| ⏺ Rec | Record all stems + stereo mix to WAV | — |

**Recording** — press Rec to start, press again to stop. A modal offers: stereo mix only, stems ZIP only, or both.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `.` | Stop (reset to bar 1) |
| `Escape` | Close edit card |

---

## Audio Chain (per sample)

```
AudioBuffer → Player(s) → PitchShift → EQ (5 bands) → [Pre-fader FX] → Panner → Volume → [Post-fader FX] → Output
```

A second player (`xfPlayer`) handles crossfade transitions and, in Grid Sync mode, the wrapped portion of a loop when File Position is offset from the loop start. Fades without crossfade are baked into the buffer directly.

---

## Sample List

A small monospace list in the bottom-right corner of the canvas (left of the master VU meter) shows all loaded samples. Names are capped at 20 characters. Grey = card closed; white = card open. Click any name to open or close that sample's edit card.

