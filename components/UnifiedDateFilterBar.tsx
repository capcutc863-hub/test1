import React from 'react';
import { Calendar, Filter, RotateCcw, RefreshCcw } from 'lucide-react';
import type { OrderDateField, OrderDatePreset } from '../types';
import {
  ORDER_DATE_FIELD_LABELS,
  ORDER_DATE_PRESET_LABELS,
  resolveCairoDateRange,
} from '../src/lib/date-utils';

export interface DateFilterValue {
  preset: OrderDatePreset;
  dateType: OrderDateField;
  dateFrom?: string;
  dateTo?: string;
}

interface UnifiedDateFilterBarProps {
  value: DateFilterValue;
  onChange: (next: DateFilterValue) => void;
  totalMatched?: number;
  totalRevenue?: number;
  loading?: boolean;
  allowedDateFields?: OrderDateField[];
  compact?: boolean;
}

const ALL_DATE_FIELDS: OrderDateField[] = [
  'createdAt',
  'confirmedAt',
  'prepStartedAt',
  'prepCompletedAt',
  'shippedAt',
  'deliveredAt',
  'cancelledAt',
  'returnedAt',
];

const PRESET_ORDER: OrderDatePreset[] = [
  'all',
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'custom',
];

export const UnifiedDateFilterBar: React.FC<UnifiedDateFilterBarProps> = ({
  value,
  onChange,
  totalMatched,
  totalRevenue,
  loading = false,
  allowedDateFields = ALL_DATE_FIELDS,
  compact = false,
}) => {
  const isFiltered = value.preset !== 'all' || Boolean(value.dateFrom) || Boolean(value.dateTo);

  const handlePresetClick = (preset: OrderDatePreset) => {
    if (preset === 'custom') {
      const fallback = resolveCairoDateRange('today');
      onChange({
        ...value,
        preset: 'custom',
        dateFrom: value.dateFrom || fallback.dateFrom,
        dateTo: value.dateTo || fallback.dateTo,
      });
      return;
    }
    const resolved = resolveCairoDateRange(preset);
    onChange({
      ...value,
      preset: resolved.preset,
      dateFrom: resolved.dateFrom,
      dateTo: resolved.dateTo,
    });
  };

  const handleCustomDateChange = (field: 'dateFrom' | 'dateTo', rawVal: string) => {
    const nextFrom = field === 'dateFrom' ? rawVal : value.dateFrom;
    const nextTo = field === 'dateTo' ? rawVal : value.dateTo;
    if (!nextFrom && !nextTo) {
      onChange({
        ...value,
        preset: 'all',
        dateFrom: undefined,
        dateTo: undefined,
      });
      return;
    }
    const resolved = resolveCairoDateRange('custom', nextFrom, nextTo);
    onChange({
      ...value,
      preset: 'custom',
      dateFrom: resolved.dateFrom,
      dateTo: resolved.dateTo,
    });
  };

  const handleReset = () => {
    onChange({
      preset: 'all',
      dateType: 'createdAt',
      dateFrom: undefined,
      dateTo: undefined,
    });
  };

  return (
    <div
      className={`bg-white border border-slate-200/80 shadow-sm ${
        compact ? 'p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl' : 'p-4 sm:p-5 rounded-3xl sm:rounded-[2rem]'
      } space-y-3 font-cairo`}
      dir="rtl"
    >
      {/* Top Row: Title + Active Scope Badge + Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-black text-[#072F5F]">
            <Calendar className="w-4 h-4 text-[#0A468C]" />
            فلترة التاريخ الموحدة
          </span>
          <span className="text-slate-300" aria-hidden="true">|</span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-50 text-[#0A468C] font-black text-[11px]">
            <Filter className="w-3 h-3" />
            {ORDER_DATE_FIELD_LABELS[value.dateType]}
            {' · '}
            {isFiltered
              ? value.dateFrom === value.dateTo && value.dateFrom
                ? value.dateFrom
                : `${value.dateFrom || '...'} ← ${value.dateTo || '...'}`
              : 'كل التواريخ'}
            {' (توقيت القاهرة)'}
          </span>
          {loading && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0A468C]">
              <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
              جاري التحديث...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          {typeof totalMatched === 'number' && (
            <span className="px-2.5 py-1 rounded-xl bg-slate-100 text-[#072F5F] font-black tabular-nums">
              {totalMatched.toLocaleString()} فاتورة
              {typeof totalRevenue === 'number' ? ` · ${totalRevenue.toLocaleString()} ج.م` : ''}
            </span>
          )}
          {isFiltered && (
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[34px] px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 font-black text-[11px] inline-flex items-center gap-1 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              إعادة ضبط
            </button>
          )}
        </div>
      </div>

      {/* Presets Row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {PRESET_ORDER.map((preset) => {
          const isSelected = value.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => handlePresetClick(preset)}
              className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-[#072F5F] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-[#0A468C]'
              }`}
            >
              {ORDER_DATE_PRESET_LABELS[preset]}
            </button>
          );
        })}
      </div>

      {/* Controls Grid: Date Field Selector + From + To */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">
            التصفية حسب تاريخ:
          </label>
          <select
            value={value.dateType}
            onChange={(e) =>
              onChange({
                ...value,
                dateType: e.target.value as OrderDateField,
              })
            }
            className="w-full min-h-[42px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-xs sm:text-sm text-slate-900"
          >
            {allowedDateFields.map((field) => (
              <option key={field} value={field}>
                {ORDER_DATE_FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">من تاريخ:</label>
          <input
            type="date"
            value={value.dateFrom || ''}
            onChange={(e) => handleCustomDateChange('dateFrom', e.target.value)}
            className="w-full min-h-[42px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-xs sm:text-sm text-slate-900 tabular-nums"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">إلى تاريخ:</label>
          <input
            type="date"
            value={value.dateTo || ''}
            onChange={(e) => handleCustomDateChange('dateTo', e.target.value)}
            className="w-full min-h-[42px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:border-[#0A468C] outline-none font-bold text-xs sm:text-sm text-slate-900 tabular-nums"
          />
        </div>
      </div>
    </div>
  );
};
