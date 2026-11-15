
import { Product, Customer, SalesRep, User } from './types';

export const INITIAL_USERS: User[] = [
  { 
    id: 'u1', 
    name: 'المدير العام', 
    nickname: 'الكبير',
    username: 'admin', 
    role: 'admin', 
    isSuspended: false, 
    isMuted: false, 
    canEditInventory: true,
    canConfirmDelivery: true,
    startDate: '2023-01-01',
    address: 'القاهرة، مصر',
    online: true
  },
  { 
    id: 'u2', 
    name: 'أحمد علي', 
    nickname: 'أبو حميد',
    username: 'ahmed', 
    role: 'sales', 
    salesRepId: 's1', 
    isSuspended: false, 
    isMuted: false, 
    canEditInventory: false,
    canConfirmDelivery: false,
    startDate: '2023-05-15',
    address: 'الجيزة، مصر',
    online: true
  },
  { 
    id: 'u3', 
    name: 'سارة محمود', 
    username: 'sara', 
    role: 'sales', 
    salesRepId: 's2', 
    isSuspended: false, 
    isMuted: false, 
    canEditInventory: true,
    canConfirmDelivery: false,
    startDate: '2023-06-10',
    address: 'الإسكندرية، مصر',
    online: false
  },
];

export const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'زيت لافندر فرنسي', grade: 'عالي (Code A)', pricePerMg: 15, stock: 10000 },
  { id: '2', name: 'زيت لافندر فرنسي', grade: 'وسط (Code B)', pricePerMg: 10, stock: 15000 },
  { id: '3', name: 'زيت عود ملكي', grade: 'عالي (Code A)', pricePerMg: 45, stock: 5000 },
  { id: '4', name: 'زيت ياسمين طبيعي', grade: 'تجاري (Code C)', pricePerMg: 8, stock: 20000 },
];

export const INITIAL_SALES_REPS: SalesRep[] = [
  { 
    id: 's1', 
    userId: 'u2',
    name: 'أحمد علي', 
    totalCommission: 0, 
    pendingCommission: 0,
    ordersCount: 0, 
    maxDiscountAllowed: 5, 
    customCommissionRate: 0.05,
    monthlyHistory: []
  },
  { 
    id: 's2', 
    userId: 'u3',
    name: 'سارة محمود', 
    totalCommission: 0, 
    pendingCommission: 0,
    ordersCount: 0, 
    maxDiscountAllowed: 7, 
    customCommissionRate: 0.06,
    monthlyHistory: []
  },
];

export const INITIAL_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'شركة النور للعطور', phone: '0123456789', totalSpent: 0, classification: 'عادي', lastOrderDate: '2023-10-01' },
];

