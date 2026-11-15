import React, { useState } from 'react';
import { 
  Users, Search, Crown, Sparkles, Phone, MapPin, 
  Calendar, ShoppingBag, Send, Copy, Check, RefreshCcw, X,
  Trash2, Plus, AlertTriangle, UserCheck, Droplets
} from 'lucide-react';
import { Customer, Order, Product, User } from '../types';
import { getMarketingInsights } from '../services/geminiService';

interface CustomersTabProps {
  customers: Customer[];
  orders: Order[];
  products: Product[];
  currentUser?: User;
  onDeleteCustomer?: (customerId: string) => void;
  onAddCustomer?: (customer: { name: string; phone: string; address?: string }) => void;
}

export const CustomersTab: React.FC<CustomersTabProps> = ({
  customers,
  orders,
  products,
  currentUser,
  onDeleteCustomer,
  onAddCustomer
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState<string>('الكل');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  
  // New Customer Form State
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  // AI Marketing State
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [copied, setCopied] = useState(false);

  const canDelete = currentUser?.role === 'admin' || currentUser?.canDeleteCustomers;

  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = 
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone.includes(searchTerm);
    const matchesClass = classFilter === 'الكل' || customer.classification === classFilter;
    return matchesSearch && matchesClass;
  });

  const handleGenerateAiMessage = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsLoadingAi(true);
    setAiInsight('');
    setCopied(false);

    const customerOrders = orders.filter(o => o.customerName === customer.name || o.customerPhone === customer.phone);
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

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (onAddCustomer) {
      onAddCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        address: newAddress.trim()
      });
    }
    setNewName('');
    setNewPhone('');
    setNewAddress('');
    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 font-cairo">
      
      {/* Top Search, Filter and Add Customer Bar */}
      <div className="bg-white p-5 sm:p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        <div className="flex-1 relative">
          <Search className="w-5 h-5 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث باسم العميل أو رقم الهاتف..."
            className="w-full pr-12 pl-4 py-3.5 bg-gray-50 rounded-2xl font-bold outline-none border border-transparent focus:border-emerald-500 text-xs sm:text-sm"
          />
        </div>

        {/* Classification Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {['الكل', 'ذهبي', 'فضي', 'عادي'].map(c => (
            <button
              key={c}
              onClick={() => setClassFilter(c)}
              className={`px-3.5 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                classFilter === c
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {c === 'ذهبي' ? '👑 VIP (ذهبي)' : c === 'فضي' ? '🥈 نشط (فضي)' : c === 'عادي' ? '🏷️ عادي' : 'الكل'}
            </button>
          ))}
        </div>

        {onAddCustomer && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-emerald-600 text-white px-5 py-3.5 rounded-2xl font-black shadow-md hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 text-xs sm:text-sm whitespace-nowrap active:scale-95"
          >
            <Plus className="w-4 h-4" />
            عميل جديد
          </button>
        )}
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCustomers.map(customer => {
          const customerOrders = orders.filter(o => o.customerName === customer.name || o.customerPhone === customer.phone);
          return (
            <div
              key={customer.id}
              className="bg-white p-6 sm:p-7 rounded-[2.5rem] shadow-sm border border-gray-100 hover:border-emerald-200 transition-all hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-black flex items-center gap-1 ${
                    customer.classification === 'ذهبي' ? 'bg-amber-100 text-amber-900 border border-amber-200' :
                    customer.classification === 'فضي' ? 'bg-slate-200 text-slate-900' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {customer.classification === 'ذهبي' && <Crown className="w-3.5 h-3.5 text-amber-600" />}
                    عميل {customer.classification}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400">
                      {customerOrders.length} فواتير
                    </span>
                    {canDelete && onDeleteCustomer && (
                      <button
                        onClick={() => setCustomerToDelete(customer)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="حذف العميل من النظام"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="text-xl font-black text-gray-900 mb-1">{customer.name}</h3>
                
                <div className="space-y-1.5 mb-6 text-xs text-gray-500 font-bold">
                  <p className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                    {customer.phone || 'بدون هاتف'}
                  </p>
                  {customer.address && (
                    <p className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                      {customer.address}
                    </p>
                  )}
                  {customer.lastOrderDate && (
                    <p className="flex items-center gap-2 text-[11px] text-gray-400">
                      <Calendar className="w-3.5 h-3.5" />
                      آخر طلب: {new Date(customer.lastOrderDate).toLocaleDateString('ar-EG')}
                    </p>
                  )}
                </div>

                <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-100 mb-6">
                  <span className="text-[10px] text-emerald-800 font-bold block mb-0.5">إجمالي المشتريات التراكمية</span>
                  <p className="text-2xl font-black text-emerald-950">
                    {customer.totalSpent.toLocaleString()} <span className="text-xs font-normal text-emerald-700">ج.م</span>
                  </p>
                </div>
              </div>

              {/* AI Marketing Trigger */}
              <button
                onClick={() => handleGenerateAiMessage(customer)}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-2xl font-black text-xs transition-all flex items-center justify-center gap-2 shadow-md active:scale-98"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                توليد رسالة تسويق ذكية (AI)
              </button>
            </div>
          );
        })}
      </div>

      {filteredCustomers.length === 0 && (
        <div className="bg-white rounded-[2.5rem] p-12 text-center text-gray-400 font-bold space-y-2 border border-gray-100">
          <Users className="w-12 h-12 text-gray-300 mx-auto" />
          <p>لا يوجد عملاء مطابقين لخيارات البحث.</p>
        </div>
      )}

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-[750] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-7 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-600" />
                إضافة عميل جديد
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-700 rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">اسم العميل أو المؤسسة *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: متجر الزهور العطرية"
                  className="w-full p-3.5 bg-gray-50 rounded-2xl font-bold outline-none border border-transparent focus:border-emerald-500 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full p-3.5 bg-gray-50 rounded-2xl font-bold outline-none border border-transparent focus:border-emerald-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">العنوان / المنطقة</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="مثال: الدقي، الجيزة"
                  className="w-full p-3.5 bg-gray-50 rounded-2xl font-bold outline-none border border-transparent focus:border-emerald-500 text-sm"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs sm:text-sm transition-all shadow-md active:scale-95"
                >
                  حفظ العميل
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold text-xs sm:text-sm"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Customer Confirmation Modal */}
      {customerToDelete && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-[750] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-7 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-xl font-black text-gray-900">تأكيد حذف العميل</h3>
              <p className="text-xs text-gray-500 font-bold leading-relaxed">
                هل أنت متأكد من حذف العميل <span className="text-emerald-950 font-black">"{customerToDelete.name}"</span> من قاعدة البيانات؟
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleConfirmDeleteCustomer}
                className="flex-1 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs sm:text-sm transition-all shadow-md active:scale-95"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setCustomerToDelete(null)}
                className="px-5 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold text-xs sm:text-sm transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Marketing Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[650] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-6 sm:p-8 shadow-2xl space-y-6 animate-in zoom-in duration-200">
            <div className="flex justify-between items-start pb-4 border-b">
              <div>
                <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  مساعد التسويق الذكي من Gemini
                </span>
                <h3 className="text-xl font-black text-gray-900 mt-1">
                  مقترح رسالة مخصصة للعميل: {selectedCustomer.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-2 text-gray-400 hover:text-gray-700 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50/60 p-6 rounded-2xl border border-emerald-100 min-h-[160px] flex items-center justify-center">
              {isLoadingAi ? (
                <div className="text-center space-y-3 text-emerald-800 font-bold text-xs">
                  <RefreshCcw className="w-6 h-6 animate-spin mx-auto text-emerald-600" />
                  <p>جاري تحليل سجل مشتريات العميل وتوليد عرض تسويقي مخصص...</p>
                </div>
              ) : (
                <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-line font-medium text-right w-full">
                  {aiInsight}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleCopy}
                disabled={isLoadingAi || !aiInsight}
                className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-md active:scale-95 disabled:opacity-50"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'تم النسخ للحافظة!' : 'نسخ الرسالة لإرسالها للعميل'}
              </button>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-bold text-xs transition-all"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
