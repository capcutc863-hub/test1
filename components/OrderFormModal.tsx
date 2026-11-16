import React, { useState, useMemo } from 'react';
import {
  X, Plus, Trash2, Check, RefreshCcw, User, Phone, MapPin,
  Sparkles, Search, ArrowRight, ShoppingCart, Droplets,
  Package, AlertCircle, Minus, ChevronDown
} from 'lucide-react';
import { Product, SalesRep, OrderItem, OilGrade, Order, Customer } from '../types';

interface OrderFormModalProps {
  products: Product[];
  salesReps: SalesRep[];
  customers?: Customer[];
  currentRep?: SalesRep;
  isAdmin: boolean;
  editingOrder?: Order | null;
  formMode?: 'create' | 'edit' | 'edit-request' | 'approve-override';
  onClose: () => void;
  onSaveOrder: (
    orderData: Omit<Order, 'id' | 'createdAt'>,
    requestReason?: string
  ) => Promise<void> | void;
}

const OIL_GRADES: OilGrade[] = ['عالي (Code A)', 'وسط (Code B)', 'تجاري (Code C)'];

export const OrderFormModal: React.FC<OrderFormModalProps> = ({
  products,
  salesReps,
  customers = [],
  currentRep,
  isAdmin,
  editingOrder = null,
  formMode,
  onClose,
  onSaveOrder
}) => {
  const resolvedMode = formMode || (editingOrder ? 'edit' : 'create');
  const isEditing = resolvedMode !== 'create' && Boolean(editingOrder);
  const isEditRequest = resolvedMode === 'edit-request';
  const isApproveOverride = resolvedMode === 'approve-override';
  const sourceDraft =
    (isEditRequest || isApproveOverride) && editingOrder?.pendingEditRequest
      ? editingOrder.pendingEditRequest
      : editingOrder;

  // Customer Details
  const [customerName, setCustomerName] = useState(sourceDraft?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(sourceDraft?.customerPhone || '');
  const [customerAddress, setCustomerAddress] = useState(sourceDraft?.customerAddress || '');
  const [customerNotes, setCustomerNotes] = useState(sourceDraft?.customerNotes || '');
  const [editReason, setEditReason] = useState(
    editingOrder?.pendingEditRequest?.reason || ''
  );
  const [selectedRepId, setSelectedRepId] = useState(
    sourceDraft?.salesRepId || currentRep?.id || salesReps[0]?.id || ''
  );
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);

  // Cart & Item Addition (supports existing warehouse items OR typing a new/custom item)
  const [cart, setCart] = useState<OrderItem[]>(() =>
    sourceDraft ? sourceDraft.items.map((item) => ({ ...item })) : []
  );
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [itemNameInput, setItemNameInput] = useState<string>(products[0]?.name || '');
  const [itemGrade, setItemGrade] = useState<OilGrade>(products[0]?.grade || 'عالي (Code A)');
  const [itemQuantity, setItemQuantity] = useState<string>('500');
  const [customPrice, setCustomPrice] = useState<string>(
    products[0] ? products[0].pricePerMg.toString() : ''
  );
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [addNewToInventory, setAddNewToInventory] = useState<boolean>(true);

  // Pricing adjustments
  const [discountPercentage, setDiscountPercentage] = useState<number>(
    sourceDraft?.discountPercentage ?? 0
  );
  const [shippingCost, setShippingCost] = useState<number>(
    sourceDraft?.shippingCost ?? 50
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [mobileStep, setMobileStep] = useState<'customer' | 'products' | 'summary'>(
    isEditing ? 'summary' : 'customer'
  );

  // Active items
  const selectedRep = salesReps.find((r) => r.id === selectedRepId) || salesReps[0];
  const matchedProduct = useMemo(() => {
    const cleanInput = itemNameInput.trim().toLowerCase();
    if (!cleanInput) return undefined;
    if (selectedProductId) {
      const byId = products.find(
        (p) => p.id === selectedProductId && p.name.trim().toLowerCase() === cleanInput && p.grade === itemGrade
      );
      if (byId) return byId;
    }
    return products.find(
      (p) => p.name.trim().toLowerCase() === cleanInput && p.grade === itemGrade
    );
  }, [products, selectedProductId, itemNameInput, itemGrade]);

  const isCustomNewItem = itemNameInput.trim().length > 0 && !matchedProduct;

  // Filter products by typed name
  const filteredProducts = useMemo(() => {
    const q = itemNameInput.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.grade.toLowerCase().includes(q)
    );
  }, [products, itemNameInput]);

  // Filter customer autocomplete
  const customerSuggestions = useMemo(() => {
    if (!customerName.trim() || customerName.length < 2) return [];
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(customerName.toLowerCase()) ||
          c.phone.includes(customerName)
      )
      .slice(0, 4);
  }, [customers, customerName]);

  const handleSelectCustomerSuggestion = (c: Customer) => {
    setCustomerName(c.name);
    setCustomerPhone(c.phone);
    if (c.address) setCustomerAddress(c.address);
    setShowCustomerSuggestions(false);
  };

  const handleSelectWarehouseProduct = (prod: Product) => {
    setSelectedProductId(prod.id);
    setItemNameInput(prod.name);
    setItemGrade(prod.grade);
    setCustomPrice(prod.pricePerMg.toString());
    setShowProductDropdown(false);
  };

  // Add Item to Cart (works for both warehouse products and custom/new oils)
  const handleAddItem = () => {
    setFormError(null);
    const cleanName = itemNameInput.trim();
    if (!cleanName) {
      setFormError('يرجى كتابة اسم الصنف أو اختياره من المخزن');
      return;
    }

    const qty = parseFloat(itemQuantity);
    if (isNaN(qty) || qty <= 0) {
      setFormError('يرجى إدخال كمية صحيحة بالمليجرام (mg)');
      return;
    }

    const price = customPrice !== '' ? parseFloat(customPrice) : matchedProduct?.pricePerMg ?? NaN;
    if (isNaN(price) || price <= 0) {
      setFormError('يرجى إدخال سعر صحيح للـ mg');
      return;
    }

    const targetGrade = matchedProduct ? matchedProduct.grade : itemGrade;
    const isCustom = !matchedProduct;

    const existingIndex = cart.findIndex(
      (item) =>
        item.productName.trim().toLowerCase() === cleanName.toLowerCase() &&
        item.grade === targetGrade
    );

    if (existingIndex >= 0) {
      const updated = [...cart];
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: updated[existingIndex].quantity + qty,
        price,
        ...(isCustom ? { isCustom: true, addToInventory: addNewToInventory } : {}),
      };
      setCart(updated);
    } else {
      const newItem: OrderItem = {
        productName: matchedProduct ? matchedProduct.name : cleanName,
        grade: targetGrade,
        quantity: qty,
        price,
        ...(isCustom ? { isCustom: true, addToInventory: addNewToInventory } : {}),
      };
      setCart([...cart, newItem]);
    }

    setItemQuantity('500');
    if (isCustom) {
      setItemNameInput('');
      setSelectedProductId('');
      setCustomPrice('');
    }
  };

  const handleRemoveItem = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const handleUpdateItemQty = (index: number, delta: number) => {
    setCart(
      cart.map((item, idx) => {
        if (idx !== index) return item;
        const newQty = Math.max(50, item.quantity + delta);
        return { ...item, quantity: newQty };
      })
    );
  };

  // Calculations
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const maxDiscount = selectedRep?.maxDiscountAllowed || (isAdmin ? 50 : 10);
  const actualDiscountPercent = Math.min(maxDiscount, Math.max(0, discountPercentage));
  const discountAmount = (subtotal * actualDiscountPercent) / 100;
  const totalAmount = Math.max(0, subtotal - discountAmount + shippingCost);
  const commissionRate = selectedRep?.customCommissionRate || 0.05;
  const commission = (subtotal - discountAmount) * commissionRate;

  // Submit Order (Create or Update)
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);
    if (!customerName.trim()) {
      setFormError('يرجى إدخال اسم العميل أو المؤسسة');
      setMobileStep('customer');
      return;
    }
    if (cart.length === 0) {
      setFormError('يرجى إضافة صنف زيت واحد على الأقل إلى الفاتورة');
      setMobileStep('products');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSaveOrder(
        {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: customerAddress.trim(),
          customerNotes: customerNotes.trim(),
          salesRepId: selectedRep?.id || '',
          salesRepName: selectedRep?.name || '',
          items: cart,
          subtotal,
          discountPercentage: actualDiscountPercent,
          discountAmount,
          shippingCost,
          totalAmount,
          status: editingOrder ? editingOrder.status : 'قيد التنفيذ',
          commission,
        },
        editReason.trim() || undefined
      );
      onClose();
    } catch (err) {
      console.error(err);
      setFormError(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الفاتورة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo overflow-hidden"
      dir="rtl"
    >
      {/* Main Container - Full-height bottom sheet on mobile, rounded modal on desktop */}
      <div className="bg-white w-full max-w-5xl rounded-t-3xl sm:rounded-[2.5rem] shadow-2xl flex flex-col h-[94vh] sm:h-auto sm:max-h-[90vh] overflow-hidden border border-blue-900/10 animate-in slide-in-from-bottom duration-300">
        {/* Top Header */}
        <div className="bg-[#072F5F] text-white px-5 py-3.5 sm:px-8 sm:py-5 flex justify-between items-center shrink-0 border-b border-blue-800/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-500/20 text-blue-200 rounded-xl sm:rounded-2xl shrink-0">
              <Droplets className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-black tracking-tight truncate">
                {isEditRequest
                  ? `طلب تعديل / إضافة لفاتورة #${editingOrder!.id.slice(0, 10)}`
                  : isApproveOverride
                  ? `مراجعة وتعديل قبل الموافقة #${editingOrder!.id.slice(0, 10)}`
                  : isEditing
                  ? `تعديل فاتورة #${editingOrder!.id.slice(0, 10)}`
                  : 'إصدار فاتورة بيع جديدة'}
              </h2>
              <p className="text-[11px] text-blue-200/90 font-bold hidden sm:block">
                {isEditRequest
                  ? 'الطلب في حالة "تم التجهيز" — سيُرسل طلب التعديل لمسؤول حالة الطلبات للموافقة'
                  : isApproveOverride
                  ? 'قم بمراجعة أو تعديل البيانات والأصناف ثم اضغط اعتماد للموافقة الفورية'
                  : isEditing
                  ? editingOrder?.status === 'تم التسليم'
                    ? 'تعديل إداري على فاتورة مسلمة — يتم تحديث المخزون والعمولات تلقائياً'
                    : 'تحديث الأصناف والكميات والبيانات مع إعادة احتساب المخزون تلقائياً'
                  : 'تسجيل طلبات وتوزيع زيوت الجملة أو إضافة أصناف جديدة'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-red-500 hover:text-white rounded-2xl transition-all text-blue-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile 3-Step Segmented Switcher */}
        <div className="lg:hidden bg-slate-100 p-1.5 grid grid-cols-3 gap-1.5 shrink-0 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setMobileStep('customer')}
            className={`min-h-[42px] px-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
              mobileStep === 'customer'
                ? 'bg-[#0A468C] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>1. العميل</span>
            {customerName.trim() && <Check className="w-3.5 h-3.5 text-emerald-300 shrink-0" />}
          </button>

          <button
            type="button"
            onClick={() => setMobileStep('products')}
            className={`min-h-[42px] px-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
              mobileStep === 'products'
                ? 'bg-[#0A468C] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>2. الزيوت</span>
            {cart.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] tabular-nums ${
                  mobileStep === 'products' ? 'bg-white text-[#072F5F]' : 'bg-[#0A468C] text-white'
                }`}
              >
                {cart.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMobileStep('summary')}
            className={`min-h-[42px] px-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
              mobileStep === 'summary'
                ? 'bg-[#0A468C] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>3. المراجعة</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row">
          {/* Form Controls Column */}
          <div
            className={`flex-1 p-4 sm:p-7 space-y-5 overflow-y-auto ${
              mobileStep === 'summary' ? 'hidden lg:block' : 'block'
            }`}
          >
            {formError && (
              <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Section 1: Customer Details */}
            <div
              className={`bg-slate-50 p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200/80 space-y-4 ${
                mobileStep === 'customer' ? 'block' : 'hidden lg:block'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <User className="w-4 h-4 text-[#0A468C]" />
                  بيانات العميل المستلم
                </span>
                <span className="text-xs font-bold text-slate-500">حقل الاسم إلزامي *</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Customer Name with Autocomplete */}
                <div className="relative">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    اسم العميل / المتجر
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setShowCustomerSuggestions(true);
                    }}
                    onFocus={() => setShowCustomerSuggestions(true)}
                    placeholder="مثال: مؤسسة لافندر للزيوت"
                    className="w-full min-h-[48px] px-4 py-3 bg-white rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm text-slate-900 transition-all"
                    required
                  />

                  {showCustomerSuggestions && customerSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-2xl shadow-xl border border-blue-200 p-2 z-30 space-y-1">
                      <p className="text-xs font-bold text-[#0A468C] px-2 py-1">
                        عملاء سابقين مطابقين:
                      </p>
                      {customerSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCustomerSuggestion(c)}
                          className="w-full min-h-[44px] text-right p-2.5 hover:bg-blue-50 rounded-xl text-sm flex justify-between items-center transition-all"
                        >
                          <span className="font-bold text-slate-900">{c.name}</span>
                          <span className="text-xs text-slate-500 tabular-nums">{c.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Customer Phone */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    رقم الهاتف للتواصل
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="01XXXXXXXXX"
                      className="w-full min-h-[48px] pr-10 pl-3 py-3 bg-white rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm text-slate-900 tabular-nums"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Customer Address */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    العنوان أو منطقة التسليم
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder="مثال: الموسكي - العتبة، القاهرة"
                      className="w-full min-h-[48px] pr-10 pl-3 py-3 bg-white rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
                    />
                  </div>
                </div>

                {/* Assigned Sales Person */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">مسؤول السيلز</label>
                  {isAdmin ? (
                    <select
                      value={selectedRepId}
                      onChange={(e) => setSelectedRepId(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 bg-white rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
                    >
                      {salesReps.map((rep) => (
                        <option key={rep.id} value={rep.id}>
                          {rep.name} (عمولة: {(rep.customCommissionRate * 100).toFixed(0)}%)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="min-h-[48px] flex items-center px-4 py-3 bg-white rounded-2xl font-bold border border-slate-200 text-base sm:text-sm text-slate-800">
                      {selectedRep?.name || 'سيلز فريق عمل كيما سنت'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: Oil Product Selection OR Free-Text New/Custom Product */}
            <div
              className={`bg-blue-50/60 p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-blue-200/80 space-y-4 ${
                mobileStep === 'products' ? 'block' : 'hidden lg:block'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-black text-[#072F5F] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#0A468C]" />
                  إضافة صنف زيت للفاتورة (من المخزن أو صنف جديد)
                </span>
                {matchedProduct ? (
                  <span className="text-xs font-black text-[#072F5F] bg-white border border-blue-200 px-3 py-1 rounded-xl tabular-nums">
                    المخزون: {matchedProduct.stock.toLocaleString()} mg
                  </span>
                ) : isCustomNewItem ? (
                  <span className="text-xs font-black text-[#0A468C] bg-white border border-blue-300 px-3 py-1 rounded-xl">
                    صنف جديد / طلب مخصوص
                  </span>
                ) : null}
              </div>

              {/* Combo Input: Type product name freely OR pick from warehouse dropdown */}
              <div className="relative space-y-2.5">
                <label className="block text-xs font-bold text-[#072F5F]">
                  اسم الصنف (اكتب اسم الصنف أو اختر من المخزن)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={itemNameInput}
                      onFocus={() => setShowProductDropdown(true)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setItemNameInput(val);
                        setShowProductDropdown(true);
                        const exactMatch = products.find(
                          (p) => p.name.trim().toLowerCase() === val.trim().toLowerCase()
                        );
                        if (exactMatch) {
                          setSelectedProductId(exactMatch.id);
                          setItemGrade(exactMatch.grade);
                          setCustomPrice(exactMatch.pricePerMg.toString());
                        } else {
                          setSelectedProductId('');
                        }
                      }}
                      placeholder="اكتب اسم الزيت أو اختر من القائمة..."
                      className="w-full min-h-[48px] pr-10 pl-10 py-3 bg-white rounded-2xl font-bold outline-none border border-blue-200 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
                    />
                    {itemNameInput && (
                      <button
                        type="button"
                        aria-label="مسح اسم الصنف"
                        onClick={() => {
                          setItemNameInput('');
                          setSelectedProductId('');
                          setCustomPrice('');
                          setShowProductDropdown(true);
                        }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 min-w-[32px] min-h-[32px] flex items-center justify-center text-slate-400 hover:text-slate-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowProductDropdown((prev) => !prev)}
                    className="min-h-[48px] px-3.5 bg-white border border-blue-200 hover:border-[#0A468C] text-[#072F5F] rounded-2xl text-xs font-black flex items-center gap-1 shrink-0"
                    title="عرض كل أصناف المخزن"
                  >
                    <span>المخزن</span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${showProductDropdown ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {/* Searchable Warehouse Dropdown */}
                {showProductDropdown && (
                  <div className="bg-white rounded-2xl shadow-xl border border-blue-200 p-2 max-h-56 overflow-y-auto space-y-1 z-30">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-[11px] font-black text-[#0A468C]">
                        أصناف المخزن ({filteredProducts.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowProductDropdown(false)}
                        className="text-[11px] font-bold text-slate-500 hover:text-slate-900 px-2 py-0.5"
                      >
                        إغلاق
                      </button>
                    </div>

                    {filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectWarehouseProduct(p)}
                        className={`w-full min-h-[46px] text-right px-3 py-2 rounded-xl text-xs flex items-center justify-between gap-2 transition-all ${
                          selectedProductId === p.id
                            ? 'bg-blue-50 border border-blue-200'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-black text-slate-900 truncate">{p.name}</p>
                          <p className="text-[11px] text-slate-500 font-bold">{p.grade}</p>
                        </div>
                        <div className="text-left shrink-0 tabular-nums">
                          <p className="font-black text-[#072F5F]">{p.pricePerMg} ج.م/mg</p>
                          <p className="text-[10px] text-slate-500 font-bold">
                            متاح: {p.stock.toLocaleString()} mg
                          </p>
                        </div>
                      </button>
                    ))}

                    {isCustomNewItem && (
                      <button
                        type="button"
                        onClick={() => setShowProductDropdown(false)}
                        className="w-full min-h-[46px] text-right px-3 py-2.5 bg-blue-50 hover:bg-blue-100 rounded-xl text-xs font-black text-[#072F5F] flex items-center justify-between border border-blue-200"
                      >
                        <span>استخدام "{itemNameInput.trim()}" كصنف جديد / طلب مخصوص</span>
                        <Plus className="w-4 h-4 shrink-0" />
                      </button>
                    )}
                  </div>
                )}

                {/* Grade & Auto-Add to Warehouse option when typing a custom/new item */}
                {isCustomNewItem && (
                  <div className="bg-white p-3.5 rounded-2xl border border-blue-200 space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-[#072F5F] mb-1.5">
                        درجة الصنف الجديد
                      </label>
                      <select
                        value={itemGrade}
                        onChange={(e) => setItemGrade(e.target.value as OilGrade)}
                        className="w-full min-h-[46px] px-3.5 py-2.5 bg-slate-50 rounded-xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
                      >
                        {OIL_GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-start gap-2.5 cursor-pointer select-none min-h-[40px] p-2 rounded-xl hover:bg-blue-50/60 transition-colors">
                      <input
                        type="checkbox"
                        checked={addNewToInventory}
                        onChange={(e) => setAddNewToInventory(e.target.checked)}
                        className="mt-1 w-4 h-4 accent-[#0A468C] rounded shrink-0"
                      />
                      <span className="text-xs leading-relaxed">
                        <strong className="font-black text-[#072F5F] block">
                          إضافة هذا الصنف تلقائياً إلى المخزن
                        </strong>
                        <span className="text-slate-500 font-bold">
                          سيتم تسجيله في قائمة المخزون تلقائياً، أو أزل التحديد إذا كان طلباً مخصوصاً للفاتورة فقط
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Weight Presets & Input */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-bold text-[#072F5F]">
                    الكمية المطلوبة (mg مليجرام)
                  </label>
                  <span className="text-xs font-bold text-[#0A468C] tabular-nums">
                    {parseFloat(itemQuantity) >= 1000
                      ? `≈ ${(parseFloat(itemQuantity) / 1000).toFixed(1)} جرام`
                      : ''}
                  </span>
                </div>

                {/* Quick Weight Buttons (44px touch targets) */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {['250', '500', '1000', '2500', '5000', '10000'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setItemQuantity(preset)}
                      className={`min-h-[44px] px-2 rounded-xl text-xs font-black transition-all tabular-nums ${
                        itemQuantity === preset
                          ? 'bg-[#0A468C] text-white shadow-sm'
                          : 'bg-white text-[#072F5F] hover:bg-blue-100/60 border border-blue-200'
                      }`}
                    >
                      {preset} mg
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      الكمية (mg)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="1"
                      value={itemQuantity}
                      onChange={(e) => setItemQuantity(e.target.value)}
                      placeholder="الكمية بالمليجرام..."
                      className="w-full min-h-[48px] p-3.5 bg-white rounded-2xl font-black outline-none border border-blue-200 focus:border-[#0A468C] text-base text-[#072F5F] tabular-nums"
                    />
                  </div>

                  {/* Custom or default price */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      السعر للـ mg (ج.م)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0.1"
                        value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)}
                        placeholder={matchedProduct ? `${matchedProduct.pricePerMg}` : 'أدخل السعر للـ mg'}
                        className="w-full min-h-[48px] p-3.5 pl-20 bg-white rounded-2xl font-black outline-none border border-blue-200 focus:border-[#0A468C] text-base text-[#072F5F] tabular-nums"
                      />
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 pointer-events-none">
                        ج.م / mg
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Item Button */}
              <button
                type="button"
                onClick={handleAddItem}
                className="w-full min-h-[50px] py-3.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm sm:text-base transition-all flex items-center justify-center gap-2 shadow-md active:scale-[0.98]"
              >
                <Plus className="w-5 h-5" />
                إضافة الصنف إلى الفاتورة
              </button>

              {/* Mobile Quick Preview of Added Cart Items inside Step 2 */}
              {cart.length > 0 && (
                <div className="lg:hidden bg-white rounded-2xl p-3.5 border border-blue-200 space-y-2">
                  <div className="flex justify-between items-center text-xs font-black text-[#072F5F]">
                    <span>الأصناف المضافة ({cart.length})</span>
                    <button
                      type="button"
                      onClick={() => setMobileStep('summary')}
                      className="text-[#0A468C] underline"
                    >
                      عرض ومراجعة الفاتورة
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {cart.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs bg-slate-50 px-3 py-2 rounded-xl gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-800 block truncate">
                            {item.productName}
                          </span>
                          {item.isCustom && (
                            <span className="text-[10px] font-bold text-[#0A468C]">
                              {item.addToInventory ? 'سيُضاف للمخزن' : 'طلب مخصوص'}
                            </span>
                          )}
                        </div>
                        <span className="font-black text-[#072F5F] tabular-nums whitespace-nowrap">
                          {item.quantity} mg · {(item.quantity * item.price).toLocaleString()} ج.م
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Section 3: Discounts, Shipping & Notes (Desktop) */}
            <div className="hidden lg:grid grid-cols-3 gap-3">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-slate-700">نسبة الخصم (%)</label>
                  <span className="text-[11px] font-bold text-[#0A468C]">حد: {maxDiscount}%</span>
                </div>
                <input
                  type="number"
                  min="0"
                  max={maxDiscount}
                  value={discountPercentage}
                  onChange={(e) =>
                    setDiscountPercentage(
                      Math.min(maxDiscount, Math.max(0, parseFloat(e.target.value) || 0))
                    )
                  }
                  className="w-full min-h-[42px] p-2.5 bg-white rounded-xl font-black outline-none border border-slate-200 text-sm tabular-nums"
                />
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  تكلفة التوصيل (ج.م)
                </label>
                <input
                  type="number"
                  min="0"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full min-h-[42px] p-2.5 bg-white rounded-xl font-black outline-none border border-slate-200 text-sm tabular-nums"
                />
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الطلب</label>
                <input
                  type="text"
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder="ملاحظات شحن خاصة..."
                  className="w-full min-h-[42px] p-2.5 bg-white rounded-xl font-bold outline-none border border-slate-200 text-sm"
                />
              </div>

              {isEditRequest && (
                <div className="col-span-3 bg-blue-50 p-3.5 rounded-2xl border border-blue-200">
                  <label className="block text-xs font-black text-[#072F5F] mb-1">
                    سبب طلب التعديل / رسالة لمسؤول الطلبات (اختياري)
                  </label>
                  <input
                    type="text"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="مثال: العميل طلب زيادة الكمية أو إضافة صنف جديد..."
                    className="w-full min-h-[44px] px-3.5 py-2 bg-white rounded-xl font-bold outline-none border border-blue-200 focus:border-[#0A468C] text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Cart & Financial Breakdown Column */}
          <div
            className={`w-full lg:w-96 bg-[#072F5F] text-white p-4 sm:p-7 flex flex-col justify-between shrink-0 border-t lg:border-t-0 lg:border-r border-blue-800/40 ${
              mobileStep === 'summary' ? 'flex-1 flex' : 'hidden lg:flex'
            }`}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-blue-200" />
                  <h3 className="text-base sm:text-lg font-black">أصناف الفاتورة</h3>
                </div>
                <span className="bg-blue-500/20 text-blue-100 text-xs px-3 py-1 rounded-xl font-black tabular-nums">
                  {cart.length} أصناف
                </span>
              </div>

              {/* Mobile-only Discounts, Shipping & Notes inside Summary Step */}
              <div className="lg:hidden grid grid-cols-2 gap-2.5 bg-white/10 p-3.5 rounded-2xl">
                <div>
                  <label className="block text-xs font-bold text-blue-100 mb-1">
                    الخصم % (حد {maxDiscount}%)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={maxDiscount}
                    value={discountPercentage}
                    onChange={(e) =>
                      setDiscountPercentage(
                        Math.min(maxDiscount, Math.max(0, parseFloat(e.target.value) || 0))
                      )
                    }
                    className="w-full min-h-[44px] px-3 bg-white text-slate-900 rounded-xl font-black outline-none text-base tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-blue-100 mb-1">الشحن (ج.م)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={shippingCost}
                    onChange={(e) => setShippingCost(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full min-h-[44px] px-3 bg-white text-slate-900 rounded-xl font-black outline-none text-base tabular-nums"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-blue-100 mb-1">ملاحظات الطلب</label>
                  <input
                    type="text"
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    placeholder="ملاحظات شحن خاصة..."
                    className="w-full min-h-[44px] px-3 bg-white text-slate-900 rounded-xl font-bold outline-none text-base"
                  />
                </div>
                {isEditRequest && (
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-blue-100 mb-1">
                      سبب طلب التعديل لمسؤول الطلبات
                    </label>
                    <input
                      type="text"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      placeholder="سبب التعديل أو الإضافة..."
                      className="w-full min-h-[44px] px-3 bg-white text-slate-900 rounded-xl font-bold outline-none text-base"
                    />
                  </div>
                )}
              </div>

              {/* Cart Items List */}
              <div className="max-h-56 sm:max-h-60 overflow-y-auto space-y-2.5 pr-1">
                {cart.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-white/10 p-3.5 rounded-2xl flex justify-between items-center gap-2 text-xs"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <p className="font-bold text-white text-sm truncate">{item.productName}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-blue-200">
                        <span className="bg-blue-900/60 px-2 py-0.5 rounded text-[10px]">
                          {item.grade}
                        </span>
                        {item.isCustom && (
                          <span className="bg-white/15 text-white px-2 py-0.5 rounded text-[10px] font-bold">
                            {item.addToInventory ? 'جديد + للمخزن' : 'طلب مخصوص'}
                          </span>
                        )}
                        <span className="tabular-nums">
                          {item.quantity} mg × {item.price} ج.م
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => handleUpdateItemQty(idx, -100)}
                          aria-label="تقليل 100 ملجم"
                          className="min-w-[32px] min-h-[32px] flex items-center justify-center bg-white/15 hover:bg-white/25 rounded-lg text-white"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateItemQty(idx, 100)}
                          aria-label="زيادة 100 ملجم"
                          className="min-w-[32px] min-h-[32px] flex items-center justify-center bg-white/15 hover:bg-white/25 rounded-lg text-white"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-left">
                        <span className="font-black text-sm text-blue-100 block tabular-nums">
                          {(item.quantity * item.price).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-blue-200">ج.م</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-red-300 hover:text-white hover:bg-red-500/30 rounded-xl transition-all"
                        title="حذف الصنف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {cart.length === 0 && (
                  <div className="text-center py-8 text-blue-200/70 text-xs font-bold border border-dashed border-white/20 rounded-2xl space-y-1">
                    <Package className="w-8 h-8 mx-auto opacity-50 mb-1" />
                    <p>لم يتم إضافة أصناف حتى الآن</p>
                    <button
                      type="button"
                      onClick={() => setMobileStep('products')}
                      className="lg:hidden mt-2 px-4 py-2 bg-white/15 text-white rounded-xl text-xs font-black"
                    >
                      الذهاب لاختيار أو كتابة الزيوت
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Financial Summary Calculation */}
            <div className="space-y-2.5 pt-4 border-t border-white/10 text-xs mt-4">
              <div className="flex justify-between text-blue-200 font-bold">
                <span>إجمالي الأصناف:</span>
                <span className="tabular-nums">{subtotal.toLocaleString()} ج.م</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-red-300 font-bold">
                  <span>الخصم التجاري ({actualDiscountPercent}%):</span>
                  <span className="tabular-nums">-{discountAmount.toLocaleString()} ج.م</span>
                </div>
              )}

              <div className="flex justify-between text-blue-200 font-bold">
                <span>تكلفة الشحن والتوصيل:</span>
                <span className="tabular-nums">+{shippingCost.toLocaleString()} ج.م</span>
              </div>

              <div className="flex justify-between text-blue-200 text-xs pt-1">
                <span>عمولة السيلز المقدرة:</span>
                <span className="font-black tabular-nums">{commission.toLocaleString()} ج.م</span>
              </div>

              {/* Total Box */}
              <div className="bg-white/15 p-4 rounded-2xl mt-2">
                <span className="text-xs text-blue-100 font-black block mb-0.5">
                  المبلغ الإجمالي المستحق
                </span>
                <div className="flex justify-between items-baseline">
                  <span className="text-2xl sm:text-3xl font-black text-white tabular-nums">
                    {totalAmount.toLocaleString()}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-blue-200">جنيه مصري</span>
                </div>
              </div>

              {/* Desktop Submit CTA */}
              <button
                type="button"
                disabled={isSubmitting || cart.length === 0 || !customerName.trim()}
                onClick={() => void handleSubmit()}
                className={`hidden lg:flex w-full min-h-[52px] py-4 rounded-2xl font-black text-base transition-all items-center justify-center gap-2 mt-3 ${
                  isSubmitting || cart.length === 0 || !customerName.trim()
                    ? 'bg-white/20 text-white/50 cursor-not-allowed'
                    : 'bg-white text-[#072F5F] hover:bg-blue-50 shadow-xl active:scale-[0.98]'
                }`}
              >
                {isSubmitting ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                {isSubmitting
                  ? 'جاري الحفظ...'
                  : isEditRequest
                  ? 'إرسال طلب التعديل للمسؤول'
                  : isApproveOverride
                  ? 'حفظ واعتماد التعديلات'
                  : isEditing
                  ? 'حفظ تعديلات الفاتورة'
                  : 'تأكيد وإصدار الفاتورة'}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Sticky Footer Bar */}
        <div className="lg:hidden bg-white border-t border-slate-200 p-3.5 pb-safe flex items-center justify-between gap-3 shrink-0 shadow-[0_-4px_16px_rgba(7,47,95,0.08)]">
          <div>
            <span className="text-[11px] font-bold text-slate-500 block">الإجمالي المستحق</span>
            <span className="text-lg font-black text-[#072F5F] tabular-nums">
              {totalAmount.toLocaleString()} <span className="text-xs font-bold">ج.م</span>
            </span>
          </div>

          {mobileStep === 'customer' && (
            <button
              type="button"
              onClick={() => setMobileStep('products')}
              className="min-h-[48px] px-5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm flex items-center gap-2 shadow-md active:scale-[0.98]"
            >
              <span>التالي: الزيوت</span>
              <ArrowRight className="w-4 h-4 rotate-180" />
            </button>
          )}

          {mobileStep === 'products' && (
            <button
              type="button"
              onClick={() => setMobileStep('summary')}
              className="min-h-[48px] px-5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm flex items-center gap-2 shadow-md active:scale-[0.98]"
            >
              <span>المراجعة ({cart.length})</span>
              <ArrowRight className="w-4 h-4 rotate-180" />
            </button>
          )}

          {mobileStep === 'summary' && (
            <button
              type="button"
              disabled={isSubmitting || cart.length === 0 || !customerName.trim()}
              onClick={() => void handleSubmit()}
              className={`min-h-[48px] flex-1 max-w-[220px] px-5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-md transition-all ${
                isSubmitting || cart.length === 0 || !customerName.trim()
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-[#072F5F] text-white active:scale-[0.98]'
              }`}
            >
              {isSubmitting ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              <span>
                {isSubmitting
                  ? 'جاري الحفظ...'
                  : isEditRequest
                  ? 'إرسال طلب التعديل'
                  : isApproveOverride
                  ? 'حفظ واعتماد'
                  : isEditing
                  ? 'حفظ التعديلات'
                  : 'إصدار الفاتورة'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
