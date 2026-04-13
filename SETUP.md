# دليل إعداد نظام vitesse-eco

> نظام إدارة عمليات داخلي (Next.js 16 + Neon Postgres + NextAuth). انظر
> [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md) للنظرة المعمارية الكاملة.

---

## 1. المتطلبات

- Node.js 20+
- npm 11+ (يُرافق Node 20)
- قاعدة Neon Postgres نشطة (فرع منفصل لكل بيئة: إنتاج / تطوير محلي / اختبار)

---

## 2. إعداد بيئة التطوير المحلية — `.env.local`

أنشئ ملف `.env.local` في جذر المستودع:

```env
# Neon dev branch — NOT the production branch
POSTGRES_URL=postgresql://user:pass@host/db?sslmode=require
POSTGRES_URL_NON_POOLING=postgresql://user:pass@host/db?sslmode=require

NEXTAUTH_SECRET=<32+ random chars>
NEXTAUTH_URL=http://localhost:3000

# AI providers (required for the voice flow; optional for non-voice work)
GROQ_API_KEY=<your groq key>
```

بعد ذلك:

```bash
npm install
npm run dev
```

يفتح التطبيق على <http://localhost:3000>.

---

## 3. تهيئة قاعدة البيانات

`/api/init` هو الباب الوحيد لتشغيل إعدادات المخطط. **يستخدم POST body، لا query params**
(تم إزالة `?reset=true` و`?clean=true` في BUG-03).

### 3.1 التهيئة الآمنة (idempotent)

سجّل دخولك كمدير، ثم:

```bash
curl -X POST http://localhost:3000/api/init \
  -H 'Content-Type: application/json' \
  --cookie <nextauth session cookie> \
  -d '{}'
```

هذا ينشئ الجداول إذا لم تكن موجودة، ويُضيف الأعمدة المفقودة عبر `ALTER TABLE` آمنة، ويبذر
المستخدم المدير الافتراضي. آمن للتشغيل أكثر من مرة.

> ⚠️ **بيانات الدخول الافتراضية بعد أول تهيئة:** `admin` / `admin123`
> يجب تغييرها فوراً من واجهة `/users`. الحساب لا يزال موجوداً لأنه بذرة ضرورية للمستخدم
> الأول — لكن تركه بدون تغيير في أي نشر علني هو ثغرة أمنية خطيرة.

### 3.2 العمليات المدمرة — `action: 'reset'` و`action: 'clean'`

كلتاهما تتطلب عبارة تأكيد بالضبط في الـ body:

```bash
# المسح الكامل (محظور في production، يتطلب ALLOW_DB_RESET=true في .env)
curl -X POST http://localhost:3000/api/init \
  -H 'Content-Type: application/json' \
  --cookie <admin session> \
  -d '{"action":"reset","confirm":"احذف كل البيانات نهائيا"}'

# مسح البيانات مع الاحتفاظ بالمستخدمين والإعدادات (والذاكرة التعليمية اختيارياً)
curl -X POST http://localhost:3000/api/init \
  -H 'Content-Type: application/json' \
  --cookie <admin session> \
  -d '{"action":"clean","confirm":"احذف كل البيانات نهائيا","keepLearning":true}'
```

- `action:'reset'` محظور في `NODE_ENV=production` ويتطلب إعداد `ALLOW_DB_RESET=true` في
  `.env` لبيئة التطوير (راجع [BUG-03 في SPRINT_PLAN.md](SPRINT_PLAN.md)).
- `action:'clean'` يحذف بيانات الأعمال لكنه يحتفظ بالمستخدمين والإعدادات. مع
  `keepLearning:true` يحتفظ أيضاً بجداول `ai_corrections`، `ai_patterns`، `entity_aliases`.

---

## 4. تشغيل الاختبارات

### 4.1 `.env.test` — مطلوب

اختبارات التكامل في `tests/sale-lifecycle.test.js` وما في معناها تتصل بفرع Neon حقيقي.
**أي فرع يُشير إليه `.env.test` سيتم عمل TRUNCATE له**. استخدم فرعاً مخصصاً للاختبار.

أنشئ ملف `.env.test`:

```env
POSTGRES_URL=<Neon test-branch connection string>
POSTGRES_URL_NON_POOLING=<Neon test-branch non-pooling string>
NEXTAUTH_SECRET=<any string — tests don't really use this>
```

> ⚠️ **لا تستخدم فرع الإنتاج أو فرع التطوير اليومي هنا.** الاختبارات ستحذف البيانات.

### 4.2 تشغيل المجموعة الكاملة

```bash
# تشغيل مرة واحدة
npx vitest run

# مع المراقبة (إعادة تشغيل تلقائي على التغييرات)
npx vitest

# اختبار ملف معين فقط
npx vitest run tests/sale-lifecycle.test.js

# اختبار وحدة ملف معين (no DB)
npx vitest run tests/voice-normalizer.test.js
```

المجموعة الحالية: **206 اختبار، 13 ملف**. الاختبارات التي لا تحتاج DB تستخدم mocks
(راجع `tests/bug04-deliveries-driver-put.test.js` كمثال).

---

## 5. ملء الأسماء البديلة (Alias Backfill)

بعد تهيئة DB على مستودع جديد، شغّل سكربت التعبئة لتوليد الأسماء البديلة لكل المنتجات
والعملاء والموردين الموجودين. هذا ضروري لأن FEAT-01 يُولّد الأسماء البديلة فقط عند إنشاء
كيان جديد — الكيانات الموجودة قبل FEAT-01 تحتاج تعبئة يدوية لمرة واحدة.

```bash
node scripts/backfill-aliases.mjs
```

السكربت:
- idempotent (آمن للتشغيل أكثر من مرة — يحترم `first-writer-wins` على الأسماء
  الموجودة).
- يقرأ `POSTGRES_URL` من `.env.test` أولاً ثم `.env.local`.
- يطبع لكل جدول `processed / skipped / aliases_created`.
- يُبطل ذاكرة مُقرّر الكيانات (Fuse cache) في النهاية حتى يعكس التطبيق الحي الأسماء
  الجديدة فوراً.

---

## 6. النشر على Vercel

المشروع الحالي منشور على `mohammadnl.vercel.app`. الاسم المرجعي للمشروع في الوثائق
والسكربتات الجديدة هو **vitesse-eco** (قرار ARC-05 — انظر [SPRINT_PLAN.md](SPRINT_PLAN.md)).

### متغيرات البيئة على Vercel (Production + Preview)

نفس مفاتيح `.env.local` أعلاه، مع استبدال `NEXTAUTH_URL` بنطاق النشر الفعلي.

### ملاحظة مهمة لقاعدة بيانات الإنتاج

- **لا تُشغّل `action:'reset'` أو `action:'clean'` ضد فرع Neon الإنتاج.** قاعدة رسمية للمشروع
  (`feedback_no_data_loss.md`). استخدم `action:'clean'` مع `keepLearning:true` فقط إذا كنت
  بحاجة لمسح البيانات في بيئة تطوير.
- متغير `ALLOW_DB_RESET` يجب أن يبقى غير مُعَرَّف أو `false` في الإنتاج.

---

## 7. سير العمل اليومي

```bash
# صباحاً — تأكد من أحدث نسخة
git pull

# تشغيل التطبيق
npm run dev

# قبل commit — شغّل الاختبارات
npx vitest run

# قبل push — شغّل البناء
npm run build
```

تشغيل `npm run build` بدون أخطاء ضروري قبل أي commit يمس `lib/` أو `app/api/` — البناء
يفحص أخطاء الاستيراد التي لا يراها الـ linter.
