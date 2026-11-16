import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  PlusCircle,
  X,
  LogOut,
  Plus,
  MessageSquare,
  Check,
  Award,
  Menu,
  RefreshCcw,
  AlertTriangle,
  Lock,
  PackageCheck,
  Truck,
  CheckCircle2,
} from 'lucide-react';
import { Product, Customer, SalesRep, Order, OrderStatus, User, ChatMessage } from './types';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { apiClient } from './src/lib/api';
import Invoice from './components/Invoice';
import { DashboardTab } from './components/DashboardTab';
import { OrdersTab } from './components/OrdersTab';
import { OrderFormModal } from './components/OrderFormModal';
import { InventoryTab } from './components/InventoryTab';
import { CustomersTab } from './components/CustomersTab';
import { UsersTab } from './components/UsersTab';
import { TeamChatModal } from './components/TeamChatModal';

type AppTab =
  | 'dashboard'
  | 'orders'
  | 'prepared-orders'
  | 'shipping-orders'
  | 'delivered-orders'
  | 'inventory'
  | 'customers'
  | 'admin-users';

const LOGO_SRC = '/assets/aistudio/logo_after_edit__2-1__80f21b58.png';

const AppContent: React.FC = () => {
  const {
    authUser,
    authToken,
    initialWorkspace,
    clearInitialWorkspace,
    authLoading,
    authError,
    loginWithUsername,
    logout,
    setAuthUser,
  } = useAuth();

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [orderModalMode, setOrderModalMode] = useState<'create' | 'edit' | 'edit-request' | 'approve-override'>('create');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const applyWorkspaceData = useCallback(
    (data: {
      users: User[];
      products: Product[];
      salesReps: SalesRep[];
      customers: Customer[];
      orders: Order[];
      chatMessages: ChatMessage[];
    }) => {
      setUsers(data.users);
      setProducts(data.products);
      setSalesReps(data.salesReps);
      setCustomers(data.customers);
      setOrders(data.orders);
      setChatMessages(data.chatMessages);

      if (authUser) {
        const refreshedSelf = data.users.find((u) => u.id === authUser.id);
        if (refreshedSelf) {
          setAuthUser(refreshedSelf);
        }
      }
    },
    [authUser?.id, setAuthUser]
  );

  const refreshData = useCallback(async () => {
    if (!authUser || !authToken) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const data = await apiClient.getWorkspace(authToken);
      applyWorkspaceData(data);
    } catch (err: unknown) {
      console.error('Failed to load workspace:', err);
      setDataError(err instanceof Error ? err.message : 'تعذر تحميل البيانات. يرجى المحاولة مرة أخرى.');
    } finally {
      setDataLoading(false);
    }
  }, [authUser?.id, authToken, applyWorkspaceData]);

  useEffect(() => {
    if (authUser && authToken) {
      if (initialWorkspace) {
        applyWorkspaceData(initialWorkspace);
        clearInitialWorkspace();
        setDataLoading(false);
        setDataError(null);
      } else {
        void refreshData();
      }
    } else {
      setUsers([]);
      setProducts([]);
      setSalesReps([]);
      setCustomers([]);
      setOrders([]);
      setChatMessages([]);
    }
  }, [authUser?.id, authToken, initialWorkspace, clearInitialWorkspace, applyWorkspaceData, refreshData]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword) return;
    const ok = await loginWithUsername(loginUsername, loginPassword);
    if (ok) {
      setLoginUsername('');
      setLoginPassword('');
      setActiveTab('dashboard');
    }
  };

  const handleSaveNewOrder = async (orderData: Omit<Order, 'id' | 'createdAt'>) => {
    try {
      const newOrder = await apiClient.createOrder(orderData);
      await refreshData();
      showToast('تم إصدار الفاتورة وحفظها بنجاح ✅');
      setSelectedOrder(newOrder);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الفاتورة';
      showToast(message);
      throw err;
    }
  };

  const handleUpdateExistingOrder = async (
    orderData: Omit<Order, 'id' | 'createdAt'>,
    requestReason?: string
  ) => {
    if (!editingOrder) return;
    try {
      if (orderModalMode === 'edit-request') {
        const updated = await apiClient.submitOrderEditRequest(editingOrder.id, {
          ...orderData,
          reason: requestReason,
        });
        await refreshData();
        showToast('تم إرسال طلب التعديل لمسؤول حالة الطلبات بنجاح ✅');
        setEditingOrder(null);
        setSelectedOrder(updated);
        return;
      }

      if (orderModalMode === 'approve-override') {
        const updated = await apiClient.resolveOrderEditRequest(
          editingOrder.id,
          'approve',
          orderData
        );
        await refreshData();
        showToast('تم تعديل واعتماد طلب التعديل بنجاح ✅');
        setEditingOrder(null);
        setSelectedOrder(updated);
        return;
      }

      const updated = await apiClient.updateOrder(editingOrder.id, orderData);
      await refreshData();
      showToast('تم تعديل الفاتورة وتحديث البيانات بنجاح ✅');
      setEditingOrder(null);
      setSelectedOrder(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تعديل الفاتورة';
      showToast(message);
      throw err;
    }
  };

  const handleResolveOrderEditRequest = async (orderId: string, action: 'approve' | 'reject') => {
    try {
      await apiClient.resolveOrderEditRequest(orderId, action);
      await refreshData();
      showToast(
        action === 'approve'
          ? 'تمت الموافقة على التعديل وتحديث الفاتورة ✅'
          : 'تم رفض طلب التعديل وإبقاء الفاتورة كما هي'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء معالجة طلب التعديل');
    }
  };

  const getOrderEditAction = (order: Order): { allowed: boolean; mode: 'edit' | 'edit-request'; label: string } => {
    if (!authUser) return { allowed: false, mode: 'edit', label: 'تعديل' };
    if (authUser.role === 'admin') return { allowed: true, mode: 'edit', label: 'تعديل' };
    if (order.status === 'قيد التنفيذ') return { allowed: true, mode: 'edit', label: 'تعديل' };
    if (order.status === 'تم التجهيز') {
      if (authUser.canManageOrderStatus) return { allowed: true, mode: 'edit', label: 'تعديل' };
      return { allowed: true, mode: 'edit-request', label: 'طلب تعديل' };
    }
    return { allowed: false, mode: 'edit', label: 'تعديل' };
  };

  const handleUpdateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      await apiClient.updateOrderStatus(orderId, newStatus);
      await refreshData();
      showToast(`تم تحديث حالة الطلب إلى: ${newStatus} ✅`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await apiClient.deleteOrder(orderId);
      await refreshData();
      showToast('تم حذف الفاتورة وإعادة الكميات للمخزون بنجاح 🗑️');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء حذف الفاتورة');
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    try {
      await apiClient.deleteCustomer(customerId);
      await refreshData();
      showToast('تم حذف العميل من النظام 🗑️');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء حذف العميل');
    }
  };

  const handleAddCustomer = async (customerData: { name: string; phone: string; address?: string }) => {
    try {
      await apiClient.createCustomer(customerData);
      await refreshData();
      showToast('تم إضافة العميل الجديد بنجاح ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة العميل');
    }
  };

  const handleAddProduct = async (productData: Omit<Product, 'id'>) => {
    try {
      await apiClient.createProduct(productData);
      await refreshData();
      showToast('تم إضافة صنف الزيت بنجاح ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة الصنف');
    }
  };

  const handleUpdateProduct = async (updatedProduct: Product) => {
    try {
      await apiClient.updateProduct(updatedProduct);
      await refreshData();
      showToast('تم تحديث بيانات الصنف ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الصنف');
    }
  };

  const handleAddUser = async (
    userData: Omit<User, 'id'> & { password?: string },
    initialRepData?: Partial<SalesRep>
  ) => {
    try {
      await apiClient.createTeamMember(userData, initialRepData);
      await refreshData();
      showToast('تم إضافة العضو الجديد بنجاح ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة العضو');
    }
  };

  const handleUpdateUser = async (updatedUser: User & { newPassword?: string }) => {
    try {
      await apiClient.updateTeamMember(updatedUser);
      await refreshData();
      showToast('تم تحديث بيانات المستخدم ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث المستخدم');
    }
  };

  const handleUpdateRep = async (updatedRep: SalesRep) => {
    try {
      await apiClient.updateSalesRep(updatedRep);
      await refreshData();
      showToast('تم تحديث بيانات السيلز والعمولات ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث بيانات السيلز');
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!authUser) return;
    try {
      await apiClient.sendChatMessage({
        senderId: authUser.id,
        senderName: authUser.name,
        text,
      });
      await refreshData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'تعذر إرسال الرسالة');
    }
  };

  const currentRep = useMemo(() => {
    return salesReps.find((r) => r.userId === authUser?.id || r.id === authUser?.salesRepId);
  }, [salesReps, authUser]);

  const canAccessInventory = Boolean(
    authUser && (authUser.role === 'admin' || authUser.role === 'supervisor' || authUser.canEditInventory)
  );
  const canAccessUsers = Boolean(authUser && authUser.role === 'admin');

  const handleNavigateTab = useCallback(
    (tab: AppTab) => {
      if (tab === 'inventory' && !canAccessInventory) return;
      if (tab === 'admin-users' && !canAccessUsers) return;
      setActiveTab(tab);
      setIsMobileMenuOpen(false);
    },
    [canAccessInventory, canAccessUsers]
  );

  useEffect(() => {
    if (activeTab === 'inventory' && !canAccessInventory) {
      setActiveTab('dashboard');
    } else if (activeTab === 'admin-users' && !canAccessUsers) {
      setActiveTab('dashboard');
    }
  }, [activeTab, canAccessInventory, canAccessUsers]);

  // 1. Username & Password Login Screen
  if (!authUser || !authToken) {
    return (
      <div className="min-h-screen bg-[#072F5F] flex items-center justify-center p-4 sm:p-6 font-cairo overflow-y-auto" dir="rtl">
        <div className="bg-white w-full max-w-md rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-10 shadow-2xl flex flex-col items-center animate-in zoom-in-95 duration-200 my-4">
          <img
            src={LOGO_SRC}
            alt="Kima Scent"
            className="h-20 sm:h-24 w-auto object-contain mb-3"
          />
          <p className="text-sm font-bold text-slate-600 mb-6 text-center">
            نظام إدارة مبيعات الزيوت العطرية والفواتير
          </p>

          {authError && (
            <div className="w-full mb-4 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm font-bold text-center">
              {authError}
            </div>
          )}

          <form onSubmit={(e) => void handleLoginSubmit(e)} className="w-full space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">اسم المستخدم</label>
              <input
                type="text"
                autoComplete="username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="أدخل اسم المستخدم..."
                className="w-full min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl outline-none font-bold border-2 border-slate-200/80 focus:border-[#0A468C] text-base text-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">كلمة المرور</label>
              <div className="relative">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور..."
                  className="w-full min-h-[48px] px-4 pl-11 py-3 bg-slate-50 rounded-2xl outline-none font-bold border-2 border-slate-200/80 focus:border-[#0A468C] text-base text-slate-900"
                  required
                />
                <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full min-h-[52px] py-3.5 bg-[#0A468C] text-white rounded-2xl font-black text-base sm:text-lg hover:bg-[#072F5F] transition-all shadow-lg active:scale-[0.99] disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {authLoading && <RefreshCcw className="w-5 h-5 animate-spin" />}
              {authLoading ? 'جاري الدخول وتجهيز البيانات...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. Fallback Loading Skeleton (only shown if workspace wasn't already hydrated on login)
  if (dataLoading && products.length === 0 && orders.length === 0) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-4 sm:p-8 font-cairo space-y-6" dir="rtl">
        <div className="bg-[#072F5F] rounded-3xl p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshCcw className="w-6 h-6 animate-spin text-blue-200" />
            <div>
              <p className="font-black text-base">جاري تجهيز بيانات Kima Scent...</p>
              <p className="text-xs text-blue-200 font-bold">قد يستغرق الاتصال الأول ثوانٍ قليلة فقط</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-3xl p-5 border border-slate-100 space-y-3 animate-pulse">
              <div className="h-4 w-24 bg-slate-200 rounded" />
              <div className="h-8 w-28 bg-slate-200 rounded" />
              <div className="h-3 w-20 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-3xl p-6 border border-slate-100 space-y-4 animate-pulse">
          <div className="h-5 w-40 bg-slate-200 rounded" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 w-full bg-slate-100 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (dataError && products.length === 0 && orders.length === 0) {
    return (
      <div className="h-screen bg-[#072F5F] flex items-center justify-center p-4 font-cairo" dir="rtl">
        <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl text-center space-y-4">
          <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black text-slate-900">تعذر تحميل البيانات</h2>
          <p className="text-sm font-bold text-slate-600">{dataError}</p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => void refreshData()}
              className="flex-1 min-h-[48px] py-3 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm transition-all"
            >
              إعادة المحاولة
            </button>
            <button
              onClick={logout}
              className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
            >
              خروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  const preparedCount = orders.filter((o) => o.status === 'تم التجهيز').length;
  const shippingCount = orders.filter((o) => o.status === 'تم الشحن').length;
  const deliveredCount = orders.filter((o) => o.status === 'تم التسليم').length;

  const allNavItems: {
    id: AppTab;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    badge?: number;
    visible: boolean;
  }[] = [
    {
      id: 'dashboard',
      label: 'الرئيسية',
      shortLabel: 'الرئيسية',
      icon: <LayoutDashboard className="w-5 h-5" />,
      visible: true,
    },
    {
      id: 'orders',
      label: 'الفواتير والمبيعات',
      shortLabel: 'الفواتير',
      icon: <ShoppingCart className="w-5 h-5" />,
      visible: true,
    },
    {
      id: 'prepared-orders',
      label: 'الطلبات المجهزة',
      shortLabel: 'المجهزة',
      icon: <PackageCheck className="w-5 h-5" />,
      badge: preparedCount,
      visible: true,
    },
    {
      id: 'shipping-orders',
      label: 'الطلبات في الشحن',
      shortLabel: 'الشحن',
      icon: <Truck className="w-5 h-5" />,
      badge: shippingCount,
      visible: true,
    },
    {
      id: 'delivered-orders',
      label: 'طلبات تم تسليمها',
      shortLabel: 'المسلمة',
      icon: <CheckCircle2 className="w-5 h-5" />,
      badge: deliveredCount,
      visible: true,
    },
    {
      id: 'inventory',
      label: 'المخزون والزيوت',
      shortLabel: 'المخزون',
      icon: <Package className="w-5 h-5" />,
      visible: canAccessInventory,
    },
    {
      id: 'customers',
      label: 'العملاء والتسويق',
      shortLabel: 'العملاء',
      icon: <Users className="w-5 h-5" />,
      visible: true,
    },
    {
      id: 'admin-users',
      label: 'فريق عمل كيما سنت',
      shortLabel: 'الفريق',
      icon: <Award className="w-5 h-5" />,
      visible: canAccessUsers,
    },
  ];

  const navItems = allNavItems.filter((item) => item.visible);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#F8FAFC] font-cairo text-slate-900 overflow-hidden" dir="rtl">

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 sm:top-6 left-1/2 -translate-x-1/2 z-[999] bg-[#072F5F] text-white px-5 sm:px-6 py-3 rounded-2xl font-black text-xs sm:text-sm shadow-2xl border border-blue-400/30 animate-in fade-in slide-in-from-top-4 flex items-center gap-2 max-w-[92vw]">
          <Check className="w-4 h-4 text-blue-300 shrink-0" />
          <span className="truncate">{toastMessage}</span>
        </div>
      )}

      {/* Mobile Top App Bar (compact 56px height) */}
      <div className="md:hidden h-14 bg-[#072F5F] text-white px-3 flex items-center justify-between z-30 shrink-0 shadow-md no-print">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-xl transition-all"
            aria-label="القائمة والحساب"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-white rounded-lg px-1.5 py-0.5">
              <img src={LOGO_SRC} alt="Kima Scent" className="h-6 w-auto object-contain" />
            </div>
            <span className="font-black text-sm whitespace-nowrap">Kima Scent</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void refreshData()}
            aria-label="تحديث البيانات"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-xl transition-all"
          >
            <RefreshCcw className={`w-4 h-4 text-blue-200 ${dataLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowChat(true)}
            aria-label="شات الفريق"
            className="min-h-[40px] px-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold flex items-center gap-1"
          >
            <MessageSquare className="w-4 h-4 text-blue-200" />
            <span className="text-xs tabular-nums">{chatMessages.length}</span>
          </button>
          <button
            onClick={() => setShowOrderForm(true)}
            className="min-h-[40px] bg-white text-[#072F5F] px-3 rounded-xl font-black text-xs flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            فاتورة
          </button>
        </div>
      </div>

      {/* Mobile Menu Backdrop */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-xs no-print"
        />
      )}

      {/* Sidebar Navigation (Drawer on Mobile, Static Sidebar on Desktop) */}
      <aside className={`
        fixed md:static inset-y-0 right-0 z-40 w-72 bg-[#072F5F] text-white flex flex-col justify-between no-print transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full md:translate-x-0'}
      `}>
        <div className="overflow-y-auto flex-1">
          <div className="p-5 sm:p-6 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white rounded-2xl p-1.5 shadow-sm">
                <img src={LOGO_SRC} alt="Kima Scent" className="h-10 w-auto object-contain" />
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tight">Kima Scent</h1>
                <p className="text-[10px] text-blue-200 font-bold uppercase tracking-wider">Inspired by Purity</p>
              </div>
            </div>

            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center md:hidden text-white/80 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="mt-5 px-4 pb-4 space-y-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigateTab(item.id)}
                className={`w-full min-h-[46px] flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl font-black text-sm transition-all ${
                  activeTab === item.id
                    ? 'bg-[#0A468C] text-white shadow-lg ring-1 ring-white/20'
                    : 'text-blue-100 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </div>
                {typeof item.badge === 'number' && (
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-black tabular-nums ${
                      activeTab === item.id
                        ? 'bg-white text-[#072F5F]'
                        : 'bg-white/10 text-blue-100'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-5 border-t border-white/10 space-y-3">
          <button
            onClick={() => { setShowChat(true); setIsMobileMenuOpen(false); }}
            className="w-full min-h-[44px] py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2"
          >
            <MessageSquare className="w-4 h-4 text-blue-200" />
            شات الفريق الداخلي ({chatMessages.length})
          </button>

          <div className="flex items-center justify-between px-2 pt-1">
            <div className="space-y-0.5">
              <p className="text-sm font-black text-white">{authUser.name}</p>
              <p className="text-xs text-blue-200 font-bold">
                {authUser.role === 'admin' ? 'مدير عام' : authUser.role === 'supervisor' ? 'مشرف' : 'سيلز'}
              </p>
            </div>
            <button
              onClick={logout}
              title="تسجيل الخروج"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-red-300 hover:text-white hover:bg-red-500/20 rounded-xl transition-all"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area (with bottom padding on mobile for fixed Bottom Tab Bar) */}
      <main className="flex-1 overflow-y-auto p-3.5 sm:p-6 md:p-10 pb-24 md:pb-10 print:p-0 print:overflow-visible">
        {dataError && (
          <div className="mb-4 sm:mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-2xl flex items-center justify-between gap-3 no-print">
            <span className="text-sm font-bold">{dataError}</span>
            <button
              onClick={() => void refreshData()}
              className="min-h-[40px] px-4 py-1.5 bg-red-600 text-white rounded-xl text-xs font-black hover:bg-red-700 shrink-0"
            >
              تحديث
            </button>
          </div>
        )}

        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 sm:mb-8 no-print">
          <div>
            <h2 className="text-lg sm:text-2xl md:text-3xl font-black text-slate-900">
              {activeTab === 'dashboard' && 'لوحة التحكم والتقارير'}
              {activeTab === 'orders' && 'سجل الفواتير والمبيعات'}
              {activeTab === 'prepared-orders' && 'الطلبات المجهزة'}
              {activeTab === 'shipping-orders' && 'الطلبات في الشحن'}
              {activeTab === 'delivered-orders' && 'طلبات تم تسليمها'}
              {activeTab === 'inventory' && canAccessInventory && 'مخزون الزيوت العطرية'}
              {activeTab === 'customers' && 'إدارة العملاء والتسويق الذكي'}
              {activeTab === 'admin-users' && canAccessUsers && 'فريق العمل والعمولات'}
            </h2>
            <p className="text-xs font-bold text-slate-500 mt-0.5 hidden sm:block">
              Kima Scent — نظام متكامل لإدارة مبيعات الزيوت العطرية والعمولات والفواتير
            </p>
          </div>

          <button
            onClick={() => setShowOrderForm(true)}
            className="hidden sm:flex bg-[#0A468C] text-white px-5 sm:px-6 py-3 sm:py-3.5 rounded-2xl font-black shadow-lg hover:bg-[#072F5F] hover:shadow-xl transition-all items-center gap-2.5 active:scale-95 text-xs sm:text-sm whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-4 h-4 sm:w-5 sm:h-5" />
            فاتورة بيع جديدة
          </button>
        </header>

        <div className="no-print">
          {activeTab === 'dashboard' && (
            <DashboardTab
              orders={orders}
              products={products}
              salesReps={salesReps}
              customers={customers}
              currentUser={authUser}
              onOpenNewOrder={() => setShowOrderForm(true)}
              onSelectOrder={(order) => setSelectedOrder(order)}
              onNavigateTab={(tab) => handleNavigateTab(tab)}
            />
          )}

          {(activeTab === 'orders' ||
            activeTab === 'prepared-orders' ||
            activeTab === 'shipping-orders' ||
            activeTab === 'delivered-orders') && (
            <OrdersTab
              key={activeTab}
              orders={orders}
              currentUser={authUser}
              fixedStatus={
                activeTab === 'prepared-orders'
                  ? 'تم التجهيز'
                  : activeTab === 'shipping-orders'
                    ? 'تم الشحن'
                    : activeTab === 'delivered-orders'
                      ? 'تم التسليم'
                      : undefined
              }
              onOpenNewOrder={() => {
                setOrderModalMode('create');
                setShowOrderForm(true);
              }}
              onSelectOrder={(order) => setSelectedOrder(order)}
              onEditOrder={(order, mode) => {
                setOrderModalMode(mode || getOrderEditAction(order).mode);
                setEditingOrder(order);
              }}
              onUpdateStatus={(orderId, status) => void handleUpdateOrderStatus(orderId, status)}
              onResolveEditRequest={(orderId, action) =>
                handleResolveOrderEditRequest(orderId, action)
              }
              onDeleteOrder={(orderId) => void handleDeleteOrder(orderId)}
            />
          )}

          {activeTab === 'inventory' && canAccessInventory && (
            <InventoryTab
              products={products}
              currentUser={authUser}
              onAddProduct={(p) => void handleAddProduct(p)}
              onUpdateProduct={(p) => void handleUpdateProduct(p)}
            />
          )}

          {activeTab === 'customers' && (
            <CustomersTab
              customers={customers}
              orders={orders}
              products={products}
              currentUser={authUser}
              onDeleteCustomer={(id) => void handleDeleteCustomer(id)}
              onAddCustomer={(c) => void handleAddCustomer(c)}
            />
          )}

          {activeTab === 'admin-users' && canAccessUsers && (
            <UsersTab
              users={users}
              salesReps={salesReps}
              currentUser={authUser}
              onAddUser={(u, r) => void handleAddUser(u, r)}
              onUpdateUser={(u) => void handleUpdateUser(u)}
              onUpdateRep={(r) => void handleUpdateRep(r)}
            />
          )}
        </div>

        {(showOrderForm || editingOrder) && (
          <OrderFormModal
            key={editingOrder ? `${editingOrder.id}-${orderModalMode}` : 'new-order'}
            products={products}
            salesReps={salesReps}
            customers={customers}
            currentRep={currentRep}
            isAdmin={authUser.role === 'admin' || authUser.role === 'supervisor'}
            editingOrder={editingOrder}
            formMode={editingOrder ? orderModalMode : 'create'}
            onClose={() => {
              setShowOrderForm(false);
              setEditingOrder(null);
              setOrderModalMode('create');
            }}
            onSaveOrder={editingOrder ? handleUpdateExistingOrder : handleSaveNewOrder}
          />
        )}

        {selectedOrder && (() => {
          const editInfo = getOrderEditAction(selectedOrder);
          return (
            <Invoice
              order={selectedOrder}
              canEdit={editInfo.allowed}
              editLabel={editInfo.label}
              onEdit={() => {
                setOrderModalMode(editInfo.mode);
                setEditingOrder(selectedOrder);
                setSelectedOrder(null);
              }}
              onClose={() => setSelectedOrder(null)}
            />
          );
        })()}

        {showChat && (
          <TeamChatModal
            messages={chatMessages}
            currentUser={authUser}
            onClose={() => setShowChat(false)}
            onSendMessage={(txt) => void handleSendMessage(txt)}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (Thumb-Zone Ergonomics) */}
      <nav
        aria-label="التنقل السريع"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe shadow-[0_-4px_20px_rgba(7,47,95,0.08)] no-print"
      >
        <div
          className={`flex items-center h-16 px-1.5 ${
            navItems.length > 5 ? 'overflow-x-auto gap-1' : 'justify-around'
          }`}
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigateTab(item.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                  navItems.length > 5 ? 'min-w-[66px] shrink-0 px-1.5' : 'flex-1'
                } ${
                  isActive ? 'text-[#0A468C]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <div className={`p-1 rounded-xl transition-colors relative ${isActive ? 'bg-blue-50' : ''}`}>
                  {item.icon}
                </div>
                <span className={`text-[11px] leading-tight whitespace-nowrap ${isActive ? 'font-black' : 'font-bold'}`}>
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export const App: React.FC = () => (
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

export default App;
