import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.127.0';

const TA = window.TA;
const $ = s => document.querySelector(s);

// ---------- Veri kaynakları ----------
// data-api.binance.vision: Binance'in yalnızca piyasa verisi sunan, anahtarsız ve CORS açık uç noktası.
const BINANCE_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
const BINANCE_WS = 'wss://data-stream.binance.vision/ws/';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const STABLES = new Set(['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'EUR', 'AEUR', 'EURI', 'USDE', 'PYUSD', 'XUSD', 'BFUSD', 'USD1', 'RLUSD', 'WBTC', 'WBETH', 'BNSOL']);

const state = {
  source: 'binance',
  host: BINANCE_HOSTS[0],
  tickers: [],          // {symbol, base, price, change, quoteVol, high, low, cgId?}
  symbol: safeGet('ks.symbol') || 'BTCUSDT',
  interval: safeGet('ks.interval') || '1h',
  candles: [],
  ws: null,
  tab: 'all',
  favs: new Set(JSON.parse(safeGet('ks.favs') || '["BTCUSDT","ETHUSDT","SOLUSDT"]')),
  lastSignal: null,
  mtf: {},
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* yok say */ } }

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function binance(path) {
  let lastErr;
  const hosts = [state.host, ...BINANCE_HOSTS.filter(h => h !== state.host)];
  for (const h of hosts) {
    try { const d = await getJSON(h + path); state.host = h; return d; }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function loadTickers() {
  if (state.source === 'binance') {
    try {
      const all = await binance('/api/v3/ticker/24hr');
      state.tickers = all
        .filter(t => t.symbol.endsWith('USDT'))
        .map(t => ({ symbol: t.symbol, base: t.symbol.slice(0, -4), price: +t.lastPrice, change: +t.priceChangePercent,
          quoteVol: +t.quoteVolume, high: +t.highPrice, low: +t.lowPrice, volume: +t.volume }))
        .filter(t => t.quoteVol > 0 && !STABLES.has(t.base) && !/(UP|DOWN|BULL|BEAR)$/.test(t.base))
        .sort((a, b) => b.quoteVol - a.quoteVol);
      return;
    } catch (e) {
      console.warn('Binance erişilemedi, CoinGecko\'ya geçiliyor', e);
      state.source = 'coingecko';
    }
  }
  const m = await getJSON(`${COINGECKO}/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1`);
  state.tickers = m
    .filter(c => !STABLES.has(c.symbol.toUpperCase()) && !/usd/i.test(c.symbol))
    .map(c => ({ symbol: c.symbol.toUpperCase() + 'USDT', base: c.symbol.toUpperCase(), cgId: c.id, price: c.current_price,
      change: c.price_change_percentage_24h || 0, quoteVol: c.total_volume, high: c.high_24h, low: c.low_24h, volume: null }));
}

const CG_DAYS = { '15m': 1, '1h': 1, '4h': 30, '1d': 365 };

async function loadCandles(symbol, interval, limit = 500) {
  if (state.source === 'binance') {
    const k = await binance(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return k.map(r => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
  }
  const t = state.tickers.find(x => x.symbol === symbol);
  if (!t) throw new Error('Coin bulunamadı');
  const d = await getJSON(`${COINGECKO}/coins/${t.cgId}/ohlc?vs_currency=usd&days=${CG_DAYS[interval]}`);
  return d.map(r => ({ time: Math.floor(r[0] / 1000), open: r[1], high: r[2], low: r[3], close: r[4], volume: 0 }));
}

// ---------- Biçimlendirme ----------
function fmtPrice(p) {
  if (p == null || isNaN(p)) return '—';
  const d = p >= 1000 ? 2 : p >= 1 ? 3 : p >= 0.01 ? 5 : 8;
  return p.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const fmtPct = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
function fmtBig(v) {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + ' Mr';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' Mn';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + ' B';
  return v.toFixed(0);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Grafikler ----------
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let charts = null;

function chartOpts(el, h) {
  return {
    width: el.clientWidth, height: h,
    layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontFamily: 'Inter, sans-serif' },
    grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
    rightPriceScale: { borderColor: css('--line'), minimumWidth: 80 },
    timeScale: { borderColor: css('--line'), timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
    localization: { locale: 'tr-TR', priceFormatter: fmtPrice },
  };
}

function buildCharts() {
  const LW = window.LightweightCharts;
  if (charts) { charts.list.forEach(c => c.remove()); }
  const mainEl = $('#chart'), rsiEl = $('#rsiChart'), macdEl = $('#macdChart');
  const main = LW.createChart(mainEl, chartOpts(mainEl, mainEl.clientHeight));
  const rsiC = LW.createChart(rsiEl, { ...chartOpts(rsiEl, rsiEl.clientHeight), localization: { locale: 'tr-TR' } });
  const macdC = LW.createChart(macdEl, { ...chartOpts(macdEl, macdEl.clientHeight), localization: { locale: 'tr-TR', priceFormatter: v => v.toPrecision(3) } });

  const line = (chart, color, width = 1.5, extra = {}) => chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
  const s = {
    candle: main.addCandlestickSeries({ upColor: css('--up'), downColor: css('--down'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--down') }),
    bbU: line(main, css('--bb'), 1, { lineStyle: 2 }), bbL: line(main, css('--bb'), 1, { lineStyle: 2 }),
    e20: line(main, css('--ema20')), e50: line(main, css('--ema50')), e200: line(main, css('--ema200'), 2),
    rsi: line(rsiC, css('--accent-2'), 1.5, { lastValueVisible: true }),
    macd: line(macdC, css('--ema20')), sig: line(macdC, css('--ema50')),
    hist: macdC.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }),
  };
  s.rsi.createPriceLine({ price: 70, color: css('--down'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
  s.rsi.createPriceLine({ price: 30, color: css('--up'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });

  // Zaman eksenlerini senkronla
  const all = [main, rsiC, macdC];
  all.forEach(src => src.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (!r) return;
    all.forEach(dst => { if (dst !== src) dst.timeScale().setVisibleLogicalRange(r); });
  }));
  charts = { main, rsiC, macdC, s, list: all };
}

function resizeCharts() {
  if (!charts) return;
  [[charts.main, '#chart'], [charts.rsiC, '#rsiChart'], [charts.macdC, '#macdChart']].forEach(([c, sel]) => {
    const el = $(sel); c.applyOptions({ width: el.clientWidth, height: el.clientHeight });
  });
}

const series = (candles, arr) => candles.map((c, i) => arr[i] == null ? { time: c.time } : { time: c.time, value: arr[i] });

function renderChart(fit) {
  const c = state.candles, ind = TA.computeAll(c), s = charts.s;
  s.candle.setData(c.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  s.e20.setData(series(c, ind.ema20)); s.e50.setData(series(c, ind.ema50)); s.e200.setData(series(c, ind.ema200));
  s.bbU.setData(series(c, ind.bb.upper)); s.bbL.setData(series(c, ind.bb.lower));
  s.rsi.setData(series(c, ind.rsi));
  s.macd.setData(series(c, ind.macd.line)); s.sig.setData(series(c, ind.macd.signal));
  s.hist.setData(c.map((k, i) => ind.macd.hist[i] == null ? { time: k.time } :
    { time: k.time, value: ind.macd.hist[i], color: ind.macd.hist[i] >= 0 ? css('--up') : css('--down') }));
  if (fit) {
    const n = c.length;
    charts.main.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 3 });
  }
  renderSignal(TA.signal(c, ind));
}

// ---------- Sinyal paneli ----------
const IV_LABEL = { '15m': '15dk', '1h': '1 saat', '4h': '4 saat', '1d': '1 gün' };
const GROUPS = ['Trend', 'Momentum', 'Yapı', 'Formasyon', 'Volatilite', 'Hacim'];
let srLines = [];

function drawLevelLines(sig) {
  const s = charts.s.candle;
  srLines.forEach(l => s.removePriceLine(l));
  srLines = [
    ...sig.sr.supports.slice(0, 2).map(l => s.createPriceLine({ price: l.price, color: css('--up'), lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'D' })),
    ...sig.sr.resistances.slice(0, 2).map(l => s.createPriceLine({ price: l.price, color: css('--down'), lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'R' })),
  ];
}

function renderSignal(sig) {
  state.lastSignal = sig;
  state.mtf[state.interval] = sig;
  const b = $('#signalBadge');
  b.textContent = `${sig.label}  ${sig.score > 0 ? '+' : ''}${sig.score}`;
  b.className = 'badge ' + sig.cls;
  $('#gaugeMark').style.left = `${(sig.score + 100) / 2}%`;
  const lv = sig.levels;
  $('#levels').innerHTML = `
    <div><span>Son fiyat</span>${fmtPrice(sig.price)}</div>
    <div><span>Zarar-kes</span>${lv ? fmtPrice(lv.stop) : '—'}</div>
    <div><span>Hedef${lv ? ` · R/R ${lv.rr.toFixed(1)}` : ''}</span>${lv ? fmtPrice(lv.target) : '—'}</div>`;

  $('#reasons').innerHTML = GROUPS.map(g => {
    const rs = sig.reasons.filter(r => r.group === g);
    if (!rs.length) return '';
    const pts = rs.reduce((a, r) => a + r.pts, 0);
    return `<div class="rg"><h3>${g}<span class="pts ${pts >= 0.5 ? 'up' : pts <= -0.5 ? 'down' : 'muted'}">${pts > 0 ? '+' : ''}${Math.round(pts)} puan</span></h3>
      <ul class="reasons">${rs.map(r => `<li class="${r.w > 0 ? 'pos' : r.w < 0 ? 'neg' : 'neu'}">${esc(r.text)}</li>`).join('')}</ul></div>`;
  }).join('');

  const near = l => sig.atr && Math.abs(l.price - sig.price) < sig.atr * 0.8 ? 'near' : '';
  const lvl = (arr, empty) => arr.length ? arr.map(l => `<li class="${near(l)}"><span>${l.touches} dokunuş</span><span>${fmtPrice(l.price)}</span></li>`).join('') : `<li class="muted"><span>${empty}</span><span></span></li>`;
  $('#resList').innerHTML = lvl(sig.sr.resistances, 'Yakında direnç yok (zirve bölgesi)');
  $('#supList').innerHTML = lvl(sig.sr.supports, 'Yakında destek yok');
  const f = sig.fib;
  $('#fibTitle').textContent = `Fibonacci · son ${f.up ? 'yükseliş' : 'düşüş'} salınımı (${fmtPrice(f.low)} → ${fmtPrice(f.high)})`;
  $('#fibList').innerHTML = f.levels.map(l => `<li class="${near(l)} ${l.ratio === 0.5 || l.ratio === 0.618 ? 'key' : ''}"><span>%${(l.ratio * 100).toFixed(1)}</span><span>${fmtPrice(l.price)}</span></li>`).join('');

  drawLevelLines(sig);
  renderMTF();
}

function renderMTF() {
  const ivs = Object.keys(IV_LABEL);
  $('#mtf').innerHTML = ivs.map(iv => {
    const s = state.mtf[iv];
    return `<div data-iv="${iv}" class="${s ? s.cls : ''} ${iv === state.interval ? 'cur' : ''}" title="${IV_LABEL[iv]} grafiğini aç"><span>${IV_LABEL[iv]}</span><b>${s ? s.label : '…'}</b>${s ? ` <small class="mono">${s.score > 0 ? '+' : ''}${s.score}</small>` : ''}</div>`;
  }).join('');
  const got = ivs.map(iv => state.mtf[iv]).filter(Boolean);
  const buys = got.filter(s => s.cls === 'buy').length, sells = got.filter(s => s.cls === 'sell').length;
  $('#mtfNote').textContent = got.length < ivs.length ? '' :
    buys >= 3 ? 'Zaman dilimlerinin çoğu AL yönünde: sinyal daha güvenilir.' :
    sells >= 3 ? 'Zaman dilimlerinin çoğu SAT yönünde: sinyal daha güvenilir.' :
    'Zaman dilimleri çelişiyor: temkinli olun, büyük zaman dilimi (1 gün / 4 saat) trendi daha belirleyicidir.';
}

async function loadMTF(sym) {
  for (const iv of Object.keys(IV_LABEL)) {
    if (iv === state.interval) continue;
    try {
      const c = await loadCandles(sym, iv, 300);
      if (sym !== state.symbol) return;
      state.mtf[iv] = TA.signal(c);
      renderMTF();
    } catch { /* atla */ }
  }
}

// ---------- Başlık ----------
function renderHeader() {
  const t = state.tickers.find(x => x.symbol === state.symbol);
  const base = state.symbol.replace(/USDT$/, '');
  $('#symTitle').textContent = `${base}/USDT`;
  document.title = `${base} ${t ? fmtPrice(t.price) : ''} | Kripto Sinyal`;
  $('#favBtn').textContent = state.favs.has(state.symbol) ? '★' : '☆';
  if (!t) return;
  $('#price').textContent = fmtPrice(t.price);
  const ch = $('#change');
  ch.textContent = fmtPct(t.change);
  ch.className = 'chg mono ' + (t.change >= 0 ? 'up' : 'down');
  $('#stats').innerHTML = `<span>24s Yüksek <b>${fmtPrice(t.high)}</b></span><span>24s Düşük <b>${fmtPrice(t.low)}</b></span><span>24s Hacim <b>${fmtBig(t.quoteVol)} $</b></span>`;
}

// ---------- Coin listesi ----------
function renderList() {
  const q = $('#search').value.trim().toUpperCase();
  let list = state.tab === 'fav' ? state.tickers.filter(t => state.favs.has(t.symbol)) : state.tickers;
  if (q) list = state.tickers.filter(t => t.base.includes(q));
  else if (state.tab === 'all') list = list.slice(0, 40);
  $('#coinList').innerHTML = list.length ? list.map(t => `
    <li class="item ${t.symbol === state.symbol ? 'active' : ''}" data-sym="${t.symbol}">
      <span class="c-sym">${state.favs.has(t.symbol) ? '★ ' : ''}${esc(t.base)}</span>
      <span class="c-right mono"><div>${fmtPrice(t.price)}</div><div class="c-chg ${t.change >= 0 ? 'up' : 'down'}">${fmtPct(t.change)}</div></span>
    </li>`).join('') : `<li class="muted pad">${state.tab === 'fav' ? 'Favori yok. Grafikteki ☆ ile ekleyin.' : 'Sonuç yok.'}</li>`;
}

// ---------- Canlı veri ----------
function setConn(text, cls) { const el = $('#conn'); el.textContent = text; el.className = 'conn ' + (cls || ''); }

function openSocket() {
  if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  if (state.source !== 'binance') { setConn('CoinGecko · 60sn yenileme'); return; }
  const sym = state.symbol, iv = state.interval;
  const ws = new WebSocket(`${BINANCE_WS}${sym.toLowerCase()}@kline_${iv}`);
  state.ws = ws;
  ws.onopen = () => setConn('canlı', 'live');
  ws.onmessage = ev => {
    const k = JSON.parse(ev.data).k;
    if (!k || sym !== state.symbol || iv !== state.interval) return;
    const bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
    const c = state.candles, lastBar = c[c.length - 1];
    if (lastBar && lastBar.time === bar.time) c[c.length - 1] = bar;
    else if (!lastBar || bar.time > lastBar.time) { c.push(bar); if (c.length > 600) c.shift(); }
    const t = state.tickers.find(x => x.symbol === sym);
    if (t) t.price = bar.close;
    throttledRender();
  };
  ws.onclose = () => {
    setConn('bağlantı koptu', 'err');
    setTimeout(() => { if (state.ws === ws) openSocket(); }, 3000);
  };
}

let renderPending = false;
function throttledRender() {
  if (renderPending) return;
  renderPending = true;
  setTimeout(() => {
    renderPending = false;
    const c = state.candles, s = charts.s, i = c.length - 1, k = c[i];
    s.candle.update({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close });
    const ind = TA.computeAll(c);
    const pt = (ser, arr) => { if (arr[i] != null) ser.update({ time: k.time, value: arr[i] }); };
    pt(s.e20, ind.ema20); pt(s.e50, ind.ema50); pt(s.e200, ind.ema200);
    pt(s.bbU, ind.bb.upper); pt(s.bbL, ind.bb.lower); pt(s.rsi, ind.rsi);
    pt(s.macd, ind.macd.line); pt(s.sig, ind.macd.signal);
    if (ind.macd.hist[i] != null) s.hist.update({ time: k.time, value: ind.macd.hist[i], color: ind.macd.hist[i] >= 0 ? css('--up') : css('--down') });
    renderSignal(TA.signal(c, ind));
    renderHeader();
  }, 1000);
}

// ---------- Seçim ----------
let loadToken = 0;
async function selectSymbol(sym, interval = state.interval) {
  if (sym !== state.symbol) state.mtf = {};
  state.symbol = sym; state.interval = interval;
  safeSet('ks.symbol', sym); safeSet('ks.interval', interval);
  document.querySelectorAll('#intervalTabs button').forEach(b => b.classList.toggle('active', b.dataset.iv === interval));
  renderHeader(); renderList();
  const token = ++loadToken;
  try {
    const c = await loadCandles(sym, interval);
    if (token !== loadToken) return;
    state.candles = c;
    renderChart(true);
    openSocket();
    loadMTF(sym);
  } catch (e) {
    console.error(e);
    setConn('veri alınamadı', 'err');
    $('#reasons').innerHTML = `<li class="neg">Mum verisi alınamadı: ${esc(e.message)}</li>`;
  }
  resetAI();
}

// ---------- Radar ----------
async function runScan() {
  const btn = $('#scanBtn');
  btn.disabled = true; btn.textContent = 'Taranıyor…';
  const list = state.tickers.slice(0, 20);
  const body = $('#scanBody');
  body.innerHTML = `<tr><td colspan="7" class="muted"><span class="spinner"></span>0 / ${list.length}</td></tr>`;
  const rows = [];
  let done = 0;
  const queue = [...list];
  const conc = state.source === 'binance' ? 5 : 1;
  async function worker() {
    while (queue.length) {
      const t = queue.shift();
      try {
        const c = await loadCandles(t.symbol, state.interval, 300);
        rows.push({ t, sig: TA.signal(c) });
      } catch { /* atla */ }
      done++;
      if (rows.length < list.length) body.innerHTML = `<tr><td colspan="7" class="muted"><span class="spinner"></span>${done} / ${list.length}</td></tr>`;
      if (state.source === 'coingecko') await new Promise(r => setTimeout(r, 2500)); // ücretsiz limit
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  rows.sort((a, b) => b.sig.score - a.sig.score);
  body.innerHTML = rows.map(({ t, sig }) => `
    <tr class="row" data-sym="${t.symbol}">
      <td><b>${esc(t.base)}</b></td>
      <td class="mono">${fmtPrice(sig.price)}</td>
      <td class="mono ${t.change >= 0 ? 'up' : 'down'}">${fmtPct(t.change)}</td>
      <td class="mono">${sig.rsi != null ? sig.rsi.toFixed(0) : '—'}</td>
      <td class="mono">${sig.adx != null ? sig.adx.toFixed(0) : '—'}</td>
      <td class="mono">${sig.score > 0 ? '+' : ''}${sig.score}</td>
      <td><span class="pill ${sig.cls}">${sig.label}</span></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Veri alınamadı.</td></tr>';
  btn.disabled = false; btn.textContent = 'Yeniden tara';
}

// ---------- Yapay zeka yorumu ----------
const AI_SYSTEM = `Sen deneyimli bir kripto para teknik analistisin. Kullanıcıya Türkçe, sade ve dürüst bir piyasa yorumu yaz.
Sana bir coinin güncel fiyatı, hesaplanmış göstergeler (EMA, RSI, Stoch RSI, MACD, ADX, Bollinger, ATR), destek/direnç, Fibonacci, mum formasyonları, zaman dilimi uyumu, kural tabanlı sinyal skoru ve son mumlar JSON olarak verilecek.
Yanıt biçimi (Markdown, en fazla ~250 kelime):
### Genel Görünüm
### Önemli Seviyeler (destek / direnç, verideki fiyatlardan türet)
### Senaryo (AL / SAT / BEKLE önerisi; giriş bölgesi, zarar-kes ve hedef ile)
### Riskler
Göstergeler birbiriyle çelişiyorsa bunu açıkça söyle ve emin olmadığında BEKLE de. Veride olmayan haberleri veya olayları uydurma.
Son satırda tek cümleyle bunun yatırım tavsiyesi olmadığını hatırlat.`;

function buildPayload() {
  const c = state.candles, ind = TA.computeAll(c), sig = state.lastSignal || TA.signal(c, ind);
  const t = state.tickers.find(x => x.symbol === state.symbol) || {};
  const r = v => v == null ? null : +v.toPrecision(6);
  const L = a => r(a[a.length - 1]);
  return {
    sembol: state.symbol, zaman_dilimi: state.interval, veri_kaynagi: state.source,
    fiyat: r(sig.price), degisim_24s_yuzde: t.change, yuksek_24s: t.high, dusuk_24s: t.low,
    gostergeler: {
      ema20: L(ind.ema20), ema50: L(ind.ema50), ema200: L(ind.ema200), rsi14: L(ind.rsi),
      macd: L(ind.macd.line), macd_sinyal: L(ind.macd.signal), macd_histogram: L(ind.macd.hist),
      bollinger_ust: L(ind.bb.upper), bollinger_orta: L(ind.bb.mid), bollinger_alt: L(ind.bb.lower), atr14: L(ind.atr),
      stoch_rsi_k: L(ind.stoch.k), stoch_rsi_d: L(ind.stoch.d), adx: L(ind.adx.adx), arti_di: L(ind.adx.plusDI), eksi_di: L(ind.adx.minusDI),
    },
    destekler: sig.sr.supports.map(l => r(l.price)), direncler: sig.sr.resistances.map(l => r(l.price)),
    fibonacci: { yon: sig.fib.up ? 'yukselis' : 'dusus', seviyeler: sig.fib.levels.map(l => [l.ratio, r(l.price)]) },
    mum_formasyonlari: sig.patterns.map(p => p.name),
    zaman_dilimi_uyumu: Object.fromEntries(Object.entries(state.mtf).map(([k, v]) => [k, `${v.label} ${v.score}`])),
    kural_tabanli_sinyal: { etiket: sig.label, skor: sig.score, gerekceler: sig.reasons.map(x => `${x.group}: ${x.text}`) },
    son_mumlar_OHLCV: c.slice(-40).map(k => [new Date(k.time * 1000).toISOString().slice(0, 16), r(k.open), r(k.high), r(k.low), r(k.close), r(k.volume)]),
  };
}

// Küçük, güvenli markdown: önce kaçış, sonra başlık/kalın/liste.
function md(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (let line of lines) {
    line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const li = line.match(/^\s*[-*•]\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<h3>${h[1]}</h3>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function resetAI() {
  const out = $('#aiOut');
  if (out.dataset.busy) return;
  out.className = 'ai-out muted';
  out.innerHTML = safeGet('ks.apiKey')
    ? `${esc(state.symbol.replace(/USDT$/, ''))} için ${esc(state.interval)} yorumu almak üzere <b>Yorumla</b>'ya basın.`
    : 'Sinyaller bu bölüm olmadan da tamamen çalışır. İsterseniz göstergeleri Claude\'a gönderip Türkçe bir yorum alabilirsiniz; bunun için <a href="#" class="ai-setup">kendi Anthropic API anahtarınızı</a> girmeniz gerekir (ücretli).';
}

async function runAI() {
  const key = safeGet('ks.apiKey');
  if (!key) { openSettings(); return; }
  if (!state.candles.length) return;
  const model = safeGet('ks.model') || 'claude-opus-5-5';
  const out = $('#aiOut'), btn = $('#aiBtn');
  out.dataset.busy = '1'; btn.disabled = true;
  out.className = 'ai-out';
  out.innerHTML = '<span class="spinner"></span>Claude analiz ediyor…';
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const params = {
    model, max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: AI_SYSTEM,
    messages: [{ role: 'user', content: 'Şu verileri yorumla:\n```json\n' + JSON.stringify(buildPayload()) + '\n```' }],
  };
  // Opus/Sonnet 5.5'te güvenlik sınıflandırıcısı reddederse sunucu tarafında yedek modele geçilir.
  if (model !== 'claude-haiku-5-5') { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  try {
    let text = '';
    const stream = client.beta.messages.stream(params);
    stream.on('text', d => { text += d; out.innerHTML = md(text); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      out.innerHTML = '<p class="err">Model bu isteği yanıtlamadı. Farklı bir model seçip tekrar deneyin.</p>';
    } else {
      out.innerHTML = md(text) + `<p class="muted small-text">${esc(model)} · ${new Date().toLocaleTimeString('tr-TR')}</p>`;
    }
  } catch (e) {
    let m = e.message || String(e);
    if (e.status === 401) m = 'API anahtarı geçersiz. AI Ayarları\'ndan kontrol edin.';
    else if (e.status === 429) m = 'Hız/bakiye limiti aşıldı, biraz sonra tekrar deneyin.';
    else if (e.status === 400 && /credit/i.test(m)) m = 'Anthropic hesabınızda kredi yok görünüyor.';
    out.innerHTML = `<p class="err">Hata: ${esc(m)}</p>`;
  } finally {
    delete out.dataset.busy; btn.disabled = false;
  }
}

// ---------- Ayarlar ----------
function openSettings() {
  $('#apiKey').value = safeGet('ks.apiKey') || '';
  $('#model').value = safeGet('ks.model') || 'claude-opus-5-5';
  $('#settings').showModal();
}

// ---------- Tema ----------
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

// ---------- Başlangıç ----------
function bind() {
  $('#coinList').addEventListener('click', e => { const li = e.target.closest('[data-sym]'); if (li) selectSymbol(li.dataset.sym); });
  $('#scanBody').addEventListener('click', e => { const tr = e.target.closest('[data-sym]'); if (tr) { selectSymbol(tr.dataset.sym); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  $('#search').addEventListener('input', renderList);
  $('#listTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab;
    document.querySelectorAll('#listTabs button').forEach(x => x.classList.toggle('active', x === b));
    renderList();
  });
  $('#intervalTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectSymbol(state.symbol, b.dataset.iv); });
  $('#favBtn').addEventListener('click', () => {
    state.favs.has(state.symbol) ? state.favs.delete(state.symbol) : state.favs.add(state.symbol);
    safeSet('ks.favs', JSON.stringify([...state.favs]));
    renderHeader(); renderList();
  });
  $('#mtf').addEventListener('click', e => { const d = e.target.closest('[data-iv]'); if (d && d.dataset.iv !== state.interval) selectSymbol(state.symbol, d.dataset.iv); });
  $('#scanBtn').addEventListener('click', runScan);
  $('#aiBtn').addEventListener('click', runAI);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#aiOut').addEventListener('click', e => { if (e.target.matches('a.ai-setup')) { e.preventDefault(); openSettings(); } });
  $('#saveKey').addEventListener('click', () => {
    const k = $('#apiKey').value.trim();
    if (k) safeSet('ks.apiKey', k);
    safeSet('ks.model', $('#model').value);
    resetAI();
  });
  $('#clearKey').addEventListener('click', () => {
    try { localStorage.removeItem('ks.apiKey'); } catch { /* yok say */ }
    $('#apiKey').value = '';
    $('#settings').close(); resetAI();
  });
  $('#themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const t = dark ? 'light' : 'dark';
    safeSet('ks.theme', t); applyTheme(t);
    buildCharts(); if (state.candles.length) renderChart(false);
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resizeCharts, 150); });
}

async function init() {
  applyTheme(safeGet('ks.theme'));
  bind();
  buildCharts();
  try {
    await loadTickers();
  } catch (e) {
    setConn('veri alınamadı', 'err');
    $('#coinList').innerHTML = `<li class="muted pad">Borsa verisine ulaşılamadı. Ağ bağlantınızı kontrol edin.</li>`;
    return;
  }
  if (!state.tickers.some(t => t.symbol === state.symbol)) state.symbol = state.tickers[0]?.symbol || 'BTCUSDT';
  renderList();
  await selectSymbol(state.symbol, state.interval);
  // Liste fiyatlarını periyodik yenile (CoinGecko'da mumları da)
  setInterval(async () => {
    try {
      await loadTickers(); renderList(); renderHeader();
      if (state.source === 'coingecko') { state.candles = await loadCandles(state.symbol, state.interval); renderChart(false); }
      loadMTF(state.symbol);
    } catch { /* bir sonraki turda tekrar */ }
  }, 60000);
}

init();
