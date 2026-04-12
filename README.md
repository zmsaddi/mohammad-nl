# Vitesse Eco - E-bikes Business Management

نظام إدارة متكامل للدراجات الكهربائية والإكسسوارات وقطع الغيار.

## المميزات

- شراء وبيع البضائع مع تتبع المخزون التلقائي
- نظام توصيل تلقائي مع VIN وفواتير
- نظام ديون للعملاء مع تسجيل الدفعات
- إدخال صوتي بالعربية (Whisper + Gemini AI)
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
- Groq Whisper (STT)
- Gemini 2.5 Flash (AI)
- Fuse.js (Entity Resolution)

## التشغيل

```bash
npm install
npm run dev
```

بيانات الدخول الافتراضية: `admin` / `admin123`

## النشر

الموقع منشور على Vercel: https://mohammadnl.vercel.app
