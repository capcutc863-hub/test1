
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

export interface OilGradeRecord {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  aliases: string[];
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductPriceHistoryEntry {
  id: string;
  productId: string;
  productCode?: string | null;
  productName: string;
  grade: string;
  previousSellingPrice: number | null;
  newSellingPrice: number | null;
  previousCostPrice: number | null;
  newCostPrice: number | null;
  unit: string;
  sourceType: 'manual' | 'pdf_import' | 'bulk_update' | 'product_created';
  importBatchId?: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  note?: string | null;
  createdAt: string;
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
  gradeId?: string | null;
  baseProductName?: string | null;
  baseProductKey?: string | null;
  pricePerMg: number; // Selling price per unit (kept as pricePerMg for compatibility)
  costPrice?: number | null;
  costUpdatedAt?: string | null;
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
  assignedSalesRepId?: string | null;
  assignedSalesRepName?: string | null;
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
  externalUnitCost?: number | null;
  externalTotalCost?: number | null;
  supplierDateSecured?: string;
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
    | 'manual_adjustment'
    | 'bulk_set_stock'
    | 'bulk_add_stock';
  sourcingSource: ItemSourcingSource;
  quantityDelta: number;
  orderQuantityCovered: number;
  previousStock: number;
  newStock: number;
  supplierName?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  createdAt: string;
}

export interface ExternalSourcingRecord {
  id: string;
  orderId: string;
  itemIndex: number;
  productId?: string | null;
  productCode?: string | null;
  productName: string;
  categoryId?: string | null;
  categoryName?: string | null;
  unit: ProductUnit;
  sourcingType: 'supplier_receipt' | 'external_direct';
  supplierName?: string | null;
  externalQty: number;
  unitCost?: number | null;
  totalSourcingCost?: number | null;
  dateSecured: string;
  notes?: string | null;
  idempotencyKey?: string | null;
  recordedById: string;
  recordedByName: string;
  recordedAt: string;
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
export type PriceListImportActionMode = 'update_and_add' | 'update_only' | 'add_only';

export type PriceListColumnRole =
  | 'ignore'
  | 'serial'
  | 'code'
  | 'name'
  | 'description'
  | 'unit'
  | 'sellingPrice'
  | 'costPrice'
  | 'pricePerKg'
  | 'pricePerGram';

export interface PriceListColumnAssignment {
  role: PriceListColumnRole;
  gradeId?: string | null;
  gradeName?: string | null;
  unit?: ProductUnit | null;
}

export interface PriceListColumnMapping {
  hasHeaderRow?: boolean;
  columns: Record<number, PriceListColumnRole>;
  columnConfigs?: Record<number, PriceListColumnAssignment>;
  oilSourceUnit?: 'auto' | 'كيلوجرام' | 'جرام';
  sourceUnit?: ProductUnit | 'unconfirmed' | 'auto';
  targetUnit?: ProductUnit;
  unitConfirmedByUser?: boolean;
  conversionFactor?: number;
  defaultGradeName?: string;
}

export interface PriceListBatchUnitConfig {
  detectedSourceUnit: string | null;
  sourceUnit: ProductUnit | 'unconfirmed';
  targetUnit: ProductUnit;
  confirmedByUser: boolean;
  conversionFactor: number;
  suggestionReason?: string | null;
  exampleOriginalPrice?: number | null;
  exampleConvertedPrice?: number | null;
}

export interface PriceListImportCounts {
  expectedSerialCount: number | null;
  uniqueProductsCount: number;
  totalVariantsCount: number;
  rawRowsCount?: number;
  availableVariantsCount?: number;
  unavailableVariantsCount?: number;
  incompletePricesCount?: number;
  unconfirmedCostsCount?: number;
  excludedReasons?: string[];
  hasCountMismatch: boolean;
  countMismatchReason?: string | null;
  detectedSerialMin?: number | null;
  detectedSerialMax?: number | null;
  missingSerialNumbers?: number[];
}

export interface PriceListImportConfig {
  unitConfig: PriceListBatchUnitConfig;
  counts: PriceListImportCounts;
  detectedGrades: Array<{
    name: string;
    gradeId?: string | null;
    matched: boolean;
    columnIndices: number[];
  }>;
  isMultiGradeTable: boolean;
}

export interface PriceListParsedItem {
  rowKey: string;
  rowIndex?: number;
  serialNumber?: number | null;
  code: string;
  name: string;
  baseProductName?: string;
  baseProductKey?: string;
  grade?: string;
  gradeId?: string | null;
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
  isAvailable?: boolean;
  missingSellPrice?: boolean;
  missingCostPrice?: boolean;
  ambiguousSinglePrice: number | null;
  singlePriceMeaning: PriceListSinglePriceMeaning;
  matchStatus: PriceListMatchStatus;
  matchedBy?: 'code' | 'normalized_name' | 'name_and_grade' | null;
  matchedProductId?: string | null;
  matchedProductCurrent?: {
    id: string;
    code: string;
    name: string;
    grade?: string;
    gradeId?: string | null;
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
    grade?: boolean;
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
  importConfig?: PriceListImportConfig | null;
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

export type GranularResetGroupId =
  | 'orders_and_revisions'
  | 'stock_movements'
  | 'external_sourcing'
  | 'zero_stock_balances'
  | 'customers_unlinked'
  | 'customers_balances'
  | 'demo_products'
  | 'unlinked_catalog'
  | 'chat_messages'
  | 'price_list_imports'
  | 'operational_logs';

export interface SystemResetScope {
  mode:
    | 'reset_sales'
    | 'reset_stock'
    | 'reset_customers'
    | 'reset_demo_products'
    | 'reset_extras'
    | 'reset_full'
    | 'remove_catalog'
    | 'reset_groups';
  customerAction?: 'archive_only' | 'reset_balances' | 'delete_unlinked_and_demo' | 'delete_all';
  selectedDemoProductIds?: string[];
  clearChatMessages?: boolean;
  clearPriceListImports?: boolean;
  clearOperationalLogs?: boolean;
  archiveProtectedCatalog?: boolean;
  resetGroups?: GranularResetGroupId[];
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
  catalogRemovalSummary?: {
    totalProducts: number;
    deletableCount: number;
    protectedCount: number;
    archivedProtectedCount: number;
    deletableSample: Array<{ id: string; code: string; name: string; categoryName: string }>;
    protectedSample: Array<{
      id: string;
      code: string;
      name: string;
      categoryName: string;
      ordersCount: number;
      stockMovementsCount: number;
    }>;
  };
  groupsSummary?: Record<GranularResetGroupId, number>;
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
  externalSourcingCount?: number;
  priceListImportsCount: number;
  backupsCount: number;
  lastVerifiedBackupAt?: string | null;
  lastVerifiedBackupId?: string | null;
}

// =========================================================================
// BI Analytics, Unit-Safe Quantities, Sourcing & Reports Types
// =========================================================================

export type BiPeriodPreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'previous_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_year'
  | 'custom';

export interface BiFilterParams {
  preset?: BiPeriodPreset;
  dateFrom?: string;
  dateTo?: string;
  salesRepId?: string;
  categoryId?: string;
  productId?: string;
  status?: string;
  customerClassification?: string;
  stockSource?: 'all' | 'warehouse' | 'external' | 'pending';
  topLimit?: number;
}

export interface UnitQuantityTotal {
  unit: string;
  quantity: number;
}

export interface CostCoverageSummary {
  status: 'complete' | 'partial' | 'unavailable';
  totalRevenue: number;
  revenueWithKnownCost: number;
  coverageRatio: number; // 0..1
  knownCatalogCost: number;
  knownExternalSourcingCost: number;
  knownTotalCost: number;
  grossProfit: number | null; // null if any cost missing or unavailable
  partialGrossProfit: number | null; // profit on covered items only
  marginPercentage: number | null;
  missingCostItemsCount: number;
  totalItemsCount: number;
  noteAr: string;
}

export interface InventoryValuationSummary {
  status: 'complete' | 'partial' | 'unavailable';
  totalActiveProducts: number;
  productsWithStock: number;
  valuedProductsCount: number;
  missingCostStockedProductsCount: number;
  totalStockValue: number | null; // null if incomplete unless partial explicitly separated
  partialKnownStockValue: number;
  coverageRatio: number; // 0..1
  unitsBreakdown: UnitQuantityTotal[];
  noteAr: string;
}

export interface BiBusinessAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical' | 'opportunity';
  title: string;
  message: string;
  metric?: string;
  ruleExplanation: string;
}

export interface OwnerBiDashboardData {
  appliedRange: {
    preset: BiPeriodPreset;
    dateFrom?: string;
    dateTo?: string;
    priorDateFrom?: string;
    priorDateTo?: string;
    hasPriorComparison: boolean;
  };
  kpis: {
    totalRevenue: number;
    deliveredRevenue: number;
    ordersCount: number;
    deliveredOrdersCount: number;
    cancelledOrdersCount: number;
    returnedOrdersCount: number;
    averageOrderValue: number;
    uniqueBuyersCount: number;
    newBuyersCount: number;
    repeatBuyersCount: number;
    earnedCommission: number;
    pendingCommission: number;
    unitsSoldByUnit: UnitQuantityTotal[];
    growth: {
      revenuePct: number | null;
      ordersPct: number | null;
      aovPct: number | null;
      uniqueBuyersPct: number | null;
    };
  };
  profitSummary: CostCoverageSummary;
  inventoryValuation: InventoryValuationSummary;
  revenueTimeSeries: Array<{
    bucket: string;
    label: string;
    revenue: number;
    deliveredRevenue: number;
    ordersCount: number;
  }>;
  statusBreakdown: Array<{
    status: OrderStatus;
    count: number;
    revenue: number;
    sharePct: number;
  }>;
  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    ordersCount: number;
    revenue: number;
    sharePct: number;
    unitsByUnit: UnitQuantityTotal[];
  }>;
  topProducts: Array<{
    productId: string;
    productCode: string;
    productName: string;
    categoryName: string;
    unit: string;
    ordersCount: number;
    quantitySold: number;
    revenue: number;
    currentStock: number;
    pendingSourcingQty: number;
    externalSuppliedQty: number;
    stockingOpportunity: boolean;
    stockingOpportunityReason?: string;
  }>;
  sourcingSummary: {
    warehouseUnitsByUnit: UnitQuantityTotal[];
    externalUnitsByUnit: UnitQuantityTotal[];
    pendingUnitsByUnit: UnitQuantityTotal[];
    pendingItemsCount: number;
    pendingOrdersCount: number;
    knownExternalCostTotal: number;
    externalRecordsCount: number;
    missingCostExternalRecordsCount: number;
  };
  alerts: BiBusinessAlert[];
}

export interface SalesRepAnalyticsRow {
  salesRepId: string;
  salesRepName: string;
  ordersCount: number;
  deliveredOrdersCount: number;
  cancelledOrReturnedCount: number;
  totalRevenue: number;
  deliveredRevenue: number;
  averageOrderValue: number;
  uniqueCustomersCount: number;
  repeatCustomersCount: number;
  earnedCommission: number;
  pendingCommission: number;
  baseCommissionRate: number;
  categoryRates: Record<string, number>;
  unitsByUnit: UnitQuantityTotal[];
  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    revenue: number;
    unitsByUnit: UnitQuantityTotal[];
  }>;
}

export type CustomerRepeatFilter =
  | 'all'
  | 'once'
  | '2_plus'
  | '3_plus'
  | '5_plus'
  | 'custom_min'
  | 'increased_frequency'
  | 'declined_frequency'
  | 'inactive';

export interface CustomerAnalyticsRow {
  customerId: string;
  customerName: string;
  phone: string;
  address?: string;
  classification: string;
  assignedSalesRepId?: string | null;
  assignedSalesRepName?: string | null;
  ordersCount: number;
  periodOrdersCount: number;
  previousPeriodOrdersCount: number;
  totalSpent: number;
  periodSpent: number;
  averageOrderValue: number;
  firstOrderDate: string;
  lastOrderDate: string;
  daysSinceLastOrder: number | null;
  isDormant: boolean;
  frequencyTrend: 'increased' | 'declined' | 'stable' | 'new';
  unitsByUnit: UnitQuantityTotal[];
  primaryRepName?: string;
}

export interface ReorderRecommendationRow {
  productId: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  unit: string;
  currentStock: number;
  lookbackUnitsSold: number;
  avgDailyDemand: number;
  externalSuppliedInLookback: number;
  pendingProcurementQty: number;
  leadTimeDays: number;
  safetyDays: number;
  recommendedTargetStock: number;
  suggestedReorderQty: number;
  daysOfCoverRemaining: number | null;
  priority: 'urgent' | 'soon' | 'watch';
  reasonAr: string;
}

export type UnifiedReportType =
  | 'sales'
  | 'sales_reps'
  | 'commissions'
  | 'categories'
  | 'products'
  | 'customers'
  | 'repeat_customers'
  | 'inventory_valuation'
  | 'stock_movements'
  | 'external_sourcing'
  | 'invoice_status'
  | 'operations_performance';

export interface BulkPreviewItem {
  id: string;
  label: string;
  subLabel?: string;
  eligible: boolean;
  reason?: string;
  previewBefore?: string;
  previewAfter?: string;
}

export interface BulkPreviewResult {
  action: string;
  totalSelected: number;
  eligibleCount: number;
  excludedCount: number;
  items: BulkPreviewItem[];
  warnings: string[];
}

export interface BulkExecuteResult {
  action: string;
  executedCount: number;
  skippedCount: number;
  idempotentReplay?: boolean;
  message: string;
  details?: Record<string, unknown>;
}


