import React, { useState } from 'react';
import { 
  Package, Plus, Search, Edit3, Trash2, Check, X, 
  AlertTriangle, ArrowUpDown, Layers, Droplets, Sparkles 
} from 'lucide-react';
import { Product, OilGrade, User } from '../types';

interface InventoryTabProps {
  products: Product[];
  currentUser: User;
  onAddProduct: (product: Omit<Product, 'id'>) => void;
  onUpdateProduct: (product: Product) => void;
}

export const InventoryTab: React.FC<InventoryTabProps> = ({
  products,
  currentUser,
  onAddProduct,
  onUpdateProduct
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('الكل');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // New product form
  const [name, setName] = useState('');
  const [grade, setGrade] = useState<OilGrade>('عالي (Code A)');
  const [pricePerMg, setPricePerMg] = useState<string>('20');
  const [stock, setStock] = useState<string>('10000');

  const canEdit = currentUser.role === 'admin' || currentUser.canEditInventory;

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGrade = gradeFilter === 'الكل' || product.grade === gradeFilter;
    return matchesSearch && matchesGrade;
  });

  const handleSaveNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAddProduct({
      name: name.trim(),
      grade,
      pricePerMg: parseFloat(pricePerMg) || 10,
      stock: parseFloat(stock) || 5000
    });

    setName('');
    setShowAddModal(false);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    onUpdateProduct(editingProduct);
    setEditingProduct(null);
  };

  return (
    <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300">
      {/* Top Filter and Actions */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3.5">
        <div className="flex-1 relative">
          <Search className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث في أسماء الزيوت والروائح المركزة..."
            className="w-full min-h-[48px] pr-12 pl-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200/80 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
          />
        </div>

        {/* Grade Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {['الكل', 'عالي (Code A)', 'وسط (Code B)', 'تجاري (Code C)'].map(g => (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              className={`min-h-[40px] px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                gradeFilter === g
                  ? 'bg-[#0A468C] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="min-h-[48px] bg-[#0A468C] text-white px-5 py-3 rounded-2xl font-black shadow-md hover:bg-[#072F5F] transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            إضافة صنف زيت جديد
          </button>
        )}
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {filteredProducts.map(product => {
          const isLowStock = product.stock < 5000;
          return (
            <div
              key={product.id}
              className="bg-white p-5 sm:p-7 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80 hover:border-blue-200 transition-all hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start mb-3.5">
                  <span className={`px-3 py-1 rounded-xl text-xs font-black ${
                    product.grade.includes('Code A') ? 'bg-amber-100 text-amber-900 border border-amber-200' :
                    product.grade.includes('Code B') ? 'bg-blue-100 text-[#072F5F] border border-blue-200' :
                    'bg-slate-100 text-slate-800'
                  }`}>
                    {product.grade}
                  </span>
                  <div className="p-2.5 bg-blue-50 text-[#0A468C] rounded-2xl">
                    <Droplets className="w-5 h-5" />
                  </div>
                </div>

                <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-0.5">{product.name}</h3>
                <p className="text-xs text-slate-500 font-bold mb-4 tabular-nums">كود النظام: OIL-{product.id}</p>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
                    <p className="text-xs font-bold text-slate-500 mb-0.5">سعر الـ mg</p>
                    <p className="text-lg sm:text-xl font-black text-[#072F5F] tabular-nums">
                      {product.pricePerMg} <span className="text-xs font-bold">ج.م</span>
                    </p>
                  </div>
                  <div className={`p-3.5 rounded-2xl border ${isLowStock ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200/60'}`}>
                    <p className="text-xs font-bold text-slate-500 mb-0.5">المخزون المتاح</p>
                    <p className={`text-lg sm:text-xl font-black tabular-nums ${isLowStock ? 'text-amber-700' : 'text-slate-900'}`}>
                      {product.stock.toLocaleString()} <span className="text-xs font-bold">mg</span>
                    </p>
                  </div>
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
                      style={{ width: `${Math.min(100, (product.stock / 20000) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => setEditingProduct(product)}
                    className="min-h-[44px] w-full sm:w-auto justify-center text-xs font-black text-[#0A468C] bg-blue-50 hover:bg-[#0A468C] hover:text-white px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5"
                  >
                    <Edit3 className="w-4 h-4" />
                    تعديل السعر والمخزون
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Product Modal (Bottom sheet on mobile) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-8 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg sm:text-xl font-black text-slate-900">إضافة صنف زيت جديد</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveNew} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم الزيت العطري</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: زيت مسك الطهارة الأبيض..."
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">درجة النقاوة والجودة</label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value as OilGrade)}
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                >
                  <option value="عالي (Code A)">عالي النقاوة (Code A) - للماركات الفاخرة</option>
                  <option value="وسط (Code B)">وسط (Code B) - للاستخدام المتوازن</option>
                  <option value="تجاري (Code C)">تجاري (Code C) - للإنتاج الاقتصادي</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">السعر للـ mg (ج.م)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    value={pricePerMg}
                    onChange={(e) => setPricePerMg(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">الرصيد الابتدائي (mg)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full min-h-[50px] py-3.5 bg-[#0A468C] text-white rounded-2xl font-black text-base hover:bg-[#072F5F] transition-all mt-2"
              >
                حفظ الصنف في المستودع
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Product Modal (Bottom sheet on mobile) */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-8 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900">تعديل {editingProduct.name}</h3>
                <p className="text-xs font-bold text-[#0A468C]">{editingProduct.grade}</p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4">
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

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">السعر للـ mg (ج.م)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={editingProduct.pricePerMg}
                    onChange={(e) => setEditingProduct({ ...editingProduct, pricePerMg: parseFloat(e.target.value) || 0 })}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">المخزون الحالي (mg)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editingProduct.stock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, stock: parseFloat(e.target.value) || 0 })}
                    className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full min-h-[50px] py-3.5 bg-[#0A468C] text-white rounded-2xl font-black text-base hover:bg-[#072F5F] transition-all mt-2"
              >
                تحديث بيانات الصنف
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
