import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  PackageMinus,
  PackageX,
  RefreshCcw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  BackupRecord,
  GranularResetGroupId,
  OwnerSystemOverviewCounts,
  SystemResetPreview,
  SystemResetResult,
  SystemResetScope,
} from '../types';
import { apiClient, ApiRequestError } from '../src/lib/api';

const FULL_RESET_CONFIRM_PHRASE = 'تأكيد تصفير النظام بالكامل';
const REMOVE_CATALOG_CONFIRM_PHRASE = 'تأكيد إزالة كتالوج المنتجات';

const GRANULAR_GROUP_META: Array<{
  key: GranularResetGroupId;
  label: string;
  desc: string;
}> = [
  { key: 'orders_and_revisions', label: 'الفواتير والمراجعات', desc: 'حذف الفواتير والمراجعات وتصفير عمولات المناديب' },
  { key: 'stock_movements', label: 'حركات المخزون', desc: 'حذف سجل حركات المستودع التاريخية' },
  { key: 'external_sourcing', label: 'سجلات التوريد الخارجي', desc: 'حذف فواتير/تكاليف التوريد من الموردين' },
  { key: 'zero_stock_balances', label: 'تصفير أرصدة المخزون', desc: 'ضبط رصيد كل المنتجات على 0 دون حذف الكتالوج' },
  { key: 'customers_unlinked', label: 'العملاء غير المرتبطين', desc: 'حذف العملاء الذين لا يملكون فواتير فقط' },
  { key: 'customers_balances', label: 'أرصدة وتصنيفات العملاء', desc: 'تصفير إجمالي المشتريات دون حذف العملاء' },
  { key: 'demo_products', label: 'المنتجات التجريبية فقط', desc: 'حذف الأصناف التجريبية غير المرتبطة' },
  { key: 'unlinked_catalog', label: 'كتالوج المنتجات غير المرتبط', desc: 'حذف الأصناف التي لا ترتبط بأي فاتورة أو حركة' },
  { key: 'chat_messages', label: 'شات الفريق الداخلي', desc: 'حذف جميع رسائل الشات' },
  { key: 'price_list_imports', label: 'أرشيف قوائم الأسعار PDF', desc: 'حذف سجل ومرفقات استيراد PDF' },
  { key: 'operational_logs', label: 'السجلات التشغيلية', desc: 'تنظيف سجلات التدقيق غير الأمنية وسجل تغييرات العمولة' },
];

interface OwnerSystemResetPanelProps {
  backups: BackupRecord[];
  systemCounts?: OwnerSystemOverviewCounts;
  stepUpActive: boolean;
  onRequireStepUp: () => void;
  onRefreshAll: () => Promise<void>;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
}

export const OwnerSystemResetPanel: React.FC<OwnerSystemResetPanelProps> = ({
  backups,
  systemCounts,
  stepUpActive,
  onRequireStepUp,
  onRefreshAll,
  onError,
  onSuccess,
}) => {
  const [selectedMode, setSelectedMode] = useState<SystemResetScope['mode']>('reset_sales');
  const [stockReason, setStockReason] = useState('');
  const [customerAction, setCustomerAction] = useState<
    'reset_balances' | 'delete_unlinked_and_demo' | 'delete_all'
  >('delete_unlinked_and_demo');
  const [clearChat, setClearChat] = useState(true);
  const [clearPdfImports, setClearPdfImports] = useState(false);
  const [clearOpLogs, setClearOpLogs] = useState(false);

  const [archiveProtectedCatalog, setArchiveProtectedCatalog] = useState(true);
  const [catalogConfirmPhrase, setCatalogConfirmPhrase] = useState('');
  const [selectedResetGroups, setSelectedResetGroups] = useState<GranularResetGroupId[]>([]);

  const [selectedDemoIds, setSelectedDemoIds] = useState<string[]>([]);
  const [livePreview, setLivePreview] = useState<SystemResetPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmModalPreview, setConfirmModalPreview] = useState<SystemResetPreview | null>(null);

  const verifiedBackups = backups.filter(
    (b) => b.status === 'completed' && b.verificationStatus !== 'failed'
  );
  const [verifiedBackupId, setVerifiedBackupId] = useState<string>(verifiedBackups[0]?.id || '');
  const [fullConfirmPhrase, setFullConfirmPhrase] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [executing, setExecuting] = useState(false);
  const [resetResult, setResetResult] = useState<SystemResetResult | null>(null);

  const effectiveBackupId =
    verifiedBackupId && verifiedBackups.some((b) => b.id === verifiedBackupId)
      ? verifiedBackupId
      : verifiedBackups[0]?.id || '';

  const loadModePreview = async (
    mode: SystemResetScope['mode'],
    custAction = customerAction
  ) => {
    setLoadingPreview(true);
    try {
      const preview = await apiClient.previewOwnerSystemReset({
        mode,
        customerAction: mode === 'reset_customers' ? custAction : undefined,
        archiveProtectedCatalog: mode === 'remove_catalog' ? archiveProtectedCatalog : undefined,
        resetGroups: mode === 'reset_groups' ? selectedResetGroups : undefined,
      });
      setLivePreview(preview);
      if (mode === 'reset_demo_products' && preview.demoProductsSummary) {
        setSelectedDemoIds(preview.demoProductsSummary.eligibleToDelete.map((p) => p.id));
      }
      return preview;
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر تحميل معاينة التصفير.');
      return null;
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (
      selectedMode === 'reset_customers' ||
      selectedMode === 'reset_demo_products' ||
      selectedMode === 'reset_stock' ||
      selectedMode === 'remove_catalog' ||
      selectedMode === 'reset_groups'
    ) {
      void loadModePreview(selectedMode, customerAction);
    } else {
      setLivePreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMode, customerAction]);

  const handleRequestResetConfirmation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (executing || loadingPreview) return;
    onError(null);
    onSuccess(null);

    if (selectedMode === 'reset_stock' && !stockReason.trim()) {
      onError('يرجى إدخال سبب التصفير لتسجيله في سجل حركات المخزون وسجل التدقيق.');
      return;
    }
    if (selectedMode === 'reset_demo_products' && selectedDemoIds.length === 0) {
      onError('لا توجد منتجات تجريبية غير مرتبطة محددة للحذف.');
      return;
    }
    if (
      selectedMode === 'reset_extras' &&
      !clearChat &&
      !clearPdfImports &&
      !clearOpLogs
    ) {
      onError('يرجى تحديد خيار واحد على الأقل للتنظيف.');
      return;
    }
    if (selectedMode === 'remove_catalog') {
      if (catalogConfirmPhrase.trim() !== REMOVE_CATALOG_CONFIRM_PHRASE) {
        onError(`يرجى كتابة عبارة التأكيد المطابقة: "${REMOVE_CATALOG_CONFIRM_PHRASE}"`);
        return;
      }
    }
    if (selectedMode === 'reset_groups' && selectedResetGroups.length === 0) {
      onError('يرجى تحديد مجموعة بيانات واحدة على الأقل للتصفير الانتقائي.');
      return;
    }
    if (selectedMode === 'reset_full') {
      if (!effectiveBackupId) {
        onError('يجب إنشاء نسخة احتياطية كاملة ناجحة ومتحقق منها قبل السماح بالتصفير الكامل.');
        return;
      }
      if (fullConfirmPhrase.trim() !== FULL_RESET_CONFIRM_PHRASE) {
        onError(`يرجى كتابة عبارة التأكيد المطابقة: "${FULL_RESET_CONFIRM_PHRASE}"`);
        return;
      }
    }

    const preview = await loadModePreview(selectedMode, customerAction);
    if (!preview) return;

    if (
      selectedMode === 'reset_customers' &&
      customerAction === 'delete_all' &&
      preview.ordersCount > 0
    ) {
      onError(
        `يوجد حالياً ${preview.ordersCount} فاتورة مسجلة — لا يمكن حذف جميع العملاء. اختر "حذف العملاء غير المرتبطين والتجريبيين فقط" أو صفّر الفواتير أولاً.`
      );
      return;
    }

    setConfirmModalPreview(preview);
  };

  const handleConfirmExecuteReset = async () => {
    if (executing) return;
    setExecuting(true);
    onError(null);
    onSuccess(null);
    try {
      const payload: SystemResetScope = {
        mode: selectedMode,
        customerAction: selectedMode === 'reset_customers' ? customerAction : undefined,
        selectedDemoProductIds:
          selectedMode === 'reset_demo_products' ? selectedDemoIds : undefined,
        clearChatMessages: selectedMode === 'reset_extras' ? clearChat : undefined,
        clearPriceListImports: selectedMode === 'reset_extras' ? clearPdfImports : undefined,
        clearOperationalLogs: selectedMode === 'reset_extras' ? clearOpLogs : undefined,
        archiveProtectedCatalog: selectedMode === 'remove_catalog' ? archiveProtectedCatalog : undefined,
        resetGroups: selectedMode === 'reset_groups' ? selectedResetGroups : undefined,
        reason: stockReason.trim() || undefined,
        confirmationPhrase:
          selectedMode === 'reset_full'
            ? fullConfirmPhrase.trim()
            : selectedMode === 'remove_catalog'
              ? catalogConfirmPhrase.trim()
              : undefined,
        verifiedBackupId: selectedMode === 'reset_full' ? effectiveBackupId : undefined,
      };
      const res = await apiClient.executeOwnerSystemReset(
        payload,
        confirmPassword.trim() || undefined
      );
      setResetResult(res);
      setConfirmModalPreview(null);
      setFullConfirmPhrase('');
      setCatalogConfirmPhrase('');
      setConfirmPassword('');
      setStockReason('');
      onSuccess(`تم تنفيذ العملية (${selectedMode}) بنجاح وتوثيقها في سجل التدقيق الإداري ✅`);
      await onRefreshAll();
      if (
        selectedMode === 'reset_customers' ||
        selectedMode === 'reset_demo_products' ||
        selectedMode === 'reset_stock' ||
        selectedMode === 'remove_catalog' ||
        selectedMode === 'reset_groups'
      ) {
        await loadModePreview(selectedMode, customerAction);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.requiresOwnerReauth) {
        onRequireStepUp();
      }
      setConfirmModalPreview(null);
      onError(err instanceof Error ? err.message : 'فشل تنفيذ عملية التصفير.');
    } finally {
      setExecuting(false);
    }
  };

  const modeMeta: Record<SystemResetScope['mode'], { title: string; desc: string }> = {
    reset_sales: {
      title: 'تصفير المبيعات والفواتير فقط',
      desc: 'يحذف الفواتير والمراجعات وعمولات المناديب فقط مع الحفاظ على الكتالوج والمخزون',
    },
    reset_stock: {
      title: 'تصفير كميات المخزون فقط',
      desc: 'يعيد كميات المخزون إلى 0 مع حفظ جميع الأصناف والأسعار والفواتير',
    },
    reset_customers: {
      title: 'تصفير / تنظيف العملاء',
      desc: 'تصفير الأرصدة أو حذف العملاء غير المرتبطين والتجريبيين فقط',
    },
    reset_demo_products: {
      title: 'إزالة المنتجات التجريبية فقط',
      desc: 'يحذف الأصناف التجريبية غير المرتبطة بأي فواتير أو حركات مع حفظ كل المنتجات الحقيقية',
    },
    reset_extras: {
      title: 'تنظيف إضافي مستقل',
      desc: 'الشات الداخلي أو دفعات PDF أو السجلات التشغيلية',
    },
    reset_full: {
      title: 'تصفير كامل للنظام',
      desc: 'شديد الخطورة — يتطلب نسخة احتياطية موثقة وعبارة تأكيد',
    },
    remove_catalog: {
      title: 'إزالة كتالوج المنتجات بالكامل',
      desc: 'يحذف كل الأصناف غير المرتبطة بفواتير أو حركات، ويحفظ/يؤرشف الأصناف المرتبطة تاريخياً',
    },
    reset_groups: {
      title: 'تصفير انتقائي مخصص للمجموعات',
      desc: 'تحديد مجموعات بيانات مستقلة للتصفير دفعة واحدة في معاملة محمية',
    },
  };

  return (
    <div className="rounded-3xl border-2 border-red-300 bg-gradient-to-b from-red-50/70 via-white to-white p-5 sm:p-6 shadow-sm space-y-6">
      {/* Danger Zone Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-red-200 pb-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-xl text-xs font-black">
            <AlertOctagon className="w-4 h-4" />
            <span>منطقة عالية الخطورة — تصفير وتنظيف النظام (للمالك فقط)</span>
          </div>
          <h4 className="text-lg sm:text-xl font-black text-red-950">
            خيارات التصفير المنضبطة حسب النطاق التشغيلي
          </h4>
          <p className="text-xs font-bold text-red-800">
            تم الفصل الواضح بين تصفير المبيعات، تصفير كميات المخزون، تنظيف العملاء، إزالة الكتالوج، والتصفير الانتقائي للمجموعات — مع تأكيد إجباري ومعاينة قبل التنفيذ.
          </p>
        </div>
        {systemCounts && (
          <div className="bg-white border border-red-200 rounded-2xl px-4 py-2.5 text-[11px] font-bold text-slate-700 tabular-nums shrink-0">
            <p>الفواتير الحالية: {systemCounts.ordersCount} · المنتجات: {systemCounts.productsCount}</p>
            <p>العملاء: {systemCounts.customersCount} · حركات المخزون: {systemCounts.stockMovementsCount}</p>
          </div>
        )}
      </div>

      {/* Mode Selection Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(
          [
            ['reset_sales', '1. تصفير المبيعات والفواتير', 'يحذف الفواتير والمراجعات وعمولات المناديب فقط', <RotateCcw className="w-4 h-4" />],
            ['reset_stock', '2. تصفير كميات المخزون', 'يعيد الكميات إلى 0 مع حفظ الكتالوج والأسعار والمبيعات', <PackageX className="w-4 h-4" />],
            ['reset_customers', '3. تصفير / تنظيف العملاء', 'تصفير الأرصدة أو إزالة العملاء غير المرتبطين والتجريبيين', <Users className="w-4 h-4" />],
            ['reset_demo_products', '4. إزالة المنتجات التجريبية فقط', 'يحذف المنتجات التجريبية غير المستخدمة ويحمي الحقيقية', <PackageMinus className="w-4 h-4" />],
            ['reset_extras', '5. تنظيف إضافي مستقل', 'الشات أو دفعات PDF أو السجلات التشغيلية', <Trash2 className="w-4 h-4" />],
            ['reset_full', '6. تصفير كامل للنظام', 'شديد الخطورة — يتطلب نسخة موثقة وعبارة تأكيد', <ShieldAlert className="w-4 h-4" />],
            ['remove_catalog', '7. إزالة كتالوج المنتجات', 'حذف غير المرتبطين وحماية/أرشفة المرتبطين بفواتير', <PackageX className="w-4 h-4" />],
            ['reset_groups', '8. تصفير انتقائي للمجموعات', 'تحديد مجموعات بيانات معينة للتنظيف بدقة', <AlertOctagon className="w-4 h-4" />],
          ] as [SystemResetScope['mode'], string, string, React.ReactNode][]
        ).map(([mode, title, desc, icon]) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              setSelectedMode(mode);
              setResetResult(null);
            }}
            className={`text-right p-3.5 rounded-2xl border transition-all space-y-1.5 ${
              selectedMode === mode
                ? mode === 'reset_full' || mode === 'remove_catalog'
                  ? 'bg-red-700 text-white border-red-800 shadow-md'
                  : 'bg-[#072F5F] text-white border-[#072F5F] shadow-md'
                : 'bg-white text-slate-800 border-slate-200 hover:border-red-300'
            }`}
          >
            <div className="flex items-center gap-1.5 font-black text-xs">
              {icon}
              <span>{title}</span>
            </div>
            <p
              className={`text-[11px] font-bold leading-snug ${
                selectedMode === mode ? 'text-white/90' : 'text-slate-500'
              }`}
            >
              {desc}
            </p>
          </button>
        ))}
      </div>

      {/* Scope Details Form */}
      <form
        onSubmit={(e) => void handleRequestResetConfirmation(e)}
        className="bg-white rounded-2xl border border-red-200 p-5 space-y-4"
      >
        {selectedMode === 'reset_sales' && (
          <div className="space-y-2 text-xs">
            <h5 className="font-black text-sm text-[#072F5F]">تصفير المبيعات والفواتير فقط</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl font-bold text-red-900 space-y-1">
                <p className="font-black">سيتم حذف / تصفير:</p>
                <p>• جميع الفواتير (`orders`) ومراجعات التعديلات (`order_revisions`)</p>
                <p>• حركات المخزون المرتبطة بالفواتير</p>
                <p>• إجمالي العمولات المحققة والمعلقة وعدد الطلبات للمناديب</p>
                <p>• إجمالي مشتريات العملاء (`totalSpent = 0`)</p>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl font-bold text-emerald-900 space-y-1">
                <p className="font-black">سيتم الحفاظ التام على:</p>
                <p>• نسخة أمان تلقائية (`pre_reset_safety`) تُحفظ قبل التنفيذ</p>
                <p>• حساب المالك الرئيسي والمستخدمين وصلاحياتهم</p>
                <p>• كتالوج المنتجات وأرصدة المخزون الحالية والتصنيفات</p>
                <p>• نسب عمولات المناديب والإعدادات العامة للنظام</p>
              </div>
            </div>
          </div>
        )}

        {selectedMode === 'reset_stock' && (
          <div className="space-y-3 text-xs">
            <h5 className="font-black text-sm text-[#072F5F]">تصفير كميات المخزون فقط (بدون حذف الأصناف)</h5>
            <p className="font-bold text-slate-600">
              يضبط <span dir="ltr">products.stock = 0</span> لجميع الأصناف ذات الرصيد غير الصفري مع الحفاظ التام على الكتالوج والأسعار والفواتير، ويسجل قيد تسوية صريحاً في سجل حركات المخزون لكل صنف.
            </p>
            {livePreview?.stockSummary && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl font-bold text-[#072F5F] flex flex-wrap gap-3 tabular-nums">
                <span>إجمالي الأصناف: {livePreview.stockSummary.totalProducts}</span>
                <span>أصناف برصيد غير صفري: {livePreview.stockSummary.nonZeroProductsCount}</span>
                <span>إجمالي الوحدات التي ستعود إلى 0: {livePreview.stockSummary.totalUnitsToZero.toLocaleString()}</span>
              </div>
            )}
            <div>
              <label className="block text-xs font-black text-slate-800 mb-1">
                سبب تصفير أرصدة المخزون (إلزامي للتوثيق) *
              </label>
              <input
                type="text"
                required
                value={stockReason}
                onChange={(e) => setStockReason(e.target.value)}
                placeholder="مثال: بداية فترة جرد جديدة ٢٠٢٦..."
                className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
              />
            </div>
          </div>
        )}

        {selectedMode === 'reset_customers' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <h5 className="font-black text-sm text-[#072F5F]">تصفير وتنظيف العملاء</h5>
              {loadingPreview && <RefreshCcw className="w-4 h-4 animate-spin text-[#0A468C]" />}
            </div>

            {livePreview?.customersSummary && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-2 text-center tabular-nums">
                <div>
                  <p className="text-[11px] font-bold text-slate-500">إجمالي العملاء</p>
                  <p className="text-base font-black text-slate-900">{livePreview.customersSummary.totalCount}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-emerald-700">مرتبطون بفواتير (محميون)</p>
                  <p className="text-base font-black text-emerald-800">{livePreview.customersSummary.linkedCount}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-amber-700">غير مرتبطين بفواتير</p>
                  <p className="text-base font-black text-amber-800">{livePreview.customersSummary.unlinkedCount}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-red-700">عملاء تجريبيون/اختبار</p>
                  <p className="text-base font-black text-red-800">{livePreview.customersSummary.demoCount}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex items-start gap-2.5 p-3 bg-amber-50/70 rounded-xl border border-amber-300 cursor-pointer">
                <input
                  type="radio"
                  name="custAction"
                  checked={customerAction === 'delete_unlinked_and_demo'}
                  onChange={() => setCustomerAction('delete_unlinked_and_demo')}
                  className="mt-1 accent-[#0A468C]"
                />
                <div>
                  <p className="font-black text-slate-900">حذف العملاء غير المرتبطين والتجريبيين فقط</p>
                  <p className="text-[11px] font-bold text-slate-600">
                    يحذف العملاء الذين ليس لهم أي فواتير (بما فيهم التجريبيين) ويحفظ العملاء المرتبطين بالفواتير دون كسر السجلات
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="radio"
                  name="custAction"
                  checked={customerAction === 'reset_balances'}
                  onChange={() => setCustomerAction('reset_balances')}
                  className="mt-1 accent-[#0A468C]"
                />
                <div>
                  <p className="font-black text-slate-900">تصفير الأرصدة والتصنيفات فقط</p>
                  <p className="text-[11px] font-bold text-slate-500">
                    يعيد المشتريات إلى 0 والتصنيف إلى عادي وسجل المرتجعات دون حذف أي عميل
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 bg-red-50 rounded-xl border border-red-200 cursor-pointer">
                <input
                  type="radio"
                  name="custAction"
                  checked={customerAction === 'delete_all'}
                  onChange={() => setCustomerAction('delete_all')}
                  className="mt-1 accent-red-600"
                />
                <div>
                  <p className="font-black text-red-900">حذف جميع سجلات العملاء نهائياً</p>
                  <p className="text-[11px] font-bold text-red-700">
                    يتطلب أن يكون عدد الفواتير = 0 لحماية ارتباط الفواتير
                  </p>
                </div>
              </label>
            </div>

            {customerAction === 'delete_unlinked_and_demo' &&
              livePreview?.customersSummary &&
              livePreview.customersSummary.unlinkedSample.length > 0 && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                  <p className="font-black text-slate-800">
                    العملاء المرشحون للحذف ({livePreview.customersSummary.unlinkedCount} عميل غير مرتبط بفواتير):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {livePreview.customersSummary.unlinkedSample.map((c) => (
                      <span
                        key={c.id}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                          c.isDemo
                            ? 'bg-red-50 border-red-200 text-red-900'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        {c.name} {c.phone ? `(${c.phone})` : ''} {c.isDemo ? '· تجريبي' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {selectedMode === 'reset_demo_products' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <h5 className="font-black text-sm text-[#072F5F]">
                إزالة المنتجات التجريبية / الاختبارية فقط (حماية تامة للكتالوج الحقيقي)
              </h5>
              {loadingPreview && <RefreshCcw className="w-4 h-4 animate-spin text-[#0A468C]" />}
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl font-bold text-emerald-900">
              ✓ تقتصر هذه الأداة على الأصناف التجريبية أو الاختبارية التي لا ترتبط بأي فواتير أو حركات مخزون، ولا تمس نهائياً المنتجات الحقيقية أو المستوردة.
            </div>

            {livePreview?.demoProductsSummary && (
              <div className="space-y-3">
                {livePreview.demoProductsSummary.eligibleToDelete.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold text-slate-600">
                    لا توجد حالياً منتجات تجريبية غير مرتبطة قابلة للحذف.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="font-black text-slate-800">
                      الأصناف التجريبية القابلة للإزالة بأمان ({livePreview.demoProductsSummary.eligibleToDelete.length}):
                    </p>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {livePreview.demoProductsSummary.eligibleToDelete.map((p) => {
                        const checked = selectedDemoIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedDemoIds((prev) =>
                                    e.target.checked
                                      ? [...prev, p.id]
                                      : prev.filter((id) => id !== p.id)
                                  );
                                }}
                                className="w-4 h-4 accent-red-600"
                              />
                              <div className="min-w-0">
                                <p className="font-black text-slate-900 truncate">
                                  {p.name} <span dir="ltr" className="text-[#0A468C]">({p.code})</span>
                                </p>
                                <p className="text-[11px] font-bold text-slate-500">
                                  {p.categoryName} · {p.reason}
                                </p>
                              </div>
                            </div>
                            <span className="text-[11px] font-black text-slate-600 tabular-nums shrink-0">
                              المخزون: {p.stock.toLocaleString()}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {livePreview.demoProductsSummary.blockedLinked.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-1.5">
                    <p className="font-black text-amber-950 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      أصناف تجريبية محمية من الحذف لارتباطها ببيانات تشغيلية ({livePreview.demoProductsSummary.blockedLinked.length}):
                    </p>
                    {livePreview.demoProductsSummary.blockedLinked.map((b) => (
                      <p key={b.id} className="text-[11px] font-bold text-amber-900">
                        • {b.name} (<span dir="ltr">{b.code}</span>) — مرتبط بـ {b.ordersCount} فاتورة و {b.stockMovementsCount} حركة مخزون (يمكن أرشفته من تبويب المخزون بدلاً من الحذف)
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {selectedMode === 'reset_extras' && (
          <div className="space-y-3 text-xs">
            <h5 className="font-black text-sm text-[#072F5F]">تنظيف الأقسام الإضافية بشكل مستقل</h5>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-bold">
              <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearChat}
                  onChange={(e) => setClearChat(e.target.checked)}
                  className="w-4 h-4 accent-[#0A468C]"
                />
                <span>حذف رسائل شات الفريق الداخلي</span>
              </label>
              <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearPdfImports}
                  onChange={(e) => setClearPdfImports(e.target.checked)}
                  className="w-4 h-4 accent-[#0A468C]"
                />
                <span>حذف أرشيف دفعات استيراد PDF</span>
              </label>
              <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearOpLogs}
                  onChange={(e) => setClearOpLogs(e.target.checked)}
                  className="w-4 h-4 accent-[#0A468C]"
                />
                <span>حذف السجلات التشغيلية (مع إبقاء سجل الأمان الحرج)</span>
              </label>
            </div>
          </div>
        )}

        {selectedMode === 'remove_catalog' && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between gap-2">
              <h5 className="font-black text-sm text-red-900">
                إزالة كتالوج المنتجات بالكامل (مع حماية المنتجات المرتبطة بفواتير أو حركات)
              </h5>
              {loadingPreview && <RefreshCcw className="w-4 h-4 animate-spin text-red-700" />}
            </div>

            {livePreview?.catalogRemovalSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-center tabular-nums">
                <div>
                  <p className="text-[11px] font-bold text-slate-500">إجمالي الكتالوج</p>
                  <p className="text-base font-black text-slate-900">
                    {livePreview.catalogRemovalSummary.totalProducts}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-red-700">سيُحذف نهائياً (غير مرتبط)</p>
                  <p className="text-base font-black text-red-700">
                    {livePreview.catalogRemovalSummary.deletableCount}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-emerald-700">محمي (مرتبط بسجلات)</p>
                  <p className="text-base font-black text-emerald-800">
                    {livePreview.catalogRemovalSummary.protectedCount}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-amber-700">مؤرشف بالفعل من المحمي</p>
                  <p className="text-base font-black text-amber-800">
                    {livePreview.catalogRemovalSummary.archivedProtectedCount}
                  </p>
                </div>
              </div>
            )}

            <label className="flex items-start gap-2.5 p-3 bg-amber-50/70 rounded-xl border border-amber-200 cursor-pointer font-bold text-amber-950">
              <input
                type="checkbox"
                checked={archiveProtectedCatalog}
                onChange={(e) => setArchiveProtectedCatalog(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-[#0A468C]"
              />
              <div>
                <p className="font-black">أرشفة الأصناف المحمية (المرتبطة بفواتير/حركات) تلقائياً</p>
                <p className="text-[11px] text-amber-900">
                  لن تُحذف الأصناف المرتبطة بفواتير حفاظاً على التقارير التاريخية، ولكن ستُخفى من الفواتير الجديدة عند التفعيل.
                </p>
              </div>
            </label>

            <div>
              <label className="block text-xs font-black text-red-900 mb-1">
                اكتب عبارة التأكيد المطابقة: <span className="underline">{REMOVE_CATALOG_CONFIRM_PHRASE}</span>
              </label>
              <input
                type="text"
                value={catalogConfirmPhrase}
                onChange={(e) => setCatalogConfirmPhrase(e.target.value)}
                placeholder={REMOVE_CATALOG_CONFIRM_PHRASE}
                className="w-full min-h-[44px] px-3.5 py-2 bg-red-50/40 border border-red-300 rounded-xl font-black text-sm"
              />
            </div>
          </div>
        )}

        {selectedMode === 'reset_groups' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <h5 className="font-black text-sm text-[#072F5F]">
                تصفير انتقائي مخصص حسب مجموعات البيانات (Granular Reset)
              </h5>
              {loadingPreview && <RefreshCcw className="w-4 h-4 animate-spin text-[#0A468C]" />}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {GRANULAR_GROUP_META.map((grp) => {
                const checked = selectedResetGroups.includes(grp.key);
                const count = livePreview?.groupsSummary?.[grp.key];
                return (
                  <label
                    key={grp.key}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      checked
                        ? 'bg-blue-50 border-[#0A468C] shadow-xs'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedResetGroups((prev) =>
                          e.target.checked
                            ? [...prev, grp.key]
                            : prev.filter((k) => k !== grp.key)
                        )
                      }
                      className="w-4 h-4 mt-0.5 accent-[#0A468C]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-black text-slate-900">{grp.label}</span>
                        {typeof count === 'number' && (
                          <span className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[10px] font-black text-[#072F5F] tabular-nums">
                            {count.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-bold text-slate-500 leading-snug mt-0.5">
                        {grp.desc}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {selectedMode === 'reset_full' && (
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-red-50 border border-red-300 rounded-2xl space-y-1.5 text-red-950 font-bold">
              <p className="font-black text-sm flex items-center gap-1.5 text-red-800">
                <ShieldAlert className="w-4 h-4" />
                متطلبات أمان إجبارية قبل التصفير الكامل للنظام:
              </p>
              <p>1. وجود نسخة احتياطية كاملة حديثة وناجحة ومتحقق منها في السجل.</p>
              <p>2. إعادة مصادقة المالك الرئيسي (Step-Up Verification).</p>
              <p>3. كتابة عبارة التأكيد المطابقة بالأسفل.</p>
              <p className="text-emerald-900 font-black pt-1">
                ✓ يضمن النظام الحفاظ الكامل على حساب المالك الرئيسي وصلاحياته ورمز الاسترداد وبنية قاعدة البيانات والتصنيفات.
              </p>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-800 mb-1">
                النسخة الاحتياطية الحديثة الموثقة المعتمدة *
              </label>
              {verifiedBackups.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl font-black text-amber-900">
                  لا توجد أي نسخة احتياطية كاملة متحقق منها حتى الآن — توجه لقسم "النسخ الاحتياطي والاستعادة" لإنشاء نسخة أولاً.
                </div>
              ) : (
                <select
                  value={effectiveBackupId}
                  onChange={(e) => setVerifiedBackupId(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs"
                >
                  {verifiedBackups.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — {new Date(b.createdAt).toLocaleString('ar-EG')} ({b.totalRecords} سجل)
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-black text-red-900 mb-1">
                اكتب عبارة التأكيد المطابقة: <span className="underline">{FULL_RESET_CONFIRM_PHRASE}</span>
              </label>
              <input
                type="text"
                value={fullConfirmPhrase}
                onChange={(e) => setFullConfirmPhrase(e.target.value)}
                placeholder={FULL_RESET_CONFIRM_PHRASE}
                className="w-full min-h-[44px] px-3.5 py-2 bg-red-50/40 border border-red-300 rounded-xl font-black text-sm"
              />
            </div>
          </div>
        )}

        {!stepUpActive && (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              كلمة مرور تأكيد هوية المالك الرئيسي *
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="أدخل كلمة مرور المالك لتنفيذ العملية..."
              className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={
            executing ||
            loadingPreview ||
            (selectedMode === 'reset_demo_products' && selectedDemoIds.length === 0) ||
            (selectedMode === 'remove_catalog' &&
              catalogConfirmPhrase.trim() !== REMOVE_CATALOG_CONFIRM_PHRASE) ||
            (selectedMode === 'reset_groups' && selectedResetGroups.length === 0) ||
            (selectedMode === 'reset_full' &&
              (!effectiveBackupId || fullConfirmPhrase.trim() !== FULL_RESET_CONFIRM_PHRASE))
          }
          className={`w-full min-h-[48px] px-6 py-2.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 text-white shadow-md disabled:opacity-50 ${
            selectedMode === 'reset_full' ||
            selectedMode === 'reset_customers' ||
            selectedMode === 'reset_demo_products' ||
            selectedMode === 'remove_catalog'
              ? 'bg-red-700 hover:bg-red-800'
              : 'bg-[#072F5F] hover:bg-[#0A468C]'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          مراجعة التفاصيل وتأكيد التنفيذ
        </button>
      </form>

      {resetResult && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 space-y-2 text-xs">
          <p className="font-black text-emerald-950 flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            ملخص تنفيذ العملية ({resetResult.mode})
          </p>
          {resetResult.preResetBackupId && (
            <p className="font-bold text-emerald-900">
              النسخة الاحتياطية المرجعية قبل التنفيذ:{' '}
              <span dir="ltr" className="font-black">
                {resetResult.preResetBackupId}
              </span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {Object.entries(resetResult.affectedCounts).map(([k, v]) => (
              <span
                key={k}
                className="px-2.5 py-1 bg-white border border-emerald-200 rounded-xl font-black tabular-nums"
              >
                {k}: {v}
              </span>
            ))}
          </div>
          {resetResult.warnings.map((w, i) => (
            <p key={i} className="font-bold text-amber-900">
              ⚠ {w}
            </p>
          ))}
          {resetResult.preservedSummary.map((line, i) => (
            <p key={i} className="font-bold text-emerald-900">
              ✓ {line}
            </p>
          ))}
        </div>
      )}

      {/* Explicit Pre-Execution Confirmation Modal */}
      {confirmModalPreview && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[800] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-lg font-black text-red-900 flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 text-red-600" />
                تأكيد نهائي قبل التنفيذ
              </h4>
              <button
                type="button"
                onClick={() => !executing && setConfirmModalPreview(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1.5">
              <p className="font-black text-red-950 text-sm">{modeMeta[selectedMode].title}</p>
              <p className="font-bold text-red-900">{modeMeta[selectedMode].desc}</p>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 space-y-1.5 tabular-nums">
              <p className="font-black text-slate-900">التأثير الفعلي المتوقع على قاعدة البيانات:</p>
              {selectedMode === 'reset_sales' && (
                <p>• سيتم حذف {confirmModalPreview.ordersCount} فاتورة وتصفير عمولات المناديب وأرصدة مشتريات العملاء.</p>
              )}
              {selectedMode === 'reset_stock' && confirmModalPreview.stockSummary && (
                <>
                  <p>• سيتم تصفير مخزون {confirmModalPreview.stockSummary.nonZeroProductsCount} صنف (بإجمالي {confirmModalPreview.stockSummary.totalUnitsToZero.toLocaleString()} وحدة).</p>
                  <p>• السبب المسجل: {stockReason}</p>
                </>
              )}
              {selectedMode === 'reset_customers' && confirmModalPreview.customersSummary && (
                <>
                  {customerAction === 'delete_unlinked_and_demo' && (
                    <>
                      <p>• سيتم حذف {confirmModalPreview.customersSummary.unlinkedCount} عميل غير مرتبط بفواتير (شامل العملاء التجريبيين).</p>
                      <p>• سيتم الإبقاء على {confirmModalPreview.customersSummary.linkedCount} عميل مرتبط بفواتير تاريخية.</p>
                    </>
                  )}
                  {customerAction === 'reset_balances' && (
                    <p>• سيتم تصفير أرصدة وتصنيفات {confirmModalPreview.customersSummary.totalCount} عميل دون حذف أي عميل.</p>
                  )}
                  {customerAction === 'delete_all' && (
                    <p>• سيتم حذف جميع العملاء ({confirmModalPreview.customersSummary.totalCount}) نهائياً.</p>
                  )}
                </>
              )}
              {selectedMode === 'reset_demo_products' && confirmModalPreview.demoProductsSummary && (
                <>
                  <p>• سيتم حذف {selectedDemoIds.length} صنف تجريبي غير مرتبط بفواتير أو حركات مخزون.</p>
                  <p>• سيتم الإبقاء على {confirmModalPreview.demoProductsSummary.blockedLinked.length} صنف تجريبي مرتبط ببيانات تشغيلية، وحفظ جميع المنتجات الحقيقية بالكامل.</p>
                </>
              )}
              {selectedMode === 'reset_extras' && (
                <p>
                  • التنظيف المحدد: {[clearChat && 'شات الفريق', clearPdfImports && 'دفعات PDF', clearOpLogs && 'السجلات التشغيلية'].filter(Boolean).join('، ')}.
                </p>
              )}
              {selectedMode === 'remove_catalog' && confirmModalPreview.catalogRemovalSummary && (
                <>
                  <p>• سيتم حذف {confirmModalPreview.catalogRemovalSummary.deletableCount} صنف غير مرتبط بأي فاتورة أو حركة مخزون نهائياً.</p>
                  <p>• سيتم حماية {confirmModalPreview.catalogRemovalSummary.protectedCount} صنف مرتبط بسجلات تاريخية{archiveProtectedCatalog ? ' (مع أرشفتها تلقائياً)' : ''}.</p>
                </>
              )}
              {selectedMode === 'reset_groups' && confirmModalPreview.groupsSummary && (
                <p>
                  • المجموعات المحددة للتنظيف:{' '}
                  {GRANULAR_GROUP_META.filter((g) => selectedResetGroups.includes(g.key))
                    .map((g) => `${g.label} (${confirmModalPreview.groupsSummary?.[g.key] ?? 0})`)
                    .join('، ')}.
                </p>
              )}
              {selectedMode === 'reset_full' && (
                <p>• سيتم تنفيذ التصفير الكامل للبيانات التشغيلية مع حفظ نسخة احتياطية مرجعية وحساب المالك الرئيسي والتصنيفات.</p>
              )}
            </div>

            {confirmModalPreview.warnings.map((w, idx) => (
              <div
                key={idx}
                className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs font-bold text-amber-950"
              >
                ⚠ {w}
              </div>
            ))}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={executing}
                onClick={() => void handleConfirmExecuteReset()}
                className="flex-1 min-h-[48px] bg-red-700 hover:bg-red-800 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {executing ? (
                  <>
                    <RefreshCcw className="w-4 h-4 animate-spin" />
                    جاري التنفيذ...
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4" />
                    تأكيد وتنفيذ التصفير الآن
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={executing}
                onClick={() => setConfirmModalPreview(null)}
                className="min-h-[48px] px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                تراجع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
