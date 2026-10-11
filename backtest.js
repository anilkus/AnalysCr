// Geriye dönük test: sinyallerle spot (yalnızca alış) işlem yapılsaydı ne olurdu?
// Tarayıcıda window.BT, Node'da module.exports. TA (indicators.js) gerekir.
(function (root) {
  const TA = typeof module !== 'undefined' && module.exports ? require('./indicators.js') : root.TA;

  const BARS_PER_YEAR = { '15m': 35040, '1h': 8760, '4h': 2190, '1d': 365 };

  // Her mum için ham sinyali bir kez hesapla; farklı parametreler bunu yeniden puanlar.
  function precompute(candles, from = 210) {
    const ind = TA.computeAll(candles);
    const raws = new Array(candles.length).fill(null);
    for (let i = from; i < candles.length; i++) raws[i] = TA.signalRaw(candles, ind, i);
    return raws;
  }

  // Kural: kapanışta AL/GÜÇLÜ AL → sonraki açılışta al. SAT/GÜÇLÜ SAT (exit:'sell') ya da skor < 0 (exit:'zero')
  // → sonraki açılışta sat. Komisyon her işlemde %0.1.
  function run(candles, raws, P, opts = {}) {
    const fee = opts.fee ?? 0.001;
    const exit = opts.exit || P.exit || 'sell';
    const from = opts.from ?? raws.findIndex(r => r);
    const to = opts.to ?? candles.length - 1;
    let pos = false, entry = 0, eq = 1, peak = 1, maxDD = 0, inBars = 0;
    const trades = [], curve = [], barRets = [];
    const hold0 = candles[from].close;
    let prevEq = 1;
    for (let i = from; i < to; i++) {
      const s = TA.scoreRaw(raws[i], P);
      const next = candles[i + 1];
      // Pozisyondaysa mumu taşı
      if (pos) {
        inBars++;
      }
      // Karar kapanışta, uygulama sonraki açılışta
      if (!pos && s.cls === 'buy') { pos = true; entry = next.open; eq *= 1 - fee; trades.push({ inTime: next.time, in: next.open }); }
      else if (pos && (exit === 'sell' ? s.cls === 'sell' : s.score < 0)) {
        pos = false; eq *= (next.open / entry) * (1 - fee);
        const t = trades[trades.length - 1]; t.outTime = next.time; t.out = next.open; t.ret = (next.open / t.in) * (1 - fee) ** 2 - 1;
      }
      const mark = pos ? eq * (next.close / entry) : eq;
      peak = Math.max(peak, mark); maxDD = Math.max(maxDD, 1 - mark / peak);
      barRets.push(mark / prevEq - 1); prevEq = mark;
      curve.push({ time: next.time, strat: mark, hold: next.close / hold0 });
    }
    if (pos) { // açık pozisyonu son kapanıştan kapat
      const lastC = candles[to].close; eq *= (lastC / entry) * (1 - fee);
      const t = trades[trades.length - 1]; t.outTime = candles[to].time; t.out = lastC; t.ret = (lastC / t.in) * (1 - fee) ** 2 - 1; t.open = true;
    }
    const closed = trades.filter(t => t.ret != null);
    const wins = closed.filter(t => t.ret > 0);
    const holdRet = candles[to].close / hold0 - 1;
    let hPeak = 0, holdDD = 0;
    for (let i = from; i <= to; i++) { hPeak = Math.max(hPeak, candles[i].close); holdDD = Math.max(holdDD, 1 - candles[i].close / hPeak); }
    const mean = barRets.reduce((a, b) => a + b, 0) / (barRets.length || 1);
    const sd = Math.sqrt(barRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (barRets.length || 1));
    const bpy = BARS_PER_YEAR[opts.interval] || 365;
    const grossWin = wins.reduce((a, t) => a + t.ret, 0), grossLoss = -closed.filter(t => t.ret <= 0).reduce((a, t) => a + t.ret, 0);
    return {
      curve, trades,
      ret: eq - 1, holdRet, maxDD, holdDD,
      sharpe: sd ? (mean / sd) * Math.sqrt(bpy) : 0,
      nTrades: closed.length, winRate: closed.length ? wins.length / closed.length : 0,
      avgTrade: closed.length ? closed.reduce((a, t) => a + t.ret, 0) / closed.length : 0,
      profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
      exposure: inBars / Math.max(1, to - from),
    };
  }

  // Etiket isabeti: her etiketten sonra `h` mum içindeki getiri
  function labelStats(candles, raws, P, h = 10, from, to) {
    from = from ?? raws.findIndex(r => r); to = to ?? candles.length - 1;
    const out = {};
    for (const l of ['GÜÇLÜ AL', 'AL', 'BEKLE', 'SAT', 'GÜÇLÜ SAT']) out[l] = { n: 0, sum: 0, up: 0 };
    for (let i = from; i + h <= to; i++) {
      const s = TA.scoreRaw(raws[i], P);
      const r = candles[i + h].close / candles[i].close - 1;
      const o = out[s.label]; o.n++; o.sum += r; if (r > 0) o.up++;
    }
    for (const l in out) { const o = out[l]; o.avg = o.n ? o.sum / o.n : 0; o.hit = o.n ? o.up / o.n : 0; }
    return out;
  }

  const BT = { precompute, run, labelStats, BARS_PER_YEAR };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT;
  else root.BT = BT;
})(typeof window !== 'undefined' ? window : globalThis);
