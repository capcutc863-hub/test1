import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { requireAuth } from './src/middleware/auth.ts';
import type { AuthRequest } from './src/middleware/auth.ts';
import { signAuthToken } from './src/lib/auth-utils.ts';
import {
  authenticateTeamMember,
  createChatMessageRecord,
  createCustomerRecord,
  createOrderRecord,
  createProductRecord,
  createTeamMemberRecord,
  deleteCustomerRecord,
  deleteOrderRecord,
  getAllWorkspaceData,
  getOrderById,
  resolveOrderEditRequestRecord,
  submitOrderEditRequestRecord,
  updateOrderRecord,
  updateOrderStatusRecord,
  updateProductRecord,
  updateSalesRepRecord,
  updateTeamMemberRecord,
} from './src/db/queries.ts';
import type { OrderEditRequest, OrderStatus } from './types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Username & Password login endpoint (returns token, user, and initial workspace data in one round-trip)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
    }

    const result = await authenticateTeamMember(username, password);
    if (!result.user) {
      return res.status(401).json({ error: result.error || 'بيانات الدخول غير صحيحة.' });
    }

    const token = signAuthToken(result.user.id, result.user.username);
    const workspace = await getAllWorkspaceData();
    res.json({ token, user: result.user, workspace });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تسجيل الدخول.';
    res.status(500).json({ error: message });
  }
});

// Authenticated workspace data bootstrap
app.get('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = await getAllWorkspaceData();
    res.json({ ...data, currentUser: req.staffUser });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load workspace data';
    res.status(500).json({ error: message });
  }
});

// Orders endpoints
app.post('/api/orders', requireAuth, async (req: AuthRequest, res) => {
  try {
    const newOrder = await createOrderRecord(req.body);
    res.status(201).json(newOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create order';
    res.status(500).json({ error: message });
  }
});

app.put('/api/orders/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const id = String(req.params.id);
    const existing = await getOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة.' });
    }

    const isAdmin = user.role === 'admin';
    const canManageStatus = Boolean(user.canManageOrderStatus);

    if (!isAdmin) {
      if (
        existing.status === 'تم الشحن' ||
        existing.status === 'تم التسليم' ||
        existing.status === 'مرتجع' ||
        existing.status === 'ملغي'
      ) {
        return res.status(403).json({
          error: 'غير مسموح بتعديل الفاتورة بعد الشحن أو التسليم. المدير العام فقط يمكنه التعديل.',
        });
      }
      if (existing.status === 'تم التجهيز' && !canManageStatus) {
        return res.status(403).json({
          error: 'الطلب في حالة "تم التجهيز". يرجى إرسال طلب تعديل لمسؤول حالة الطلبات.',
        });
      }
    }

    const updatedOrder = await updateOrderRecord(id, req.body, isAdmin, canManageStatus);
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update order';
    const statusCode =
      message.includes('لا يمكن تعديل') || message.includes('تم تجهيزه') ? 403 : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/orders/:id/edit-request', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const id = String(req.params.id);
    const existing = await getOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة.' });
    }

    if (existing.status !== 'تم التجهيز') {
      return res.status(403).json({
        error:
          existing.status === 'تم الشحن' || existing.status === 'تم التسليم'
            ? 'غير مسموح بطلب التعديل أو تعديل الفاتورة بعد الشحن أو التسليم.'
            : 'طلب التعديل مخصص للطلبات في حالة "تم التجهيز" فقط.',
      });
    }

    const body = req.body as Omit<OrderEditRequest, 'requestedById' | 'requestedByName' | 'requestedAt'>;
    const editRequest: OrderEditRequest = {
      ...body,
      requestedById: user.id,
      requestedByName: user.name,
      requestedAt: new Date().toISOString(),
    };

    const updatedOrder = await submitOrderEditRequestRecord(id, editRequest);
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to submit edit request';
    res.status(500).json({ error: message });
  }
});

app.post('/api/orders/:id/edit-request/resolve', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (user.role !== 'admin' && !user.canManageOrderStatus)) {
    return res.status(403).json({
      error: 'صلاحية الموافقة أو رفض طلبات التعديل مخصصة لمسؤول حالة الطلبات أو المدير العام فقط.',
    });
  }

  try {
    const id = String(req.params.id);
    const { action, overrideData } = req.body as {
      action: 'approve' | 'reject';
      overrideData?: Parameters<typeof resolveOrderEditRequestRecord>[2];
    };

    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'إجراء غير صالح.' });
    }

    const updatedOrder = await resolveOrderEditRequestRecord(id, action, overrideData);
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to resolve edit request';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/orders/:id/status', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  const nextStatus = req.body.status as OrderStatus;
  const isPrepOrShip = nextStatus === 'تم التجهيز' || nextStatus === 'تم الشحن' || nextStatus === 'قيد التنفيذ';

  if (isPrepOrShip) {
    if (user.role !== 'admin' && !user.canManageOrderStatus) {
      return res.status(403).json({ error: 'ليس لديك صلاحية تحديث حالة التجهيز والشحن.' });
    }
  } else {
    if (
      user.role !== 'admin' &&
      user.role !== 'supervisor' &&
      !user.canConfirmDelivery &&
      !user.canManageOrderStatus
    ) {
      return res.status(403).json({ error: 'ليس لديك صلاحية تعديل حالة التسليم.' });
    }
  }

  try {
    const id = String(req.params.id);
    await updateOrderStatusRecord(id, nextStatus);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update order status';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/orders/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (user.role !== 'admin' && !user.canDeleteOrders)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية حذف الفواتير.' });
  }

  try {
    const id = String(req.params.id);
    await deleteOrderRecord(id);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete order';
    res.status(500).json({ error: message });
  }
});

// Customers endpoints
app.post('/api/customers', requireAuth, async (req: AuthRequest, res) => {
  try {
    const newCustomer = await createCustomerRecord(req.body);
    res.status(201).json(newCustomer);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create customer';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/customers/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (user.role !== 'admin' && !user.canDeleteCustomers)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية حذف العملاء.' });
  }

  try {
    const id = String(req.params.id);
    await deleteCustomerRecord(id);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete customer';
    res.status(500).json({ error: message });
  }
});

// Products endpoints
app.post('/api/products', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (user.role !== 'admin' && !user.canEditInventory)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية إضافة منتجات للمخزون.' });
  }

  try {
    const newProduct = await createProductRecord(req.body);
    res.status(201).json(newProduct);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create product';
    res.status(500).json({ error: message });
  }
});

app.put('/api/products/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (user.role !== 'admin' && !user.canEditInventory)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية تعديل المخزون والأسعار.' });
  }

  try {
    const id = String(req.params.id);
    await updateProductRecord({ ...req.body, id });
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update product';
    res.status(500).json({ error: message });
  }
});

// Team members & sales reps endpoints (Admin only)
app.post('/api/team-members', requireAuth, async (req: AuthRequest, res) => {
  if (req.staffUser?.role !== 'admin') {
    return res.status(403).json({ error: 'صلاحية المدير العام فقط لإضافة أعضاء جدد.' });
  }

  try {
    await createTeamMemberRecord(req.body.userData, req.body.initialRepData);
    res.status(201).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create team member';
    res.status(500).json({ error: message });
  }
});

app.put('/api/team-members/:id', requireAuth, async (req: AuthRequest, res) => {
  if (req.staffUser?.role !== 'admin') {
    return res.status(403).json({ error: 'صلاحية المدير العام فقط لتعديل صلاحيات الفريق.' });
  }

  try {
    const id = String(req.params.id);
    await updateTeamMemberRecord({ ...req.body, id });
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update team member';
    res.status(500).json({ error: message });
  }
});

app.put('/api/sales-reps/:id', requireAuth, async (req: AuthRequest, res) => {
  if (req.staffUser?.role !== 'admin') {
    return res.status(403).json({ error: 'صلاحية المدير العام فقط لتعديل عمولات السيلز.' });
  }

  try {
    const id = String(req.params.id);
    await updateSalesRepRecord({ ...req.body, id });
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update sales rep';
    res.status(500).json({ error: message });
  }
});

// Team chat endpoint
app.post('/api/chat', requireAuth, async (req: AuthRequest, res) => {
  if (req.staffUser?.isMuted) {
    return res.status(403).json({ error: 'تم كتم إمكانية الإرسال لهذا الحساب.' });
  }

  try {
    const newMsg = await createChatMessageRecord(req.body);
    res.status(201).json(newMsg);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send chat message';
    res.status(500).json({ error: message });
  }
});

// Server-side Gemini marketing insights endpoint
app.post('/api/marketing-insight', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { customer, products } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      بصفتك خبير تسويق لشركة زيوت عطرية بالجملة.
      العميل: ${customer.name}
      تصنيفه: ${customer.classification}
      إجمالي مشترياته: ${customer.totalSpent} جنيه.
      الزيوت المتاحة لدينا: ${(products || []).map((p: { name: string }) => p.name).join(', ')}.
      
      اكتب رسالة تسويقية مخصصة (Re-marketing) لهذا العميل باللغة العربية بلهجة احترافية وودودة لتشجيعه على الطلب مرة أخرى.
      واقترح 3 منتجات قد تهمه بناءً على كونه عميل ${customer.classification}.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    res.json({ text: response.text });
  } catch (error: unknown) {
    console.error('Gemini Error:', error);
    res.status(500).json({ error: 'عذراً، حدث خطأ أثناء توليد الاقتراحات التسويقية.' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
