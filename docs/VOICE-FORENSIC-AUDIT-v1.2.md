# تدقيق جنائي صارم — النظام الصوتي v1.2

**التاريخ:** 2026-04-16
**المنهجية:** تحقق مباشر من الكود — لم يُعتمد على التقرير السابق
**النتيجة:** 15 عيب مؤكد (3 عالي، 7 متوسط، 5 منخفض، 0 حرج)

---

## الحكم

النظام الصوتي **يعمل فعلاً** ولا توجد أعطال حرجة تمنع الإنتاج. لكن ثلاثة عيوب عالية الخطورة تتعلق بـ**تسلسل التعلم** تحتاج إصلاحاً قبل الاعتماد الكامل — وإلا يمكن أن تتلوث بيانات التعلم الذاتي بشكل دائم من عمليات فاشلة.

---

## سجل العيوب المؤكدة

### DEFECT-001: عدم التحقق من نوع MIME للملف المرفوع
- **Severity:** Medium
- **Category:** security
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js`
- **Function/Route:** `POST /api/voice/process`
- **Evidence:** السطر 56 يتحقق فقط من وجود الملف والسطر 60 من الحجم. لا يوجد تحقق من `audioFile.type`. السطر 66 يُعيد تسمية الملف كـ `audio.webm` مهما كان نوعه.
- **Failure Scenario:** ملف PDF أو صورة يُرسل كـ FormData باسم `audio` → يُمرر مباشرة إلى Groq Whisper.
- **Impact:** استهلاك غير ضروري لـ Groq quota + استجابات غير متوقعة.
- **Fix:** إضافة `if (!audioFile.type?.startsWith('audio/')) return 400`.
- **Confidence:** High

---

### DEFECT-002: حقل voice_logs.action_id لا يُحدَّث أبداً
- **Severity:** Medium
- **Category:** data-integrity
- **Status:** Confirmed
- **File:** `lib/db/_migrations.js` + `app/api/voice/process/route.js`
- **Evidence:** الجدول يحتوي عمود `action_id INTEGER` لكن لا يوجد أي كود في المشروع يحدّث هذا الحقل بعد إنشاء العملية. كل السجلات تبقى `NULL`.
- **Failure Scenario:** لا يمكن ربط تسجيل صوتي بالعملية المحاسبية الناتجة عنه.
- **Impact:** فقدان القدرة على التدقيق (audit trail مكسور).
- **Fix:** بعد نجاح الحفظ في VoiceConfirm، استدعاء endpoint يحدّث `voice_logs SET action_id`.
- **Confidence:** High

---

### DEFECT-003: البائع (seller) يحفظ تعلم خاطئ من عمليات مرفوضة
- **Severity:** High
- **Category:** security / learning
- **Status:** Confirmed
- **File:** `components/VoiceConfirm.js` (سطر 114-121) + `app/api/purchases/route.js` (سطر 20)
- **Evidence:** الـ voice/process يقبل seller. إذا قال "اشتريت..."، يظهر نموذج شراء. عند التأكيد:
  1. `/api/voice/learn` يُستدعى أولاً (سطر 114) → **ينجح**
  2. `/api/purchases` POST يُرفض بـ 403 (seller غير مسموح)
  3. لكن ai_corrections + ai_patterns حُفظت من عملية فاشلة
- **Impact:** تلوث دائم لبيانات التعلم.
- **Fix:** 1) فلترة أنواع العمليات حسب صلاحيات المستخدم في VoiceConfirm. 2) نقل learn بعد نجاح الحفظ.
- **Confidence:** High

---

### DEFECT-004: Fire-and-forget للتعلم قبل الحفظ الرئيسي
- **Severity:** High
- **Category:** data-integrity / learning
- **Status:** Confirmed
- **File:** `components/VoiceConfirm.js` (سطر 114-121 vs 172)
- **Evidence:** `/api/voice/learn` يُستدعى في سطر 114 **قبل** الحفظ الرئيسي (سطر 172). ملفوف بـ `try/catch` فارغ. تعليق الكود: `// Don't block save`.
- **Failure Scenario:**
  1. مستخدم يؤكد بيع بسعر خاطئ
  2. learn ينجح → يحفظ السعر الخاطئ كـ pattern
  3. sales API يفشل (مخزون غير كافٍ مثلاً)
  4. Pattern الخاطئ يبقى → يلوث كل الاستخراجات المستقبلية
- **Impact:** تلوث دائم لبيانات التعلم من عمليات فاشلة.
- **Fix:** نقل استدعاء `/api/voice/learn` ليكون **بعد** `await onConfirm()` في نفس الـ try block.
- **Confidence:** High

---

### DEFECT-005: غياب حماية الإرسال المتكرر (idempotency)
- **Severity:** Medium
- **Category:** data-integrity
- **Status:** Confirmed
- **File:** `components/VoiceConfirm.js` (سطر 63-64, 179)
- **Evidence:** `if (saving) return` يحمي من الضغط المزدوج. لكن `setSaving(false)` في `finally` يسمح بإعادة المحاولة بعد timeout أو فشل شبكة. لا يوجد idempotency token أو server-side duplicate detection.
- **Failure Scenario:** شبكة بطيئة → مستخدم يضغط مرتين → عمليتان محاسبيتان متطابقتان.
- **Impact:** عمليات مكررة + مخزون خاطئ.
- **Fix:** توليد `voiceRequestId` فريد عند وصول نتيجة الصوت. إرساله مع الطلب. فحص التكرار server-side.
- **Confidence:** High

---

### DEFECT-006: تلوث Alias دائم من fire-and-forget قبل تأكيد المستخدم
- **Severity:** High
- **Category:** entity-resolution / learning
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js` (سطر 382-416) + `lib/db.js` (addAlias)
- **Evidence:** الـ fire-and-forget IIFE في route.js تكتب aliases بناءً على نتيجة entity resolution **الآلية** — قبل أن يؤكد المستخدم. `addAlias` يستبدل `entity_id` في alias موجود (NEWEST-WRITER-WINS). إذا كان الحل الآلي خاطئاً، يُكتب alias يربط الاسم بالكيان الخطأ.
- **Failure Scenario:**
  1. Entity resolver يختار "محمد" → id=5 (fuzzy match خاطئ)
  2. Fire-and-forget يكتب alias("محمد" → 5)
  3. المستخدم لا ينتبه ويقبل
  4. كل الطلبات المستقبلية التي تذكر "محمد" تتجه لـ id=5 عبر Layer 0
- **Impact:** تلوث دائم لـ entity resolution. يؤثر على كل العمليات المستقبلية.
- **Fix:** عدم كتابة aliases في الـ fire-and-forget IIFE. نقل كتابة Aliases إلى `/api/voice/learn` بعد تأكيد المستخدم.
- **Confidence:** High

---

### DEFECT-007: Rate limiter في الذاكرة فقط
- **Severity:** Low
- **Category:** security
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js` (سطر 22-40)
- **Evidence:** `voiceRateLimit = new Map()` — يُفقد عند Cold Start. مع عدة instances، الحد يتضاعف.
- **Impact:** حماية ضعيفة ضد الهجمات المتقدمة. مقبول للحمل الحالي.
- **Fix:** الانتقال إلى `@vercel/kv` عند الحاجة.
- **Confidence:** High

---

### DEFECT-008: عدم التحقق من payment_type قبل الإرسال
- **Severity:** Low
- **Category:** accounting-integration
- **Status:** Confirmed
- **File:** `components/VoiceConfirm.js` (سطر 144, 156, 164)
- **Evidence:** `paymentType = form.payment_type || 'كاش'` بدون التحقق أن القيمة من القائمة المسموحة. LLM قد يُعيد قيمة غريبة تتجاوز `PAYMENT_MAP`. الحماية الخلفية في `addSale` تعيد القيمة لـ 'كاش' كـ fallback.
- **Impact:** محدود — الحماية الخلفية موجودة. لكن `addPurchase` لا يتحقق.
- **Fix:** إضافة whitelist validation في VoiceConfirm.
- **Confidence:** Medium

---

### DEFECT-009: فحص sell_price >= buy_price غير مكتمل للمشتريات
- **Severity:** Medium
- **Category:** accounting-integration
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js` (سطر 344-362) + `components/VoiceConfirm.js` (سطر 95-102)
- **Evidence:** في route.js، فحص BUG-30 يعمل فقط على `register_sale`. VoiceConfirm يتحقق مع alert gate لكن فقط عندما الحقلين > 0.
- **Impact:** محدود — الحماية البصرية موجودة في VoiceConfirm لكن route.js لا يضيف amber warning للمشتريات.
- **Fix:** إضافة BUG-30 mirror في route.js للمشتريات.
- **Confidence:** Medium

---

### DEFECT-010: normalizeArabicText يدمر أسماء عملاء تحتوي مفردات المنتجات
- **Severity:** Medium
- **Category:** extraction
- **Status:** Confirmed
- **File:** `lib/voice-normalizer.js` (سطر 351-374)
- **Evidence:** `transliterateArabicToLatin` يستبدل كلمات مثل "أسود" → "Noir"، "كاسك" → "Casque" بدون حدود كلمة (substring match). تُطبَّق على **كامل** النص قبل إرساله للـ LLM.
- **Failure Scenario:** عميل "أسود الدين" → "Noir الDن" → LLM يفشل في استخراج اسم العميل.
- **Impact:** فشل استخراج أسماء عملاء تتطابق مع vocabulary الترجمة.
- **Fix:** تطبيق `arabicSafeBoundary` على **كل** المداخل أو تشغيل الترجمة فقط بعد استخراج الحقول.
- **Confidence:** Medium

---

### DEFECT-011: إنشاء كيانات جديدة بدون تحقق كافٍ + أخطاء صامتة
- **Severity:** Medium
- **Category:** data-integrity
- **Status:** Confirmed
- **File:** `components/VoiceConfirm.js` (سطر 123-131)
- **Evidence:** إنشاء عميل/مورد/منتج يحدث **قبل** البيع الرئيسي. `.catch(() => {})` يبتلع كل الأخطاء صامتاً. لا تحقق من التكرار.
- **Impact:** إنشاء كيانات مكررة أو فشل صامت.
- **Fix:** التحقق من الوجود قبل الإنشاء + عدم ابتلاع الأخطاء.
- **Confidence:** Medium

---

### DEFECT-012: استعلامات قاعدة بيانات مكررة بالتوازي
- **Severity:** Low
- **Category:** api
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js` (سطر 68-161)
- **Evidence:** `Promise.all` يستدعي `getProducts()`, `getClients()`, `getSuppliers()` مرتين — مرة للسياق ومرة للـ entity resolution.
- **Impact:** 6 استعلامات بدلاً من 3 لكل طلب صوتي.
- **Fix:** مشاركة النتائج بين الوظيفتين.
- **Confidence:** High

---

### DEFECT-013: Hallucination جزئية تتجاوز القائمة السوداء
- **Severity:** Medium
- **Category:** transcription
- **Status:** Confirmed
- **File:** `lib/voice-blacklist.js` (سطر 62-68)
- **Evidence:** `isBlacklisted` يبحث عن عبارات كاملة بالضبط. Whisper قد يُنتج اختلافات: "اشترك بالقناة" بدلاً من "اشتركوا في القناة"، "لا تنسى الاشتراك" بدلاً من "لا تنسوا الاشتراك". الطبقة الثانية (soft warning) لا ترفض.
- **Impact:** hallucinations معدّلة قد تصل للـ LLM.
- **Fix:** إضافة fuzzy matching للعبارات المحظورة (Levenshtein distance < 3).
- **Confidence:** Medium

---

### DEFECT-014: Race condition في entity_aliases بدون transaction
- **Severity:** Low
- **Category:** data-integrity
- **Status:** Confirmed
- **File:** `lib/db.js` (addAlias: SELECT → UPDATE/INSERT بدون transaction)
- **Evidence:** TOCTOU race: طلبان متزامنان → كلاهما يجد `existing.length === 0` → كلاهما INSERT → صف مكرر (لا يوجد UNIQUE constraint على normalized_alias).
- **Impact:** صفوف مكررة — التأثير العملي محدود لأن البحث يُعيد الأول.
- **Fix:** UNIQUE constraint + `INSERT ... ON CONFLICT DO UPDATE`.
- **Confidence:** Medium

---

### DEFECT-015: GROQ_API_KEY غير موثق في .env.example
- **Severity:** Low
- **Category:** security
- **Status:** Confirmed
- **File:** `.env.example`
- **Evidence:** بحث عن `GROQ` في الملف — لا توجد نتائج.
- **Impact:** مطور جديد لن يعرف أن المتغير مطلوب.
- **Fix:** إضافة `GROQ_API_KEY=` مع تعليق.
- **Confidence:** High

---

## خطة الإصلاح ذات الأولوية

### فوري (قبل الاعتماد على التعلم الذاتي)

| # | العيب | الإصلاح |
|---|-------|---------|
| 1 | DEFECT-004 | نقل `/api/voice/learn` ليكون **بعد** نجاح الحفظ الرئيسي |
| 2 | DEFECT-006 | إزالة كتابة aliases من fire-and-forget IIFE في route.js |
| 3 | DEFECT-003 | فلترة أنواع العمليات في VoiceConfirm حسب صلاحيات المستخدم |

### قصير المدى (أسبوع)

| # | العيب | الإصلاح |
|---|-------|---------|
| 4 | DEFECT-005 | إضافة idempotency token لمنع الإرسال المتكرر |
| 5 | DEFECT-002 | تحديث voice_logs.action_id بعد إنشاء العملية |
| 6 | DEFECT-001 | تحقق MIME type عند الرفع |
| 7 | DEFECT-011 | تحقق وجود الكيان قبل الإنشاء + عدم ابتلاع الأخطاء |

### متوسط المدى (شهر)

| # | العيب | الإصلاح |
|---|-------|---------|
| 8 | DEFECT-010 | تطبيق arabicSafeBoundary على كل vocabulary الترجمة |
| 9 | DEFECT-013 | fuzzy matching للعبارات المحظورة |
| 10 | DEFECT-014 | UNIQUE constraint + ON CONFLICT على entity_aliases |
| 11 | DEFECT-012 | مشاركة نتائج الاستعلامات المكررة |
| 12 | DEFECT-015 | توثيق GROQ_API_KEY في .env.example |

---

## الحكم النهائي

**هل النظام الصوتي صالح للإنتاج؟**
نعم — بشرط إصلاح العيوب الثلاثة الأولى (DEFECT-003, 004, 006). بدون إصلاحها، كل تصحيح فاشل يلوث بيانات التعلم بشكل لا رجعة فيه.

**هل يمكن أن يولّد عمليات تجارية خاطئة؟**
الـ VoiceConfirm يُعرض دائماً قبل الحفظ (لا يوجد حفظ تلقائي). المستخدم يراجع كل الحقول. الخطر الحقيقي ليس في العملية الحالية بل في **تلوث التعلم** الذي يُفسد العمليات المستقبلية.

**ما أخطر المخاطر الحقيقية؟**
1. تلوث aliases من fire-and-forget (DEFECT-006) — يؤثر على كل entity resolution لاحقاً
2. learn قبل save (DEFECT-004) — يحفظ patterns من عمليات فاشلة
3. إرسال مكرر (DEFECT-005) — عمليات محاسبية مضاعفة

**ملاحظة إيجابية مؤكدة من الكود:**
الحماية من hallucination (4 طبقات) تعمل فعلاً كما وُصفت. الـ entity resolver لا يختار تلقائياً في حالة الغموض (مؤكد من الكود). VoiceButton يرفض التسجيلات الصامتة والقصيرة بشكل صحيح.
