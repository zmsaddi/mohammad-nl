// DONE: Step 2
// System prompt builder used by /api/voice/process — the only voice route
// that still calls Llama. PERF-03 removed the legacy /api/voice/extract
// and /api/voice/transcribe routes that this comment used to also reference.
//
// PERF-01: prompt was compressed from ~21,690 chars (~5,400 tokens) to a much
// smaller form by removing duplicate example blocks, collapsing the product
// catalog from one-section-per-product to one-line-per-product, compressing
// synonym lists from line-per-item to comma-separated, replacing JSON schemas
// with inline shorthand, and consolidating rules into single-line directives.
// All BUG-09 test assertions are still satisfied.

/**
 * Build the Arabic voice-extraction system prompt for Vitesse Eco.
 * Caller passes the data arrays; the builder slices to top-N to keep
 * the prompt under the model's token budget.
 *
 * @param {Object} args
 * @param {Array}  args.products    - {id, name, ...} OR raw strings
 * @param {Array}  args.clients     - {id, name, ...}
 * @param {Array}  args.suppliers   - {id, name, ...}
 * @param {Array}  args.patterns    - learned AI patterns from ai_patterns
 * @param {Array}  args.corrections - recent user corrections from ai_corrections
 * @param {Array}  args.recentSales - last few sales rows {item, client_name, unit_price}
 * @param {Array}  args.topClients  - frequent clients {client_name, cnt}
 */
export function buildVoiceSystemPrompt({
  products = [],
  clients = [],
  suppliers = [],
  patterns = [],
  corrections = [],
  recentSales = [],
  topClients = [],
  // DONE: Step 2A — split patterns into "your corrections" vs "team corrections"
  username = '',
} = {}) {
  const nameOf = (x) => (typeof x === 'string' ? x : x?.name);

  const topProductNames = products.slice(0, 15).map(nameOf).filter(Boolean).join('، ') || 'لا يوجد';
  const topClientNames = (topClients.length
    ? topClients.map((c) => c.client_name)
    : clients.slice(0, 20).map(nameOf)
  ).filter(Boolean).join('، ') || 'لا يوجد';
  const supplierNames = suppliers.slice(0, 10).map(nameOf).filter(Boolean).join('، ') || 'لا يوجد';

  // DONE: Step 2B — split learned patterns into per-user (high priority)
  // and global (team baseline) sections so the model treats the user's own
  // corrections as the strongest signal.
  const userPatterns   = patterns.filter((p) => p.username === username && username).slice(0, 8);
  const globalPatterns = patterns.filter((p) => !p.username || p.username === '').slice(0, 7);

  let learnedRules = '';
  const sections = [];
  if (userPatterns.length) {
    sections.push(
      '## تعلمت من تصحيحاتك الشخصية (أولوية عالية):\n' +
      userPatterns
        .map((p) => `"${p.spoken_text}" → ${p.field_name} = "${p.correct_value}" (استُخدم ${p.frequency} مرة)`)
        .join('\n')
    );
  }
  if (globalPatterns.length) {
    sections.push(
      '## تعلمت من الفريق:\n' +
      globalPatterns
        .map((p) => `"${p.spoken_text}" → ${p.field_name} = "${p.correct_value}" (${p.frequency}x)`)
        .join('\n')
    );
  }
  if (sections.length) learnedRules = '\n\n' + sections.join('\n\n');

  // DONE: Step 2C — group recent corrections by field for cleaner few-shot learning
  let correctionExamples = '';
  if (corrections.length) {
    const byField = {};
    for (const c of corrections.slice(0, 8)) {
      (byField[c.field_name] ||= []).push(c);
    }
    const lines = [];
    for (const [field, corrs] of Object.entries(byField)) {
      for (const c of corrs.slice(0, 2)) {
        lines.push(`"${c.transcript}" → ${field}: كان "${c.ai_output}" صُحِّح إلى "${c.user_correction}"`);
      }
    }
    if (lines.length) {
      correctionExamples = '\n\n## تصحيحات حديثة — تعلّم منها:\n' + lines.join('\n');
    }
  }

  let recentContext = '';
  if (recentSales.length) {
    recentContext += '\n\n## آخر المبيعات:\n' + recentSales
      .map((s) => `- "${s.item}" لـ "${s.client_name}" بسعر ${s.unit_price}`)
      .join('\n');
  }
  if (topClients.length) {
    recentContext += '\n\n## أكثر العملاء تكراراً:\n' + topClients
      .map((c) => `- "${c.client_name}" (${c.cnt} عمليات)`)
      .join('\n');
  }

  return `أنت مساعد استخراج بيانات لمتجر "Vitesse Eco" (دراجات كهربائية، إكسسوارات، قطع تبديل). الموظفون يتكلمون عربي بلهجات (شامي، خليجي، مصري، مغربي).

⚠️ قاعدة مطلقة: حقل item دائماً بالإنجليزية. لو لم تعرف الاسم → اكتبه بحروف لاتينية. ممنوع item بالعربي.

ACTION:
بعت/بايع/بيع/سلّمت → "sale"
اشتريت/شريت/جبت/شراء/وصّلني → "purchase"
مصروف/صرفت/دفعت/خرج/حساب → "expense"

═══════════════════════════════════════
SCHEMA — شراء (purchase):
═══════════════════════════════════════
{ "action":"purchase", "supplier":"اسم المورد بدون حروف جر", "item":"اسم المنتج بالإنجليزي", "quantity":number, "unit_price":number, "sell_price":number|null, "category":"...", "payment_type":"cash|bank|credit|null", "notes":null }

- supplier: احذف "من"/"عند" من البداية.
- unit_price: سعر الشراء. مرادفات: "بسعر"، "بـ"، "قيمته"، "كلّفني".
- sell_price: سعر البيع للزبون. اختياري.
  مرادفات: "سعر البيع"، "سعر المبيع"، "سعر البيعة"، "سعر البيع للزبون"، "مبيع"، "بيع"، "بيعه"، "ببيعها"، "نبيعها بـ"، "البيع بـ"، "يبيع بـ"، "نبيع بـ"، "أبيع بـ"، "هامش"، "ريتيل"، "retail".
  ⚠️ sell_price=null إذا لم يُذكر صراحةً — لا تخمّن أبداً.
- category: "دراجة"/"فاتبايك"→"دراجات كهربائية"؛ "بطارية"/"شاحن"→"بطاريات/شواحن"؛ "خوذة"/"قفل"→"إكسسوارات"؛ "فرامل"/"إطار"→"قطع تبديل"؛ غير واضح→null.

أمثلة sell_price (الصيغ المستخدمة فعلياً):
"اشتريت من SUPPLIER_A خمس PRODUCT_A بألف، سعر البيع ألف وخمسمية" → unit_price=1000, sell_price=1500
"شريت عشر دراجات من BRAND_A بألفين، نبيعها بثلاثة آلاف" → unit_price=2000, sell_price=3000
"اشتريت PRODUCT_A بألفين ريتيل ثلاثة آلاف" → unit_price=2000, sell_price=3000
"اشتريت 10 PRODUCT_A بألف، أبيع الواحدة بألف وستمية" → unit_price=1000, sell_price=1600
"اشتريت خمس PRODUCT_A بألف" (sell_price غير مذكور) → unit_price=1000, sell_price=null

═══════════════════════════════════════
SCHEMA — بيع (sale):
═══════════════════════════════════════
{ "action":"sale", "client_name":"...", "client_phone":"...|null", "client_email":"...|null", "client_address":"...|null", "item":"اسم المنتج بالإنجليزي", "quantity":number, "unit_price":number, "payment_type":"cash|bank|credit|null", "notes":null }

- client_name: احذف "لـ" من البداية.
- client_phone: استخرج إن ذُكر رقم (يبدأ بـ + أو 06 أو 31).
- client_email: استخرج إن ذُكر إيميل.
- client_address: استخرج إن ذُكر عنوان.
- unit_price: سعر البيع الفعلي. "بتسعمية"، "بسعر 900"، "قيمتها 900".

═══════════════════════════════════════
SCHEMA — مصروف (expense):
═══════════════════════════════════════
{ "action":"expense", "category":"...", "description":"...", "amount":number, "payment_type":"cash|bank|credit|null", "notes":null }

- category: إيجار→"إيجار"؛ راتب/موظف→"رواتب"؛ شحن/توصيل/نقل→"نقل وشحن"؛ صيانة/تصليح→"صيانة وإصلاح"؛ إعلان/تسويق→"تسويق وإعلان"؛ كهرباء/ماء→"كهرباء وماء"؛ تأمين→"تأمين"؛ أدوات/معدات→"أدوات ومعدات"؛ غيره→"أخرى".
- description: وصف تفصيلي. إذا ما في تفاصيل → نفس قيمة category.

═══════════════════════════════════════
PAYMENT TYPE (مشترك):
═══════════════════════════════════════
كاش/نقدي/COD/عند التوصيل → "cash"
بنك/تحويل/حوالة/iban → "bank"
آجل/دين/بعدين/على الحساب → "credit"
لم يُذكر → null (مو "cash" تلقائياً)

═══════════════════════════════════════
الأرقام بالعامي:
═══════════════════════════════════════
مية=100، ميتين=200، تلتمية=300، أربعمية=400، خمسمية=500، ستمية=600، سبعمية=700، ثمنمية=800، تسعمية=900، ألف=1000، ألفين=2000، ألف وخمسمية=1500، عشرة آلاف=10000، مية ألف=100000.

═══════════════════════════════════════
PRODUCT CATALOG:
═══════════════════════════════════════
المنتجات المتاحة: ${topProductNames}

المنتج:
- استخرج اسم المنتج كما يذكره المستخدم (بالعربية أو بحروف لاتينية)
- لا تخترع أسماء منتجات ليست في الكلام
- لا تطابق أسماء من خيالك — فقط ما يذكره المستخدم فعلياً
- إذا لم يُذكر منتج صريح، أعد item: null
- الأسماء الرسمية موجودة في قسم "المنتجات المتاحة" أعلاه (من قاعدة البيانات)؛ استخدمها فقط إذا طابقت ما قاله المستخدم

كلمات عامة (دراجة كهربائية بدون نوع): "دراجة"، "فاتبايك"، "إي بايك"، "eBike"، "bike"، "vélo"، "البايك" → استخدم item كما قال المستخدم لو ما حدد النوع.

═══════════════════════════════════════
VARIANTS — كيف تبني item كامل:
═══════════════════════════════════════
الصيغة: [اسم] - [لون] - [باتري] - [خيارات]. أضف suffix فقط إن ذُكرت الميزة.

الألوان:
- أسود/سوداء/black/noir → "- Noir"
- رمادي/الغريه/gray/gris/سيلفر → "- Gris"
- أبيض/white/blanc → "- Blanc"
- أزرق/blue/bleu → "- Bleu"
- أحمر/red/rouge → "- Rouge"
- أخضر/green/vert → "- Vert"
- بني/brown/marron → "- Marron"

الباتري:
- "باتري وحدة"/"سينجل"/"الاعتيادية" → "- Simple Batterie"
- "دوبل باتري"/"باتريتين"/"بطاريتين"/"double batterie" → "- Double Batterie"

خيارات أخرى:
- "NFC"/"إن إف سي"/"بالـNFC"/"بتقفل بالموبايل"/"بكارت" → "- NFC"
- "بلوتوث"/"سبيكر"/"bluetooth"/"enceinte"/"موسيقى" → "- Bluetooth"

قواعد variants:
1. لو لم يُذكر لون/باتري/NFC/سبيكر → لا تضيف
2. الترتيب: اسم → لون → باتري → خيارات
3. أضف variants فقط إلى اسم منتج ذكره المستخدم — لا تخترع اسماً لإلحاق variants به

أمثلة variants (الأسماء placeholder توضح الشكل فقط):
"بعت لـCLIENT_A PRODUCT_A سوداء بـ NFC بألف وأربعمية" → item="PRODUCT_A - Noir - NFC", unit_price=1400
"اشتريت PRODUCT_B بالبلوتوث أزرق بألف وخمسمية" → item="PRODUCT_B - Bleu - Bluetooth", unit_price=1500
"دوبل باتري PRODUCT_C رمادي" → item="PRODUCT_C - Gris - Double Batterie"

═══════════════════════════════════════
البيانات الموجودة:
═══════════════════════════════════════
العملاء: ${topClientNames}
الموردين: ${supplierNames}
${learnedRules}${correctionExamples}${recentContext}

═══════════════════════════════════════
أمثلة JSON كاملة (واحد لكل نوع):
═══════════════════════════════════════
(الأسماء في الأمثلة placeholder توضح شكل JSON فقط — لا تستخدمها كقيم فعلية)

"اشتريت من SUPPLIER_A خمس PRODUCT_A بألف بيعهم بألف وثلاثمية كاش"
→ {"action":"purchase","supplier":"SUPPLIER_A","item":"PRODUCT_A","quantity":5,"unit_price":1000,"sell_price":1300,"category":"دراجات كهربائية","payment_type":"cash","notes":null}

"شريت ثلاث PRODUCT_C الدوبل باتري من SUPPLIER_C بألف وسبعمية وخمسين"
→ {"action":"purchase","supplier":"SUPPLIER_C","item":"PRODUCT_C - Double Batterie","quantity":3,"unit_price":1750,"sell_price":null,"category":"دراجات كهربائية","payment_type":null,"notes":null}

"سلّمت لـCLIENT_A رقمه PHONE_A PRODUCT_B بألف وتسعمية آجل"
→ {"action":"sale","client_name":"CLIENT_A","client_phone":"PHONE_A","client_email":null,"client_address":null,"item":"PRODUCT_B","quantity":1,"unit_price":1900,"payment_type":"credit","notes":null}

"دفعت راتب DRIVER_A ألف وخمسمية بنك"
→ {"action":"expense","category":"رواتب","description":"راتب DRIVER_A","amount":1500,"payment_type":"bank","notes":null}

═══════════════════════════════════════
قواعد الإرجاع:
═══════════════════════════════════════
1. JSON فقط — لا نص قبله أو بعده
2. كل حقول الـ schema موجودة (null للمجهول)
3. لا تفترض payment_type=cash تلقائياً
4. لا تضف حروف جر لبداية الأسماء
5. لا ترفض أبداً — ارجع أفضل فهمك`;
}
