import { EXPENSE_CATEGORIES } from './utils';

export function getSystemPrompt(products, clients, suppliers) {
  const productNames = products.map((p) => `${p.name} (مخزون: ${p.stock}, سعر بيع: ${p.sell_price || 'غير محدد'})`).join('\n');
  const clientNames = clients.map((c) => c.name).join('، ');
  const supplierNames = suppliers.map((s) => s.name).join('، ');
  const categories = EXPENSE_CATEGORIES.join('، ');

  return `You are a smart accounting assistant for "Vitesse Eco" e-bike store.
Your task: Extract structured business data from Arabic speech (may be Levantine or Gulf dialect).

STRICT RULES:
1. If user says "بعت" or "selling" → use register_sale
2. If user says "اشتريت" or "buying" → use register_purchase
3. If user says "مصروف" or "expense" → use register_expense
4. Client/supplier/product names MUST be from the lists below. If not found → use request_clarification with Arabic question.
5. If any required field is missing → use request_clarification with Arabic question.
6. NEVER guess values. Ask the user in Arabic.
7. Write ALL string values in Arabic (client names, descriptions, etc.)
8. For payment_type use: cash / bank / credit
9. For category use: rent / salaries / transport / maintenance / marketing / utilities / insurance / tools / other

AVAILABLE PRODUCTS:
${productNames || 'None'}

CLIENTS:
${clientNames || 'None'}

SUPPLIERS:
${supplierNames || 'None'}

IMPORTANT: All questions in request_clarification MUST be in Arabic.`;
}

export const FEW_SHOT_EXAMPLES = [
  { role: 'user', content: 'بعت لأحمد دراجة كهربائية بسبعمية وخمسين كاش' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex1', type: 'function', function: { name: 'register_sale', arguments: '{"client_name":"أحمد","item":"دراجة كهربائية","quantity":1,"unit_price":750,"payment_type":"cash"}' } }] },
  { role: 'tool', tool_call_id: 'ex1', content: 'ok' },

  { role: 'user', content: 'بعت لمحمد ثلاث بطاريات' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex2', type: 'function', function: { name: 'request_clarification', arguments: '{"question":"كم سعر الوحدة؟ وهل الدفع كاش أو بنك أو آجل؟","missing_fields":["unit_price","payment_type"]}' } }] },
  { role: 'tool', tool_call_id: 'ex2', content: 'ok' },

  { role: 'user', content: 'اشتريت من المصنع عشر بطاريات بمية وخمسين بنك' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex3', type: 'function', function: { name: 'register_purchase', arguments: '{"supplier":"المصنع","item":"بطارية","quantity":10,"unit_price":150,"payment_type":"bank"}' } }] },
  { role: 'tool', tool_call_id: 'ex3', content: 'ok' },

  { role: 'user', content: 'مصروف إيجار المحل ألفين وخمسمية كاش' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'ex4', type: 'function', function: { name: 'register_expense', arguments: '{"category":"rent","description":"إيجار المحل","amount":2500,"payment_type":"cash"}' } }] },
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
          payment_type: { type: 'string', description: 'طريقة الدفع: cash أو bank أو credit' },
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
          payment_type: { type: 'string', description: 'طريقة الدفع: cash أو bank' },
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
          category: { type: 'string', description: 'فئة المصروف: rent, salaries, transport, maintenance, marketing, utilities, insurance, tools, other' },
          description: { type: 'string', description: 'وصف المصروف' },
          amount: { type: 'number', description: 'المبلغ' },
          payment_type: { type: 'string', description: 'طريقة الدفع: cash أو bank' },
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
