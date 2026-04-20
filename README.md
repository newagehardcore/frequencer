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

**PITCH+TIME** — Four independent pitch and time controls:

| Slider | Engine | Range | Behaviour |
|--------|--------|-------|-----------|
| **PITCH** | RubberBand (WASM) | ±24 st | High-quality pitch shift — tempo unchanged. Snaps to semitones. |
| **FINE** | Tone.js PitchShift | ±2 st | Smooth continuous pitch shift with portamento glide (~750 ms for full range). LFO-targetable for vibrato and pitch-sweep effects. |
| **TAPE** | Playback rate | ±24 st | Changes playback speed and pitch together, like a tape deck. |
| **PAUL** | PaulStretch (Worker) | ×1–×200 | Extreme time-stretch with no pitch change. Rendered offline; progress shown while building. |

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

Each sample card has a **SYNC** button (Play · Stop · **SYNC** · M · S row). Click it to detect the loop region's BPM and lock to the project tempo via playback-rate adjustment (pitch rises/falls with speed, like a record). Zero artifacts, zero latency.

**Workflow:**
1. Set loop start/end around the rhythmic region.
2. Click **SYNC** — BPM is auto-detected and the sample locks to the project tempo.
3. Changing the project BPM updates the playback rate in real time.
4. Adjusting the loop region automatically clears sync; click SYNC again to re-analyze.

Sync state is saved with the project.

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

A ±300 ms nudge slider shifts the sample's firing phase relative to the bar grid. Use it to dial in swing, pre-delay, or offset patterns that intentionally drift from bar 1.

Click the **Nudge** label (it's a button) to auto-detect the sample's first transient and align it to the beat. This re-runs the same onset detection used when you press SYNC, so you can re-nudge after changing the subdivision without clicking SYNC again. Fine-tune manually afterward if needed.

### How It Works

When Grid is active the sample fires via the global transport scheduler. Each repeat fires at the next quantization boundary. Loops use WebAudio's native loop splice point for sample-accurate boundaries with no gap or click. The visual playhead wraps continuously using the same timing math as the audio, so it stays tight even across loop boundaries.

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
- **Modulation Wires** — Drag from the LFO port onto any parameter slider, the **EQ canvas**, or directly onto a **module tile** (connects to volume). Wire endpoints always track to the tile's input port regardless of whether the edit card is open or closed. Modulatable sample parameters include: Pitch, Fine, Tape, Volume, Pan, Loop Start/End, File Position, PaulStretch, Attack, Release, Crossfade, Grain controls, and all FX parameters.
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

### FM (DX7)

Authentic 6-operator FM synthesizer — a full Yamaha DX7 clone running in an AudioWorklet.

- **Engine** — 6-operator FM with all 32 DX7 algorithms, operator envelopes, and feedback routing, ported from mmontag/dx7-synth-js
- **Patch library** — 600+ unique patches from 47 bundled banks: all 8 Yamaha factory ROMs, VRC artist cartridges (David Bristow, Bo Tomlyn, Gary Leuenberger, Studio 64), Brian Eno, Wendy Carlos, Godric collection, and more — no internet required
- **Browser** — patches organized into 12 categories (Voice · Crystal · Pad · Strings · FX · Lead · Keys · Brass · Bass · Pluck · Perc · Other) with a bank filter to browse by source

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

Add a drum machine to the canvas via `+ Drums`. Each instance is an independent step sequencer with sample-based kits.

### Lanes

One lane per sound category — **Kick · Snare · Clap · Rim · HH Closed · HH Open · Tom Hi · Tom Low · Cowbell · Ride** — showing only the categories present in the selected kit. Kits with multiple variants per category (e.g. four kicks) offer an inline dropdown to select which sample plays on that lane.

### Step Grid

- **Steps** — up to 64 steps, configurable with +/− buttons.
- **Velocity** — click-drag across steps to draw patterns. Empty → Soft → Accent → erase, determined by the first step touched.
- **Per-lane pitch & volume** — compact dual sliders (±12 st, −40 to +6 dB) next to each lane. Both are LFO-targetable.

### Kits

50 sample kits, 3300+ samples hosted locally:

Roland TR-808 · TR-909 · TR-707 · TR-606 · CR-78 · CR-8000 · Korg KPR-77 · LinnDrum · Oberheim DMX · Alesis SR-16 · ASR-X · Basimilus · Elektron Machinedrum · and many more.

Patterns are preserved across kit switches and restored when switching back.

### Transport

- **Grid Sync** — lock step timing to the global BPM at the selected subdivision.
- **Free mode** — independent BPM slider.
- **CLR** — clear all steps.

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

### Sequencer Modes

The **Mode** row below the titlebar selects between two sequencer modes:

#### GRID Mode

The default mode. Steps play left-to-right in a linear grid, identical to a traditional step sequencer.

Up to 64 steps in an 8-column grid. Each step shows its note name and a velocity bar (drag up/down to adjust velocity).

- **Rec Pattern** — pattern record mode; requires transport to be playing. Notes played on the keyboard are written to whichever step is currently playing (quantized to the selected subdivision). Existing notes are overwritten.
- **Rec Step** — step-entry mode; each note played on the keyboard writes to the cursor step and advances automatically. Use `← →` to move the cursor, `R` to skip a step without writing a note.
- **Shift ◀ ▶** — rotate the entire pattern left or right by one step
- **Clear** — erase all steps
- **Steps +/−** — 1–64 steps

#### ORBIT Mode

A non-Euclidean, multi-ring orbital sequencer. Instead of a linear grid, notes are arranged on concentric circles — each ring is an independent loop running at its own tempo ratio, creating polyrhythmic patterns that evolve over time.

**Rings** — 1 to 4 concentric rings, each configured independently:

| Parameter | Description |
|-----------|-------------|
| **Steps** | Number of note positions on this ring (1–16) |
| **Speed** | Tempo ratio relative to the base subdivision — e.g. ×2 means the ring cycles twice as fast |

**Note entry** — identical to GRID mode. Select a ring via the ring tabs, then use the keyboard or QWERTY input to assign notes to steps. Velocity bars, per-step octave shift, and per-step glide all work the same way.

**Visualization** — the orbit canvas shows:
- Each ring as a circle scaled to its step count
- A rotating arm (playhead) on each ring showing the current position in real time
- Filled dots for steps that have a note assigned; hollow dots for rests
- The selected step highlighted for editing

**Collapsed tile** — when the riff node is minimized, orbit mode shows a small animated ring canvas instead of the usual step grid strip.

**Per-ring wire outputs** — in ORBIT mode, each ring gets its own pair of output ports stacked vertically on the left and right sides of the module (Ring 1 at top, Ring 2 below, etc.). Drag from any ring's port to connect that ring independently to a different synth or sampler. Ports flash the riff's accent color when that ring fires a note.

This means a single Riff node in ORBIT mode can drive multiple instruments simultaneously with different polyrhythmic patterns — e.g. a 3-step fast ring routed to a lead synth and a 7-step slow ring routed to a pad.

---

### Per-Step Controls (both modes)

Each step cell has two sets of per-step controls:

**Octave transpose** — `−` and `+` buttons appear in the top-left and top-right corners of the cell on hover. Click to shift that step's note down or up one octave. Click repeatedly to transpose multiple octaves. Has no effect on empty (rest) steps.

**Per-step glide** — a thin strip runs along the bottom of each cell.
- *Off (default)*: dim strip with a muted `›` arrow. Click to enable glide for that step.
- *On*: strip lights up in the riff's accent color; a fill bar grows from left to right showing the glide duration relative to the 500 ms maximum. Drag left/right to set the glide time (0–500 ms). The current value in ms is shown while dragging. Click again (without dragging) to turn glide off.

When a step fires with glide enabled, the sequencer sets that synth's portamento to the step's glide time before triggering the note, overriding the global Glide knob for that step only. Steps with glide off always set portamento to 0. Glide data moves with the note when the pattern is shifted with ◀ ▶. Glide settings are saved and restored with the project.

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

In **GRID mode**, drag from the single wire port onto a synth or sampler tile to connect. A riff can drive multiple instruments simultaneously.

In **ORBIT mode**, each ring has its own wire port pair. Drag from any ring's port to route that ring to a separate instrument.

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
AudioBuffer → Player(s) → FadeGain → ClipGain → [RubberBand →] RbGain → FineShift → EQ (5 bands) → [Pre-fader FX] → Panner → Volume → [Post-fader FX] → Output
```

**Granular mode (per sample):**
```
AudioBuffer → GranularEngine → GranGain → ClipGain → [RubberBand →] RbGain → FineShift → EQ (5 bands) → [Pre-fader FX] → Panner → Volume → [Post-fader FX] → Output
```

`RubberBand` — async WASM AudioWorklet, wired in after load. `RbGain` is a passthrough until it's ready. `FineShift` — always present Tone.js PitchShift (±2 st FINE control).

**Synth / Drum Machine:**
```
Tone.PolySynth / DrumBus → Pan → Volume → [Post-fader FX] → Output
```

---

## Sample List

A small monospace list in the lower-right corner (left of the master VU meter) shows all loaded samples. Grey = card closed; white = card open. Click any name to open or close that sample's edit card.
