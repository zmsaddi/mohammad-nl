# دليل إعداد نظام المحاسبة

## الخطوة 1: إعداد Google Sheet

1. اذهب إلى [Google Sheets](https://sheets.google.com) وأنشئ جدول بيانات جديد
2. أنشئ **5 تبويبات** بالأسماء التالية بالضبط:

### تبويب: المشتريات
أضف هذه العناوين في الصف الأول:
```
معرف | التاريخ | اسم المورد | اسم الصنف | الكمية | سعر الوحدة | الإجمالي | ملاحظات
```

### تبويب: المبيعات
```
معرف | التاريخ | اسم العميل | اسم الصنف | الكمية | سعر الوحدة | الإجمالي | طريقة الدفع | المبلغ المدفوع | المبلغ المتبقي | ملاحظات
```

### تبويب: المصاريف
```
معرف | التاريخ | الفئة | الوصف | المبلغ | ملاحظات
```

### تبويب: العملاء
```
معرف | اسم العميل | رقم الهاتف | العنوان | ملاحظات
```

### تبويب: سجل الدفعات
```
معرف | التاريخ | اسم العميل | المبلغ | معرف_البيع | ملاحظات
```

3. انسخ **معرف الجدول** من الرابط (الجزء بين `/d/` و `/edit`):
   مثال: `https://docs.google.com/spreadsheets/d/ABC123XYZ/edit` → المعرف هو `ABC123XYZ`

---

## الخطوة 2: إعداد Google Cloud

1. اذهب إلى [Google Cloud Console](https://console.cloud.google.com)
2. أنشئ **مشروع جديد** (New Project)
3. من القائمة الجانبية اذهب إلى **APIs & Services** → **Enable APIs**
4. ابحث عن **Google Sheets API** واضغط **Enable**
5. اذهب إلى **APIs & Services** → **Credentials**
6. اضغط **Create Credentials** → **Service Account**
7. أدخل اسم (مثلاً: `accounting-app`) واضغط **Create**
8. في صفحة Service Account، اضغط على الحساب الذي أنشأته
9. اذهب لتبويب **Keys** → **Add Key** → **Create new key** → **JSON**
10. سيتم تحميل ملف JSON - احتفظ به

---

## الخطوة 3: مشاركة الجدول

1. افتح ملف JSON الذي حملته
2. انسخ قيمة `client_email` (مثل: `accounting-app@project.iam.gserviceaccount.com`)
3. افتح Google Sheet واضغط **مشاركة** (Share)
4. ألصق الإيميل وأعطه صلاحية **محرر** (Editor)

---

## الخطوة 4: إعداد متغيرات البيئة

أنشئ ملف `.env.local` في جذر المشروع:

```env
# Google Sheets
GOOGLE_SHEETS_ID=معرف_الجدول_من_الخطوة_1
GOOGLE_SERVICE_ACCOUNT_EMAIL=الإيميل_من_ملف_JSON
GOOGLE_PRIVATE_KEY="المفتاح_الخاص_من_ملف_JSON"

# NextAuth
NEXTAUTH_SECRET=أي_نص_عشوائي_طويل_32_حرف_على_الأقل
NEXTAUTH_URL=http://localhost:3000
```

**ملاحظة:** قيمة `GOOGLE_PRIVATE_KEY` يجب أن تكون بين علامتي تنصيص ويجب نسخها كاملة من ملف JSON.

---

## الخطوة 5: تشغيل المشروع محلياً

```bash
npm install
npm run dev
```

افتح المتصفح على `http://localhost:3000`

**بيانات الدخول الافتراضية:**
- مدير: `admin` / `admin123`
- موظف: `user` / `user123`

---

## الخطوة 6: النشر على Vercel

1. ارفع المشروع على GitHub
2. اذهب إلى [Vercel](https://vercel.com) وسجّل دخول بحساب GitHub
3. اضغط **New Project** واختر المشروع
4. أضف متغيرات البيئة (Environment Variables) نفس القيم في `.env.local`
5. اضغط **Deploy**

**مهم:** في Vercel، حدّث `NEXTAUTH_URL` ليكون رابط الموقع الفعلي (مثل: `https://your-app.vercel.app`)
