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

#### v1.1 F-009 — حارس صارم على `POSTGRES_URL`

اعتباراً من v1.1، تُرفض اختبارات المجموعة إذا لم يُعرّف `POSTGRES_URL` نفسه
كبيئة اختبار. يجب أن يحتوي **اسم المضيف (host)** أو **اسم قاعدة البيانات** على
أحد المُعرّفات التالية (غير حساسة لحالة الأحرف):

```
test  |  sandbox  |  dev  |  staging  |  preview  |  ephemeral
```

أمثلة مقبولة:

```
postgresql://user:pw@ep-test-sandbox.example.neon.tech/neondb?sslmode=require
postgresql://user:pw@ep-prod.example.neon.tech/neondb-test?sslmode=require
```

أمثلة **مرفوضة** (ستتسبب بفشل `pretest` قبل أي اتصال بقاعدة البيانات):

```
postgresql://user:pw@ep-winter-wave.example.neon.tech/neondb?sslmode=require   ← مرفوض
postgresql://user:pw@prod-db.example.com/customers?sslmode=require              ← مرفوض
```

لتشخيص ما يُشير إليه `.env.test` الحالي:

```bash
node scripts/env-test-doctor.mjs
```

السكربت يطبع المضيف واسم قاعدة البيانات ويُجري فحص `current_database()` الحي قبل أي
DDL. رمز الخروج 0 = آمن للتشغيل، 1 = رفض، 2 = فشل الفحص (شبكة/اتصال).

المرجع: [F-009 في docs/v1-1-comprehensive-study.md](docs/v1-1-comprehensive-study.md).

### 4.2 تشغيل المجموعة الكاملة

```bash
# تشغيل مرة واحدة — يُشغّل env-test-doctor أولاً (pretest hook)
npm test

# الطريقة القديمة (لا تشغّل الحارس — استخدم فقط بعد التحقق اليدوي)
npx vitest run

# مع المراقبة
npm run test:ui

# اختبار ملف معين فقط
npx vitest run tests/sale-lifecycle.test.js

# اختبار وحدة ملف معين (no DB)
npx vitest run tests/voice-normalizer.test.js
```

> ✅ `npm test` هو الطريقة الصحيحة اعتباراً من v1.1 — يُشغّل حارس `env-test-doctor`
> تلقائياً قبل vitest. إذا كان `.env.test` يُشير إلى الإنتاج، سيرفض تشغيل الاختبارات
> مع رسالة `F-009 env-test guard REFUSING TO RUN`.

المجموعة الحالية: **206 اختبار، 13 ملف**. الاختبارات التي لا تحتاج DB تستخدم mocks
(راجع `tests/bug04-deliveries-driver-put.test.js` كمثال).

### 4.3 GitHub Actions CI (v1.1 — F-069)

اعتباراً من v1.1، الملف `.github/workflows/ci.yml` يُشغّل على كل push و PR إلى
`master`. الوظائف:

1. **lint** — ESLint (غير حاجب حالياً — `continue-on-error: true`)
2. **build** — `next build` يجب أن ينجح
3. **test-mock** — vitest على اختبارات mock/وحدة (لا تحتاج قاعدة بيانات)
4. **test-real-db** — vitest على اختبارات التكامل الحقيقية (تُخطى ما لم يُفعَّل)

**أسرار GitHub المطلوبة** (Settings → Secrets and variables → Actions):

| السر / المتغير | النوع | الوصف |
|-----------------|-------|-------|
| `NEON_TEST_BRANCH_URL` | Secret | رابط `POSTGRES_URL` لفرع Neon مخصص للاختبار |
| `NEON_TEST_BRANCH_URL_NON_POOLING` | Secret | نفسه بصيغة non-pooling |
| `ENABLE_REAL_DB_TESTS` | Variable | اضبط على `"true"` لتفعيل وظيفة `test-real-db` |

**حماية الفرع** (Settings → Branches → `master` branch protection rule):

- [ ] Require a pull request before merging
- [ ] Require status checks to pass before merging (select `build`, `test-mock`)
- [ ] Require branches to be up to date before merging
- [ ] Include administrators (اختياري لكن يُستحسن)

Claude لا يستطيع تفعيل هذه الحمايات تلقائياً — يجب على المستخدم تفعيلها من واجهة GitHub.

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

---

## 8. First-Time Admin Password Rotation

**Run this procedure immediately after go-live.** The default `admin123`
password is a well-known placeholder and must be rotated before the
first real user logs in.

1. Navigate to https://mohammadnl.vercel.app/login
2. Log in with `admin` / `admin123`
3. Click **المستخدمون** (Users) in the sidebar
4. Find the row for user `admin` and click the edit (pencil) button
5. Enter a new strong password:
   - Minimum 12 characters
   - Mix of UPPERCASE, lowercase, numbers, and symbols
   - NOT a dictionary word, NOT a name, NOT `admin{year}`
   - Store it in a password manager — there is no self-service reset
6. Click **حفظ** (Save)
7. **Log out** (top-right button)
8. **Log back in** with the new password to verify it works
9. Optional but recommended: create a personalized admin account
   (e.g. `mohammad-admin`) and either delete or disable the default
   `admin` user from the Users page

**What to do if you lock yourself out:** the `admin` account can be
recovered only via direct database access. Connect to the Neon
console (https://console.neon.tech → project `accounting-db` →
branch `main` → SQL Editor) and run:

```sql
-- Generate a new bcrypt hash locally first:
-- node -e "console.log(require('bcryptjs').hashSync('NewPassword123!', 12))"

UPDATE users
SET password = '<paste bcrypt hash here>', active = true
WHERE username = 'admin';
```

Then log in with the new password and rotate it again via the UI
(so the SQL-set password isn't the permanent one).

---

## 9. Secret Rotation Procedure

Each production secret has its own rotation workflow, blast radius,
and cadence. **Do not copy-paste old values — always generate fresh.**

### `NEXTAUTH_SECRET`

Signs JWT session cookies. Rotating it invalidates every active
session — all users must log in again.

```bash
# Generate a new 32-byte base64 secret
openssl rand -base64 32
```

1. Copy the output
2. Vercel Dashboard → Project `mohammad_nl` → Settings → Environment
   Variables
3. Find `NEXTAUTH_SECRET`, click the edit (three dots) icon → Edit
4. Paste the new value, ensure **Production** scope is selected
5. Click Save
6. Vercel Dashboard → Deployments → click the three dots on the
   current production deploy → Redeploy
7. After redeploy lands, verify by logging in fresh (old cookies
   are already invalid)

**Cadence:** quarterly, or immediately on suspected compromise.
**Blast radius:** all users logged out (expect support calls).

### `GROQ_API_KEY`

Powers voice transcription (Whisper) and entity extraction (Llama).
Rotation has zero user impact if done in sequence.

1. https://console.groq.com → API Keys → Create new key
2. Copy the new key immediately (Groq shows it only once)
3. Vercel Dashboard → Environment Variables → edit `GROQ_API_KEY`
4. Paste new value, Production scope, Save
5. Redeploy (same step 6 as above)
6. After redeploy lands, **revoke** the old key from the Groq console
   — do NOT leave it active

**Cadence:** quarterly, or immediately on suspected compromise.
**Blast radius:** none — voice transcription continues uninterrupted
because the redeploy atomically swaps the running instances.

### `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING`

Production database connection strings. Vercel Postgres / Neon
manages password rotation internally — you do not rotate these by
hand unless you suspect the current credentials are compromised.

1. Vercel Dashboard → Storage → Neon Postgres → Settings
2. Click **Reset database password** (warns: all existing connections
   will be closed)
3. Vercel updates both `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`
   automatically in the linked project
4. Trigger a redeploy to pick up the new URLs
5. Verify production loads and the auth flow works

**Cadence:** never, unless compromise is suspected. If Vercel Postgres
provisioned the DB, the password rotation is a button on the Neon
integration page.

**Blast radius:** ~30 seconds of connection errors during rotation.
Expect a handful of 500s in Vercel function logs during the swap.

### `NEXTAUTH_URL`

Only rotated if the production domain changes (e.g. switching to a
custom domain like `app.vitesse-eco.fr`).

1. Add the new domain under Vercel Project → Settings → Domains
2. Wait for DNS propagation (Vercel shows green checkmark)
3. Update `NEXTAUTH_URL` in Environment Variables to the new URL
   (no trailing slash, must be https://)
4. Redeploy
5. Update the old domain to redirect to the new one (Vercel handles
   this automatically if you set the new domain as primary)

**Cadence:** never, unless the domain changes.
**Blast radius:** any hardcoded links in emails or docs pointing at
the old URL will break until manually updated.

### Rotation frequency summary

| Secret | Quarterly | On compromise | On domain change |
|---|---|---|---|
| `NEXTAUTH_SECRET` | ✅ | ✅ | — |
| `GROQ_API_KEY` | ✅ | ✅ | — |
| `POSTGRES_URL` + `_NON_POOLING` | — | ✅ | — |
| `NEXTAUTH_URL` | — | — | ✅ |

---

## 10. Disaster Recovery

### Neon point-in-time restore

This project uses Vercel Postgres backed by Neon. Neon retains a
point-in-time-restore (PITR) window that lets you create a branch
from any timestamp in the recent past. **On the Free tier the
retention window is 7 days.** Upgrade to Pro for longer retention
if the business case justifies it.

### When to use PITR

| Situation | Action |
|---|---|
| Accidental DELETE on a sales row | PITR branch from before the delete, copy the row back |
| Corrupt data from a bad UPDATE | PITR branch, compare rows, copy corrected values back |
| Dropped table / schema wipe | PITR branch, dump + restore the whole table |
| User deleted their own data via the UI | Consider whether it was intentional before restoring |
| Bad code shipped and already rolled back | No DB restore needed — data is untouched |

**When NOT to use PITR:** do not use restore for bugs where the code
was wrong but the data is still valid. Revert the code via Git
instead.

### Create a restore branch (step-by-step)

1. https://console.neon.tech → project `accounting-db`
2. Click **Branches** in the left sidebar
3. Click **Create branch**
4. Under "Create from", choose **Timestamp** (not "head")
5. Pick a timestamp before the incident (Neon shows available range
   based on retention)
6. Name the branch something like `restore-2026-04-14-1530`
7. Click **Create**
8. Once the branch is ready, click it and copy the **pooled
   connection string** — this is what you use to query it

### Connect to a restore branch

```bash
# From your local machine (or any tool that accepts a PG URL):
psql "<pooled connection string from step 8>"

# Verify schema matches production
\dt
SELECT COUNT(*) FROM sales;
SELECT COUNT(*) FROM clients;

# Inspect the rows you want to restore
SELECT * FROM sales WHERE id = 123;
```

### Copy data from restore branch to production

**Option A — single row / small batch:**

```bash
# 1. Dump the row(s) from the restore branch
pg_dump "<restore branch URL>" \
  --data-only --table=sales \
  --where="id = 123" \
  > /tmp/restore-sale-123.sql

# 2. Review the SQL before applying
cat /tmp/restore-sale-123.sql

# 3. Apply to production (the CURRENT pooled POSTGRES_URL)
psql "<production pooled URL>" < /tmp/restore-sale-123.sql
```

**Option B — whole table:**

```bash
# Truncate + reload is destructive. Only use if the entire table is
# corrupt and all legitimate post-incident changes are acceptable
# losses.
pg_dump "<restore branch URL>" --table=sales --data-only \
  > /tmp/sales-full.sql

psql "<production pooled URL>" -c "TRUNCATE TABLE sales CASCADE;"
psql "<production pooled URL>" < /tmp/sales-full.sql
```

### After restoring

1. Verify the restored data with a quick `SELECT COUNT(*)` check
2. Delete the restore branch from Neon (it's billed on storage even
   after you're done with it)
3. Write an incident note in the project log describing what
   happened, what you restored, and what post-incident changes were
   lost (if any)

### Verify PITR is actually enabled

Do this once, now, before you need it:

1. https://console.neon.tech → project `accounting-db` → branch `main`
2. Confirm the **Point-in-time restore** setting is enabled
3. Note the retention window (7 days on Free tier)
4. Create a throwaway restore branch from ~1 hour ago to verify the
   procedure works on your specific project — delete it immediately
   after

Neon docs: https://neon.tech/docs/introduction/point-in-time-restore

---
