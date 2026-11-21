import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit2,
  FileEdit,
  History,
  MapPin,
  Package,
  PackageCheck,
  PauseCircle,
  Phone,
  PlayCircle,
  Printer,
  RotateCcw,
  Save,
  Search,
  Truck,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ItemSourcingSource,
  Order,
  OrderItem,
  OrderReturnPrimaryReason,
  OrderStatus,
  Product,
  User,
  UserRole,
} from '../types';
import {
  apiClient,
  type ManageItemSourcingPayload,
  type OrderStatusTransitionPayload,
} from '../src/lib/api';
import {
  hasOrderPendingProcurement,
  isItemProcurementPending,
  isRevisionBlockingShipment,
  isRevisionPendingReview,
  normalizeRevisionStatus,
  VALID_SOURCING_SOURCES,
} from '../src/lib/date-utils';
import { UnifiedDateFilterBar, type DateFilterValue } from './UnifiedDateFilterBar';

interface OperationsTabProps {
  orders: Order[];
  products?: Product[];
  currentUser: User;
  onSelectOrder: (order: Order) => void;
  onEditOrder: (order: Order, mode?: 'edit' | 'edit-request' | 'approve-override') => void;
  onTransitionStatus: (
    orderId: string,
    status: OrderStatus,
    options?: OrderStatusTransitionPayload
  ) => Promise<void> | void;
  onReviewRevision: (
    orderId: string,
    status:
      | 'تمت مراجعة التعديل واعتماده'
      | 'يحتاج إعادة تجهيز'
      | 'تمت إعادة التجهيز'
      | 'تمت مراجعة التعديل'
      | 'التعديل جاهز لاستكمال التجهيز',
    note?: string
  ) => Promise<void> | void;
  onManageItemSourcing: (
    orderId: string,
    payload: ManageItemSourcingPayload
  ) => Promise<void> | void;
  onCancelOrder: (orderId: string, reason: string) => Promise<void> | void;
  onHoldOrder: (
    orderId: string,
    payload: { isHeld: boolean; reason?: string; notes?: string }
  ) => Promise<void> | void;
  onUpdateOperationalNotes: (orderId: string, operationalNotes: string) => Promise<void> | void;
  onResolveEditRequest: (orderId: string, action: 'approve' | 'reject') => Promise<void> | void;
}

type QueueTab =
  | 'active'
  | 'needs-review'
  | 'pending-procurement'
  | 'new'
  | 'waiting-prep'
  | 'in-prep'
  | 'prepared'
  | 'shipped'
  | 'held'
  | 'returned-cancelled'
  | 'delivered'
  | 'edit-requests';

const RETURN_REASONS: OrderReturnPrimaryReason[] = [
  'رفض الاستلام',
  'العميل لم يرد',
  'العنوان غير صحيح',
  'العميل طلب الإلغاء',
  'سبب آخر',
];

export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  'بانتظار تأكيد العميل': 'bg-slate-200 text-slate-800 border border-slate-300',
  'طلب جديد': 'bg-sky-100 text-sky-900 border border-sky-200',
  'بانتظار التجهيز': 'bg-amber-100 text-amber-900 border border-amber-200',
  'جاري التجهيز': 'bg-yellow-100 text-yellow-900 border border-yellow-200',
  'تم التجهيز': 'bg-blue-100 text-[#072F5F] border border-blue-200',
  'تم الشحن': 'bg-indigo-100 text-indigo-900 border border-indigo-200',
  'تم التسليم': 'bg-emerald-100 text-emerald-900 border border-emerald-200',
  'مرتجع': 'bg-orange-100 text-orange-900 border border-orange-200',
  'رفض استلام': 'bg-rose-100 text-rose-900 border border-rose-200',
  'ملغي': 'bg-red-100 text-red-900 border border-red-200',
  'قيد التنفيذ': 'bg-amber-100 text-amber-800 border border-amber-200',
};

function getRoleLabelAr(role: UserRole): string {
  if (role === 'owner') return 'المالك الرئيسي';
  if (role === 'admin') return 'مدير عام';
  if (role === 'supervisor') return 'مشرف';
  return 'فريق التشغيل / السيلز';
}

function formatWaitDuration(isoDate?: string): string {
  if (!isoDate) return '—';
  const diffMs = Math.max(0, Date.now() - new Date(isoDate).getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return `${days} يوم و ${hours} ساعة`;
  if (hours > 0) return `${hours} ساعة و ${mins} د`;
  return `${Math.max(1, mins)} دقيقة`;
}

function isOperationalActive(status: OrderStatus): boolean {
  return (
    status === 'طلب جديد' ||
    status === 'قيد التنفيذ' ||
    status === 'بانتظار التجهيز' ||
    status === 'جاري التجهيز' ||
    status === 'تم التجهيز' ||
    status === 'تم الشحن'
  );
}

export const OperationsTab: React.FC<OperationsTabProps> = ({
  orders,
  products = [],
  currentUser,
  onSelectOrder,
  onEditOrder,
  onTransitionStatus,
  onReviewRevision,
  onManageItemSourcing,
  onCancelOrder,
  onHoldOrder,
  onUpdateOperationalNotes,
  onResolveEditRequest,
}) => {
  const [queueTab, setQueueTab] = useState<QueueTab>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [governorateFilter, setGovernorateFilter] = useState('الكل');
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({
    preset: 'all',
    dateType: 'createdAt',
  });
  const [queriedOrders, setQueriedOrders] = useState<Order[] | null>(null);
  const [queriedTotalRevenue, setQueriedTotalRevenue] = useState<number | undefined>(undefined);
  const [isQueryLoading, setIsQueryLoading] = useState(false);

  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  // Item Sourcing Modal State
  const [sourcingModal, setSourcingModal] = useState<{
    order: Order;
    itemIndex: number;
    item: OrderItem;
  } | null>(null);
  const [sourcingAction, setSourcingAction] = useState<ManageItemSourcingPayload['action']>('receive_into_warehouse');
  const [sourcingSourceInput, setSourcingSourceInput] = useState<ItemSourcingSource>('توفير من المورد');
  const [sourcingQtyInput, setSourcingQtyInput] = useState<string>('');
  const [sourcingSupplierInput, setSourcingSupplierInput] = useState<string>('');
  const [sourcingNotesInput, setSourcingNotesInput] = useState<string>('');
  const [sourcingUnitCostInput, setSourcingUnitCostInput] = useState<string>('');
  const [sourcingTotalCostInput, setSourcingTotalCostInput] = useState<string>('');
  const [sourcingDateInput, setSourcingDateInput] = useState<string>(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
  );
  const [sourcingIdempotencyKey, setSourcingIdempotencyKey] = useState<string>('');
  const [sourcingError, setSourcingError] = useState<string | null>(null);
  const [isSavingSourcing, setIsSavingSourcing] = useState(false);

  // Modals State
  const [shippingModalOrder, setShippingModalOrder] = useState<Order | null>(null);
  const [carrierInput, setCarrierInput] = useState('');
  const [trackingInput, setTrackingInput] = useState('');
  const [shippingNotesInput, setShippingNotesInput] = useState('');

  const [deliveryModalOrder, setDeliveryModalOrder] = useState<Order | null>(null);
  const [deliveryNotesInput, setDeliveryNotesInput] = useState('');

  const [returnModal, setReturnModal] = useState<{
    order: Order;
    outcome: 'مرتجع' | 'رفض استلام';
  } | null>(null);
  const [returnReason, setReturnReason] = useState<OrderReturnPrimaryReason>('رفض الاستلام');
  const [returnDetails, setReturnDetails] = useState('');
  const [flagRefused, setFlagRefused] = useState(true);
  const [flagNoAnswer, setFlagNoAnswer] = useState(false);
  const [flagInvalidAddr, setFlagInvalidAddr] = useState(false);
  const [flagCustCancel, setFlagCustCancel] = useState(false);
  const [flagOther, setFlagOther] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const [holdModalOrder, setHoldModalOrder] = useState<Order | null>(null);
  const [holdReasonInput, setHoldReasonInput] = useState('');
  const [holdNotesInput, setHoldNotesInput] = useState('');
  const [holdError, setHoldError] = useState<string | null>(null);

  const [cancelModalOrder, setCancelModalOrder] = useState<Order | null>(null);
  const [cancelNoteInput, setCancelNoteInput] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [reviewingOrder, setReviewingOrder] = useState<Order | null>(null);
  const [isResolvingEdit, setIsResolvingEdit] = useState(false);

  const isStrictAdmin = currentUser.role === 'owner' || currentUser.role === 'admin';
  const isDateFilterActive =
    dateFilter.preset !== 'all' || Boolean(dateFilter.dateFrom) || Boolean(dateFilter.dateTo);

  useEffect(() => {
    if (!isDateFilterActive) {
      setQueriedOrders(null);
      setQueriedTotalRevenue(undefined);
      return;
    }

    let cancelled = false;
    setIsQueryLoading(true);
    apiClient
      .queryOrders({
        preset: dateFilter.preset,
        dateType: dateFilter.dateType,
        dateFrom: dateFilter.dateFrom,
        dateTo: dateFilter.dateTo,
      })
      .then((res) => {
        if (cancelled) return;
        setQueriedOrders(res.orders);
        setQueriedTotalRevenue(res.stats.totalRevenue);
      })
      .catch((err) => {
        console.error('Failed to query filtered operations orders:', err);
      })
      .finally(() => {
        if (!cancelled) setIsQueryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDateFilterActive, dateFilter.preset, dateFilter.dateType, dateFilter.dateFrom, dateFilter.dateTo, orders]);

  const effectiveOrders = useMemo(
    () => (isDateFilterActive && queriedOrders ? queriedOrders : orders),
    [isDateFilterActive, queriedOrders, orders]
  );

  const governorates = useMemo(() => {
    const set = new Set<string>();
    effectiveOrders.forEach((o) => {
      if (o.governorate?.trim()) set.add(o.governorate.trim());
    });
    return ['الكل', ...Array.from(set)];
  }, [effectiveOrders]);

  const needsRePrepOrReview = (o: Order): boolean => {
    if (o.status === 'بانتظار تأكيد العميل' || o.status === 'ملغي') return false;
    const revStatus = normalizeRevisionStatus(o.revisionAlert?.status);
    return (
      isRevisionPendingReview(o) ||
      revStatus === 'يحتاج إعادة تجهيز'
    );
  };

  const counts = useMemo(() => {
    return {
      active: effectiveOrders.filter((o) => isOperationalActive(o.status)).length,
      needsReview: effectiveOrders.filter((o) => needsRePrepOrReview(o)).length,
      pendingProcurement: effectiveOrders.filter(
        (o) =>
          o.status !== 'بانتظار تأكيد العميل' &&
          o.status !== 'ملغي' &&
          o.status !== 'تم التسليم' &&
          hasOrderPendingProcurement(o)
      ).length,
      new: effectiveOrders.filter((o) => o.status === 'طلب جديد' || o.status === 'قيد التنفيذ').length,
      waitingPrep: effectiveOrders.filter((o) => o.status === 'بانتظار التجهيز').length,
      inPrep: effectiveOrders.filter((o) => o.status === 'جاري التجهيز').length,
      prepared: effectiveOrders.filter((o) => o.status === 'تم التجهيز').length,
      shipped: effectiveOrders.filter((o) => o.status === 'تم الشحن').length,
      held: effectiveOrders.filter((o) => Boolean(o.holdInfo?.isHeld)).length,
      returnedCancelled: effectiveOrders.filter(
        (o) => o.status === 'مرتجع' || o.status === 'رفض استلام' || o.status === 'ملغي'
      ).length,
      delivered: effectiveOrders.filter((o) => o.status === 'تم التسليم').length,
      editRequests: effectiveOrders.filter(
        (o) =>
          Boolean(o.pendingEditRequest) &&
          (o.status === 'جاري التجهيز' || o.status === 'تم التجهيز')
      ).length,
    };
  }, [effectiveOrders]);

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return effectiveOrders.filter((o) => {
      // Never show unconfirmed customer drafts in Preparation / Operations queues
      if (o.status === 'بانتظار تأكيد العميل') return false;

      const matchesQuery =
        !q ||
        o.id.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerPhone.includes(q) ||
        o.salesRepName.toLowerCase().includes(q) ||
        (o.customerAddress || '').toLowerCase().includes(q) ||
        (o.governorate || '').toLowerCase().includes(q);

      if (!matchesQuery) return false;

      if (governorateFilter !== 'الكل' && (o.governorate || '').trim() !== governorateFilter) {
        return false;
      }

      switch (queueTab) {
        case 'active':
          return isOperationalActive(o.status);
        case 'needs-review':
          return needsRePrepOrReview(o);
        case 'pending-procurement':
          return (
            o.status !== 'ملغي' &&
            o.status !== 'تم التسليم' &&
            hasOrderPendingProcurement(o)
          );
        case 'new':
          return o.status === 'طلب جديد' || o.status === 'قيد التنفيذ';
        case 'waiting-prep':
          return o.status === 'بانتظار التجهيز';
        case 'in-prep':
          return o.status === 'جاري التجهيز';
        case 'prepared':
          return o.status === 'تم التجهيز';
        case 'shipped':
          return o.status === 'تم الشحن';
        case 'held':
          return Boolean(o.holdInfo?.isHeld);
        case 'returned-cancelled':
          return o.status === 'مرتجع' || o.status === 'رفض استلام' || o.status === 'ملغي';
        case 'delivered':
          return o.status === 'تم التسليم';
        case 'edit-requests':
          return (
            Boolean(o.pendingEditRequest) &&
            (o.status === 'جاري التجهيز' || o.status === 'تم التجهيز')
          );
        default:
          return true;
      }
    });
  }, [effectiveOrders, queueTab, searchTerm, governorateFilter]);

  const toggleHistory = (orderId: string) => {
    setExpandedHistoryIds((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const runTransition = async (
    orderId: string,
    status: OrderStatus,
    options?: OrderStatusTransitionPayload
  ) => {
    setBusyOrderId(orderId);
    try {
      await onTransitionStatus(orderId, status, options);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleSaveNotes = async (order: Order) => {
    const val = notesDrafts[order.id] ?? order.operationalNotes ?? '';
    setSavingNotesId(order.id);
    try {
      await onUpdateOperationalNotes(order.id, val);
    } finally {
      setSavingNotesId(null);
    }
  };

  const openShippingModal = (order: Order) => {
    setShippingModalOrder(order);
    setCarrierInput(order.shippingInfo?.carrier || '');
    setTrackingInput(order.shippingInfo?.trackingNumber || '');
    setShippingNotesInput('');
  };

  const handleConfirmShipping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shippingModalOrder) return;
    await runTransition(shippingModalOrder.id, 'تم الشحن', {
      shipping: {
        carrier: carrierInput.trim() || undefined,
        trackingNumber: trackingInput.trim() || undefined,
        notes: shippingNotesInput.trim() || undefined,
      },
    });
    setShippingModalOrder(null);
  };

  const openDeliveryModal = (order: Order) => {
    setDeliveryModalOrder(order);
    setDeliveryNotesInput('');
  };

  const handleConfirmDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryModalOrder) return;
    await runTransition(deliveryModalOrder.id, 'تم التسليم', {
      delivery: {
        notes: deliveryNotesInput.trim() || undefined,
      },
    });
    setDeliveryModalOrder(null);
  };

  const openReturnModal = (order: Order, outcome: 'مرتجع' | 'رفض استلام') => {
    setReturnModal({ order, outcome });
    const defaultReason: OrderReturnPrimaryReason =
      outcome === 'رفض استلام' ? 'رفض الاستلام' : 'سبب آخر';
    setReturnReason(defaultReason);
    setReturnDetails('');
    setFlagRefused(outcome === 'رفض استلام');
    setFlagNoAnswer(false);
    setFlagInvalidAddr(false);
    setFlagCustCancel(false);
    setFlagOther(outcome === 'مرتجع');
    setReturnError(null);
  };

  const handleSelectReturnReason = (reason: OrderReturnPrimaryReason) => {
    setReturnReason(reason);
    if (reason === 'رفض الاستلام') setFlagRefused(true);
    if (reason === 'العميل لم يرد') setFlagNoAnswer(true);
    if (reason === 'العنوان غير صحيح') setFlagInvalidAddr(true);
    if (reason === 'العميل طلب الإلغاء') setFlagCustCancel(true);
    if (reason === 'سبب آخر') setFlagOther(true);
  };

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModal) return;
    if (returnDetails.trim().length < 3) {
      setReturnError('يجب كتابة ملاحظة تفصيلية واضحة (3 أحرف على الأقل) توضح سبب الإرجاع أو الرفض.');
      return;
    }
    setReturnError(null);
    await runTransition(returnModal.order.id, returnModal.outcome, {
      returnDetails: {
        reason: returnReason,
        details: returnDetails.trim(),
        customerRefusedDelivery: flagRefused,
        customerNoAnswer: flagNoAnswer,
        invalidAddress: flagInvalidAddr,
        customerRequestedCancel: flagCustCancel,
        otherReason: flagOther,
      },
    });
    setReturnModal(null);
  };

  const openHoldModal = (order: Order) => {
    setHoldModalOrder(order);
    setHoldReasonInput(order.holdInfo?.reason || '');
    setHoldNotesInput('');
    setHoldError(null);
  };

  const handleConfirmHold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holdModalOrder) return;
    const isCurrentlyHeld = Boolean(holdModalOrder.holdInfo?.isHeld);
    if (!isCurrentlyHeld && holdReasonInput.trim().length < 2) {
      setHoldError('يرجى كتابة سبب تعليق الطلب.');
      return;
    }
    setBusyOrderId(holdModalOrder.id);
    try {
      await onHoldOrder(holdModalOrder.id, {
        isHeld: !isCurrentlyHeld,
        reason: !isCurrentlyHeld ? holdReasonInput.trim() : undefined,
        notes: holdNotesInput.trim() || undefined,
      });
      setHoldModalOrder(null);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalOrder) return;
    if (cancelNoteInput.trim().length < 3) {
      setCancelError('يجب كتابة سبب واضح للإلغاء (3 أحرف على الأقل).');
      return;
    }
    setCancelError(null);
    setBusyOrderId(cancelModalOrder.id);
    try {
      await onCancelOrder(cancelModalOrder.id, cancelNoteInput.trim());
      setCancelModalOrder(null);
      setCancelNoteInput('');
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const openSourcingModal = (order: Order, itemIndex: number, item: OrderItem) => {
    const pend =
      typeof item.pendingQty === 'number'
        ? item.pendingQty
        : item.procurementStatus === 'pending'
          ? item.quantity
          : 0;
    const defaultAction: ManageItemSourcingPayload['action'] =
      pend > 0 ? 'receive_into_warehouse' : 'set_source';

    setSourcingModal({ order, itemIndex, item });
    setSourcingAction(defaultAction);
    setSourcingSourceInput(item.sourcingSource || 'توفير من المورد');
    setSourcingQtyInput(pend > 0 ? String(pend) : String(item.quantity));
    setSourcingSupplierInput(item.supplierName || '');
    setSourcingNotesInput(item.sourcingNotes || '');
    setSourcingUnitCostInput('');
    setSourcingTotalCostInput('');
    setSourcingDateInput(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }));
    setSourcingIdempotencyKey(
      `src-${order.id}-${itemIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    );
    setSourcingError(null);
  };

  const handleSubmitSourcing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourcingModal) return;
    setSourcingError(null);

    const parsedQty = Number(sourcingQtyInput);
    if (sourcingAction !== 'set_source' && (!Number.isFinite(parsedQty) || parsedQty <= 0)) {
      setSourcingError('يرجى إدخال كمية صالحة أكبر من صفر.');
      return;
    }

    const parsedUnitCost =
      sourcingUnitCostInput.trim() !== '' ? Number(sourcingUnitCostInput) : null;
    const parsedTotalCost =
      sourcingTotalCostInput.trim() !== '' ? Number(sourcingTotalCostInput) : null;

    if (parsedUnitCost !== null && (!Number.isFinite(parsedUnitCost) || parsedUnitCost < 0)) {
      setSourcingError('سعر التكلفة للوحدة يجب أن يكون رقماً غير سالب.');
      return;
    }
    if (parsedTotalCost !== null && (!Number.isFinite(parsedTotalCost) || parsedTotalCost < 0)) {
      setSourcingError('إجمالي تكلفة التوريد يجب أن يكون رقماً غير سالب.');
      return;
    }

    const supportsCost =
      sourcingAction === 'receive_into_warehouse' || sourcingAction === 'fulfill_external_direct';

    setIsSavingSourcing(true);
    try {
      await onManageItemSourcing(sourcingModal.order.id, {
        itemIndex: sourcingModal.itemIndex,
        action: sourcingAction,
        ...(sourcingAction === 'set_source'
          ? { sourcingSource: sourcingSourceInput }
          : { quantity: parsedQty }),
        ...(sourcingSupplierInput.trim() ? { supplierName: sourcingSupplierInput.trim() } : {}),
        ...(sourcingNotesInput.trim() ? { notes: sourcingNotesInput.trim() } : {}),
        ...(supportsCost && parsedUnitCost !== null ? { unitCost: parsedUnitCost } : {}),
        ...(supportsCost && parsedTotalCost !== null ? { totalSourcingCost: parsedTotalCost } : {}),
        ...(supportsCost && sourcingDateInput ? { dateSecured: sourcingDateInput } : {}),
        ...(sourcingAction !== 'set_source' && sourcingIdempotencyKey
          ? { idempotencyKey: sourcingIdempotencyKey }
          : {}),
      });
      setSourcingModal(null);
    } catch (err: unknown) {
      setSourcingError(err instanceof Error ? err.message : 'تعذر تنفيذ عملية التوفير.');
    } finally {
      setIsSavingSourcing(false);
    }
  };

  const handleReviewRevisionClick = async (
    orderId: string,
    status:
      | 'تمت مراجعة التعديل واعتماده'
      | 'يحتاج إعادة تجهيز'
      | 'تمت إعادة التجهيز'
      | 'تمت مراجعة التعديل'
      | 'التعديل جاهز لاستكمال التجهيز'
  ) => {
    setBusyOrderId(orderId);
    try {
      await onReviewRevision(orderId, status);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleResolveEdit = async (action: 'approve' | 'reject') => {
    if (!reviewingOrder) return;
    setIsResolvingEdit(true);
    try {
      await onResolveEditRequest(reviewingOrder.id, action);
      setReviewingOrder(null);
    } finally {
      setIsResolvingEdit(false);
    }
  };

  const canEditOrderInline = (order: Order) => {
    if (isStrictAdmin) return true;
    return (
      order.status === 'طلب جديد' ||
      order.status === 'قيد التنفيذ' ||
      order.status === 'بانتظار التجهيز' ||
      order.status === 'جاري التجهيز' ||
      order.status === 'تم التجهيز'
    );
  };

  const queueItems: { id: QueueTab; label: string; count: number }[] = [
    { id: 'active', label: 'الطلبات النشطة', count: counts.active },
    ...(counts.needsReview > 0
      ? [{ id: 'needs-review' as QueueTab, label: 'مراجعة / إعادة تجهيز', count: counts.needsReview }]
      : []),
    { id: 'pending-procurement', label: 'منتجات بانتظار التوفير', count: counts.pendingProcurement },
    { id: 'new', label: 'طلب جديد', count: counts.new },
    { id: 'waiting-prep', label: 'بانتظار التجهيز', count: counts.waitingPrep },
    { id: 'in-prep', label: 'جاري التجهيز', count: counts.inPrep },
    { id: 'prepared', label: 'تم التجهيز', count: counts.prepared },
    { id: 'shipped', label: 'تم الشحن (متابعة)', count: counts.shipped },
    { id: 'held', label: 'معلقة', count: counts.held },
    { id: 'returned-cancelled', label: 'مرتجع / رفض / ملغي', count: counts.returnedCancelled },
    { id: 'delivered', label: 'تم التسليم', count: counts.delivered },
    { id: 'edit-requests', label: 'طلبات التعديل', count: counts.editRequests },
  ];

  return (
    <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300 font-cairo">
      {/* Urgent Revision Review Banner (Blocks Shipping Until Reviewed) */}
      {counts.needsReview > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl sm:rounded-3xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-600 text-white rounded-xl shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="font-black text-sm text-red-900">
                تنبيه تعديل فاتورة: يوجد {counts.needsReview} طلب تم تعديله بعد التأكيد ويحتاج مراجعة التجهيز!
              </p>
              <p className="text-xs font-bold text-red-700 mt-0.5">
                لن يُسمح بشحن أي طلب معدّل قبل مراجعة الفروقات وتأكيد جاهزيته للتجهيز.
              </p>
            </div>
          </div>
          <button
            onClick={() => setQueueTab(queueTab === 'needs-review' ? 'active' : 'needs-review')}
            className="min-h-[42px] px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black whitespace-nowrap transition-all"
          >
            {queueTab === 'needs-review' ? 'عرض كل الطلبات النشطة' : 'عرض الطلبات المعدّلة'}
          </button>
        </div>
      )}

      {/* Pending Edit Requests Banner */}
      {counts.editRequests > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl sm:rounded-3xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#0A468C] text-white rounded-xl shrink-0">
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <p className="font-black text-sm text-[#072F5F]">
                يوجد {counts.editRequests} طلب تعديل فواتير بانتظار المراجعة
              </p>
              <p className="text-xs font-bold text-slate-600 mt-0.5">
                طلبات تعديل واردة من فريق السيلز على طلبات في مرحلة التجهيز
              </p>
            </div>
          </div>
          <button
            onClick={() => setQueueTab(queueTab === 'edit-requests' ? 'active' : 'edit-requests')}
            className="min-h-[42px] px-4 py-2 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl text-xs font-black whitespace-nowrap transition-all"
          >
            {queueTab === 'edit-requests' ? 'العودة للطلبات النشطة' : 'عرض طلبات التعديل'}
          </button>
        </div>
      )}

      {/* Unified Cairo Date Filter */}
      <UnifiedDateFilterBar
        value={dateFilter}
        onChange={setDateFilter}
        totalMatched={filteredOrders.length}
        totalRevenue={isDateFilterActive ? queriedTotalRevenue : undefined}
        loading={isQueryLoading}
        compact
      />

      {/* Search, Governorate Filter & Grouped Queue Switcher */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث برقم الفاتورة، اسم العميل، الهاتف، العنوان، أو السيلز..."
              className="w-full min-h-[48px] pr-12 pl-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200/80 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
            />
          </div>

          <div className="md:w-56">
            <select
              value={governorateFilter}
              onChange={(e) => setGovernorateFilter(e.target.value)}
              className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200/80 focus:border-[#0A468C] text-sm text-slate-900"
              aria-label="تصفية حسب المحافظة"
            >
              {governorates.map((gov) => (
                <option key={gov} value={gov}>
                  {gov === 'الكل' ? 'كل المحافظات' : gov}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Queue Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {queueItems.map((tab) => {
            const isSelected = queueTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setQueueTab(tab.id)}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#0A468C] text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[11px] font-black tabular-nums ${
                    isSelected ? 'bg-white text-[#072F5F]' : 'bg-white text-slate-700'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Unified Operational Order Cards */}
      <div className="space-y-4">
        {filteredOrders.map((order) => {
          const isHeld = Boolean(order.holdInfo?.isHeld);
          const isBusy = busyOrderId === order.id;
          const isHistoryExpanded = Boolean(expandedHistoryIds[order.id]);
          const notesValue = notesDrafts[order.id] ?? order.operationalNotes ?? '';
          const notesDirty =
            notesDrafts[order.id] !== undefined &&
            notesDrafts[order.id] !== (order.operationalNotes ?? '');
          const isClosed = order.status === 'تم التسليم' || order.status === 'ملغي';
          const revStatus = normalizeRevisionStatus(order.revisionAlert?.status);
          const needsRevisionReview = revStatus === 'تعديل جديد يحتاج المراجعة';
          const needsRePrep = revStatus === 'يحتاج إعادة تجهيز';
          const hasPendingProcurement = hasOrderPendingProcurement(order);
          const shipmentBlocked = isRevisionBlockingShipment(order);
          const latestRevision = order.revisions && order.revisions.length > 0 ? order.revisions[0] : null;

          return (
            <div
              key={order.id}
              className={`bg-white rounded-3xl p-4 sm:p-6 shadow-sm space-y-4 ${
                needsRevisionReview
                  ? 'border-2 border-red-400'
                  : needsRePrep || hasPendingProcurement
                    ? 'border-2 border-amber-400'
                    : 'border border-slate-200/80'
              }`}
            >
              {/* Top Row: ID, Date, Live Wait, Customer, Status Badges */}
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 pb-3.5 border-b border-slate-100">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                    <span className="font-mono font-black text-[#072F5F] bg-slate-100 px-2.5 py-0.5 rounded-lg">
                      #{order.id}
                    </span>
                    {(order.version || 1) > 1 && (
                      <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-lg text-[11px] font-black tabular-nums">
                        نسخة v{order.version}
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {new Date(order.createdAt).toLocaleString('ar-EG')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-[#0A468C] font-black tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      انتظار: {formatWaitDuration(order.createdAt)}
                    </span>
                  </div>

                  <h3 className="text-lg sm:text-xl font-black text-slate-900">
                    {order.customerName}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-600">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Phone className="w-3.5 h-3.5 text-[#0A468C]" />
                      <span dir="ltr">{order.customerPhone || 'بدون هاتف'}</span>
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#0A468C]" />
                      <span>
                        {order.governorate ? `${order.governorate} — ` : ''}
                        {order.customerAddress || 'الاستلام من المقر'}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="inline-flex items-center gap-1 text-slate-700">
                      <UserCheck className="w-3.5 h-3.5 text-[#0A468C]" />
                      السيلز: {order.salesRepName}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {isHeld && (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-100 text-amber-950 border border-amber-300">
                      <PauseCircle className="w-3.5 h-3.5" />
                      معلق
                    </span>
                  )}
                  {needsRePrep && (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-100 text-amber-950 border border-amber-300">
                      إعادة تجهيز بسبب تعديل
                    </span>
                  )}
                  {hasPendingProcurement && (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-50 text-amber-900 border border-amber-300">
                      بانتظار توفير أصناف
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap ${
                      ORDER_STATUS_BADGE[order.status]
                    }`}
                  >
                    {order.status}
                  </span>
                  <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-[#072F5F] text-xs font-black tabular-nums">
                    {order.totalAmount.toLocaleString()} ج.م
                  </span>
                </div>
              </div>

              {/* Post-Confirmation Invoice Revision Alert & Diff Comparison */}
              {order.revisionAlert &&
                revStatus !== 'لا يوجد تعديل معلق' && (
                <div
                  className={`rounded-2xl p-4 text-xs space-y-2.5 border ${
                    needsRevisionReview
                      ? 'bg-red-50 border-red-300'
                      : needsRePrep
                        ? 'bg-amber-50 border-amber-300'
                        : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <p
                        className={`font-black flex items-center gap-1.5 ${
                          needsRevisionReview
                            ? 'text-red-900'
                            : needsRePrep
                              ? 'text-amber-950'
                              : 'text-emerald-900'
                        }`}
                      >
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        {revStatus} (نسخة v{order.revisionAlert.latestVersion})
                      </p>
                      <p className="font-bold text-slate-700">
                        تعديل بواسطة: {order.revisionAlert.editedByName} ·{' '}
                        {new Date(order.revisionAlert.editedAt).toLocaleString('ar-EG')}
                      </p>
                      <p className="font-bold text-slate-800">{order.revisionAlert.summary}</p>
                    </div>

                    {needsRevisionReview && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void handleReviewRevisionClick(order.id, 'تمت مراجعة التعديل واعتماده')
                          }
                          className="min-h-[38px] px-3 py-1.5 bg-white text-[#072F5F] border border-blue-300 hover:bg-blue-50 rounded-xl font-black text-xs"
                        >
                          اعتماد التعديل
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void handleReviewRevisionClick(
                              order.id,
                              'يحتاج إعادة تجهيز'
                            )
                          }
                          className="min-h-[38px] px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-xs"
                        >
                          تحويل لإعادة التجهيز
                        </button>
                      </div>
                    )}

                    {needsRePrep && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy || hasPendingProcurement}
                          onClick={() =>
                            void handleReviewRevisionClick(order.id, 'تمت إعادة التجهيز')
                          }
                          className="min-h-[38px] px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs disabled:opacity-50"
                        >
                          تأكيد إتمام إعادة التجهيز
                        </button>
                      </div>
                    )}
                  </div>

                  {latestRevision && (
                    <div className="bg-white/90 rounded-xl p-3 border border-slate-200/80 space-y-1">
                      {latestRevision.reason && (
                        <p className="font-black text-slate-800">
                          سبب التعديل: {latestRevision.reason}
                        </p>
                      )}
                      {latestRevision.addedItems.map((it, idx) => (
                        <p key={`a-${idx}`} className="font-bold text-emerald-800">
                          + أُضيف: {it.productName} ({it.grade}) — {it.newQuantity.toLocaleString()} {it.unit || 'mg'} ×{' '}
                          {it.newPrice} ج.م
                        </p>
                      ))}
                      {latestRevision.removedItems.map((it, idx) => (
                        <p key={`r-${idx}`} className="font-bold text-red-700">
                          - أُزيل: {it.productName} ({it.grade}) — كان {it.oldQuantity.toLocaleString()} {it.unit || 'mg'}
                        </p>
                      ))}
                      {latestRevision.modifiedItems.map((it, idx) => (
                        <p key={`m-${idx}`} className="font-bold text-amber-900">
                          ~ عُدّل: {it.productName} ({it.grade}) — الكمية: {it.oldQuantity.toLocaleString()} ←{' '}
                          {it.newQuantity.toLocaleString()} {it.unit || 'mg'} (
                          {it.quantityDelta > 0 ? `+${it.quantityDelta}` : it.quantityDelta} {it.unit || 'mg'})
                        </p>
                      ))}
                      <p className="font-black text-[#072F5F] pt-1 border-t border-slate-100 tabular-nums">
                        الإجمالي: {latestRevision.previousTotal.toLocaleString()} ←{' '}
                        {latestRevision.newTotal.toLocaleString()} ج.م
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Cancellation Archive Banner */}
              {order.status === 'ملغي' && order.cancellationInfo && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 text-xs space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-red-900">
                      طلب ملغي (مرحلة الإلغاء: {order.cancellationInfo.stageAtCancellation})
                    </p>
                    {order.cancellationInfo.notifiedOperations && (
                      <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-800 font-black text-[11px]">
                        تم إشعار التجهيز بالإلغاء
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-red-800">السبب: {order.cancellationInfo.reason}</p>
                  <p className="font-bold text-red-700/80 text-[11px]">
                    ألغي بواسطة: {order.cancellationInfo.cancelledByName} ·{' '}
                    {new Date(order.cancellationInfo.cancelledAt).toLocaleString('ar-EG')}
                  </p>
                </div>
              )}

              {/* Pending Edit Request Alert inside card */}
              {order.pendingEditRequest &&
                (order.status === 'جاري التجهيز' || order.status === 'تم التجهيز') && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="space-y-0.5 text-xs">
                      <p className="font-black text-[#072F5F] flex items-center gap-1.5">
                        <FileEdit className="w-4 h-4 text-[#0A468C]" />
                        طلب تعديل معلق من {order.pendingEditRequest.requestedByName}
                      </p>
                      {order.pendingEditRequest.reason && (
                        <p className="font-bold text-slate-700">
                          السبب: {order.pendingEditRequest.reason}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setReviewingOrder(order)}
                      className="min-h-[40px] px-4 py-2 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl text-xs font-black shrink-0"
                    >
                      مراجعة واعتماد / رفض
                    </button>
                  </div>
                )}

              {/* Hold Banner */}
              {isHeld && order.holdInfo && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs space-y-1">
                  <p className="font-black text-amber-950 flex items-center gap-1.5">
                    <PauseCircle className="w-4 h-4 text-amber-700" />
                    الطلب معلق في مرحلة "{order.holdInfo.heldAtStage}" · سبب التعليق:{' '}
                    {order.holdInfo.reason}
                  </p>
                  <p className="font-bold text-amber-800">
                    بواسطة: {order.holdInfo.heldByName} ·{' '}
                    {new Date(order.holdInfo.heldAt).toLocaleString('ar-EG')}
                    {order.holdInfo.notes ? ` · ${order.holdInfo.notes}` : ''}
                  </p>
                </div>
              )}

              {/* Return / Refusal Banner */}
              {order.returnInfo && (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3.5 text-xs space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-orange-950">
                      نتيجة الطلب: {order.returnInfo.outcome} — السبب الرئيسي:{' '}
                      {order.returnInfo.reason}
                    </p>
                    <span className="font-bold text-orange-800 tabular-nums">
                      {order.returnInfo.recordedByName} ·{' '}
                      {new Date(order.returnInfo.recordedAt).toLocaleString('ar-EG')}
                    </span>
                  </div>
                  <p className="font-bold text-slate-800">{order.returnInfo.details}</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] font-bold text-orange-900">
                    {order.returnInfo.customerRefusedDelivery && (
                      <span className="bg-white/80 px-2 py-0.5 rounded-lg border border-orange-200">
                        رفض الاستلام
                      </span>
                    )}
                    {order.returnInfo.customerNoAnswer && (
                      <span className="bg-white/80 px-2 py-0.5 rounded-lg border border-orange-200">
                        العميل لم يرد
                      </span>
                    )}
                    {order.returnInfo.invalidAddress && (
                      <span className="bg-white/80 px-2 py-0.5 rounded-lg border border-orange-200">
                        العنوان غير صحيح
                      </span>
                    )}
                    {order.returnInfo.customerRequestedCancel && (
                      <span className="bg-white/80 px-2 py-0.5 rounded-lg border border-orange-200">
                        العميل طلب الإلغاء
                      </span>
                    )}
                    {order.returnInfo.otherReason && (
                      <span className="bg-white/80 px-2 py-0.5 rounded-lg border border-orange-200">
                        سبب آخر
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Items + Shipping/Delivery Info + Notes Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                {/* Items List */}
                <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/70 space-y-2">
                  <div className="flex items-center justify-between text-xs font-black text-[#072F5F]">
                    <span className="flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-[#0A468C]" />
                      تفاصيل المنتجات ({order.items.length})
                    </span>
                    <span className="tabular-nums text-slate-600">
                      الشحن: {order.shippingCost.toLocaleString()} ج.م
                    </span>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {order.items.map((item, idx) => {
                      const isPendingItem = isItemProcurementPending(item);
                      const pendQty = item.pendingQty ?? (isPendingItem ? item.quantity : 0);
                      const wareQty = item.warehouseDeductedQty ?? 0;
                      const extQty = item.externalSuppliedQty ?? 0;
                      const itemUnit = item.unit || 'mg';

                      return (
                        <div
                          key={idx}
                          className={`bg-white px-3 py-2.5 rounded-xl border text-xs space-y-1.5 ${
                            isPendingItem ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-black text-slate-900 truncate">{item.productName}</p>
                              <p className="text-[11px] font-bold text-[#0A468C]">
                                {item.productCode ? `#${item.productCode} · ` : ''}
                                {item.categoryName ? `${item.categoryName} · ` : ''}
                                {item.grade}
                                {item.isCustom ? ' · طلب مخصوص' : ''}
                                {item.sourcingSource ? ` · ${item.sourcingSource}` : ''}
                              </p>
                            </div>
                            <span className="font-black text-[#072F5F] tabular-nums whitespace-nowrap">
                              {item.quantity.toLocaleString()} {itemUnit} × {item.price} ج.م
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-100 text-[11px]">
                            <div className="flex flex-wrap items-center gap-1.5 font-bold">
                              {wareQty > 0 && (
                                <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-[#072F5F] tabular-nums">
                                  من المخزن: {wareQty.toLocaleString()} {itemUnit}
                                </span>
                              )}
                              {extQty > 0 && (
                                <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 tabular-nums">
                                  خارجي: {extQty.toLocaleString()} {itemUnit}
                                </span>
                              )}
                              {pendQty > 0 && (
                                <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 font-black tabular-nums">
                                  بانتظار التوفير: {pendQty.toLocaleString()} {itemUnit}
                                </span>
                              )}
                              {item.supplierName && (
                                <span className="text-slate-600">المورد: {item.supplierName}</span>
                              )}
                            </div>

                            {!isClosed && (
                              <button
                                type="button"
                                onClick={() => openSourcingModal(order, idx, item)}
                                className={`min-h-[30px] px-2.5 py-1 rounded-lg font-black text-[11px] transition-all ${
                                  pendQty > 0
                                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                    : 'bg-slate-100 hover:bg-blue-50 text-[#072F5F]'
                                }`}
                              >
                                {pendQty > 0 ? 'توفير الصنف الآن' : 'إدارة التوفير'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Notes, Shipping Info & Operational Notes */}
                <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/70 space-y-3 text-xs">
                  <div>
                    <span className="font-black text-slate-600 block mb-0.5">ملاحظات السيلز:</span>
                    <p className="font-bold text-slate-800">
                      {order.customerNotes?.trim() || 'لا توجد ملاحظات مسجلة من السيلز'}
                    </p>
                  </div>

                  {order.shippingInfo && (
                    <div className="pt-2 border-t border-slate-200/80 space-y-0.5">
                      <span className="font-black text-indigo-900 block">بيانات الشحن:</span>
                      <p className="font-bold text-slate-700">
                        {order.shippingInfo.carrier || 'شحن مباشر'}
                        {order.shippingInfo.trackingNumber
                          ? ` · بوليصة: ${order.shippingInfo.trackingNumber}`
                          : ''}
                        {' · '}
                        {new Date(order.shippingInfo.shippedAt).toLocaleString('ar-EG')} (
                        {order.shippingInfo.shippedByName})
                      </p>
                      {order.shippingInfo.notes && (
                        <p className="font-bold text-slate-600">{order.shippingInfo.notes}</p>
                      )}
                    </div>
                  )}

                  {order.deliveryInfo && (
                    <div className="pt-2 border-t border-slate-200/80 space-y-0.5">
                      <span className="font-black text-emerald-800 block">تأكيد التسليم:</span>
                      <p className="font-bold text-slate-700">
                        {order.deliveryInfo.confirmedByName} ·{' '}
                        {new Date(order.deliveryInfo.deliveredAt).toLocaleString('ar-EG')}
                      </p>
                      {order.deliveryInfo.notes && (
                        <p className="font-bold text-slate-600">{order.deliveryInfo.notes}</p>
                      )}
                    </div>
                  )}

                  {/* Inline Operational Notes Editor */}
                  <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                    <label className="font-black text-[#072F5F] block">
                      الملاحظات التشغيلية (التجهيز والشحن):
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={notesValue}
                        onChange={(e) =>
                          setNotesDrafts((prev) => ({ ...prev, [order.id]: e.target.value }))
                        }
                        placeholder="أضف ملاحظة تشغيلية للتجهيز أو المندوب..."
                        className="flex-1 min-h-[40px] px-3 py-1.5 bg-white rounded-xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-xs text-slate-900"
                      />
                      <button
                        type="button"
                        disabled={!notesDirty || savingNotesId === order.id}
                        onClick={() => void handleSaveNotes(order)}
                        className={`min-h-[40px] px-3 rounded-xl font-black text-xs flex items-center gap-1 transition-all shrink-0 ${
                          notesDirty
                            ? 'bg-[#0A468C] text-white hover:bg-[#072F5F]'
                            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <Save className="w-3.5 h-3.5" />
                        حفظ
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status History Collapsible Timeline */}
              {order.statusHistory && order.statusHistory.length > 0 && (
                <div className="border border-slate-200/80 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleHistory(order.id)}
                    className="w-full min-h-[42px] px-4 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-black text-[#072F5F] transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <History className="w-4 h-4 text-[#0A468C]" />
                      سجل تغييرات الحالة ({order.statusHistory.length})
                    </span>
                    {isHistoryExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {isHistoryExpanded && (
                    <div className="p-3.5 bg-white space-y-2 max-h-60 overflow-y-auto">
                      {order.statusHistory.map((entry, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs py-1.5 border-b last:border-b-0 border-slate-100"
                        >
                          <div className="space-y-0.5">
                            <p className="font-black text-slate-900">
                              {entry.fromStatus ? `${entry.fromStatus} ← ${entry.toStatus}` : entry.toStatus}
                            </p>
                            {entry.note && (
                              <p className="font-bold text-slate-600">{entry.note}</p>
                            )}
                          </div>
                          <div className="text-[11px] font-bold text-slate-500 sm:text-left tabular-nums">
                            {entry.changedByName} ({getRoleLabelAr(entry.changedByRole)}) ·{' '}
                            {new Date(entry.changedAt).toLocaleString('ar-EG')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Operational Action Buttons Row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={() => onSelectOrder(order)}
                  className="min-h-[44px] px-3.5 py-2 bg-blue-50 text-[#0A468C] hover:bg-[#0A468C] hover:text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  عرض الفاتورة
                </button>

                {canEditOrderInline(order) && (
                  <button
                    onClick={() => onEditOrder(order, 'edit')}
                    className="min-h-[44px] px-3.5 py-2 bg-slate-100 text-[#072F5F] hover:bg-blue-100 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                  >
                    <Edit2 className="w-4 h-4" />
                    تعديل الفاتورة
                  </button>
                )}

                {/* Forward lifecycle buttons */}
                {(order.status === 'طلب جديد' || order.status === 'قيد التنفيذ') && (
                  <>
                    <button
                      disabled={isBusy}
                      onClick={() => void runTransition(order.id, 'بانتظار التجهيز')}
                      className="min-h-[44px] px-3.5 py-2 bg-amber-100 text-amber-950 hover:bg-amber-200 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                    >
                      <Clock className="w-4 h-4" />
                      بانتظار التجهيز
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => void runTransition(order.id, 'جاري التجهيز')}
                      className="min-h-[44px] px-3.5 py-2 bg-[#0A468C] text-white hover:bg-[#072F5F] rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                    >
                      <Package className="w-4 h-4" />
                      بدء التجهيز
                    </button>
                  </>
                )}

                {order.status === 'بانتظار التجهيز' && (
                  <button
                    disabled={isBusy}
                    onClick={() => void runTransition(order.id, 'جاري التجهيز')}
                    className="min-h-[44px] px-3.5 py-2 bg-[#0A468C] text-white hover:bg-[#072F5F] rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                  >
                    <Package className="w-4 h-4" />
                    بدء التجهيز
                  </button>
                )}

                {(order.status === 'جاري التجهيز' || order.status === 'قيد التنفيذ') && (
                  <button
                    disabled={isBusy || hasPendingProcurement}
                    onClick={() => void runTransition(order.id, 'تم التجهيز')}
                    title={
                      hasPendingProcurement
                        ? 'موقوف لحين توفير جميع الأصناف المعلقة في الطلب'
                        : 'إتمام التجهيز'
                    }
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                      hasPendingProcurement
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : 'bg-blue-100 text-[#072F5F] hover:bg-[#0A468C] hover:text-white'
                    }`}
                  >
                    <PackageCheck className="w-4 h-4" />
                    {hasPendingProcurement ? 'التجهيز موقوف (توجد أصناف بانتظار التوفير)' : 'تم التجهيز'}
                  </button>
                )}

                {(order.status === 'تم التجهيز' || order.status === 'قيد التنفيذ') && (
                  <button
                    disabled={isBusy || shipmentBlocked}
                    onClick={() => openShippingModal(order)}
                    title={
                      hasPendingProcurement
                        ? 'موقوف لوجود أصناف بانتظار التوفير'
                        : shipmentBlocked
                          ? 'موقوف لحين اعتماد التعديل أو إتمام إعادة التجهيز'
                          : 'تسجيل الشحن'
                    }
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                      shipmentBlocked
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : 'bg-indigo-100 text-indigo-900 hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    <Truck className="w-4 h-4" />
                    {hasPendingProcurement
                      ? 'الشحن موقوف لحين توفير الأصناف'
                      : shipmentBlocked
                        ? 'الشحن موقوف لحين مراجعة/إعادة تجهيز التعديل'
                        : 'تسجيل الشحن'}
                  </button>
                )}

                {(order.status === 'تم الشحن' || order.status === 'قيد التنفيذ') && (
                  <>
                    <button
                      disabled={isBusy}
                      onClick={() => openDeliveryModal(order)}
                      className="min-h-[44px] px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      تم التسليم
                    </button>

                    <button
                      disabled={isBusy}
                      onClick={() => openReturnModal(order, 'رفض استلام')}
                      className="min-h-[44px] px-3.5 py-2 bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                    >
                      <XCircle className="w-4 h-4" />
                      رفض استلام
                    </button>

                    <button
                      disabled={isBusy}
                      onClick={() => openReturnModal(order, 'مرتجع')}
                      className="min-h-[44px] px-3.5 py-2 bg-orange-50 text-orange-800 border border-orange-200 hover:bg-orange-100 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-4 h-4" />
                      مرتجع
                    </button>
                  </>
                )}

                {/* Re-prepare from returned / refused / shipped */}
                {(order.status === 'مرتجع' ||
                  order.status === 'رفض استلام' ||
                  order.status === 'تم الشحن') && (
                  <button
                    disabled={isBusy}
                    onClick={() =>
                      void runTransition(order.id, 'بانتظار التجهيز', {
                        note: 'إعادة الطلب للتجهيز (بدون إعادة خصم المخزون)',
                      })
                    }
                    className="min-h-[44px] px-3.5 py-2 bg-sky-50 text-sky-900 border border-sky-200 hover:bg-sky-100 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    إعادة للتجهيز
                  </button>
                )}

                {/* Hold / Unhold for active stages */}
                {!isClosed &&
                  order.status !== 'مرتجع' &&
                  order.status !== 'رفض استلام' && (
                    <button
                      disabled={isBusy}
                      onClick={() => openHoldModal(order)}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                        isHeld
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      {isHeld ? (
                        <>
                          <PlayCircle className="w-4 h-4" />
                          فك التعليق
                        </>
                      ) : (
                        <>
                          <PauseCircle className="w-4 h-4" />
                          تعليق الطلب
                        </>
                      )}
                    </button>
                  )}

                {/* Cancel for pre-shipment stages */}
                {(order.status === 'طلب جديد' ||
                  order.status === 'قيد التنفيذ' ||
                  order.status === 'بانتظار التجهيز' ||
                  order.status === 'جاري التجهيز' ||
                  order.status === 'تم التجهيز') && (
                  <button
                    disabled={isBusy}
                    onClick={() => {
                      setCancelModalOrder(order);
                      setCancelNoteInput('');
                      setCancelError(null);
                    }}
                    className="min-h-[44px] px-3.5 py-2 bg-red-50 text-red-700 hover:bg-red-100 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                  >
                    <XCircle className="w-4 h-4" />
                    إلغاء الطلب
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredOrders.length === 0 && (
          <div className="bg-white rounded-3xl p-12 text-center text-slate-500 font-bold space-y-2 border border-slate-200/80">
            <PackageCheck className="w-12 h-12 text-slate-300 mx-auto" />
            <p>لا توجد طلبات في هذا القسم مطابقة لخيارات البحث الحالية.</p>
          </div>
        )}
      </div>

      {/* 1. Shipping Modal */}
      {shippingModalOrder && (
        <div
          className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[740] font-cairo"
          dir="rtl"
        >
          <form
            onSubmit={(e) => void handleConfirmShipping(e)}
            className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
                  <Truck className="w-5 h-5 text-indigo-600" />
                  تسجيل شحن الطلب #{shippingModalOrder.id}
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  العميل: {shippingModalOrder.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShippingModalOrder(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  شركة الشحن أو المندوب (اختياري)
                </label>
                <input
                  type="text"
                  value={carrierInput}
                  onChange={(e) => setCarrierInput(e.target.value)}
                  placeholder="مثال: بوسطة / أرامكس / مندوب الشركة"
                  className="w-full min-h-[46px] px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  رقم البوليصة / التتبع (اختياري)
                </label>
                <input
                  type="text"
                  value={trackingInput}
                  onChange={(e) => setTrackingInput(e.target.value)}
                  placeholder="مثال: TRK-88241"
                  className="w-full min-h-[46px] px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات الشحن (اختياري)
                </label>
                <textarea
                  rows={2}
                  value={shippingNotesInput}
                  onChange={(e) => setShippingNotesInput(e.target.value)}
                  placeholder="أي تعليمات لمندوب التوصيل أو التحصيل..."
                  className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={busyOrderId === shippingModalOrder.id}
                className="flex-1 min-h-[48px] py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm shadow-md"
              >
                تأكيد الشحن
              </button>
              <button
                type="button"
                onClick={() => setShippingModalOrder(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. Delivery Confirmation Modal */}
      {deliveryModalOrder && (
        <div
          className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[740] font-cairo"
          dir="rtl"
        >
          <form
            onSubmit={(e) => void handleConfirmDelivery(e)}
            className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  تأكيد تسليم الطلب #{deliveryModalOrder.id}
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  العميل: {deliveryModalOrder.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeliveryModalOrder(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 text-xs font-bold text-emerald-900">
              عند تأكيد التسليم سيتم إثبات العمولة المستحقة ({deliveryModalOrder.commission.toLocaleString()} ج.م) في رصيد السيلز: {deliveryModalOrder.salesRepName}.
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ملاحظات التسليم والتحصيل (اختياري)
              </label>
              <textarea
                rows={2}
                value={deliveryNotesInput}
                onChange={(e) => setDeliveryNotesInput(e.target.value)}
                placeholder="مثال: تم التسليم والتحصيل بالكامل..."
                className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
              />
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={busyOrderId === deliveryModalOrder.id}
                className="flex-1 min-h-[48px] py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-sm shadow-md"
              >
                تأكيد التسليم النهائي
              </button>
              <button
                type="button"
                onClick={() => setDeliveryModalOrder(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 3. Mandatory Return / Refusal Modal */}
      {returnModal && (
        <div
          className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[745] font-cairo"
          dir="rtl"
        >
          <form
            onSubmit={(e) => void handleConfirmReturn(e)}
            className="bg-white w-full max-w-xl rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-[#072F5F]">
                  تسجيل "{returnModal.outcome}" — فاتورة #{returnModal.order.id}
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  العميل: {returnModal.order.customerName} · المسؤول: {currentUser.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReturnModal(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {returnError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{returnError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-800">
                السبب الرئيسي (إلزامي) *
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {RETURN_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => handleSelectReturnReason(reason)}
                    className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-black border transition-all ${
                      returnReason === reason
                        ? 'bg-[#0A468C] text-white border-[#0A468C]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
              <p className="text-xs font-black text-slate-700">توثيق تفاصيل الحالة:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-bold text-slate-800">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagRefused}
                    onChange={(e) => setFlagRefused(e.target.checked)}
                    className="w-4 h-4 accent-[#0A468C]"
                  />
                  <span>هل العميل رفض الاستلام؟</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagNoAnswer}
                    onChange={(e) => setFlagNoAnswer(e.target.checked)}
                    className="w-4 h-4 accent-[#0A468C]"
                  />
                  <span>هل العميل لم يرد؟</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagInvalidAddr}
                    onChange={(e) => setFlagInvalidAddr(e.target.checked)}
                    className="w-4 h-4 accent-[#0A468C]"
                  />
                  <span>هل العنوان غير صحيح؟</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagCustCancel}
                    onChange={(e) => setFlagCustCancel(e.target.checked)}
                    className="w-4 h-4 accent-[#0A468C]"
                  />
                  <span>هل العميل طلب الإلغاء؟</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagOther}
                    onChange={(e) => setFlagOther(e.target.checked)}
                    className="w-4 h-4 accent-[#0A468C]"
                  />
                  <span>سبب آخر</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-800 mb-1">
                ملاحظة تفصيلية (إلزامي) *
              </label>
              <textarea
                rows={3}
                required
                value={returnDetails}
                onChange={(e) => setReturnDetails(e.target.value)}
                placeholder="اكتب ما حدث أثناء محاولة التسليم أو سبب المرتجع بوضوح (سيظهر للسيلز وفي سجل العميل)..."
                className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
              />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[11px] font-bold text-amber-900">
              ملاحظة: سيتم خصم العمولة المعلقة لهذا الطلب وتحديث سجل مرتجعات العميل بدون إعادة المخزون تلقائياً.
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={busyOrderId === returnModal.order.id}
                className="flex-1 min-h-[48px] py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-sm shadow-md"
              >
                حفظ وتسجيل "{returnModal.outcome}"
              </button>
              <button
                type="button"
                onClick={() => setReturnModal(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. Hold / Unhold Modal */}
      {holdModalOrder && (
        <div
          className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[740] font-cairo"
          dir="rtl"
        >
          <form
            onSubmit={(e) => void handleConfirmHold(e)}
            className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
                {holdModalOrder.holdInfo?.isHeld ? (
                  <>
                    <PlayCircle className="w-5 h-5 text-emerald-600" />
                    فك تعليق الطلب #{holdModalOrder.id}
                  </>
                ) : (
                  <>
                    <PauseCircle className="w-5 h-5 text-amber-600" />
                    تعليق الطلب #{holdModalOrder.id}
                  </>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setHoldModalOrder(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {holdError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black">
                {holdError}
              </div>
            )}

            {!holdModalOrder.holdInfo?.isHeld && (
              <div>
                <label className="block text-xs font-black text-slate-800 mb-1">
                  سبب التعليق (إلزامي) *
                </label>
                <input
                  type="text"
                  required
                  value={holdReasonInput}
                  onChange={(e) => setHoldReasonInput(e.target.value)}
                  placeholder="مثال: بانتظار تأكيد العميل على العنوان / نقص صنف مؤقت"
                  className="w-full min-h-[46px] px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ملاحظات إضافية (اختياري)
              </label>
              <textarea
                rows={2}
                value={holdNotesInput}
                onChange={(e) => setHoldNotesInput(e.target.value)}
                placeholder="تفاصيل إضافية تظهر للفريق..."
                className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
              />
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={busyOrderId === holdModalOrder.id}
                className={`flex-1 min-h-[48px] py-3 text-white rounded-2xl font-black text-sm shadow-md ${
                  holdModalOrder.holdInfo?.isHeld
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {holdModalOrder.holdInfo?.isHeld ? 'تأكيد فك التعليق' : 'تأكيد التعليق'}
              </button>
              <button
                type="button"
                onClick={() => setHoldModalOrder(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 5. Cancel Order Confirmation Modal (Mandatory Reason, Non-destructive) */}
      {cancelModalOrder && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[745] font-cairo"
          dir="rtl"
        >
          <form
            onSubmit={(e) => void handleConfirmCancel(e)}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-red-700">
                إلغاء الطلب #{cancelModalOrder.id}
              </h3>
              <button
                type="button"
                onClick={() => setCancelModalOrder(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {cancelError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black">
                {cancelError}
              </div>
            )}
            <p className="text-xs font-bold text-slate-600">
              سيتم تحويل الطلب للعميل "{cancelModalOrder.customerName}" إلى حالة "ملغي" مع الاحتفاظ بسجله وإلغاء العمولة المعلقة.
            </p>
            <div>
              <label className="block text-xs font-black text-slate-800 mb-1">
                سبب الإلغاء (إلزامي) *
              </label>
              <textarea
                rows={2}
                required
                value={cancelNoteInput}
                onChange={(e) => setCancelNoteInput(e.target.value)}
                placeholder="مثال: طلب العميل الإلغاء قبل الشحن..."
                className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-red-500 outline-none font-bold text-sm"
              />
            </div>
            <div className="flex gap-2.5">
              <button
                type="submit"
                disabled={busyOrderId === cancelModalOrder.id}
                className="flex-1 min-h-[48px] py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm disabled:opacity-60"
              >
                تأكيد الإلغاء
              </button>
              <button
                type="button"
                onClick={() => setCancelModalOrder(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                تراجع
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 6. Edit Request Review Modal */}
      {reviewingOrder && reviewingOrder.pendingEditRequest && (
        <div
          className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[745] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg sm:text-xl font-black text-[#072F5F]">
                  مراجعة طلب تعديل فاتورة #{reviewingOrder.id}
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  مقدم الطلب: {reviewingOrder.pendingEditRequest.requestedByName} ·{' '}
                  {new Date(reviewingOrder.pendingEditRequest.requestedAt).toLocaleString('ar-EG')}
                </p>
              </div>
              <button
                onClick={() => setReviewingOrder(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reviewingOrder.pendingEditRequest.reason && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs">
                <p className="font-black text-amber-900 mb-1">سبب طلب التعديل:</p>
                <p className="font-bold text-amber-800">{reviewingOrder.pendingEditRequest.reason}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-1.5">
                <span className="font-black text-slate-500 block">الفاتورة الحالية</span>
                <p className="font-black text-slate-900">{reviewingOrder.customerName}</p>
                <p className="font-bold text-slate-600 tabular-nums">
                  {reviewingOrder.items.length} أصناف · الإجمالي:{' '}
                  <strong className="text-slate-900">
                    {reviewingOrder.totalAmount.toLocaleString()} ج.م
                  </strong>
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 space-y-1.5">
                <span className="font-black text-[#0A468C] block">بعد التعديل المطلوب</span>
                <p className="font-black text-[#072F5F]">
                  {reviewingOrder.pendingEditRequest.customerName}
                </p>
                <p className="font-bold text-[#072F5F] tabular-nums">
                  {reviewingOrder.pendingEditRequest.items.length} أصناف · الإجمالي:{' '}
                  <strong className="text-base font-black">
                    {reviewingOrder.pendingEditRequest.totalAmount.toLocaleString()} ج.م
                  </strong>
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
              <p className="text-xs font-black text-[#072F5F]">الأصناف في التعديل المطلوب:</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {reviewingOrder.pendingEditRequest.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-white px-3 py-2 rounded-xl border border-slate-200/80 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-black text-slate-900 truncate">{item.productName}</p>
                      <p className="text-[11px] font-bold text-[#0A468C]">
                        {item.productCode ? `#${item.productCode} · ` : ''}
                        {item.categoryName ? `${item.categoryName} · ` : ''}
                        {item.grade}
                        {item.isCustom ? ' · صنف جديد/مخصوص' : ''}
                      </p>
                    </div>
                    <span className="font-black text-[#072F5F] tabular-nums whitespace-nowrap">
                      {item.quantity.toLocaleString()} {item.unit || 'mg'} × {item.price} ={' '}
                      {(item.quantity * item.price).toLocaleString()} ج.م
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                disabled={isResolvingEdit}
                onClick={() => void handleResolveEdit('approve')}
                className="flex-1 min-h-[48px] px-4 py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-md"
              >
                <Check className="w-4 h-4" />
                موافقة واعتماد التعديل
              </button>

              <button
                disabled={isResolvingEdit}
                onClick={() => {
                  const target = reviewingOrder;
                  setReviewingOrder(null);
                  onEditOrder(target, 'approve-override');
                }}
                className="min-h-[48px] px-4 py-3 bg-blue-50 text-[#072F5F] border border-blue-200 hover:bg-blue-100 rounded-2xl font-black text-sm flex items-center justify-center gap-1.5"
              >
                <Edit2 className="w-4 h-4" />
                تعديل قبل الموافقة
              </button>

              <button
                disabled={isResolvingEdit}
                onClick={() => void handleResolveEdit('reject')}
                className="min-h-[48px] px-4 py-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-2xl font-black text-sm"
              >
                رفض
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Item Procurement / Multi-Source Modal */}
      {sourcingModal && (
        <div
          className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[746] font-cairo"
          dir="rtl"
        >
          <form
            onSubmit={(e) => void handleSubmitSourcing(e)}
            className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-[#072F5F]">
                  إدارة توفير: {sourcingModal.item.productName}
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  فاتورة #{sourcingModal.order.id} · {sourcingModal.item.grade}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSourcingModal(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {sourcingError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black">
                {sourcingError}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center text-xs bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div>
                <span className="text-slate-500 font-bold block">من المخزن</span>
                <strong className="text-[#072F5F] font-black tabular-nums">
                  {(sourcingModal.item.warehouseDeductedQty ?? 0).toLocaleString()} {sourcingModal.item.unit || 'mg'}
                </strong>
              </div>
              <div>
                <span className="text-slate-500 font-bold block">توفير خارجي</span>
                <strong className="text-emerald-700 font-black tabular-nums">
                  {(sourcingModal.item.externalSuppliedQty ?? 0).toLocaleString()} {sourcingModal.item.unit || 'mg'}
                </strong>
              </div>
              <div>
                <span className="text-slate-500 font-bold block">بانتظار التوفير</span>
                <strong className="text-amber-700 font-black tabular-nums">
                  {(sourcingModal.item.pendingQty ?? 0).toLocaleString()} {sourcingModal.item.unit || 'mg'}
                </strong>
              </div>
            </div>

            {(() => {
              const matchedProd = products.find(
                (p) =>
                  (sourcingModal.item.productId && p.id === sourcingModal.item.productId) ||
                  (p.name.trim().toLowerCase() ===
                    sourcingModal.item.productName.trim().toLowerCase() &&
                    p.grade === sourcingModal.item.grade)
              );
              return matchedProd ? (
                <p className="text-xs font-bold text-slate-600 bg-blue-50 border border-blue-200 px-3 py-2 rounded-xl tabular-nums">
                  الرصيد الحالي بالمخزن لهذا الصنف: {matchedProd.stock.toLocaleString()} {matchedProd.unit || sourcingModal.item.unit || 'mg'}
                </p>
              ) : null;
            })()}

            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-800">اختر الإجراء المطلوب:</label>
              <div className="grid grid-cols-1 gap-2">
                {(sourcingModal.item.pendingQty ?? 0) > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSourcingAction('receive_into_warehouse')}
                      className={`min-h-[42px] px-3.5 py-2 rounded-xl text-right text-xs font-black border transition-all ${
                        sourcingAction === 'receive_into_warehouse'
                          ? 'bg-[#0A468C] text-white border-[#0A468C]'
                          : 'bg-slate-50 text-slate-800 border-slate-200'
                      }`}
                    >
                      استلام كمية من المورد للمخزن وتخصيصها للطلب
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourcingAction('fulfill_external_direct')}
                      className={`min-h-[42px] px-3.5 py-2 rounded-xl text-right text-xs font-black border transition-all ${
                        sourcingAction === 'fulfill_external_direct'
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-slate-50 text-slate-800 border-slate-200'
                      }`}
                    >
                      تأكيد التوفير الخارجي المباشر (دون تعديل رصيد المخزن)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourcingAction('allocate_from_warehouse')}
                      className={`min-h-[42px] px-3.5 py-2 rounded-xl text-right text-xs font-black border transition-all ${
                        sourcingAction === 'allocate_from_warehouse'
                          ? 'bg-[#072F5F] text-white border-[#072F5F]'
                          : 'bg-slate-50 text-slate-800 border-slate-200'
                      }`}
                    >
                      سحب من الرصيد المتاح حاليًا بالمخزن
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSourcingAction('set_source')}
                  className={`min-h-[42px] px-3.5 py-2 rounded-xl text-right text-xs font-black border transition-all ${
                    sourcingAction === 'set_source'
                      ? 'bg-[#0A468C] text-white border-[#0A468C]'
                      : 'bg-slate-50 text-slate-800 border-slate-200'
                  }`}
                >
                  تحديث مصدر التوفير وبيانات المورد فقط
                </button>
              </div>
            </div>

            {sourcingAction === 'set_source' ? (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مصدر التوفير</label>
                <select
                  value={sourcingSourceInput}
                  onChange={(e) => setSourcingSourceInput(e.target.value as ItemSourcingSource)}
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
                >
                  {VALID_SOURCING_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الكمية ({sourcingModal.item.unit || 'قطعة'})
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={sourcingQtyInput}
                  onChange={(e) => setSourcingQtyInput(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                  required
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم المورد (اختياري)
                </label>
                <input
                  type="text"
                  value={sourcingSupplierInput}
                  onChange={(e) => setSourcingSupplierInput(e.target.value)}
                  placeholder="مثال: مورد القاهرة للزيوت"
                  className="w-full min-h-[42px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظة</label>
                <input
                  type="text"
                  value={sourcingNotesInput}
                  onChange={(e) => setSourcingNotesInput(e.target.value)}
                  placeholder="تفاصيل الاستلام أو التوريد..."
                  className="w-full min-h-[42px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
                />
              </div>
            </div>

            {(sourcingAction === 'receive_into_warehouse' ||
              sourcingAction === 'fulfill_external_direct') && (
              <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-2xl space-y-3">
                <p className="text-[11px] font-black text-[#072F5F]">
                  بيانات تكلفة التوريد الخارجي (اختياري — تُسجل في سجل التكاليف وتُحدّث تقييم التكلفة لاحقاً)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      سعر التكلفة / {sourcingModal.item.unit || 'وحدة'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={sourcingUnitCostInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSourcingUnitCostInput(val);
                        const qty = Number(sourcingQtyInput);
                        const uCost = Number(val);
                        if (val.trim() !== '' && Number.isFinite(qty) && Number.isFinite(uCost) && qty > 0) {
                          setSourcingTotalCostInput(String(Math.round(qty * uCost * 100) / 100));
                        }
                      }}
                      placeholder="اختياري"
                      className="w-full min-h-[40px] px-3 py-1.5 bg-white rounded-xl border border-blue-200 font-black text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      إجمالي تكلفة التوريد (ج.م)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={sourcingTotalCostInput}
                      onChange={(e) => setSourcingTotalCostInput(e.target.value)}
                      placeholder="اختياري"
                      className="w-full min-h-[40px] px-3 py-1.5 bg-white rounded-xl border border-blue-200 font-black text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      تاريخ التوريد
                    </label>
                    <input
                      type="date"
                      value={sourcingDateInput}
                      onChange={(e) => setSourcingDateInput(e.target.value)}
                      className="w-full min-h-[40px] px-3 py-1.5 bg-white rounded-xl border border-blue-200 font-bold text-xs tabular-nums"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={isSavingSourcing}
                className="flex-1 min-h-[48px] py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm shadow-md disabled:opacity-60"
              >
                {isSavingSourcing ? 'جاري التنفيذ...' : 'حفظ وتنفيذ الإجراء'}
              </button>
              <button
                type="button"
                onClick={() => setSourcingModal(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
