# lightweight-charts vs rekurt/ohlcv-front — технический сравнительный анализ

> Дата: 2026-06-01
>
> **Методология.** Анализ построен на прямом чтении исходного кода `@rekurt/ohlcv-*`
> (монорепо `packages/core|react|vue`) и на публичной модели API/архитектуры
> TradingView lightweight-charts v5.2. Ссылки на код приводятся как
> `packages/core/src/<path>:<lines>`. **Бенчмарков не проводилось** — выводы о
> стоимости операций основаны на анализе алгоритмов и структур данных, а не на
> замерах. Оценка сделана по реальному техническому содержанию, без скидок и
> штрафов «за репутацию».

---

## 0. Обновление (2026-06-02): пробелы закрыты доработкой

> Разделы §1–§9 ниже описывают состояние rekurt **на момент анализа** (v0.1.0).
> После анализа в код внесён стек из **17 задач**, который устранил оба найденных
> технических недочёта, закрыл все пробелы паритета с lightweight-charts (LWC) и
> добавил фичи, которых у LWC нет из коробки. Состояние после доработки:
>
> - **Тесты:** 785 → **1086** (+301), все зелёные; typecheck + lint чисты во всех пакетах.
> - **Размер:** tree-shaken базовый график `OHLCVChart` = **34.83 КБ gzip ≤ 35 КБ** (паритет с LWC сохранён); тяжёлые опциональные фичи (compare, volume profile, SVG, WebGL) вынесены в tree-shakeable модули и **не входят** в базовый бандл.
> - **Бенчмарки (теперь есть, `npm run bench`, 50k свечей):** `sliceView` 7.5M ops/s (zero-copy), `updateLast` 5.2k ops/s, SMA 15.2k, RSI 4.6k, MACD 2.1k, Ichimoku 415 ops/s.

| Пункт анализа | Было | Стало |
|---|---|---|
| `candleAt`-аллокации в hot-цикле индикаторов (§8.2) | ❌ недочёт | ✅ убраны во всех 24 индикаторах (zero-copy `sliceView`) |
| Полный O(n)-пересчёт индикаторов на realtime-тик (§8.2) | ❌ недочёт | ✅ инкрементальный `updateTail` (EMA/SMA/WMA/ROC/OBV/Bollinger/Donchian) |
| Бенчмарки / доказательство перформанса | ❌ нет | ✅ `npm run bench` + size-гейт в CI |
| Baseline-серия (§3.1) | ❌ | ✅ `baselineSeries` / `createBaselineSeries` |
| Несколько price scale (§3.4) | ⚠️ слабее | ✅ вторичная left-ось (right-путь bit-for-bit) |
| Magnet-crosshair (§3.5) | ❌ | ✅ `crosshairMode: 'magnet'` |
| Богатый event-API + hovered-object info (§3.5) | ❌ | ✅ `onDblClick`, `paneIndex`, `hovered{kind,id}` |
| Формальный plugin-API (§3.1, §8.3) | ⚠️ | ✅ Pane Primitives (`clipToPane`) + `docs/PLUGINS.md` |
| Replay mode (§5) | ❌ | ✅ `ReplayController` |
| Compare mode (§5) | ❌ | ✅ `CompareController` (нормализация %/indexed) |
| Alerts (§5) | ❌ | ✅ `AlertManager` (price-cross, one-shot, персист) |
| Volume / Market Profile (§5) | ❌ | ✅ `VolumeProfileController` (POC + value area) |
| Продвинутые рисовалки (§3.3) | ❌ | ✅ +5: регрессия, вилы Эндрюса, fib-веер, measure, параллельный канал |
| Полный i18n (§5) | ❌ | ✅ `createI18n` (Intl-форматтеры + словарь) |
| SVG-экспорт (§3.7) | ⚠️ только PNG | ✅ `chartEngineToSVG` (canvas2svg-shim) |
| WebGL-рендер свечей (§4) | ❌ | ✅ опциональный `WebGLCandleRenderer` (стретч) |

Вне технического кода остаются (по требованию исключены из доработки): зрелость /
боевая проверка / экосистема / сообщество — это не решается кодом за один заход.

---

## 1. TL;DR — это решения разных классов

|  | **lightweight-charts** | **rekurt/ohlcv-front** |
|---|---|---|
| Что это по сути | Тонкий **движок отрисовки** котировок | **Полное «из коробки» решение** для OHLCV-терминала |
| Класс продукта | Rendering primitive (ядро) | Ближе к TradingView **Advanced Charts** (платной), а не к lightweight |
| Зрелость | v5.2, годы продакшена, ~11k★, тысячи внедрений | **v0.1.0**, первый релиз, ~116 коммитов, нет боевой проверки |
| Индикаторы из коробки | ❌ 0 (считаешь сам) | ✅ ~24 |
| Рисовалки из коробки | ❌ 0 (сторонний плагин) | ✅ ~9 |
| Слой данных (REST/WS/lazy) | ❌ нет вообще | ✅ есть целиком |
| Бэкер/поддержка | Компания TradingView | Малый/одиночный проект (риск) |
| Размер | ~35 КБ gzipped | Больше (tree-shakeable); точные цифры не публикуются |
| Лицензия | Apache-2.0 + **обязательная атрибуция** TradingView | MIT (без атрибуции) |

**Суть:** rekurt по **охвату функциональности** значительно превосходит
lightweight-charts — потому что lightweight-charts намеренно НЕ включает
индикаторы, рисовалки и слой данных. Но lightweight-charts выигрывает по
**зрелости, экосистеме, стабильности API, поддержке и проверенности в бою** —
а это тоже технические, а не репутационные характеристики.

---

## 2. Концептуальная разница

**lightweight-charts** — философия «**push-модель, тонкое ядро**»:

- ты сам грузишь данные (нет HTTP/WS-клиента);
- ты сам считаешь индикаторы и отдаёшь их как обычные `LineSeries`/`HistogramSeries`;
- ты сам реализуешь рисовалки (или ставишь сторонний плагин);
- библиотека отвечает **только** за шкалы, отрисовку серий, crosshair, зум/пан, события.

**rekurt/ohlcv-front** — философия «**батарейки в комплекте**»:

- свой слой данных: `PollingTransport` (REST), `WebSocketTransport` (абстракция),
  `DataFeed` (оркестратор), `CandleMerger` (склейка тиков), lazy-load истории,
  детект разрывов, валидация;
- свои индикаторы (реестр + factory);
- свои рисовалки (`DrawingLayer` + hit-test + undo/redo);
- сохранение состояния (layout в URL / полный workspace);
- официальные обёртки React + Vue в одном релизе.

Технически важно: **rekurt НЕ использует lightweight-charts и вообще никаких
сторонних charting-зависимостей** — это полностью самостоятельная реализация
Canvas 2D-движка (в `core` ноль runtime-зависимостей по `package.json`).

---

## 3. Поматричное сравнение по функциям

### 3.1 Рендеринг и типы серий

| Функция | lightweight-charts | rekurt |
|---|---|---|
| Технология | Canvas 2D | Canvas 2D (3 слоя: chart / UI / crosshair) |
| Candlestick | ✅ | ✅ (two-pass рендер: батчинг по цвету) |
| OHLC bars | ✅ `BarSeries` | ✅ `OHLCBarRenderer` |
| Line | ✅ | ✅ |
| Area | ✅ | ✅ (с градиентом) |
| Baseline (двухцветная) | ✅ | ❌ нет отдельного типа |
| Histogram / Volume | ✅ `HistogramSeries` | ✅ `VolumeRenderer` |
| Heikin-Ashi | ⚠️ только через custom series | ✅ **first-class** |
| Renko / P&F / Kagi | ⚠️ через custom series (плагин) | ⚠️ есть transforms, не full-feature |
| Custom-типы серий | ✅ формальный плагин-API `addCustomSeries` | ✅ registry, но без экосистемы |

### 3.2 Технические индикаторы

|  | lightweight-charts | rekurt |
|---|---|---|
| Встроенные | **❌ ноль** | **✅ ~24** |
| Список | — | SMA, EMA, WMA, HMA, RSI, MACD, Stochastic, StochRSI, Bollinger, Keltner, Donchian, ATR, VWAP (session/cumulative/anchored), ADX, CCI, MFI, ROC, OBV, Williams %R, Ichimoku, Supertrend, Parabolic SAR, ZigZag, Pivot Points |
| Overlay + sub-pane | сам делаешь | ✅ оба режима |
| Мемоизация пересчёта | сам делаешь | ✅ по `version` буфера |

### 3.3 Инструменты рисования

|  | lightweight-charts | rekurt |
|---|---|---|
| Встроенные | **❌ ноль** (сторонний плагин ~68 инстр.) | ✅ ~9 |
| Список | — | TrendLine, Horizontal/Vertical Line, Ray, Rectangle, Fib Retracement, Fib Extension, Channel, Arrow |
| Hit-test / выбор / undo-redo | сам | ✅ `DrawingLayer` |
| Привязка к свечам | сам | ✅ anchored в буфере |
| Продвинутые (Эллиотт, Гартли) | через плагин | ❌ нет |

### 3.4 Оси, шкалы, форматирование

| Функция | lightweight-charts | rekurt |
|---|---|---|
| Linear / Log / Percentage / IndexedTo100 | ✅ все 4 | ✅ все 4 |
| Несколько price scale | ✅ | ⚠️ слабее |
| Autoscale + scaleMargins | ✅ | ✅ (с RangeSource для больших окон) |
| Богатый Time scale API | ✅ | ✅ есть аналоги |
| Произвольная горизонтальная шкала (yield curve) | ⚠️ ограниченно | ✅ `HorzScaleBehavior` |

### 3.5 Интерактивность

| Функция | lightweight-charts | rekurt |
|---|---|---|
| Crosshair | ✅ Normal/Hidden/**Magnet** | ✅ + snap-to-candle |
| Зум/пан/колесо/touch | ✅ | ✅ + инерция |
| Клавиатура | ⚠️ минимально | ✅ стрелки/+−/Home/End/Fit |
| Подписки на события | ✅ богатый API | ✅ беднее по гранулярности |
| Hovered-object info (v5.2) | ✅ | ❌ |
| Доступность (ARIA) | ⚠️ ограниченно | ✅ role=img + live-region |

### 3.6 Слой данных и realtime — ключевое расхождение

| Функция | lightweight-charts | rekurt |
|---|---|---|
| HTTP-клиент истории | **❌ нет** | ✅ `PollingTransport` |
| WebSocket | **❌ нет** | ✅ `WebSocketTransport` (абстракция) |
| Realtime-обновление | `series.update()` O(1) | ✅ `CandleMerger` (RAF-склейка) + `updateLast` |
| O(1) prepend истории | ❌ O(n) `setData` | ✅ `_head`-офсет |
| Lazy-load при скролле | сам | ✅ `onLoadMoreHistory` / `prependHistory` |
| Stale-guard смены символа | сам | ✅ `_connectVersion` |
| Валидация инвариантов | сам | ✅ runtime-валидация |

### 3.7 Состояние, темы, кастомизация

| Функция | lightweight-charts | rekurt |
|---|---|---|
| Сохранение/восстановление layout | ❌ сам | ✅ `saveLayoutState` (URL) / `saveFullState` |
| Темы dark/light/auto | ⚠️ цвета вручную | ✅ + `prefers-color-scheme` |
| Watermark text/image | ✅ плагины v5 | ⚠️ беднее |
| Markers | ✅ (v5 — плагин) | ✅ Markers API |
| Legend OHLCV | ❌ сам | ✅ встроенная |
| Экспорт в PNG | ✅ `takeScreenshot()` | ✅ `toPNG()` |

### 3.8 Производительность

| Аспект | lightweight-charts | rekurt |
|---|---|---|
| Хранение данных | внутреннее оптимизированное | колоночные `Float64Array` |
| append/prepend | `update()` O(1) | O(1) append/prepend через head-offset |
| Culling видимой области | ✅ | ✅ |
| Даунсэмплинг при сжатии | ✅ data conflation (v5.1) | ✅ `conflate` |
| Потолок | проверен в проде | хорошие алгоритмы, **не проверено в бою** |

### 3.9 Экосистема, фреймворки, зрелость

| Аспект | lightweight-charts | rekurt |
|---|---|---|
| React/Vue обёртки | ✅ сторонние (популярные) | ✅ **официальные, в одном релизе** |
| Плагин-экосистема | ✅ формальная + сообщество | ⚠️ registry без экосистемы |
| Документация | ✅ обширная | ⚠️ README + GUIDES + TypeDoc |
| Стабильность API | стабильный, версионированный | **0.1.0 — может ломаться** |
| Бэкер | TradingView (компания) | малый/одиночный проект |

---

## 4. Плюсы и минусы

### lightweight-charts

**Плюсы:** зрелость и боевая закалка; компактность (~35 КБ) и предсказуемость;
стабильный версионированный API + миграции; формальная плагин-система
(Custom Series, Series/Pane Primitives) и экосистема; богатый API событий,
magnet-crosshair, hovered-object info; большое сообщество и документация.

**Минусы:** ничего «прикладного» из коробки (ни индикаторов, ни рисовалок, ни
слоя данных, ни realtime-склейки, ни сохранения состояния); Apache-2.0 требует
видимой атрибуции TradingView; официальные React/Vue-обёртки — сторонние.

### rekurt/ohlcv-front

**Плюсы:** огромный охват из коробки (24 индикатора, 9 рисовалок, полный слой
данных, realtime, сохранение/шеринг состояния, легенда, темы, ARIA); качественная
инженерия ядра (колоночные `Float64Array`, O(1) prepend, version-мемоизация,
трёхслойный canvas, структурированные ошибки, strict TS); официальные
React+Vue+vanilla; MIT.

**Минусы:** v0.1.0 — нет боевой проверки, API нестабилен; экосистемный/bus-factor
риск (малый/одиночный проект; в коммитах упоминается «Codex» — повод тщательнее
ревьюить код перед продакшеном); нет сообщества/плагин-экосистемы; беднее по API
событий, нескольким price scale, watermark; нет `Baseline`-серии; заявления о
перформансе не подтверждены бенчмарками; найдены конкретные недочёты в индикаторах
(см. §8.2).

---

## 5. Чего не хватает rekurt

**Функциональные пробелы:** Replay mode; Compare mode (наложение символов);
Alerts (только в комментариях); Volume Profile / Market Profile (TPO); продвинутые
рисовалки (Эллиотт, Гартли, вилы); Baseline-серия; полноценные множественные price
scale; hovered-object info; Workspaces (в роадмапе); полный i18n.

**Нефункциональные (технически значимые):** зрелость и закалка краевыми случаями;
стабильность API; плагин-экосистема и сообщество; документация; долгосрочная
поддержка / bus-factor.

---

## 6. Что у каждого реализовано лучше

**rekurt объективно сильнее в:** индикаторах из коробки (24 vs 0 с мемоизацией);
полном слое данных (REST + WS-абстракция + lazy-load с O(1) prepend + gap-detection
+ валидация + структурированные ошибки); realtime-конвейере (RAF-склейка тиков,
autoFollow); рисовалках из коробки; сохранении/шеринге состояния; Heikin-Ashi
first-class, встроенной OHLCV-легенде, авто-темах, ARIA-доступности; колоночном
хранении `Float64Array`.

**lightweight-charts объективно сильнее в:** зрелости рендера и краевых случаев;
API time scale и событий (magnet-crosshair, hovered-object info); формальной
плагин-архитектуре с экосистемой; стабильности и предсказуемости API; нескольких
price scale, watermark, price lines; компактности и проверенной производительности;
поддержке вендором + сообществе + документации (снижает технический риск внедрения).

---

## 7. Вердикт и рекомендации по сценариям

- **Нужен лёгкий, проверенный движок отрисовки, а индикаторы/данные/рисовалки ты и
  так делаешь сам (или они не нужны)** → **lightweight-charts**. Меньше риска,
  стабильный API, поддержка, экосистема.
- **Нужен «терминал из коробки»** (индикаторы + рисовалки + REST/WS + realtime +
  сохранение состояния) → **rekurt закрывает это разом** — но только если принять
  риски v0.1.0: собственный код-ревью, фиксация версии, готовность поддерживать
  форк самому.
- **Гибрид** (часто оптимален): взять **lightweight-charts как проверенное ядро** и
  **портировать у rekurt** прикладные слои (индикаторы, data-feed, realtime-merge) —
  там качественные, читаемые реализации.

**Одной фразой:** rekurt — технически грамотный «полный комбайн» уровня платных
решений, но молодой и непроверенный; lightweight-charts — узкий, но зрелый и
безопасный фундамент. Выбор определяется тем, что дороже: **готовая широта функций
сейчас** (rekurt) или **низкий технический риск и долгосрочная стабильность**
(lightweight-charts).

---

## 8. Построчный разбор подсистем

Ниже — разбор по фактически прочитанному коду rekurt, с указанием файлов и строк.
Для lightweight-charts разбирается его публичная модель.

### 8.1 Слой данных + realtime

**Поток данных:**

```
Transport (REST/WS) ──candles──▶ DataFeed ──▶ CandleMerger ──RAF──▶ CandleBuffer ──version++──▶ render
   (fetchHistory,            (stale-guard,      (coalescing,        (Float64Array,
    subscribe)                loadMoreHistory)   merge/append)       O(1) append/prepend)
```

**`CandleBuffer`** (`data/CandleBuffer.ts`):

- Колоночное хранение — 6 параллельных `Float64Array` (`:46–66`) вместо массива
  объектов: меньше нагрузка на GC, лучше кэш-локальность.
- Логический `_head`-офсет (`:31–44`, `:193–288`) даёт **O(1) prepend** истории:
  fast-path сдвигает head влево без аллокаций (`:219–237`); когда left-pad кончился,
  slow-path резервирует новый left-pad `= max(incoming, length)` (`:242`), амортизируя
  серию страниц к O(1) — «infinite scroll without GC churn» (`:187`).
- Два счётчика ревизий: `_version` на любой мутации (ключ мемоизации), `_generation`
  только на `clear()` (`:72–93`) — позволяет кэшам отличить `setData`-перезагруз даже
  при той же длине/таймстемпах.
- Атомарность: `appendBatch`/`prepend` валидируют весь диапазон до записи (`:143–149`).
- `evictHead` O(1) + `_compact` через `copyWithin` (`:361–369`) для `maxCandles`-кэпа.
- `sliceView` — zero-copy `subarray` (`:305–320`).

**`CandleMerger`** (`data/CandleMerger.ts`): `mergeRealtime` (`:46–60`) — `updateLast`
при `t==lastTime`, `append` при `t>lastTime`, старые игнор; `_scheduleUpdate` (`:80–89`)
гарантирует максимум один `onUpdate` за кадр через `_rafId`-guard; флаг
`_pendingRealtime` отделяет realtime-кадр от history (для scoping `maxCandles`-эвикции).

**`DataFeed`** (`data/DataFeed.ts`): stale-protection через `_connectVersion`
(`:38, :53, :69, :111`) — поздний ответ старого `fetchHistory` при смене символа
отбрасывается; `loadMoreHistory` (`:88–128`) сериализует загрузку (`_isLoadingHistory`,
один запрос в полёте) и возвращает реальное число добавленных свечей; ошибки lazy-load
не-фатальны.

**Транспорты:** `PollingTransport` — `_pollInFlight`-guard пропускает тик вместо
накопления параллельных запросов (`:129–131`), `AbortController` рвёт запрос на
unsubscribe; `WebSocketTransport` — **абстрактный** каркас (реализуешь под свою
WS-библиотеку), канал `${symbol}:${resolution}` (`:34`).

**Валидация/gaps:** `validateCandle` проверяет инварианты `t>0`, `h≥l`, `h≥max(o,c)`,
`l≤min(o,c)`, `v≥0` и срезает лишние поля (`data/validation.ts:51–76`); `findGaps`
детектит пропуски с tolerance 1.5×, корректно отдаёт `null` для календарных месяцев.

**Что делает lightweight-charts:** ничего из этого. История → `setData`; realtime →
сам зовёшь `update()` (O(1) — это хорошо); **lazy-load → `setData([...older, ...current])`
= O(n) пересоздание массива** (нет O(1)-prepend); coalescing, stale-guard, валидация —
на тебе.

**Вердикт:** самая сильная, «production-grade» подсистема rekurt — гонки, атомарность,
амортизация prepend, коалесинг продуманы. Объективно даёт намного больше, чем LWC.

### 8.2 Индикаторы

**Базовый класс** (`indicators/Indicator.ts`): `computeCached` (`:67–77`) — ключ кэша
= идентичность буфера + `version` + `length`; проверка `cache.buffer === buffer`
(`:57–66`) защищает от возврата чужой серии, когда два свежих буфера делят `version:0`
и длину. Серии — `Float64Array` длины `n`, NaN до конца warmup (`nanArray :85–89`).

**Реестр** (`indicators/registry.ts`): дискриминированное объединение `IndicatorConfig`
(`:41–77`); `createIndicator` (`:150–215`) с exhaustive `never`-guard (`:205–213`) —
забытый case ловится компилятором, forged-JSON — рантайм-исключением;
`diffIndicatorConfigs` (`:236–261`) — общая diff-функция для React-`useEffect` и
Vue-`watch`.

**Математика:** RSI — Wilder seed = SMA первых `period` приращений (`RSI.ts:39–48`),
сглаживание (`:55–56`), edge-cases `avgLoss==0→100` (`:64–68`); EMA — SMA-seed + `k=2/(p+1)`
(`EMA.ts:35–44`); VWAP — session (сброс по UTC-дню), cumulative, anchored (NaN до якоря)
(`VWAP.ts:63–85`); **Ichimoku — образцово**: оконные max/min через монотонную деку O(1)
(`Ichimoku.ts:78–95`), один раз пред-выгружает h/l/close в `Float64Array` (`:68–76`),
forward/backward displacement (`:107–123`); Supertrend — Wilder-ATR + carry-forward
полос + флип на пробое (`Supertrend.ts:62–96`).

**❗ Найденные недочёты (видны только из кода):**

1. **Аллокации в горячем цикле.** RSI/EMA/VWAP/Supertrend читают данные через
   `buffer.candleAt(i)`, а `candleAt` (`CandleBuffer.ts:322–334`) создаёт **новый объект
   `{o,h,l,c,v,t}` на каждый вызов**. Пример: `RSI.ts:42` — два объекта только чтобы
   прочитать `.c`. Иронично при колоночном буфере. Ichimoku показывает, как надо
   (пред-выгрузка в `Float64Array`), но остальные не приведены к этому паттерну.
2. **Нет инкрементального пересчёта.** `computeCached` мемоизирует по `version`, но при
   realtime каждый тик → `version++` → **полный пересчёт всех индикаторов O(n) на каждом
   realtime-кадре**. Для 24 индикаторов на длинной истории — заметная работа каждые
   ~16 мс. Характерно, что `RangePyramid` (та же кодовая база) инкрементальный rebuild
   **умеет**, а индикаторы нет.

**Что делает lightweight-charts:** ноль индикаторов — считаешь массив сам, кладёшь в
`LineSeries`/`HistogramSeries`, на realtime обновляешь сам. Ни реестра, ни мемоизации,
ни авто-sub-pane.

**Вердикт:** rekurt на порядок функциональнее, математика в проверенных местах
канонична; но реализация не идеальна — `candleAt`-аллокации и O(n)/тик бьют ровно по
realtime-сценарию (главному для трейдинга).

### 8.3 Рендеринг

**Трёхслойный canvas** (`rendering/ChartEngine.ts`, конструктор `:148–224`): три
наложенных `<canvas>` z-index 1/2/3 — chart / ui / crosshair; нижние `aria-hidden` +
`pointer-events:none` (`:167–168, :798`), верхний `tabIndex=0`, `role=img`, offscreen
`aria-live`-регион для озвучки OHLC (`:171–201`).

**Dirty-флаги — суть оптимизации.** Три независимых флага; в `setCrosshair` (`:447–477`)
движение курсора **внутри одной свечи** перерисовывает только дешёвый crosshair-слой, а
ui-слой (легенда) — только при смене свечи. Дорогие слои (свечи, индикаторы, оси) на
hover не трогаются. `_scheduleRaf` (`:567–573`) коалесит в один RAF.

**Конвейер `_render`** (`:575–790`): тип серии → (опц. `transformView` для Heikin-Ashi) →
**autoScale** (с акселерацией RangePyramid) → **conflate** (`:645`) → отрисовка в порядке
(`:660–741`): фон → bottom-примитивы → grid → volume → серия → overlay-индикаторы
(`computeCached :684`) → markers → drawings → ось цены → sub-pane → ось времени. UI-слой
читает легенду свежей из буфера (`:758–767`), чтобы realtime-тик обновлял OHLC под курсором.

**`CandleRenderer`** (`rendering/CandleRenderer.ts`): two-pass — сначала медвежьи, потом
бычьи (`:17–19`), `fillStyle` ставится раз на проход; culling — свечи вне зоны
пропускаются (`:45`); тело клампится к `MIN_CANDLE_BODY_HEIGHT` (`:59`).

**`Viewport`** (`interaction/Viewport.ts`): `priceToY` имеет linear fast-path,
bit-for-bit идентичный дотрансформной версии (`:169–182`), а log/percentage/indexed —
через `priceToTransformed` с кэшем `_ensureTransform` (`:200–215`); `indexToX` (`:120–125`)
поддерживает и равномерную сетку, и нелинейный `coord01`-маппинг (`:140–166`, бинарный
поиск) для кривых доходности.

**`priceScale`** (`interaction/priceScale.ts`): чистые `priceToTransformed`/
`transformedToPrice` (`:36–67`); guard `LOG_MIN_POSITIVE=1e-9`; `_applyPriceRange` паддит
в log-пространстве для log-режима (`Viewport.ts:461–481`).

**Экспорт:** `toPNG()` (`:545–565`) композитит три слоя на offscreen-canvas → `data:image/png`.

**Модель lightweight-charts:** canvas скрыт, ты даёшь данные — движок рисует; кастом через
формальные `ISeriesPrimitive`/`IPanePrimitive`/`addCustomSeries`. У rekurt обратная
философия: внутренняя архитектура открыта (плюс — гибкость; минус — выше риск поломок API).

**Вердикт:** инженерия рендера сильная (3-слойные dirty-флаги, two-pass+culling, нелинейные
оси, a11y, PNG). Чего нет против LWC — формального стабильного плагин-API и боевой закалки.

### 8.4 Производительность

| Механизм | Где | Что даёт |
|---|---|---|
| Колоночные `Float64Array` | `CandleBuffer` | нет per-candle объектов, кэш-локальность |
| O(1) append/prepend | `_head`-офсет | infinite-scroll без GC-churn |
| Version-мемоизация | `Indicator.computeCached` | индикаторы не считаются каждый кадр |
| RangePyramid | `data/RangePyramid.ts` | autoscale огромного окна O(n/256) вместо O(n) |
| Conflate | `data/conflate.ts` | 1 бар/пиксель при fit-all над миллионами баров |
| Dirty-флаги слоёв | `ChartEngine` | hover не перерисовывает свечи/индикаторы |
| `_ensureTransform`-кэш | `Viewport` | трансформа шкалы не пересчитывается в кадре |

**`RangePyramid`** (`data/RangePyramid.ts`): `BLOCK=256` (`:16`); autoscale суб-пиксельного
fit-all = O(n/256) + два ≤256-частичных скана (`:51–89`); память 1M свечей ≈ 96 КБ против
~48 МБ полной пирамиды (`:10–15`); инкрементальный rebuild на append (`:124–142`), полный —
только при смене `generation`/`firstTime` (`:143–148`); строится **лениво** и только когда
окно > порога (`:27–35`) — в обычном зуме её нет.

**`Conflate`** (`data/conflate.ts`): при `candleStep < 1px` (`:34`) каждый пиксельный столбец
схлопывается в один бар с корректной OHLC-семантикой (open=first, close=last, high=max,
low=min, vol=sum) (`:66–85`); при нормальном зуме возвращает вью без изменений; `repIndex`
держит исходный индекс (crosshair/hit-test на сырых индексах).

**Границы (честно):** аллокации `candleAt` в индикаторах (§8.2.1); полный O(n)-пересчёт
индикаторов на тик (§8.2.2); `conflate` аллоцирует `Float64Array` на кадр в fit-all
(приемлемо); заявления о масштабе не подтверждены бенчмарками.

**lightweight-charts:** сопоставимый набор — data conflation v5.1, `update()` O(1), годы
профилирования; чего у LWC нет публично — аналога RangePyramid и O(1)-prepend. Зато LWC
проверен в проде.

**Вердикт:** алгоритмически rekurt на уровне или местами выше LWC по идеям, но есть два
конкретных недочёта в индикаторах (бьют по realtime) и нет независимых бенчмарков. LWC
берёт доказанной стабильностью.

---

## 9. Итоговая таблица по подсистемам (на уровне кода)

| Подсистема | rekurt сильнее в | lightweight-charts сильнее в |
|---|---|---|
| **Данные/realtime** | весь слой есть; O(1) prepend; stale-guard; коалесинг; валидация | `update()` боевой; зрелость; не навязывает модель |
| **Индикаторы** | 24 шт.; реестр; мемоизация; sub-pane; каноничная математика | — (но без аллокаций-в-цикле и O(n)/тик, т.к. их просто нет) |
| **Рендеринг** | 3-слойные dirty-флаги; two-pass+culling; нелинейные оси; a11y; PNG | формальный стабильный плагин-API; закалка рендера |
| **Производительность** | RangePyramid; O(1) prepend; ленивые структуры | доказанный прод-масштаб; нет «candleAt»-мусора и O(n)/тик |

**Честный итог.** На уровне прочитанного кода rekurt — не наивная поделка, а грамотно
спроектированная библиотека, по ряду идей превосходящая lightweight-charts (O(1)-prepend,
RangePyramid, открытость архитектуры). Но прямое чтение вскрыло два конкретных недочёта,
которых не видно из README и которые бьют по realtime (аллокации `candleAt` в hot-циклах
индикаторов и полный O(n)-пересчёт на тик), плюс отсутствие бенчмарков и боевой закалки.
У lightweight-charts наоборот: уже по фичам, но без таких шероховатостей и с доказанной
стабильностью.

---

## Приложение. Прочитанные файлы-источники

`packages/core/src/`:

- **data/**: `CandleBuffer.ts`, `CandleMerger.ts`, `DataFeed.ts`, `PollingTransport.ts`,
  `WebSocketTransport.ts`, `conflate.ts`, `RangePyramid.ts`, `validation.ts`, `gaps.ts`
- **indicators/**: `Indicator.ts`, `registry.ts`, `RSI.ts`, `EMA.ts`, `VWAP.ts`,
  `Ichimoku.ts`, `Supertrend.ts`
- **rendering/**: `ChartEngine.ts`, `CandleRenderer.ts`
- **interaction/**: `Viewport.ts`, `priceScale.ts`

Для lightweight-charts — публичная документация и release notes v5.0–v5.2.
