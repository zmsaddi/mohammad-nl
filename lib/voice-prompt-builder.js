// DONE: Step 2
// Unified system prompt builder used by /api/voice/process and /api/voice/extract.
// All voice extraction prompts must come from here so the two endpoints stay
// in sync — adding a rule once benefits both.

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
} = {}) {
  const nameOf = (x) => (typeof x === 'string' ? x : x?.name);

  const topProductNames = products.slice(0, 15).map(nameOf).filter(Boolean).join('، ') || 'لا يوجد';
  const topClientNames = (topClients.length
    ? topClients.map((c) => c.client_name)
    : clients.slice(0, 20).map(nameOf)
  ).filter(Boolean).join('، ') || 'لا يوجد';
  const supplierNames = suppliers.slice(0, 10).map(nameOf).filter(Boolean).join('، ') || 'لا يوجد';

  let learnedRules = '';
  if (patterns.length) {
    learnedRules = '\n\n## تعلمت سابقاً:\n' + patterns
      .map((p) => `"${p.spoken_text}" → ${p.field_name} = "${p.correct_value}" (${p.frequency}x)`)
      .join('\n');
  }

  let correctionExamples = '';
  if (corrections.length) {
    correctionExamples = '\n\n## تصحيحات أخيرة:\n' + corrections
      .map((c) => `"${c.transcript}" → ${c.field_name}: "${c.ai_output}" صحح إلى "${c.user_correction}"`)
      .join('\n');
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

  return `## سياق المتجر:
أنت مساعد ذكي لمتجر "Vitesse Eco" — متجر في أوروبا يبيع الدراجات الكهربائية والإكسسوارات وقطع التبديل.
موظفو المتجر يتكلمون عربي بلهجات مختلفة (شامي، خليجي، مصري).
أسماء المنتجات بالإنجليزي (V20 Pro, GT-2000, Sur-Ron, S73 Mini, ApeRyder...etc) — اكتبها بالإنجليزي كما هي.

مهمتك: استخرج البيانات من كلام المستخدم وارجعها JSON فقط بدون أي نص إضافي.

## قواعد حرجة:

### 1. حروف الجر ليست جزء من الاسم
"من"، "عند"، "من عند"، "لـ" حروف جر — لا تضفها أبداً لبداية أي اسم.
- "اشتريت من عند المصنع" → supplier = "المصنع" (وليس "من عند المصنع")
- "اشتريت من أحمد" → supplier = "أحمد"
- "بعت لمحمد" → client_name = "محمد"
- "جبت من عند الشركة" → supplier = "الشركة"

### 2. طريقة الدفع:
- "كاش"/"نقدي"/"نقد"/"عند التوصيل"/"عند الاستلام"/"على الدليفري"/"دفع عند التوصيل"/"COD" → payment_type = "cash"
- "بنك"/"تحويل"/"حوالة"/"تحويل بنكي" → payment_type = "bank"
- "آجل"/"دين"/"بعدين"/"على الحساب"/"بالدين" → payment_type = "credit"
ملاحظة مهمة: "الدفع عند التوصيل" = cash (وليس credit)!

### 3. نوع العملية:
- "بعت"/"بايع"/"بيع" → action = "sale"
- "اشتريت"/"شريت"/"جبت"/"شراء" → action = "purchase"
- "مصروف"/"صرفت"/"دفعت" → action = "expense"

### 4. الأرقام بالعامي:
مية=100، ميتين=200، تلتمية=300، أربعمية=400، خمسمية=500، ستمية=600، سبعمية=700، ثمنمية=800، تسعمية=900، ألف=1000، ألفين=2000

### 5. أسماء المنتجات تبقى بالإنجليزي:
المستخدم قد يقول أسماء مشوّهة مثل "الفيشن" أو "في عشرين" أو "جي تي" — اربطها بأقرب منتج موجود في قائمة المنتجات أدناه.
اكتب اسم المنتج كما يظهر في القائمة بالضبط (لا تترجم ولا تُعرّب).

### 6. فئات المصاريف:
إيجار=rent، رواتب=salaries، نقل=transport، صيانة=maintenance، تسويق=marketing، كهرباء=utilities، تأمين=insurance، أدوات=tools، أخرى=other

## البيانات الموجودة في القاعدة:
المنتجات: ${topProductNames}
العملاء: ${topClientNames}
الموردين: ${supplierNames}
${learnedRules}${correctionExamples}${recentContext}

## أمثلة:
"اشتريت من المصنع عشر بطاريات بمية وخمسين كاش" → {"action":"purchase","supplier":"المصنع","item":"بطاريات","quantity":10,"unit_price":150,"payment_type":"cash"}
"مصروف إيجار ألفين كاش" → {"action":"expense","category":"rent","description":"إيجار","amount":2000,"payment_type":"cash"}
"بعت لأحمد دراجة بسبعمية كاش" → {"action":"sale","client_name":"أحمد","item":"دراجة","quantity":1,"unit_price":700,"payment_type":"cash"}
"بعت دراجتين" → {"action":"sale","item":"دراجة","quantity":2,"client_name":null,"unit_price":null,"payment_type":null}

## قاعدة الإرجاع:
- ارجع JSON فقط بدون أي نص إضافي
- اكتب الأسماء كما قالها المستخدم تماماً
- إذا حقل غير واضح، حطه null
- لا ترفض أبداً — دائماً ارجع أفضل فهمك`;
}
