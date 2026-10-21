// 表の仕切り線の自動検出(ブラウザ/Node 両用の純関数)
(function (root) {
  const INK_T = 28;      // 背景との差がこれを超えたら「インク」
  const LINE_FRAC = 0.7; // 行/列の70%以上がインクなら罫線
  const THIN_MAX = 6;    // これ以下の太さは罫線、超えるものは塗りつぶし帯
  const EDGE = 3;        // 枠の端からこの距離以内は枠線とみなし除外

  function modeGray(gray) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let best = -1, bi = 255;
    for (let v = 0; v < 256; v++) {
      const s = hist[v] + (v > 0 ? hist[v - 1] : 0) + (v < 255 ? hist[v + 1] : 0);
      if (s > best) { best = s; bi = v; }
    }
    return bi;
  }

  function groups(flags) {
    const out = []; let s = -1;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i]) { if (s < 0) s = i; }
      else if (s >= 0) { out.push([s, i - 1]); s = -1; }
    }
    if (s >= 0) out.push([s, flags.length - 1]);
    return out;
  }

  // 罫線フラグ列 → 罫線位置とマスク
  function analyzeAxis(flags, n) {
    const pos = [], mask = new Uint8Array(n);
    for (const [a, b] of groups(flags)) {
      for (let i = Math.max(0, a - 1); i <= Math.min(n - 1, b + 1); i++) mask[i] = 1;
      if (b - a + 1 <= THIN_MAX) pos.push((a + b + 1) / 2);
      else { pos.push(a); pos.push(b + 1); }
    }
    return { pos: pos.filter(p => p >= EDGE && p <= n - EDGE), mask };
  }

  // 値が0の連続区間のうち、両側にインクがあり長さがminLen以上のもの [s,e](両端含む)
  function interiorGaps(prof, minLen) {
    let first = -1, last = -1;
    for (let i = 0; i < prof.length; i++) if (prof[i] > 0) { if (first < 0) first = i; last = i; }
    const gaps = [];
    if (first < 0) return gaps;
    let s = -1;
    for (let i = first; i <= last; i++) {
      if (prof[i] === 0) { if (s < 0) s = i; }
      else if (s >= 0) { if (i - s >= minLen) gaps.push([s, i - 1]); s = -1; }
    }
    return gaps;
  }

  function bandHeights(prof) {
    const hs = [];
    for (const [a, b] of groups(Array.from(prof, v => v > 0))) hs.push(b - a + 1);
    return hs;
  }

  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  }

  function dedupe(list, minDist) {
    const s = list.slice().sort((a, b) => a - b), out = [];
    for (const v of s) if (!out.length || v - out[out.length - 1] >= minDist) out.push(v);
    return out;
  }

  function pick(ruled, gaps) {
    if (ruled.length >= 2) return ruled;           // 罫線表: 罫線のみ採用
    const out = ruled.slice();
    for (const [s, e] of gaps) {
      if (!ruled.some(p => p >= s && p <= e + 1)) out.push((s + e + 1) / 2);
    }
    return out;
  }

  /**
   * gray: Uint8Array(w*h) グレースケール
   * opts: { rowGap: 行間の最小幅(px), colK: 列間の最小幅(文字高の倍率) }
   * 戻り値: { h:[y...], v:[x...] } いずれも枠内の相対座標(境界位置)
   */
  function detectGrid(gray, w, h, opts) {
    const rowGap = (opts && opts.rowGap) || 2;
    const colK = (opts && opts.colK) || 0.8;
    const bg = modeGray(gray);
    const ink = new Uint8Array(w * h);
    const rowCnt = new Int32Array(h), colCnt = new Int32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.abs(gray[y * w + x] - bg) > INK_T) { ink[y * w + x] = 1; rowCnt[y]++; colCnt[x]++; }
      }
    }
    const H = analyzeAxis(Array.from(rowCnt, c => c >= LINE_FRAC * w), h);
    const V = analyzeAxis(Array.from(colCnt, c => c >= LINE_FRAC * h), w);

    const rowInk = new Int32Array(h), colInk = new Int32Array(w);
    for (let y = 0; y < h; y++) {
      if (H.mask[y]) continue;
      for (let x = 0; x < w; x++) {
        if (V.mask[x] || !ink[y * w + x]) continue;
        rowInk[y]++; colInk[x]++;
      }
    }
    const rowGaps = interiorGaps(rowInk, rowGap);
    const mh = median(bandHeights(rowInk)) || 12;
    const colGaps = interiorGaps(colInk, Math.max(6, Math.round(mh * colK)));

    return {
      h: dedupe(pick(H.pos, rowGaps), 4),
      v: dedupe(pick(V.pos, colGaps), 4),
    };
  }

  // インク(背景と異なる画素)の外接矩形。無ければ null
  function inkBBox(gray, w, h) {
    const bg = modeGray(gray);
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.abs(gray[y * w + x] - bg) > INK_T) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  const api = { detectGrid, inkBBox, modeGray, INK_T };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TableDetect = api;
})(typeof window !== 'undefined' ? window : globalThis);
