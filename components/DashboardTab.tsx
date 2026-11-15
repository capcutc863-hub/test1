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
  onNavigateTab: (tab: 'dashboard' | 'orders' | 'inventory' | 'customers' | 'admin-users') => void;
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
  const currentRep = salesReps.find(r => r.userId === currentUser.id);

  // Stats calculation
  const relevantOrders = isAdmin 
    ? orders 
    : orders.filter(o => o.salesRepId === currentRep?.id);

  const totalDeliveredRevenue = relevantOrders
    .filter(o => o.status === 'تم التسليم')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  const pendingOrdersCount = relevantOrders.filter(o => o.status === 'قيد التنفيذ').length;
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
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Welcome Banner */}
      <div className="bg-gradient-to-r from-[#064E3B] via-[#047857] to-[#059669] rounded-[2.5rem] p-8 md:p-10 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold text-emerald-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              {currentUser.role === 'admin' ? 'لوحة تحكم الإدارة العليا' : currentUser.role === 'supervisor' ? 'لوحة المشرف' : 'لوحة المندوب'}
            </span>
            <span className="text-xs text-emerald-200">{new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-black">مرحباً، {currentUser.name} 👋</h2>
          <p className="text-emerald-100 text-sm max-w-xl">
            متابعة فورية للمبيعات، فواتير الزيوت العطرية، نسب العمولات، ومستويات المخزون اللحظية.
          </p>
        </div>
        <button
          onClick={onOpenNewOrder}
          className="bg-white text-emerald-950 hover:bg-emerald-50 px-8 py-4 rounded-2xl font-black shadow-lg hover:shadow-2xl transition-all flex items-center gap-3 active:scale-95 text-base whitespace-nowrap"
        >
          <ShoppingCart className="w-5 h-5 text-emerald-700" />
          إنشاء فاتورة جديدة
        </button>
      </div>

      {/* Main KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-7 rounded-[2rem] shadow-sm border border-gray-100/80 hover:border-emerald-200 transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-bold text-gray-500">إجمالي المبيعات المحصلة</span>
            <div className="p-3 bg-emerald-50 text-emerald-700 rounded-2xl">
              <DollarSign className="w-6 h-6" />
            </div>
          </div>
          <p className="text-3xl font-black text-gray-900 tracking-tight mb-1">
            {totalDeliveredRevenue.toLocaleString()} <span className="text-sm font-bold text-gray-400">ج.م</span>
          </p>
          <p className="text-xs font-bold text-emerald-600 flex items-center gap-1 mt-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {deliveredOrdersCount} طلب تم تسليمه بنجاح
          </p>
        </div>

        <div className="bg-white p-7 rounded-[2rem] shadow-sm border border-gray-100/80 hover:border-amber-200 transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-bold text-gray-500">طلبات قيد التنفيذ</span>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
              <Clock className="w-6 h-6" />
            </div>
          </div>
          <p className="text-3xl font-black text-gray-900 tracking-tight mb-1">
            {pendingOrdersCount} <span className="text-sm font-bold text-gray-400">طلب</span>
          </p>
          <p className="text-xs font-bold text-amber-600 flex items-center gap-1 mt-2">
            <AlertCircle className="w-3.5 h-3.5" />
            بانتظار التأكيد والتسليم
          </p>
        </div>

        <div className="bg-white p-7 rounded-[2rem] shadow-sm border border-gray-100/80 hover:border-purple-200 transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-bold text-gray-500">
              {isAdmin ? 'إجمالي العمولات المكتسبة' : 'عمولاتي المحصلة'}
            </span>
            <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
              <Award className="w-6 h-6" />
            </div>
          </div>
          <p className="text-3xl font-black text-purple-950 tracking-tight mb-1">
            {totalMyCommission.toLocaleString()} <span className="text-sm font-bold text-gray-400">ج.م</span>
          </p>
          <p className="text-xs font-bold text-purple-600 mt-2">
            + {pendingMyCommission.toLocaleString()} ج.م معلقة قيد التنفيذ
          </p>
        </div>

        <div className="bg-white p-7 rounded-[2rem] shadow-sm border border-gray-100/80 hover:border-blue-200 transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-bold text-gray-500">قاعدة العملاء النشطة</span>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Users className="w-6 h-6" />
            </div>
          </div>
          <p className="text-3xl font-black text-gray-900 tracking-tight mb-1">
            {customers.length} <span className="text-sm font-bold text-gray-400">عميل</span>
          </p>
          <p className="text-xs font-bold text-blue-600 mt-2">
            {customers.filter(c => c.classification === 'ذهبي').length} عميل ذهبي VIP
          </p>
        </div>
      </div>

      {/* Two Columns: Recent Orders & Inventory/Sales Reps */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Orders (2 Cols) */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-xl font-black text-gray-900">أحدث الفواتير والطلبات</h3>
              <p className="text-xs text-gray-400 font-bold mt-1">آخر العمليات المسجلة في النظام</p>
            </div>
            <button
              onClick={() => onNavigateTab('orders')}
              className="text-xs font-black text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-xl transition-all flex items-center gap-1"
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
                className="p-5 rounded-2xl bg-gray-50/70 hover:bg-emerald-50/40 border border-gray-100 hover:border-emerald-200 transition-all cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <p className="font-black text-gray-900 text-base">{order.customerName}</p>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black ${
                      order.status === 'تم التسليم' ? 'bg-emerald-100 text-emerald-800' :
                      order.status === 'قيد التنفيذ' ? 'bg-amber-100 text-amber-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 font-bold">
                    المندوب: {order.salesRepName} • {order.items.length} أصناف • {new Date(order.createdAt).toLocaleDateString('ar-EG')}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-lg font-black text-emerald-950">{order.totalAmount.toLocaleString()} ج.م</p>
                  <p className="text-[11px] font-bold text-gray-400">عمولة: {order.commission.toLocaleString()} ج.م</p>
                </div>
              </div>
            ))}
            {relevantOrders.length === 0 && (
              <div className="text-center py-12 text-gray-400 font-bold text-sm">
                لا توجد طلبات مسجلة بعد.
              </div>
            )}
          </div>
        </div>

        {/* Side Section: Stock Alerts & Sales Reps */}
        <div className="space-y-8">
          {/* Low Stock Warning */}
          <div className="bg-white rounded-[2.5rem] p-7 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                تنبيهات المخزون
              </h3>
              <button
                onClick={() => onNavigateTab('inventory')}
                className="text-xs font-bold text-emerald-700 hover:underline"
              >
                إدارة الزيوت
              </button>
            </div>
            <div className="space-y-3">
              {lowStockProducts.length > 0 ? (
                lowStockProducts.map(prod => (
                  <div key={prod.id} className="p-4 bg-amber-50/60 rounded-2xl border border-amber-100 flex justify-between items-center">
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{prod.name}</p>
                      <p className="text-[11px] text-amber-700 font-bold">{prod.grade}</p>
                    </div>
                    <span className="text-xs font-black bg-amber-200 text-amber-900 px-3 py-1 rounded-xl">
                      {prod.stock.toLocaleString()} mg
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-xs font-bold text-emerald-800 text-center">
                  جميع أصناف الزيوت متوفرة بمستويات كافية ✅
                </div>
              )}
            </div>
          </div>

          {/* Sales Reps Leaderboard */}
          <div className="bg-white rounded-[2.5rem] p-7 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Award className="w-5 h-5 text-purple-600" />
                أداء المندوبين
              </h3>
              {isAdmin && (
                <button
                  onClick={() => onNavigateTab('admin-users')}
                  className="text-xs font-bold text-emerald-700 hover:underline"
                >
                  الفريق
                </button>
              )}
            </div>
            <div className="space-y-3">
              {salesReps.map(rep => (
                <div key={rep.id} className="p-4 rounded-2xl bg-gray-50 flex justify-between items-center border border-gray-100">
                  <div className="space-y-0.5">
                    <p className="font-black text-gray-900 text-sm">{rep.name}</p>
                    <p className="text-[11px] text-gray-400 font-bold">{rep.ordersCount} طلب منجز</p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-black text-purple-900">{rep.totalCommission.toLocaleString()} ج.م</p>
                    <p className="text-[10px] text-gray-400 font-bold">نسبة: {(rep.customCommissionRate * 100).toFixed(0)}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
