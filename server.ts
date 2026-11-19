import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import {
  isPrivilegedManagerRole,
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
} from './src/middleware/auth.ts';
import type { AuthRequest } from './src/middleware/auth.ts';
import {
  signAuthToken,
  signOwnerStepUpToken,
  verifyPassword,
} from './src/lib/auth-utils.ts';
import { extractPriceListFromPdfBuffer } from './src/lib/pdf-price-importer.ts';
import { db, isTransientDbError } from './src/db/index.ts';
import { products as productsTable } from './src/db/schema.ts';
import {
  OwnerBootstrapError,
  approvePriceListImportRecord,
  cancelPriceListImportRecord,
  claimInitialOwnerRoleRecord,
  createCategoryRecord,
  createPriceListImportRecord,
  exportFullDatabaseSnapshotForOwner,
  getAllCategories,
  getOwnerBootstrapStatus,
  getOwnerOverviewData,
  getPriceListImportHistory,
  getPriceListImportOriginalFile,
  mapProductRow,
  recoverOwnerAccessRecord,
  remapPriceListImportRecord,
  setOwnerRecoveryKeyRecord,
  updateCategoryRecord,
  updateCommissionConfigRecord,
  updateSystemGeneralSettingsRecord,
} from './src/db/catalogQueries.ts';
import {
  OwnerControlError,
  createFullSystemBackup,
  deleteBackupRecordById,
  executeBackupRestore,
  executeSystemReset,
  getBackupArchiveById,
  inspectBackupZipBuffer,
  listBackupRecords,
  previewSystemReset,
} from './src/db/ownerControlQueries.ts';
import {
  authenticateTeamMember,
  cancelOrderRecord,
  confirmOrderRecord,
  createChatMessageRecord,
  createCustomerRecord,
  createOrderRecord,
  createProductRecord,
  createTeamMemberRecord,
  deleteCustomerRecord,
  deleteOrderRecord,
  deleteProductRecord,
  getOrderById,
  getProductUsageInfo,
  getStockMovementsForUser,
  getTeamMemberPasswordHashById,
  getWorkspaceDataForUser,
  holdOrderRecord,
  isCancelledOrReturnedStatus,
  isSalesDirectEditableStatus,
  isSalesEditRequestStatus,
  manageOrderItemSourcingRecord,
  queryOrdersForUser,
  resolveOrderEditRequestRecord,
  reviewOrderRevisionRecord,
  setProductArchiveStatusRecord,
  submitOrderEditRequestRecord,
  updateCustomerRecord,
  updateOrderOperationalNotesRecord,
  updateOrderRecord,
  updateOrderStatusRecord,
  updateProductRecord,
  updateSalesRepRecord,
  updateTeamMemberRecord,
  type StatusTransitionOptions,
} from './src/db/queries.ts';
import type {
  OrderDateField,
  OrderDatePreset,
  OrderEditRequest,
  OrderStatus,
  PriceListColumnMapping,
  PriceListParsedItem,
} from './types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf')
    ) {
      cb(null, true);
    } else {
      cb(new Error('يُسمح برفع ملفات PDF فقط.'));
    }
  },
});

const backupZipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const lower = (file.originalname || '').toLowerCase();
    if (
      lower.endsWith('.zip') ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.mimetype === 'application/octet-stream'
    ) {
      cb(null, true);
    } else {
      cb(new Error('يُسمح برفع ملفات النسخ الاحتياطية بصيغة ZIP فقط.'));
    }
  },
});

app.use(express.json({ limit: '20mb' }));

function getSafeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    const agg = error as Error & { errors?: unknown[] };
    if (Array.isArray(agg.errors)) {
      const first = agg.errors.find(
        (item): item is Error => item instanceof Error && Boolean(item.message?.trim())
      );
      if (first) return first.message.trim();
    }
  }
  return fallback;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Username & Password login endpoint (returns token, user, and scoped workspace data in one round-trip)
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
    const workspace = await getWorkspaceDataForUser(result.user);
    res.json({ token, user: result.user, workspace });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تسجيل الدخول.';
    res.status(500).json({ error: message });
  }
});

// Authenticated scoped workspace data bootstrap
app.get('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const data = await getWorkspaceDataForUser(user);
    res.json({ ...data, currentUser: user });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load workspace data';
    res.status(500).json({ error: message });
  }
});

// Orders query endpoint with unified Africa/Cairo date filtering & RBAC
app.get('/api/orders', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await queryOrdersForUser(user, {
      dateFrom: q.dateFrom || undefined,
      dateTo: q.dateTo || undefined,
      dateType: (q.dateType as OrderDateField | undefined) || undefined,
      preset: (q.preset as OrderDatePreset | undefined) || undefined,
      status: q.status || undefined,
      queue: q.queue || undefined,
      search: q.search || undefined,
      governorate: q.governorate || undefined,
    });
    res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to query orders';
    res.status(500).json({ error: message });
  }
});

// Orders endpoints
app.post('/api/orders', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const body = { ...req.body };
    if (user.role === 'sales' && user.salesRepId) {
      if (body.salesRepId && body.salesRepId !== user.salesRepId) {
        return res.status(403).json({ error: 'غير مسموح بإنشاء فاتورة باسم مندوب آخر.' });
      }
      body.salesRepId = user.salesRepId;
      body.salesRepName = body.salesRepName || user.name;
    }

    const newOrder = await createOrderRecord(body, user);
    res.status(201).json(newOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create order';
    const statusCode =
      message.includes('يجب إضافة صنف') || message.includes('مؤرشف') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/orders/:id/confirm', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const id = String(req.params.id);
    const existing = await getOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'الفاتورة المطلوبة غير موجودة.' });
    }

    const isAdmin = isPrivilegedManagerRole(user.role);
    const isOpsOrSupervisor = Boolean(user.canManageOrderStatus) || user.role === 'supervisor';
    if (!isAdmin && !isOpsOrSupervisor) {
      if (!user.salesRepId || existing.salesRepId !== user.salesRepId) {
        return res.status(403).json({ error: 'غير مسموح بتأكيد فاتورة تخص مندوباً آخر.' });
      }
    }

    const confirmedOrder = await confirmOrderRecord(id, user);
    res.json(confirmedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to confirm order';
    const statusCode =
      message.includes('غير موجودة')
        ? 404
        : message.includes('مسبقاً')
          ? 409
          : message.includes('غير كافية') || message.includes('ملغاة') || message.includes('خالية')
            ? 400
            : 500;
    res.status(statusCode).json({ error: message });
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

    const isAdmin = isPrivilegedManagerRole(user.role);
    const canManageStatus = Boolean(user.canManageOrderStatus);

    if (!isAdmin && !canManageStatus && user.role === 'sales') {
      if (user.salesRepId && existing.salesRepId !== user.salesRepId) {
        return res.status(403).json({ error: 'غير مسموح بتعديل فاتورة تخص مندوباً آخر.' });
      }
    }

    if (!isAdmin) {
      if (isSalesDirectEditableStatus(existing.status)) {
        // Allowed directly for owner sales rep / supervisor / ops
      } else if (isSalesEditRequestStatus(existing.status)) {
        if (!canManageStatus) {
          return res.status(403).json({
            error: `الطلب في حالة "${existing.status}". يرجى إرسال طلب تعديل لمسؤول التجهيز والشحن.`,
          });
        }
      } else {
        return res.status(403).json({
          error: 'غير مسموح بتعديل الفاتورة بعد الشحن أو الإغلاق. المدير العام فقط يمكنه التعديل.',
        });
      }
    }

    const expectedVersion =
      typeof req.body?.expectedVersion === 'number' ? req.body.expectedVersion : undefined;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

    const updatedOrder = await updateOrderRecord(id, req.body, isAdmin, canManageStatus, {
      actor: user,
      reason,
      expectedVersion,
    });
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update order';
    const statusCode =
      message.includes('تم تعديل هذه الفاتورة في عملية أخرى')
        ? 409
        : message.includes('لا يمكن تعديل') ||
            message.includes('طلب تعديل') ||
            message.includes('غير مسموح')
          ? 403
          : message.includes('غير كافية') || message.includes('صنف واحد')
            ? 400
            : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/orders/:id/revision-review', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canManageOrderStatus)) {
    return res.status(403).json({
      error: 'صلاحية مراجعة تعديلات الفواتير مخصصة لمسؤول التجهيز والشحن أو المدير العام فقط.',
    });
  }

  try {
    const id = String(req.params.id);
    const { status: reviewStatus, note } = req.body as {
      status?:
        | 'تمت مراجعة التعديل واعتماده'
        | 'يحتاج إعادة تجهيز'
        | 'تمت إعادة التجهيز'
        | 'تمت مراجعة التعديل'
        | 'التعديل جاهز لاستكمال التجهيز';
      note?: string;
    };

    const allowedReviewStatuses = new Set([
      'تمت مراجعة التعديل واعتماده',
      'يحتاج إعادة تجهيز',
      'تمت إعادة التجهيز',
      'تمت مراجعة التعديل',
      'التعديل جاهز لاستكمال التجهيز',
    ]);

    if (!reviewStatus || !allowedReviewStatuses.has(reviewStatus)) {
      return res.status(400).json({ error: 'حالة مراجعة التعديل غير صالحة.' });
    }

    const updated = await reviewOrderRevisionRecord(id, reviewStatus, user, note);
    res.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to review order revision';
    const statusCode =
      message.includes('غير موجودة')
        ? 404
        : message.includes('يوجد طلب تعديل') || message.includes('بانتظار التوفير')
          ? 409
          : message.includes('لا يوجد تعديل')
            ? 400
            : 500;
    res.status(statusCode).json({ error: message });
  }
});

// Multi-source item procurement / supplier receipt / external supply management
app.post('/api/orders/:id/sourcing', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canManageOrderStatus)) {
    return res.status(403).json({
      error: 'صلاحية إدارة توفير الأصناف مخصصة لمسؤول التجهيز والشحن أو المدير العام فقط.',
    });
  }

  try {
    const id = String(req.params.id);
    const updatedOrder = await manageOrderItemSourcingRecord(id, user, req.body);
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to manage order item sourcing';
    const statusCode =
      message.includes('غير موجود')
        ? 404
        : message.includes('مسبقًا') ||
            message.includes('لا توجد كمية') ||
            message.includes('يرجى تأكيد') ||
            message.includes('لا يمكن تعديل مصدر التوفير')
          ? 409
          : message.includes('غير صالح') || message.includes('لا يوجد رصيد')
            ? 400
            : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/orders/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const id = String(req.params.id);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const updatedOrder = await cancelOrderRecord(id, user, reason);
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to cancel order';
    const statusCode =
      message.includes('غير موجودة')
        ? 404
        : message.includes('غير مسموح') || message.includes('صلاحية إلغاء')
          ? 403
          : message.includes('سبب واضح') ||
              message.includes('لا يمكن إلغاء') ||
              message.includes('ملغاة')
            ? 400
            : 500;
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

    const isAdmin = isPrivilegedManagerRole(user.role);
    const canManageStatus = Boolean(user.canManageOrderStatus);
    if (!isAdmin && !canManageStatus && user.role === 'sales') {
      if (user.salesRepId && existing.salesRepId !== user.salesRepId) {
        return res.status(403).json({ error: 'غير مسموح بإرسال طلب تعديل لفاتورة تخص مندوباً آخر.' });
      }
    }

    if (!isSalesEditRequestStatus(existing.status)) {
      const isClosedOrShipped =
        existing.status === 'تم الشحن' ||
        existing.status === 'تم التسليم' ||
        isCancelledOrReturnedStatus(existing.status);
      return res.status(403).json({
        error: isClosedOrShipped
          ? 'غير مسموح بطلب التعديل أو تعديل الفاتورة بعد الشحن أو التسليم.'
          : 'طلب التعديل مخصص للطلبات في مرحلة "جاري التجهيز" أو "تم التجهيز" فقط.',
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
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canManageOrderStatus)) {
    return res.status(403).json({
      error: 'صلاحية الموافقة أو رفض طلبات التعديل مخصصة لمسؤول التجهيز والشحن أو المدير العام فقط.',
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

    const updatedOrder = await resolveOrderEditRequestRecord(id, action, overrideData, user);
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to resolve edit request';
    const statusCode = message.includes('غير كافية') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.patch('/api/orders/:id/status', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  try {
    const id = String(req.params.id);
    const existing = await getOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'الفاتورة المطلوبة غير موجودة.' });
    }

    const { status: nextStatus, note, operationalNotes, shipping, delivery, returnDetails } =
      req.body as { status: OrderStatus } & StatusTransitionOptions;

    if (!nextStatus) {
      return res.status(400).json({ error: 'يرجى تحديد الحالة الجديدة للطلب.' });
    }

    const isAdmin = isPrivilegedManagerRole(user.role);
    const canOps = isAdmin || Boolean(user.canManageOrderStatus);
    const canDeliveryConfirm =
      canOps || user.role === 'supervisor' || Boolean(user.canConfirmDelivery);

    const isTerminalOutcome =
      nextStatus === 'تم التسليم' || nextStatus === 'مرتجع' || nextStatus === 'رفض استلام';

    if (isTerminalOutcome) {
      if (!canDeliveryConfirm) {
        return res.status(403).json({ error: 'ليس لديك صلاحية تأكيد التسليم أو تسجيل المرتجعات.' });
      }
      if (!isAdmin && existing.status === 'تم التسليم') {
        return res.status(403).json({ error: 'لا يمكن تغيير حالة طلب مغلق إلا من خلال المدير العام.' });
      }
    } else {
      if (!canOps) {
        return res.status(403).json({ error: 'ليس لديك صلاحية إدارة التجهيز والشحن.' });
      }
    }

    const updatedOrder = await updateOrderStatusRecord(id, nextStatus, user, {
      note,
      operationalNotes,
      shipping,
      delivery,
      returnDetails,
    });
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update order status';
    const statusCode =
      message.includes('غير موجودة')
        ? 404
        : message.includes('لا يمكن تغيير حالة')
          ? 403
          : message.includes('تعديل جديد') || message.includes('بانتظار التوفير') || message.includes('توفير الأصناف')
            ? 409
            : message.includes('يجب') ||
                message.includes('غير مسموح به وفق تسلسل التشغيل') ||
                message.includes('بانتظار تأكيد العميل')
              ? 400
              : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/orders/:id/hold', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canManageOrderStatus)) {
    return res.status(403).json({ error: 'صلاحية تعليق الطلب أو فك التعليق لمسؤول التجهيز والشحن أو المدير العام فقط.' });
  }

  try {
    const id = String(req.params.id);
    const updatedOrder = await holdOrderRecord(id, user, req.body);
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update order hold status';
    const statusCode =
      message.includes('غير موجودة')
        ? 404
        : message.includes('لا يمكن تعليق') || message.includes('يجب إدخال')
          ? 400
          : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.patch('/api/orders/:id/operational-notes', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canManageOrderStatus)) {
    return res.status(403).json({ error: 'صلاحية تعديل الملاحظات التشغيلية لمسؤول التجهيز والشحن أو المدير العام فقط.' });
  }

  try {
    const id = String(req.params.id);
    const updatedOrder = await updateOrderOperationalNotesRecord(
      id,
      String(req.body.operationalNotes ?? '')
    );
    res.json(updatedOrder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update operational notes';
    res.status(message.includes('غير موجودة') ? 404 : 500).json({ error: message });
  }
});

app.delete('/api/orders/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canDeleteOrders)) {
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
    res.status(message.includes('اسم العميل') ? 400 : 500).json({ error: message });
  }
});

app.put('/api/customers/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && user.role !== 'supervisor')) {
    return res.status(403).json({
      error: 'صلاحية تعديل بيانات العملاء مخصصة للمالك أو المدير أو المشرف فقط.',
    });
  }

  try {
    const id = String(req.params.id);
    const result = await updateCustomerRecord(id, req.body || {}, user);
    res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تحديث بيانات العميل.';
    const statusCode = message.includes('غير موجود')
      ? 404
      : message.includes('عميل آخر')
        ? 409
        : message.includes('اسم العميل')
          ? 400
          : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.delete('/api/customers/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canDeleteCustomers)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية حذف العملاء.' });
  }

  try {
    const id = String(req.params.id);
    await deleteCustomerRecord(id, user);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete customer';
    const statusCode = message.includes('غير موجود')
      ? 404
      : message.includes('لا يمكن حذف العميل')
        ? 409
        : 500;
    res.status(statusCode).json({ error: message });
  }
});

// Products endpoints
app.post('/api/products', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canEditInventory)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية إضافة منتجات للمخزون.' });
  }

  try {
    const newProduct = await createProductRecord(req.body, user);
    res.status(201).json(newProduct);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create product';
    const statusCode = message.includes('غير مسموح')
      ? 403
      : message.includes('مستخدم بالفعل')
        ? 409
        : message.includes('يرجى إدخال')
          ? 400
          : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.put('/api/products/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canEditInventory)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية تعديل المخزون والأسعار.' });
  }

  try {
    const id = String(req.params.id);
    await updateProductRecord({ ...req.body, id }, user);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update product';
    const statusCode = message.includes('غير مسموح')
      ? 403
      : message.includes('مستخدم بالفعل')
        ? 409
        : message.includes('غير موجود')
          ? 404
          : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.get('/api/products/:id/usage', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canEditInventory)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية فحص ارتباطات المنتج.' });
  }

  try {
    const id = String(req.params.id);
    const usage = await getProductUsageInfo(id);
    if (!usage) {
      return res.status(404).json({ error: 'المنتج المطلوب غير موجود.' });
    }
    res.json(usage);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل فحص ارتباطات المنتج.';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/products/:id/archive', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || (!isPrivilegedManagerRole(user.role) && !user.canEditInventory)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية أرشفة أو استعادة المنتجات.' });
  }

  try {
    const id = String(req.params.id);
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ error: 'يرجى تحديد حالة الأرشفة المطلوبة (isActive).' });
    }
    const updated = await setProductArchiveStatusRecord(
      id,
      req.body.isActive,
      user,
      typeof req.body?.reason === 'string' ? req.body.reason : undefined
    );
    res.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تحديث حالة أرشفة المنتج.';
    res.status(message.includes('غير موجود') ? 404 : 500).json({ error: message });
  }
});

app.delete(
  '/api/products/:id',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      const result = await deleteProductRecord(id, req.staffUser!);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'فشل حذف الصنف.';
      const statusCode = message.includes('غير موجود')
        ? 404
        : message.includes('لا يمكن حذف الصنف')
          ? 409
          : 500;
      res.status(statusCode).json({
        error: message,
        canArchiveInstead: statusCode === 409,
      });
    }
  }
);

// Stock movement audit log endpoint
app.get('/api/stock-movements', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (
    !user ||
    (!isPrivilegedManagerRole(user.role) &&
      user.role !== 'supervisor' &&
      !user.canEditInventory &&
      !user.canManageOrderStatus)
  ) {
    return res.status(403).json({ error: 'ليس لديك صلاحية الاطلاع على سجل حركات المخزون.' });
  }

  try {
    const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : undefined;
    const rows = await getStockMovementsForUser(user, orderId);
    res.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load stock movements';
    res.status(500).json({ error: message });
  }
});

// Team members & sales reps endpoints (Admin / Owner only, with Owner protections)
app.post('/api/team-members', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || !isPrivilegedManagerRole(user.role)) {
    return res.status(403).json({ error: 'صلاحية المدير العام فقط لإضافة أعضاء جدد.' });
  }
  if (req.body?.userData?.role === 'owner') {
    return res.status(403).json({
      error: 'غير مسموح بإنشاء حساب المالك الرئيسي (Owner) عبر هذه الواجهة.',
    });
  }

  try {
    await createTeamMemberRecord(req.body.userData, req.body.initialRepData, user);
    res.status(201).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create team member';
    res.status(message.includes('غير مسموح') ? 403 : 500).json({ error: message });
  }
});

app.put('/api/team-members/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || !isPrivilegedManagerRole(user.role)) {
    return res.status(403).json({ error: 'صلاحية المدير العام فقط لتعديل صلاحيات الفريق.' });
  }

  try {
    const id = String(req.params.id);
    await updateTeamMemberRecord({ ...req.body, id }, user);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update team member';
    const statusCode = message.includes('غير مسموح')
      ? 403
      : message.includes('غير موجود')
        ? 404
        : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.put('/api/sales-reps/:id', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user || !isPrivilegedManagerRole(user.role)) {
    return res.status(403).json({ error: 'صلاحية المدير العام فقط لتعديل بيانات المناديب.' });
  }

  try {
    const id = String(req.params.id);
    await updateSalesRepRecord({ ...req.body, id }, user);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update sales rep';
    const statusCode = message.includes('غير مسموح')
      ? 403
      : message.includes('غير موجود')
        ? 404
        : 500;
    res.status(statusCode).json({ error: message });
  }
});

// Dedicated Owner + Step-up endpoint for per-category and base sales rep commission matrix
app.put(
  '/api/owner/sales-reps/:id/commissions',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      const { categoryRates, customCommissionRate, reason } = (req.body || {}) as {
        categoryRates?: Record<string, number>;
        customCommissionRate?: number;
        reason?: string;
      };
      await updateSalesRepRecord(
        {
          id,
          ...(categoryRates !== undefined ? { categoryRates } : {}),
          ...(typeof customCommissionRate === 'number' ? { customCommissionRate } : {}),
          ...(typeof reason === 'string' ? { reason } : {}),
        },
        req.staffUser!
      );
      res.json({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'فشل تحديث نسب عمولة المندوب.';
      const statusCode = message.includes('غير مسموح')
        ? 403
        : message.includes('غير موجود')
          ? 404
          : 500;
      res.status(statusCode).json({ error: message });
    }
  }
);

// =====================================================================
// OWNER (SUPER ADMIN), CATEGORIES, COMMISSION RULES & PDF PRICE IMPORTS
// =====================================================================

// Inspect Owner Bootstrap eligibility without requiring role = owner
app.get('/api/owner/bootstrap-status', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }
  try {
    const status = await getOwnerBootstrapStatus();
    const role = String(user.role || '').trim().toLowerCase();
    res.json({
      hasOwnerAccount: status.hasOwnerAccount,
      canBootstrapOwner: status.canBootstrapOwner,
      hasPartialBootstrapState: !status.hasOwnerAccount && (status.hasRecoveryHash || status.hasClaimAudit),
      currentUserRole: role,
      eligibleForBootstrap: role === 'admin' && !user.isSuspended && status.canBootstrapOwner,
    });
  } catch (error: unknown) {
    console.error('[GET /api/owner/bootstrap-status] Error for user', user.id, {
      message: getSafeErrorMessage(error, 'Unknown error'),
    });
    res.status(isTransientDbError(error) ? 503 : 500).json({
      error: getSafeErrorMessage(error, 'تعذر فحص حالة تفعيل المالك الرئيسي.'),
    });
  }
});

// Initial one-time Owner activation by an existing Admin ONLY when bootstrap is not yet completed
app.post('/api/owner/claim', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  const normalizedRole = String(user.role || '').trim().toLowerCase();
  if (normalizedRole === 'owner') {
    console.warn('[POST /api/owner/claim] Rejected: user is already owner', {
      userId: user.id,
      username: user.username,
    });
    return res.status(409).json({
      error: 'تم تفعيل حسابك كمالك رئيسي مسبقاً ولا يمكن تكرار التفعيل.',
    });
  }
  if (normalizedRole !== 'admin') {
    console.warn('[POST /api/owner/claim] Rejected non-admin actor', {
      userId: user.id,
      username: user.username,
      role: user.role,
    });
    return res.status(403).json({
      error: 'يمكن تفعيل حساب المالك الرئيسي لأول مرة من حساب المدير العام (Admin) المؤهل فقط.',
    });
  }

  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      currentPassword?: unknown;
      recoveryKey?: unknown;
    };
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const recoveryKey = typeof body.recoveryKey === 'string' ? body.recoveryKey : '';

    if (!currentPassword || !recoveryKey.trim()) {
      return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية ومفتاح الاستعادة.' });
    }
    if (recoveryKey.trim().length < 8) {
      return res
        .status(400)
        .json({ error: 'يجب أن يكون مفتاح الاستعادة للمالك 8 أحرف أو أرقام على الأقل.' });
    }

    const upgradedUser = await claimInitialOwnerRoleRecord(user, currentPassword, recoveryKey);
    const token = signAuthToken(upgradedUser.id, upgradedUser.username);
    const workspace = await getWorkspaceDataForUser(upgradedUser);
    console.info('[POST /api/owner/claim] Initial Owner activated successfully', {
      userId: upgradedUser.id,
      username: upgradedUser.username,
    });
    res.json({ token, user: upgradedUser, workspace });
  } catch (error: unknown) {
    console.error('[POST /api/owner/claim] Error for user', user.id, {
      role: user.role,
      name: error instanceof Error ? error.name : typeof error,
      statusCode: error instanceof OwnerBootstrapError ? error.statusCode : undefined,
      message: getSafeErrorMessage(error, 'Unknown error'),
    });

    if (error instanceof OwnerBootstrapError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (isTransientDbError(error)) {
      return res.status(503).json({
        error: 'تعذر الاتصال بقاعدة البيانات مؤقتاً أثناء التفعيل. يرجى المحاولة مرة أخرى.',
      });
    }

    const message = getSafeErrorMessage(error, 'فشل تفعيل حساب المالك.');
    const statusCode = message.includes('مسبقاً')
      ? 409
      : message.includes('معطل') || message.includes('فقط')
        ? 403
        : message.includes('8 أحرف') || message.includes('غير صحيحة')
          ? 400
          : 500;
    res.status(statusCode).json({ error: message });
  }
});

// Owner step-up password verification (issues 15-min X-Owner-Reauth token)
app.post('/api/owner/verify-identity', requireAuth, requireOwner, async (req: AuthRequest, res) => {
  const user = req.staffUser!;
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      return res.status(400).json({ error: 'يرجى إدخال كلمة مرور المالك للتأكيد.' });
    }
    const hash = await getTeamMemberPasswordHashById(user.id);
    if (!hash || !verifyPassword(password, hash)) {
      return res.status(403).json({ error: 'كلمة مرور تأكيد هوية المالك غير صحيحة.' });
    }
    const stepUpToken = signOwnerStepUpToken(user.id);
    res.json({ stepUpToken, expiresInSeconds: 15 * 60 });
  } catch (error: unknown) {
    const message = getSafeErrorMessage(error, 'فشل تأكيد الهوية.');
    res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
  }
});

// Rotate recovery key (requires Owner + step-up)
app.post('/api/owner/recovery-key', requireAuth, requireOwner, requireOwnerStepUp, async (req: AuthRequest, res) => {
  const user = req.staffUser!;
  try {
    const recoveryKey = typeof req.body?.recoveryKey === 'string' ? req.body.recoveryKey : '';
    await setOwnerRecoveryKeyRecord(user, recoveryKey);
    res.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof OwnerBootstrapError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    const message = getSafeErrorMessage(error, 'فشل تحديث مفتاح الاستعادة.');
    res.status(message.includes('8 أحرف') ? 400 : isTransientDbError(error) ? 503 : 500).json({ error: message });
  }
});

// Recover Owner account access via recovery key (no prior login needed)
app.post('/api/owner/recover', async (req, res) => {
  try {
    const { username, recoveryKey, newPassword } = (req.body || {}) as {
      username?: string;
      recoveryKey?: string;
      newPassword?: string;
    };
    if (!username || !recoveryKey || !newPassword) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم ومفتاح الاستعادة وكلمة المرور الجديدة.' });
    }
    const ownerUser = await recoverOwnerAccessRecord(username, recoveryKey, newPassword);
    const token = signAuthToken(ownerUser.id, ownerUser.username);
    const workspace = await getWorkspaceDataForUser(ownerUser);
    res.json({ token, user: ownerUser, workspace });
  } catch (error: unknown) {
    if (error instanceof OwnerBootstrapError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (isTransientDbError(error)) {
      return res.status(503).json({
        error: 'تعذر الاتصال بقاعدة البيانات مؤقتاً أثناء الاستعادة. يرجى المحاولة مرة أخرى.',
      });
    }
    const message = getSafeErrorMessage(error, 'فشل استعادة حساب المالك.');
    const statusCode = message.includes('غير موجود') || message.includes('غير صحيح')
      ? 403
      : message.includes('6 أحرف')
        ? 400
        : 500;
    res.status(statusCode).json({ error: message });
  }
});

// Owner overview analytics, logs, settings, and price list import history
app.get('/api/owner/overview', requireAuth, requireOwner, async (_req: AuthRequest, res) => {
  try {
    const overview = await getOwnerOverviewData();
    res.json(overview);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تحميل بيانات لوحة المالك.';
    res.status(500).json({ error: message });
  }
});

// Full JSON snapshot backup export (Legacy compatibility — Owner + Step-up)
app.post('/api/owner/backup', requireAuth, requireOwner, requireOwnerStepUp, async (req: AuthRequest, res) => {
  try {
    const snapshot = await exportFullDatabaseSnapshotForOwner(req.staffUser!);
    res.json(snapshot);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تصدير النسخة الاحتياطية.';
    res.status(500).json({ error: message });
  }
});

// =====================================================================
// OWNER BACKUP LEDGER, ZIP INSPECTOR, RESTORE & SYSTEM RESET
// =====================================================================

app.get('/api/owner/backups', requireAuth, requireOwner, async (_req: AuthRequest, res) => {
  try {
    const records = await listBackupRecords();
    res.json(records);
  } catch (error: unknown) {
    const message = getSafeErrorMessage(error, 'تعذر تحميل سجل النسخ الاحتياطية.');
    res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
  }
});

app.post(
  '/api/owner/backups/create',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  async (req: AuthRequest, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
      const created = await createFullSystemBackup(req.staffUser!, { name, backupType: 'full' });
      res.status(201).json({
        record: created.record,
        fileName: created.fileName,
        manifest: created.manifest,
      });
    } catch (error: unknown) {
      if (error instanceof OwnerControlError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      const message = getSafeErrorMessage(error, 'فشل إنشاء النسخة الاحتياطية المضغوطة.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

app.get(
  '/api/owner/backups/:id/download',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      const found = await getBackupArchiveById(id);
      if (!found) {
        return res.status(404).json({ error: 'ملف النسخة الاحتياطية غير موجود أو غير محفوظ على الخادم.' });
      }
      const fileName = `KimaScent-Backup-${found.record.createdAt.slice(0, 10)}-${found.record.id.slice(-6)}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('X-Backup-Sha256', found.record.zipSha256);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );
      res.send(found.zipBuffer);
    } catch (error: unknown) {
      const message = getSafeErrorMessage(error, 'فشل تنزيل حزمة النسخة الاحتياطية.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

app.post(
  '/api/owner/backups/:id/verify',
  requireAuth,
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      const found = await getBackupArchiveById(id);
      if (!found) {
        return res.status(404).json({ error: 'حزمة النسخة الاحتياطية غير متوفرة للفحص.' });
      }
      const report = await inspectBackupZipBuffer(found.zipBuffer, {
        actor: req.staffUser!,
        logInspection: true,
      });
      res.json(report);
    } catch (error: unknown) {
      const message = getSafeErrorMessage(error, 'فشل فحص سلامة النسخة الاحتياطية.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

app.delete(
  '/api/owner/backups/:id',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      await deleteBackupRecordById(id, req.staffUser!);
      res.json({ ok: true });
    } catch (error: unknown) {
      if (error instanceof OwnerControlError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      const message = getSafeErrorMessage(error, 'فشل حذف سجل النسخة الاحتياطية.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

app.post(
  '/api/owner/backups/inspect',
  requireAuth,
  requireOwner,
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      backupZipUpload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'فشل قراءة ملف النسخة الاحتياطية.' });
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthRequest, res) => {
    try {
      let zipBuffer: Buffer | null = null;
      if (req.file) {
        zipBuffer = req.file.buffer;
      } else if (typeof req.body?.backupId === 'string' && req.body.backupId.trim()) {
        const found = await getBackupArchiveById(req.body.backupId.trim());
        if (!found) {
          return res.status(404).json({ error: 'النسخة الاحتياطية المطلوبة غير موجودة.' });
        }
        zipBuffer = found.zipBuffer;
      } else if (typeof req.body?.zipBase64 === 'string' && req.body.zipBase64.trim()) {
        zipBuffer = Buffer.from(req.body.zipBase64.trim(), 'base64');
      }

      if (!zipBuffer || zipBuffer.length === 0) {
        return res.status(400).json({ error: 'يرجى رفع ملف ZIP صالح أو اختيار نسخة احتياطية محفوظة للفحص.' });
      }

      const report = await inspectBackupZipBuffer(zipBuffer, {
        actor: req.staffUser!,
        logInspection: true,
      });
      res.json(report);
    } catch (error: unknown) {
      const message = getSafeErrorMessage(error, 'تعذر فحص ملف النسخة الاحتياطية.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

app.post(
  '/api/owner/backups/restore',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      backupZipUpload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'فشل قراءة ملف الاستعادة.' });
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthRequest, res) => {
    try {
      const modeRaw = req.body?.mode;
      const mode = modeRaw === 'live_replace' ? 'live_replace' : 'isolated_sandbox';
      const confirmationPhrase =
        typeof req.body?.confirmationPhrase === 'string' ? req.body.confirmationPhrase : '';

      let zipBuffer: Buffer | null = null;
      if (req.file) {
        zipBuffer = req.file.buffer;
      } else if (typeof req.body?.backupId === 'string' && req.body.backupId.trim()) {
        const found = await getBackupArchiveById(req.body.backupId.trim());
        if (!found) {
          return res.status(404).json({ error: 'النسخة الاحتياطية المختارة غير موجودة.' });
        }
        zipBuffer = found.zipBuffer;
      }

      if (!zipBuffer || zipBuffer.length === 0) {
        return res.status(400).json({ error: 'يرجى تحديد حزمة ZIP أو نسخة محفوظة للاستعادة.' });
      }

      const result = await executeBackupRestore({
        zipBuffer,
        mode,
        actor: req.staffUser!,
        confirmationPhrase,
      });
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof OwnerControlError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      const message = getSafeErrorMessage(error, 'فشلت عملية الاستعادة.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

app.post(
  '/api/owner/system-reset/preview',
  requireAuth,
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        mode?: string;
        customerAction?: 'archive_only' | 'reset_balances' | 'delete_unlinked_and_demo' | 'delete_all';
      };
      const allowedModes = new Set([
        'reset_sales',
        'reset_stock',
        'reset_customers',
        'reset_demo_products',
        'reset_extras',
        'reset_full',
      ]);
      if (!body.mode || !allowedModes.has(body.mode)) {
        return res.status(400).json({ error: 'نوع التصفير المطلوب غير صالح.' });
      }
      const preview = await previewSystemReset({
        mode: body.mode as
          | 'reset_sales'
          | 'reset_stock'
          | 'reset_customers'
          | 'reset_demo_products'
          | 'reset_extras'
          | 'reset_full',
        customerAction: body.customerAction,
      });
      res.json(preview);
    } catch (error: unknown) {
      if (error instanceof OwnerControlError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      const message = getSafeErrorMessage(error, 'فشل تجهيز معاينة التصفير.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

app.post(
  '/api/owner/system-reset',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as {
        mode?: string;
        customerAction?: 'archive_only' | 'reset_balances' | 'delete_unlinked_and_demo' | 'delete_all';
        selectedDemoProductIds?: string[];
        clearChatMessages?: boolean;
        clearPriceListImports?: boolean;
        clearOperationalLogs?: boolean;
        reason?: string;
        confirmationPhrase?: string;
        verifiedBackupId?: string;
      };

      const allowedModes = new Set([
        'reset_sales',
        'reset_stock',
        'reset_customers',
        'reset_demo_products',
        'reset_extras',
        'reset_full',
      ]);
      if (!body.mode || !allowedModes.has(body.mode)) {
        return res.status(400).json({ error: 'نوع التصفير المطلوب غير صالح.' });
      }

      const result = await executeSystemReset(
        {
          mode: body.mode as
            | 'reset_sales'
            | 'reset_stock'
            | 'reset_customers'
            | 'reset_demo_products'
            | 'reset_extras'
            | 'reset_full',
          customerAction: body.customerAction,
          selectedDemoProductIds: Array.isArray(body.selectedDemoProductIds)
            ? body.selectedDemoProductIds.map((x) => String(x))
            : undefined,
          clearChatMessages: Boolean(body.clearChatMessages),
          clearPriceListImports: Boolean(body.clearPriceListImports),
          clearOperationalLogs: Boolean(body.clearOperationalLogs),
          reason: typeof body.reason === 'string' ? body.reason : undefined,
          confirmationPhrase:
            typeof body.confirmationPhrase === 'string' ? body.confirmationPhrase : undefined,
          verifiedBackupId:
            typeof body.verifiedBackupId === 'string' ? body.verifiedBackupId : undefined,
        },
        req.staffUser!
      );
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof OwnerControlError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      const message = getSafeErrorMessage(error, 'فشل تنفيذ عملية التصفير.');
      res.status(isTransientDbError(error) ? 503 : 500).json({ error: message });
    }
  }
);

// Update general system settings (Owner + Step-up)
app.put('/api/owner/settings', requireAuth, requireOwner, requireOwnerStepUp, async (req: AuthRequest, res) => {
  try {
    const updated = await updateSystemGeneralSettingsRecord(req.staffUser!, req.body || {});
    res.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل حفظ إعدادات النظام.';
    res.status(500).json({ error: message });
  }
});

// Update commission configuration (Owner + Step-up)
app.put('/api/owner/commission-settings', requireAuth, requireOwner, requireOwnerStepUp, async (req: AuthRequest, res) => {
  try {
    const { reason, confirmPassword: _ignored, ...configPatch } = req.body || {};
    const updated = await updateCommissionConfigRecord(
      req.staffUser!,
      configPatch,
      typeof reason === 'string' ? reason : undefined
    );
    res.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل حفظ إعدادات العمولات.';
    res.status(500).json({ error: message });
  }
});

// Categories endpoints
app.get('/api/categories', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const categories = await getAllCategories();
    res.json(categories);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تحميل التصنيفات.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/categories', requireAuth, requireOwner, requireOwnerStepUp, async (req: AuthRequest, res) => {
  try {
    const created = await createCategoryRecord(req.body, req.staffUser!);
    res.status(201).json(created);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل إضافة التصنيف.';
    const statusCode = message.includes('تكرار') ? 409 : message.includes('يرجى إدخال') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.put('/api/categories/:id', requireAuth, requireOwner, requireOwnerStepUp, async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);
    const updated = await updateCategoryRecord({ ...req.body, id }, req.staffUser!);
    res.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تحديث التصنيف.';
    const statusCode = message.includes('آخر بنفس الاسم')
      ? 409
      : message.includes('غير موجود')
        ? 404
        : message.includes('يرجى إدخال')
          ? 400
          : 500;
    res.status(statusCode).json({ error: message });
  }
});

// PDF Price List Import & Preview (Strictly Owner Only — 403 for Admin, Supervisor, Sales)
app.post(
  '/api/price-lists/import',
  requireAuth,
  requireOwner,
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      pdfUpload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'فشل رفع ملف PDF.' });
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthRequest, res) => {
    try {
      let buffer: Buffer | null = null;
      let fileName = 'price-list.pdf';
      let mimeType = 'application/pdf';

      if (req.file) {
        buffer = req.file.buffer;
        fileName = req.file.originalname || 'price-list.pdf';
        mimeType = req.file.mimetype || 'application/pdf';
      } else if (typeof req.body?.fileBase64 === 'string' && req.body.fileBase64.trim()) {
        const cleanB64 = req.body.fileBase64.replace(/^data:application\/pdf;base64,/, '');
        buffer = Buffer.from(cleanB64, 'base64');
        fileName = (req.body.fileName || 'price-list.pdf').toString();
      }

      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: 'يرجى إرفاق ملف PDF صالح لقائمة الأسعار.' });
      }
      if (buffer.length > 15 * 1024 * 1024) {
        return res.status(400).json({ error: 'حجم الملف يتجاوز الحد الأقصى المسموح (15 ميجابايت).' });
      }

      const rawListCatId =
        typeof req.body?.listCategoryId === 'string' && req.body.listCategoryId.trim()
          ? req.body.listCategoryId.trim()
          : null;

      let parsedColumnMapping: PriceListColumnMapping | null = null;
      if (req.body?.columnMapping) {
        if (typeof req.body.columnMapping === 'string') {
          try {
            parsedColumnMapping = JSON.parse(req.body.columnMapping) as PriceListColumnMapping;
          } catch {
            return res.status(400).json({ error: 'صيغة تعيين الأعمدة غير صالحة.' });
          }
        } else if (typeof req.body.columnMapping === 'object') {
          parsedColumnMapping = req.body.columnMapping as PriceListColumnMapping;
        }
      }

      const [allProdRows, categories] = await Promise.all([
        db.select().from(productsTable),
        getAllCategories(),
      ]);
      if (rawListCatId && !categories.some((c) => c.id === rawListCatId)) {
        return res.status(400).json({ error: 'التصنيف المحدد لقائمة الأسعار غير موجود في الكتالوج.' });
      }
      const existingProducts = allProdRows.map(mapProductRow);

      const extraction = await extractPriceListFromPdfBuffer(buffer, existingProducts, categories, {
        listCategoryId: rawListCatId,
        columnMapping: parsedColumnMapping,
      });
      const savedImport = await createPriceListImportRecord({
        fileName,
        mimeType,
        fileSizeBytes: buffer.length,
        fileDataBase64: buffer.toString('base64'),
        listCategoryId: extraction.listCategoryId ?? rawListCatId,
        listCategoryName: extraction.listCategoryName ?? null,
        columnMapping: extraction.columnMapping ?? parsedColumnMapping,
        rawTableRows: extraction.rawTableRows ?? null,
        extractionMethod: extraction.extractionMethod,
        parsedItems: extraction.parsedItems,
        totalParsed: extraction.totalParsed,
        newCount: extraction.newCount,
        updatedCount: extraction.updatedCount,
        needsReviewCount: extraction.needsReviewCount,
        duplicateCount: extraction.duplicateCount,
        rawTextPreview: extraction.rawTextPreview,
        errorMessage: extraction.errorMessage ?? null,
        actor: req.staffUser!,
      });

      res.status(201).json(savedImport);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'فشل استيراد ومعالجة ملف PDF.';
      res.status(500).json({ error: message });
    }
  }
);

app.post(
  '/api/price-lists/:id/remap',
  requireAuth,
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      const listCategoryId =
        typeof req.body?.listCategoryId === 'string' && req.body.listCategoryId.trim()
          ? req.body.listCategoryId.trim()
          : undefined;
      const columnMapping =
        req.body?.columnMapping && typeof req.body.columnMapping === 'object'
          ? (req.body.columnMapping as PriceListColumnMapping)
          : undefined;

      const updated = await remapPriceListImportRecord({
        importId: id,
        listCategoryId,
        columnMapping,
        actor: req.staffUser!,
      });
      res.json(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'فشل إعادة تعيين واستخراج الأعمدة.';
      const statusCode = message.includes('غير موجود')
        ? 404
        : message.includes('مسبقاً')
          ? 409
          : 500;
      res.status(statusCode).json({ error: message });
    }
  }
);

app.get('/api/price-lists', requireAuth, requireOwner, async (_req: AuthRequest, res) => {
  try {
    const history = await getPriceListImportHistory();
    res.json(history);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تحميل سجل قوائم الأسعار.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/price-lists/:id/file', requireAuth, requireOwner, async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);
    const file = await getPriceListImportOriginalFile(id);
    if (!file) {
      return res.status(404).json({ error: 'الملف الأصلي غير موجود.' });
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
    );
    res.send(file.buffer);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل تنزيل ملف PDF الأصلي.';
    res.status(500).json({ error: message });
  }
});

app.post(
  '/api/price-lists/:id/approve',
  requireAuth,
  requireOwner,
  requireOwnerStepUp,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id);
      const items = Array.isArray(req.body?.items) ? (req.body.items as PriceListParsedItem[]) : [];
      const approved = await approvePriceListImportRecord(id, items, req.staffUser!);
      res.json(approved);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'فشل اعتماد قائمة الأسعار.';
      const statusCode = message.includes('غير موجود')
        ? 404
        : message.includes('مسبقاً') || message.includes('مكرر')
          ? 409
          : message.includes('غير محدد') || message.includes('كود') || message.includes('سعر')
            ? 400
            : 500;
      res.status(statusCode).json({ error: message });
    }
  }
);

app.post('/api/price-lists/:id/cancel', requireAuth, requireOwner, async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);
    await cancelPriceListImportRecord(id, req.staffUser!);
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'فشل إلغاء دفعة الاستيراد.';
    res.status(500).json({ error: message });
  }
});

// Team chat endpoint (server enforces sender identity from verified auth token)
app.post('/api/chat', requireAuth, async (req: AuthRequest, res) => {
  const user = req.staffUser;
  if (!user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }
  if (user.isMuted) {
    return res.status(403).json({ error: 'تم كتم إمكانية الإرسال لهذا الحساب.' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'لا يمكن إرسال رسالة فارغة.' });
  }

  try {
    const newMsg = await createChatMessageRecord({
      senderId: user.id,
      senderName: user.name,
      text,
    });
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

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });
    const prompt = `
      بصفتك خبير تسويق لشركة زيوت عطرية بالجملة.
      العميل: ${customer.name}
      تصنيفه: ${customer.classification}
      إجمالي مشترياته: ${customer.totalSpent} جنيه.
      المنتجات المتاحة لدينا: ${(products || []).map((p: { name: string }) => p.name).join(', ')}.
      
      اكتب رسالة تسويقية مخصصة (Re-marketing) لهذا العميل باللغة العربية بلهجة احترافية وودودة لتشجيعه على الطلب مرة أخرى.
      واقترح 3 منتجات قد تهمه بناءً على كونه عميل ${customer.classification}.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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

// Return structured JSON errors for unmatched /api/* endpoints and middleware errors (JSON syntax, multer, DB)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'المسار المطلوب غير موجود على الخادم.' });
});

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  const errObj = err as { type?: string; status?: number; name?: string; message?: string };
  if (errObj?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({ error: 'صيغة بيانات الطلب المرسلة غير صالحة.' });
  }
  if (errObj?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'حجم البيانات المرسلة يتجاوز الحد المسموح.' });
  }
  if (errObj?.name === 'MulterError') {
    return res.status(400).json({ error: errObj.message || 'تعذر قراءة الملف المرفوع.' });
  }
  console.error('[API Error Middleware]', req.method, req.originalUrl, {
    name: err instanceof Error ? errorNameOrType(err) : typeof err,
    message: getSafeErrorMessage(err, 'Internal error'),
  });
  if (isTransientDbError(err)) {
    return res.status(503).json({
      error: 'انقطع الاتصال بقاعدة البيانات مؤقتاً. يرجى المحاولة مرة أخرى.',
    });
  }
  if (req.originalUrl.startsWith('/api')) {
    return res.status(errObj?.status && errObj.status >= 400 ? errObj.status : 500).json({
      error: getSafeErrorMessage(err, 'حدث خطأ غير متوقع في الخادم.'),
    });
  }
  return next(err);
});

function errorNameOrType(err: Error): string {
  return err.name || 'Error';
}

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
