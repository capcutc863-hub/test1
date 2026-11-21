import { desc } from 'drizzle-orm';
import { db, withDbRetry } from './index.ts';
import {
  customers,
  externalSourcingRecords,
  orders,
  products,
  salesReps,
  stockMovements,
} from './schema.ts';
import {
  getAllCategories,
  getGeneralSystemSettings,
  mapProductRow,
} from './catalogQueries.ts';
import {
  getVisibleCustomersForUser,
  hasOrderBeenConfirmed,
} from './queries.ts';
import {
  aggregateQuantitiesByUnit,
  formatUnitTotalsSummary,
  normalizeProductUnit,
  roundStockNumber,
} from '../lib/unit-conversion.ts';
import {
  addDaysYmd,
  CAIRO_TIMEZONE,
  formatCairoYmd,
  getMonthStartEndYmd,
  hasOrderPendingProcurement,
  isValidYmd,
} from '../lib/date-utils.ts';
import type {
  BiBusinessAlert,
  BiFilterParams,
  BiPeriodPreset,
  CostCoverageSummary,
  Customer,
  CustomerAnalyticsRow,
  CustomerRepeatFilter,
  ExternalSourcingRecord,
  InventoryValuationSummary,
  Order,
  OrderStatus,
  OwnerBiDashboardData,
  Product,
  ReorderRecommendationRow,
  SalesRepAnalyticsRow,
  UnifiedReportType,
  UnitQuantityTotal,
  User,
} from '../../types.ts';

function toCairoYmd(iso?: string | null): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatCairoYmd(d);
}

function diffYmdDays(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

export function resolveBiDateRange(
  preset: BiPeriodPreset = 'last_30_days',
  customFrom?: string,
  customTo?: string,
  referenceDate: Date = new Date()
): {
  preset: BiPeriodPreset;
  dateFrom?: string;
  dateTo?: string;
  priorDateFrom?: string;
  priorDateTo?: string;
  hasPriorComparison: boolean;
} {
  const todayYmd = formatCairoYmd(referenceDate);
  const [yStr, mStr] = todayYmd.split('-');
  const year = Number(yStr);
  const month = Number(mStr);

  let dateFrom: string | undefined;
  let dateTo: string | undefined;

  switch (preset) {
    case 'all':
      return { preset: 'all', hasPriorComparison: false };
    case 'today':
      dateFrom = todayYmd;
      dateTo = todayYmd;
      break;
    case 'yesterday': {
      const yest = addDaysYmd(todayYmd, -1);
      dateFrom = yest;
      dateTo = yest;
      break;
    }
    case 'this_week': {
      // Week starts Saturday or Monday in Egypt? Use rolling Saturday-to-today (Egypt business week) or 7 days
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: CAIRO_TIMEZONE,
        weekday: 'short',
      }).format(referenceDate);
      const dayMap: Record<string, number> = {
        Sat: 0,
        Sun: 1,
        Mon: 2,
        Tue: 3,
        Wed: 4,
        Thu: 5,
        Fri: 6,
      };
      const offset = dayMap[weekday] ?? 0;
      dateFrom = addDaysYmd(todayYmd, -offset);
      dateTo = todayYmd;
      break;
    }
    case 'this_month': {
      dateFrom = `${yStr}-${mStr}-01`;
      dateTo = todayYmd;
      break;
    }
    case 'previous_month': {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const { from, to } = getMonthStartEndYmd(prevYear, prevMonth);
      dateFrom = from;
      dateTo = to;
      break;
    }
    case 'last_30_days':
      dateFrom = addDaysYmd(todayYmd, -29);
      dateTo = todayYmd;
      break;
    case 'last_90_days':
      dateFrom = addDaysYmd(todayYmd, -89);
      dateTo = todayYmd;
      break;
    case 'this_year':
      dateFrom = `${yStr}-01-01`;
      dateTo = todayYmd;
      break;
    case 'custom': {
      const vf = isValidYmd(customFrom) ? customFrom : undefined;
      const vt = isValidYmd(customTo) ? customTo : undefined;
      if (vf && vt && vf > vt) {
        dateFrom = vt;
        dateTo = vf;
      } else {
        dateFrom = vf || vt;
        dateTo = vt || vf;
      }
      break;
    }
    default:
      dateFrom = addDaysYmd(todayYmd, -29);
      dateTo = todayYmd;
      break;
  }

  if (!dateFrom || !dateTo) {
    return { preset, dateFrom, dateTo, hasPriorComparison: false };
  }

  const spanDays = Math.max(1, diffYmdDays(dateFrom, dateTo) + 1);
  const priorDateTo = addDaysYmd(dateFrom, -1);
  const priorDateFrom = addDaysYmd(priorDateTo, -(spanDays - 1));
  return {
    preset,
    dateFrom,
    dateTo,
    priorDateFrom,
    priorDateTo,
    hasPriorComparison: true,
  };
}

function isInYmdRange(ymd: string, dateFrom?: string, dateTo?: string): boolean {
  if (!ymd) return false;
  if (dateFrom && ymd < dateFrom) return false;
  if (dateTo && ymd > dateTo) return false;
  return true;
}

function isRevenueCountingOrder(status: string): boolean {
  return (
    status !== 'بانتظار تأكيد العميل' &&
    status !== 'ملغي' &&
    status !== 'مرتجع' &&
    status !== 'رفض استلام'
  );
}

function normalizeCustomerKey(name?: string | null, phone?: string | null): string {
  const cleanPhone = (phone || '').replace(/\s+/g, '').trim();
  const cleanName = (name || '').trim().toLowerCase();
  if (cleanPhone) return `ph:${cleanPhone}`;
  return `nm:${cleanName}`;
}

function computeGrowthPct(current: number, prior: number): number | null {
  if (prior === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function buildProductLookup(productsList: Product[]) {
  const byId = new Map<string, Product>();
  const byCode = new Map<string, Product>();
  const byNameGrade = new Map<string, Product>();
  const byName = new Map<string, Product>();
  for (const p of productsList) {
    byId.set(p.id, p);
    if (p.code) byCode.set(p.code.trim().toLowerCase(), p);
    byNameGrade.set(`${p.name.trim().toLowerCase()}||${(p.grade || '').trim()}`, p);
    if (!byName.has(p.name.trim().toLowerCase())) {
      byName.set(p.name.trim().toLowerCase(), p);
    }
  }
  return {
    resolve(item: {
      productId?: string;
      productCode?: string;
      productName: string;
      grade?: string;
    }): Product | undefined {
      if (item.productId && byId.has(item.productId)) return byId.get(item.productId);
      if (item.productCode) {
        const c = byCode.get(item.productCode.trim().toLowerCase());
        if (c) return c;
      }
      const ng = byNameGrade.get(
        `${item.productName.trim().toLowerCase()}||${(item.grade || '').trim()}`
      );
      if (ng) return ng;
      return byName.get(item.productName.trim().toLowerCase());
    },
  };
}

function buildCustomerLookup(customersList: Customer[]) {
  const byPhone = new Map<string, Customer>();
  const byName = new Map<string, Customer>();
  for (const c of customersList) {
    const p = (c.phone || '').replace(/\s+/g, '').trim();
    if (p) byPhone.set(p, c);
    byName.set(c.name.trim().toLowerCase(), c);
  }
  return {
    resolve(name?: string | null, phone?: string | null): Customer | undefined {
      const p = (phone || '').replace(/\s+/g, '').trim();
      if (p && byPhone.has(p)) return byPhone.get(p);
      const n = (name || '').trim().toLowerCase();
      if (n && byName.has(n)) return byName.get(n);
      return undefined;
    },
  };
}

function getOrderNetDiscountFactor(order: {
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
}): number {
  if (order.subtotal <= 0) return 1;
  const factor = (order.subtotal - (order.discountAmount || 0)) / order.subtotal;
  return Math.max(0, Math.min(1, factor));
}

function doesItemMatchFilters(
  item: Order['items'][number],
  prod: Product | undefined,
  filters: BiFilterParams
): boolean {
  const catId = item.categoryId || prod?.categoryId || 'cat-other';
  if (filters.categoryId && filters.categoryId !== 'all' && catId !== filters.categoryId) {
    return false;
  }
  if (filters.productId && filters.productId !== 'all') {
    const matchesProd = prod?.id === filters.productId || item.productId === filters.productId;
    if (!matchesProd) return false;
  }
  if (filters.stockSource && filters.stockSource !== 'all') {
    const ware = Number(item.warehouseDeductedQty ?? 0);
    const ext = Number(item.externalSuppliedQty ?? 0);
    const pend = Number(item.pendingQty ?? 0);
    if (filters.stockSource === 'warehouse' && ware <= 0) return false;
    if (filters.stockSource === 'external' && ext <= 0) return false;
    if (filters.stockSource === 'pending' && pend <= 0) return false;
  }
  return true;
}

export async function getOwnerBiDashboardData(
  filters: BiFilterParams = {}
): Promise<OwnerBiDashboardData> {
  const [
    orderRows,
    productRows,
    customerRows,
    extRows,
    categories,
    generalSettings,
  ] = await withDbRetry(() =>
    Promise.all([
      db.select().from(orders).orderBy(desc(orders.createdAt)),
      db.select().from(products),
      db.select().from(customers),
      db.select().from(externalSourcingRecords),
      getAllCategories(),
      getGeneralSystemSettings(),
    ])
  );

  const productsCatalog = productRows.map(mapProductRow);
  const prodLookup = buildProductLookup(productsCatalog);
  const custList: Customer[] = customerRows.map((c) => ({
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
  }));
  const custLookup = buildCustomerLookup(custList);

  const preset: BiPeriodPreset = filters.preset || (filters.dateFrom || filters.dateTo ? 'custom' : 'last_30_days');
  const range = resolveBiDateRange(preset, filters.dateFrom, filters.dateTo);

  // Build external sourcing cost lookup by orderId + itemIndex
  const extRecordsByOrderItem = new Map<string, typeof extRows>();
  for (const r of extRows) {
    const key = `${r.orderId}::${r.itemIndex}`;
    const list = extRecordsByOrderItem.get(key) ?? [];
    list.push(r);
    extRecordsByOrderItem.set(key, list);
  }

  // Track customer first-ever revenue order date for accurate New vs Repeat buyers
  const firstOrderYmdByCustomer = new Map<string, string>();
  for (const o of orderRows) {
    if (!isRevenueCountingOrder(o.status)) continue;
    const ck = normalizeCustomerKey(o.customerName, o.customerPhone);
    const ymd = toCairoYmd(o.createdAt);
    if (!ymd) continue;
    const prevFirst = firstOrderYmdByCustomer.get(ck);
    if (!prevFirst || ymd < prevFirst) {
      firstOrderYmdByCustomer.set(ck, ymd);
    }
  }

  const filterNonDateOrder = (o: typeof orderRows[number]): boolean => {
    if (filters.salesRepId && filters.salesRepId !== 'all' && o.salesRepId !== filters.salesRepId) {
      return false;
    }
    if (filters.status && filters.status !== 'all' && filters.status !== 'الكل' && o.status !== filters.status) {
      return false;
    }
    if (filters.customerClassification && filters.customerClassification !== 'all') {
      const matchedCust = custLookup.resolve(o.customerName, o.customerPhone);
      const cls = matchedCust?.classification || 'عادي';
      if (cls !== filters.customerClassification) return false;
    }
    const hasItemConstraint =
      (filters.categoryId && filters.categoryId !== 'all') ||
      (filters.productId && filters.productId !== 'all') ||
      (filters.stockSource && filters.stockSource !== 'all');
    if (hasItemConstraint) {
      const anyMatch = (o.items || []).some((it) =>
        doesItemMatchFilters(it, prodLookup.resolve(it), filters)
      );
      if (!anyMatch) return false;
    }
    return true;
  };

  const hasItemScopedFilter =
    (filters.categoryId && filters.categoryId !== 'all') ||
    (filters.productId && filters.productId !== 'all') ||
    (filters.stockSource && filters.stockSource !== 'all');

  const computeAttributedOrderRevenue = (o: typeof orderRows[number]): number => {
    if (!hasItemScopedFilter) return o.totalAmount;
    const discFactor = getOrderNetDiscountFactor(o);
    let sum = 0;
    for (const it of o.items || []) {
      const prod = prodLookup.resolve(it);
      if (doesItemMatchFilters(it, prod, filters)) {
        sum += Number(it.quantity) * Number(it.price) * discFactor;
      }
    }
    return Math.round(sum * 100) / 100;
  };

  const scopedOrders = orderRows.filter((o) => {
    if (!filterNonDateOrder(o)) return false;
    if (!range.dateFrom && !range.dateTo) return true;
    const ymd = toCairoYmd(o.createdAt);
    return isInYmdRange(ymd, range.dateFrom, range.dateTo);
  });

  const priorOrders =
    range.hasPriorComparison && range.priorDateFrom && range.priorDateTo
      ? orderRows.filter((o) => {
          if (!filterNonDateOrder(o)) return false;
          const ymd = toCairoYmd(o.createdAt);
          return isInYmdRange(ymd, range.priorDateFrom, range.priorDateTo);
        })
      : [];

  // Core KPIs on current period
  let totalRevenue = 0;
  let deliveredRevenue = 0;
  let ordersCount = 0;
  let deliveredOrdersCount = 0;
  let cancelledOrdersCount = 0;
  let returnedOrdersCount = 0;
  let earnedCommission = 0;
  let pendingCommission = 0;

  const uniqueBuyerKeys = new Set<string>();
  const repeatBuyerKeys = new Set<string>();
  const newBuyerKeys = new Set<string>();
  const soldUnitEntries: Array<{ unit: string; quantity: number }> = [];
  const warehouseUnitEntries: Array<{ unit: string; quantity: number }> = [];
  const externalUnitEntries: Array<{ unit: string; quantity: number }> = [];
  const pendingUnitEntries: Array<{ unit: string; quantity: number }> = [];
  let pendingItemsCount = 0;
  let pendingOrdersCount = 0;

  // Cost & profit accumulators
  let revenueWithKnownCost = 0;
  let knownCatalogCost = 0;
  let knownExternalSourcingCost = 0;
  let missingCostItemsCount = 0;
  let totalCostEvaluatedItems = 0;

  // Breakdown maps
  const statusMap = new Map<OrderStatus, { count: number; revenue: number }>();
  const categoryMap = new Map<
    string,
    {
      categoryId: string;
      categoryName: string;
      orderIds: Set<string>;
      revenue: number;
      unitEntries: Array<{ unit: string; quantity: number }>;
    }
  >();
  const productPerfMap = new Map<
    string,
    {
      productId: string;
      productCode: string;
      productName: string;
      categoryName: string;
      unit: string;
      orderIds: Set<string>;
      quantitySold: number;
      revenue: number;
      currentStock: number;
      pendingSourcingQty: number;
      externalSuppliedQty: number;
    }
  >();
  const timeSeriesMap = new Map<
    string,
    { bucket: string; label: string; revenue: number; deliveredRevenue: number; ordersCount: number }
  >();

  const spanDays =
    range.dateFrom && range.dateTo ? Math.max(1, diffYmdDays(range.dateFrom, range.dateTo) + 1) : 90;
  const useMonthlyBuckets = spanDays > 62;

  for (const o of scopedOrders) {
    const rev = computeAttributedOrderRevenue(o);
    const status = o.status as OrderStatus;
    const stEntry = statusMap.get(status) ?? { count: 0, revenue: 0 };
    stEntry.count += 1;
    stEntry.revenue = Math.round((stEntry.revenue + rev) * 100) / 100;
    statusMap.set(status, stEntry);

    if (status === 'ملغي') {
      cancelledOrdersCount += 1;
      continue;
    }
    if (status === 'مرتجع' || status === 'رفض استلام') {
      returnedOrdersCount += 1;
      continue;
    }
    if (status === 'بانتظار تأكيد العميل') {
      continue;
    }

    // Revenue-counting confirmed order
    ordersCount += 1;
    totalRevenue += rev;
    if (status === 'تم التسليم') {
      deliveredOrdersCount += 1;
      deliveredRevenue += rev;
      earnedCommission += o.commission;
    } else {
      pendingCommission += o.commission;
    }

    const ymd = toCairoYmd(o.createdAt);
    if (ymd) {
      const bucket = useMonthlyBuckets ? ymd.slice(0, 7) : ymd;
      const ts = timeSeriesMap.get(bucket) ?? {
        bucket,
        label: bucket,
        revenue: 0,
        deliveredRevenue: 0,
        ordersCount: 0,
      };
      ts.revenue = Math.round((ts.revenue + rev) * 100) / 100;
      if (status === 'تم التسليم') {
        ts.deliveredRevenue = Math.round((ts.deliveredRevenue + rev) * 100) / 100;
      }
      ts.ordersCount += 1;
      timeSeriesMap.set(bucket, ts);
    }

    const ck = normalizeCustomerKey(o.customerName, o.customerPhone);
    uniqueBuyerKeys.add(ck);
    const firstYmd = firstOrderYmdByCustomer.get(ck);
    if (firstYmd && (!range.dateFrom || firstYmd >= range.dateFrom)) {
      newBuyerKeys.add(ck);
    } else {
      repeatBuyerKeys.add(ck);
    }

    const discFactor = getOrderNetDiscountFactor(o);
    let orderHasPending = false;

    for (let idx = 0; idx < (o.items || []).length; idx++) {
      const item = o.items[idx];
      const prod = prodLookup.resolve(item);
      if (hasItemScopedFilter && !doesItemMatchFilters(item, prod, filters)) {
        continue;
      }

      const qty = Math.max(0, Number(item.quantity || 0));
      const unit = normalizeProductUnit(item.unit || prod?.unit || 'قطعة');
      const lineRev = Math.round(qty * Number(item.price || 0) * discFactor * 100) / 100;

      soldUnitEntries.push({ unit, quantity: qty });

      const wareQty =
        typeof item.warehouseDeductedQty === 'number'
          ? Math.max(0, item.warehouseDeductedQty)
          : prod
            ? qty
            : 0;
      const extQty = Math.max(0, Number(item.externalSuppliedQty ?? 0));
      const pendQty =
        typeof item.pendingQty === 'number'
          ? Math.max(0, item.pendingQty)
          : Math.max(0, qty - wareQty - extQty);

      if (wareQty > 0) warehouseUnitEntries.push({ unit, quantity: wareQty });
      if (extQty > 0) externalUnitEntries.push({ unit, quantity: extQty });
      if (pendQty > 0) {
        pendingUnitEntries.push({ unit, quantity: pendQty });
        pendingItemsCount += 1;
        orderHasPending = true;
      }

      // Cost evaluation (strictly NEVER treat null cost as 0)
      totalCostEvaluatedItems += 1;
      let itemCostComplete = true;
      let itemCatalogCost = 0;
      let itemExternalCost = 0;

      if (pendQty > 0) {
        itemCostComplete = false;
      }
      if (wareQty > 0) {
        if (prod && typeof prod.costPrice === 'number' && Number.isFinite(prod.costPrice)) {
          itemCatalogCost += wareQty * prod.costPrice;
        } else {
          itemCostComplete = false;
        }
      }
      if (extQty > 0) {
        const linkedExtRecs = extRecordsByOrderItem.get(`${o.id}::${idx}`) ?? [];
        const knownRecs = linkedExtRecs.filter(
          (r) => typeof r.totalSourcingCost === 'number' || typeof r.unitCost === 'number'
        );
        if (knownRecs.length > 0) {
          for (const rec of knownRecs) {
            if (typeof rec.totalSourcingCost === 'number') {
              itemExternalCost += rec.totalSourcingCost;
            } else if (typeof rec.unitCost === 'number') {
              itemExternalCost += rec.unitCost * rec.externalQty;
            }
          }
        } else if (typeof item.externalTotalCost === 'number') {
          itemExternalCost += item.externalTotalCost;
        } else if (typeof item.externalUnitCost === 'number') {
          itemExternalCost += item.externalUnitCost * extQty;
        } else {
          itemCostComplete = false;
        }
      }

      if (itemCostComplete) {
        revenueWithKnownCost += lineRev;
        knownCatalogCost += itemCatalogCost;
        knownExternalSourcingCost += itemExternalCost;
      } else {
        missingCostItemsCount += 1;
      }

      // Category aggregation (unit-safe!)
      const catId = item.categoryId || prod?.categoryId || 'cat-other';
      const matchedCat = categories.find((c) => c.id === catId);
      const catName = item.categoryName || matchedCat?.name || prod?.categoryName || 'أخرى';
      const catEntry = categoryMap.get(catId) ?? {
        categoryId: catId,
        categoryName: catName,
        orderIds: new Set<string>(),
        revenue: 0,
        unitEntries: [],
      };
      catEntry.orderIds.add(o.id);
      catEntry.revenue = Math.round((catEntry.revenue + lineRev) * 100) / 100;
      catEntry.unitEntries.push({ unit, quantity: qty });
      categoryMap.set(catId, catEntry);

      // Top products aggregation
      const prodKey = prod?.id || `name:${item.productName.trim().toLowerCase()}:${unit}`;
      const pEntry = productPerfMap.get(prodKey) ?? {
        productId: prod?.id || prodKey,
        productCode: prod?.code || item.productCode || '-',
        productName: prod?.name || item.productName,
        categoryName: catName,
        unit,
        orderIds: new Set<string>(),
        quantitySold: 0,
        revenue: 0,
        currentStock: prod?.stock ?? 0,
        pendingSourcingQty: 0,
        externalSuppliedQty: 0,
      };
      pEntry.orderIds.add(o.id);
      pEntry.quantitySold = roundStockNumber(pEntry.quantitySold + qty);
      pEntry.revenue = Math.round((pEntry.revenue + lineRev) * 100) / 100;
      pEntry.pendingSourcingQty = roundStockNumber(pEntry.pendingSourcingQty + pendQty);
      pEntry.externalSuppliedQty = roundStockNumber(pEntry.externalSuppliedQty + extQty);
      productPerfMap.set(prodKey, pEntry);
    }

    if (orderHasPending) pendingOrdersCount += 1;
  }

  // Prior period metrics for growth calculation
  let priorRevenue = 0;
  let priorOrdersCount = 0;
  const priorBuyers = new Set<string>();
  for (const po of priorOrders) {
    if (!isRevenueCountingOrder(po.status)) continue;
    priorOrdersCount += 1;
    priorRevenue += computeAttributedOrderRevenue(po);
    priorBuyers.add(normalizeCustomerKey(po.customerName, po.customerPhone));
  }

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  deliveredRevenue = Math.round(deliveredRevenue * 100) / 100;
  const averageOrderValue = ordersCount > 0 ? Math.round((totalRevenue / ordersCount) * 100) / 100 : 0;
  const priorAov = priorOrdersCount > 0 ? priorRevenue / priorOrdersCount : 0;

  // Profit Summary (Cost-gated)
  revenueWithKnownCost = Math.round(revenueWithKnownCost * 100) / 100;
  knownCatalogCost = Math.round(knownCatalogCost * 100) / 100;
  knownExternalSourcingCost = Math.round(knownExternalSourcingCost * 100) / 100;
  const knownTotalCost = Math.round((knownCatalogCost + knownExternalSourcingCost) * 100) / 100;
  const coverageRatio =
    totalRevenue > 0 ? Math.min(1, Math.round((revenueWithKnownCost / totalRevenue) * 1000) / 1000) : 0;

  let profitStatus: CostCoverageSummary['status'] = 'unavailable';
  let grossProfit: number | null = null;
  let partialGrossProfit: number | null = null;
  let marginPercentage: number | null = null;
  let profitNoteAr = 'لا توجد مبيعات مسعّرة التكلفة في هذه الفترة لعرض الربح الحقيقي.';

  if (totalCostEvaluatedItems > 0 && revenueWithKnownCost > 0) {
    if (missingCostItemsCount === 0) {
      profitStatus = 'complete';
      grossProfit = Math.round((totalRevenue - knownTotalCost) * 100) / 100;
      partialGrossProfit = grossProfit;
      marginPercentage =
        totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : null;
      profitNoteAr = 'جميع البنود المباعة مسجلة التكلفة (تغطية 100%).';
    } else {
      profitStatus = 'partial';
      grossProfit = null;
      partialGrossProfit = Math.round((revenueWithKnownCost - knownTotalCost) * 100) / 100;
      marginPercentage = Math.round((partialGrossProfit / revenueWithKnownCost) * 1000) / 10;
      profitNoteAr = `تم حجب صافي الربح الإجمالي لوجود ${missingCostItemsCount} بند بدون تكلفة مسجلة (تغطية التكلفة ${Math.round(coverageRatio * 100)}%).`;
    }
  }

  // Inventory Valuation Summary (Cost-gated)
  const activeProducts = productsCatalog.filter((p) => {
    if (!p.isActive) return false;
    if (filters.categoryId && filters.categoryId !== 'all' && p.categoryId !== filters.categoryId) {
      return false;
    }
    if (filters.productId && filters.productId !== 'all' && p.id !== filters.productId) {
      return false;
    }
    return true;
  });
  const stockedProducts = activeProducts.filter((p) => p.stock > 0);
  const valuedStockedProducts = stockedProducts.filter(
    (p) => typeof p.costPrice === 'number' && Number.isFinite(p.costPrice) && p.costPrice >= 0
  );
  const missingCostStockedProductsCount = stockedProducts.length - valuedStockedProducts.length;
  const partialKnownStockValue = Math.round(
    valuedStockedProducts.reduce((sum, p) => sum + p.stock * (p.costPrice as number), 0) * 100
  ) / 100;
  const invCoverageRatio =
    stockedProducts.length > 0
      ? Math.round((valuedStockedProducts.length / stockedProducts.length) * 1000) / 1000
      : 0;

  let invStatus: InventoryValuationSummary['status'] = 'unavailable';
  let totalStockValue: number | null = null;
  let invNoteAr = 'لا توجد أصناف برصيد مخزني مسعّر التكلفة حالياً.';

  if (stockedProducts.length > 0 && valuedStockedProducts.length > 0) {
    if (missingCostStockedProductsCount === 0) {
      invStatus = 'complete';
      totalStockValue = partialKnownStockValue;
      invNoteAr = 'تقييم كامل لكافة الأرصدة المخزنية ذات التكلفة المسجلة.';
    } else {
      invStatus = 'partial';
      totalStockValue = null;
      invNoteAr = `تقييم جزئي فقط: يوجد ${missingCostStockedProductsCount} صنف برصيد مخزني بدون سعر تكلفة.`;
    }
  }

  const inventoryValuation: InventoryValuationSummary = {
    status: invStatus,
    totalActiveProducts: activeProducts.length,
    productsWithStock: stockedProducts.length,
    valuedProductsCount: valuedStockedProducts.length,
    missingCostStockedProductsCount,
    totalStockValue,
    partialKnownStockValue,
    coverageRatio: invCoverageRatio,
    unitsBreakdown: aggregateQuantitiesByUnit(
      activeProducts.map((p) => ({ unit: p.unit, quantity: p.stock }))
    ),
    noteAr: invNoteAr,
  };

  // External sourcing summary across period
  const scopedExtRecords = extRows.filter((r) => {
    if (filters.categoryId && filters.categoryId !== 'all' && r.categoryId !== filters.categoryId) {
      return false;
    }
    if (filters.productId && filters.productId !== 'all' && r.productId !== filters.productId) {
      return false;
    }
    if (range.dateFrom || range.dateTo) {
      return isInYmdRange(r.dateSecured, range.dateFrom, range.dateTo);
    }
    return true;
  });
  let knownExternalCostTotal = 0;
  let missingCostExternalRecordsCount = 0;
  for (const r of scopedExtRecords) {
    if (typeof r.totalSourcingCost === 'number') {
      knownExternalCostTotal += r.totalSourcingCost;
    } else if (typeof r.unitCost === 'number') {
      knownExternalCostTotal += r.unitCost * r.externalQty;
    } else {
      missingCostExternalRecordsCount += 1;
    }
  }

  const topLimit = Math.min(100, Math.max(5, Number(filters.topLimit || 10)));
  const topProducts = Array.from(productPerfMap.values())
    .map((p) => {
      const stockingOpportunity =
        (p.currentStock <= 0 && p.orderIds.size >= 1) ||
        p.externalSuppliedQty > 0 ||
        p.pendingSourcingQty > 0;
      let reason: string | undefined;
      if (p.pendingSourcingQty > 0) {
        reason = 'كميات بانتظار التوفير في الطلبات الحالية';
      } else if (p.externalSuppliedQty > 0) {
        reason = 'تم الاعتماد على التوفير الخارجي لتغطية الطلب';
      } else if (p.currentStock <= 0) {
        reason = 'نفاد الرصيد المخزني مع استمرار الطلب';
      }
      return {
        productId: p.productId,
        productCode: p.productCode,
        productName: p.productName,
        categoryName: p.categoryName,
        unit: p.unit,
        ordersCount: p.orderIds.size,
        quantitySold: p.quantitySold,
        revenue: p.revenue,
        currentStock: p.currentStock,
        pendingSourcingQty: p.pendingSourcingQty,
        externalSuppliedQty: p.externalSuppliedQty,
        stockingOpportunity,
        stockingOpportunityReason: reason,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topLimit);

  const statusTotalCount = scopedOrders.length || 1;
  const statusBreakdown = Array.from(statusMap.entries())
    .map(([status, v]) => ({
      status,
      count: v.count,
      revenue: v.revenue,
      sharePct: Math.round((v.count / statusTotalCount) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  const categoryBreakdown = Array.from(categoryMap.values())
    .map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      ordersCount: c.orderIds.size,
      revenue: c.revenue,
      sharePct: totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 1000) / 10 : 0,
      unitsByUnit: aggregateQuantitiesByUnit(c.unitEntries),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Transparent rule-based Business Alerts
  const alerts: BiBusinessAlert[] = [];
  if (pendingOrdersCount > 0) {
    alerts.push({
      id: 'pending-procurement',
      severity: 'critical',
      title: 'طلبات بانتظار توفير الأصناف',
      message: `يوجد ${pendingOrdersCount} طلب (${pendingItemsCount} بند) بانتظار التوفير من المورد أو المخزن (${formatUnitTotalsSummary(aggregateQuantitiesByUnit(pendingUnitEntries))}).`,
      metric: `${pendingOrdersCount} طلب`,
      ruleExplanation: 'تُحسب عندما يحتوي طلب مؤكد غير ملغي وغير مسلم على بنود ذات pendingQty > 0.',
    });
  }

  const missingCostProductsCount = activeProducts.filter((p) => p.costPrice == null).length;
  if (missingCostProductsCount > 0) {
    alerts.push({
      id: 'missing-cost-prices',
      severity: 'warning',
      title: 'أصناف بدون سعر تكلفة مسجل',
      message: `${missingCostProductsCount} صنف نشط غير مسجل له سعر تكلفة؛ لذا يتم حجب التقييم الإجمالي أو هامش الربح الكامل لحين استكمالها.`,
      metric: `${missingCostProductsCount} صنف`,
      ruleExplanation: 'سياسة الدقة المالية تمنع احتساب تكلفة الصنف غير المسعّر كصفر.',
    });
  }

  const lowStockCritical = activeProducts.filter((p) => {
    const threshold =
      p.categoryId === 'cat-oils'
        ? generalSettings.lowStockThresholdOils
        : generalSettings.lowStockThresholdOther;
    return p.stock > 0 && p.stock <= threshold;
  });
  if (lowStockCritical.length > 0) {
    alerts.push({
      id: 'low-stock-threshold',
      severity: 'warning',
      title: 'أصناف اقتربت من حد التنبيه المخزني',
      message: `${lowStockCritical.length} صنف نشط وصل إلى حد المخزون المنخفض المحدد في إعدادات النظام.`,
      metric: `${lowStockCritical.length} صنف`,
      ruleExplanation: `الحد المضبوط: ${generalSettings.lowStockThresholdOils.toLocaleString()} للزيوت و ${generalSettings.lowStockThresholdOther.toLocaleString()} لباقي التصنيفات.`,
    });
  }

  const stockingOppCount = topProducts.filter((p) => p.stockingOpportunity).length;
  if (stockingOppCount > 0) {
    alerts.push({
      id: 'stocking-opportunity',
      severity: 'opportunity',
      title: 'فرص تخزين لأصناف عالية الطلب',
      message: `${stockingOppCount} من أكثر المنتجات مبيعاً نفد مخزونها أو اعتمدت على توفير خارجي مؤخراً.`,
      metric: `${stockingOppCount} منتج`,
      ruleExplanation: 'تُكتشف عند تقاطع الطلب المؤكد مع نفاد المخزون أو تكرار التوفير الخارجي.',
    });
  }

  const denomReturnCancel = ordersCount + cancelledOrdersCount + returnedOrdersCount;
  if (denomReturnCancel >= 5) {
    const badRate = ((cancelledOrdersCount + returnedOrdersCount) / denomReturnCancel) * 100;
    if (badRate >= 15) {
      alerts.push({
        id: 'high-return-cancel-rate',
        severity: 'warning',
        title: 'ارتفاع نسبة المرتجعات والإلغاءات',
        message: `تمثل الفواتير الملغاة والمرتجعة ${Math.round(badRate * 10) / 10}% من إجمالي الفواتير المؤكدة في الفترة.`,
        metric: `${Math.round(badRate)}%`,
        ruleExplanation: 'تُفعّل عند تجاوز (ملغي + مرتجع + رفض استلام) نسبة 15% من الطلبات غير المسودة.',
      });
    }
  }

  return {
    appliedRange: {
      preset: range.preset,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      priorDateFrom: range.priorDateFrom,
      priorDateTo: range.priorDateTo,
      hasPriorComparison: range.hasPriorComparison,
    },
    kpis: {
      totalRevenue,
      deliveredRevenue,
      ordersCount,
      deliveredOrdersCount,
      cancelledOrdersCount,
      returnedOrdersCount,
      averageOrderValue,
      uniqueBuyersCount: uniqueBuyerKeys.size,
      newBuyersCount: newBuyerKeys.size,
      repeatBuyersCount: repeatBuyerKeys.size,
      earnedCommission: Math.round(earnedCommission * 100) / 100,
      pendingCommission: Math.round(pendingCommission * 100) / 100,
      unitsSoldByUnit: aggregateQuantitiesByUnit(soldUnitEntries),
      growth: {
        revenuePct: range.hasPriorComparison ? computeGrowthPct(totalRevenue, priorRevenue) : null,
        ordersPct: range.hasPriorComparison ? computeGrowthPct(ordersCount, priorOrdersCount) : null,
        aovPct: range.hasPriorComparison ? computeGrowthPct(averageOrderValue, priorAov) : null,
        uniqueBuyersPct: range.hasPriorComparison
          ? computeGrowthPct(uniqueBuyerKeys.size, priorBuyers.size)
          : null,
      },
    },
    profitSummary: {
      status: profitStatus,
      totalRevenue,
      revenueWithKnownCost,
      coverageRatio,
      knownCatalogCost,
      knownExternalSourcingCost,
      knownTotalCost,
      grossProfit,
      partialGrossProfit,
      marginPercentage,
      missingCostItemsCount,
      totalItemsCount: totalCostEvaluatedItems,
      noteAr: profitNoteAr,
    },
    inventoryValuation,
    revenueTimeSeries: Array.from(timeSeriesMap.values()).sort((a, b) =>
      a.bucket.localeCompare(b.bucket)
    ),
    statusBreakdown,
    categoryBreakdown,
    topProducts,
    sourcingSummary: {
      warehouseUnitsByUnit: aggregateQuantitiesByUnit(warehouseUnitEntries),
      externalUnitsByUnit: aggregateQuantitiesByUnit(externalUnitEntries),
      pendingUnitsByUnit: aggregateQuantitiesByUnit(pendingUnitEntries),
      pendingItemsCount,
      pendingOrdersCount,
      knownExternalCostTotal: Math.round(knownExternalCostTotal * 100) / 100,
      externalRecordsCount: scopedExtRecords.length,
      missingCostExternalRecordsCount,
    },
    alerts,
  };
}

export async function getSalesRepAnalytics(
  filters: BiFilterParams = {}
): Promise<{
  appliedRange: OwnerBiDashboardData['appliedRange'];
  reps: SalesRepAnalyticsRow[];
}> {
  const [orderRows, repRows, productRows, categories] = await withDbRetry(() =>
    Promise.all([
      db.select().from(orders).orderBy(desc(orders.createdAt)),
      db.select().from(salesReps),
      db.select().from(products),
      getAllCategories(),
    ])
  );

  const prodLookup = buildProductLookup(productRows.map(mapProductRow));
  const preset: BiPeriodPreset = filters.preset || (filters.dateFrom || filters.dateTo ? 'custom' : 'all');
  const range = resolveBiDateRange(preset, filters.dateFrom, filters.dateTo);

  const repMap = new Map<
    string,
    {
      salesRepId: string;
      salesRepName: string;
      ordersCount: number;
      deliveredOrdersCount: number;
      cancelledOrReturnedCount: number;
      totalRevenue: number;
      deliveredRevenue: number;
      uniqueCustomers: Set<string>;
      customerOrderCounts: Map<string, number>;
      earnedCommission: number;
      pendingCommission: number;
      baseCommissionRate: number;
      categoryRates: Record<string, number>;
      unitEntries: Array<{ unit: string; quantity: number }>;
      catMap: Map<
        string,
        {
          categoryId: string;
          categoryName: string;
          revenue: number;
          unitEntries: Array<{ unit: string; quantity: number }>;
        }
      >;
    }
  >();

  for (const r of repRows) {
    if (filters.salesRepId && filters.salesRepId !== 'all' && r.id !== filters.salesRepId) continue;
    repMap.set(r.id, {
      salesRepId: r.id,
      salesRepName: r.name,
      ordersCount: 0,
      deliveredOrdersCount: 0,
      cancelledOrReturnedCount: 0,
      totalRevenue: 0,
      deliveredRevenue: 0,
      uniqueCustomers: new Set(),
      customerOrderCounts: new Map(),
      earnedCommission: 0,
      pendingCommission: 0,
      baseCommissionRate: r.customCommissionRate,
      categoryRates: r.categoryRates ?? {},
      unitEntries: [],
      catMap: new Map(),
    });
  }

  for (const o of orderRows) {
    if (filters.salesRepId && filters.salesRepId !== 'all' && o.salesRepId !== filters.salesRepId) {
      continue;
    }
    if (range.dateFrom || range.dateTo) {
      if (!isInYmdRange(toCairoYmd(o.createdAt), range.dateFrom, range.dateTo)) continue;
    }
    let entry = repMap.get(o.salesRepId);
    if (!entry) {
      entry = {
        salesRepId: o.salesRepId,
        salesRepName: o.salesRepName,
        ordersCount: 0,
        deliveredOrdersCount: 0,
        cancelledOrReturnedCount: 0,
        totalRevenue: 0,
        deliveredRevenue: 0,
        uniqueCustomers: new Set(),
        customerOrderCounts: new Map(),
        earnedCommission: 0,
        pendingCommission: 0,
        baseCommissionRate: 0.05,
        categoryRates: {},
        unitEntries: [],
        catMap: new Map(),
      };
      repMap.set(o.salesRepId, entry);
    }

    if (o.status === 'ملغي' || o.status === 'مرتجع' || o.status === 'رفض استلام') {
      entry.cancelledOrReturnedCount += 1;
      continue;
    }
    if (o.status === 'بانتظار تأكيد العميل') continue;

    entry.ordersCount += 1;
    entry.totalRevenue += o.totalAmount;
    if (o.status === 'تم التسليم') {
      entry.deliveredOrdersCount += 1;
      entry.deliveredRevenue += o.totalAmount;
      entry.earnedCommission += o.commission;
    } else {
      entry.pendingCommission += o.commission;
    }

    const ck = normalizeCustomerKey(o.customerName, o.customerPhone);
    entry.uniqueCustomers.add(ck);
    entry.customerOrderCounts.set(ck, (entry.customerOrderCounts.get(ck) ?? 0) + 1);

    const discFactor = getOrderNetDiscountFactor(o);
    for (const item of o.items || []) {
      const prod = prodLookup.resolve(item);
      const unit = normalizeProductUnit(item.unit || prod?.unit || 'قطعة');
      const qty = Math.max(0, Number(item.quantity || 0));
      const lineRev = qty * Number(item.price || 0) * discFactor;
      entry.unitEntries.push({ unit, quantity: qty });

      const catId = item.categoryId || prod?.categoryId || 'cat-other';
      const catName =
        item.categoryName ||
        categories.find((c) => c.id === catId)?.name ||
        prod?.categoryName ||
        'أخرى';
      const catEntry = entry.catMap.get(catId) ?? {
        categoryId: catId,
        categoryName: catName,
        revenue: 0,
        unitEntries: [],
      };
      catEntry.revenue = Math.round((catEntry.revenue + lineRev) * 100) / 100;
      catEntry.unitEntries.push({ unit, quantity: qty });
      entry.catMap.set(catId, catEntry);
    }
  }

  const reps: SalesRepAnalyticsRow[] = Array.from(repMap.values())
    .map((e) => {
      let repeatCount = 0;
      for (const cnt of e.customerOrderCounts.values()) {
        if (cnt >= 2) repeatCount += 1;
      }
      return {
        salesRepId: e.salesRepId,
        salesRepName: e.salesRepName,
        ordersCount: e.ordersCount,
        deliveredOrdersCount: e.deliveredOrdersCount,
        cancelledOrReturnedCount: e.cancelledOrReturnedCount,
        totalRevenue: Math.round(e.totalRevenue * 100) / 100,
        deliveredRevenue: Math.round(e.deliveredRevenue * 100) / 100,
        averageOrderValue:
          e.ordersCount > 0 ? Math.round((e.totalRevenue / e.ordersCount) * 100) / 100 : 0,
        uniqueCustomersCount: e.uniqueCustomers.size,
        repeatCustomersCount: repeatCount,
        earnedCommission: Math.round(e.earnedCommission * 100) / 100,
        pendingCommission: Math.round(e.pendingCommission * 100) / 100,
        baseCommissionRate: e.baseCommissionRate,
        categoryRates: e.categoryRates,
        unitsByUnit: aggregateQuantitiesByUnit(e.unitEntries),
        categoryBreakdown: Array.from(e.catMap.values())
          .map((c) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
            revenue: c.revenue,
            unitsByUnit: aggregateQuantitiesByUnit(c.unitEntries),
          }))
          .sort((a, b) => b.revenue - a.revenue),
      };
    })
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    appliedRange: {
      preset: range.preset,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      priorDateFrom: range.priorDateFrom,
      priorDateTo: range.priorDateTo,
      hasPriorComparison: range.hasPriorComparison,
    },
    reps,
  };
}

export interface CustomerAnalyticsFilters extends BiFilterParams {
  repeatFilter?: CustomerRepeatFilter;
  customMinOrders?: number;
  dormancyDays?: number;
  search?: string;
  sortBy?: 'periodSpent' | 'totalSpent' | 'ordersCount' | 'lastOrderDate' | 'daysSinceLastOrder';
  sortDir?: 'asc' | 'desc';
}

export async function getCustomerAnalytics(
  user: User,
  filters: CustomerAnalyticsFilters = {}
): Promise<{
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
}> {
  const isSalesOnly =
    user.role === 'sales' &&
    !user.canManageOrderStatus &&
    !user.canConfirmDelivery;

  if (
    isSalesOnly &&
    filters.salesRepId &&
    filters.salesRepId !== 'all' &&
    filters.salesRepId !== user.salesRepId
  ) {
    const err = new Error('غير مسموح بالاطلاع على عملاء مندوب مبيعات آخر.');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  const [customerRows, orderRows, productRows] = await withDbRetry(() =>
    Promise.all([
      db.select().from(customers),
      db.select().from(orders).orderBy(desc(orders.createdAt)),
      db.select().from(products),
    ])
  );

  const allMappedCustomers: Customer[] = customerRows.map((c) => ({
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
  }));

  const allMappedOrders = orderRows.map((o) => ({
    ...o,
    items: o.items || [],
    governorate: o.governorate ?? undefined,
    customerNotes: o.customerNotes ?? undefined,
    operationalNotes: o.operationalNotes ?? undefined,
    status: o.status as OrderStatus,
  })) as unknown as Order[];

  // Enforce strict Salesperson Customer Privacy
  const visibleCustomers = getVisibleCustomersForUser(user, allMappedCustomers, allMappedOrders);
  const scopedOrders = isSalesOnly
    ? orderRows.filter((o) => Boolean(user.salesRepId) && o.salesRepId === user.salesRepId)
    : orderRows;

  const prodLookup = buildProductLookup(productRows.map(mapProductRow));
  const preset: BiPeriodPreset = filters.preset || (filters.dateFrom || filters.dateTo ? 'custom' : 'all');
  const range = resolveBiDateRange(preset, filters.dateFrom, filters.dateTo);
  const dormancyDays = Math.max(1, Number(filters.dormancyDays || 45));
  const todayYmd = formatCairoYmd();

  const rows: CustomerAnalyticsRow[] = [];

  for (const cust of visibleCustomers) {
    if (
      filters.salesRepId &&
      filters.salesRepId !== 'all' &&
      cust.assignedSalesRepId !== filters.salesRepId
    ) {
      // Also check if customer orders match rep if unassigned
      const hasRepOrder = scopedOrders.some(
        (o) =>
          o.salesRepId === filters.salesRepId &&
          (o.customerName.trim().toLowerCase() === cust.name.trim().toLowerCase() ||
            (Boolean(cust.phone) && o.customerPhone === cust.phone))
      );
      if (!hasRepOrder) continue;
    }

    if (
      filters.customerClassification &&
      filters.customerClassification !== 'all' &&
      cust.classification !== filters.customerClassification
    ) {
      continue;
    }

    const search = filters.search?.trim().toLowerCase();
    if (
      search &&
      !cust.name.toLowerCase().includes(search) &&
      !(cust.phone || '').toLowerCase().includes(search) &&
      !(cust.address || '').toLowerCase().includes(search)
    ) {
      continue;
    }

    const custNameLow = cust.name.trim().toLowerCase();
    const custPhone = (cust.phone || '').trim();
    const custValidOrders = scopedOrders.filter(
      (o) =>
        isRevenueCountingOrder(o.status) &&
        hasOrderBeenConfirmed(o) &&
        (o.customerName.trim().toLowerCase() === custNameLow ||
          (Boolean(custPhone) && (o.customerPhone || '').trim() === custPhone))
    );

    let firstOrderDate = '';
    let lastOrderDate = '';
    let lifetimeSpent = 0;
    let periodOrdersCount = 0;
    let previousPeriodOrdersCount = 0;
    let periodSpent = 0;
    const periodUnitEntries: Array<{ unit: string; quantity: number }> = [];
    const repCounter = new Map<string, number>();

    for (const o of custValidOrders) {
      const ymd = toCairoYmd(o.createdAt);
      if (!firstOrderDate || (ymd && ymd < firstOrderDate)) firstOrderDate = ymd;
      if (!lastOrderDate || (ymd && ymd > lastOrderDate)) lastOrderDate = ymd;
      lifetimeSpent += o.totalAmount;
      if (o.salesRepName) {
        repCounter.set(o.salesRepName, (repCounter.get(o.salesRepName) ?? 0) + 1);
      }

      const inPeriod = !range.dateFrom && !range.dateTo ? true : isInYmdRange(ymd, range.dateFrom, range.dateTo);
      const inPrior =
        range.hasPriorComparison && range.priorDateFrom && range.priorDateTo
          ? isInYmdRange(ymd, range.priorDateFrom, range.priorDateTo)
          : false;

      if (inPeriod) {
        periodOrdersCount += 1;
        periodSpent += o.totalAmount;
        for (const it of o.items || []) {
          const prod = prodLookup.resolve(it);
          const unit = normalizeProductUnit(it.unit || prod?.unit || 'قطعة');
          periodUnitEntries.push({ unit, quantity: Number(it.quantity || 0) });
        }
      } else if (inPrior) {
        previousPeriodOrdersCount += 1;
      }
    }

    const daysSinceLastOrder = lastOrderDate ? Math.max(0, diffYmdDays(lastOrderDate, todayYmd)) : null;
    const isDormant = daysSinceLastOrder !== null ? daysSinceLastOrder >= dormancyDays : custValidOrders.length === 0;

    let frequencyTrend: CustomerAnalyticsRow['frequencyTrend'] = 'stable';
    if (custValidOrders.length <= 1 && periodOrdersCount === 1 && previousPeriodOrdersCount === 0) {
      frequencyTrend = 'new';
    } else if (periodOrdersCount > previousPeriodOrdersCount) {
      frequencyTrend = 'increased';
    } else if (periodOrdersCount < previousPeriodOrdersCount) {
      frequencyTrend = 'declined';
    }

    let primaryRepName = cust.assignedSalesRepName || undefined;
    if (!primaryRepName && repCounter.size > 0) {
      primaryRepName = Array.from(repCounter.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }

    const ordersCount = custValidOrders.length;
    const avgOrderValue =
      periodOrdersCount > 0
        ? Math.round((periodSpent / periodOrdersCount) * 100) / 100
        : ordersCount > 0
          ? Math.round((lifetimeSpent / ordersCount) * 100) / 100
          : 0;

    // Repeat filter matching
    const rf: CustomerRepeatFilter = filters.repeatFilter || 'all';
    let passRepeat = true;
    if (rf === 'once') passRepeat = ordersCount === 1;
    else if (rf === '2_plus') passRepeat = ordersCount >= 2;
    else if (rf === '3_plus') passRepeat = ordersCount >= 3;
    else if (rf === '5_plus') passRepeat = ordersCount >= 5;
    else if (rf === 'custom_min') {
      const min = Math.max(1, Number(filters.customMinOrders || 2));
      passRepeat = ordersCount >= min;
    } else if (rf === 'increased_frequency') {
      passRepeat = periodOrdersCount > previousPeriodOrdersCount;
    } else if (rf === 'declined_frequency') {
      passRepeat = periodOrdersCount < previousPeriodOrdersCount;
    } else if (rf === 'inactive') {
      passRepeat = isDormant;
    }

    if (!passRepeat) continue;

    // When explicit date range is active and repeatFilter != 'inactive', exclude zero-activity customers unless repeatFilter requested 'inactive' or 'declined_frequency'
    if (
      (range.dateFrom || range.dateTo) &&
      rf !== 'inactive' &&
      rf !== 'declined_frequency' &&
      rf !== 'all' &&
      periodOrdersCount === 0
    ) {
      continue;
    }

    rows.push({
      customerId: cust.id,
      customerName: cust.name,
      phone: cust.phone,
      address: cust.address,
      classification: cust.classification,
      assignedSalesRepId: cust.assignedSalesRepId ?? null,
      assignedSalesRepName: cust.assignedSalesRepName ?? null,
      ordersCount,
      periodOrdersCount,
      previousPeriodOrdersCount,
      totalSpent: Math.round(lifetimeSpent * 100) / 100,
      periodSpent: Math.round(periodSpent * 100) / 100,
      averageOrderValue: avgOrderValue,
      firstOrderDate,
      lastOrderDate,
      daysSinceLastOrder,
      isDormant,
      frequencyTrend,
      unitsByUnit: aggregateQuantitiesByUnit(periodUnitEntries),
      primaryRepName,
    });
  }

  const sortBy = filters.sortBy || 'periodSpent';
  const sortDir = filters.sortDir || 'desc';
  rows.sort((a, b) => {
    const mult = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'lastOrderDate') {
      return a.lastOrderDate.localeCompare(b.lastOrderDate) * mult;
    }
    const av = Number(a[sortBy] ?? -1);
    const bv = Number(b[sortBy] ?? -1);
    return (av - bv) * mult;
  });

  const repeatCustomersCount = rows.filter((r) => r.ordersCount >= 2).length;
  const oneTimeBuyersCount = rows.filter((r) => r.ordersCount === 1).length;
  const dormantCustomersCount = rows.filter((r) => r.isDormant).length;
  const totalPeriodRevenue = Math.round(rows.reduce((s, r) => s + r.periodSpent, 0) * 100) / 100;

  return {
    appliedRange: {
      preset: range.preset,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      priorDateFrom: range.priorDateFrom,
      priorDateTo: range.priorDateTo,
      hasPriorComparison: range.hasPriorComparison,
    },
    dormancyDays,
    summary: {
      totalCustomers: rows.length,
      repeatCustomersCount,
      oneTimeBuyersCount,
      dormantCustomersCount,
      totalPeriodRevenue,
    },
    customers: rows,
  };
}

export async function getReorderRecommendations(options: {
  lookbackDays?: number;
  leadTimeDays?: number;
  safetyDays?: number;
  categoryId?: string;
} = {}): Promise<{
  lookbackDays: number;
  leadTimeDays: number;
  safetyDays: number;
  recommendations: ReorderRecommendationRow[];
}> {
  const lookbackDays = Math.min(365, Math.max(7, Number(options.lookbackDays || 30)));
  const leadTimeDays = Math.min(90, Math.max(1, Number(options.leadTimeDays || 7)));
  const safetyDays = Math.min(90, Math.max(0, Number(options.safetyDays || 7)));

  const [productRows, orderRows, generalSettings] = await withDbRetry(() =>
    Promise.all([
      db.select().from(products),
      db.select().from(orders),
      getGeneralSystemSettings(),
    ])
  );

  const productsCatalog = productRows.map(mapProductRow).filter((p) => p.isActive);
  const prodLookup = buildProductLookup(productsCatalog);
  const todayYmd = formatCairoYmd();
  const startYmd = addDaysYmd(todayYmd, -(lookbackDays - 1));

  const demandMap = new Map<
    string,
    { soldQty: number; extQty: number; pendingQty: number }
  >();

  for (const o of orderRows) {
    if (!isRevenueCountingOrder(o.status)) continue;
    const ymd = toCairoYmd(o.createdAt);
    const inLookback = ymd && ymd >= startYmd && ymd <= todayYmd;

    for (const it of o.items || []) {
      const prod = prodLookup.resolve(it);
      if (!prod || !prod.isActive) continue;
      if (options.categoryId && options.categoryId !== 'all' && prod.categoryId !== options.categoryId) {
        continue;
      }

      const d = demandMap.get(prod.id) ?? { soldQty: 0, extQty: 0, pendingQty: 0 };
      const qty = Math.max(0, Number(it.quantity || 0));
      const pend =
        o.status !== 'تم التسليم' ? Math.max(0, Number(it.pendingQty ?? 0)) : 0;
      const ext = Math.max(0, Number(it.externalSuppliedQty ?? 0));

      d.pendingQty = roundStockNumber(d.pendingQty + pend);
      if (inLookback) {
        d.soldQty = roundStockNumber(d.soldQty + qty);
        d.extQty = roundStockNumber(d.extQty + ext);
      }
      demandMap.set(prod.id, d);
    }
  }

  const recommendations: ReorderRecommendationRow[] = [];

  for (const p of productsCatalog) {
    if (options.categoryId && options.categoryId !== 'all' && p.categoryId !== options.categoryId) {
      continue;
    }
    const stats = demandMap.get(p.id) ?? { soldQty: 0, extQty: 0, pendingQty: 0 };
    const avgDailyDemand = stats.soldQty / lookbackDays;
    const coverTargetDays = leadTimeDays + safetyDays;
    const demandTarget = roundStockNumber(avgDailyDemand * coverTargetDays);
    const lowThreshold =
      p.categoryId === 'cat-oils'
        ? generalSettings.lowStockThresholdOils
        : generalSettings.lowStockThresholdOther;
    const recommendedTargetStock = Math.max(demandTarget, stats.soldQty > 0 ? lowThreshold : 0);
    const netRequired = roundStockNumber(recommendedTargetStock + stats.pendingQty - p.stock);
    const daysOfCoverRemaining =
      avgDailyDemand > 0 ? Math.round((p.stock / avgDailyDemand) * 10) / 10 : null;

    const shouldRecommend =
      netRequired > 0 ||
      stats.pendingQty > 0 ||
      (stats.soldQty > 0 && p.stock <= lowThreshold) ||
      (stats.extQty > 0 && p.stock <= lowThreshold);

    if (!shouldRecommend) continue;

    let priority: ReorderRecommendationRow['priority'] = 'watch';
    if (p.stock <= 0 || stats.pendingQty > 0 || (daysOfCoverRemaining !== null && daysOfCoverRemaining < leadTimeDays)) {
      priority = 'urgent';
    } else if (daysOfCoverRemaining !== null && daysOfCoverRemaining <= coverTargetDays) {
      priority = 'soon';
    }

    const reasons: string[] = [];
    if (stats.pendingQty > 0) {
      reasons.push(`كميات معلقة للتوفير (${stats.pendingQty.toLocaleString()} ${p.unit})`);
    }
    if (p.stock <= 0) {
      reasons.push('رصيد المخزون صفر');
    } else if (daysOfCoverRemaining !== null && daysOfCoverRemaining <= coverTargetDays) {
      reasons.push(`يكفي ${daysOfCoverRemaining} يوم فقط`);
    }
    if (stats.extQty > 0) {
      reasons.push(`توفير خارجي سابق (${stats.extQty.toLocaleString()} ${p.unit})`);
    }
    if (reasons.length === 0) {
      reasons.push(`الرصيد أقل من الحد الموصى به (${recommendedTargetStock.toLocaleString()} ${p.unit})`);
    }

    recommendations.push({
      productId: p.id,
      code: p.code,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      unit: p.unit,
      currentStock: p.stock,
      lookbackUnitsSold: stats.soldQty,
      avgDailyDemand: roundStockNumber(avgDailyDemand),
      externalSuppliedInLookback: stats.extQty,
      pendingProcurementQty: stats.pendingQty,
      leadTimeDays,
      safetyDays,
      recommendedTargetStock,
      suggestedReorderQty: Math.max(0, netRequired),
      daysOfCoverRemaining,
      priority,
      reasonAr: reasons.join(' · '),
    });
  }

  const priorityRank = { urgent: 0, soon: 1, watch: 2 };
  recommendations.sort((a, b) => {
    const pDiff = priorityRank[a.priority] - priorityRank[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.lookbackUnitsSold - a.lookbackUnitsSold;
  });

  return {
    lookbackDays,
    leadTimeDays,
    safetyDays,
    recommendations,
  };
}

export interface UnifiedReportColumn {
  key: string;
  label: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
}

export interface UnifiedReportPayload {
  reportType: UnifiedReportType;
  titleAr: string;
  subtitleAr: string;
  appliedFilterSummary: string;
  summaryCards: Array<{ label: string; value: string }>;
  columns: UnifiedReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  unitTotals?: UnitQuantityTotal[];
}

const SALES_ALLOWED_REPORTS = new Set<UnifiedReportType>([
  'sales',
  'commissions',
  'customers',
  'repeat_customers',
  'invoice_status',
]);

export function canUserAccessReportType(user: User, reportType: UnifiedReportType): boolean {
  if (user.role === 'owner' || user.role === 'admin') return true;
  if (user.role === 'supervisor') {
    return reportType !== 'inventory_valuation' && reportType !== 'commissions';
  }
  if (user.role === 'sales') {
    return SALES_ALLOWED_REPORTS.has(reportType);
  }
  return false;
}

export async function getUnifiedReportData(
  reportType: UnifiedReportType,
  user: User,
  filters: BiFilterParams & {
    repeatFilter?: CustomerRepeatFilter;
    dormancyDays?: number;
    search?: string;
  } = {}
): Promise<UnifiedReportPayload> {
  if (!canUserAccessReportType(user, reportType)) {
    const err = new Error('ليس لديك صلاحية للوصول إلى هذا التقرير أو تصديره.');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  const effectiveFilters: typeof filters = { ...filters };
  if (user.role === 'sales' && user.salesRepId) {
    if (filters.salesRepId && filters.salesRepId !== 'all' && filters.salesRepId !== user.salesRepId) {
      const err = new Error('غير مسموح بعرض تقارير تخص مندوب مبيعات آخر.');
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }
    effectiveFilters.salesRepId = user.salesRepId;
  }

  const preset: BiPeriodPreset =
    effectiveFilters.preset || (effectiveFilters.dateFrom || effectiveFilters.dateTo ? 'custom' : 'last_30_days');
  const range = resolveBiDateRange(preset, effectiveFilters.dateFrom, effectiveFilters.dateTo);
  const filterSummary =
    range.dateFrom || range.dateTo
      ? `الفترة: ${range.dateFrom || '...'} إلى ${range.dateTo || '...'}`
      : 'الفترة: كافة السجلات';

  if (reportType === 'sales' || reportType === 'invoice_status' || reportType === 'operations_performance') {
    const orderRows = await db.select().from(orders).orderBy(desc(orders.createdAt));
    const matched = orderRows.filter((o) => {
      if (
        effectiveFilters.salesRepId &&
        effectiveFilters.salesRepId !== 'all' &&
        o.salesRepId !== effectiveFilters.salesRepId
      ) {
        return false;
      }
      if (effectiveFilters.status && effectiveFilters.status !== 'all' && o.status !== effectiveFilters.status) {
        return false;
      }
      if (range.dateFrom || range.dateTo) {
        if (!isInYmdRange(toCairoYmd(o.createdAt), range.dateFrom, range.dateTo)) return false;
      }
      return true;
    });

    if (reportType === 'sales') {
      const totalRev = matched
        .filter((o) => isRevenueCountingOrder(o.status))
        .reduce((s, o) => s + o.totalAmount, 0);
      const deliveredRev = matched
        .filter((o) => o.status === 'تم التسليم')
        .reduce((s, o) => s + o.totalAmount, 0);
      return {
        reportType,
        titleAr: 'تقرير المبيعات والفواتير',
        subtitleAr: 'تفاصيل الفواتير والإيرادات والخصومات والشحن حسب الفترة المختارة',
        appliedFilterSummary: filterSummary,
        summaryCards: [
          { label: 'عدد الفواتير', value: `${matched.length}` },
          { label: 'إجمالي المبيعات المؤكدة', value: `${Math.round(totalRev).toLocaleString()} ج.م` },
          { label: 'إيرادات التسليم النهائي', value: `${Math.round(deliveredRev).toLocaleString()} ج.م` },
        ],
        columns: [
          { key: 'id', label: 'رقم الفاتورة', format: 'text' },
          { key: 'createdAt', label: 'التاريخ', format: 'date' },
          { key: 'customerName', label: 'العميل', format: 'text' },
          { key: 'salesRepName', label: 'المندوب', format: 'text' },
          { key: 'status', label: 'الحالة', format: 'text' },
          { key: 'subtotal', label: 'الإجمالي الفرعي', format: 'currency' },
          { key: 'discountAmount', label: 'الخصم', format: 'currency' },
          { key: 'shippingCost', label: 'الشحن', format: 'currency' },
          { key: 'totalAmount', label: 'الصافي', format: 'currency' },
          { key: 'commission', label: 'العمولة', format: 'currency' },
        ],
        rows: matched.map((o) => ({
          id: o.id,
          createdAt: toCairoYmd(o.createdAt),
          customerName: o.customerName,
          salesRepName: o.salesRepName,
          status: o.status,
          subtotal: o.subtotal,
          discountAmount: o.discountAmount,
          shippingCost: o.shippingCost,
          totalAmount: o.totalAmount,
          commission: o.commission,
        })),
      };
    }

    if (reportType === 'invoice_status') {
      const grouped = new Map<string, { count: number; total: number; commission: number }>();
      for (const o of matched) {
        const g = grouped.get(o.status) ?? { count: 0, total: 0, commission: 0 };
        g.count += 1;
        g.total += o.totalAmount;
        g.commission += o.commission;
        grouped.set(o.status, g);
      }
      return {
        reportType,
        titleAr: 'تقرير توزيع حالات الفواتير',
        subtitleAr: 'حصر الفواتير حسب المرحلة التشغيلية ونسبتها من الإجمالي',
        appliedFilterSummary: filterSummary,
        summaryCards: [{ label: 'إجمالي الفواتير', value: `${matched.length}` }],
        columns: [
          { key: 'status', label: 'حالة الفاتورة', format: 'text' },
          { key: 'count', label: 'عدد الفواتير', format: 'number' },
          { key: 'sharePct', label: 'النسبة %', format: 'percent' },
          { key: 'totalAmount', label: 'إجمالي القيمة', format: 'currency' },
          { key: 'commission', label: 'إجمالي العمولات', format: 'currency' },
        ],
        rows: Array.from(grouped.entries()).map(([st, g]) => ({
          status: st,
          count: g.count,
          sharePct: matched.length > 0 ? Math.round((g.count / matched.length) * 1000) / 10 : 0,
          totalAmount: Math.round(g.total * 100) / 100,
          commission: Math.round(g.commission * 100) / 100,
        })),
      };
    }

    // operations_performance
    const rows = matched.map((o) => {
      const createdMs = Date.parse(o.createdAt);
      const deliveredMs = o.deliveredAt ? Date.parse(o.deliveredAt) : NaN;
      const cycleHours =
        Number.isFinite(createdMs) && Number.isFinite(deliveredMs) && deliveredMs >= createdMs
          ? Math.round(((deliveredMs - createdMs) / 3600000) * 10) / 10
          : null;
      return {
        id: o.id,
        customerName: o.customerName,
        status: o.status,
        confirmedAt: toCairoYmd(o.confirmedAt),
        prepCompletedAt: toCairoYmd(o.prepCompletedAt),
        shippedAt: toCairoYmd(o.shippedAt),
        deliveredAt: toCairoYmd(o.deliveredAt),
        cycleHours,
        hasPendingProcurement: hasOrderPendingProcurement({ items: o.items }) ? 'نعم' : 'لا',
        isHeld: o.holdInfo?.isHeld ? 'معلق' : 'لا',
      };
    });
    return {
      reportType,
      titleAr: 'تقرير أداء التشغيل والتجهيز والشحن',
      subtitleAr: 'تتبع أزمنة المراحل التشغيلية وحالات التعليق والتوفير المعلّقة',
      appliedFilterSummary: filterSummary,
      summaryCards: [
        { label: 'إجمالي الطلبات', value: `${matched.length}` },
        {
          label: 'طلبات بانتظار التوفير',
          value: `${rows.filter((r) => r.hasPendingProcurement === 'نعم').length}`,
        },
      ],
      columns: [
        { key: 'id', label: 'رقم الفاتورة', format: 'text' },
        { key: 'customerName', label: 'العميل', format: 'text' },
        { key: 'status', label: 'الحالة', format: 'text' },
        { key: 'confirmedAt', label: 'تأكيد العميل', format: 'date' },
        { key: 'prepCompletedAt', label: 'اكتمال التجهيز', format: 'date' },
        { key: 'shippedAt', label: 'الشحن', format: 'date' },
        { key: 'deliveredAt', label: 'التسليم', format: 'date' },
        { key: 'cycleHours', label: 'ساعات الدورة', format: 'number' },
        { key: 'hasPendingProcurement', label: 'توفير معلق', format: 'text' },
        { key: 'isHeld', label: 'التعليق', format: 'text' },
      ],
      rows,
    };
  }

  if (reportType === 'sales_reps' || reportType === 'commissions') {
    const repData = await getSalesRepAnalytics(effectiveFilters);
    const totalEarned = repData.reps.reduce((s, r) => s + r.earnedCommission, 0);
    const totalPending = repData.reps.reduce((s, r) => s + r.pendingCommission, 0);
    if (reportType === 'commissions') {
      return {
        reportType,
        titleAr: 'تقرير العمولات المستحقة والمعلقة',
        subtitleAr: 'تفصيل العمولات المكتسبة عند التسليم مقابل المعلقة قيد التشغيل',
        appliedFilterSummary: filterSummary,
        summaryCards: [
          { label: 'إجمالي العمولات المستحقة', value: `${Math.round(totalEarned).toLocaleString()} ج.م` },
          { label: 'إجمالي العمولات المعلقة', value: `${Math.round(totalPending).toLocaleString()} ج.م` },
        ],
        columns: [
          { key: 'salesRepName', label: 'مندوب المبيعات', format: 'text' },
          { key: 'ordersCount', label: 'الطلبات المؤكدة', format: 'number' },
          { key: 'deliveredOrdersCount', label: 'طلبات التسليم', format: 'number' },
          { key: 'deliveredRevenue', label: 'مبيعات التسليم', format: 'currency' },
          { key: 'baseCommissionRate', label: 'النسبة الأساسية %', format: 'percent' },
          { key: 'earnedCommission', label: 'عمولة مستحقة', format: 'currency' },
          { key: 'pendingCommission', label: 'عمولة معلقة', format: 'currency' },
        ],
        rows: repData.reps.map((r) => ({
          salesRepName: r.salesRepName,
          ordersCount: r.ordersCount,
          deliveredOrdersCount: r.deliveredOrdersCount,
          deliveredRevenue: r.deliveredRevenue,
          baseCommissionRate: Math.round(r.baseCommissionRate * 1000) / 10,
          earnedCommission: r.earnedCommission,
          pendingCommission: r.pendingCommission,
        })),
      };
    }

    return {
      reportType,
      titleAr: 'تقرير أداء مناديب المبيعات',
      subtitleAr: 'مقارنة المبيعات والطلبات ومتوسط الفاتورة والعملاء المتكررين والكميات بوحداتها',
      appliedFilterSummary: filterSummary,
      summaryCards: [
        { label: 'عدد المناديب', value: `${repData.reps.length}` },
        {
          label: 'إجمالي المبيعات',
          value: `${Math.round(repData.reps.reduce((s, r) => s + r.totalRevenue, 0)).toLocaleString()} ج.م`,
        },
      ],
      columns: [
        { key: 'salesRepName', label: 'المندوب', format: 'text' },
        { key: 'ordersCount', label: 'الطلبات', format: 'number' },
        { key: 'deliveredOrdersCount', label: 'المسلمة', format: 'number' },
        { key: 'cancelledOrReturnedCount', label: 'ملغي/مرتجع', format: 'number' },
        { key: 'totalRevenue', label: 'إجمالي المبيعات', format: 'currency' },
        { key: 'averageOrderValue', label: 'متوسط الفاتورة', format: 'currency' },
        { key: 'uniqueCustomersCount', label: 'العملاء', format: 'number' },
        { key: 'repeatCustomersCount', label: 'عملاء متكررون', format: 'number' },
        { key: 'unitsSummary', label: 'الكميات المباعة بالوحدة', format: 'text' },
      ],
      rows: repData.reps.map((r) => ({
        salesRepName: r.salesRepName,
        ordersCount: r.ordersCount,
        deliveredOrdersCount: r.deliveredOrdersCount,
        cancelledOrReturnedCount: r.cancelledOrReturnedCount,
        totalRevenue: r.totalRevenue,
        averageOrderValue: r.averageOrderValue,
        uniqueCustomersCount: r.uniqueCustomersCount,
        repeatCustomersCount: r.repeatCustomersCount,
        unitsSummary: formatUnitTotalsSummary(r.unitsByUnit),
      })),
    };
  }

  if (reportType === 'categories' || reportType === 'products') {
    const bi = await getOwnerBiDashboardData({ ...effectiveFilters, topLimit: 500 });
    if (reportType === 'categories') {
      return {
        reportType,
        titleAr: 'تقرير مبيعات التصنيفات (آمن للوحدات)',
        subtitleAr: 'تحليل الإيرادات والكميات لكل تصنيف مع فصل الوحدات المختلفة وعدم جمعها',
        appliedFilterSummary: filterSummary,
        summaryCards: [
          { label: 'التصنيفات النشطة', value: `${bi.categoryBreakdown.length}` },
          { label: 'إجمالي المبيعات', value: `${Math.round(bi.kpis.totalRevenue).toLocaleString()} ج.م` },
        ],
        columns: [
          { key: 'categoryName', label: 'التصنيف', format: 'text' },
          { key: 'ordersCount', label: 'عدد الطلبات', format: 'number' },
          { key: 'revenue', label: 'المبيعات', format: 'currency' },
          { key: 'sharePct', label: 'الحصة %', format: 'percent' },
          { key: 'unitsSummary', label: 'الكميات المباعة بالوحدات', format: 'text' },
        ],
        rows: bi.categoryBreakdown.map((c) => ({
          categoryName: c.categoryName,
          ordersCount: c.ordersCount,
          revenue: c.revenue,
          sharePct: c.sharePct,
          unitsSummary: formatUnitTotalsSummary(c.unitsByUnit),
        })),
        unitTotals: bi.kpis.unitsSoldByUnit,
      };
    }

    return {
      reportType,
      titleAr: 'تقرير المنتجات الأكثر مبيعاً وحالة المخزون',
      subtitleAr: 'ترتيب المنتجات حسب المبيعات مع إظهار الرصيد الحالي وفرص التخزين',
      appliedFilterSummary: filterSummary,
      summaryCards: [{ label: 'عدد المنتجات المباعة', value: `${bi.topProducts.length}` }],
      columns: [
        { key: 'productCode', label: 'الكود', format: 'text' },
        { key: 'productName', label: 'المنتج', format: 'text' },
        { key: 'categoryName', label: 'التصنيف', format: 'text' },
        { key: 'unit', label: 'الوحدة', format: 'text' },
        { key: 'ordersCount', label: 'الطلبات', format: 'number' },
        { key: 'quantitySold', label: 'الكمية المباعة', format: 'number' },
        { key: 'revenue', label: 'إجمالي المبيعات', format: 'currency' },
        { key: 'currentStock', label: 'الرصيد الحالي', format: 'number' },
        { key: 'pendingSourcingQty', label: 'بانتظار التوفير', format: 'number' },
        { key: 'opportunity', label: 'فرصة تخزين', format: 'text' },
      ],
      rows: bi.topProducts.map((p) => ({
        productCode: p.productCode,
        productName: p.productName,
        categoryName: p.categoryName,
        unit: p.unit,
        ordersCount: p.ordersCount,
        quantitySold: p.quantitySold,
        revenue: p.revenue,
        currentStock: p.currentStock,
        pendingSourcingQty: p.pendingSourcingQty,
        opportunity: p.stockingOpportunity ? p.stockingOpportunityReason || 'نعم' : 'متوازن',
      })),
    };
  }

  if (reportType === 'customers' || reportType === 'repeat_customers') {
    const custData = await getCustomerAnalytics(user, {
      ...effectiveFilters,
      repeatFilter:
        reportType === 'repeat_customers'
          ? effectiveFilters.repeatFilter && effectiveFilters.repeatFilter !== 'all'
            ? effectiveFilters.repeatFilter
            : '2_plus'
          : effectiveFilters.repeatFilter || 'all',
      dormancyDays: filters.dormancyDays,
      search: filters.search,
    });
    return {
      reportType,
      titleAr:
        reportType === 'repeat_customers'
          ? 'تقرير العملاء المتكررين والاحتفاظ بالعملاء'
          : 'تقرير العملاء والمبيعات المفلتر',
      subtitleAr:
        reportType === 'repeat_customers'
          ? 'تحليل تكرار الشراء وتغير الوتيرة والعملاء الخاملين ضمن نطاق الصلاحيات'
          : 'تفاصيل مشتريات العملاء حسب التاريخ وحالة الفواتير الصحيحة',
      appliedFilterSummary: filterSummary,
      summaryCards: [
        { label: 'عدد العملاء', value: `${custData.summary.totalCustomers}` },
        { label: 'العملاء المتكررون (2+)', value: `${custData.summary.repeatCustomersCount}` },
        { label: 'عملاء خاملون', value: `${custData.summary.dormantCustomersCount}` },
        { label: 'مبيعات الفترة', value: `${Math.round(custData.summary.totalPeriodRevenue).toLocaleString()} ج.م` },
      ],
      columns: [
        { key: 'customerName', label: 'العميل', format: 'text' },
        { key: 'phone', label: 'الهاتف', format: 'text' },
        { key: 'classification', label: 'التصنيف', format: 'text' },
        { key: 'primaryRepName', label: 'المندوب المسؤول', format: 'text' },
        { key: 'ordersCount', label: 'إجمالي الطلبات', format: 'number' },
        { key: 'periodOrdersCount', label: 'طلبات الفترة', format: 'number' },
        { key: 'periodSpent', label: 'إنفاق الفترة', format: 'currency' },
        { key: 'totalSpent', label: 'الإجمالي التاريخي', format: 'currency' },
        { key: 'averageOrderValue', label: 'متوسط الطلب', format: 'currency' },
        { key: 'lastOrderDate', label: 'آخر طلب', format: 'date' },
        { key: 'daysSinceLastOrder', label: 'أيام منذ آخر طلب', format: 'number' },
        { key: 'unitsSummary', label: 'الكميات المشتراة', format: 'text' },
      ],
      rows: custData.customers.map((c) => ({
        customerName: c.customerName,
        phone: c.phone,
        classification: c.classification,
        primaryRepName: c.primaryRepName || 'غير معيّن',
        ordersCount: c.ordersCount,
        periodOrdersCount: c.periodOrdersCount,
        periodSpent: c.periodSpent,
        totalSpent: c.totalSpent,
        averageOrderValue: c.averageOrderValue,
        lastOrderDate: c.lastOrderDate,
        daysSinceLastOrder: c.daysSinceLastOrder,
        unitsSummary: formatUnitTotalsSummary(c.unitsByUnit),
      })),
    };
  }

  if (reportType === 'inventory_valuation') {
    const productRows = (await db.select().from(products))
      .map(mapProductRow)
      .filter((p) => {
        if (!p.isActive) return false;
        if (effectiveFilters.categoryId && effectiveFilters.categoryId !== 'all' && p.categoryId !== effectiveFilters.categoryId) {
          return false;
        }
        return true;
      });
    const stocked = productRows.filter((p) => p.stock > 0);
    const missingCount = stocked.filter((p) => p.costPrice == null).length;
    const knownValue = stocked.reduce(
      (s, p) => (typeof p.costPrice === 'number' ? s + p.stock * p.costPrice : s),
      0
    );
    const sellingValue = stocked.reduce((s, p) => s + p.stock * p.pricePerMg, 0);

    return {
      reportType,
      titleAr: 'تقرير تقييم المخزون الفعلي',
      subtitleAr:
        missingCount > 0
          ? `تنبيه: يوجد ${missingCount} صنف برصيد بدون تكلفة مسجلة (لا يُحتسب صفرًا)`
          : 'تقييم كامل لكافة الأرصدة المخزنية بتكلفتها المسجلة',
      appliedFilterSummary: 'حالة المخزون الحالية',
      summaryCards: [
        { label: 'إجمالي الأصناف النشطة', value: `${productRows.length}` },
        {
          label: 'قيمة التكلفة المعروفة',
          value:
            missingCount > 0
              ? `جزئي: ${Math.round(knownValue).toLocaleString()} ج.م`
              : `${Math.round(knownValue).toLocaleString()} ج.م`,
        },
        { label: 'القيمة البيعية التقديرية', value: `${Math.round(sellingValue).toLocaleString()} ج.م` },
      ],
      columns: [
        { key: 'code', label: 'الكود', format: 'text' },
        { key: 'name', label: 'المنتج', format: 'text' },
        { key: 'categoryName', label: 'التصنيف', format: 'text' },
        { key: 'unit', label: 'الوحدة', format: 'text' },
        { key: 'stock', label: 'الرصيد', format: 'number' },
        { key: 'costPrice', label: 'سعر التكلفة', format: 'currency' },
        { key: 'stockCostValue', label: 'قيمة التكلفة', format: 'currency' },
        { key: 'pricePerMg', label: 'سعر البيع', format: 'currency' },
        { key: 'sellingValue', label: 'القيمة البيعية', format: 'currency' },
      ],
      rows: productRows.map((p) => ({
        code: p.code,
        name: p.name,
        categoryName: p.categoryName,
        unit: p.unit,
        stock: p.stock,
        costPrice: typeof p.costPrice === 'number' ? p.costPrice : null,
        stockCostValue:
          typeof p.costPrice === 'number' ? Math.round(p.stock * p.costPrice * 100) / 100 : null,
        pricePerMg: p.pricePerMg,
        sellingValue: Math.round(p.stock * p.pricePerMg * 100) / 100,
      })),
      unitTotals: aggregateQuantitiesByUnit(
        productRows.map((p) => ({ unit: p.unit, quantity: p.stock }))
      ),
    };
  }

  if (reportType === 'stock_movements') {
    const moves = await db.select().from(stockMovements).orderBy(desc(stockMovements.createdAt)).limit(500);
    const filtered = moves.filter((m) => {
      if (effectiveFilters.productId && effectiveFilters.productId !== 'all' && m.productId !== effectiveFilters.productId) {
        return false;
      }
      if (range.dateFrom || range.dateTo) {
        if (!isInYmdRange(toCairoYmd(m.createdAt), range.dateFrom, range.dateTo)) return false;
      }
      return true;
    });
    return {
      reportType,
      titleAr: 'تقرير سجل حركات المخزون',
      subtitleAr: 'كافة عمليات الخصم والإضافة والتسوية الجماعية واستلامات الموردين',
      appliedFilterSummary: filterSummary,
      summaryCards: [{ label: 'عدد الحركات', value: `${filtered.length}` }],
      columns: [
        { key: 'createdAt', label: 'التاريخ', format: 'date' },
        { key: 'productName', label: 'المنتج', format: 'text' },
        { key: 'unit', label: 'الوحدة', format: 'text' },
        { key: 'movementType', label: 'نوع الحركة', format: 'text' },
        { key: 'quantityDelta', label: 'التغير', format: 'number' },
        { key: 'previousStock', label: 'الرصيد قبل', format: 'number' },
        { key: 'newStock', label: 'الرصيد بعد', format: 'number' },
        { key: 'orderId', label: 'رقم الفاتورة', format: 'text' },
        { key: 'actorName', label: 'المستخدم', format: 'text' },
        { key: 'note', label: 'السبب / الملاحظات', format: 'text' },
      ],
      rows: filtered.map((m) => ({
        createdAt: toCairoYmd(m.createdAt),
        productName: m.productName,
        unit: m.unit || '-',
        movementType: m.movementType,
        quantityDelta: m.quantityDelta,
        previousStock: m.previousStock,
        newStock: m.newStock,
        orderId: m.orderId || '-',
        actorName: m.actorName,
        note: m.note || '-',
      })),
    };
  }

  // external_sourcing
  const extRows = await db
    .select()
    .from(externalSourcingRecords)
    .orderBy(desc(externalSourcingRecords.recordedAt));
  const filteredExt = extRows.filter((r) => {
    if (effectiveFilters.productId && effectiveFilters.productId !== 'all' && r.productId !== effectiveFilters.productId) {
      return false;
    }
    if (effectiveFilters.categoryId && effectiveFilters.categoryId !== 'all' && r.categoryId !== effectiveFilters.categoryId) {
      return false;
    }
    if (range.dateFrom || range.dateTo) {
      if (!isInYmdRange(r.dateSecured, range.dateFrom, range.dateTo)) return false;
    }
    return true;
  });
  const knownCost = filteredExt.reduce(
    (s, r) =>
      s +
      (typeof r.totalSourcingCost === 'number'
        ? r.totalSourcingCost
        : typeof r.unitCost === 'number'
          ? r.unitCost * r.externalQty
          : 0),
    0
  );
  const missingCostCnt = filteredExt.filter(
    (r) => r.totalSourcingCost == null && r.unitCost == null
  ).length;

  return {
    reportType,
    titleAr: 'تقرير التوفير الخارجي وتكاليف الموردين',
    subtitleAr: 'تتبع الكميات الموفرة من خارج المخزون وتكاليف الشراء عند تسجيلها',
    appliedFilterSummary: filterSummary,
    summaryCards: [
      { label: 'عدد عمليات التوفير', value: `${filteredExt.length}` },
      { label: 'إجمالي التكلفة المعروفة', value: `${Math.round(knownCost).toLocaleString()} ج.م` },
      { label: 'سجلات بدون تكلفة مسجلة', value: `${missingCostCnt}` },
    ],
    columns: [
      { key: 'dateSecured', label: 'تاريخ التوفير', format: 'date' },
      { key: 'orderId', label: 'الفاتورة', format: 'text' },
      { key: 'productName', label: 'المنتج', format: 'text' },
      { key: 'sourcingType', label: 'النوع', format: 'text' },
      { key: 'supplierName', label: 'المورد', format: 'text' },
      { key: 'externalQty', label: 'الكمية', format: 'number' },
      { key: 'unit', label: 'الوحدة', format: 'text' },
      { key: 'unitCost', label: 'تكلفة الوحدة', format: 'currency' },
      { key: 'totalSourcingCost', label: 'إجمالي التكلفة', format: 'currency' },
      { key: 'recordedByName', label: 'بواسطة', format: 'text' },
    ],
    rows: filteredExt.map((r) => ({
      dateSecured: r.dateSecured,
      orderId: r.orderId,
      productName: r.productName,
      sourcingType: r.sourcingType === 'external_direct' ? 'توفير خارجي مباشر' : 'استلام مورد للمخزن',
      supplierName: r.supplierName || 'غير محدد',
      externalQty: r.externalQty,
      unit: r.unit,
      unitCost: r.unitCost ?? null,
      totalSourcingCost: r.totalSourcingCost ?? null,
      recordedByName: r.recordedByName,
    })),
    unitTotals: aggregateQuantitiesByUnit(
      filteredExt.map((r) => ({ unit: r.unit, quantity: r.externalQty }))
    ),
  };
}
