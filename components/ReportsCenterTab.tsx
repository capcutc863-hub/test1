import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  Filter,
  Printer,
  RefreshCcw,
} from 'lucide-react';
import type {
  BiFilterParams,
  BiPeriodPreset,
  CustomerRepeatFilter,
  OrderStatus,
  ProductCategory,
  SalesRep,
  UnifiedReportType,
  User,
} from '../types';
import { apiClient, type UnifiedReportClientPayload } from '../src/lib/api';
import { formatUnitTotalsSummary } from '../src/lib/unit-conversion';

interface ReportsCenterTabProps {
  currentUser: User;
  categories: ProductCategory[];
  salesReps: SalesRep[];
}

const REPORT_CATALOG: Array<{
  id: UnifiedReportType;
  label: string;
  desc: string;
}> = [
  { id: 'sales', label: '1. المبيعات والفواتير', desc: 'تفاصيل الفواتير والمبالغ والخصومات والعمولات' },
  { id: 'sales_reps', label: '2. أداء المناديب', desc: 'مبيعات ومتوسط فواتير وعملاء كل مندوب' },
  { id: 'commissions', label: '3. العمولات المستحقة والمعلقة', desc: 'العمولة المكتسبة عند التسليم مقابل المعلقة' },
  { id: 'categories', label: '4. مبيعات التصنيفات', desc: 'إيرادات وكميات التصنيفات بوحداتها المستقلة' },
  { id: 'products', label: '5. أداء المنتجات', desc: 'أكثر الأصناف طلباً ومبيعاتها وأرصدتها' },
  { id: 'customers', label: '6. العملاء والمبيعات', desc: 'إنفاق العملاء وتواريخ الطلب والمندوب المسؤول' },
  { id: 'repeat_customers', label: '7. تكرار الشراء والخمول', desc: 'تحليل ولاء العملاء وفجوة الانقطاع' },
  { id: 'inventory_valuation', label: '8. تقييم المخزون والتكلفة', desc: 'قيمة المخزون الحالية مع تغطية أسعار التكلفة' },
  { id: 'stock_movements', label: '9. سجل حركات المخزون', desc: 'حركات الخصم والاستلام والتسويات الجماعية' },
  { id: 'external_sourcing', label: '10. التوريد الخارجي والتكاليف', desc: 'مشتريات الموردين والتوفير المباشر للطلبات' },
  { id: 'invoice_status', label: '11. توزيع حالات الفواتير', desc: 'نسب وعدد الفواتير في كل مرحلة' },
  { id: 'operations_performance', label: '12. كفاءة التشغيل والتجهيز', desc: 'أزمنة الدورة التشغيلية وحالات التعليق والتوفير' },
];

const SALES_ALLOWED = new Set<UnifiedReportType>([
  'sales',
  'commissions',
  'customers',
  'repeat_customers',
  'invoice_status',
]);

const STATUS_OPTIONS: OrderStatus[] = [
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

function formatCellValue(
  value: string | number | null | undefined,
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent'
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (format === 'currency') return `${value.toLocaleString()} ج.م`;
    if (format === 'percent') return `${value}%`;
    return value.toLocaleString();
  }
  return String(value);
}

export const ReportsCenterTab: React.FC<ReportsCenterTabProps> = ({
  currentUser,
  categories,
  salesReps,
}) => {
  const visibleReports = useMemo(() => {
    if (currentUser.role === 'owner' || currentUser.role === 'admin') {
      return REPORT_CATALOG;
    }
    if (currentUser.role === 'supervisor') {
      return REPORT_CATALOG.filter(
        (r) => r.id !== 'inventory_valuation' && r.id !== 'commissions'
      );
    }
    if (currentUser.role === 'sales') {
      return REPORT_CATALOG.filter((r) => SALES_ALLOWED.has(r.id));
    }
    return [];
  }, [currentUser.role]);

  const [reportType, setReportType] = useState<UnifiedReportType>(
    visibleReports[0]?.id || 'sales'
  );
  const [preset, setPreset] = useState<BiPeriodPreset>('last_30_days');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [salesRepId, setSalesRepId] = useState<string>(
    currentUser.role === 'sales' && currentUser.salesRepId ? currentUser.salesRepId : 'all'
  );
  const [categoryId, setCategoryId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [repeatFilter, setRepeatFilter] = useState<CustomerRepeatFilter>('all');
  const [dormancyDays, setDormancyDays] = useState(45);
  const [search, setSearch] = useState('');

  const [report, setReport] = useState<UnifiedReportClientPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visibleReports.some((r) => r.id === reportType) && visibleReports[0]) {
      setReportType(visibleReports[0].id);
    }
  }, [visibleReports, reportType]);

  const buildFilterPayload = (): BiFilterParams & {
    repeatFilter?: CustomerRepeatFilter;
    dormancyDays?: number;
    search?: string;
  } => ({
    preset,
    dateFrom: preset === 'custom' && dateFrom ? dateFrom : undefined,
    dateTo: preset === 'custom' && dateTo ? dateTo : undefined,
    salesRepId:
      currentUser.role === 'sales' && currentUser.salesRepId
        ? currentUser.salesRepId
        : salesRepId === 'all'
          ? undefined
          : salesRepId,
    categoryId: categoryId === 'all' ? undefined : categoryId,
    status: statusFilter === 'all' ? undefined : statusFilter,
    repeatFilter:
      reportType === 'repeat_customers' || reportType === 'customers' ? repeatFilter : undefined,
    dormancyDays:
      reportType === 'repeat_customers' || reportType === 'customers' ? dormancyDays : undefined,
    search: search.trim() || undefined,
  });

  const filterKey = JSON.stringify({
    reportType,
    preset,
    dateFrom,
    dateTo,
    salesRepId,
    categoryId,
    statusFilter,
    repeatFilter,
    dormancyDays,
    search,
  });

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getUnifiedReport(reportType, buildFilterPayload());
      setReport(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل التقرير.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const handleExportExcel = async () => {
    setExporting(true);
    setError(null);
    try {
      await apiClient.downloadUnifiedReportExcel(reportType, buildFilterPayload());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'فشل تصدير ملف Excel.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 font-cairo animate-in fade-in duration-300" dir="rtl">
      {/* Report Selector Grid */}
      <div className="bg-white rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-6 shadow-sm border border-slate-200/80 space-y-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg sm:text-xl font-black text-[#072F5F] flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#0A468C]" />
              مركز التقارير الموحد ({visibleReports.length} تقارير)
            </h3>
            <p className="text-xs font-bold text-slate-500 mt-0.5">
              تقارير تشغيلية ومالية دقيقة مع تصدير ملفات Excel حقيقية منسقة RTL
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!report}
              className="min-h-[42px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-black inline-flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              طباعة التقرير
            </button>
            <button
              type="button"
              onClick={() => void handleExportExcel()}
              disabled={exporting || !report}
              className="min-h-[42px] px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {exporting ? 'جاري التصدير...' : 'تنزيل Excel (.xlsx)'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {visibleReports.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setReportType(item.id)}
              className={`text-right p-3 rounded-2xl border transition-all ${
                reportType === item.id
                  ? 'bg-[#072F5F] text-white border-[#072F5F] shadow-md'
                  : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-blue-300'
              }`}
            >
              <p className="font-black text-xs">{item.label}</p>
              <p
                className={`text-[10px] font-bold mt-0.5 line-clamp-1 ${
                  reportType === item.id ? 'text-blue-100' : 'text-slate-500'
                }`}
              >
                {item.desc}
              </p>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="pt-2 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs">
          <div>
            <label className="block font-bold text-slate-500 mb-1">الفترة</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as BiPeriodPreset)}
              className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">كل الفترات</option>
              <option value="today">اليوم</option>
              <option value="yesterday">أمس</option>
              <option value="this_week">هذا الأسبوع</option>
              <option value="this_month">هذا الشهر</option>
              <option value="previous_month">الشهر السابق</option>
              <option value="last_30_days">آخر 30 يوم</option>
              <option value="last_90_days">آخر 90 يوم</option>
              <option value="this_year">هذا العام</option>
              <option value="custom">مخصص</option>
            </select>
          </div>

          {preset === 'custom' && (
            <>
              <div>
                <label className="block font-bold text-slate-500 mb-1">من</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-500 mb-1">إلى</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums"
                />
              </div>
            </>
          )}

          {currentUser.role !== 'sales' && (
            <div>
              <label className="block font-bold text-slate-500 mb-1">مندوب المبيعات</label>
              <select
                value={salesRepId}
                onChange={(e) => setSalesRepId(e.target.value)}
                className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                <option value="all">الكل</option>
                {salesReps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-500 mb-1">التصنيف</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              <option value="all">كل التصنيفات</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {(reportType === 'sales' || reportType === 'invoice_status' || reportType === 'operations_performance') && (
            <div>
              <label className="block font-bold text-slate-500 mb-1">حالة الفاتورة</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                <option value="all">الكل</option>
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(reportType === 'customers' || reportType === 'repeat_customers') && (
            <>
              <div>
                <label className="block font-bold text-slate-500 mb-1">فلتر التكرار</label>
                <select
                  value={repeatFilter}
                  onChange={(e) => setRepeatFilter(e.target.value as CustomerRepeatFilter)}
                  className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option value="all">كل العملاء</option>
                  <option value="once">اشترى مرة واحدة</option>
                  <option value="2_plus">مرتين فأكثر</option>
                  <option value="3_plus">3 مرات فأكثر</option>
                  <option value="5_plus">5 مرات فأكثر</option>
                  <option value="increased_frequency">زيادة في التكرار</option>
                  <option value="declined_frequency">انخفاض في التكرار</option>
                  <option value="inactive">خامل / منقطع</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-500 mb-1">حد الخمول (يوم)</label>
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={dormancyDays}
                  onChange={(e) => setDormancyDays(Math.max(7, Number(e.target.value) || 45))}
                  className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black tabular-nums"
                />
              </div>
            </>
          )}

          <div>
            <label className="block font-bold text-slate-500 mb-1">بحث سريع</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="اسم / كود / رقم..."
              className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
          {error}
        </div>
      )}

      {/* Report Content + Printable Surface */}
      <div className="bg-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-7 shadow-sm border border-slate-200/80 space-y-5">
        {loading && !report ? (
          <div className="py-12 text-center text-xs font-bold text-slate-500 flex items-center justify-center gap-2">
            <RefreshCcw className="w-4 h-4 animate-spin text-[#0A468C]" />
            جاري تجهيز بيانات التقرير...
          </div>
        ) : report ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h4 className="text-lg sm:text-xl font-black text-[#072F5F]">{report.titleAr}</h4>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  {report.subtitleAr} · {report.appliedFilterSummary}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500 tabular-nums no-print">
                <Filter className="w-3.5 h-3.5 text-[#0A468C]" />
                <span>عدد السجلات: {report.rows.length.toLocaleString()}</span>
                {loading && <RefreshCcw className="w-3.5 h-3.5 animate-spin text-[#0A468C]" />}
              </div>
            </div>

            {report.summaryCards.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {report.summaryCards.map((card, i) => (
                  <div
                    key={i}
                    className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1"
                  >
                    <p className="text-[11px] font-bold text-slate-500">{card.label}</p>
                    <p className="text-sm sm:text-base font-black text-[#072F5F] tabular-nums">
                      {card.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {report.unitTotals && report.unitTotals.length > 0 && (
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-2xl text-xs font-black text-[#072F5F] tabular-nums">
                إجمالي الكميات المصنفة حسب الوحدة: {formatUnitTotalsSummary(report.unitTotals)}
              </div>
            )}

            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-right border-collapse text-xs">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    {report.columns.map((col) => (
                      <th key={col.key} className="p-3 font-black whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={report.columns.length}
                        className="p-10 text-center font-bold text-slate-400"
                      >
                        لا توجد بيانات مطابقة للفلاتر الحالية في هذا التقرير.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-blue-50/30">
                        {report.columns.map((col) => (
                          <td
                            key={col.key}
                            className={`p-3 font-bold text-slate-800 whitespace-nowrap ${
                              col.format === 'currency' ||
                              col.format === 'number' ||
                              col.format === 'percent' ||
                              col.format === 'date'
                                ? 'tabular-nums'
                                : ''
                            }`}
                          >
                            {formatCellValue(row[col.key], col.format)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end no-print">
              <button
                type="button"
                onClick={() => void handleExportExcel()}
                disabled={exporting}
                className="min-h-[40px] px-4 py-2 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                {exporting ? 'جاري التصدير...' : 'تصدير هذا التقرير إلى Excel'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};
