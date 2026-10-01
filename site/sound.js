// site/sound.js: every sound on the site, synthesized. No audio files.
// The voices follow the old 4-channel handheld chips: two square waves,
// one soft wave channel (triangle here), one noise channel. Off until the
// visitor turns the volume wheel; the choice persists.
(function () {
  'use strict';
  var KEY = 'bureau_site_sound';
  var ctx = null, master = null, noiseBuf = null;
  var enabled = false;
  try { enabled = localStorage.getItem(KEY) === 'on'; } catch (e) {}

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // One square or triangle note with a hard attack and a short decay.
  function tone(freq, at, dur, opts) {
    opts = opts || {};
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type || 'square';
    o.frequency.setValueAtTime(freq, at);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, at + dur);
    var vol = opts.vol == null ? 0.5 : opts.vol;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.02);
  }
  function noise(at, dur, vol, lowpass) {
    var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf;
    f.type = 'lowpass'; f.frequency.value = lowpass || 4000;
    g.gain.setValueAtTime(vol == null ? 0.4 : vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(at); s.stop(at + dur + 0.02);
  }

  var SOUNDS = {
    // Our own power-on: a quick rising arpeggio over a low note.
    boot: function (t) {
      tone(523.25, t, 0.09, { vol: 0.35 });
      tone(659.25, t + 0.08, 0.09, { vol: 0.35 });
      tone(783.99, t + 0.16, 0.09, { vol: 0.35 });
      tone(1046.5, t + 0.24, 0.35, { vol: 0.4 });
      tone(130.81, t + 0.24, 0.35, { type: 'triangle', vol: 0.5 });
    },
    // Cartridge seated: a plastic clack.
    clack: function (t) { noise(t, 0.05, 0.6, 2200); tone(90, t, 0.06, { type: 'triangle', vol: 0.6 }); },
    press: function (t) { tone(880, t, 0.03, { vol: 0.25 }); },
    back: function (t) { tone(660, t, 0.03, { vol: 0.25 }); tone(440, t + 0.035, 0.04, { vol: 0.25 }); },
    select: function (t) { tone(988, t, 0.04, { vol: 0.25 }); tone(1319, t + 0.045, 0.05, { vol: 0.25 }); },
    // The character-select twirl: a square sweep with a sparkle on top.
    spin: function (t) {
      tone(330, t, 0.22, { to: 990, vol: 0.28 });
      tone(1760, t + 0.22, 0.08, { vol: 0.18 });
      tone(2349, t + 0.29, 0.1, { vol: 0.15 });
    },
    pop: function (t) { tone(1175, t, 0.05, { vol: 0.2 }); },
    type: function (t) { tone(1568, t, 0.012, { vol: 0.08 }); },
    whoosh: function (t) { noise(t, 0.25, 0.12, 900); },
    // the tour's scene props
    thump: function (t) { tone(110, t, 0.09, { type: 'triangle', to: 60, vol: 0.7 }); noise(t, 0.04, 0.3, 700); },
    stamp: function (t) { noise(t, 0.09, 0.7, 1800); tone(70, t, 0.16, { type: 'triangle', vol: 0.8 }); tone(1480, t + 0.12, 0.05, { vol: 0.12 }); },
    book: function (t) { noise(t, 0.05, 0.25, 2600); tone(660, t, 0.03, { type: 'triangle', vol: 0.2 }); },
    box: function (t) { tone(98, t, 0.1, { type: 'triangle', vol: 0.6 }); noise(t, 0.06, 0.25, 900); },
    lights: function (t) { [0, 0.07, 0.14].forEach(function (d) { noise(t + d, 0.02, 0.35, 5000); }); tone(60, t + 0.2, 0.3, { type: 'triangle', vol: 0.3 }); },
    save: function (t) { [659.25, 783.99, 987.77, 1318.5].forEach(function (f, i) { tone(f, t + i * 0.07, 0.09, { vol: 0.28 }); }); },
    star: function (t) { [987.77, 1318.5, 1975.5, 2637].forEach(function (f, i) { tone(f, t + i * 0.05, 0.08, { vol: 0.22 }); }); },
    // BUG HUNT, the hidden cartridge
    bhstart: function (t) {
      [392, 523.25, 659.25, 523.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, t + i * 0.11, 0.1, { vol: 0.3 }); });
      tone(130.81, t, 0.66, { type: 'triangle', vol: 0.4 });
    },
    bhdot: function (t) { tone(440, t, 0.035, { type: 'triangle', vol: 0.35 }); },
    bhdot2: function (t) { tone(330, t, 0.035, { type: 'triangle', vol: 0.35 }); },
    bhpower: function (t) { tone(200, t, 0.35, { to: 800, vol: 0.25 }); tone(800, t + 0.35, 0.2, { to: 300, vol: 0.2 }); },
    bheat: function (t) { tone(1200, t, 0.12, { to: 2400, vol: 0.25 }); noise(t, 0.06, 0.2, 3000); },
    bhdie: function (t) { tone(880, t, 1.1, { to: 110, vol: 0.3 }); noise(t + 1, 0.2, 0.25, 1200); },
    bhwin: function (t) { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) { tone(f, t + i * 0.09, 0.14, { vol: 0.3 }); }); },
  };

  window.BureauSound = {
    get enabled() { return enabled; },
    setEnabled: function (on) {
      enabled = !!on;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) {}
      if (enabled && ensure() && ctx.state === 'suspended') ctx.resume();
    },
    // Called from a user gesture so the browser lets audio start.
    unlock: function () { if (enabled && ensure() && ctx.state === 'suspended') ctx.resume(); },
    play: function (name) {
      if (!enabled || !SOUNDS[name]) return;
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      SOUNDS[name](ctx.currentTime + 0.005);
    },
  };
})();
