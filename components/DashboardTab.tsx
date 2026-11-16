import React from 'react';
import { 
  TrendingUp, ShoppingCart, Package, Users, Award, 
  AlertCircle, CheckCircle2, Clock, ArrowUpRight, DollarSign, 
  Sparkles, Layers
} from 'lucide-react';
import { Order, Product, SalesRep, User, Customer } from '../types';

interface DashboardTabProps {
  orders: Order[];
  products: Product[];
  salesReps: SalesRep[];
  customers: Customer[];
  currentUser: User;
  onOpenNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onNavigateTab: (
    tab:
      | 'dashboard'
      | 'orders'
      | 'prepared-orders'
      | 'shipping-orders'
      | 'delivered-orders'
      | 'inventory'
      | 'customers'
      | 'admin-users'
  ) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  orders,
  products,
  salesReps,
  customers,
  currentUser,
  onOpenNewOrder,
  onSelectOrder,
  onNavigateTab
}) => {
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'supervisor';
  const canViewInventory = isAdmin || Boolean(currentUser.canEditInventory);
  const canViewTeam = currentUser.role === 'admin';
  const currentRep = salesReps.find(r => r.userId === currentUser.id || r.id === currentUser.salesRepId);

  // Stats calculation
  const relevantOrders = isAdmin 
    ? orders 
    : orders.filter(o => o.salesRepId === currentRep?.id);

  const totalDeliveredRevenue = relevantOrders
    .filter(o => o.status === 'تم التسليم')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  const pendingOrdersCount = relevantOrders.filter(
    o => o.status === 'قيد التنفيذ' || o.status === 'تم التجهيز' || o.status === 'تم الشحن'
  ).length;
  const deliveredOrdersCount = relevantOrders.filter(o => o.status === 'تم التسليم').length;

  const totalMyCommission = isAdmin
    ? salesReps.reduce((sum, r) => sum + r.totalCommission, 0)
    : (currentRep?.totalCommission || 0);

  const pendingMyCommission = isAdmin
    ? salesReps.reduce((sum, r) => sum + r.pendingCommission, 0)
    : (currentRep?.pendingCommission || 0);

  // Low stock products (< 5000 mg)
  const lowStockProducts = products.filter(p => p.stock < 5000);

  return (
    <div className="space-y-5 sm:space-y-8 animate-in fade-in duration-300">
      {/* Top Welcome Banner */}
      <div className="bg-gradient-to-r from-[#072F5F] via-[#0A468C] to-[#1565C0] rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 md:p-10 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-xs font-black text-blue-100">
              {currentUser.role === 'admin' ? 'الإدارة العليا' : currentUser.role === 'supervisor' ? 'المشرف' : 'فريق السيلز'}
            </span>
            <span className="text-blue-300" aria-hidden="true">·</span>
            <span className="text-xs text-blue-200 font-bold">
              {new Date().toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black">مرحباً، {currentUser.name}</h2>
          <p className="text-blue-100 text-xs sm:text-sm max-w-xl leading-relaxed">
            متابعة فورية للمبيعات، فواتير الزيوت العطرية، نسب العمولات، ومستويات المخزون اللحظية.
          </p>
        </div>
        <button
          onClick={onOpenNewOrder}
          className="w-full md:w-auto min-h-[48px] bg-white text-[#072F5F] hover:bg-blue-50 px-6 sm:px-8 py-3.5 rounded-2xl font-black shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2.5 active:scale-[0.98] text-sm sm:text-base whitespace-nowrap shrink-0"
        >
          <ShoppingCart className="w-5 h-5 text-[#0A468C]" />
          إنشاء فاتورة جديدة
        </button>
      </div>

      {/* Main KPI Cards Grid (2-column compact on mobile, 4-column on desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <div className="bg-white p-4 sm:p-7 rounded-2xl sm:rounded-[2rem] shadow-sm border border-slate-200/80 hover:border-blue-200 transition-all">
          <div className="flex justify-between items-start mb-2.5 sm:mb-4 gap-2">
            <span className="text-xs font-bold text-slate-600 leading-snug">المبيعات المحصلة</span>
            <div className="p-2 sm:p-3 bg-blue-50 text-[#0A468C] rounded-xl sm:rounded-2xl shrink-0">
              <DollarSign className="w-4 h-4 sm:w-6 sm:h-6" />
            </div>
          </div>
          <p className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums mb-1">
            {totalDeliveredRevenue.toLocaleString()} <span className="text-xs sm:text-sm font-bold text-slate-500">ج.م</span>
          </p>
          <p className="text-[11px] sm:text-xs font-bold text-emerald-700 flex items-center gap-1 mt-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{deliveredOrdersCount} طلب تم تسليمه</span>
          </p>
        </div>

        <div className="bg-white p-4 sm:p-7 rounded-2xl sm:rounded-[2rem] shadow-sm border border-slate-200/80 hover:border-amber-200 transition-all">
          <div className="flex justify-between items-start mb-2.5 sm:mb-4 gap-2">
            <span className="text-xs font-bold text-slate-600 leading-snug">طلبات قيد التنفيذ</span>
            <div className="p-2 sm:p-3 bg-amber-50 text-amber-600 rounded-xl sm:rounded-2xl shrink-0">
              <Clock className="w-4 h-4 sm:w-6 sm:h-6" />
            </div>
          </div>
          <p className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums mb-1">
            {pendingOrdersCount} <span className="text-xs sm:text-sm font-bold text-slate-500">طلب</span>
          </p>
          <p className="text-[11px] sm:text-xs font-bold text-amber-700 flex items-center gap-1 mt-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>بانتظار التسليم</span>
          </p>
        </div>

        <div className="bg-white p-4 sm:p-7 rounded-2xl sm:rounded-[2rem] shadow-sm border border-slate-200/80 hover:border-blue-200 transition-all">
          <div className="flex justify-between items-start mb-2.5 sm:mb-4 gap-2">
            <span className="text-xs font-bold text-slate-600 leading-snug">
              {isAdmin ? 'العمولات المكتسبة' : 'عمولاتي المحصلة'}
            </span>
            <div className="p-2 sm:p-3 bg-blue-50 text-[#0A468C] rounded-xl sm:rounded-2xl shrink-0">
              <Award className="w-4 h-4 sm:w-6 sm:h-6" />
            </div>
          </div>
          <p className="text-xl sm:text-3xl font-black text-[#072F5F] tracking-tight tabular-nums mb-1">
            {totalMyCommission.toLocaleString()} <span className="text-xs sm:text-sm font-bold text-slate-500">ج.م</span>
          </p>
          <p className="text-[11px] sm:text-xs font-bold text-[#0A468C] mt-1.5 tabular-nums">
            + {pendingMyCommission.toLocaleString()} ج.م معلقة
          </p>
        </div>

        <div className="bg-white p-4 sm:p-7 rounded-2xl sm:rounded-[2rem] shadow-sm border border-slate-200/80 hover:border-blue-200 transition-all">
          <div className="flex justify-between items-start mb-2.5 sm:mb-4 gap-2">
            <span className="text-xs font-bold text-slate-600 leading-snug">قاعدة العملاء</span>
            <div className="p-2 sm:p-3 bg-blue-50 text-[#0A468C] rounded-xl sm:rounded-2xl shrink-0">
              <Users className="w-4 h-4 sm:w-6 sm:h-6" />
            </div>
          </div>
          <p className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums mb-1">
            {customers.length} <span className="text-xs sm:text-sm font-bold text-slate-500">عميل</span>
          </p>
          <p className="text-[11px] sm:text-xs font-bold text-[#0A468C] mt-1.5 tabular-nums">
            {customers.filter(c => c.classification === 'ذهبي').length} عميل ذهبي VIP
          </p>
        </div>
      </div>

      {/* Two Columns: Recent Orders & Inventory/Sales Reps */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-8">
        {/* Recent Orders (2 Cols) */}
        <div className="lg:col-span-2 bg-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 shadow-sm border border-slate-200/80">
          <div className="flex justify-between items-center mb-4 sm:mb-6 gap-2">
            <div>
              <h3 className="text-lg sm:text-xl font-black text-slate-900">أحدث الفواتير والطلبات</h3>
              <p className="text-xs text-slate-500 font-bold mt-0.5">آخر العمليات المسجلة في النظام</p>
            </div>
            <button
              onClick={() => onNavigateTab('orders')}
              className="min-h-[44px] text-xs font-black text-[#0A468C] hover:text-white bg-blue-50 hover:bg-[#0A468C] px-4 py-2 rounded-xl transition-all flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              عرض الكل
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {relevantOrders.slice(0, 5).map(order => (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className="p-4 sm:p-5 rounded-2xl bg-slate-50/80 hover:bg-blue-50/50 border border-slate-200/70 hover:border-blue-200 transition-all cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 min-h-[64px]"
              >
                <div className="space-y-1 w-full sm:w-auto">
                  <div className="flex items-center justify-between sm:justify-start gap-2.5">
                    <p className="font-black text-slate-900 text-base">{order.customerName}</p>
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-black whitespace-nowrap ${
                      order.status === 'تم التسليم' ? 'bg-emerald-100 text-emerald-800' :
                      order.status === 'تم التجهيز' ? 'bg-blue-100 text-[#072F5F]' :
                      order.status === 'تم الشحن' ? 'bg-indigo-100 text-indigo-800' :
                      order.status === 'قيد التنفيذ' ? 'bg-amber-100 text-amber-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-bold">
                    السيلز: {order.salesRepName} · {order.items.length} أصناف · {new Date(order.createdAt).toLocaleDateString('ar-EG')}
                  </p>
                </div>
                <div className="w-full sm:w-auto flex sm:block items-baseline justify-between pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60 sm:text-left">
                  <p className="text-base sm:text-lg font-black text-[#072F5F] tabular-nums">
                    {order.totalAmount.toLocaleString()} ج.م
                  </p>
                  <p className="text-xs font-bold text-slate-500 tabular-nums">
                    عمولة: {order.commission.toLocaleString()} ج.م
                  </p>
                </div>
              </div>
            ))}
            {relevantOrders.length === 0 && (
              <div className="text-center py-10 text-slate-500 font-bold text-sm">
                لا توجد طلبات مسجلة بعد.
              </div>
            )}
          </div>
        </div>

        {/* Side Section: Stock Alerts, Sales Reps (if permitted) & Order Stage Shortcuts */}
        <div className="space-y-5 sm:space-y-8">
          {/* Low Stock Warning (Only for Inventory-permitted users) */}
          {canViewInventory && (
            <div className="bg-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-7 shadow-sm border border-slate-200/80">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  تنبيهات المخزون
                </h3>
                <button
                  onClick={() => onNavigateTab('inventory')}
                  className="min-h-[40px] px-2 text-xs font-black text-[#0A468C] hover:underline"
                >
                  إدارة الزيوت
                </button>
              </div>
              <div className="space-y-2.5">
                {lowStockProducts.length > 0 ? (
                  lowStockProducts.map(prod => (
                    <div key={prod.id} className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200/80 flex justify-between items-center gap-2">
                      <div>
                        <p className="font-black text-slate-900 text-sm">{prod.name}</p>
                        <p className="text-xs text-amber-800 font-bold">{prod.grade}</p>
                      </div>
                      <span className="text-xs font-black bg-amber-200 text-amber-950 px-3 py-1 rounded-xl tabular-nums whitespace-nowrap">
                        {prod.stock.toLocaleString()} mg
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 text-xs font-bold text-[#072F5F] text-center">
                    جميع أصناف الزيوت متوفرة بمستويات كافية
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sales Reps Leaderboard (Admin only) */}
          {canViewTeam && (
            <div className="bg-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-7 shadow-sm border border-slate-200/80">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                  <Award className="w-5 h-5 text-[#0A468C]" />
                  أداء فريق السيلز
                </h3>
                <button
                  onClick={() => onNavigateTab('admin-users')}
                  className="min-h-[40px] px-2 text-xs font-black text-[#0A468C] hover:underline"
                >
                  الفريق
                </button>
              </div>
              <div className="space-y-2.5">
                {salesReps.map(rep => (
                  <div key={rep.id} className="p-3.5 rounded-2xl bg-slate-50 flex justify-between items-center border border-slate-200/60">
                    <div className="space-y-0.5">
                      <p className="font-black text-slate-900 text-sm">{rep.name}</p>
                      <p className="text-xs text-slate-500 font-bold tabular-nums">{rep.ordersCount} طلب منجز</p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black text-[#072F5F] tabular-nums">{rep.totalCommission.toLocaleString()} ج.م</p>
                      <p className="text-xs text-slate-500 font-bold tabular-nums">نسبة: {(rep.customCommissionRate * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Order Stages Quick Access */}
          <div className="bg-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-7 shadow-sm border border-slate-200/80">
            <h3 className="text-base sm:text-lg font-black text-slate-900 mb-3.5 flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#0A468C]" />
              متابعة مراحل الطلبات
            </h3>
            <div className="space-y-2.5">
              <button
                onClick={() => onNavigateTab('prepared-orders')}
                className="w-full p-3.5 rounded-2xl bg-blue-50/70 hover:bg-blue-100/80 border border-blue-100 flex justify-between items-center transition-all text-right"
              >
                <span className="font-black text-sm text-[#072F5F]">الطلبات المجهزة</span>
                <span className="px-2.5 py-1 rounded-xl bg-white text-[#0A468C] text-xs font-black tabular-nums">
                  {relevantOrders.filter(o => o.status === 'تم التجهيز').length}
                </span>
              </button>
              <button
                onClick={() => onNavigateTab('shipping-orders')}
                className="w-full p-3.5 rounded-2xl bg-indigo-50/70 hover:bg-indigo-100/80 border border-indigo-100 flex justify-between items-center transition-all text-right"
              >
                <span className="font-black text-sm text-indigo-900">الطلبات في الشحن</span>
                <span className="px-2.5 py-1 rounded-xl bg-white text-indigo-700 text-xs font-black tabular-nums">
                  {relevantOrders.filter(o => o.status === 'تم الشحن').length}
                </span>
              </button>
              <button
                onClick={() => onNavigateTab('delivered-orders')}
                className="w-full p-3.5 rounded-2xl bg-emerald-50/70 hover:bg-emerald-100/80 border border-emerald-100 flex justify-between items-center transition-all text-right"
              >
                <span className="font-black text-sm text-emerald-900">طلبات تم تسليمها</span>
                <span className="px-2.5 py-1 rounded-xl bg-white text-emerald-700 text-xs font-black tabular-nums">
                  {relevantOrders.filter(o => o.status === 'تم التسليم').length}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
