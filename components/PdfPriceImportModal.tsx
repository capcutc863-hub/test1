import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import {
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
  const [activeBatch, setActiveBatch] = useState<PriceListImportRecord | null>(initialImport);
  const [editableItems, setEditableItems] = useState<PriceListParsedItem[]>(
    initialImport ? initialImport.parsedItems.map((it) => ({ ...it })) : []
  );
  const [importsHistory, setImportsHistory] = useState<PriceListImportRecord[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemapping, setIsRemapping] = useState(false);
  const [showColumnMapper, setShowColumnMapper] = useState(false);
  const [remapCategoryId, setRemapCategoryId] = useState<string>(
    initialImport?.listCategoryId || categories[0]?.id || 'cat-oils'
  );
  const [mappingDraft, setMappingDraft] = useState<PriceListColumnMapping>(
    initialImport?.columnMapping || {
      headerRowIndex: null,
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

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const list = await apiClient.getPriceListImports();
      setImportsHistory(list);
    } catch {
      // silently ignore history fetch failure if upload modal is still usable
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadHistory();
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
    setErrorMsg(batch.errorMessage || null);
    setSuccessMsg(null);
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
      const record = await apiClient.importPriceListPdf(selectedFile, { listCategoryId });
      openBatchForReview(record);
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحليل ملف PDF.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemapBatch = async () => {
    if (!activeBatch) return;
    setIsRemapping(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const updated = await apiClient.remapPriceListImport(activeBatch.id, {
        listCategoryId: remapCategoryId,
        columnMapping: mappingDraft,
      });
      openBatchForReview(updated);
      setSuccessMsg('تمت إعادة استخراج القائمة وتطبيق تعيين الأعمدة بنجاح ✅');
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إعادة استخراج وتطبيق التعيين.');
    } finally {
      setIsRemapping(false);
    }
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

  const handleApprove = async () => {
    if (!activeBatch) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (selectedCount === 0) {
      setErrorMsg('يرجى تحديد صنف واحد على الأقل للاعتماد والحفظ.');
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
        `تم اعتماد الدفعة بنجاح: ${approved.approvalSummary?.createdCount ?? 0} صنف جديد، ${approved.approvalSummary?.updatedCount ?? 0} تحديث سعر/وصف — رصيد المخزون لم يُمس.`
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
                مراجعة وتصنيف وتحديد الأسعار قبل الحفظ — مع حماية كاملة لرصيد المخزون
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
              سياسة المخزون الصارمة: الاستيراد يحدّث الكتالوج وأسعار البيع/التكلفة والوصف والوحدة والتصنيف فقط — لن يتم تعديل رصيد المخزون لأي صنف حالي مطلقاً، وتُضاف الأصناف الجديدة برصيد ابتدائي (0) حتى تستلم بضاعتها فعلياً.
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

          {/* Upload Form or Active Batch Header */}
          {!activeBatch ? (
            <div className="space-y-5">
              <form
                onSubmit={(e) => void handleUploadPdf(e)}
                className="bg-slate-50 border-2 border-dashed border-blue-300 rounded-3xl p-6 sm:p-8 text-center space-y-4"
              >
                <FileText className="w-12 h-12 text-[#0A468C] mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-black text-slate-900">
                    اختر ملف قائمة الأسعار PDF للتحليل والمراجعة
                  </h3>
                  <p className="text-xs font-bold text-slate-500">
                    يدعم الملفات الجدولية والنصية العربية والإنجليزية (والملفات الممسوحة ضوئياً عبر Gemini عند ضبط GEMINI_API_KEY على الخادم)
                  </p>
                </div>

                <div className="max-w-md mx-auto text-right space-y-1.5">
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
                  <p className="text-[11px] font-bold text-slate-500">
                    {listCategoryId === 'cat-oils'
                      ? 'للزيوت العطرية: أسعار الكيلو تُقسَم تلقائياً على 1000 للوصول لسعر الجرام مع حفظ السعر الأصلي للعرض.'
                      : 'تحافظ الفوارغ والعبوات والكحول والكيماويات على وحداتها وأسعارها الأصلية دون قسمة على 1000.'}
                  </p>
                </div>

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

              {/* Import History */}
              <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-[#072F5F]">
                    سجل دفعات الاستيراد المؤرشفة ({importsHistory.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() => void loadHistory()}
                    className="text-xs font-bold text-[#0A468C] hover:underline flex items-center gap-1"
                  >
                    <RefreshCcw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                    تحديث
                  </button>
                </div>

                {importsHistory.length === 0 ? (
                  <p className="text-xs font-bold text-slate-500 py-4 text-center">
                    لا توجد دفعات استيراد مسجلة بعد.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {importsHistory.map((imp) => (
                      <div
                        key={imp.id}
                        className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-black text-slate-900 truncate">{imp.fileName}</span>
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
                            مستخرج: {imp.totalParsed} · جديد: {imp.newCount} · تحديث: {imp.updatedCount} · مراجعة:{' '}
                            {imp.needsReviewCount}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openBatchForReview(imp)}
                            className="min-h-[36px] px-3 py-1.5 bg-blue-50 hover:bg-[#0A468C] text-[#072F5F] hover:text-white rounded-xl font-black text-[11px] transition-all"
                          >
                            {imp.status === 'pending_review' ? 'مراجعة واعتماد' : 'عرض التفاصيل'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void apiClient.downloadPriceListOriginalFile(imp.id, imp.fileName)}
                            className="min-h-[36px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-[11px] flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF الأصلي
                          </button>
                        </div>
                      </div>
                    ))}
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
                        ? 'استخراج نصي/جدولي'
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
                  <p className="font-bold text-slate-600 tabular-nums">
                    المستخرج: {editableItems.length} · المحدد للحفظ: {selectedCount} · يحتاج تحديد معنى السعر:{' '}
                    <span className={unresolvedSelectedCount > 0 ? 'text-red-700 font-black' : ''}>
                      {unresolvedSelectedCount}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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

              {/* Collapsible Manual Column Mapping Panel */}
              {showColumnMapper &&
                activeBatch.status === 'pending_review' &&
                activeBatch.rawTableRows &&
                activeBatch.rawTableRows.length > 0 && (() => {
                  const previewRows = activeBatch.rawTableRows.slice(0, 6);
                  const maxCols = Math.max(...previewRows.map((r) => r.length), 1);
                  const roleOptions: Array<[PriceListColumnRole, string]> = [
                    ['ignore', 'تجاهل / مسلسل / وزن فرعي'],
                    ['code', 'كود الصنف'],
                    ['name', 'اسم الصنف'],
                    ['sellingPrice', 'سعر البيع'],
                    ['costPrice', 'سعر التكلفة'],
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
                              onChange={(e) =>
                                setMappingDraft((prev) => ({
                                  ...prev,
                                  oilSourceUnit: e.target.value as 'auto' | 'كيلوجرام' | 'جرام',
                                }))
                              }
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
                                  <td key={cIdx} className="p-1.5 font-bold text-slate-700 truncate max-w-[160px]">
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

              {/* Editable Review Table / Cards */}
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
                  {editableItems.map((item) => {
                    const isLocked = activeBatch.status !== 'pending_review';
                    const isAmbiguous =
                      item.ambiguousSinglePrice !== null && item.singlePriceMeaning === 'unresolved';
                    const matched = item.matchedProductCurrent;

                    return (
                      <div
                        key={item.rowKey}
                        className={`rounded-2xl border p-4 space-y-3 text-xs transition-all ${
                          !item.selectedForImport
                            ? 'bg-slate-50 border-slate-200 opacity-75'
                            : isAmbiguous || item.matchStatus === 'duplicate_in_file'
                              ? 'bg-red-50/40 border-red-300'
                              : matched
                                ? 'bg-blue-50/40 border-blue-200'
                                : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
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
                            <span>تضمين الصنف في الحفظ</span>
                          </label>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black ${
                                item.matchStatus === 'new'
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : item.matchStatus === 'matched'
                                    ? 'bg-blue-100 text-[#072F5F]'
                                    : item.matchStatus === 'duplicate_in_file'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              {item.matchStatus === 'new'
                                ? 'صنف جديد (رصيد 0)'
                                : item.matchStatus === 'matched'
                                  ? 'تحديث صنف حالي'
                                  : item.matchStatus === 'duplicate_in_file'
                                    ? 'مكرر داخل الملف'
                                    : 'يحتاج مراجعة'}
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-bold tabular-nums">
                              ثقة: {item.confidence}%
                            </span>
                            {item.matchedBy && item.matchedBy !== 'none' && (
                              <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 font-bold">
                                تطابق: {item.matchedBy === 'code' ? 'بالكود' : item.matchedBy === 'normalized_name' ? 'بالاسم الموحّد' : 'بالاسم'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Unit Conversion Badge */}
                        {(item.conversionNote || (item.originalPrice !== null && item.originalPrice !== undefined)) && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 text-[11px] font-bold text-emerald-900 flex flex-wrap items-center justify-between gap-2">
                            <span>
                              {item.conversionNote || 'تحويل تلقائي لوحدة التسعير'}
                            </span>
                            {item.originalPrice !== null && item.originalPrice !== undefined && (
                              <span className="tabular-nums font-black">
                                السعر الأصلي: {item.originalPrice.toLocaleString()} ج.م / {item.originalPriceUnit || 'كيلوجرام'} ← {item.sellingPrice ?? '—'} ج.م / {item.unit}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Warnings */}
                        {item.warnings.length > 0 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] font-bold text-amber-900 space-y-0.5">
                            {item.warnings.map((w, idx) => (
                              <p key={idx}>• {w}</p>
                            ))}
                          </div>
                        )}

                        {/* Ambiguous Single Price Resolver */}
                        {item.ambiguousSinglePrice !== null && (
                          <div
                            className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                              item.singlePriceMeaning === 'unresolved'
                                ? 'bg-red-50 border-red-300 text-red-900'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            }`}
                          >
                            <span className="font-black text-[11px]">
                              تم رصد سعر واحد منفرد ({item.ambiguousSinglePrice} ج.م) دون توضيح هل هو سعر بيع أم تكلفة:
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
                              className="min-h-[36px] px-3 py-1 bg-white border border-slate-300 rounded-xl font-black text-xs text-slate-900"
                            >
                              <option value="unresolved">— اختر معنى السعر (إلزامي) —</option>
                              <option value="selling">اعتباره سعر البيع للعميل</option>
                              <option value="cost">اعتباره سعر التكلفة</option>
                            </select>
                          </div>
                        )}

                        {/* Editable Fields */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">الكود</label>
                            <input
                              type="text"
                              disabled={isLocked}
                              value={item.code}
                              onChange={(e) =>
                                updateRow(item.rowKey, (p) => ({ ...p, code: e.target.value }))
                              }
                              className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                            />
                          </div>

                          <div className="lg:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">اسم الصنف</label>
                            <input
                              type="text"
                              disabled={isLocked}
                              value={item.name}
                              onChange={(e) =>
                                updateRow(item.rowKey, (p) => ({ ...p, name: e.target.value }))
                              }
                              className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-xs"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">التصنيف المقترح</label>
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
                              className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                            >
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">الوحدة</label>
                            <select
                              disabled={isLocked}
                              value={item.unit}
                              onChange={(e) =>
                                updateRow(item.rowKey, (p) => ({ ...p, unit: e.target.value }))
                              }
                              className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                            >
                              {PRODUCT_UNIT_OPTIONS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">سعر البيع</label>
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
                                className="w-full min-h-[38px] px-2 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">التكلفة</label>
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
                                className="w-full min-h-[38px] px-2 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-xs tabular-nums"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Side-by-side Diff + Selective Field Checkboxes for Matched Existing Product */}
                        {matched && (
                          <div className="bg-white rounded-xl border border-blue-200 p-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-700">
                              <span>
                                الصنف الحالي في النظام:{' '}
                                <strong className="text-[#072F5F]">
                                  {matched.name} ({matched.code})
                                </strong>
                              </span>
                              <span className="tabular-nums text-slate-600">
                                سعر البيع الحالي: <strong>{matched.pricePerMg} ج.م</strong> · التكلفة:{' '}
                                <strong>{matched.costPrice ?? 'غير محدد'}</strong> · المخزون الحالي:{' '}
                                <strong>{matched.stock.toLocaleString()} {matched.unit} (لن يتغير)</strong>
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-3 text-[11px] font-bold text-slate-700">
                              {(
                                [
                                  ['name', 'تحديث الاسم'],
                                  ['category', 'تحديث التصنيف'],
                                  ['unit', 'تحديث الوحدة'],
                                  ['sellingPrice', 'تحديث سعر البيع'],
                                  ['costPrice', 'تحديث التكلفة'],
                                  ['description', 'تحديث الوصف'],
                                ] as const
                              ).map(([fieldKey, label]) => (
                                <label key={fieldKey} className="flex items-center gap-1 cursor-pointer">
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
                    disabled={isApproving || selectedCount === 0}
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
                      : `اعتماد وحفظ (${selectedCount}) صنف — دون تعديل المخزون`}
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
    </div>
  );
};
