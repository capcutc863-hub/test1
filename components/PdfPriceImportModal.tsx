import React, { useEffect, useMemo, useState } from 'react';
import {
  FileUp,
  X,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCcw,
  FileText,
  Lock,
  ShieldCheck,
  XCircle,
  Trash2,
  Plus,
  Layers,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  OilGradeRecord,
  PriceListColumnMapping,
  PriceListColumnRole,
  PriceListImportRecord,
  PriceListParsedItem,
  PriceListSinglePriceMeaning,
  ProductCategory,
} from '../types';
import { PRODUCT_UNIT_OPTIONS } from '../src/lib/commission-utils';
import { apiClient, ApiRequestError, getOwnerStepUpToken } from '../src/lib/api';

interface PdfPriceImportModalProps {
  categories: ProductCategory[];
  initialImport?: PriceListImportRecord | null;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

const DEFAULT_FALLBACK_GRADES: OilGradeRecord[] = [
  { id: 'grade-high', name: 'عالي', slug: 'high', sortOrder: 1, isActive: true, aliases: [] },
  { id: 'grade-medium', name: 'وسط', slug: 'medium', sortOrder: 2, isActive: true, aliases: [] },
  { id: 'grade-commercial', name: 'تجاري', slug: 'commercial', sortOrder: 3, isActive: true, aliases: [] },
];

type ReviewFilterMode = 'all' | 'needs_review' | 'new' | 'matched' | 'unavailable';

export const PdfPriceImportModal: React.FC<PdfPriceImportModalProps> = ({
  categories,
  initialImport = null,
  onClose,
  onImported,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [listCategoryId, setListCategoryId] = useState<string>(
    initialImport?.listCategoryId || ''
  );
  const [uploadOilUnit, setUploadOilUnit] = useState<'auto' | 'كيلوجرام' | 'جرام'>('auto');

  const [oilGrades, setOilGrades] = useState<OilGradeRecord[]>(DEFAULT_FALLBACK_GRADES);
  const [showGradesManager, setShowGradesManager] = useState(false);
  const [newGradeName, setNewGradeName] = useState('');
  const [newGradeAliases, setNewGradeAliases] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  const [activeBatch, setActiveBatch] = useState<PriceListImportRecord | null>(initialImport);
  const [editableItems, setEditableItems] = useState<PriceListParsedItem[]>(
    initialImport ? initialImport.parsedItems.map((it) => ({ ...it })) : []
  );
  const [importsHistory, setImportsHistory] = useState<PriceListImportRecord[]>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [pendingDeleteBatches, setPendingDeleteBatches] = useState<PriceListImportRecord[] | null>(
    null
  );
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('');
  const [deleteNeedsPassword, setDeleteNeedsPassword] = useState(false);
  const [isDeletingArchive, setIsDeletingArchive] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isRemapping, setIsRemapping] = useState(false);
  const [showColumnMapper, setShowColumnMapper] = useState(false);
  const [remapCategoryId, setRemapCategoryId] = useState<string>(
    initialImport?.listCategoryId || categories[0]?.id || 'cat-oils'
  );
  const [mappingDraft, setMappingDraft] = useState<PriceListColumnMapping>(
    initialImport?.columnMapping || {
      hasHeaderRow: true,
      columns: {},
      oilSourceUnit: 'auto',
    }
  );
  const [isApproving, setIsApproving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [needsPasswordPrompt, setNeedsPasswordPrompt] = useState(false);

  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilterMode>('all');

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const list = await apiClient.getPriceListImports();
      setImportsHistory(list);
      setSelectedHistoryIds((prev) => prev.filter((id) => list.some((b) => b.id === id)));
    } catch {
      // keep upload view usable
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadOilGrades = async () => {
    try {
      const list = await apiClient.getOilGrades();
      if (Array.isArray(list) && list.length > 0) {
        setOilGrades(list);
      }
    } catch {
      // keep default fallback grades
    }
  };

  useEffect(() => {
    void loadHistory();
    void loadOilGrades();
  }, []);

  const openBatchForReview = (batch: PriceListImportRecord) => {
    setActiveBatch(batch);
    setEditableItems(batch.parsedItems.map((it) => ({ ...it })));
    setRemapCategoryId(batch.listCategoryId || categories[0]?.id || 'cat-oils');
    setMappingDraft(
      batch.columnMapping || {
        hasHeaderRow: true,
        columns: {},
        oilSourceUnit: 'auto',
      }
    );
    setShowColumnMapper(false);
    setReviewSearch('');
    setReviewFilter('all');
    setErrorMsg(batch.errorMessage || null);
    setSuccessMsg(null);
  };

  const handleAddOilGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGradeName.trim()) return;
    setSavingGrade(true);
    setErrorMsg(null);
    try {
      const aliases = newGradeAliases
        .split(/[،,]/)
        .map((a) => a.trim())
        .filter(Boolean);
      const created = await apiClient.createOilGrade({
        name: newGradeName.trim(),
        aliases,
        isActive: true,
      });
      setOilGrades((prev) => [...prev, created]);
      setNewGradeName('');
      setNewGradeAliases('');
      setSuccessMsg(`تمت إضافة درجة الزيت "${created.name}" بنجاح ويمكن استيراد قوائم بها فوراً.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إضافة درجة الزيت.');
    } finally {
      setSavingGrade(false);
    }
  };

  const handleToggleGradeActive = async (g: OilGradeRecord) => {
    try {
      const updated = await apiClient.updateOilGrade({ id: g.id, isActive: !g.isActive });
      setOilGrades((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث حالة الدرجة.');
    }
  };

  const handleUploadPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listCategoryId) {
      setErrorMsg('يرجى تحديد تصنيف قائمة الأسعار (زيوت عطرية / عبوات / كحول...) قبل الرفع والتحليل.');
      return;
    }
    if (!selectedFile) {
      setErrorMsg('يرجى اختيار ملف PDF لقائمة الأسعار أولاً.');
      return;
    }
    setIsUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const isOilCat = listCategoryId === 'cat-oils';
      const initialColumnMapping: PriceListColumnMapping | null =
        isOilCat && uploadOilUnit !== 'auto'
          ? {
              hasHeaderRow: true,
              columns: {},
              oilSourceUnit: uploadOilUnit,
              sourceUnit: uploadOilUnit,
              targetUnit: 'جرام',
              unitConfirmedByUser: true,
            }
          : null;
      const record = await apiClient.importPriceListPdf(selectedFile, {
        listCategoryId,
        columnMapping: initialColumnMapping,
      });
      openBatchForReview(record);
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحليل ملف PDF.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemapBatch = async (overrideMapping?: PriceListColumnMapping) => {
    if (!activeBatch) return;
    setIsRemapping(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const updated = await apiClient.remapPriceListImport(activeBatch.id, {
        listCategoryId: remapCategoryId || activeBatch.listCategoryId || undefined,
        columnMapping: overrideMapping || mappingDraft,
      });
      openBatchForReview(updated);
      setSuccessMsg('تمت إعادة تحليل القائمة وتحديث الأسعار والدرجات بنجاح.');
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إعادة استخراج وتطبيق التعيين.');
    } finally {
      setIsRemapping(false);
    }
  };

  const handleQuickConfirmOilUnit = async (unitChoice: 'كيلوجرام' | 'جرام') => {
    if (!activeBatch) return;
    const baseMapping: PriceListColumnMapping = activeBatch.columnMapping || {
      hasHeaderRow: true,
      columns: {},
    };
    const nextMapping: PriceListColumnMapping = {
      ...baseMapping,
      oilSourceUnit: unitChoice,
      sourceUnit: unitChoice,
      targetUnit: 'جرام',
      unitConfirmedByUser: true,
      conversionFactor: unitChoice === 'كيلوجرام' ? 0.001 : 1,
    };
    setMappingDraft(nextMapping);
    await handleRemapBatch(nextMapping);
  };

  const updateRow = (rowKey: string, updater: (prev: PriceListParsedItem) => PriceListParsedItem) => {
    setEditableItems((prev) => prev.map((it) => (it.rowKey === rowKey ? updater(it) : it)));
  };

  const handleSinglePriceMeaningChange = (
    rowKey: string,
    meaning: PriceListSinglePriceMeaning
  ) => {
    updateRow(rowKey, (it) => {
      const val = it.ambiguousSinglePrice;
      let nextSelling = it.sellingPrice;
      let nextCost = it.costPrice;
      if (val !== null) {
        if (meaning === 'selling') {
          nextSelling = val;
          if (nextCost === val) nextCost = it.matchedProductCurrent?.costPrice ?? null;
        } else if (meaning === 'cost') {
          nextCost = val;
          if (nextSelling === val) nextSelling = it.matchedProductCurrent?.pricePerMg ?? null;
        }
      }
      return {
        ...it,
        singlePriceMeaning: meaning,
        sellingPrice: nextSelling,
        costPrice: nextCost,
        needsReview: meaning === 'unresolved' || it.warnings.length > 0,
      };
    });
  };

  const selectedCount = editableItems.filter((i) => i.selectedForImport).length;
  const unresolvedSelectedCount = editableItems.filter(
    (i) =>
      i.selectedForImport &&
      i.ambiguousSinglePrice !== null &&
      i.singlePriceMeaning === 'unresolved'
  ).length;

  const isOilBatch =
    activeBatch?.listCategoryId === 'cat-oils' ||
    editableItems.some((i) => i.suggestedCategoryId === 'cat-oils');
  const unitConfig = activeBatch?.importConfig?.unitConfig ?? null;
  const counts = activeBatch?.importConfig?.counts ?? null;
  const isLegacyBatchExtract = Boolean(
    activeBatch &&
      activeBatch.status === 'pending_review' &&
      (!activeBatch.importConfig ||
        (activeBatch.rawTableRows || []).every((r) => !Array.isArray(r) || r.length <= 1))
  );
  const needsOilUnitConfirmation = Boolean(
    isOilBatch &&
      editableItems.some(
        (i) =>
          i.selectedForImport &&
          i.suggestedCategoryId === 'cat-oils' &&
          !unitConfig?.confirmedByUser &&
          !i.originalPriceUnit
      )
  );

  const uniqueBaseCount = useMemo(() => {
    const keys = new Set(
      editableItems.map((i) => (i.baseProductKey || i.baseProductName || i.name).trim())
    );
    return counts?.uniqueProductsCount ?? keys.size;
  }, [editableItems, counts]);

  const unavailableCount = useMemo(
    () => counts?.unavailableVariantsCount ?? editableItems.filter((i) => i.isAvailable === false).length,
    [editableItems, counts]
  );

  const unconfirmedCostCount = useMemo(
    () =>
      counts?.unconfirmedCostsCount ??
      editableItems.filter((i) => i.isAvailable !== false && i.costPrice === null).length,
    [editableItems, counts]
  );

  const filteredItems = useMemo(() => {
    const q = reviewSearch.trim().toLowerCase();
    return editableItems.filter((item) => {
      if (reviewFilter === 'needs_review' && !item.needsReview) return false;
      if (reviewFilter === 'new' && item.matchStatus !== 'new') return false;
      if (reviewFilter === 'matched' && item.matchStatus !== 'matched') return false;
      if (reviewFilter === 'unavailable' && item.isAvailable !== false) return false;
      if (!q) return true;
      return (
        (item.baseProductName || item.name).toLowerCase().includes(q) ||
        (item.code || '').toLowerCase().includes(q) ||
        (item.grade || '').toLowerCase().includes(q)
      );
    });
  }, [editableItems, reviewSearch, reviewFilter]);

  const groupedProducts = useMemo(() => {
    const groups: Array<{
      groupKey: string;
      serialNumber: number | null;
      baseProductName: string;
      items: PriceListParsedItem[];
    }> = [];
    const byKey = new Map<string, number>();

    for (const item of filteredItems) {
      const baseName = (item.baseProductName || item.name || item.code || 'غير مسمى').trim();
      const serialPart = item.serialNumber ?? item.rowIndex ?? 0;
      const gKey = `${serialPart}::${item.baseProductKey || baseName}`;
      const existingIdx = byKey.get(gKey);
      if (existingIdx !== undefined) {
        groups[existingIdx].items.push(item);
      } else {
        byKey.set(gKey, groups.length);
        groups.push({
          groupKey: gKey,
          serialNumber: item.serialNumber ?? null,
          baseProductName: baseName,
          items: [item],
        });
      }
    }
    // Sort variants inside each base product so عالي appears before وسط
    const gradeOrder = new Map<string, number>(
      oilGrades.map((g, idx) => [g.name, Number(g.sortOrder ?? idx + 1)])
    );
    for (const g of groups) {
      g.items.sort((a, b) => {
        const oa = gradeOrder.get(a.grade || '') ?? 99;
        const ob = gradeOrder.get(b.grade || '') ?? 99;
        return oa - ob;
      });
    }
    return groups;
  }, [filteredItems, oilGrades]);

  const handleApprove = async () => {
    if (!activeBatch) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (selectedCount === 0) {
      setErrorMsg('يرجى تحديد صنف واحد على الأقل للاعتماد والحفظ.');
      return;
    }
    if (needsOilUnitConfirmation) {
      setErrorMsg(
        'وحدة تسعير الزيوت غير مؤكدة بعد — يرجى اختيار (كيلوجرام ÷ 1000 إلى جرام) أو (جرام مباشر) من شريط وحدة التسعير في الأعلى قبل الاعتماد.'
      );
      return;
    }
    if (unresolvedSelectedCount > 0) {
      setErrorMsg(
        `يوجد ${unresolvedSelectedCount} صنف محدد بسعر منفرد غير محدد المعنى — يرجى تحديد هل هو "سعر بيع" أم "سعر تكلفة" أولاً.`
      );
      return;
    }

    const hasStepUp = Boolean(getOwnerStepUpToken());
    if (!hasStepUp && !confirmPassword.trim()) {
      setNeedsPasswordPrompt(true);
      setErrorMsg('يرجى إدخال كلمة مرور المالك الرئيسي لتأكيد اعتماد قائمة الأسعار.');
      return;
    }

    setIsApproving(true);
    try {
      const approved = await apiClient.approvePriceListImport(
        activeBatch.id,
        editableItems,
        confirmPassword.trim() || undefined
      );
      setActiveBatch(approved);
      setEditableItems(approved.parsedItems);
      setNeedsPasswordPrompt(false);
      setConfirmPassword('');
      setSuccessMsg(
        `تم اعتماد الدفعة بنجاح: ${approved.approvalSummary?.createdCount ?? 0} صنف/درجة جديدة، ${approved.approvalSummary?.updatedCount ?? 0} تحديث سعر/بيانات — رصيد المخزون لم يُمس.`
      );
      await loadHistory();
      await onImported();
    } catch (err) {
      if (err instanceof ApiRequestError && err.requiresOwnerReauth) {
        setNeedsPasswordPrompt(true);
      }
      setErrorMsg(err instanceof Error ? err.message : 'تعذر اعتماد قائمة الأسعار.');
    } finally {
      setIsApproving(false);
    }
  };

  const handleCancelBatch = async () => {
    if (!activeBatch) return;
    setIsCancelling(true);
    setErrorMsg(null);
    try {
      await apiClient.cancelPriceListImport(activeBatch.id);
      setActiveBatch((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
      await loadHistory();
      setSuccessMsg('تم إلغاء دفعة الاستيراد دون أي تعديل على المنتجات أو الأسعار.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إلغاء الدفعة.');
    } finally {
      setIsCancelling(false);
    }
  };

  const openDeleteArchiveModal = (batches: PriceListImportRecord[]) => {
    if (batches.length === 0) return;
    setPendingDeleteBatches(batches);
    setDeleteConfirmPassword('');
    setDeleteNeedsPassword(!getOwnerStepUpToken());
    setErrorMsg(null);
  };

  const executeDeleteArchiveBatches = async () => {
    if (!pendingDeleteBatches || pendingDeleteBatches.length === 0) return;
    if (!getOwnerStepUpToken() && !deleteConfirmPassword.trim()) {
      setDeleteNeedsPassword(true);
      setErrorMsg('يرجى إدخال كلمة مرور المالك الرئيسي لتأكيد حذف الأرشيف.');
      return;
    }

    setIsDeletingArchive(true);
    setErrorMsg(null);
    try {
      const ids = pendingDeleteBatches.map((b) => b.id);
      const res =
        ids.length === 1
          ? await apiClient.deletePriceListImport(
              ids[0],
              deleteConfirmPassword.trim() || undefined
            )
          : await apiClient.deletePriceListImportsBulk(
              ids,
              deleteConfirmPassword.trim() || undefined
            );

      setPendingDeleteBatches(null);
      setDeleteConfirmPassword('');
      setDeleteNeedsPassword(false);
      setSelectedHistoryIds((prev) => prev.filter((id) => !res.deletedIds.includes(id)));
      setSuccessMsg(
        `تم حذف ${res.deletedCount} دفعة من سجل الاستيراد المؤرشف فقط. المنتجات والأسعار والمخزون والفواتير لم تتأثر.`
      );
      await loadHistory();
      await onImported();
    } catch (err) {
      if (err instanceof ApiRequestError && err.requiresOwnerReauth) {
        setDeleteNeedsPassword(true);
      }
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف الدفعة المؤرشفة.');
    } finally {
      setIsDeletingArchive(false);
    }
  };

  const allHistorySelected =
    importsHistory.length > 0 && selectedHistoryIds.length === importsHistory.length;

  return (
    <div
      className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[750] font-cairo"
      dir="rtl"
    >
      <div className="bg-white w-full max-w-6xl rounded-t-3xl sm:rounded-[2.5rem] shadow-2xl flex flex-col h-[94vh] sm:h-auto sm:max-h-[92vh] overflow-hidden border border-blue-900/15">
        {/* Header */}
        <div className="bg-[#072F5F] text-white px-5 py-4 sm:px-8 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-white/15 rounded-2xl shrink-0">
              <FileUp className="w-5 h-5 text-blue-200" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-black truncate">
                استيراد قائمة الأسعار والمنتجات من PDF (المالك الرئيسي فقط)
              </h2>
              <p className="text-xs text-blue-200 font-bold">
                مراجعة الدرجات ووحدة التسعير وتحويل الكيلو إلى جرام بدقة — مع حماية كاملة للمخزون
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-red-500 rounded-2xl text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Mandatory Non-Stock Banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 text-xs font-bold text-[#072F5F] flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#0A468C] shrink-0 mt-0.5" />
            <span>
              سياسة المخزون الصارمة: الاستيراد يحدّث الكتالوج وأسعار البيع والشراء/التكلفة والدرجات فقط — لن يتم تعديل رصيد المخزون لأي صنف حالي مطلقاً، وتُضاف الأصناف الجديدة برصيد ابتدائي (0).
            </span>
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 text-xs font-black text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 text-xs font-black text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Upload Form or Active Batch Review */}
          {!activeBatch ? (
            <div className="space-y-5">
              <form
                onSubmit={(e) => void handleUploadPdf(e)}
                className="bg-slate-50 border-2 border-dashed border-blue-300 rounded-3xl p-5 sm:p-7 text-center space-y-4"
              >
                <FileText className="w-11 h-11 text-[#0A468C] mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-black text-slate-900">
                    اختر ملف قائمة الأسعار PDF للتحليل والمراجعة
                  </h3>
                  <p className="text-xs font-bold text-slate-500">
                    يدعم جداول الزيوت متعددة الدرجات (عالي / وسط / تجاري / مخصص) واستخراج سعر البيع وسعر الشراء/التكلفة بدقة
                  </p>
                </div>

                <div className="max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3 text-right">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black text-[#072F5F]">
                      تصنيف هذه القائمة (إلزامي قبل التحليل) *
                    </label>
                    <select
                      value={listCategoryId}
                      onChange={(e) => {
                        setListCategoryId(e.target.value);
                        setErrorMsg(null);
                      }}
                      className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-blue-200 rounded-2xl font-black text-xs sm:text-sm text-slate-900 outline-none focus:border-[#0A468C]"
                    >
                      <option value="">— اختر تصنيف منتجات القائمة —</option>
                      {categories
                        .filter((c) => c.isActive !== false)
                        .map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name} (الوحدة: {cat.defaultUnit})
                          </option>
                        ))}
                    </select>
                  </div>

                  {listCategoryId === 'cat-oils' ? (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black text-[#072F5F]">
                        وحدة الأسعار داخل ملف PDF (للتحويل إلى الجرام)
                      </label>
                      <select
                        value={uploadOilUnit}
                        onChange={(e) =>
                          setUploadOilUnit(e.target.value as 'auto' | 'كيلوجرام' | 'جرام')
                        }
                        className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-blue-200 rounded-2xl font-black text-xs sm:text-sm text-slate-900 outline-none focus:border-[#0A468C]"
                      >
                        <option value="auto">تحديد من الملف أو التأكيد في شاشة المراجعة</option>
                        <option value="كيلوجرام">أسعار الكيلو (تحويل تلقائي ÷ 1000 إلى جرام)</option>
                        <option value="جرام">أسعار الجرام مباشرة (بدون قسمة)</option>
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-end">
                      <p className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5 w-full">
                        تحافظ الفوارغ والعبوات والكحول والكيماويات على وحداتها وأسعارها الأصلية دون قسمة على 1000.
                      </p>
                    </div>
                  )}
                </div>

                {listCategoryId === 'cat-oils' && (
                  <p className="text-[11px] font-bold text-blue-900 bg-blue-50/80 border border-blue-200 rounded-xl px-3 py-2 max-w-2xl mx-auto">
                    مثال تحويل الزيوت: إذا كان سعر الكيلو <strong>4,000 ج.م</strong> يصبح في النظام{' '}
                    <strong>4 ج.م / جرام</strong>، وإذا كان <strong>2,600 ج.م</strong> يصبح{' '}
                    <strong>2.6 ج.م / جرام</strong>.
                  </p>
                )}

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setSelectedFile(f);
                      setErrorMsg(null);
                    }}
                    className="block w-full max-w-sm text-xs font-bold text-slate-700 file:mr-0 file:ml-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-blue-100 file:text-[#072F5F] hover:file:bg-blue-200 cursor-pointer"
                  />
                  <button
                    type="submit"
                    disabled={isUploading || !selectedFile || !listCategoryId}
                    className="min-h-[48px] px-6 py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm flex items-center gap-2 shadow-md disabled:opacity-50 shrink-0"
                  >
                    {isUploading ? (
                      <RefreshCcw className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileUp className="w-4 h-4" />
                    )}
                    {isUploading ? 'جاري استخراج وتحليل البيانات...' : 'تحليل واستخراج المعاينة'}
                  </button>
                </div>
              </form>

              {/* Extensible Oil Grades Management Bar */}
              <div className="bg-white border border-slate-200 rounded-3xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#0A468C]" />
                    <span className="text-xs sm:text-sm font-black text-[#072F5F]">
                      درجات الزيوت المعتمدة ({oilGrades.filter((g) => g.isActive).length} مفعّلة)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {oilGrades.map((g) => (
                        <span
                          key={g.id}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                            g.isActive
                              ? 'bg-blue-50 text-[#072F5F] border border-blue-200'
                              : 'bg-slate-100 text-slate-500 line-through'
                          }`}
                        >
                          {g.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGradesManager((v) => !v)}
                    className="text-xs font-black text-[#0A468C] hover:underline"
                  >
                    {showGradesManager ? 'إخفاء إدارة الدرجات' : 'إدارة / إضافة درجة جديدة'}
                  </button>
                </div>

                {showGradesManager && (
                  <div className="pt-2 border-t border-slate-100 space-y-3 text-xs">
                    <form
                      onSubmit={(e) => void handleAddOilGrade(e)}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                    >
                      <input
                        type="text"
                        value={newGradeName}
                        onChange={(e) => setNewGradeName(e.target.value)}
                        placeholder="اسم الدرجة الجديدة (مثلاً: سوبر أو VIP)"
                        className="min-h-[38px] px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                      />
                      <input
                        type="text"
                        value={newGradeAliases}
                        onChange={(e) => setNewGradeAliases(e.target.value)}
                        placeholder="مرادفات الأعمدة في PDF (اختياري، مفصولة بفاصلة)"
                        className="min-h-[38px] px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                      />
                      <button
                        type="submit"
                        disabled={savingGrade || !newGradeName.trim()}
                        className="min-h-[38px] px-4 py-1.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4" />
                        إضافة درجة جديدة
                      </button>
                    </form>
                    <div className="flex flex-wrap gap-2">
                      {oilGrades.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => void handleToggleGradeActive(g)}
                          className={`px-3 py-1.5 rounded-xl border text-[11px] font-black transition-all ${
                            g.isActive
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                              : 'bg-slate-100 border-slate-200 text-slate-600'
                          }`}
                        >
                          {g.name} ({g.isActive ? 'مفعّلة — اضغط للتعطيل' : 'معطّلة — اضغط للتفعيل'})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Import History (with Single & Multi-Select Delete for Owner) */}
              <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-black text-[#072F5F]">
                      سجل دفعات الاستيراد المؤرشفة ({importsHistory.length})
                    </h4>
                    {importsHistory.length > 0 && (
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allHistorySelected}
                          onChange={(e) =>
                            setSelectedHistoryIds(
                              e.target.checked ? importsHistory.map((b) => b.id) : []
                            )
                          }
                          className="accent-[#0A468C]"
                        />
                        <span>تحديد الكل</span>
                      </label>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedHistoryIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          openDeleteArchiveModal(
                            importsHistory.filter((b) => selectedHistoryIds.includes(b.id))
                          )
                        }
                        className="min-h-[34px] px-3 py-1 bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 rounded-xl font-black text-xs flex items-center gap-1 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        حذف المحدد ({selectedHistoryIds.length})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadHistory()}
                      className="text-xs font-bold text-[#0A468C] hover:underline flex items-center gap-1"
                    >
                      <RefreshCcw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                      تحديث
                    </button>
                  </div>
                </div>

                {importsHistory.length === 0 ? (
                  <p className="text-xs font-bold text-slate-500 py-4 text-center">
                    لا توجد دفعات استيراد مسجلة بعد.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {importsHistory.map((imp) => {
                      const isChecked = selectedHistoryIds.includes(imp.id);
                      return (
                        <div
                          key={imp.id}
                          className={`p-3 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs transition-all ${
                            isChecked
                              ? 'bg-red-50/40 border-red-300'
                              : 'bg-slate-50 border-slate-200/80'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) =>
                                setSelectedHistoryIds((prev) =>
                                  e.target.checked
                                    ? [...prev, imp.id]
                                    : prev.filter((x) => x !== imp.id)
                                )
                              }
                              className="mt-1 accent-[#0A468C] shrink-0"
                            />
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-black text-slate-900 truncate">
                                  {imp.fileName}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                                    imp.status === 'approved'
                                      ? 'bg-emerald-100 text-emerald-900'
                                      : imp.status === 'cancelled'
                                        ? 'bg-slate-200 text-slate-700'
                                        : 'bg-amber-100 text-amber-900'
                                  }`}
                                >
                                  {imp.status === 'approved'
                                    ? 'معتمد'
                                    : imp.status === 'cancelled'
                                      ? 'ملغي'
                                      : 'بانتظار المراجعة'}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500">
                                  {new Date(imp.uploadedAt).toLocaleString('ar-EG')}
                                </span>
                              </div>
                              <p className="text-[11px] font-bold text-slate-600 tabular-nums">
                                بنود/درجات: {imp.totalParsed}
                                {imp.importConfig?.counts?.uniqueProductsCount
                                  ? ` (${imp.importConfig.counts.uniqueProductsCount} صنف أساسي)`
                                  : ''}{' '}
                                · جديد: {imp.newCount} · تحديث: {imp.updatedCount} · مراجعة:{' '}
                                {imp.needsReviewCount}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openBatchForReview(imp)}
                              className="min-h-[36px] px-3 py-1.5 bg-blue-50 hover:bg-[#0A468C] text-[#072F5F] hover:text-white rounded-xl font-black text-[11px] transition-all"
                            >
                              {imp.status === 'pending_review' ? 'مراجعة واعتماد' : 'عرض التفاصيل'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void apiClient.downloadPriceListOriginalFile(imp.id, imp.fileName)
                              }
                              className="min-h-[36px] px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-[11px] flex items-center gap-1"
                            >
                              <Download className="w-3.5 h-3.5" />
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeleteArchiveModal([imp])}
                              title="حذف الدفعة المؤرشفة فقط"
                              className="min-h-[36px] px-2.5 py-1.5 bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 rounded-xl font-black text-[11px] flex items-center gap-1 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              حذف
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Batch Summary Top Bar */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-900 text-sm">{activeBatch.fileName}</span>
                    {activeBatch.listCategoryName && (
                      <span className="px-2.5 py-0.5 rounded-lg bg-indigo-100 text-indigo-900 font-black">
                        تصنيف القائمة: {activeBatch.listCategoryName}
                      </span>
                    )}
                    <span className="px-2.5 py-0.5 rounded-lg bg-blue-100 text-[#072F5F] font-black">
                      {activeBatch.extractionMethod === 'pdf_text'
                        ? 'استخراج جدولي/نصي'
                        : activeBatch.extractionMethod === 'pdf_ocr_gemini'
                          ? 'استخراج ذكي (PDF مصوّر)'
                          : 'استخراج مختلط'}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-lg font-black ${
                        activeBatch.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-900'
                          : activeBatch.status === 'cancelled'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {activeBatch.status === 'approved'
                        ? 'دفعة معتمدة'
                        : activeBatch.status === 'cancelled'
                          ? 'دفعة ملغاة'
                          : 'بانتظار مراجعة واعتماد المالك'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isLegacyBatchExtract && (
                    <button
                      type="button"
                      disabled={isRemapping}
                      onClick={() => void handleRemapBatch()}
                      className="min-h-[38px] px-3 py-1.5 bg-amber-100 border border-amber-300 hover:bg-amber-200 text-amber-950 rounded-xl font-black flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {isRemapping ? 'جاري إعادة التحليل...' : 'إعادة تحليل الملف بالمحرك المحدّث'}
                    </button>
                  )}
                  {activeBatch.status === 'pending_review' &&
                    activeBatch.rawTableRows &&
                    activeBatch.rawTableRows.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowColumnMapper((prev) => !prev)}
                        className="min-h-[38px] px-3 py-1.5 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-[#072F5F] rounded-xl font-black"
                      >
                        {showColumnMapper ? 'إخفاء تعيين الأعمدة' : 'تعيين الأعمدة يدوياً'}
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() =>
                      void apiClient.downloadPriceListOriginalFile(activeBatch.id, activeBatch.fileName)
                    }
                    className="min-h-[38px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl font-bold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    تحميل PDF الأصلي
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBatch(null);
                      setEditableItems([]);
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className="min-h-[38px] px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-black"
                  >
                    رفع ملف آخر / السجل
                  </button>
                </div>
              </div>

              {/* Transparent Counts & Diagnostics Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-[11px]">
                <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-2">
                  <div className="font-bold text-slate-600">الأصناف الأساسية</div>
                  <div className="font-black text-sm text-[#072F5F] tabular-nums">
                    {uniqueBaseCount}
                    {counts?.expectedSerialCount ? ` / ${counts.expectedSerialCount}` : ''}
                  </div>
                </div>
                <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-2">
                  <div className="font-bold text-slate-600">الأكواد والدرجات</div>
                  <div className="font-black text-sm text-indigo-950 tabular-nums">
                    {editableItems.length}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2">
                  <div className="font-bold text-slate-600">صفوف الجدول</div>
                  <div className="font-black text-sm text-slate-900 tabular-nums">
                    {counts?.rawRowsCount ?? activeBatch.rawTableRows?.length ?? 0}
                  </div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2">
                  <div className="font-bold text-emerald-700">جديد</div>
                  <div className="font-black text-sm text-emerald-900 tabular-nums">
                    {editableItems.filter((i) => i.matchStatus === 'new').length}
                  </div>
                </div>
                <div className="bg-sky-50 border border-sky-200 rounded-xl p-2">
                  <div className="font-bold text-sky-700">تحديث حالي</div>
                  <div className="font-black text-sm text-sky-900 tabular-nums">
                    {editableItems.filter((i) => i.matchStatus === 'matched').length}
                  </div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-2">
                  <div className="font-bold text-purple-700">محدد للحفظ</div>
                  <div className="font-black text-sm text-purple-950 tabular-nums">
                    {selectedCount}
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2">
                  <div className="font-bold text-amber-800">غير متوفر / مستبعد</div>
                  <div className="font-black text-sm text-amber-950 tabular-nums">
                    {unavailableCount}
                  </div>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-2">
                  <div className="font-bold text-rose-700">بدون تكلفة / مراجعة</div>
                  <div className="font-black text-sm text-rose-900 tabular-nums">
                    {unconfirmedCostCount} / {editableItems.filter((i) => i.needsReview).length}
                  </div>
                </div>
              </div>

              {(counts?.hasCountMismatch || (counts?.excludedReasons && counts.excludedReasons.length > 0)) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs font-bold text-amber-950 space-y-1">
                  {counts?.countMismatchReason && <p>• {counts.countMismatchReason}</p>}
                  {counts?.excludedReasons?.map((reason, idx) => (
                    <p key={idx}>• سبب عدم تضمين بعض البنود تلقائياً: {reason}</p>
                  ))}
                </div>
              )}

              {/* Oil Pricing Unit Confirmation & Conversion Preview Banner */}
              {isOilBatch && activeBatch.status === 'pending_review' && (
                <div
                  className={`rounded-2xl border p-4 space-y-2.5 text-xs ${
                    needsOilUnitConfirmation || !unitConfig?.confirmedByUser
                      ? 'bg-amber-50 border-amber-300 text-amber-950'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-black text-sm">
                        {unitConfig?.confirmedByUser
                          ? `تم تأكيد وحدة التسعير: الأسعار الأصلية بـ (${unitConfig.sourceUnit}) ← تُحفظ بالنظام بـ (${unitConfig.targetUnit})`
                          : 'تأكيد وحدة تسعير الزيوت مطلوب قبل الاعتماد'}
                      </p>
                      <p className="font-bold">
                        {unitConfig?.suggestionReason ||
                          `معامل التحويل المطبق: × ${unitConfig?.conversionFactor ?? 1} · مثال: ${(unitConfig?.exampleOriginalPrice ?? 4000).toLocaleString()} ج.م / ${unitConfig?.sourceUnit === 'جرام' ? 'جرام' : 'كيلوجرام'} ← ${unitConfig?.sourceUnit === 'كيلوجرام' ? ((unitConfig?.exampleOriginalPrice ?? 4000) * 0.001) : (unitConfig?.exampleConvertedPrice ?? 4)} ج.م / جرام (ومثال 2,600 / كيلو ← 2.6 / جرام)`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isRemapping}
                        onClick={() => void handleQuickConfirmOilUnit('كيلوجرام')}
                        className={`min-h-[38px] px-3.5 py-1.5 rounded-xl font-black text-xs border transition-all ${
                          unitConfig?.confirmedByUser && unitConfig.sourceUnit === 'كيلوجرام'
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white hover:bg-blue-50 text-[#072F5F] border-blue-300'
                        }`}
                      >
                        تأكيد: الأسعار بالكيلوجرام (÷ 1000 إلى جرام)
                      </button>
                      <button
                        type="button"
                        disabled={isRemapping}
                        onClick={() => void handleQuickConfirmOilUnit('جرام')}
                        className={`min-h-[38px] px-3.5 py-1.5 rounded-xl font-black text-xs border transition-all ${
                          unitConfig?.confirmedByUser && unitConfig.sourceUnit === 'جرام'
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white hover:bg-blue-50 text-[#072F5F] border-blue-300'
                        }`}
                      >
                        تأكيد: الأسعار بالجرام مباشرة
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Collapsible Manual Column Mapping Panel */}
              {showColumnMapper &&
                activeBatch.status === 'pending_review' &&
                activeBatch.rawTableRows &&
                activeBatch.rawTableRows.length > 0 &&
                (() => {
                  const previewRows = activeBatch.rawTableRows.slice(0, 6);
                  const maxCols = Math.max(...previewRows.map((r) => r.length), 1);
                  const roleOptions: Array<[PriceListColumnRole, string]> = [
                    ['ignore', 'تجاهل / وزن فرعي'],
                    ['serial', 'مسلسل (#)'],
                    ['code', 'كود الصنف'],
                    ['name', 'اسم الصنف'],
                    ['sellingPrice', 'سعر البيع'],
                    ['costPrice', 'سعر الشراء / التكلفة'],
                    ['pricePerKg', 'سعر الكيلو (زيوت)'],
                    ['pricePerGram', 'سعر الجرام (زيوت)'],
                    ['unit', 'الوحدة'],
                    ['description', 'الوصف / الدرجة'],
                  ];
                  return (
                    <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 space-y-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-[#072F5F]">
                          تعديل تعيين أعمدة الجدول وإعادة الاستخراج
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={remapCategoryId}
                            onChange={(e) => setRemapCategoryId(e.target.value)}
                            className="min-h-[34px] px-2.5 py-1 bg-white border border-blue-200 rounded-xl font-bold text-xs"
                          >
                            {categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                          </select>
                          {remapCategoryId === 'cat-oils' && (
                            <select
                              value={mappingDraft.oilSourceUnit || 'auto'}
                              onChange={(e) => {
                                const val = e.target.value as 'auto' | 'كيلوجرام' | 'جرام';
                                setMappingDraft((prev) => ({
                                  ...prev,
                                  oilSourceUnit: val,
                                  sourceUnit: val,
                                  targetUnit: 'جرام',
                                  unitConfirmedByUser: val !== 'auto',
                                }));
                              }}
                              className="min-h-[34px] px-2.5 py-1 bg-white border border-blue-200 rounded-xl font-bold text-xs"
                            >
                              <option value="auto">وحدة الزيوت: تلقائي</option>
                              <option value="كيلوجرام">الأسعار بالكيلو (÷ 1000 للجرام)</option>
                              <option value="جرام">الأسعار بالجرام مباشرة</option>
                            </select>
                          )}
                          <button
                            type="button"
                            disabled={isRemapping}
                            onClick={() => void handleRemapBatch()}
                            className="min-h-[34px] px-4 py-1 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl font-black text-xs disabled:opacity-50"
                          >
                            {isRemapping ? 'جاري إعادة الاستخراج...' : 'إعادة استخراج وتطبيق التعيين'}
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto bg-white rounded-xl border border-blue-200 p-2">
                        <table className="w-full text-right text-[11px] border-collapse">
                          <thead>
                            <tr>
                              {Array.from({ length: maxCols }).map((_, colIdx) => (
                                <th key={colIdx} className="p-1.5 border-b border-slate-200 min-w-[110px]">
                                  <div className="text-[10px] text-slate-500 font-bold mb-1">
                                    عمود {colIdx + 1}
                                  </div>
                                  <select
                                    value={mappingDraft.columns?.[colIdx] || 'ignore'}
                                    onChange={(e) =>
                                      setMappingDraft((prev) => ({
                                        ...prev,
                                        columns: {
                                          ...(prev.columns || {}),
                                          [colIdx]: e.target.value as PriceListColumnRole,
                                        },
                                      }))
                                    }
                                    className="w-full px-1.5 py-1 bg-slate-50 border border-slate-200 rounded-lg font-black text-[11px]"
                                  >
                                    {roleOptions.map(([roleVal, roleLabel]) => (
                                      <option key={roleVal} value={roleVal}>
                                        {roleLabel}
                                      </option>
                                    ))}
                                  </select>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {previewRows.map((row, rIdx) => (
                              <tr key={rIdx} className="border-b border-slate-100 last:border-0">
                                {Array.from({ length: maxCols }).map((_, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className="p-1.5 font-bold text-slate-700 truncate max-w-[160px]"
                                  >
                                    {row[cIdx] || '—'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

              {/* Filter & Search Bar */}
              {editableItems.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={reviewSearch}
                      onChange={(e) => setReviewSearch(e.target.value)}
                      placeholder="بحث باسم الصنف أو الكود أو الدرجة..."
                      className="w-full min-h-[38px] pr-9 pl-3 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        ['all', 'الكل'],
                        ['needs_review', 'يحتاج مراجعة'],
                        ['new', 'جديد'],
                        ['matched', 'تحديث'],
                        ['unavailable', 'غير متوفر'],
                      ] as const
                    ).map(([fKey, fLabel]) => (
                      <button
                        key={fKey}
                        type="button"
                        onClick={() => setReviewFilter(fKey)}
                        className={`px-2.5 py-1.5 rounded-xl font-black text-[11px] ${
                          reviewFilter === fKey
                            ? 'bg-[#0A468C] text-white'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {fLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Grouped Base Product Review Cards */}
              {editableItems.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2 text-xs font-bold text-amber-950">
                  <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
                  <p className="font-black text-sm">لم يتم استخراج أصناف قابلة للاستيراد من هذا الملف</p>
                  {activeBatch.rawTextPreview && (
                    <pre className="text-[11px] bg-white p-3 rounded-xl border border-amber-200 text-right overflow-x-auto max-h-40 whitespace-pre-wrap">
                      {activeBatch.rawTextPreview}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {groupedProducts.map((group) => {
                    const isLocked = activeBatch.status !== 'pending_review';
                    return (
                      <div
                        key={group.groupKey}
                        className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs"
                      >
                        {/* Base Product Group Header */}
                        <div className="bg-slate-100/80 px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            {group.serialNumber !== null && (
                              <span className="px-2 py-0.5 rounded-lg bg-[#072F5F] text-white font-black tabular-nums">
                                #{group.serialNumber}
                              </span>
                            )}
                            <span className="font-black text-sm text-slate-900">
                              {group.baseProductName}
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-blue-100 text-[#072F5F] font-black text-[11px]">
                              {group.items.length} {group.items.length > 1 ? 'درجات' : 'درجة'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.items.map((v) => (
                              <span
                                key={v.rowKey}
                                className={`px-2 py-0.5 rounded-lg font-bold text-[11px] tabular-nums ${
                                  v.isAvailable === false
                                    ? 'bg-slate-200 text-slate-600'
                                    : 'bg-white border border-slate-200 text-slate-800'
                                }`}
                              >
                                {v.grade || 'أساسي'}: {v.code || 'بدون كود'}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Individual Grade Variants under Base Product */}
                        <div className="divide-y divide-slate-100">
                          {group.items.map((item) => {
                            const isAmbiguous =
                              item.ambiguousSinglePrice !== null &&
                              item.singlePriceMeaning === 'unresolved';
                            const matched = item.matchedProductCurrent;

                            return (
                              <div
                                key={item.rowKey}
                                className={`p-3.5 space-y-2.5 text-xs ${
                                  !item.selectedForImport
                                    ? 'bg-slate-50/70 opacity-75'
                                    : isAmbiguous || item.matchStatus === 'duplicate_in_file'
                                      ? 'bg-red-50/40'
                                      : matched
                                        ? 'bg-blue-50/30'
                                        : 'bg-white'
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex items-center gap-2 font-black text-slate-900 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        disabled={isLocked}
                                        checked={item.selectedForImport}
                                        onChange={(e) =>
                                          updateRow(item.rowKey, (p) => ({
                                            ...p,
                                            selectedForImport: e.target.checked,
                                          }))
                                        }
                                        className="w-4 h-4 accent-[#0A468C]"
                                      />
                                      <span>تضمين ({item.grade || 'أساسي'})</span>
                                    </label>
                                    {item.originalPrice !== null && item.originalPrice !== undefined && (
                                      <span className="px-2.5 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold text-[11px] tabular-nums">
                                        الأصل ({item.originalPriceUnit || 'كيلوجرام'}): بيع{' '}
                                        {item.originalPrice.toLocaleString()}
                                        {item.originalCostPrice !== null &&
                                        item.originalCostPrice !== undefined
                                          ? ` · شراء ${item.originalCostPrice.toLocaleString()}`
                                          : ''}{' '}
                                        ← النظام ({item.unit}): بيع{' '}
                                        <strong>{item.sellingPrice ?? '—'}</strong>
                                        {item.costPrice !== null && item.costPrice !== undefined ? (
                                          <>
                                            {' '}
                                            · شراء <strong>{item.costPrice}</strong>
                                          </>
                                        ) : null}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                                        item.isAvailable === false
                                          ? 'bg-slate-200 text-slate-700'
                                          : item.matchStatus === 'new'
                                            ? 'bg-emerald-100 text-emerald-900'
                                            : item.matchStatus === 'matched'
                                              ? 'bg-blue-100 text-[#072F5F]'
                                              : item.matchStatus === 'duplicate_in_file'
                                                ? 'bg-red-100 text-red-800'
                                                : 'bg-amber-100 text-amber-900'
                                      }`}
                                    >
                                      {item.isAvailable === false
                                        ? 'غير متوفر بالملف'
                                        : item.matchStatus === 'new'
                                          ? 'جديد (رصيد 0)'
                                          : item.matchStatus === 'matched'
                                            ? 'تحديث حالي'
                                            : item.matchStatus === 'duplicate_in_file'
                                              ? 'مكرر داخل الملف'
                                              : 'يحتاج مراجعة'}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-bold tabular-nums">
                                      ثقة: {item.confidence}%
                                    </span>
                                  </div>
                                </div>

                                {/* Warnings */}
                                {item.warnings.length > 0 && (
                                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 text-[11px] font-bold text-amber-900 space-y-0.5">
                                    {item.warnings.map((w, idx) => (
                                      <p key={idx}>• {w}</p>
                                    ))}
                                  </div>
                                )}

                                {/* Ambiguous Single Price Resolver */}
                                {item.ambiguousSinglePrice !== null && (
                                  <div
                                    className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                                      item.singlePriceMeaning === 'unresolved'
                                        ? 'bg-red-50 border-red-300 text-red-900'
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                    }`}
                                  >
                                    <span className="font-black text-[11px]">
                                      سعر منفرد ({item.ambiguousSinglePrice} ج.م):
                                    </span>
                                    <select
                                      disabled={isLocked}
                                      value={item.singlePriceMeaning}
                                      onChange={(e) =>
                                        handleSinglePriceMeaningChange(
                                          item.rowKey,
                                          e.target.value as PriceListSinglePriceMeaning
                                        )
                                      }
                                      className="min-h-[34px] px-3 py-1 bg-white border border-slate-300 rounded-xl font-black text-xs text-slate-900"
                                    >
                                      <option value="unresolved">— حدد معنى السعر (إلزامي) —</option>
                                      <option value="selling">سعر البيع</option>
                                      <option value="cost">سعر الشراء / التكلفة</option>
                                    </select>
                                  </div>
                                )}

                                {/* Editable Fields */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                      الكود
                                    </label>
                                    <input
                                      type="text"
                                      disabled={isLocked}
                                      value={item.code}
                                      onChange={(e) =>
                                        updateRow(item.rowKey, (p) => ({ ...p, code: e.target.value }))
                                      }
                                      className="w-full min-h-[36px] px-2.5 py-1 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                      الدرجة
                                    </label>
                                    <select
                                      disabled={isLocked}
                                      value={item.grade || ''}
                                      onChange={(e) => {
                                        const gObj = oilGrades.find((g) => g.name === e.target.value);
                                        updateRow(item.rowKey, (p) => ({
                                          ...p,
                                          grade: e.target.value,
                                          gradeId: gObj?.id ?? null,
                                        }));
                                      }}
                                      className="w-full min-h-[36px] px-2 py-1 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                                    >
                                      <option value="">بدون درجة</option>
                                      {oilGrades.map((g) => (
                                        <option key={g.id} value={g.name}>
                                          {g.name}
                                        </option>
                                      ))}
                                      {item.grade &&
                                        !oilGrades.some((g) => g.name === item.grade) && (
                                          <option value={item.grade}>{item.grade}</option>
                                        )}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                      المنتج الأساسي
                                    </label>
                                    <input
                                      type="text"
                                      disabled={isLocked}
                                      value={item.baseProductName || item.name}
                                      onChange={(e) =>
                                        updateRow(item.rowKey, (p) => ({
                                          ...p,
                                          name: e.target.value,
                                          baseProductName: e.target.value,
                                        }))
                                      }
                                      className="w-full min-h-[36px] px-2.5 py-1 bg-white border border-slate-200 rounded-xl font-black text-xs"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                      التصنيف
                                    </label>
                                    <select
                                      disabled={isLocked}
                                      value={item.suggestedCategoryId}
                                      onChange={(e) => {
                                        const cat = categories.find((c) => c.id === e.target.value);
                                        updateRow(item.rowKey, (p) => ({
                                          ...p,
                                          suggestedCategoryId: e.target.value,
                                          suggestedCategoryName: cat?.name || p.suggestedCategoryName,
                                        }));
                                      }}
                                      className="w-full min-h-[36px] px-2 py-1 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                                    >
                                      {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                      وحدة النظام
                                    </label>
                                    <select
                                      disabled={isLocked}
                                      value={item.unit}
                                      onChange={(e) =>
                                        updateRow(item.rowKey, (p) => ({ ...p, unit: e.target.value }))
                                      }
                                      className="w-full min-h-[36px] px-2 py-1 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                                    >
                                      {PRODUCT_UNIT_OPTIONS.map((u) => (
                                        <option key={u} value={u}>
                                          {u}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                      سعر البيع ({item.unit})
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      disabled={isLocked}
                                      value={item.sellingPrice ?? ''}
                                      onChange={(e) =>
                                        updateRow(item.rowKey, (p) => ({
                                          ...p,
                                          sellingPrice:
                                            e.target.value === '' ? null : parseFloat(e.target.value),
                                        }))
                                      }
                                      placeholder="—"
                                      className="w-full min-h-[36px] px-2 py-1 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                      الشراء / التكلفة ({item.unit})
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      disabled={isLocked}
                                      value={item.costPrice ?? ''}
                                      onChange={(e) =>
                                        updateRow(item.rowKey, (p) => ({
                                          ...p,
                                          costPrice:
                                            e.target.value === '' ? null : parseFloat(e.target.value),
                                        }))
                                      }
                                      placeholder="—"
                                      className="w-full min-h-[36px] px-2 py-1 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                                    />
                                  </div>
                                </div>

                                {/* Matched Product Diff */}
                                {matched && (
                                  <div className="bg-white rounded-xl border border-blue-200 p-2.5 space-y-1.5">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-700">
                                      <span>
                                        الحالي بالنظام:{' '}
                                        <strong className="text-[#072F5F]">
                                          {matched.name} ({matched.code})
                                          {matched.grade ? ` · ${matched.grade}` : ''}
                                        </strong>
                                      </span>
                                      <span className="tabular-nums text-slate-600">
                                        البيع الحالي: <strong>{matched.pricePerMg} ج.م</strong> · التكلفة:{' '}
                                        <strong>{matched.costPrice ?? 'غير محدد'}</strong> · المخزون:{' '}
                                        <strong>
                                          {matched.stock.toLocaleString()} {matched.unit} (محمي)
                                        </strong>
                                      </span>
                                    </div>

                                    <div className="flex flex-wrap gap-3 text-[11px] font-bold text-slate-700">
                                      {(
                                        [
                                          ['name', 'تحديث الاسم'],
                                          ['grade', 'تحديث الدرجة'],
                                          ['category', 'تحديث التصنيف'],
                                          ['unit', 'تحديث الوحدة'],
                                          ['sellingPrice', 'تحديث سعر البيع'],
                                          ['costPrice', 'تحديث التكلفة'],
                                          ['description', 'تحديث الوصف'],
                                        ] as const
                                      ).map(([fieldKey, label]) => (
                                        <label
                                          key={fieldKey}
                                          className="flex items-center gap-1 cursor-pointer"
                                        >
                                          <input
                                            type="checkbox"
                                            disabled={isLocked}
                                            checked={item.updateFields?.[fieldKey] ?? false}
                                            onChange={(e) =>
                                              updateRow(item.rowKey, (p) => ({
                                                ...p,
                                                updateFields: {
                                                  ...(p.updateFields || {}),
                                                  [fieldKey]: e.target.checked,
                                                },
                                              }))
                                            }
                                            className="accent-[#0A468C]"
                                          />
                                          <span>{label}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Step-up password prompt if needed before final approve */}
              {activeBatch.status === 'pending_review' && needsPasswordPrompt && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-black text-amber-950 shrink-0">
                    <Lock className="w-4 h-4 text-amber-700" />
                    <span>تأكيد كلمة مرور المالك الرئيسي للاعتماد:</span>
                  </div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أدخل كلمة مرور حساب المالك..."
                    className="flex-1 min-h-[42px] px-3.5 py-2 bg-white border border-amber-300 rounded-xl font-bold text-sm"
                  />
                </div>
              )}

              {activeBatch.status === 'pending_review' && (
                <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={isApproving || selectedCount === 0 || needsOilUnitConfirmation}
                    onClick={() => void handleApprove()}
                    className="flex-1 min-h-[48px] px-5 py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
                  >
                    {isApproving ? (
                      <RefreshCcw className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    {isApproving
                      ? 'جاري الحفظ...'
                      : needsOilUnitConfirmation
                        ? 'أكد وحدة تسعير الزيوت أعلاه لتفعيل الاعتماد'
                        : `اعتماد وحفظ (${selectedCount}) درجة/صنف — دون تعديل المخزون`}
                  </button>
                  <button
                    type="button"
                    disabled={isCancelling}
                    onClick={() => void handleCancelBatch()}
                    className="min-h-[48px] px-5 py-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-2xl font-black text-sm flex items-center justify-center gap-1.5"
                  >
                    <XCircle className="w-4 h-4" />
                    إلغاء الدفعة
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Deleting Archived Import Batches */}
      {pendingDeleteBatches && pendingDeleteBatches.length > 0 && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-[800]">
          <div className="bg-white w-full max-w-lg rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 border border-red-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-red-800 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                تأكيد حذف سجل دفعات الاستيراد المؤرشفة ({pendingDeleteBatches.length})
              </h3>
              <button
                type="button"
                onClick={() => setPendingDeleteBatches(null)}
                className="p-1.5 hover:bg-slate-100 rounded-xl"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs font-bold text-emerald-950">
              تنبيه أمان: سيتم حذف سجل الأرشفة وملف PDF المرفق به فقط من السجل.{' '}
              <strong>
                لن تتأثر المنتجات أو الأكواد أو الأسعار أو أرصدة المخزون أو الفواتير التاريخية بأي شكل.
              </strong>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1.5 text-xs">
              {pendingDeleteBatches.map((b) => (
                <div
                  key={b.id}
                  className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2"
                >
                  <span className="font-black text-slate-900 truncate">{b.fileName}</span>
                  <span className="text-[11px] font-bold text-slate-500 shrink-0">
                    {new Date(b.uploadedAt).toLocaleString('ar-EG')}
                  </span>
                </div>
              ))}
            </div>

            {deleteNeedsPassword && (
              <div className="space-y-1">
                <label className="block text-xs font-black text-amber-900">
                  كلمة مرور المالك الرئيسي للتأكيد:
                </label>
                <input
                  type="password"
                  value={deleteConfirmPassword}
                  onChange={(e) => setDeleteConfirmPassword(e.target.value)}
                  placeholder="أدخل كلمة مرور المالك..."
                  className="w-full min-h-[42px] px-3.5 py-2 bg-white border border-amber-300 rounded-xl font-bold text-sm"
                />
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={isDeletingArchive}
                onClick={() => void executeDeleteArchiveBatches()}
                className="flex-1 min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs disabled:opacity-50"
              >
                {isDeletingArchive
                  ? 'جاري الحذف...'
                  : `تأكيد حذف (${pendingDeleteBatches.length}) من الأرشيف`}
              </button>
              <button
                type="button"
                disabled={isDeletingArchive}
                onClick={() => setPendingDeleteBatches(null)}
                className="min-h-[44px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl font-black text-xs"
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
