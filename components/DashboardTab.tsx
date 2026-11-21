import React, { useEffect, useMemo, useState } from 'react';
import { 
  TrendingUp, ShoppingCart, Package, Users, Award, 
  AlertCircle, CheckCircle2, Clock, ArrowUpRight, DollarSign, 
  Sparkles, Layers, BarChart3
} from 'lucide-react';
import { Order, OrdersQueryStats, Product, ProductCategory, SalesRep, User, Customer, SystemGeneralSettings } from '../types';
import { apiClient } from '../src/lib/api';
import { DEFAULT_CATEGORIES } from '../src/lib/commission-utils';
import { getSalesOrderDisplayState, type SalesOrderDisplayState } from '../src/lib/date-utils';
import { UnifiedDateFilterBar, type DateFilterValue } from './UnifiedDateFilterBar';
import { OwnerBIDashboard } from './OwnerBIDashboard';
import { SalesAnalyticsPanel } from './SalesAnalyticsPanel';

interface DashboardTabProps {
  orders: Order[];
  products: Product[];
  categories?: ProductCategory[];
  salesReps: SalesRep[];
  customers: Customer[];
  generalSettings?: SystemGeneralSettings;
  currentUser: User;
  onOpenNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onNavigateTab: (
    tab:
      | 'dashboard'
      | 'operations'
      | 'orders'
      | 'prepared-orders'
      | 'shipping-orders'
      | 'delivered-orders'
      | 'inventory'
      | 'customers'
      | 'reports'
      | 'admin-users'
      | 'owner-console'
  ) => void;
}

const RECENT_BADGE_CLASS: Record<SalesOrderDisplayState['badgeVariant'], string> = {
  slate: 'bg-slate-200 text-slate-800',
  sky: 'bg-sky-100 text-sky-900',
  amber: 'bg-amber-100 text-amber-800',
  yellow: 'bg-yellow-100 text-yellow-900',
  blue: 'bg-blue-100 text-[#072F5F]',
  indigo: 'bg-indigo-100 text-indigo-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  orange: 'bg-orange-100 text-orange-800',
  red: 'bg-red-100 text-red-800',
};

export const DashboardTab: React.FC<DashboardTabProps> = ({
  orders,
  products,
  categories = DEFAULT_CATEGORIES,
  salesReps,
  customers,
  generalSettings,
  currentUser,
  onOpenNewOrder,
  onSelectOrder,
  onNavigateTab
}) => {
  const [ownerViewMode, setOwnerViewMode] = useState<'bi' | 'classic'>('bi');
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({
    preset: 'all',
    dateType: 'createdAt',
  });
  const [queriedOrders, setQueriedOrders] = useState<Order[] | null>(null);
  const [queriedStats, setQueriedStats] = useState<OrdersQueryStats | null>(null);
  const [isQueryLoading, setIsQueryLoading] = useState(false);

  const isAdmin = currentUser.role === 'owner' || currentUser.role === 'admin' || currentUser.role === 'supervisor';
  const canViewInventory = isAdmin || Boolean(currentUser.canEditInventory);
  const canViewTeam = currentUser.role === 'owner' || currentUser.role === 'admin';
  const currentRep = salesReps.find(r => r.userId === currentUser.id || r.id === currentUser.salesRepId);

  const canAccessOperations =
    currentUser.role === 'owner' || currentUser.role === 'admin' || Boolean(currentUser.canManageOrderStatus);

  const isDateFilterActive =
    dateFilter.preset !== 'all' || Boolean(dateFilter.dateFrom) || Boolean(dateFilter.dateTo);

  useEffect(() => {
    if (!isDateFilterActive) {
      setQueriedOrders(null);
      setQueriedStats(null);
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
        setQueriedStats(res.stats);
      })
      .catch((err) => {
        console.error('Failed to query dashboard orders:', err);
      })
      .finally(() => {
        if (!cancelled) setIsQueryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDateFilterActive, dateFilter.preset, dateFilter.dateType, dateFilter.dateFrom, dateFilter.dateTo, orders]);

  // Stats calculation (Backend-filtered when date filter is active, live workspace props otherwise)
  const relevantOrders = useMemo(() => {
    if (isDateFilterActive && queriedOrders) {
      return queriedOrders;
    }
    return isAdmin
      ? orders
      : orders.filter(o => o.salesRepId === currentRep?.id);
  }, [isDateFilterActive, queriedOrders, isAdmin, orders, currentRep?.id]);

  const totalDeliveredRevenue =
    isDateFilterActive && queriedStats
      ? queriedStats.deliveredRevenue
      : relevantOrders
          .filter(o => o.status === 'تم التسليم')
          .reduce((sum, o) => sum + o.totalAmount, 0);

  const awaitingConfirmationCount =
    isDateFilterActive && queriedStats
      ? queriedStats.draftOrdersCount
      : relevantOrders.filter((o) => o.status === 'بانتظار تأكيد العميل').length;

  const pendingOrdersCount =
    isDateFilterActive && queriedStats
      ? queriedStats.activeOrdersCount
      : relevantOrders.filter(
          (o) =>
            o.status === 'طلب جديد' ||
            o.status === 'قيد التنفيذ' ||
            o.status === 'بانتظار التجهيز' ||
            o.status === 'جاري التجهيز' ||
            o.status === 'تم التجهيز' ||
            o.status === 'تم الشحن'
        ).length;

  const deliveredOrdersCount =
    isDateFilterActive && queriedStats
      ? queriedStats.deliveredOrdersCount
      : relevantOrders.filter(o => o.status === 'تم التسليم').length;

  const totalMyCommission =
    isDateFilterActive && queriedStats
      ? queriedStats.totalCommission
      : isAdmin
        ? salesReps.reduce((sum, r) => sum + r.totalCommission, 0)
        : (currentRep?.totalCommission || 0);

  const pendingMyCommission =
    isDateFilterActive && queriedStats
      ? queriedStats.pendingCommission
      : isAdmin
        ? salesReps.reduce((sum, r) => sum + r.pendingCommission, 0)
        : (currentRep?.pendingCommission || 0);

  // Low stock products (category threshold)
  const oilsThreshold = generalSettings?.lowStockThresholdOils ?? 5000;
  const otherThreshold = generalSettings?.lowStockThresholdOther ?? 50;
  const lowStockProducts = products.filter(
    (p) =>
      p.isActive !== false &&
      p.stock < ((p.categoryId || 'cat-oils') === 'cat-oils' ? oilsThreshold : otherThreshold)
  );

  const isOwner = currentUser.role === 'owner';

  if (isOwner && ownerViewMode === 'bi') {
    return (
      <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOwnerViewMode('bi')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#072F5F] text-white text-xs font-black flex items-center gap-1.5 shadow-sm"
            >
              <BarChart3 className="w-4 h-4" />
              اللوحة التنفيذية BI
            </button>
            <button
              type="button"
              onClick={() => setOwnerViewMode('classic')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black"
            >
              المتابعة التشغيلية الكلاسيكية
            </button>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('reports')}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#0A468C] text-xs font-black flex items-center gap-1.5 border border-blue-200"
          >
            <BarChart3 className="w-4 h-4" />
            مركز التقارير الموحد (12 تقرير)
          </button>
        </div>

        <OwnerBIDashboard
          currentUser={currentUser}
          products={products}
          categories={categories}
          salesReps={salesReps}
          onNavigateTab={(tab) => onNavigateTab(tab)}
          onOpenNewOrder={onOpenNewOrder}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-8 animate-in fade-in duration-300">
      {isOwner && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOwnerViewMode('bi')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black flex items-center gap-1.5"
            >
              <BarChart3 className="w-4 h-4" />
              اللوحة التنفيذية BI
            </button>
            <button
              type="button"
              onClick={() => setOwnerViewMode('classic')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#072F5F] text-white text-xs font-black shadow-sm"
            >
              المتابعة التشغيلية الكلاسيكية
            </button>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('reports')}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#0A468C] text-xs font-black flex items-center gap-1.5 border border-blue-200"
          >
            <BarChart3 className="w-4 h-4" />
            مركز التقارير الموحد
          </button>
        </div>
      )}

      {/* Top Welcome Banner */}
      <div className="bg-gradient-to-r from-[#072F5F] via-[#0A468C] to-[#1565C0] rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 md:p-10 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-xs font-black text-blue-100">
              {currentUser.role === 'owner' ? 'المالك الرئيسي' : currentUser.role === 'admin' ? 'الإدارة العليا' : currentUser.role === 'supervisor' ? 'المشرف' : 'فريق السيلز'}
            </span>
            <span className="text-blue-300" aria-hidden="true">·</span>
            <span className="text-xs text-blue-200 font-bold">
              {new Date().toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black">مرحباً، {currentUser.name}</h2>
          <p className="text-blue-100 text-xs sm:text-sm max-w-xl leading-relaxed">
            متابعة فورية للمبيعات، الفواتير والكتالوج المتكامل، نسب العمولات، ومستويات المخزون اللحظية.
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

      {/* Unified Cairo Date Filter for Dashboard KPIs & Recent Orders */}
      <UnifiedDateFilterBar
        value={dateFilter}
        onChange={setDateFilter}
        totalMatched={relevantOrders.length}
        totalRevenue={queriedStats ? queriedStats.totalRevenue : undefined}
        loading={isQueryLoading}
        compact
      />

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
            <span>
              بانتظار التسليم{awaitingConfirmationCount > 0 ? ` (+${awaitingConfirmationCount} مسودة عميل)` : ''}
            </span>
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
            {relevantOrders.slice(0, 5).map(order => {
              const display = getSalesOrderDisplayState(order);
              return (
                <div
                  key={order.id}
                  onClick={() => onSelectOrder(order)}
                  className="p-4 sm:p-5 rounded-2xl bg-slate-50/80 hover:bg-blue-50/50 border border-slate-200/70 hover:border-blue-200 transition-all cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 min-h-[64px]"
                >
                  <div className="space-y-1 w-full sm:w-auto">
                    <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2">
                      <p className="font-black text-slate-900 text-base">{order.customerName}</p>
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-black whitespace-nowrap ${
                        RECENT_BADGE_CLASS[display.badgeVariant]
                      }`}>
                        {display.primaryLabel}
                      </span>
                      {display.secondaryLabel && (
                        <span className="text-[10px] font-black text-[#072F5F] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg">
                          {display.secondaryLabel}
                        </span>
                      )}
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
              );
            })}
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
                  إدارة الكتالوج والمخزون
                </button>
              </div>
              <div className="space-y-2.5">
                {lowStockProducts.length > 0 ? (
                  lowStockProducts.slice(0, 6).map(prod => (
                    <div key={prod.id} className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200/80 flex justify-between items-center gap-2">
                      <div>
                        <p className="font-black text-slate-900 text-sm">{prod.name}</p>
                        <p className="text-xs text-amber-800 font-bold">
                          {prod.categoryName || 'الزيوت العطرية'} · {prod.grade}
                        </p>
                      </div>
                      <span className="text-xs font-black bg-amber-200 text-amber-950 px-3 py-1 rounded-xl tabular-nums whitespace-nowrap">
                        {prod.stock.toLocaleString()} {prod.unit || 'mg'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 text-xs font-bold text-[#072F5F] text-center">
                    جميع أصناف الكتالوج متوفرة بمستويات كافية
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
              {canAccessOperations && (
                <button
                  onClick={() => onNavigateTab('operations')}
                  className="w-full p-3.5 rounded-2xl bg-[#072F5F] hover:bg-[#0A468C] text-white flex justify-between items-center transition-all text-right"
                >
                  <span className="font-black text-sm">إدارة التجهيز والشحن</span>
                  <span className="px-2.5 py-1 rounded-xl bg-white/15 text-white text-xs font-black tabular-nums">
                    {relevantOrders.filter(o =>
                      o.status === 'طلب جديد' ||
                      o.status === 'قيد التنفيذ' ||
                      o.status === 'بانتظار التجهيز' ||
                      o.status === 'جاري التجهيز' ||
                      o.status === 'تم التجهيز' ||
                      o.status === 'تم الشحن'
                    ).length}
                  </span>
                </button>
              )}
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

      {/* Role-scoped Sales & Commission Analytics Panel */}
      <SalesAnalyticsPanel
        currentUser={currentUser}
        title={
          currentUser.role === 'sales'
            ? 'تحليل مبيعاتي وعمولاتي التفصيلي'
            : 'تحليل أداء وعمولات فريق السيلز'
        }
      />
    </div>
  );
};
