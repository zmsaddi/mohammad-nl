# دليل إعداد نظام المحاسبة

## التشغيل المحلي

### 1. إعداد متغيرات البيئة

أنشئ ملف `.env.local`:

```env
POSTGRES_URL=postgresql://user:pass@host/db?sslmode=require
POSTGRES_URL_NON_POOLING=postgresql://user:pass@host/db?sslmode=require
POSTGRES_HOST=host
POSTGRES_USER=user
POSTGRES_PASSWORD=pass
POSTGRES_DATABASE=db

NEXTAUTH_SECRET=any_random_long_string_32_chars
NEXTAUTH_URL=http://localhost:3000
```

### 2. التشغيل

```bash
npm install
npm run dev
```

### 3. تهيئة قاعدة البيانات

سجّل دخول كمدير (`admin` / `admin123`) ثم افتح:
```
http://localhost:3000/api/init
```

---

## النشر على Vercel

الموقع منشور على: **https://mohammadnl.vercel.app**

قاعدة البيانات: **Neon Postgres** (مجانية)

### بيانات الدخول الافتراضية
- مدير: `admin` / `admin123`
- موظف: `user` / `user123`
