import { and, asc, desc, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db, withDbRetry } from './index.ts';
import {
  auditLogs,
  chatMessages,
  commissionSettingLogs,
  customers,
  externalSourcingRecords,
  orderRevisions,
  orders,
  products,
  salesReps,
  stockMovements,
  systemSettings,
  teamMembers,
} from './schema.ts';
import {
  ensureCatalogAndSettingsSeeded,
  getAllCategories,
  getAllOilGrades,
  getCommissionConfig,
  getGeneralSystemSettings,
  getOwnerAccountCount,
  getOwnerBootstrapStatus,
  mapProductRow,
} from './catalogQueries.ts';
import {
  INITIAL_CUSTOMERS,
  INITIAL_PRODUCTS,
  INITIAL_SALES_REPS,
  INITIAL_USERS,
} from '../../constants.ts';
import { hashPassword, verifyPassword } from '../lib/auth-utils.ts';
import {
  calculateOrderFinancialsAndCommission,
  DEFAULT_CATEGORIES,
  DEFAULT_COMMISSION_CONFIG,
  resolveCategoryDefaultCommissionEligible,
} from '../lib/commission-utils.ts';
import { classifyProductName, normalizeArabicForSearch } from '../lib/product-classifier.ts';
import { roundStockNumber } from '../lib/unit-conversion.ts';
import {
  computeOrderStats,
  formatCairoYmd,
  hasOrderPendingProcurement,
  normalizeRevisionStatus,
  resolveCairoDateRange,
  VALID_SOURCING_SOURCES,
} from '../lib/date-utils.ts';
import type {
  ChatMessage,
  CommissionMode,
  Customer,
  CustomerReturnHistoryEntry,
  ExternalSourcingRecord,
  ItemProcurementStatus,
  ItemSourcingSource,
  OilGrade,
  Order,
  OrderCancellationInfo,
  OrderDateField,
  OrderDatePreset,
  OrderDeliveryInfo,
  OrderEditRequest,
  OrderHoldInfo,
  OrderItem,
  OrderReturnInfo,
  OrderReturnPrimaryReason,
  OrderRevisionAlert,
  OrderRevisionEntry,
  OrderRevisionItemDiff,
  OrderShippingEntry,
  OrderShippingInfo,
  OrdersQueryStats,
  OrderStatus,
  OrderStatusHistoryEntry,
  Product,
  ProductUsageSummary,
  RevisionAlertStatus,
  SalesRep,
  StockMovementEntry,
  User,
  UserRole,
} from '../../types.ts';

const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-1001',
    customerName: 'شركة النور للعطور',
    customerPhone: '0123456789',
    customerAddress: 'وسط البلد، القاهرة',
    customerNotes: 'تسليم في أسرع وقت مع عينات جديدة',
    salesRepId: 's1',
    salesRepName: 'أحمد علي',
    items: [
      { productName: 'زيت عود ملكي', grade: 'عالي (Code A)', quantity: 200, price: 45 },
      { productName: 'زيت لافندر فرنسي', grade: 'عالي (Code A)', quantity: 300, price: 15 },
    ],
    subtotal: 13500,
    discountPercentage: 5,
    discountAmount: 675,
    shippingCost: 100,
    totalAmount: 12925,
    status: 'تم التسليم',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    commission: 646.25,
  },
  {
    id: 'ord-1002',
    customerName: 'مؤسسة الزهور العطرية',
    customerPhone: '0109876543',
    customerAddress: 'مدينة نصر، القاهرة',
    customerNotes: 'تغليف خاص ومحكم للزجاجات',
    salesRepId: 's2',
    salesRepName: 'سارة محمود',
    items: [
      { productName: 'زيت ياسمين طبيعي', grade: 'تجاري (Code C)', quantity: 500, price: 8 },
    ],
    subtotal: 4000,
    discountPercentage: 0,
    discountAmount: 0,
    shippingCost: 80,
    totalAmount: 4080,
    status: 'قيد التنفيذ',
    createdAt: new Date().toISOString(),
    commission: 240,
  },
];

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 'msg-1',
    senderId: 'u1',
    senderName: 'المدير العام',
    text: 'أهلاً بفريق العمل، تم تحديث أسعار زيت العود الملكي وتوفرت شحنة جديدة.',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 'msg-2',
    senderId: 'u2',
    senderName: 'أحمد علي',
    text: 'ممتاز يا فندم، عميل شركة النور طلب كمية إضافية بالفعل.',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
];

function computeClassification(totalSpent: number): 'ذهبي' | 'فضي' | 'عادي' {
  if (totalSpent >= 10000) return 'ذهبي';
  if (totalSpent >= 5000) return 'فضي';
  return 'عادي';
}

function mapTeamMemberRow(u: typeof teamMembers.$inferSelect): User {
  return {
    id: u.id,
    name: u.name,
    nickname: u.nickname ?? undefined,
    avatar: u.avatar ?? undefined,
    username: u.username,
    role: u.role as UserRole,
    salesRepId: u.salesRepId ?? undefined,
    isSuspended: u.isSuspended,
    isMuted: u.isMuted,
    canEditInventory: u.canEditInventory,
    canConfirmDelivery: u.canConfirmDelivery,
    canManageOrderStatus: u.canManageOrderStatus,
    canDeleteOrders: u.canDeleteOrders,
    canDeleteCustomers: u.canDeleteCustomers,
    address: u.address ?? undefined,
    startDate: u.startDate ?? undefined,
    online: u.online,
  };
}

let seedVerified = false;
let seedInFlight: Promise<void> | null = null;

export async function ensureInitialDataSeeded() {
  if (seedVerified) return;
  if (seedInFlight) return seedInFlight;

  seedInFlight = (async () => {
    try {
      const [existingUsers, existingProducts, seedFlagRows] = await withDbRetry(() =>
        Promise.all([
          db.select().from(teamMembers),
          db.select({ id: products.id }).from(products).limit(1),
          db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, 'initial_seed_completed'))
            .limit(1),
        ])
      );

      const alreadySeededFlag = seedFlagRows.length > 0;

      if (existingUsers.length === 0 && existingProducts.length === 0 && !alreadySeededFlag) {
        const defaultHash = hashPassword('123456');
        await db
          .insert(teamMembers)
          .values(
            INITIAL_USERS.map((u) => ({
              id: u.id,
              name: u.name,
              nickname: u.nickname ?? null,
              avatar: u.avatar ?? null,
              username: u.username,
              passwordHash: defaultHash,
              role: u.role,
              salesRepId: u.salesRepId ?? null,
              isSuspended: u.isSuspended,
              isMuted: u.isMuted,
              canEditInventory: u.canEditInventory,
              canConfirmDelivery: u.canConfirmDelivery,
              canManageOrderStatus: u.canManageOrderStatus ?? u.role === 'admin',
              canDeleteOrders: u.canDeleteOrders ?? u.role === 'admin',
              canDeleteCustomers: u.canDeleteCustomers ?? u.role === 'admin',
              address: u.address ?? null,
              startDate: u.startDate ?? null,
              online: u.online ?? false,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(products)
          .values(
            INITIAL_PRODUCTS.map((p) => ({
              id: p.id,
              code: `OIL-${p.id.toUpperCase()}`,
              name: p.name,
              categoryId: 'cat-oils',
              categoryName: 'الزيوت العطرية',
              unit: 'mg',
              grade: p.grade,
              pricePerMg: p.pricePerMg,
              stock: p.stock,
              isActive: true,
              isCommissionEligible: true,
              commissionMode: 'inherit_rep',
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(salesReps)
          .values(
            INITIAL_SALES_REPS.map((r) => ({
              id: r.id,
              userId: r.userId,
              name: r.name,
              totalCommission: r.totalCommission,
              pendingCommission: r.pendingCommission,
              ordersCount: r.ordersCount,
              maxDiscountAllowed: r.maxDiscountAllowed,
              customCommissionRate: r.customCommissionRate,
              monthlyHistory: r.monthlyHistory,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(customers)
          .values(
            INITIAL_CUSTOMERS.map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              address: c.address ?? null,
              totalSpent: c.totalSpent,
              classification: c.classification,
              lastOrderDate: c.lastOrderDate,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(orders)
          .values(
            INITIAL_ORDERS.map((o) => ({
              id: o.id,
              customerName: o.customerName,
              customerPhone: o.customerPhone,
              customerAddress: o.customerAddress,
              customerNotes: o.customerNotes ?? null,
              salesRepId: o.salesRepId,
              salesRepName: o.salesRepName,
              items: o.items,
              subtotal: o.subtotal,
              discountPercentage: o.discountPercentage,
              discountAmount: o.discountAmount,
              shippingCost: o.shippingCost,
              totalAmount: o.totalAmount,
              status: o.status,
              createdAt: o.createdAt,
              commission: o.commission,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(chatMessages)
          .values(INITIAL_CHAT)
          .onConflictDoNothing();

        await db
          .insert(systemSettings)
          .values({
            key: 'initial_seed_completed',
            value: { completed: true, seededAt: new Date().toISOString() },
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoNothing();
      } else {
        if (!alreadySeededFlag && (existingUsers.length > 0 || existingProducts.length > 0)) {
          await db
            .insert(systemSettings)
            .values({
              key: 'initial_seed_completed',
              value: { completed: true, seededAt: new Date().toISOString() },
              updatedAt: new Date().toISOString(),
            })
            .onConflictDoNothing();
        }
        const rowsMissingPassword = existingUsers.filter((u) => !u.passwordHash);
        if (rowsMissingPassword.length > 0) {
          const defaultHash = hashPassword('123456');
          await Promise.all(
            rowsMissingPassword.map((row) =>
              db
                .update(teamMembers)
                .set({ passwordHash: defaultHash })
                .where(eq(teamMembers.id, row.id))
            )
          );
        }
      }

      // Seed categories, commission/system settings, backfill product catalog & order lifecycle columns safely
      await withDbRetry(() => ensureCatalogAndSettingsSeeded());
      await backfillOrderLifecycleTimestampsIfMissing();

      seedVerified = true;
    } catch (error) {
      console.error('Database query failed in ensureInitialDataSeeded:', error);
      throw new Error('Failed to initialize workspace data.', { cause: error });
    } finally {
      seedInFlight = null;
    }
  })();

  return seedInFlight;
}

async function backfillOrderLifecycleTimestampsIfMissing() {
  try {
    const allOrderRows = await db.select().from(orders);
    for (const row of allOrderRows) {
      const history = row.statusHistory ?? [];
      const findStageTime = (statuses: string[]) =>
        history.find((h) => statuses.includes(h.toStatus))?.changedAt;

      const patch: Partial<typeof orders.$inferInsert> = {};
      if (!row.prepStartedAt) {
        const t =
          findStageTime(['جاري التجهيز']) ||
          (row.status === 'جاري التجهيز' ||
          row.status === 'تم التجهيز' ||
          row.status === 'تم الشحن' ||
          row.status === 'تم التسليم' ||
          row.status === 'قيد التنفيذ'
            ? row.confirmedAt || row.createdAt
            : null);
        if (t) patch.prepStartedAt = t;
      }
      if (!row.prepCompletedAt) {
        const t =
          findStageTime(['تم التجهيز']) ||
          (row.status === 'تم التجهيز' || row.status === 'تم الشحن' || row.status === 'تم التسليم'
            ? row.shippingInfo?.shippedAt || row.deliveryInfo?.deliveredAt || row.confirmedAt || row.createdAt
            : null);
        if (t) patch.prepCompletedAt = t;
      }
      if (!row.shippedAt) {
        const t =
          row.shippingInfo?.shippedAt ||
          findStageTime(['تم الشحن']) ||
          (row.status === 'تم الشحن' || row.status === 'تم التسليم'
            ? row.deliveryInfo?.deliveredAt || row.createdAt
            : null);
        if (t) patch.shippedAt = t;
      }
      if (!row.deliveredAt) {
        const t =
          row.deliveryInfo?.deliveredAt ||
          findStageTime(['تم التسليم']) ||
          (row.status === 'تم التسليم' ? row.createdAt : null);
        if (t) patch.deliveredAt = t;
      }
      if (!row.cancelledAt) {
        const t =
          row.cancellationInfo?.cancelledAt ||
          findStageTime(['ملغي']) ||
          (row.status === 'ملغي' ? row.createdAt : null);
        if (t) patch.cancelledAt = t;
      }
      if (!row.returnedAt) {
        const t =
          row.returnInfo?.recordedAt ||
          findStageTime(['مرتجع', 'رفض استلام']) ||
          (row.status === 'مرتجع' || row.status === 'رفض استلام' ? row.createdAt : null);
        if (t) patch.returnedAt = t;
      }

      if (Object.keys(patch).length > 0) {
        await db.update(orders).set(patch).where(eq(orders.id, row.id));
      }
    }
  } catch (err) {
    console.warn('Non-fatal lifecycle timestamp backfill warning:', err);
  }
}

export async function authenticateTeamMember(
  username: string,
  password: string
): Promise<{ user: User | null; error?: string }> {
  try {
    await ensureInitialDataSeeded();
    const cleanUsername = username.trim().toLowerCase();
    const rows = await withDbRetry(() =>
      db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.username, cleanUsername))
        .limit(1)
    );

    if (rows.length === 0) {
      return { user: null, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
    }

    const row = rows[0];
    if (!verifyPassword(password, row.passwordHash)) {
      return { user: null, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
    }

    if (row.isSuspended) {
      return { user: null, error: 'هذا الحساب معطل حالياً من قبل الإدارة.' };
    }

    return { user: mapTeamMemberRow(row) };
  } catch (error) {
    console.error('Database query failed in authenticateTeamMember:', error);
    throw new Error('Authentication failed.', { cause: error });
  }
}

export async function getTeamMemberById(userId: string): Promise<User | null> {
  try {
    const rows = await withDbRetry(() =>
      db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.id, userId))
        .limit(1)
    );
    if (rows.length === 0) return null;
    return mapTeamMemberRow(rows[0]);
  } catch (error) {
    console.error('Database query failed in getTeamMemberById:', error);
    throw new Error('Failed to fetch user profile.', { cause: error });
  }
}

export async function getTeamMemberPasswordHashById(userId: string): Promise<string | null> {
  const rows = await withDbRetry(() =>
    db
      .select({ passwordHash: teamMembers.passwordHash })
      .from(teamMembers)
      .where(eq(teamMembers.id, userId))
      .limit(1)
  );
  return rows[0]?.passwordHash ?? null;
}

function mapCustomerRow(c: typeof customers.$inferSelect): Customer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    address: c.address ?? undefined,
    totalSpent: c.totalSpent,
    classification: c.classification as Customer['classification'],
    lastOrderDate: c.lastOrderDate,
    assignedSalesRepId: c.assignedSalesRepId ?? null,
    assignedSalesRepName: c.assignedSalesRepName ?? null,
    returnHistory: c.returnHistory ?? [],
  };
}

export function canUserAccessCustomerRecord(
  user: User,
  customer: Pick<Customer, 'name' | 'phone' | 'assignedSalesRepId'>,
  ordersList: Array<Pick<Order, 'customerName' | 'customerPhone' | 'salesRepId'>>
): boolean {
  if (
    user.role === 'owner' ||
    user.role === 'admin' ||
    user.role === 'supervisor' ||
    Boolean(user.canManageOrderStatus) ||
    Boolean(user.canConfirmDelivery)
  ) {
    return true;
  }
  if (!user.salesRepId) return false;
  if (customer.assignedSalesRepId) {
    return customer.assignedSalesRepId === user.salesRepId;
  }
  const cleanName = customer.name.trim().toLowerCase();
  const cleanPhone = (customer.phone || '').trim();
  const matchingOrders = ordersList.filter(
    (o) =>
      (cleanName && o.customerName.trim().toLowerCase() === cleanName) ||
      (Boolean(cleanPhone) && (o.customerPhone || '').trim() === cleanPhone)
  );
  return matchingOrders.length > 0 && matchingOrders.every((o) => o.salesRepId === user.salesRepId);
}

export function getVisibleCustomersForUser(
  user: User,
  allCustomers: Customer[],
  allOrders: Order[]
): Customer[] {
  if (
    user.role === 'owner' ||
    user.role === 'admin' ||
    user.role === 'supervisor' ||
    Boolean(user.canManageOrderStatus) ||
    Boolean(user.canConfirmDelivery)
  ) {
    return allCustomers;
  }
  return allCustomers.filter((c) => canUserAccessCustomerRecord(user, c, allOrders));
}

function mapRevisionRow(r: typeof orderRevisions.$inferSelect): OrderRevisionEntry {
  return {
    id: r.id,
    orderId: r.orderId,
    fromVersion: r.fromVersion,
    toVersion: r.toVersion,
    editedById: r.editedById,
    editedByName: r.editedByName,
    editedByRole: r.editedByRole as UserRole,
    editedAt: r.editedAt,
    reason: r.reason ?? undefined,
    orderStatusAtEdit: r.orderStatusAtEdit as OrderStatus,
    addedItems: r.addedItems ?? [],
    removedItems: r.removedItems ?? [],
    modifiedItems: r.modifiedItems ?? [],
    previousItemCount: r.previousItemCount,
    newItemCount: r.newItemCount,
    previousTotal: r.previousTotal,
    newTotal: r.newTotal,
    previousCommission: r.previousCommission,
    newCommission: r.newCommission,
    requiresRePreparation: Boolean(r.requiresRePreparation),
    reviewStatus: normalizeRevisionStatus(r.reviewStatus as RevisionAlertStatus),
    reviewedById: r.reviewedById ?? undefined,
    reviewedByName: r.reviewedByName ?? undefined,
    reviewedAt: r.reviewedAt ?? undefined,
    reviewNote: r.reviewNote ?? undefined,
  };
}

function mapOrderRow(
  o: typeof orders.$inferSelect,
  revisions: OrderRevisionEntry[] = []
): Order {
  return {
    id: o.id,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerAddress: o.customerAddress,
    governorate: o.governorate ?? undefined,
    customerNotes: o.customerNotes ?? undefined,
    operationalNotes: o.operationalNotes ?? undefined,
    salesRepId: o.salesRepId,
    salesRepName: o.salesRepName,
    items: o.items,
    subtotal: o.subtotal,
    discountPercentage: o.discountPercentage,
    discountAmount: o.discountAmount,
    shippingCost: o.shippingCost,
    totalAmount: o.totalAmount,
    status: o.status as OrderStatus,
    createdAt: o.createdAt,
    commission: o.commission,
    commissionableSubtotal: o.commissionableSubtotal ?? undefined,
    commissionRateSnapshot: o.commissionRateSnapshot ?? undefined,
    commissionRuleSnapshot: o.commissionRuleSnapshot ?? null,
    version: o.version ?? 1,
    confirmedAt: o.confirmedAt ?? null,
    confirmedById: o.confirmedById ?? null,
    confirmedByName: o.confirmedByName ?? null,
    prepStartedAt: o.prepStartedAt ?? null,
    prepCompletedAt: o.prepCompletedAt ?? null,
    shippedAt: o.shippedAt ?? null,
    deliveredAt: o.deliveredAt ?? null,
    cancelledAt: o.cancelledAt ?? null,
    returnedAt: o.returnedAt ?? null,
    pendingEditRequest: o.pendingEditRequest ?? null,
    statusHistory: o.statusHistory ?? [],
    shippingInfo: o.shippingInfo ?? null,
    deliveryInfo: o.deliveryInfo ?? null,
    returnInfo: o.returnInfo ?? null,
    holdInfo: o.holdInfo ?? null,
    revisionAlert: o.revisionAlert
      ? {
          ...o.revisionAlert,
          status: normalizeRevisionStatus(o.revisionAlert.status),
        }
      : null,
    revisions,
    cancellationInfo: o.cancellationInfo ?? null,
  };
}

export async function getAllWorkspaceData() {
  try {
    await ensureInitialDataSeeded();

    const [
      userRows,
      productRows,
      repRows,
      customerRows,
      orderRows,
      revisionRows,
      chatRows,
      categories,
      oilGradesList,
      commissionConfig,
      generalSettings,
      bootstrapStatus,
    ] = await withDbRetry(() =>
      Promise.all([
        db.select().from(teamMembers),
        db.select().from(products),
        db.select().from(salesReps),
        db.select().from(customers),
        db.select().from(orders).orderBy(desc(orders.createdAt)),
        db.select().from(orderRevisions).orderBy(asc(orderRevisions.toVersion)),
        db.select().from(chatMessages),
        getAllCategories(),
        getAllOilGrades(),
        getCommissionConfig(),
        getGeneralSystemSettings(),
        getOwnerBootstrapStatus(),
      ])
    );

    const revisionsByOrder = new Map<string, OrderRevisionEntry[]>();
    for (const r of revisionRows) {
      const mapped = mapRevisionRow(r);
      const list = revisionsByOrder.get(r.orderId) ?? [];
      list.push(mapped);
      revisionsByOrder.set(r.orderId, list);
    }

    return {
      users: userRows.map(mapTeamMemberRow),
      products: productRows.map(mapProductRow),
      categories,
      oilGrades: oilGradesList,
      commissionConfig,
      generalSettings,
      hasOwnerAccount: bootstrapStatus.hasOwnerAccount,
      canBootstrapOwner: bootstrapStatus.canBootstrapOwner,
      salesReps: repRows.map((r): SalesRep => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        totalCommission: r.totalCommission,
        pendingCommission: r.pendingCommission,
        ordersCount: r.ordersCount,
        maxDiscountAllowed: r.maxDiscountAllowed,
        customCommissionRate: r.customCommissionRate,
        categoryRates: r.categoryRates ?? {},
        monthlyHistory: r.monthlyHistory ?? [],
      })),
      customers: customerRows.map(mapCustomerRow),
      orders: orderRows.map((o) => mapOrderRow(o, revisionsByOrder.get(o.id) ?? [])),
      chatMessages: chatRows,
    };
  } catch (error) {
    console.error('Database query failed in getAllWorkspaceData:', error);
    throw new Error('Failed to load workspace data from database.', { cause: error });
  }
}

export async function getWorkspaceDataForUser(user: User) {
  const full = await getAllWorkspaceData();
  const isStrictManager = user.role === 'owner' || user.role === 'admin';
  const isSupervisor = user.role === 'supervisor';
  const hasOperationsOrderAccess =
    isStrictManager ||
    isSupervisor ||
    Boolean(user.canManageOrderStatus) ||
    Boolean(user.canConfirmDelivery) ||
    Boolean(user.canDeleteOrders);

  return {
    users: isStrictManager ? full.users : [user],
    products: full.products,
    categories: full.categories,
    oilGrades: full.oilGrades,
    commissionConfig: full.commissionConfig,
    generalSettings: full.generalSettings,
    hasOwnerAccount: full.hasOwnerAccount,
    canBootstrapOwner: full.canBootstrapOwner,
    salesReps:
      isStrictManager || isSupervisor
        ? full.salesReps
        : full.salesReps.filter(
            (r) => r.userId === user.id || (Boolean(user.salesRepId) && r.id === user.salesRepId)
          ),
    customers: getVisibleCustomersForUser(user, full.customers, full.orders),
    orders: hasOperationsOrderAccess
      ? full.orders
      : full.orders.filter(
          (o) => Boolean(user.salesRepId) && o.salesRepId === user.salesRepId
        ),
    chatMessages: full.chatMessages,
  };
}

function normalizeOrderItem(item: OrderItem, preserveAddToInventory = false): OrderItem {
  const validSource =
    item.sourcingSource && VALID_SOURCING_SOURCES.includes(item.sourcingSource)
      ? item.sourcingSource
      : undefined;

  return {
    ...(item.productId ? { productId: item.productId } : {}),
    ...(item.productCode ? { productCode: item.productCode.trim() } : {}),
    productName: item.productName.trim(),
    ...(item.categoryId ? { categoryId: item.categoryId } : {}),
    ...(item.categoryName ? { categoryName: item.categoryName } : {}),
    ...(item.unit ? { unit: item.unit } : {}),
    grade: item.grade ?? '',
    quantity: Number(item.quantity),
    price: Number(item.price),
    ...(typeof item.isCommissionEligible === 'boolean'
      ? { isCommissionEligible: item.isCommissionEligible }
      : {}),
    ...(typeof item.commissionRateApplied === 'number'
      ? { commissionRateApplied: item.commissionRateApplied }
      : {}),
    ...(typeof item.commissionAmount === 'number'
      ? { commissionAmount: item.commissionAmount }
      : {}),
    ...(item.isCustom ? { isCustom: true } : {}),
    ...(preserveAddToInventory && item.addToInventory ? { addToInventory: true } : {}),
    ...(validSource ? { sourcingSource: validSource } : {}),
    ...(typeof item.warehouseDeductedQty === 'number'
      ? { warehouseDeductedQty: Math.max(0, Number(item.warehouseDeductedQty)) }
      : {}),
    ...(typeof item.externalSuppliedQty === 'number'
      ? { externalSuppliedQty: Math.max(0, Number(item.externalSuppliedQty)) }
      : {}),
    ...(typeof item.pendingQty === 'number'
      ? { pendingQty: Math.max(0, Number(item.pendingQty)) }
      : {}),
    ...(item.procurementStatus === 'pending' || item.procurementStatus === 'fulfilled'
      ? { procurementStatus: item.procurementStatus }
      : {}),
    ...(item.supplierName?.trim() ? { supplierName: item.supplierName.trim() } : {}),
    ...(item.sourcingNotes?.trim() ? { sourcingNotes: item.sourcingNotes.trim() } : {}),
    ...(typeof item.receivedIntoWarehouse === 'boolean'
      ? { receivedIntoWarehouse: item.receivedIntoWarehouse }
      : {}),
    ...(typeof item.externalUnitCost === 'number' && Number.isFinite(item.externalUnitCost)
      ? { externalUnitCost: item.externalUnitCost }
      : {}),
    ...(typeof item.externalTotalCost === 'number' && Number.isFinite(item.externalTotalCost)
      ? { externalTotalCost: item.externalTotalCost }
      : {}),
    ...(item.supplierDateSecured ? { supplierDateSecured: item.supplierDateSecured } : {}),
    ...(item.sourcingUpdatedBy ? { sourcingUpdatedBy: item.sourcingUpdatedBy } : {}),
    ...(item.sourcingUpdatedAt ? { sourcingUpdatedAt: item.sourcingUpdatedAt } : {}),
  };
}

function sanitizeOrderItemsForStorage(items: OrderItem[], preserveAddToInventory = false): OrderItem[] {
  return items.map((item) => normalizeOrderItem(item, preserveAddToInventory));
}

function makeItemKey(
  productName: string,
  grade: string,
  productCode?: string,
  productId?: string
): string {
  if (productId) return `id:${productId}`;
  if (productCode) return `code:${productCode.trim().toLowerCase()}`;
  return `${productName.trim().toLowerCase()}||${grade || ''}`;
}

function findMatchingProduct(
  productList: Array<typeof products.$inferSelect>,
  productName: string,
  grade: string,
  productId?: string,
  productCode?: string
) {
  if (productId) {
    const byId = productList.find((p) => p.id === productId);
    if (byId) return byId;
  }
  if (productCode) {
    const cleanCode = productCode.trim().toLowerCase();
    const byCode = productList.find((p) => (p.code || '').trim().toLowerCase() === cleanCode);
    if (byCode) return byCode;
  }
  const cleanName = productName.trim().toLowerCase();
  const byExact = productList.find(
    (p) => p.name.trim().toLowerCase() === cleanName && (p.grade || '') === (grade || '')
  );
  if (byExact) return byExact;
  return productList.find((p) => p.name.trim().toLowerCase() === cleanName);
}

export function hasOrderBeenConfirmed(order: {
  status: string;
  confirmedAt?: string | null;
  cancellationInfo?: OrderCancellationInfo | null;
}): boolean {
  if (order.status === 'بانتظار تأكيد العميل') return false;
  if (
    order.status === 'ملغي' &&
    !order.confirmedAt &&
    order.cancellationInfo?.stageAtCancellation === 'بانتظار تأكيد العميل'
  ) {
    return false;
  }
  return true;
}

function isCustomerRevenueOrder(order: {
  status: string;
  confirmedAt?: string | null;
  cancellationInfo?: OrderCancellationInfo | null;
}): boolean {
  return hasOrderBeenConfirmed(order);
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeAuditLogTx(
  tx: DbTx,
  params: {
    orderId?: string | null;
    actionType: string;
    actor: User;
    details: Record<string, unknown>;
    createdAt?: string;
  }
) {
  const now = params.createdAt || new Date().toISOString();
  await tx.insert(auditLogs).values({
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    orderId: params.orderId ?? null,
    actionType: params.actionType,
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorRole: params.actor.role,
    details: params.details,
    createdAt: now,
  });
}

async function writeStockMovementTx(
  tx: DbTx,
  params: {
    productId?: string | null;
    productName: string;
    grade: OilGrade;
    unit?: string | null;
    orderId?: string | null;
    movementType: StockMovementEntry['movementType'];
    sourcingSource: ItemSourcingSource;
    quantityDelta: number;
    orderQuantityCovered: number;
    previousStock: number;
    newStock: number;
    supplierName?: string | null;
    note?: string | null;
    idempotencyKey?: string | null;
    actor: User;
    createdAt?: string;
  }
) {
  const now = params.createdAt || new Date().toISOString();
  await tx.insert(stockMovements).values({
    id: `stk-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    productId: params.productId ?? null,
    productName: params.productName,
    grade: params.grade,
    unit: params.unit ?? null,
    orderId: params.orderId ?? null,
    movementType: params.movementType,
    sourcingSource: params.sourcingSource,
    quantityDelta: params.quantityDelta,
    orderQuantityCovered: params.orderQuantityCovered,
    previousStock: params.previousStock,
    newStock: params.newStock,
    supplierName: params.supplierName ?? null,
    note: params.note ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorRole: params.actor.role,
    createdAt: now,
  });
}

function aggregateItemsByKey(items: OrderItem[]) {
  const map = new Map<
    string,
    {
      productName: string;
      grade: OilGrade;
      quantity: number;
      price: number;
      isCustom?: boolean;
      addToInventory?: boolean;
    }
  >();

  for (const item of items) {
    const cleanName = item.productName.trim();
    if (!cleanName) continue;
    const key = makeItemKey(cleanName, item.grade, item.productCode, item.productId);
    const qty = Number(item.quantity);
    const price = Number(item.price);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += qty;
      existing.price = price;
      if (item.isCustom) existing.isCustom = true;
      if (item.addToInventory) existing.addToInventory = true;
    } else {
      map.set(key, {
        productName: cleanName,
        grade: item.grade,
        quantity: qty,
        price,
        isCustom: item.isCustom,
        addToInventory: item.addToInventory,
      });
    }
  }
  return map;
}

function computeOrderItemDiffs(oldItems: OrderItem[], newItems: OrderItem[]) {
  const oldMap = aggregateItemsByKey(oldItems);
  const newMap = aggregateItemsByKey(newItems);
  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);

  const addedItems: OrderRevisionItemDiff[] = [];
  const removedItems: OrderRevisionItemDiff[] = [];
  const modifiedItems: OrderRevisionItemDiff[] = [];

  for (const key of allKeys) {
    const oldEntry = oldMap.get(key);
    const newEntry = newMap.get(key);

    if (!oldEntry && newEntry) {
      addedItems.push({
        productName: newEntry.productName,
        grade: newEntry.grade,
        changeType: 'added',
        oldQuantity: 0,
        newQuantity: newEntry.quantity,
        quantityDelta: newEntry.quantity,
        oldPrice: 0,
        newPrice: newEntry.price,
      });
    } else if (oldEntry && !newEntry) {
      removedItems.push({
        productName: oldEntry.productName,
        grade: oldEntry.grade,
        changeType: 'removed',
        oldQuantity: oldEntry.quantity,
        newQuantity: 0,
        quantityDelta: -oldEntry.quantity,
        oldPrice: oldEntry.price,
        newPrice: 0,
      });
    } else if (oldEntry && newEntry) {
      if (oldEntry.quantity !== newEntry.quantity || oldEntry.price !== newEntry.price) {
        modifiedItems.push({
          productName: newEntry.productName,
          grade: newEntry.grade,
          changeType: 'modified',
          oldQuantity: oldEntry.quantity,
          newQuantity: newEntry.quantity,
          quantityDelta: newEntry.quantity - oldEntry.quantity,
          oldPrice: oldEntry.price,
          newPrice: newEntry.price,
        });
      }
    }
  }

  return { addedItems, removedItems, modifiedItems };
}

async function recomputeCustomerTotalsTx(
  tx: DbTx,
  customerNamesAndPhones: Array<{ name: string; phone: string }>
) {
  const allOrders = await tx.select().from(orders).orderBy(desc(orders.createdAt));
  const allCustomers = await tx.select().from(customers);

  const visitedIds = new Set<string>();
  for (const ref of customerNamesAndPhones) {
    const cleanName = ref.name.trim();
    const cleanPhone = (ref.phone || '').trim();
    const matched = allCustomers.find(
      (c) =>
        (cleanName && c.name.trim() === cleanName) ||
        (Boolean(cleanPhone) && c.phone === cleanPhone)
    );
    if (!matched || visitedIds.has(matched.id)) continue;
    visitedIds.add(matched.id);

    const custConfirmedOrders = allOrders.filter(
      (o) =>
        isCustomerRevenueOrder(o) &&
        (o.customerName.trim() === matched.name.trim() ||
          (Boolean(matched.phone) && o.customerPhone === matched.phone))
    );
    const totalSpent = custConfirmedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    await tx
      .update(customers)
      .set({
        totalSpent,
        classification: computeClassification(totalSpent),
        lastOrderDate: custConfirmedOrders.length > 0 ? custConfirmedOrders[0].createdAt : '',
      })
      .where(eq(customers.id, matched.id));
  }
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  try {
    const [rows, revRows] = await Promise.all([
      db.select().from(orders).where(eq(orders.id, orderId)).limit(1),
      db
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion)),
    ]);
    if (rows.length === 0) return null;
    return mapOrderRow(rows[0], revRows.map(mapRevisionRow));
  } catch (error) {
    console.error('Database query failed in getOrderById:', error);
    throw new Error('Failed to fetch order.', { cause: error });
  }
}

export async function createOrderRecord(
  orderData: Omit<Order, 'id' | 'createdAt'>,
  actorUser?: User
): Promise<Order> {
  try {
    const cleanedItems = sanitizeOrderItemsForStorage(orderData.items, true);
    if (cleanedItems.length === 0) {
      throw new Error('يجب إضافة صنف واحد على الأقل إلى الفاتورة.');
    }

    const createdAt = new Date().toISOString();
    const initialStatus: OrderStatus = 'بانتظار تأكيد العميل';
    const actor: User = actorUser || {
      id: orderData.salesRepId || 'system',
      name: orderData.salesRepName || 'النظام',
      username: 'system',
      role: 'sales',
      isSuspended: false,
      isMuted: false,
      canEditInventory: false,
      canConfirmDelivery: false,
      canManageOrderStatus: false,
    };

    const [allProductRows, categoriesCatalog, commissionConfig, repRows] = await Promise.all([
      db.select().from(products),
      getAllCategories(),
      getCommissionConfig(),
      db.select().from(salesReps),
    ]);
    const productsCatalog = allProductRows.map(mapProductRow);

    for (const item of cleanedItems) {
      const catalogProd = findMatchingProduct(
        allProductRows,
        item.productName,
        item.grade || '',
        item.productId,
        item.productCode
      );
      if (catalogProd && catalogProd.isActive === false) {
        throw new Error(`لا يمكن إضافة الصنف المؤرشف "${catalogProd.name}" إلى فاتورة جديدة.`);
      }
    }

    const rep = repRows.find((r) => r.id === orderData.salesRepId);
    const repBaseRate =
      rep?.customCommissionRate ?? commissionConfig.defaultOilCommissionRate;

    const computed = calculateOrderFinancialsAndCommission({
      items: cleanedItems,
      discountPercentage: orderData.discountPercentage,
      shippingCost: orderData.shippingCost,
      repBaseRate,
      repCategoryRates: rep?.categoryRates ?? {},
      commissionConfig,
      productsCatalog,
      categoriesCatalog,
      capturedAt: createdAt,
    });

    const initialHistory: OrderStatusHistoryEntry[] = [
      {
        fromStatus: null,
        toStatus: initialStatus,
        changedById: actor.id,
        changedByName: actor.name,
        changedByRole: actor.role,
        changedAt: createdAt,
        note: 'تم إنشاء مسودة الفاتورة بانتظار تأكيد العميل (لم يُخصم المخزون أو تُحسب العمولة بعد)',
      },
    ];

    const orderIdSuffix = Math.floor(Math.random() * 900 + 100);
    const newOrder: Order = {
      ...orderData,
      customerPhone: orderData.customerPhone ?? '',
      customerAddress: orderData.customerAddress ?? '',
      salesRepName: orderData.salesRepName || rep?.name || actor.name,
      governorate: orderData.governorate?.trim() || undefined,
      operationalNotes: orderData.operationalNotes?.trim() || undefined,
      items: computed.items,
      subtotal: computed.subtotal,
      discountPercentage: computed.discountPercentage,
      discountAmount: computed.discountAmount,
      shippingCost: computed.shippingCost,
      totalAmount: computed.totalAmount,
      commission: computed.commission,
      commissionableSubtotal: computed.commissionableSubtotal,
      commissionRateSnapshot: computed.commissionRateSnapshot,
      commissionRuleSnapshot: computed.commissionRuleSnapshot,
      status: initialStatus,
      id: `ORD-${Date.now().toString().slice(-6)}-${orderIdSuffix}`,
      createdAt,
      version: 1,
      confirmedAt: null,
      confirmedById: null,
      confirmedByName: null,
      statusHistory: initialHistory,
      shippingInfo: null,
      deliveryInfo: null,
      returnInfo: null,
      holdInfo: null,
      revisionAlert: null,
      revisions: [],
      cancellationInfo: null,
    };

    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: newOrder.id,
        customerName: newOrder.customerName,
        customerPhone: newOrder.customerPhone,
        customerAddress: newOrder.customerAddress,
        governorate: newOrder.governorate ?? null,
        customerNotes: newOrder.customerNotes ?? null,
        operationalNotes: newOrder.operationalNotes ?? null,
        salesRepId: newOrder.salesRepId,
        salesRepName: newOrder.salesRepName,
        items: newOrder.items,
        subtotal: newOrder.subtotal,
        discountPercentage: newOrder.discountPercentage,
        discountAmount: newOrder.discountAmount,
        shippingCost: newOrder.shippingCost,
        totalAmount: newOrder.totalAmount,
        status: initialStatus,
        createdAt: newOrder.createdAt,
        commission: newOrder.commission,
        commissionableSubtotal: computed.commissionableSubtotal,
        commissionRateSnapshot: computed.commissionRateSnapshot,
        commissionRuleSnapshot: computed.commissionRuleSnapshot,
        version: 1,
        confirmedAt: null,
        confirmedById: null,
        confirmedByName: null,
        statusHistory: initialHistory,
        revisionAlert: null,
        cancellationInfo: null,
      });

      const allCustomers = await tx.select().from(customers);
      const matchedCustomer = allCustomers.find(
        (c) =>
          c.name.trim() === newOrder.customerName.trim() ||
          (Boolean(newOrder.customerPhone) && c.phone === newOrder.customerPhone)
      );

      if (!matchedCustomer) {
        await tx.insert(customers).values({
          id: `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: newOrder.customerName,
          phone: newOrder.customerPhone,
          address: newOrder.customerAddress || null,
          totalSpent: 0,
          classification: 'عادي',
          lastOrderDate: '',
          assignedSalesRepId: newOrder.salesRepId || null,
          assignedSalesRepName: newOrder.salesRepName || null,
        });
      } else if (!matchedCustomer.assignedSalesRepId && newOrder.salesRepId) {
        await tx
          .update(customers)
          .set({
            assignedSalesRepId: newOrder.salesRepId,
            assignedSalesRepName: newOrder.salesRepName || null,
          })
          .where(eq(customers.id, matchedCustomer.id));
      }

      await writeAuditLogTx(tx, {
        orderId: newOrder.id,
        actionType: 'order_created_draft',
        actor,
        details: {
          status: initialStatus,
          itemCount: computed.items.length,
          totalAmount: newOrder.totalAmount,
          commission: newOrder.commission,
          commissionableSubtotal: computed.commissionableSubtotal,
        },
        createdAt,
      });
    });

    return newOrder;
  } catch (error) {
    console.error('Database query failed in createOrderRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('يجب إضافة صنف') || error.message.includes('مؤرشف'))
    ) {
      throw error;
    }
    throw new Error('Failed to create order in database.', { cause: error });
  }
}

export async function confirmOrderRecord(orderId: string, actorUser: User): Promise<Order> {
  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');

      if (existingRows.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existingRows[0];
      const prevStatus = prevOrder.status as OrderStatus;

      if (prevStatus === 'ملغي') {
        throw new Error('لا يمكن تأكيد فاتورة ملغاة.');
      }
      if (prevStatus !== 'بانتظار تأكيد العميل') {
        throw new Error('تم تأكيد هذه الفاتورة وإرسالها للتجهيز مسبقاً.');
      }
      if (!prevOrder.items || prevOrder.items.length === 0) {
        throw new Error('لا يمكن تأكيد فاتورة خالية من الأصناف.');
      }

      const nowIso = new Date().toISOString();
      const allProducts = await tx.select().from(products);
      const stockMap = new Map<string, number>(allProducts.map((p) => [p.id, p.stock]));

      // Safe Zero-Stock & Multi-Source Allocation:
      // Warehouse stock can NEVER go below 0. Shortages become `pendingQty` for procurement.
      const storedItems: OrderItem[] = [];
      let pendingItemCount = 0;

      for (let idx = 0; idx < prevOrder.items.length; idx++) {
        const rawItem = normalizeOrderItem(prevOrder.items[idx], true);
        const qty = Math.max(0, Number(rawItem.quantity));
        const requestedSource = rawItem.sourcingSource;
        let prod = findMatchingProduct(
          allProducts,
          rawItem.productName,
          rawItem.grade,
          rawItem.productId,
          rawItem.productCode
        );

        if (!prod && rawItem.addToInventory) {
          const categories = await getAllCategories();
          const commCfg = await getCommissionConfig();
          const autoClassified = classifyProductName(rawItem.productName, categories);
          const matchedCat =
            categories.find((c) => c.id === autoClassified.categoryId) ||
            categories.find((c) => c.id === 'cat-other') ||
            DEFAULT_CATEGORIES[0];
          const eligible = resolveCategoryDefaultCommissionEligible(
            matchedCat.id,
            matchedCat.name,
            commCfg,
            categories
          );
          const autoCode =
            rawItem.productCode ||
            `PRD-${Date.now().toString().slice(-5)}-${idx + 1}`;
          const newProdRow: typeof products.$inferInsert = {
            id: `p-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
            code: autoCode,
            name: rawItem.productName,
            categoryId: matchedCat.id,
            categoryName: matchedCat.name,
            unit: rawItem.unit || autoClassified.defaultUnit || matchedCat.defaultUnit,
            grade: rawItem.grade ?? '',
            pricePerMg: rawItem.price,
            stock: 0,
            isActive: true,
            isCommissionEligible: eligible,
            commissionMode: 'inherit_rep',
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await tx.insert(products).values(newProdRow);
          allProducts.push(newProdRow as typeof products.$inferSelect);
          stockMap.set(newProdRow.id, 0);
          prod = newProdRow as typeof products.$inferSelect;
        }

        let warehouseDeductedQty = 0;
        let externalSuppliedQty = 0;
        let pendingQty = 0;
        let resolvedSource: ItemSourcingSource = 'من المخزون الحالي';
        let procurementStatus: ItemProcurementStatus = 'fulfilled';

        if (requestedSource === 'توفير خارجي دون إدخاله إلى المخزن') {
          externalSuppliedQty = qty;
          resolvedSource = 'توفير خارجي دون إدخاله إلى المخزن';
          procurementStatus = 'fulfilled';

          const curStock = prod ? (stockMap.get(prod.id) ?? prod.stock) : 0;
          const itemUnit = prod?.unit || rawItem.unit || 'وحدة';
          await writeStockMovementTx(tx, {
            productId: prod?.id ?? null,
            productName: rawItem.productName,
            grade: rawItem.grade,
            unit: itemUnit,
            orderId,
            movementType: 'external_direct',
            sourcingSource: resolvedSource,
            quantityDelta: 0,
            orderQuantityCovered: externalSuppliedQty,
            previousStock: curStock,
            newStock: curStock,
            supplierName: rawItem.supplierName ?? null,
            note: rawItem.sourcingNotes || 'تأكيد توفير خارجي مباشر عند اعتماد الفاتورة',
            actor: actorUser,
            createdAt: nowIso,
          });
          if (externalSuppliedQty > 0) {
            const unitCost =
              typeof rawItem.externalUnitCost === 'number' && Number.isFinite(rawItem.externalUnitCost) && rawItem.externalUnitCost >= 0
                ? rawItem.externalUnitCost
                : null;
            const totalSourcingCost =
              typeof rawItem.externalTotalCost === 'number' && Number.isFinite(rawItem.externalTotalCost) && rawItem.externalTotalCost >= 0
                ? rawItem.externalTotalCost
                : unitCost !== null
                  ? unitCost * externalSuppliedQty
                  : null;
            await tx.insert(externalSourcingRecords).values({
              id: `ext-${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}`,
              orderId,
              itemIndex: idx,
              productId: prod?.id ?? rawItem.productId ?? null,
              productCode: prod?.code ?? rawItem.productCode ?? null,
              productName: rawItem.productName,
              categoryId: prod?.categoryId ?? rawItem.categoryId ?? null,
              categoryName: prod?.categoryName ?? rawItem.categoryName ?? null,
              unit: itemUnit,
              sourcingType: 'external_direct',
              supplierName: rawItem.supplierName ?? null,
              externalQty: externalSuppliedQty,
              unitCost,
              totalSourcingCost,
              dateSecured: rawItem.supplierDateSecured || formatCairoYmd(new Date(nowIso)),
              notes: rawItem.sourcingNotes ?? null,
              recordedById: actorUser.id,
              recordedByName: actorUser.name,
              recordedAt: nowIso,
            });
          }
        } else if (
          requestedSource === 'توفير من المورد' ||
          requestedSource === 'بانتظار التوفير'
        ) {
          pendingQty = qty;
          resolvedSource = requestedSource;
          procurementStatus = qty > 0 ? 'pending' : 'fulfilled';
        } else {
          // Default ('من المخزون الحالي' or unspecified): deduct up to available warehouse stock, mark remainder pending
          const curStock = prod ? Math.max(0, stockMap.get(prod.id) ?? prod.stock) : 0;
          const take = prod ? Math.min(curStock, qty) : 0;
          warehouseDeductedQty = take;
          pendingQty = Math.max(0, qty - take);

          if (prod && take > 0) {
            const nextStock = roundStockNumber(curStock - take);
            stockMap.set(prod.id, nextStock);
            await writeStockMovementTx(tx, {
              productId: prod.id,
              productName: rawItem.productName,
              grade: rawItem.grade,
              unit: prod.unit || rawItem.unit || null,
              orderId,
              movementType: 'order_deduction',
              sourcingSource: 'من المخزون الحالي',
              quantityDelta: -take,
              orderQuantityCovered: take,
              previousStock: curStock,
              newStock: nextStock,
              note:
                pendingQty > 0
                  ? `خصم المتاح (${take} ${prod.unit || rawItem.unit || ''}) ووضع المتبقي (${pendingQty}) بانتظار التوفير`
                  : 'خصم كامل الكمية من المخزون عند تأكيد العميل',
              actor: actorUser,
              createdAt: nowIso,
            });
          }

          if (pendingQty > 0) {
            resolvedSource = 'بانتظار التوفير';
            procurementStatus = 'pending';
          } else {
            resolvedSource = 'من المخزون الحالي';
            procurementStatus = 'fulfilled';
          }
        }

        if (pendingQty > 0) pendingItemCount += 1;

        storedItems.push({
          ...rawItem,
          ...(prod ? { productId: prod.id, productCode: prod.code || rawItem.productCode } : {}),
          productName: rawItem.productName,
          grade: rawItem.grade ?? '',
          quantity: qty,
          price: rawItem.price,
          ...(rawItem.isCustom ? { isCustom: true } : {}),
          sourcingSource: resolvedSource,
          warehouseDeductedQty,
          externalSuppliedQty,
          pendingQty,
          procurementStatus,
          ...(rawItem.supplierName ? { supplierName: rawItem.supplierName } : {}),
          ...(rawItem.sourcingNotes ? { sourcingNotes: rawItem.sourcingNotes } : {}),
          receivedIntoWarehouse: false,
          sourcingUpdatedBy: actorUser.name,
          sourcingUpdatedAt: nowIso,
        });
      }

      for (const p of allProducts) {
        const nextStock = stockMap.get(p.id);
        if (nextStock !== undefined && nextStock !== p.stock) {
          await tx.update(products).set({ stock: Math.max(0, nextStock) }).where(eq(products.id, p.id));
        }
      }

      // Recompute & freeze authoritative commission & rule snapshot at confirmation moment
      const [latestProdRowsAtConfirm, categoriesAtConfirm, commCfgAtConfirm, repRowsAtConfirm] =
        await Promise.all([
          tx.select().from(products),
          getAllCategories(),
          getCommissionConfig(),
          tx.select().from(salesReps).where(eq(salesReps.id, prevOrder.salesRepId)),
        ]);
      const confirmRep = repRowsAtConfirm[0];
      const computedAtConfirm = calculateOrderFinancialsAndCommission({
        items: storedItems,
        discountPercentage: prevOrder.discountPercentage,
        shippingCost: prevOrder.shippingCost,
        repBaseRate: confirmRep?.customCommissionRate ?? commCfgAtConfirm.defaultOilCommissionRate,
        repCategoryRates: confirmRep?.categoryRates ?? {},
        commissionConfig: commCfgAtConfirm,
        productsCatalog: latestProdRowsAtConfirm.map(mapProductRow),
        categoriesCatalog: categoriesAtConfirm,
        capturedAt: nowIso,
      });

      const nextStatus: OrderStatus = 'طلب جديد';
      const noteDetail =
        pendingItemCount > 0
          ? `تأكيد العميل وإرسال الطلب للتجهيز (توجد ${pendingItemCount} أصناف بكميات بانتظار التوفير دون حظر)`
          : 'تأكيد العميل على الفاتورة وإرسال الطلب للتجهيز (تم احتساب المخزون والعمولة)';

      const nextHistory: OrderStatusHistoryEntry[] = [
        ...(prevOrder.statusHistory ?? []),
        {
          fromStatus: prevStatus,
          toStatus: nextStatus,
          changedById: actorUser.id,
          changedByName: actorUser.name,
          changedByRole: actorUser.role,
          changedAt: nowIso,
          note: noteDetail,
        },
      ];

      await tx
        .update(orders)
        .set({
          items: computedAtConfirm.items,
          subtotal: computedAtConfirm.subtotal,
          discountAmount: computedAtConfirm.discountAmount,
          totalAmount: computedAtConfirm.totalAmount,
          commission: computedAtConfirm.commission,
          commissionableSubtotal: computedAtConfirm.commissionableSubtotal,
          commissionRateSnapshot: computedAtConfirm.commissionRateSnapshot,
          commissionRuleSnapshot: computedAtConfirm.commissionRuleSnapshot,
          status: nextStatus,
          confirmedAt: nowIso,
          confirmedById: actorUser.id,
          confirmedByName: actorUser.name,
          statusHistory: nextHistory,
        })
        .where(eq(orders.id, orderId));

      // 3. Add pendingCommission & ordersCount once upon confirmation
      if (confirmRep) {
        await tx
          .update(salesReps)
          .set({
            pendingCommission: confirmRep.pendingCommission + computedAtConfirm.commission,
            ordersCount: confirmRep.ordersCount + 1,
          })
          .where(eq(salesReps.id, confirmRep.id));
      }

      // 4. Update customer totals now that invoice is confirmed
      const allCustomers = await tx.select().from(customers);
      const matchedCust = allCustomers.find(
        (c) =>
          c.name.trim() === prevOrder.customerName.trim() ||
          (Boolean(prevOrder.customerPhone) && c.phone === prevOrder.customerPhone)
      );
      if (!matchedCust) {
        await tx.insert(customers).values({
          id: `c-${Date.now()}`,
          name: prevOrder.customerName,
          phone: prevOrder.customerPhone,
          address: prevOrder.customerAddress || null,
          totalSpent: computedAtConfirm.totalAmount,
          classification: computeClassification(computedAtConfirm.totalAmount),
          lastOrderDate: prevOrder.createdAt,
        });
      } else {
        await recomputeCustomerTotalsTx(tx, [
          { name: prevOrder.customerName, phone: prevOrder.customerPhone },
        ]);
      }

      await writeAuditLogTx(tx, {
        orderId,
        actionType: 'order_confirmed',
        actor: actorUser,
        details: {
          fromStatus: prevStatus,
          toStatus: nextStatus,
          totalAmount: prevOrder.totalAmount,
          commission: prevOrder.commission,
          pendingProcurementItems: pendingItemCount,
        },
        createdAt: nowIso,
      });

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const revRows = await tx
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion));
      return mapOrderRow(updatedRow, revRows.map(mapRevisionRow));
    });
  } catch (error) {
    console.error('Database query failed in confirmOrderRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') ||
        error.message.includes('ملغاة') ||
        error.message.includes('مسبقاً') ||
        error.message.includes('خالية'))
    ) {
      throw error;
    }
    throw new Error('Failed to confirm order in database.', { cause: error });
  }
}

export function isPendingCommissionStatus(status: OrderStatus): boolean {
  return (
    status === 'طلب جديد' ||
    status === 'قيد التنفيذ' ||
    status === 'بانتظار التجهيز' ||
    status === 'جاري التجهيز' ||
    status === 'تم التجهيز' ||
    status === 'تم الشحن'
  );
}

export function isCancelledOrReturnedStatus(status: OrderStatus): boolean {
  return status === 'مرتجع' || status === 'رفض استلام' || status === 'ملغي';
}

export function isSalesDirectEditableStatus(status: OrderStatus): boolean {
  return (
    status === 'بانتظار تأكيد العميل' ||
    status === 'طلب جديد' ||
    status === 'بانتظار التجهيز' ||
    status === 'قيد التنفيذ'
  );
}

export function isSalesEditRequestStatus(status: OrderStatus): boolean {
  return status === 'جاري التجهيز' || status === 'تم التجهيز';
}

export const ALLOWED_OPERATIONAL_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  'بانتظار تأكيد العميل': [],
  'طلب جديد': ['بانتظار التجهيز', 'جاري التجهيز', 'ملغي'],
  'قيد التنفيذ': [
    'بانتظار التجهيز',
    'جاري التجهيز',
    'تم التجهيز',
    'تم الشحن',
    'تم التسليم',
    'مرتجع',
    'رفض استلام',
    'ملغي',
  ],
  'بانتظار التجهيز': ['جاري التجهيز', 'ملغي'],
  'جاري التجهيز': ['تم التجهيز', 'بانتظار التجهيز', 'ملغي'],
  'تم التجهيز': ['تم الشحن', 'جاري التجهيز', 'ملغي'],
  'تم الشحن': ['تم التسليم', 'مرتجع', 'رفض استلام', 'جاري التجهيز', 'بانتظار التجهيز'],
  'مرتجع': ['بانتظار التجهيز', 'جاري التجهيز'],
  'رفض استلام': ['بانتظار التجهيز', 'جاري التجهيز', 'مرتجع'],
  'تم التسليم': ['مرتجع', 'جاري التجهيز'],
  'ملغي': ['بانتظار التجهيز'],
};

const VALID_RETURN_REASONS: OrderReturnPrimaryReason[] = [
  'رفض الاستلام',
  'العميل لم يرد',
  'العنوان غير صحيح',
  'العميل طلب الإلغاء',
  'سبب آخر',
];

export interface StatusTransitionOptions {
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

export interface OrderUpdateOptions {
  actor?: User;
  reason?: string;
  expectedVersion?: number;
  note?: string;
  isEditRequestApproval?: boolean;
}

function getEffectiveLegacyWarehouseQty(
  item: OrderItem,
  matchedProd: typeof products.$inferSelect | undefined
): { ware: number; ext: number; pend: number } {
  const qty = Math.max(0, Number(item.quantity));
  if (typeof item.warehouseDeductedQty === 'number') {
    const ware = Math.max(0, Number(item.warehouseDeductedQty));
    const ext = Math.max(0, Number(item.externalSuppliedQty ?? 0));
    const pend =
      typeof item.pendingQty === 'number'
        ? Math.max(0, Number(item.pendingQty))
        : Math.max(0, qty - ware - ext);
    return { ware, ext, pend };
  }
  if (typeof item.externalSuppliedQty === 'number' || typeof item.pendingQty === 'number') {
    const ext = Math.max(0, Number(item.externalSuppliedQty ?? 0));
    const pend =
      typeof item.pendingQty === 'number' ? Math.max(0, Number(item.pendingQty)) : Math.max(0, qty - ext);
    return { ware: 0, ext, pend };
  }
  // Legacy confirmed item created before multi-source tracking
  if (matchedProd) {
    return { ware: qty, ext: 0, pend: 0 };
  }
  return { ware: 0, ext: qty, pend: 0 };
}

export async function updateOrderRecord(
  orderId: string,
  orderData: Omit<Order, 'id' | 'createdAt'>,
  canEditAnytime: boolean,
  canEditPrepared = false,
  auditHistoryNoteOrOptions?: { actor: User; note: string } | OrderUpdateOptions
): Promise<Order> {
  try {
    const updateOpts: OrderUpdateOptions =
      auditHistoryNoteOrOptions && 'actor' in auditHistoryNoteOrOptions
        ? {
            actor: auditHistoryNoteOrOptions.actor,
            note: 'note' in auditHistoryNoteOrOptions ? auditHistoryNoteOrOptions.note : undefined,
            reason: 'reason' in auditHistoryNoteOrOptions ? auditHistoryNoteOrOptions.reason : undefined,
            expectedVersion:
              'expectedVersion' in auditHistoryNoteOrOptions
                ? auditHistoryNoteOrOptions.expectedVersion
                : undefined,
            isEditRequestApproval:
              'isEditRequestApproval' in auditHistoryNoteOrOptions
                ? auditHistoryNoteOrOptions.isEditRequestApproval
                : undefined,
          }
        : (auditHistoryNoteOrOptions ?? {});

    const updatedOrder = await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');

      if (existingRows.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existingRows[0];
      const prevStatus = prevOrder.status as OrderStatus;
      const currentVersion = prevOrder.version ?? 1;

      if (
        typeof updateOpts.expectedVersion === 'number' &&
        updateOpts.expectedVersion !== currentVersion
      ) {
        throw new Error(
          'تم تعديل هذه الفاتورة في عملية أخرى بالفعل، يرجى تحديث الصفحة والمحاولة مرة أخرى.'
        );
      }

      if (!canEditAnytime) {
        if (!isSalesDirectEditableStatus(prevStatus)) {
          if (isSalesEditRequestStatus(prevStatus)) {
            if (!canEditPrepared) {
              throw new Error(
                `الطلب في حالة "${prevStatus}"؛ يرجى إرسال طلب تعديل لمسؤول التجهيز والشحن.`
              );
            }
          } else {
            throw new Error(
              'لا يمكن تعديل الفاتورة بعد شحن الطلب أو إغلاقه. المدير العام فقط يمكنه التعديل.'
            );
          }
        }
      }

      const isDraft = !hasOrderBeenConfirmed(prevOrder);
      const cleanedInputItems = sanitizeOrderItemsForStorage(orderData.items, true);
      if (cleanedInputItems.length === 0) {
        throw new Error('يجب أن تحتوي الفاتورة على صنف واحد على الأقل.');
      }

      const nowIso = new Date().toISOString();
      const actor: User = updateOpts.actor || {
        id: prevOrder.salesRepId || 'system',
        name: prevOrder.salesRepName || 'النظام',
        username: 'system',
        role: canEditAnytime ? 'admin' : 'sales',
        isSuspended: false,
        isMuted: false,
        canEditInventory: false,
        canConfirmDelivery: false,
        canManageOrderStatus: canEditPrepared,
      };

      let finalStoredItems: OrderItem[] = cleanedInputItems;

      // 1. Inventory & Commission reconciliation ONLY for confirmed orders
      if (!isDraft) {
        const allProducts = await tx.select().from(products);
        const stockMap = new Map<string, number>(allProducts.map((p) => [p.id, p.stock]));

        // Group previously allocated pools per product key
        const prevPoolsByKey = new Map<
          string,
          {
            productName: string;
            grade: OilGrade;
            warePool: number;
            extPool: number;
            receivedIntoWarehouse: boolean;
            supplierName?: string;
            sourcingNotes?: string;
          }
        >();

        for (const oldRaw of prevOrder.items) {
          const oldItem = normalizeOrderItem(oldRaw, false);
          const key = makeItemKey(oldItem.productName, oldItem.grade, oldItem.productCode, oldItem.productId);
          const matchedProd = findMatchingProduct(
            allProducts,
            oldItem.productName,
            oldItem.grade,
            oldItem.productId,
            oldItem.productCode
          );
          const eff = getEffectiveLegacyWarehouseQty(oldItem, matchedProd);
          const existingPool = prevPoolsByKey.get(key);
          if (existingPool) {
            existingPool.warePool += eff.ware;
            existingPool.extPool += eff.ext;
            if (oldItem.receivedIntoWarehouse) existingPool.receivedIntoWarehouse = true;
            if (!existingPool.supplierName && oldItem.supplierName) existingPool.supplierName = oldItem.supplierName;
            if (!existingPool.sourcingNotes && oldItem.sourcingNotes) existingPool.sourcingNotes = oldItem.sourcingNotes;
          } else {
            prevPoolsByKey.set(key, {
              productName: oldItem.productName,
              grade: oldItem.grade,
              warePool: eff.ware,
              extPool: eff.ext,
              receivedIntoWarehouse: Boolean(oldItem.receivedIntoWarehouse),
              supplierName: oldItem.supplierName,
              sourcingNotes: oldItem.sourcingNotes,
            });
          }
        }

        const newTotalQtyByKey = new Map<string, number>();
        for (const newItem of cleanedInputItems) {
          const key = makeItemKey(newItem.productName, newItem.grade, newItem.productCode, newItem.productId);
          newTotalQtyByKey.set(key, (newTotalQtyByKey.get(key) ?? 0) + newItem.quantity);
        }

        for (const [key, pool] of prevPoolsByKey.entries()) {
          const targetTotalQty = newTotalQtyByKey.get(key) ?? 0;
          if (pool.warePool > targetTotalQty) {
            const restoreQty = pool.warePool - targetTotalQty;
            const prod = findMatchingProduct(
              allProducts,
              pool.productName,
              pool.grade,
              key.startsWith('id:') ? key.slice(3) : undefined,
              key.startsWith('code:') ? key.slice(5) : undefined
            );
            if (prod && restoreQty > 0) {
              const curStock = stockMap.get(prod.id) ?? prod.stock;
              const nextStock = roundStockNumber(curStock + restoreQty);
              stockMap.set(prod.id, nextStock);
              await writeStockMovementTx(tx, {
                productId: prod.id,
                productName: pool.productName,
                grade: pool.grade,
                unit: prod.unit || null,
                orderId,
                movementType: 'order_delta_restore',
                sourcingSource: 'من المخزون الحالي',
                quantityDelta: restoreQty,
                orderQuantityCovered: 0,
                previousStock: curStock,
                newStock: nextStock,
                note: 'إرجاع فائض الكمية المخصومة مسبقًا من المخزن بعد تعديل الفاتورة',
                actor,
                createdAt: nowIso,
              });
            }
            pool.warePool = targetTotalQty;
          }
          const maxRemainingAfterWare = Math.max(0, targetTotalQty - pool.warePool);
          if (pool.extPool > maxRemainingAfterWare) {
            pool.extPool = maxRemainingAfterWare;
          }
        }

        const reconciledItems: OrderItem[] = [];
        for (let idx = 0; idx < cleanedInputItems.length; idx++) {
          const newItem = cleanedInputItems[idx];
          const qty = Math.max(0, Number(newItem.quantity));
          const key = makeItemKey(newItem.productName, newItem.grade, newItem.productCode, newItem.productId);
          const pool = prevPoolsByKey.get(key);
          let prod = findMatchingProduct(
            allProducts,
            newItem.productName,
            newItem.grade,
            newItem.productId,
            newItem.productCode
          );

          if (!prod && newItem.addToInventory) {
            const categories = await getAllCategories();
            const commCfg = await getCommissionConfig();
            const autoClassified = classifyProductName(newItem.productName, categories);
            const matchedCat =
              categories.find((c) => c.id === autoClassified.categoryId) ||
              categories.find((c) => c.id === 'cat-other') ||
              DEFAULT_CATEGORIES[0];
            const eligible = resolveCategoryDefaultCommissionEligible(
              matchedCat.id,
              matchedCat.name,
              commCfg,
              categories
            );
            const autoCode =
              newItem.productCode ||
              `PRD-${Date.now().toString().slice(-5)}-${idx + 1}`;
            const newProdRow: typeof products.$inferInsert = {
              id: `p-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
              code: autoCode,
              name: newItem.productName,
              categoryId: matchedCat.id,
              categoryName: matchedCat.name,
              unit: newItem.unit || autoClassified.defaultUnit || matchedCat.defaultUnit,
              grade: newItem.grade ?? '',
              pricePerMg: newItem.price,
              stock: 0,
              isActive: true,
              isCommissionEligible: eligible,
              commissionMode: 'inherit_rep',
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            await tx.insert(products).values(newProdRow);
            allProducts.push(newProdRow as typeof products.$inferSelect);
            stockMap.set(newProdRow.id, 0);
            prod = newProdRow as typeof products.$inferSelect;
          }

          let warehouseDeductedQty = 0;
          let externalSuppliedQty = 0;
          let pendingQty = 0;

          if (pool && pool.warePool > 0) {
            const takeFromWarePool = Math.min(pool.warePool, qty);
            warehouseDeductedQty += takeFromWarePool;
            pool.warePool -= takeFromWarePool;
          }
          if (pool && pool.extPool > 0 && warehouseDeductedQty < qty) {
            const takeFromExtPool = Math.min(pool.extPool, qty - warehouseDeductedQty);
            externalSuppliedQty += takeFromExtPool;
            pool.extPool -= takeFromExtPool;
          }

          const remainingNeed = Math.max(0, qty - warehouseDeductedQty - externalSuppliedQty);
          let resolvedSource: ItemSourcingSource =
            newItem.sourcingSource ||
            (externalSuppliedQty > 0 && warehouseDeductedQty === 0
              ? 'توفير خارجي دون إدخاله إلى المخزن'
              : 'من المخزون الحالي');

          if (remainingNeed > 0) {
            if (newItem.sourcingSource === 'توفير خارجي دون إدخاله إلى المخزن') {
              externalSuppliedQty += remainingNeed;
              resolvedSource = 'توفير خارجي دون إدخاله إلى المخزن';
              const curStock = prod ? (stockMap.get(prod.id) ?? prod.stock) : 0;
              await writeStockMovementTx(tx, {
                productId: prod?.id ?? null,
                productName: newItem.productName,
                grade: newItem.grade,
                unit: prod?.unit || newItem.unit || null,
                orderId,
                movementType: 'external_direct',
                sourcingSource: resolvedSource,
                quantityDelta: 0,
                orderQuantityCovered: remainingNeed,
                previousStock: curStock,
                newStock: curStock,
                supplierName: newItem.supplierName ?? null,
                note: newItem.sourcingNotes || 'تغطية الزيادة عبر توفير خارجي مباشر عند تعديل الفاتورة',
                actor,
                createdAt: nowIso,
              });
            } else if (
              newItem.sourcingSource === 'توفير من المورد' ||
              newItem.sourcingSource === 'بانتظار التوفير'
            ) {
              pendingQty += remainingNeed;
              resolvedSource = newItem.sourcingSource;
            } else {
              const curStock = prod ? Math.max(0, stockMap.get(prod.id) ?? prod.stock) : 0;
              const takeNew = prod ? Math.min(curStock, remainingNeed) : 0;
              if (prod && takeNew > 0) {
                const nextStock = roundStockNumber(curStock - takeNew);
                stockMap.set(prod.id, nextStock);
                warehouseDeductedQty += takeNew;
                await writeStockMovementTx(tx, {
                  productId: prod.id,
                  productName: newItem.productName,
                  grade: newItem.grade,
                  unit: prod.unit || newItem.unit || null,
                  orderId,
                  movementType: 'order_delta_deduction',
                  sourcingSource: 'من المخزون الحالي',
                  quantityDelta: -takeNew,
                  orderQuantityCovered: takeNew,
                  previousStock: curStock,
                  newStock: nextStock,
                  note: 'خصم الكمية الإضافية من المخزن عند تعديل الفاتورة',
                  actor,
                  createdAt: nowIso,
                });
              }
              const shortage = Math.max(0, remainingNeed - takeNew);
              pendingQty += shortage;
              if (pendingQty > 0) {
                resolvedSource = 'بانتظار التوفير';
              } else if (warehouseDeductedQty > 0) {
                resolvedSource = 'من المخزون الحالي';
              }
            }
          } else {
            // Fully covered by carried-over pools
            if (warehouseDeductedQty > 0 && pendingQty === 0) {
              resolvedSource =
                newItem.sourcingSource === 'توفير من المورد'
                  ? 'توفير من المورد'
                  : 'من المخزون الحالي';
            } else if (externalSuppliedQty > 0 && warehouseDeductedQty === 0) {
              resolvedSource = 'توفير خارجي دون إدخاله إلى المخزن';
            }
          }

          const procurementStatus: ItemProcurementStatus = pendingQty > 0 ? 'pending' : 'fulfilled';
          reconciledItems.push({
            ...newItem,
            ...(prod ? { productId: prod.id, productCode: prod.code || newItem.productCode } : {}),
            productName: newItem.productName,
            grade: newItem.grade ?? '',
            quantity: qty,
            price: newItem.price,
            ...(newItem.isCustom ? { isCustom: true } : {}),
            sourcingSource: resolvedSource,
            warehouseDeductedQty,
            externalSuppliedQty,
            pendingQty,
            procurementStatus,
            ...(newItem.supplierName || pool?.supplierName
              ? { supplierName: newItem.supplierName || pool?.supplierName }
              : {}),
            ...(newItem.sourcingNotes || pool?.sourcingNotes
              ? { sourcingNotes: newItem.sourcingNotes || pool?.sourcingNotes }
              : {}),
            receivedIntoWarehouse: Boolean(
              newItem.receivedIntoWarehouse ?? pool?.receivedIntoWarehouse ?? false
            ),
            sourcingUpdatedBy: newItem.sourcingUpdatedBy || actor.name,
            sourcingUpdatedAt: newItem.sourcingUpdatedAt || nowIso,
          });
        }

        finalStoredItems = reconciledItems;

        for (const p of allProducts) {
          const nextStock = stockMap.get(p.id);
          if (nextStock !== undefined && nextStock !== p.stock) {
            await tx.update(products).set({ stock: Math.max(0, nextStock) }).where(eq(products.id, p.id));
          }
        }
      } else {
        // Draft stays un-deducted
        finalStoredItems = sanitizeOrderItemsForStorage(cleanedInputItems, true);
      }

      // Authoritative Server Commission & Totals Calculation (for eligible items only; respects historical snapshot base rate)
      const [latestProdRows, latestCategories, latestCommCfg, repRowsForCalc] = await Promise.all([
        tx.select().from(products),
        getAllCategories(),
        getCommissionConfig(),
        tx.select().from(salesReps),
      ]);
      const latestCatalog = latestProdRows.map(mapProductRow);
      const effectiveCustomerName =
        typeof orderData.customerName === 'string' && orderData.customerName.trim()
          ? orderData.customerName
          : prevOrder.customerName;
      const effectiveCustomerPhone =
        typeof orderData.customerPhone === 'string'
          ? orderData.customerPhone
          : prevOrder.customerPhone;
      const effectiveCustomerAddress =
        typeof orderData.customerAddress === 'string'
          ? orderData.customerAddress
          : prevOrder.customerAddress;
      const effectiveSalesRepId =
        typeof orderData.salesRepId === 'string' && orderData.salesRepId.trim()
          ? orderData.salesRepId
          : prevOrder.salesRepId;
      const effectiveSalesRepName =
        typeof orderData.salesRepName === 'string' && orderData.salesRepName.trim()
          ? orderData.salesRepName
          : prevOrder.salesRepName;
      const effectiveDiscountPct =
        orderData.discountPercentage !== undefined
          ? orderData.discountPercentage
          : prevOrder.discountPercentage;
      const effectiveShippingCost =
        orderData.shippingCost !== undefined
          ? orderData.shippingCost
          : prevOrder.shippingCost;

      const targetRep = repRowsForCalc.find((r) => r.id === effectiveSalesRepId);
      const keepHistoricalSnapshot =
        !isDraft && effectiveSalesRepId === prevOrder.salesRepId ? prevOrder.commissionRuleSnapshot : null;
      const repBaseRateForEdit =
        keepHistoricalSnapshot && typeof keepHistoricalSnapshot.repBaseRate === 'number'
          ? keepHistoricalSnapshot.repBaseRate
          : (targetRep?.customCommissionRate ?? latestCommCfg.defaultOilCommissionRate);

      const computedOrderFinancials = calculateOrderFinancialsAndCommission({
        items: finalStoredItems,
        discountPercentage: effectiveDiscountPct,
        shippingCost: effectiveShippingCost,
        repBaseRate: repBaseRateForEdit,
        repCategoryRates: targetRep?.categoryRates ?? {},
        commissionConfig: latestCommCfg,
        productsCatalog: latestCatalog,
        categoriesCatalog: latestCategories,
        frozenSnapshot: keepHistoricalSnapshot,
        capturedAt: keepHistoricalSnapshot?.capturedAt || nowIso,
      });

      finalStoredItems = computedOrderFinancials.items;
      const authoritativeSubtotal = computedOrderFinancials.subtotal;
      const authoritativeDiscountAmount = computedOrderFinancials.discountAmount;
      const authoritativeTotal = computedOrderFinancials.totalAmount;
      const authoritativeCommission = computedOrderFinancials.commission;

      // Compute diff and decoupled status/revision behavior
      const nextVersion = currentVersion + 1;
      const { addedItems, removedItems, modifiedItems } = computeOrderItemDiffs(
        prevOrder.items,
        finalStoredItems
      );
      const requiresRePreparation =
        addedItems.length > 0 ||
        removedItems.length > 0 ||
        modifiedItems.some((m) => m.quantityDelta !== 0);

      let targetStatus: OrderStatus =
        canEditAnytime && orderData.status && orderData.status !== 'بانتظار تأكيد العميل'
          ? orderData.status
          : prevStatus;

      const isPreShipmentOperational =
        !isDraft &&
        (prevStatus === 'طلب جديد' ||
          prevStatus === 'قيد التنفيذ' ||
          prevStatus === 'بانتظار التجهيز' ||
          prevStatus === 'جاري التجهيز' ||
          prevStatus === 'تم التجهيز');

      const orderHasPendingProcurement = hasOrderPendingProcurement({ items: finalStoredItems });
      const needsPhysicalRePrep = requiresRePreparation || orderHasPendingProcurement;

      let reviewStatus: RevisionAlertStatus = 'لا يوجد تعديل معلق';
      let nextPrepStartedAt = prevOrder.prepStartedAt ?? null;
      let nextPrepCompletedAt = prevOrder.prepCompletedAt ?? null;

      if (isPreShipmentOperational) {
        if (updateOpts.isEditRequestApproval) {
          if (prevStatus === 'تم التجهيز') {
            if (needsPhysicalRePrep) {
              targetStatus = 'جاري التجهيز';
              nextPrepStartedAt = prevOrder.prepStartedAt || nowIso;
              nextPrepCompletedAt = null;
              reviewStatus = 'يحتاج إعادة تجهيز';
            } else {
              // Price / discount / shipping / phone / address / notes only
              targetStatus = prevStatus;
              reviewStatus = 'تمت مراجعة التعديل واعتماده';
            }
          } else {
            // Order is 'جاري التجهيز' or earlier
            reviewStatus = needsPhysicalRePrep
              ? 'يحتاج إعادة تجهيز'
              : 'تمت مراجعة التعديل واعتماده';
          }
        } else {
          // Direct edit via PUT /api/orders/:id on a pre-shipment operational order
          if (prevStatus === 'تم التجهيز' && needsPhysicalRePrep) {
            targetStatus = 'جاري التجهيز';
            nextPrepStartedAt = prevOrder.prepStartedAt || nowIso;
            nextPrepCompletedAt = null;
            reviewStatus = 'يحتاج إعادة تجهيز';
          } else {
            reviewStatus = 'تعديل جديد يحتاج المراجعة';
          }
        }
      }

      // 2. Reconcile sales rep commissions & counts cleanly (delta-safe) using final targetStatus!
      if (!isDraft) {
        const allReps = await tx.select().from(salesReps);
        const repMap = new Map(allReps.map((r) => [r.id, { ...r }]));

        const prevRep = repMap.get(prevOrder.salesRepId);
        if (prevRep) {
          if (prevStatus === 'تم التسليم') {
            prevRep.totalCommission = Math.max(0, prevRep.totalCommission - prevOrder.commission);
          } else if (isPendingCommissionStatus(prevStatus)) {
            prevRep.pendingCommission = Math.max(0, prevRep.pendingCommission - prevOrder.commission);
          }
          if (effectiveSalesRepId !== prevOrder.salesRepId) {
            prevRep.ordersCount = Math.max(0, prevRep.ordersCount - 1);
          }
        }

        const nextRep = repMap.get(effectiveSalesRepId);
        if (nextRep) {
          if (targetStatus === 'تم التسليم') {
            nextRep.totalCommission += authoritativeCommission;
          } else if (isPendingCommissionStatus(targetStatus)) {
            nextRep.pendingCommission += authoritativeCommission;
          }
          if (effectiveSalesRepId !== prevOrder.salesRepId) {
            nextRep.ordersCount += 1;
          }
        }

        if (prevRep) {
          await tx
            .update(salesReps)
            .set({
              totalCommission: prevRep.totalCommission,
              pendingCommission: prevRep.pendingCommission,
              ordersCount: prevRep.ordersCount,
            })
            .where(eq(salesReps.id, prevRep.id));
        }
        if (nextRep && nextRep.id !== prevRep?.id) {
          await tx
            .update(salesReps)
            .set({
              totalCommission: nextRep.totalCommission,
              pendingCommission: nextRep.pendingCommission,
              ordersCount: nextRep.ordersCount,
            })
            .where(eq(salesReps.id, nextRep.id));
        }
      }

      const revisionId = `rev-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const diffSummaryParts: string[] = [];
      if (addedItems.length > 0) diffSummaryParts.push(`إضافة ${addedItems.length} صنف`);
      if (removedItems.length > 0) diffSummaryParts.push(`حذف ${removedItems.length} صنف`);
      if (modifiedItems.length > 0) {
        const qtyModified = modifiedItems.filter((m) => m.quantityDelta !== 0).length;
        const priceOnlyModified = modifiedItems.filter((m) => m.quantityDelta === 0).length;
        if (qtyModified > 0) diffSummaryParts.push(`تعديل كمية ${qtyModified} صنف`);
        if (priceOnlyModified > 0) diffSummaryParts.push(`تعديل سعر ${priceOnlyModified} صنف`);
      }
      if (diffSummaryParts.length === 0 && prevOrder.totalAmount !== authoritativeTotal) {
        diffSummaryParts.push('تحديث الإجمالي أو الخصم/الشحن');
      }
      if (diffSummaryParts.length === 0) {
        diffSummaryParts.push('تحديث بيانات العميل أو الملاحظات');
      }
      const summaryText = diffSummaryParts.join(' · ');

      await tx.insert(orderRevisions).values({
        id: revisionId,
        orderId,
        fromVersion: currentVersion,
        toVersion: nextVersion,
        editedById: actor.id,
        editedByName: actor.name,
        editedByRole: actor.role,
        editedAt: nowIso,
        reason: updateOpts.reason?.trim() || updateOpts.note?.trim() || null,
        orderStatusAtEdit: prevStatus,
        addedItems,
        removedItems,
        modifiedItems,
        previousItemCount: prevOrder.items.length,
        newItemCount: finalStoredItems.length,
        previousTotal: prevOrder.totalAmount,
        newTotal: authoritativeTotal,
        previousCommission: prevOrder.commission,
        newCommission: authoritativeCommission,
        requiresRePreparation,
        reviewStatus,
        ...(updateOpts.isEditRequestApproval
          ? {
              reviewedById: actor.id,
              reviewedByName: actor.name,
              reviewedAt: nowIso,
              reviewNote: needsPhysicalRePrep
                ? 'تم اعتماد التعديل وتحويل الطلب لإعادة التجهيز'
                : 'تمت مراجعة التعديل واعتماده بدون الحاجة لإعادة التجهيز',
            }
          : {}),
      });

      const nextRevisionAlert: OrderRevisionAlert | null = isPreShipmentOperational
        ? {
            status: reviewStatus,
            latestRevisionId: revisionId,
            latestVersion: nextVersion,
            editedByName: actor.name,
            editedAt: nowIso,
            summary: `${summaryText}${updateOpts.reason?.trim() ? ` — ${updateOpts.reason.trim()}` : ''}`,
            requiresRePreparation: needsPhysicalRePrep,
            hasPendingEditRequest: false,
            ...(updateOpts.isEditRequestApproval
              ? {
                  reviewedById: actor.id,
                  reviewedByName: actor.name,
                  reviewedAt: nowIso,
                  reviewNote: needsPhysicalRePrep
                    ? 'إعادة تجهيز مطلوبة بسبب تعديل الأصناف/الكميات'
                    : 'تعديل إداري/مالي معتمد بدون إعادة تجهيز',
                }
              : {}),
          }
        : prevOrder.revisionAlert ?? null;

      const nextGovernorate =
        orderData.governorate !== undefined
          ? orderData.governorate.trim() || null
          : prevOrder.governorate;

      const revisionHistoryNote =
        updateOpts.note?.trim() ||
        `تعديل الفاتورة (v${currentVersion} ← v${nextVersion}): ${summaryText}${
          updateOpts.reason?.trim() ? ` — ${updateOpts.reason.trim()}` : ''
        }`;

      const nextStatusHistory: OrderStatusHistoryEntry[] = [
        ...(prevOrder.statusHistory ?? []),
        {
          fromStatus: prevStatus,
          toStatus: targetStatus,
          changedById: actor.id,
          changedByName: actor.name,
          changedByRole: actor.role,
          changedAt: nowIso,
          note:
            targetStatus !== prevStatus
              ? `${revisionHistoryNote} (تم التحويل تلقائيًا إلى "${targetStatus}" لإعادة التجهيز)`
              : revisionHistoryNote,
        },
      ];

      await tx
        .update(orders)
        .set({
          customerName: effectiveCustomerName,
          customerPhone: effectiveCustomerPhone,
          customerAddress: effectiveCustomerAddress,
          governorate: nextGovernorate,
          customerNotes:
            orderData.customerNotes !== undefined
              ? orderData.customerNotes ?? null
              : prevOrder.customerNotes,
          salesRepId: effectiveSalesRepId,
          salesRepName: effectiveSalesRepName,
          items: finalStoredItems,
          subtotal: authoritativeSubtotal,
          discountPercentage: computedOrderFinancials.discountPercentage,
          discountAmount: authoritativeDiscountAmount,
          shippingCost: computedOrderFinancials.shippingCost,
          totalAmount: authoritativeTotal,
          status: targetStatus,
          commission: authoritativeCommission,
          commissionableSubtotal: computedOrderFinancials.commissionableSubtotal,
          commissionRateSnapshot: computedOrderFinancials.commissionRateSnapshot,
          commissionRuleSnapshot: computedOrderFinancials.commissionRuleSnapshot,
          version: nextVersion,
          prepStartedAt: nextPrepStartedAt,
          prepCompletedAt: nextPrepCompletedAt,
          pendingEditRequest: null,
          statusHistory: nextStatusHistory,
          revisionAlert: nextRevisionAlert,
        })
        .where(eq(orders.id, orderId));

      if (!isDraft) {
        const allCustomers = await tx.select().from(customers);
        const nextCustExists = allCustomers.some(
          (c) =>
            c.name.trim() === effectiveCustomerName.trim() ||
            (Boolean(effectiveCustomerPhone) && c.phone === effectiveCustomerPhone)
        );
        if (!nextCustExists) {
          await tx.insert(customers).values({
            id: `c-${Date.now()}`,
            name: effectiveCustomerName,
            phone: effectiveCustomerPhone,
            address: effectiveCustomerAddress || null,
            totalSpent: authoritativeTotal,
            classification: computeClassification(authoritativeTotal),
            lastOrderDate: prevOrder.createdAt,
          });
        }
        await recomputeCustomerTotalsTx(tx, [
          { name: prevOrder.customerName, phone: prevOrder.customerPhone },
          { name: effectiveCustomerName, phone: effectiveCustomerPhone },
        ]);
      }

      await writeAuditLogTx(tx, {
        orderId,
        actionType: isDraft ? 'order_draft_updated' : 'order_revised',
        actor,
        details: {
          fromVersion: currentVersion,
          toVersion: nextVersion,
          statusAtEdit: prevStatus,
          targetStatus,
          addedCount: addedItems.length,
          removedCount: removedItems.length,
          modifiedCount: modifiedItems.length,
          requiresRePreparation: needsPhysicalRePrep,
          previousTotal: prevOrder.totalAmount,
          newTotal: authoritativeTotal,
          previousCommission: prevOrder.commission,
          newCommission: authoritativeCommission,
          reviewStatus,
        },
        createdAt: nowIso,
      });

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const revRows = await tx
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion));
      return mapOrderRow(updatedRow, revRows.map(mapRevisionRow));
    });

    return updatedOrder;
  } catch (error) {
    console.error('Database query failed in updateOrderRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('لا يمكن تعديل') ||
        error.message.includes('غير موجودة') ||
        error.message.includes('طلب تعديل') ||
        error.message.includes('تم تعديل هذه الفاتورة') ||
        error.message.includes('صنف واحد'))
    ) {
      throw error;
    }
    throw new Error('Failed to update order in database.', { cause: error });
  }
}

export async function submitOrderEditRequestRecord(
  orderId: string,
  editRequest: OrderEditRequest
): Promise<Order> {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (rows.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = rows[0];
      const prevStatus = prevOrder.status as OrderStatus;
      if (!isSalesEditRequestStatus(prevStatus)) {
        throw new Error('طلبات التعديل متاحة فقط في مرحلة "جاري التجهيز" أو "تم التجهيز".');
      }

      const sanitizedReqItems = sanitizeOrderItemsForStorage(editRequest.items || [], true);
      const [allProdRows, categoriesCatalog, commConfig, repRows] = await Promise.all([
        tx.select().from(products),
        getAllCategories(),
        getCommissionConfig(),
        tx.select().from(salesReps),
      ]);
      const productsCatalog = allProdRows.map(mapProductRow);
      const targetRepId = editRequest.salesRepId || prevOrder.salesRepId;
      const rep = repRows.find((r) => r.id === targetRepId);
      const keepSnapshot =
        targetRepId === prevOrder.salesRepId ? prevOrder.commissionRuleSnapshot : null;
      const repBaseRate =
        keepSnapshot && typeof keepSnapshot.repBaseRate === 'number'
          ? keepSnapshot.repBaseRate
          : (rep?.customCommissionRate ?? commConfig.defaultOilCommissionRate);

      const computedReq = calculateOrderFinancialsAndCommission({
        items: sanitizedReqItems,
        discountPercentage: editRequest.discountPercentage,
        shippingCost: editRequest.shippingCost,
        repBaseRate,
        repCategoryRates: rep?.categoryRates ?? {},
        commissionConfig: commConfig,
        productsCatalog,
        categoriesCatalog,
        frozenSnapshot: keepSnapshot,
        capturedAt: keepSnapshot?.capturedAt || editRequest.requestedAt,
      });

      const storedEditRequest: OrderEditRequest = {
        ...editRequest,
        items: computedReq.items,
        subtotal: computedReq.subtotal,
        discountPercentage: computedReq.discountPercentage,
        discountAmount: computedReq.discountAmount,
        shippingCost: computedReq.shippingCost,
        totalAmount: computedReq.totalAmount,
        commission: computedReq.commission,
      };

      const { addedItems, removedItems, modifiedItems } = computeOrderItemDiffs(
        prevOrder.items,
        computedReq.items
      );
      const requiresRePreparation =
        addedItems.length > 0 ||
        removedItems.length > 0 ||
        modifiedItems.some((m) => m.quantityDelta !== 0);

      const summaryParts: string[] = [];
      if (addedItems.length > 0) summaryParts.push(`إضافة ${addedItems.length} صنف`);
      if (removedItems.length > 0) summaryParts.push(`حذف ${removedItems.length} صنف`);
      if (modifiedItems.length > 0) {
        const qtyMod = modifiedItems.filter((m) => m.quantityDelta !== 0).length;
        const priceMod = modifiedItems.filter((m) => m.quantityDelta === 0).length;
        if (qtyMod > 0) summaryParts.push(`تعديل كمية ${qtyMod} صنف`);
        if (priceMod > 0) summaryParts.push(`تعديل سعر ${priceMod} صنف`);
      }
      if (summaryParts.length === 0 && prevOrder.totalAmount !== storedEditRequest.totalAmount) {
        summaryParts.push('تعديل الخصم أو الشحن أو الإجمالي');
      }
      if (summaryParts.length === 0) {
        summaryParts.push('تعديل بيانات العميل أو الملاحظات');
      }

      const nextRevisionAlert: OrderRevisionAlert = {
        status: 'تعديل جديد يحتاج المراجعة',
        latestRevisionId: prevOrder.revisionAlert?.latestRevisionId,
        latestVersion: prevOrder.version ?? 1,
        editedByName: storedEditRequest.requestedByName,
        editedAt: storedEditRequest.requestedAt,
        summary: `${summaryParts.join(' · ')}${storedEditRequest.reason?.trim() ? ` — ${storedEditRequest.reason.trim()}` : ''}`,
        requiresRePreparation,
        hasPendingEditRequest: true,
      };

      const nextHistory: OrderStatusHistoryEntry[] = [
        ...(prevOrder.statusHistory ?? []),
        {
          fromStatus: prevStatus,
          toStatus: prevStatus,
          changedById: storedEditRequest.requestedById,
          changedByName: storedEditRequest.requestedByName,
          changedByRole: 'sales',
          changedAt: storedEditRequest.requestedAt,
          note: `طلب تعديل من السيلز ينتظر المراجعة: ${nextRevisionAlert.summary}`,
        },
      ];

      await tx
        .update(orders)
        .set({
          pendingEditRequest: storedEditRequest,
          revisionAlert: nextRevisionAlert,
          statusHistory: nextHistory,
        })
        .where(eq(orders.id, orderId));

      await tx.insert(auditLogs).values({
        id: `aud-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        orderId,
        actionType: 'order_edit_requested',
        actorId: storedEditRequest.requestedById,
        actorName: storedEditRequest.requestedByName,
        actorRole: 'sales',
        details: {
          statusAtRequest: prevStatus,
          reason: storedEditRequest.reason || null,
          proposedTotal: storedEditRequest.totalAmount,
          requiresRePreparation,
        },
        createdAt: storedEditRequest.requestedAt,
      });

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const revRows = await tx
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion));
      return mapOrderRow(updatedRow, revRows.map(mapRevisionRow));
    });
  } catch (error) {
    console.error('Database query failed in submitOrderEditRequestRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') || error.message.includes('طلبات التعديل'))
    ) {
      throw error;
    }
    throw new Error('Failed to submit order edit request.', { cause: error });
  }
}

export async function resolveOrderEditRequestRecord(
  orderId: string,
  action: 'approve' | 'reject',
  overrideData?: Omit<Order, 'id' | 'createdAt'>,
  actorUser?: User
): Promise<Order> {
  try {
    const existing = await getOrderById(orderId);
    if (!existing) {
      throw new Error('الفاتورة المطلوبة غير موجودة.');
    }

    if (action === 'reject') {
      const nowIso = new Date().toISOString();
      const nextHistory: OrderStatusHistoryEntry[] = actorUser
        ? [
            ...(existing.statusHistory ?? []),
            {
              fromStatus: existing.status,
              toStatus: existing.status,
              changedById: actorUser.id,
              changedByName: actorUser.name,
              changedByRole: actorUser.role,
              changedAt: nowIso,
              note: 'تم رفض طلب تعديل الفاتورة وإعادة الحالة لما كانت عليه',
            },
          ]
        : existing.statusHistory ?? [];

      const nextAlert: OrderRevisionAlert | null = existing.revisionAlert
        ? {
            ...existing.revisionAlert,
            status: 'لا يوجد تعديل معلق',
            hasPendingEditRequest: false,
            requiresRePreparation: false,
            reviewedById: actorUser?.id,
            reviewedByName: actorUser?.name,
            reviewedAt: nowIso,
            reviewNote: 'تم رفض طلب التعديل',
          }
        : null;

      await db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({
            pendingEditRequest: null,
            revisionAlert: nextAlert,
            statusHistory: nextHistory,
          })
          .where(eq(orders.id, orderId));

        if (actorUser) {
          await writeAuditLogTx(tx, {
            orderId,
            actionType: 'order_edit_request_rejected',
            actor: actorUser,
            details: { status: existing.status },
            createdAt: nowIso,
          });
        }
      });
      return {
        ...existing,
        pendingEditRequest: null,
        revisionAlert: nextAlert,
        statusHistory: nextHistory,
      };
    }

    const reqData = overrideData || existing.pendingEditRequest;
    if (!reqData) {
      throw new Error('لا يوجد طلب تعديل معلق على هذه الفاتورة.');
    }

    return await updateOrderRecord(
      orderId,
      {
        customerName: reqData.customerName,
        customerPhone: reqData.customerPhone,
        customerAddress: reqData.customerAddress,
        governorate: reqData.governorate ?? existing.governorate,
        customerNotes: reqData.customerNotes,
        salesRepId: reqData.salesRepId,
        salesRepName: reqData.salesRepName,
        items: reqData.items,
        subtotal: reqData.subtotal,
        discountPercentage: reqData.discountPercentage,
        discountAmount: reqData.discountAmount,
        shippingCost: reqData.shippingCost,
        totalAmount: reqData.totalAmount,
        status: existing.status,
        commission: reqData.commission,
      },
      true,
      true,
      {
        actor: actorUser || {
          id: 'system',
          name: 'النظام',
          username: 'system',
          role: 'admin',
          isSuspended: false,
          isMuted: false,
          canEditInventory: true,
          canConfirmDelivery: true,
          canManageOrderStatus: true,
        },
        note: 'تمت الموافقة على طلب التعديل وتحديث الفاتورة',
        reason: existing.pendingEditRequest?.reason,
        isEditRequestApproval: true,
      }
    );
  } catch (error) {
    console.error('Database query failed in resolveOrderEditRequestRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') ||
        error.message.includes('لا يوجد طلب') ||
        error.message.includes('لا يمكن تعديل'))
    ) {
      throw error;
    }
    throw new Error('Failed to resolve order edit request.', { cause: error });
  }
}

export async function reviewOrderRevisionRecord(
  orderId: string,
  reviewStatusInput:
    | 'تمت مراجعة التعديل واعتماده'
    | 'يحتاج إعادة تجهيز'
    | 'تمت إعادة التجهيز'
    | 'تمت مراجعة التعديل'
    | 'التعديل جاهز لاستكمال التجهيز',
  actorUser: User,
  reviewNote?: string
): Promise<Order> {
  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');
      if (existingRows.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existingRows[0];
      const prevStatus = prevOrder.status as OrderStatus;

      if (prevOrder.pendingEditRequest) {
        throw new Error(
          'يوجد طلب تعديل معلق من السيلز؛ يجب اعتماد طلب التعديل أو رفضه أولاً قبل تأكيد المراجعة.'
        );
      }

      const alert = prevOrder.revisionAlert;
      const normalizedAlertStatus = normalizeRevisionStatus(alert?.status);
      if (!alert || normalizedAlertStatus === 'لا يوجد تعديل معلق') {
        throw new Error('لا يوجد تعديل معلق للمراجعة على هذه الفاتورة.');
      }

      const nowIso = new Date().toISOString();
      const cleanNote = reviewNote?.trim() || undefined;
      let normalizedReviewStatus = normalizeRevisionStatus(reviewStatusInput);
      let nextOrderStatus: OrderStatus = prevStatus;
      let nextPrepStartedAt = prevOrder.prepStartedAt ?? null;
      let nextPrepCompletedAt = prevOrder.prepCompletedAt ?? null;

      // If revision affected warehouse items/quantities and order was already 'تم التجهيز',
      // approving the review must move it back to 'جاري التجهيز' unless explicitly marked 'تمت إعادة التجهيز'
      if (
        normalizedReviewStatus === 'تمت مراجعة التعديل واعتماده' &&
        (alert.requiresRePreparation || hasOrderPendingProcurement({ items: prevOrder.items })) &&
        prevStatus === 'تم التجهيز'
      ) {
        normalizedReviewStatus = 'يحتاج إعادة تجهيز';
        nextOrderStatus = 'جاري التجهيز';
        nextPrepStartedAt = prevOrder.prepStartedAt || nowIso;
        nextPrepCompletedAt = null;
      } else if (normalizedReviewStatus === 'يحتاج إعادة تجهيز' && prevStatus === 'تم التجهيز') {
        nextOrderStatus = 'جاري التجهيز';
        nextPrepStartedAt = prevOrder.prepStartedAt || nowIso;
        nextPrepCompletedAt = null;
      } else if (normalizedReviewStatus === 'تمت إعادة التجهيز') {
        if (hasOrderPendingProcurement({ items: prevOrder.items })) {
          throw new Error(
            'لا يمكن إعلان اكتمال إعادة التجهيز قبل استلام أو تغطية كافة الأصناف بانتظار التوفير.'
          );
        }
        nextOrderStatus = 'تم التجهيز';
        nextPrepStartedAt = prevOrder.prepStartedAt || nowIso;
        nextPrepCompletedAt = nowIso;
      }

      const nextAlert: OrderRevisionAlert = {
        ...alert,
        status: normalizedReviewStatus,
        hasPendingEditRequest: false,
        reviewedById: actorUser.id,
        reviewedByName: actorUser.name,
        reviewedAt: nowIso,
        reviewNote: cleanNote || alert.reviewNote,
      };

      if (alert.latestRevisionId) {
        await tx
          .update(orderRevisions)
          .set({
            reviewStatus: normalizedReviewStatus,
            reviewedById: actorUser.id,
            reviewedByName: actorUser.name,
            reviewedAt: nowIso,
            reviewNote: cleanNote ?? null,
          })
          .where(eq(orderRevisions.id, alert.latestRevisionId));
      }

      const nextHistory: OrderStatusHistoryEntry[] = [
        ...(prevOrder.statusHistory ?? []),
        {
          fromStatus: prevStatus,
          toStatus: nextOrderStatus,
          changedById: actorUser.id,
          changedByName: actorUser.name,
          changedByRole: actorUser.role,
          changedAt: nowIso,
          note: `${normalizedReviewStatus} (v${alert.latestVersion})${
            nextOrderStatus !== prevStatus ? ` — تحويل الحالة إلى "${nextOrderStatus}"` : ''
          }${cleanNote ? ` — ${cleanNote}` : ''}`,
        },
      ];

      await tx
        .update(orders)
        .set({
          status: nextOrderStatus,
          prepStartedAt: nextPrepStartedAt,
          prepCompletedAt: nextPrepCompletedAt,
          revisionAlert: nextAlert,
          statusHistory: nextHistory,
        })
        .where(eq(orders.id, orderId));

      await writeAuditLogTx(tx, {
        orderId,
        actionType: 'order_revision_reviewed',
        actor: actorUser,
        details: {
          revisionId: alert.latestRevisionId ?? null,
          version: alert.latestVersion,
          reviewStatus: normalizedReviewStatus,
          fromOrderStatus: prevStatus,
          toOrderStatus: nextOrderStatus,
          reviewNote: cleanNote ?? null,
        },
        createdAt: nowIso,
      });

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const revRows = await tx
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion));
      return mapOrderRow(updatedRow, revRows.map(mapRevisionRow));
    });
  } catch (error) {
    console.error('Database query failed in reviewOrderRevisionRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') ||
        error.message.includes('لا يوجد تعديل') ||
        error.message.includes('يوجد طلب تعديل') ||
        error.message.includes('بانتظار التوفير'))
    ) {
      throw error;
    }
    throw new Error('Failed to review order revision.', { cause: error });
  }
}

export async function cancelOrderRecord(
  orderId: string,
  actorUser: User,
  reason: string
): Promise<Order> {
  try {
    const cleanReason = (reason || '').trim();
    if (cleanReason.length < 3) {
      throw new Error('يجب إدخال سبب واضح لإلغاء الفاتورة (3 أحرف على الأقل).');
    }

    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');
      if (existingRows.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existingRows[0];
      const prevStatus = prevOrder.status as OrderStatus;

      if (prevStatus === 'ملغي') {
        throw new Error('الفاتورة ملغاة بالفعل.');
      }
      if (
        prevStatus === 'تم الشحن' ||
        prevStatus === 'تم التسليم' ||
        prevStatus === 'مرتجع' ||
        prevStatus === 'رفض استلام'
      ) {
        throw new Error('لا يمكن إلغاء طلب تم شحنه أو إغلاقه بالفعل.');
      }

      const isAdmin = actorUser.role === 'owner' || actorUser.role === 'admin';
      const isOps = isAdmin || Boolean(actorUser.canManageOrderStatus);
      const isDraft = prevStatus === 'بانتظار تأكيد العميل';

      if (isDraft) {
        const isOwnerOrSupervisor =
          isOps ||
          actorUser.role === 'supervisor' ||
          (Boolean(actorUser.salesRepId) && prevOrder.salesRepId === actorUser.salesRepId);
        if (!isOwnerOrSupervisor) {
          throw new Error('غير مسموح بإلغاء فاتورة تخص مندوباً آخر.');
        }
      } else {
        if (!isOps) {
          throw new Error(
            'صلاحية إلغاء طلب مؤكد قيد التشغيل مخصصة لمسؤول التجهيز والشحن أو المدير العام فقط.'
          );
        }
      }

      const nowIso = new Date().toISOString();
      const wasConfirmed = hasOrderBeenConfirmed(prevOrder);
      const notifiedOperations =
        wasConfirmed &&
        (prevStatus === 'طلب جديد' ||
          prevStatus === 'بانتظار التجهيز' ||
          prevStatus === 'جاري التجهيز' ||
          prevStatus === 'تم التجهيز' ||
          prevStatus === 'قيد التنفيذ');

      const cancellationInfo: OrderCancellationInfo = {
        cancelledById: actorUser.id,
        cancelledByName: actorUser.name,
        cancelledByRole: actorUser.role,
        cancelledAt: nowIso,
        reason: cleanReason,
        stageAtCancellation: prevStatus,
        wasConfirmed,
        notifiedOperations,
      };

      let nextHoldInfo: OrderHoldInfo | null = prevOrder.holdInfo ?? null;
      if (nextHoldInfo?.isHeld) {
        nextHoldInfo = {
          ...nextHoldInfo,
          isHeld: false,
          releasedAt: nowIso,
          releasedById: actorUser.id,
          releasedByName: actorUser.name,
        };
      }

      const nextHistory: OrderStatusHistoryEntry[] = [
        ...(prevOrder.statusHistory ?? []),
        {
          fromStatus: prevStatus,
          toStatus: 'ملغي',
          changedById: actorUser.id,
          changedByName: actorUser.name,
          changedByRole: actorUser.role,
          changedAt: nowIso,
          note: `إلغاء الفاتورة: ${cleanReason}${notifiedOperations ? ' (تم إشعار مسؤول التجهيز)' : ''}`,
        },
      ];

      // Preserve inventory policy: NEVER delete order row and NEVER auto-restore stock on cancel!
      await tx
        .update(orders)
        .set({
          status: 'ملغي',
          cancelledAt: nowIso,
          pendingEditRequest: null,
          holdInfo: nextHoldInfo,
          cancellationInfo,
          statusHistory: nextHistory,
        })
        .where(eq(orders.id, orderId));

      if (wasConfirmed && isPendingCommissionStatus(prevStatus)) {
        const matchedReps = await tx
          .select()
          .from(salesReps)
          .where(eq(salesReps.id, prevOrder.salesRepId));
        if (matchedReps.length > 0) {
          const rep = matchedReps[0];
          await tx
            .update(salesReps)
            .set({
              pendingCommission: Math.max(0, rep.pendingCommission - prevOrder.commission),
            })
            .where(eq(salesReps.id, rep.id));
        }
      }

      await writeAuditLogTx(tx, {
        orderId,
        actionType: 'order_cancelled',
        actor: actorUser,
        details: {
          stageAtCancellation: prevStatus,
          wasConfirmed,
          notifiedOperations,
          reason: cleanReason,
        },
        createdAt: nowIso,
      });

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const revRows = await tx
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion));
      return mapOrderRow(updatedRow, revRows.map(mapRevisionRow));
    });
  } catch (error) {
    console.error('Database query failed in cancelOrderRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') ||
        error.message.includes('سبب واضح') ||
        error.message.includes('ملغاة') ||
        error.message.includes('لا يمكن إلغاء') ||
        error.message.includes('غير مسموح') ||
        error.message.includes('صلاحية إلغاء'))
    ) {
      throw error;
    }
    throw new Error('Failed to cancel order.', { cause: error });
  }
}

export async function updateOrderStatusRecord(
  orderId: string,
  newStatus: OrderStatus,
  actorUser?: User,
  options?: StatusTransitionOptions
): Promise<Order> {
  try {
    const updatedOrder = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');
      if (existing.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existing[0];
      const prevStatus = prevOrder.status as OrderStatus;
      const nowIso = new Date().toISOString();

      const actor: User = actorUser || {
        id: 'system',
        name: 'النظام',
        username: 'system',
        role: 'admin',
        isSuspended: false,
        isMuted: false,
        canEditInventory: true,
        canConfirmDelivery: true,
        canManageOrderStatus: true,
      };

      if (prevStatus === newStatus) {
        const revRows = await tx
          .select()
          .from(orderRevisions)
          .where(eq(orderRevisions.orderId, orderId))
          .orderBy(asc(orderRevisions.toVersion));
        return mapOrderRow(prevOrder, revRows.map(mapRevisionRow));
      }

      if (prevStatus === 'بانتظار تأكيد العميل') {
        throw new Error(
          'الفاتورة بانتظار تأكيد العميل؛ يجب تأكيد الطلب أولاً أو إلغاؤه مع ذكر السبب.'
        );
      }

      const isAdmin = actor.role === 'owner' || actor.role === 'admin';
      if (!isAdmin && (prevStatus === 'تم التسليم' || prevStatus === 'ملغي')) {
        throw new Error('لا يمكن تغيير حالة طلب مغلق إلا من خلال المدير العام.');
      }

      // Gate 2: Block shipping while any pending edit request, unreviewed revision, or pending re-prep exists
      const normRevStatus = normalizeRevisionStatus(prevOrder.revisionAlert?.status);
      if (
        newStatus === 'تم الشحن' &&
        (prevOrder.pendingEditRequest ||
          normRevStatus === 'تعديل جديد يحتاج المراجعة' ||
          normRevStatus === 'يحتاج إعادة تجهيز')
      ) {
        throw new Error(
          'يوجد تعديل جديد أو طلب إعادة تجهيز غير مكتمل على الفاتورة. يجب اعتماده وإتمام إعادة التجهيز قبل شحن الطلب.'
        );
      }

      // Gate 1: Pending procurement items MUST be fulfilled before completing preparation or shipping
      if (
        (newStatus === 'تم التجهيز' || newStatus === 'تم الشحن') &&
        hasOrderPendingProcurement({ items: prevOrder.items })
      ) {
        throw new Error(
          'لا يمكن إتمام التجهيز أو الشحن قبل توفير الأصناف المعلّقة (استلام من المورد أو تأكيد التوفير الخارجي).'
        );
      }

      const allowedNext = ALLOWED_OPERATIONAL_TRANSITIONS[prevStatus] || [];
      if (!allowedNext.includes(newStatus)) {
        throw new Error(`الانتقال من "${prevStatus}" إلى "${newStatus}" غير مسموح به وفق تسلسل التشغيل.`);
      }

      let nextShippingInfo: OrderShippingInfo | null = prevOrder.shippingInfo ?? null;
      let nextDeliveryInfo: OrderDeliveryInfo | null = prevOrder.deliveryInfo ?? null;
      let nextReturnInfo: OrderReturnInfo | null = prevOrder.returnInfo ?? null;
      let nextHoldInfo: OrderHoldInfo | null = prevOrder.holdInfo ?? null;
      let nextRevisionAlert: OrderRevisionAlert | null = prevOrder.revisionAlert ?? null;

      // Update lifecycle timestamps safely
      let nextPrepStartedAt = prevOrder.prepStartedAt ?? null;
      let nextPrepCompletedAt = prevOrder.prepCompletedAt ?? null;
      let nextShippedAt = prevOrder.shippedAt ?? null;
      let nextDeliveredAt = prevOrder.deliveredAt ?? null;
      let nextCancelledAt = prevOrder.cancelledAt ?? null;
      let nextReturnedAt = prevOrder.returnedAt ?? null;

      if (newStatus === 'جاري التجهيز') {
        nextPrepStartedAt = prevOrder.prepStartedAt || nowIso;
        nextPrepCompletedAt = null;
      } else if (newStatus === 'بانتظار التجهيز') {
        nextPrepCompletedAt = null;
      } else if (newStatus === 'تم التجهيز') {
        nextPrepStartedAt = prevOrder.prepStartedAt || nowIso;
        nextPrepCompletedAt = nowIso;

        // If completing re-prep after an approved revision, automatically update revisionAlert -> 'تمت إعادة التجهيز'
        if (
          nextRevisionAlert &&
          (normRevStatus === 'يحتاج إعادة تجهيز' ||
            (normRevStatus === 'تعديل جديد يحتاج المراجعة' && !prevOrder.pendingEditRequest))
        ) {
          nextRevisionAlert = {
            ...nextRevisionAlert,
            status: 'تمت إعادة التجهيز',
            hasPendingEditRequest: false,
            reviewedById: actor.id,
            reviewedByName: actor.name,
            reviewedAt: nowIso,
            reviewNote: 'تمت إعادة التجهيز بنجاح بعد التعديل',
          };
          if (nextRevisionAlert.latestRevisionId) {
            await tx
              .update(orderRevisions)
              .set({
                reviewStatus: 'تمت إعادة التجهيز',
                reviewedById: actor.id,
                reviewedByName: actor.name,
                reviewedAt: nowIso,
                reviewNote: 'تمت إعادة التجهيز بنجاح بعد التعديل',
              })
              .where(eq(orderRevisions.id, nextRevisionAlert.latestRevisionId));
          }
        }
      } else if (newStatus === 'تم الشحن') {
        nextShippedAt = nowIso;
        const entry: OrderShippingEntry = {
          carrier: options?.shipping?.carrier?.trim() || undefined,
          trackingNumber: options?.shipping?.trackingNumber?.trim() || undefined,
          shippedAt: nowIso,
          shippedById: actor.id,
          shippedByName: actor.name,
          notes: options?.shipping?.notes?.trim() || options?.note?.trim() || undefined,
        };
        const prevHistory = prevOrder.shippingInfo?.history ?? [];
        nextShippingInfo = {
          ...entry,
          history: [...prevHistory, entry],
        };
      } else if (newStatus === 'تم التسليم') {
        nextDeliveredAt = nowIso;
        nextDeliveryInfo = {
          deliveredAt: nowIso,
          confirmedById: actor.id,
          confirmedByName: actor.name,
          notes: options?.delivery?.notes?.trim() || options?.note?.trim() || undefined,
        };
        if (nextHoldInfo?.isHeld) {
          nextHoldInfo = {
            ...nextHoldInfo,
            isHeld: false,
            releasedAt: nowIso,
            releasedById: actor.id,
            releasedByName: actor.name,
          };
        }
      } else if (newStatus === 'ملغي') {
        nextCancelledAt = nowIso;
      }

      if (newStatus === 'مرتجع' || newStatus === 'رفض استلام') {
        const ret = options?.returnDetails;
        if (!ret || !VALID_RETURN_REASONS.includes(ret.reason)) {
          throw new Error('يجب تحديد سبب المرتجع أو رفض الاستلام بشكل واضح.');
        }
        const details = (ret.details || '').trim();
        if (details.length < 3) {
          throw new Error('يجب كتابة ملاحظة تفصيلية واضحة لتسجيل المرتجع أو رفض الاستلام.');
        }

        const customerRefusedDelivery = Boolean(
          ret.customerRefusedDelivery || ret.reason === 'رفض الاستلام'
        );
        const customerNoAnswer = Boolean(
          ret.customerNoAnswer || ret.reason === 'العميل لم يرد'
        );
        const invalidAddress = Boolean(
          ret.invalidAddress || ret.reason === 'العنوان غير صحيح'
        );
        const customerRequestedCancel = Boolean(
          ret.customerRequestedCancel || ret.reason === 'العميل طلب الإلغاء'
        );
        const otherReason = Boolean(ret.otherReason || ret.reason === 'سبب آخر');

        nextReturnedAt = nowIso;
        nextReturnInfo = {
          outcome: newStatus,
          reason: ret.reason,
          details,
          customerRefusedDelivery,
          customerNoAnswer,
          invalidAddress,
          customerRequestedCancel,
          otherReason,
          recordedAt: nowIso,
          recordedById: actor.id,
          recordedByName: actor.name,
        };

        if (nextHoldInfo?.isHeld) {
          nextHoldInfo = {
            ...nextHoldInfo,
            isHeld: false,
            releasedAt: nowIso,
            releasedById: actor.id,
            releasedByName: actor.name,
          };
        }

        const allCustomers = await tx.select().from(customers);
        const matchingCustomers = allCustomers.filter(
          (c) =>
            c.name.trim() === prevOrder.customerName.trim() ||
            (Boolean(prevOrder.customerPhone) && c.phone === prevOrder.customerPhone)
        );

        const customerHistoryEntry: CustomerReturnHistoryEntry = {
          orderId: prevOrder.id,
          outcome: newStatus,
          reason: ret.reason,
          details,
          customerRefusedDelivery,
          customerNoAnswer,
          invalidAddress,
          customerRequestedCancel,
          otherReason,
          recordedAt: nowIso,
          recordedByName: actor.name,
        };

        for (const cust of matchingCustomers) {
          const prevCustHistory = cust.returnHistory ?? [];
          await tx
            .update(customers)
            .set({
              returnHistory: [customerHistoryEntry, ...prevCustHistory],
            })
            .where(eq(customers.id, cust.id));
        }
      }

      const isRePrepare =
        (isCancelledOrReturnedStatus(prevStatus) || prevStatus === 'تم الشحن') &&
        (newStatus === 'بانتظار التجهيز' || newStatus === 'جاري التجهيز');

      if (isRePrepare && nextHoldInfo?.isHeld) {
        nextHoldInfo = {
          ...nextHoldInfo,
          isHeld: false,
          releasedAt: nowIso,
          releasedById: actor.id,
          releasedByName: actor.name,
        };
      }

      const shouldClearEditRequest =
        newStatus === 'تم الشحن' ||
        newStatus === 'تم التسليم' ||
        newStatus === 'مرتجع' ||
        newStatus === 'رفض استلام' ||
        newStatus === 'ملغي';

      const historyNoteParts: string[] = [];
      if (options?.note?.trim()) historyNoteParts.push(options.note.trim());
      if (newStatus === 'تم الشحن') {
        const carrierPart = nextShippingInfo?.carrier ? `شركة الشحن: ${nextShippingInfo.carrier}` : '';
        const trackPart = nextShippingInfo?.trackingNumber
          ? `بوليصة: ${nextShippingInfo.trackingNumber}`
          : '';
        const shipSummary = [carrierPart, trackPart].filter(Boolean).join(' · ');
        if (shipSummary) historyNoteParts.push(shipSummary);
      }
      if ((newStatus === 'مرتجع' || newStatus === 'رفض استلام') && nextReturnInfo) {
        historyNoteParts.push(`${nextReturnInfo.reason} — ${nextReturnInfo.details}`);
      }
      if (isRePrepare && historyNoteParts.length === 0) {
        historyNoteParts.push('إعادة الطلب للتجهيز');
      }

      const nextStatusHistory: OrderStatusHistoryEntry[] = [
        ...(prevOrder.statusHistory ?? []),
        {
          fromStatus: prevStatus,
          toStatus: newStatus,
          changedById: actor.id,
          changedByName: actor.name,
          changedByRole: actor.role,
          changedAt: nowIso,
          ...(historyNoteParts.length > 0 ? { note: historyNoteParts.join(' | ') } : {}),
        },
      ];

      const nextOperationalNotes =
        options?.operationalNotes !== undefined
          ? options.operationalNotes.trim() || null
          : prevOrder.operationalNotes;

      await tx
        .update(orders)
        .set({
          status: newStatus,
          ...(shouldClearEditRequest ? { pendingEditRequest: null } : {}),
          operationalNotes: nextOperationalNotes,
          prepStartedAt: nextPrepStartedAt,
          prepCompletedAt: nextPrepCompletedAt,
          shippedAt: nextShippedAt,
          deliveredAt: nextDeliveredAt,
          cancelledAt: nextCancelledAt,
          returnedAt: nextReturnedAt,
          revisionAlert: nextRevisionAlert,
          statusHistory: nextStatusHistory,
          shippingInfo: nextShippingInfo,
          deliveryInfo: nextDeliveryInfo,
          returnInfo: nextReturnInfo,
          holdInfo: nextHoldInfo,
        })
        .where(eq(orders.id, orderId));

      // Commission reconciliation (strictly preserves commission rules & independent of item sourcing source)
      const matchedReps = await tx
        .select()
        .from(salesReps)
        .where(eq(salesReps.id, prevOrder.salesRepId));

      if (matchedReps.length > 0) {
        const rep = matchedReps[0];
        let totalComm = rep.totalCommission;
        let pendingComm = rep.pendingCommission;

        const prevWasPending = isPendingCommissionStatus(prevStatus);
        const nextIsPending = isPendingCommissionStatus(newStatus);
        const prevWasCancelled = isCancelledOrReturnedStatus(prevStatus);
        const nextIsCancelled = isCancelledOrReturnedStatus(newStatus);

        if (prevWasPending && newStatus === 'تم التسليم') {
          pendingComm = Math.max(0, pendingComm - prevOrder.commission);
          totalComm += prevOrder.commission;
        } else if (prevStatus === 'تم التسليم' && nextIsCancelled) {
          totalComm = Math.max(0, totalComm - prevOrder.commission);
        } else if (prevWasPending && nextIsCancelled) {
          pendingComm = Math.max(0, pendingComm - prevOrder.commission);
        } else if (prevStatus === 'تم التسليم' && nextIsPending) {
          totalComm = Math.max(0, totalComm - prevOrder.commission);
          pendingComm += prevOrder.commission;
        } else if (prevWasCancelled && nextIsPending) {
          pendingComm += prevOrder.commission;
        }

        await tx
          .update(salesReps)
          .set({ totalCommission: totalComm, pendingCommission: pendingComm })
          .where(eq(salesReps.id, rep.id));
      }

      await writeAuditLogTx(tx, {
        orderId,
        actionType: 'order_status_changed',
        actor,
        details: {
          fromStatus: prevStatus,
          toStatus: newStatus,
          note: historyNoteParts.join(' | ') || null,
        },
        createdAt: nowIso,
      });

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const revRows = await tx
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion));
      return mapOrderRow(updatedRow, revRows.map(mapRevisionRow));
    });

    return updatedOrder;
  } catch (error) {
    console.error('Database query failed in updateOrderStatusRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') ||
        error.message.includes('غير مسموح') ||
        error.message.includes('مغلق') ||
        error.message.includes('يجب') ||
        error.message.includes('بانتظار تأكيد العميل') ||
        error.message.includes('بانتظار التوفير') ||
        error.message.includes('توفير الأصناف') ||
        error.message.includes('لا يمكن إتمام التجهيز') ||
        error.message.includes('تعديل جديد'))
    ) {
      throw error;
    }
    throw new Error('Failed to update order status.', { cause: error });
  }
}

export async function holdOrderRecord(
  orderId: string,
  actorUser: User,
  payload: { isHeld: boolean; reason?: string; notes?: string }
): Promise<Order> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (existing.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existing[0];
      const prevStatus = prevOrder.status as OrderStatus;
      const nowIso = new Date().toISOString();

      if (payload.isHeld) {
        if (prevStatus === 'تم التسليم' || isCancelledOrReturnedStatus(prevStatus)) {
          throw new Error('لا يمكن تعليق طلب في حالة نهائية مغلقة.');
        }
        const cleanReason = (payload.reason || '').trim();
        if (cleanReason.length < 2) {
          throw new Error('يجب إدخال سبب تعليق الطلب.');
        }

        const nextHold: OrderHoldInfo = {
          isHeld: true,
          reason: cleanReason,
          notes: payload.notes?.trim() || undefined,
          heldAtStage: prevStatus,
          heldAt: nowIso,
          heldById: actorUser.id,
          heldByName: actorUser.name,
        };

        const nextHistory: OrderStatusHistoryEntry[] = [
          ...(prevOrder.statusHistory ?? []),
          {
            fromStatus: prevStatus,
            toStatus: prevStatus,
            changedById: actorUser.id,
            changedByName: actorUser.name,
            changedByRole: actorUser.role,
            changedAt: nowIso,
            note: `تعليق الطلب: ${cleanReason}${nextHold.notes ? ` — ${nextHold.notes}` : ''}`,
          },
        ];

        await tx
          .update(orders)
          .set({
            holdInfo: nextHold,
            statusHistory: nextHistory,
          })
          .where(eq(orders.id, orderId));
      } else {
        const nextHold: OrderHoldInfo | null = prevOrder.holdInfo
          ? {
              ...prevOrder.holdInfo,
              isHeld: false,
              releasedAt: nowIso,
              releasedById: actorUser.id,
              releasedByName: actorUser.name,
            }
          : null;

        const nextHistory: OrderStatusHistoryEntry[] = [
          ...(prevOrder.statusHistory ?? []),
          {
            fromStatus: prevStatus,
            toStatus: prevStatus,
            changedById: actorUser.id,
            changedByName: actorUser.name,
            changedByRole: actorUser.role,
            changedAt: nowIso,
            note: payload.notes?.trim()
              ? `فك تعليق الطلب: ${payload.notes.trim()}`
              : 'تم فك تعليق الطلب واستئناف التشغيل',
          },
        ];

        await tx
          .update(orders)
          .set({
            holdInfo: nextHold,
            statusHistory: nextHistory,
          })
          .where(eq(orders.id, orderId));
      }

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      return mapOrderRow(updatedRow);
    });
  } catch (error) {
    console.error('Database query failed in holdOrderRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') ||
        error.message.includes('لا يمكن تعليق') ||
        error.message.includes('يجب إدخال'))
    ) {
      throw error;
    }
    throw new Error('Failed to update order hold status.', { cause: error });
  }
}

export async function updateOrderOperationalNotesRecord(
  orderId: string,
  operationalNotes: string
): Promise<Order> {
  try {
    const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (rows.length === 0) {
      throw new Error('الفاتورة المطلوبة غير موجودة.');
    }

    const cleanNotes = operationalNotes.trim() || null;
    await db
      .update(orders)
      .set({ operationalNotes: cleanNotes })
      .where(eq(orders.id, orderId));

    const [updated] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    return mapOrderRow(updated);
  } catch (error) {
    console.error('Database query failed in updateOrderOperationalNotesRecord:', error);
    if (error instanceof Error && error.message.includes('غير موجودة')) {
      throw error;
    }
    throw new Error('Failed to update operational notes.', { cause: error });
  }
}

export async function deleteOrderRecord(orderId: string) {
  try {
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (existing.length === 0) return;
      const orderToDelete = existing[0];
      const wasConfirmed = hasOrderBeenConfirmed(orderToDelete);

      if (wasConfirmed) {
        const allProducts = await tx.select().from(products);
        for (const item of orderToDelete.items) {
          const prod = findMatchingProduct(
            allProducts,
            item.productName,
            item.grade,
            item.productId,
            item.productCode
          );
          const { ware } = getEffectiveLegacyWarehouseQty(item, prod);
          if (prod && ware > 0) {
            await tx
              .update(products)
              .set({ stock: roundStockNumber(prod.stock + ware) })
              .where(eq(products.id, prod.id));
            prod.stock = roundStockNumber(prod.stock + ware);
          }
        }

        const matchedReps = await tx
          .select()
          .from(salesReps)
          .where(eq(salesReps.id, orderToDelete.salesRepId));
        if (matchedReps.length > 0) {
          const rep = matchedReps[0];
          let totalComm = rep.totalCommission;
          let pendingComm = rep.pendingCommission;

          if (orderToDelete.status === 'تم التسليم') {
            totalComm = Math.max(0, totalComm - orderToDelete.commission);
          } else if (isPendingCommissionStatus(orderToDelete.status as OrderStatus)) {
            pendingComm = Math.max(0, pendingComm - orderToDelete.commission);
          }

          await tx
            .update(salesReps)
            .set({
              totalCommission: totalComm,
              pendingCommission: pendingComm,
              ordersCount: Math.max(0, rep.ordersCount - 1),
            })
            .where(eq(salesReps.id, rep.id));
        }
      }

      await tx.delete(orderRevisions).where(eq(orderRevisions.orderId, orderId));
      await tx.delete(orders).where(eq(orders.id, orderId));

      await recomputeCustomerTotalsTx(tx, [
        { name: orderToDelete.customerName, phone: orderToDelete.customerPhone },
      ]);
    });
  } catch (error) {
    console.error('Database query failed in deleteOrderRecord:', error);
    throw new Error('Failed to delete order.', { cause: error });
  }
}

export async function createCustomerRecord(
  customerData: {
    name: string;
    phone: string;
    address?: string;
    assignedSalesRepId?: string | null;
    assignedSalesRepName?: string | null;
  },
  actor?: User
): Promise<Customer> {
  try {
    const cleanName = (customerData.name || '').trim();
    if (!cleanName) {
      throw new Error('يرجى إدخال اسم العميل.');
    }
    const cleanPhone = (customerData.phone || '').trim();
    const cleanAddress = customerData.address?.trim() || undefined;

    let assignedSalesRepId = customerData.assignedSalesRepId?.trim() || null;
    let assignedSalesRepName = customerData.assignedSalesRepName?.trim() || null;

    if (actor?.role === 'sales' && actor.salesRepId) {
      assignedSalesRepId = actor.salesRepId;
      assignedSalesRepName = actor.name;
    } else if (assignedSalesRepId && !assignedSalesRepName) {
      const repRows = await db
        .select()
        .from(salesReps)
        .where(eq(salesReps.id, assignedSalesRepId))
        .limit(1);
      if (repRows.length > 0) {
        assignedSalesRepName = repRows[0].name;
      }
    }

    const newCust: Customer = {
      id: `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: cleanName,
      phone: cleanPhone,
      address: cleanAddress,
      totalSpent: 0,
      classification: 'عادي',
      lastOrderDate: '',
      assignedSalesRepId,
      assignedSalesRepName,
    };

    await db.insert(customers).values({
      id: newCust.id,
      name: newCust.name,
      phone: newCust.phone,
      address: newCust.address ?? null,
      totalSpent: 0,
      classification: 'عادي',
      lastOrderDate: '',
      assignedSalesRepId,
      assignedSalesRepName,
    });

    return newCust;
  } catch (error) {
    console.error('Database query failed in createCustomerRecord:', error);
    if (error instanceof Error && error.message.includes('اسم العميل')) {
      throw error;
    }
    throw new Error('Failed to create customer.', { cause: error });
  }
}

export async function updateCustomerRecord(
  customerId: string,
  patch: {
    name: string;
    phone?: string;
    address?: string | null;
    assignedSalesRepId?: string | null;
  },
  actor?: User
): Promise<{ customer: Customer; linkedOrdersSynced: number }> {
  try {
    const nextName = (patch.name || '').trim();
    if (!nextName) {
      throw new Error('يرجى إدخال اسم العميل.');
    }
    const nextPhone = (patch.phone ?? '').trim();
    const nextAddress =
      patch.address !== undefined ? (patch.address || '').trim() || null : undefined;

    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (existingRows.length === 0) {
        throw new Error('العميل المطلوب غير موجود.');
      }
      const prev = existingRows[0];

      const allCusts = await tx.select().from(customers);
      const duplicate = allCusts.find(
        (c) =>
          c.id !== customerId &&
          (c.name.trim().toLowerCase() === nextName.toLowerCase() ||
            (Boolean(nextPhone) && c.phone.trim() === nextPhone))
      );
      if (duplicate) {
        throw new Error(
          `يوجد عميل آخر مسجل بنفس الاسم أو رقم الهاتف (${duplicate.name}).`
        );
      }

      const prevNameNorm = prev.name.trim();
      const prevPhoneNorm = (prev.phone || '').trim();
      const allOrders = await tx.select().from(orders);
      const linkedOrders = allOrders.filter(
        (o) =>
          o.customerName.trim() === prevNameNorm ||
          (Boolean(prevPhoneNorm) && (o.customerPhone || '').trim() === prevPhoneNorm)
      );

      let nextAssignedRepId = prev.assignedSalesRepId ?? null;
      let nextAssignedRepName = prev.assignedSalesRepName ?? null;
      if (patch.assignedSalesRepId !== undefined) {
        const requestedRepId = (patch.assignedSalesRepId || '').trim() || null;
        if (!requestedRepId) {
          nextAssignedRepId = null;
          nextAssignedRepName = null;
        } else {
          const repRows = await tx
            .select()
            .from(salesReps)
            .where(eq(salesReps.id, requestedRepId))
            .limit(1);
          if (repRows.length === 0) {
            throw new Error('مندوب المبيعات المحدد غير موجود.');
          }
          nextAssignedRepId = repRows[0].id;
          nextAssignedRepName = repRows[0].name;
        }
      }

      const finalAddress = nextAddress !== undefined ? nextAddress : prev.address;
      await tx
        .update(customers)
        .set({
          name: nextName,
          phone: nextPhone,
          address: finalAddress,
          assignedSalesRepId: nextAssignedRepId,
          assignedSalesRepName: nextAssignedRepName,
        })
        .where(eq(customers.id, customerId));

      let linkedOrdersSynced = 0;
      if (
        linkedOrders.length > 0 &&
        (nextName !== prevNameNorm || nextPhone !== prevPhoneNorm)
      ) {
        for (const ord of linkedOrders) {
          await tx
            .update(orders)
            .set({
              customerName: nextName,
              customerPhone: nextPhone || ord.customerPhone,
            })
            .where(eq(orders.id, ord.id));
          linkedOrdersSynced++;
        }
      }

      await recomputeCustomerTotalsTx(tx, [{ name: nextName, phone: nextPhone }]);

      const [updatedRow] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

      if (actor) {
        await writeAuditLogTx(tx, {
          actionType: 'customer_updated',
          actor,
          details: {
            customerId,
            previous: {
              name: prev.name,
              phone: prev.phone,
              address: prev.address,
              assignedSalesRepId: prev.assignedSalesRepId,
            },
            updated: {
              name: nextName,
              phone: nextPhone,
              address: finalAddress,
              assignedSalesRepId: nextAssignedRepId,
            },
            linkedOrdersCount: linkedOrders.length,
            linkedOrdersSynced,
          },
          createdAt: new Date().toISOString(),
        });
      }

      return {
        customer: mapCustomerRow(
          updatedRow || {
            ...prev,
            name: nextName,
            phone: nextPhone,
            address: finalAddress,
            assignedSalesRepId: nextAssignedRepId,
            assignedSalesRepName: nextAssignedRepName,
          }
        ),
        linkedOrdersSynced,
      };
    });
  } catch (error) {
    console.error('Database query failed in updateCustomerRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجود') ||
        error.message.includes('اسم العميل') ||
        error.message.includes('عميل آخر'))
    ) {
      throw error;
    }
    throw new Error('Failed to update customer.', { cause: error });
  }
}

export async function deleteCustomerRecord(customerId: string, actor?: User) {
  try {
    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (existingRows.length === 0) {
        throw new Error('العميل المطلوب غير موجود.');
      }
      const target = existingRows[0];
      const targetNameNorm = target.name.trim();
      const targetPhoneNorm = (target.phone || '').trim();

      const allOrders = await tx.select().from(orders);
      const linkedOrders = allOrders.filter(
        (o) =>
          o.customerName.trim() === targetNameNorm ||
          (Boolean(targetPhoneNorm) && (o.customerPhone || '').trim() === targetPhoneNorm)
      );

      if (linkedOrders.length > 0) {
        throw new Error(
          `لا يمكن حذف العميل "${target.name}" لوجود ${linkedOrders.length} فاتورة تاريخية مرتبطة به لحماية السجلات.`
        );
      }

      await tx.delete(customers).where(eq(customers.id, customerId));

      if (actor) {
        await writeAuditLogTx(tx, {
          actionType: 'customer_deleted',
          actor,
          details: {
            customerId: target.id,
            name: target.name,
            phone: target.phone,
          },
          createdAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error('Database query failed in deleteCustomerRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجود') || error.message.includes('لا يمكن حذف العميل'))
    ) {
      throw error;
    }
    throw new Error('Failed to delete customer.', { cause: error });
  }
}

const SEED_DEMO_PRODUCT_IDS = new Set(['1', '2', '3', '4']);
const SEED_DEMO_PRODUCT_NAMES = new Set([
  'زيت لافندر فرنسي',
  'زيت عود ملكي',
  'زيت ياسمين طبيعي',
]);

export function isDemoProductCandidate(p: {
  id: string;
  code?: string | null;
  name: string;
}): boolean {
  const cleanName = (p.name || '').trim();
  const cleanCode = (p.code || '').trim();
  if (SEED_DEMO_PRODUCT_IDS.has(p.id) && SEED_DEMO_PRODUCT_NAMES.has(cleanName)) {
    return true;
  }
  if (
    /\b(test|demo|dummy)\b/i.test(cleanName) ||
    /(تيست|تجريبي|تجربة|اختباري|وهمي)/.test(cleanName) ||
    /\b(test|demo|dummy)\b/i.test(cleanCode)
  ) {
    return true;
  }
  return false;
}

export async function getProductUsageInfo(
  productId: string,
  txOrDb: DbTx | typeof db = db
): Promise<ProductUsageSummary | null> {
  const prodRows = await txOrDb
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (prodRows.length === 0) return null;
  const prod = prodRows[0];

  const [allOrders, moveRows] = await Promise.all([
    txOrDb.select({ id: orders.id, items: orders.items }).from(orders),
    txOrDb
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.productId, productId)),
  ]);

  const cleanProdCode = (prod.code || '').trim().toLowerCase();
  const cleanProdName = prod.name.trim().toLowerCase();
  const cleanProdGrade = (prod.grade || '').trim();
  const matchedOrderIds: string[] = [];

  for (const ord of allOrders) {
    const items = Array.isArray(ord.items) ? ord.items : [];
    const matches = items.some((item) => {
      if (item.productId) return item.productId === prod.id;
      if (cleanProdCode && item.productCode && item.productCode.trim().toLowerCase() === cleanProdCode) {
        return true;
      }
      const itemName = (item.productName || '').trim().toLowerCase();
      if (!itemName || itemName !== cleanProdName) return false;
      const itemGrade = (item.grade || '').trim();
      return !cleanProdGrade || !itemGrade || itemGrade === cleanProdGrade;
    });
    if (matches) {
      matchedOrderIds.push(ord.id);
    }
  }

  return {
    productId: prod.id,
    code: prod.code,
    name: prod.name,
    categoryName: prod.categoryName,
    stock: prod.stock,
    isActive: prod.isActive,
    ordersCount: matchedOrderIds.length,
    sampleOrderIds: matchedOrderIds.slice(0, 5),
    stockMovementsCount: moveRows.length,
    canDelete: matchedOrderIds.length === 0 && moveRows.length === 0,
    isDemoCandidate: isDemoProductCandidate(prod),
  };
}

export async function setProductArchiveStatusRecord(
  productId: string,
  isActive: boolean,
  actor: User,
  reason?: string
): Promise<Product> {
  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (existingRows.length === 0) {
        throw new Error('المنتج المطلوب غير موجود.');
      }
      const prev = existingRows[0];
      const nowIso = new Date().toISOString();

      await tx
        .update(products)
        .set({
          isActive,
          updatedAt: nowIso,
        })
        .where(eq(products.id, productId));

      await writeAuditLogTx(tx, {
        actionType: isActive ? 'product_unarchived' : 'product_archived',
        actor,
        details: {
          productId: prev.id,
          code: prev.code,
          name: prev.name,
          previousIsActive: prev.isActive,
          newIsActive: isActive,
          reason: reason?.trim() || null,
        },
        createdAt: nowIso,
      });

      return mapProductRow({ ...prev, isActive, updatedAt: nowIso });
    });
  } catch (error) {
    console.error('Database query failed in setProductArchiveStatusRecord:', error);
    if (error instanceof Error && error.message.includes('غير موجود')) {
      throw error;
    }
    throw new Error('Failed to update product archive status.', { cause: error });
  }
}

export async function deleteProductRecord(
  productId: string,
  actor: User
): Promise<{ ok: true; deletedId: string }> {
  try {
    return await db.transaction(async (tx) => {
      const usage = await getProductUsageInfo(productId, tx);
      if (!usage) {
        throw new Error('المنتج المطلوب غير موجود.');
      }
      if (!usage.canDelete) {
        throw new Error(
          `لا يمكن حذف الصنف "${usage.name}" نهائياً لارتباطه بـ ${usage.ordersCount} فاتورة و ${usage.stockMovementsCount} حركة مخزون. يمكنك أرشفته بدلاً من الحذف للحفاظ على سلامة السجلات التاريخية.`
        );
      }

      await tx.delete(products).where(eq(products.id, productId));

      await writeAuditLogTx(tx, {
        actionType: 'product_deleted',
        actor,
        details: {
          productId: usage.productId,
          code: usage.code,
          name: usage.name,
          categoryName: usage.categoryName,
          stock: usage.stock,
        },
        createdAt: new Date().toISOString(),
      });

      return { ok: true, deletedId: productId };
    });
  } catch (error) {
    console.error('Database query failed in deleteProductRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجود') || error.message.includes('لا يمكن حذف الصنف'))
    ) {
      throw error;
    }
    throw new Error('Failed to delete product.', { cause: error });
  }
}

export async function createProductRecord(
  productData: Partial<Omit<Product, 'id'>> & Pick<Product, 'name' | 'pricePerMg' | 'stock'>,
  actor?: User
): Promise<Product> {
  try {
    const cleanName = productData.name.trim();
    if (!cleanName) {
      throw new Error('يرجى إدخال اسم المنتج.');
    }

    return await db.transaction(async (tx) => {
      const existingRows = await tx.select().from(products);
      const categories = await getAllCategories();
      const commConfig = await getCommissionConfig();

      const chosenCat =
        categories.find((c) => c.id === productData.categoryId) ||
        categories.find((c) => c.name === productData.categoryName) ||
        categories[0] ||
        DEFAULT_CATEGORIES[0];

      let cleanCode = (productData.code || '').trim().toUpperCase();
      if (!cleanCode) {
        const prefix =
          chosenCat.slug === 'oils'
            ? 'OIL'
            : chosenCat.slug === 'packaging'
              ? 'PKG'
              : chosenCat.slug === 'alcohol'
                ? 'ALC'
                : chosenCat.slug === 'chemicals'
                  ? 'CHM'
                  : 'SUP';
        cleanCode = `${prefix}-${Date.now().toString().slice(-5)}`;
      }

      if (
        existingRows.some(
          (p) => (p.code || '').trim().toLowerCase() === cleanCode.toLowerCase()
        )
      ) {
        throw new Error(`كود المنتج (${cleanCode}) مستخدم بالفعل لصنف آخر، يرجى استخدام كود فريد.`);
      }

      const defaultEligible = resolveCategoryDefaultCommissionEligible(
        chosenCat.id,
        chosenCat.name,
        commConfig,
        categories
      );

      const allowCommissionInput = !actor || actor.role === 'owner';
      if (!allowCommissionInput) {
        const triedOverrideEligible =
          typeof productData.isCommissionEligible === 'boolean' &&
          productData.isCommissionEligible !== defaultEligible;
        const triedOverrideMode =
          Boolean(productData.commissionMode) &&
          productData.commissionMode !== (defaultEligible ? 'inherit_rep' : 'none');
        const triedCustomValues =
          (productData.customCommissionRate !== null &&
            productData.customCommissionRate !== undefined) ||
          (productData.customCommissionFixed !== null &&
            productData.customCommissionFixed !== undefined);
        if (triedOverrideEligible || triedOverrideMode || triedCustomValues) {
          throw new Error('غير مسموح بتحديد أو تعديل قواعد عمولة المنتج إلا بواسطة المالك الرئيسي (Owner).');
        }
      }

      const isCommissionEligible = allowCommissionInput
        ? typeof productData.isCommissionEligible === 'boolean'
          ? productData.isCommissionEligible
          : defaultEligible
        : defaultEligible;

      const commissionMode: CommissionMode = allowCommissionInput
        ? productData.commissionMode ||
          (productData.isCommissionEligible === false ? 'none' : 'inherit_rep')
        : 'inherit_rep';

      const nowIso = new Date().toISOString();
      const baseName = productData.baseProductName?.trim() || cleanName;
      const rowToInsert: typeof products.$inferInsert = {
        id: `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        code: cleanCode,
        name: cleanName,
        categoryId: chosenCat.id,
        categoryName: chosenCat.name,
        description: productData.description?.trim() || null,
        unit: productData.unit?.trim() || chosenCat.defaultUnit || 'mg',
        grade: productData.grade ?? (chosenCat.slug === 'oils' ? 'عالي' : ''),
        gradeId: productData.gradeId ?? null,
        baseProductName: baseName,
        baseProductKey: productData.baseProductKey?.trim() || normalizeArabicForSearch(baseName),
        pricePerMg: Number(productData.pricePerMg) || 0,
        costPrice:
          typeof productData.costPrice === 'number' && Number.isFinite(productData.costPrice)
            ? productData.costPrice
            : null,
        costUpdatedAt:
          typeof productData.costPrice === 'number' && Number.isFinite(productData.costPrice)
            ? nowIso
            : null,
        stock: Math.max(0, roundStockNumber(Number(productData.stock) || 0)),
        isActive: productData.isActive !== false,
        isCommissionEligible,
        commissionMode:
          allowCommissionInput && productData.isCommissionEligible === false && !productData.commissionMode
            ? 'none'
            : commissionMode,
        customCommissionRate: allowCommissionInput ? productData.customCommissionRate ?? null : null,
        customCommissionFixed: allowCommissionInput ? productData.customCommissionFixed ?? null : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await tx.insert(products).values(rowToInsert);
      if (actor) {
        await writeAuditLogTx(tx, {
          actionType: 'product_created',
          actor,
          details: {
            productId: rowToInsert.id,
            code: cleanCode,
            name: cleanName,
            categoryId: chosenCat.id,
            unit: rowToInsert.unit,
            isCommissionEligible,
          },
          createdAt: nowIso,
        });
      }
      return mapProductRow(rowToInsert as typeof products.$inferSelect);
    });
  } catch (error) {
    console.error('Database query failed in createProductRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('كود المنتج') ||
        error.message.includes('اسم المنتج') ||
        error.message.includes('غير مسموح'))
    ) {
      throw error;
    }
    throw new Error('Failed to create product.', { cause: error });
  }
}

export async function updateProductRecord(updatedProduct: Partial<Product> & { id: string }, actor?: User) {
  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(products)
        .where(eq(products.id, updatedProduct.id))
        .limit(1);
      if (existingRows.length === 0) {
        throw new Error('المنتج المطلوب غير موجود.');
      }
      const prev = existingRows[0];

      const cleanCode = (updatedProduct.code ?? prev.code ?? '').trim().toUpperCase();
      if (cleanCode) {
        const allProds = await tx.select().from(products);
        if (
          allProds.some(
            (p) =>
              p.id !== updatedProduct.id &&
              (p.code || '').trim().toLowerCase() === cleanCode.toLowerCase()
          )
        ) {
          throw new Error(`كود المنتج (${cleanCode}) مستخدم بالفعل لصنف آخر.`);
        }
      }

      const categories = await getAllCategories();
      const chosenCat =
        categories.find((c) => c.id === updatedProduct.categoryId) ||
        categories.find((c) => c.name === updatedProduct.categoryName) ||
        categories.find((c) => c.id === prev.categoryId);

      const isOwner = !actor || actor.role === 'owner';
      if (!isOwner) {
        const triedEligibleChange =
          typeof updatedProduct.isCommissionEligible === 'boolean' &&
          updatedProduct.isCommissionEligible !== prev.isCommissionEligible;
        const triedModeChange =
          Boolean(updatedProduct.commissionMode) &&
          updatedProduct.commissionMode !== prev.commissionMode;
        const triedRateChange =
          updatedProduct.customCommissionRate !== undefined &&
          updatedProduct.customCommissionRate !== prev.customCommissionRate;
        const triedFixedChange =
          updatedProduct.customCommissionFixed !== undefined &&
          updatedProduct.customCommissionFixed !== prev.customCommissionFixed;
        if (triedEligibleChange || triedModeChange || triedRateChange || triedFixedChange) {
          throw new Error('غير مسموح بتعديل إعدادات عمولة المنتج إلا بواسطة المالك الرئيسي (Owner).');
        }
      }

      const nextEligible = isOwner
        ? typeof updatedProduct.isCommissionEligible === 'boolean'
          ? updatedProduct.isCommissionEligible
          : prev.isCommissionEligible
        : prev.isCommissionEligible;

      const nextMode = isOwner
        ? updatedProduct.commissionMode || prev.commissionMode || 'inherit_rep'
        : prev.commissionMode;

      const nextCustomRate = isOwner
        ? updatedProduct.customCommissionRate !== undefined
          ? updatedProduct.customCommissionRate
          : prev.customCommissionRate
        : prev.customCommissionRate;

      const nextCustomFixed = isOwner
        ? updatedProduct.customCommissionFixed !== undefined
          ? updatedProduct.customCommissionFixed
          : prev.customCommissionFixed
        : prev.customCommissionFixed;

      const nowIso = new Date().toISOString();
      const nextName = updatedProduct.name?.trim() || prev.name;
      const nextBaseName = updatedProduct.baseProductName?.trim() || prev.baseProductName || nextName;
      await tx
        .update(products)
        .set({
          code: cleanCode || prev.code,
          name: nextName,
          categoryId: chosenCat?.id || prev.categoryId || 'cat-oils',
          categoryName: chosenCat?.name || prev.categoryName || 'الزيوت العطرية',
          description:
            updatedProduct.description !== undefined
              ? updatedProduct.description?.trim() || null
              : prev.description,
          unit: updatedProduct.unit?.trim() || prev.unit || 'mg',
          grade: updatedProduct.grade !== undefined ? updatedProduct.grade : prev.grade,
          gradeId: updatedProduct.gradeId !== undefined ? updatedProduct.gradeId : prev.gradeId,
          baseProductName: nextBaseName,
          baseProductKey:
            updatedProduct.baseProductKey?.trim() || normalizeArabicForSearch(nextBaseName),
          pricePerMg:
            typeof updatedProduct.pricePerMg === 'number'
              ? updatedProduct.pricePerMg
              : prev.pricePerMg,
          costPrice:
            updatedProduct.costPrice !== undefined ? updatedProduct.costPrice : prev.costPrice,
          costUpdatedAt:
            updatedProduct.costPrice !== undefined && updatedProduct.costPrice !== prev.costPrice
              ? nowIso
              : prev.costUpdatedAt,
          stock:
            typeof updatedProduct.stock === 'number'
              ? Math.max(0, roundStockNumber(updatedProduct.stock))
              : prev.stock,
          isActive:
            typeof updatedProduct.isActive === 'boolean' ? updatedProduct.isActive : prev.isActive,
          isCommissionEligible: nextEligible,
          commissionMode: nextEligible ? nextMode : 'none',
          customCommissionRate: nextCustomRate,
          customCommissionFixed: nextCustomFixed,
          updatedAt: nowIso,
        })
        .where(eq(products.id, updatedProduct.id));

      const commChanged =
        isOwner &&
        (prev.isCommissionEligible !== nextEligible ||
          prev.commissionMode !== (nextEligible ? nextMode : 'none') ||
          prev.customCommissionRate !== nextCustomRate ||
          prev.customCommissionFixed !== nextCustomFixed);

      if (actor && commChanged) {
        await tx.insert(commissionSettingLogs).values({
          id: `clg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          targetType: 'product',
          targetId: prev.id,
          targetName: updatedProduct.name?.trim() || prev.name,
          previousValue: {
            isCommissionEligible: prev.isCommissionEligible,
            commissionMode: prev.commissionMode,
            customCommissionRate: prev.customCommissionRate,
            customCommissionFixed: prev.customCommissionFixed,
          },
          newValue: {
            isCommissionEligible: nextEligible,
            commissionMode: nextEligible ? nextMode : 'none',
            customCommissionRate: nextCustomRate,
            customCommissionFixed: nextCustomFixed,
          },
          reason: 'تحديث إعدادات عمولة المنتج',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          createdAt: nowIso,
        });
      }

      if (actor) {
        await writeAuditLogTx(tx, {
          actionType: 'product_updated',
          actor,
          details: {
            productId: prev.id,
            code: cleanCode || prev.code,
            name: updatedProduct.name?.trim() || prev.name,
            prevPrice: prev.pricePerMg,
            newPrice: updatedProduct.pricePerMg ?? prev.pricePerMg,
          },
          createdAt: nowIso,
        });
      }
    });
  } catch (error) {
    console.error('Database query failed in updateProductRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('كود المنتج') ||
        error.message.includes('غير موجود') ||
        error.message.includes('غير مسموح'))
    ) {
      throw error;
    }
    throw new Error('Failed to update product.', { cause: error });
  }
}

export async function createTeamMemberRecord(
  userData: Omit<User, 'id'> & { password?: string },
  initialRepData?: Partial<SalesRep>,
  actor?: User
) {
  if (userData.role === ('owner' as UserRole)) {
    throw new Error('غير مسموح بإنشاء حساب المالك الرئيسي (Owner) عبر هذه الواجهة.');
  }

  try {
    const userId = `u-${Date.now()}`;
    const repId = `s-${Date.now()}`;
    const rawPassword = userData.password?.trim() || '123456';
    const passwordHash = hashPassword(rawPassword);

    await db.transaction(async (tx) => {
      await tx.insert(teamMembers).values({
        id: userId,
        name: userData.name,
        nickname: userData.nickname ?? null,
        avatar: userData.avatar ?? null,
        username: userData.username.toLowerCase().trim(),
        passwordHash,
        role: userData.role,
        salesRepId: userData.role === 'sales' ? repId : null,
        isSuspended: userData.isSuspended,
        isMuted: userData.isMuted,
        canEditInventory: userData.canEditInventory,
        canConfirmDelivery: userData.canConfirmDelivery,
        canManageOrderStatus: userData.canManageOrderStatus ?? false,
        canDeleteOrders: userData.canDeleteOrders ?? false,
        canDeleteCustomers: userData.canDeleteCustomers ?? false,
        address: userData.address ?? null,
        startDate: userData.startDate ?? null,
        online: userData.online ?? true,
      });

      if (userData.role === 'sales' && initialRepData) {
        const allowRepCommissionSet = !actor || actor.role === 'owner';
        const sanitizedCategoryRates: Record<string, number> = {};
        if (allowRepCommissionSet && initialRepData.categoryRates) {
          for (const [catId, rateVal] of Object.entries(initialRepData.categoryRates)) {
            if (typeof rateVal === 'number' && Number.isFinite(rateVal) && rateVal >= 0 && rateVal <= 1) {
              sanitizedCategoryRates[catId] = rateVal;
            }
          }
        }
        await tx.insert(salesReps).values({
          id: repId,
          userId,
          name: userData.name,
          totalCommission: allowRepCommissionSet ? initialRepData.totalCommission || 0 : 0,
          pendingCommission: allowRepCommissionSet ? initialRepData.pendingCommission || 0 : 0,
          ordersCount: initialRepData.ordersCount || 0,
          maxDiscountAllowed: initialRepData.maxDiscountAllowed || 10,
          customCommissionRate: allowRepCommissionSet
            ? (initialRepData.customCommissionRate ?? 0.05)
            : 0.05,
          categoryRates: sanitizedCategoryRates,
          monthlyHistory: [],
        });
      }

      if (actor) {
        await writeAuditLogTx(tx, {
          actionType: 'team_member_created',
          actor,
          details: { targetUserId: userId, username: userData.username, role: userData.role },
        });
      }
    });
  } catch (error) {
    console.error('Database query failed in createTeamMemberRecord:', error);
    throw new Error('Failed to create team member.', { cause: error });
  }
}

export async function updateTeamMemberRecord(
  updatedUser: User & { newPassword?: string },
  actor?: User
) {
  try {
    const existingRows = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, updatedUser.id))
      .limit(1);
    if (existingRows.length === 0) {
      throw new Error('الحساب المطلوب غير موجود.');
    }
    const existingRow = existingRows[0];

    if (existingRow.role === 'owner' && actor && actor.role !== 'owner') {
      throw new Error('غير مسموح لأي مستخدم بتعديل أو تعطيل حساب المالك الرئيسي.');
    }

    if (existingRow.role !== 'owner' && updatedUser.role === 'owner') {
      throw new Error('غير مسموح بترقية أي مستخدم إلى المالك الرئيسي (Owner) عبر هذه الواجهة.');
    }

    const safeRole: UserRole =
      existingRow.role === 'owner' ? 'owner' : (updatedUser.role as UserRole);

    const updateFields: Partial<typeof teamMembers.$inferInsert> = {
      name: updatedUser.name,
      nickname: updatedUser.nickname ?? null,
      avatar: updatedUser.avatar ?? null,
      username: updatedUser.username.toLowerCase().trim(),
      role: safeRole,
      salesRepId: updatedUser.salesRepId ?? null,
      isSuspended: safeRole === 'owner' ? false : updatedUser.isSuspended,
      isMuted: updatedUser.isMuted,
      canEditInventory: safeRole === 'owner' ? true : updatedUser.canEditInventory,
      canConfirmDelivery: safeRole === 'owner' ? true : updatedUser.canConfirmDelivery,
      canManageOrderStatus:
        safeRole === 'owner' ? true : (updatedUser.canManageOrderStatus ?? false),
      canDeleteOrders: safeRole === 'owner' ? true : (updatedUser.canDeleteOrders ?? false),
      canDeleteCustomers:
        safeRole === 'owner' ? true : (updatedUser.canDeleteCustomers ?? false),
      address: updatedUser.address ?? null,
      startDate: updatedUser.startDate ?? null,
      online: updatedUser.online ?? false,
    };

    if (updatedUser.newPassword && updatedUser.newPassword.trim().length > 0) {
      updateFields.passwordHash = hashPassword(updatedUser.newPassword.trim());
    }

    await db.transaction(async (tx) => {
      await tx
        .update(teamMembers)
        .set(updateFields)
        .where(eq(teamMembers.id, updatedUser.id));

      if (actor) {
        await writeAuditLogTx(tx, {
          actionType: 'team_member_updated',
          actor,
          details: { targetUserId: updatedUser.id, role: safeRole, suspended: updateFields.isSuspended },
        });
      }
    });
  } catch (error) {
    console.error('Database query failed in updateTeamMemberRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير مسموح') || error.message.includes('غير موجود'))
    ) {
      throw error;
    }
    throw new Error('Failed to update team member.', { cause: error });
  }
}

export async function updateSalesRepRecord(
  updatedRep: Partial<SalesRep> & { id: string; reason?: string },
  actor?: User
) {
  try {
    await db.transaction(async (tx) => {
      const prevRows = await tx
        .select()
        .from(salesReps)
        .where(eq(salesReps.id, updatedRep.id))
        .limit(1);
      if (prevRows.length === 0) {
        throw new Error('مندوب المبيعات المطلوب غير موجود.');
      }
      const prev = prevRows[0];

      const sanitizeRates = (raw?: Record<string, number> | null): Record<string, number> => {
        const result: Record<string, number> = {};
        if (!raw || typeof raw !== 'object') return result;
        for (const key of Object.keys(raw).sort()) {
          const v = raw[key];
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) {
            result[key] = Math.round(v * 10000) / 10000;
          }
        }
        return result;
      };

      const prevRates = sanitizeRates(prev.categoryRates);
      const nextRates =
        updatedRep.categoryRates !== undefined ? sanitizeRates(updatedRep.categoryRates) : prevRates;

      const nextCustomRate =
        typeof updatedRep.customCommissionRate === 'number' &&
        Number.isFinite(updatedRep.customCommissionRate)
          ? Math.min(1, Math.max(0, updatedRep.customCommissionRate))
          : prev.customCommissionRate;

      const nextTotalCommission =
        typeof updatedRep.totalCommission === 'number'
          ? updatedRep.totalCommission
          : prev.totalCommission;
      const nextPendingCommission =
        typeof updatedRep.pendingCommission === 'number'
          ? updatedRep.pendingCommission
          : prev.pendingCommission;

      const baseRateChanged = Math.abs(nextCustomRate - prev.customCommissionRate) > 1e-6;
      const catRatesChanged = JSON.stringify(prevRates) !== JSON.stringify(nextRates);
      const totalsChanged =
        Math.abs(nextTotalCommission - prev.totalCommission) > 1e-6 ||
        Math.abs(nextPendingCommission - prev.pendingCommission) > 1e-6;

      const isOwner = !actor || actor.role === 'owner';
      if (!isOwner && (baseRateChanged || catRatesChanged || totalsChanged)) {
        throw new Error('غير مسموح بتعديل نسب أو مبالغ عمولات المناديب إلا بواسطة المالك الرئيسي (Owner).');
      }

      const cleanName = updatedRep.name?.trim() || prev.name;
      const cleanMaxDiscount =
        typeof updatedRep.maxDiscountAllowed === 'number' &&
        Number.isFinite(updatedRep.maxDiscountAllowed)
          ? Math.min(100, Math.max(0, updatedRep.maxDiscountAllowed))
          : prev.maxDiscountAllowed;

      await tx
        .update(salesReps)
        .set({
          name: cleanName,
          totalCommission: isOwner ? nextTotalCommission : prev.totalCommission,
          pendingCommission: isOwner ? nextPendingCommission : prev.pendingCommission,
          ordersCount: isOwner && typeof updatedRep.ordersCount === 'number' ? updatedRep.ordersCount : prev.ordersCount,
          maxDiscountAllowed: cleanMaxDiscount,
          customCommissionRate: isOwner ? nextCustomRate : prev.customCommissionRate,
          categoryRates: isOwner ? nextRates : prevRates,
          monthlyHistory: updatedRep.monthlyHistory ?? prev.monthlyHistory,
        })
        .where(eq(salesReps.id, updatedRep.id));

      if (actor && isOwner && (baseRateChanged || catRatesChanged)) {
        await tx.insert(commissionSettingLogs).values({
          id: `clg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          targetType: 'sales_rep',
          targetId: updatedRep.id,
          targetName: cleanName,
          previousValue: {
            customCommissionRate: prev.customCommissionRate,
            categoryRates: prevRates,
          },
          newValue: {
            customCommissionRate: nextCustomRate,
            categoryRates: nextRates,
          },
          reason: updatedRep.reason?.trim() || 'تعديل نسب عمولة مندوب السيلز حسب التصنيف',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          createdAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error('Database query failed in updateSalesRepRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير مسموح') || error.message.includes('غير موجود'))
    ) {
      throw error;
    }
    throw new Error('Failed to update sales rep.', { cause: error });
  }
}

export async function createChatMessageRecord(msg: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
  try {
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    await db.insert(chatMessages).values(newMsg);
    return newMsg;
  } catch (error) {
    console.error('Database query failed in createChatMessageRecord:', error);
    throw new Error('Failed to send chat message.', { cause: error });
  }
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

export async function manageOrderItemSourcingRecord(
  orderId: string,
  actorUser: User,
  payload: ManageItemSourcingPayload
): Promise<Order> {
  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');
      if (existingRows.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existingRows[0];
      const prevStatus = prevOrder.status as OrderStatus;
      if (prevStatus === 'ملغي' || prevStatus === 'تم التسليم') {
        throw new Error('لا يمكن تعديل مصدر التوفير لطلب ملغي أو تم تسليمه بالفعل.');
      }
      if (!hasOrderBeenConfirmed(prevOrder)) {
        throw new Error('يرجى تأكيد الفاتورة من العميل أولاً قبل تنفيذ عمليات التوفير المخزني.');
      }

      const cleanIdempotencyKey = payload.idempotencyKey?.trim() || null;
      if (cleanIdempotencyKey) {
        const [dupMove, dupExt] = await Promise.all([
          tx
            .select({ id: stockMovements.id })
            .from(stockMovements)
            .where(eq(stockMovements.idempotencyKey, cleanIdempotencyKey))
            .limit(1),
          tx
            .select({ id: externalSourcingRecords.id })
            .from(externalSourcingRecords)
            .where(eq(externalSourcingRecords.idempotencyKey, cleanIdempotencyKey))
            .limit(1),
        ]);
        if (dupMove.length > 0 || dupExt.length > 0) {
          const revRows = await tx
            .select()
            .from(orderRevisions)
            .where(eq(orderRevisions.orderId, orderId))
            .orderBy(asc(orderRevisions.toVersion));
          return mapOrderRow(prevOrder, revRows.map(mapRevisionRow));
        }
      }

      const items = [...prevOrder.items];
      const idx = Number(payload.itemIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
        throw new Error('الصنف المحدد غير موجود داخل الفاتورة.');
      }

      const allProducts = await tx.select().from(products);
      const rawTarget = normalizeOrderItem(items[idx], false);
      let prod = findMatchingProduct(
        allProducts,
        rawTarget.productName,
        rawTarget.grade,
        rawTarget.productId,
        rawTarget.productCode
      );
      const eff = getEffectiveLegacyWarehouseQty(rawTarget, prod);

      let ware = eff.ware;
      let ext = eff.ext;
      let pend = eff.pend;
      let resolvedSource: ItemSourcingSource =
        rawTarget.sourcingSource || (pend > 0 ? 'بانتظار التوفير' : 'من المخزون الحالي');
      let receivedIntoWarehouse = Boolean(rawTarget.receivedIntoWarehouse);
      const supplierName = payload.supplierName?.trim() || rawTarget.supplierName;
      const sourcingNotes = payload.notes?.trim() || rawTarget.sourcingNotes;
      const nowIso = new Date().toISOString();
      const dateSecured = payload.dateSecured?.trim() || formatCairoYmd(new Date(nowIso));
      const unitLabel = prod?.unit || rawTarget.unit || 'وحدة';
      let auditNote = '';
      let resolvedUnitCost: number | null =
        typeof payload.unitCost === 'number' && Number.isFinite(payload.unitCost) && payload.unitCost >= 0
          ? payload.unitCost
          : null;
      let resolvedTotalCost: number | null =
        typeof payload.totalSourcingCost === 'number' &&
        Number.isFinite(payload.totalSourcingCost) &&
        payload.totalSourcingCost >= 0
          ? payload.totalSourcingCost
          : null;

      if (payload.action === 'set_source') {
        if (!payload.sourcingSource || !VALID_SOURCING_SOURCES.includes(payload.sourcingSource)) {
          throw new Error('مصدر التوفير المختار غير صالح.');
        }
        resolvedSource = payload.sourcingSource;
        auditNote = `تحديث مصدر توفير "${rawTarget.productName}" إلى: ${resolvedSource}`;
      } else if (payload.action === 'receive_into_warehouse') {
        if (receivedIntoWarehouse && pend === 0) {
          throw new Error(
            'تم تسجيل استلام هذه الكمية وتخصيصها من المورد مسبقًا؛ لا يمكن تكرار نفس حركة الاستلام.'
          );
        }
        if (pend <= 0) {
          throw new Error('لا توجد كمية متبقية بانتظار التوفير لهذا الصنف.');
        }

        const receivedQty =
          payload.quantity !== undefined ? Number(payload.quantity) : pend;
        if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
          throw new Error('كمية الاستلام من المورد غير صالحة.');
        }

        if (!prod) {
          const genId = `p-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`;
          const [insertedProd] = await tx
            .insert(products)
            .values({
              id: genId,
              code: rawTarget.productCode || `PRD-${genId.slice(-6)}`,
              name: rawTarget.productName,
              categoryId: rawTarget.categoryId || 'cat-oils',
              categoryName: rawTarget.categoryName || 'الزيوت العطرية',
              unit: rawTarget.unit || 'mg',
              grade: rawTarget.grade,
              pricePerMg: rawTarget.price,
              stock: 0,
              isActive: true,
              isCommissionEligible:
                typeof rawTarget.isCommissionEligible === 'boolean'
                  ? rawTarget.isCommissionEligible
                  : (rawTarget.categoryId || 'cat-oils') === 'cat-oils',
              commissionMode: 'inherit_rep',
            })
            .returning();
          allProducts.push(insertedProd);
          prod = insertedProd;
        }

        const stockBeforeReceipt = Math.max(0, prod.stock);
        const stockAfterReceipt = roundStockNumber(stockBeforeReceipt + receivedQty);

        await writeStockMovementTx(tx, {
          productId: prod.id,
          productName: rawTarget.productName,
          grade: rawTarget.grade,
          unit: prod.unit || unitLabel,
          orderId,
          movementType: 'supplier_receipt',
          sourcingSource: 'توفير من المورد',
          quantityDelta: receivedQty,
          orderQuantityCovered: 0,
          previousStock: stockBeforeReceipt,
          newStock: stockAfterReceipt,
          supplierName: supplierName ?? null,
          note: sourcingNotes || `استلام من المورد لتغطية الطلب ${orderId}`,
          idempotencyKey: cleanIdempotencyKey ? `${cleanIdempotencyKey}:receipt` : null,
          actor: actorUser,
          createdAt: nowIso,
        });

        const allocQty = Math.min(stockAfterReceipt, pend);
        const finalStock = roundStockNumber(stockAfterReceipt - allocQty);

        await tx.update(products).set({ stock: finalStock }).where(eq(products.id, prod.id));

        await writeStockMovementTx(tx, {
          productId: prod.id,
          productName: rawTarget.productName,
          grade: rawTarget.grade,
          unit: prod.unit || unitLabel,
          orderId,
          movementType: 'order_allocation',
          sourcingSource: 'توفير من المورد',
          quantityDelta: -allocQty,
          orderQuantityCovered: allocQty,
          previousStock: stockAfterReceipt,
          newStock: finalStock,
          supplierName: supplierName ?? null,
          note: sourcingNotes || `تخصيص الكمية المستلمة من المورد لصالح الطلب ${orderId}`,
          idempotencyKey: cleanIdempotencyKey ? `${cleanIdempotencyKey}:alloc` : null,
          actor: actorUser,
          createdAt: nowIso,
        });

        if (resolvedTotalCost === null && resolvedUnitCost !== null) {
          resolvedTotalCost = Math.round(resolvedUnitCost * receivedQty * 100) / 100;
        } else if (resolvedUnitCost === null && resolvedTotalCost !== null && receivedQty > 0) {
          resolvedUnitCost = Math.round((resolvedTotalCost / receivedQty) * 10000) / 10000;
        }

        await tx.insert(externalSourcingRecords).values({
          id: `ext-${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}`,
          orderId,
          itemIndex: idx,
          productId: prod.id,
          productCode: prod.code ?? rawTarget.productCode ?? null,
          productName: rawTarget.productName,
          categoryId: prod.categoryId ?? rawTarget.categoryId ?? null,
          categoryName: prod.categoryName ?? rawTarget.categoryName ?? null,
          unit: prod.unit || unitLabel,
          sourcingType: 'supplier_receipt',
          supplierName: supplierName ?? null,
          externalQty: receivedQty,
          unitCost: resolvedUnitCost,
          totalSourcingCost: resolvedTotalCost,
          dateSecured,
          notes: sourcingNotes ?? null,
          idempotencyKey: cleanIdempotencyKey,
          recordedById: actorUser.id,
          recordedByName: actorUser.name,
          recordedAt: nowIso,
        });

        ware = roundStockNumber(ware + allocQty);
        pend = Math.max(0, roundStockNumber(pend - allocQty));
        resolvedSource = 'توفير من المورد';
        receivedIntoWarehouse = true;
        auditNote = `استلام ${receivedQty.toLocaleString()} ${unitLabel} من المورد${
          supplierName ? ` (${supplierName})` : ''
        } وتخصيص ${allocQty.toLocaleString()} ${unitLabel} لصالح "${rawTarget.productName}"`;
      } else if (payload.action === 'fulfill_external_direct') {
        if (pend <= 0) {
          throw new Error('لا توجد كمية متبقية بانتظار التوفير لهذا الصنف.');
        }
        const coverQty =
          payload.quantity !== undefined ? Math.min(Number(payload.quantity), pend) : pend;
        if (!Number.isFinite(coverQty) || coverQty <= 0) {
          throw new Error('كمية التوفير الخارجي غير صالحة.');
        }

        const currentProdStock = prod ? Math.max(0, prod.stock) : 0;
        await writeStockMovementTx(tx, {
          productId: prod?.id ?? null,
          productName: rawTarget.productName,
          grade: rawTarget.grade,
          unit: unitLabel,
          orderId,
          movementType: 'external_direct',
          sourcingSource: 'توفير خارجي دون إدخاله إلى المخزن',
          quantityDelta: 0,
          orderQuantityCovered: coverQty,
          previousStock: currentProdStock,
          newStock: currentProdStock,
          supplierName: supplierName ?? null,
          note: sourcingNotes || 'توفير خارجي مباشر للعميل دون إدخال للمخزن',
          idempotencyKey: cleanIdempotencyKey,
          actor: actorUser,
          createdAt: nowIso,
        });

        if (resolvedTotalCost === null && resolvedUnitCost !== null) {
          resolvedTotalCost = Math.round(resolvedUnitCost * coverQty * 100) / 100;
        } else if (resolvedUnitCost === null && resolvedTotalCost !== null && coverQty > 0) {
          resolvedUnitCost = Math.round((resolvedTotalCost / coverQty) * 10000) / 10000;
        }

        await tx.insert(externalSourcingRecords).values({
          id: `ext-${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}`,
          orderId,
          itemIndex: idx,
          productId: prod?.id ?? rawTarget.productId ?? null,
          productCode: prod?.code ?? rawTarget.productCode ?? null,
          productName: rawTarget.productName,
          categoryId: prod?.categoryId ?? rawTarget.categoryId ?? null,
          categoryName: prod?.categoryName ?? rawTarget.categoryName ?? null,
          unit: unitLabel,
          sourcingType: 'external_direct',
          supplierName: supplierName ?? null,
          externalQty: coverQty,
          unitCost: resolvedUnitCost,
          totalSourcingCost: resolvedTotalCost,
          dateSecured,
          notes: sourcingNotes ?? null,
          idempotencyKey: cleanIdempotencyKey,
          recordedById: actorUser.id,
          recordedByName: actorUser.name,
          recordedAt: nowIso,
        });

        ext = roundStockNumber(ext + coverQty);
        pend = Math.max(0, roundStockNumber(pend - coverQty));
        resolvedSource = 'توفير خارجي دون إدخاله إلى المخزن';
        auditNote = `تأكيد توفير خارجي مباشر بمقدار ${coverQty.toLocaleString()} ${unitLabel} لصنف "${rawTarget.productName}" بدون التأثير على المخزن`;
      } else if (payload.action === 'allocate_from_warehouse') {
        if (pend <= 0) {
          throw new Error('لا توجد كمية متبقية بانتظار التوفير لهذا الصنف.');
        }
        if (!prod || prod.stock <= 0) {
          throw new Error('لا يوجد رصيد متاح حاليًا في المخزون لهذا الصنف.');
        }
        const wanted =
          payload.quantity !== undefined ? Math.min(Number(payload.quantity), pend) : pend;
        const allocQty = Math.min(prod.stock, wanted);
        if (!Number.isFinite(allocQty) || allocQty <= 0) {
          throw new Error('كمية التخصيص من المخزن غير صالحة.');
        }

        const prevStock = prod.stock;
        const nextStock = roundStockNumber(prevStock - allocQty);
        await tx.update(products).set({ stock: nextStock }).where(eq(products.id, prod.id));

        await writeStockMovementTx(tx, {
          productId: prod.id,
          productName: rawTarget.productName,
          grade: rawTarget.grade,
          unit: prod.unit || unitLabel,
          orderId,
          movementType: 'order_allocation',
          sourcingSource: 'من المخزون الحالي',
          quantityDelta: -allocQty,
          orderQuantityCovered: allocQty,
          previousStock: prevStock,
          newStock: nextStock,
          note: sourcingNotes || `سحب الكمية المتوفرة بالمخزن لصالح الطلب ${orderId}`,
          idempotencyKey: cleanIdempotencyKey,
          actor: actorUser,
          createdAt: nowIso,
        });

        ware = roundStockNumber(ware + allocQty);
        pend = Math.max(0, roundStockNumber(pend - allocQty));
        if (pend === 0 && ext === 0) resolvedSource = 'من المخزون الحالي';
        auditNote = `سحب ${allocQty.toLocaleString()} ${unitLabel} من المخزون الحالي لصنف "${rawTarget.productName}"`;
      } else {
        throw new Error('إجراء التوفير المطلوب غير معروف.');
      }

      const procurementStatus: ItemProcurementStatus = pend > 0 ? 'pending' : 'fulfilled';
      items[idx] = {
        ...rawTarget,
        ...(prod ? { productId: prod.id, productCode: prod.code || rawTarget.productCode } : {}),
        unit: prod?.unit || rawTarget.unit,
        sourcingSource: resolvedSource,
        warehouseDeductedQty: ware,
        externalSuppliedQty: ext,
        pendingQty: pend,
        procurementStatus,
        ...(supplierName ? { supplierName } : {}),
        ...(sourcingNotes ? { sourcingNotes } : {}),
        ...(resolvedUnitCost !== null ? { externalUnitCost: resolvedUnitCost } : {}),
        ...(resolvedTotalCost !== null ? { externalTotalCost: resolvedTotalCost } : {}),
        ...(payload.action === 'receive_into_warehouse' || payload.action === 'fulfill_external_direct'
          ? { supplierDateSecured: dateSecured }
          : {}),
        receivedIntoWarehouse,
        sourcingUpdatedBy: actorUser.name,
        sourcingUpdatedAt: nowIso,
      };

      const nextHistory: OrderStatusHistoryEntry[] = [
        ...(prevOrder.statusHistory ?? []),
        {
          fromStatus: prevStatus,
          toStatus: prevStatus,
          changedById: actorUser.id,
          changedByName: actorUser.name,
          changedByRole: actorUser.role,
          changedAt: nowIso,
          note: auditNote,
        },
      ];

      await tx
        .update(orders)
        .set({
          items,
          statusHistory: nextHistory,
        })
        .where(eq(orders.id, orderId));

      await writeAuditLogTx(tx, {
        orderId,
        actionType: 'order_item_sourcing_updated',
        actor: actorUser,
        details: {
          itemIndex: idx,
          productName: rawTarget.productName,
          grade: rawTarget.grade,
          unit: unitLabel,
          action: payload.action,
          sourcingSource: resolvedSource,
          warehouseDeductedQty: ware,
          externalSuppliedQty: ext,
          pendingQty: pend,
          procurementStatus,
          unitCost: resolvedUnitCost,
          totalSourcingCost: resolvedTotalCost,
        },
        createdAt: nowIso,
      });

      const [updatedRow] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const revRows = await tx
        .select()
        .from(orderRevisions)
        .where(eq(orderRevisions.orderId, orderId))
        .orderBy(asc(orderRevisions.toVersion));
      return mapOrderRow(updatedRow, revRows.map(mapRevisionRow));
    });
  } catch (error) {
    console.error('Database query failed in manageOrderItemSourcingRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجود') ||
        error.message.includes('لا توجد') ||
        error.message.includes('لا يمكن') ||
        error.message.includes('مسبقًا') ||
        error.message.includes('غير صالحة') ||
        error.message.includes('غير صالح') ||
        error.message.includes('لا يوجد رصيد') ||
        error.message.includes('يرجى تأكيد'))
    ) {
      throw error;
    }
    throw new Error('Failed to update item sourcing.', { cause: error });
  }
}

export async function listExternalSourcingRecords(filters?: {
  orderId?: string;
  productId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<ExternalSourcingRecord[]> {
  const rows = await db
    .select()
    .from(externalSourcingRecords)
    .orderBy(desc(externalSourcingRecords.recordedAt));

  return rows
    .filter((r) => {
      if (filters?.orderId && r.orderId !== filters.orderId) return false;
      if (filters?.productId && r.productId !== filters.productId) return false;
      if (filters?.dateFrom && r.dateSecured < filters.dateFrom) return false;
      if (filters?.dateTo && r.dateSecured > filters.dateTo) return false;
      return true;
    })
    .map((r) => ({
      id: r.id,
      orderId: r.orderId,
      itemIndex: r.itemIndex,
      productId: r.productId ?? null,
      productCode: r.productCode ?? null,
      productName: r.productName,
      categoryId: r.categoryId ?? null,
      categoryName: r.categoryName ?? null,
      unit: r.unit,
      sourcingType: r.sourcingType as ExternalSourcingRecord['sourcingType'],
      supplierName: r.supplierName ?? null,
      externalQty: r.externalQty,
      unitCost: r.unitCost ?? null,
      totalSourcingCost: r.totalSourcingCost ?? null,
      dateSecured: r.dateSecured,
      notes: r.notes ?? null,
      recordedById: r.recordedById,
      recordedByName: r.recordedByName,
      recordedAt: r.recordedAt,
    }));
}

export async function updateExternalSourcingCostRecord(
  recordId: string,
  patch: {
    supplierName?: string | null;
    unitCost?: number | null;
    totalSourcingCost?: number | null;
    dateSecured?: string;
    notes?: string | null;
  },
  actor: User
): Promise<ExternalSourcingRecord> {
  return await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(externalSourcingRecords)
      .where(eq(externalSourcingRecords.id, recordId))
      .limit(1);
    if (existingRows.length === 0) {
      throw new Error('سجل التوفير الخارجي المطلوب غير موجود.');
    }
    const prev = existingRows[0];

    let nextUnitCost: number | null =
      patch.unitCost !== undefined
        ? typeof patch.unitCost === 'number' && Number.isFinite(patch.unitCost) && patch.unitCost >= 0
          ? patch.unitCost
          : null
        : prev.unitCost;
    let nextTotalCost: number | null =
      patch.totalSourcingCost !== undefined
        ? typeof patch.totalSourcingCost === 'number' &&
          Number.isFinite(patch.totalSourcingCost) &&
          patch.totalSourcingCost >= 0
          ? patch.totalSourcingCost
          : null
        : prev.totalSourcingCost;

    if (patch.totalSourcingCost === undefined && patch.unitCost !== undefined) {
      nextTotalCost =
        nextUnitCost !== null ? Math.round(nextUnitCost * prev.externalQty * 100) / 100 : null;
    } else if (patch.unitCost === undefined && patch.totalSourcingCost !== undefined) {
      nextUnitCost =
        nextTotalCost !== null && prev.externalQty > 0
          ? Math.round((nextTotalCost / prev.externalQty) * 10000) / 10000
          : null;
    }

    const nextSupplierName =
      patch.supplierName !== undefined ? patch.supplierName?.trim() || null : prev.supplierName;
    const nextDateSecured = patch.dateSecured?.trim() || prev.dateSecured;
    const nextNotes = patch.notes !== undefined ? patch.notes?.trim() || null : prev.notes;

    await tx
      .update(externalSourcingRecords)
      .set({
        supplierName: nextSupplierName,
        unitCost: nextUnitCost,
        totalSourcingCost: nextTotalCost,
        dateSecured: nextDateSecured,
        notes: nextNotes,
      })
      .where(eq(externalSourcingRecords.id, recordId));

    // Sync cost back into the linked order item if present
    const orderRows = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, prev.orderId))
      .limit(1);
    if (orderRows.length > 0 && Array.isArray(orderRows[0].items)) {
      const nextItems = [...orderRows[0].items];
      const targetItem = nextItems[prev.itemIndex];
      if (targetItem) {
        nextItems[prev.itemIndex] = {
          ...targetItem,
          ...(nextSupplierName ? { supplierName: nextSupplierName } : {}),
          externalUnitCost: nextUnitCost,
          externalTotalCost: nextTotalCost,
          supplierDateSecured: nextDateSecured,
        };
        await tx
          .update(orders)
          .set({ items: nextItems })
          .where(eq(orders.id, prev.orderId));
      }
    }

    await writeAuditLogTx(tx, {
      orderId: prev.orderId,
      actionType: 'external_sourcing_cost_updated',
      actor,
      details: {
        recordId,
        productName: prev.productName,
        previousUnitCost: prev.unitCost,
        newUnitCost: nextUnitCost,
        previousTotalCost: prev.totalSourcingCost,
        newTotalCost: nextTotalCost,
      },
      createdAt: new Date().toISOString(),
    });

    const [updated] = await tx
      .select()
      .from(externalSourcingRecords)
      .where(eq(externalSourcingRecords.id, recordId))
      .limit(1);
    return {
      id: updated.id,
      orderId: updated.orderId,
      itemIndex: updated.itemIndex,
      productId: updated.productId ?? null,
      productCode: updated.productCode ?? null,
      productName: updated.productName,
      categoryId: updated.categoryId ?? null,
      categoryName: updated.categoryName ?? null,
      unit: updated.unit,
      sourcingType: updated.sourcingType as ExternalSourcingRecord['sourcingType'],
      supplierName: updated.supplierName ?? null,
      externalQty: updated.externalQty,
      unitCost: updated.unitCost ?? null,
      totalSourcingCost: updated.totalSourcingCost ?? null,
      dateSecured: updated.dateSecured,
      notes: updated.notes ?? null,
      recordedById: updated.recordedById,
      recordedByName: updated.recordedByName,
      recordedAt: updated.recordedAt,
    };
  });
}

export async function getStockMovementsForUser(
  user: User,
  orderId?: string
): Promise<StockMovementEntry[]> {
  try {
    const canView =
      user.role === 'owner' ||
      user.role === 'admin' ||
      user.role === 'supervisor' ||
      Boolean(user.canEditInventory) ||
      Boolean(user.canManageOrderStatus);
    if (!canView) return [];

    const rows = orderId
      ? await db
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.orderId, orderId))
          .orderBy(desc(stockMovements.createdAt))
          .limit(300)
      : await db
          .select()
          .from(stockMovements)
          .orderBy(desc(stockMovements.createdAt))
          .limit(300);

    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      grade: r.grade as OilGrade,
      unit: r.unit ?? null,
      orderId: r.orderId,
      movementType: r.movementType as StockMovementEntry['movementType'],
      sourcingSource: r.sourcingSource as ItemSourcingSource,
      quantityDelta: r.quantityDelta,
      orderQuantityCovered: r.orderQuantityCovered,
      previousStock: r.previousStock,
      newStock: r.newStock,
      supplierName: r.supplierName,
      note: r.note,
      idempotencyKey: r.idempotencyKey ?? null,
      actorId: r.actorId,
      actorName: r.actorName,
      actorRole: r.actorRole as UserRole,
      createdAt: r.createdAt,
    }));
  } catch (error) {
    console.error('Database query failed in getStockMovementsForUser:', error);
    throw new Error('Failed to load stock movements.', { cause: error });
  }
}

export interface OrderQueryFilters {
  dateFrom?: string;
  dateTo?: string;
  dateType?: OrderDateField;
  preset?: OrderDatePreset;
  status?: string;
  queue?: string;
  search?: string;
  governorate?: string;
}

export interface OrderQueryResult {
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

const VALID_ORDER_DATE_FIELDS: OrderDateField[] = [
  'createdAt',
  'confirmedAt',
  'prepStartedAt',
  'prepCompletedAt',
  'shippedAt',
  'deliveredAt',
  'cancelledAt',
  'returnedAt',
];

export async function queryOrdersForUser(
  user: User,
  filters: OrderQueryFilters = {}
): Promise<OrderQueryResult> {
  try {
    await ensureInitialDataSeeded();

    const dateType: OrderDateField =
      filters.dateType && VALID_ORDER_DATE_FIELDS.includes(filters.dateType)
        ? filters.dateType
        : 'createdAt';

    const preset: OrderDatePreset = filters.preset || (filters.dateFrom || filters.dateTo ? 'custom' : 'all');
    const resolvedRange = resolveCairoDateRange(preset, filters.dateFrom, filters.dateTo);

    const conditions: SQL[] = [];

    // 1. Strict RBAC scope
    const hasOpsAccess =
      user.role === 'owner' ||
      user.role === 'admin' ||
      user.role === 'supervisor' ||
      Boolean(user.canConfirmDelivery) ||
      Boolean(user.canManageOrderStatus);

    if (!hasOpsAccess) {
      conditions.push(eq(orders.salesRepId, user.salesRepId || '__none__'));
    }

    // 2. Date boundary filter executed in PostgreSQL using Africa/Cairo timezone
    const dateColumnMap = {
      createdAt: orders.createdAt,
      confirmedAt: orders.confirmedAt,
      prepStartedAt: orders.prepStartedAt,
      prepCompletedAt: orders.prepCompletedAt,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
      cancelledAt: orders.cancelledAt,
      returnedAt: orders.returnedAt,
    };
    const selectedDateCol = dateColumnMap[dateType];

    if (resolvedRange.dateFrom || resolvedRange.dateTo) {
      conditions.push(isNotNull(selectedDateCol));
      conditions.push(sql`${selectedDateCol} <> ''`);

      if (resolvedRange.dateFrom) {
        conditions.push(
          sql`(${selectedDateCol})::timestamptz >= (${resolvedRange.dateFrom}::date::timestamp AT TIME ZONE 'Africa/Cairo')`
        );
      }
      if (resolvedRange.dateTo) {
        conditions.push(
          sql`(${selectedDateCol})::timestamptz < ((${resolvedRange.dateTo}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Africa/Cairo')`
        );
      }
    }

    // 3. Governorate filter
    if (filters.governorate && filters.governorate !== 'all') {
      conditions.push(eq(orders.governorate, filters.governorate));
    }

    // 4. Text search filter across customer, phone, ID, sales rep, shipping info & items JSONB
    const searchTerm = filters.search?.trim();
    if (searchTerm) {
      const pattern = `%${searchTerm}%`;
      const searchCond = or(
        ilike(orders.id, pattern),
        ilike(orders.customerName, pattern),
        ilike(orders.customerPhone, pattern),
        ilike(orders.salesRepName, pattern),
        ilike(orders.customerAddress, pattern),
        sql`COALESCE(${orders.governorate}, '') ILIKE ${pattern}`,
        sql`COALESCE(${orders.shippingInfo}::text, '') ILIKE ${pattern}`,
        sql`${orders.items}::text ILIKE ${pattern}`
      );
      if (searchCond) conditions.push(searchCond);
    }

    const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;
    const [orderRows, allRevRows] = await Promise.all([
      baseWhere
        ? db.select().from(orders).where(baseWhere).orderBy(desc(orders.createdAt))
        : db.select().from(orders).orderBy(desc(orders.createdAt)),
      db.select().from(orderRevisions).orderBy(asc(orderRevisions.toVersion)),
    ]);

    const revisionsByOrderId = new Map<string, OrderRevisionEntry[]>();
    for (const rev of allRevRows) {
      const mapped = mapRevisionRow(rev);
      const list = revisionsByOrderId.get(rev.orderId);
      if (list) list.push(mapped);
      else revisionsByOrderId.set(rev.orderId, [mapped]);
    }

    const baseMatchedOrders = orderRows.map((row) =>
      mapOrderRow(row, revisionsByOrderId.get(row.id) ?? [])
    );

    // Compute queue counts across date/search/governorate/RBAC matched set
    const queueCounts: Record<string, number> = {
      all: baseMatchedOrders.filter((o) => o.status !== 'بانتظار تأكيد العميل').length,
      'awaiting-confirmation': baseMatchedOrders.filter((o) => o.status === 'بانتظار تأكيد العميل').length,
      'pending-prep': baseMatchedOrders.filter(
        (o) =>
          o.status === 'طلب جديد' ||
          o.status === 'بانتظار التجهيز' ||
          o.status === 'قيد التنفيذ'
      ).length,
      'in-progress': baseMatchedOrders.filter((o) => o.status === 'جاري التجهيز').length,
      prepared: baseMatchedOrders.filter((o) => o.status === 'تم التجهيز').length,
      shipped: baseMatchedOrders.filter((o) => o.status === 'تم الشحن').length,
      delivered: baseMatchedOrders.filter((o) => o.status === 'تم التسليم').length,
      returned: baseMatchedOrders.filter(
        (o) => o.status === 'مرتجع' || o.status === 'رفض استلام'
      ).length,
      cancelled: baseMatchedOrders.filter((o) => o.status === 'ملغي').length,
      'needs-review': baseMatchedOrders.filter(
        (o) =>
          o.status !== 'ملغي' &&
          o.status !== 'بانتظار تأكيد العميل' &&
          (Boolean(o.pendingEditRequest) ||
            o.revisionAlert?.status === 'تعديل جديد يحتاج المراجعة' ||
            o.revisionAlert?.status === 'يحتاج إعادة تجهيز')
      ).length,
      'pending-procurement': baseMatchedOrders.filter(
        (o) =>
          o.status !== 'ملغي' &&
          o.status !== 'تم التسليم' &&
          hasOrderPendingProcurement(o)
      ).length,
      held: baseMatchedOrders.filter((o) => Boolean(o.holdInfo?.isHeld)).length,
    };

    // 5. Optional status / queue narrowing
    let finalOrders = baseMatchedOrders;
    if (filters.status && filters.status !== 'الكل' && filters.status !== 'all') {
      finalOrders = finalOrders.filter((o) => o.status === filters.status);
    }

    if (filters.queue && filters.queue !== 'all') {
      finalOrders = finalOrders.filter((o) => {
        switch (filters.queue) {
          case 'awaiting-confirmation':
            return o.status === 'بانتظار تأكيد العميل';
          case 'pending-prep':
            return (
              o.status === 'طلب جديد' ||
              o.status === 'بانتظار التجهيز' ||
              o.status === 'قيد التنفيذ'
            );
          case 'in-progress':
            return o.status === 'جاري التجهيز';
          case 'prepared':
            return o.status === 'تم التجهيز';
          case 'shipped':
            return o.status === 'تم الشحن';
          case 'delivered':
            return o.status === 'تم التسليم';
          case 'returned':
            return o.status === 'مرتجع' || o.status === 'رفض استلام';
          case 'cancelled':
            return o.status === 'ملغي';
          case 'needs-review':
            return (
              o.status !== 'ملغي' &&
              o.status !== 'بانتظار تأكيد العميل' &&
              (Boolean(o.pendingEditRequest) ||
                o.revisionAlert?.status === 'تعديل جديد يحتاج المراجعة' ||
                o.revisionAlert?.status === 'يحتاج إعادة تجهيز')
            );
          case 'pending-procurement':
            return (
              o.status !== 'ملغي' &&
              o.status !== 'تم التسليم' &&
              hasOrderPendingProcurement(o)
            );
          case 'held':
            return Boolean(o.holdInfo?.isHeld);
          default:
            return true;
        }
      });
    }

    const stats = computeOrderStats(finalOrders);

    return {
      orders: finalOrders,
      stats,
      queueCounts,
      appliedFilter: {
        dateFrom: resolvedRange.dateFrom,
        dateTo: resolvedRange.dateTo,
        dateType,
        preset: resolvedRange.preset,
      },
    };
  } catch (error) {
    console.error('Database query failed in queryOrdersForUser:', error);
    throw new Error('Failed to query orders.', { cause: error });
  }
}
