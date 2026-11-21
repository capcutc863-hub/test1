import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Search,
  Crown,
  Sparkles,
  Phone,
  MapPin,
  Calendar,
  Send,
  Copy,
  Check,
  RefreshCcw,
  X,
  Trash2,
  Plus,
  AlertTriangle,
  UserCheck,
  Edit3,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckSquare,
  Square,
  CheckCircle2,
} from 'lucide-react';
import type {
  BiPeriodPreset,
  BulkPreviewResult,
  Customer,
  CustomerAnalyticsRow,
  CustomerRepeatFilter,
  Order,
  Product,
  SalesRep,
  User,
} from '../types';
import { getMarketingInsights } from '../services/geminiService';
import { apiClient } from '../src/lib/api';
import { BulkActionBar, BulkPreviewModal } from './BulkActionComponents';

interface CustomersTabProps {
  customers: Customer[];
  orders: Order[];
  products: Product[];
  salesReps?: SalesRep[];
  currentUser?: User;
  onRefreshWorkspace?: () => Promise<void> | void;
  onDeleteCustomer?: (customerId: string) => void;
  onAddCustomer?: (customer: {
    name: string;
    phone: string;
    address?: string;
    assignedSalesRepId?: string | null;
  }) => void;
  onUpdateCustomer?: (
    customerId: string,
    data: {
      name: string;
      phone?: string;
      address?: string;
      assignedSalesRepId?: string | null;
    }
  ) => Promise<void> | void;
}

const REPEAT_FILTER_LABELS: Array<{ value: CustomerRepeatFilter; label: string }> = [
  { value: 'all', label: 'كل العملاء' },
  { value: '2_plus', label: 'تكرار (مرتين فأكثر)' },
  { value: '3_plus', label: 'تكرار (3 مرات فأكثر)' },
  { value: '5_plus', label: 'تكرار (5 مرات فأكثر)' },
  { value: 'once', label: 'اشترى مرة واحدة' },
  { value: 'increased_frequency', label: 'زادت وتيرة شرائهم' },
  { value: 'declined_frequency', label: 'تراجعت وتيرة شرائهم' },
  { value: 'inactive', label: 'متوقفون / خاملون' },
  { value: 'custom_min', label: 'حد أدنى مخصص' },
];

const PERIOD_PRESETS: Array<{ value: BiPeriodPreset; label: string }> = [
  { value: 'all', label: 'كل الفترات' },
  { value: 'this_month', label: 'هذا الشهر' },
  { value: 'previous_month', label: 'الشهر الماضي' },
  { value: 'last_30_days', label: 'آخر 30 يوم' },
  { value: 'last_90_days', label: 'آخر 90 يوم' },
  { value: 'this_year', label: 'هذا العام' },
  { value: 'custom', label: 'فترة مخصصة' },
];

export const CustomersTab: React.FC<CustomersTabProps> = ({
  customers,
  orders,
  products,
  salesReps = [],
  currentUser,
  onRefreshWorkspace,
  onDeleteCustomer,
  onAddCustomer,
  onUpdateCustomer,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState<string>('الكل');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [returnHistoryCustomer, setReturnHistoryCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editAssignedRepId, setEditAssignedRepId] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Customer Form State
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newAssignedRepId, setNewAssignedRepId] = useState<string>('');

  // Analytics & Repeat Buyer Filter State
  const [preset, setPreset] = useState<BiPeriodPreset>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [repeatFilter, setRepeatFilter] = useState<CustomerRepeatFilter>('all');
  const [customMinOrders, setCustomMinOrders] = useState<number>(4);
  const [dormancyDays, setDormancyDays] = useState<number>(45);
  const [salesRepFilter, setSalesRepFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('periodSpent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsRows, setAnalyticsRows] = useState<CustomerAnalyticsRow[] | null>(null);
  const [analyticsSummary, setAnalyticsSummary] = useState<{
    totalCustomers: number;
    repeatCustomersCount: number;
    oneTimeBuyersCount: number;
    dormantCustomersCount: number;
    totalPeriodRevenue: number;
  } | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);

  // Bulk Selection & Action State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAssignRepModal, setShowAssignRepModal] = useState(false);
  const [bulkTargetRepId, setBulkTargetRepId] = useState<string>('');
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewResult | null>(null);
  const [bulkPreviewMeta, setBulkPreviewMeta] = useState<{
    title: string;
    subtitle: string;
    confirmLabel: string;
    confirmVariant: 'primary' | 'danger' | 'amber';
    payload: Record<string, unknown>;
  } | null>(null);
  const [bulkExecuting, setBulkExecuting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBanner, setBulkBanner] = useState<string | null>(null);

  // AI Marketing State
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [copied, setCopied] = useState(false);

  const canEdit =
    currentUser?.role === 'owner' ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'supervisor';
  const canDelete =
    currentUser?.role === 'owner' ||
    currentUser?.role === 'admin' ||
    Boolean(currentUser?.canDeleteCustomers);
  const isSalesRole = currentUser?.role === 'sales';

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await apiClient.getCustomerAnalytics({
        preset,
        dateFrom: preset === 'custom' && dateFrom ? dateFrom : undefined,
        dateTo: preset === 'custom' && dateTo ? dateTo : undefined,
        repeatFilter,
        customMinOrders: repeatFilter === 'custom_min' ? customMinOrders : undefined,
        dormancyDays,
        salesRepId: !isSalesRole && salesRepFilter !== 'all' ? salesRepFilter : undefined,
        search: searchTerm.trim() || undefined,
        sortBy,
        sortDir,
      });
      setAnalyticsRows(res.customers);
      setAnalyticsSummary(res.summary);
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : 'تعذر تحميل تحليلات العملاء.');
    } finally {
      setAnalyticsLoading(false);
    }
  }, [
    preset,
    dateFrom,
    dateTo,
    repeatFilter,
    customMinOrders,
    dormancyDays,
    isSalesRole,
    salesRepFilter,
    searchTerm,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const analyticsByCustomerId = useMemo(() => {
    const map = new Map<string, CustomerAnalyticsRow>();
    (analyticsRows || []).forEach((r) => map.set(r.customerId, r));
    return map;
  }, [analyticsRows]);

  const customersById = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  const displayedCustomers = useMemo(() => {
    if (analyticsRows) {
      return analyticsRows
        .map((row) => {
          const base = customersById.get(row.customerId);
          return {
            customer:
              base ||
              ({
                id: row.customerId,
                name: row.customerName,
                phone: row.phone,
                address: row.address,
                totalSpent: row.totalSpent,
                classification: (row.classification as Customer['classification']) || 'عادي',
                lastOrderDate: row.lastOrderDate,
                assignedSalesRepId: row.assignedSalesRepId,
                assignedSalesRepName: row.assignedSalesRepName,
              } as Customer),
            analytics: row,
          };
        })
        .filter(({ customer }) => classFilter === 'الكل' || customer.classification === classFilter);
    }

    return customers
      .filter((customer) => {
        const matchesSearch =
          customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          customer.phone.includes(searchTerm);
        const matchesClass = classFilter === 'الكل' || customer.classification === classFilter;
        return matchesSearch && matchesClass;
      })
      .map((customer) => ({ customer, analytics: analyticsByCustomerId.get(customer.id) }));
  }, [analyticsRows, customersById, customers, classFilter, searchTerm, analyticsByCustomerId]);

  const handleGenerateAiMessage = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsLoadingAi(true);
    setAiInsight('');
    setCopied(false);

    const customerOrders = orders.filter(
      (o) => o.customerName === customer.name || o.customerPhone === customer.phone
    );
    const insight = await getMarketingInsights(customer, customerOrders, products);
    setAiInsight(insight || 'لا تتوفر اقتراحات تسويقية حالياً.');
    setIsLoadingAi(false);
  };

  const handleCopy = () => {
    if (!aiInsight) return;
    navigator.clipboard.writeText(aiInsight);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirmDeleteCustomer = () => {
    if (!customerToDelete || !onDeleteCustomer) return;
    onDeleteCustomer(customerToDelete.id);
    setCustomerToDelete(null);
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditName(customer.name);
    setEditPhone(customer.phone || '');
    setEditAddress(customer.address || '');
    setEditAssignedRepId(customer.assignedSalesRepId || '');
    setEditError(null);
  };

  const handleSaveCustomerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !onUpdateCustomer || isSavingEdit) return;
    if (!editName.trim()) {
      setEditError('يرجى إدخال اسم العميل.');
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      await onUpdateCustomer(editingCustomer.id, {
        name: editName.trim(),
        phone: editPhone.trim(),
        address: editAddress.trim(),
        ...(canEdit ? { assignedSalesRepId: editAssignedRepId || null } : {}),
      });
      setEditingCustomer(null);
      void loadAnalytics();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'تعذر حفظ تعديلات العميل.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (onAddCustomer) {
      onAddCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        address: newAddress.trim(),
        ...(canEdit && newAssignedRepId ? { assignedSalesRepId: newAssignedRepId } : {}),
      });
    }
    setNewName('');
    setNewPhone('');
    setNewAddress('');
    setNewAssignedRepId('');
    setIsAddModalOpen(false);
  };

  const toggleSelectCustomer = (cid: string) => {
    setSelectedIds((prev) =>
      prev.includes(cid) ? prev.filter((id) => id !== cid) : [...prev, cid]
    );
  };

  const handleExportCustomersExcel = async () => {
    setExportingExcel(true);
    try {
      await apiClient.downloadUnifiedReportExcel('repeat_customers', {
        preset,
        dateFrom: preset === 'custom' && dateFrom ? dateFrom : undefined,
        dateTo: preset === 'custom' && dateTo ? dateTo : undefined,
        repeatFilter,
        dormancyDays,
        salesRepId: !isSalesRole && salesRepFilter !== 'all' ? salesRepFilter : undefined,
        search: searchTerm.trim() || undefined,
      });
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'تعذر تصدير تقرير العملاء إلى Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleRequestBulkPreview = async (
    action: 'assign_sales_rep' | 'delete_unlinked',
    salesRepId?: string
  ) => {
    if (selectedIds.length === 0) return;
    setBulkError(null);
    try {
      const payload = {
        customerIds: selectedIds,
        action,
        ...(salesRepId ? { salesRepId } : {}),
      };
      const preview = await apiClient.previewBulkCustomers(payload);
      setShowAssignRepModal(false);
      setBulkPreview(preview);
      setBulkPreviewMeta({
        title:
          action === 'assign_sales_rep'
            ? 'معاينة تعيين مندوب المبيعات للعملاء'
            : 'معاينة حذف العملاء غير المرتبطين بفواتير',
        subtitle:
          action === 'delete_unlinked'
            ? 'يتم تلقائياً استبعاد أي عميل مرتبط بفواتير تاريخية للحفاظ على السجلات'
            : 'سيتم ربط العملاء المؤهلين بالمندوب المحدد',
        confirmLabel: action === 'delete_unlinked' ? 'تأكيد حذف المؤهلين' : 'تأكيد التعيين',
        confirmVariant: action === 'delete_unlinked' ? 'danger' : 'primary',
        payload,
      });
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'تعذر تجهيز معاينة العملاء.');
    }
  };

  const handleExecuteBulkConfirmed = async () => {
    if (!bulkPreviewMeta || bulkExecuting) return;
    setBulkExecuting(true);
    setBulkError(null);
    try {
      const res = await apiClient.executeBulkCustomers(bulkPreviewMeta.payload);
      setBulkPreview(null);
      setBulkPreviewMeta(null);
      setSelectedIds([]);
      setBulkBanner(res.message);
      await onRefreshWorkspace?.();
      await loadAnalytics();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء الجماعي.');
    } finally {
      setBulkExecuting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300 font-cairo">
      
      {/* Top Search, Filter and Add Customer Bar */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3.5">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث باسم العميل أو رقم الهاتف..."
              className="w-full min-h-[48px] pr-12 pl-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200/80 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
            />
          </div>

          {/* Classification Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            {['الكل', 'ذهبي', 'فضي', 'عادي'].map((c) => (
              <button
                key={c}
                onClick={() => setClassFilter(c)}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                  classFilter === c
                    ? 'bg-[#0A468C] text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c === 'ذهبي' ? 'VIP (ذهبي)' : c === 'فضي' ? 'نشط (فضي)' : c === 'عادي' ? 'عادي' : 'الكل'}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportingExcel}
              onClick={() => void handleExportCustomersExcel()}
              className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {exportingExcel ? 'جاري التصدير...' : 'تصدير Excel'}
            </button>

            {onAddCustomer && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="min-h-[48px] bg-[#0A468C] text-white px-5 py-3 rounded-2xl font-black shadow-md hover:bg-[#072F5F] transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                عميل جديد
              </button>
            )}
          </div>
        </div>

        {/* Repeat Purchase, Period & Dormancy Filter Controls */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 text-xs">
          <div>
            <label className="block font-bold text-slate-500 mb-1">الفترة الزمنية</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as BiPeriodPreset)}
              className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              {PERIOD_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-500 mb-1">تصنيف التكرار</label>
            <select
              value={repeatFilter}
              onChange={(e) => setRepeatFilter(e.target.value as CustomerRepeatFilter)}
              className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
            >
              {REPEAT_FILTER_LABELS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {repeatFilter === 'custom_min' && (
            <div>
              <label className="block font-bold text-slate-500 mb-1">أقل عدد طلبات</label>
              <input
                type="number"
                min={1}
                value={customMinOrders}
                onChange={(e) => setCustomMinOrders(Math.max(1, Number(e.target.value) || 1))}
                className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black tabular-nums"
              />
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-500 mb-1">حد التوقف (يوم)</label>
            <input
              type="number"
              min={7}
              max={365}
              value={dormancyDays}
              onChange={(e) => setDormancyDays(Math.max(7, Number(e.target.value) || 45))}
              className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black tabular-nums"
            />
          </div>

          {!isSalesRole && (
            <div>
              <label className="block font-bold text-slate-500 mb-1">المندوب</label>
              <select
                value={salesRepFilter}
                onChange={(e) => setSalesRepFilter(e.target.value)}
                className="w-full min-h-[40px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                <option value="all">كل المناديب</option>
                {salesReps.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-500 mb-1">ترتيب حسب</label>
            <div className="flex gap-1">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="flex-1 min-h-[40px] px-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                <option value="periodSpent">مشتريات الفترة</option>
                <option value="ordersCount">عدد الطلبات</option>
                <option value="totalSpent">إجمالي المشتريات</option>
                <option value="daysSinceLastOrder">أيام الانقطاع</option>
              </select>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                className="min-h-[40px] px-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-black"
                title="عكس الترتيب"
              >
                {sortDir === 'desc' ? '↓' : '↑'}
              </button>
            </div>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
            <div>
              <label className="font-bold text-slate-500 ml-1.5">من:</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-[38px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums"
              />
            </div>
            <div>
              <label className="font-bold text-slate-500 ml-1.5">إلى:</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-[38px] px-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums"
              />
            </div>
          </div>
        )}

        {canEdit && displayedCustomers.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
            <button
              type="button"
              onClick={() => {
                const allSelected = displayedCustomers.every(({ customer }) =>
                  selectedIds.includes(customer.id)
                );
                setSelectedIds(
                  allSelected ? [] : displayedCustomers.map(({ customer }) => customer.id)
                );
              }}
              className="min-h-[36px] px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#072F5F] rounded-xl font-black inline-flex items-center gap-1.5"
            >
              {displayedCustomers.every(({ customer }) => selectedIds.includes(customer.id)) ? (
                <CheckSquare className="w-4 h-4 text-[#0A468C]" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>تحديد المعروضين ({displayedCustomers.length})</span>
            </button>
            {analyticsLoading && (
              <span className="text-slate-500 font-bold inline-flex items-center gap-1.5">
                <RefreshCcw className="w-3.5 h-3.5 animate-spin text-[#0A468C]" />
                جاري تحديث التحليلات...
              </span>
            )}
          </div>
        )}
      </div>

      {/* Repeat Customers Summary KPIs */}
      {analyticsSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs tabular-nums">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <p className="font-bold text-slate-500">عملاء مطابقون</p>
            <p className="text-xl font-black text-[#072F5F]">{analyticsSummary.totalCustomers}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-emerald-200/80 shadow-xs">
            <p className="font-bold text-emerald-700">عملاء متكررون (2+)</p>
            <p className="text-xl font-black text-emerald-800">
              {analyticsSummary.repeatCustomersCount}
            </p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <p className="font-bold text-slate-500">اشترى مرة واحدة</p>
            <p className="text-xl font-black text-slate-800">
              {analyticsSummary.oneTimeBuyersCount}
            </p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-amber-200/80 shadow-xs">
            <p className="font-bold text-amber-700">خامل (+{dormancyDays} يوم)</p>
            <p className="text-xl font-black text-amber-800">
              {analyticsSummary.dormantCustomersCount}
            </p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-blue-200/80 shadow-xs col-span-2 sm:col-span-1">
            <p className="font-bold text-[#0A468C]">مشتريات الفترة</p>
            <p className="text-xl font-black text-[#072F5F]">
              {analyticsSummary.totalPeriodRevenue.toLocaleString()} ج.م
            </p>
          </div>
        </div>
      )}

      {analyticsError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
          {analyticsError}
        </div>
      )}

      {bulkBanner && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-black text-emerald-900 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            {bulkBanner}
          </span>
          <button type="button" onClick={() => setBulkBanner(null)} className="font-bold underline">
            إغلاق
          </button>
        </div>
      )}

      {bulkError && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
          {bulkError}
        </div>
      )}

      {/* Bulk Customers Bar (Managers only) */}
      {canEdit && (
        <BulkActionBar
          selectedCount={selectedIds.length}
          pageCount={displayedCustomers.length}
          totalMatchingCount={displayedCustomers.length}
          selectionScope="page"
          onSelectPage={() =>
            setSelectedIds(displayedCustomers.map(({ customer }) => customer.id))
          }
          onClearSelection={() => setSelectedIds([])}
          itemLabel="عميل"
        >
          {salesReps.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setBulkTargetRepId(salesReps[0]?.id || '');
                setShowAssignRepModal(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-black text-xs inline-flex items-center gap-1"
            >
              <UserCheck className="w-3.5 h-3.5" />
              تعيين مندوب مبيعات
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => void handleRequestBulkPreview('delete_unlinked')}
              className="px-3 py-1.5 rounded-xl bg-red-500/80 hover:bg-red-500 text-white font-black text-xs inline-flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              حذف غير المرتبطين بفواتير
            </button>
          )}
        </BulkActionBar>
      )}

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {displayedCustomers.map(({ customer, analytics }) => {
          const customerOrders = orders.filter(
            (o) => o.customerName === customer.name || o.customerPhone === customer.phone
          );
          const isSelected = selectedIds.includes(customer.id);
          return (
            <div
              key={customer.id}
              className={`bg-white p-5 sm:p-7 rounded-3xl sm:rounded-[2.5rem] shadow-sm border transition-all hover:shadow-md flex flex-col justify-between ${
                isSelected
                  ? 'border-[#0A468C] ring-2 ring-blue-500/20'
                  : 'border-slate-200/80 hover:border-blue-200'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectCustomer(customer.id)}
                        aria-label={`تحديد ${customer.name}`}
                        className="w-4 h-4 accent-[#0A468C] cursor-pointer"
                      />
                    )}
                    <span
                      className={`px-3 py-1 rounded-xl text-xs font-black flex items-center gap-1 ${
                        customer.classification === 'ذهبي'
                          ? 'bg-amber-100 text-amber-900 border border-amber-200'
                          : customer.classification === 'فضي'
                            ? 'bg-slate-200 text-slate-900'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {customer.classification === 'ذهبي' && (
                        <Crown className="w-3.5 h-3.5 text-amber-600" />
                      )}
                      عميل {customer.classification}
                    </span>

                    {analytics?.isDormant && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-100 text-amber-950 border border-amber-200 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        خامل ({analytics.daysSinceLastOrder} يوم)
                      </span>
                    )}
                    {analytics?.frequencyTrend === 'increased' && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-emerald-100 text-emerald-800 inline-flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        وتيرة متزايدة
                      </span>
                    )}
                    {analytics?.frequencyTrend === 'declined' && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-orange-100 text-orange-800 inline-flex items-center gap-1">
                        <TrendingDown className="w-3 h-3" />
                        تراجع شراء
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-slate-500 tabular-nums ml-1">
                      {analytics ? analytics.ordersCount : customerOrders.length} فواتير
                    </span>
                    {canEdit && onUpdateCustomer && (
                      <button
                        type="button"
                        onClick={() => openEditModal(customer)}
                        className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-500 hover:text-[#0A468C] hover:bg-blue-50 rounded-xl transition-all"
                        title="تعديل بيانات العميل"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    {canDelete && onDeleteCustomer && (
                      <button
                        type="button"
                        onClick={() => setCustomerToDelete(customer)}
                        className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="حذف العميل من النظام"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-1.5">
                  {customer.name}
                </h3>

                <div className="space-y-1.5 mb-5 text-xs text-slate-600 font-bold">
                  <p className="flex items-center gap-2 tabular-nums">
                    <Phone className="w-3.5 h-3.5 text-[#0A468C]" />
                    {customer.phone || 'بدون هاتف'}
                  </p>
                  {customer.address && (
                    <p className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-[#0A468C]" />
                      {customer.address}
                    </p>
                  )}
                  {(customer.assignedSalesRepName || analytics?.primaryRepName) && (
                    <p className="flex items-center gap-2 text-[#072F5F]">
                      <UserCheck className="w-3.5 h-3.5 text-[#0A468C]" />
                      المسؤول: {customer.assignedSalesRepName || analytics?.primaryRepName}
                    </p>
                  )}
                  {customer.lastOrderDate && (
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <Calendar className="w-3.5 h-3.5" />
                      آخر طلب: {new Date(customer.lastOrderDate).toLocaleDateString('ar-EG')}
                    </p>
                  )}
                </div>

                <div className="bg-blue-50/70 p-4 rounded-2xl border border-blue-100 mb-4">
                  <span className="text-xs text-[#0A468C] font-bold block mb-0.5">
                    {analytics && preset !== 'all'
                      ? 'مشتريات الفترة المحددة'
                      : 'إجمالي المشتريات التراكمية'}
                  </span>
                  <p className="text-2xl font-black text-[#072F5F] tabular-nums">
                    {(analytics && preset !== 'all'
                      ? analytics.periodSpent
                      : customer.totalSpent
                    ).toLocaleString()}{' '}
                    <span className="text-xs font-bold text-[#0A468C]">ج.م</span>
                  </p>
                  {analytics && analytics.periodOrdersCount > 0 && (
                    <p className="text-[11px] font-bold text-slate-600 mt-1 tabular-nums">
                      طلبات الفترة: {analytics.periodOrdersCount} · متوسط الفاتورة:{' '}
                      {analytics.averageOrderValue.toLocaleString()} ج.م
                    </p>
                  )}
                </div>

                {customer.returnHistory && customer.returnHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setReturnHistoryCustomer(customer)}
                    className="w-full mb-3 px-3.5 py-2.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-2xl text-xs font-black text-orange-900 flex items-center justify-between transition-all"
                  >
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-orange-700 shrink-0" />
                      سجل مرتجعات / رفض استلام ({customer.returnHistory.length})
                    </span>
                    <span className="underline text-[11px]">عرض التفاصيل</span>
                  </button>
                )}
              </div>

              {/* AI Marketing Trigger */}
              <button
                onClick={() => handleGenerateAiMessage(customer)}
                className="w-full min-h-[48px] py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-md active:scale-[0.98]"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                توليد رسالة تسويق ذكية (AI)
              </button>
            </div>
          );
        })}
      </div>

      {displayedCustomers.length === 0 && (
        <div className="bg-white rounded-3xl sm:rounded-[2.5rem] p-12 text-center text-slate-500 font-bold space-y-2 border border-slate-200/80">
          <Users className="w-12 h-12 text-slate-300 mx-auto" />
          <p>لا يوجد عملاء مطابقين لخيارات البحث والتحليل.</p>
        </div>
      )}

      {/* Add Customer Modal (Bottom sheet on mobile) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-[#0A468C]" />
                إضافة عميل جديد
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم العميل أو المؤسسة *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: متجر الزهور العطرية"
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">رقم الهاتف</label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">العنوان / المنطقة</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="مثال: الدقي، الجيزة"
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                />
              </div>

              {canEdit && salesReps.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    مندوب المبيعات المسؤول (اختياري)
                  </label>
                  <select
                    value={newAssignedRepId}
                    onChange={(e) => setNewAssignedRepId(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  >
                    <option value="">غير معيّن</option>
                    {salesReps.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 min-h-[48px] py-3.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm transition-all shadow-md active:scale-95"
                >
                  حفظ العميل
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="min-h-[48px] px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {editingCustomer && (() => {
        const linkedOrdersCount = orders.filter(
          (o) =>
            o.customerName === editingCustomer.name ||
            (Boolean(editingCustomer.phone) && o.customerPhone === editingCustomer.phone)
        ).length;
        return (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750] font-cairo" dir="rtl">
            <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <Edit3 className="w-5 h-5 text-[#0A468C]" />
                    تعديل بيانات العميل
                  </h3>
                  <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                    {linkedOrdersCount > 0
                      ? `مرتبط بـ ${linkedOrdersCount} فاتورة تاريخية — سيتم الحفاظ على ربط جميع الفواتير بالعميل تلقائياً`
                      : 'لا توجد فواتير مرتبطة حالياً بهذا العميل'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
                  {editError}
                </div>
              )}

              <form onSubmit={(e) => void handleSaveCustomerEdit(e)} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم العميل أو المؤسسة *</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">رقم الهاتف</label>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">العنوان / المنطقة</label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  />
                </div>

                {canEdit && salesReps.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      مندوب المبيعات المسؤول
                    </label>
                    <select
                      value={editAssignedRepId}
                      onChange={(e) => setEditAssignedRepId(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                    >
                      <option value="">غير معيّن</option>
                      {salesReps.map((rep) => (
                        <option key={rep.id} value={rep.id}>
                          {rep.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="flex-1 min-h-[48px] py-3.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm transition-all shadow-md active:scale-95 disabled:opacity-60"
                  >
                    {isSavingEdit ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCustomer(null)}
                    className="min-h-[48px] px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Delete Customer Confirmation Modal */}
      {customerToDelete && (() => {
        const linkedOrdersCount = orders.filter(
          (o) =>
            o.customerName === customerToDelete.name ||
            (Boolean(customerToDelete.phone) && o.customerPhone === customerToDelete.phone)
        ).length;
        return (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750] font-cairo" dir="rtl">
            <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-5 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
              <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-xl font-black text-slate-900">تأكيد حذف العميل</h3>
                <p className="text-sm text-slate-600 font-bold leading-relaxed">
                  هل أنت متأكد من حذف العميل <span className="text-[#072F5F] font-black">"{customerToDelete.name}"</span> من قاعدة البيانات؟
                </p>
                {linkedOrdersCount > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-xs font-black text-amber-950 text-right">
                    تحذير حماية السجلات: هذا العميل مرتبط حالياً بـ {linkedOrdersCount} فاتورة تاريخية ولا يُسمح بحذفه للحفاظ على سلامة الفواتير؛ يمكنك تعديل بياناته بدلاً من الحذف.
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                {linkedOrdersCount === 0 && (
                  <button
                    onClick={handleConfirmDeleteCustomer}
                    className="flex-1 min-h-[48px] py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm transition-all shadow-md active:scale-95"
                  >
                    تأكيد الحذف
                  </button>
                )}
                <button
                  onClick={() => setCustomerToDelete(null)}
                  className="flex-1 min-h-[48px] px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* AI Marketing Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[650] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-8 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-start pb-4 border-b border-slate-100">
              <div>
                <span className="text-xs font-bold text-[#0A468C] flex items-center gap-1">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  مساعد التسويق الذكي
                </span>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-1">
                  مقترح رسالة مخصصة للعميل: {selectedCustomer.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-blue-50/60 p-5 sm:p-6 rounded-2xl border border-blue-100 min-h-[160px] flex items-center justify-center">
              {isLoadingAi ? (
                <div className="text-center space-y-3 text-[#072F5F] font-bold text-sm">
                  <RefreshCcw className="w-6 h-6 animate-spin mx-auto text-[#0A468C]" />
                  <p>جاري تحليل سجل مشتريات العميل وتوليد عرض تسويقي مخصص...</p>
                </div>
              ) : (
                <p className="text-slate-800 text-sm leading-relaxed whitespace-pre-line font-bold text-right w-full">
                  {aiInsight}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2.5 pt-1">
              <button
                onClick={handleCopy}
                disabled={isLoadingAi || !aiInsight}
                className="min-h-[48px] px-6 py-3 bg-[#0A468C] text-white rounded-2xl font-black text-sm hover:bg-[#072F5F] transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 disabled:opacity-50"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'تم النسخ للحافظة!' : 'نسخ الرسالة لإرسالها للعميل'}
              </button>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Return / Refusal History Modal */}
      {returnHistoryCustomer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-xl rounded-t-3xl sm:rounded-[2.5rem] p-5 sm:p-7 pb-safe shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  سجل المرتجعات ورفض الاستلام
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  العميل: {returnHistoryCustomer.name} · {returnHistoryCustomer.phone}
                </p>
              </div>
              <button
                onClick={() => setReturnHistoryCustomer(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {(returnHistoryCustomer.returnHistory || []).map((entry, idx) => (
                <div
                  key={idx}
                  className="bg-orange-50/70 border border-orange-200 rounded-2xl p-4 space-y-1.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-orange-950">
                      فاتورة #{entry.orderId} · {entry.outcome} ({entry.reason})
                    </span>
                    <span className="font-bold text-orange-800 tabular-nums">
                      {new Date(entry.recordedAt).toLocaleString('ar-EG')}
                    </span>
                  </div>
                  <p className="font-bold text-slate-800 leading-relaxed">{entry.details}</p>
                  <p className="text-[11px] font-bold text-slate-500">
                    سُجل بواسطة: {entry.recordedByName}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => setReturnHistoryCustomer(null)}
              className="w-full min-h-[48px] py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl font-black text-sm"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* Bulk Assign Sales Rep Modal */}
      {showAssignRepModal && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[780] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-[#072F5F]">تعيين مندوب للعملاء المحددين</h3>
              <button
                type="button"
                onClick={() => setShowAssignRepModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                اختر مندوب المبيعات المستهدف *
              </label>
              <select
                value={bulkTargetRepId}
                onChange={(e) => setBulkTargetRepId(e.target.value)}
                className="w-full min-h-[46px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm"
              >
                {salesReps.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                disabled={!bulkTargetRepId}
                onClick={() => void handleRequestBulkPreview('assign_sales_rep', bulkTargetRepId)}
                className="flex-1 min-h-[48px] px-5 py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm"
              >
                معاينة التعيين
              </button>
              <button
                type="button"
                onClick={() => setShowAssignRepModal(false)}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Bulk Preview Modal */}
      {bulkPreviewMeta && (
        <BulkPreviewModal
          preview={bulkPreview}
          title={bulkPreviewMeta.title}
          subtitle={bulkPreviewMeta.subtitle}
          confirmLabel={bulkPreviewMeta.confirmLabel}
          confirmVariant={bulkPreviewMeta.confirmVariant}
          executing={bulkExecuting}
          error={bulkError}
          onCancel={() => {
            if (!bulkExecuting) {
              setBulkPreview(null);
              setBulkPreviewMeta(null);
              setBulkError(null);
            }
          }}
          onConfirm={() => void handleExecuteBulkConfirmed()}
        />
      )}
    </div>
  );
};
