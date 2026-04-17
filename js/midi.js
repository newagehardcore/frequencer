    // ════════════════════════════════════════════════════
    // MIDI INPUT SYSTEM
    // ════════════════════════════════════════════════════
    'use strict';

    let _midiAccess = null;
    let _midiInitDone = false;

    function getMidiInputDevices() {
      if (!_midiAccess) return [];
      return [..._midiAccess.inputs.values()];
    }

    function populateMidiSelect(sel, currentValue) {
      const devices = getMidiInputDevices();
      sel.innerHTML =
        `<option value="all"${currentValue === 'all' ? ' selected' : ''}>ALL</option>` +
        `<option value="keyboard"${currentValue === 'keyboard' ? ' selected' : ''}>KEYBOARD</option>` +
        devices.map(d =>
          `<option value="${d.id}"${currentValue === d.id ? ' selected' : ''}>${d.name}</option>`
        ).join('');
    }

    function _refreshAllMidiSelects() {
      document.querySelectorAll('.midi-input-sel').forEach(sel => {
        const instrId = sel.dataset.instrId ? parseInt(sel.dataset.instrId) : null;
        const riffId  = sel.dataset.riffId  ? parseInt(sel.dataset.riffId)  : null;
        const obj = riffId != null ? riffs.get(riffId) : (instrId != null ? getInstrument(instrId) : null);
        if (obj) populateMidiSelect(sel, obj.midiInput ?? 'all');
        else populateMidiSelect(sel, sel.value || 'all');
      });
    }

    let _midiDotTimer = null;
    function _flashMidiDot() {
      const dot = document.getElementById('midi-dot');
      if (!dot) return;
      dot.classList.add('flash');
      clearTimeout(_midiDotTimer);
      _midiDotTimer = setTimeout(() => dot.classList.remove('flash'), 80);
    }

    function _routeMidiMessage(deviceId, data) {
      const cmd  = data[0] & 0xf0;
      const note = data[1];
      const vel  = data[2];
      const isNoteOn  = cmd === 0x90 && vel > 0;
      const isNoteOff = cmd === 0x80 || (cmd === 0x90 && vel === 0);
      if (!isNoteOn && !isNoteOff) return;
      _flashMidiDot();

      const noteName = midiToNoteName(note);
      const normVel  = Math.round((vel / 127) * 100);

      // Route to synths
      for (const synth of synths.values()) {
        if (synth.midiInput === 'all' || synth.midiInput === deviceId) {
          if (isNoteOn) {
            synth.noteOn(noteName, normVel);
            synth._noteHighlight?.(noteName, true);
          } else {
            synth.noteOff(noteName);
            synth._noteHighlight?.(noteName, false);
          }
        }
      }

      // Route to riffs via kbdProxy
      for (const riff of riffs.values()) {
        if (riff.midiInput === 'all' || riff.midiInput === deviceId) {
          const proxy = riffKbdProxies.get(riff.id);
          if (!proxy) continue;
          if (isNoteOn) {
            proxy.noteOn(noteName, normVel);
            proxy._noteHighlight?.(proxy.snapNote?.(noteName) ?? noteName, true);
          } else {
            proxy.noteOff(noteName);
            proxy._noteHighlight?.(proxy.snapNote?.(noteName) ?? noteName, false);
          }
        }
      }
    }

    function initMidi() {
      if (!navigator.requestMIDIAccess) {
        console.warn('[MIDI] Web MIDI API not supported in this browser.');
        return;
      }
      navigator.requestMIDIAccess({ sysex: false }).then(access => {
        _midiAccess = access;
        _midiInitDone = true;
        const inputs = [...access.inputs.values()];
        for (const input of inputs) {
          input.onmidimessage = e => _routeMidiMessage(input.id, e.data);
        }
        access.onstatechange = e => {
          const port = e.port;
          if (port.type !== 'input') return;
          if (port.state === 'connected') {
            port.onmidimessage = ev => _routeMidiMessage(port.id, ev.data);
          }
          _refreshAllMidiSelects();
        };
        _refreshAllMidiSelects();
      }).catch(err => {
        _midiInitDone = true;
        console.warn('[MIDI] Access denied or unavailable:', err);
      });
    }

    // Re-populate a MIDI select when the user focuses it (catches late init or new devices)
    document.addEventListener('focusin', e => {
      if (!e.target.classList.contains('midi-input-sel')) return;
      _refreshAllMidiSelects();
    });
