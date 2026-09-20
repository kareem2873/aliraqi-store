/* =====================================================================
   AL-IRAQI HOME APPLIANCES — كتالوج الجملة — script.js
   =====================================================================
   نسخة مراجعة شاملة (Data Contract + Validation + Security + A11y):
   ✅ طبقة تطبيع وvalidation موحّدة لبيانات Google Sheet (aliases + schema).
   ✅ حماية من الأكواد (IDs) المكررة — لا تختلط الأسعار ولا المنتجات في السلة.
   ✅ PRODUCT_MAP للوصول O(1) بدل PRODUCTS.find() في كل مكان.
   ✅ حالات UI حقيقية: تحميل / خطأ / لا توجد منتجات / لا نتائج بحث.
   ✅ بدون innerHTML لأي بيانات قادمة من الشيت (createElement + textContent فقط).
   ✅ تعطيل حقيقي (disabled) للأزرار/الحقول بدل CSS فقط.
   ✅ normalizeQuantity() موحّدة لكل الموقع.
   ✅ إدارة Focus لكل من السلة والـ Lightbox والقائمة المنسدلة + دعم كيبورد.
   ✅ Debounce للبحث + DocumentFragment للعرض + Lazy Loading للصور.
===================================================================== */

const CONFIG = {

  // 📌 مصدر البيانات: "json" (تجريبي للتطوير فقط) أو "csv" أو "sheet"
  dataSource: "sheet",

  // 📌 لو dataSource = "csv": مسار ملف الـ CSV
  csvFilePath: "data/products.csv",

  // 📌 لو dataSource = "sheet": رابط الشيت بعد نشرها كـ CSV
  googleSheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRy6tmzPEdxq6EcBxWh-bM_zR94kaYlZhHOxXa6LceOjFxZjxm0Qtr3Dy8GnYB99g/pub?gid=1444421128&single=true&output=csv",

  // 📌 رقم واتساب المؤسسة (بصيغة دولية، من غير + أو صفر)
  whatsappNumber: "201105236152",

  // 📌 اسم المؤسسة (يظهر في رسالة واتساب)
  storeName: "AL-IRAQI HOME APPLIANCES",

  // 📌 عملة العرض
  currency: "ج.م",

  // 📌 الوحدة الافتراضية المختارة في كارت المنتج: "carton" أو "piece"
  defaultUnit: "carton",

  // 📌 لو الصنف مالوش سعر قطعة في البيانات، يتحسب تلقائياً من سعر الكرتونة؟
  autoDerivePiecePrice: true,

  // 📌 أقصى كمية مسموح بها في السلة لكل سطر (قابلة للتعديل)
  maxQuantity: 9999,
};

/* =====================================================================
   1) طبقة Data Contract: Aliases لأسماء الأعمدة + Validation
===================================================================== */

/** أسماء الأعمدة البديلة (aliases) المقبولة لكل حقل — أي عمود من دول هيتقرا صح */
const FIELD_ALIASES = {
  id: ["id", "code", "item_id", "sku", "كود", "كود الصنف", "كود المنتج"],
  name: ["name", "product_name", "title", "اسم", "اسم الصنف", "اسم المنتج"],
  category: ["category", "type", "القسم", "التصنيف", "قسم"],
  image: ["image", "img", "photo", "image_url", "صورة", "رابط الصورة", "الصورة"],
  pcs_per_carton: [
    "pcs_per_carton", "carton_qty", "pcs", "pieces_per_carton",
    "عدد القطع بالكرتونة", "عدد القطع في الكرتونة", "عدد القطعة بالكرتونة",
  ],
  piece_price: ["piece_price", "price_piece", "سعر القطعة", "سعر_القطعة"],
  carton_price: ["carton_price", "price_carton", "سعر الكرتونة", "سعر_الكرتونة"],
  availability: ["availability", "status", "التوفر", "الحالة", "متوفر"],
  description: ["description", "desc", "details", "الوصف", "تفاصيل"],
};

const AVAILABLE_VALUES = new Set(["available", "متوفر", "yes", "1", "true", "نعم"]);
const UNAVAILABLE_VALUES = new Set(["unavailable", "غير متوفر", "no", "0", "false", "لا"]);

/** إزالة BOM/فراغات زائدة وتوحيد حالة الأحرف لاسم أي عمود قبل المقارنة */
function normalizeHeader(h) {
  if (h === undefined || h === null) return "";
  let s = String(h);
  s = s.replace(/^\uFEFF/, ""); // BOM
  s = s.trim().replace(/\s+/g, " ");
  return s.toLowerCase();
}

/** يحوّل صف الـ CSV الخام إلى خريطة { عنوان_معالج: قيمة } لتفادي مشاكل الأعمدة */
function normalizeRowKeys(row) {
  const out = {};
  Object.keys(row || {}).forEach((k) => {
    const nk = normalizeHeader(k);
    if (nk && !(nk in out)) out[nk] = row[k];
  });
  return out;
}

/** يدور على أول alias موجود وله قيمة غير فارغة */
function pickField(normRow, aliasList) {
  for (const alias of aliasList) {
    const nk = normalizeHeader(alias);
    if (nk in normRow) {
      const v = normRow[nk];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

function extractFields(normRow) {
  return {
    id: pickField(normRow, FIELD_ALIASES.id),
    name: pickField(normRow, FIELD_ALIASES.name),
    category: pickField(normRow, FIELD_ALIASES.category),
    image: pickField(normRow, FIELD_ALIASES.image),
    pcs_per_carton: pickField(normRow, FIELD_ALIASES.pcs_per_carton),
    piece_price: pickField(normRow, FIELD_ALIASES.piece_price),
    carton_price: pickField(normRow, FIELD_ALIASES.carton_price),
    availability: pickField(normRow, FIELD_ALIASES.availability),
    description: pickField(normRow, FIELD_ALIASES.description),
  };
}

/** تحويل نصي → رقم بأمان (بدون NaN/Infinity)، يرجع null لو مش قابل للتحويل */
function parseNumberSafe(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}
function isPositiveIntegerValue(n) {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
function isNonNegativeFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** تطبيع قيمة التوفر — لو القيمة غريبة/غير معروفة أو ناقصة، لا نعتبرها "متوفر" تلقائياً */
function normalizeAvailability(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return "unavailable";
  }
  const v = String(raw).trim().toLowerCase();
  if (AVAILABLE_VALUES.has(v)) return "available";
  if (UNAVAILABLE_VALUES.has(v)) return "unavailable";
  console.warn(`[Data] قيمة توفر غير معروفة: "${raw}" — تم اعتباره غير متوفر بشكل آمن.`);
  return "unavailable";
}

/** روابط الصور: http/https فقط، وأي حاجة تانية (javascript:, data:, ...) تُرفض */
function isSafeImageUrl(raw) {
  if (!raw) return false;
  const v = String(raw).trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(v);
  } catch (e) {
    return false;
  }
  return true;
}

/** صورة بديلة موثوقة (SVG محلي مُضمّن) — لا تعتمد على أي رابط خارجي */
const FALLBACK_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>" +
      "<rect width='400' height='400' fill='#f1f3f6'/>" +
      "<g fill='none' stroke='#c7cfd8' stroke-width='10'>" +
      "<circle cx='200' cy='150' r='55'/>" +
      "</g>" +
      "<path d='M120 300 L170 230 L215 270 L260 210 L300 300 Z' fill='#c7cfd8'/>" +
      "<text x='200' y='355' font-size='24' text-anchor='middle' font-family='sans-serif' fill='#9aa5b1'>لا توجد صورة</text>" +
      "</svg>"
  );

function resolveImageSrc(product) {
  return isSafeImageUrl(product.image) ? product.image : FALLBACK_IMAGE;
}

/** يمنع الدخول في loop لو الـ fallback نفسه فشل، وبيتفعّل مرة واحدة فقط لكل عنصر */
function attachImageFallback(imgEl) {
  imgEl.addEventListener("error", function onImgError() {
    if (imgEl.dataset.fallbackApplied === "1") return;
    imgEl.dataset.fallbackApplied = "1";
    imgEl.src = FALLBACK_IMAGE;
  });
}

/** الكمية: عدد صحيح، >= 1، محدودة بحد أقصى منطقي، وبدون NaN/Infinity/Decimal */
function normalizeQuantity(raw, fallback) {
  const fb = typeof fallback === "number" && Number.isFinite(fallback) ? fallback : 1;
  let n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) n = fb;
  if (n < 1) n = 1;
  if (n > CONFIG.maxQuantity) n = CONFIG.maxQuantity;
  return n;
}

/**
 * تطبيع صف واحد إلى منتج نهائي حسب الـ Schema الثابت، أو null لو الصف غير صالح.
 * الترتيب: تحقق من id/name → تطبيع الأرقام → اشتقاق الأسعار الناقصة → تحقق نهائي.
 */
function normalizeProductRow(fields, rowIndex) {
  const id = fields.id !== undefined ? String(fields.id).trim() : "";
  const name = fields.name !== undefined ? String(fields.name).trim() : "";

  if (!id) {
    console.warn(`[Data] تم تجاهل الصف #${rowIndex + 1}: كود الصنف (id) فارغ.`);
    return null;
  }
  if (!name) {
    console.warn(`[Data] تم تجاهل الصف #${rowIndex + 1} (كود: "${id}"): اسم الصنف فارغ.`);
    return null;
  }

  const category = fields.category ? String(fields.category).trim() : "";
  const description = fields.description ? String(fields.description).trim() : "";

  // عدد القطع بالكرتونة — لازم يكون عدد صحيح موجب، وإلا يُعتبر غير معروف (null)
  let pcsPerCarton = parseNumberSafe(fields.pcs_per_carton);
  if (pcsPerCarton !== null) {
    pcsPerCarton = Math.trunc(pcsPerCarton);
    if (!isPositiveIntegerValue(pcsPerCarton)) {
      console.warn(`[Data] "عدد القطع بالكرتونة" غير صالح للصنف "${id}" — تم تجاهل القيمة.`);
      pcsPerCarton = null;
    }
  }

  let piecePrice = parseNumberSafe(fields.piece_price);
  let cartonPrice = parseNumberSafe(fields.carton_price);

  if (piecePrice !== null && !isNonNegativeFiniteNumber(piecePrice)) {
    console.warn(`[Data] سعر القطعة غير صالح للصنف "${id}" — تم تجاهل القيمة.`);
    piecePrice = null;
  }
  if (cartonPrice !== null && !isNonNegativeFiniteNumber(cartonPrice)) {
    console.warn(`[Data] سعر الكرتونة غير صالح للصنف "${id}" — تم تجاهل القيمة.`);
    cartonPrice = null;
  }

  // اشتقاق السعر الناقص (بدون أي قسمة على صفر: pcsPerCarton لازم يكون رقم موجب فعلي)
  if (piecePrice === null && cartonPrice !== null && pcsPerCarton) {
    piecePrice = Math.round((cartonPrice / pcsPerCarton) * 100) / 100;
  }
  if (cartonPrice === null && CONFIG.autoDerivePiecePrice && piecePrice !== null && pcsPerCarton) {
    cartonPrice = Math.round(piecePrice * pcsPerCarton * 100) / 100;
  }

  // لو مفيش أي سعر صالح إطلاقاً (لا قطعة ولا كرتونة) — المنتج غير قابل للبيع، نتجاهله
  if (piecePrice === null && cartonPrice === null) {
    console.warn(`[Data] تم تجاهل الصنف "${id}" (${name}): لا يوجد سعر صالح لا بالقطعة ولا بالكرتونة.`);
    return null;
  }

  return {
    // مفتاح داخلي فريد لهذا التحميل فقط (لا يُعرض أبداً) — يُستخدم للربط الآمن في
    // PRODUCT_MAP والسلة، بحيث صنفان مختلفان بنفس نص الـ id الظاهر للعميل لا يتعارضان.
    _key: `row_${rowIndex}`,
    id,
    name,
    category: category || "أخرى",
    image: isSafeImageUrl(fields.image) ? String(fields.image).trim() : null,
    pcsPerCarton,
    piecePrice,
    cartonPrice,
    availability: normalizeAvailability(fields.availability),
    description,
    _order: rowIndex,
  };
}

/* =====================================================================
   بيانات تجريبية — لأغراض التطوير المحلي فقط (dataSource = "json")
   ⚠️ ملحوظة مهمة: السطر ده مش fallback تلقائي عند فشل تحميل Google Sheet.
   هو بيتستخدم فقط لو المطوّر غيّر CONFIG.dataSource يدوياً إلى "json".
   عند فشل الشبكة/الشيت الحقيقي، الموقع بيعرض حالة خطأ واضحة للعميل، مش بيانات وهمية.
===================================================================== */
const SAMPLE_PRODUCTS = [
  {
    id: "GLS-2044",
    name: "طقم كاسات زجاج كلاسيك 6 قطع",
    category: "زجاجيات",
    image: "https://picsum.photos/seed/gls2044/500/500",
    pcs_per_carton: 48,
    piece_price: 15,
    carton_price: 620,
    availability: "available",
    description: "زجاج شفاف عالي الجودة، سُمك موحّد ومقاومة عالية للكسر.",
  },
  {
    id: "PLX-1001",
    name: "طقم أطباق بلاستيك فاخر 12 قطعة",
    category: "بلاستيكيات",
    image: "https://picsum.photos/seed/plx1001/500/500",
    pcs_per_carton: 24,
    piece_price: 24,
    carton_price: 480,
    availability: "available",
    description: "أطباق بلاستيك متينة مقاومة للكسر، مناسبة للاستخدام المنزلي اليومي.",
  },
  {
    id: "MEL-3300",
    name: "طقم سلطانيات ميلامين 8 قطع",
    category: "ميلامين",
    image: "https://picsum.photos/seed/mel3300/500/500",
    pcs_per_carton: 20,
    piece_price: 32,
    carton_price: 540,
    availability: "available",
    description: "ميلامين فاخر مقاوم للكسر بألوان وتصميمات عصرية.",
  },
  {
    id: "PLX-1032",
    name: "دولاب بلاستيك 4 أدراج",
    category: "بلاستيكيات",
    image: "https://picsum.photos/seed/plx1032/500/500",
    pcs_per_carton: 6,
    piece_price: 245,
    carton_price: 1350,
    availability: "unavailable",
    description: "تصميم عملي لتنظيم الأدوات المنزلية بمساحة توفير كبيرة.",
  },
];

/* =====================================================================
   الحالة العامة (State)
===================================================================== */
let PRODUCTS = [];
let PRODUCT_MAP = new Map();
let ACTIVE_CATEGORY = "الكل";
let SEARCH_TERM = "";
let SORT_MODE = "default";
let searchDebounceTimer = null;
let lightboxTrigger = null;

/* السلة: المفتاح = "كود الصنف::الوحدة"
   القيمة = { id, unit: "piece" | "carton", qty } */
let CART = {};

/* عناصر DOM */
const el = {
  grid: document.getElementById("catalogGrid"),
  cardTemplate: document.getElementById("cardTemplate"),

  loadingState: document.getElementById("loadingState"),
  loadErrorState: document.getElementById("loadErrorState"),
  retryLoadBtn: document.getElementById("retryLoadBtn"),
  noProductsState: document.getElementById("noProductsState"),
  emptyState: document.getElementById("emptyState"),
  resetFilters: document.getElementById("resetFilters"),

  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),

  categoryDropdown: document.getElementById("categoryDropdown"),
  categoryToggle: document.getElementById("categoryToggle"),
  categoryLabel: document.getElementById("categoryLabel"),
  categoryMenu: document.getElementById("categoryMenu"),

  cartBtn: document.getElementById("cartBtn"),
  cartCount: document.getElementById("cartCount"),
  cartPanel: document.getElementById("cartPanel"),
  cartOverlay: document.getElementById("cartOverlay"),
  cartClose: document.getElementById("cartClose"),
  cartItems: document.getElementById("cartItems"),
  cartTotalCartons: document.getElementById("cartTotalCartons"),
  cartTotalPieces: document.getElementById("cartTotalPieces"),
  cartTotalPrice: document.getElementById("cartTotalPrice"),
  checkoutBtn: document.getElementById("checkoutBtn"),

  lightbox: document.getElementById("lightbox"),
  lightboxImg: document.getElementById("lightboxImg"),
  lightboxClose: document.getElementById("lightboxClose"),
};

// الـ fallback بيتعلّق مرة واحدة بس على عنصر اللايت بوكس لأنه بيتعاد استخدامه لكل صورة
attachImageFallback(el.lightboxImg);

/* =====================================================================
   2) تحميل البيانات — JSON / CSV / Google Sheets + حالات الواجهة
===================================================================== */
function setViewState(state) {
  el.loadingState.hidden = true;
  el.loadErrorState.hidden = true;
  el.noProductsState.hidden = true;
  el.emptyState.hidden = true;
  el.grid.hidden = true;

  if (state === "loading") el.loadingState.hidden = false;
  else if (state === "error") el.loadErrorState.hidden = false;
  else if (state === "emptyData") el.noProductsState.hidden = false;
  else if (state === "ready") el.grid.hidden = false;
}

function init() {
  // التأكد من إن السلة والّلايت بوكس مقفولين من أول ما الصفحة تفتح
  closeCartPanel();
  closeLightbox();

  if (CONFIG.dataSource === "csv") {
    loadFromCsvFile(CONFIG.csvFilePath);
  } else if (CONFIG.dataSource === "sheet") {
    loadFromGoogleSheet(CONFIG.googleSheetCsvUrl);
  } else {
    // وضع تطوير محلي فقط — راجع الملاحظة فوق SAMPLE_PRODUCTS
    processProducts(SAMPLE_PRODUCTS);
  }
}

// عدّاد تحميل بسيط لمنع Race Condition: لو المستخدم ضغط "إعادة المحاولة" أكتر من
// مرة بسرعة، بس آخر طلب تحميل هو اللي مسموحله يحدّث الواجهة؛ أي استجابة أقدم
// توصل متأخرة يتم تجاهلها بدل ما تكتب فوق نتيجة أحدث بالغلط.
let loadRequestToken = 0;

function loadFromCsvFile(path) {
  const token = ++loadRequestToken;
  setViewState("loading");
  Papa.parse(path, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (token !== loadRequestToken) return; // استجابة قديمة — تم تجاوزها بتحميل أحدث
      if (results.errors && results.errors.length) {
        console.warn("[CSV] أخطاء أثناء تحليل الملف:", results.errors);
      }
      processProducts(results.data);
    },
    error: (err) => {
      if (token !== loadRequestToken) return;
      console.error("تعذّر تحميل ملف CSV:", err);
      setViewState("error");
    },
  });
}

/**
 * تحميل من Google Sheets
 * ------------------------------------------------------------------
 * 1) افتح الشيت على Google Sheets.
 * 2) File → Share → Publish to web.
 * 3) اختار الشيت المطلوب ونوع الملف "Comma-separated values (.csv)".
 * 4) انسخ الرابط وحطه في CONFIG.googleSheetCsvUrl فوق.
 * 5) أول صف في الشيت أسماء أعمدة (id, name, category, image, pcs_per_carton,
 *    piece_price, carton_price, availability, description) أو أي مرادف مدعوم
 *    في FIELD_ALIASES فوق.
 * ------------------------------------------------------------------
 */
function loadFromGoogleSheet(url) {
  if (!url) {
    console.warn("لم يتم تحديد رابط Google Sheet في CONFIG.googleSheetCsvUrl");
    setViewState("error");
    return;
  }
  const token = ++loadRequestToken;
  setViewState("loading");
  Papa.parse(url, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (token !== loadRequestToken) return; // استجابة قديمة — تم تجاوزها بتحميل أحدث
      if (results.errors && results.errors.length) {
        console.warn("[Google Sheet] أخطاء أثناء تحليل البيانات:", results.errors);
      }
      processProducts(results.data);
    },
    error: (err) => {
      if (token !== loadRequestToken) return;
      console.error("تعذّر تحميل بيانات Google Sheet:", err);
      setViewState("error");
    },
  });
}

/**
 * تطبيع كل صفوف البيانات الخام وإسقاط غير الصالح فقط (id/name فارغ أو بدون سعر صالح).
 *
 * ⚠️ ملحوظة مهمة عن الأكواد (id) المكررة:
 * مشكلة الأكواد المكررة تم حلّها من جانب البيانات (Google Sheet) — فمفيش هنا أي منطق
 * قديم بيحذف أو يدمج صفوف لمجرد إن الـ id بتاعها اتكرر. كل صف صالح بييجي من الشيت
 * بيُعرض كمنتج مستقل بالكامل (بما في ذلك لو صنفين مختلفين استخدموا نفس نص الـ id).
 * للتعامل الداخلي الآمن في السلة (Cart) وربط المنتج بسعره الصح، كل منتج بياخد مفتاح
 * داخلي فريد (_key) مبني على ترتيب الصف في هذا التحميل — والمفتاح ده مش بيتعرض للعميل
 * أبداً؛ اللي بيتعرض ويترسل في واتساب هو نص الكود (id) الأصلي زي ما هو في الشيت.
 */
function processProducts(rawList) {
  try {
    const rows = Array.isArray(rawList) ? rawList : [];
    const candidates = [];

    rows.forEach((row, i) => {
      if (!row) return;
      const normRow = normalizeRowKeys(row);
      const fields = extractFields(normRow);
      const product = normalizeProductRow(fields, i);
      if (product) candidates.push(product);
    });

    PRODUCTS = candidates;
    // المفتاح الداخلي (_key) وليس id — عشان صنفين بنفس الكود ما يتلخبطوش أو يختفي حدهم
    PRODUCT_MAP = new Map(PRODUCTS.map((p) => [p._key, p]));

    buildCategoryMenu();

    if (PRODUCTS.length === 0) {
      setViewState("emptyData");
    } else {
      setViewState("ready");
      renderGrid();
    }
    renderCart();
  } catch (err) {
    console.error("خطأ غير متوقع أثناء معالجة بيانات المنتجات:", err);
    setViewState("error");
  }
}

/* =====================================================================
   3) القائمة المنسدلة للأقسام (Category Dropdown) + دعم الكيبورد
===================================================================== */
function buildCategoryMenu() {
  // عدّ الأقسام في مرور واحد بدل O(n²)
  const counts = new Map();
  PRODUCTS.forEach((p) => counts.set(p.category, (counts.get(p.category) || 0) + 1));
  const categories = ["الكل", ...counts.keys()];

  el.categoryMenu.replaceChildren();
  categories.forEach((cat) => {
    const count = cat === "الكل" ? PRODUCTS.length : counts.get(cat) || 0;
    const isActive = cat === ACTIVE_CATEGORY;

    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.dataset.category = cat;
    li.className = isActive ? "active" : "";
    li.setAttribute("aria-selected", String(isActive));

    const nameSpan = document.createElement("span");
    nameSpan.textContent = cat;
    const countSpan = document.createElement("span");
    countSpan.className = "count";
    countSpan.textContent = String(count);
    li.appendChild(nameSpan);
    li.appendChild(countSpan);

    li.addEventListener("click", () => selectCategory(cat, li));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectCategory(cat, li);
      }
    });

    el.categoryMenu.appendChild(li);
  });
}

function selectCategory(cat, liEl) {
  ACTIVE_CATEGORY = cat;
  el.categoryLabel.textContent = cat === "الكل" ? "كل الأقسام" : cat;
  [...el.categoryMenu.children].forEach((c) => {
    c.classList.remove("active");
    c.setAttribute("aria-selected", "false");
  });
  if (liEl) {
    liEl.classList.add("active");
    liEl.setAttribute("aria-selected", "true");
  }
  closeCategoryMenu();
  el.categoryToggle.focus();
  renderGrid();
}

function toggleCategoryMenu() {
  const isOpen = !el.categoryDropdown.classList.contains("open");
  el.categoryDropdown.classList.toggle("open", isOpen);
  el.categoryMenu.hidden = !isOpen;
  el.categoryToggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    const active = el.categoryMenu.querySelector("li.active") || el.categoryMenu.querySelector("li");
    if (active) active.focus();
  }
}
function closeCategoryMenu() {
  el.categoryDropdown.classList.remove("open");
  el.categoryMenu.hidden = true;
  el.categoryToggle.setAttribute("aria-expanded", "false");
}

el.categoryToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleCategoryMenu();
});
el.categoryToggle.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (el.categoryMenu.hidden) toggleCategoryMenu();
    else {
      const first = el.categoryMenu.querySelector("li");
      if (first) first.focus();
    }
  }
});
el.categoryMenu.addEventListener("keydown", (e) => {
  const items = [...el.categoryMenu.querySelectorAll("li")];
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    (items[(idx + 1 + items.length) % items.length] || items[0]).focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    (items[(idx - 1 + items.length) % items.length] || items[items.length - 1]).focus();
  } else if (e.key === "Home") {
    e.preventDefault();
    items[0].focus();
  } else if (e.key === "End") {
    e.preventDefault();
    items[items.length - 1].focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeCategoryMenu();
    el.categoryToggle.focus();
  }
});
document.addEventListener("click", (e) => {
  if (!el.categoryDropdown.contains(e.target)) closeCategoryMenu();
});

/* =====================================================================
   4) الفلترة، البحث (Debounced)، الترتيب، وعرض المنتجات
===================================================================== */
function getFilteredProducts() {
  let list = PRODUCTS;

  if (ACTIVE_CATEGORY !== "الكل") {
    list = list.filter((p) => p.category === ACTIVE_CATEGORY);
  }

  const term = SEARCH_TERM.trim().toLowerCase();
  if (term) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
    );
  }

  return sortProducts(list.slice());
}

/** قيمة مرجعية للترتيب بالسعر حتى لو الصنف بيتباع بالقطعة فقط */
function sortPriceValue(p) {
  if (typeof p.cartonPrice === "number") return p.cartonPrice;
  if (typeof p.piecePrice === "number" && p.pcsPerCarton) return p.piecePrice * p.pcsPerCarton;
  if (typeof p.piecePrice === "number") return p.piecePrice;
  return 0;
}
function sortProducts(list) {
  switch (SORT_MODE) {
    case "price-asc":
      return list.sort((a, b) => sortPriceValue(a) - sortPriceValue(b));
    case "price-desc":
      return list.sort((a, b) => sortPriceValue(b) - sortPriceValue(a));
    case "newest":
      return list.sort((a, b) => b._order - a._order);
    default:
      return list.sort((a, b) => a._order - b._order);
  }
}

/** سعر الوحدة المطلوبة، أو null لو غير صالح/غير متاح */
function unitPrice(product, unit) {
  const p = unit === "piece" ? product.piecePrice : product.cartonPrice;
  return isNonNegativeFiniteNumber(p) ? p : null;
}
function unitLabel(unit) {
  return unit === "piece" ? "قطعة" : "كرتونة";
}

/**
 * القلب الحسابي الموحّد للموقع كله (الكارت، السلة، رسائل واتساب):
 * يحسب لسطر واحد (منتج + كمية + وحدة شراء): عدد القطع الفعلي، عدد الكراتين
 * المكافئ، وقيمة السطر — بحيث نفس الرقم يظهر في كل مكان بدون أي تعارض.
 *
 * القاعدة الثابتة: عدد الكراتين لا يظهر فيه كسور أبداً — تقريب لأعلى (CEIL) دائماً:
 *   - شراء بالقطعة: pieces = qty  |  cartons = CEIL(qty / pcsPerCarton)
 *   - شراء بالكرتونة: cartons = qty  |  pieces = qty × pcsPerCarton
 * لو pcsPerCarton غير معروف/غير صالح، القيمة المكافئة (الغير مطلوبة مباشرة من
 * العميل) بترجع null بدل ما تتحسب بصفر أو تنكسر بـ NaN/Infinity.
 */
function computeLineTotals(product, qty, unit) {
  const price = unitPrice(product, unit);
  if (price === null) return null;

  const normQty = normalizeQuantity(qty);
  const hasCartonSize = isPositiveIntegerValue(product.pcsPerCarton);

  let pieces;
  let cartons;

  if (unit === "piece") {
    pieces = normQty;
    cartons = hasCartonSize ? Math.ceil(normQty / product.pcsPerCarton) : null;
  } else {
    cartons = normQty;
    pieces = hasCartonSize ? normQty * product.pcsPerCarton : null;
  }

  return {
    qty: normQty,
    unit,
    pieces, // null = غير معروف (مش صفر) لو مفيش pcsPerCarton صالح
    cartons, // null = غير معروف — أبداً كسر، دايماً عدد صحيح لو موجود
    unitPrice: price,
    lineTotal: normQty * price,
  };
}
function isUnitPurchasable(product, unit) {
  if (!product) return false;
  if (product.availability !== "available") return false;
  return unitPrice(product, unit) !== null;
}
function formatMoney(value) {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString("en-US")} ${CONFIG.currency}`;
}

function renderGrid() {
  const list = getFilteredProducts();
  const fragment = document.createDocumentFragment();
  list.forEach((product) => fragment.appendChild(buildProductCard(product)));
  el.grid.replaceChildren(fragment);

  el.emptyState.hidden = list.length !== 0;
  el.grid.hidden = list.length === 0;
}

/** بناء كارت منتج واحد بالكامل (DOM آمن، بدون innerHTML لأي بيانات من الشيت) */
function buildProductCard(product) {
  const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
  const isAvailable = product.availability === "available";
  if (!isAvailable) node.classList.add("unavailable");

  const img = node.querySelector(".card-img");
  img.src = resolveImageSrc(product);
  img.alt = product.name;
  attachImageFallback(img);
  node.querySelector(".card-media").addEventListener("click", (e) =>
    openLightbox(resolveImageSrc(product), product.name, e.currentTarget)
  );

  node.querySelector(".qty-num").textContent = product.pcsPerCarton !== null ? String(product.pcsPerCarton) : "—";
  node.querySelector(".card-category").textContent = product.category;
  const itemIdEl = node.querySelector(".card-itemid");
  if (itemIdEl) itemIdEl.textContent = `كود: ${product.id}`;
  node.querySelector(".card-name").textContent = product.name;
  node.querySelector(".card-desc").textContent = product.description;

  const flag = node.querySelector(".avail-flag");
  if (isAvailable) {
    flag.textContent = "متوفر";
    flag.classList.add("in");
  } else {
    flag.textContent = "غير متوفر";
    flag.classList.add("out");
  }

  const unitButtons = [...node.querySelectorAll(".unit-btn")];
  const pieceBtn = unitButtons.find((b) => b.dataset.unit === "piece");
  const cartonBtn = unitButtons.find((b) => b.dataset.unit === "carton");
  const priceValue = node.querySelector(".price-value");
  const priceUnitLabel = node.querySelector(".price-unit-label");
  const lineTotalValue = node.querySelector(".line-total-value");
  const qtyInput = node.querySelector(".qty-input");
  const minusBtn = node.querySelector(".step-btn.minus");
  const plusBtn = node.querySelector(".step-btn.plus");
  const addBtn = node.querySelector(".btn-add");
  const waBtn = node.querySelector(".btn-whatsapp");

  qtyInput.max = String(CONFIG.maxQuantity);
  qtyInput.value = "1";

  const piecePurchasable = unitPrice(product, "piece") !== null;
  const cartonPurchasable = unitPrice(product, "carton") !== null;

  // تعطيل حقيقي (disabled attribute) — مش CSS بس — لو مفيش سعر صالح لهذه الوحدة
  if (!piecePurchasable) {
    pieceBtn.disabled = true;
    pieceBtn.classList.add("disabled");
    pieceBtn.setAttribute("aria-disabled", "true");
    pieceBtn.title = "الصنف ده متاح بالكرتونة فقط";
  }
  if (!cartonPurchasable) {
    cartonBtn.disabled = true;
    cartonBtn.classList.add("disabled");
    cartonBtn.setAttribute("aria-disabled", "true");
    cartonBtn.title = "الصنف ده متاح بالقطعة فقط";
  }

  let selectedUnit =
    CONFIG.defaultUnit === "piece" && piecePurchasable
      ? "piece"
      : cartonPurchasable
      ? "carton"
      : piecePurchasable
      ? "piece"
      : "carton";

  function refreshCardUI() {
    unitButtons.forEach((b) => b.classList.toggle("active", b.dataset.unit === selectedUnit));
    const price = unitPrice(product, selectedUnit);
    priceValue.textContent = price !== null ? formatMoney(price) : "—";
    priceUnitLabel.textContent = selectedUnit === "piece" ? "للقطعة" : "للكرتونة";

    const totals = computeLineTotals(product, qtyInput.value, selectedUnit);
    if (!totals) {
      lineTotalValue.textContent = "غير متاح حالياً";
      return;
    }
    // نص الإجمالي دايماً بيوضّح القيمتين المكافئتين (قطع وكراتين) مهما كانت وحدة
    // الشراء المختارة، عشان العميل يشوف بوضوح كام كرتونة هيتشحن له فعلياً.
    let equivalentText = "";
    if (selectedUnit === "piece") {
      equivalentText = totals.cartons !== null ? ` (يعادل ${totals.cartons} كرتونة)` : "";
    } else {
      equivalentText = totals.pieces !== null ? ` (${totals.pieces} قطعة)` : "";
    }
    lineTotalValue.textContent = `${formatMoney(totals.lineTotal)} — ${totals.qty} ${unitLabel(
      selectedUnit
    )}${equivalentText}`;
  }

  unitButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      selectedUnit = btn.dataset.unit;
      refreshCardUI();
    });
  });

  minusBtn.addEventListener("click", () => {
    if (minusBtn.disabled) return;
    qtyInput.value = String(normalizeQuantity(Number(qtyInput.value) - 1));
    refreshCardUI();
  });
  plusBtn.addEventListener("click", () => {
    if (plusBtn.disabled) return;
    qtyInput.value = String(normalizeQuantity(Number(qtyInput.value) + 1));
    refreshCardUI();
  });
  // أثناء الكتابة: تحديث المعاينة فقط بدون فرض تصحيح القيمة (عشان الكتابة متتقطعش)
  qtyInput.addEventListener("input", refreshCardUI);
  // عند فقد التركيز أو الإدخال النهائي: تصحيح القيمة فعلياً
  qtyInput.addEventListener("change", () => {
    qtyInput.value = String(normalizeQuantity(qtyInput.value));
    refreshCardUI();
  });

  let feedbackTimer = null;
  const addBtnOriginalText = addBtn.textContent;
  addBtn.addEventListener("click", () => {
    if (addBtn.disabled) return;
    if (!isUnitPurchasable(product, selectedUnit)) return;
    const qty = normalizeQuantity(qtyInput.value);
    qtyInput.value = String(qty);
    addToCart(product, qty, selectedUnit);

    addBtn.textContent = "تمت الإضافة ✓";
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      addBtn.textContent = addBtnOriginalText;
    }, 1200);
  });

  waBtn.addEventListener("click", () => {
    if (waBtn.disabled) return;
    if (!isUnitPurchasable(product, selectedUnit)) return;
    const qty = normalizeQuantity(qtyInput.value);
    qtyInput.value = String(qty);
    const link = buildSingleItemWhatsappLink(product, qty, selectedUnit);
    if (link) window.open(link, "_blank", "noopener");
  });

  if (!isAvailable) {
    [addBtn, waBtn, qtyInput, minusBtn, plusBtn, pieceBtn, cartonBtn].forEach((elx) => {
      elx.disabled = true;
      elx.setAttribute("aria-disabled", "true");
    });
  } else if (!piecePurchasable && !cartonPurchasable) {
    // حماية إضافية — من الناحية النظرية مينفعش يحصل لأن المنتج بدون أي سعر بيتم إسقاطه من الأساس
    [addBtn, waBtn].forEach((elx) => {
      elx.disabled = true;
      elx.setAttribute("aria-disabled", "true");
    });
  }

  refreshCardUI();
  return node;
}

/* =====================================================================
   5) سلة الطلب (بالقطعة أو بالكرتونة) — عبر PRODUCT_MAP
   المفتاح الداخلي مبني على product._key (وليس id الظاهر) عشان صنفين مختلفين
   بنفس نص الكود يفضلوا منفصلين تماماً في السلة وفي حساب السعر.
===================================================================== */
function cartKey(productKey, unit) {
  return `${productKey}::${unit}`;
}

function addToCart(product, qty, unit) {
  const key = cartKey(product._key, unit);
  const existing = CART[key];
  const newQty = normalizeQuantity((existing ? existing.qty : 0) + qty);
  // نحتفظ بنص الكود (id) وقت الإضافة أيضاً، عشان لو المنتج اتشال من الشيت لاحقاً
  // نقدر لسه نعرض للعميل كود الصنف اللي كان طلبه في سطر "غير متاح" بدل ما يختفي بلا تفسير.
  CART[key] = { productKey: product._key, id: product.id, unit, qty: newQty };
  renderCart();
  // ملحوظة: لا نفتح السلة هنا عمداً — الفتح فقط عند الضغط على زر السلة في الهيدر
}

function removeFromCart(key) {
  delete CART[key];
  renderCart();
}

/** يبني سطر سلة "غير صالح" (منتج محذوف أو سعر لم يعد متاحاً) مع زر إزالة واضح */
function buildInvalidCartLine(key, titleText, metaText) {
  const row = document.createElement("div");
  row.className = "cart-line invalid";

  const info = document.createElement("div");
  info.className = "cart-line-info";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = titleText;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = metaText;
  info.appendChild(name);
  info.appendChild(meta);

  const removeBtn = document.createElement("button");
  removeBtn.className = "cart-line-remove";
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", "إزالة");
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => removeFromCart(key));

  row.appendChild(info);
  row.appendChild(removeBtn);
  return row;
}

function renderCart() {
  const keys = Object.keys(CART);
  el.cartItems.replaceChildren();

  if (keys.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.className = "cart-empty-msg";
    emptyMsg.textContent = "لسه ما ضفتش أي أصناف للطلب";
    el.cartItems.appendChild(emptyMsg);
  }

  // ثلاث قيم منفصلة وواضحة دايماً: إجمالي القطع، إجمالي الكراتين (مقرّبة لأعلى
  // لكل سطر على حدة قبل الجمع — مش بعد جمع كل القطع مع بعض)، والإجمالي المالي.
  let totalCartons = 0;
  let totalPieces = 0;
  let totalPrice = 0;
  let totalQty = 0;
  let hasInvalid = false;

  keys.forEach((key) => {
    const line = CART[key];
    const qty = normalizeQuantity(line.qty);
    totalQty += qty;

    const product = PRODUCT_MAP.get(line.productKey);
    if (!product) {
      hasInvalid = true;
      el.cartItems.appendChild(
        buildInvalidCartLine(key, "هذا الصنف لم يعد متاحاً", `كود: ${line.id}`)
      );
      return;
    }

    const totals = computeLineTotals(product, qty, line.unit);
    if (!totals) {
      hasInvalid = true;
      el.cartItems.appendChild(
        buildInvalidCartLine(key, product.name, "السعر غير متاح حالياً لهذا الصنف — برجاء إزالته")
      );
      return;
    }

    totalPrice += totals.lineTotal;
    // كل سطر بيتحسب مكافئه بالكراتين/القطع على حدة (حسب حجم كرتونة المنتج ده
    // تحديداً) قبل الجمع — عشان منتجات بأحجام كراتين مختلفة متتخلطش مع بعض.
    if (totals.cartons !== null) totalCartons += totals.cartons;
    if (totals.pieces !== null) totalPieces += totals.pieces;

    const row = document.createElement("div");
    row.className = "cart-line";

    const img = document.createElement("img");
    img.src = resolveImageSrc(product);
    img.alt = product.name;
    img.loading = "lazy";
    img.decoding = "async";
    attachImageFallback(img);

    const info = document.createElement("div");
    info.className = "cart-line-info";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = product.name;

    const codeLine = document.createElement("div");
    codeLine.className = "meta";
    codeLine.textContent = `كود: ${product.id}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${totals.qty} ${unitLabel(line.unit)} × ${formatMoney(totals.unitPrice)} = ${formatMoney(
      totals.lineTotal
    )}`;

    const badge = document.createElement("span");
    badge.className = "unit-badge" + (line.unit === "piece" ? " piece" : "");
    if (line.unit === "piece") {
      badge.textContent =
        totals.cartons !== null ? `شراء بالقطعة (يعادل ${totals.cartons} كرتونة)` : "شراء بالقطعة";
    } else {
      badge.textContent =
        totals.pieces !== null ? `شراء بالكرتونة (${totals.pieces} قطعة)` : "شراء بالكرتونة";
    }

    info.appendChild(name);
    info.appendChild(codeLine);
    info.appendChild(meta);
    info.appendChild(badge);

    const removeBtn = document.createElement("button");
    removeBtn.className = "cart-line-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "إزالة");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeFromCart(key));

    row.appendChild(img);
    row.appendChild(info);
    row.appendChild(removeBtn);
    el.cartItems.appendChild(row);
  });

  el.cartCount.textContent = String(totalQty);
  el.cartTotalCartons.textContent = String(totalCartons);
  el.cartTotalPieces.textContent = String(totalPieces);
  el.cartTotalPrice.textContent = formatMoney(totalPrice);
  el.checkoutBtn.disabled = keys.length === 0 || hasInvalid;
  el.checkoutBtn.title = hasInvalid ? "برجاء إزالة الأصناف غير المتاحة من السلة أولاً" : "";
}

/* ---- فتح/قفل السلة + إدارة الـ Focus ---- */
function trapCartFocus(e) {
  if (e.key !== "Tab") return;
  const focusables = el.cartPanel.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const list = Array.prototype.slice.call(focusables);
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openCartPanel() {
  el.cartPanel.classList.add("open");
  el.cartPanel.setAttribute("aria-hidden", "false");
  el.cartOverlay.hidden = false;
  requestAnimationFrame(() => {
    el.cartOverlay.classList.add("show");
    el.cartClose.focus();
  });
  document.addEventListener("keydown", trapCartFocus);
}
function closeCartPanel() {
  const wasOpen = el.cartPanel.classList.contains("open");
  el.cartPanel.classList.remove("open");
  el.cartPanel.setAttribute("aria-hidden", "true");
  el.cartOverlay.classList.remove("show");
  el.cartOverlay.hidden = true;
  document.removeEventListener("keydown", trapCartFocus);
  if (wasOpen) el.cartBtn.focus();
}

/* =====================================================================
   6) بناء رسائل واتساب وإرسال الطلب
===================================================================== */
function isValidWhatsappNumber(num) {
  return typeof num === "string" && /^\d{8,15}$/.test(num.trim());
}

/** سطر تفاصيل الوحدة في واتساب: بيوضّح دايماً المكافئ بالكراتين (مقرّب لأعلى) أو بالقطع سوا */
function unitDetailLine(product, totals) {
  if (totals.unit === "piece") {
    const cartonsTxt = totals.cartons !== null ? `${totals.cartons}` : "غير معروف";
    return `الوحدة: قطعة\n   الكمية: ${totals.pieces} قطعة\n   ما يعادل: ${cartonsTxt} كرتونة`;
  }
  const piecesTxt = totals.pieces !== null ? `${totals.pieces}` : "غير معروف";
  return `الوحدة: كرتونة\n   الكمية: ${totals.cartons} كرتونة\n   ما يعادل: ${piecesTxt} قطعة`;
}

function buildSingleItemWhatsappLink(product, qty, unit) {
  if (!isValidWhatsappNumber(CONFIG.whatsappNumber)) {
    console.error("رقم واتساب غير صالح في الإعدادات (CONFIG.whatsappNumber).");
    return null;
  }
  const totals = computeLineTotals(product, qty, unit);
  if (!totals) return null;

  const msg = [
    `مرحباً ${CONFIG.storeName}، أرغب في طلب الصنف التالي:`,
    "",
    `📦 ${product.name}`,
    `كود الصنف: ${product.id}`,
    unitDetailLine(product, totals),
    `سعر ال${unitLabel(unit)}: ${formatMoney(totals.unitPrice)}`,
    `الإجمالي: ${formatMoney(totals.lineTotal)}`,
  ].join("\n");
  return `https://wa.me/${CONFIG.whatsappNumber.trim()}?text=${encodeURIComponent(msg)}`;
}

function buildCartWhatsappMessage() {
  const keys = Object.keys(CART);
  const lines = [`مرحباً ${CONFIG.storeName}، أرغب في طلب الأصناف التالية:`, ""];
  // نفس منطق renderCart بالظبط: كل سطر بيتحسب مكافئه لوحده (CEIL لكل منتج على
  // حجم كرتونته هو)، وبعدين بنجمع النتائج — مش العكس.
  let totalCartons = 0;
  let totalPieces = 0;
  let totalPrice = 0;
  let itemNumber = 0;
  let hasValid = false;

  keys.forEach((key) => {
    const line = CART[key];
    const product = PRODUCT_MAP.get(line.productKey);
    if (!product) return; // لا يُرسل أي سطر بدون منتج حقيقي مرتبط به

    const totals = computeLineTotals(product, line.qty, line.unit);
    if (!totals) return; // لا يُرسل سطر بسعر أو كمية غير صالحة

    hasValid = true;
    itemNumber += 1;
    totalPrice += totals.lineTotal;
    if (totals.cartons !== null) totalCartons += totals.cartons;
    if (totals.pieces !== null) totalPieces += totals.pieces;

    lines.push(
      `${itemNumber}. ${product.name}\n   كود الصنف: ${product.id}\n   ${unitDetailLine(
        product,
        totals
      )}\n   السعر: ${totals.qty} × ${formatMoney(totals.unitPrice)} = ${formatMoney(totals.lineTotal)}`
    );
  });

  if (!hasValid) return null; // لا يُسمح بإرسال طلب فارغ/ناقص بالكامل

  lines.push("");
  lines.push(`إجمالي عدد القطع: ${totalPieces}`);
  lines.push(`إجمالي عدد الكراتين: ${totalCartons}`);
  lines.push(`الإجمالي الكلي: ${formatMoney(totalPrice)}`);

  return lines.join("\n");
}

function sendCartToWhatsapp() {
  if (Object.keys(CART).length === 0) return;
  if (!isValidWhatsappNumber(CONFIG.whatsappNumber)) {
    console.error("رقم واتساب غير صالح في الإعدادات (CONFIG.whatsappNumber).");
    return;
  }
  const text = buildCartWhatsappMessage();
  if (!text) return;
  const link = `https://wa.me/${CONFIG.whatsappNumber.trim()}?text=${encodeURIComponent(text)}`;
  window.open(link, "_blank", "noopener");
}

/* =====================================================================
   7) تكبير الصورة (Lightbox) + إدارة الـ Focus
===================================================================== */
function openLightbox(imgUrl, caption, triggerEl) {
  lightboxTrigger = triggerEl || document.activeElement;
  delete el.lightboxImg.dataset.fallbackApplied; // إعادة ضبط حالة الـ fallback لصورة جديدة
  el.lightboxImg.src = imgUrl;
  el.lightboxImg.alt = caption;
  el.lightbox.hidden = false;
  requestAnimationFrame(() => el.lightboxClose.focus());
}
function closeLightbox() {
  const wasOpen = !el.lightbox.hidden;
  el.lightbox.hidden = true;
  if (wasOpen && lightboxTrigger && typeof lightboxTrigger.focus === "function") {
    lightboxTrigger.focus();
  }
  lightboxTrigger = null;
}

/* =====================================================================
   8) ربط الأحداث (Event Listeners)
===================================================================== */
el.searchInput.addEventListener("input", (e) => {
  const value = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    SEARCH_TERM = value;
    renderGrid();
  }, 200);
});

el.sortSelect.addEventListener("change", (e) => {
  SORT_MODE = e.target.value;
  renderGrid();
});

el.resetFilters.addEventListener("click", () => {
  SEARCH_TERM = "";
  ACTIVE_CATEGORY = "الكل";
  SORT_MODE = "default";
  el.searchInput.value = "";
  el.sortSelect.value = "default";
  el.categoryLabel.textContent = "كل الأقسام";
  buildCategoryMenu();
  renderGrid();
});

if (el.retryLoadBtn) el.retryLoadBtn.addEventListener("click", () => init());

el.cartBtn.addEventListener("click", openCartPanel);
el.cartClose.addEventListener("click", closeCartPanel);
el.cartOverlay.addEventListener("click", closeCartPanel);
el.checkoutBtn.addEventListener("click", sendCartToWhatsapp);

el.lightboxClose.addEventListener("click", closeLightbox);
el.lightbox.addEventListener("click", (e) => {
  if (e.target === el.lightbox) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el.lightbox.hidden) closeLightbox();
  if (el.cartPanel.classList.contains("open")) closeCartPanel();
  if (el.categoryDropdown.classList.contains("open")) {
    closeCategoryMenu();
    el.categoryToggle.focus();
  }
});

/* =====================================================================
   تشغيل الموقع
===================================================================== */
init();
