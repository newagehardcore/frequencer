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

Each tile shows the sample's waveform rendered in its assigned color, a white live playhead, and a stereo VU meter. A master VU meter sits in the header. The app uses a monochrome (black and white) visual style throughout — only the waveforms carry color.

| Interaction | Result |
|-------------|--------|
| Click | Open edit card |
| Double-click | Toggle play / stop |
| Drag | Move — volume and pan update live |

---

## Edit Card

Click a tile to open its floating edit card. Multiple cards can be open at once. The card has a white border and displays the sample's waveform in its assigned color.

**Playback modes** (row above the waveform) — select how the sample plays:

| Mode | Behaviour |
|------|-----------|
| LOOP | Loops the loop region continuously (default) |
| REV | Plays the loop region in reverse, continuously |
| GRAN | Granular synthesis (see Granular Mode below) |
| TRIG | Waits for an external trigger — only plays on demand |

In **TRIG** mode the sample stops looping and waits silently. The Play button fires it once. Connecting a step sequencer wire automatically switches the sample to TRIG and drives it from the sequencer. Clicking LOOP, REV, or GRAN while a sequencer is connected disconnects it and restores continuous playback.

**Controls** — Play · Stop · Mute · Solo

The remaining parameters are grouped into collapsible accordion sections (click a section header to expand; multiple sections can be open at once):

**PLAYBACK** — Loop start/end handles and sliders, File Position, and Grid Sync settings. Grid Sync options are hidden in GRAN and TRIG modes.
- *Loop Points* — drag handles on the waveform or use the Start/End sliders. Waveform supports zoom (drag vertically) and pan (drag horizontally); double-click to reset.
- *File Position* — start offset within the loop region. In Grid Sync mode applies silently on the next subdivision.
- *Grid Sync* — lock to BPM: `1 Bar · ½ · ¼ · ⅛ · 1/16 · 1/32`, with Dot (×1.5) and 3let (÷1.5) variants; `÷2` / `÷3` multipliers skip every other or every third trigger.

**MIXER** — Volume and Pan.

**ENVELOPE** — Attack, Release, Crossfade (equal-power).

**PITCH+TIME** — Pitch Shift (±24 st, speed unchanged) · Timestretch (±24 st, changes speed and pitch) · Paulstretch (extreme slow-down).

**EFFECTS** — FX rack. Add unlimited effect instances; each has a PRE/POST fader toggle. Click ✕ to remove.

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

## Granular Mode

Activate with the **GRAN** button in the playback mode row. The sample's loop region is used as the grain source — the regular player and playhead are replaced by a granular engine.

**Controls** (shown in the GRAN sliders section):

| Slider | Range | Description |
|--------|-------|-------------|
| Position | 0–100% | Center position of grain playback within the loop region |
| Spread | 0–100% | Random scatter of grain start points around Position |
| Density | 0–100% | Grain trigger rate — low = sparse (~500ms apart), high = dense (~15ms apart) |

- Pitch and playback speed are inherited from the **PITCH+TIME** section and apply to the granular engine just like normal playback.
- Loop handles still control the source region; moving them updates the engine in real time without restarting.
- All three controls are LFO-targetable for evolving, modulated textures.
- The cloud visualization on the card waveform shows grain positions and spread in real time.
- Switching to LOOP, REV, or TRIG exits granular mode and resumes normal playback.

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

## Synth Instruments

Add synthesizers to the canvas via the footer buttons.

### Analog Synth (`+ Synth → Analog`)

A polyphonic subtractive synthesizer built on Tone.PolySynth.

- **Oscillator** — Sine, Triangle, Sawtooth, Square, Pulse
- **ADSR envelope** — Attack, Decay, Sustain, Release
- **Filter** — LP / HP / BP with Frequency and Q controls
- **Portamento** — glide between notes
- **Keyboard** — 2-octave mouse-playable keyboard (C3–B4); octave shift buttons

### FM Synth (`+ Synth → FM`)

A frequency-modulation synthesizer with a built-in library of 32 DX7-style presets.

- **FM Parameters** — Harmonicity (carrier:modulator ratio), Modulation Index
- **Carrier & Modulation envelopes** — independent ADSR for carrier and modulator
- **Preset library** — 32 classic DX7 patches; load custom banks via SysEx `.syx` files
- **Keyboard** — same 2-octave playable keyboard as Analog

Both synth types share volume, pan, and mute/solo controls consistent with the sample tiles.

---

## Riff Sequencer

Add melodic step sequencers to the canvas via `+ Riff`. Each riff connects to one or more synths or samplers via wires and loops a melodic pattern in sync with the transport.

### Step Grid

Up to 64 steps arranged in an 8-column grid. Each step shows its note name and a **velocity bar** — a colored fill from the bottom of the cell representing the step's velocity (full height = full velocity). Click and drag up/down on any step to adjust its velocity.

- **● Rec** — enter step-entry mode; keys/mouse pressed on the keyboard fill the current cursor step and advance automatically
- **Rest** — skip the cursor step (leave it silent) and advance
- **Clear** — erase all steps in the pattern
- **Steps +/−** — increase or decrease the number of active steps (1–64)

### Grid & Subdivision

- **Grid button** — when on, step timing locks to the transport BPM at the selected musical subdivision; when off, use the **Rate** slider for a free-running step interval in seconds
- **Subdivision** — `1 bar` through `1/32`, with dotted (`.`) and triplet (`T`) variants for each

### Transform Controls

| Control | Action |
|---------|--------|
| **Oct ▼▲** | Shift all notes in the pattern up or down one octave |
| **Semi ▼▲** | Transpose all notes up or down one semitone, snapping to the selected scale |
| **+ (interval)** | Add a harmony voice at the chosen interval (1–7 semitones, or 8 = octave) above each note, snapped to the current scale |

### Scale & Root

Select a root note and scale from a library of 55+ scales (modes, world scales, jazz scales, and more). When a scale is selected:

- Out-of-scale keys on the keyboard are dimmed
- All notes entered or transposed snap to the nearest in-scale degree
- The **+ interval** harmony voice also snaps to the scale

Chromatic (default) disables all snapping.

### Keyboard

A 2-octave mouse-playable keyboard with octave shift buttons. Notes snap to the current scale on input.

**QWERTY input** (when the riff node is focused — click it first):

| Keys | Notes |
|------|-------|
| `A W S E D F T G Y H U J` | C C# D D# E F F# G G# A A# B |
| `K O L P` | C C# D D# (next octave) |
| `Z` / `X` | Octave down / up |
| `R` or `Space` | Rest (skip current step) |
| `← →` | Move step selection left / right |
| `↑ ↓` | Transpose selected step up / down (scale-snapped) |
| `Delete` / `Backspace` | Clear selected step |

### Wires

Drag from the riff's wire port onto a synth tile or sampler tile to connect. A riff can drive multiple instruments simultaneously. The connection is shown as a colored wire on the canvas.

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

Normal mode:
```
AudioBuffer → Player(s) → FadeGain → ClipGain → PitchShift → EQ (5 bands) → [Pre-fader FX] → Panner → Volume → [Post-fader FX] → Output
```

Granular mode:
```
AudioBuffer → GranularEngine → GranGain → ClipGain → PitchShift → EQ (5 bands) → [Pre-fader FX] → Panner → Volume → [Post-fader FX] → Output
```

A second player (`xfPlayer`) handles crossfade transitions and, in Grid Sync mode, the wrapped portion of a loop when File Position is offset from the loop start. Fades without crossfade are baked into the buffer directly. In granular mode the regular players are disconnected and the GranularEngine drives the chain directly.

---

## Sample List

A small monospace list in the bottom-right corner of the canvas (left of the master VU meter) shows all loaded samples. Names are capped at 20 characters. Grey = card closed; white = card open. Click any name to open or close that sample's edit card.

