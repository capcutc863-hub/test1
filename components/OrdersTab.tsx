import React, { useState } from 'react';
import {
  ShoppingCart, Search, Printer, Trash2, CheckCircle2,
  Clock, RotateCcw, Plus, Phone, MapPin,
  AlertTriangle, X, Edit2, PackageCheck, Truck, FileEdit, Check
} from 'lucide-react';
import { Order, OrderStatus, User } from '../types';

interface OrdersTabProps {
  orders: Order[];
  currentUser: User;
  fixedStatus?: OrderStatus;
  onOpenNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onEditOrder: (order: Order, mode?: 'edit' | 'edit-request' | 'approve-override') => void;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onResolveEditRequest: (orderId: string, action: 'approve' | 'reject') => Promise<void> | void;
  onDeleteOrder: (orderId: string) => void;
}

const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  'قيد التنفيذ': 'bg-amber-100 text-amber-800',
  'تم التجهيز': 'bg-blue-100 text-[#072F5F] border border-blue-200',
  'تم الشحن': 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  'تم التسليم': 'bg-emerald-100 text-emerald-800',
  'مرتجع': 'bg-orange-100 text-orange-800',
  'ملغي': 'bg-red-100 text-red-800',
};

export const OrdersTab: React.FC<OrdersTabProps> = ({
  orders,
  currentUser,
  fixedStatus,
  onOpenNewOrder,
  onSelectOrder,
  onEditOrder,
  onUpdateStatus,
  onResolveEditRequest,
  onDeleteOrder
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(fixedStatus || 'الكل');
  const [onlyEditRequests, setOnlyEditRequests] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [reviewingOrder, setReviewingOrder] = useState<Order | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const isStrictAdmin = currentUser.role === 'admin';
  const canManageStatus = isStrictAdmin || Boolean(currentUser.canManageOrderStatus);
  const canConfirm =
    isStrictAdmin ||
    currentUser.role === 'supervisor' ||
    currentUser.canConfirmDelivery ||
    Boolean(currentUser.canManageOrderStatus);
  const canDelete = isStrictAdmin || Boolean(currentUser.canDeleteOrders);

  const pendingEditOrders = orders.filter(
    (o) => Boolean(o.pendingEditRequest) && o.status === 'تم التجهيز'
  );

  const getEditCapability = (order: Order): 'direct' | 'request' | 'none' => {
    if (isStrictAdmin) return 'direct';
    if (order.status === 'قيد التنفيذ') return 'direct';
    if (order.status === 'تم التجهيز') {
      return canManageStatus ? 'direct' : 'request';
    }
    return 'none';
  };

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customerPhone.includes(searchTerm) ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.salesRepName.toLowerCase().includes(searchTerm.toLowerCase());

    if (fixedStatus) {
      if (order.status !== fixedStatus) return false;
      if (fixedStatus === 'تم التجهيز' && onlyEditRequests) {
        return matchesSearch && Boolean(order.pendingEditRequest);
      }
      return matchesSearch;
    }

    if (statusFilter === 'طلبات التعديل') {
      return matchesSearch && Boolean(order.pendingEditRequest) && order.status === 'تم التجهيز';
    }

    const matchesStatus = statusFilter === 'الكل' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

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

  const showEditAlert =
    canManageStatus &&
    pendingEditOrders.length > 0 &&
    (!fixedStatus || fixedStatus === 'تم التجهيز');

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
                طلبات تعديل أو إضافة أصناف على فواتير في حالة "تم التجهيز"
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
              placeholder="بحث باسم العميل، الهاتف، السيلز، أو رقم الفاتورة..."
              className="w-full min-h-[48px] pr-12 pl-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200/80 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
            />
          </div>

          <button
            onClick={onOpenNewOrder}
            className="min-h-[48px] bg-[#0A468C] text-white px-5 py-3 rounded-2xl font-black shadow-md hover:bg-[#072F5F] transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            فاتورة جديدة
          </button>
        </div>

        {/* Status Filter Tabs (Full view) or Sub-view indicator (Dedicated stage view) */}
        {!fixedStatus ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {[
              'الكل',
              'قيد التنفيذ',
              'تم التجهيز',
              'تم الشحن',
              'تم التسليم',
              'مرتجع',
              'ملغي',
              ...(canManageStatus && pendingEditOrders.length > 0 ? ['طلبات التعديل'] : []),
            ].map((status) => (
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
      </div>

      {/* Mobile-Friendly Cards View on Small Screens */}
      <div className="block lg:hidden space-y-3.5">
        {filteredOrders.map((order) => {
          const editCap = getEditCapability(order);
          const isActivePending =
            order.status === 'قيد التنفيذ' ||
            order.status === 'تم التجهيز' ||
            order.status === 'تم الشحن';

          return (
            <div
              key={order.id}
              className="bg-white p-4 sm:p-5 rounded-3xl shadow-sm border border-slate-200/80 space-y-3.5"
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-lg">
                    #{order.id.slice(0, 8)}
                  </span>
                  <h3 className="text-lg font-black text-slate-900 mt-1.5">{order.customerName}</h3>
                  <p className="text-xs text-slate-600 font-bold flex items-center gap-1.5 mt-0.5 tabular-nums">
                    <Phone className="w-3.5 h-3.5 text-[#0A468C]" />
                    <span dir="ltr">{order.customerPhone || 'بدون هاتف'}</span>
                  </p>
                </div>

                <span
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black whitespace-nowrap ${
                    STATUS_BADGE_CLASS[order.status]
                  }`}
                >
                  {order.status === 'تم التسليم' && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {order.status === 'تم التجهيز' && <PackageCheck className="w-3.5 h-3.5" />}
                  {order.status === 'تم الشحن' && <Truck className="w-3.5 h-3.5" />}
                  {order.status === 'قيد التنفيذ' && <Clock className="w-3.5 h-3.5" />}
                  {order.status}
                </span>
              </div>

              {/* Pending Edit Request Notice */}
              {order.pendingEditRequest && order.status === 'تم التجهيز' && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-[#072F5F]">
                      يوجد طلب تعديل معلق
                    </p>
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

              {/* Action Buttons on Mobile */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
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

                {canManageStatus && order.status === 'قيد التنفيذ' && (
                  <button
                    onClick={() => onUpdateStatus(order.id, 'تم التجهيز')}
                    className="min-h-[44px] px-3.5 py-2.5 bg-blue-100 text-[#072F5F] hover:bg-[#0A468C] hover:text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                  >
                    <PackageCheck className="w-4 h-4" />
                    تجهيز
                  </button>
                )}

                {canManageStatus &&
                  (order.status === 'قيد التنفيذ' || order.status === 'تم التجهيز') && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'تم الشحن')}
                      className="min-h-[44px] px-3.5 py-2.5 bg-indigo-100 text-indigo-800 hover:bg-indigo-600 hover:text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
                    >
                      <Truck className="w-4 h-4" />
                      شحن
                    </button>
                  )}

                {canConfirm && isActivePending && (
                  <button
                    onClick={() => onUpdateStatus(order.id, 'تم التسليم')}
                    className="min-h-[44px] px-4 py-2.5 bg-[#0A468C] text-white hover:bg-[#072F5F] rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    تسليم
                  </button>
                )}

                {canConfirm && isActivePending && (
                  <button
                    onClick={() => onUpdateStatus(order.id, 'مرتجع')}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-100 text-slate-700 hover:bg-orange-50 hover:text-orange-600 rounded-xl transition-all"
                    title="تسجيل كمرتجع"
                  >
                    <RotateCcw className="w-4 h-4" />
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
                const isActivePending =
                  order.status === 'قيد التنفيذ' ||
                  order.status === 'تم التجهيز' ||
                  order.status === 'تم الشحن';

                return (
                  <tr key={order.id} className="hover:bg-blue-50/30 transition-all">
                    <td className="p-5">
                      <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                        #{order.id.slice(0, 8)}
                      </span>
                      <p className="text-xs text-slate-500 font-bold mt-1">
                        {new Date(order.createdAt).toLocaleDateString('ar-EG')}
                      </p>
                    </td>

                    <td className="p-5">
                      <p className="font-black text-[#072F5F] text-base">{order.customerName}</p>
                      <p className="text-xs text-slate-600 font-bold flex items-center gap-1.5 mt-0.5 tabular-nums">
                        <Phone className="w-3.5 h-3.5 text-[#0A468C]" />
                        <span dir="ltr">{order.customerPhone || 'بدون هاتف'}</span>
                      </p>
                      {order.customerAddress && (
                        <p className="text-xs text-slate-500 font-bold flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {order.customerAddress}
                        </p>
                      )}
                      {order.pendingEditRequest && order.status === 'تم التجهيز' && (
                        <div className="mt-1.5 inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-[#072F5F] px-2.5 py-1 rounded-lg text-[11px] font-black">
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

                    <td className="p-5 font-bold text-slate-700 text-sm">
                      {order.salesRepName}
                    </td>

                    <td className="p-5 text-center">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold tabular-nums">
                        {order.items.length} أصناف
                      </span>
                    </td>

                    <td className="p-5 text-center font-black text-[#072F5F] text-base tabular-nums">
                      {order.totalAmount.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-500">ج.م</span>
                    </td>

                    <td className="p-5 text-center font-bold text-[#0A468C] text-sm tabular-nums">
                      {order.commission.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-500">ج.م</span>
                    </td>

                    <td className="p-5 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black whitespace-nowrap ${
                          STATUS_BADGE_CLASS[order.status]
                        }`}
                      >
                        {order.status === 'تم التسليم' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {order.status === 'تم التجهيز' && <PackageCheck className="w-3.5 h-3.5" />}
                        {order.status === 'تم الشحن' && <Truck className="w-3.5 h-3.5" />}
                        {order.status === 'قيد التنفيذ' && <Clock className="w-3.5 h-3.5" />}
                        {order.status}
                      </span>
                    </td>

                    <td className="p-5 text-center">
                      <div className="flex items-center justify-center flex-wrap gap-1.5">
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
                            title="إرسال طلب تعديل لمسؤول الطلبات"
                            className="px-2.5 py-2 bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 rounded-xl text-xs font-black transition-all flex items-center gap-1"
                          >
                            <FileEdit className="w-3.5 h-3.5" />
                            <span>{order.pendingEditRequest ? 'تحديث الطلب' : 'طلب تعديل'}</span>
                          </button>
                        )}

                        {canManageStatus && order.pendingEditRequest && order.status === 'تم التجهيز' && (
                          <button
                            onClick={() => setReviewingOrder(order)}
                            title="مراجعة والموافقة على طلب التعديل"
                            className="px-2.5 py-2 bg-[#072F5F] text-white hover:bg-[#0A468C] rounded-xl text-xs font-black transition-all flex items-center gap-1"
                          >
                            <FileEdit className="w-3.5 h-3.5" />
                            مراجعة
                          </button>
                        )}

                        {canManageStatus && order.status === 'قيد التنفيذ' && (
                          <button
                            onClick={() => onUpdateStatus(order.id, 'تم التجهيز')}
                            title="تحديث الحالة إلى تم التجهيز"
                            className="px-2.5 py-2 bg-blue-100 text-[#072F5F] hover:bg-[#0A468C] hover:text-white rounded-xl text-xs font-black transition-all flex items-center gap-1"
                          >
                            <PackageCheck className="w-3.5 h-3.5" />
                            تجهيز
                          </button>
                        )}

                        {canManageStatus &&
                          (order.status === 'قيد التنفيذ' || order.status === 'تم التجهيز') && (
                            <button
                              onClick={() => onUpdateStatus(order.id, 'تم الشحن')}
                              title="تحديث الحالة إلى تم الشحن"
                              className="px-2.5 py-2 bg-indigo-100 text-indigo-800 hover:bg-indigo-600 hover:text-white rounded-xl text-xs font-black transition-all flex items-center gap-1"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              شحن
                            </button>
                          )}

                        {canConfirm && isActivePending && (
                          <button
                            onClick={() => onUpdateStatus(order.id, 'تم التسليم')}
                            title="تأكيد التسليم"
                            className="px-3 py-2 bg-[#0A468C] text-white hover:bg-[#072F5F] rounded-xl text-xs font-black transition-all shadow-xs flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            تسليم
                          </button>
                        )}

                        {canConfirm && isActivePending && (
                          <button
                            onClick={() => onUpdateStatus(order.id, 'مرتجع')}
                            title="تسجيل كمرتجع"
                            className="p-2.5 bg-slate-100 text-slate-600 hover:bg-orange-50 hover:text-orange-600 rounded-xl transition-all"
                          >
                            <RotateCcw className="w-4 h-4" />
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

            {/* Comparison Summary */}
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

            {/* Requested Items */}
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
                        {item.grade}
                        {item.isCustom ? ' · صنف جديد/مخصوص' : ''}
                      </p>
                    </div>
                    <span className="font-black text-[#072F5F] tabular-nums whitespace-nowrap">
                      {item.quantity.toLocaleString()} mg × {item.price} ={' '}
                      {(item.quantity * item.price).toLocaleString()} ج.م
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
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
                سيتم تلقائياً إعادة كميات الزيوت إلى المستودع وإلغاء العمولة المسجلة للسيلز.
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
    </div>
  );
};
