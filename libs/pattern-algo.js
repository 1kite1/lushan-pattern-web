/*!
 * pattern-algo.js — 麓山绘梦·纹鉴 纯算法民族归属判别器（浏览器端）
 *
 * 零网络、零 API、零额度。全部在本地浏览器内完成：
 *   画布 → 256x256 → 灰度标准化 → 4 组特征(66 维) → 标准化 + LDA 线性判别
 *
 * 特征组（共 66 维，与 _aigc-eval/algo_v2_probe.py 同源）:
 *   skel   4 维   全局骨架：梯度方向比 / 各向异性 / 行·列投影周期性
 *   gabor 24 维   Gabor 滤波器组 4 方向 x 3 尺度，响应均值与标准差
 *   lbp   10 维   旋转不变均匀 LBP 直方图
 *   color 28 维   HSV：全局色相 8bin + 2x2 分块色相 4bin + S/V 统计
 *
 * 参考指标（n=50，留一验证）：74.0%，随机基线 25%。详见 _aigc-eval/RESULTS_*.md
 *
 * 用法:
 *   await PatternAlgo.load('algo_model.json');       // 一次性
 *   const r = await PatternAlgo.recognize(imgOrCanvas);
 *   // r = { label:'侗锦', scores:{...}, ranked:[...], margin:12.3, level:'高', confidence:0.94 }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PatternAlgo = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 256;
  var EPS = 1e-9;
  var MODEL = null;

  // 置信度分档阈值（由 JS 特征重新标定，load() 时若模型带 bands 则覆盖）
  var DEFAULT_BANDS = [4.98, 11.20];

  /* ================================================================
   * 1. FFT（radix-2，就地，实数用复数表示）
   * ================================================================ */

  var _revCache = {};

  function bitrev(n) {
    if (_revCache[n]) return _revCache[n];
    var bits = Math.round(Math.log2(n));
    var rev = new Int32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i, r = 0;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    _revCache[n] = rev;
    return rev;
  }

  // 1D 就地 FFT；stride 支持按列取样（2D 的第二遍）
  function fft1d(re, im, off, stride, n, inverse) {
    var rev = bitrev(n), i, j, t;
    for (i = 0; i < n; i++) {
      j = rev[i];
      if (j > i) {
        t = re[off + i * stride]; re[off + i * stride] = re[off + j * stride]; re[off + j * stride] = t;
        t = im[off + i * stride]; im[off + i * stride] = im[off + j * stride]; im[off + j * stride] = t;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (inverse ? 2 : -2) * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      var half = len >> 1;
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < half; k++) {
          var a = off + (i + k) * stride, b = off + (i + k + half) * stride;
          var xr = re[b] * cr - im[b] * ci;
          var xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) {
      for (i = 0; i < n; i++) {
        re[off + i * stride] /= n; im[off + i * stride] /= n;
      }
    }
  }

  function fft2d(re, im, w, h, inverse) {
    var y, x;
    for (y = 0; y < h; y++) fft1d(re, im, y * w, 1, w, inverse);
    for (x = 0; x < w; x++) fft1d(re, im, x, w, h, inverse);
  }

  /* ================================================================
   * 2. 预处理：图像 → 256x256 灰度（已标准化）
   * ================================================================ */

  function drawToCanvas(src, size) {
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, size, size);

    if (src instanceof ImageData) {
      var tmp = document.createElement('canvas');
      tmp.width = src.width; tmp.height = src.height;
      tmp.getContext('2d').putImageData(src, 0, 0);
      ctx.drawImage(tmp, 0, 0, size, size);
    } else {
      var sw = src.naturalWidth || src.videoWidth || src.width;
      var sh = src.naturalHeight || src.videoHeight || src.height;
      // 直接拉伸到 size x size —— 必须与训练侧 PIL 的 resize((256,256)) 一致，
      // 否则各向异性 / Gabor 方向特征分布会漂移，模型权重失效。
      ctx.drawImage(src, 0, 0, sw, sh, 0, 0, size, size);
    }
    return cv;
  }

  function grayNormalized(rgba, w, h) {
    var n = w * h, g = new Float64Array(n);
    var i, p, sum = 0;
    for (i = 0, p = 0; i < n; i++, p += 4) {
      var v = rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114;
      g[i] = v; sum += v;
    }
    var mean = sum / n, sq = 0;
    for (i = 0; i < n; i++) { var d = g[i] - mean; sq += d * d; }
    var std = Math.sqrt(sq / n);
    var s = std + 1e-6;
    for (i = 0; i < n; i++) g[i] = (g[i] - mean) / s;
    return g;
  }

  /* ================================================================
   * 3. 四组特征
   * ================================================================ */

  // ---- 3.1 skel: 全局骨架 4 维 -----------------------------------
  function periodicity(profile) {
    var n = profile.length, i, sum = 0, v;
    for (i = 0; i < n; i++) sum += profile[i];
    var mean = sum / n, sq = 0;
    for (i = 0; i < n; i++) { v = profile[i] - mean; sq += v * v; }
    if (Math.sqrt(sq / n) < 1e-6) return 0;

    var re = new Float64Array(n), im = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var wnd = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));   // np.hanning
      re[i] = (profile[i] - mean) * wnd;
    }
    fft1d(re, im, 0, 1, n, false);

    var half = (n >> 1) + 1;                                       // rfft 长度
    var ms = 0, cnt = 0, mx = 0;
    for (var k = 3; k < half; k++) {
      var m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      ms += m; cnt++; if (m > mx) mx = m;
    }
    if (cnt === 0 || ms / cnt < 1e-9) return 0;
    return mx / (ms / cnt);
  }

  function featsSkel(a, w, h) {
    var x, y, seh = 0, sev = 0;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w - 1; x++) seh += Math.abs(a[y * w + x + 1] - a[y * w + x]);
    }
    for (y = 0; y < h - 1; y++) {
      for (x = 0; x < w; x++) sev += Math.abs(a[(y + 1) * w + x] - a[y * w + x]);
    }
    var eh = seh / (h * (w - 1)), ev = sev / ((h - 1) * w);
    var tot = eh + ev + EPS;

    var colMean = new Float64Array(w), rowMean = new Float64Array(h);
    for (y = 0; y < h; y++) {
      var rs = 0;
      for (x = 0; x < w; x++) { var v = a[y * w + x]; rs += v; colMean[x] += v; }
      rowMean[y] = rs / w;
    }
    for (x = 0; x < w; x++) colMean[x] /= h;

    return [eh / tot, Math.abs(eh - ev) / tot,
      periodicity(colMean), periodicity(rowMean)];
  }

  // ---- 3.2 gabor: 24 维（FFT 卷积，等价 scipy.fftconvolve valid）----
  var _kfft = null;          // { P, items:[{ks, re, im}] }

  function buildKernelFFT(P) {
    if (_kfft && _kfft.P === P) return _kfft;
    var kernels = MODEL.gabor.kernels;
    var items = [];
    for (var idx = 0; idx < kernels.length; idx++) {
      var ks = kernels[idx].size, data = kernels[idx].data;
      var kre = new Float64Array(P * P), kim = new Float64Array(P * P);
      for (var y = 0; y < ks; y++) {
        for (var x = 0; x < ks; x++) kre[y * P + x] = data[y * ks + x];
      }
      fft2d(kre, kim, P, P, false);
      items.push({ ks: ks, re: kre, im: kim });
    }
    _kfft = { P: P, items: items };
    return _kfft;
  }

  function featsGabor(a, w, h) {
    var maxKs = 0, kernels = MODEL.gabor.kernels;
    for (var q = 0; q < kernels.length; q++) maxKs = Math.max(maxKs, kernels[q].size);

    var P = 1;
    while (P < w + maxKs - 1) P <<= 1;

    // 图像补零 → FFT（只做一次，所有核复用）
    var are = new Float64Array(P * P), aim = new Float64Array(P * P);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) are[y * P + x] = a[y * w + x];
    }
    fft2d(are, aim, P, P, false);

    var kf = buildKernelFFT(P), out = [];
    var cre = new Float64Array(P * P), cim = new Float64Array(P * P);
    var i, n;

    for (var idx = 0; idx < kf.items.length; idx++) {
      var ks = kf.items[idx].ks, kr = kf.items[idx].re, ki = kf.items[idx].im;
      for (i = 0; i < P * P; i++) {
        cre[i] = are[i] * kr[i] - aim[i] * ki[i];
        cim[i] = are[i] * ki[i] + aim[i] * kr[i];
      }
      fft2d(cre, cim, P, P, true);

      // valid 区域：行/列 ks-1 .. w-1（含）; 与 numpy 同用两遍法求 std(ddof=0)
      var sumAbs = 0, sum = 0; n = 0;
      for (y = ks - 1; y < h; y++) {
        var base = y * P;
        for (x = ks - 1; x < w; x++) {
          var v = cre[base + x];
          sumAbs += Math.abs(v); sum += v; n++;
        }
      }
      var mu = sum / n, sq = 0;
      for (y = ks - 1; y < h; y++) {
        var base2 = y * P;
        for (x = ks - 1; x < w; x++) {
          var d = cre[base2 + x] - mu; sq += d * d;
        }
      }
      out.push(sumAbs / n, Math.sqrt(sq / n));
    }
    return out;
  }

  // ---- 3.3 lbp: 旋转不变均匀 LBP 直方图 10 维 --------------------
  function featsLbp(a, w, h) {
    var n = w * h, q = new Uint8Array(n), i, x, y;
    for (i = 0; i < n; i++) {
      var v = Math.floor(a[i] * 32 + 128);
      q[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    var code = new Uint8Array(n);
    var offs = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
    for (var t = 0; t < 8; t++) {
      var dy = offs[t][0], dx = offs[t][1];
      for (y = 0; y < h; y++) {
        var sy = (y + dy + h) % h;               // np.roll(q, -dy, axis=0)
        for (x = 0; x < w; x++) {
          var sx = (x + dx + w) % w;
          if (q[sy * w + sx] >= q[y * w + x]) code[y * w + x] |= (1 << t);
        }
      }
    }
    var hist = new Float64Array(10), total = 0;
    for (y = 2; y < h - 2; y++) {
      for (x = 2; x < w - 2; x++) {
        var c = code[y * w + x], ones = 0, trans = 0, prev = 0, first = 0;
        for (i = 0; i < 8; i++) {
          var b = (c >> i) & 1;
          ones += b;
          if (i === 0) { prev = b; first = b; }
          else if (b !== prev) trans++;
          prev = b;
        }
        if (first !== prev) trans++;              // 环形比较 (7,0)
        hist[trans <= 2 ? ones : 9]++;
        total++;
      }
    }
    var denom = total + EPS;
    for (i = 0; i < 10; i++) hist[i] /= denom;
    return Array.prototype.slice.call(hist);
  }

  // ---- 3.4 color: HSV 28 维 --------------------------------------
  function featsColor(rgba, w, h) {
    var n = w * h, H = new Float64Array(n), S = new Float64Array(n), V = new Float64Array(n);
    var i, p;
    for (i = 0, p = 0; i < n; i++, p += 4) {
      var r = rgba[p] / 255, g = rgba[p + 1] / 255, b = rgba[p + 2] / 255;
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var d = mx - mn, hh;
      if (d === 0) hh = 0;
      else if (mx === r) hh = (((g - b) / d) + 6) % 6;
      else if (mx === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      H[i] = hh / 6;
      S[i] = mx === 0 ? 0 : d / mx;
      V[i] = mx;
    }

    function hist(src, bins, stride, off) {
      var out = new Float64Array(bins), cnt = 0, k;
      for (k = off; k < src.length; k += stride) {
        var bi = Math.floor(src[k] * bins);
        if (bi >= bins) bi = bins - 1; else if (bi < 0) bi = 0;
        out[bi]++; cnt++;
      }
      for (k = 0; k < bins; k++) out[k] /= (cnt + EPS);
      return out;
    }

    var out2 = [];
    var g8 = hist(H, 8, 1, 0);
    for (i = 0; i < 8; i++) out2.push(g8[i]);

    var h2 = w >> 1, y, x;                         // 2x2 分块
    for (var bi2 = 0; bi2 < 2; bi2++) {
      for (var bj = 0; bj < 2; bj++) {
        var cnt = 0, b4 = new Float64Array(4);
        for (y = bi2 * h2; y < (bi2 + 1) * h2; y++) {
          for (x = bj * h2; x < (bj + 1) * h2; x++) {
            var hv = H[y * w + x];
            var ib = Math.floor(hv * 4);
            if (ib >= 4) ib = 3; else if (ib < 0) ib = 0;
            b4[ib]++; cnt++;
          }
        }
        for (var k2 = 0; k2 < 4; k2++) out2.push(b4[k2] / (cnt + EPS));
      }
    }
    function stat(arr) {
      var s = 0, q = 0, m;
      for (m = 0; m < arr.length; m++) s += arr[m];
      var mu = s / arr.length;
      for (m = 0; m < arr.length; m++) { var dd = arr[m] - mu; q += dd * dd; }
      return [mu, Math.sqrt(q / arr.length)];
    }
    var ss = stat(S), vv = stat(V);
    out2.push(ss[0], ss[1], vv[0], vv[1]);
    return out2;
  }

  /* ================================================================
   * 4. 对外接口
   * ================================================================ */

  function extract(gray, rgba, w, h) {
    var f = [];
    f = f.concat(featsSkel(gray, w, h));
    f = f.concat(featsGabor(gray, w, h));
    f = f.concat(featsLbp(gray, w, h));
    f = f.concat(featsColor(rgba, w, h));
    return f;
  }

  function predict(f) {
    if (!MODEL) throw new Error('PatternAlgo: 模型未加载，请先 await PatternAlgo.load(url)');
    var mean = MODEL.scaler.mean, scale = MODEL.scaler.scale;
    var coef = MODEL.lda.coef, inter = MODEL.lda.intercept, cls = MODEL.classes;
    var scores = new Array(cls.length).fill(0);
    var xs = new Float64Array(f.length);

    for (var j = 0; j < f.length; j++) {
      var sc = scale[j] || 1;
      xs[j] = (f[j] - mean[j]) / sc;
    }
    for (var c = 0; c < cls.length; c++) {
      var row = coef[c], s = inter[c];
      for (var k = 0; k < xs.length; k++) s += xs[k] * row[k];
      scores[c] = s;
    }

    var ranked = cls.map(function (name, i) { return { label: name, score: scores[i] }; })
      .sort(function (a, b) { return b.score - a.score; });
    var margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : 0;

    var bands = (MODEL.bands || DEFAULT_BANDS);
    var level, conf;
    if (margin >= bands[1]) { level = '高'; conf = (MODEL.bandAcc && MODEL.bandAcc[2]) || 0.94; }
    else if (margin >= bands[0]) { level = '中'; conf = (MODEL.bandAcc && MODEL.bandAcc[1]) || 0.75; }
    else { level = '低'; conf = (MODEL.bandAcc && MODEL.bandAcc[0]) || 0.53; }

    // 展示用软分布：分数做 softmax，仅供可视化，不作校准概率。
    // 温度取 8：LDA 分数尺度是任意的，温度太低会把第二名起全压成 0%。
    var mxs = Math.max.apply(null, scores);
    var exps = scores.map(function (s) { return Math.exp((s - mxs) / 8); });
    var esum = exps.reduce(function (a, b) { return a + b; }, 0) || 1;
    var dist = {};
    for (var q = 0; q < cls.length; q++) dist[cls[q]] = exps[q] / esum;

    return {
      label: ranked[0].label,
      margin: margin,
      level: level,
      confidence: conf,
      scores: dist,
      rawScores: scores,
      ranked: ranked,
      dims: f.length,
      model: MODEL.version || 'unknown',
    };
  }

  var api = {};

  api.VERSION = '1.1.0';

  api.load = function (url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('模型加载失败 HTTP ' + r.status);
      return r.json();
    }).then(function (m) {
      MODEL = m; _kfft = null;
      // 预热：首次调用前把核 FFT 算好，避免识别时卡顿
      try { buildKernelFFT(512); } catch (e) { /* 忽略，识别时再算 */ }
      return m;
    });
  };

  api.loadModel = function (m) { MODEL = m; _kfft = null; return m; };
  api.isReady = function () { return !!MODEL; };

  // 从图像/画布提取 66 维特征
  api.features = function (src) {
    if (!MODEL) throw new Error('PatternAlgo: 模型未加载');
    var cv = drawToCanvas(src, SIZE);
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    var img = ctx.getImageData(0, 0, SIZE, SIZE);
    var gray = grayNormalized(img.data, SIZE, SIZE);
    return { vec: extract(gray, img.data, SIZE, SIZE), canvas: cv };
  };

  // 一步到位
  api.recognize = function (src) {
    var r = api.features(src);
    var out = predict(r.vec);
    out.features = r.vec;
    return out;
  };

  api.predict = predict;

  // 输入为【已经 256x256 灰度标准化】的数组时（parity 测试用）
  api.recognizeGray = function (grayVec, rgba, w, h) {
    return predict(extract(grayVec, rgba, w, h));
  };

  api._internal = {
    drawToCanvas: drawToCanvas, grayNormalized: grayNormalized,
    featsSkel: featsSkel, featsGabor: featsGabor,
    featsLbp: featsLbp, featsColor: featsColor, extract: extract,
    fft2d: fft2d, SIZE: SIZE
  };

  return api;
}));
