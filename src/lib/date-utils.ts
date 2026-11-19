import type {
  ItemSourcingSource,
  Order,
  OrderDateField,
  OrderDatePreset,
  OrderItem,
  OrdersQueryStats,
  RevisionAlertStatus,
} from '../../types.ts';

export const CAIRO_TIMEZONE = 'Africa/Cairo';

export const ORDER_DATE_FIELD_LABELS: Record<OrderDateField, string> = {
  createdAt: 'تاريخ إنشاء الفاتورة',
  confirmedAt: 'تاريخ تأكيد العميل',
  prepStartedAt: 'تاريخ بدء التجهيز',
  prepCompletedAt: 'تاريخ اكتمال التجهيز',
  shippedAt: 'تاريخ الشحن',
  deliveredAt: 'تاريخ التسليم',
  cancelledAt: 'تاريخ الإلغاء',
  returnedAt: 'تاريخ المرتجع أو رفض الاستلام',
};

export const ORDER_DATE_PRESET_LABELS: Record<OrderDatePreset, string> = {
  all: 'الكل',
  today: 'اليوم',
  yesterday: 'أمس',
  last_7_days: 'آخر 7 أيام',
  last_30_days: 'آخر 30 يومًا',
  this_month: 'هذا الشهر',
  last_month: 'الشهر السابق',
  custom: 'فترة مخصصة',
};

export const VALID_SOURCING_SOURCES: ItemSourcingSource[] = [
  'من المخزون الحالي',
  'توفير من المورد',
  'توفير خارجي دون إدخاله إلى المخزن',
  'بانتظار التوفير',
];

/**
 * Formats an instant into YYYY-MM-DD in Africa/Cairo timezone regardless of server/browser OS timezone.
 */
export function formatCairoYmd(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

export function isValidYmd(value?: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function getMonthStartEndYmd(year: number, month1To12: number): { from: string; to: string } {
  const mm = String(month1To12).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const lastDayDate = new Date(Date.UTC(year, month1To12, 0));
  const to = lastDayDate.toISOString().slice(0, 10);
  return { from, to };
}

export function resolveCairoDateRange(
  preset: OrderDatePreset = 'all',
  customFrom?: string,
  customTo?: string,
  referenceDate: Date = new Date()
): { preset: OrderDatePreset; dateFrom?: string; dateTo?: string } {
  const todayYmd = formatCairoYmd(referenceDate);
  const [yStr, mStr] = todayYmd.split('-');
  const year = Number(yStr);
  const month = Number(mStr);

  switch (preset) {
    case 'all':
      return { preset: 'all' };
    case 'today':
      return { preset: 'today', dateFrom: todayYmd, dateTo: todayYmd };
    case 'yesterday': {
      const yest = addDaysYmd(todayYmd, -1);
      return { preset: 'yesterday', dateFrom: yest, dateTo: yest };
    }
    case 'last_7_days':
      return {
        preset: 'last_7_days',
        dateFrom: addDaysYmd(todayYmd, -6),
        dateTo: todayYmd,
      };
    case 'last_30_days':
      return {
        preset: 'last_30_days',
        dateFrom: addDaysYmd(todayYmd, -29),
        dateTo: todayYmd,
      };
    case 'this_month': {
      const firstOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
      return {
        preset: 'this_month',
        dateFrom: firstOfMonth,
        dateTo: todayYmd,
      };
    }
    case 'last_month': {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const { from, to } = getMonthStartEndYmd(prevYear, prevMonth);
      return { preset: 'last_month', dateFrom: from, dateTo: to };
    }
    case 'custom': {
      const validFrom = isValidYmd(customFrom) ? customFrom : undefined;
      const validTo = isValidYmd(customTo) ? customTo : undefined;
      if (validFrom && validTo && validFrom > validTo) {
        return { preset: 'custom', dateFrom: validTo, dateTo: validFrom };
      }
      return {
        preset: 'custom',
        dateFrom: validFrom || validTo,
        dateTo: validTo || validFrom,
      };
    }
    default:
      return { preset: 'all' };
  }
}

export function isItemProcurementPending(item: OrderItem): boolean {
  if (typeof item.pendingQty === 'number') {
    return item.pendingQty > 0;
  }
  return item.procurementStatus === 'pending';
}

export function hasOrderPendingProcurement(order: Pick<Order, 'items'>): boolean {
  return (order.items || []).some((item) => isItemProcurementPending(item));
}

export function getOrderPendingProcurementItems(order: Pick<Order, 'items'>): Array<{
  index: number;
  item: OrderItem;
  pendingQty: number;
}> {
  return (order.items || [])
    .map((item, index) => ({
      index,
      item,
      pendingQty: typeof item.pendingQty === 'number' ? item.pendingQty : item.procurementStatus === 'pending' ? item.quantity : 0,
    }))
    .filter((entry) => entry.pendingQty > 0);
}

export function normalizeRevisionStatus(status?: RevisionAlertStatus | null): RevisionAlertStatus {
  if (!status || status === 'none') return 'لا يوجد تعديل معلق';
  if (status === 'تمت مراجعة التعديل' || status === 'التعديل جاهز لاستكمال التجهيز') {
    return 'تمت مراجعة التعديل واعتماده';
  }
  return status;
}

export function isRevisionPendingReview(order: Pick<Order, 'pendingEditRequest' | 'revisionAlert'>): boolean {
  if (order.pendingEditRequest) return true;
  return order.revisionAlert?.status === 'تعديل جديد يحتاج المراجعة';
}

export function isRevisionBlockingShipment(
  order: Pick<Order, 'pendingEditRequest' | 'revisionAlert' | 'items'>
): boolean {
  if (order.pendingEditRequest) return true;
  const revStatus = order.revisionAlert?.status;
  if (revStatus === 'تعديل جديد يحتاج المراجعة' || revStatus === 'يحتاج إعادة تجهيز') {
    return true;
  }
  if (hasOrderPendingProcurement(order)) {
    return true;
  }
  return false;
}

export interface SalesOrderDisplayState {
  primaryLabel: string;
  secondaryLabel?: string;
  revisionBadgeLabel?: string;
  badgeVariant: 'slate' | 'sky' | 'amber' | 'yellow' | 'blue' | 'indigo' | 'emerald' | 'orange' | 'red';
  isRePrepActive: boolean;
  isAwaitingReview: boolean;
}

/**
 * Decouples raw order status from revision/re-prep status so Sales never sees "تم التجهيز"
 * as the active current state while a revision awaits review or requires warehouse re-preparation.
 */
export function getSalesOrderDisplayState(order: Order): SalesOrderDisplayState {
  const revStatus = normalizeRevisionStatus(order.revisionAlert?.status);
  const hasPendingEdit = Boolean(order.pendingEditRequest);

  if (hasPendingEdit || revStatus === 'تعديل جديد يحتاج المراجعة') {
    return {
      primaryLabel: 'تعديل جديد ينتظر المراجعة',
      secondaryLabel:
        order.status === 'تم التجهيز'
          ? 'موقوف عن الشحن لحين مراجعة واعتماد التعديل'
          : `حالة التشغيل السابقة: ${order.status}`,
      revisionBadgeLabel: 'تعديل جديد ينتظر المراجعة',
      badgeVariant: 'red',
      isRePrepActive: false,
      isAwaitingReview: true,
    };
  }

  if (revStatus === 'يحتاج إعادة تجهيز') {
    return {
      primaryLabel: 'جاري إعادة التجهيز',
      secondaryLabel: 'تم اعتماد التعديل – إعادة التجهيز مطلوبة',
      revisionBadgeLabel: 'تم اعتماد التعديل – إعادة التجهيز مطلوبة',
      badgeVariant: 'amber',
      isRePrepActive: true,
      isAwaitingReview: false,
    };
  }

  if (revStatus === 'تمت إعادة التجهيز' && order.status === 'تم التجهيز') {
    return {
      primaryLabel: 'تم التجهيز بعد التعديل',
      secondaryLabel: 'جاهز للشحن بعد تنفيذ التعديلات',
      revisionBadgeLabel: 'تمت إعادة التجهيز',
      badgeVariant: 'blue',
      isRePrepActive: false,
      isAwaitingReview: false,
    };
  }

  if (revStatus === 'تمت مراجعة التعديل واعتماده' && order.status === 'تم التجهيز') {
    return {
      primaryLabel: 'تم التجهيز',
      secondaryLabel: 'تمت مراجعة التعديل واعتماده (بدون إعادة تجهيز)',
      revisionBadgeLabel: 'تمت مراجعة التعديل واعتماده',
      badgeVariant: 'blue',
      isRePrepActive: false,
      isAwaitingReview: false,
    };
  }

  const variantMap: Record<Order['status'], SalesOrderDisplayState['badgeVariant']> = {
    'بانتظار تأكيد العميل': 'slate',
    'طلب جديد': 'sky',
    'بانتظار التجهيز': 'amber',
    'جاري التجهيز': 'yellow',
    'تم التجهيز': 'blue',
    'تم الشحن': 'indigo',
    'تم التسليم': 'emerald',
    'مرتجع': 'orange',
    'رفض استلام': 'orange',
    'ملغي': 'red',
    'قيد التنفيذ': 'amber',
  };

  return {
    primaryLabel: order.status,
    badgeVariant: variantMap[order.status] || 'slate',
    isRePrepActive: false,
    isAwaitingReview: false,
  };
}

export function computeOrderStats(orders: Order[]): OrdersQueryStats {
  let activeOrdersCount = 0;
  let draftOrdersCount = 0;
  let preparedOrdersCount = 0;
  let shippedOrdersCount = 0;
  let deliveredOrdersCount = 0;
  let cancelledOrdersCount = 0;
  let returnedOrdersCount = 0;
  let totalRevenue = 0;
  let deliveredRevenue = 0;
  let totalCommission = 0;
  let pendingCommission = 0;
  let needsReviewCount = 0;
  let pendingProcurementCount = 0;

  for (const o of orders) {
    if (o.status === 'بانتظار تأكيد العميل') {
      draftOrdersCount += 1;
    } else if (o.status === 'ملغي') {
      cancelledOrdersCount += 1;
    } else if (o.status === 'مرتجع' || o.status === 'رفض استلام') {
      returnedOrdersCount += 1;
    } else if (o.status === 'تم التسليم') {
      deliveredOrdersCount += 1;
      deliveredRevenue += o.totalAmount;
      totalRevenue += o.totalAmount;
      totalCommission += o.commission;
    } else {
      activeOrdersCount += 1;
      totalRevenue += o.totalAmount;
      pendingCommission += o.commission;
      if (o.status === 'تم التجهيز') preparedOrdersCount += 1;
      if (o.status === 'تم الشحن') shippedOrdersCount += 1;
    }

    if (
      o.status !== 'ملغي' &&
      o.status !== 'بانتظار تأكيد العميل' &&
      isRevisionPendingReview(o)
    ) {
      needsReviewCount += 1;
    }

    if (
      o.status !== 'ملغي' &&
      o.status !== 'تم التسليم' &&
      hasOrderPendingProcurement(o)
    ) {
      pendingProcurementCount += 1;
    }
  }

  return {
    totalOrders: orders.length,
    activeOrdersCount,
    draftOrdersCount,
    preparedOrdersCount,
    shippedOrdersCount,
    deliveredOrdersCount,
    cancelledOrdersCount,
    returnedOrdersCount,
    totalRevenue,
    deliveredRevenue,
    totalCommission,
    pendingCommission,
    needsReviewCount,
    pendingProcurementCount,
  };
}
