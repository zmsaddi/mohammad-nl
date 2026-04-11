import { EXPENSE_CATEGORIES } from './utils';

export function getSystemPrompt(products, clients, suppliers) {
  const productNames = products.map((p) => `${p.name} (مخزون: ${p.stock}, سعر بيع: ${p.sell_price || 'غير محدد'})`).join('\n');
  const clientNames = clients.map((c) => c.name).join('، ');
  const supplierNames = suppliers.map((s) => s.name).join('، ');
  const categories = EXPENSE_CATEGORIES.join('، ');

  return `أنت مساعد محاسبي ذكي لمتجر "Vitesse Eco" للدراجات الكهربائية والإكسسوارات.

مهمتك: استخراج بيانات العمليات التجارية من كلام المستخدم بالعربية (قد يكون بلهجة شامية أو خليجية).

## القواعد الصارمة:
1. العميل لازم يكون موجود في القائمة. إذا غير موجود → استخدم request_clarification.
2. المورد لازم يكون موجود في القائمة. إذا غير موجود → استخدم request_clarification.
3. المنتج لازم يكون موجود في القائمة. إذا غير موجود → استخدم request_clarification.
4. إذا حقل إلزامي ناقص → استخدم request_clarification واسأل عنه بالعربي.
5. لا تفترض أي قيمة - اسأل المستخدم.
6. الأرقام قد تكون بالأرقام (700) أو بالكلمات (سبعمية) - تعامل مع الاثنين.

## المنتجات المتاحة:
${productNames || 'لا توجد منتجات'}

## العملاء:
${clientNames || 'لا يوجد عملاء'}

## الموردين:
${supplierNames || 'لا يوجد موردين'}

## فئات المصاريف:
${categories}

## طرق الدفع:
- بيع: كاش (عند التوصيل) / بنك / آجل (دين)
- شراء ومصاريف: كاش / بنك`;
}

export const FEW_SHOT_EXAMPLES = [
  { role: 'user', content: 'بعت لأحمد دراجة كهربائية بسبعمية وخمسين كاش' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex1', type: 'function', function: { name: 'register_sale', arguments: '{"client_name":"أحمد","item":"دراجة كهربائية","quantity":1,"unit_price":750,"payment_type":"كاش"}' } }] },
  { role: 'tool', tool_call_id: 'ex1', content: 'ok' },

  { role: 'user', content: 'بعت لمحمد ثلاث بطاريات' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex2', type: 'function', function: { name: 'request_clarification', arguments: '{"question":"كم سعر الوحدة؟ وهل الدفع كاش أو بنك أو آجل؟","missing_fields":["unit_price","payment_type"]}' } }] },
  { role: 'tool', tool_call_id: 'ex2', content: 'ok' },

  { role: 'user', content: 'اشتريت من المصنع عشر بطاريات بمية وخمسين بنك' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex3', type: 'function', function: { name: 'register_purchase', arguments: '{"supplier":"المصنع","item":"بطارية","quantity":10,"unit_price":150,"payment_type":"بنك"}' } }] },
  { role: 'tool', tool_call_id: 'ex3', content: 'ok' },

  { role: 'user', content: 'مصروف إيجار المحل ألفين وخمسمية كاش' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex4', type: 'function', function: { name: 'register_expense', arguments: '{"category":"إيجار","description":"إيجار المحل","amount":2500,"payment_type":"كاش"}' } }] },
  { role: 'tool', tool_call_id: 'ex4', content: 'ok' },

  { role: 'user', content: 'سجل مصروف' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex5', type: 'function', function: { name: 'request_clarification', arguments: '{"question":"إيش نوع المصروف؟ وكم المبلغ؟ كاش أو بنك؟","missing_fields":["category","description","amount","payment_type"]}' } }] },
  { role: 'tool', tool_call_id: 'ex5', content: 'ok' },
];

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'register_sale',
      description: 'تسجيل عملية بيع جديدة',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'اسم العميل (لازم يكون موجود)' },
          item: { type: 'string', description: 'اسم المنتج (لازم يكون موجود بالمخزون)' },
          quantity: { type: 'number', description: 'الكمية' },
          unit_price: { type: 'number', description: 'سعر الوحدة' },
          payment_type: { type: 'string', enum: ['كاش', 'بنك', 'آجل'], description: 'طريقة الدفع' },
          notes: { type: 'string', description: 'ملاحظات اختيارية' },
        },
        required: ['client_name', 'item', 'quantity', 'unit_price', 'payment_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_purchase',
      description: 'تسجيل عملية شراء جديدة',
      parameters: {
        type: 'object',
        properties: {
          supplier: { type: 'string', description: 'اسم المورد (لازم يكون موجود)' },
          item: { type: 'string', description: 'اسم المنتج' },
          quantity: { type: 'number', description: 'الكمية' },
          unit_price: { type: 'number', description: 'سعر الوحدة' },
          payment_type: { type: 'string', enum: ['كاش', 'بنك'], description: 'طريقة الدفع' },
          notes: { type: 'string', description: 'ملاحظات اختيارية' },
        },
        required: ['supplier', 'item', 'quantity', 'unit_price', 'payment_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_expense',
      description: 'تسجيل مصروف',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: EXPENSE_CATEGORIES, description: 'فئة المصروف' },
          description: { type: 'string', description: 'وصف المصروف' },
          amount: { type: 'number', description: 'المبلغ' },
          payment_type: { type: 'string', enum: ['كاش', 'بنك'], description: 'طريقة الدفع' },
          notes: { type: 'string', description: 'ملاحظات اختيارية' },
        },
        required: ['category', 'description', 'amount', 'payment_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_clarification',
      description: 'طلب معلومات ناقصة من المستخدم',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'السؤال بالعربي' },
          missing_fields: { type: 'array', items: { type: 'string' }, description: 'الحقول الناقصة' },
          partial_data: { type: 'object', description: 'البيانات المستخرجة حتى الآن' },
        },
        required: ['question', 'missing_fields'],
      },
    },
  },
];
