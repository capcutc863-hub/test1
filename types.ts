
export type OrderStatus =
  | 'بانتظار تأكيد العميل'
  | 'طلب جديد'
  | 'بانتظار التجهيز'
  | 'جاري التجهيز'
  | 'تم التجهيز'
  | 'تم الشحن'
  | 'تم التسليم'
  | 'مرتجع'
  | 'رفض استلام'
  | 'ملغي'
  | 'قيد التنفيذ'; // Legacy status preserved for historical invoices

export type UserRole = 'owner' | 'admin' | 'supervisor' | 'sales';
export type OilGrade = 'عالي (Code A)' | 'وسط (Code B)' | 'تجاري (Code C)' | string;

export type ProductUnit =
  | 'mg'
  | 'جرام'
  | 'كيلوجرام'
  | 'قطعة'
  | 'عبوة'
  | 'دستة'
  | 'كرتونة'
  | 'جركن'
  | 'لتر'
  | 'ملليلتر'
  | string;

export type CommissionMode = 'inherit_rep' | 'fixed_rate' | 'fixed_per_unit' | 'none';

export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  defaultUnit: ProductUnit;
  defaultCommissionEligible: boolean;
  defaultCommissionRate?: number | null;
  isActive: boolean;
  description?: string;
  createdAt?: string;
}

export interface MonthlyCommission {
  month: string;
  amount: number;
  ordersCount: number;
}

export interface User {
  id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  username: string;
  role: UserRole;
  salesRepId?: string;
  isSuspended: boolean;
  isMuted: boolean;
  canEditInventory: boolean;
  canConfirmDelivery: boolean; // صلاحية تأكيد التسليم
  canManageOrderStatus?: boolean; // صلاحية إدارة التجهيز والشحن والمتابعة حتى التسليم/المرتجع وطلبات التعديل
  canDeleteOrders?: boolean; // صلاحية حذف الفواتير
  canDeleteCustomers?: boolean; // صلاحية حذف العملاء
  address?: string;
  startDate?: string;
  online?: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  description?: string;
  unit: ProductUnit;
  grade: OilGrade;
  pricePerMg: number; // Selling price per unit (kept as pricePerMg for compatibility)
  costPrice?: number | null;
  stock: number;
  isActive: boolean;
  isCommissionEligible: boolean;
  commissionMode: CommissionMode;
  customCommissionRate?: number | null;
  customCommissionFixed?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export type OrderReturnPrimaryReason =
  | 'رفض الاستلام'
  | 'العميل لم يرد'
  | 'العنوان غير صحيح'
  | 'العميل طلب الإلغاء'
  | 'سبب آخر';

export interface CustomerReturnHistoryEntry {
  orderId: string;
  outcome: 'مرتجع' | 'رفض استلام';
  reason: OrderReturnPrimaryReason;
  details: string;
  customerRefusedDelivery: boolean;
  customerNoAnswer: boolean;
  invalidAddress: boolean;
  customerRequestedCancel: boolean;
  otherReason: boolean;
  recordedAt: string;
  recordedByName: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  totalSpent: number;
  classification: 'ذهبي' | 'فضي' | 'عادي';
  lastOrderDate: string;
  returnHistory?: CustomerReturnHistoryEntry[];
}

export interface SalesRep {
  id: string;
  userId: string;
  name: string;
  totalCommission: number; // العمولات المكتسبة (تم التسليم)
  pendingCommission: number; // العمولات المعلقة (قيد التشغيل)
  ordersCount: number;
  maxDiscountAllowed: number;
  customCommissionRate: number;
  categoryRates?: Record<string, number>;
  monthlyHistory: MonthlyCommission[];
}

export type ItemSourcingSource =
  | 'من المخزون الحالي'
  | 'توفير من المورد'
  | 'توفير خارجي دون إدخاله إلى المخزن'
  | 'بانتظار التوفير';

export type ItemProcurementStatus = 'pending' | 'fulfilled';

export interface OrderItem {
  productId?: string;
  productCode?: string;
  productName: string;
  categoryId?: string;
  categoryName?: string;
  unit?: ProductUnit;
  grade: OilGrade;
  quantity: number;
  price: number;
  isCommissionEligible?: boolean;
  commissionRateApplied?: number;
  commissionAmount?: number;
  isCustom?: boolean;
  addToInventory?: boolean;
  sourcingSource?: ItemSourcingSource;
  warehouseDeductedQty?: number;
  externalSuppliedQty?: number;
  pendingQty?: number;
  procurementStatus?: ItemProcurementStatus;
  supplierName?: string;
  sourcingNotes?: string;
  receivedIntoWarehouse?: boolean;
  sourcingUpdatedBy?: string;
  sourcingUpdatedAt?: string;
}

export interface OrderEditRequest {
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  reason?: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  governorate?: string;
  customerNotes?: string;
  salesRepId: string;
  salesRepName: string;
  items: OrderItem[];
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  commission: number;
}

export interface OrderStatusHistoryEntry {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedById: string;
  changedByName: string;
  changedByRole: UserRole;
  changedAt: string;
  note?: string;
}

export interface OrderShippingEntry {
  carrier?: string;
  trackingNumber?: string;
  shippedAt: string;
  shippedById: string;
  shippedByName: string;
  notes?: string;
}

export interface OrderShippingInfo {
  carrier?: string;
  trackingNumber?: string;
  shippedAt: string;
  shippedById: string;
  shippedByName: string;
  notes?: string;
  history?: OrderShippingEntry[];
}

export interface OrderDeliveryInfo {
  deliveredAt: string;
  confirmedById: string;
  confirmedByName: string;
  notes?: string;
}

export interface OrderReturnInfo {
  outcome: 'مرتجع' | 'رفض استلام';
  reason: OrderReturnPrimaryReason;
  details: string;
  customerRefusedDelivery: boolean;
  customerNoAnswer: boolean;
  invalidAddress: boolean;
  customerRequestedCancel: boolean;
  otherReason: boolean;
  recordedAt: string;
  recordedById: string;
  recordedByName: string;
}

export interface OrderHoldInfo {
  isHeld: boolean;
  reason: string;
  notes?: string;
  heldAtStage: OrderStatus;
  heldAt: string;
  heldById: string;
  heldByName: string;
  releasedAt?: string;
  releasedById?: string;
  releasedByName?: string;
}

export type RevisionAlertStatus =
  | 'none'
  | 'لا يوجد تعديل معلق'
  | 'تعديل جديد يحتاج المراجعة'
  | 'تمت مراجعة التعديل واعتماده'
  | 'يحتاج إعادة تجهيز'
  | 'تمت إعادة التجهيز'
  | 'تمت مراجعة التعديل'
  | 'التعديل جاهز لاستكمال التجهيز';

export interface OrderRevisionItemDiff {
  productName: string;
  grade: OilGrade;
  unit?: ProductUnit;
  changeType: 'added' | 'removed' | 'modified';
  oldQuantity: number;
  newQuantity: number;
  quantityDelta: number;
  oldPrice: number;
  newPrice: number;
}

export interface OrderRevisionEntry {
  id: string;
  orderId: string;
  fromVersion: number;
  toVersion: number;
  editedById: string;
  editedByName: string;
  editedByRole: UserRole;
  editedAt: string;
  reason?: string;
  orderStatusAtEdit: OrderStatus;
  addedItems: OrderRevisionItemDiff[];
  removedItems: OrderRevisionItemDiff[];
  modifiedItems: OrderRevisionItemDiff[];
  previousItemCount: number;
  newItemCount: number;
  previousTotal: number;
  newTotal: number;
  previousCommission: number;
  newCommission: number;
  requiresRePreparation?: boolean;
  reviewStatus: RevisionAlertStatus;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface OrderRevisionAlert {
  status: RevisionAlertStatus;
  latestRevisionId?: string;
  latestVersion: number;
  editedByName: string;
  editedAt: string;
  summary: string;
  requiresRePreparation?: boolean;
  hasPendingEditRequest?: boolean;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface OrderCancellationInfo {
  cancelledById: string;
  cancelledByName: string;
  cancelledByRole: UserRole;
  cancelledAt: string;
  reason: string;
  stageAtCancellation: OrderStatus;
  wasConfirmed: boolean;
  notifiedOperations: boolean;
}

export interface AuditLogEntry {
  id: string;
  orderId?: string | null;
  actionType: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface StockMovementEntry {
  id: string;
  productId?: string | null;
  productName: string;
  grade: OilGrade;
  unit?: ProductUnit;
  orderId?: string | null;
  movementType:
    | 'order_deduction'
    | 'order_delta_deduction'
    | 'order_delta_restore'
    | 'supplier_receipt'
    | 'order_allocation'
    | 'external_direct'
    | 'manual_adjustment';
  sourcingSource: ItemSourcingSource;
  quantityDelta: number;
  orderQuantityCovered: number;
  previousStock: number;
  newStock: number;
  supplierName?: string | null;
  note?: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  createdAt: string;
}

export type OrderDateField =
  | 'createdAt'
  | 'confirmedAt'
  | 'prepStartedAt'
  | 'prepCompletedAt'
  | 'shippedAt'
  | 'deliveredAt'
  | 'cancelledAt'
  | 'returnedAt';

export type OrderDatePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'custom';

export interface OrdersQueryStats {
  totalOrders: number;
  activeOrdersCount: number;
  draftOrdersCount: number;
  preparedOrdersCount: number;
  shippedOrdersCount: number;
  deliveredOrdersCount: number;
  cancelledOrdersCount: number;
  returnedOrdersCount: number;
  totalRevenue: number;
  deliveredRevenue: number;
  totalCommission: number;
  pendingCommission: number;
  needsReviewCount: number;
  pendingProcurementCount: number;
}

export interface OrderCommissionSnapshot {
  method: 'product_eligibility_net_after_discount';
  repBaseRate: number;
  defaultOilRate: number;
  repCategoryRates?: Record<string, number>;
  categoryDefaultRates?: Record<string, number>;
  discountPercentage: number;
  commissionableSubtotal: number;
  nonCommissionableSubtotal: number;
  computedCommission: number;
  capturedAt: string;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  governorate?: string;
  customerNotes?: string;
  operationalNotes?: string;
  salesRepId: string;
  salesRepName: string;
  items: OrderItem[];
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  commission: number;
  commissionableSubtotal?: number;
  commissionRateSnapshot?: number;
  commissionRuleSnapshot?: OrderCommissionSnapshot | null;
  version?: number;
  confirmedAt?: string | null;
  confirmedById?: string | null;
  confirmedByName?: string | null;
  prepStartedAt?: string | null;
  prepCompletedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  returnedAt?: string | null;
  pendingEditRequest?: OrderEditRequest | null;
  statusHistory?: OrderStatusHistoryEntry[];
  shippingInfo?: OrderShippingInfo | null;
  deliveryInfo?: OrderDeliveryInfo | null;
  returnInfo?: OrderReturnInfo | null;
  holdInfo?: OrderHoldInfo | null;
  revisionAlert?: OrderRevisionAlert | null;
  revisions?: OrderRevisionEntry[];
  cancellationInfo?: OrderCancellationInfo | null;
}

export interface CommissionConfig {
  defaultOilCommissionRate: number; // e.g., 0.05 = 5%
  useSalesRepCustomRateWhenInherited: boolean;
  accrualTrigger: 'delivery';
  calculationBasis: 'net_commissionable_after_discount';
  packagingDefaultEligible: boolean;
  alcoholDefaultEligible: boolean;
  chemicalsDefaultEligible: boolean;
  otherDefaultEligible: boolean;
  updatedAt?: string;
  updatedByName?: string;
}

export interface SystemGeneralSettings {
  companyName: string;
  defaultShippingCost: number;
  lowStockThresholdOils: number;
  lowStockThresholdOther: number;
  allowCustomItemsInInvoices: boolean;
}

export interface CommissionSettingLog {
  id: string;
  targetType: 'global_config' | 'product' | 'category' | 'sales_rep';
  targetId: string;
  targetName: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  reason?: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  createdAt: string;
}

export type PriceListMatchStatus = 'new' | 'matched' | 'duplicate_in_file' | 'needs_review';
export type PriceListSinglePriceMeaning = 'selling' | 'cost' | 'unresolved';

export type PriceListColumnRole =
  | 'ignore'
  | 'code'
  | 'name'
  | 'description'
  | 'unit'
  | 'sellingPrice'
  | 'costPrice'
  | 'pricePerKg'
  | 'pricePerGram';

export interface PriceListColumnMapping {
  hasHeaderRow?: boolean;
  columns: Record<number, PriceListColumnRole>;
  oilSourceUnit?: 'auto' | 'كيلوجرام' | 'جرام';
}

export interface PriceListParsedItem {
  rowKey: string;
  code: string;
  name: string;
  description: string;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  unit: ProductUnit;
  sellingPrice: number | null;
  costPrice: number | null;
  originalPrice?: number | null;
  originalPriceUnit?: ProductUnit | string | null;
  originalCostPrice?: number | null;
  conversionFactor?: number | null;
  conversionNote?: string | null;
  ambiguousSinglePrice: number | null;
  singlePriceMeaning: PriceListSinglePriceMeaning;
  matchStatus: PriceListMatchStatus;
  matchedBy?: 'code' | 'normalized_name' | null;
  matchedProductId?: string | null;
  matchedProductCurrent?: {
    id: string;
    code: string;
    name: string;
    categoryName: string;
    unit: string;
    pricePerMg: number;
    costPrice?: number | null;
    description?: string;
    stock: number;
  } | null;
  confidence: number; // 0..100
  warnings: string[];
  needsReview: boolean;
  selectedForImport: boolean;
  updateFields?: {
    name?: boolean;
    description?: boolean;
    category?: boolean;
    unit?: boolean;
    sellingPrice?: boolean;
    costPrice?: boolean;
  };
}

export interface PriceListImportRecord {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  extractionMethod: 'pdf_text' | 'pdf_ocr_gemini' | 'pdf_hybrid';
  status: 'pending_review' | 'approved' | 'cancelled';
  listCategoryId?: string | null;
  listCategoryName?: string | null;
  columnMapping?: PriceListColumnMapping | null;
  rawTableRows?: string[][];
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: string;
  approvedById?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  totalParsed: number;
  newCount: number;
  updatedCount: number;
  needsReviewCount: number;
  duplicateCount: number;
  parsedItems: PriceListParsedItem[];
  approvalSummary?: {
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    stockModified: false;
  } | null;
  errorMessage?: string | null;
  rawTextPreview?: string | null;
}

export interface OwnerCommissionAnalytics {
  commissionableDeliveredSales: number;
  commissionablePendingSales: number;
  nonCommissionableDeliveredSales: number;
  nonCommissionablePendingSales: number;
  earnedCommissionTotal: number;
  pendingCommissionTotal: number;
}

export type BackupVerificationStatus =
  | 'valid'
  | 'valid_with_warnings'
  | 'incomplete'
  | 'incompatible'
  | 'corrupted';

export interface BackupAttachmentMeta {
  importId: string;
  archivePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
}

export interface BackupManifest {
  backupId: string;
  name: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  appVersion: string;
  schemaVersion: number;
  backupType: 'full' | 'pre_restore_safety' | 'pre_reset_safety';
  databaseEngine: 'postgresql';
  tables: string[];
  recordCounts: Record<string, number>;
  attachmentsCount: number;
  attachments: BackupAttachmentMeta[];
  tableSha256s: Record<string, string>;
  excludedSensitiveFields: Record<string, string[]>;
  compatibility: {
    minSchemaVersion: number;
    schemaVersion: number;
    appVersion: string;
  };
  supportedRestoreModes: Array<'isolated_sandbox' | 'live_replace'>;
}

export interface BackupRecord {
  id: string;
  name: string;
  backupType: 'full' | 'pre_restore_safety' | 'pre_reset_safety';
  createdAt: string;
  createdById: string;
  createdByName: string;
  appVersion: string;
  schemaVersion: number;
  tablesCount: number;
  totalRecords: number;
  attachmentsCount: number;
  recordCounts: Record<string, number>;
  fileSizeBytes: number;
  zipSha256: string;
  storageMode: 'server_db' | 'downloaded_only';
  status: 'completed' | 'failed';
  verificationStatus: 'verified' | 'warnings' | 'failed';
  verificationNotes?: string | null;
  hasStoredArchive: boolean;
}

export interface BackupTableComparison {
  tableName: string;
  backupCount: number;
  liveCount: number;
  delta: number;
}

export interface BackupInspectionReport {
  validZip: boolean;
  status: BackupVerificationStatus;
  statusLabelAr: string;
  manifest: BackupManifest | null;
  zipSha256: string;
  zipSizeBytes: number;
  checksumMismatches: string[];
  missingTables: string[];
  unexpectedTables: string[];
  integrityErrors: string[];
  warnings: string[];
  tableComparison: BackupTableComparison[];
  willReplaceTables: string[];
  preservedProtections: string[];
}

export interface RestoreExecutionReport {
  mode: 'isolated_sandbox' | 'live_replace';
  preRestoreBackupId: string | null;
  sandboxSchemaName?: string | null;
  sandboxCleanedUp?: boolean;
  restoredAt: string;
  restoredTablesCount: number;
  restoredRecordsTotal: number;
  restoredAttachmentsCount: number;
  tableVerification: Array<{
    tableName: string;
    expectedCount: number;
    actualCount: number;
    matched: boolean;
  }>;
  relationalChecks: Array<{
    checkName: string;
    passed: boolean;
    details: string;
  }>;
  ownerPreserved: boolean;
}

export interface ProductUsageSummary {
  productId: string;
  code: string;
  name: string;
  categoryName: string;
  stock: number;
  isActive: boolean;
  ordersCount: number;
  sampleOrderIds: string[];
  stockMovementsCount: number;
  canDelete: boolean;
  isDemoCandidate: boolean;
}

export interface SystemResetScope {
  mode:
    | 'reset_sales'
    | 'reset_stock'
    | 'reset_customers'
    | 'reset_demo_products'
    | 'reset_extras'
    | 'reset_full';
  customerAction?: 'archive_only' | 'reset_balances' | 'delete_unlinked_and_demo' | 'delete_all';
  selectedDemoProductIds?: string[];
  clearChatMessages?: boolean;
  clearPriceListImports?: boolean;
  clearOperationalLogs?: boolean;
  reason?: string;
  confirmationPhrase?: string;
  verifiedBackupId?: string;
}

export interface SystemResetPreview {
  mode: SystemResetScope['mode'];
  ordersCount: number;
  customersSummary?: {
    totalCount: number;
    linkedCount: number;
    unlinkedCount: number;
    demoCount: number;
    unlinkedSample: Array<{ id: string; name: string; phone: string; isDemo: boolean }>;
  };
  stockSummary?: {
    totalProducts: number;
    nonZeroProductsCount: number;
    totalUnitsToZero: number;
  };
  demoProductsSummary?: {
    totalProducts: number;
    eligibleToDelete: Array<{
      id: string;
      code: string;
      name: string;
      categoryName: string;
      stock: number;
      reason: string;
    }>;
    blockedLinked: Array<{
      id: string;
      code: string;
      name: string;
      categoryName: string;
      ordersCount: number;
      stockMovementsCount: number;
    }>;
  };
  extrasSummary?: {
    chatMessagesCount: number;
    priceListImportsCount: number;
    commissionLogsCount: number;
    operationalAuditLogsCount: number;
  };
  warnings: string[];
}

export interface SystemResetResult {
  executedAt: string;
  mode: SystemResetScope['mode'];
  preResetBackupId?: string | null;
  affectedCounts: Record<string, number>;
  preservedSummary: string[];
  warnings: string[];
}

export interface OwnerSystemOverviewCounts {
  usersCount: number;
  salesRepsCount: number;
  categoriesCount: number;
  productsCount: number;
  customersCount: number;
  ordersCount: number;
  stockMovementsCount: number;
  priceListImportsCount: number;
  backupsCount: number;
  lastVerifiedBackupAt?: string | null;
  lastVerifiedBackupId?: string | null;
}

