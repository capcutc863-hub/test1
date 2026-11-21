import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  customers,
  orderRevisions,
  orders,
  products,
  salesReps,
  stockMovements,
} from './schema.ts';
import { getAllCategories, mapProductRow } from './catalogQueries.ts';
import {
  ALLOWED_OPERATIONAL_TRANSITIONS,
  getProductUsageInfo,
  hasOrderBeenConfirmed,
  updateOrderStatusRecord,
  type StatusTransitionOptions,
} from './queries.ts';
import {
  convertQuantityBetweenUnits,
  normalizeProductUnit,
  roundStockNumber,
} from '../lib/unit-conversion.ts';
import { hasOrderPendingProcurement, isRevisionPendingReview, normalizeRevisionStatus } from '../lib/date-utils.ts';
import type {
  BulkExecuteResult,
  BulkPreviewItem,
  BulkPreviewResult,
  OrderStatus,
  User,
} from '../../types.ts';

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeBulkAuditLogTx(
  tx: DbTx,
  actionType: string,
  actor: User,
  details: Record<string, unknown>,
  createdAt: string
) {
  await tx.insert(auditLogs).values({
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    orderId: null,
    actionType,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    details,
    createdAt,
  });
}

// =========================================================================
// 1. BULK PRODUCTS SELECTION & ACTIONS
// =========================================================================

export interface BulkProductFilterCriteria {
  search?: string;
  categoryId?: string;
  grade?: string;
  activeFilter?: 'all' | 'active' | 'archived';
  lowStockOnly?: boolean;
}

export interface BulkProductActionPayload {
  selectionMode?: 'ids' | 'all_matching_filters';
  productIds?: string[];
  filters?: BulkProductFilterCriteria;
  action:
    | 'archive'
    | 'unarchive'
    | 'delete'
    | 'change_category'
    | 'update_pricing'
    | 'update_commission';
  targetCategoryId?: string;
  priceUpdateMode?: 'set_fixed' | 'percent_change';
  sellingPriceValue?: number;
  costPriceValue?: number | null;
  isCommissionEligible?: boolean;
  commissionMode?: 'inherit_rep' | 'fixed_rate' | 'fixed_per_unit' | 'none' | 'product_rate' | 'product_fixed';
  customCommissionRate?: number | null;
  customCommissionFixed?: number | null;
  reason?: string;
}

async function resolveSelectedProducts(payload: {
  selectionMode?: 'ids' | 'all_matching_filters';
  productIds?: string[];
  filters?: BulkProductFilterCriteria;
}) {
  const allRows = await db.select().from(products);
  const mapped = allRows.map(mapProductRow);

  if (payload.selectionMode === 'all_matching_filters' && payload.filters) {
    const f = payload.filters;
    const q = (f.search || '').trim().toLowerCase();
    return mapped.filter((p) => {
      if (f.activeFilter === 'active' && !p.isActive) return false;
      if (f.activeFilter === 'archived' && p.isActive) return false;
      if (f.categoryId && f.categoryId !== 'all' && p.categoryId !== f.categoryId) return false;
      if (f.grade && f.grade !== 'all' && f.grade !== 'الكل' && p.grade !== f.grade) return false;
      if (f.lowStockOnly && p.stock > 0) return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.code.toLowerCase().includes(q) &&
        !(p.description || '').toLowerCase().includes(q) &&
        !(p.categoryName || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }

  const idSet = new Set((payload.productIds || []).map(String));
  return mapped.filter((p) => idSet.has(p.id));
}

export async function previewBulkProductsAction(
  payload: BulkProductActionPayload,
  actor: User
): Promise<BulkPreviewResult> {
  const selected = await resolveSelectedProducts(payload);
  const categories = await getAllCategories();
  const targetCat = payload.targetCategoryId
    ? categories.find((c) => c.id === payload.targetCategoryId)
    : undefined;
  const warnings: string[] = [];
  const items: BulkPreviewItem[] = [];

  if (
    (payload.action === 'delete' ||
      payload.action === 'update_pricing' ||
      payload.action === 'update_commission') &&
    actor.role !== 'owner'
  ) {
    throw new Error('هذا الإجراء الجماعي مخصص للمالك الرئيسي (Owner) فقط.');
  }

  if (payload.action === 'change_category' && !targetCat) {
    throw new Error('يرجى تحديد التصنيف الجديد المطلوب.');
  }

  for (const prod of selected) {
    if (payload.action === 'archive') {
      if (!prod.isActive) {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: false,
          reason: 'المنتج مؤرشف بالفعل.',
        });
      } else {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: true,
          previewBefore: 'نشط',
          previewAfter: 'مؤرشف',
        });
      }
    } else if (payload.action === 'unarchive') {
      if (prod.isActive) {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: false,
          reason: 'المنتج نشط بالفعل.',
        });
      } else {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: true,
          previewBefore: 'مؤرشف',
          previewAfter: 'نشط',
        });
      }
    } else if (payload.action === 'delete') {
      const usage = await getProductUsageInfo(prod.id);
      if (!usage || !usage.canDelete) {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: false,
          reason: usage
            ? `مرتبط بـ ${usage.ordersCount} فاتورة و ${usage.stockMovementsCount} حركة مخزون (يمكن أرشفته بدلاً من الحذف).`
            : 'غير متاح للحذف.',
        });
      } else {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: true,
          previewBefore: `رصيد ${prod.stock} ${prod.unit}`,
          previewAfter: 'حذف نهائي من الكتالوج',
        });
      }
    } else if (payload.action === 'change_category' && targetCat) {
      if (prod.categoryId === targetCat.id) {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: false,
          reason: `ينتمي بالفعل لتصنيف "${targetCat.name}".`,
        });
      } else {
        items.push({
          id: prod.id,
          label: prod.name,
          subLabel: prod.code,
          eligible: true,
          previewBefore: prod.categoryName,
          previewAfter: targetCat.name,
        });
      }
    } else if (payload.action === 'update_pricing') {
      let nextSell = prod.pricePerMg;
      if (typeof payload.sellingPriceValue === 'number' && Number.isFinite(payload.sellingPriceValue)) {
        if (payload.priceUpdateMode === 'percent_change') {
          nextSell = Math.max(0, Math.round(prod.pricePerMg * (1 + payload.sellingPriceValue / 100) * 10000) / 10000);
        } else {
          nextSell = Math.max(0, payload.sellingPriceValue);
        }
      }
      items.push({
        id: prod.id,
        label: prod.name,
        subLabel: `${prod.code} · ${prod.unit}`,
        eligible: true,
        previewBefore: `${prod.pricePerMg} ج.م`,
        previewAfter: `${nextSell} ج.م`,
      });
      } else if (payload.action === 'update_commission') {
      const normalizedCommMode =
        payload.commissionMode === 'product_rate'
          ? 'fixed_rate'
          : payload.commissionMode === 'product_fixed'
            ? 'fixed_per_unit'
            : payload.commissionMode;
      items.push({
        id: prod.id,
        label: prod.name,
        subLabel: prod.code,
        eligible: true,
        previewBefore: prod.isCommissionEligible ? prod.commissionMode : 'غير خاضع للعمولة',
        previewAfter:
          payload.isCommissionEligible === false
            ? 'غير خاضع للعمولة'
            : normalizedCommMode || prod.commissionMode,
      });
    }
  }

  const eligibleCount = items.filter((i) => i.eligible).length;
  const excludedCount = items.length - eligibleCount;
  if (excludedCount > 0) {
    warnings.push(`سيتم استبعاد ${excludedCount} منتج لا ينطبق عليه الإجراء مع توضيح السبب.`);
  }

  return {
    action: payload.action,
    totalSelected: items.length,
    eligibleCount,
    excludedCount,
    items,
    warnings,
  };
}

export async function executeBulkProductsAction(
  payload: BulkProductActionPayload,
  actor: User
): Promise<BulkExecuteResult> {
  const preview = await previewBulkProductsAction(payload, actor);
  const eligibleIds = new Set(preview.items.filter((i) => i.eligible).map((i) => i.id));
  if (eligibleIds.size === 0) {
    return {
      action: payload.action,
      executedCount: 0,
      skippedCount: preview.excludedCount,
      message: 'لا توجد منتجات مؤهلة لتنفيذ هذا الإجراء.',
    };
  }

  const categories = await getAllCategories();
  const targetCat = payload.targetCategoryId
    ? categories.find((c) => c.id === payload.targetCategoryId)
    : undefined;
  const nowIso = new Date().toISOString();

  await db.transaction(async (tx) => {
    const allRows = await tx.select().from(products);
    for (const row of allRows) {
      if (!eligibleIds.has(row.id)) continue;

      if (payload.action === 'archive') {
        await tx
          .update(products)
          .set({ isActive: false, updatedAt: nowIso })
          .where(eq(products.id, row.id));
      } else if (payload.action === 'unarchive') {
        await tx
          .update(products)
          .set({ isActive: true, updatedAt: nowIso })
          .where(eq(products.id, row.id));
      } else if (payload.action === 'delete') {
        await tx.delete(products).where(eq(products.id, row.id));
      } else if (payload.action === 'change_category' && targetCat) {
        await tx
          .update(products)
          .set({
            categoryId: targetCat.id,
            categoryName: targetCat.name,
            updatedAt: nowIso,
          })
          .where(eq(products.id, row.id));
      } else if (payload.action === 'update_pricing') {
        let nextSell = row.pricePerMg;
        if (typeof payload.sellingPriceValue === 'number' && Number.isFinite(payload.sellingPriceValue)) {
          if (payload.priceUpdateMode === 'percent_change') {
            nextSell = Math.max(
              0,
              Math.round(row.pricePerMg * (1 + payload.sellingPriceValue / 100) * 10000) / 10000
            );
          } else {
            nextSell = Math.max(0, payload.sellingPriceValue);
          }
        }
        const nextCost =
          payload.costPriceValue !== undefined ? payload.costPriceValue : row.costPrice;
        await tx
          .update(products)
          .set({
            pricePerMg: nextSell,
            costPrice: nextCost,
            updatedAt: nowIso,
          })
          .where(eq(products.id, row.id));
      } else if (payload.action === 'update_commission') {
        const normalizedCommMode =
          payload.commissionMode === 'product_rate'
            ? 'fixed_rate'
            : payload.commissionMode === 'product_fixed'
              ? 'fixed_per_unit'
              : payload.commissionMode;
        const eligible =
          typeof payload.isCommissionEligible === 'boolean'
            ? payload.isCommissionEligible
            : row.isCommissionEligible;
        const mode = eligible ? normalizedCommMode || row.commissionMode : 'none';
        await tx
          .update(products)
          .set({
            isCommissionEligible: eligible,
            commissionMode: mode,
            customCommissionRate:
              payload.customCommissionRate !== undefined
                ? payload.customCommissionRate
                : row.customCommissionRate,
            customCommissionFixed:
              payload.customCommissionFixed !== undefined
                ? payload.customCommissionFixed
                : row.customCommissionFixed,
            updatedAt: nowIso,
          })
          .where(eq(products.id, row.id));
      }
    }

    await writeBulkAuditLogTx(
      tx,
      `bulk_products_${payload.action}`,
      actor,
      {
        executedCount: eligibleIds.size,
        skippedCount: preview.excludedCount,
        targetCategoryId: payload.targetCategoryId ?? null,
        reason: payload.reason?.trim() || null,
        productIds: Array.from(eligibleIds).slice(0, 50),
      },
      nowIso
    );
  });

  return {
    action: payload.action,
    executedCount: eligibleIds.size,
    skippedCount: preview.excludedCount,
    message: `تم تنفيذ الإجراء على ${eligibleIds.size} منتج${
      preview.excludedCount > 0 ? ` (تم استبعاد ${preview.excludedCount})` : ''
    }.`,
  };
}

// =========================================================================
// 2. BULK INVENTORY STOCK OPERATIONS (STRICTLY SEPARATED SET vs ADD + UNIT CONVERSION + IDEMPOTENCY)
// =========================================================================

export interface BulkInventoryPayload {
  selectionMode?: 'ids' | 'all_matching_filters';
  productIds?: string[];
  filters?: BulkProductFilterCriteria;
  mode: 'set_stock' | 'add_stock';
  quantity: number;
  inputUnit?: string;
  reason: string;
  idempotencyKey?: string;
}

export async function previewBulkInventoryAction(
  payload: BulkInventoryPayload
): Promise<BulkPreviewResult> {
  if (!Number.isFinite(payload.quantity)) {
    throw new Error('يرجى إدخال كمية صالحة.');
  }
  if (payload.mode === 'set_stock' && payload.quantity < 0) {
    throw new Error('رصيد المخزون الجديد لا يمكن أن يكون بالسالب.');
  }
  if (payload.mode === 'add_stock' && payload.quantity <= 0) {
    throw new Error('الكمية المضافة للمخزون يجب أن تكون أكبر من الصفر.');
  }

  const selected = await resolveSelectedProducts(payload);
  const items: BulkPreviewItem[] = [];
  const warnings: string[] = [];

  for (const prod of selected) {
    const prodUnit = normalizeProductUnit(prod.unit);
    const inputUnit = payload.inputUnit ? normalizeProductUnit(payload.inputUnit) : prodUnit;
    const conv = convertQuantityBetweenUnits(payload.quantity, inputUnit, prodUnit);

    if (!conv.ok) {
      items.push({
        id: prod.id,
        label: prod.name,
        subLabel: `${prod.code} · وحدة الصنف: ${prodUnit}`,
        eligible: false,
        reason: 'reason' in conv ? conv.reason : 'الوحدة غير متوافقة للتحويل.',
      });
      continue;
    }

    const prevStock = Math.max(0, Number(prod.stock || 0));
    const nextStock =
      payload.mode === 'set_stock'
        ? roundStockNumber(conv.convertedQuantity)
        : roundStockNumber(prevStock + conv.convertedQuantity);

    if (nextStock < 0) {
      items.push({
        id: prod.id,
        label: prod.name,
        subLabel: `${prod.code} · ${prodUnit}`,
        eligible: false,
        reason: 'النتيجة تؤدي إلى رصيد سالب وهو غير مسموح.',
      });
      continue;
    }

    items.push({
      id: prod.id,
      label: prod.name,
      subLabel: `${prod.code} · ${conv.note}`,
      eligible: true,
      previewBefore: `${prevStock.toLocaleString()} ${prodUnit}`,
      previewAfter: `${nextStock.toLocaleString()} ${prodUnit}`,
    });
  }

  const eligibleCount = items.filter((i) => i.eligible).length;
  const excludedCount = items.length - eligibleCount;
  if (excludedCount > 0) {
    warnings.push(`تم استبعاد ${excludedCount} صنف لعدم توافق الوحدة المختارة (${payload.inputUnit}) مع وحدة المنتج.`);
  }

  return {
    action: payload.mode,
    totalSelected: items.length,
    eligibleCount,
    excludedCount,
    items,
    warnings,
  };
}

export async function executeBulkInventoryAction(
  payload: BulkInventoryPayload,
  actor: User
): Promise<BulkExecuteResult> {
  const cleanReason = (payload.reason || '').trim();
  if (cleanReason.length < 3) {
    throw new Error('يجب كتابة سبب واضح للتسوية أو الإضافة الجماعية (3 أحرف على الأقل).');
  }

  const cleanKey = payload.idempotencyKey?.trim() || null;
  if (cleanKey) {
    const existingMove = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.idempotencyKey, cleanKey))
      .limit(1);
    if (existingMove.length > 0) {
      return {
        action: payload.mode,
        executedCount: 0,
        skippedCount: 0,
        idempotentReplay: true,
        message: 'تم تنفيذ هذه العملية مسبقاً بنفس مفتاح عدم التكرار؛ لم يتم تعديل الرصيد مرة أخرى.',
      };
    }
  }

  const preview = await previewBulkInventoryAction(payload);
  const eligibleIds = new Set(preview.items.filter((i) => i.eligible).map((i) => i.id));
  if (eligibleIds.size === 0) {
    return {
      action: payload.mode,
      executedCount: 0,
      skippedCount: preview.excludedCount,
      message: 'لا توجد أصناف متوافقة لتنفيذ العملية المخزنية.',
    };
  }

  const nowIso = new Date().toISOString();
  let updatedCount = 0;

  await db.transaction(async (tx) => {
    const allProds = await tx.select().from(products);
    for (const row of allProds) {
      if (!eligibleIds.has(row.id)) continue;
      const prodUnit = normalizeProductUnit(row.unit);
      const inputUnit = payload.inputUnit ? normalizeProductUnit(payload.inputUnit) : prodUnit;
      const conv = convertQuantityBetweenUnits(payload.quantity, inputUnit, prodUnit);
      if (!conv.ok) continue;

      const prevStock = Math.max(0, Number(row.stock || 0));
      const nextStock =
        payload.mode === 'set_stock'
          ? roundStockNumber(conv.convertedQuantity)
          : roundStockNumber(prevStock + conv.convertedQuantity);
      const delta = roundStockNumber(nextStock - prevStock);

      await tx
        .update(products)
        .set({ stock: nextStock, updatedAt: nowIso })
        .where(eq(products.id, row.id));

      await tx.insert(stockMovements).values({
        id: `stk-${Date.now()}-${updatedCount}-${Math.floor(Math.random() * 10000)}`,
        productId: row.id,
        productName: row.name,
        grade: row.grade,
        unit: prodUnit,
        orderId: null,
        movementType: payload.mode === 'set_stock' ? 'bulk_set_stock' : 'bulk_add_stock',
        sourcingSource: 'من المخزون الحالي',
        quantityDelta: delta,
        orderQuantityCovered: 0,
        previousStock: prevStock,
        newStock: nextStock,
        supplierName: null,
        note: `${payload.mode === 'set_stock' ? 'تعيين رصيد جماعي' : 'إضافة رصيد جماعي'} (${conv.note}): ${cleanReason}`,
        idempotencyKey: cleanKey,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        createdAt: nowIso,
      });
      updatedCount += 1;
    }

    await writeBulkAuditLogTx(
      tx,
      `bulk_inventory_${payload.mode}`,
      actor,
      {
        mode: payload.mode,
        inputQuantity: payload.quantity,
        inputUnit: payload.inputUnit || null,
        reason: cleanReason,
        idempotencyKey: cleanKey,
        executedCount: updatedCount,
        skippedCount: preview.excludedCount,
      },
      nowIso
    );
  });

  return {
    action: payload.mode,
    executedCount: updatedCount,
    skippedCount: preview.excludedCount,
    message:
      payload.mode === 'set_stock'
        ? `تم تعيين الرصيد لـ ${updatedCount} صنف بنجاح.`
        : `تمت إضافة الكمية إلى ${updatedCount} صنف بنجاح.`,
  };
}

// =========================================================================
// 3. BULK CUSTOMERS ACTIONS
// =========================================================================

export interface BulkCustomersPayload {
  customerIds: string[];
  action: 'assign_sales_rep' | 'delete_unlinked';
  salesRepId?: string;
}

export async function previewBulkCustomersAction(
  payload: BulkCustomersPayload
): Promise<BulkPreviewResult> {
  const idSet = new Set((payload.customerIds || []).map(String));
  const [allCustomers, allOrders, allReps] = await Promise.all([
    db.select().from(customers),
    db.select({ id: orders.id, customerName: orders.customerName, customerPhone: orders.customerPhone }).from(orders),
    db.select().from(salesReps),
  ]);

  const targetRep = payload.salesRepId ? allReps.find((r) => r.id === payload.salesRepId) : undefined;
  if (payload.action === 'assign_sales_rep' && !targetRep) {
    throw new Error('يرجى تحديد مندوب المبيعات المستهدف.');
  }

  const selected = allCustomers.filter((c) => idSet.has(c.id));
  const items: BulkPreviewItem[] = [];

  for (const c of selected) {
    const cleanName = c.name.trim().toLowerCase();
    const cleanPhone = (c.phone || '').trim();
    const linkedOrdersCount = allOrders.filter(
      (o) =>
        o.customerName.trim().toLowerCase() === cleanName ||
        (Boolean(cleanPhone) && (o.customerPhone || '').trim() === cleanPhone)
    ).length;

    if (payload.action === 'delete_unlinked') {
      if (linkedOrdersCount > 0) {
        items.push({
          id: c.id,
          label: c.name,
          subLabel: c.phone || 'بدون هاتف',
          eligible: false,
          reason: `مرتبط بـ ${linkedOrdersCount} فاتورة تاريخية؛ لا يمكن حذفه لحماية السجلات.`,
        });
      } else {
        items.push({
          id: c.id,
          label: c.name,
          subLabel: c.phone || 'بدون هاتف',
          eligible: true,
          previewBefore: 'غير مرتبط بفواتير',
          previewAfter: 'حذف نهائي',
        });
      }
    } else if (payload.action === 'assign_sales_rep' && targetRep) {
      if (c.assignedSalesRepId === targetRep.id) {
        items.push({
          id: c.id,
          label: c.name,
          subLabel: c.phone || '',
          eligible: false,
          reason: `معيّن بالفعل للمندوب ${targetRep.name}.`,
        });
      } else {
        items.push({
          id: c.id,
          label: c.name,
          subLabel: c.phone || '',
          eligible: true,
          previewBefore: c.assignedSalesRepName || 'غير معيّن',
          previewAfter: targetRep.name,
        });
      }
    }
  }

  const eligibleCount = items.filter((i) => i.eligible).length;
  return {
    action: payload.action,
    totalSelected: items.length,
    eligibleCount,
    excludedCount: items.length - eligibleCount,
    items,
    warnings:
      items.length - eligibleCount > 0
        ? [`تم استبعاد ${items.length - eligibleCount} عميل لا ينطبق عليه الإجراء.`]
        : [],
  };
}

export async function executeBulkCustomersAction(
  payload: BulkCustomersPayload,
  actor: User
): Promise<BulkExecuteResult> {
  const preview = await previewBulkCustomersAction(payload);
  const eligibleIds = new Set(preview.items.filter((i) => i.eligible).map((i) => i.id));
  if (eligibleIds.size === 0) {
    return {
      action: payload.action,
      executedCount: 0,
      skippedCount: preview.excludedCount,
      message: 'لا يوجد عملاء مؤهلون لتنفيذ الإجراء.',
    };
  }

  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (payload.action === 'delete_unlinked') {
      for (const cid of eligibleIds) {
        await tx.delete(customers).where(eq(customers.id, cid));
      }
    } else if (payload.action === 'assign_sales_rep' && payload.salesRepId) {
      const repRows = await tx
        .select()
        .from(salesReps)
        .where(eq(salesReps.id, payload.salesRepId))
        .limit(1);
      const rep = repRows[0];
      if (!rep) throw new Error('مندوب المبيعات المحدد غير موجود.');
      for (const cid of eligibleIds) {
        await tx
          .update(customers)
          .set({ assignedSalesRepId: rep.id, assignedSalesRepName: rep.name })
          .where(eq(customers.id, cid));
      }
    }

    await writeBulkAuditLogTx(
      tx,
      `bulk_customers_${payload.action}`,
      actor,
      {
        executedCount: eligibleIds.size,
        skippedCount: preview.excludedCount,
        salesRepId: payload.salesRepId ?? null,
      },
      nowIso
    );
  });

  return {
    action: payload.action,
    executedCount: eligibleIds.size,
    skippedCount: preview.excludedCount,
    message: `تم تنفيذ الإجراء على ${eligibleIds.size} عميل.`,
  };
}

// =========================================================================
// 4. BULK ORDERS WORKFLOW-SAFE STATUS TRANSITIONS
// =========================================================================

export interface BulkOrdersStatusPayload {
  orderIds: string[];
  targetStatus: OrderStatus;
  options?: StatusTransitionOptions;
}

export async function previewBulkOrdersTransition(
  payload: BulkOrdersStatusPayload,
  actor: User
): Promise<BulkPreviewResult> {
  const idSet = new Set((payload.orderIds || []).map(String));
  const allOrders = await db.select().from(orders);
  const selected = allOrders.filter((o) => idSet.has(o.id));
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';
  const items: BulkPreviewItem[] = [];

  for (const o of selected) {
    const prevStatus = o.status as OrderStatus;
    const revStatus = normalizeRevisionStatus(o.revisionAlert?.status);
    let reason = '';

    if (prevStatus === payload.targetStatus) {
      reason = `الطلب في حالة "${payload.targetStatus}" بالفعل.`;
    } else if (!hasOrderBeenConfirmed(o) || prevStatus === 'بانتظار تأكيد العميل') {
      reason = 'بانتظار تأكيد العميل؛ يجب التأكيد أولاً.';
    } else if (!isAdmin && (prevStatus === 'تم التسليم' || prevStatus === 'ملغي')) {
      reason = 'لا يمكن تعديل طلب مغلق إلا للمدير العام.';
    } else if (o.holdInfo?.isHeld) {
      reason = 'الطلب معلق (Hold) ويجب فك التعليق أولاً.';
    } else if (
      payload.targetStatus === 'تم الشحن' &&
      (o.pendingEditRequest ||
        revStatus === 'تعديل جديد يحتاج المراجعة' ||
        revStatus === 'يحتاج إعادة تجهيز')
    ) {
      reason = 'يوجد تعديل أو إعادة تجهيز غير مكتملة تمنع الشحن.';
    } else if (
      (payload.targetStatus === 'تم التجهيز' || payload.targetStatus === 'تم الشحن') &&
      hasOrderPendingProcurement({ items: o.items })
    ) {
      reason = 'يحتوي على أصناف بانتظار التوفير (pendingQty > 0).';
    } else if (!(ALLOWED_OPERATIONAL_TRANSITIONS[prevStatus] || []).includes(payload.targetStatus)) {
      reason = `الانتقال من "${prevStatus}" إلى "${payload.targetStatus}" غير مسموح بتسلسل التشغيل.`;
    }

    items.push({
      id: o.id,
      label: `${o.id} — ${o.customerName}`,
      subLabel: `${o.totalAmount.toLocaleString()} ج.م`,
      eligible: !reason,
      reason: reason || undefined,
      previewBefore: prevStatus,
      previewAfter: reason ? undefined : payload.targetStatus,
    });
  }

  const eligibleCount = items.filter((i) => i.eligible).length;
  return {
    action: `transition:${payload.targetStatus}`,
    totalSelected: items.length,
    eligibleCount,
    excludedCount: items.length - eligibleCount,
    items,
    warnings:
      items.length - eligibleCount > 0
        ? [`سيتم تخطي ${items.length - eligibleCount} فاتورة غير مستوفية لشروط الانتقال التشغيلي.`]
        : [],
  };
}

export async function executeBulkOrdersTransition(
  payload: BulkOrdersStatusPayload,
  actor: User
): Promise<BulkExecuteResult> {
  const preview = await previewBulkOrdersTransition(payload, actor);
  const eligibleIds = preview.items.filter((i) => i.eligible).map((i) => i.id);
  let executedCount = 0;
  let skippedCount = preview.excludedCount;
  const errors: string[] = [];

  for (const oid of eligibleIds) {
    try {
      await updateOrderStatusRecord(oid, payload.targetStatus, actor, payload.options);
      executedCount += 1;
    } catch (err) {
      skippedCount += 1;
      errors.push(`${oid}: ${err instanceof Error ? err.message : 'تعذر التحديث'}`);
    }
  }

  return {
    action: `transition:${payload.targetStatus}`,
    executedCount,
    skippedCount,
    message: `تم تحديث حالة ${executedCount} فاتورة إلى "${payload.targetStatus}".`,
    details: errors.length > 0 ? { errors } : undefined,
  };
}
