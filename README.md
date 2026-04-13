# Vitesse Eco - E-bikes Business Management

نظام إدارة متكامل للدراجات الكهربائية والإكسسوارات وقطع الغيار.

## المميزات

- شراء وبيع البضائع مع تتبع المخزون التلقائي
- نظام توصيل تلقائي مع VIN وفواتير
- نظام ديون للعملاء مع تسجيل الدفعات
- إدخال صوتي بالعربية (Whisper + Llama 3.1 8B Instant)
- نظام بونص للبائعين والسائقين
- داشبورد شامل مع رسوم بيانية (P&L)
- 4 أدوار: مدير / مشرف / بائع / سائق
- تصميم عربي RTL متوافق مع كل الشاشات

## التقنيات

- Next.js 16 (App Router)
- Vercel Postgres (Neon)
- NextAuth.js
- Tailwind CSS
- Recharts
- Groq Whisper large-v3 (Arabic STT)
- Groq Llama 3.1 8B Instant (structured extraction LLM)
- Fuse.js (Entity Resolution)
- Vitest (integration tests against a disposable Neon branch)

## التشغيل

انظر [SETUP.md](SETUP.md) للتفاصيل الكاملة (متغيرات البيئة، تهيئة قاعدة البيانات، تشغيل الاختبارات، ملء الأسماء البديلة).

```bash
npm install
npm run dev
```

> ⚠️ عند أول تهيئة، ينشئ `/api/init` حساب مدير افتراضياً: `admin` / `admin123`.
> **يجب تغيير كلمة المرور فوراً** من `/users` بعد أول تسجيل دخول. لا تُشغّل هذا النشر علناً قبل تغييرها.

## النشر

الموقع منشور على Vercel (نطاق النشر الحالي: `mohammadnl.vercel.app`؛ الاسم المرجعي للمشروع في الوثائق هو **vitesse-eco**).
