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
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Filter and Actions */}
      <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        <div className="flex-1 relative">
          <Search className="w-5 h-5 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث في أسماء الزيوت والروائح المركزة..."
            className="w-full pr-12 pl-4 py-3.5 bg-gray-50 rounded-2xl font-bold outline-none border border-transparent focus:border-emerald-500 text-sm"
          />
        </div>

        {/* Grade Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {['الكل', 'عالي (Code A)', 'وسط (Code B)', 'تجاري (Code C)'].map(g => (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              className={`px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                gradeFilter === g
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-emerald-600 text-white px-6 py-3.5 rounded-2xl font-black shadow-md hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            إضافة صنف زيت جديد
          </button>
        )}
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProducts.map(product => {
          const isLowStock = product.stock < 5000;
          return (
            <div
              key={product.id}
              className="bg-white p-7 rounded-[2.5rem] shadow-sm border border-gray-100 hover:border-emerald-200 transition-all hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-black ${
                    product.grade.includes('Code A') ? 'bg-amber-100 text-amber-900 border border-amber-200' :
                    product.grade.includes('Code B') ? 'bg-blue-100 text-blue-900 border border-blue-200' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {product.grade}
                  </span>
                  <div className="p-3 bg-emerald-50 text-emerald-700 rounded-2xl">
                    <Droplets className="w-5 h-5" />
                  </div>
                </div>

                <h3 className="text-xl font-black text-gray-900 mb-1">{product.name}</h3>
                <p className="text-xs text-gray-400 font-bold mb-6">كود النظام: OIL-{product.id}</p>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <p className="text-[11px] font-bold text-gray-400">سعر المليجرام (mg)</p>
                    <p className="text-xl font-black text-emerald-900">{product.pricePerMg} <span className="text-xs">ج.م</span></p>
                  </div>
                  <div className={`p-4 rounded-2xl ${isLowStock ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                    <p className="text-[11px] font-bold text-gray-400">المخزون المتاح</p>
                    <p className={`text-xl font-black ${isLowStock ? 'text-amber-700' : 'text-gray-900'}`}>
                      {product.stock.toLocaleString()} <span className="text-xs">mg</span>
                    </p>
                  </div>
                </div>

                {/* Stock progress */}
                <div className="space-y-1.5 mb-6">
                  <div className="flex justify-between text-[11px] font-bold">
                    <span className="text-gray-400">نسبة التوفر بالمستودع</span>
                    <span className={isLowStock ? 'text-amber-600' : 'text-emerald-600'}>
                      {isLowStock ? 'مخزون منخفض' : 'متوفر بشكل ممتاز'}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isLowStock ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, (product.stock / 20000) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="pt-4 border-t border-gray-100 flex justify-end">
                  <button
                    onClick={() => setEditingProduct(product)}
                    className="text-xs font-black text-emerald-700 hover:bg-emerald-50 px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    تعديل السعر والمخزون
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl space-y-6">
            <div className="flex justify-between items-center pb-3 border-b">
              <h3 className="text-xl font-black text-gray-900">إضافة صنف زيت جديد</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveNew} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">اسم الزيت العطري</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: زيت مسك الطهارة الأبيض..."
                  className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">درجة النقاوة والجودة</label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value as OilGrade)}
                  className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
                >
                  <option value="عالي (Code A)">عالي النقاوة (Code A) - للماركات الفاخرة</option>
                  <option value="وسط (Code B)">وسط (Code B) - للاستخدام المتوازن</option>
                  <option value="تجاري (Code C)">تجاري (Code C) - للإنتاج الاقتصادي</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">السعر للـ mg (ج.م)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={pricePerMg}
                    onChange={(e) => setPricePerMg(e.target.value)}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">الرصيد الابتدائي (mg)</label>
                  <input
                    type="number"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-base hover:bg-emerald-700 transition-all mt-4"
              >
                حفظ الصنف في المستودع
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl space-y-6">
            <div className="flex justify-between items-center pb-3 border-b">
              <div>
                <h3 className="text-xl font-black text-gray-900">تعديل {editingProduct.name}</h3>
                <p className="text-xs font-bold text-emerald-700">{editingProduct.grade}</p>
              </div>
              <button onClick={() => setEditingProduct(null)} className="p-2 hover:bg-gray-100 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">اسم الصنف</label>
                <input
                  type="text"
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">السعر للـ mg (ج.م)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingProduct.pricePerMg}
                    onChange={(e) => setEditingProduct({ ...editingProduct, pricePerMg: parseFloat(e.target.value) || 0 })}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">المخزون الحالي (mg)</label>
                  <input
                    type="number"
                    value={editingProduct.stock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, stock: parseFloat(e.target.value) || 0 })}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-base hover:bg-emerald-700 transition-all mt-4"
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
