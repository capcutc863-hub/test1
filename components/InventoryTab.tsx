import React, { useEffect, useMemo, useState } from 'react';
import {
  Package,
  Plus,
  Search,
  Edit3,
  X,
  Droplets,
  History,
  RefreshCcw,
  ChevronDown,
  ChevronUp,
  FileUp,
  Layers,
  Award,
  AlertCircle,
  Archive,
  RotateCcw,
  Trash2,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import {
  Product,
  ProductCategory,
  ProductUnit,
  ProductUsageSummary,
  CommissionConfig,
  CommissionMode,
  SystemGeneralSettings,
  OilGrade,
  User,
  StockMovementEntry,
} from '../types';
import { apiClient, ApiRequestError, getOwnerStepUpToken } from '../src/lib/api';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_COMMISSION_CONFIG,
  PRODUCT_UNIT_OPTIONS,
  resolveCategoryDefaultCommissionEligible,
} from '../src/lib/commission-utils';
import { detectCatalogCategoryConflict } from '../src/lib/product-classifier';

interface InventoryTabProps {
  products: Product[];
  categories?: ProductCategory[];
  commissionConfig?: CommissionConfig;
  generalSettings?: SystemGeneralSettings;
  currentUser: User;
  onOpenPdfImport?: () => void;
  onAddProduct: (product: Partial<Omit<Product, 'id'>> & Pick<Product, 'name' | 'pricePerMg' | 'stock'>) => Promise<void> | void;
  onUpdateProduct: (product: Product) => Promise<void> | void;
  onArchiveProduct?: (productId: string, isActive: boolean, reason?: string) => Promise<void> | void;
  onDeleteProduct?: (productId: string, confirmPassword?: string) => Promise<void> | void;
}

export const InventoryTab: React.FC<InventoryTabProps> = ({
  products,
  categories = DEFAULT_CATEGORIES,
  commissionConfig = DEFAULT_COMMISSION_CONFIG,
  generalSettings,
  currentUser,
  onOpenPdfImport,
  onAddProduct,
  onUpdateProduct,
  onArchiveProduct,
  onDeleteProduct,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('الكل');
  const [gradeFilter, setGradeFilter] = useState<string>('الكل');
  const [showInactive, setShowInactive] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSavingModal, setIsSavingModal] = useState(false);

  // Archive & Safe Delete modal state
  const [actionProduct, setActionProduct] = useState<Product | null>(null);
  const [actionKind, setActionKind] = useState<'archive' | 'unarchive' | 'delete' | null>(null);
  const [actionUsage, setActionUsage] = useState<ProductUsageSummary | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [actionReason, setActionReason] = useState('');
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState(false);

  // New product form
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('cat-oils');
  const [unit, setUnit] = useState<ProductUnit>('mg');
  const [grade, setGrade] = useState<OilGrade>('عالي (Code A)');
  const [description, setDescription] = useState('');
  const [pricePerMg, setPricePerMg] = useState<string>('20');
  const [costPrice, setCostPrice] = useState<string>('');
  const [stock, setStock] = useState<string>('0');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [newIsCommissionEligible, setNewIsCommissionEligible] = useState<boolean>(true);
  const [newCommissionMode, setNewCommissionMode] = useState<CommissionMode>('inherit_rep');
  const [newCustomCommRate, setNewCustomCommRate] = useState<string>('5');
  const [newCustomCommFixed, setNewCustomCommFixed] = useState<string>('0');

  const [showMovements, setShowMovements] = useState(false);
  const [movements, setMovements] = useState<StockMovementEntry[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  const isOwner = currentUser.role === 'owner';
  const canEdit =
    currentUser.role === 'owner' ||
    currentUser.role === 'admin' ||
    currentUser.canEditInventory;

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive !== false),
    [categories]
  );

  const loadMovements = async () => {
    setLoadingMovements(true);
    setMovementsError(null);
    try {
      const list = await apiClient.getStockMovements();
      setMovements(list);
    } catch (err: unknown) {
      setMovementsError(err instanceof Error ? err.message : 'تعذر تحميل سجل حركات المخزون');
    } finally {
      setLoadingMovements(false);
    }
  };

  useEffect(() => {
    if (showMovements) {
      void loadMovements();
    }
  }, [showMovements, products]);

  const movementLabelMap: Record<StockMovementEntry['movementType'], { label: string; badgeClass: string }> = {
    order_deduction: { label: 'خصم عند تأكيد الطلب', badgeClass: 'bg-blue-100 text-[#072F5F]' },
    order_delta_deduction: { label: 'خصم زيادة كمية التعديل', badgeClass: 'bg-sky-100 text-sky-900' },
    order_delta_restore: { label: 'إرجاع فرق تعديل/حذف فاتورة', badgeClass: 'bg-emerald-100 text-emerald-800' },
    order_allocation: { label: 'تخصيص مخزون متاح للطلب', badgeClass: 'bg-teal-100 text-teal-900' },
    supplier_receipt: { label: 'استلام من المورد للمخزن', badgeClass: 'bg-indigo-100 text-indigo-900' },
    external_direct: { label: 'توفير خارجي مباشر', badgeClass: 'bg-purple-100 text-purple-900' },
    manual_adjustment: { label: 'تعديل مخزون يدوي', badgeClass: 'bg-amber-100 text-amber-900' },
  };

  const filteredProducts = products.filter((product) => {
    if (!showInactive && product.isActive === false) return false;
    const q = searchTerm.trim().toLowerCase();
    const matchesSearch =
      !q ||
      product.name.toLowerCase().includes(q) ||
      (product.code || '').toLowerCase().includes(q) ||
      (product.description || '').toLowerCase().includes(q);
    const matchesCategory =
      categoryFilter === 'الكل' ||
      product.categoryId === categoryFilter ||
      product.categoryName === categoryFilter;
    const matchesGrade = gradeFilter === 'الكل' || product.grade === gradeFilter;
    return matchesSearch && matchesCategory && matchesGrade;
  });

  const handleCategoryChangeInAdd = (nextCatId: string) => {
    setCategoryId(nextCatId);
    const cat = categories.find((c) => c.id === nextCatId);
    if (cat) {
      setUnit(cat.defaultUnit || 'قطعة');
      const eligible = resolveCategoryDefaultCommissionEligible(
        cat.id,
        cat.name,
        commissionConfig,
        categories
      );
      setNewIsCommissionEligible(eligible);
      setNewCommissionMode(eligible ? 'inherit_rep' : 'none');
      if (cat.id !== 'cat-oils') {
        setGrade('');
      } else if (!grade) {
        setGrade('عالي (Code A)');
      }
    }
  };

  const openAddModal = () => {
    setModalError(null);
    setCode('');
    setName('');
    const defaultCat = activeCategories[0] || categories[0];
    if (defaultCat) {
      handleCategoryChangeInAdd(defaultCat.id);
    } else {
      setCategoryId('cat-oils');
      setUnit('mg');
    }
    setDescription('');
    setPricePerMg('20');
    setCostPrice('');
    setStock('0');
    setIsActive(true);
    setShowAddModal(true);
  };

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setModalError(null);
    setIsSavingModal(true);
    try {
      const cat = categories.find((c) => c.id === categoryId);
      const payload: Partial<Omit<Product, 'id'>> & Pick<Product, 'name' | 'pricePerMg' | 'stock'> = {
        code: code.trim() || undefined,
        name: name.trim(),
        categoryId,
        categoryName: cat?.name || 'الزيوت العطرية',
        description: description.trim() || undefined,
        unit: unit.trim() || 'mg',
        grade: categoryId === 'cat-oils' ? grade || 'عالي (Code A)' : grade || 'قياسي',
        pricePerMg: parseFloat(pricePerMg) || 0,
        costPrice: costPrice.trim() !== '' ? parseFloat(costPrice) : null,
        stock: parseFloat(stock) || 0,
        isActive,
      };

      if (isOwner) {
        payload.isCommissionEligible = newIsCommissionEligible;
        payload.commissionMode = newIsCommissionEligible ? newCommissionMode : 'none';
        payload.customCommissionRate =
          newCommissionMode === 'fixed_rate' ? (parseFloat(newCustomCommRate) || 0) / 100 : null;
        payload.customCommissionFixed =
          newCommissionMode === 'fixed_per_unit' ? parseFloat(newCustomCommFixed) || 0 : null;
      }

      await onAddProduct(payload);
      setShowAddModal(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'تعذر حفظ الصنف الجديد.');
    } finally {
      setIsSavingModal(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setModalError(null);
    setIsSavingModal(true);
    try {
      const payloadToSave: Product = { ...editingProduct };
      if (!isOwner) {
        // Non-owners do not send commission rule changes
        const original = products.find((p) => p.id === editingProduct.id);
        if (original) {
          payloadToSave.isCommissionEligible = original.isCommissionEligible;
          payloadToSave.commissionMode = original.commissionMode;
          payloadToSave.customCommissionRate = original.customCommissionRate;
          payloadToSave.customCommissionFixed = original.customCommissionFixed;
        }
      }
      await onUpdateProduct(payloadToSave);
      setEditingProduct(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'تعذر تحديث الصنف.');
    } finally {
      setIsSavingModal(false);
    }
  };

  const openProductActionModal = async (
    product: Product,
    kind: 'archive' | 'unarchive' | 'delete'
  ) => {
    setActionProduct(product);
    setActionKind(kind);
    setActionUsage(null);
    setActionReason('');
    setDeleteConfirmPassword('');
    setActionError(null);
    setLoadingUsage(true);
    try {
      const usage = await apiClient.getProductUsage(product.id);
      setActionUsage(usage);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر فحص ارتباطات المنتج.');
    } finally {
      setLoadingUsage(false);
    }
  };

  const closeProductActionModal = () => {
    if (executingAction) return;
    setActionProduct(null);
    setActionKind(null);
    setActionUsage(null);
    setActionError(null);
    setDeleteConfirmPassword('');
    setActionReason('');
  };

  const handleConfirmProductAction = async (overrideKind?: 'archive' | 'unarchive' | 'delete') => {
    const kind = overrideKind || actionKind;
    if (!actionProduct || !kind || executingAction) return;
    setActionError(null);
    setExecutingAction(true);
    try {
      if (kind === 'archive' || kind === 'unarchive') {
        if (!onArchiveProduct) return;
        await onArchiveProduct(actionProduct.id, kind === 'unarchive', actionReason.trim() || undefined);
      } else if (kind === 'delete') {
        if (!onDeleteProduct) return;
        await onDeleteProduct(actionProduct.id, deleteConfirmPassword.trim() || undefined);
      }
      setActionProduct(null);
      setActionKind(null);
      setActionUsage(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.requiresOwnerReauth) {
        setActionError('يرجى إدخال كلمة مرور المالك الرئيسي لتأكيد الحذف النهائي.');
      } else {
        setActionError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية.');
      }
    } finally {
      setExecutingAction(false);
    }
  };

  const archivedCount = useMemo(
    () => products.filter((p) => p.isActive === false).length,
    [products]
  );

  const oilLowThreshold = generalSettings?.lowStockThresholdOils ?? 5000;
  const otherLowThreshold = generalSettings?.lowStockThresholdOther ?? 50;

  return (
    <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300">
      {/* Top Filter and Actions */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80 space-y-3.5">
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث باسم الصنف أو الكود أو الوصف..."
              className="w-full min-h-[48px] pr-12 pl-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200/80 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="accent-[#0A468C]"
              />
              <span>إظهار المؤرشفة / الموقوفة ({archivedCount})</span>
            </label>

            {isOwner && onOpenPdfImport && (
              <button
                type="button"
                onClick={onOpenPdfImport}
                className="min-h-[48px] bg-[#072F5F] hover:bg-[#0A468C] text-white px-4 py-3 rounded-2xl font-black shadow-md transition-all flex items-center justify-center gap-2 text-xs sm:text-sm whitespace-nowrap"
              >
                <FileUp className="w-4 h-4 text-blue-200" />
                استيراد قائمة أسعار PDF
              </button>
            )}

            {canEdit && (
              <button
                onClick={openAddModal}
                className="min-h-[48px] bg-[#0A468C] text-white px-5 py-3 rounded-2xl font-black shadow-md hover:bg-[#072F5F] transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                إضافة صنف جديد
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCategoryFilter('الكل')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-xl font-black text-xs whitespace-nowrap transition-all flex items-center gap-1.5 ${
              categoryFilter === 'الكل'
                ? 'bg-[#072F5F] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>الكل ({products.filter((p) => showInactive || p.isActive !== false).length})</span>
          </button>
          {categories.map((cat) => {
            const count = products.filter(
              (p) => (showInactive || p.isActive !== false) && p.categoryId === cat.id
            ).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl font-black text-xs whitespace-nowrap transition-all ${
                  categoryFilter === cat.id
                    ? 'bg-[#0A468C] text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.name} ({count})
              </button>
            );
          })}
        </div>

        {/* Grade Filter (shown when viewing All or Oils) */}
        {(categoryFilter === 'الكل' || categoryFilter === 'cat-oils') && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="text-[11px] font-bold text-slate-500 ml-1">درجة الزيت:</span>
            {['الكل', 'عالي (Code A)', 'وسط (Code B)', 'تجاري (Code C)'].map((g) => (
              <button
                key={g}
                onClick={() => setGradeFilter(g)}
                className={`min-h-[34px] px-3 py-1 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                  gradeFilter === g
                    ? 'bg-blue-100 text-[#072F5F] border border-blue-200'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {filteredProducts.map((product) => {
          const unitLabel = product.unit || 'mg';
          const isOil = product.categoryId === 'cat-oils' || product.categoryName.includes('زيت');
          const threshold = isOil ? oilLowThreshold : otherLowThreshold;
          const maxBar = isOil ? 20000 : 500;
          const isLowStock = product.stock < threshold;

          return (
            <div
              key={product.id}
              className={`bg-white p-5 sm:p-7 rounded-3xl sm:rounded-[2.5rem] shadow-sm border transition-all hover:shadow-md flex flex-col justify-between ${
                product.isActive === false
                  ? 'border-red-200 bg-red-50/20 opacity-80'
                  : 'border-slate-200/80 hover:border-blue-200'
              }`}
            >
              <div>
                <div className="flex justify-between items-start gap-2 mb-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2.5 py-1 rounded-xl text-[11px] font-black bg-blue-100 text-[#072F5F] border border-blue-200">
                      {product.categoryName || 'الزيوت العطرية'}
                    </span>
                    {product.grade && product.grade !== 'قياسي' && (
                      <span
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-black ${
                          product.grade.includes('Code A')
                            ? 'bg-amber-100 text-amber-900 border border-amber-200'
                            : product.grade.includes('Code B')
                              ? 'bg-sky-100 text-sky-900 border border-sky-200'
                              : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {product.grade}
                      </span>
                    )}
                    {product.isActive === false && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-red-100 text-red-700">
                        مؤرشف / موقوف
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 bg-blue-50 text-[#0A468C] rounded-2xl shrink-0">
                    {isOil ? <Droplets className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                  </div>
                </div>

                <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-0.5">{product.name}</h3>
                <p className="text-xs text-slate-500 font-bold mb-1.5 tabular-nums">
                  كود الصنف: <span dir="ltr" className="text-[#072F5F]">{product.code || `OIL-${product.id}`}</span> · الوحدة: {unitLabel}
                </p>
                {(() => {
                  const conflict = detectCatalogCategoryConflict(product, categories);
                  if (!conflict) return null;
                  return (
                    <div className="mb-2 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>
                        ملاحظة تصنيف: الاسم يطابق غالباً «{conflict.suggestedCategoryName}»
                      </span>
                    </div>
                  );
                })()}
                {product.description && (
                  <p className="text-xs text-slate-500 font-bold mb-3 line-clamp-2">{product.description}</p>
                )}

                <div className="grid grid-cols-2 gap-3 mb-3.5 mt-3">
                  <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
                    <p className="text-xs font-bold text-slate-500 mb-0.5">سعر البيع ({unitLabel})</p>
                    <p className="text-lg sm:text-xl font-black text-[#072F5F] tabular-nums">
                      {product.pricePerMg} <span className="text-xs font-bold">ج.م</span>
                    </p>
                    {product.costPrice !== undefined && product.costPrice !== null && (
                      <p className="text-[10px] font-bold text-slate-500 mt-0.5 tabular-nums">
                        التكلفة: {product.costPrice} ج.م
                      </p>
                    )}
                  </div>
                  <div
                    className={`p-3.5 rounded-2xl border ${
                      isLowStock ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200/60'
                    }`}
                  >
                    <p className="text-xs font-bold text-slate-500 mb-0.5">المخزون المتاح</p>
                    <p
                      className={`text-lg sm:text-xl font-black tabular-nums ${
                        isLowStock ? 'text-amber-700' : 'text-slate-900'
                      }`}
                    >
                      {product.stock.toLocaleString()}{' '}
                      <span className="text-xs font-bold">{unitLabel}</span>
                    </p>
                  </div>
                </div>

                {/* Commission Eligibility Pill */}
                <div className="mb-3.5 flex items-center justify-between text-[11px] font-bold">
                  <span
                    className={`px-2.5 py-1 rounded-xl flex items-center gap-1 ${
                      product.isCommissionEligible
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Award className="w-3.5 h-3.5" />
                    {product.isCommissionEligible
                      ? product.commissionMode === 'fixed_rate'
                        ? `عمولة مخصصة (${((product.customCommissionRate || 0) * 100).toFixed(1)}%)`
                        : product.commissionMode === 'fixed_per_unit'
                          ? `عمولة ثابتة (${product.customCommissionFixed || 0} ج.م / ${unitLabel})`
                          : 'خاضع لعمولة السيلز'
                      : 'صنف بدون عمولة'}
                  </span>
                </div>

                {/* Stock progress */}
                <div className="space-y-1.5 mb-4">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-500">التوفر بالمستودع</span>
                    <span className={isLowStock ? 'text-amber-700' : 'text-[#0A468C]'}>
                      {isLowStock ? 'مخزون منخفض' : 'متوفر بشكل جيد'}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isLowStock ? 'bg-amber-500' : 'bg-[#0A468C]'}`}
                      style={{ width: `${Math.min(100, (product.stock / maxBar) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModalError(null);
                      setEditingProduct({ ...product });
                    }}
                    className="min-h-[42px] flex-1 sm:flex-initial justify-center text-xs font-black text-[#0A468C] bg-blue-50 hover:bg-[#0A468C] hover:text-white px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5"
                  >
                    <Edit3 className="w-4 h-4" />
                    تعديل
                  </button>
                  {onArchiveProduct && (
                    <button
                      type="button"
                      onClick={() =>
                        void openProductActionModal(
                          product,
                          product.isActive === false ? 'unarchive' : 'archive'
                        )
                      }
                      className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                        product.isActive === false
                          ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white'
                          : 'bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white'
                      }`}
                      title={product.isActive === false ? 'استعادة المنتج من الأرشيف' : 'أرشفة المنتج'}
                    >
                      {product.isActive === false ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          استعادة
                        </>
                      ) : (
                        <>
                          <Archive className="w-3.5 h-3.5" />
                          أرشفة
                        </>
                      )}
                    </button>
                  )}
                  {isOwner && onDeleteProduct && (
                    <button
                      type="button"
                      onClick={() => void openProductActionModal(product, 'delete')}
                      className="min-h-[42px] px-3 py-2 rounded-xl text-xs font-black bg-red-50 text-red-700 hover:bg-red-600 hover:text-white transition-all flex items-center gap-1.5"
                      title="حذف نهائي للمنتج (للمالك فقط إذا لم يكن مرتبطاً بفواتير أو حركات)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      حذف
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Collapsible Stock & Sourcing Movement Log */}
      <div className="bg-white rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMovements((prev) => !prev)}
          className="w-full px-5 sm:px-7 py-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition-all text-right"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-[#0A468C]">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                سجل حركات المخزون والتوريد الأخير
              </h3>
              <p className="text-[11px] font-bold text-slate-500">
                متابعة الخصم من المستودع، الاستلام من المورد، والتوفير الخارجي المباشر
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-black text-[#0A468C]">
            <span>{showMovements ? 'إخفاء' : 'عرض السجل'}</span>
            {showMovements ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {showMovements && (
          <div className="border-t border-slate-100 p-4 sm:p-6 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600 tabular-nums">
                عدد الحركات المعروضة: {movements.length}
              </span>
              <button
                type="button"
                onClick={() => void loadMovements()}
                disabled={loadingMovements}
                className="min-h-[38px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-[#072F5F] rounded-xl text-xs font-black flex items-center gap-1.5"
              >
                <RefreshCcw className={`w-3.5 h-3.5 ${loadingMovements ? 'animate-spin' : ''}`} />
                تحديث السجل
              </button>
            </div>

            {movementsError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700">
                {movementsError}
              </div>
            )}

            {loadingMovements && movements.length === 0 ? (
              <div className="py-8 text-center text-xs font-bold text-slate-500">
                جاري تحميل سجل حركات المخزون...
              </div>
            ) : movements.length === 0 ? (
              <div className="py-8 text-center text-xs font-bold text-slate-500">
                لا توجد حركات مخزون أو توريد مسجلة بعد.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-0.5">
                {movements.slice(0, 60).map((mv) => {
                  const meta = movementLabelMap[mv.movementType] || {
                    label: mv.movementType,
                    badgeClass: 'bg-slate-100 text-slate-700',
                  };
                  const mvUnit = mv.unit || 'mg';
                  return (
                    <div
                      key={mv.id}
                      className="bg-white p-3.5 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${meta.badgeClass}`}>
                            {meta.label}
                          </span>
                          <span className="font-black text-slate-900">
                            {mv.productName} {mv.grade ? `(${mv.grade})` : ''}
                          </span>
                          {mv.orderId && (
                            <span dir="ltr" className="text-[11px] font-black text-[#0A468C] tabular-nums">
                              #{mv.orderId}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-500">
                          {mv.sourcingSource ? `${mv.sourcingSource}` : ''}
                          {mv.supplierName ? ` · المورد: ${mv.supplierName}` : ''}
                          {mv.note ? ` · ${mv.note}` : ''}
                          {mv.actorName ? ` · بواسطة: ${mv.actorName}` : ''}
                        </p>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0 tabular-nums">
                        <span
                          dir="ltr"
                          className={`text-xs font-black ${
                            mv.quantityDelta > 0
                              ? 'text-emerald-700'
                              : mv.quantityDelta < 0
                                ? 'text-red-700'
                                : 'text-purple-800'
                          }`}
                        >
                          {mv.quantityDelta > 0
                            ? `+${mv.quantityDelta.toLocaleString()}`
                            : mv.quantityDelta.toLocaleString()}{' '}
                          {mvUnit}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500">
                          الرصيد: {mv.previousStock.toLocaleString()} ← {mv.newStock.toLocaleString()} {mvUnit}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">
                          {new Date(mv.createdAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Product Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-xl rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-8 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg sm:text-xl font-black text-slate-900">إضافة صنف جديد للكتالوج</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={(e) => void handleSaveNew(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">التصنيف *</label>
                  <select
                    value={categoryId}
                    onChange={(e) => handleCategoryChangeInAdd(e.target.value)}
                    className="w-full min-h-[46px] px-3 py-2 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">كود الصنف (اختياري)</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="توليد تلقائي إن تُرك فارغاً"
                    className="w-full min-h-[46px] px-3 py-2 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">وحدة البيع *</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as ProductUnit)}
                    className="w-full min-h-[46px] px-3 py-2 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  >
                    {PRODUCT_UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم الصنف *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: زجاجة كرستال 100 مل أو زيت مسك الطهارة..."
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  required
                />
              </div>

              {categoryId === 'cat-oils' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">درجة النقاوة والجودة</label>
                  <select
                    value={grade}
                    onChange={(e) => setGrade(e.target.value as OilGrade)}
                    className="w-full min-h-[46px] px-4 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  >
                    <option value="عالي (Code A)">عالي النقاوة (Code A) - للماركات الفاخرة</option>
                    <option value="وسط (Code B)">وسط (Code B) - للاستخدام المتوازن</option>
                    <option value="تجاري (Code C)">تجاري (Code C) - للإنتاج الاقتصادي</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الوصف / المواصفات (اختياري)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="مثال: عبوة زجاج شفاف ببخاخ ذهبي كرتونة 100 قطعة"
                  className="w-full min-h-[44px] px-4 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    سعر البيع / {unit}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={pricePerMg}
                    onChange={(e) => setPricePerMg(e.target.value)}
                    className="w-full min-h-[46px] px-3 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm tabular-nums"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">سعر التكلفة (اختياري)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="—"
                    className="w-full min-h-[46px] px-3 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    الرصيد الابتدائي ({unit})
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="w-full min-h-[46px] px-3 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm tabular-nums"
                    required
                  />
                </div>
              </div>

              {isOwner && (
                <div className="p-3.5 bg-blue-50/70 rounded-2xl border border-blue-200 space-y-2.5 text-xs">
                  <p className="font-black text-[#072F5F]">إعدادات العمولة (للمالك الرئيسي فقط)</p>
                  <label className="flex items-center gap-2 cursor-pointer font-bold">
                    <input
                      type="checkbox"
                      checked={newIsCommissionEligible}
                      onChange={(e) => setNewIsCommissionEligible(e.target.checked)}
                      className="accent-[#0A468C]"
                    />
                    <span>الصنف خاضع لعمولة المندوبين</span>
                  </label>
                  {newIsCommissionEligible && (
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={newCommissionMode}
                        onChange={(e) => setNewCommissionMode(e.target.value as CommissionMode)}
                        className="min-h-[38px] px-2.5 bg-white border border-blue-200 rounded-xl font-bold"
                      >
                        <option value="inherit_rep">يرث نسبة المندوب</option>
                        <option value="fixed_rate">نسبة مخصصة %</option>
                        <option value="fixed_per_unit">مبلغ ثابت / {unit}</option>
                      </select>
                      {newCommissionMode === 'fixed_rate' && (
                        <input
                          type="number"
                          step="0.1"
                          value={newCustomCommRate}
                          onChange={(e) => setNewCustomCommRate(e.target.value)}
                          placeholder="النسبة %"
                          className="min-h-[38px] px-2.5 bg-white border border-blue-200 rounded-xl font-black tabular-nums"
                        />
                      )}
                      {newCommissionMode === 'fixed_per_unit' && (
                        <input
                          type="number"
                          step="0.1"
                          value={newCustomCommFixed}
                          onChange={(e) => setNewCustomCommFixed(e.target.value)}
                          placeholder="المبلغ ج.م"
                          className="min-h-[38px] px-2.5 bg-white border border-blue-200 rounded-xl font-black tabular-nums"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingModal}
                className="w-full min-h-[50px] py-3.5 bg-[#0A468C] text-white rounded-2xl font-black text-base hover:bg-[#072F5F] transition-all mt-2 disabled:opacity-60"
              >
                {isSavingModal ? 'جاري الحفظ...' : 'حفظ الصنف في المستودع'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-xl rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-8 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900">تعديل {editingProduct.name}</h3>
                <p className="text-xs font-bold text-[#0A468C]">
                  {editingProduct.categoryName} · {editingProduct.unit}
                </p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">التصنيف</label>
                  <select
                    value={editingProduct.categoryId}
                    onChange={(e) => {
                      const cat = categories.find((c) => c.id === e.target.value);
                      setEditingProduct({
                        ...editingProduct,
                        categoryId: e.target.value,
                        categoryName: cat?.name || editingProduct.categoryName,
                      });
                    }}
                    className="w-full min-h-[46px] px-3 py-2 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">الكود</label>
                  <input
                    type="text"
                    value={editingProduct.code || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, code: e.target.value })}
                    className="w-full min-h-[46px] px-3 py-2 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">الوحدة</label>
                  <select
                    value={editingProduct.unit || 'mg'}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, unit: e.target.value as ProductUnit })
                    }
                    className="w-full min-h-[46px] px-3 py-2 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                  >
                    {PRODUCT_UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم الصنف</label>
                <input
                  type="text"
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الوصف / الملاحظات</label>
                <input
                  type="text"
                  value={editingProduct.description || ''}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, description: e.target.value })
                  }
                  className="w-full min-h-[44px] px-4 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    سعر البيع ({editingProduct.unit || 'mg'})
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={editingProduct.pricePerMg}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        pricePerMg: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full min-h-[46px] px-3 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm tabular-nums"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">التكلفة</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={editingProduct.costPrice ?? ''}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        costPrice: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="w-full min-h-[46px] px-3 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    المخزون ({editingProduct.unit || 'mg'})
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={editingProduct.stock}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        stock: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full min-h-[46px] px-3 py-2.5 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-sm tabular-nums"
                    required
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl cursor-pointer text-xs font-bold">
                <input
                  type="checkbox"
                  checked={editingProduct.isActive !== false}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, isActive: e.target.checked })
                  }
                  className="w-4 h-4 accent-[#0A468C]"
                />
                <span>الصنف نشط ومتاح في فواتير البيع</span>
              </label>

              {isOwner && (
                <div className="p-3.5 bg-blue-50/70 rounded-2xl border border-blue-200 space-y-2 text-xs">
                  <p className="font-black text-[#072F5F]">إعدادات العمولة (للمالك الرئيسي فقط)</p>
                  <label className="flex items-center gap-2 cursor-pointer font-bold">
                    <input
                      type="checkbox"
                      checked={editingProduct.isCommissionEligible}
                      onChange={(e) =>
                        setEditingProduct({
                          ...editingProduct,
                          isCommissionEligible: e.target.checked,
                          commissionMode: e.target.checked
                            ? editingProduct.commissionMode === 'none'
                              ? 'inherit_rep'
                              : editingProduct.commissionMode
                            : 'none',
                        })
                      }
                      className="accent-[#0A468C]"
                    />
                    <span>خاضع للعمولة</span>
                  </label>
                  {editingProduct.isCommissionEligible && (
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={editingProduct.commissionMode}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            commissionMode: e.target.value as CommissionMode,
                          })
                        }
                        className="min-h-[38px] px-2.5 bg-white border border-blue-200 rounded-xl font-bold"
                      >
                        <option value="inherit_rep">يرث نسبة المندوب</option>
                        <option value="fixed_rate">نسبة مخصصة %</option>
                        <option value="fixed_per_unit">مبلغ ثابت / {editingProduct.unit}</option>
                      </select>
                      {editingProduct.commissionMode === 'fixed_rate' && (
                        <input
                          type="number"
                          step="0.1"
                          value={Number(((editingProduct.customCommissionRate || 0) * 100).toFixed(2))}
                          onChange={(e) =>
                            setEditingProduct({
                              ...editingProduct,
                              customCommissionRate: (parseFloat(e.target.value) || 0) / 100,
                            })
                          }
                          className="min-h-[38px] px-2.5 bg-white border border-blue-200 rounded-xl font-black tabular-nums"
                        />
                      )}
                      {editingProduct.commissionMode === 'fixed_per_unit' && (
                        <input
                          type="number"
                          step="0.1"
                          value={editingProduct.customCommissionFixed ?? 0}
                          onChange={(e) =>
                            setEditingProduct({
                              ...editingProduct,
                              customCommissionFixed: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="min-h-[38px] px-2.5 bg-white border border-blue-200 rounded-xl font-black tabular-nums"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingModal}
                className="w-full min-h-[50px] py-3.5 bg-[#0A468C] text-white rounded-2xl font-black text-base hover:bg-[#072F5F] transition-all mt-2 disabled:opacity-60"
              >
                {isSavingModal ? 'جاري التحديث...' : 'تحديث بيانات الصنف'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Archive / Unarchive / Safe Delete Confirmation Modal */}
      {actionProduct && actionKind && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[700] font-cairo"
          dir="rtl"
        >
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-7 pb-safe shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                {actionKind === 'delete' ? (
                  <ShieldAlert className="w-5 h-5 text-red-600" />
                ) : actionKind === 'archive' ? (
                  <Archive className="w-5 h-5 text-amber-600" />
                ) : (
                  <RotateCcw className="w-5 h-5 text-emerald-600" />
                )}
                <span>
                  {actionKind === 'delete'
                    ? 'حذف الصنف نهائياً من الكتالوج'
                    : actionKind === 'archive'
                      ? 'تأكيد أرشفة الصنف'
                      : 'تأكيد استعادة الصنف من الأرشيف'}
                </span>
              </h3>
              <button
                type="button"
                onClick={closeProductActionModal}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1">
              <p className="font-black text-slate-900 text-sm">{actionProduct.name}</p>
              <p className="font-bold text-slate-600 tabular-nums">
                الكود: <span dir="ltr">{actionProduct.code}</span> · التصنيف: {actionProduct.categoryName} · الرصيد الحالي: {actionProduct.stock.toLocaleString()} {actionProduct.unit}
              </p>
            </div>

            {loadingUsage ? (
              <div className="p-4 text-center text-xs font-bold text-slate-500 flex items-center justify-center gap-2">
                <RefreshCcw className="w-4 h-4 animate-spin text-[#0A468C]" />
                جاري فحص ارتباطات الصنف بالفواتير وسجل حركات المخزون...
              </div>
            ) : actionUsage && (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-[11px] font-bold text-[#0A468C]">الفواتير المرتبطة</p>
                    <p className="text-lg font-black text-[#072F5F] tabular-nums">{actionUsage.ordersCount}</p>
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-[11px] font-bold text-[#0A468C]">حركات المخزون المسجلة</p>
                    <p className="text-lg font-black text-[#072F5F] tabular-nums">{actionUsage.stockMovementsCount}</p>
                  </div>
                </div>

                {actionKind === 'delete' && !actionUsage.canDelete && (
                  <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-amber-950 font-bold space-y-1.5">
                    <p className="font-black flex items-center gap-1.5 text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      ممنوع الحذف النهائي حفاظاً على سلامة السجلات التاريخية
                    </p>
                    <p>
                      هذا الصنف مرتبط بـ {actionUsage.ordersCount} فاتورة و {actionUsage.stockMovementsCount} حركة مخزون. لحماية الفواتير والتقارير التاريخية لا يمكن حذفه نهائياً، ولكن يمكنك **أرشفته** لإخفائه من الفواتير الجديدة مع بقائه محفوظاً في الفواتير السابقة.
                    </p>
                  </div>
                )}

                {actionKind === 'delete' && actionUsage.canDelete && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-900 font-bold space-y-1">
                    <p className="font-black">الصنف غير مستخدم في أي فاتورة أو حركة مخزون.</p>
                    <p>سيتم حذفه نهائياً من قاعدة البيانات وتوثيق العملية في سجل التدقيق الإداري.</p>
                  </div>
                )}

                {actionKind === 'archive' && (
                  <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl text-amber-950 font-bold">
                    عند أرشفة الصنف لن يظهر عند إنشاء فواتير جديدة، بينما يظل محفوظاً بالكامل في الفواتير السابقة والتقارير وسجل المخزون ويمكن استعادته في أي وقت.
                  </div>
                )}

                {actionKind === 'unarchive' && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-950 font-bold">
                    سيعود الصنف نشطاً ومتاحاً للاختيار عند إنشاء فواتير بيع جديدة.
                  </div>
                )}
              </div>
            )}

            {(actionKind === 'archive' || actionKind === 'unarchive') && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظة / سبب الأرشفة (اختياري)
                </label>
                <input
                  type="text"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="مثال: توقف التوريد مؤقتاً..."
                  className="w-full min-h-[42px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                />
              </div>
            )}

            {actionKind === 'delete' && actionUsage?.canDelete && !getOwnerStepUpToken() && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  كلمة مرور تأكيد هوية المالك الرئيسي *
                </label>
                <input
                  type="password"
                  value={deleteConfirmPassword}
                  onChange={(e) => setDeleteConfirmPassword(e.target.value)}
                  placeholder="أدخل كلمة مرور المالك لتنفيذ الحذف النهائي..."
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                />
              </div>
            )}

            {actionError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-black text-red-700">
                {actionError}
              </div>
            )}

            <div className="flex flex-wrap gap-2.5 pt-1">
              {actionKind === 'delete' && actionUsage && !actionUsage.canDelete && onArchiveProduct && (
                <button
                  type="button"
                  disabled={executingAction || loadingUsage}
                  onClick={() => void handleConfirmProductAction('archive')}
                  className="flex-1 min-h-[46px] px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Archive className="w-4 h-4" />
                  {executingAction ? 'جاري الأرشفة...' : 'أرشفة المنتج بدلاً من الحذف'}
                </button>
              )}

              {actionKind === 'delete' && actionUsage?.canDelete && (
                <button
                  type="button"
                  disabled={executingAction || loadingUsage}
                  onClick={() => void handleConfirmProductAction('delete')}
                  className="flex-1 min-h-[46px] px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  {executingAction ? 'جاري الحذف...' : 'تأكيد الحذف النهائي'}
                </button>
              )}

              {(actionKind === 'archive' || actionKind === 'unarchive') && (
                <button
                  type="button"
                  disabled={executingAction || loadingUsage}
                  onClick={() => void handleConfirmProductAction()}
                  className={`flex-1 min-h-[46px] px-4 py-2.5 text-white rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                    actionKind === 'archive'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {actionKind === 'archive' ? 'تأكيد الأرشفة' : 'تأكيد الاستعادة'}
                </button>
              )}

              <button
                type="button"
                disabled={executingAction}
                onClick={closeProductActionModal}
                className="min-h-[46px] px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-xs sm:text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

