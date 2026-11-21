import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  Download,
  Filter,
  Layers,
  Package,
  RefreshCcw,
  RotateCcw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import type {
  BiFilterParams,
  BiPeriodPreset,
  OrderStatus,
  OwnerBiDashboardData,
  Product,
  ProductCategory,
  SalesRep,
  User,
} from '../types';
import { apiClient } from '../src/lib/api';
import { formatUnitTotalsSummary } from '../src/lib/unit-conversion';
import { SalesAnalyticsPanel } from './SalesAnalyticsPanel';

interface OwnerBIDashboardProps {
  currentUser: User;
  products: Product[];
  categories: ProductCategory[];
  salesReps: SalesRep[];
  onNavigateTab: (tab: 'orders' | 'operations' | 'inventory' | 'customers' | 'reports') => void;
  onOpenNewOrder: () => void;
}

const BI_PRESETS: Array<{ id: BiPeriodPreset; label: string }> = [
  { id: 'all', label: 'كل الفترات' },
  { id: 'today', label: 'اليوم' },
  { id: 'yesterday', label: 'أمس' },
  { id: 'this_week', label: 'هذا الأسبوع' },
  { id: 'this_month', label: 'هذا الشهر' },
  { id: 'previous_month', label: 'الشهر السابق' },
  { id: 'last_30_days', label: 'آخر 30 يوم' },
  { id: 'last_90_days', label: 'آخر 90 يوم' },
  { id: 'this_year', label: 'هذا العام' },
  { id: 'custom', label: 'مخصص' },
];

const ORDER_STATUS_OPTIONS: OrderStatus[] = [
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
];

function GrowthPill({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="text-[11px] font-bold text-slate-400">لا توجد فترة سابقة للمقارنة</span>
    );
  }
  const positive = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-black tabular-nums ${
        positive ? 'text-emerald-700' : 'text-red-700'
      }`}
    >
      {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {positive ? `+${pct}%` : `${pct}%`} عن الفترة السابقة
    </span>
  );
}

export const OwnerBIDashboard: React.FC<OwnerBIDashboardProps> = ({
  currentUser,
  products,
  categories,
  salesReps,
  onNavigateTab,
  onOpenNewOrder,
}) => {
  const [filters, setFilters] = useState<BiFilterParams>({
    preset: 'last_30_days',
    topLimit: 10,
    stockSource: 'all',
  });
  const [data, setData] = useState<OwnerBiDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const filterKey = JSON.stringify(filters);

  const loadBiData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getOwnerBiDashboard(filters);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل لوحة تحليلات المالك.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBiData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const handleResetFilters = () => {
    setFilters({
      preset: 'last_30_days',
      topLimit: 10,
      stockSource: 'all',
    });
  };

  const handleExportSalesExcel = async () => {
    setExporting(true);
    try {
      await apiClient.downloadUnifiedReportExcel('sales', filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تصدير ملف Excel.');
    } finally {
      setExporting(false);
    }
  };

  // SVG Time-Series Geometry
  const chartGeometry = useMemo(() => {
    const series = data?.revenueTimeSeries || [];
    if (series.length === 0) return null;
    const width = 680;
    const height = 220;
    const padX = 28;
    const padY = 22;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const maxVal = Math.max(1, ...series.map((s) => Math.max(s.revenue, s.deliveredRevenue)));

    const stepX = series.length > 1 ? innerW / (series.length - 1) : innerW / 2;
    const pointsTotal = series.map((s, idx) => {
      const x = series.length === 1 ? padX + innerW / 2 : padX + idx * stepX;
      const y = padY + innerH - (s.revenue / maxVal) * innerH;
      return { x, y, ...s };
    });
    const pointsDelivered = series.map((s, idx) => {
      const x = series.length === 1 ? padX + innerW / 2 : padX + idx * stepX;
      const y = padY + innerH - (s.deliveredRevenue / maxVal) * innerH;
      return { x, y, ...s };
    });

    const lineTotal = pointsTotal.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const lineDeliv = pointsDelivered
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
      .join(' ');
    const areaTotal = `${lineTotal} L${pointsTotal[pointsTotal.length - 1].x},${padY + innerH} L${pointsTotal[0].x},${padY + innerH} Z`;

    return { width, height, padX, padY, innerH, maxVal, pointsTotal, pointsDelivered, lineTotal, lineDeliv, areaTotal };
  }, [data?.revenueTimeSeries]);

  return (
    <div className="space-y-5 sm:space-y-6 font-cairo animate-in fade-in duration-300" dir="rtl">
      {/* Executive Hero Header */}
      <div className="bg-gradient-to-l from-[#072F5F] via-[#0A468C] to-[#1565C0] rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 text-white shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-blue-100">
            <span>مركز ذكاء الأعمال التنفيذي للمالك الرئيسي</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {data?.appliedRange.dateFrom && data?.appliedRange.dateTo
                ? `${data.appliedRange.dateFrom} ← ${data.appliedRange.dateTo}`
                : 'كافة السجلات (توقيت القاهرة)'}
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black">مرحباً، {currentUser.name}</h2>
          <p className="text-xs sm:text-sm text-blue-100 max-w-2xl leading-relaxed">
            تحليل حي للمبيعات، الأرباح الصافية المرتبطة بتغطية التكلفة الفعلية، أداء المناديب، التصنيفات بوحداتها المستقلة، وتنبيهات التوريد والمخزون.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenNewOrder}
            className="min-h-[46px] px-5 py-2.5 bg-white text-[#072F5F] hover:bg-blue-50 rounded-2xl font-black text-xs sm:text-sm inline-flex items-center gap-2 shadow-md"
          >
            <ShoppingCart className="w-4 h-4 text-[#0A468C]" />
            فاتورة جديدة
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExportSalesExcel()}
            className="min-h-[46px] px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white border border-white/20 rounded-2xl font-black text-xs sm:text-sm inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'جاري التصدير...' : 'تصدير المبيعات XLSX'}
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('reports')}
            className="min-h-[46px] px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-2xl font-black text-xs sm:text-sm inline-flex items-center gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            مركز التقارير (12)
          </button>
        </div>
      </div>

      {/* Comprehensive BI Filter Bar */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-200/80 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-black text-[#072F5F] flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-[#0A468C]" />
            فلاتر التحليل التنفيذي
          </span>
          <div className="flex items-center gap-2">
            {loading && (
              <span className="text-xs font-bold text-[#0A468C] inline-flex items-center gap-1">
                <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                تحديث...
              </span>
            )}
            <button
              type="button"
              onClick={handleResetFilters}
              className="min-h-[34px] px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              إعادة ضبط
            </button>
          </div>
        </div>

        {/* Presets */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {BI_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  preset: p.id,
                  ...(p.id !== 'custom' ? { dateFrom: undefined, dateTo: undefined } : {}),
                }))
              }
              className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                filters.preset === p.id
                  ? 'bg-[#072F5F] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-[#0A468C]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Multi-dimension Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
          {filters.preset === 'custom' && (
            <>
              <div>
                <label className="block font-bold text-slate-500 mb-1">من تاريخ</label>
                <input
                  type="date"
                  value={filters.dateFrom || ''}
                  onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value || undefined }))}
                  className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-500 mb-1">إلى تاريخ</label>
                <input
                  type="date"
                  value={filters.dateTo || ''}
                  onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value || undefined }))}
                  className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums"
                />
              </div>
            </>
          )}

          <div>
            <label className="block font-bold text-slate-500 mb-1">مندوب المبيعات</label>
            <select
              value={filters.salesRepId || 'all'}
              onChange={(e) =>
                setFilters((p) => ({ ...p, salesRepId: e.target.value === 'all' ? undefined : e.target.value }))
              }
              className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">كل المناديب</option>
              {salesReps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-500 mb-1">التصنيف</label>
            <select
              value={filters.categoryId || 'all'}
              onChange={(e) =>
                setFilters((p) => ({ ...p, categoryId: e.target.value === 'all' ? undefined : e.target.value }))
              }
              className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">كل التصنيفات</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-500 mb-1">المنتج</label>
            <select
              value={filters.productId || 'all'}
              onChange={(e) =>
                setFilters((p) => ({ ...p, productId: e.target.value === 'all' ? undefined : e.target.value }))
              }
              className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">كل المنتجات</option>
              {products.slice(0, 200).map((prod) => (
                <option key={prod.id} value={prod.id}>
                  {prod.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-500 mb-1">حالة الفاتورة</label>
            <select
              value={filters.status || 'all'}
              onChange={(e) =>
                setFilters((p) => ({ ...p, status: e.target.value === 'all' ? undefined : e.target.value }))
              }
              className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">كل الحالات</option>
              {ORDER_STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-500 mb-1">تصنيف العميل</label>
            <select
              value={filters.customerClassification || 'all'}
              onChange={(e) =>
                setFilters((p) => ({
                  ...p,
                  customerClassification: e.target.value === 'all' ? undefined : e.target.value,
                }))
              }
              className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">كل العملاء</option>
              <option value="ذهبي">ذهبي VIP</option>
              <option value="فضي">فضي</option>
              <option value="عادي">عادي</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-500 mb-1">مصدر التوفير</label>
            <select
              value={filters.stockSource || 'all'}
              onChange={(e) =>
                setFilters((p) => ({
                  ...p,
                  stockSource: e.target.value as BiFilterParams['stockSource'],
                }))
              }
              className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">الكل</option>
              <option value="warehouse">من المخزون</option>
              <option value="external">توفير خارجي</option>
              <option value="pending">بانتظار التوفير</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-500 mb-1">أعلى المنتجات</label>
            <select
              value={filters.topLimit || 10}
              onChange={(e) => setFilters((p) => ({ ...p, topLimit: Number(e.target.value) || 10 }))}
              className="w-full min-h-[40px] px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums"
            >
              <option value={10}>أعلى 10</option>
              <option value={20}>أعلى 20</option>
              <option value={50}>أعلى 50</option>
              <option value={100}>أعلى 100</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Primary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-sm space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>إجمالي المبيعات المؤكدة</span>
                <ShoppingCart className="w-4 h-4 text-[#0A468C]" />
              </div>
              <p className="text-2xl sm:text-3xl font-black text-[#072F5F] tabular-nums">
                {data.kpis.totalRevenue.toLocaleString()}{' '}
                <span className="text-xs font-bold text-slate-500">ج.م</span>
              </p>
              <p className="text-[11px] font-bold text-emerald-700 tabular-nums">
                تم تسليمها: {data.kpis.deliveredRevenue.toLocaleString()} ج.م ({data.kpis.deliveredOrdersCount})
              </p>
              <GrowthPill pct={data.kpis.growth.revenuePct} />
            </div>

            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-sm space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>عدد الطلبات ومتوسط الفاتورة</span>
                <Layers className="w-4 h-4 text-[#0A468C]" />
              </div>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums">
                {data.kpis.ordersCount.toLocaleString()}{' '}
                <span className="text-xs font-bold text-slate-500">فاتورة</span>
              </p>
              <p className="text-[11px] font-bold text-slate-600 tabular-nums">
                متوسط الفاتورة (AOV): {data.kpis.averageOrderValue.toLocaleString()} ج.م
              </p>
              <GrowthPill pct={data.kpis.growth.ordersPct} />
            </div>

            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-sm space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>العملاء المشترون</span>
                <Users className="w-4 h-4 text-[#0A468C]" />
              </div>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums">
                {data.kpis.uniqueBuyersCount.toLocaleString()}{' '}
                <span className="text-xs font-bold text-slate-500">عميل</span>
              </p>
              <p className="text-[11px] font-bold text-slate-600 tabular-nums">
                جدد: {data.kpis.newBuyersCount} · متكررون: {data.kpis.repeatBuyersCount}
              </p>
              <GrowthPill pct={data.kpis.growth.uniqueBuyersPct} />
            </div>

            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-sm space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>العمولات المكتسبة والمعلقة</span>
                <Award className="w-4 h-4 text-[#0A468C]" />
              </div>
              <p className="text-2xl sm:text-3xl font-black text-emerald-700 tabular-nums">
                {data.kpis.earnedCommission.toLocaleString()}{' '}
                <span className="text-xs font-bold text-slate-500">ج.م</span>
              </p>
              <p className="text-[11px] font-bold text-amber-700 tabular-nums">
                معلقة قيد التشغيل: {data.kpis.pendingCommission.toLocaleString()} ج.م
              </p>
              <p className="text-[11px] font-bold text-slate-500 tabular-nums">
                كميات مباعة: {formatUnitTotalsSummary(data.kpis.unitsSoldByUnit)}
              </p>
            </div>
          </div>

          {/* Cost-Gated Profit & Inventory Valuation Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-black text-[#072F5F]">ملخص الربحية وتكلفة البضاعة</h3>
                <span
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-black ${
                    data.profitSummary.status === 'complete'
                      ? 'bg-emerald-100 text-emerald-800'
                      : data.profitSummary.status === 'partial'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {data.profitSummary.status === 'complete'
                    ? 'تكاليف مكتملة'
                    : data.profitSummary.status === 'partial'
                      ? `تغطية جزئية (${Math.round(data.profitSummary.coverageRatio * 100)}%)`
                      : 'التكاليف غير مكتملة'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs tabular-nums">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block">صافي الربح الإجمالي</span>
                  <strong className="text-lg font-black text-[#072F5F]">
                    {data.profitSummary.grossProfit !== null
                      ? `${data.profitSummary.grossProfit.toLocaleString()} ج.م`
                      : 'غير مكتمل'}
                  </strong>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block">ربح البنود المسعّرة فقط</span>
                  <strong className="text-lg font-black text-emerald-700">
                    {data.profitSummary.partialGrossProfit !== null
                      ? `${data.profitSummary.partialGrossProfit.toLocaleString()} ج.م`
                      : '—'}
                  </strong>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block">هامش الربح (المسعّر)</span>
                  <strong className="text-lg font-black text-slate-900">
                    {data.profitSummary.marginPercentage !== null
                      ? `${data.profitSummary.marginPercentage}%`
                      : '—'}
                  </strong>
                </div>
              </div>

              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                {data.profitSummary.noteAr} · تكلفة مخزنية معروفة: {data.profitSummary.knownCatalogCost.toLocaleString()} ج.م · تكلفة توريد خارجي: {data.profitSummary.knownExternalSourcingCost.toLocaleString()} ج.م.
              </p>
            </div>

            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-black text-[#072F5F]">تقييم المخزون الحالي</h3>
                <span
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-black ${
                    data.inventoryValuation.status === 'complete'
                      ? 'bg-emerald-100 text-emerald-800'
                      : data.inventoryValuation.status === 'partial'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {data.inventoryValuation.status === 'complete'
                    ? 'تقييم كامل'
                    : data.inventoryValuation.status === 'partial'
                      ? `تغطية ${Math.round(data.inventoryValuation.coverageRatio * 100)}%`
                      : 'غير متاح'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs tabular-nums">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block">القيمة الإجمالية الكاملة</span>
                  <strong className="text-lg font-black text-[#072F5F]">
                    {data.inventoryValuation.totalStockValue !== null
                      ? `${data.inventoryValuation.totalStockValue.toLocaleString()} ج.م`
                      : 'غير مكتمل'}
                  </strong>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block">قيمة الأصناف المسعّرة</span>
                  <strong className="text-lg font-black text-emerald-700">
                    {data.inventoryValuation.partialKnownStockValue.toLocaleString()} ج.م
                  </strong>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block">أصناف مسعّرة / ذات رصيد</span>
                  <strong className="text-lg font-black text-slate-900">
                    {data.inventoryValuation.valuedProductsCount} / {data.inventoryValuation.productsWithStock}
                  </strong>
                </div>
              </div>

              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                {data.inventoryValuation.noteAr} · أرصدة المستودع حسب الوحدة:{' '}
                <span className="text-[#072F5F]">
                  {formatUnitTotalsSummary(data.inventoryValuation.unitsBreakdown)}
                </span>
              </p>
            </div>
          </div>

          {/* Alerts + Sourcing Overview */}
          {data.alerts.length > 0 && (
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-3">
              <h3 className="text-base font-black text-[#072F5F] flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                تنبيهات الأعمال والفرص (مبنية على قواعد واضحة)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.alerts.map((al) => (
                  <div
                    key={al.id}
                    className={`p-4 rounded-2xl border space-y-1 text-xs ${
                      al.severity === 'critical'
                        ? 'bg-red-50 border-red-200 text-red-950'
                        : al.severity === 'opportunity'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                          : 'bg-amber-50 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-sm">{al.title}</span>
                      {al.metric && (
                        <span className="px-2 py-0.5 rounded-lg bg-white/80 font-black tabular-nums">
                          {al.metric}
                        </span>
                      )}
                    </div>
                    <p className="font-bold leading-relaxed">{al.message}</p>
                    <p className="text-[11px] opacity-80 font-bold">القاعدة: {al.ruleExplanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SVG Time Series Chart + Order Status Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="lg:col-span-2 bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-black text-[#072F5F]">منحنى الإيرادات الزمني</h3>
                  <p className="text-xs font-bold text-slate-500">
                    مقارنة إجمالي المبيعات المؤكدة مع الإيرادات المحصلة بالتسليم
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-bold text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-1.5 bg-[#0A468C] inline-block rounded" />
                    مبيعات مؤكدة
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-1.5 bg-emerald-600 inline-block rounded" />
                    مبيعات التسليم
                  </span>
                </div>
              </div>

              {!chartGeometry ? (
                <div className="py-12 text-center text-xs font-bold text-slate-400">
                  لا توجد بيانات زمنية لعرض المنحنى في هذه الفترة.
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                    className="w-full h-56 overflow-visible"
                    role="img"
                    aria-label="منحنى الإيرادات"
                  >
                    {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
                      const y = chartGeometry.padY + chartGeometry.innerH * (1 - frac);
                      return (
                        <g key={idx}>
                          <line
                            x1={chartGeometry.padX}
                            y1={y}
                            x2={chartGeometry.width - chartGeometry.padX}
                            y2={y}
                            stroke="#e2e8f0"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={chartGeometry.padX - 4}
                            y={y + 3}
                            textAnchor="end"
                            className="fill-slate-400 text-[9px] font-bold"
                          >
                            {Math.round(chartGeometry.maxVal * frac).toLocaleString()}
                          </text>
                        </g>
                      );
                    })}
                    <path d={chartGeometry.areaTotal} fill="#0A468C" fillOpacity="0.08" />
                    <path
                      d={chartGeometry.lineTotal}
                      fill="none"
                      stroke="#0A468C"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                    />
                    <path
                      d={chartGeometry.lineDeliv}
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      strokeLinejoin="round"
                    />
                    {chartGeometry.pointsTotal.map((p, idx) => (
                      <g key={p.bucket}>
                        <circle cx={p.x} cy={p.y} r="3.5" fill="#072F5F">
                          <title>{`${p.label}: ${p.revenue.toLocaleString()} ج.م (${p.ordersCount} طلب)`}</title>
                        </circle>
                        {(chartGeometry.pointsTotal.length <= 12 || idx % Math.ceil(chartGeometry.pointsTotal.length / 8) === 0) && (
                          <text
                            x={p.x}
                            y={chartGeometry.height - 4}
                            textAnchor="middle"
                            className="fill-slate-500 text-[9px] font-bold"
                          >
                            {p.label}
                          </text>
                        )}
                      </g>
                    ))}
                  </svg>
                </div>
              )}
            </div>

            {/* Status Breakdown */}
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-[#072F5F]">توزيع حالات الفواتير</h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('orders')}
                  className="text-xs font-black text-[#0A468C] hover:underline"
                >
                  فتح الفواتير
                </button>
              </div>
              <div className="space-y-2.5">
                {data.statusBreakdown.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 text-center py-8">لا توجد فواتير.</p>
                ) : (
                  data.statusBreakdown.map((st) => (
                    <button
                      key={st.status}
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          status: prev.status === st.status ? undefined : st.status,
                        }))
                      }
                      className="w-full text-right space-y-1 p-2 rounded-xl hover:bg-slate-50 transition-all"
                    >
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-slate-800">{st.status}</span>
                        <span className="text-[#072F5F] tabular-nums">
                          {st.count} ({st.sharePct}%) · {st.revenue.toLocaleString()} ج.م
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0A468C] rounded-full"
                          style={{ width: `${Math.min(100, st.sharePct)}%` }}
                        />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Unit-Safe Category Breakdown + Sourcing Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-3.5">
              <h3 className="text-base font-black text-[#072F5F]">المبيعات حسب التصنيف (بوحداتها المستقلة)</h3>
              <div className="space-y-2.5">
                {data.categoryBreakdown.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 text-center py-6">لا توجد مبيعات في الفترة.</p>
                ) : (
                  data.categoryBreakdown.map((cat) => (
                    <div
                      key={cat.categoryId}
                      className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/70 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-slate-900">{cat.categoryName}</span>
                        <span className="font-black text-[#072F5F] tabular-nums">
                          {cat.revenue.toLocaleString()} ج.م ({cat.sharePct}%)
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-600 tabular-nums">
                        <span>{cat.ordersCount} فاتورة</span>
                        <span>الكميات: {formatUnitTotalsSummary(cat.unitsByUnit)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-[#072F5F]">تغطية المخزون والتوريد الخارجي</h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('operations')}
                  className="text-xs font-black text-[#0A468C] hover:underline"
                >
                  متابعة التوريد
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs tabular-nums">
                <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl">
                  <span className="text-[#0A468C] font-bold block">مسحوب من المخزن</span>
                  <strong className="text-sm font-black text-[#072F5F]">
                    {formatUnitTotalsSummary(data.sourcingSummary.warehouseUnitsByUnit)}
                  </strong>
                </div>
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl">
                  <span className="text-emerald-700 font-bold block">توفير خارجي</span>
                  <strong className="text-sm font-black text-emerald-900">
                    {formatUnitTotalsSummary(data.sourcingSummary.externalUnitsByUnit)}
                  </strong>
                </div>
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                  <span className="text-amber-800 font-bold block">بانتظار التوفير</span>
                  <strong className="text-sm font-black text-amber-950">
                    {data.sourcingSummary.pendingOrdersCount} طلب ({data.sourcingSummary.pendingItemsCount} بند)
                  </strong>
                </div>
              </div>
              <p className="text-xs font-bold text-slate-600 tabular-nums">
                إجمالي تكلفة التوريد الخارجي المسجلة: {data.sourcingSummary.knownExternalCostTotal.toLocaleString()} ج.م ({data.sourcingSummary.externalRecordsCount} سجل، منها {data.sourcingSummary.missingCostExternalRecordsCount} بدون تكلفة).
              </p>
            </div>
          </div>

          {/* Top Products Table with Stocking Opportunity */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base sm:text-lg font-black text-[#072F5F] flex items-center gap-2">
                <Package className="w-5 h-5 text-[#0A468C]" />
                أعلى {data.topProducts.length} منتجاً مبيعاً وفرص التخزين
              </h3>
              <button
                type="button"
                onClick={() => onNavigateTab('inventory')}
                className="text-xs font-black text-[#0A468C] hover:underline"
              >
                إدارة المخزون
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-right border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="p-3.5 font-black text-slate-600">المنتج</th>
                    <th className="p-3.5 font-black text-slate-600">التصنيف</th>
                    <th className="p-3.5 font-black text-slate-600 text-center">الكمية المباعة</th>
                    <th className="p-3.5 font-black text-slate-600 text-center">المبيعات</th>
                    <th className="p-3.5 font-black text-slate-600 text-center">المخزون الحالي</th>
                    <th className="p-3.5 font-black text-slate-600 text-center">توريد خارجي / معلق</th>
                    <th className="p-3.5 font-black text-slate-600">توصية التخزين</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.topProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 font-bold">
                        لا توجد مبيعات منتجات مطابقة للفلاتر.
                      </td>
                    </tr>
                  ) : (
                    data.topProducts.map((tp) => (
                      <tr key={tp.productId} className="hover:bg-blue-50/30">
                        <td className="p-3.5">
                          <p className="font-black text-slate-900">{tp.productName}</p>
                          <p className="text-[11px] font-bold text-slate-500" dir="ltr">
                            {tp.productCode}
                          </p>
                        </td>
                        <td className="p-3.5 font-bold text-slate-700">{tp.categoryName}</td>
                        <td className="p-3.5 text-center font-black tabular-nums">
                          {tp.quantitySold.toLocaleString()} {tp.unit}
                        </td>
                        <td className="p-3.5 text-center font-black text-[#072F5F] tabular-nums">
                          {tp.revenue.toLocaleString()} ج.م
                        </td>
                        <td className="p-3.5 text-center font-bold tabular-nums">
                          {tp.currentStock.toLocaleString()} {tp.unit}
                        </td>
                        <td className="p-3.5 text-center font-bold tabular-nums text-slate-600">
                          خارجي: {tp.externalSuppliedQty.toLocaleString()} · معلق: {tp.pendingSourcingQty.toLocaleString()}
                        </td>
                        <td className="p-3.5">
                          {tp.stockingOpportunity ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-100 text-amber-950 font-black text-[11px]">
                              فرصة تخزين · {tp.stockingOpportunityReason}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              تغطية مستقرة
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Embedded Sales Rep Comparison */}
          <SalesAnalyticsPanel currentUser={currentUser} filters={filters} />
        </>
      )}
    </div>
  );
};
