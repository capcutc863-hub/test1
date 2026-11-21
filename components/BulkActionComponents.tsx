import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  RefreshCcw,
  X,
  XCircle,
} from 'lucide-react';
import type { BulkPreviewResult } from '../types';

interface BulkActionBarProps {
  selectedCount: number;
  pageCount: number;
  totalMatchingCount: number;
  selectionScope: 'page' | 'all_matching';
  onSelectPage: () => void;
  onSelectAllMatching?: () => void;
  onClearSelection: () => void;
  itemLabel?: string;
  children: React.ReactNode;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  pageCount,
  totalMatchingCount,
  selectionScope,
  onSelectPage,
  onSelectAllMatching,
  onClearSelection,
  itemLabel = 'عنصر',
  children,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div
      className="sticky top-2 z-30 bg-[#072F5F] text-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-4 shadow-xl border border-blue-400/30 flex flex-col lg:flex-row lg:items-center justify-between gap-3 font-cairo animate-in fade-in slide-in-from-top-2 duration-200"
      dir="rtl"
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
        <span className="inline-flex items-center gap-1.5 bg-white text-[#072F5F] px-3 py-1.5 rounded-xl font-black tabular-nums">
          <Layers className="w-4 h-4 text-[#0A468C]" />
          المحدد: {selectedCount.toLocaleString()} {itemLabel}
        </span>

        {selectionScope === 'all_matching' ? (
          <span className="text-blue-100 font-bold">
            تم تحديد جميع النتائج المطابقة للفلاتر ({totalMatchingCount.toLocaleString()})
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onSelectPage}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold transition-all"
            >
              تحديد الصفحة ({pageCount.toLocaleString()})
            </button>
            {onSelectAllMatching && totalMatchingCount > pageCount && (
              <button
                type="button"
                onClick={onSelectAllMatching}
                className="px-2.5 py-1.5 rounded-xl bg-amber-400 text-slate-950 hover:bg-amber-300 font-black transition-all"
              >
                تحديد كل المطابق للفلاتر ({totalMatchingCount.toLocaleString()})
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onClearSelection}
          className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-red-500/80 text-white font-bold inline-flex items-center gap-1 transition-all"
        >
          <X className="w-3.5 h-3.5" />
          إلغاء التحديد
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
};

interface BulkPreviewModalProps {
  preview: BulkPreviewResult | null;
  title: string;
  subtitle?: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger' | 'amber';
  executing: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  extraContent?: React.ReactNode;
}

export const BulkPreviewModal: React.FC<BulkPreviewModalProps> = ({
  preview,
  title,
  subtitle,
  confirmLabel = 'تأكيد وتنفيذ الإجراء',
  confirmVariant = 'primary',
  executing,
  error,
  onCancel,
  onConfirm,
  extraContent,
}) => {
  if (!preview) return null;

  const confirmBtnClass =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : confirmVariant === 'amber'
        ? 'bg-amber-600 hover:bg-amber-700'
        : 'bg-[#0A468C] hover:bg-[#072F5F]';

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[820] font-cairo"
      dir="rtl"
    >
      <div className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-lg sm:text-xl font-black text-[#072F5F]">{title}</h3>
            {subtitle && <p className="text-xs font-bold text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            disabled={executing}
            onClick={onCancel}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Counters */}
        <div className="grid grid-cols-3 gap-2.5 text-center tabular-nums">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl">
            <p className="text-[11px] font-bold text-slate-500">إجمالي المحدد</p>
            <p className="text-lg font-black text-slate-900">{preview.totalSelected}</p>
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <p className="text-[11px] font-bold text-emerald-700">سينفذ عليها</p>
            <p className="text-lg font-black text-emerald-800">{preview.eligibleCount}</p>
          </div>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl">
            <p className="text-[11px] font-bold text-amber-700">سيُستبعد</p>
            <p className="text-lg font-black text-amber-800">{preview.excludedCount}</p>
          </div>
        </div>

        {preview.warnings.map((w, idx) => (
          <div
            key={idx}
            className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-950 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>{w}</span>
          </div>
        ))}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
            {error}
          </div>
        )}

        {extraContent}

        {/* Items Preview List */}
        <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
          {preview.items.map((item) => (
            <div
              key={item.id}
              className={`p-3 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                item.eligible
                  ? 'bg-white border-slate-200'
                  : 'bg-slate-50 border-slate-200/80 opacity-85'
              }`}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  {item.eligible ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span className="font-black text-slate-900 truncate">{item.label}</span>
                </div>
                {item.subLabel && (
                  <p className="text-[11px] font-bold text-slate-500 pr-5">{item.subLabel}</p>
                )}
                {!item.eligible && item.reason && (
                  <p className="text-[11px] font-bold text-amber-800 pr-5">{item.reason}</p>
                )}
              </div>

              {item.eligible && (item.previewBefore || item.previewAfter) && (
                <div className="text-[11px] font-black text-[#072F5F] bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl shrink-0 tabular-nums">
                  {item.previewBefore ? `${item.previewBefore} ← ` : ''}
                  {item.previewAfter || ''}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            disabled={executing || preview.eligibleCount === 0}
            onClick={onConfirm}
            className={`flex-1 min-h-[48px] px-5 py-3 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-md disabled:opacity-50 ${confirmBtnClass}`}
          >
            {executing && <RefreshCcw className="w-4 h-4 animate-spin" />}
            {executing ? 'جاري التنفيذ...' : `${confirmLabel} (${preview.eligibleCount})`}
          </button>
          <button
            type="button"
            disabled={executing}
            onClick={onCancel}
            className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};
