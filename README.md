# ADM Download Manager (MediaCatch)

**MediaCatch** — افزونهٔ Chrome (Manifest V3) برای تشخیص خودکار تصاویر، ویدیوها و فایل‌های صوتی در هر صفحه و دانلود یک‌کلیکی، الهام‌گرفته از تجربهٔ **ADM Download Manager**.

[English summary](#english) · [نصب](#نصب) · [قابلیت‌ها](#قابلیت‌ها) · [ساختار پروژه](#ساختار-پروژه)

---

## این پروژه چه کاری می‌کند؟

وقتی در وب می‌گردید، رسانه‌ها (عکس، ویدیو، صدا، لینک مستقیم فایل) پشت `<img>`، `<video>`، CSS background، لینک‌ها و گاهی `blob:` پنهان می‌مانند. MediaCatch همان لحظه آن‌ها را پیدا می‌کند و **بدون باز کردن DevTools** امکان دانلود می‌دهد:

1. **هاور روی رسانه** → دکمهٔ شناور با نوع فایل و (برای تصویر) ابعاد  
2. **پنل «رسانه‌های صفحه»** → فهرست کامل، فیلتر، اسکن عمیق، دانلود دسته‌ای  
3. **راست‌کلیک** → «دانلود … (MediaCatch)»  
4. **میانبر** → `Alt+D` برای دانلود زیر نشانگر، `Alt+Shift+D` برای پنل  

دانلودها در پوشهٔ **`media-catch`** داخل Downloads ذخیره می‌شوند (یا با «پرسش محل ذخیره»، هر بار Save As).

### زنجیرهٔ مقاوم دانلود

بسیاری از سایت‌ها hotlink protection دارند (Referer، Cookie). افزونه به‌ترتیب امتحان می‌کند:

| مرحله | روش |
|--------|-----|
| ۱ | `chrome.downloads` مستقیم |
| ۲ | fetch در **service worker** با Cookie و Referer تب |
| ۳ | fetch **داخل content script** (context کامل صفحه) |
| + | اگر دانلود بعد از شروع قطع شد (۴۰۳ و…) → **retry** با روش بعدی |

برای fetch جایگزین سقف **۱۵۰MB** است (محدودیت حافظه).

---

## قابلیت‌ها

- تشخیص: `<img>` (شامل lazy `data-src`)، `<video>` / `<audio>` / `<source>`، **background-image**، لینک‌های مستقیم رسانه، **blob:** (MSE)
- دکمهٔ شناور هنگام هاور (قابل خاموش در تنظیمات)
- پنل FAB پایین صفحه + popup نوارابزار + **بج** تعداد رسانه روی آیکون
- تاریخچهٔ دانلود با وضعیت (✅ ⏳ ⚠️) و اندازه
- تنظیمات: حداقل سایز تصویر، دامنه‌های block، saveAs، خاموش/روشن کلی
- پشتیبانی از **iframe** (`all_frames`)
- منوی راست‌کلیک برای image / audio / video / لینک رسانه

---

## نصب

### از سورس (Developer)

1. این repo را clone کنید.
2. در Chrome بروید به `chrome://extensions`
3. **Developer mode** را روشن کنید.
4. **Load unpacked** → پوشهٔ [`media-catch/`](media-catch/) را انتخاب کنید.

برای `file://` روی کارت افزونه → Details → **Allow access to file URLs**.

### میانبرها

در `chrome://extensions/shortcuts` می‌توانید `Alt+D` و `Alt+Shift+D` را تغییر دهید.

---

## نحوهٔ استفاده

| کار | روش |
|-----|-----|
| یک فایل | هاور → دکمه ⬇ |
| همهٔ رسانه‌ها | 📥 پایین صفحه یا کلیک آیکون افزونه |
| چندتایی | پنل → «دانلود همه» (تا ۳۰ مورد) |
| پس‌زمینه‌های CSS | پنل → 🔍 اسکن عمیق |
| راست‌کلیک | منوی MediaCatch |

جزئیات بیشتر: [`media-catch/README.md`](media-catch/README.md)

---

## محدودیت‌ها

- فقط URLهای **قابل دسترس HTTP** (یا blob/data در همان صفحه). **YouTube، اینستاگرام، آپارات** و مشابه نیاز به extractor اختصاصی دارند (در roadmap).
- **HLS/DASH** (`.m3u8` / `.mpd`) به‌صورت manifest دانلود می‌شوند؛ تبدیل به mp4 داخل افزونه نیست.
- **Shadow DOM** اسکن نمی‌شود.
- token یکبارمصرف / sign با IP ممکن است فقط با کلیک دستی روی لینک در صفحه کار کند.

---

## ساختار پروژه

```
.
├── README.md                 # همین فایل — معرفی repo
├── media-catch/              # افزونهٔ Chrome (Load unpacked این پوشه)
│   ├── manifest.json
│   ├── background.js         # MV3 service worker — دانلود، منو، تاریخچه
│   ├── content.js            # تشخیص + UI در صفحه
│   ├── content.css
│   ├── popup/
│   ├── options/
│   └── icons/
└── scripts/
    └── make_icons.py         # تولید آیکون (Pillow)
```

---

## فناوری

- **Chrome Extension Manifest V3**
- JavaScript (vanilla) — بدون build step
- `chrome.downloads`, `storage`, `contextMenus`, `tabs`, `host_permissions: <all_urls>`

---

## Roadmap

- استریکتر سایت‌های خاص (YouTube، Vimeo، …)
- تبدیل m3u8 با ffmpeg.wasm
- resume / multi-connection download
- انتخاب پوشهٔ ذخیره (در حد API Chrome)

---

## مجوز

MIT — استفاده، تغییر و انتشار آزاد با ذکر منبع.

---

## English

**MediaCatch** is a lightweight **Chrome extension (MV3)** inspired by ADM Download Manager. It scans pages for downloadable images, videos, audio, direct media links, CSS backgrounds, and some `blob:` sources; shows a hover download button and a floating panel; supports context menus and keyboard shortcuts; and uses a **three-stage download fallback** (direct → extension fetch with page cookies/referer → in-page fetch) when servers block hotlinking.

Install: clone repo → `chrome://extensions` → Load unpacked → select the `media-catch/` folder.

See [limitations](#محدودیت‌ها) above for sites that need dedicated extractors (YouTube, etc.).
