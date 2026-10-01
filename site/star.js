/* The Bureau star, shared by the handheld and the inside page.
   Drawn by hand pixel by pixel, the body only: 3 shine, 2 body, 1 shade.
   A glint runs down the upper-left edges, the lower-right rim is in shade.
   The darkest outline is traced around each frame after the squeeze, so it
   is always closed. Spinning squeezes it sideways like a coin, and the back
   face is a shade darker. On the light LCD the body goes dark (onLcd) so it
   reads solid, the glint stays bright. */
(function () {
  var STAR = [
    '........3........',
    '.......322.......',
    '.......322.......',
    '......32221......',
    '......32221......',
    '.....3222221.....',
    '33333322222222211',
    '.322222222222211.',
    '..3222222222211..',
    '...32222222211...',
    '....322222221....',
    '....322222221....',
    '...32222.22211...',
    '...3222...2211...',
    '..3222.....2211..',
    '.32...........21.',
  ];
  var N = 19, W = 17, H = 16;
  // sh: 4 colours, darkest first. fi: frame 0..7 of the coin spin.
  function make(sh, fi, onLcd) {
    var map = onLcd ? [0, 0, 1, 3] : [0, 1, 2, 3];
    var cnv = document.createElement('canvas'); cnv.width = N; cnv.height = N;
    var c = cnv.getContext('2d');
    var cos = Math.cos((fi + 0.5) / 8 * Math.PI * 2), back = cos < 0; // half a step off, so never a flat bar
    var w = Math.max(1, Math.round(W * Math.abs(cos)));
    var ox = 1 + Math.floor((W - w) / 2), oy = 1;
    var g = new Array(N * N), x, y, k;
    for (y = 0; y < H; y++) for (x = 0; x < w; x++) {
      var sx = Math.min(W - 1, Math.floor((x + 0.5) * W / w));
      if (back) sx = W - 1 - sx;                       // the back face, mirrored
      var ch = STAR[y][sx];
      if (ch === '.') continue;
      var i = +ch;
      if (w <= 3) i = 1;                               // edge-on: a thin dark sliver
      else if (back) i = Math.max(1, i - 1);           // the back is a shade darker, no shine
      g[(oy + y) * N + ox + x] = i;
    }
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      k = y * N + x;
      if (g[k] > 0) continue;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || !(g[ny * N + nx] > 0)) continue;
        g[k] = 0; dy = dx = 2; // any touching body pixel: outline
      }
    }
    for (k = 0; k < g.length; k++) {
      if (g[k] === undefined) continue;
      c.fillStyle = sh[map[g[k]]];
      c.fillRect(k % N, Math.floor(k / N), 1, 1);
    }
    return cnv;
  }
  window.BureauStar = { N: N, make: make };
})();
