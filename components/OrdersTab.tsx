import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ShoppingCart,
  Search,
  Printer,
  Trash2,
  CheckCircle2,
  Clock,
  RotateCcw,
  Plus,
  Phone,
  MapPin,
  AlertTriangle,
  X,
  Edit2,
  PackageCheck,
  Truck,
  FileEdit,
  Check,
  PauseCircle,
  History,
  ChevronDown,
  ChevronUp,
  XCircle,
  FileSpreadsheet,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  BulkPreviewResult,
  Order,
  OrderReturnPrimaryReason,
  OrderStatus,
  User,
} from '../types';
import { apiClient, type OrderStatusTransitionPayload } from '../src/lib/api';
import {
  getSalesOrderDisplayState,
  hasOrderPendingProcurement,
  type SalesOrderDisplayState,
} from '../src/lib/date-utils';
import { UnifiedDateFilterBar, type DateFilterValue } from './UnifiedDateFilterBar';
import { BulkActionBar, BulkPreviewModal } from './BulkActionComponents';

interface OrdersTabProps {
  orders: Order[];
  currentUser: User;
  fixedStatus?: OrderStatus;
  onRefreshWorkspace?: () => Promise<void> | void;
  onOpenNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onEditOrder: (order: Order, mode?: 'edit' | 'edit-request' | 'approve-override') => void;
  onConfirmOrder: (orderId: string) => Promise<void> | void;
  onCancelOrder: (orderId: string, reason: string) => Promise<void> | void;
  onUpdateStatus: (
    orderId: string,
    status: OrderStatus,
    options?: OrderStatusTransitionPayload
  ) => Promise<void> | void;
  onResolveEditRequest: (orderId: string, action: 'approve' | 'reject') => Promise<void> | void;
  onDeleteOrder: (orderId: string) => void;
}

const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  'بانتظار تأكيد العميل': 'bg-slate-200 text-slate-800 border border-slate-300',
  'طلب جديد': 'bg-sky-100 text-sky-900 border border-sky-200',
  'بانتظار التجهيز': 'bg-amber-100 text-amber-900 border border-amber-200',
  'جاري التجهيز': 'bg-yellow-100 text-yellow-900 border border-yellow-200',
  'تم التجهيز': 'bg-blue-100 text-[#072F5F] border border-blue-200',
  'تم الشحن': 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  'تم التسليم': 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'مرتجع': 'bg-orange-100 text-orange-800 border border-orange-200',
  'رفض استلام': 'bg-rose-100 text-rose-800 border border-rose-200',
  'ملغي': 'bg-red-100 text-red-800 border border-red-200',
  'قيد التنفيذ': 'bg-amber-100 text-amber-800 border border-amber-200',
};

const DISPLAY_BADGE_CLASS: Record<SalesOrderDisplayState['badgeVariant'], string> = {
  slate: 'bg-slate-200 text-slate-800 border border-slate-300',
  sky: 'bg-sky-100 text-sky-900 border border-sky-200',
  amber: 'bg-amber-100 text-amber-900 border border-amber-200',
  yellow: 'bg-yellow-100 text-yellow-900 border border-yellow-200',
  blue: 'bg-blue-100 text-[#072F5F] border border-blue-200',
  indigo: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  emerald: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  orange: 'bg-orange-100 text-orange-800 border border-orange-200',
  red: 'bg-red-100 text-red-800 border border-red-200',
};

const RETURN_REASONS: OrderReturnPrimaryReason[] = [
  'رفض الاستلام',
  'العميل لم يرد',
  'العنوان غير صحيح',
  'العميل طلب الإلغاء',
  'سبب آخر',
];

export const OrdersTab: React.FC<OrdersTabProps> = ({
  orders,
  currentUser,
  fixedStatus,
  onRefreshWorkspace,
  onOpenNewOrder,
  onSelectOrder,
  onEditOrder,
  onConfirmOrder,
  onCancelOrder,
  onUpdateStatus,
  onResolveEditRequest,
  onDeleteOrder,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(fixedStatus || 'الكل');
  const [onlyEditRequests, setOnlyEditRequests] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({
    preset: 'all',
    dateType: 'createdAt',
  });
  const [queriedOrders, setQueriedOrders] = useState<Order[] | null>(null);
  const [queriedRevenue, setQueriedRevenue] = useState<number | undefined>(undefined);
  const [isQueryLoading, setIsQueryLoading] = useState(false);

  // Bulk Selection, Workflow Transition, Batch Print & Excel Export State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewResult | null>(null);
  const [bulkTargetStatus, setBulkTargetStatus] = useState<OrderStatus | null>(null);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkExecuting, setBulkExecuting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBanner, setBulkBanner] = useState<string | null>(null);
  const [showBatchPrint, setShowBatchPrint] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [reviewingOrder, setReviewingOrder] = useState<Order | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  const [cancelModalOrder, setCancelModalOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Mandatory Return / Refusal Modal State (for canConfirmDelivery / supervisor / ops)
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

  const isStrictAdmin = currentUser.role === 'owner' || currentUser.role === 'admin';
  const canManageStatus = isStrictAdmin || Boolean(currentUser.canManageOrderStatus);
  const canConfirm =
    isStrictAdmin ||
    currentUser.role === 'supervisor' ||
    currentUser.canConfirmDelivery ||
    Boolean(currentUser.canManageOrderStatus);
  const canDelete = isStrictAdmin || Boolean(currentUser.canDeleteOrders);
  const canBulkTransition = isStrictAdmin || currentUser.role === 'supervisor' || canManageStatus || canConfirm;

  const isDateFilterActive =
    dateFilter.preset !== 'all' || Boolean(dateFilter.dateFrom) || Boolean(dateFilter.dateTo);

  useEffect(() => {
    if (!isDateFilterActive) {
      setQueriedOrders(null);
      setQueriedRevenue(undefined);
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
        ...(fixedStatus ? { status: fixedStatus } : {}),
      })
      .then((res) => {
        if (cancelled) return;
        setQueriedOrders(res.orders);
        setQueriedRevenue(res.stats.totalRevenue);
      })
      .catch((err) => {
        console.error('Failed to query filtered orders:', err);
      })
      .finally(() => {
        if (!cancelled) setIsQueryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isDateFilterActive,
    dateFilter.preset,
    dateFilter.dateType,
    dateFilter.dateFrom,
    dateFilter.dateTo,
    fixedStatus,
    orders,
  ]);

  const effectiveOrders = useMemo(
    () => (isDateFilterActive && queriedOrders ? queriedOrders : orders),
    [isDateFilterActive, queriedOrders, orders]
  );

  const pendingEditOrders = effectiveOrders.filter(
    (o) =>
      Boolean(o.pendingEditRequest) &&
      (o.status === 'جاري التجهيز' || o.status === 'تم التجهيز')
  );

  const hasLegacyInProgress = effectiveOrders.some((o) => o.status === 'قيد التنفيذ');

  const isOwnerOrElevated = (order: Order) =>
    isStrictAdmin ||
    currentUser.role === 'supervisor' ||
    canManageStatus ||
    !currentUser.salesRepId ||
    order.salesRepId === currentUser.salesRepId;

  const getEditCapability = (order: Order): 'direct' | 'request' | 'none' => {
    if (isStrictAdmin) return 'direct';
    if (order.status === 'بانتظار تأكيد العميل') {
      return isOwnerOrElevated(order) ? 'direct' : 'none';
    }
    if (
      order.status === 'طلب جديد' ||
      order.status === 'بانتظار التجهيز' ||
      order.status === 'قيد التنفيذ'
    ) {
      return isOwnerOrElevated(order) ? 'direct' : 'none';
    }
    if (order.status === 'جاري التجهيز' || order.status === 'تم التجهيز') {
      if (canManageStatus) return 'direct';
      return isOwnerOrElevated(order) ? 'request' : 'none';
    }
    return 'none';
  };

  const canConfirmDraftOrder = (order: Order): boolean =>
    order.status === 'بانتظار تأكيد العميل' && isOwnerOrElevated(order);

  const canCancelOrder = (order: Order): boolean => {
    if (order.status === 'بانتظار تأكيد العميل') {
      return isOwnerOrElevated(order);
    }
    if (
      order.status === 'طلب جديد' ||
      order.status === 'بانتظار التجهيز' ||
      order.status === 'جاري التجهيز' ||
      order.status === 'تم التجهيز' ||
      order.status === 'قيد التنفيذ'
    ) {
      return isStrictAdmin || canManageStatus;
    }
    return false;
  };

  const filteredOrders = effectiveOrders.filter((order) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      order.customerName.toLowerCase().includes(q) ||
      order.customerPhone.includes(searchTerm) ||
      order.id.toLowerCase().includes(q) ||
      order.salesRepName.toLowerCase().includes(q) ||
      (order.governorate || '').toLowerCase().includes(q);

    if (fixedStatus) {
      if (order.status !== fixedStatus) return false;
      if (fixedStatus === 'تم التجهيز' && onlyEditRequests) {
        return matchesSearch && Boolean(order.pendingEditRequest);
      }
      return matchesSearch;
    }

    if (statusFilter === 'طلبات التعديل') {
      return (
        matchesSearch &&
        Boolean(order.pendingEditRequest) &&
        (order.status === 'جاري التجهيز' || order.status === 'تم التجهيز')
      );
    }

    const matchesStatus = statusFilter === 'الكل' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredRevenue = useMemo(
    () =>
      filteredOrders
        .filter((o) => o.status !== 'ملغي' && o.status !== 'مرتجع' && o.status !== 'رفض استلام')
        .reduce((sum, o) => sum + o.totalAmount, 0),
    [filteredOrders]
  );

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOrders = useMemo(
    () => filteredOrders.filter((o) => selectedIdSet.has(o.id)),
    [filteredOrders, selectedIdSet]
  );

  const toggleOrderSelect = (orderId: string) => {
    setSelectedIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  const toggleSelectAllFiltered = () => {
    const allSelected =
      filteredOrders.length > 0 && filteredOrders.every((o) => selectedIdSet.has(o.id));
    setSelectedIds(allSelected ? [] : filteredOrders.map((o) => o.id));
  };

  const handleRequestBulkTransitionPreview = async (targetStatus: OrderStatus) => {
    if (selectedIds.length === 0) return;
    setBulkPreviewLoading(true);
    setBulkError(null);
    try {
      const preview = await apiClient.previewBulkOrders({
        orderIds: selectedIds,
        targetStatus,
      });
      setBulkTargetStatus(targetStatus);
      setBulkPreview(preview);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'تعذر تجهيز معاينة تحديث حالات الطلبات.');
    } finally {
      setBulkPreviewLoading(false);
    }
  };

  const handleExecuteBulkTransition = async () => {
    if (!bulkTargetStatus || bulkExecuting) return;
    setBulkExecuting(true);
    setBulkError(null);
    try {
      const result = await apiClient.executeBulkOrders({
        orderIds: selectedIds,
        targetStatus: bulkTargetStatus,
      });
      setBulkPreview(null);
      setBulkTargetStatus(null);
      setSelectedIds([]);
      setBulkBanner(result.message);
      await onRefreshWorkspace?.();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'تعذر تنفيذ تحديث حالات الطلبات.');
    } finally {
      setBulkExecuting(false);
    }
  };

  const handleExportOrdersExcel = async () => {
    setExportingExcel(true);
    try {
      const mapPreset = (p: DateFilterValue['preset']) => {
        if (p === 'last_month') return 'previous_month';
        if (p === 'last_7_days') return 'this_week';
        return p;
      };
      await apiClient.downloadUnifiedReportExcel('sales', {
        preset: mapPreset(dateFilter.preset) as 'all',
        dateFrom: dateFilter.preset === 'custom' ? dateFilter.dateFrom : undefined,
        dateTo: dateFilter.preset === 'custom' ? dateFilter.dateTo : undefined,
        status: fixedStatus || (statusFilter !== 'الكل' && statusFilter !== 'طلبات التعديل' ? statusFilter : undefined),
      });
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'تعذر تصدير الفواتير إلى Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleConfirmDelete = () => {
    if (!orderToDelete) return;
    onDeleteOrder(orderToDelete.id);
    setOrderToDelete(null);
  };

  const handleResolve = async (action: 'approve' | 'reject') => {
    if (!reviewingOrder) return;
    setIsResolving(true);
    try {
      await onResolveEditRequest(reviewingOrder.id, action);
      setReviewingOrder(null);
    } finally {
      setIsResolving(false);
    }
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

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModal) return;
    if (returnDetails.trim().length < 3) {
      setReturnError('يجب كتابة ملاحظة تفصيلية واضحة (3 أحرف على الأقل).');
      return;
    }
    setReturnError(null);
    await onUpdateStatus(returnModal.order.id, returnModal.outcome, {
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

  const handleConfirmDraftClick = async (orderId: string) => {
    setConfirmingOrderId(orderId);
    try {
      await onConfirmOrder(orderId);
    } finally {
      setConfirmingOrderId(null);
    }
  };

  const handleSubmitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalOrder) return;
    if (cancelReason.trim().length < 3) {
      setCancelError('يجب كتابة سبب واضح للإلغاء (3 أحرف على الأقل).');
      return;
    }
    setCancelError(null);
    setIsCancelling(true);
    try {
      await onCancelOrder(cancelModalOrder.id, cancelReason.trim());
      setCancelModalOrder(null);
      setCancelReason('');
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة.');
    } finally {
      setIsCancelling(false);
    }
  };

  const showEditAlert =
    canManageStatus &&
    pendingEditOrders.length > 0 &&
    (!fixedStatus || fixedStatus === 'تم التجهيز');

  const statusFilterTabs = [
    'الكل',
    'بانتظار تأكيد العميل',
    'طلب جديد',
    'بانتظار التجهيز',
    'جاري التجهيز',
    'تم التجهيز',
    'تم الشحن',
    'تم التسليم',
    'مرتجع',
    'رفض استلام',
    'ملغي',
    ...(hasLegacyInProgress ? ['قيد التنفيذ'] : []),
    ...(canManageStatus && pendingEditOrders.length > 0 ? ['طلبات التعديل'] : []),
  ];

  return (
    <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300 font-cairo">
      {/* Pending Edit Requests Alert for Order Status Officer & Admin */}
      {showEditAlert && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl sm:rounded-3xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#0A468C] text-white rounded-xl shrink-0">
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <p className="font-black text-sm text-[#072F5F]">
                يوجد {pendingEditOrders.length} طلب تعديل فواتير بانتظار المراجعة والموافقة
              </p>
              <p className="text-xs font-bold text-slate-600 mt-0.5">
                طلبات تعديل أو إضافة أصناف على فواتير في مرحلة التجهيز
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (fixedStatus === 'تم التجهيز') {
                setOnlyEditRequests((prev) => !prev);
              } else {
                setStatusFilter(statusFilter === 'طلبات التعديل' ? 'الكل' : 'طلبات التعديل');
              }
            }}
            className="min-h-[42px] px-4 py-2 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl text-xs font-black whitespace-nowrap transition-all"
          >
            {(fixedStatus === 'تم التجهيز' ? onlyEditRequests : statusFilter === 'طلبات التعديل')
              ? 'عرض كل الطلبات'
              : 'عرض طلبات التعديل فقط'}
          </button>
        </div>
      )}

      {/* Unified Cairo Date Filter */}
      <UnifiedDateFilterBar
        value={dateFilter}
        onChange={setDateFilter}
        totalMatched={filteredOrders.length}
        totalRevenue={isDateFilterActive ? queriedRevenue : filteredRevenue}
        loading={isQueryLoading}
        compact
      />

      {/* Top Filter and Actions Bar */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80 flex flex-col gap-3.5">
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث باسم العميل، الهاتف، المحافظة، السيلز، أو رقم الفاتورة..."
              className="w-full min-h-[48px] pr-12 pl-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200/80 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportingExcel}
              onClick={() => void handleExportOrdersExcel()}
              className="min-h-[48px] bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-2xl font-black shadow-md transition-all flex items-center justify-center gap-2 text-xs sm:text-sm whitespace-nowrap disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {exportingExcel ? 'جاري التصدير...' : 'تصدير Excel'}
            </button>

            <button
              onClick={onOpenNewOrder}
              className="min-h-[48px] bg-[#0A468C] text-white px-5 py-3 rounded-2xl font-black shadow-md hover:bg-[#072F5F] transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              فاتورة جديدة
            </button>
          </div>
        </div>

        {/* Status Filter Tabs (Full view) or Sub-view indicator (Dedicated stage view) */}
        {!fixedStatus ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {statusFilterTabs.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                  statusFilter === status
                    ? 'bg-[#0A468C] text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {status}
                {status === 'طلبات التعديل' ? ` (${pendingEditOrders.length})` : ''}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black ${
                  STATUS_BADGE_CLASS[fixedStatus]
                }`}
              >
                {fixedStatus === 'تم التجهيز' && <PackageCheck className="w-3.5 h-3.5" />}
                {fixedStatus === 'تم الشحن' && <Truck className="w-3.5 h-3.5" />}
                {fixedStatus === 'تم التسليم' && <CheckCircle2 className="w-3.5 h-3.5" />}
                {fixedStatus}
              </span>
              <span className="text-xs font-bold text-slate-500 tabular-nums">
                عدد الطلبات: {filteredOrders.length}
              </span>
            </div>

            {fixedStatus === 'تم التجهيز' && canManageStatus && pendingEditOrders.length > 0 && (
              <button
                onClick={() => setOnlyEditRequests((prev) => !prev)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                  onlyEditRequests
                    ? 'bg-[#0A468C] text-white shadow-sm'
                    : 'bg-blue-50 text-[#072F5F] border border-blue-200 hover:bg-blue-100'
                }`}
              >
                طلبات التعديل ({pendingEditOrders.length})
              </button>
            )}
          </div>
        )}

        {filteredOrders.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="min-h-[36px] px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#072F5F] rounded-xl font-black inline-flex items-center gap-1.5"
            >
              {filteredOrders.every((o) => selectedIdSet.has(o.id)) ? (
                <CheckSquare className="w-4 h-4 text-[#0A468C]" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>تحديد كل الفواتير المعروضة ({filteredOrders.length})</span>
            </button>
          </div>
        )}
      </div>

      {bulkBanner && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-black text-emerald-900 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            {bulkBanner}
          </span>
          <button type="button" onClick={() => setBulkBanner(null)} className="font-bold underline">
            إغلاق
          </button>
        </div>
      )}

      {bulkError && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
          {bulkError}
        </div>
      )}

      {/* Sticky Bulk Action Bar for Orders */}
      <BulkActionBar
        selectedCount={selectedIds.length}
        pageCount={filteredOrders.length}
        totalMatchingCount={filteredOrders.length}
        selectionScope="page"
        onSelectPage={() => setSelectedIds(filteredOrders.map((o) => o.id))}
        onClearSelection={() => setSelectedIds([])}
        itemLabel="فاتورة"
      >
        <button
          type="button"
          onClick={() => setShowBatchPrint(true)}
          className="px-3 py-1.5 rounded-xl bg-white text-[#072F5F] hover:bg-blue-50 font-black text-xs inline-flex items-center gap-1.5"
        >
          <Printer className="w-3.5 h-3.5" />
          طباعة مجمّعة ({selectedOrders.length})
        </button>

        {canBulkTransition && (isStrictAdmin || canManageStatus) && (
          <>
            <button
              type="button"
              disabled={bulkPreviewLoading}
              onClick={() => void handleRequestBulkTransitionPreview('جاري التجهيز')}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-xs"
            >
              بدء التجهيز
            </button>
            <button
              type="button"
              disabled={bulkPreviewLoading}
              onClick={() => void handleRequestBulkTransitionPreview('تم التجهيز')}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-xs"
            >
              تم التجهيز
            </button>
            <button
              type="button"
              disabled={bulkPreviewLoading}
              onClick={() => void handleRequestBulkTransitionPreview('تم الشحن')}
              className="px-3 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs"
            >
              تم الشحن
            </button>
          </>
        )}

        {canBulkTransition && canConfirm && (
          <button
            type="button"
            disabled={bulkPreviewLoading}
            onClick={() => void handleRequestBulkTransitionPreview('تم التسليم')}
            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xs"
          >
            تأكيد التسليم
          </button>
        )}
      </BulkActionBar>

      {/* Mobile-Friendly Cards View on Small Screens */}
      <div className="block lg:hidden space-y-3.5">
        {filteredOrders.map((order) => {
          const editCap = getEditCapability(order);
          const canConfirmOutcomeOnOrder =
            order.status === 'تم الشحن' || order.status === 'قيد التنفيذ';
          const isHeld = Boolean(order.holdInfo?.isHeld);
          const isSelected = selectedIdSet.has(order.id);

          return (
            <div
              key={order.id}
              className={`bg-white p-4 sm:p-5 rounded-3xl shadow-sm border space-y-3.5 ${
                isSelected ? 'border-[#0A468C] ring-2 ring-blue-500/20' : 'border-slate-200/80'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOrderSelect(order.id)}
                      aria-label={`تحديد فاتورة ${order.id}`}
                      className="w-4 h-4 accent-[#0A468C] cursor-pointer ml-1"
                    />
                    <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-lg">
                      #{order.id.slice(0, 10)}
                    </span>
                    {(order.version || 1) > 1 && (
                      <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-lg text-[10px] font-black tabular-nums">
                        v{order.version}
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-black text-slate-900 mt-1.5">{order.customerName}</h3>
                  <p className="text-xs text-slate-600 font-bold flex items-center gap-1.5 mt-0.5 tabular-nums">
                    <Phone className="w-3.5 h-3.5 text-[#0A468C]" />
                    <span dir="ltr">{order.customerPhone || 'بدون هاتف'}</span>
                  </p>
                  {(order.governorate || order.customerAddress) && (
                    <p className="text-xs text-slate-500 font-bold flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {order.governorate ? `${order.governorate} — ` : ''}
                        {order.customerAddress}
                      </span>
                    </p>
                  )}
                </div>

                {(() => {
                  const display = getSalesOrderDisplayState(order);
                  const pendingProc = hasOrderPendingProcurement(order);
                  return (
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black whitespace-nowrap ${
                          DISPLAY_BADGE_CLASS[display.badgeVariant]
                        }`}
                      >
                        {order.status === 'تم التسليم' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {order.status === 'تم التجهيز' && !display.isAwaitingReview && !display.isRePrepActive && (
                          <PackageCheck className="w-3.5 h-3.5" />
                        )}
                        {order.status === 'تم الشحن' && <Truck className="w-3.5 h-3.5" />}
                        {(display.isAwaitingReview || display.isRePrepActive) && (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {!display.isAwaitingReview &&
                          !display.isRePrepActive &&
                          (order.status === 'قيد التنفيذ' ||
                            order.status === 'طلب جديد' ||
                            order.status === 'بانتظار التجهيز' ||
                            order.status === 'بانتظار تأكيد العميل') && <Clock className="w-3.5 h-3.5" />}
                        {display.primaryLabel}
                      </span>
                      {display.secondaryLabel && (
                        <span className="text-[10px] font-black text-[#072F5F] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg text-left">
                          {display.secondaryLabel}
                        </span>
                      )}
                      {order.status === 'بانتظار تأكيد العميل' && (
                        <span className="text-[10px] font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">
                          لم يُخصم المخزون بعد
                        </span>
                      )}
                      {pendingProc && order.status !== 'ملغي' && order.status !== 'تم التسليم' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-100 text-amber-950 border border-amber-300">
                          توجد أصناف بانتظار التوفير
                        </span>
                      )}
                      {isHeld && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-black bg-amber-100 text-amber-950 border border-amber-300">
                          <PauseCircle className="w-3 h-3" />
                          معلق
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {order.status === 'ملغي' && order.cancellationInfo && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-xs space-y-0.5">
                  <p className="font-black text-red-900">سبب الإلغاء: {order.cancellationInfo.reason}</p>
                  <p className="font-bold text-red-700 text-[11px]">
                    بواسطة {order.cancellationInfo.cancelledByName} (مرحلة: {order.cancellationInfo.stageAtCancellation})
                  </p>
                </div>
              )}

              {/* Hold / Return / Shipping / Operational notes visibility */}
              {isHeld && order.holdInfo && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs">
                  <p className="font-black text-amber-950">سبب التعليق: {order.holdInfo.reason}</p>
                  {order.holdInfo.notes && (
                    <p className="font-bold text-amber-800 mt-0.5">{order.holdInfo.notes}</p>
                  )}
                </div>
              )}

              {order.returnInfo && (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3 text-xs space-y-0.5">
                  <p className="font-black text-orange-950">
                    {order.returnInfo.outcome}: {order.returnInfo.reason}
                  </p>
                  <p className="font-bold text-slate-700">{order.returnInfo.details}</p>
                </div>
              )}

              {order.shippingInfo && (
                <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-3 text-xs text-indigo-950 font-bold">
                  شحن: {order.shippingInfo.carrier || 'مندوب'}
                  {order.shippingInfo.trackingNumber
                    ? ` · بوليصة: ${order.shippingInfo.trackingNumber}`
                    : ''}
                </div>
              )}

              {order.operationalNotes && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs text-slate-700 font-bold">
                  ملاحظة التشغيل: {order.operationalNotes}
                </div>
              )}

              {/* Pending Edit Request Notice */}
              {order.pendingEditRequest &&
                (order.status === 'جاري التجهيز' || order.status === 'تم التجهيز') && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-[#072F5F]">يوجد طلب تعديل معلق</p>
                      <p className="text-[11px] font-bold text-slate-600 truncate">
                        مقدم من: {order.pendingEditRequest.requestedByName}
                      </p>
                    </div>
                    {canManageStatus && (
                      <button
                        onClick={() => setReviewingOrder(order)}
                        className="min-h-[38px] px-3 py-1.5 bg-[#0A468C] text-white rounded-xl text-xs font-black shrink-0"
                      >
                        مراجعة
                      </button>
                    )}
                  </div>
                )}

              {/* Items summary */}
              <div className="bg-slate-50 p-3.5 rounded-2xl text-xs space-y-1.5 border border-slate-200/60">
                <div className="flex justify-between text-slate-600 font-bold">
                  <span>السيلز: {order.salesRepName}</span>
                  <span className="tabular-nums">{order.items.length} أصناف زيت</span>
                </div>
                <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-200">
                  <span className="text-slate-700 font-bold">إجمالي الفاتورة:</span>
                  <span className="text-base font-black text-[#072F5F] tabular-nums">
                    {order.totalAmount.toLocaleString()} <span className="text-xs font-bold">ج.م</span>
                  </span>
                </div>
              </div>

              {((order.statusHistory && order.statusHistory.length > 0) ||
                (order.revisions && order.revisions.length > 0)) && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedHistoryId((prev) => (prev === order.id ? null : order.id))
                  }
                  className="w-full min-h-[38px] px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-[#072F5F] flex items-center justify-between"
                >
                  <span className="flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    السجل والمراجعات ({order.statusHistory?.length || 0} حالة · {order.revisions?.length || 0} تعديل)
                  </span>
                  {expandedHistoryId === order.id ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              )}

              {expandedHistoryId === order.id && (
                <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 space-y-2.5 text-[11px]">
                  {order.revisions && order.revisions.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-black text-[#0A468C]">تعديلات الفاتورة ({order.revisions.length})</p>
                      {order.revisions.map((rev) => (
                        <div key={rev.id} className="bg-white rounded-xl p-2 border border-slate-200 space-y-0.5">
                          <p className="font-black text-slate-900">
                            v{rev.fromVersion} ← v{rev.toVersion} ({rev.editedByName})
                          </p>
                          {rev.reason && <p className="font-bold text-slate-600">السبب: {rev.reason}</p>}
                          <p className="font-bold text-[#072F5F] tabular-nums">
                            الإجمالي: {rev.previousTotal.toLocaleString()} ← {rev.newTotal.toLocaleString()} ج.م
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {order.statusHistory && order.statusHistory.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-black text-slate-700">تغييرات الحالة</p>
                      {order.statusHistory.map((h, i) => (
                        <div key={i} className="border-b last:border-b-0 border-slate-200 pb-1">
                          <p className="font-black text-slate-900">
                            {h.fromStatus ? `${h.fromStatus} ← ${h.toStatus}` : h.toStatus}
                          </p>
                          {h.note && <p className="font-bold text-slate-600">{h.note}</p>}
                          <p className="font-bold text-slate-500">
                            {h.changedByName} · {new Date(h.changedAt).toLocaleString('ar-EG')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons on Mobile */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {canConfirmDraftOrder(order) && (
                  <button
                    disabled={confirmingOrderId === order.id}
                    onClick={() => void handleConfirmDraftClick(order.id)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {confirmingOrderId === order.id ? 'جاري التأكيد...' : 'تأكيد وإرسال للتجهيز'}
                  </button>
                )}

                <button
                  onClick={() => onSelectOrder(order)}
                  className="flex-1 min-h-[44px] px-3 py-2.5 bg-blue-50 text-[#0A468C] hover:bg-[#0A468C] hover:text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  عرض / طباعة
                </button>

                {editCap === 'direct' && (
                  <button
                    onClick={() => onEditOrder(order, 'edit')}
                    className="min-h-[44px] px-3.5 py-2.5 bg-slate-100 text-[#072F5F] hover:bg-blue-100 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                  >
                    <Edit2 className="w-4 h-4" />
                    تعديل
                  </button>
                )}

                {editCap === 'request' && (
                  <button
                    onClick={() => onEditOrder(order, 'edit-request')}
                    className="min-h-[44px] px-3.5 py-2.5 bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                  >
                    <FileEdit className="w-4 h-4" />
                    {order.pendingEditRequest ? 'تحديث طلب التعديل' : 'طلب تعديل'}
                  </button>
                )}

                {canConfirm && canConfirmOutcomeOnOrder && (
                  <button
                    onClick={() => void onUpdateStatus(order.id, 'تم التسليم')}
                    className="min-h-[44px] px-4 py-2.5 bg-[#0A468C] text-white hover:bg-[#072F5F] rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    تسليم
                  </button>
                )}

                {canConfirm && canConfirmOutcomeOnOrder && (
                  <button
                    onClick={() => openReturnModal(order, 'مرتجع')}
                    className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center gap-1 bg-orange-50 text-orange-800 border border-orange-200 hover:bg-orange-100 rounded-xl text-xs font-black transition-all"
                    title="تسجيل كمرتجع"
                  >
                    <RotateCcw className="w-4 h-4" />
                    مرتجع
                  </button>
                )}

                {canCancelOrder(order) && (
                  <button
                    onClick={() => {
                      setCancelError(null);
                      setCancelReason('');
                      setCancelModalOrder(order);
                    }}
                    className="min-h-[44px] px-3 py-2 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded-xl text-xs font-black transition-all flex items-center gap-1"
                    title="إلغاء الفاتورة"
                  >
                    <XCircle className="w-4 h-4" />
                    إلغاء
                  </button>
                )}

                {canDelete && (
                  <button
                    onClick={() => setOrderToDelete(order)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-all"
                    title="حذف الفاتورة"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Full Table View */}
      <div className="hidden lg:block bg-white rounded-[2.5rem] shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200/80">
              <tr>
                <th className="p-4 text-center w-10">
                  <input
                    type="checkbox"
                    checked={filteredOrders.length > 0 && filteredOrders.every((o) => selectedIdSet.has(o.id))}
                    onChange={toggleSelectAllFiltered}
                    aria-label="تحديد كل الفواتير"
                    className="w-4 h-4 accent-[#0A468C] cursor-pointer"
                  />
                </th>
                <th className="p-5 font-black text-xs text-slate-500">رقم الفاتورة</th>
                <th className="p-5 font-black text-xs text-slate-500">العميل والتفاصيل</th>
                <th className="p-5 font-black text-xs text-slate-500">السيلز</th>
                <th className="p-5 font-black text-xs text-slate-500 text-center">الأصناف</th>
                <th className="p-5 font-black text-xs text-slate-500 text-center">المبلغ الصافي</th>
                <th className="p-5 font-black text-xs text-slate-500 text-center">العمولة</th>
                <th className="p-5 font-black text-xs text-slate-500 text-center">الحالة</th>
                <th className="p-5 font-black text-xs text-slate-500 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map((order) => {
                const editCap = getEditCapability(order);
                const canConfirmOutcomeOnOrder =
                  order.status === 'تم الشحن' || order.status === 'قيد التنفيذ';
                const isHeld = Boolean(order.holdInfo?.isHeld);
                const isSelected = selectedIdSet.has(order.id);

                return (
                  <tr
                    key={order.id}
                    className={`transition-all ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-blue-50/30'
                    }`}
                  >
                    <td className="p-4 text-center align-top pt-6">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOrderSelect(order.id)}
                        aria-label={`تحديد فاتورة ${order.id}`}
                        className="w-4 h-4 accent-[#0A468C] cursor-pointer"
                      />
                    </td>
                    <td className="p-5 align-top">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                          #{order.id.slice(0, 10)}
                        </span>
                        {(order.version || 1) > 1 && (
                          <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-lg text-[10px] font-black tabular-nums">
                            v{order.version}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-bold mt-1">
                        {new Date(order.createdAt).toLocaleDateString('ar-EG')}
                      </p>
                    </td>

                    <td className="p-5 align-top space-y-1">
                      <p className="font-black text-[#072F5F] text-base">{order.customerName}</p>
                      <p className="text-xs text-slate-600 font-bold flex items-center gap-1.5 tabular-nums">
                        <Phone className="w-3.5 h-3.5 text-[#0A468C]" />
                        <span dir="ltr">{order.customerPhone || 'بدون هاتف'}</span>
                      </p>
                      {(order.governorate || order.customerAddress) && (
                        <p className="text-xs text-slate-500 font-bold flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            {order.governorate ? `${order.governorate} — ` : ''}
                            {order.customerAddress}
                          </span>
                        </p>
                      )}
                      {order.status === 'ملغي' && order.cancellationInfo && (
                        <p className="text-[11px] font-bold text-red-800 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                          سبب الإلغاء: {order.cancellationInfo.reason}
                        </p>
                      )}
                      {isHeld && order.holdInfo && (
                        <p className="text-[11px] font-black text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block">
                          معلق: {order.holdInfo.reason}
                        </p>
                      )}
                      {order.returnInfo && (
                        <p className="text-[11px] font-bold text-orange-900 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1">
                          {order.returnInfo.outcome} ({order.returnInfo.reason}): {order.returnInfo.details}
                        </p>
                      )}
                      {order.operationalNotes && (
                        <p className="text-[11px] font-bold text-slate-600">
                          ملاحظة التشغيل: {order.operationalNotes}
                        </p>
                      )}
                      {order.pendingEditRequest &&
                        (order.status === 'جاري التجهيز' || order.status === 'تم التجهيز') && (
                          <div className="mt-1 inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-[#072F5F] px-2.5 py-1 rounded-lg text-[11px] font-black">
                            <FileEdit className="w-3 h-3" />
                            <span>طلب تعديل من {order.pendingEditRequest.requestedByName}</span>
                            {canManageStatus && (
                              <button
                                onClick={() => setReviewingOrder(order)}
                                className="underline text-[#0A468C] mr-1"
                              >
                                مراجعة
                              </button>
                            )}
                          </div>
                        )}
                    </td>

                    <td className="p-5 font-bold text-slate-700 text-sm align-top">
                      {order.salesRepName}
                    </td>

                    <td className="p-5 text-center align-top">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold tabular-nums">
                        {order.items.length} أصناف
                      </span>
                    </td>

                    <td className="p-5 text-center font-black text-[#072F5F] text-base tabular-nums align-top">
                      {order.totalAmount.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-500">ج.م</span>
                    </td>

                    <td className="p-5 text-center font-bold text-[#0A468C] text-sm tabular-nums align-top">
                      {order.commission.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-500">ج.م</span>
                    </td>

                    <td className="p-5 text-center align-top space-y-1">
                      {(() => {
                        const display = getSalesOrderDisplayState(order);
                        const pendingProc = hasOrderPendingProcurement(order);
                        return (
                          <>
                            <span
                              className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black whitespace-nowrap ${
                                DISPLAY_BADGE_CLASS[display.badgeVariant]
                              }`}
                            >
                              {order.status === 'تم التسليم' && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {order.status === 'تم التجهيز' && !display.isAwaitingReview && !display.isRePrepActive && (
                                <PackageCheck className="w-3.5 h-3.5" />
                              )}
                              {order.status === 'تم الشحن' && <Truck className="w-3.5 h-3.5" />}
                              {(display.isAwaitingReview || display.isRePrepActive) && (
                                <AlertTriangle className="w-3.5 h-3.5" />
                              )}
                              {!display.isAwaitingReview &&
                                !display.isRePrepActive &&
                                (order.status === 'قيد التنفيذ' ||
                                  order.status === 'طلب جديد' ||
                                  order.status === 'بانتظار التجهيز' ||
                                  order.status === 'بانتظار تأكيد العميل') && <Clock className="w-3.5 h-3.5" />}
                              {display.primaryLabel}
                            </span>
                            {display.secondaryLabel && (
                              <div>
                                <span className="inline-block text-[10px] font-black text-[#072F5F] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg">
                                  {display.secondaryLabel}
                                </span>
                              </div>
                            )}
                            {order.status === 'بانتظار تأكيد العميل' && (
                              <div>
                                <span className="inline-block text-[10px] font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">
                                  لم يُخصم المخزون بعد
                                </span>
                              </div>
                            )}
                            {pendingProc && order.status !== 'ملغي' && order.status !== 'تم التسليم' && (
                              <div>
                                <span className="inline-block text-[10px] font-black text-amber-950 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg">
                                  توجد أصناف بانتظار التوفير
                                </span>
                              </div>
                            )}
                            {isHeld && (
                              <div>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-100 text-amber-950 border border-amber-300">
                                  <PauseCircle className="w-3 h-3" />
                                  معلق
                                </span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>

                    <td className="p-5 text-center align-top">
                      <div className="flex items-center justify-center flex-wrap gap-1.5">
                        {canConfirmDraftOrder(order) && (
                          <button
                            disabled={confirmingOrderId === order.id}
                            onClick={() => void handleConfirmDraftClick(order.id)}
                            title="تأكيد الطلب وإرساله للتجهيز وخصم المخزون"
                            className="px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-xs font-black transition-all shadow-xs flex items-center gap-1 disabled:opacity-60"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {confirmingOrderId === order.id ? 'جاري التأكيد...' : 'تأكيد وإرسال للتجهيز'}
                          </button>
                        )}

                        <button
                          onClick={() => onSelectOrder(order)}
                          title="طباعة / عرض الفاتورة"
                          className="p-2.5 bg-blue-50 text-[#0A468C] hover:bg-[#0A468C] hover:text-white rounded-xl transition-all shadow-xs"
                        >
                          <Printer className="w-4 h-4" />
                        </button>

                        {editCap === 'direct' && (
                          <button
                            onClick={() => onEditOrder(order, 'edit')}
                            title="تعديل الفاتورة"
                            className="p-2.5 bg-slate-100 text-[#072F5F] hover:bg-blue-100 hover:text-[#0A468C] rounded-xl transition-all shadow-xs"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}

                        {editCap === 'request' && (
                          <button
                            onClick={() => onEditOrder(order, 'edit-request')}
                            title="إرسال طلب تعديل لمسؤول التجهيز والشحن"
                            className="px-2.5 py-2 bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 rounded-xl text-xs font-black transition-all flex items-center gap-1"
                          >
                            <FileEdit className="w-3.5 h-3.5" />
                            <span>{order.pendingEditRequest ? 'تحديث الطلب' : 'طلب تعديل'}</span>
                          </button>
                        )}

                        {canManageStatus &&
                          order.pendingEditRequest &&
                          (order.status === 'جاري التجهيز' || order.status === 'تم التجهيز') && (
                            <button
                              onClick={() => setReviewingOrder(order)}
                              title="مراجعة والموافقة على طلب التعديل"
                              className="px-2.5 py-2 bg-[#072F5F] text-white hover:bg-[#0A468C] rounded-xl text-xs font-black transition-all flex items-center gap-1"
                            >
                              <FileEdit className="w-3.5 h-3.5" />
                              مراجعة
                            </button>
                          )}

                        {canConfirm && canConfirmOutcomeOnOrder && (
                          <button
                            onClick={() => void onUpdateStatus(order.id, 'تم التسليم')}
                            title="تأكيد التسليم"
                            className="px-3 py-2 bg-[#0A468C] text-white hover:bg-[#072F5F] rounded-xl text-xs font-black transition-all shadow-xs flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            تسليم
                          </button>
                        )}

                        {canConfirm && canConfirmOutcomeOnOrder && (
                          <button
                            onClick={() => openReturnModal(order, 'مرتجع')}
                            title="تسجيل كمرتجع"
                            className="p-2.5 bg-slate-100 text-slate-600 hover:bg-orange-50 hover:text-orange-600 rounded-xl transition-all"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}

                        {canCancelOrder(order) && (
                          <button
                            onClick={() => {
                              setCancelError(null);
                              setCancelReason('');
                              setCancelModalOrder(order);
                            }}
                            title="إلغاء الفاتورة مع حفظ السجل"
                            className="p-2.5 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white rounded-xl transition-all shadow-xs"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}

                        {canDelete && (
                          <button
                            onClick={() => setOrderToDelete(order)}
                            title="حذف الفاتورة من النظام"
                            className="p-2.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-xl transition-all shadow-xs"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {filteredOrders.length === 0 && (
        <div className="bg-white rounded-3xl sm:rounded-[2.5rem] p-12 text-center text-slate-500 font-bold space-y-2 border border-slate-200/80">
          <ShoppingCart className="w-12 h-12 text-slate-300 mx-auto" />
          <p>
            {fixedStatus === 'تم التجهيز'
              ? 'لا توجد طلبات مجهزة حالياً.'
              : fixedStatus === 'تم الشحن'
                ? 'لا توجد طلبات في الشحن حالياً.'
                : fixedStatus === 'تم التسليم'
                  ? 'لا توجد طلبات تم تسليمها مطابقة للبحث.'
                  : 'لا توجد فواتير مطابقة لخيارات البحث الحالية.'}
          </p>
        </div>
      )}

      {/* Mandatory Return / Refusal Modal */}
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
                  العميل: {returnModal.order.customerName}
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
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black">
                {returnError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {(['مرتجع', 'رفض استلام'] as const).map((out) => (
                <button
                  key={out}
                  type="button"
                  onClick={() => setReturnModal({ order: returnModal.order, outcome: out })}
                  className={`min-h-[42px] rounded-xl text-xs font-black border ${
                    returnModal.outcome === out
                      ? 'bg-orange-600 text-white border-orange-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  {out}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-800">السبب الرئيسي *</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {RETURN_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setReturnReason(reason)}
                    className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-black border ${
                      returnReason === reason
                        ? 'bg-[#0A468C] text-white border-[#0A468C]'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-bold text-slate-800 bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={flagRefused} onChange={(e) => setFlagRefused(e.target.checked)} className="w-4 h-4 accent-[#0A468C]" />
                <span>هل العميل رفض الاستلام؟</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={flagNoAnswer} onChange={(e) => setFlagNoAnswer(e.target.checked)} className="w-4 h-4 accent-[#0A468C]" />
                <span>هل العميل لم يرد؟</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={flagInvalidAddr} onChange={(e) => setFlagInvalidAddr(e.target.checked)} className="w-4 h-4 accent-[#0A468C]" />
                <span>هل العنوان غير صحيح؟</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={flagCustCancel} onChange={(e) => setFlagCustCancel(e.target.checked)} className="w-4 h-4 accent-[#0A468C]" />
                <span>هل العميل طلب الإلغاء؟</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={flagOther} onChange={(e) => setFlagOther(e.target.checked)} className="w-4 h-4 accent-[#0A468C]" />
                <span>سبب آخر</span>
              </label>
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
                placeholder="اكتب سبب المرتجع أو رفض الاستلام بالتفصيل..."
                className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-sm"
              />
            </div>

            <div className="flex gap-2.5">
              <button
                type="submit"
                className="flex-1 min-h-[48px] py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-sm"
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

      {/* Review Edit Request Modal */}
      {reviewingOrder && reviewingOrder.pendingEditRequest && (
        <div
          className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[740] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg sm:text-xl font-black text-[#072F5F]">
                  مراجعة طلب تعديل فاتورة #{reviewingOrder.id.slice(0, 10)}
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
                disabled={isResolving}
                onClick={() => void handleResolve('approve')}
                className="flex-1 min-h-[48px] px-4 py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-md"
              >
                <Check className="w-4 h-4" />
                موافقة واعتماد التعديل
              </button>

              <button
                disabled={isResolving}
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
                disabled={isResolving}
                onClick={() => void handleResolve('reject')}
                className="min-h-[48px] px-4 py-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-2xl font-black text-sm"
              >
                رفض
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Confirmation Modal (Non-destructive) */}
      {cancelModalOrder && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750] font-cairo"
          dir="rtl"
        >
          <form
            onSubmit={(e) => void handleSubmitCancel(e)}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-red-700 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                إلغاء الفاتورة #{cancelModalOrder.id}
              </h3>
              <button
                type="button"
                onClick={() => setCancelModalOrder(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cancelError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black">
                {cancelError}
              </div>
            )}

            <p className="text-xs text-slate-600 font-bold leading-relaxed">
              تتحول الفاتورة للعميل <span className="text-[#072F5F] font-black">"{cancelModalOrder.customerName}"</span> إلى حالة "ملغي" وتظل محفوظة في السجل للتدقيق.
            </p>

            <div>
              <label className="block text-xs font-black text-slate-800 mb-1.5">
                سبب الإلغاء (إلزامي) *
              </label>
              <textarea
                rows={3}
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="اكتب سبب الإلغاء بوضوح..."
                className="w-full px-3.5 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-red-500 outline-none font-bold text-sm"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={isCancelling}
                className="flex-1 min-h-[48px] py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm transition-all shadow-md disabled:opacity-60"
              >
                {isCancelling ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
              </button>
              <button
                type="button"
                onClick={() => setCancelModalOrder(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
              >
                تراجع
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Order Confirmation Dialog */}
      {orderToDelete && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-5 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-xl font-black text-slate-900">تأكيد حذف الفاتورة</h3>
              <p className="text-sm text-slate-600 font-bold leading-relaxed">
                هل أنت متأكد من حذف فاتورة{' '}
                <span className="text-[#072F5F] font-black">"{orderToDelete.customerName}"</span>{' '}
                (مبلغ {orderToDelete.totalAmount.toLocaleString()} ج.م)؟
              </p>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 font-bold text-right">
                {orderToDelete.status === 'بانتظار تأكيد العميل'
                  ? 'هذه الفاتورة مسودة لم يتم تأكيدها بعد — لن يتأثر المخزون أو العمولات عند حذفها.'
                  : 'سيتم تلقائياً إعادة كميات الزيوت إلى المستودع وإلغاء العمولة المسجلة للسيلز.'}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 min-h-[48px] py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm transition-all shadow-md active:scale-95"
              >
                تأكيد الحذف النهائي
              </button>
              <button
                onClick={() => setOrderToDelete(null)}
                className="min-h-[48px] px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Orders Status Transition Preview Modal */}
      {bulkTargetStatus && (
        <BulkPreviewModal
          preview={bulkPreview}
          title={`معاينة نقل الفواتير إلى "${bulkTargetStatus}"`}
          subtitle="الفواتير غير المستوفية لشروط التسلسل التشغيلي أو المعلقة أو التي تنتظر التوفير تُستبعد تلقائياً"
          confirmLabel={`تأكيد النقل إلى "${bulkTargetStatus}"`}
          confirmVariant={bulkTargetStatus === 'تم التسليم' ? 'primary' : 'amber'}
          executing={bulkExecuting}
          error={bulkError}
          onCancel={() => {
            if (!bulkExecuting) {
              setBulkPreview(null);
              setBulkTargetStatus(null);
              setBulkError(null);
            }
          }}
          onConfirm={() => void handleExecuteBulkTransition()}
        />
      )}

      {/* In-App Batch Invoice Print Portal (renders outside .no-print wrapper) */}
      {showBatchPrint &&
        selectedOrders.length > 0 &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[900] overflow-y-auto p-4 sm:p-8 print:static print:inset-auto print:bg-white print:p-0 print:overflow-visible font-cairo"
            dir="rtl"
          >
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-white rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-xl no-print">
                <div>
                  <h3 className="text-lg font-black text-[#072F5F]">
                    طباعة مجمّعة لـ {selectedOrders.length} فاتورة
                  </h3>
                  <p className="text-xs font-bold text-slate-500">
                    معاينة جاهزة للطباعة أو الحفظ كـ PDF من المتصفح
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="min-h-[44px] px-5 py-2.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-xs inline-flex items-center gap-2"
                  >
                    <Printer className="w-4 h-4" />
                    طباعة الآن
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBatchPrint(false)}
                    className="min-h-[44px] px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-xs"
                  >
                    إغلاق
                  </button>
                </div>
              </div>

              {selectedOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-4 print:rounded-none print:border-b print:shadow-none print:break-after-page"
                >
                  <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                    <div>
                      <h4 className="text-xl font-black text-[#072F5F]">
                        Kima Scent — فاتورة #{ord.id}
                      </h4>
                      <p className="text-xs font-bold text-slate-600 mt-1">
                        العميل: {ord.customerName} · {ord.customerPhone || 'بدون هاتف'}
                      </p>
                      {(ord.governorate || ord.customerAddress) && (
                        <p className="text-xs font-bold text-slate-500">
                          العنوان: {ord.governorate ? `${ord.governorate} — ` : ''}
                          {ord.customerAddress}
                        </p>
                      )}
                    </div>
                    <div className="text-left text-xs space-y-1 tabular-nums">
                      <p className="font-black text-slate-900">الحالة: {ord.status}</p>
                      <p className="font-bold text-slate-500">
                        التاريخ: {new Date(ord.createdAt).toLocaleDateString('ar-EG')}
                      </p>
                      <p className="font-bold text-slate-600">السيلز: {ord.salesRepName}</p>
                    </div>
                  </div>

                  <table className="w-full text-right border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="p-2.5 font-black text-slate-700">الصنف</th>
                        <th className="p-2.5 font-black text-slate-700 text-center">الكمية</th>
                        <th className="p-2.5 font-black text-slate-700 text-center">السعر</th>
                        <th className="p-2.5 font-black text-slate-700 text-center">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ord.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="p-2.5 font-bold text-slate-900">
                            {it.productName} {it.grade ? `(${it.grade})` : ''}
                          </td>
                          <td className="p-2.5 text-center font-bold tabular-nums">
                            {it.quantity.toLocaleString()} {it.unit || 'mg'}
                          </td>
                          <td className="p-2.5 text-center font-bold tabular-nums">
                            {it.price.toLocaleString()} ج.م
                          </td>
                          <td className="p-2.5 text-center font-black tabular-nums">
                            {(it.quantity * it.price).toLocaleString()} ج.م
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-200 text-xs tabular-nums">
                    <div className="space-x-4 space-x-reverse font-bold text-slate-600">
                      <span>المجموع الفرعي: {ord.subtotal.toLocaleString()} ج.م</span>
                      {ord.discountAmount > 0 && (
                        <span>الخصم ({ord.discountPercentage}%): -{ord.discountAmount.toLocaleString()} ج.م</span>
                      )}
                      {ord.shippingCost > 0 && (
                        <span>الشحن: {ord.shippingCost.toLocaleString()} ج.م</span>
                      )}
                    </div>
                    <p className="text-base font-black text-[#072F5F]">
                      الصافي المستحق: {ord.totalAmount.toLocaleString()} ج.م
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
