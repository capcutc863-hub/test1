
export type OrderStatus = 'قيد التنفيذ' | 'تم التجهيز' | 'تم الشحن' | 'تم التسليم' | 'مرتجع' | 'ملغي';
export type UserRole = 'admin' | 'supervisor' | 'sales';
export type OilGrade = 'عالي (Code A)' | 'وسط (Code B)' | 'تجاري (Code C)';

export interface MonthlyCommission {
  month: string;
  amount: number;
  ordersCount: number;
}

export interface User {
  id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  username: string;
  role: UserRole;
  salesRepId?: string;
  isSuspended: boolean;
  isMuted: boolean;
  canEditInventory: boolean;
  canConfirmDelivery: boolean; // صلاحية تأكيد التسليم
  canManageOrderStatus?: boolean; // صلاحية التجهيز والشحن والموافقة على طلبات التعديل
  canDeleteOrders?: boolean; // صلاحية حذف الفواتير
  canDeleteCustomers?: boolean; // صلاحية حذف العملاء
  address?: string;
  startDate?: string;
  online?: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export interface Product {
  id: string;
  name: string;
  grade: OilGrade;
  pricePerMg: number;
  stock: number; // in mg
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  totalSpent: number;
  classification: 'ذهبي' | 'فضي' | 'عادي';
  lastOrderDate: string;
}

export interface SalesRep {
  id: string;
  userId: string;
  name: string;
  totalCommission: number; // العمولات المكتسبة (تم التسليم)
  pendingCommission: number; // العمولات المعلقة (قيد التنفيذ)
  ordersCount: number;
  maxDiscountAllowed: number;
  customCommissionRate: number;
  monthlyHistory: MonthlyCommission[];
}

export interface OrderItem {
  productName: string;
  grade: OilGrade;
  quantity: number;
  price: number;
  isCustom?: boolean;
  addToInventory?: boolean;
}

export interface OrderEditRequest {
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  reason?: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNotes?: string;
  salesRepId: string;
  salesRepName: string;
  items: OrderItem[];
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  commission: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNotes?: string;
  salesRepId: string;
  salesRepName: string;
  items: OrderItem[];
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  commission: number;
  pendingEditRequest?: OrderEditRequest | null;
}
