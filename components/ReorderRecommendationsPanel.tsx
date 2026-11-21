import React, { useEffect, useState } from 'react';
import { AlertTriangle, PackagePlus, RefreshCcw } from 'lucide-react';
import type { ProductCategory, ReorderRecommendationRow } from '../types';
import { apiClient } from '../src/lib/api';

interface ReorderRecommendationsPanelProps {
  categories: ProductCategory[];
}

export const ReorderRecommendationsPanel: React.FC<ReorderRecommendationsPanelProps> = ({
  categories,
}) => {
  const [lookbackDays, setLookbackDays] = useState(30);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [safetyDays, setSafetyDays] = useState(7);
  const [categoryId, setCategoryId] = useState('all');
  const [rows, setRows] = useState<ReorderRecommendationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getReorderRecommendations({
        lookbackDays,
        leadTimeDays,
        safetyDays,
        categoryId: categoryId === 'all' ? undefined : categoryId,
      });
      setRows(res.recommendations);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر حساب توصيات إعادة التوريد.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookbackDays, leadTimeDays, safetyDays, categoryId]);

  return (
    <div
      className="bg-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-7 shadow-sm border border-slate-200/80 space-y-5 font-cairo"
      dir="rtl"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg sm:text-xl font-black text-[#072F5F] flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-[#0A468C]" />
            توصيات إعادة التوريد وتوفير المخزون
          </h3>
          <p className="text-xs font-bold text-slate-500 mt-0.5">
            تحديد الأصناف التي تحتاج شحناً أو شراءً من المورد بناءً على معدل السحب الفعلي والكميات المعلقة
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRecommendations()}
          disabled={loading}
          className="min-h-[40px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#072F5F] rounded-xl text-xs font-black inline-flex items-center gap-1.5 self-start"
        >
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث الحسابات
        </button>
      </div>

      {/* Configurable Rule Parameters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
        <div>
          <label className="block font-bold text-slate-600 mb-1">فترة القياس (يوم)</label>
          <input
            type="number"
            min={7}
            max={365}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Math.max(7, Number(e.target.value) || 30))}
            className="w-full min-h-[40px] px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-black tabular-nums"
          />
        </div>
        <div>
          <label className="block font-bold text-slate-600 mb-1">مدة التوريد (يوم)</label>
          <input
            type="number"
            min={1}
            max={90}
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(Math.max(1, Number(e.target.value) || 7))}
            className="w-full min-h-[40px] px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-black tabular-nums"
          />
        </div>
        <div>
          <label className="block font-bold text-slate-600 mb-1">مخزون أمان (يوم)</label>
          <input
            type="number"
            min={0}
            max={90}
            value={safetyDays}
            onChange={(e) => setSafetyDays(Math.max(0, Number(e.target.value) || 0))}
            className="w-full min-h-[40px] px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-black tabular-nums"
          />
        </div>
        <div>
          <label className="block font-bold text-slate-600 mb-1">التصنيف</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full min-h-[40px] px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-bold"
          >
            <option value="all">كل التصنيفات</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="py-10 text-center text-xs font-bold text-slate-500">
          جاري تحليل الطلبات وحساب نقاط إعادة الطلب...
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center text-xs font-black text-emerald-900">
          مستويات المخزون الحالية كافية وفقاً لمعايير التوريد والأمان المحددة.
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="w-full text-right border-collapse text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-3.5 font-black text-slate-600">الأولوية</th>
                <th className="p-3.5 font-black text-slate-600">الصنف</th>
                <th className="p-3.5 font-black text-slate-600 text-center">الرصيد الحالي</th>
                <th className="p-3.5 font-black text-slate-600 text-center">مباع ({lookbackDays} يوم)</th>
                <th className="p-3.5 font-black text-slate-600 text-center">معلق للتوفير</th>
                <th className="p-3.5 font-black text-slate-600 text-center">تغطية متبقية</th>
                <th className="p-3.5 font-black text-slate-600 text-center">الكمية المقترح طلبها</th>
                <th className="p-3.5 font-black text-slate-600">سبب التوصية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.productId} className="hover:bg-blue-50/30">
                  <td className="p-3.5 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-black ${
                        r.priority === 'urgent'
                          ? 'bg-red-100 text-red-800 border border-red-200'
                          : r.priority === 'soon'
                            ? 'bg-amber-100 text-amber-900 border border-amber-200'
                            : 'bg-sky-100 text-sky-900 border border-sky-200'
                      }`}
                    >
                      {r.priority === 'urgent' && <AlertTriangle className="w-3 h-3" />}
                      {r.priority === 'urgent' ? 'عاجل' : r.priority === 'soon' ? 'قريباً' : 'للمتابعة'}
                    </span>
                  </td>
                  <td className="p-3.5">
                    <p className="font-black text-slate-900">{r.name}</p>
                    <p className="text-[11px] font-bold text-slate-500">
                      <span dir="ltr">{r.code}</span> · {r.categoryName}
                    </p>
                  </td>
                  <td className="p-3.5 text-center font-black tabular-nums">
                    {r.currentStock.toLocaleString()} {r.unit}
                  </td>
                  <td className="p-3.5 text-center font-bold text-slate-700 tabular-nums">
                    {r.lookbackUnitsSold.toLocaleString()} {r.unit}
                  </td>
                  <td className="p-3.5 text-center font-black text-amber-700 tabular-nums">
                    {r.pendingProcurementQty > 0
                      ? `${r.pendingProcurementQty.toLocaleString()} ${r.unit}`
                      : '—'}
                  </td>
                  <td className="p-3.5 text-center font-bold tabular-nums">
                    {r.daysOfCoverRemaining !== null ? `${r.daysOfCoverRemaining} يوم` : '—'}
                  </td>
                  <td className="p-3.5 text-center font-black text-[#072F5F] tabular-nums">
                    {r.suggestedReorderQty.toLocaleString()} {r.unit}
                  </td>
                  <td className="p-3.5 font-bold text-slate-700 min-w-[200px]">{r.reasonAr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
