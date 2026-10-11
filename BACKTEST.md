# Geriye dönük test (Ekim 2026)

`tools/tune.mjs` ile yapıldı. Veri `data/` klasöründe, `.github/workflows/fetch-history.yml` Binance'ten indiriyor.

**Kapsam:** BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, LINK, LTC × 4 saatlik (Kas 2023 – Eki 2026) ve günlük (Nis 2023 – Eki 2026). 20 seri.
**Kurallar:** Yalnızca alış (spot). Kapanışta skor ≥ eşik → sonraki açılışta al; çıkış kuralına göre sat. Her işlemde %0.1 komisyon.
**Ayar / kontrol:** Her serinin ilk %65'i ayar (in-sample), son %35'i (günlükte Tem 2025, 4 saatlikte Eki 2025 sonrası) kontrol (out-of-sample). 7.776 kombinasyon: grup ağırlıkları, AL eşiği, trende ters sinyal çarpanı, çıkış kuralı. Seçim ölçütü in-sample ortalama Sharpe, seri başına en az 3 işlem.

## Skor yapısı (v3)

- Gruplar kendi içinde ortalanır (−1…+1), sonra ağırlıklandırılır. RSI, Stoch RSI ve MACD artık aynı şeyi üç kez saymıyor: yön "Momentum", aşırı bölge "Aşırı alım/satım" grubunda.
- **Rejim filtresi:** Fiyat MA200 üstünde ve EMA20 > EMA50 ise yükseliş, tersiyse düşüş rejimi. Düşüşte aşırı satım/destek/dönüş formasyonu gibi alış yönlü dönüş sinyalleri puanlanmaz (yükselişte tersi).

## Seçilen ayar

| Grup | Ağırlık |
|---|---|
| Trend (MA200, EMA20/50, Golden/Death Cross, ADX) | 35 |
| Aşırı alım/satım (RSI <30/>70, Stoch RSI, Bollinger, uyumsuzluk) | 20 |
| Momentum (RSI yönü, MACD) | 10 |
| Yapı, formasyon, hacim | 0 (yalnızca bilgi) |

AL ≥ +30, GÜÇLÜ AL ≥ +50, SAT ≤ −30, GÜÇLÜ SAT ≤ −50. Backtest çıkışı: skor 0'ın altına inince.
Not: In-sample en iyi 10 kombinasyonun hepsi trendi ağır, yapı/formasyon/hacmi 0 seçti. Trende ters çarpanı (0 / 0.5 / 1) sonucu ölçülebilir şekilde değiştirmedi; ilkeli olduğu için 0 tutuldu.

## Sonuçlar (medyan, 20 seri)

| Dönem | Strateji | Max düşüş | Al-tut | Max düşüş | Al-tutu geçen |
|---|---|---|---|---|---|
| Ayar (boğa) | +%125 | %46 | +%134 | %61 | 7 / 20 |
| Kontrol (ayı) | −%21 | %41 | −%45 | %71 | 20 / 20 |
| Kontrol, günlük | +%9 | %38 | −%36 | %73 | 10 / 10 |
| Kontrol, 4 saatlik | −%32 | %44 | −%48 | %70 | 10 / 10 |

Kıyas: "Kapanış MA200 üstündeyse tut" kuralı kontrolde medyan −%14, max düşüş %44.

**Etiket isabeti (kontrol dönemi, 10 mum sonrası ortalama değişim):** GÜÇLÜ AL −%0.21 · AL +%0.60 · BEKLE −%0.37 · SAT −%0.32 · GÜÇLÜ SAT −%0.47. Etiketler kısa vadeli yönü anlamlı biçimde tahmin etmiyor.

## Sonuç

- Sistemin değeri tahmin değil, risk azaltma: düşüş trendinde piyasa dışında kalarak kaybı ve en büyük düşüşü yaklaşık yarıya indiriyor. Güçlü yükselişte al-tutun gerisinde kalıyor.
- Bu değerin çoğu MA200 trend filtresinden geliyor. Destek/direnç, Fibonacci, mum formasyonları ve hacim ek fayda sağlamadı.
- Günlük grafik 4 saatlikten iyi: daha az işlem, daha az komisyon ve gürültü.
- Kontrol dönemi tek bir piyasa rejimine (düşüş) denk geldi; farklı bir dönemde sonuçlar değişebilir. Yatırım tavsiyesi değildir.
