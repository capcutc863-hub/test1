import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, ShoppingCart, Users, Package, TrendingUp, PlusCircle, 
  Clock, Printer, Sparkles, X, LogOut, UserCircle, 
  Plus, Trash2, Phone, MapPin, RefreshCcw, 
  ChevronRight, Info, MessageSquare, ShieldAlert, UserPlus, 
  Edit3, Send, History, Star, Download, Search, Check, Zap, AlertTriangle, ShieldCheck, ExternalLink,
  Wifi, WifiOff, Crown, Award, Droplets, Menu
} from 'lucide-react';
import { Product, Customer, SalesRep, Order, OrderStatus, User, ChatMessage } from './types';
import { INITIAL_USERS } from './constants';
import { dataStore } from './services/storageService';
import Invoice from './components/Invoice';
import { DashboardTab } from './components/DashboardTab';
import { OrdersTab } from './components/OrdersTab';
import { OrderFormModal } from './components/OrderFormModal';
import { InventoryTab } from './components/InventoryTab';
import { CustomersTab } from './components/CustomersTab';
import { UsersTab } from './components/UsersTab';
import { TeamChatModal } from './components/TeamChatModal';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const users = dataStore.getUsers();
    return users.find(u => u.username === 'admin') || users[0] || null;
  });
  const [loginUsername, setLoginUsername] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'inventory' | 'customers' | 'admin-users'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Data state from local-first storage
  const [users, setUsers] = useState<User[]>(() => dataStore.getUsers());
  const [products, setProducts] = useState<Product[]>(() => dataStore.getProducts());
  const [salesReps, setSalesReps] = useState<SalesRep[]>(() => dataStore.getSalesReps());
  const [customers, setCustomers] = useState<Customer[]>(() => dataStore.getCustomers());
  const [orders, setOrders] = useState<Order[]>(() => dataStore.getOrders());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => dataStore.getChat());

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync state with local store events
  const refreshData = () => {
    setUsers(dataStore.getUsers());
    setProducts(dataStore.getProducts());
    setSalesReps(dataStore.getSalesReps());
    setCustomers(dataStore.getCustomers());
    setOrders(dataStore.getOrders());
    setChatMessages(dataStore.getChat());
  };

  useEffect(() => {
    const handleStorageUpdate = () => {
      refreshData();
    };

    window.addEventListener('royal_storage_update', handleStorageUpdate);
    return () => window.removeEventListener('royal_storage_update', handleStorageUpdate);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => u.username.toLowerCase() === loginUsername.toLowerCase().trim());
    if (user) {
      if (user.isSuspended) {
        alert('هذا الحساب معطل حالياً من قبل الإدارة.');
        return;
      }
      setCurrentUser(user);
    } else {
      alert('اسم المستخدم غير صحيح. يمكنك تجربة: admin أو ahmed أو sara');
    }
  };

  const handleQuickLogin = (uname: string) => {
    const user = users.find(u => u.username === uname);
    if (user) setCurrentUser(user);
  };

  const handleSaveNewOrder = (orderData: Omit<Order, 'id' | 'createdAt'>) => {
    const newOrder: Order = {
      ...orderData,
      id: `ORD-${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString()
    };
    dataStore.addOrder(newOrder);
    refreshData();
    showToast('تم إصدار الفاتورة وحفظها بنجاح ✅');
    setSelectedOrder(newOrder);
  };

  const handleUpdateOrderStatus = (orderId: string, newStatus: OrderStatus) => {
    dataStore.updateOrderStatus(orderId, newStatus);
    refreshData();
    showToast(`تم تحديث حالة الطلب إلى: ${newStatus} ✅`);
  };

  const handleDeleteOrder = (orderId: string) => {
    dataStore.deleteOrder(orderId);
    refreshData();
    showToast('تم حذف الفاتورة وإعادة الكميات للمخزون بنجاح 🗑️');
  };

  const handleDeleteCustomer = (customerId: string) => {
    dataStore.deleteCustomer(customerId);
    refreshData();
    showToast('تم حذف العميل من قاعدة البيانات 🗑️');
  };

  const handleAddCustomer = (customerData: { name: string; phone: string; address?: string }) => {
    dataStore.addCustomer(customerData);
    refreshData();
    showToast('تم إضافة العميل الجديد بنجاح ✅');
  };

  const handleAddProduct = (productData: Omit<Product, 'id'>) => {
    const newProd: Product = {
      ...productData,
      id: `p-${Date.now()}`
    };
    const updated = [newProd, ...products];
    dataStore.setProducts(updated);
    refreshData();
    showToast('تم إضافة صنف الزيت بنجاح ✅');
  };

  const handleUpdateProduct = (updatedProduct: Product) => {
    const updated = products.map(p => p.id === updatedProduct.id ? updatedProduct : p);
    dataStore.setProducts(updated);
    refreshData();
    showToast('تم تحديث بيانات الصنف ✅');
  };

  const handleAddUser = (userData: Omit<User, 'id'>, initialRepData?: Partial<SalesRep>) => {
    const userId = `u-${Date.now()}`;
    const repId = `s-${Date.now()}`;

    const newUser: User = {
      ...userData,
      id: userId,
      salesRepId: userData.role === 'sales' ? repId : undefined
    };

    const updatedUsers = [...users, newUser];
    dataStore.setUsers(updatedUsers);

    if (userData.role === 'sales' && initialRepData) {
      const newRep: SalesRep = {
        id: repId,
        userId: userId,
        name: userData.name,
        totalCommission: initialRepData.totalCommission || 0,
        pendingCommission: initialRepData.pendingCommission || 0,
        ordersCount: initialRepData.ordersCount || 0,
        maxDiscountAllowed: initialRepData.maxDiscountAllowed || 10,
        customCommissionRate: initialRepData.customCommissionRate || 0.05,
        monthlyHistory: []
      };
      dataStore.setSalesReps([...salesReps, newRep]);
    }

    refreshData();
    showToast('تم إضافة العضو الجديد بنجاح ✅');
  };

  const handleUpdateUser = (updatedUser: User) => {
    const updated = users.map(u => u.id === updatedUser.id ? updatedUser : u);
    dataStore.setUsers(updated);
    refreshData();
    showToast('تم تحديث بيانات المستخدم ✅');
  };

  const handleUpdateRep = (updatedRep: SalesRep) => {
    const updated = salesReps.map(r => r.id === updatedRep.id ? updatedRep : r);
    dataStore.setSalesReps(updated);
    refreshData();
    showToast('تم تحديث بيانات المندوب والعمولات ✅');
  };

  const handleSendMessage = (text: string) => {
    if (!currentUser) return;
    dataStore.addChatMessage({
      senderId: currentUser.id,
      senderName: currentUser.name,
      text
    });
    refreshData();
  };

  const currentRep = useMemo(() => {
    return salesReps.find(r => r.userId === currentUser?.id || r.id === currentUser?.salesRepId);
  }, [salesReps, currentUser]);

  // Login Screen if no current user
  if (!currentUser) {
    return (
      <div className="h-screen bg-[#064E3B] flex items-center justify-center p-4 sm:p-6 font-cairo" dir="rtl">
        <div className="bg-white w-full max-w-md rounded-[2.5rem] sm:rounded-[3rem] p-8 sm:p-12 shadow-2xl flex flex-col items-center animate-in zoom-in-95 duration-200">
          <div className="bg-emerald-600 p-5 rounded-[1.8rem] shadow-xl mb-5 text-white">
            <Droplets className="w-10 h-10" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 mb-1 text-center">مؤسسة الملكي للعطور</h1>
          <p className="text-xs font-bold text-gray-400 mb-6 text-center">نظام إدارة مبيعات الزيوت بالجملة والفواتير</p>
          
          <form onSubmit={handleLogin} className="w-full space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1.5">اسم المستخدم</label>
              <input 
                value={loginUsername} 
                onChange={(e) => setLoginUsername(e.target.value)} 
                placeholder="أدخل اسم المستخدم (admin)..." 
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold border-2 border-transparent focus:border-emerald-500 text-sm" 
              />
            </div>
            <button 
              type="submit" 
              className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-base sm:text-lg hover:bg-emerald-700 transition-all shadow-lg active:scale-98"
            >
              تسجيل الدخول
            </button>
          </form>

          {/* Quick Demo Logins */}
          <div className="w-full mt-8 pt-6 border-t border-gray-100 space-y-2.5">
            <p className="text-[11px] font-bold text-gray-400 text-center">دخول سريع للحسابات التجريبية:</p>
            <div className="grid grid-cols-3 gap-2">
              <button 
                onClick={() => handleQuickLogin('admin')}
                className="p-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 rounded-xl text-xs font-black transition-all text-center"
              >
                👑 المدير
              </button>
              <button 
                onClick={() => handleQuickLogin('ahmed')}
                className="p-2.5 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-xl text-xs font-black transition-all text-center"
              >
                💼 أحمد
              </button>
              <button 
                onClick={() => handleQuickLogin('sara')}
                className="p-2.5 bg-purple-50 hover:bg-purple-100 text-purple-900 rounded-xl text-xs font-black transition-all text-center"
              >
                💼 سارة
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#F8FAFC] font-cairo text-gray-900 overflow-hidden" dir="rtl">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[999] bg-emerald-900 text-white px-5 sm:px-6 py-3 rounded-2xl font-black text-xs sm:text-sm shadow-2xl border border-emerald-700 animate-in fade-in slide-in-from-top-4 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          {toastMessage}
        </div>
      )}

      {/* Mobile Top App Bar */}
      <div className="md:hidden bg-[#064E3B] text-white px-4 py-3 flex items-center justify-between z-30 shrink-0 shadow-md">
        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all"
            aria-label="القائمة"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-500 rounded-xl">
              <Droplets className="w-4 h-4 text-white" />
            </div>
            <span className="font-black text-sm">الملكي للعطور</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowChat(true)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold flex items-center gap-1"
          >
            <MessageSquare className="w-4 h-4 text-emerald-300" />
            <span className="text-[10px]">{chatMessages.length}</span>
          </button>
          <button
            onClick={() => setShowOrderForm(true)}
            className="bg-emerald-500 text-emerald-950 px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            فاتورة
          </button>
        </div>
      </div>

      {/* Mobile Menu Backdrop */}
      {isMobileMenuOpen && (
        <div 
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-xs"
        />
      )}

      {/* Sidebar Navigation - Drawer on mobile, Fixed Sidebar on desktop */}
      <aside className={`
        fixed md:static inset-y-0 right-0 z-40 w-72 bg-[#064E3B] text-white flex flex-col justify-between no-print transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full md:translate-x-0'}
      `}>
        <div>
          {/* Brand Header */}
          <div className="p-6 sm:p-7 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500 rounded-2xl">
                <Droplets className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tight">الملكي للعطور</h1>
                <p className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">Essential Oils Wholesale</p>
              </div>
            </div>
            
            <button 
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-2 md:hidden text-white/70 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="mt-6 px-4 space-y-1.5">
            <button 
              onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} 
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl font-black text-sm transition-all ${
                activeTab === 'dashboard' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-100 hover:bg-white/5'
              }`}
            >
              <LayoutDashboard className="w-5 h-5"/> الرئيسية
            </button>

            <button 
              onClick={() => { setActiveTab('orders'); setIsMobileMenuOpen(false); }} 
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl font-black text-sm transition-all ${
                activeTab === 'orders' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-100 hover:bg-white/5'
              }`}
            >
              <ShoppingCart className="w-5 h-5"/> الفواتير والمبيعات
            </button>

            <button 
              onClick={() => { setActiveTab('inventory'); setIsMobileMenuOpen(false); }} 
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl font-black text-sm transition-all ${
                activeTab === 'inventory' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-100 hover:bg-white/5'
              }`}
            >
              <Package className="w-5 h-5"/> المخزون والزيوت
            </button>

            <button 
              onClick={() => { setActiveTab('customers'); setIsMobileMenuOpen(false); }} 
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl font-black text-sm transition-all ${
                activeTab === 'customers' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-100 hover:bg-white/5'
              }`}
            >
              <Users className="w-5 h-5"/> العملاء والتسويق
            </button>

            <button 
              onClick={() => { setActiveTab('admin-users'); setIsMobileMenuOpen(false); }} 
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl font-black text-sm transition-all ${
                activeTab === 'admin-users' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-100 hover:bg-white/5'
              }`}
            >
              <Award className="w-5 h-5"/> فريق العمل والمندوبين
            </button>
          </nav>
        </div>

        {/* Sidebar Footer: User profile, Chat & Logout */}
        <div className="p-5 border-t border-white/10 space-y-3">
          <button
            onClick={() => { setShowChat(true); setIsMobileMenuOpen(false); }}
            className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2"
          >
            <MessageSquare className="w-4 h-4 text-emerald-300" />
            شات الفريق الداخلي ({chatMessages.length})
          </button>

          <div className="flex items-center justify-between px-2 pt-1">
            <div className="space-y-0.5">
              <p className="text-xs font-black text-white">{currentUser.name}</p>
              <p className="text-[10px] text-emerald-300 font-bold">
                {currentUser.role === 'admin' ? 'مدير عام' : currentUser.role === 'supervisor' ? 'مشرف' : 'مندوب مبيعات'}
              </p>
            </div>
            <button 
              onClick={() => setCurrentUser(null)} 
              title="تسجيل الخروج"
              className="p-2 text-red-300 hover:text-white hover:bg-red-500/20 rounded-xl transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10">
        
        {/* Top Desktop Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-gray-900">
              {activeTab === 'dashboard' && 'لوحة التحكم والتقارير'}
              {activeTab === 'orders' && 'سجل الفواتير والمبيعات'}
              {activeTab === 'inventory' && 'مخزون الزيوت العطرية'}
              {activeTab === 'customers' && 'إدارة العملاء والتسويق الذكي'}
              {activeTab === 'admin-users' && 'فريق العمل والعمولات'}
            </h2>
            <p className="text-[11px] sm:text-xs font-bold text-gray-400 mt-0.5">
              نظام سحابي متكامل لإدارة منتجات الزيوت والعمولات وتوليد الفواتير
            </p>
          </div>

          <button 
            onClick={() => setShowOrderForm(true)} 
            className="hidden sm:flex bg-emerald-600 text-white px-5 sm:px-6 py-3 sm:py-3.5 rounded-2xl font-black shadow-lg hover:bg-emerald-700 hover:shadow-xl transition-all items-center gap-2.5 active:scale-95 text-xs sm:text-sm"
          >
            <PlusCircle className="w-4 h-4 sm:w-5 sm:h-5"/>
            فاتورة بيع جديدة
          </button>
        </header>

        {/* Tab Components */}
        {activeTab === 'dashboard' && (
          <DashboardTab
            orders={orders}
            products={products}
            salesReps={salesReps}
            customers={customers}
            currentUser={currentUser}
            onOpenNewOrder={() => setShowOrderForm(true)}
            onSelectOrder={(order) => setSelectedOrder(order)}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersTab
            orders={orders}
            currentUser={currentUser}
            onOpenNewOrder={() => setShowOrderForm(true)}
            onSelectOrder={(order) => setSelectedOrder(order)}
            onUpdateStatus={handleUpdateOrderStatus}
            onDeleteOrder={handleDeleteOrder}
          />
        )}

        {activeTab === 'inventory' && (
          <InventoryTab
            products={products}
            currentUser={currentUser}
            onAddProduct={handleAddProduct}
            onUpdateProduct={handleUpdateProduct}
          />
        )}

        {activeTab === 'customers' && (
          <CustomersTab
            customers={customers}
            orders={orders}
            products={products}
            currentUser={currentUser}
            onDeleteCustomer={handleDeleteCustomer}
            onAddCustomer={handleAddCustomer}
          />
        )}

        {activeTab === 'admin-users' && (
          <UsersTab
            users={users}
            salesReps={salesReps}
            currentUser={currentUser}
            onAddUser={handleAddUser}
            onUpdateUser={handleUpdateUser}
            onUpdateRep={handleUpdateRep}
          />
        )}

        {/* Order Create Modal */}
        {showOrderForm && (
          <OrderFormModal
            products={products}
            salesReps={salesReps}
            customers={customers}
            currentRep={currentRep}
            isAdmin={currentUser.role === 'admin' || currentUser.role === 'supervisor'}
            onClose={() => setShowOrderForm(false)}
            onSaveOrder={handleSaveNewOrder}
          />
        )}

        {/* Selected Order Printable Invoice */}
        {selectedOrder && (
          <Invoice 
            order={selectedOrder} 
            onClose={() => setSelectedOrder(null)} 
          />
        )}

        {/* Team Chat Modal */}
        {showChat && (
          <TeamChatModal
            messages={chatMessages}
            currentUser={currentUser}
            onClose={() => setShowChat(false)}
            onSendMessage={handleSendMessage}
          />
        )}

      </main>
    </div>
  );
};

export default App;
