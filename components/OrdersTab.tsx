import React, { useState } from 'react';
import { 
  ShoppingCart, Search, Filter, Printer, Trash2, CheckCircle2, 
  Clock, XCircle, RotateCcw, Plus, Eye, Phone, MapPin, UserCheck,
  AlertTriangle, X, Check, Droplets
} from 'lucide-react';
import { Order, OrderStatus, User } from '../types';

interface OrdersTabProps {
  orders: Order[];
  currentUser: User;
  onOpenNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onDeleteOrder: (orderId: string) => void;
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  orders,
  currentUser,
  onOpenNewOrder,
  onSelectOrder,
  onUpdateStatus,
  onDeleteOrder
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('الكل');
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);

  const isAdmin = currentUser.role === 'admin';
  const canConfirm = currentUser.role === 'admin' || currentUser.canConfirmDelivery;
  const canDelete = currentUser.role === 'admin' || currentUser.canDeleteOrders;

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customerPhone.includes(searchTerm) ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.salesRepName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'الكل' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleConfirmDelete = () => {
    if (!orderToDelete) return;
    onDeleteOrder(orderToDelete.id);
    setOrderToDelete(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 font-cairo">
      
      {/* Top Filter and Actions Bar */}
      <div className="bg-white p-5 sm:p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="w-5 h-5 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث باسم العميل، رقم الهاتف، اسم المندوب، أو رقم الفاتورة..."
            className="w-full pr-12 pl-4 py-3.5 bg-gray-50 rounded-2xl font-bold outline-none border border-transparent focus:border-emerald-500 text-xs sm:text-sm"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {['الكل', 'قيد التنفيذ', 'تم التسليم', 'مرتجع', 'ملغي'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                statusFilter === status
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <button
          onClick={onOpenNewOrder}
          className="bg-emerald-600 text-white px-5 py-3.5 rounded-2xl font-black shadow-md hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm whitespace-nowrap active:scale-95"
        >
          <Plus className="w-4 h-4" />
          فاتورة جديدة
        </button>
      </div>

      {/* Mobile-Friendly Cards View on Small Screens (block on mobile, hidden on lg) */}
      <div className="block lg:hidden space-y-4">
        {filteredOrders.map(order => (
          <div 
            key={order.id}
            className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-4"
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="font-mono text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">
                  #{order.id.slice(0, 8)}
                </span>
                <h3 className="text-lg font-black text-gray-900 mt-1">{order.customerName}</h3>
                <p className="text-xs text-gray-400 font-bold flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3 text-emerald-600" />
                  {order.customerPhone || 'بدون هاتف'}
                </p>
              </div>

              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-black ${
                order.status === 'تم التسليم' ? 'bg-emerald-100 text-emerald-800' :
                order.status === 'قيد التنفيذ' ? 'bg-amber-100 text-amber-800' :
                order.status === 'مرتجع' ? 'bg-orange-100 text-orange-800' :
                'bg-red-100 text-red-800'
              }`}>
                {order.status === 'تم التسليم' && <CheckCircle2 className="w-3 h-3" />}
                {order.status === 'قيد التنفيذ' && <Clock className="w-3 h-3" />}
                {order.status}
              </span>
            </div>

            {/* Items summary */}
            <div className="bg-gray-50 p-3 rounded-2xl text-xs space-y-1">
              <div className="flex justify-between text-gray-500 font-bold">
                <span>المندوب: {order.salesRepName}</span>
                <span>{order.items.length} أصناف زيت</span>
              </div>
              <div className="flex justify-between items-baseline pt-1 border-t border-gray-200/60">
                <span className="text-gray-600 font-bold">إجمالي الفاتورة:</span>
                <span className="text-base font-black text-emerald-950">
                  {order.totalAmount.toLocaleString()} <span className="text-xs font-normal">ج.م</span>
                </span>
              </div>
            </div>

            {/* Action Buttons on Mobile */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => onSelectOrder(order)}
                className="flex-1 py-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                عرض / طباعة
              </button>

              {canConfirm && order.status === 'قيد التنفيذ' && (
                <button
                  onClick={() => onUpdateStatus(order.id, 'تم التسليم')}
                  className="px-3.5 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  تسليم
                </button>
              )}

              {canConfirm && order.status === 'قيد التنفيذ' && (
                <button
                  onClick={() => onUpdateStatus(order.id, 'مرتجع')}
                  className="p-2.5 bg-gray-100 text-gray-600 hover:bg-orange-50 hover:text-orange-600 rounded-xl transition-all"
                  title="تسجيل كمرتجع"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}

              {canDelete && (
                <button
                  onClick={() => setOrderToDelete(order)}
                  className="p-2.5 text-red-500 hover:bg-red-50 rounded-xl transition-all"
                  title="حذف الفاتورة"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Full Table View */}
      <div className="hidden lg:block bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="p-5 font-black text-xs text-gray-400">رقم الفاتورة</th>
                <th className="p-5 font-black text-xs text-gray-400">العميل والتفاصيل</th>
                <th className="p-5 font-black text-xs text-gray-400">المندوب</th>
                <th className="p-5 font-black text-xs text-gray-400 text-center">الأصناف</th>
                <th className="p-5 font-black text-xs text-gray-400 text-center">المبلغ الصافي</th>
                <th className="p-5 font-black text-xs text-gray-400 text-center">العمولة</th>
                <th className="p-5 font-black text-xs text-gray-400 text-center">الحالة</th>
                <th className="p-5 font-black text-xs text-gray-400 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredOrders.map(order => (
                <tr key={order.id} className="hover:bg-emerald-50/20 transition-all">
                  <td className="p-5">
                    <span className="font-mono text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
                      #{order.id.slice(0, 8)}
                    </span>
                    <p className="text-[11px] text-gray-400 font-bold mt-1">
                      {new Date(order.createdAt).toLocaleDateString('ar-EG')}
                    </p>
                  </td>

                  <td className="p-5">
                    <p className="font-black text-emerald-950 text-base">{order.customerName}</p>
                    <p className="text-xs text-gray-500 font-bold flex items-center gap-1.5 mt-0.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      {order.customerPhone || 'بدون هاتف'}
                    </p>
                    {order.customerAddress && (
                      <p className="text-[11px] text-gray-400 font-bold flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-gray-400" />
                        {order.customerAddress}
                      </p>
                    )}
                  </td>

                  <td className="p-5 font-bold text-gray-700 text-sm">
                    {order.salesRepName}
                  </td>

                  <td className="p-5 text-center">
                    <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-bold">
                      {order.items.length} أصناف
                    </span>
                  </td>

                  <td className="p-5 text-center font-black text-emerald-950 text-base">
                    {order.totalAmount.toLocaleString()} <span className="text-xs font-normal text-gray-400">ج.م</span>
                  </td>

                  <td className="p-5 text-center font-bold text-purple-900 text-sm">
                    {order.commission.toLocaleString()} <span className="text-xs font-normal text-gray-400">ج.م</span>
                  </td>

                  <td className="p-5 text-center">
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black ${
                      order.status === 'تم التسليم' ? 'bg-emerald-100 text-emerald-800' :
                      order.status === 'قيد التنفيذ' ? 'bg-amber-100 text-amber-800' :
                      order.status === 'مرتجع' ? 'bg-orange-100 text-orange-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {order.status === 'تم التسليم' && <CheckCircle2 className="w-3 h-3" />}
                      {order.status === 'قيد التنفيذ' && <Clock className="w-3 h-3" />}
                      {order.status}
                    </span>
                  </td>

                  <td className="p-5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => onSelectOrder(order)}
                        title="طباعة / عرض الفاتورة"
                        className="p-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-xl transition-all shadow-sm"
                      >
                        <Printer className="w-4 h-4" />
                      </button>

                      {/* Status quick changer */}
                      {canConfirm && order.status === 'قيد التنفيذ' && (
                        <button
                          onClick={() => onUpdateStatus(order.id, 'تم التسليم')}
                          title="تأكيد التسليم"
                          className="px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          تسليم
                        </button>
                      )}

                      {canConfirm && order.status === 'قيد التنفيذ' && (
                        <button
                          onClick={() => onUpdateStatus(order.id, 'مرتجع')}
                          title="تسجيل كمرتجع"
                          className="p-2.5 bg-gray-100 text-gray-600 hover:bg-orange-50 hover:text-orange-600 rounded-xl transition-all"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}

                      {/* Delete Button */}
                      {canDelete && (
                        <button
                          onClick={() => setOrderToDelete(order)}
                          title="حذف الفاتورة من النظام"
                          className="p-2.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-xl transition-all shadow-sm"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredOrders.length === 0 && (
        <div className="bg-white rounded-[2.5rem] p-12 text-center text-gray-400 font-bold space-y-2 border border-gray-100">
          <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto" />
          <p>لا توجد فواتير مطابقة لخيارات البحث الحالية.</p>
        </div>
      )}

      {/* Delete Order Confirmation Dialog */}
      {orderToDelete && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-[750] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-7 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-xl font-black text-gray-900">تأكيد حذف الفاتورة</h3>
              <p className="text-xs text-gray-500 font-bold leading-relaxed">
                هل أنت متأكد من حذف فاتورة <span className="text-emerald-950 font-black">"{orderToDelete.customerName}"</span> (مبلغ {orderToDelete.totalAmount.toLocaleString()} ج.م)؟
              </p>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-800 font-bold text-right">
                ⚠️ سيتم تلقائياً إعادة كميات الزيوت إلى المستودع وإلغاء العمولة المسجلة للمندوب.
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs sm:text-sm transition-all shadow-md active:scale-95"
              >
                تأكيد الحذف النهائي
              </button>
              <button
                onClick={() => setOrderToDelete(null)}
                className="px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold text-xs sm:text-sm transition-all"
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
