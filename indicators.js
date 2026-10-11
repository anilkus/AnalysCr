// Teknik göstergeler, formasyonlar ve kural tabanlı sinyal skoru. Tarayıcıda window.TA, Node'da module.exports.
(function (root) {
  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const start = values.findIndex(v => v != null);
    if (start < 0 || values.length - start < period) return out;
    const k = 2 / (period + 1);
    let prev = 0;
    for (let i = start; i < start + period; i++) prev += values[i];
    prev /= period;
    out[start + period - 1] = prev;
    for (let i = start + period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0, n = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] == null) { sum = 0; n = 0; continue; }
      sum += values[i]; n++;
      if (n > period) { sum -= values[i - period]; n = period; }
      if (n === period) out[i] = sum / period;
    }
    return out;
  }

  // Wilder RSI
  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period; loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  // Stochastic RSI (14, 14, 3, 3): %K ve %D 0..100
  function stochRsi(closes, rsiLen = 14, stLen = 14, kLen = 3, dLen = 3) {
    const r = rsi(closes, rsiLen);
    const raw = r.map((v, i) => {
      if (v == null || i < stLen - 1) return null;
      const win = r.slice(i - stLen + 1, i + 1);
      if (win.some(x => x == null)) return null;
      const hi = Math.max(...win), lo = Math.min(...win);
      return hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100;
    });
    const k = sma(raw, kLen);
    return { k, d: sma(k, dLen) };
  }

  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const ef = ema(closes, fast), es = ema(closes, slow);
    const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const sig = ema(line, signal);
    const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
    return { line, signal: sig, hist };
  }

  function bollinger(closes, period = 20, mult = 2) {
    const mid = sma(closes, period);
    const upper = [], lower = [];
    for (let i = 0; i < closes.length; i++) {
      if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
      let v = 0;
      for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / period);
      upper.push(mid[i] + mult * sd);
      lower.push(mid[i] - mult * sd);
    }
    return { mid, upper, lower };
  }

  const trueRange = candles => candles.map((c, i) => i === 0 ? c.high - c.low :
    Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));

  function wilder(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) { prev = (prev * (period - 1) + values[i]) / period; out[i] = prev; }
    return out;
  }

  const atr = (candles, period = 14) => wilder(trueRange(candles), period);

  // ADX ve yön göstergeleri (+DI, -DI)
  function adx(candles, period = 14) {
    const n = candles.length;
    const plusDM = [0], minusDM = [0];
    for (let i = 1; i < n; i++) {
      const up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low;
      plusDM.push(up > dn && up > 0 ? up : 0);
      minusDM.push(dn > up && dn > 0 ? dn : 0);
    }
    const tr = wilder(trueRange(candles), period), pdm = wilder(plusDM, period), mdm = wilder(minusDM, period);
    const pdi = tr.map((t, i) => t ? (100 * pdm[i]) / t : null);
    const mdi = tr.map((t, i) => t ? (100 * mdm[i]) / t : null);
    const dx = pdi.map((p, i) => p == null || mdi[i] == null || p + mdi[i] === 0 ? null : (100 * Math.abs(p - mdi[i])) / (p + mdi[i]));
    const first = dx.findIndex(v => v != null);
    const adxArr = new Array(n).fill(null);
    if (first >= 0) wilder(dx.slice(first), period).forEach((v, j) => { adxArr[first + j] = v; });
    return { adx: adxArr, plusDI: pdi, minusDI: mdi };
  }

  // Salınım tepe/dipleri: sol ve sağdaki `w` mumdan yüksek/alçak olan noktalar
  function pivots(candles, w = 3) {
    const highs = [], lows = [];
    for (let i = w; i < candles.length - w; i++) {
      let isH = true, isL = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue;
        // eşit değerlerde ilk mum pivot sayılır
        if (j < i ? candles[j].high >= candles[i].high : candles[j].high > candles[i].high) isH = false;
        if (j < i ? candles[j].low <= candles[i].low : candles[j].low < candles[i].low) isL = false;
      }
      if (isH) highs.push(i);
      if (isL) lows.push(i);
    }
    return { highs, lows };
  }

  // Destek/direnç: pivot fiyatlarını ATR toleransıyla kümele, dokunuş sayısına göre güç ver
  function supportResistance(candles, atrNow, lookback = 300) {
    const start = Math.max(0, candles.length - lookback);
    const sub = candles.slice(start);
    const pv = pivots(sub, 4);
    const pts = [...pv.highs.map(i => sub[i].high), ...pv.lows.map(i => sub[i].low)].sort((a, b) => a - b);
    const tol = (atrNow || sub[sub.length - 1].close * 0.01) * 0.6;
    const clusters = [];
    for (const p of pts) {
      const c = clusters[clusters.length - 1];
      if (c && p - c.max <= tol) { c.sum += p; c.n++; c.max = p; }
      else clusters.push({ sum: p, n: 1, max: p });
    }
    const price = candles[candles.length - 1].close;
    const levels = clusters.map(c => ({ price: c.sum / c.n, touches: c.n }));
    const supports = levels.filter(l => l.price < price).sort((a, b) => b.price - a.price).slice(0, 3);
    const resistances = levels.filter(l => l.price > price).sort((a, b) => a.price - b.price).slice(0, 3);
    return { supports, resistances };
  }

  // Son büyük salınıma göre Fibonacci düzeltme seviyeleri
  function fibonacci(candles, lookback = 150) {
    const sub = candles.slice(-lookback);
    let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
    sub.forEach((c, i) => { if (c.high > hi) { hi = c.high; hiI = i; } if (c.low < lo) { lo = c.low; loI = i; } });
    const up = loI < hiI; // önce dip sonra tepe → yükseliş salınımı
    const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const levels = ratios.map(r => ({ ratio: r, price: up ? hi - (hi - lo) * r : lo + (hi - lo) * r }));
    return { up, high: hi, low: lo, levels };
  }

  // Mum formasyonları: son kapanmış mumlara bakar. Her biri {name, dir: 1|-1|0}
  function candlePatterns(candles) {
    const out = [];
    const n = candles.length;
    if (n < 6) return out;
    const c = candles[n - 1], p = candles[n - 2], pp = candles[n - 3];
    const body = k => Math.abs(k.close - k.open);
    const range = k => k.high - k.low || 1e-12;
    const upper = k => k.high - Math.max(k.open, k.close);
    const lower = k => Math.min(k.open, k.close) - k.low;
    const bull = k => k.close > k.open, bear = k => k.close < k.open;
    const avgBody = candles.slice(-15, -1).reduce((s, k) => s + body(k), 0) / 14 || 1e-12;
    const downBefore = candles[n - 2].close < candles[n - 6].close;
    const upBefore = candles[n - 2].close > candles[n - 6].close;

    if (bear(p) && bull(c) && c.close >= p.open && c.open <= p.close && body(c) > body(p))
      out.push({ name: 'Yutan Boğa (Bullish Engulfing)', dir: 1 });
    if (bull(p) && bear(c) && c.open >= p.close && c.close <= p.open && body(c) > body(p))
      out.push({ name: 'Yutan Ayı (Bearish Engulfing)', dir: -1 });

    const smallBody = body(c) <= range(c) * 0.35;
    if (smallBody && lower(c) >= 2 * body(c) && upper(c) <= range(c) * 0.15) {
      if (downBefore) out.push({ name: 'Çekiç (Hammer)', dir: 1 });
      else if (upBefore) out.push({ name: 'Asılı Adam (Hanging Man)', dir: -1 });
    }
    if (smallBody && upper(c) >= 2 * body(c) && lower(c) <= range(c) * 0.15) {
      if (upBefore) out.push({ name: 'Kayan Yıldız (Shooting Star)', dir: -1 });
      else if (downBefore) out.push({ name: 'Ters Çekiç (Inverted Hammer)', dir: 1 });
    }
    if (body(c) <= range(c) * 0.08 && !out.length) out.push({ name: 'Doji (kararsızlık)', dir: 0 });

    const mid = k => (k.open + k.close) / 2;
    if (bear(pp) && body(pp) > avgBody && body(p) < avgBody * 0.5 && bull(c) && c.close > mid(pp))
      out.push({ name: 'Sabah Yıldızı (Morning Star)', dir: 1 });
    if (bull(pp) && body(pp) > avgBody && body(p) < avgBody * 0.5 && bear(c) && c.close < mid(pp))
      out.push({ name: 'Akşam Yıldızı (Evening Star)', dir: -1 });

    if ([pp, p, c].every(bull) && p.close > pp.close && c.close > p.close && [pp, p, c].every(k => body(k) > avgBody * 0.7))
      out.push({ name: 'Üç Beyaz Asker', dir: 1 });
    if ([pp, p, c].every(bear) && p.close < pp.close && c.close < p.close && [pp, p, c].every(k => body(k) > avgBody * 0.7))
      out.push({ name: 'Üç Kara Karga', dir: -1 });
    return out;
  }

  // RSI uyumsuzluğu: son iki salınım dibi/tepesi ile RSI karşılaştırması
  function divergence(candles, rsiArr, lookback = 60) {
    const start = Math.max(0, candles.length - lookback);
    const sub = candles.slice(start);
    const pv = pivots(sub, 3);
    const r = i => rsiArr[start + i];
    const L = pv.lows.slice(-2), H = pv.highs.slice(-2);
    if (L.length === 2 && r(L[0]) != null && sub[L[1]].low < sub[L[0]].low && r(L[1]) > r(L[0]) + 2)
      return { dir: 1, text: 'Pozitif RSI uyumsuzluğu: fiyat daha düşük dip yaptı, RSI yapmadı.' };
    if (H.length === 2 && r(H[0]) != null && sub[H[1]].high > sub[H[0]].high && r(H[1]) < r(H[0]) - 2)
      return { dir: -1, text: 'Negatif RSI uyumsuzluğu: fiyat daha yüksek tepe yaptı, RSI yapmadı.' };
    return null;
  }

  function computeAll(candles) {
    const closes = candles.map(c => c.close);
    return {
      ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200),
      sma50: sma(closes, 50), sma200: sma(closes, 200),
      rsi: rsi(closes, 14), stoch: stochRsi(closes), macd: macd(closes), bb: bollinger(closes),
      atr: atr(candles, 14), adx: adx(candles, 14), volSma: sma(candles.map(c => c.volume), 20),
    };
  }

  const last = (arr, back = 0) => arr[arr.length - 1 - back];
  const fmt = v => v.toLocaleString('tr-TR', { maximumSignificantDigits: v >= 1000 ? 6 : 4 });

  // Ağırlıklı kurallar → -100..100 skor ve gruplanmış Türkçe gerekçeler.
  function signal(candles, ind) {
    ind = ind || computeAll(candles);
    const closed = candles.slice(0, -1); // formasyonlar için kapanmış mumlar
    const c = last(candles).close;
    const reasons = [];
    let score = 0, max = 0;
    const add = (group, w, val, text) => { max += w; score += w * val; reasons.push({ group, w: val, pts: w * val, text }); };
    const note = (group, text) => reasons.push({ group, w: 0, pts: 0, text });

    // --- Trend ---
    const a = last(ind.adx.adx), pdi = last(ind.adx.plusDI), mdi = last(ind.adx.minusDI);
    const strong = a != null && a >= 25;
    const e20 = last(ind.ema20), e50 = last(ind.ema50), s200 = last(ind.sma200);
    if (s200 != null) add('Trend', 15, c > s200 ? 1 : -1, c > s200 ? 'Fiyat MA200 (200 mumluk ortalama) üzerinde: ana trend yukarı.' : 'Fiyat MA200 altında: ana trend aşağı.');
    if (e20 != null && e50 != null) add('Trend', 10, e20 > e50 ? 1 : -1, e20 > e50 ? 'EMA20 > EMA50: kısa vade yükselişte.' : 'EMA20 < EMA50: kısa vade düşüşte.');
    // Golden / death cross: MA50, MA200'ü son 15 mumda kestiyse
    let cross = 0;
    for (let b = 0; b < 15 && !cross; b++) {
      const s50a = last(ind.sma50, b), s200a = last(ind.sma200, b), s50b = last(ind.sma50, b + 1), s200b = last(ind.sma200, b + 1);
      if ([s50a, s200a, s50b, s200b].some(v => v == null)) break;
      if (s50b <= s200b && s50a > s200a) cross = 1;
      else if (s50b >= s200b && s50a < s200a) cross = -1;
    }
    if (cross) add('Trend', 15, cross, cross > 0 ? 'Golden Cross: MA50, MA200\'ü yukarı kesti.' : 'Death Cross: MA50, MA200\'ü aşağı kesti.');
    if (a != null) {
      if (strong) add('Trend', 10, pdi > mdi ? 1 : -1, `ADX ${a.toFixed(0)}: güçlü trend, ${pdi > mdi ? 'alıcılar (+DI)' : 'satıcılar (−DI)'} baskın.`);
      else note('Trend', `ADX ${a.toFixed(0)}: trend zayıf, yatay piyasa. Osilatör sinyalleri daha anlamlı.`);
    }

    // --- Momentum ---
    const r = last(ind.rsi);
    if (r != null) {
      let v, t;
      if (r < 30) { v = 1; t = `RSI ${r.toFixed(1)}: aşırı satım bölgesi.`; }
      else if (r > 70) { v = -1; t = `RSI ${r.toFixed(1)}: aşırı alım bölgesi.`; }
      else if (r >= 50) { v = 0.4; t = `RSI ${r.toFixed(1)}: 50 üzerinde, alıcılar baskın.`; }
      else { v = -0.4; t = `RSI ${r.toFixed(1)}: 50 altında, satıcılar baskın.`; }
      add('Momentum', 12, v, t);
    }
    const k = last(ind.stoch.k), d = last(ind.stoch.d), kp = last(ind.stoch.k, 1), dp = last(ind.stoch.d, 1);
    if (k != null && d != null && kp != null && dp != null) {
      if (kp <= dp && k > d && k < 30) add('Momentum', 10, 1, `Stoch RSI aşırı satımda yukarı kesişti (%K ${k.toFixed(0)}).`);
      else if (kp >= dp && k < d && k > 70) add('Momentum', 10, -1, `Stoch RSI aşırı alımda aşağı kesişti (%K ${k.toFixed(0)}).`);
      else if (k < 20) add('Momentum', 10, 0.5, `Stoch RSI ${Math.abs(k).toFixed(0)}: aşırı satım.`);
      else if (k > 80) add('Momentum', 10, -0.5, `Stoch RSI ${k.toFixed(0)}: aşırı alım.`);
      else add('Momentum', 10, k > d ? 0.2 : -0.2, `Stoch RSI ${k.toFixed(0)}, %K ${k > d ? '>' : '<'} %D.`);
    }
    const h = last(ind.macd.hist), hp = last(ind.macd.hist, 1);
    if (h != null && hp != null) {
      if (hp <= 0 && h > 0) add('Momentum', 12, 1, 'MACD sinyal çizgisini yukarı kesti (AL kesişimi).');
      else if (hp >= 0 && h < 0) add('Momentum', 12, -1, 'MACD sinyal çizgisini aşağı kesti (SAT kesişimi).');
      else if (h > 0) add('Momentum', 12, h > hp ? 0.6 : 0.2, h > hp ? 'MACD pozitif ve güçleniyor.' : 'MACD pozitif ama ivme zayıflıyor.');
      else add('Momentum', 12, h < hp ? -0.6 : -0.2, h < hp ? 'MACD negatif ve derinleşiyor.' : 'MACD negatif ama satış ivmesi azalıyor.');
    }
    const div = divergence(candles, ind.rsi);
    if (div) add('Momentum', 10, div.dir, div.text);

    // --- Bollinger ---
    const up = last(ind.bb.upper), lo = last(ind.bb.lower);
    if (up != null && lo != null) {
      const pb = (c - lo) / (up - lo || 1);
      // Güçlü trendde bant kenarı devam sinyalidir, yatayda dönüş sinyali
      if (pb < 0.05) add('Volatilite', 8, strong && mdi > pdi ? -0.3 : 0.8, strong && mdi > pdi ? 'Alt Bollinger bandında, güçlü düşüş trendinde (bant boyunca yürüyor).' : 'Alt Bollinger bandına değdi: dönüş olası.');
      else if (pb > 0.95) add('Volatilite', 8, strong && pdi > mdi ? 0.3 : -0.8, strong && pdi > mdi ? 'Üst Bollinger bandında, güçlü yükseliş trendinde (bant boyunca yürüyor).' : 'Üst Bollinger bandına değdi: geri çekilme olası.');
      else note('Volatilite', `Fiyat Bollinger bandının %${Math.round(pb * 100)} seviyesinde.`);
      const width = (up - lo) / last(ind.bb.mid);
      const widths = ind.bb.upper.slice(-120).map((u, i, arr) => u == null ? null : (u - ind.bb.lower.slice(-120)[i]) / ind.bb.mid.slice(-120)[i]).filter(v => v != null);
      if (widths.length > 50 && width <= Math.min(...widths) * 1.1) note('Volatilite', 'Bollinger sıkışması: sert bir hareket yaklaşıyor olabilir.');
    }

    // --- Yapı: destek/direnç ve Fibonacci ---
    const atrNow = last(ind.atr);
    const sr = supportResistance(candles, atrNow);
    const ns = sr.supports[0], nr = sr.resistances[0];
    if (atrNow) {
      const prevClose = last(candles, 1).close;
      const prevRes = supportResistance(candles.slice(0, -1), atrNow).resistances;
      const broken = prevRes.find(l => prevClose < l.price && c > l.price);
      if (broken) add('Yapı', 15, 1, `${fmt(broken.price)} direnci yukarı kırıldı.`);
      else if (ns && c - ns.price < atrNow * 0.8) add('Yapı', 15, 0.7, `Fiyat ${fmt(ns.price)} desteğine yakın (${ns.touches} dokunuş).`);
      else if (nr && nr.price - c < atrNow * 0.8) add('Yapı', 15, -0.7, `Fiyat ${fmt(nr.price)} direncine yakın (${nr.touches} dokunuş).`);
      else note('Yapı', `En yakın destek ${ns ? fmt(ns.price) : '—'}, direnç ${nr ? fmt(nr.price) : '—'}.`);
    }
    const fib = fibonacci(candles);
    if (atrNow) {
      const near = fib.levels.filter(l => l.ratio > 0 && l.ratio < 1).find(l => Math.abs(c - l.price) < atrNow * 0.5);
      if (near) {
        const golden = near.ratio === 0.5 || near.ratio === 0.618;
        add('Yapı', 8, (fib.up ? 1 : -1) * (golden ? 0.8 : 0.4),
          `Fiyat ${fib.up ? 'yükseliş' : 'düşüş'} salınımının Fibonacci %${(near.ratio * 100).toFixed(1)} seviyesinde (${fmt(near.price)})${golden ? ': klasik dönüş bölgesi' : ''}.`);
      }
    }

    // --- Mum formasyonları ---
    const pats = candlePatterns(closed);
    pats.forEach(p => p.dir ? add('Formasyon', 8, p.dir, `${p.name} formasyonu (son kapanan mum).`) : note('Formasyon', `${p.name} (son kapanan mum).`));
    if (!pats.length) note('Formasyon', 'Son mumlarda belirgin formasyon yok.');

    // --- Hacim ---
    const vs = last(ind.volSma, 1), vol = last(closed)?.volume;
    if (vs && vol != null) {
      const ratio = vol / vs, k1 = last(closed);
      const dir = k1.close >= k1.open ? 1 : -1;
      if (ratio > 1.5) add('Hacim', 10, dir, `Son mumda hacim ortalamanın ${ratio.toFixed(1)} katı, ${dir > 0 ? 'alıcılı' : 'satıcılı'}: hareketi teyit ediyor.`);
      else note('Hacim', `Hacim normal (ortalamanın ${ratio.toFixed(1)} katı).`);
    }

    const norm = max ? Math.round((score / max) * 100) : 0;
    let label, cls;
    if (norm >= 40) { label = 'GÜÇLÜ AL'; cls = 'buy'; }
    else if (norm >= 15) { label = 'AL'; cls = 'buy'; }
    else if (norm <= -40) { label = 'GÜÇLÜ SAT'; cls = 'sell'; }
    else if (norm <= -15) { label = 'SAT'; cls = 'sell'; }
    else { label = 'BEKLE'; cls = 'neutral'; }

    // Zarar-kes / hedef: önce yapısal seviyeler, yoksa ATR
    let levels = null;
    if (atrNow) {
      if (cls === 'sell') {
        const stop = nr && nr.price - c < atrNow * 3 ? nr.price + atrNow * 0.3 : c + 1.5 * atrNow;
        const target = ns && c - ns.price > atrNow ? ns.price : c - 2.5 * atrNow;
        levels = { stop, target };
      } else {
        const stop = ns && c - ns.price < atrNow * 3 ? ns.price - atrNow * 0.3 : c - 1.5 * atrNow;
        const target = nr && nr.price - c > atrNow ? nr.price : c + 2.5 * atrNow;
        levels = { stop, target };
      }
      levels.rr = Math.abs(levels.target - c) / Math.abs(c - levels.stop);
    }

    return { score: norm, label, cls, reasons, rsi: r, adx: a, atr: atrNow, levels, price: c, sr, fib, patterns: pats };
  }

  const TA = { ema, sma, rsi, stochRsi, macd, bollinger, atr, adx, pivots, supportResistance, fibonacci, candlePatterns, divergence, computeAll, signal };
  if (typeof module !== 'undefined' && module.exports) module.exports = TA;
  else root.TA = TA;
})(typeof window !== 'undefined' ? window : globalThis);
