import React, { useState } from 'react';
import { 
  Users, UserPlus, Shield, Award, CheckCircle2, 
  XCircle, Edit3, DollarSign, Percent, Lock, Unlock, X 
} from 'lucide-react';
import { User, SalesRep, UserRole, ProductCategory } from '../types';

interface UsersTabProps {
  users: User[];
  salesReps: SalesRep[];
  categories?: ProductCategory[];
  currentUser: User;
  onAddUser: (userData: Omit<User, 'id'> & { password?: string }, initialRepData?: Partial<SalesRep>) => void;
  onUpdateUser: (user: User & { newPassword?: string }) => void;
  onUpdateRep: (rep: SalesRep) => void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  salesReps,
  categories = [],
  currentUser,
  onAddUser,
  onUpdateUser,
  onUpdateRep
}) => {
  const isOwner = currentUser.role === 'owner';
  const isElevatedAdmin = currentUser.role === 'owner' || currentUser.role === 'admin';

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<(User & { newPassword?: string }) | null>(null);
  const [editingRep, setEditingRep] = useState<SalesRep | null>(null);

  // New user form state
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('123456');
  const [role, setRole] = useState<UserRole>('sales');
  const [commissionRate, setCommissionRate] = useState<string>('5');
  const [maxDiscount, setMaxDiscount] = useState<string>('10');
  const [canEditInventory, setCanEditInventory] = useState(false);
  const [canConfirmDelivery, setCanConfirmDelivery] = useState(false);
  const [canManageOrderStatus, setCanManageOrderStatus] = useState(false);
  const [canDeleteOrders, setCanDeleteOrders] = useState(false);
  const [canDeleteCustomers, setCanDeleteCustomers] = useState(false);

  const handleSaveNewUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !username.trim()) return;

    const repData: Partial<SalesRep> | undefined =
      role === 'sales'
        ? {
            name: name.trim(),
            ...(isOwner ? { customCommissionRate: (parseFloat(commissionRate) || 5) / 100 } : {}),
            maxDiscountAllowed: parseFloat(maxDiscount) || 10,
            totalCommission: 0,
            pendingCommission: 0,
            ordersCount: 0,
            monthlyHistory: [],
          }
        : undefined;

    onAddUser({
      name: name.trim(),
      username: username.toLowerCase().trim(),
      password: password.trim() || '123456',
      role,
      isSuspended: false,
      isMuted: false,
      canEditInventory,
      canConfirmDelivery: role === 'admin' || canConfirmDelivery,
      canManageOrderStatus: role === 'admin' || canManageOrderStatus,
      canDeleteOrders: role === 'admin' || canDeleteOrders,
      canDeleteCustomers: role === 'admin' || canDeleteCustomers,
      online: true,
      startDate: new Date().toISOString()
    }, repData);

    setName('');
    setUsername('');
    setPassword('123456');
    setCanManageOrderStatus(false);
    setShowAddModal(false);
  };

  return (
    <div className="space-y-5 sm:space-y-8 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 sm:p-7 rounded-3xl sm:rounded-[2.5rem] shadow-sm border border-slate-200/80">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-slate-900">فريق عمل كيما سنت والسيلز</h3>
          <p className="text-xs text-slate-500 font-bold mt-0.5">إدارة الصلاحيات، نسب العمولات، وأرصدة المبيعات</p>
        </div>

        {isElevatedAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full sm:w-auto min-h-[48px] bg-[#0A468C] hover:bg-[#072F5F] text-white px-6 py-3 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-md"
          >
            <UserPlus className="w-4 h-4" />
            إضافة عضو / سيلز جديد
          </button>
        )}
      </div>

      {/* Users & Sales Reps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {users.map(user => {
          const rep = salesReps.find(r => r.userId === user.id || r.id === user.salesRepId);
          const isUserFullAdmin = user.role === 'owner' || user.role === 'admin';
          return (
            <div
              key={user.id}
              className={`bg-white p-5 sm:p-7 rounded-3xl sm:rounded-[2.5rem] shadow-sm border transition-all flex flex-col justify-between ${
                user.isSuspended ? 'border-red-200 bg-red-50/20' : user.role === 'owner' ? 'border-amber-300 bg-amber-50/10' : 'border-slate-200/80 hover:border-blue-200'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-3.5">
                  <span className={`px-3 py-1 rounded-xl text-xs font-black ${
                    user.role === 'owner' ? 'bg-amber-100 text-amber-900 border border-amber-300' :
                    user.role === 'admin' ? 'bg-blue-100 text-[#072F5F] border border-blue-200' :
                    user.role === 'supervisor' ? 'bg-slate-200 text-slate-900' :
                    'bg-blue-50 text-[#0A468C]'
                  }`}>
                    {user.role === 'owner' ? 'المالك الرئيسي (Owner)' : user.role === 'admin' ? 'مدير عام' : user.role === 'supervisor' ? 'مشرف' : 'سيلز'}
                  </span>

                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-lg ${
                    user.isSuspended ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'
                  }`}>
                    {user.isSuspended ? 'حساب معطل' : 'نشط'}
                  </span>
                </div>

                <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-0.5">{user.name}</h3>
                <p className="text-xs text-slate-500 font-bold mb-4">اسم المستخدم: @{user.username}</p>

                {/* Permissions Summary */}
                <div className="space-y-2 mb-5 text-xs font-bold">
                  <div className="flex justify-between items-center text-slate-700">
                    <span>تعديل أسعار ومخزون المنتجات</span>
                    <span className={user.role === 'owner' || user.canEditInventory ? 'text-[#0A468C] font-black' : 'text-slate-400'}>
                      {user.role === 'owner' || user.canEditInventory ? 'مسموح' : 'غير مسموح'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>تأكيد تسليم الطلبات</span>
                    <span className={user.role === 'owner' || user.canConfirmDelivery ? 'text-[#0A468C] font-black' : 'text-slate-400'}>
                      {user.role === 'owner' || user.canConfirmDelivery ? 'مسموح' : 'غير مسموح'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>إدارة التجهيز والشحن والمتابعة</span>
                    <span className={isUserFullAdmin || user.canManageOrderStatus ? 'text-[#0A468C] font-black' : 'text-slate-400'}>
                      {isUserFullAdmin || user.canManageOrderStatus ? 'مسموح' : 'غير مسموح'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>حذف الفواتير</span>
                    <span className={isUserFullAdmin || user.canDeleteOrders ? 'text-[#0A468C] font-black' : 'text-slate-400'}>
                      {isUserFullAdmin || user.canDeleteOrders ? 'مسموح' : 'غير مسموح'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700">
                    <span>حذف العملاء</span>
                    <span className={isUserFullAdmin || user.canDeleteCustomers ? 'text-[#0A468C] font-black' : 'text-slate-400'}>
                      {isUserFullAdmin || user.canDeleteCustomers ? 'مسموح' : 'غير مسموح'}
                    </span>
                  </div>
                </div>

                {/* Rep Financial Stats if Sales Rep */}
                {rep && (
                  <div className="bg-blue-50/60 p-4 rounded-2xl border border-blue-100 space-y-2.5 mb-5">
                    <div className="flex justify-between items-center text-xs font-bold text-[#072F5F]">
                      <span>نسبة العمولة الأساسية (الزيوت):</span>
                      <span className="font-black tabular-nums">{(rep.customCommissionRate * 100).toFixed(1).replace(/\.0$/, '')}%</span>
                    </div>
                    {rep.categoryRates && Object.keys(rep.categoryRates).length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {Object.entries(rep.categoryRates).map(([catId, rate]) => {
                          const catName = categories.find((c) => c.id === catId)?.name || catId;
                          return (
                            <span
                              key={catId}
                              className="px-2 py-0.5 rounded-lg bg-white border border-blue-200 text-[10px] font-black text-[#0A468C] tabular-nums"
                            >
                              {catName}: {(Number(rate) * 100).toFixed(1).replace(/\.0$/, '')}%
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex justify-between items-center text-xs font-bold text-[#072F5F]">
                      <span>الحد الأقصى للخصم:</span>
                      <span className="font-black tabular-nums">{rep.maxDiscountAllowed}%</span>
                    </div>
                    <div className="flex justify-between items-center text-xs font-bold text-[#072F5F] pt-2 border-t border-blue-200/80">
                      <span>العمولات المحصلة:</span>
                      <span className="font-black text-sm tabular-nums">{rep.totalCommission.toLocaleString()} ج.م</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {isElevatedAdmin && (user.role !== 'owner' || isOwner) && (
                <div className="pt-3 border-t border-slate-100 flex justify-between items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingUser(user);
                      if (rep) setEditingRep(rep);
                    }}
                    className="min-h-[44px] flex-1 text-xs font-black text-[#0A468C] bg-blue-50 hover:bg-[#0A468C] hover:text-white px-3 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5"
                  >
                    <Edit3 className="w-4 h-4" />
                    تعديل الصلاحيات
                  </button>

                  {user.role !== 'owner' && (
                    <button
                      onClick={() => onUpdateUser({ ...user, isSuspended: !user.isSuspended })}
                      className={`min-h-[44px] text-xs font-black px-3.5 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                        user.isSuspended ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-red-50 text-red-600 hover:bg-red-100'
                      }`}
                    >
                      {user.isSuspended ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      {user.isSuspended ? 'تفعيل' : 'تعطيل'}
                    </button>
                  )}
                </div>
              )}
              {user.role === 'owner' && !isOwner && (
                <div className="pt-3 border-t border-amber-100 text-[11px] font-black text-amber-800 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  حساب محمي — لا يمكن تعديله أو تعطيله إلا بواسطة المالك الرئيسي
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add User Modal (Bottom sheet on mobile) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-8 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg sm:text-xl font-black text-slate-900">إضافة عضو جديد</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveNewUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الاسم بالكامل</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: كريم يوسف..."
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم الدخول (Username)</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="مثال: karim"
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">كلمة المرور</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور..."
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الدور الوظيفي</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                >
                  <option value="sales">سيلز (Sales)</option>
                  <option value="supervisor">مشرف مبيعات (Supervisor)</option>
                  <option value="admin">مدير نظام (Admin)</option>
                </select>
              </div>

              {role === 'sales' && (
                <div className={`grid ${isOwner ? 'grid-cols-2' : 'grid-cols-1'} gap-3.5`}>
                  {isOwner && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">نسبة العمولة الأساسية (%)</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        max="100"
                        value={commissionRate}
                        onChange={(e) => setCommissionRate(e.target.value)}
                        className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">أقصى خصم مسموح (%)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={maxDiscount}
                      onChange={(e) => setMaxDiscount(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canEditInventory}
                    onChange={(e) => setCanEditInventory(e.target.checked)}
                    className="w-5 h-5 accent-[#0A468C] rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">السماح بتعديل أسعار ومخزون المنتجات</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canConfirmDelivery}
                    onChange={(e) => setCanConfirmDelivery(e.target.checked)}
                    className="w-5 h-5 accent-[#0A468C] rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">السماح بتأكيد التسليم والمرتجعات</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-blue-50/70 border border-blue-100 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canManageOrderStatus}
                    onChange={(e) => setCanManageOrderStatus(e.target.checked)}
                    className="w-5 h-5 accent-[#0A468C] rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-[#072F5F]">مسؤول التجهيز والشحن والمتابعة حتى التسليم/المرتجع وطلبات التعديل</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canDeleteOrders}
                    onChange={(e) => setCanDeleteOrders(e.target.checked)}
                    className="w-5 h-5 accent-red-600 rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">السماح بحذف الفواتير</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canDeleteCustomers}
                    onChange={(e) => setCanDeleteCustomers(e.target.checked)}
                    className="w-5 h-5 accent-red-600 rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">السماح بحذف العملاء</span>
                </label>
              </div>

              <button
                type="submit"
                className="w-full min-h-[50px] py-3.5 bg-[#0A468C] text-white rounded-2xl font-black text-base hover:bg-[#072F5F] transition-all mt-2"
              >
                إضافة العضو وتفعيل الحساب
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal (Bottom sheet on mobile) */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] p-6 sm:p-8 pb-safe shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-lg sm:text-xl font-black text-slate-900">تعديل حساب {editingUser.name}</h3>
              <button
                onClick={() => { setEditingUser(null); setEditingRep(null); }}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الاسم</label>
                <input
                  type="text"
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">تغيير كلمة المرور (اختياري)</label>
                <input
                  type="password"
                  value={editingUser.newPassword || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, newPassword: e.target.value })}
                  placeholder="اتركه فارغاً للإبقاء على كلمة المرور الحالية"
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm"
                />
              </div>

              {editingRep && (
                <div className={`grid ${isOwner ? 'grid-cols-2' : 'grid-cols-1'} gap-3.5`}>
                  {isOwner ? (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">نسبة العمولة الأساسية (%)</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        max="100"
                        value={Number((editingRep.customCommissionRate * 100).toFixed(2)).toString()}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(1, (parseFloat(e.target.value) || 0) / 100));
                          setEditingRep({ ...editingRep, customCommissionRate: val });
                        }}
                        className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                      />
                      <p className="text-[10px] font-bold text-slate-500 mt-1">
                        لإدارة نسب كل تصنيف للمندوب استخدم لوحة المالك الرئيسي ← قواعد العمولات
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] font-bold text-amber-900">
                      نسب العمولات محمية — تعديل عمولات المناديب متاح للمالك الرئيسي فقط.
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">أقصى خصم (%)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editingRep.maxDiscountAllowed.toString()}
                      onChange={(e) => setEditingRep({ ...editingRep, maxDiscountAllowed: parseFloat(e.target.value) || 0 })}
                      className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm tabular-nums"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.canEditInventory}
                    onChange={(e) => setEditingUser({ ...editingUser, canEditInventory: e.target.checked })}
                    className="w-5 h-5 accent-[#0A468C] rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">تعديل المخزون والأسعار</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.canConfirmDelivery}
                    onChange={(e) => setEditingUser({ ...editingUser, canConfirmDelivery: e.target.checked })}
                    className="w-5 h-5 accent-[#0A468C] rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">تأكيد التسليم والمرتجعات</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-blue-50/70 border border-blue-100 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingUser.canManageOrderStatus}
                    onChange={(e) => setEditingUser({ ...editingUser, canManageOrderStatus: e.target.checked })}
                    className="w-5 h-5 accent-[#0A468C] rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-[#072F5F]">مسؤول التجهيز والشحن والمتابعة حتى التسليم/المرتجع وطلبات التعديل</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingUser.canDeleteOrders}
                    onChange={(e) => setEditingUser({ ...editingUser, canDeleteOrders: e.target.checked })}
                    className="w-5 h-5 accent-red-600 rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">صلاحية حذف الفواتير</span>
                </label>

                <label className="min-h-[48px] flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingUser.canDeleteCustomers}
                    onChange={(e) => setEditingUser({ ...editingUser, canDeleteCustomers: e.target.checked })}
                    className="w-5 h-5 accent-red-600 rounded"
                  />
                  <span className="text-xs sm:text-sm font-bold text-slate-800">صلاحية حذف العملاء</span>
                </label>
              </div>

              <button
                onClick={() => {
                  onUpdateUser(editingUser);
                  if (editingRep) onUpdateRep(editingRep);
                  setEditingUser(null);
                  setEditingRep(null);
                }}
                className="w-full min-h-[50px] py-3.5 bg-[#0A468C] text-white rounded-2xl font-black text-base hover:bg-[#072F5F] transition-all mt-2"
              >
                حفظ التعديلات
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
