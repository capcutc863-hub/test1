import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Layers,
  Award,
  FileUp,
  DatabaseBackup,
  Activity,
  Plus,
  Check,
  RefreshCcw,
  Lock,
  KeyRound,
  Download,
  AlertTriangle,
  Edit3,
  Settings,
  AlertOctagon,
  Users,
  Package,
  ShoppingCart,
} from 'lucide-react';
import {
  CommissionConfig,
  CommissionMode,
  Product,
  ProductCategory,
  SalesRep,
  SystemGeneralSettings,
  User,
} from '../types';
import {
  apiClient,
  ApiRequestError,
  getOwnerStepUpToken,
  type OwnerOverviewPayload,
} from '../src/lib/api';
import {
  PRODUCT_UNIT_OPTIONS,
  resolveCategoryDefaultCommissionRate,
} from '../src/lib/commission-utils';
import { OwnerBackupRestorePanel } from './OwnerBackupRestorePanel';
import { OwnerSystemResetPanel } from './OwnerSystemResetPanel';

interface OwnerConsoleTabProps {
  currentUser: User;
  products: Product[];
  categories: ProductCategory[];
  salesReps?: SalesRep[];
  commissionConfig: CommissionConfig;
  generalSettings: SystemGeneralSettings;
  onRefreshWorkspace: () => Promise<void> | void;
  onUpdateProduct: (product: Product) => Promise<void>;
  onOpenPdfImport: () => void;
  onNavigateTab?: (tab: 'admin-users' | 'inventory' | 'orders') => void;
}

type OwnerSubTab =
  | 'analytics'
  | 'categories'
  | 'commissions'
  | 'pdf'
  | 'security_backup'
  | 'system_reset'
  | 'settings'
  | 'audit';

export const OwnerConsoleTab: React.FC<OwnerConsoleTabProps> = ({
  currentUser,
  products,
  categories,
  salesReps = [],
  commissionConfig,
  generalSettings,
  onRefreshWorkspace,
  onUpdateProduct,
  onOpenPdfImport,
  onNavigateTab,
}) => {
  const [subTab, setSubTab] = useState<OwnerSubTab>('analytics');
  const [overview, setOverview] = useState<OwnerOverviewPayload | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Step-up authentication state
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [verifyingStepUp, setVerifyingStepUp] = useState(false);
  const [stepUpActive, setStepUpActive] = useState(Boolean(getOwnerStepUpToken()));

  // New category state
  const [newCatName, setNewCatName] = useState('');
  const [newCatSlug, setNewCatSlug] = useState('');
  const [newCatUnit, setNewCatUnit] = useState('قطعة');
  const [newCatEligible, setNewCatEligible] = useState(false);
  const [newCatRate, setNewCatRate] = useState<string>('0');
  const [catRateDrafts, setCatRateDrafts] = useState<Record<string, string>>({});
  const [savingCat, setSavingCat] = useState(false);

  // Commission global settings draft
  const [commDraft, setCommDraft] = useState<CommissionConfig>(commissionConfig);
  const [commReason, setCommReason] = useState('');
  const [savingComm, setSavingComm] = useState(false);

  // Sales Rep Per-Category Commission Matrix drafts
  const [repMatrixDraft, setRepMatrixDraft] = useState<Record<string, Record<string, string>>>({});
  const [repBaseRateDraft, setRepBaseRateDraft] = useState<Record<string, string>>({});
  const [repMatrixReason, setRepMatrixReason] = useState('');
  const [savingRepId, setSavingRepId] = useState<string | null>(null);

  // Per-product commission override drafts
  const [prodSearch, setProdSearch] = useState('');
  const [editingProdComm, setEditingProdComm] = useState<Product | null>(null);
  const [savingProdComm, setSavingProdComm] = useState(false);

  // General system settings draft
  const [genDraft, setGenDraft] = useState<SystemGeneralSettings>(generalSettings);
  const [savingGen, setSavingGen] = useState(false);

  // Recovery key state
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [savingRecoveryKey, setSavingRecoveryKey] = useState(false);

  // Audit log filter
  const [auditFilter, setAuditFilter] = useState<
    'all' | 'backup_restore' | 'reset' | 'commissions' | 'pdf' | 'security'
  >('all');
  const [auditSearch, setAuditSearch] = useState('');

  useEffect(() => {
    setCommDraft(commissionConfig);
  }, [commissionConfig]);

  useEffect(() => {
    setGenDraft(generalSettings);
  }, [generalSettings]);

  useEffect(() => {
    const nextCatRates: Record<string, string> = {};
    for (const c of categories) {
      const effective = resolveCategoryDefaultCommissionRate(c.id, c.name, commissionConfig, categories);
      nextCatRates[c.id] = Number((effective * 100).toFixed(2)).toString();
    }
    setCatRateDrafts(nextCatRates);
  }, [categories, commissionConfig]);

  useEffect(() => {
    const nextMatrix: Record<string, Record<string, string>> = {};
    const nextBase: Record<string, string> = {};
    for (const rep of salesReps) {
      nextBase[rep.id] = Number(((rep.customCommissionRate ?? 0) * 100).toFixed(2)).toString();
      const row: Record<string, string> = {};
      for (const cat of categories) {
        const val = rep.categoryRates?.[cat.id];
        row[cat.id] =
          typeof val === 'number' && Number.isFinite(val)
            ? Number((val * 100).toFixed(2)).toString()
            : '';
      }
      nextMatrix[rep.id] = row;
    }
    setRepMatrixDraft(nextMatrix);
    setRepBaseRateDraft(nextBase);
  }, [salesReps, categories]);

  const loadOverview = useCallback(async () => {
    if (currentUser.role !== 'owner') return;
    setLoadingOverview(true);
    try {
      const data = await apiClient.getOwnerOverview();
      setOverview(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحميل بيانات لوحة المالك.');
    } finally {
      setLoadingOverview(false);
    }
  }, [currentUser.role]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (currentUser.role !== 'owner') {
    return null;
  }

  const handleVerifyStepUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepUpPassword.trim()) return;
    setVerifyingStepUp(true);
    setErrorMsg(null);
    try {
      await apiClient.verifyOwnerIdentity(stepUpPassword);
      setStepUpActive(true);
      setStepUpPassword('');
      setStatusMsg('تم تأكيد هوية المالك الرئيسي لمدة 15 دقيقة لتنفيذ الإجراءات الحساسة ✅');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل التحقق من كلمة مرور المالك.');
    } finally {
      setVerifyingStepUp(false);
    }
  };

  const handleApiError = (err: unknown, fallback: string) => {
    if (err instanceof ApiRequestError && err.requiresOwnerReauth) {
      setStepUpActive(false);
      setSubTab('security_backup');
    }
    setErrorMsg(err instanceof Error ? err.message : fallback);
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setSavingCat(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const parsedRate = Math.max(0, Math.min(100, parseFloat(newCatRate) || 0)) / 100;
      await apiClient.createCategory({
        name: newCatName.trim(),
        slug: (newCatSlug.trim() || newCatName.trim()).toLowerCase().replace(/\s+/g, '-'),
        sortOrder: categories.length + 1,
        defaultUnit: newCatUnit,
        defaultCommissionEligible: newCatEligible || parsedRate > 0,
        defaultCommissionRate: parsedRate,
        isActive: true,
      });
      setNewCatName('');
      setNewCatSlug('');
      setNewCatRate('0');
      setStatusMsg('تم إنشاء التصنيف الجديد بنجاح ✅');
      await onRefreshWorkspace();
      await loadOverview();
    } catch (err) {
      handleApiError(err, 'تعذر إنشاء التصنيف.');
    } finally {
      setSavingCat(false);
    }
  };

  const handleToggleCategoryField = async (
    cat: ProductCategory,
    patch: Partial<ProductCategory>
  ) => {
    setErrorMsg(null);
    try {
      await apiClient.updateCategory({ ...cat, ...patch });
      setStatusMsg(`تم تحديث التصنيف "${cat.name}" ✅`);
      await onRefreshWorkspace();
      await loadOverview();
    } catch (err) {
      handleApiError(err, 'تعذر تحديث التصنيف.');
    }
  };

  const handleSaveRepMatrix = async (rep: SalesRep) => {
    setSavingRepId(rep.id);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const row = repMatrixDraft[rep.id] || {};
      const categoryRates: Record<string, number> = {};
      for (const cat of categories) {
        const raw = (row[cat.id] ?? '').trim();
        if (raw !== '') {
          const parsed = parseFloat(raw);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) {
            categoryRates[cat.id] = Math.round((parsed / 100) * 10000) / 10000;
          }
        }
      }
      const baseRaw = parseFloat(repBaseRateDraft[rep.id] ?? '');
      const customCommissionRate =
        !Number.isNaN(baseRaw) && baseRaw >= 0 && baseRaw <= 100
          ? Math.round((baseRaw / 100) * 10000) / 10000
          : rep.customCommissionRate;

      await apiClient.updateOwnerRepCommissions(rep.id, {
        categoryRates,
        customCommissionRate,
        reason: repMatrixReason.trim() || undefined,
      });
      setRepMatrixReason('');
      setStatusMsg(`تم حفظ نسب عمولات المندوب "${rep.name}" حسب التصنيف ✅`);
      await onRefreshWorkspace();
      await loadOverview();
    } catch (err) {
      handleApiError(err, 'تعذر حفظ نسب عمولات المندوب.');
    } finally {
      setSavingRepId(null);
    }
  };

  const handleSaveGlobalCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingComm(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiClient.updateCommissionSettings({
        ...commDraft,
        reason: commReason.trim() || undefined,
      });
      setCommReason('');
      setStatusMsg('تم حفظ قواعد العمولات الجديدة (تُطبق على الفواتير الجديدة فقط) ✅');
      await onRefreshWorkspace();
      await loadOverview();
    } catch (err) {
      handleApiError(err, 'تعذر حفظ قواعد العمولات.');
    } finally {
      setSavingComm(false);
    }
  };

  const handleSaveProductCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProdComm) return;
    setSavingProdComm(true);
    setErrorMsg(null);
    try {
      await onUpdateProduct(editingProdComm);
      setEditingProdComm(null);
      setStatusMsg('تم تحديث قاعدة عمولة الصنف بنجاح ✅');
      await loadOverview();
    } catch (err) {
      handleApiError(err, 'تعذر تحديث عمولة الصنف.');
    } finally {
      setSavingProdComm(false);
    }
  };

  const handleSaveGeneralSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGen(true);
    setErrorMsg(null);
    try {
      await apiClient.updateSystemGeneralSettings(genDraft);
      setStatusMsg('تم تحديث الإعدادات العامة للنظام ✅');
      await onRefreshWorkspace();
      await loadOverview();
    } catch (err) {
      handleApiError(err, 'تعذر حفظ الإعدادات العامة.');
    } finally {
      setSavingGen(false);
    }
  };

  const handleSetRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoveryKeyInput.trim().length < 8) {
      setErrorMsg('يجب أن يتكون رمز الاسترداد من 8 أحرف على الأقل.');
      return;
    }
    setSavingRecoveryKey(true);
    setErrorMsg(null);
    try {
      await apiClient.setOwnerRecoveryKey(recoveryKeyInput.trim());
      setRecoveryKeyInput('');
      setStatusMsg('تم تحديث رمز الاسترداد الاحتياطي بنجاح — احتفظ به في مكان آمن خارج النظام ✅');
    } catch (err) {
      handleApiError(err, 'تعذر تحديث رمز الاسترداد.');
    } finally {
      setSavingRecoveryKey(false);
    }
  };

  const refreshAllOwnerAndWorkspace = async () => {
    await onRefreshWorkspace();
    await loadOverview();
  };

  const analytics = overview?.commissionAnalytics;
  const sysCounts = overview?.systemCounts;
  const backupsList = overview?.backups || [];

  const filteredProductsForComm = products.filter((p) => {
    const q = prodSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      p.categoryName.toLowerCase().includes(q)
    );
  });

  const filteredAuditLogs = (overview?.auditLogs || []).filter((log) => {
    if (auditFilter === 'backup_restore') {
      if (!/backup|restore/i.test(log.actionType)) return false;
    } else if (auditFilter === 'reset') {
      if (!/reset/i.test(log.actionType)) return false;
    } else if (auditFilter === 'commissions') {
      if (!/commission|category/i.test(log.actionType)) return false;
    } else if (auditFilter === 'pdf') {
      if (!/price_list/i.test(log.actionType)) return false;
    } else if (auditFilter === 'security') {
      if (!/owner_|team|rep|settings/i.test(log.actionType)) return false;
    }
    const q = auditSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      log.actionType.toLowerCase().includes(q) ||
      log.actorName.toLowerCase().includes(q) ||
      JSON.stringify(log.details).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-300 font-cairo">
      {/* Executive Header */}
      <div className="bg-gradient-to-r from-[#072F5F] via-[#0A468C] to-[#072F5F] text-white rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 bg-amber-400/20 text-amber-200 border border-amber-300/30 px-3 py-1 rounded-xl text-xs font-black">
            <ShieldCheck className="w-4 h-4" />
            <span>صلاحية المالك الرئيسي (Super Admin / Owner)</span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-black">إدارة المالك الرئيسي والرقابة الكاملة</h3>
          <p className="text-xs sm:text-sm text-blue-100 font-bold">
            إدارة التصنيفات، قواعد العمولات، استيراد قوائم الأسعار PDF، النسخ الاحتياطي، وسجل التدقيق الشامل
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenPdfImport}
            className="min-h-[46px] px-5 py-2.5 bg-white text-[#072F5F] hover:bg-blue-50 rounded-2xl font-black text-xs sm:text-sm flex items-center gap-2 shadow-lg"
          >
            <FileUp className="w-4 h-4 text-[#0A468C]" />
            استيراد قائمة أسعار PDF
          </button>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="min-h-[46px] px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white rounded-2xl font-black text-xs flex items-center gap-1.5"
          >
            <RefreshCcw className={`w-4 h-4 ${loadingOverview ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      </div>

      {/* Step-up security status bar */}
      <div
        className={`rounded-2xl border p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
          stepUpActive
            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
            : 'bg-amber-50 border-amber-200 text-amber-950'
        }`}
      >
        <div className="flex items-center gap-2 font-black">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            {stepUpActive
              ? 'جلسة التحقق الثنائي للمالك مفعّلة (15 دقيقة) لتنفيذ التغييرات الحساسة والنسخ الاحتياطي'
              : 'للعمليات الحساسة (تغيير قواعد العمولات، اعتماد PDF، تصدير النسخة الاحتياطية): أكد كلمة مرور المالك'}
          </span>
        </div>
        {!stepUpActive && (
          <form onSubmit={(e) => void handleVerifyStepUp(e)} className="flex items-center gap-2">
            <input
              type="password"
              value={stepUpPassword}
              onChange={(e) => setStepUpPassword(e.target.value)}
              placeholder="كلمة مرور المالك..."
              className="min-h-[38px] px-3 py-1.5 bg-white border border-amber-300 rounded-xl font-bold text-xs text-slate-900"
            />
            <button
              type="submit"
              disabled={verifyingStepUp}
              className="min-h-[38px] px-4 py-1.5 bg-[#072F5F] text-white rounded-xl font-black text-xs shrink-0"
            >
              {verifyingStepUp ? 'جاري التحقق...' : 'تأكيد الهوية'}
            </button>
          </form>
        )}
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-3.5 text-xs font-black flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-3.5 text-xs font-black flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Sub-Tabs Navigation */}
      <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl border border-slate-200/80 shadow-sm">
        {(
          [
            ['analytics', 'نظرة عامة والعمولات', <Award className="w-4 h-4" />],
            ['categories', 'تصنيفات المنتجات', <Layers className="w-4 h-4" />],
            ['commissions', 'قواعد وسجلات العمولات', <Settings className="w-4 h-4" />],
            ['pdf', 'استيراد قوائم PDF', <FileUp className="w-4 h-4" />],
            ['security_backup', 'النسخ الاحتياطي والاستعادة', <DatabaseBackup className="w-4 h-4" />],
            ['system_reset', 'تصفير النظام', <AlertOctagon className="w-4 h-4" />],
            ['settings', 'الإعدادات والأمان', <KeyRound className="w-4 h-4" />],
            ['audit', 'سجل التدقيق الشامل', <Activity className="w-4 h-4" />],
          ] as [OwnerSubTab, string, React.ReactNode][]
        ).map(([id, label, icon]) => {
          const isResetTab = id === 'system_reset';
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                subTab === id
                  ? isResetTab
                    ? 'bg-red-700 text-white shadow-sm'
                    : 'bg-[#0A468C] text-white shadow-sm'
                  : isResetTab
                    ? 'text-red-700 bg-red-50/70 hover:bg-red-100 border border-red-200'
                    : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Analytics & System Overview Sub-Tab */}
      {subTab === 'analytics' && (
        <div className="space-y-5">
          {/* System Status & Operational Health Overview */}
          <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-black text-[#072F5F]">
                  الحالة العامة للنظام ومركز التحكم الموحّد
                </h4>
                <p className="text-xs font-bold text-slate-500">
                  ملخص فوري لحجم البيانات التشغيلية وحالة آخر نسخة احتياطية معتمدة
                </p>
              </div>
              <div
                className={`px-3.5 py-2 rounded-2xl text-xs font-black border ${
                  sysCounts?.lastVerifiedBackupAt
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                {sysCounts?.lastVerifiedBackupAt
                  ? `آخر نسخة موثقة: ${new Date(sysCounts.lastVerifiedBackupAt).toLocaleString('ar-EG')}`
                  : 'لم يتم إنشاء نسخة احتياطية مضغوطة موثقة بعد'}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-center">
              {[
                ['المستخدمون', sysCounts?.usersCount ?? '-'],
                ['المناديب', sysCounts?.salesRepsCount ?? salesReps.length],
                ['التصنيفات', sysCounts?.categoriesCount ?? categories.length],
                ['المنتجات', sysCounts?.productsCount ?? products.length],
                ['العملاء', sysCounts?.customersCount ?? '-'],
                ['الفواتير', sysCounts?.ordersCount ?? '-'],
                ['حركات المخزون', sysCounts?.stockMovementsCount ?? '-'],
                ['النسخ المحفوظة', sysCounts?.backupsCount ?? backupsList.length],
              ].map(([lbl, val]) => (
                <div key={String(lbl)} className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <p className="text-[11px] font-bold text-slate-500">{lbl}</p>
                  <p className="text-lg font-black text-[#072F5F] tabular-nums mt-0.5">{val}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {onNavigateTab && (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('admin-users')}
                    className="min-h-[40px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-black text-xs flex items-center gap-1.5"
                  >
                    <Users className="w-3.5 h-3.5 text-[#0A468C]" />
                    إدارة المستخدمين والصلاحيات
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('inventory')}
                    className="min-h-[40px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-black text-xs flex items-center gap-1.5"
                  >
                    <Package className="w-3.5 h-3.5 text-[#0A468C]" />
                    إدارة المنتجات والمخزون
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('orders')}
                    className="min-h-[40px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-black text-xs flex items-center gap-1.5"
                  >
                    <ShoppingCart className="w-3.5 h-3.5 text-[#0A468C]" />
                    سجل الفواتير
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSubTab('security_backup')}
                className="min-h-[40px] px-4 py-2 bg-blue-50 hover:bg-blue-100 text-[#072F5F] border border-blue-200 rounded-xl font-black text-xs flex items-center gap-1.5"
              >
                <DatabaseBackup className="w-3.5 h-3.5" />
                النسخ الاحتياطي والاستعادة
              </button>
              <button
                type="button"
                onClick={() => setSubTab('system_reset')}
                className="min-h-[40px] px-4 py-2 bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 rounded-xl font-black text-xs flex items-center gap-1.5"
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                تصفير النظام
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-1">
              <span className="text-xs font-bold text-slate-500">مبيعات الأصناف الخاضعة للعمولة (المسلمة)</span>
              <p className="text-2xl font-black text-[#072F5F] tabular-nums">
                {(analytics?.commissionableDeliveredSales ?? 0).toLocaleString()} ج.م
              </p>
              <p className="text-[11px] font-bold text-slate-500 tabular-nums">
                معلقة بالتشغيل: {(analytics?.commissionablePendingSales ?? 0).toLocaleString()} ج.م
              </p>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-1">
              <span className="text-xs font-bold text-slate-500">مبيعات الأصناف غير الخاضعة للعمولة (المسلمة)</span>
              <p className="text-2xl font-black text-slate-900 tabular-nums">
                {(analytics?.nonCommissionableDeliveredSales ?? 0).toLocaleString()} ج.م
              </p>
              <p className="text-[11px] font-bold text-slate-500 tabular-nums">
                معلقة بالتشغيل: {(analytics?.nonCommissionablePendingSales ?? 0).toLocaleString()} ج.م
              </p>
            </div>

            <div className="bg-blue-50 p-5 rounded-3xl border border-blue-200 shadow-sm space-y-1">
              <span className="text-xs font-bold text-[#0A468C]">إجمالي العمولات المستحقة / المعلقة</span>
              <p className="text-2xl font-black text-[#072F5F] tabular-nums">
                {(analytics?.earnedCommissionTotal ?? 0).toLocaleString()} ج.م
              </p>
              <p className="text-[11px] font-bold text-[#0A468C] tabular-nums">
                عمولات معلقة حتى التسليم: {(analytics?.pendingCommissionTotal ?? 0).toLocaleString()} ج.م
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. Categories Sub-Tab */}
      {subTab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <form
            onSubmit={(e) => void handleCreateCategory(e)}
            className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 h-fit"
          >
            <h4 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#0A468C]" />
              إضافة تصنيف منتجات جديد
            </h4>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم التصنيف *</label>
              <input
                type="text"
                required
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="مثال: عبوات فاخرة / بوكسات هدايا"
                className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الوحدة الافتراضية</label>
                <select
                  value={newCatUnit}
                  onChange={(e) => setNewCatUnit(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
                >
                  {PRODUCT_UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المعرّف (Slug)</label>
                <input
                  type="text"
                  value={newCatSlug}
                  onChange={(e) => setNewCatSlug(e.target.value)}
                  placeholder="اختياري"
                  className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نسبة العمولة الافتراضية (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={newCatRate}
                  onChange={(e) => {
                    setNewCatRate(e.target.value);
                    if ((parseFloat(e.target.value) || 0) > 0) setNewCatEligible(true);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                />
              </div>
              <div className="flex items-end">
                <label className="w-full min-h-[44px] flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl cursor-pointer text-xs font-bold border border-slate-200">
                  <input
                    type="checkbox"
                    checked={newCatEligible}
                    onChange={(e) => setNewCatEligible(e.target.checked)}
                    className="w-4 h-4 accent-[#0A468C]"
                  />
                  <span>خاضع للعمولة افتراضياً</span>
                </label>
              </div>
            </div>
            <button
              type="submit"
              disabled={savingCat}
              className="w-full min-h-[46px] bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm"
            >
              {savingCat ? 'جاري الإضافة...' : 'إضافة التصنيف'}
            </button>
          </form>

          <div className="lg:col-span-2 bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-3">
            <h4 className="text-base font-black text-slate-900">
              التصنيفات المعتمدة ونسب عمولاتها الافتراضية ({categories.length})
            </h4>
            <div className="space-y-2.5">
              {categories.map((cat) => {
                const effRate = resolveCategoryDefaultCommissionRate(
                  cat.id,
                  cat.name,
                  commissionConfig,
                  categories
                );
                return (
                  <div
                    key={cat.id}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-slate-900 text-sm">{cat.name}</span>
                        <span className="px-2 py-0.5 rounded-lg bg-blue-100 text-[#072F5F] font-bold">
                          الوحدة: {cat.defaultUnit}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-lg font-black tabular-nums ${
                            effRate > 0
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          العمولة الافتراضية: {(effRate * 100).toFixed(1).replace(/\.0$/, '')}%
                        </span>
                      </div>
                      {cat.description && (
                        <p className="text-slate-500 font-bold">{cat.description}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          aria-label={`نسبة عمولة ${cat.name}`}
                          value={catRateDrafts[cat.id] ?? '0'}
                          onChange={(e) =>
                            setCatRateDrafts((prev) => ({ ...prev, [cat.id]: e.target.value }))
                          }
                          className="w-16 text-center font-black text-xs outline-none tabular-nums"
                        />
                        <span className="text-[11px] font-bold text-slate-500">%</span>
                        <button
                          type="button"
                          onClick={() => {
                            const pct = Math.max(
                              0,
                              Math.min(100, parseFloat(catRateDrafts[cat.id] ?? '0') || 0)
                            );
                            const rateVal = Math.round((pct / 100) * 10000) / 10000;
                            void handleToggleCategoryField(cat, {
                              defaultCommissionRate: rateVal,
                              defaultCommissionEligible: rateVal > 0,
                            });
                          }}
                          className="px-2.5 py-1 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-lg font-black text-[11px]"
                        >
                          حفظ النسبة
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void handleToggleCategoryField(cat, { isActive: !cat.isActive })
                        }
                        className={`min-h-[36px] px-3 py-1.5 rounded-xl font-black ${
                          cat.isActive
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                      >
                        {cat.isActive ? 'نشط' : 'موقوف'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3. Commission Rules & Per-Product Overrides */}
      {subTab === 'commissions' && (
        <div className="space-y-5">
          <form
            onSubmit={(e) => void handleSaveGlobalCommission(e)}
            className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-base font-black text-[#072F5F]">
                القواعد العامة للعمولات (تُحفظ كلقطة تاريخية على الفواتير الجديدة فقط)
              </h4>
              <span className="text-[11px] font-bold text-slate-500">
                لا تتأثر الفواتير المحفوظة أو المسلمة سابقاً بأي تعديل هنا
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  نسبة العمولة الافتراضية للزيوت العطرية (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={Number((commDraft.defaultOilCommissionRate * 100).toFixed(2))}
                  onChange={(e) =>
                    setCommDraft({
                      ...commDraft,
                      defaultOilCommissionRate: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
                    })
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                />
              </div>

              <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-2xl border border-slate-200 cursor-pointer text-xs font-bold">
                <input
                  type="checkbox"
                  checked={commDraft.useSalesRepCustomRateWhenInherited}
                  onChange={(e) =>
                    setCommDraft({
                      ...commDraft,
                      useSalesRepCustomRateWhenInherited: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-[#0A468C]"
                />
                <span>استخدام نسبة مندوب السيلز الخاصة للأصناف التي ترث نسبة السيلز</span>
              </label>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">سبب التعديل (اختياري)</label>
                <input
                  type="text"
                  value={commReason}
                  onChange={(e) => setCommReason(e.target.value)}
                  placeholder="مثال: خطة تحفيز الربع الجديد"
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-bold">
              {(
                [
                  ['packagingDefaultEligible', 'الفوارغ والعبوات خاضعة للعمولة افتراضياً'],
                  ['alcoholDefaultEligible', 'الكحول خاضع للعمولة افتراضياً'],
                  ['chemicalsDefaultEligible', 'الكيماويات خاضعة للعمولة افتراضياً'],
                  ['otherDefaultEligible', 'المستلزمات الأخرى خاضعة للعمولة افتراضياً'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(commDraft[key])}
                    onChange={(e) => setCommDraft({ ...commDraft, [key]: e.target.checked })}
                    className="w-4 h-4 accent-[#0A468C] shrink-0"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <button
              type="submit"
              disabled={savingComm}
              className="min-h-[46px] px-6 py-2.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm"
            >
              {savingComm ? 'جاري الحفظ...' : 'حفظ القواعد العامة للعمولات'}
            </button>
          </form>

          {/* Sales Rep Per-Category Commission Matrix */}
          <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-black text-[#072F5F]">
                  مصفوفة نسب عمولات المناديب حسب كل تصنيف ({salesReps.length})
                </h4>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  اترك الخانة فارغة لوراثة النسبة الافتراضية للتصنيف، أو أدخل 0 لمنع العمولة لهذا المندوب في هذا التصنيف
                </p>
              </div>
              <input
                type="text"
                value={repMatrixReason}
                onChange={(e) => setRepMatrixReason(e.target.value)}
                placeholder="سبب التعديل في سجل التدقيق (اختياري)..."
                className="min-h-[40px] px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs w-full sm:w-72"
              />
            </div>

            {salesReps.length === 0 ? (
              <p className="text-xs font-bold text-slate-500">لا يوجد مناديب مبيعات مسجلون بعد.</p>
            ) : (
              <div className="space-y-3">
                {salesReps.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-black text-sm text-slate-900">{rep.name}</span>
                        <span className="mr-2 text-[11px] font-bold text-slate-500 tabular-nums">
                          (المحققة: {rep.totalCommission.toLocaleString()} ج.م · المعلقة: {rep.pendingCommission.toLocaleString()} ج.م)
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={savingRepId === rep.id}
                        onClick={() => void handleSaveRepMatrix(rep)}
                        className="min-h-[38px] px-4 py-1.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl font-black text-xs disabled:opacity-50"
                      >
                        {savingRepId === rep.id ? 'جاري الحفظ...' : 'حفظ نسب المندوب'}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 mb-1">
                          الأساسية للزيوت (%)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={repBaseRateDraft[rep.id] ?? ''}
                          onChange={(e) =>
                            setRepBaseRateDraft((prev) => ({ ...prev, [rep.id]: e.target.value }))
                          }
                          className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                        />
                      </div>

                      {categories.map((cat) => {
                        const catDefPct = Number(
                          (
                            resolveCategoryDefaultCommissionRate(
                              cat.id,
                              cat.name,
                              commissionConfig,
                              categories
                            ) * 100
                          ).toFixed(1)
                        ).toString();
                        return (
                          <div key={cat.id}>
                            <label className="block text-[10px] font-bold text-slate-600 mb-1 truncate">
                              {cat.name} (%)
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              placeholder={`افتراضي ${catDefPct}%`}
                              value={repMatrixDraft[rep.id]?.[cat.id] ?? ''}
                              onChange={(e) =>
                                setRepMatrixDraft((prev) => ({
                                  ...prev,
                                  [rep.id]: {
                                    ...(prev[rep.id] || {}),
                                    [cat.id]: e.target.value,
                                  },
                                }))
                              }
                              className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-product commission overrides */}
          <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h4 className="text-base font-black text-slate-900">
                تخصيص استحقاق العمولة لكل منتج ({products.length})
              </h4>
              <input
                type="text"
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                placeholder="بحث بالكود أو الاسم أو التصنيف..."
                className="min-h-[42px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs w-full sm:w-72"
              />
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredProductsForComm.map((p) => (
                <div
                  key={p.id}
                  className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span dir="ltr" className="px-2 py-0.5 rounded bg-white border border-slate-200 font-black tabular-nums">
                        {p.code || `OIL-${p.id}`}
                      </span>
                      <span className="font-black text-slate-900">{p.name}</span>
                      <span className="px-2 py-0.5 rounded bg-blue-100 text-[#072F5F] font-bold">
                        {p.categoryName}
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-600">
                      {p.isCommissionEligible
                        ? p.commissionMode === 'fixed_rate'
                          ? `خاضع بنسبة مخصصة (${((p.customCommissionRate || 0) * 100).toFixed(1)}%)`
                          : p.commissionMode === 'fixed_per_unit'
                            ? `خاضع بمبلغ ثابت (${p.customCommissionFixed || 0} ج.م / ${p.unit})`
                            : 'خاضع — يرث نسبة مندوب السيلز'
                        : 'بدون عمولة'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditingProdComm({ ...p })}
                    className="min-h-[36px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-[#0A468C] hover:text-white rounded-xl font-black text-xs flex items-center gap-1.5 shrink-0"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    تعديل قاعدة الصنف
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Commission Setting Logs */}
          {overview && overview.commissionLogs.length > 0 && (
            <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <h4 className="text-base font-black text-slate-900">سجل تغييرات إعدادات العمولات</h4>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {overview.commissionLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="space-y-1 min-w-0">
                      <p className="font-black text-[#072F5F]">
                        {log.targetName} ({log.targetType})
                      </p>
                      <p className="font-bold text-slate-600">
                        بواسطة: {log.actorName} {log.reason ? `· السبب: ${log.reason}` : ''}
                      </p>
                      <p dir="ltr" className="text-[10px] font-bold text-slate-500 truncate">
                        {JSON.stringify(log.previousValue)} → {JSON.stringify(log.newValue)}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">
                      {new Date(log.createdAt).toLocaleString('ar-EG')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. PDF Imports Summary Sub-Tab */}
      {subTab === 'pdf' && (
        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-black text-slate-900">استيراد وأرشيف قوائم الأسعار PDF</h4>
              <p className="text-xs font-bold text-slate-500">
                متاح حصرياً للمالك الرئيسي — يتم أرشفة الملف الأصلي دون المساس بالمخزون
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenPdfImport}
              className="min-h-[44px] px-5 py-2.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-xs flex items-center gap-2"
            >
              <FileUp className="w-4 h-4" />
              فتح نافذة الاستيراد والمراجعة
            </button>
          </div>

          <div className="space-y-2">
            {(overview?.priceListImports || []).map((imp) => (
              <div
                key={imp.id}
                className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <p className="font-black text-slate-900">
                    {imp.fileName} — {imp.status === 'approved' ? 'معتمد' : imp.status === 'cancelled' ? 'ملغي' : 'بانتظار المراجعة'}
                  </p>
                  <p className="text-[11px] font-bold text-slate-500 tabular-nums">
                    {new Date(imp.uploadedAt).toLocaleString('ar-EG')} · أصناف: {imp.totalParsed}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void apiClient.downloadPriceListOriginalFile(imp.id, imp.fileName)}
                  className="min-h-[36px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl font-black text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  تحميل PDF الأصلي
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Backup & Restore Center */}
      {subTab === 'security_backup' && (
        <OwnerBackupRestorePanel
          backups={backupsList}
          stepUpActive={stepUpActive}
          onRequireStepUp={() => setStepUpActive(false)}
          onRefreshAll={refreshAllOwnerAndWorkspace}
          onError={setErrorMsg}
          onSuccess={setStatusMsg}
        />
      )}

      {/* 6. System Reset Zone (Visually Separated High-Risk Zone) */}
      {subTab === 'system_reset' && (
        <OwnerSystemResetPanel
          backups={backupsList}
          systemCounts={sysCounts}
          stepUpActive={stepUpActive}
          onRequireStepUp={() => setStepUpActive(false)}
          onRefreshAll={refreshAllOwnerAndWorkspace}
          onError={setErrorMsg}
          onSuccess={setStatusMsg}
        />
      )}

      {/* 7. General Settings & Owner Recovery Key */}
      {subTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* General Settings */}
          <form
            onSubmit={(e) => void handleSaveGeneralSettings(e)}
            className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4"
          >
            <h4 className="text-base font-black text-slate-900">الإعدادات العامة للنظام والمخزون</h4>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم الشركة</label>
              <input
                type="text"
                value={genDraft.companyName}
                onChange={(e) => setGenDraft({ ...genDraft, companyName: e.target.value })}
                className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الشحن الافتراضي (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  value={genDraft.defaultShippingCost}
                  onChange={(e) =>
                    setGenDraft({ ...genDraft, defaultShippingCost: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تنبيه مخزون الزيوت (mg)</label>
                <input
                  type="number"
                  min="0"
                  value={genDraft.lowStockThresholdOils}
                  onChange={(e) =>
                    setGenDraft({ ...genDraft, lowStockThresholdOils: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تنبيه مخزون التصنيفات الأخرى</label>
                <input
                  type="number"
                  min="0"
                  value={genDraft.lowStockThresholdOther}
                  onChange={(e) =>
                    setGenDraft({ ...genDraft, lowStockThresholdOther: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                />
              </div>
            </div>
            <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl cursor-pointer text-xs font-bold">
              <input
                type="checkbox"
                checked={genDraft.allowCustomItemsInInvoices}
                onChange={(e) =>
                  setGenDraft({ ...genDraft, allowCustomItemsInInvoices: e.target.checked })
                }
                className="w-4 h-4 accent-[#0A468C]"
              />
              <span>السماح بإضافة أصناف جديدة/مخصوصة داخل الفاتورة</span>
            </label>
            <button
              type="submit"
              disabled={savingGen}
              className="w-full min-h-[46px] bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm"
            >
              {savingGen ? 'جاري الحفظ...' : 'حفظ الإعدادات العامة'}
            </button>
          </form>

          {/* Recovery Key */}
          <form
            onSubmit={(e) => void handleSetRecoveryKey(e)}
            className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-3.5 h-fit"
          >
            <h4 className="text-base font-black text-slate-900 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#0A468C]" />
              تعيين أو تدوير رمز الاسترداد الاحتياطي للمالك
            </h4>
            <p className="text-xs font-bold text-slate-500">
              يُستخدم رمز الاسترداد فقط عند فقدان كلمة مرور المالك الرئيسي — احتفظ به في مكان آمن خارج الجهاز. يتم استبعاده من جميع ملفات النسخ الاحتياطي للحماية.
            </p>
            <input
              type="password"
              value={recoveryKeyInput}
              onChange={(e) => setRecoveryKeyInput(e.target.value)}
              placeholder="أدخل رمز استرداد قوي (8 أحرف على الأقل)..."
              className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
            />
            <button
              type="submit"
              disabled={savingRecoveryKey}
              className="w-full min-h-[46px] bg-[#072F5F] hover:bg-[#0A468C] text-white rounded-2xl font-black text-sm"
            >
              {savingRecoveryKey ? 'جاري التحديث...' : 'حفظ رمز الاسترداد المشفّر'}
            </button>
          </form>
        </div>
      )}

      {/* 8. Comprehensive Filterable Admin Audit Logs */}
      {subTab === 'audit' && (
        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-black text-slate-900">
                سجل التدقيق الإداري والأمني ({filteredAuditLogs.length} / {overview?.auditLogs.length ?? 0})
              </h4>
              <p className="text-[11px] font-bold text-slate-500">
                توثيق فوري لعمليات النسخ الاحتياطي، الفحص، الاستعادة، التصفير، العمولات، وأمان المالك
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="بحث بالحدث أو المنفذ..."
                className="min-h-[38px] px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs w-56"
              />
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(filteredAuditLogs, null, 2)], {
                    type: 'application/json',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `KimaScent-AuditLog-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                className="min-h-[38px] px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-black text-xs flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                تصدير السجل
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'الكل'],
                ['backup_restore', 'النسخ والاستعادة'],
                ['reset', 'تصفير النظام'],
                ['commissions', 'العمولات والتصنيفات'],
                ['pdf', 'قوائم PDF'],
                ['security', 'الأمان والإعدادات'],
              ] as const
            ).map(([fid, label]) => (
              <button
                key={fid}
                type="button"
                onClick={() => setAuditFilter(fid)}
                className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-black ${
                  auditFilter === fid
                    ? 'bg-[#072F5F] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredAuditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded font-black ${
                        /reset/i.test(log.actionType)
                          ? 'bg-red-100 text-red-900'
                          : /backup|restore/i.test(log.actionType)
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-blue-100 text-[#072F5F]'
                      }`}
                    >
                      {log.actionType}
                    </span>
                    <span className="font-black text-slate-900">{log.actorName}</span>
                    <span className="text-[11px] font-bold text-slate-500">({log.actorRole})</span>
                    {log.orderId && (
                      <span dir="ltr" className="text-[11px] font-black text-[#0A468C] tabular-nums">
                        #{log.orderId}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-slate-600 truncate">
                    {JSON.stringify(log.details)}
                  </p>
                </div>
                <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">
                  {new Date(log.createdAt).toLocaleString('ar-EG')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Product Commission Override Modal */}
      {editingProdComm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750]">
          <form
            onSubmit={(e) => void handleSaveProductCommission(e)}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-[2rem] p-6 pb-safe shadow-2xl space-y-4"
          >
            <h3 className="text-lg font-black text-[#072F5F]">
              قاعدة عمولة الصنف: {editingProdComm.name}
            </h3>
            <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl cursor-pointer text-xs font-bold">
              <input
                type="checkbox"
                checked={editingProdComm.isCommissionEligible}
                onChange={(e) =>
                  setEditingProdComm({
                    ...editingProdComm,
                    isCommissionEligible: e.target.checked,
                    commissionMode: e.target.checked
                      ? editingProdComm.commissionMode === 'none'
                        ? 'inherit_rep'
                        : editingProdComm.commissionMode
                      : 'none',
                  })
                }
                className="w-4 h-4 accent-[#0A468C]"
              />
              <span>هذا الصنف خاضع للعمولة</span>
            </label>

            {editingProdComm.isCommissionEligible && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نمط حساب العمولة</label>
                  <select
                    value={editingProdComm.commissionMode}
                    onChange={(e) =>
                      setEditingProdComm({
                        ...editingProdComm,
                        commissionMode: e.target.value as CommissionMode,
                      })
                    }
                    className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm"
                  >
                    <option value="inherit_rep">يرث نسبة مندوب السيلز</option>
                    <option value="fixed_rate">نسبة مئوية مخصصة للصنف (%)</option>
                    <option value="fixed_per_unit">مبلغ ثابت لكل وحدة</option>
                  </select>
                </div>

                {editingProdComm.commissionMode === 'fixed_rate' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">النسبة المخصصة (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={Number(((editingProdComm.customCommissionRate || 0) * 100).toFixed(2))}
                      onChange={(e) =>
                        setEditingProdComm({
                          ...editingProdComm,
                          customCommissionRate: (parseFloat(e.target.value) || 0) / 100,
                        })
                      }
                      className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                    />
                  </div>
                )}

                {editingProdComm.commissionMode === 'fixed_per_unit' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      المبلغ الثابت لكل ({editingProdComm.unit}) بالجنيه
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={editingProdComm.customCommissionFixed ?? 0}
                      onChange={(e) =>
                        setEditingProdComm({
                          ...editingProdComm,
                          customCommissionFixed: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full min-h-[44px] px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 font-black text-sm tabular-nums"
                    />
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                type="submit"
                disabled={savingProdComm}
                className="flex-1 min-h-[46px] bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm"
              >
                {savingProdComm ? 'جاري الحفظ...' : 'حفظ قاعدة الصنف'}
              </button>
              <button
                type="button"
                onClick={() => setEditingProdComm(null)}
                className="min-h-[46px] px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
