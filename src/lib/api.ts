import { getInMemoryIdToken } from './tokenStore.ts';
import type {
  AuditLogEntry,
  BackupInspectionReport,
  BackupManifest,
  BackupRecord,
  BiFilterParams,
  BulkExecuteResult,
  BulkPreviewResult,
  ChatMessage,
  CommissionConfig,
  CommissionSettingLog,
  Customer,
  CustomerAnalyticsRow,
  CustomerRepeatFilter,
  ExternalSourcingRecord,
  ItemSourcingSource,
  OilGradeRecord,
  Order,
  OrderDateField,
  OrderDatePreset,
  OrderEditRequest,
  OrderReturnPrimaryReason,
  OrdersQueryStats,
  OrderStatus,
  OwnerBiDashboardData,
  OwnerCommissionAnalytics,
  OwnerSystemOverviewCounts,
  PriceListColumnMapping,
  PriceListImportRecord,
  PriceListParsedItem,
  Product,
  ProductCategory,
  ProductUsageSummary,
  ReorderRecommendationRow,
  RestoreExecutionReport,
  SalesRep,
  SalesRepAnalyticsRow,
  StockMovementEntry,
  SystemGeneralSettings,
  SystemResetPreview,
  SystemResetResult,
  SystemResetScope,
  UnifiedReportType,
  UnitQuantityTotal,
  User,
} from '../../types.ts';

let ownerStepUpToken: string | null = null;
let ownerStepUpExpiresAt = 0;

export function setOwnerStepUpToken(token: string | null, expiresInSeconds = 900) {
  ownerStepUpToken = token;
  ownerStepUpExpiresAt = token ? Date.now() + expiresInSeconds * 1000 : 0;
}

export function getOwnerStepUpToken(): string | null {
  if (!ownerStepUpToken) return null;
  if (Date.now() >= ownerStepUpExpiresAt) {
    ownerStepUpToken = null;
    ownerStepUpExpiresAt = 0;
    return null;
  }
  return ownerStepUpToken;
}

export class ApiRequestError extends Error {
  status: number;
  requiresOwnerReauth: boolean;

  constructor(message: string, status: number, requiresOwnerReauth = false) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.requiresOwnerReauth = requiresOwnerReauth;
  }
}

export interface OrderQueryParams {
  dateFrom?: string;
  dateTo?: string;
  dateType?: OrderDateField;
  preset?: OrderDatePreset;
  status?: string;
  queue?: string;
  search?: string;
  governorate?: string;
}

export interface OrderQueryResponse {
  orders: Order[];
  stats: OrdersQueryStats;
  queueCounts: Record<string, number>;
  appliedFilter: {
    dateFrom?: string;
    dateTo?: string;
    dateType: OrderDateField;
    preset: OrderDatePreset;
  };
}

export interface ManageItemSourcingPayload {
  itemIndex: number;
  action:
    | 'set_source'
    | 'receive_into_warehouse'
    | 'fulfill_external_direct'
    | 'allocate_from_warehouse';
  sourcingSource?: ItemSourcingSource;
  quantity?: number;
  supplierName?: string;
  notes?: string;
  unitCost?: number | null;
  totalSourcingCost?: number | null;
  dateSecured?: string;
  idempotencyKey?: string;
}

export interface UnifiedReportClientPayload {
  reportType: UnifiedReportType;
  titleAr: string;
  subtitleAr: string;
  appliedFilterSummary: string;
  summaryCards: Array<{ label: string; value: string }>;
  columns: Array<{
    key: string;
    label: string;
    format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
  }>;
  rows: Array<Record<string, string | number | null>>;
  unitTotals?: UnitQuantityTotal[];
}

export interface OrderStatusTransitionPayload {
  note?: string;
  operationalNotes?: string;
  shipping?: {
    carrier?: string;
    trackingNumber?: string;
    notes?: string;
  };
  delivery?: {
    notes?: string;
  };
  returnDetails?: {
    reason: OrderReturnPrimaryReason;
    details: string;
    customerRefusedDelivery?: boolean;
    customerNoAnswer?: boolean;
    invalidAddress?: boolean;
    customerRequestedCancel?: boolean;
    otherReason?: boolean;
  };
}

export type UpdateOrderPayload = Omit<Order, 'id' | 'createdAt'> & {
  expectedVersion?: number;
  reason?: string;
};

export interface WorkspacePayload {
  users: User[];
  products: Product[];
  categories: ProductCategory[];
  oilGrades?: OilGradeRecord[];
  commissionConfig: CommissionConfig;
  generalSettings: SystemGeneralSettings;
  hasOwnerAccount: boolean;
  canBootstrapOwner?: boolean;
  salesReps: SalesRep[];
  customers: Customer[];
  orders: Order[];
  chatMessages: ChatMessage[];
}

export interface OwnerOverviewPayload {
  categories: ProductCategory[];
  oilGrades?: OilGradeRecord[];
  commissionConfig: CommissionConfig;
  generalSettings: SystemGeneralSettings;
  commissionLogs: CommissionSettingLog[];
  auditLogs: AuditLogEntry[];
  priceListImports: PriceListImportRecord[];
  commissionAnalytics: OwnerCommissionAnalytics;
  systemCounts?: OwnerSystemOverviewCounts;
  backups?: BackupRecord[];
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
  tokenOverride?: string
): Promise<T> {
  const token = tokenOverride || (await getInMemoryIdToken());
  if (!token) {
    throw new ApiRequestError('يرجى تسجيل الدخول أولاً.', 401);
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const activeStepUp = getOwnerStepUpToken();
  if (activeStepUp && !headers.has('X-Owner-Reauth')) {
    headers.set('X-Owner-Reauth', activeStepUp);
  }
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  const method = (options.method || 'GET').toUpperCase();
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (netErr) {
    if (method === 'GET') {
      try {
        await new Promise((resolve) => setTimeout(resolve, 600));
        response = await fetch(url, {
          ...options,
          headers,
        });
      } catch {
        throw new ApiRequestError(
          'تعذر الاتصال بالخادم حالياً. تحقق من الشبكة أو حاول مرة أخرى.',
          0
        );
      }
    } else {
      throw new ApiRequestError(
        netErr instanceof TypeError
          ? 'تعذر الوصول إلى الخادم لتنفيذ العملية. يرجى المحاولة مرة أخرى.'
          : netErr instanceof Error && netErr.message
            ? netErr.message
            : 'تعذر الاتصال بالخادم لتنفيذ العملية.',
        0
      );
    }
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    let errorBody: { error?: string; requiresOwnerReauth?: boolean } = {};
    if (rawText) {
      try {
        errorBody = JSON.parse(rawText) as { error?: string; requiresOwnerReauth?: boolean };
      } catch {
        errorBody = {};
      }
    }
    if (response.status === 428 || errorBody.requiresOwnerReauth) {
      setOwnerStepUpToken(null);
    }

    const bodyMessage =
      typeof errorBody.error === 'string' && errorBody.error.trim()
        ? errorBody.error.trim()
        : '';

    const statusFallback =
      response.status === 400
        ? 'البيانات المرسلة غير صالحة أو غير مكتملة.'
        : response.status === 401
          ? 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.'
          : response.status === 403
            ? 'ليس لديك صلاحية كافية لتنفيذ هذه العملية.'
            : response.status === 404
              ? 'الخدمة المطلوبة غير متاحة على الخادم.'
              : response.status === 409
                ? 'تم تنفيذ هذه العملية مسبقاً أو يوجد تعارض في البيانات.'
                : response.status === 502 || response.status === 503 || response.status === 504
                  ? 'الخادم أو قاعدة البيانات غير متاحة مؤقتاً. يرجى المحاولة بعد لحظات.'
                  : `فشلت العملية على الخادم (رمز الحالة ${response.status}).`;

    throw new ApiRequestError(
      bodyMessage || statusFallback,
      response.status,
      Boolean(errorBody.requiresOwnerReauth || response.status === 428)
    );
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  getWorkspace: (tokenOverride?: string) =>
    apiRequest<WorkspacePayload>('/api/workspace', {}, tokenOverride),

  queryOrders: (params: OrderQueryParams = {}) => {
    const searchParams = new URLSearchParams();
    if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params.dateType) searchParams.set('dateType', params.dateType);
    if (params.preset) searchParams.set('preset', params.preset);
    if (params.status) searchParams.set('status', params.status);
    if (params.queue) searchParams.set('queue', params.queue);
    if (params.search) searchParams.set('search', params.search);
    if (params.governorate) searchParams.set('governorate', params.governorate);
    const qs = searchParams.toString();
    return apiRequest<OrderQueryResponse>(`/api/orders${qs ? `?${qs}` : ''}`);
  },

  createOrder: (orderData: Omit<Order, 'id' | 'createdAt'>) =>
    apiRequest<Order>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    }),

  updateOrder: (orderId: string, orderData: UpdateOrderPayload) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      body: JSON.stringify(orderData),
    }),

  confirmOrder: (orderId: string) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/confirm`, {
      method: 'POST',
    }),

  reviewOrderRevision: (
    orderId: string,
    status:
      | 'تمت مراجعة التعديل واعتماده'
      | 'يحتاج إعادة تجهيز'
      | 'تمت إعادة التجهيز'
      | 'تمت مراجعة التعديل'
      | 'التعديل جاهز لاستكمال التجهيز',
    note?: string
  ) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/revision-review`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),

  manageOrderItemSourcing: (orderId: string, payload: ManageItemSourcingPayload) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/sourcing`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getStockMovements: (orderId?: string) =>
    apiRequest<StockMovementEntry[]>(
      `/api/stock-movements${orderId ? `?orderId=${encodeURIComponent(orderId)}` : ''}`
    ),

  cancelOrder: (orderId: string, reason: string) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  submitOrderEditRequest: (
    orderId: string,
    requestData: Omit<OrderEditRequest, 'requestedById' | 'requestedByName' | 'requestedAt'>
  ) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/edit-request`, {
      method: 'POST',
      body: JSON.stringify(requestData),
    }),

  resolveOrderEditRequest: (
    orderId: string,
    action: 'approve' | 'reject',
    overrideData?: Omit<Order, 'id' | 'createdAt'>
  ) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/edit-request/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, overrideData }),
    }),

  updateOrderStatus: (
    orderId: string,
    status: OrderStatus,
    options?: OrderStatusTransitionPayload
  ) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...(options || {}) }),
    }),

  holdOrder: (
    orderId: string,
    payload: { isHeld: boolean; reason?: string; notes?: string }
  ) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/hold`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateOperationalNotes: (orderId: string, operationalNotes: string) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/operational-notes`, {
      method: 'PATCH',
      body: JSON.stringify({ operationalNotes }),
    }),

  deleteOrder: (orderId: string) =>
    apiRequest<{ ok: boolean }>(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
    }),

  createCustomer: (customerData: {
    name: string;
    phone: string;
    address?: string;
    assignedSalesRepId?: string | null;
  }) =>
    apiRequest<Customer>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(customerData),
    }),

  updateCustomer: (
    customerId: string,
    customerData: {
      name: string;
      phone?: string;
      address?: string;
      assignedSalesRepId?: string | null;
    }
  ) =>
    apiRequest<{ customer: Customer; linkedOrdersSynced: number }>(
      `/api/customers/${encodeURIComponent(customerId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(customerData),
      }
    ),

  deleteCustomer: (customerId: string) =>
    apiRequest<{ ok: boolean }>(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'DELETE',
    }),

  createProduct: (productData: Partial<Omit<Product, 'id'>> & Pick<Product, 'name' | 'pricePerMg' | 'stock'>) =>
    apiRequest<Product>('/api/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    }),

  updateProduct: (product: Product) =>
    apiRequest<{ ok: boolean }>(`/api/products/${encodeURIComponent(product.id)}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    }),

  getProductUsage: (productId: string) =>
    apiRequest<ProductUsageSummary>(`/api/products/${encodeURIComponent(productId)}/usage`),

  archiveProduct: (productId: string, isActive: boolean, reason?: string) =>
    apiRequest<Product>(`/api/products/${encodeURIComponent(productId)}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive, reason }),
    }),

  deleteProduct: (productId: string, confirmPassword?: string) =>
    apiRequest<{ ok: boolean; deletedId: string }>(
      `/api/products/${encodeURIComponent(productId)}`,
      {
        method: 'DELETE',
        body: confirmPassword ? JSON.stringify({ confirmPassword }) : undefined,
      }
    ),

  createTeamMember: (
    userData: Omit<User, 'id'> & { password?: string },
    initialRepData?: Partial<SalesRep>
  ) =>
    apiRequest<{ ok: boolean }>('/api/team-members', {
      method: 'POST',
      body: JSON.stringify({ userData, initialRepData }),
    }),

  updateTeamMember: (user: User & { newPassword?: string }) =>
    apiRequest<{ ok: boolean }>(`/api/team-members/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      body: JSON.stringify(user),
    }),

  updateSalesRep: (rep: SalesRep & { reason?: string }) =>
    apiRequest<{ ok: boolean }>(`/api/sales-reps/${encodeURIComponent(rep.id)}`, {
      method: 'PUT',
      body: JSON.stringify(rep),
    }),

  updateOwnerRepCommissions: (
    repId: string,
    payload: {
      categoryRates?: Record<string, number>;
      customCommissionRate?: number;
      reason?: string;
    },
    confirmPassword?: string
  ) =>
    apiRequest<{ ok: boolean }>(
      `/api/owner/sales-reps/${encodeURIComponent(repId)}/commissions`,
      {
        method: 'PUT',
        body: JSON.stringify({ ...payload, confirmPassword }),
      }
    ),

  sendChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) =>
    apiRequest<ChatMessage>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(msg),
    }),

  // ===================================================================
  // Owner (Super Admin), Categories, Commission & PDF Price List APIs
  // ===================================================================

  getOwnerBootstrapStatus: () =>
    apiRequest<{
      hasOwnerAccount: boolean;
      canBootstrapOwner: boolean;
      hasPartialBootstrapState: boolean;
      currentUserRole: string;
      eligibleForBootstrap: boolean;
    }>('/api/owner/bootstrap-status'),

  claimInitialOwner: (currentPassword: string, recoveryKey: string) =>
    apiRequest<{ token: string; user: User; workspace: WorkspacePayload }>('/api/owner/claim', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, recoveryKey }),
    }),

  verifyOwnerIdentity: async (password: string) => {
    const res = await apiRequest<{ stepUpToken: string; expiresInSeconds: number }>(
      '/api/owner/verify-identity',
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    );
    setOwnerStepUpToken(res.stepUpToken, res.expiresInSeconds);
    return res;
  },

  setOwnerRecoveryKey: (recoveryKey: string, confirmPassword?: string) =>
    apiRequest<{ ok: boolean }>('/api/owner/recovery-key', {
      method: 'POST',
      body: JSON.stringify({ recoveryKey, confirmPassword }),
    }),

  recoverOwnerAccess: async (username: string, recoveryKey: string, newPassword: string) => {
    const response = await fetch('/api/owner/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, recoveryKey, newPassword }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiRequestError(data.error || 'فشل استعادة حساب المالك.', response.status);
    }
    return data as { token: string; user: User; workspace: WorkspacePayload };
  },

  getOwnerOverview: () => apiRequest<OwnerOverviewPayload>('/api/owner/overview'),

  exportOwnerBackup: (confirmPassword?: string) =>
    apiRequest<{
      exportedAt: string;
      exportedBy: string;
      counts: Record<string, number>;
      data: Record<string, unknown>;
    }>('/api/owner/backup', {
      method: 'POST',
      body: JSON.stringify({ confirmPassword }),
    }),

  listOwnerBackups: () => apiRequest<BackupRecord[]>('/api/owner/backups'),

  createOwnerBackup: (name?: string, confirmPassword?: string) =>
    apiRequest<{ record: BackupRecord; fileName: string; manifest: BackupManifest }>(
      '/api/owner/backups/create',
      {
        method: 'POST',
        body: JSON.stringify({ name, confirmPassword }),
      }
    ),

  downloadOwnerBackupZip: async (backupId: string, preferredFileName?: string) => {
    const token = await getInMemoryIdToken();
    if (!token) throw new ApiRequestError('يرجى تسجيل الدخول أولاً.', 401);
    const stepUp = getOwnerStepUpToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (stepUp) headers['X-Owner-Reauth'] = stepUp;
    const res = await fetch(`/api/owner/backups/${encodeURIComponent(backupId)}/download`, {
      headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 428 || err.requiresOwnerReauth) setOwnerStepUpToken(null);
      throw new ApiRequestError(
        err.error || 'فشل تنزيل ملف النسخة الاحتياطية.',
        res.status,
        Boolean(err.requiresOwnerReauth || res.status === 428)
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preferredFileName || `KimaScent-Backup-${backupId.slice(-6)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  verifyStoredOwnerBackup: (backupId: string) =>
    apiRequest<BackupInspectionReport>(
      `/api/owner/backups/${encodeURIComponent(backupId)}/verify`,
      { method: 'POST' }
    ),

  deleteOwnerBackup: (backupId: string, confirmPassword?: string) =>
    apiRequest<{ ok: boolean }>(`/api/owner/backups/${encodeURIComponent(backupId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmPassword }),
    }),

  inspectBackupZipFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<BackupInspectionReport>('/api/owner/backups/inspect', {
      method: 'POST',
      body: formData,
    });
  },

  restoreBackupZip: (options: {
    file?: File | null;
    backupId?: string | null;
    mode: 'isolated_sandbox' | 'live_replace';
    confirmationPhrase?: string;
    confirmPassword?: string;
  }) => {
    if (options.file) {
      const formData = new FormData();
      formData.append('file', options.file);
      formData.append('mode', options.mode);
      if (options.confirmationPhrase) {
        formData.append('confirmationPhrase', options.confirmationPhrase);
      }
      if (options.confirmPassword) {
        formData.append('confirmPassword', options.confirmPassword);
      }
      return apiRequest<RestoreExecutionReport>('/api/owner/backups/restore', {
        method: 'POST',
        body: formData,
      });
    }
    return apiRequest<RestoreExecutionReport>('/api/owner/backups/restore', {
      method: 'POST',
      body: JSON.stringify({
        backupId: options.backupId,
        mode: options.mode,
        confirmationPhrase: options.confirmationPhrase,
        confirmPassword: options.confirmPassword,
      }),
    });
  },

  previewOwnerSystemReset: (scope: SystemResetScope) =>
    apiRequest<SystemResetPreview>('/api/owner/system-reset/preview', {
      method: 'POST',
      body: JSON.stringify(scope),
    }),

  executeOwnerSystemReset: (scope: SystemResetScope, confirmPassword?: string) =>
    apiRequest<SystemResetResult>('/api/owner/system-reset', {
      method: 'POST',
      body: JSON.stringify({ ...scope, confirmPassword }),
    }),

  updateSystemGeneralSettings: (
    settings: Partial<SystemGeneralSettings>,
    confirmPassword?: string
  ) =>
    apiRequest<SystemGeneralSettings>('/api/owner/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...settings, confirmPassword }),
    }),

  updateCommissionSettings: (
    config: Partial<CommissionConfig> & { reason?: string },
    confirmPassword?: string
  ) =>
    apiRequest<CommissionConfig>('/api/owner/commission-settings', {
      method: 'PUT',
      body: JSON.stringify({ ...config, confirmPassword }),
    }),

  createCategory: (
    category: Omit<ProductCategory, 'id' | 'createdAt'>,
    confirmPassword?: string
  ) =>
    apiRequest<ProductCategory>('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ ...category, confirmPassword }),
    }),

  updateCategory: (category: ProductCategory, confirmPassword?: string) =>
    apiRequest<ProductCategory>(`/api/categories/${encodeURIComponent(category.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...category, confirmPassword }),
    }),

  importPriceListPdf: (
    file: File,
    options?: { listCategoryId?: string | null; columnMapping?: PriceListColumnMapping | null }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.listCategoryId) {
      formData.append('listCategoryId', options.listCategoryId);
    }
    if (options?.columnMapping) {
      formData.append('columnMapping', JSON.stringify(options.columnMapping));
    }
    return apiRequest<PriceListImportRecord>('/api/price-lists/import', {
      method: 'POST',
      body: formData,
    });
  },

  remapPriceListImport: (
    importId: string,
    payload: { listCategoryId?: string; columnMapping?: PriceListColumnMapping }
  ) =>
    apiRequest<PriceListImportRecord>(
      `/api/price-lists/${encodeURIComponent(importId)}/remap`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  getPriceListImports: () => apiRequest<PriceListImportRecord[]>('/api/price-lists'),

  approvePriceListImport: (
    importId: string,
    items: PriceListParsedItem[],
    confirmPassword?: string
  ) =>
    apiRequest<PriceListImportRecord>(
      `/api/price-lists/${encodeURIComponent(importId)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ items, confirmPassword }),
      }
    ),

  getOilGrades: () => apiRequest<OilGradeRecord[]>('/api/oil-grades'),

  createOilGrade: (payload: {
    name: string;
    slug?: string;
    sortOrder?: number;
    isActive?: boolean;
    aliases?: string[];
    description?: string | null;
  }) =>
    apiRequest<OilGradeRecord>('/api/oil-grades', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateOilGrade: (grade: Partial<OilGradeRecord> & { id: string }) =>
    apiRequest<OilGradeRecord>(`/api/oil-grades/${encodeURIComponent(grade.id)}`, {
      method: 'PUT',
      body: JSON.stringify(grade),
    }),

  cancelPriceListImport: (importId: string) =>
    apiRequest<{ ok: boolean }>(
      `/api/price-lists/${encodeURIComponent(importId)}/cancel`,
      {
        method: 'POST',
      }
    ),

  deletePriceListImport: (importId: string, confirmPassword?: string) =>
    apiRequest<{ deletedCount: number; deletedIds: string[]; deletedFiles: string[] }>(
      `/api/price-lists/${encodeURIComponent(importId)}`,
      {
        method: 'DELETE',
        body: confirmPassword ? JSON.stringify({ confirmPassword }) : undefined,
      }
    ),

  deletePriceListImportsBulk: (ids: string[], confirmPassword?: string) =>
    apiRequest<{ deletedCount: number; deletedIds: string[]; deletedFiles: string[] }>(
      '/api/price-lists/archive/delete',
      {
        method: 'POST',
        body: JSON.stringify({ ids, confirmPassword }),
      }
    ),

  downloadPriceListOriginalFile: async (importId: string, fileName: string) => {
    const token = await getInMemoryIdToken();
    if (!token) throw new ApiRequestError('يرجى تسجيل الدخول أولاً.', 401);
    const res = await fetch(`/api/price-lists/${encodeURIComponent(importId)}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiRequestError(err.error || 'فشل تنزيل الملف الأصلي.', res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'price-list.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // ===================================================================
  // BI Analytics, Reports, Real Excel Export & Bulk Operations
  // ===================================================================

  getOwnerBiDashboard: (filters: BiFilterParams = {}) => {
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const qs = sp.toString();
    return apiRequest<OwnerBiDashboardData>(`/api/analytics/owner-bi${qs ? `?${qs}` : ''}`);
  },

  getSalesRepAnalytics: (filters: BiFilterParams = {}) => {
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const qs = sp.toString();
    return apiRequest<{
      appliedRange: OwnerBiDashboardData['appliedRange'];
      reps: SalesRepAnalyticsRow[];
    }>(`/api/analytics/sales-reps${qs ? `?${qs}` : ''}`);
  },

  getCustomerAnalytics: (
    filters: BiFilterParams & {
      repeatFilter?: CustomerRepeatFilter;
      customMinOrders?: number;
      dormancyDays?: number;
      search?: string;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
    } = {}
  ) => {
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const qs = sp.toString();
    return apiRequest<{
      appliedRange: OwnerBiDashboardData['appliedRange'];
      dormancyDays: number;
      summary: {
        totalCustomers: number;
        repeatCustomersCount: number;
        oneTimeBuyersCount: number;
        dormantCustomersCount: number;
        totalPeriodRevenue: number;
      };
      customers: CustomerAnalyticsRow[];
    }>(`/api/analytics/customers${qs ? `?${qs}` : ''}`);
  },

  getReorderRecommendations: (params: {
    lookbackDays?: number;
    leadTimeDays?: number;
    safetyDays?: number;
    categoryId?: string;
  } = {}) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const qs = sp.toString();
    return apiRequest<{
      lookbackDays: number;
      leadTimeDays: number;
      safetyDays: number;
      recommendations: ReorderRecommendationRow[];
    }>(`/api/analytics/reorder-recommendations${qs ? `?${qs}` : ''}`);
  },

  listExternalSourcingRecords: (params: {
    orderId?: string;
    productId?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const qs = sp.toString();
    return apiRequest<ExternalSourcingRecord[]>(`/api/external-sourcing${qs ? `?${qs}` : ''}`);
  },

  updateExternalSourcingCost: (
    recordId: string,
    patch: {
      supplierName?: string | null;
      unitCost?: number | null;
      totalSourcingCost?: number | null;
      dateSecured?: string;
      notes?: string | null;
    }
  ) =>
    apiRequest<ExternalSourcingRecord>(`/api/external-sourcing/${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getUnifiedReport: (
    reportType: UnifiedReportType,
    filters: BiFilterParams & {
      repeatFilter?: CustomerRepeatFilter;
      dormancyDays?: number;
      search?: string;
    } = {}
  ) => {
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const qs = sp.toString();
    return apiRequest<UnifiedReportClientPayload>(
      `/api/reports/${encodeURIComponent(reportType)}${qs ? `?${qs}` : ''}`
    );
  },

  downloadUnifiedReportExcel: async (
    reportType: UnifiedReportType,
    filters: BiFilterParams & {
      repeatFilter?: CustomerRepeatFilter;
      dormancyDays?: number;
      search?: string;
    } = {}
  ) => {
    const token = await getInMemoryIdToken();
    if (!token) throw new ApiRequestError('يرجى تسجيل الدخول أولاً.', 401);
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const qs = sp.toString();
    const res = await fetch(
      `/api/reports/${encodeURIComponent(reportType)}/export.xlsx${qs ? `?${qs}` : ''}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiRequestError(err.error || 'فشل تصدير ملف Excel.', res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KimaScent-${reportType}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  previewBulkProducts: (payload: Record<string, unknown>) =>
    apiRequest<BulkPreviewResult>('/api/bulk/products/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeBulkProducts: (payload: Record<string, unknown>) =>
    apiRequest<BulkExecuteResult>('/api/bulk/products/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  previewBulkInventory: (payload: Record<string, unknown>) =>
    apiRequest<BulkPreviewResult>('/api/bulk/inventory/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeBulkInventory: (payload: Record<string, unknown>) =>
    apiRequest<BulkExecuteResult>('/api/bulk/inventory/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  previewBulkCustomers: (payload: Record<string, unknown>) =>
    apiRequest<BulkPreviewResult>('/api/bulk/customers/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeBulkCustomers: (payload: Record<string, unknown>) =>
    apiRequest<BulkExecuteResult>('/api/bulk/customers/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  previewBulkOrders: (payload: Record<string, unknown>) =>
    apiRequest<BulkPreviewResult>('/api/bulk/orders/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeBulkOrders: (payload: Record<string, unknown>) =>
    apiRequest<BulkExecuteResult>('/api/bulk/orders/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

