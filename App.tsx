import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  ClipboardList,
  ShieldCheck,
  KeyRound,
  BarChart3,
} from 'lucide-react';
import {
  Product,
  Customer,
  SalesRep,
  Order,
  OrderStatus,
  User,
  ChatMessage,
  ProductCategory,
  OilGradeRecord,
  CommissionConfig,
  SystemGeneralSettings,
} from './types';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import {
  apiClient,
  setOwnerStepUpToken,
  type ManageItemSourcingPayload,
  type OrderStatusTransitionPayload,
} from './src/lib/api';
import { DEFAULT_CATEGORIES, DEFAULT_COMMISSION_CONFIG } from './src/lib/commission-utils';
import Invoice from './components/Invoice';
import { DashboardTab } from './components/DashboardTab';
import { OrdersTab } from './components/OrdersTab';
import { OperationsTab } from './components/OperationsTab';
import { OrderFormModal } from './components/OrderFormModal';
import { InventoryTab } from './components/InventoryTab';
import { CustomersTab } from './components/CustomersTab';
import { UsersTab } from './components/UsersTab';
import { TeamChatModal } from './components/TeamChatModal';
import { OwnerConsoleTab } from './components/OwnerConsoleTab';
import { PdfPriceImportModal } from './components/PdfPriceImportModal';
import { ReportsCenterTab } from './components/ReportsCenterTab';

type AppTab =
  | 'dashboard'
  | 'operations'
  | 'orders'
  | 'prepared-orders'
  | 'shipping-orders'
  | 'delivered-orders'
  | 'inventory'
  | 'customers'
  | 'reports'
  | 'admin-users'
  | 'owner-console';

const DEFAULT_GENERAL_SETTINGS: SystemGeneralSettings = {
  companyName: 'Kima Scent',
  defaultShippingCost: 50,
  lowStockThresholdOils: 5000,
  lowStockThresholdOther: 50,
  allowCustomItemsInInvoices: true,
};

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
    completeAuthenticatedSession,
    logout,
    setAuthUser,
  } = useAuth();

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>(DEFAULT_CATEGORIES);
  const [oilGrades, setOilGrades] = useState<OilGradeRecord[]>([]);
  const [commissionConfig, setCommissionConfig] = useState<CommissionConfig>(DEFAULT_COMMISSION_CONFIG);
  const [generalSettings, setGeneralSettings] = useState<SystemGeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [hasOwnerAccount, setHasOwnerAccount] = useState<boolean>(true);
  const [canBootstrapOwner, setCanBootstrapOwner] = useState<boolean>(false);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [hasLoadedWorkspace, setHasLoadedWorkspace] = useState(false);
  const hydratedTokenRef = useRef<string | null>(null);

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [orderModalMode, setOrderModalMode] = useState<'create' | 'edit' | 'edit-request' | 'approve-override'>('create');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showPdfImportModal, setShowPdfImportModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // One-time initial Owner claim modal (visible only if no owner exists yet)
  const [showClaimOwnerModal, setShowClaimOwnerModal] = useState(false);
  const [claimPassword, setClaimPassword] = useState('');
  const [claimRecoveryKey, setClaimRecoveryKey] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimingOwner, setClaimingOwner] = useState(false);

  // Owner password recovery modal on Login screen
  const [showRecoverOwnerModal, setShowRecoverOwnerModal] = useState(false);
  const [recUsername, setRecUsername] = useState('');
  const [recKey, setRecKey] = useState('');
  const [recNewPassword, setRecNewPassword] = useState('');
  const [recError, setRecError] = useState<string | null>(null);
  const [recoveringOwner, setRecoveringOwner] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const applyWorkspaceData = useCallback(
    (data: {
      users: User[];
      products: Product[];
      categories?: ProductCategory[];
      oilGrades?: OilGradeRecord[];
      commissionConfig?: CommissionConfig;
      generalSettings?: SystemGeneralSettings;
      hasOwnerAccount?: boolean;
      canBootstrapOwner?: boolean;
      salesReps: SalesRep[];
      customers: Customer[];
      orders: Order[];
      chatMessages: ChatMessage[];
    }) => {
      setUsers(data.users);
      setProducts(data.products);
      if (Array.isArray(data.categories) && data.categories.length > 0) {
        setCategories(data.categories);
      }
      if (Array.isArray(data.oilGrades)) {
        setOilGrades(data.oilGrades);
      }
      if (data.commissionConfig) {
        setCommissionConfig(data.commissionConfig);
      }
      if (data.generalSettings) {
        setGeneralSettings(data.generalSettings);
      }
      if (typeof data.hasOwnerAccount === 'boolean') {
        setHasOwnerAccount(data.hasOwnerAccount);
        setCanBootstrapOwner(
          typeof data.canBootstrapOwner === 'boolean'
            ? data.canBootstrapOwner
            : !data.hasOwnerAccount
        );
      }
      setSalesReps(data.salesReps);
      setCustomers(data.customers);
      setOrders(data.orders);
      setChatMessages(data.chatMessages);
      setHasLoadedWorkspace(true);

      setAuthUser((prev) => {
        if (!prev) return prev;
        const refreshedSelf = data.users.find((u) => u.id === prev.id);
        if (!refreshedSelf) return prev;
        const unchanged =
          prev.role === refreshedSelf.role &&
          prev.name === refreshedSelf.name &&
          prev.isSuspended === refreshedSelf.isSuspended &&
          prev.isMuted === refreshedSelf.isMuted &&
          prev.canEditInventory === refreshedSelf.canEditInventory &&
          prev.canConfirmDelivery === refreshedSelf.canConfirmDelivery &&
          prev.canManageOrderStatus === refreshedSelf.canManageOrderStatus &&
          prev.canDeleteOrders === refreshedSelf.canDeleteOrders &&
          prev.canDeleteCustomers === refreshedSelf.canDeleteCustomers &&
          prev.salesRepId === refreshedSelf.salesRepId;
        return unchanged ? prev : refreshedSelf;
      });
    },
    [setAuthUser]
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
      if (hydratedTokenRef.current === authToken) {
        return;
      }
      hydratedTokenRef.current = authToken;
      if (initialWorkspace) {
        applyWorkspaceData(initialWorkspace);
        clearInitialWorkspace();
        setDataLoading(false);
        setDataError(null);
      } else {
        void refreshData();
      }
    } else {
      hydratedTokenRef.current = null;
      setHasLoadedWorkspace(false);
      setUsers([]);
      setProducts([]);
      setCategories(DEFAULT_CATEGORIES);
      setOilGrades([]);
      setCommissionConfig(DEFAULT_COMMISSION_CONFIG);
      setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
      setHasOwnerAccount(true);
      setCanBootstrapOwner(false);
      setSalesReps([]);
      setCustomers([]);
      setOrders([]);
      setChatMessages([]);
      setOwnerStepUpToken(null);
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

  const handleClaimInitialOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (claimingOwner) return;
    setClaimError(null);
    if (!claimPassword) {
      setClaimError('يرجى إدخال كلمة مرورك الحالية.');
      return;
    }
    if (claimRecoveryKey.trim().length < 8) {
      setClaimError('مفتاح الاستعادة يجب أن لا يقل عن 8 أحرف أو أرقام.');
      return;
    }
    setClaimingOwner(true);
    try {
      const res = await apiClient.claimInitialOwner(claimPassword, claimRecoveryKey.trim());
      completeAuthenticatedSession(res.token, res.user, res.workspace);
      setShowClaimOwnerModal(false);
      setClaimPassword('');
      setClaimRecoveryKey('');
      showToast('تم تفعيل صلاحية المالك الرئيسي وحفظ مفتاح الاستعادة بنجاح');
    } catch (err: unknown) {
      setClaimError(err instanceof Error ? err.message : 'تعذر تفعيل حساب المالك الرئيسي.');
    } finally {
      setClaimingOwner(false);
    }
  };

  const handleRecoverOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecError(null);
    if (!recUsername.trim() || !recKey.trim() || recNewPassword.length < 6) {
      setRecError('يرجى إدخال اسم المستخدم ومفتاح الاستعادة وكلمة مرور جديدة (6 أحرف فأكثر).');
      return;
    }
    setRecoveringOwner(true);
    try {
      const res = await apiClient.recoverOwnerAccess(
        recUsername.trim(),
        recKey.trim(),
        recNewPassword
      );
      completeAuthenticatedSession(res.token, res.user, res.workspace);
      setShowRecoverOwnerModal(false);
      setRecUsername('');
      setRecKey('');
      setRecNewPassword('');
      setActiveTab('dashboard');
      showToast('تمت استعادة حساب المالك الرئيسي وتسجيل الدخول بنجاح');
    } catch (err: unknown) {
      setRecError(err instanceof Error ? err.message : 'فشل التحقق من بيانات الاستعادة');
    } finally {
      setRecoveringOwner(false);
    }
  };

  const handleSaveNewOrder = async (orderData: Omit<Order, 'id' | 'createdAt'>) => {
    try {
      const newOrder = await apiClient.createOrder(orderData);
      await refreshData();
      showToast('تم حفظ الفاتورة بانتظار تأكيد العميل ✅');
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

      const updated = await apiClient.updateOrder(editingOrder.id, {
        ...orderData,
        expectedVersion: editingOrder.version,
        reason: requestReason,
      });
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

  const handleConfirmOrder = async (orderId: string) => {
    try {
      const updated = await apiClient.confirmOrder(orderId);
      await refreshData();
      setSelectedOrder((prev) => (prev && prev.id === orderId ? updated : prev));
      showToast('تم تأكيد الطلب وخصم المخزون وإرساله للتجهيز ✅');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'تعذر تأكيد الطلب';
      showToast(message);
      throw err;
    }
  };

  const handleCancelOrder = async (orderId: string, reason: string) => {
    try {
      const updated = await apiClient.cancelOrder(orderId, reason);
      await refreshData();
      setSelectedOrder((prev) => (prev && prev.id === orderId ? updated : prev));
      showToast('تم إلغاء الفاتورة وحفظها في السجل بنجاح');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة';
      showToast(message);
      throw err;
    }
  };

  const handleReviewOrderRevision = async (
    orderId: string,
    status:
      | 'تمت مراجعة التعديل واعتماده'
      | 'يحتاج إعادة تجهيز'
      | 'تمت إعادة التجهيز'
      | 'تمت مراجعة التعديل'
      | 'التعديل جاهز لاستكمال التجهيز',
    note?: string
  ) => {
    try {
      const updated = await apiClient.reviewOrderRevision(orderId, status, note);
      await refreshData();
      setSelectedOrder((prev) => (prev && prev.id === orderId ? updated : prev));
      showToast(`تم تسجيل: ${status} ✅`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'تعذر تحديث مراجعة التعديل';
      showToast(message);
      throw err;
    }
  };

  const handleManageOrderItemSourcing = async (
    orderId: string,
    payload: ManageItemSourcingPayload
  ) => {
    try {
      const updated = await apiClient.manageOrderItemSourcing(orderId, payload);
      await refreshData();
      setSelectedOrder((prev) => (prev && prev.id === orderId ? updated : prev));
      showToast('تم تحديث مصدر وتوريد الصنف والمخزون بنجاح ✅');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'تعذر تحديث توريد الصنف';
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

  const isOwnerOrElevatedUser = (order: Order): boolean => {
    if (!authUser) return false;
    return (
      authUser.role === 'owner' ||
      authUser.role === 'admin' ||
      authUser.role === 'supervisor' ||
      Boolean(authUser.canManageOrderStatus) ||
      !authUser.salesRepId ||
      order.salesRepId === authUser.salesRepId
    );
  };

  const getOrderEditAction = (order: Order): { allowed: boolean; mode: 'edit' | 'edit-request'; label: string } => {
    if (!authUser) return { allowed: false, mode: 'edit', label: 'تعديل' };
    if (authUser.role === 'owner' || authUser.role === 'admin') {
      return { allowed: true, mode: 'edit', label: 'تعديل' };
    }
    if (
      order.status === 'بانتظار تأكيد العميل' ||
      order.status === 'طلب جديد' ||
      order.status === 'بانتظار التجهيز' ||
      order.status === 'قيد التنفيذ'
    ) {
      return isOwnerOrElevatedUser(order)
        ? { allowed: true, mode: 'edit', label: 'تعديل' }
        : { allowed: false, mode: 'edit', label: 'تعديل' };
    }
    if (order.status === 'جاري التجهيز' || order.status === 'تم التجهيز') {
      if (authUser.canManageOrderStatus) return { allowed: true, mode: 'edit', label: 'تعديل' };
      return isOwnerOrElevatedUser(order)
        ? { allowed: true, mode: 'edit-request', label: 'طلب تعديل' }
        : { allowed: false, mode: 'edit', label: 'تعديل' };
    }
    return { allowed: false, mode: 'edit', label: 'تعديل' };
  };

  const canConfirmOrderAction = (order: Order): boolean =>
    order.status === 'بانتظار تأكيد العميل' && isOwnerOrElevatedUser(order);

  const canCancelOrderAction = (order: Order): boolean => {
    if (!authUser) return false;
    if (order.status === 'بانتظار تأكيد العميل') {
      return isOwnerOrElevatedUser(order);
    }
    if (
      order.status === 'طلب جديد' ||
      order.status === 'بانتظار التجهيز' ||
      order.status === 'جاري التجهيز' ||
      order.status === 'تم التجهيز' ||
      order.status === 'قيد التنفيذ'
    ) {
      return (
        authUser.role === 'owner' ||
        authUser.role === 'admin' ||
        Boolean(authUser.canManageOrderStatus)
      );
    }
    return false;
  };

  const handleUpdateOrderStatus = async (
    orderId: string,
    newStatus: OrderStatus,
    options?: OrderStatusTransitionPayload
  ) => {
    try {
      await apiClient.updateOrderStatus(orderId, newStatus, options);
      await refreshData();
      showToast(`تم تحديث حالة الطلب إلى: ${newStatus} ✅`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
      throw err;
    }
  };

  const handleHoldOrder = async (
    orderId: string,
    payload: { isHeld: boolean; reason?: string; notes?: string }
  ) => {
    try {
      await apiClient.holdOrder(orderId, payload);
      await refreshData();
      showToast(payload.isHeld ? 'تم تعليق الطلب بنجاح ⏸️' : 'تم فك تعليق الطلب واستئناف التشغيل ▶️');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث حالة التعليق');
      throw err;
    }
  };

  const handleUpdateOperationalNotes = async (orderId: string, operationalNotes: string) => {
    try {
      await apiClient.updateOperationalNotes(orderId, operationalNotes);
      await refreshData();
      showToast('تم حفظ الملاحظات التشغيلية ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'تعذر حفظ الملاحظات التشغيلية');
      throw err;
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      await apiClient.deleteOrder(orderId);
      await refreshData();
      showToast('تم حذف الفاتورة بنجاح 🗑️');
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

  const handleAddCustomer = async (customerData: {
    name: string;
    phone: string;
    address?: string;
    assignedSalesRepId?: string | null;
  }) => {
    try {
      await apiClient.createCustomer(customerData);
      await refreshData();
      showToast('تم إضافة العميل الجديد بنجاح ✅');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة العميل');
    }
  };

  const handleUpdateCustomer = async (
    customerId: string,
    customerData: {
      name: string;
      phone?: string;
      address?: string;
      assignedSalesRepId?: string | null;
    }
  ) => {
    try {
      const res = await apiClient.updateCustomer(customerId, customerData);
      await refreshData();
      showToast(
        res.linkedOrdersSynced > 0
          ? `تم تحديث بيانات العميل وربط ${res.linkedOrdersSynced} فاتورة تاريخية بنجاح ✅`
          : 'تم تحديث بيانات العميل بنجاح ✅'
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث بيانات العميل';
      showToast(message);
      throw err;
    }
  };

  const handleAddProduct = async (
    productData: Partial<Omit<Product, 'id'>> & Pick<Product, 'name' | 'pricePerMg' | 'stock'>
  ) => {
    try {
      await apiClient.createProduct(productData);
      await refreshData();
      showToast('تم إضافة الصنف بنجاح');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة الصنف';
      showToast(message);
      throw err;
    }
  };

  const handleUpdateProduct = async (updatedProduct: Product) => {
    try {
      await apiClient.updateProduct(updatedProduct);
      await refreshData();
      showToast('تم تحديث بيانات الصنف');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الصنف';
      showToast(message);
      throw err;
    }
  };

  const handleArchiveProduct = async (productId: string, isActive: boolean, reason?: string) => {
    try {
      await apiClient.archiveProduct(productId, isActive, reason);
      await refreshData();
      showToast(isActive ? 'تمت استعادة الصنف وتفعيله بنجاح ✅' : 'تمت أرشفة الصنف بنجاح 📦');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث حالة أرشفة الصنف';
      showToast(message);
      throw err;
    }
  };

  const handleDeleteProduct = async (productId: string, confirmPassword?: string) => {
    try {
      await apiClient.deleteProduct(productId, confirmPassword);
      await refreshData();
      showToast('تم حذف الصنف نهائياً من الكتالوج 🗑️');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء حذف الصنف';
      showToast(message);
      throw err;
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

  const canAccessOperations = Boolean(
    authUser && (authUser.role === 'owner' || authUser.role === 'admin' || authUser.canManageOrderStatus)
  );
  const canAccessInventory = Boolean(
    authUser &&
      (authUser.role === 'owner' ||
        authUser.role === 'admin' ||
        authUser.role === 'supervisor' ||
        authUser.canEditInventory)
  );
  const canAccessUsers = Boolean(
    authUser && (authUser.role === 'owner' || authUser.role === 'admin')
  );
  const canAccessOwnerConsole = Boolean(authUser && authUser.role === 'owner');

  const handleNavigateTab = useCallback(
    (tab: AppTab) => {
      if (tab === 'operations' && !canAccessOperations) return;
      if (tab === 'inventory' && !canAccessInventory) return;
      if (tab === 'admin-users' && !canAccessUsers) return;
      if (tab === 'owner-console' && !canAccessOwnerConsole) return;
      setActiveTab(tab);
      setIsMobileMenuOpen(false);
    },
    [canAccessOperations, canAccessInventory, canAccessUsers, canAccessOwnerConsole]
  );

  useEffect(() => {
    if (activeTab === 'operations' && !canAccessOperations) {
      setActiveTab('dashboard');
    } else if (activeTab === 'inventory' && !canAccessInventory) {
      setActiveTab('dashboard');
    } else if (activeTab === 'admin-users' && !canAccessUsers) {
      setActiveTab('dashboard');
    } else if (activeTab === 'owner-console' && !canAccessOwnerConsole) {
      setActiveTab('dashboard');
    }
  }, [activeTab, canAccessOperations, canAccessInventory, canAccessUsers, canAccessOwnerConsole]);

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
            نظام إدارة المبيعات والكتالوج والفواتير
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

            <button
              type="button"
              onClick={() => {
                setRecError(null);
                setShowRecoverOwnerModal(true);
              }}
              className="w-full py-2 text-xs font-black text-[#0A468C] hover:underline flex items-center justify-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              نسيت كلمة مرور المالك / استعادة الحساب
            </button>
          </form>
        </div>

        {/* Owner Recovery Modal */}
        {showRecoverOwnerModal && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-[800]" dir="rtl">
            <div className="bg-white w-full max-w-md rounded-3xl p-6 sm:p-7 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                  استعادة حساب المالك الرئيسي
                </h3>
                <button
                  type="button"
                  onClick={() => setShowRecoverOwnerModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                أدخل اسم مستخدم المالك ومفتاح الاستعادة السري المحفوظ لإعادة تعيين كلمة المرور واستعادة الدخول فورًا.
              </p>
              {recError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black">
                  {recError}
                </div>
              )}
              <form onSubmit={(e) => void handleRecoverOwnerSubmit(e)} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم مستخدم المالك</label>
                  <input
                    type="text"
                    value={recUsername}
                    onChange={(e) => setRecUsername(e.target.value)}
                    placeholder="username"
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">مفتاح الاستعادة (Recovery Key)</label>
                  <input
                    type="password"
                    value={recKey}
                    onChange={(e) => setRecKey(e.target.value)}
                    placeholder="أدخل مفتاح الاستعادة السري"
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور الجديدة (6 أحرف فأكثر)</label>
                  <input
                    type="password"
                    value={recNewPassword}
                    onChange={(e) => setRecNewPassword(e.target.value)}
                    placeholder="********"
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={recoveringOwner}
                  className="w-full min-h-[48px] bg-[#072F5F] hover:bg-[#0A468C] text-white rounded-2xl font-black text-sm disabled:opacity-60"
                >
                  {recoveringOwner ? 'جاري التحقق والاستعادة...' : 'تعيين كلمة المرور والدخول'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 2. Fallback Loading Skeleton (only shown before initial workspace hydration for this session)
  if (dataLoading && !hasLoadedWorkspace) {
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

  if (dataError && !hasLoadedWorkspace) {
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

  const activeOperationsCount = orders.filter(
    (o) =>
      o.status === 'طلب جديد' ||
      o.status === 'قيد التنفيذ' ||
      o.status === 'بانتظار التجهيز' ||
      o.status === 'جاري التجهيز' ||
      o.status === 'تم التجهيز' ||
      o.status === 'تم الشحن'
  ).length;
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
      id: 'operations',
      label: 'إدارة التجهيز والشحن',
      shortLabel: 'التشغيل',
      icon: <ClipboardList className="w-5 h-5" />,
      badge: activeOperationsCount,
      visible: canAccessOperations,
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
      label: 'المنتجات والمخزون',
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
      id: 'reports',
      label: 'التقارير والتحليلات',
      shortLabel: 'التقارير',
      icon: <BarChart3 className="w-5 h-5" />,
      visible: true,
    },
    {
      id: 'admin-users',
      label: 'فريق عمل كيما سنت',
      shortLabel: 'الفريق',
      icon: <Award className="w-5 h-5" />,
      visible: canAccessUsers,
    },
    {
      id: 'owner-console',
      label: 'إدارة المالك الرئيسي',
      shortLabel: 'المالك',
      icon: <ShieldCheck className="w-5 h-5" />,
      visible: canAccessOwnerConsole,
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
                {authUser.role === 'owner'
                  ? 'المالك الرئيسي'
                  : authUser.role === 'admin'
                    ? 'مدير عام'
                    : authUser.role === 'supervisor'
                      ? 'مشرف'
                      : 'سيلز'}
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

        {authUser.role === 'admin' && !hasOwnerAccount && canBootstrapOwner && (
          <div className="mb-5 bg-amber-50 border border-amber-300 text-amber-950 px-4 sm:px-5 py-3.5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 no-print">
            <div className="flex items-start gap-2.5 text-xs sm:text-sm font-bold">
              <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-black">لم يتم تفعيل حساب المالك الرئيسي (Owner) للنظام بعد</p>
                <p className="text-xs text-amber-800">
                  يمكنك الآن بصفتك المدير الحالي تفعيل صلاحية المالك الرئيسي لمرة واحدة مع تعيين مفتاح استعادة آمن.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setClaimError(null);
                setShowClaimOwnerModal(true);
              }}
              className="min-h-[42px] px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black whitespace-nowrap shrink-0"
            >
              تفعيل المالك الرئيسي الآن
            </button>
          </div>
        )}

        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 sm:mb-8 no-print">
          <div>
            <h2 className="text-lg sm:text-2xl md:text-3xl font-black text-slate-900">
              {activeTab === 'dashboard' && 'لوحة التحكم والتقارير'}
              {activeTab === 'operations' && canAccessOperations && 'إدارة التجهيز والشحن والمتابعة'}
              {activeTab === 'orders' && 'سجل الفواتير والمبيعات'}
              {activeTab === 'prepared-orders' && 'الطلبات المجهزة'}
              {activeTab === 'shipping-orders' && 'الطلبات في الشحن'}
              {activeTab === 'delivered-orders' && 'طلبات تم تسليمها'}
              {activeTab === 'inventory' && canAccessInventory && 'كتالوج المنتجات والمخزون'}
              {activeTab === 'customers' && 'إدارة العملاء والتسويق الذكي'}
              {activeTab === 'reports' && 'مركز التقارير والتحليلات الموحد'}
              {activeTab === 'admin-users' && canAccessUsers && 'فريق العمل والعمولات'}
              {activeTab === 'owner-console' && canAccessOwnerConsole && 'إدارة المالك الرئيسي'}
            </h2>
            <p className="text-xs font-bold text-slate-500 mt-0.5 hidden sm:block">
              {generalSettings.companyName || 'Kima Scent'} — نظام متكامل لإدارة المبيعات والكتالوج والعمولات والفواتير
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
              categories={categories}
              salesReps={salesReps}
              customers={customers}
              generalSettings={generalSettings}
              currentUser={authUser}
              onOpenNewOrder={() => setShowOrderForm(true)}
              onSelectOrder={(order) => setSelectedOrder(order)}
              onNavigateTab={(tab) => handleNavigateTab(tab)}
            />
          )}

          {activeTab === 'operations' && canAccessOperations && (
            <OperationsTab
              orders={orders}
              products={products}
              currentUser={authUser}
              onSelectOrder={(order) => setSelectedOrder(order)}
              onEditOrder={(order, mode) => {
                setOrderModalMode(mode || getOrderEditAction(order).mode);
                setEditingOrder(order);
              }}
              onTransitionStatus={(orderId, status, options) =>
                handleUpdateOrderStatus(orderId, status, options)
              }
              onReviewRevision={(orderId, status, note) =>
                handleReviewOrderRevision(orderId, status, note)
              }
              onManageItemSourcing={(orderId, payload) =>
                handleManageOrderItemSourcing(orderId, payload)
              }
              onCancelOrder={(orderId, reason) => handleCancelOrder(orderId, reason)}
              onHoldOrder={(orderId, payload) => handleHoldOrder(orderId, payload)}
              onUpdateOperationalNotes={(orderId, notes) =>
                handleUpdateOperationalNotes(orderId, notes)
              }
              onResolveEditRequest={(orderId, action) =>
                handleResolveOrderEditRequest(orderId, action)
              }
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
              onConfirmOrder={(orderId) => handleConfirmOrder(orderId)}
              onCancelOrder={(orderId, reason) => handleCancelOrder(orderId, reason)}
              onUpdateStatus={(orderId, status, options) =>
                handleUpdateOrderStatus(orderId, status, options)
              }
              onResolveEditRequest={(orderId, action) =>
                handleResolveOrderEditRequest(orderId, action)
              }
              onDeleteOrder={(orderId) => void handleDeleteOrder(orderId)}
              onRefreshWorkspace={refreshData}
            />
          )}

          {activeTab === 'inventory' && canAccessInventory && (
            <InventoryTab
              products={products}
              categories={categories}
              oilGrades={oilGrades}
              commissionConfig={commissionConfig}
              generalSettings={generalSettings}
              currentUser={authUser}
              onOpenPdfImport={canAccessOwnerConsole ? () => setShowPdfImportModal(true) : undefined}
              onAddProduct={(p) => handleAddProduct(p)}
              onUpdateProduct={(p) => handleUpdateProduct(p)}
              onArchiveProduct={(id, nextActive, reason) => handleArchiveProduct(id, nextActive, reason)}
              onDeleteProduct={(id, confirmPassword) => handleDeleteProduct(id, confirmPassword)}
              onRefreshWorkspace={refreshData}
            />
          )}

          {activeTab === 'customers' && (
            <CustomersTab
              customers={customers}
              orders={orders}
              products={products}
              salesReps={salesReps}
              currentUser={authUser}
              onDeleteCustomer={(id) => void handleDeleteCustomer(id)}
              onAddCustomer={(c) => void handleAddCustomer(c)}
              onUpdateCustomer={(id, data) => handleUpdateCustomer(id, data)}
              onRefreshWorkspace={refreshData}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsCenterTab
              currentUser={authUser}
              categories={categories}
              salesReps={salesReps}
            />
          )}

          {activeTab === 'admin-users' && canAccessUsers && (
            <UsersTab
              users={users}
              salesReps={salesReps}
              categories={categories}
              currentUser={authUser}
              onAddUser={(u, r) => void handleAddUser(u, r)}
              onUpdateUser={(u) => void handleUpdateUser(u)}
              onUpdateRep={(r) => void handleUpdateRep(r)}
            />
          )}

          {activeTab === 'owner-console' && canAccessOwnerConsole && (
            <OwnerConsoleTab
              currentUser={authUser}
              products={products}
              categories={categories}
              salesReps={salesReps}
              commissionConfig={commissionConfig}
              generalSettings={generalSettings}
              onRefreshWorkspace={refreshData}
              onUpdateProduct={(p) => handleUpdateProduct(p)}
              onOpenPdfImport={() => setShowPdfImportModal(true)}
              onNavigateTab={(tab) => handleNavigateTab(tab)}
            />
          )}
        </div>

        {(showOrderForm || editingOrder) && (
          <OrderFormModal
            key={editingOrder ? `${editingOrder.id}-${orderModalMode}` : 'new-order'}
            products={products}
            categories={categories}
            oilGrades={oilGrades}
            commissionConfig={commissionConfig}
            generalSettings={generalSettings}
            salesReps={salesReps}
            customers={customers}
            currentRep={currentRep}
            isAdmin={authUser.role === 'owner' || authUser.role === 'admin' || authUser.role === 'supervisor'}
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

        {showPdfImportModal && canAccessOwnerConsole && (
          <PdfPriceImportModal
            categories={categories}
            onClose={() => setShowPdfImportModal(false)}
            onImported={refreshData}
          />
        )}

        {showClaimOwnerModal && authUser.role === 'admin' && !hasOwnerAccount && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-[850]" dir="rtl">
            <div className="bg-white w-full max-w-md rounded-3xl p-6 sm:p-7 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                  تفعيل حساب المالك الرئيسي (لمرة واحدة)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowClaimOwnerModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                سيتم ترقية حسابك الحالي (@{authUser.username}) ليصبح المالك الرئيسي للنظام، وتعيين مفتاح استعادة آمن خاص بك. لا يمكن تكرار هذه الخطوة بعد إتمامها.
              </p>
              {claimError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-black">
                  {claimError}
                </div>
              )}
              <form onSubmit={(e) => void handleClaimInitialOwner(e)} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">كلمة مرورك الحالية</label>
                  <input
                    type="password"
                    value={claimPassword}
                    onChange={(e) => setClaimPassword(e.target.value)}
                    placeholder="أكد كلمة مرور حسابك الحالية"
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">مفتاح الاستعادة السري (8 أحرف فأكثر)</label>
                  <input
                    type="password"
                    value={claimRecoveryKey}
                    onChange={(e) => setClaimRecoveryKey(e.target.value)}
                    placeholder="احفظ هذا المفتاح في مكان آمن"
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={claimingOwner}
                  className="w-full min-h-[48px] bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-black text-sm disabled:opacity-60"
                >
                  {claimingOwner ? 'جاري التفعيل...' : 'تأكيد وتفعيل المالك الرئيسي'}
                </button>
              </form>
            </div>
          </div>
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
              canConfirm={canConfirmOrderAction(selectedOrder)}
              onConfirmOrder={handleConfirmOrder}
              canCancel={canCancelOrderAction(selectedOrder)}
              onCancelOrder={handleCancelOrder}
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
