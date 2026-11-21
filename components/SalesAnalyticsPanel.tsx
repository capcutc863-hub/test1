import React, { useEffect, useState } from 'react';
import { Award, Download, RefreshCcw, TrendingUp, Users } from 'lucide-react';
import type { BiFilterParams, SalesRepAnalyticsRow, User } from '../types';
import { apiClient } from '../src/lib/api';
import { formatUnitTotalsSummary } from '../src/lib/unit-conversion';

interface SalesAnalyticsPanelProps {
  currentUser: User;
  filters?: BiFilterParams;
  title?: string;
}

export const SalesAnalyticsPanel: React.FC<SalesAnalyticsPanelProps> = ({
  currentUser,
  filters,
  title,
}) => {
  const [reps, setReps] = useState<SalesRepAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingType, setExportingType] = useState<string | null>(null);

  const filterKey = JSON.stringify(filters || {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .getSalesRepAnalytics(filters || {})
      .then((res) => {
        if (!cancelled) setReps(res.reps);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'تعذر تحميل تحليلات المناديب.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const handleExport = async (type: 'sales_reps' | 'commissions') => {
    setExportingType(type);
    try {
      await apiClient.downloadUnifiedReportExcel(type, filters || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تصدير ملف Excel.');
    } finally {
      setExportingType(null);
    }
  };

  const maxCommission = Math.max(
    1,
    ...reps.map((r) => r.earnedCommission + r.pendingCommission)
  );

  const isSalesOnly = currentUser.role === 'sales';

  return (
    <div
      className="bg-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-7 shadow-sm border border-slate-200/80 space-y-5 font-cairo"
      dir="rtl"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg sm:text-xl font-black text-[#072F5F] flex items-center gap-2">
            <Award className="w-5 h-5 text-[#0A468C]" />
            {title || (isSalesOnly ? 'تحليل أدائي وعمولاتي' : 'أداء فريق المبيعات والعمولات')}
          </h3>
          <p className="text-xs font-bold text-slate-500 mt-0.5">
            مقارنة المبيعات المحصلة، متوسط الفاتورة، والعمولة المستحقة مقابل المعلقة دون تعديل السجلات التاريخية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isSalesOnly && (
            <button
              type="button"
              disabled={exportingType !== null}
              onClick={() => void handleExport('sales_reps')}
              className="min-h-[40px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-[#072F5F] rounded-xl text-xs font-black inline-flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              {exportingType === 'sales_reps' ? 'جاري التصدير...' : 'تصدير أداء المناديب XLSX'}
            </button>
          )}
          <button
            type="button"
            disabled={exportingType !== null}
            onClick={() => void handleExport('commissions')}
            className="min-h-[40px] px-3.5 py-2 bg-[#072F5F] hover:bg-[#0A468C] text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            {exportingType === 'commissions' ? 'جاري التصدير...' : 'تصدير العمولات XLSX'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
          {error}
        </div>
      )}

      {loading && reps.length === 0 ? (
        <div className="py-10 text-center text-xs font-bold text-slate-500 flex items-center justify-center gap-2">
          <RefreshCcw className="w-4 h-4 animate-spin text-[#0A468C]" />
          جاري تحميل بيانات المناديب والعمولات...
        </div>
      ) : reps.length === 0 ? (
        <div className="py-10 text-center text-xs font-bold text-slate-500">
          لا توجد بيانات مبيعات مطابقة للفترة المحددة.
        </div>
      ) : (
        <>
          {/* Commission Comparison Bars */}
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-black text-[#072F5F] flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#0A468C]" />
                مقارنة العمولات المستحقة والمعلقة
              </span>
              <div className="flex items-center gap-3 font-bold text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-xs bg-emerald-600 inline-block" />
                  عمولة مكتسبة (تم التسليم)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-xs bg-amber-500 inline-block" />
                  عمولة معلقة (قيد التشغيل)
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              {reps.map((rep) => {
                const earnedPct = (rep.earnedCommission / maxCommission) * 100;
                const pendingPct = (rep.pendingCommission / maxCommission) * 100;
                return (
                  <div key={rep.salesRepId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-900 font-black">{rep.salesRepName}</span>
                      <span className="text-slate-600 tabular-nums">
                        مستحق: <strong className="text-emerald-700">{rep.earnedCommission.toLocaleString()}</strong> ج.م
                        {' · '}
                        معلق: <strong className="text-amber-700">{rep.pendingCommission.toLocaleString()}</strong> ج.م
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-600 transition-all"
                        style={{ width: `${earnedPct}%` }}
                        title={`مكتسبة: ${rep.earnedCommission.toLocaleString()} ج.م`}
                      />
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{ width: `${pendingPct}%` }}
                        title={`معلقة: ${rep.pendingCommission.toLocaleString()} ج.م`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-right border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="p-3.5 font-black text-slate-600">المندوب</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">الطلبات</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">المسلمة</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">المبيعات المؤكدة</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">مبيعات التسليم</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">متوسط الفاتورة</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">عملاء (متكرر)</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">عمولة مكتسبة</th>
                  <th className="p-3.5 font-black text-slate-600 text-center">عمولة معلقة</th>
                  <th className="p-3.5 font-black text-slate-600">توزيع التصنيفات والكميات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reps.map((rep) => (
                  <tr key={rep.salesRepId} className="hover:bg-blue-50/30">
                    <td className="p-3.5 font-black text-[#072F5F] whitespace-nowrap">
                      {rep.salesRepName}
                      <span className="block text-[10px] font-bold text-slate-500 tabular-nums">
                        نسبة أساسية: {(rep.baseCommissionRate * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-3.5 text-center font-black tabular-nums">{rep.ordersCount}</td>
                    <td className="p-3.5 text-center font-bold text-emerald-700 tabular-nums">
                      {rep.deliveredOrdersCount}
                    </td>
                    <td className="p-3.5 text-center font-black text-slate-900 tabular-nums">
                      {rep.totalRevenue.toLocaleString()} ج.م
                    </td>
                    <td className="p-3.5 text-center font-black text-emerald-700 tabular-nums">
                      {rep.deliveredRevenue.toLocaleString()} ج.م
                    </td>
                    <td className="p-3.5 text-center font-bold text-slate-700 tabular-nums">
                      {rep.averageOrderValue.toLocaleString()} ج.م
                    </td>
                    <td className="p-3.5 text-center font-bold text-slate-700 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-[#0A468C]" />
                        {rep.uniqueCustomersCount} ({rep.repeatCustomersCount})
                      </span>
                    </td>
                    <td className="p-3.5 text-center font-black text-emerald-700 tabular-nums">
                      {rep.earnedCommission.toLocaleString()} ج.م
                    </td>
                    <td className="p-3.5 text-center font-black text-amber-700 tabular-nums">
                      {rep.pendingCommission.toLocaleString()} ج.م
                    </td>
                    <td className="p-3.5 space-y-1 min-w-[210px]">
                      {rep.categoryBreakdown.length === 0 ? (
                        <span className="text-slate-400 font-bold">لا توجد بنود</span>
                      ) : (
                        rep.categoryBreakdown.map((cat) => (
                          <div key={cat.categoryId} className="text-[11px] font-bold text-slate-700 tabular-nums">
                            <span className="font-black text-[#072F5F]">{cat.categoryName}:</span>{' '}
                            {cat.revenue.toLocaleString()} ج.م · {formatUnitTotalsSummary(cat.unitsByUnit)}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
