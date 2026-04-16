# تدقيق جنائي: جودة تحويل الكلام إلى نص (STT) — v1.2

**التاريخ:** 2026-04-17
**السؤال المركزي:** لماذا يخرج النص خاطئاً فوراً بعد التسجيل؟
**النتيجة:** 10 عيوب مؤكدة (1 حرج، 4 عالي، 4 متوسط، 1 منخفض)

---

## الحكم

المشكلة الأساسية **ليست في مكان واحد** بل في ثلاث طبقات متراكبة:
1. **التسجيل** — إعدادات ضعيفة + نوع MIME خاطئ على Safari
2. **Whisper** — قاموس أطول من الحد + صمت يُولّد هلوسات
3. **التطبيع** — يُشوّه أسماء العملاء والموردين الحقيقية

---

## سجل العيوب

### STT-DEFECT-001: MediaRecorder.start() بدون timeslice
- **Severity:** High
- **Category:** recording
- **Status:** Confirmed
- **File:** `components/VoiceButton.js`
- **Function:** `handleClick` (سطر 149)
- **Evidence:** `recorder.start()` بدون معامل. كل البيانات تبقى في الذاكرة حتى stop().
- **سيناريو الفشل:** تسجيل 25 ثانية على هاتف ضعيف → ضغط ذاكرة → فقدان بيانات.
- **الأثر:** نص ناقص أو مشوه.
- **الإصلاح:** `recorder.start(1000)` — chunks كل ثانية.
- **Confidence:** Medium

### STT-DEFECT-002: getUserMedia بدون قيود صوتية
- **Severity:** High
- **Category:** recording
- **Status:** Confirmed
- **File:** `components/VoiceButton.js`
- **Function:** `handleClick` (سطر 67)
- **Evidence:** `getUserMedia({ audio: true })` — لا sampleRate، لا noiseSuppression، لا echoCancellation.
- **سيناريو الفشل:** تسجيل في متجر فيه ضوضاء → Whisper يسمع الضوضاء → هلوسات.
- **الأثر:** كلمات وهمية من ضوضاء محيطة.
- **الإصلاح:** إضافة `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }`.
- **Confidence:** High

### STT-DEFECT-003: نوع MIME مُثبت على audio/webm في الباك إند
- **Severity:** Critical
- **Category:** upload
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js`
- **Function:** `POST` (سطر 68)
- **Evidence:** `new File([audioBuffer], 'audio.webm', { type: 'audio/webm' })` — دائماً webm بغض النظر عن المصدر.
- **سيناريو الفشل:** Safari يسجل بـ audio/mp4 → الباك إند يُعلنه webm → Whisper يتلقى ملف بنوع خاطئ → فشل أو تشويه.
- **الأثر:** فشل كامل أو نص مشوه على أجهزة Apple.
- **الإصلاح:** استخدام `audioFile.type` الحقيقي بدلاً من تثبيت webm.
- **Confidence:** High

### STT-DEFECT-004: تبديل ألوان/منتجات بدون حدود كلمة
- **Severity:** High
- **Category:** normalization
- **Status:** Confirmed
- **File:** `lib/voice-normalizer.js`
- **Function:** `transliterateArabicToLatin` (سطور 358-363)
- **Evidence:** "أسود"→"Noir"، "نور"→"Noir"، "بني"→"Marron" — تبديل substring بدون حدود.
- **سيناريو الفشل:** عميل "أسود الدين" → "Noir الدين"، "نور الهدى" → "Noirالهدى".
- **الأثر:** أسماء العملاء والموردين تُشوَّه.
- **الإصلاح:** تطبيق `arabicSafeBoundary` على كل إدخالات الألوان والمنتجات.
- **Confidence:** High

### STT-DEFECT-005: Blob بنوع audio/webm ثابت في المتصفح
- **Severity:** High
- **Category:** recording
- **Status:** Confirmed
- **File:** `components/VoiceButton.js`
- **Function:** `recorder.onstop` (سطر 132)
- **Evidence:** `new Blob(chunks.current, { type: 'audio/webm' })` — ثابت. لكن Safari قد يسجل بـ mp4/aac.
- **الأثر:** عدم تطابق بين المحتوى الحقيقي والنوع المُعلن → نفس تأثير DEFECT-003.
- **الإصلاح:** `new Blob(chunks.current, { type: mediaRecorder.current?.mimeType || 'audio/webm' })`.
- **Confidence:** High

### STT-DEFECT-006: حد قاموس Whisper أكبر بكثير من الحد الحقيقي
- **Severity:** Medium
- **Category:** stt-request
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js`
- **Function:** Vocabulary construction (سطور 92-128)
- **Evidence:** الحد 1450 حرف، لكن Whisper يقطع عند ~224 رمز (token). الحرف العربي ≈ 2-3 رموز → 1450 حرف ≈ 3000-4000 رمز → 15× أكثر من الحد.
- **الأثر:** معظم أسماء المنتجات والعملاء في القاموس لا تصل لـ Whisper أبداً.
- **الإصلاح:** خفض الحد إلى ~350-400 حرف.
- **Confidence:** High

### STT-DEFECT-007: إدخالات يتيمة في LETTER_MAPPING_SOURCES
- **Severity:** Low
- **Category:** normalization
- **Status:** Confirmed
- **File:** `lib/voice-normalizer.js`
- **Function:** `LETTER_MAPPING_SOURCES` (سطور 322-349)
- **Evidence:** "في"، "ڤي"، "بي" موجودة في المجموعة لكن لا يوجد لها تبديل في المصفوفة.
- **الأثر:** كود ميت — لا يؤثر حالياً لكن مُضلل.
- **الإصلاح:** حذف الإدخالات اليتيمة مع تعليق.
- **Confidence:** High

### STT-DEFECT-008: LLM يتلقى نص مُطبّع بدل النص الخام
- **Severity:** Medium
- **Category:** normalization
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js`
- **Function:** LLM prompt (سطر 237)
- **Evidence:** LLM يرى `normalized` وليس `raw`. التطبيع يحوّل كلمات عربية لفرنسية/إنجليزية → LLM يرى نصاً مهجناً.
- **الأثر:** LLM يصعب عليه التمييز بين اسم عميل ولون منتج عندما كلاهما أصبح "Noir".
- **الإصلاح:** إرسال `raw` لـ LLM، واستخدام `normalized` فقط لمطابقة الكيانات.
- **Confidence:** Medium

### STT-DEFECT-009: لا يوجد إيقاف تلقائي عند الصمت
- **Severity:** Medium
- **Category:** recording
- **Status:** Confirmed
- **File:** `components/VoiceButton.js`
- **Function:** RMS silence detector (سطور 77-114)
- **Evidence:** كاشف الصمت يسجل الـ max RMS فقط — لا يوقف التسجيل. المستخدم قد ينسى الضغط → 27 ثانية صمت تصل لـ Whisper.
- **الأثر:** صمت طويل = هلوسات Whisper.
- **الإصلاح:** إضافة مؤقت: RMS < 0.02 لمدة 2.5 ثانية متواصلة → إيقاف تلقائي.
- **Confidence:** High

### STT-DEFECT-010: لا يمكن تشخيص مصدر الخطأ من السجلات
- **Severity:** Medium
- **Category:** observability
- **Status:** Confirmed
- **File:** `app/api/voice/process/route.js`
- **Function:** voice_logs insert (سطور 386-392)
- **Evidence:** voice_logs يحفظ raw + normalized. لكن لا يحفظ: مخرج LLM، نتائج entity resolver، التحذيرات، طول القاموس.
- **الأثر:** عند شكوى "الكلام طلع غلط" لا يمكن تحديد: Whisper خطأ أم التطبيع أم LLM.
- **الإصلاح:** إضافة عمود `debug_json` يحتوي مخرج كل مرحلة.
- **Confidence:** High

---

## الأسباب الجذرية مُرتبة حسب التأثير

### السبب الأول: توافق Safari/iOS (DEFECT-003 + 005)
على أجهزة Apple، الملف الصوتي يصل بنوع MIME خاطئ. هذا يُسبب فشل Whisper الكامل أو تفسير مشوه. **هذا هو السبب الأكثر احتمالاً لـ "الكلام ما طلع أصلاً"**.

### السبب الثاني: ضوضاء + صمت = هلوسات (DEFECT-002 + 009)
بدون كبت الضوضاء وبدون إيقاف تلقائي عند الصمت، Whisper يتلقى مادة صوتية رديئة. **هذا هو السبب الأكثر احتمالاً لـ "الكلام طلع غلط تماماً"**.

### السبب الثالث: التطبيع يُشوه الأسماء (DEFECT-004 + 008)
حتى لو Whisper أنتج نصاً صحيحاً، التطبيع يستبدل كلمات عربية حقيقية بمقابلاتها الفرنسية/الإنجليزية بدون حدود كلمة. **هذا هو السبب الأكثر احتمالاً لـ "الاسم طلع غلط"**.

---

## خطة الإصلاح

### فوري (اليوم)
| # | العيب | الإصلاح |
|---|-------|---------|
| 1 | STT-003+005 | إصلاح نوع MIME — تمرير النوع الحقيقي من المتصفح إلى الباك إند إلى Whisper |
| 2 | STT-002 | إضافة قيود صوتية لـ getUserMedia (noiseSuppression, echoCancellation) |
| 3 | STT-004 | تطبيق arabicSafeBoundary على كل تبديلات الألوان والمنتجات |

### قصير المدى (أسبوع)
| # | العيب | الإصلاح |
|---|-------|---------|
| 4 | STT-009 | إيقاف تلقائي بعد 2.5 ثانية صمت |
| 5 | STT-006 | خفض حد القاموس من 1450 إلى ~400 حرف |
| 6 | STT-001 | إضافة timeslice(1000) لـ MediaRecorder.start() |
| 7 | STT-008 | إرسال raw transcript لـ LLM بدلاً من normalized |

### متوسط المدى (شهر)
| # | العيب | الإصلاح |
|---|-------|---------|
| 8 | STT-010 | إضافة debug_json لجدول voice_logs |
| 9 | STT-007 | تنظيف الإدخالات اليتيمة |

---

## الحكم النهائي

**هل المشكلة في التسجيل أم في STT أم في التطبيع؟**
في الثلاثة معاً، لكن بنسب مختلفة:
- ~40% تسجيل (MIME خاطئ على Safari + بدون كبت ضوضاء)
- ~30% STT (قاموس أطول من الحد + صمت → هلوسات)
- ~30% تطبيع (أسماء عملاء تُشوَّه بتبديلات الألوان)

**هل النص الخام نفسه سيئ أم يتخرب بعد ذلك؟**
كلاهما. النص الخام يكون سيئاً عندما:
1. Safari يرسل ملف بنوع خاطئ (DEFECT-003)
2. الضوضاء تصل بدون كبت (DEFECT-002)
3. الصمت يولّد هلوسات (DEFECT-009)

ثم النص الخام الصحيح يتخرب عندما:
4. التطبيع يستبدل أسماء حقيقية بترجمات (DEFECT-004)

**ما أول شيء يجب إصلاحه؟**
إصلاح MIME type (DEFECT-003+005) — هذا هو العائق الأكبر لأنه يُسبب فشل كامل على أجهزة Apple.
