// Teknik göstergeler ve kural tabanlı sinyal skoru. Tarayıcıda window.TA, Node'da module.exports.
(function (root) {
  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
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

  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const ef = ema(closes, fast), es = ema(closes, slow);
    const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const start = line.findIndex(v => v != null);
    const sig = new Array(closes.length).fill(null);
    if (start >= 0) {
      const s = ema(line.slice(start), signal);
      s.forEach((v, j) => { sig[start + j] = v; });
    }
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

  function atr(candles, period = 14) {
    const tr = candles.map((c, i) => i === 0 ? c.high - c.low :
      Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
    const out = new Array(candles.length).fill(null);
    if (candles.length < period) return out;
    let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < candles.length; i++) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
    return out;
  }

  function computeAll(candles) {
    const closes = candles.map(c => c.close);
    return {
      ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200),
      rsi: rsi(closes, 14), macd: macd(closes), bb: bollinger(closes), atr: atr(candles, 14),
      volSma: sma(candles.map(c => c.volume), 20),
    };
  }

  const last = (arr, back = 0) => arr[arr.length - 1 - back];

  // Ağırlıklı kurallar → -100..100 skor ve Türkçe gerekçeler.
  function signal(candles, ind) {
    ind = ind || computeAll(candles);
    const c = last(candles).close;
    const reasons = [];
    let score = 0, max = 0;
    const add = (w, val, text) => { max += w; score += w * val; reasons.push({ w: val, text }); };

    const e20 = last(ind.ema20), e50 = last(ind.ema50), e200 = last(ind.ema200);
    if (e200 != null) {
      add(20, c > e200 ? 1 : -1, c > e200 ? 'Fiyat EMA200 üzerinde: ana trend yukarı.' : 'Fiyat EMA200 altında: ana trend aşağı.');
    }
    if (e20 != null && e50 != null) {
      const p20 = last(ind.ema20, 3), p50 = last(ind.ema50, 3);
      const crossUp = p20 != null && p50 != null && p20 <= p50 && e20 > e50;
      const crossDown = p20 != null && p50 != null && p20 >= p50 && e20 < e50;
      if (crossUp) add(15, 1, 'EMA20, EMA50\'yi yukarı kesti (golden cross).');
      else if (crossDown) add(15, -1, 'EMA20, EMA50\'yi aşağı kesti (death cross).');
      else add(15, e20 > e50 ? 0.6 : -0.6, e20 > e50 ? 'EMA20 > EMA50: kısa vadeli momentum pozitif.' : 'EMA20 < EMA50: kısa vadeli momentum negatif.');
    }

    const r = last(ind.rsi);
    if (r != null) {
      let v, t;
      if (r < 30) { v = 1; t = `RSI ${r.toFixed(1)}: aşırı satım, tepki yükselişi olası.`; }
      else if (r > 70) { v = -1; t = `RSI ${r.toFixed(1)}: aşırı alım, düzeltme riski.`; }
      else if (r >= 50) { v = 0.3; t = `RSI ${r.toFixed(1)}: alıcılar hafif baskın.`; }
      else { v = -0.3; t = `RSI ${r.toFixed(1)}: satıcılar hafif baskın.`; }
      add(20, v, t);
    }

    const h = last(ind.macd.hist), hp = last(ind.macd.hist, 1);
    if (h != null && hp != null) {
      if (hp <= 0 && h > 0) add(20, 1, 'MACD sinyal çizgisini yukarı kesti.');
      else if (hp >= 0 && h < 0) add(20, -1, 'MACD sinyal çizgisini aşağı kesti.');
      else if (h > 0) add(20, h > hp ? 0.6 : 0.25, h > hp ? 'MACD histogramı pozitif ve büyüyor.' : 'MACD pozitif ama ivme zayıflıyor.');
      else add(20, h < hp ? -0.6 : -0.25, h < hp ? 'MACD histogramı negatif ve derinleşiyor.' : 'MACD negatif ama satış ivmesi azalıyor.');
    }

    const up = last(ind.bb.upper), lo = last(ind.bb.lower);
    if (up != null && lo != null) {
      const pb = (c - lo) / (up - lo || 1);
      if (pb < 0.05) add(15, 0.8, 'Fiyat alt Bollinger bandında: banttan dönüş olası.');
      else if (pb > 0.95) add(15, -0.8, 'Fiyat üst Bollinger bandında: gerilim yüksek.');
      else add(15, 0, `Fiyat Bollinger bandının %${Math.round(pb * 100)} seviyesinde.`);
    }

    const vs = last(ind.volSma), vol = last(candles).volume;
    if (vs) {
      const ratio = vol / vs;
      const dir = last(candles).close >= last(candles).open ? 1 : -1;
      if (ratio > 1.5) add(10, dir, `Hacim ortalamanın ${ratio.toFixed(1)} katı, ${dir > 0 ? 'alıcılı' : 'satıcılı'} mum.`);
      else reasons.push({ w: 0, text: `Hacim normal (ortalamanın ${ratio.toFixed(1)} katı).` });
    }

    const norm = max ? Math.round((score / max) * 100) : 0;
    let label, cls;
    if (norm >= 45) { label = 'GÜÇLÜ AL'; cls = 'buy'; }
    else if (norm >= 15) { label = 'AL'; cls = 'buy'; }
    else if (norm <= -45) { label = 'GÜÇLÜ SAT'; cls = 'sell'; }
    else if (norm <= -15) { label = 'SAT'; cls = 'sell'; }
    else { label = 'NÖTR'; cls = 'neutral'; }

    const a = last(ind.atr);
    const levels = a ? (cls === 'sell'
      ? { stop: c + 1.5 * a, target: c - 2.5 * a }
      : { stop: c - 1.5 * a, target: c + 2.5 * a }) : null;

    return { score: norm, label, cls, reasons, rsi: r, atr: a, levels, price: c };
  }

  const TA = { ema, sma, rsi, macd, bollinger, atr, computeAll, signal };
  if (typeof module !== 'undefined' && module.exports) module.exports = TA;
  else root.TA = TA;
})(typeof window !== 'undefined' ? window : globalThis);
