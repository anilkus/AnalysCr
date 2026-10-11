// Ağırlık/eşik ayarı: veri/ içindeki geçmişte ızgara araması.
// Zamanın ilk %65'i ayar (in-sample), son %35'i kontrol (out-of-sample). Kullanım: node tools/tune.mjs
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TA = require('../indicators.js');
const BT = require('../backtest.js');

const INTERVALS = (process.env.IV || '4h,1d').split(',');
const SPLIT = 0.65, FEE = 0.001;
const GROUPS = ['trend', 'momentum', 'reversion', 'structure', 'pattern', 'volume'];

const series = [];
for (const f of readdirSync('data').filter(f => INTERVALS.some(iv => f.endsWith(`_${iv}.json`)))) {
  const [sym, iv] = f.replace('.json', '').split('_');
  const candles = JSON.parse(readFileSync('data/' + f)).map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  const t0 = Date.now();
  const raws = BT.precompute(candles);
  // Hızlı puanlama için grup toplamlarını çıkar
  const g = raws.map(r => r && Object.fromEntries(GROUPS.map(k => {
    const its = r.items[k];
    const f1 = its.filter(x => !x.against), f2 = its.filter(x => x.against);
    return [k, [f1.reduce((a, x) => a + x.val, 0), f1.length, f2.reduce((a, x) => a + x.val, 0), f2.length]];
  })));
  const from = raws.findIndex(r => r);
  const split = Math.floor(from + (candles.length - from) * SPLIT);
  const ind = TA.computeAll(candles);
  series.push({ sym, iv, candles, raws, g, from, split, sma200: ind.sma200 });
  console.error(`${sym} ${iv} ${candles.length} mum, ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
}

function fastScore(gi, P) {
  const tw = GROUPS.reduce((a, k) => a + P.w[k], 0);
  let s = 0;
  for (const k of GROUPS) {
    const [sv, n, sa, na] = gi[k];
    const cnt = n + (P.gate > 0 ? na : 0);
    if (cnt) s += P.w[k] * (sv + P.gate * sa) / cnt;
  }
  return Math.round(s / tw * 100);
}

// Basit ve hızlı simülasyon (BT.run ile aynı kurallar)
function sim(S, P, from, to) {
  const { candles, g } = S;
  let pos = false, entry = 0, eq = 1, peak = 1, dd = 0, prev = 1, n = 0, wins = 0;
  const rets = [];
  for (let i = from; i < to; i++) {
    const sc = fastScore(g[i], P), next = candles[i + 1];
    if (!pos && sc >= P.buy) { pos = true; entry = next.open; eq *= 1 - FEE; }
    else if (pos && (P.exit === 'sell' ? sc <= -P.buy : sc < 0)) { pos = false; const r = next.open / entry; eq *= r * (1 - FEE); n++; if (r * (1 - FEE) ** 2 > 1) wins++; }
    const m = pos ? eq * next.close / entry : eq;
    peak = Math.max(peak, m); dd = Math.max(dd, 1 - m / peak); rets.push(m / prev - 1); prev = m;
  }
  if (pos) { const r = candles[to].close / entry; eq *= r * (1 - FEE); n++; if (r * (1 - FEE) ** 2 > 1) wins++; }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  return { ret: eq - 1, dd, sharpe: sd ? mean / sd * Math.sqrt(BT.BARS_PER_YEAR[S.iv]) : 0, n, win: n ? wins / n : 0 };
}

function benchmarks(S, from, to) {
  const { candles, sma200 } = S;
  const hold = candles[to].close / candles[from].close - 1;
  let hp = 0, hdd = 0; const hr = [];
  for (let i = from; i <= to; i++) { hp = Math.max(hp, candles[i].close); hdd = Math.max(hdd, 1 - candles[i].close / hp); if (i > from) hr.push(candles[i].close / candles[i - 1].close - 1); }
  const m = hr.reduce((a, b) => a + b, 0) / hr.length, sd = Math.sqrt(hr.reduce((a, b) => a + (b - m) ** 2, 0) / hr.length);
  // MA200 filtresi: kapanış MA200 üstündeyse tut
  let pos = false, entry = 0, eq = 1, peak = 1, dd = 0, prev = 1; const rr = [];
  for (let i = from; i < to; i++) {
    const up = candles[i].close > sma200[i], next = candles[i + 1];
    if (!pos && up) { pos = true; entry = next.open; eq *= 1 - FEE; }
    else if (pos && !up) { pos = false; eq *= next.open / entry * (1 - FEE); }
    const mk = pos ? eq * next.close / entry : eq; peak = Math.max(peak, mk); dd = Math.max(dd, 1 - mk / peak); rr.push(mk / prev - 1); prev = mk;
  }
  if (pos) eq *= candles[to].close / entry * (1 - FEE);
  const m2 = rr.reduce((a, b) => a + b, 0) / rr.length, sd2 = Math.sqrt(rr.reduce((a, b) => a + (b - m2) ** 2, 0) / rr.length);
  const bpy = Math.sqrt(BT.BARS_PER_YEAR[S.iv]);
  return { hold: { ret: hold, dd: hdd, sharpe: m / sd * bpy }, ma200: { ret: eq - 1, dd, sharpe: sd2 ? m2 / sd2 * bpy : 0 } };
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

function evaluate(P, part) {
  const rs = series.map(S => part === 'in' ? sim(S, P, S.from, S.split) : sim(S, P, S.split, S.candles.length - 1));
  return { sharpe: mean(rs.map(r => r.sharpe)), medSharpe: median(rs.map(r => r.sharpe)), ret: median(rs.map(r => r.ret)), dd: median(rs.map(r => r.dd)), trades: mean(rs.map(r => r.n)), win: mean(rs.map(r => r.win)), per: rs };
}

// Izgara
const grid = [];
for (const trend of [20, 35, 50]) for (const momentum of [10, 25, 40]) for (const reversion of [0, 10, 20])
  for (const structure of [0, 10, 20]) for (const pattern of [0, 5]) for (const volume of [0, 5])
    for (const buy of [10, 20, 30, 40]) for (const gate of [0, 0.5, 1]) for (const exit of ['sell', 'zero'])
      grid.push({ w: { trend, momentum, reversion, structure, pattern, volume }, buy, strong: buy + 20, gate, exit });
console.error('kombinasyon:', grid.length);

let best = null;
const scored = [];
for (const P of grid) {
  const e = evaluate(P, 'in');
  // Az işlemli (şans eseri) sonuçları ele: seri başına en az 3 işlem
  if (e.trades < 3) continue;
  scored.push({ P, e });
}
scored.sort((a, b) => b.e.sharpe - a.e.sharpe);
best = scored[0];

const DEF = { ...TA.DEFAULTS, exit: 'sell' };
const out = { default: { in: evaluate(DEF, 'in'), out: evaluate(DEF, 'out') }, best: { P: best.P, in: best.e, out: evaluate(best.P, 'out') }, top: scored.slice(0, 10).map(x => ({ P: x.P, in: x.e.sharpe, out: evaluate(x.P, 'out').sharpe })) };
const bench = part => {
  const b = series.map(S => part === 'in' ? benchmarks(S, S.from, S.split) : benchmarks(S, S.split, S.candles.length - 1));
  return { hold: { sharpe: mean(b.map(x => x.hold.sharpe)), ret: median(b.map(x => x.hold.ret)), dd: median(b.map(x => x.hold.dd)) }, ma200: { sharpe: mean(b.map(x => x.ma200.sharpe)), ret: median(b.map(x => x.ma200.ret)), dd: median(b.map(x => x.ma200.dd)) }, per: b };
};
out.bench = { in: bench('in'), out: bench('out') };
out.series = series.map(S => ({ sym: S.sym, iv: S.iv, from: new Date(S.candles[S.from].time * 1000).toISOString().slice(0, 10), split: new Date(S.candles[S.split].time * 1000).toISOString().slice(0, 10), to: new Date(S.candles.at(-1).time * 1000).toISOString().slice(0, 10) }));
writeFileSync(process.env.OUT || 'tools/tune-result.json', JSON.stringify(out, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v, 1));
const f = x => `sharpe ${x.sharpe.toFixed(2)} | medyan getiri ${(x.ret * 100).toFixed(0)}% | medyan maxDD ${(x.dd * 100).toFixed(0)}%` + (x.trades != null ? ` | işlem ${x.trades.toFixed(1)} | isabet ${(x.win * 100).toFixed(0)}%` : '');
console.log('IN-SAMPLE');
console.log('  al-tut      ', f(out.bench.in.hold)); console.log('  MA200 filtre', f(out.bench.in.ma200));
console.log('  varsayılan  ', f(out.default.in)); console.log('  en iyi      ', f(out.best.in));
console.log('OUT-OF-SAMPLE');
console.log('  al-tut      ', f(out.bench.out.hold)); console.log('  MA200 filtre', f(out.bench.out.ma200));
console.log('  varsayılan  ', f(out.default.out)); console.log('  en iyi      ', f(out.best.out));
console.log('en iyi P', JSON.stringify(best.P));
console.log('ilk 10 (in → out sharpe):'); out.top.forEach(t => console.log('  ', JSON.stringify(t.P), t.in.toFixed(2), '→', t.out.toFixed(2)));
console.log(out.series.map(s => `${s.sym} ${s.iv} ${s.from}→${s.split}→${s.to}`).join('\n'));
