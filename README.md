# FREQUENCER

A browser-based multi-instrument looper built on a scrollable 2D canvas. Layer samples, synths, drum machines, chord progressions, and melodic riffs, all in sync with a global transport. Connect modules with patch cables to route sequences and modulation between them.

---

## Running Locally

The app requires a local HTTP server (browsers block multi-file JS over `file://`).

```bash
python3 -m http.server 8080 --directory ~/Desktop/frequencer
```

Then open `http://localhost:8080`.

For **GitHub Pages / any web host**, just deploy the folder as-is — no build step needed.

---

## Project Structure

```
frequencer/
├── index.html          ← HTML shell (~150 lines)
├── css/
│   ├── base.css        ← Reset + CSS variables
│   ├── layout.css      ← Drop overlay, header, canvas, empty state
│   ├── tiles.css       ← Sample / synth / drum tiles
│   ├── cards.css       ← Sample edit cards, sliders, EQ, FX chain
│   ├── modals.css      ← Recording modal, Paulstretch overlay
│   ├── lfo.css         ← LFO nodes
│   ├── synth.css       ← Synth cards, piano keyboard, wavetable UI
│   └── drums.css       ← Drum machine card
└── js/
    ├── constants.js    ← All globals, maps, color palettes
    ├── sequencers.js   ← RiffSequencer, ChordsSequencer, LFO classes + chord AI
    ├── audio-unlock.js ← AudioContext init (ensureAudio)
    ├── granular.js     ← GranularEngine class
    ├── sample.js       ← Sample class (audio chain, playback, tile/card management)
    ├── presets.js      ← Analog presets, DX7 presets, wavetable engine
    ├── instruments.js  ← SynthInstrument base + AnalogSynth, FMSynth, Wavetable,
    │                      KarplusSynth, Rompler, DrumMachine
    ├── tile-ui.js      ← Tile + waveform + VU drawing, color helpers
    ├── phloop.js       ← requestAnimationFrame loop (playheads, VU, grain viz)
    ├── import.js       ← File import and drag-drop position logic
    ├── playback.js     ← startSample, removeSample, removeSynth
    ├── synth-cards.js  ← Synth and drum card UI
    ├── sample-cards.js ← Sample edit card UI
    ├── transport.js    ← Play / stop / BPM, MidiCapture
    ├── recording.js    ← Stem and mix recording
    ├── save-load.js    ← saveProject / loadProject
    ├── paulstretch.js  ← Web Worker time-stretcher
    ├── lfo-nodes.js    ← LFO node UI creation
    ├── riff-nodes.js   ← Riff node UI creation
    ├── chords-nodes.js ← Chords node UI creation
    ├── wiring.js       ← Wire drawing (LFO/Riff/Chords → tiles), modulation tick, port position calculation
    ├── events.js       ← Drag-drop + keyboard handlers
    └── main.js         ← Init

---

## Canvas

The canvas is a scrollable 10,000 × 8,000 px world. All tiles, edit cards, and module nodes are `position: absolute` within it — they all scroll together as one unified space.

Volume and pan are controlled exclusively by the **MIXER** sliders on each module's edit card. Tile position on the canvas has no effect on audio routing.

Drag any tile or node to reposition it freely within the world.

---

## Loading Samples

Drag audio files or folders onto the canvas, or click `+ Import`. Supported: WAV · MP3 · OGG · FLAC · AIFF · M4A · Opus · WebM. Samples auto-play on load.

---

## Sample Tiles

Each tile shows the sample's waveform in its assigned color, a white live playhead, and a stereo VU meter. A master VU meter sits fixed in the lower right. The app uses a monochrome (black and white) visual style — only waveforms carry color.

| Interaction | Result |
|-------------|--------|
| Click | Open edit card |
| Double-click | Toggle play / stop |
| Drag | Reposition tile on the canvas |

**Tile buttons** — each tile has `M` (mute) and `S` (solo) buttons for quick mixing without opening a card.

---

## Edit Card

Click a tile to open its floating edit card. Multiple cards can be open at once. Cards live inside the canvas world (not fixed to the viewport) and scroll with everything else. Dragging a card also moves its tile, keeping them co-located.

**Playback modes** (row above the waveform):

| Mode | Behaviour |
|------|-----------|
| LOOP | Loops the loop region continuously (default) |
| REV | Plays the loop region in reverse, continuously |
| GRAN | Granular synthesis (see Granular Mode below) |
| TRIG | Waits for a sequencer trigger — plays on demand only |

In **TRIG** mode the sample stops looping and waits silently. Connecting a step sequencer wire automatically switches the sample to TRIG and drives it from the sequencer.

**Controls** — Play · Stop · Mute · Solo

Parameters are grouped into collapsible accordion sections:

**PLAYBACK** — Loop start/end handles and sliders, File Position, and Grid Sync settings.
- *Loop Points* — drag handles on the waveform or use the Start/End sliders. Waveform supports zoom (drag vertically) and pan (drag horizontally); double-click to reset.
- *File Position* — start offset within the loop region. In Grid Sync mode applies silently on the next subdivision.
- *Grid Sync* — lock to BPM: `1 Bar · ½ · ¼ · ⅛ · 1/16 · 1/32`, with Dot (×1.5) and 3let (÷1.5) variants; `÷2` / `÷3` multipliers skip every other or every third trigger.

**MIXER** — Volume and Pan.

**ENVELOPE** — Attack, Release, Crossfade (equal-power).

**PITCH+TIME** — Pitch Shift (±24 st, speed unchanged) · Timestretch (±24 st, changes speed and pitch) · Paulstretch (extreme slow-down) · Warp (BPM-aware time stretch, see below).

**EFFECTS** — FX rack. Add unlimited effect instances; each has a PRE/POST fader toggle.

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

## Tempo Sync

Each sample card has a **SYNC** button (Play · Stop · **SYNC** · M · S row) with two modes selectable via **ANA** / **DIG** toggle buttons below:

| Mode | Behaviour |
|------|-----------|
| **ANA** (Analog) | Detects the loop region's BPM, then adjusts `playbackRate` to match the project tempo — pitch rises/falls with speed, like a record speeding up or slowing down. Zero artifacts, zero latency. |
| **DIG** (Digital) | Detects BPM, then time-stretches the loop region pitch-preservingly (phase vocoder) to match the project tempo. Pitch stays constant; timing changes. |

**Workflow:**
1. Set loop start/end around the rhythmic region.
2. Choose ANA or DIG.
3. Click **SYNC** — BPM is auto-detected and the sample locks to the project tempo.
4. Changing the project BPM updates synced samples in real time (ANA: instant rate update; DIG: re-stretch after 450 ms debounce).
5. Adjusting the loop region automatically clears sync; click SYNC again to re-analyze.

Sync state is saved with the project. Digital mode bakes the stretched audio into the session file.

---

## Grid Sync

The **Grid** button in the PLAYBACK section locks a sample's loop to the global transport so it always restarts on a bar boundary, phase-locked with drums, sequencers, and other synced modules.

### Subdivisions

| Setting | Description |
|---------|-------------|
| **Sample** | Loop length is rounded up to the nearest whole bar. The sample plays its full region; any gap before the next bar is silence. Switching back to Sample always restores the full loop region. |
| **1 Bar · ½ · ¼ · ⅛ · 1/16 · 1/32** | Fixed grid period. The loop end is auto-snapped to exactly fill the chosen subdivision. |
| **Dot (·)** | Multiplies the subdivision by ×1.5 (e.g. dotted quarter = 3/8). |
| **3let (T)** | Divides by 1.5 (triplet). |
| **÷2 / ÷3** | Fire only on every 2nd or 3rd grid trigger — useful for half-time or polyrhythmic patterns. |

Subdivision changes take effect immediately without waiting for the next downbeat.

### Nudge

A ±500 ms nudge slider shifts the sample's firing phase relative to the bar grid. Use it to dial in swing, pre-delay, or offset patterns that intentionally drift from bar 1.

### How It Works

When Grid is active the sample fires via the global transport scheduler. Each repeat fires at the next quantization boundary; the PitchShift latency (~100 ms) is pre-compensated so audio exits the chain exactly on the beat. Loops use WebAudio's native loop splice point for sample-accurate boundaries with no gap or click. The visual playhead wraps continuously using the same timing math as the audio, so it stays tight even across loop boundaries.

Sync and Grid are independent: you can use Grid without Sync (free tempo), Sync without Grid (BPM-matched but free-running loop), or both together for a fully locked loop. When Sync is activated on a sample that has Grid off, Grid is automatically enabled.

---

## Granular Mode

Activate with the **GRAN** playback mode button. The loop region becomes the grain source.

| Slider | Description |
|--------|-------------|
| Position | Center position of grain playback within the loop region |
| Spread | Random scatter of grain start points around Position |
| Density | Grain trigger rate — low = sparse (~500ms), high = dense (~15ms) |

- Pitch and stretch settings from **PITCH+TIME** also apply to the granular engine.
- All three controls are LFO-targetable for evolving textures.
- A cloud visualization on the card waveform shows grain positions in real time.

---

## Step Sequencer

Add step sequencers to the canvas via `+ Seq`. Connect them to samples via wires.

- **Steps** — 1 to 16 steps per pattern. Each step toggles on/off. The active step is highlighted in sync with the audio.
- **Gate** — controls how much of the sample plays each step. Curved scale for fine control at short durations.
- **Subdivisions** — `1 Bar · ½ · ¼ · ⅛ · 1/16 · 1/32` and triplet variants.
- **Grid Sync** — lock to BPM, or use the **Rate** slider for a free-running interval in seconds.
- **Wires** — drag from the sequencer's output port onto any sample or synth tile to connect. A sequencer can drive multiple instruments simultaneously.
- **LFO Targeting** — LFO wires can modulate the **Steps** or **Gate** sliders of a sequencer.
- **Organization** — Minimize, Duplicate, or Delete from the sequencer header.

---

## LFO Modulator System

Add LFOs to the canvas via `+ LFO`. Modulate any sample parameter (Pitch, Stretch, Volume, Pan, Loop Points, or FX parameters).

- **Presets** — Sine, Square, Triangle, Random, and Blank (flat line).
- **Custom Shapes** — Click to add breakpoints, Shift + Click to remove. Drag to reshape.
- **Modulation Wires** — Drag from the LFO port onto any parameter slider, the **EQ canvas**, or directly onto a **module tile** (connects to volume). Wire endpoints always track to the tile's input port regardless of whether the edit card is open or closed.
- **EQ Sweeping** — Dropping a wire on the EQ canvas targets the nearest frequency band for filter sweeps.
- **Range Control** — Set Min/Max boundaries per modulation target.
- **Sync** — Free-running (seconds) or locked to the project grid (bars/subdivisions).
- **Visual Feedback** — Animated EQ curves and handles show active modulation in real time. Slider values update live during LFO playback.
- **Organization** — Minimize, Duplicate, or Delete.

---

## Synth Instruments

Add synthesizers to the canvas via the `+ Synth` footer button. Click the type dropdown in the card titlebar to switch between the five synth types at any time.

All synth types share: **MIXER** (volume, pan), **GLIDE** (portamento 0–1 s), **EFFECTS** rack, a 2-octave mouse-playable keyboard (C3–B4), and mute/solo controls consistent with sample tiles. Synth cards are draggable and support Duplicate and Remove.

**Glide** works in both the keyboard and the Riff step sequencer, and is LFO-targetable.

### Analog

Polyphonic subtractive synthesizer.

- **Oscillator** — Sine, Triangle, Sawtooth, Square, Pulse
- **ADSR envelope** — Attack, Decay, Sustain, Release
- **Filter** — LP / HP / BP with Frequency and Q controls
- **Presets** — built-in preset library; load/save custom patches

### FM

Frequency-modulation synthesizer with a built-in library of 32 DX7-style presets.

- **FM Parameters** — Harmonicity (carrier:modulator ratio), Modulation Index
- **Carrier & Modulation envelopes** — independent ADSR for each
- **Preset library** — 32 classic DX7 patches; load custom banks via SysEx `.syx` files

### Wavetable

Dual-oscillator wavetable synthesizer using looped audio buffers.

- **Wave select** — choose from the built-in wavetable bank
- **Detune** — two independent detune amounts across osc pairs
- **Stereo Width** — spread between oscillator pairs
- **Filter** — cutoff, resonance, and filter envelope (Amount, Attack, Decay)
- **ADSR envelope**

### Karplus-Strong

Physical-modeling string synthesis.

- **String Damping / Variation** — controls decay and timbre randomness
- **Pluck Damping / Variation** — shapes the attack transient
- **Tension** — string stiffness
- **Stereo Spread** — width of the pluck

### Rompler

Sample-based synthesizer using the Soundfont library format.

- **Soundfont** — choose from built-in GM instruments, or load a custom `.sf2` file via URL
- **Filter** — LP filter with cutoff and resonance
- **Release** — note release time

---

## Drum Machine

Add a drum machine to the canvas via `+ Drum Machine`. Each instance is a standalone 6-lane step sequencer with sample-based kits.

### Lanes

Six lanes: **Kick · Snare · Hi-Hat · Tom 1 · Tom 2 · Tom 3**.

### Step Grid

- **Steps** — 4 to 64 steps per pattern, configurable with the +/− buttons.
- **Velocity** — each step cycles through Off → Soft → Accent (left-click to advance, right-click to go back). Soft and Accent hits are visually distinguished.
- **Per-lane pitch** — a ±12 semitone pitch slider sits next to each lane for tuning individual drums.

### Kits

15 sample kits sourced from the [Web Audio Samples](https://googlechromelabs.github.io/web-audio-samples/) library:

Roland R-8 · Roland CR-78 · Korg KPR-77 · LinnDrum · Kit 3 · Kit 8 · Techno · Stark · Breakbeat 8 · Breakbeat 9 · Breakbeat 13 · Acoustic Kit · 4OP-FM · Cheebacabra 1 · Cheebacabra 2

Switch kits at any time; samples stream and cache on demand.

### Transport

- **Grid Sync** — lock step timing to the global BPM at the selected subdivision (`32n · 16n · 8n · 4n`).
- **Free mode** — use the BPM slider to set an independent tempo (20–400 BPM).
- **CLR** — clear all steps across all lanes.

### Mixer & Effects

Volume, Pan, and the full shared FX rack (EQ, Reverb, Delay, Tremolo, Distortion, Chorus, Phaser, Bit Crusher).

---

## Chord Sequencer

Add a chord sequencer to the canvas via `+ Chords`. Programs chord progressions that drive connected synths and samplers.

### Step Grid

Up to 16 steps. Each step shows the chord name and a velocity bar. Click a step to select it; click again to enable/disable. Steps can be expanded with the +/− controls.

### AI Chord Suggestions

When a step is selected, an inline suggestions panel appears with chord recommendations generated by the **chord-seq-ai** model (ONNX Runtime, lazy-loaded on first use). Suggestions are conditioned on:

- The chord(s) already in the sequence (context-aware progressions)
- **Genre** filter — Any · Rock · Folk · Pop · Soundtrack · R&B/Soul · Country · Jazz · Experimental · Reggae · Hip Hop · Electronic · Metal · Blues · Classical
- **Era** filter — Any · 1950s through 2020s

Click any suggestion to set it on the selected step.

### Scale & Root

Select a root note and scale (55+ options, shared with the Riff module). All chords snap to the scale. **Oct ▼▲** and **Semi ▼▲** buttons transpose the entire progression; the current offset is shown in semitones.

### Voicing

- **Voicing slider** — Drop2 · Drop1 · Root · Inv1 · Inv2 (controls chord inversion and voicing spread)
- **VL (Voice Leading)** checkbox — enables smooth voice leading between steps

### Playback Modes

| Mode | Behaviour |
|------|-----------|
| Off | Chords trigger as block voicings on each step |
| Strum | Notes roll across the chord; Speed and Direction (↓ ↑ ↕ ?) are configurable |
| Arp | Arpeggiated playback with Rate, Octave range (1–4), Mode (Up/Down/Up-Down/Random/Order/Thumb), Hold, and Step Arp |

**Step Arp** — enables a custom rhythmic gate pattern within the arp, with its own step count.

### Grid & Subdivisions

- **Grid** — lock to BPM at the selected subdivision (`1 bar · ½ · ¼ · ¼. · ⅛ · ⅛. · 1/16`), or **free** mode with a rate slider.
- **Wires** — drag from the wire port onto a synth or sampler tile to connect. A chord sequencer can drive multiple instruments simultaneously.
- **Organization** — Minimize (compact tile view), Duplicate, or Delete.

---

## Riff Sequencer

Add melodic step sequencers to the canvas via `+ Riff`. Each riff connects to synths or samplers via wires and loops a melodic pattern in sync with the transport.

### Step Grid

Up to 64 steps in an 8-column grid. Each step shows its note name and a velocity bar (drag up/down to adjust velocity).

- **Rec Pattern** — pattern record mode; requires transport to be playing. Notes played on the keyboard are written to whichever step is currently playing (quantized to the selected subdivision). Existing notes are overwritten.
- **Rec Step** — step-entry mode; each note played on the keyboard writes to the cursor step and advances automatically. Use `← →` to move the cursor, `R` to skip a step without writing a note.
- **Shift ◀ ▶** — rotate the entire pattern left or right by one step
- **Clear** — erase all steps
- **Steps +/−** — 1–64 steps

### Grid & Subdivision

- **Grid** — lock to BPM at the selected subdivision; off = free Rate slider
- **Subdivision** — `1 bar` through `1/32`, with dotted (`.`) and triplet (`T`) variants

### Transform Controls

| Control | Action |
|---------|--------|
| **Oct ▼▲** | Shift all notes up or down one octave |
| **Semi ▼▲** | Transpose all notes up or down one semitone, snapping to scale |
| **+ (interval)** | Add a harmony voice at the chosen interval (1–7 st, or 8 = octave) above each note, snapped to scale |

### Scale & Root

55+ scales (modes, world scales, jazz scales). Out-of-scale keys are dimmed; all input and transposition snaps to the selected scale. Chromatic disables all snapping.

### Keyboard & QWERTY Input

A 2-octave mouse-playable keyboard with octave shift buttons. QWERTY mapping (when the riff node is focused):

| Keys | Notes |
|------|-------|
| `A W S E D F T G Y H U J` | C C# D D# E F F# G G# A A# B |
| `K O L P` | C C# D D# (next octave) |
| `Z` / `X` | Octave down / up |
| `R` | Skip (rest) — advance cursor without writing a note (Rec Step mode) |
| `← →` | Move step cursor / selection |
| `↑ ↓` | Transpose selected step (scale-snapped) |
| `Delete` / `Backspace` | Clear selected step |

### Wires

Drag from the riff's wire port onto a synth tile or sampler tile to connect. A riff can drive multiple instruments simultaneously.

---

## Transport

| Control | Function | Key |
|---------|----------|-----|
| ▶ Play | Start transport + all samples | `Space` |
| ■ Stop | Stop + reset to bar 1 | `.` |
| BPM | Drag up/down or double-click to type | — |
| Metro | Toggle metronome click | — |
| ⏺ Rec | Record all stems + stereo mix to WAV | — |

**Recording** — press Rec to start, press again to stop. A modal offers: stereo mix only, stems ZIP, or both.

---

## Session Save / Load

- **Save** — exports the entire session (sample metadata, all module states, positions) as a `.frequencer` JSON file.
- **Open** — loads a previously saved `.frequencer` file, restoring the full session.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `.` | Stop (reset to bar 1) |
| `Escape` | Close edit card |

---

## Audio Chain

**Normal mode (per sample):**
```
AudioBuffer → Player(s) → FadeGain → ClipGain → PitchShift → EQ (5 bands) → [Pre-fader FX] → Panner → Volume → [Post-fader FX] → Output
```

**Granular mode (per sample):**
```
AudioBuffer → GranularEngine → GranGain → ClipGain → PitchShift → EQ (5 bands) → [Pre-fader FX] → Panner → Volume → [Post-fader FX] → Output
```

**Synth / Drum Machine:**
```
Tone.PolySynth / DrumBus → Pan → Volume → [Post-fader FX] → Output
```

---

## Sample List

A small monospace list in the lower-right corner (left of the master VU meter) shows all loaded samples. Grey = card closed; white = card open. Click any name to open or close that sample's edit card.
