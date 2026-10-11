# AnalysCr · Kripto Sinyal

Binance'in açık API'sinden kripto verisi çeken, teknik göstergelerle (EMA 20/50/200, RSI, MACD, Bollinger, ATR) al/sat sinyali üreten ve isteğe bağlı olarak Claude ile Türkçe yorum yapan statik bir site.

Canlı: https://anilkus.github.io/AnalysCr/

- Veri: `data-api.binance.vision` (anahtarsız, CORS açık), canlı fiyat için Binance WebSocket. Erişilemezse CoinGecko.
- Göstergeler ve sinyal skoru tamamen tarayıcıda hesaplanır (`indicators.js`).
- AI yorumu: ziyaretçi kendi Anthropic API anahtarını girer; anahtar yalnızca tarayıcının localStorage'ında tutulur.

> Yatırım tavsiyesi değildir.
