import React, { useState } from 'react';
import { 
  Users, UserPlus, Shield, Award, CheckCircle2, 
  XCircle, Edit3, DollarSign, Percent, Lock, Unlock, X 
} from 'lucide-react';
import { User, SalesRep, UserRole } from '../types';

interface UsersTabProps {
  users: User[];
  salesReps: SalesRep[];
  currentUser: User;
  onAddUser: (userData: Omit<User, 'id'>, initialRepData?: Partial<SalesRep>) => void;
  onUpdateUser: (user: User) => void;
  onUpdateRep: (rep: SalesRep) => void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  salesReps,
  currentUser,
  onAddUser,
  onUpdateUser,
  onUpdateRep
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingRep, setEditingRep] = useState<SalesRep | null>(null);

  // New user form state
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [commissionRate, setCommissionRate] = useState<string>('5');
  const [maxDiscount, setMaxDiscount] = useState<string>('10');
  const [canEditInventory, setCanEditInventory] = useState(false);
  const [canConfirmDelivery, setCanConfirmDelivery] = useState(false);
  const [canDeleteOrders, setCanDeleteOrders] = useState(false);
  const [canDeleteCustomers, setCanDeleteCustomers] = useState(false);

  const handleSaveNewUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !username.trim()) return;

    const repData: Partial<SalesRep> = role === 'sales' ? {
      name: name.trim(),
      customCommissionRate: (parseFloat(commissionRate) || 5) / 100,
      maxDiscountAllowed: parseFloat(maxDiscount) || 10,
      totalCommission: 0,
      pendingCommission: 0,
      ordersCount: 0,
      monthlyHistory: []
    } : undefined;

    onAddUser({
      name: name.trim(),
      username: username.toLowerCase().trim(),
      role,
      isSuspended: false,
      isMuted: false,
      canEditInventory,
      canConfirmDelivery: role === 'admin' || canConfirmDelivery,
      canDeleteOrders: role === 'admin' || canDeleteOrders,
      canDeleteCustomers: role === 'admin' || canDeleteCustomers,
      online: true,
      startDate: new Date().toISOString()
    }, repData);

    setName('');
    setUsername('');
    setShowAddModal(false);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-7 rounded-[2.5rem] shadow-sm border border-gray-100">
        <div>
          <h3 className="text-2xl font-black text-gray-900">فريق العمل والمندوبين</h3>
          <p className="text-xs text-gray-400 font-bold mt-0.5">إدارة الصلاحيات، نسب العمولات، وأرصدة المبيعات</p>
        </div>

        {currentUser.role === 'admin' && (
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3.5 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-md"
          >
            <UserPlus className="w-4 h-4" />
            إضافة عضو / مندوب جديد
          </button>
        )}
      </div>

      {/* Users & Sales Reps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {users.map(user => {
          const rep = salesReps.find(r => r.userId === user.id || r.id === user.salesRepId);
          return (
            <div
              key={user.id}
              className={`bg-white p-7 rounded-[2.5rem] shadow-sm border transition-all flex flex-col justify-between ${
                user.isSuspended ? 'border-red-200 bg-red-50/20' : 'border-gray-100 hover:border-emerald-200'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-black ${
                    user.role === 'admin' ? 'bg-emerald-100 text-emerald-900 border border-emerald-200' :
                    user.role === 'supervisor' ? 'bg-blue-100 text-blue-900' :
                    'bg-purple-100 text-purple-900'
                  }`}>
                    {user.role === 'admin' ? '👑 مدير عام' : user.role === 'supervisor' ? '⭐ مشرف' : '💼 مندوب مبيعات'}
                  </span>

                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    user.isSuspended ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'
                  }`}>
                    {user.isSuspended ? 'حساب معطل' : 'نشط'}
                  </span>
                </div>

                <h3 className="text-xl font-black text-gray-900 mb-1">{user.name}</h3>
                <p className="text-xs text-gray-400 font-bold mb-4">اسم المستخدم: @{user.username}</p>

                {/* Permissions Badges */}
                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                    <span className={`w-2 h-2 rounded-full ${user.canEditInventory ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    تعديل أسعار ومخزون الزيوت: {user.canEditInventory ? 'مسموح' : 'غير مسموح'}
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                    <span className={`w-2 h-2 rounded-full ${user.canConfirmDelivery ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    تأكيد تسليم الطلبات: {user.canConfirmDelivery ? 'مسموح' : 'غير مسموح'}
                  </div>
                </div>

                {/* Rep Financial Stats if Sales Rep */}
                {rep && (
                  <div className="bg-purple-50/60 p-5 rounded-2xl border border-purple-100 space-y-3 mb-6">
                    <div className="flex justify-between items-center text-xs font-bold text-purple-900">
                      <span>نسبة العمولة:</span>
                      <span className="font-black">{(rep.customCommissionRate * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between items-center text-xs font-bold text-purple-900">
                      <span>الحد الأقصى للخصم:</span>
                      <span className="font-black">{rep.maxDiscountAllowed}%</span>
                    </div>
                    <div className="flex justify-between items-center text-xs font-bold text-purple-950 pt-2 border-t border-purple-200">
                      <span>العمولات المحصلة:</span>
                      <span className="font-black text-sm">{rep.totalCommission.toLocaleString()} ج.م</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {currentUser.role === 'admin' && (
                <div className="pt-4 border-t border-gray-100 flex justify-between items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingUser(user);
                      if (rep) setEditingRep(rep);
                    }}
                    className="text-xs font-bold text-emerald-700 hover:bg-emerald-50 px-3 py-2 rounded-xl transition-all flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    تعديل الصلاحيات
                  </button>

                  <button
                    onClick={() => onUpdateUser({ ...user, isSuspended: !user.isSuspended })}
                    className={`text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center gap-1 ${
                      user.isSuspended ? 'text-emerald-700 hover:bg-emerald-50' : 'text-red-600 hover:bg-red-50'
                    }`}
                  >
                    {user.isSuspended ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    {user.isSuspended ? 'تفعيل' : 'تعطيل'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl space-y-6">
            <div className="flex justify-between items-center pb-3 border-b">
              <h3 className="text-xl font-black text-gray-900">إضافة عضو جديد</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveNewUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">الاسم بالكامل</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: كريم يوسف..."
                  className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">اسم الدخول (Username)</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="مثال: karim"
                  className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">الدور الوظيفي</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
                >
                  <option value="sales">مندوب مبيعات (Sales Rep)</option>
                  <option value="supervisor">مشرف مبيعات (Supervisor)</option>
                  <option value="admin">مدير نظام (Admin)</option>
                </select>
              </div>

              {role === 'sales' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1.5">نسبة العمولة (%)</label>
                    <input
                      type="number"
                      value={commissionRate}
                      onChange={(e) => setCommissionRate(e.target.value)}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1.5">أقصى خصم مسموح (%)</label>
                    <input
                      type="number"
                      value={maxDiscount}
                      onChange={(e) => setMaxDiscount(e.target.value)}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canEditInventory}
                    onChange={(e) => setCanEditInventory(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">السماح بتعديل أسعار ومخزون المنتجات</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canConfirmDelivery}
                    onChange={(e) => setCanConfirmDelivery(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">السماح بتأكيد التسليم والمرتجعات</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canDeleteOrders}
                    onChange={(e) => setCanDeleteOrders(e.target.checked)}
                    className="w-4 h-4 text-red-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">السماح بحذف الفواتير</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canDeleteCustomers}
                    onChange={(e) => setCanDeleteCustomers(e.target.checked)}
                    className="w-4 h-4 text-red-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">السماح بحذف العملاء</span>
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-base hover:bg-emerald-700 transition-all mt-4"
              >
                إضافة العضو وتفعيل الحساب
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[600] font-cairo" dir="rtl">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl space-y-6">
            <div className="flex justify-between items-center pb-3 border-b">
              <h3 className="text-xl font-black text-gray-900">تعديل حساب {editingUser.name}</h3>
              <button onClick={() => { setEditingUser(null); setEditingRep(null); }} className="p-2 hover:bg-gray-100 rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">الاسم</label>
                <input
                  type="text"
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                />
              </div>

              {editingRep && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1.5">نسبة العمولة (%)</label>
                    <input
                      type="number"
                      value={(editingRep.customCommissionRate * 100).toString()}
                      onChange={(e) => {
                        const val = (parseFloat(e.target.value) || 0) / 100;
                        setEditingRep({ ...editingRep, customCommissionRate: val });
                      }}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1.5">أقصى خصم (%)</label>
                    <input
                      type="number"
                      value={editingRep.maxDiscountAllowed.toString()}
                      onChange={(e) => setEditingRep({ ...editingRep, maxDiscountAllowed: parseFloat(e.target.value) || 0 })}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.canEditInventory}
                    onChange={(e) => setEditingUser({ ...editingUser, canEditInventory: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">تعديل المخزون والأسعار</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.canConfirmDelivery}
                    onChange={(e) => setEditingUser({ ...editingUser, canConfirmDelivery: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">تأكيد التسليم والمرتجعات</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingUser.canDeleteOrders}
                    onChange={(e) => setEditingUser({ ...editingUser, canDeleteOrders: e.target.checked })}
                    className="w-4 h-4 text-red-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">صلاحية حذف الفواتير</span>
                </label>

                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingUser.canDeleteCustomers}
                    onChange={(e) => setEditingUser({ ...editingUser, canDeleteCustomers: e.target.checked })}
                    className="w-4 h-4 text-red-600 rounded"
                  />
                  <span className="text-xs font-bold text-gray-700">صلاحية حذف العملاء</span>
                </label>
              </div>

              <button
                onClick={() => {
                  onUpdateUser(editingUser);
                  if (editingRep) onUpdateRep(editingRep);
                  setEditingUser(null);
                  setEditingRep(null);
                }}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-base hover:bg-emerald-700 transition-all mt-4"
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
