import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  CustomerReturnHistoryEntry,
  MonthlyCommission,
  OrderCancellationInfo,
  OrderCommissionSnapshot,
  OrderDeliveryInfo,
  OrderEditRequest,
  OrderHoldInfo,
  OrderItem,
  OrderReturnInfo,
  OrderRevisionAlert,
  OrderRevisionItemDiff,
  OrderShippingInfo,
  OrderStatusHistoryEntry,
  PriceListColumnMapping,
  PriceListParsedItem,
} from '../../types.ts';

// Authenticated Firebase users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Internal team members & sales staff permissions
export const teamMembers = pgTable('team_members', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nickname: text('nickname'),
  avatar: text('avatar'),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull().default(''),
  role: text('role').notNull(),
  salesRepId: text('sales_rep_id'),
  isSuspended: boolean('is_suspended').notNull().default(false),
  isMuted: boolean('is_muted').notNull().default(false),
  canEditInventory: boolean('can_edit_inventory').notNull().default(false),
  canConfirmDelivery: boolean('can_confirm_delivery').notNull().default(false),
  canManageOrderStatus: boolean('can_manage_order_status').notNull().default(false),
  canDeleteOrders: boolean('can_delete_orders').notNull().default(false),
  canDeleteCustomers: boolean('can_delete_customers').notNull().default(false),
  address: text('address'),
  startDate: text('start_date'),
  online: boolean('online').notNull().default(false),
});

// Product categories (oils, packaging, alcohol, chemicals, other supplies)
export const productCategories = pgTable('product_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  defaultUnit: text('default_unit').notNull().default('قطعة'),
  defaultCommissionEligible: boolean('default_commission_eligible').notNull().default(false),
  defaultCommissionRate: doublePrecision('default_commission_rate'),
  isActive: boolean('is_active').notNull().default(true),
  description: text('description'),
  createdAt: text('created_at').notNull().default(''),
});

// Multi-category inventory products catalog
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  code: text('code'),
  name: text('name').notNull(),
  categoryId: text('category_id'),
  categoryName: text('category_name'),
  description: text('description'),
  unit: text('unit').notNull().default('mg'),
  grade: text('grade').notNull().default(''),
  pricePerMg: doublePrecision('price_per_mg').notNull(),
  costPrice: doublePrecision('cost_price'),
  stock: integer('stock').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  isCommissionEligible: boolean('is_commission_eligible').notNull().default(true),
  commissionMode: text('commission_mode').notNull().default('inherit_rep'),
  customCommissionRate: doublePrecision('custom_commission_rate'),
  customCommissionFixed: doublePrecision('custom_commission_fixed'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

// System & Owner settings (commission config, owner recovery key hash, general config)
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: text('updated_at').notNull().default(''),
  updatedById: text('updated_by_id'),
  updatedByName: text('updated_by_name'),
});

// Commission settings audit history (records every change made by Owner)
export const commissionSettingLogs = pgTable('commission_setting_logs', {
  id: text('id').primaryKey(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  targetName: text('target_name').notNull(),
  previousValue: jsonb('previous_value').$type<Record<string, unknown>>().notNull().default({}),
  newValue: jsonb('new_value').$type<Record<string, unknown>>().notNull().default({}),
  reason: text('reason'),
  actorId: text('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  createdAt: text('created_at').notNull(),
});

// PDF Price list imports ledger + securely archived original PDF file
export const priceListImports = pgTable('price_list_imports', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull().default('application/pdf'),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  fileDataBase64: text('file_data_base64').notNull().default(''),
  extractionMethod: text('extraction_method').notNull().default('pdf_text'),
  status: text('status').notNull().default('pending_review'),
  listCategoryId: text('list_category_id'),
  listCategoryName: text('list_category_name'),
  columnMapping: jsonb('column_mapping').$type<PriceListColumnMapping | null>().default(null),
  rawTableRows: jsonb('raw_table_rows').$type<string[][]>().notNull().default([]),
  uploadedById: text('uploaded_by_id').notNull(),
  uploadedByName: text('uploaded_by_name').notNull(),
  uploadedAt: text('uploaded_at').notNull(),
  approvedById: text('approved_by_id'),
  approvedByName: text('approved_by_name'),
  approvedAt: text('approved_at'),
  totalParsed: integer('total_parsed').notNull().default(0),
  newCount: integer('new_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  needsReviewCount: integer('needs_review_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  parsedItems: jsonb('parsed_items').$type<PriceListParsedItem[]>().notNull().default([]),
  approvalSummary: jsonb('approval_summary')
    .$type<{
      createdCount: number;
      updatedCount: number;
      skippedCount: number;
      stockModified: false;
    } | null>()
    .default(null),
  errorMessage: text('error_message'),
  rawTextPreview: text('raw_text_preview'),
});

// Sales representatives commission & discount configuration
export const salesReps = pgTable('sales_reps', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  totalCommission: doublePrecision('total_commission').notNull().default(0),
  pendingCommission: doublePrecision('pending_commission').notNull().default(0),
  ordersCount: integer('orders_count').notNull().default(0),
  maxDiscountAllowed: doublePrecision('max_discount_allowed').notNull().default(10),
  customCommissionRate: doublePrecision('custom_commission_rate').notNull().default(0.05),
  categoryRates: jsonb('category_rates').$type<Record<string, number>>().notNull().default({}),
  monthlyHistory: jsonb('monthly_history').$type<MonthlyCommission[]>().notNull().default([]),
});

// Wholesale customers
export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  address: text('address'),
  totalSpent: doublePrecision('total_spent').notNull().default(0),
  classification: text('classification').notNull().default('عادي'),
  lastOrderDate: text('last_order_date').notNull().default(''),
  returnHistory: jsonb('return_history').$type<CustomerReturnHistoryEntry[]>().notNull().default([]),
});

// Sales invoices / orders
export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull().default(''),
  customerAddress: text('customer_address').notNull().default(''),
  governorate: text('governorate'),
  customerNotes: text('customer_notes'),
  operationalNotes: text('operational_notes'),
  salesRepId: text('sales_rep_id').notNull(),
  salesRepName: text('sales_rep_name').notNull(),
  items: jsonb('items').$type<OrderItem[]>().notNull(),
  subtotal: doublePrecision('subtotal').notNull(),
  discountPercentage: doublePrecision('discount_percentage').notNull().default(0),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
  shippingCost: doublePrecision('shipping_cost').notNull().default(0),
  totalAmount: doublePrecision('total_amount').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  commission: doublePrecision('commission').notNull().default(0),
  commissionableSubtotal: doublePrecision('commissionable_subtotal'),
  commissionRateSnapshot: doublePrecision('commission_rate_snapshot'),
  commissionRuleSnapshot: jsonb('commission_rule_snapshot')
    .$type<OrderCommissionSnapshot | null>()
    .default(null),
  version: integer('version').notNull().default(1),
  confirmedAt: text('confirmed_at'),
  confirmedById: text('confirmed_by_id'),
  confirmedByName: text('confirmed_by_name'),
  prepStartedAt: text('prep_started_at'),
  prepCompletedAt: text('prep_completed_at'),
  shippedAt: text('shipped_at'),
  deliveredAt: text('delivered_at'),
  cancelledAt: text('cancelled_at'),
  returnedAt: text('returned_at'),
  pendingEditRequest: jsonb('pending_edit_request').$type<OrderEditRequest | null>().default(null),
  statusHistory: jsonb('status_history').$type<OrderStatusHistoryEntry[]>().notNull().default([]),
  shippingInfo: jsonb('shipping_info').$type<OrderShippingInfo | null>().default(null),
  deliveryInfo: jsonb('delivery_info').$type<OrderDeliveryInfo | null>().default(null),
  returnInfo: jsonb('return_info').$type<OrderReturnInfo | null>().default(null),
  holdInfo: jsonb('hold_info').$type<OrderHoldInfo | null>().default(null),
  revisionAlert: jsonb('revision_alert').$type<OrderRevisionAlert | null>().default(null),
  cancellationInfo: jsonb('cancellation_info').$type<OrderCancellationInfo | null>().default(null),
});

// Invoice revision history (versioned before/after diffs and operations review state)
export const orderRevisions = pgTable('order_revisions', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  fromVersion: integer('from_version').notNull(),
  toVersion: integer('to_version').notNull(),
  editedById: text('edited_by_id').notNull(),
  editedByName: text('edited_by_name').notNull(),
  editedByRole: text('edited_by_role').notNull(),
  editedAt: text('edited_at').notNull(),
  reason: text('reason'),
  orderStatusAtEdit: text('order_status_at_edit').notNull(),
  addedItems: jsonb('added_items').$type<OrderRevisionItemDiff[]>().notNull().default([]),
  removedItems: jsonb('removed_items').$type<OrderRevisionItemDiff[]>().notNull().default([]),
  modifiedItems: jsonb('modified_items').$type<OrderRevisionItemDiff[]>().notNull().default([]),
  previousItemCount: integer('previous_item_count').notNull(),
  newItemCount: integer('new_item_count').notNull(),
  previousTotal: doublePrecision('previous_total').notNull(),
  newTotal: doublePrecision('new_total').notNull(),
  previousCommission: doublePrecision('previous_commission').notNull(),
  newCommission: doublePrecision('new_commission').notNull(),
  requiresRePreparation: boolean('requires_re_preparation').notNull().default(false),
  reviewStatus: text('review_status').notNull().default('لا يوجد تعديل معلق'),
  reviewedById: text('reviewed_by_id'),
  reviewedByName: text('reviewed_by_name'),
  reviewedAt: text('reviewed_at'),
  reviewNote: text('review_note'),
});

// Warehouse stock & item sourcing movements ledger (prevents double deduction / tracks supplier receipts)
export const stockMovements = pgTable('stock_movements', {
  id: text('id').primaryKey(),
  productId: text('product_id'),
  productName: text('product_name').notNull(),
  grade: text('grade').notNull(),
  orderId: text('order_id'),
  movementType: text('movement_type').notNull(),
  sourcingSource: text('sourcing_source').notNull(),
  quantityDelta: integer('quantity_delta').notNull().default(0),
  orderQuantityCovered: integer('order_quantity_covered').notNull().default(0),
  previousStock: integer('previous_stock').notNull().default(0),
  newStock: integer('new_stock').notNull().default(0),
  supplierName: text('supplier_name'),
  note: text('note'),
  actorId: text('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  createdAt: text('created_at').notNull(),
});

// Persistent security and operational audit log
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  orderId: text('order_id'),
  actionType: text('action_type').notNull(),
  actorId: text('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text('created_at').notNull(),
});

// Internal team chat messages
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  senderId: text('sender_id').notNull(),
  senderName: text('sender_name').notNull(),
  text: text('text').notNull(),
  timestamp: text('timestamp').notNull(),
});

// Persistent Owner backup ledger & verified ZIP archives
export const backupRecords = pgTable('backup_records', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  backupType: text('backup_type').notNull().default('full'),
  createdAt: text('created_at').notNull(),
  createdById: text('created_by_id').notNull(),
  createdByName: text('created_by_name').notNull(),
  appVersion: text('app_version').notNull(),
  schemaVersion: integer('schema_version').notNull().default(2),
  tablesCount: integer('tables_count').notNull().default(14),
  totalRecords: integer('total_records').notNull().default(0),
  attachmentsCount: integer('attachments_count').notNull().default(0),
  recordCounts: jsonb('record_counts').$type<Record<string, number>>().notNull().default({}),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  zipSha256: text('zip_sha256').notNull(),
  storageMode: text('storage_mode').notNull().default('server_db'),
  status: text('status').notNull().default('completed'),
  verificationStatus: text('verification_status').notNull().default('verified'),
  verificationNotes: text('verification_notes'),
  archiveBase64: text('archive_base64').notNull().default(''),
});

