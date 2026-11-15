import React, { useState, useMemo } from 'react';
import { 
  X, Plus, Trash2, Check, RefreshCcw, User, Phone, MapPin, 
  FileText, Sparkles, Tag, DollarSign, Percent, ShieldCheck,
  ChevronDown, Search, ArrowRight, ShoppingCart, Droplets,
  Package, AlertCircle, Info, Edit2, Minus
} from 'lucide-react';
import { Product, SalesRep, OrderItem, OilGrade, Order, Customer } from '../types';

interface OrderFormModalProps {
  products: Product[];
  salesReps: SalesRep[];
  customers?: Customer[];
  currentRep?: SalesRep;
  isAdmin: boolean;
  onClose: () => void;
  onSaveOrder: (orderData: Omit<Order, 'id' | 'createdAt'>) => void;
}

export const OrderFormModal: React.FC<OrderFormModalProps> = ({
  products,
  salesReps,
  customers = [],
  currentRep,
  isAdmin,
  onClose,
  onSaveOrder
}) => {
  // Customer Details
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [selectedRepId, setSelectedRepId] = useState(currentRep?.id || salesReps[0]?.id || '');
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  
  // Cart & Item Addition
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [itemQuantity, setItemQuantity] = useState<string>('500');
  const [customPrice, setCustomPrice] = useState<string>('');
  const [productSearch, setProductSearch] = useState('');
  
  // Pricing adjustments
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  const [shippingCost, setShippingCost] = useState<number>(50);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active items
  const selectedRep = salesReps.find(r => r.id === selectedRepId) || salesReps[0];
  const activeProduct = products.find(p => p.id === selectedProductId) || products[0];

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    return products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.grade.toLowerCase().includes(productSearch.toLowerCase())
    );
  }, [products, productSearch]);

  // Filter customer autocomplete
  const customerSuggestions = useMemo(() => {
    if (!customerName.trim() || customerName.length < 2) return [];
    return customers.filter(c => 
      c.name.toLowerCase().includes(customerName.toLowerCase()) ||
      c.phone.includes(customerName)
    ).slice(0, 4);
  }, [customers, customerName]);

  const handleSelectCustomerSuggestion = (c: Customer) => {
    setCustomerName(c.name);
    setCustomerPhone(c.phone);
    if (c.address) setCustomerAddress(c.address);
    setShowCustomerSuggestions(false);
  };

  // Add Item to Cart
  const handleAddItem = () => {
    if (!activeProduct) return;
    const qty = parseFloat(itemQuantity);
    if (isNaN(qty) || qty <= 0) {
      alert('يرجى إدخال كمية صحيحة بالمليجرام (mg)');
      return;
    }

    const price = customPrice !== '' ? parseFloat(customPrice) : activeProduct.pricePerMg;
    if (isNaN(price) || price <= 0) {
      alert('يرجى إدخال سعر صحيح للـ mg');
      return;
    }

    // Check if item already in cart with same product and grade
    const existingIndex = cart.findIndex(
      item => item.productName === activeProduct.name && item.grade === activeProduct.grade
    );

    if (existingIndex >= 0) {
      const updated = [...cart];
      updated[existingIndex].quantity += qty;
      updated[existingIndex].price = price;
      setCart(updated);
    } else {
      const newItem: OrderItem = {
        productName: activeProduct.name,
        grade: activeProduct.grade,
        quantity: qty,
        price: price
      };
      setCart([...cart, newItem]);
    }

    // Reset item quantity and custom price
    setItemQuantity('500');
    setCustomPrice('');
  };

  const handleRemoveItem = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const handleUpdateItemQty = (index: number, delta: number) => {
    setCart(cart.map((item, idx) => {
      if (idx !== index) return item;
      const newQty = Math.max(50, item.quantity + delta);
      return { ...item, quantity: newQty };
    }));
  };

  // Calculations
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const maxDiscount = selectedRep?.maxDiscountAllowed || (isAdmin ? 50 : 10);
  const actualDiscountPercent = Math.min(maxDiscount, Math.max(0, discountPercentage));
  const discountAmount = (subtotal * actualDiscountPercent) / 100;
  const totalAmount = Math.max(0, subtotal - discountAmount + shippingCost);
  const commissionRate = selectedRep?.customCommissionRate || 0.05;
  const commission = (subtotal - discountAmount) * commissionRate;

  // Submit Order
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      alert('يرجى إدخال اسم العميل أو المؤسسة');
      return;
    }
    if (cart.length === 0) {
      alert('يرجى إضافة صنف زيت واحد على الأقل إلى الفاتورة');
      return;
    }

    setIsSubmitting(true);
    try {
      onSaveOrder({
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
        status: 'قيد التنفيذ',
        commission
      });
      onClose();
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء إصدار الفاتورة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-emerald-950/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo overflow-hidden" dir="rtl">
      
      {/* Main Container - Fullscreen bottom sheet on mobile, rounded modal on tablet/desktop */}
      <div className="bg-white w-full max-w-5xl rounded-t-[2.5rem] sm:rounded-[3rem] shadow-2xl flex flex-col max-h-[96vh] sm:max-h-[90vh] overflow-hidden border border-emerald-900/10 animate-in slide-in-from-bottom duration-300">
        
        {/* Top Header */}
        <div className="bg-[#064E3B] text-white px-6 py-4 sm:px-8 sm:py-5 flex justify-between items-center shrink-0 border-b border-emerald-800/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 text-emerald-300 rounded-2xl">
              <Droplets className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black tracking-tight">إصدار فاتورة بيع جديدة</h2>
              <p className="text-[11px] text-emerald-200/80 font-bold">تسجيل طلبات وتوزيع زيوت الجملة</p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="p-2.5 bg-white/10 hover:bg-red-500 hover:text-white rounded-2xl transition-all text-emerald-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body: Responsive 2-column on desktop, smooth 1-column scroll on mobile */}
        <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row">
          
          {/* Form Controls Column (60% width on large screens) */}
          <div className="flex-1 p-5 sm:p-7 space-y-6 overflow-y-auto">
            
            {/* Section 1: Customer Details */}
            <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-gray-800 flex items-center gap-2">
                  <User className="w-4 h-4 text-emerald-600" />
                  بيانات العميل المستلم
                </span>
                <span className="text-[11px] font-bold text-gray-400">حقل الاسم إلزامي *</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Customer Name with Autocomplete */}
                <div className="relative">
                  <label className="block text-[11px] font-bold text-gray-500 mb-1">اسم العميل / المتجر</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setShowCustomerSuggestions(true);
                    }}
                    onFocus={() => setShowCustomerSuggestions(true)}
                    placeholder="مثال: مؤسسة لافندر للزيوت"
                    className="w-full px-4 py-3 bg-white rounded-2xl font-bold outline-none border border-gray-200 focus:border-emerald-500 text-xs sm:text-sm transition-all"
                    required
                  />

                  {/* Autocomplete Suggestions Box */}
                  {showCustomerSuggestions && customerSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-2xl shadow-xl border border-emerald-100 p-2 z-30 space-y-1">
                      <p className="text-[10px] font-bold text-emerald-800 px-2 py-0.5">عملاء سابقين مطابقين:</p>
                      {customerSuggestions.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCustomerSuggestion(c)}
                          className="w-full text-right p-2 hover:bg-emerald-50 rounded-xl text-xs flex justify-between items-center transition-all"
                        >
                          <span className="font-bold text-gray-900">{c.name}</span>
                          <span className="text-[10px] text-gray-400">{c.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Customer Phone */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-1">رقم الهاتف للتواصل</label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-gray-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="01XXXXXXXXX"
                      className="w-full pr-10 pl-3 py-3 bg-white rounded-2xl font-bold outline-none border border-gray-200 focus:border-emerald-500 text-xs sm:text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Customer Address */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-1">العنوان أو منطقة التسليم</label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-gray-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder="مثال: الموسكي - العتبة، القاهرة"
                      className="w-full pr-10 pl-3 py-3 bg-white rounded-2xl font-bold outline-none border border-gray-200 focus:border-emerald-500 text-xs sm:text-sm"
                    />
                  </div>
                </div>

                {/* Assigned Sales Rep */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-1">المندوب المسؤول</label>
                  {isAdmin ? (
                    <select
                      value={selectedRepId}
                      onChange={(e) => setSelectedRepId(e.target.value)}
                      className="w-full px-4 py-3 bg-white rounded-2xl font-bold outline-none border border-gray-200 focus:border-emerald-500 text-xs sm:text-sm"
                    >
                      {salesReps.map(rep => (
                        <option key={rep.id} value={rep.id}>
                          {rep.name} (عمولة: {(rep.customCommissionRate * 100).toFixed(0)}%)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="px-4 py-3 bg-white rounded-2xl font-bold border border-gray-200 text-xs sm:text-sm text-gray-800">
                      {selectedRep?.name || 'مندوب المبيعات الحالي'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: Oil Product Selection & Cart Addition */}
            <div className="bg-emerald-50/70 p-5 rounded-3xl border border-emerald-100 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-950 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  إضافة صنف زيت عطري للفاتورة
                </span>
                {activeProduct && (
                  <span className="text-[11px] font-black text-emerald-800 bg-emerald-100/80 px-2.5 py-0.5 rounded-lg">
                    المخزون المتوفر: {activeProduct.stock.toLocaleString()} mg
                  </span>
                )}
              </div>

              {/* Product Picker */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-emerald-900">اختر الصنف والدرجة</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    const prod = products.find(p => p.id === e.target.value);
                    if (prod) setCustomPrice(prod.pricePerMg.toString());
                  }}
                  className="w-full p-3.5 bg-white rounded-2xl font-bold outline-none border border-emerald-200 text-xs sm:text-sm text-gray-900 shadow-sm"
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.grade} ({p.pricePerMg} ج.م / mg)
                    </option>
                  ))}
                </select>
              </div>

              {/* Weight Presets & Input */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-[11px] font-bold text-emerald-900">الكمية المطلوبة (mg مليجرام)</label>
                  <span className="text-[10px] font-bold text-emerald-700">
                    {parseFloat(itemQuantity) >= 1000 ? `≈ ${(parseFloat(itemQuantity) / 1000).toFixed(1)} جرام / تولات` : ''}
                  </span>
                </div>

                {/* Quick Weight Pills */}
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {['250', '500', '1000', '2500', '5000', '10000'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setItemQuantity(preset)}
                      className={`py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all ${
                        itemQuantity === preset
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-white text-emerald-900 hover:bg-emerald-100/60 border border-emerald-200/60'
                      }`}
                    >
                      {preset} mg
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <input
                      type="number"
                      min="1"
                      value={itemQuantity}
                      onChange={(e) => setItemQuantity(e.target.value)}
                      placeholder="الكمية بالمليجرام..."
                      className="w-full p-3.5 bg-white rounded-2xl font-black outline-none border border-emerald-200 text-sm text-emerald-950"
                    />
                  </div>

                  {/* Custom or default price */}
                  <div>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        value={customPrice || (activeProduct ? activeProduct.pricePerMg : '')}
                        onChange={(e) => setCustomPrice(e.target.value)}
                        placeholder={`السعر: ${activeProduct?.pricePerMg || 0} ج.م`}
                        className="w-full p-3.5 bg-white rounded-2xl font-black outline-none border border-emerald-200 text-sm text-emerald-950 pl-16"
                      />
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-gray-400 pointer-events-none">
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
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-md active:scale-98"
              >
                <Plus className="w-4 h-4" />
                إضافة الصنف إلى الفاتورة
              </button>
            </div>

            {/* Section 3: Discounts, Shipping & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[11px] font-bold text-gray-600">نسبة الخصم (%)</label>
                  <span className="text-[10px] font-bold text-emerald-700">حد: {maxDiscount}%</span>
                </div>
                <input
                  type="number"
                  min="0"
                  max={maxDiscount}
                  value={discountPercentage}
                  onChange={(e) => setDiscountPercentage(Math.min(maxDiscount, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className="w-full p-2.5 bg-white rounded-xl font-black outline-none border text-xs"
                />
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <label className="block text-[11px] font-bold text-gray-600 mb-1">تكلفة التوصيل (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full p-2.5 bg-white rounded-xl font-black outline-none border text-xs"
                />
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <label className="block text-[11px] font-bold text-gray-600 mb-1">ملاحظات الطلب</label>
                <input
                  type="text"
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder="ملاحظات شحن خاصة..."
                  className="w-full p-2.5 bg-white rounded-xl font-bold outline-none border text-xs"
                />
              </div>
            </div>

          </div>

          {/* Cart & Financial Breakdown Column (40% width on large screens, dark theme) */}
          <div className="w-full lg:w-96 bg-[#064E3B] text-white p-5 sm:p-7 flex flex-col justify-between shrink-0 border-t lg:border-t-0 lg:border-r border-emerald-800/40">
            
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-emerald-300" />
                  <h3 className="text-base sm:text-lg font-black">أصناف الفاتورة</h3>
                </div>
                <span className="bg-emerald-500/20 text-emerald-300 text-xs px-3 py-1 rounded-full font-black">
                  {cart.length} أصناف
                </span>
              </div>

              {/* Cart Items List */}
              <div className="max-h-48 sm:max-h-60 overflow-y-auto space-y-2.5 mb-4 pr-1">
                {cart.map((item, idx) => (
                  <div key={idx} className="bg-white/10 p-3.5 rounded-2xl flex justify-between items-center text-xs">
                    <div className="space-y-1">
                      <p className="font-bold text-white text-sm">{item.productName}</p>
                      <div className="flex items-center gap-2 text-[10px] text-emerald-200">
                        <span className="bg-emerald-800/60 px-1.5 py-0.5 rounded text-[9px]">{item.grade}</span>
                        <span>{item.quantity} mg × {item.price} ج.م</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-left">
                        <span className="font-black text-sm text-emerald-200 block">
                          {(item.quantity * item.price).toLocaleString()}
                        </span>
                        <span className="text-[9px] text-emerald-400">ج.م</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="p-1.5 text-red-400 hover:text-white hover:bg-red-500/30 rounded-lg transition-all"
                        title="حذف الصنف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {cart.length === 0 && (
                  <div className="text-center py-8 text-emerald-200/60 text-xs font-bold border border-dashed border-white/15 rounded-2xl space-y-1">
                    <Package className="w-8 h-8 mx-auto opacity-40 mb-1" />
                    <p>لم يتم إضافة أصناف حتى الآن</p>
                    <p className="text-[10px] opacity-70">اختر الصنف من القائمة واضغط "إضافة"</p>
                  </div>
                )}
              </div>
            </div>

            {/* Financial Summary Calculation */}
            <div className="space-y-2.5 pt-3 border-t border-white/10 text-xs">
              <div className="flex justify-between text-emerald-200 font-bold">
                <span>إجمالي الأصناف:</span>
                <span>{subtotal.toLocaleString()} ج.م</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-red-300 font-bold">
                  <span>الخصم التجاري ({actualDiscountPercent}%):</span>
                  <span>-{discountAmount.toLocaleString()} ج.م</span>
                </div>
              )}

              <div className="flex justify-between text-emerald-200 font-bold">
                <span>تكلفة الشحن والتوصيل:</span>
                <span>+{shippingCost.toLocaleString()} ج.م</span>
              </div>

              <div className="flex justify-between text-emerald-300 text-[11px] pt-1">
                <span>عمولة المندوب المقدرة:</span>
                <span className="font-black">{commission.toLocaleString()} ج.م</span>
              </div>

              {/* Total Box */}
              <div className="bg-white/15 p-4 rounded-2xl mt-3">
                <span className="text-[10px] text-emerald-200 uppercase font-black tracking-widest block mb-0.5">
                  المبلغ الإجمالي المستحق
                </span>
                <div className="flex justify-between items-baseline">
                  <span className="text-2xl sm:text-3xl font-black text-white">
                    {totalAmount.toLocaleString()}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-emerald-300">جنيه مصري</span>
                </div>
              </div>

              {/* Submit CTA */}
              <button
                type="button"
                disabled={isSubmitting || cart.length === 0 || !customerName.trim()}
                onClick={handleSubmit}
                className={`w-full py-4 rounded-2xl font-black text-sm sm:text-base transition-all flex items-center justify-center gap-2 mt-3 ${
                  isSubmitting || cart.length === 0 || !customerName.trim()
                    ? 'bg-white/20 text-white/50 cursor-not-allowed'
                    : 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300 shadow-xl active:scale-98'
                }`}
              >
                {isSubmitting ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                {isSubmitting ? 'جاري الحفظ...' : 'تأكيد وإصدار الفاتورة'}
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
