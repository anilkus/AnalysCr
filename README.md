# AnalysCr · Kripto Sinyal

Binance'in açık API'sinden kripto verisi çeken ve en yaygın teknik analiz yöntemleriyle al/sat/bekle sinyali üreten statik bir site. Anahtar veya üyelik gerekmez.

Kullanılan yöntemler: MA200 trendi, EMA20/50, Golden/Death Cross (MA50×MA200), ADX, RSI, Stochastic RSI, MACD, RSI uyumsuzluğu, Bollinger bantları ve sıkışma, destek/direnç (salınım tepe/dipleri), Fibonacci düzeltmeleri, mum formasyonları (yutan, çekiç, kayan yıldız, sabah/akşam yıldızı, üç beyaz asker/kara karga, doji), hacim teyidi ve 15dk/1s/4s/1g zaman dilimi uyumu.

Canlı: https://anilkus.github.io/AnalysCr/

- Veri: `data-api.binance.vision` (anahtarsız, CORS açık), canlı fiyat için Binance WebSocket. Erişilemezse CoinGecko.
- Göstergeler ve sinyal skoru tamamen tarayıcıda hesaplanır (`indicators.js`).
- İsteğe bağlı AI yorumu: ziyaretçi kendi Anthropic API anahtarını girer; anahtar yalnızca tarayıcının localStorage'ında tutulur.

> Yatırım tavsiyesi değildir.
