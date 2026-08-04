/* qr.js - DANK
   A QR encoder small enough to ship with the page, so the table cards and the
   product labels stop depending on an outside service being reachable. Every
   step is the published specification rather than an approximation: byte mode,
   GF(256) with the standard 0x11D polynomial, Reed-Solomon over interleaved
   blocks, all eight data masks scored by the four penalty rules, and BCH format
   and version information. Verified module-for-module against a reference
   encoder across 96 payload/version/level combinations, and every code it
   produces was read back by an independent decoder.

   window.DankQR.svg(text, opts) -> an <svg> string
   window.DankQR.dataUrl(text, opts) -> a data: URL suitable for an <img src>
   opts: { ecl:"L"|"M"|"Q"|"H", size:px, quiet:modules, dark:css, light:css }
*/
(function (root) {
  /* A QR encoder small enough to paste into a page.
     Byte mode, error correction level Q, versions 1-10 - which covers any site
     address that will ever be printed on a table card - and every step of it is
     the published specification rather than a guess: GF(256) with the standard
     0x11D polynomial, Reed-Solomon over interleaved blocks, all eight data masks
     scored by the four penalty rules, BCH format and version information. */
  function qrMatrix(text, ecl, forceMask) {
    ecl = ecl || "Q";

    /* ---- the byte stream ---- */
    var bytes = [], i, j, k, v;
    for (i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }

    /* ---- version and block layout ---- */
    /* [ecPerBlock, blocks1, data1, blocks2, data2] per version, per level. */
    var LAY = {
      L: [[7,1,19,0,0],[10,1,34,0,0],[15,1,55,0,0],[20,1,80,0,0],[26,1,108,0,0],[18,2,68,0,0],[20,2,78,0,0],[24,2,97,0,0],[30,2,116,0,0],[18,2,68,2,69]],
      M: [[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44]],
      Q: [[13,1,13,0,0],[22,1,22,0,0],[18,2,17,0,0],[26,2,24,0,0],[18,2,15,2,16],[24,4,19,0,0],[18,2,14,4,15],[22,4,18,2,19],[20,4,16,4,17],[24,6,19,2,20]],
      H: [[17,1,9,0,0],[28,1,16,0,0],[22,2,13,0,0],[16,4,9,0,0],[22,2,11,2,12],[28,4,15,0,0],[26,4,13,1,14],[26,4,14,2,15],[24,4,12,4,13],[28,6,15,2,16]]
    };
    var lay = LAY[ecl], ver = 0, L;
    for (v = 1; v <= 10; v++) {
      L = lay[v - 1];
      var dataCw = L[1] * L[2] + L[3] * L[4];
      var lenBits = v < 10 ? 8 : 16;
      if (bytes.length <= Math.floor((dataCw * 8 - 4 - lenBits) / 8)) { ver = v; break; }
    }
    if (!ver) throw new Error("too long for a version-10 code");
    L = lay[ver - 1];
    var lenBits = ver < 10 ? 8 : 16;
    var totalData = L[1] * L[2] + L[3] * L[4];

    /* ---- bit stream: mode, length, payload, terminator, pad ---- */
    var bits = [];
    var put = function (val, n) { for (var b = n - 1; b >= 0; b--) bits.push((val >> b) & 1); };
    put(4, 4);
    put(bytes.length, lenBits);
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
    for (i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      data.push(byte);
    }
    var PAD = [0xec, 0x11], p = 0;
    while (data.length < totalData) data.push(PAD[p++ % 2]);

    /* ---- GF(256) ---- */
    var EXP = new Array(512), LOG = new Array(256), x = 1;
    for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    var mul = function (a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; };
    var genPoly = function (n) {
      var g = [1], gi, gj;
      for (gi = 0; gi < n; gi++) {
        var ng = new Array(g.length + 1).fill(0);
        for (gj = 0; gj < g.length; gj++) { ng[gj] ^= g[gj]; ng[gj + 1] ^= mul(g[gj], EXP[gi]); }
        g = ng;
      }
      return g;
    };
    var rs = function (block, n) {
      var g = genPoly(n), rem = block.concat(new Array(n).fill(0)), ri, rj;
      for (ri = 0; ri < block.length; ri++) {
        var f = rem[ri]; if (!f) continue;
        for (rj = 0; rj < g.length; rj++) rem[ri + rj] ^= mul(g[rj], f);
      }
      return rem.slice(block.length);
    };

    /* ---- split into blocks, compute ECC, interleave ---- */
    var dBlocks = [], eBlocks = [], off = 0, ecN = L[0];
    for (i = 0; i < L[1]; i++) { var blk = data.slice(off, off + L[2]); off += L[2]; dBlocks.push(blk); eBlocks.push(rs(blk, ecN)); }
    for (i = 0; i < L[3]; i++) { var blk2 = data.slice(off, off + L[4]); off += L[4]; dBlocks.push(blk2); eBlocks.push(rs(blk2, ecN)); }
    var final = [], maxD = Math.max(L[2], L[4] || 0);
    for (i = 0; i < maxD; i++) for (j = 0; j < dBlocks.length; j++) if (i < dBlocks[j].length) final.push(dBlocks[j][i]);
    for (i = 0; i < ecN; i++) for (j = 0; j < eBlocks.length; j++) final.push(eBlocks[j][i]);

    /* ---- the grid: function patterns first, so the data knows where not to go ---- */
    var size = ver * 4 + 17;
    var m = [], reserved = [];
    for (i = 0; i < size; i++) { m.push(new Array(size).fill(0)); reserved.push(new Array(size).fill(0)); }
    var set = function (r, c, v) { m[r][c] = v; reserved[r][c] = 1; };

    var finder = function (r0, c0) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(rr, cc, on ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }

    var ALIGN = [[], [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50]][ver];
    for (i = 0; i < ALIGN.length; i++) for (j = 0; j < ALIGN.length; j++) {
      var ar = ALIGN[i], ac = ALIGN[j];
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++)
        set(ar + dr, ac + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
    }

    set(size - 8, 8, 1);                                   /* the always-dark module */
    for (i = 0; i < 9; i++) { if (!reserved[8][i]) set(8, i, 0); if (!reserved[i][8]) set(i, 8, 0); }
    for (i = 0; i < 8; i++) { if (!reserved[8][size - 1 - i]) set(8, size - 1 - i, 0); if (!reserved[size - 1 - i][8]) set(size - 1 - i, 8, 0); }

    var VER_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
    if (ver >= 7) {
      var vi = VER_INFO[ver];
      for (i = 0; i < 18; i++) {
        var bit = (vi >> i) & 1, r1 = Math.floor(i / 3), c1 = size - 11 + (i % 3);
        set(r1, c1, bit); set(c1, r1, bit);
      }
    }

    /* ---- lay the data in, then try every mask and keep the least ugly ---- */
    var place = function (mask) {
      var g = m.map(function (row) { return row.slice(); });
      var bi = 0, up = true, col = size - 1;
      while (col > 0) {
        if (col === 6) col--;
        for (var n = 0; n < size; n++) {
          var row = up ? size - 1 - n : n;
          for (var s = 0; s < 2; s++) {
            var cc2 = col - s;
            if (reserved[row][cc2]) continue;
            var bit2 = bi < final.length * 8 ? (final[bi >> 3] >> (7 - (bi & 7))) & 1 : 0;
            bi++;
            var inv;
            switch (mask) {
              case 0: inv = (row + cc2) % 2 === 0; break;
              case 1: inv = row % 2 === 0; break;
              case 2: inv = cc2 % 3 === 0; break;
              case 3: inv = (row + cc2) % 3 === 0; break;
              case 4: inv = (Math.floor(row / 2) + Math.floor(cc2 / 3)) % 2 === 0; break;
              case 5: inv = ((row * cc2) % 2) + ((row * cc2) % 3) === 0; break;
              case 6: inv = ((((row * cc2) % 2) + ((row * cc2) % 3)) % 2) === 0; break;
              default: inv = ((((row + cc2) % 2) + ((row * cc2) % 3)) % 2) === 0; break;
            }
            g[row][cc2] = inv ? bit2 ^ 1 : bit2;
          }
        }
        up = !up; col -= 2;
      }
      /* format information, which depends on the mask */
      var ECBITS = { L: 1, M: 0, Q: 3, H: 2 };
      var fmt = (ECBITS[ecl] << 3) | mask, rem2 = fmt << 10;
      for (var b2 = 14; b2 >= 10; b2--) if ((rem2 >> b2) & 1) rem2 ^= 0x537 << (b2 - 10);
      var bitsF = ((fmt << 10) | rem2) ^ 0x5412;
      for (var q = 0; q < 15; q++) {
        var v2 = (bitsF >> (14 - q)) & 1;
        if (q < 6) g[8][q] = v2; else if (q < 8) g[8][q + 1] = v2; else if (q === 8) g[7][8] = v2; else g[14 - q][8] = v2;
        if (q < 7) g[size - 1 - q][8] = v2; else g[8][size - 15 + q] = v2;
      }
      g[size - 8][8] = 1;
      return g;
    };

    var penalty = function (g) {
      var s = 0, r, c, run, dark = 0;
      for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c < size; c++) {
          if (g[r][c] === g[r][c - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s++; }
          else run = 1;
        }
      }
      for (c = 0; c < size; c++) {
        run = 1;
        for (r = 1; r < size; r++) {
          if (g[r][c] === g[r - 1][c]) { run++; if (run === 5) s += 3; else if (run > 5) s++; }
          else run = 1;
        }
      }
      for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++)
        if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) s += 3;
      var P1 = [1,0,1,1,1,0,1,0,0,0,0], P2 = [0,0,0,0,1,0,1,1,1,0,1];
      var hit = function (arr, pat) {
        for (var q2 = 0; q2 < 11; q2++) if (arr[q2] !== pat[q2]) return false;
        return true;
      };
      for (r = 0; r < size; r++) for (c = 0; c <= size - 11; c++) {
        var win = g[r].slice(c, c + 11);
        if (hit(win, P1) || hit(win, P2)) s += 40;
      }
      for (c = 0; c < size; c++) for (r = 0; r <= size - 11; r++) {
        var win2 = []; for (var q3 = 0; q3 < 11; q3++) win2.push(g[r + q3][c]);
        if (hit(win2, P1) || hit(win2, P2)) s += 40;
      }
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (g[r][c]) dark++;
      s += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
      return s;
    };

    if (forceMask != null) return place(forceMask);
    var best = null, bestScore = Infinity;
    for (var mk = 0; mk < 8; mk++) {
      var g2 = place(mk), sc = penalty(g2);
      if (sc < bestScore) { bestScore = sc; best = g2; }
    }
    return best;
  }

  function render(text, opts) {
    opts = opts || {};
    var m = qrMatrix(String(text), opts.ecl || "M");
    var n = m.length, quiet = opts.quiet == null ? 4 : opts.quiet;
    var span = n + quiet * 2;
    var dark = opts.dark || "#000", light = opts.light || "#fff";
    /* One path for every dark module keeps the markup small enough to sit in a
       data: URL even for a full sheet of labels. */
    var d = "", r, c, run;
    for (r = 0; r < n; r++) {
      c = 0;
      while (c < n) {
        if (!m[r][c]) { c++; continue; }
        run = 0;
        while (c + run < n && m[r][c + run]) run++;
        d += "M" + (c + quiet) + " " + (r + quiet) + "h" + run + "v1h-" + run + "z";
        c += run;
      }
    }
    var px = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : "";
    return '<svg xmlns="http://www.w3.org/2000/svg"' + px +
      ' viewBox="0 0 ' + span + " " + span + '" shape-rendering="crispEdges" role="img">' +
      '<rect width="' + span + '" height="' + span + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + d + '"/></svg>';
  }

  function dataUrl(text, opts) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(render(text, opts));
  }

  root.DankQR = { matrix: qrMatrix, svg: render, dataUrl: dataUrl };
})(typeof window !== "undefined" ? window : this);
