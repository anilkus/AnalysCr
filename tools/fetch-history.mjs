// Geriye dönük test için Binance'ten geçmiş mum verisini indirir: data/<SYMBOL>_<interval>.json
import { writeFileSync, mkdirSync } from 'fs';
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT'];
const INTERVALS = { '1d': 1500, '4h': 6600, '1h': 9000 };
const MS = { '1d': 864e5, '4h': 144e5, '1h': 36e5 };

async function get(path) {
  for (const h of HOSTS) {
    try { const r = await fetch(h + path); if (r.ok) return r.json(); console.warn(h, r.status); } catch (e) { console.warn(h, e.message); }
  }
  throw new Error('fetch failed ' + path);
}

mkdirSync('data', { recursive: true });
for (const s of SYMBOLS) for (const [iv, n] of Object.entries(INTERVALS)) {
  let start = Date.now() - n * MS[iv], rows = [];
  while (start < Date.now()) {
    const k = await get(`/api/v3/klines?symbol=${s}&interval=${iv}&startTime=${start}&limit=1000`);
    if (!k.length) break;
    rows.push(...k.map(r => [Math.floor(r[0] / 1000), +r[1], +r[2], +r[3], +r[4], +(+r[5]).toPrecision(8)]));
    start = k[k.length - 1][0] + MS[iv];
  }
  writeFileSync(`data/${s}_${iv}.json`, JSON.stringify(rows));
  console.log(s, iv, rows.length);
}
