import { Product, Customer, SalesRep, Order, User, ChatMessage, OrderStatus } from '../types';
import { INITIAL_PRODUCTS, INITIAL_SALES_REPS, INITIAL_USERS, INITIAL_CUSTOMERS } from '../constants';

const STORAGE_KEYS = {
  USERS: 'royal_oils_users_v2',
  PRODUCTS: 'royal_oils_products_v2',
  SALES_REPS: 'royal_oils_sales_reps_v2',
  CUSTOMERS: 'royal_oils_customers_v2',
  ORDERS: 'royal_oils_orders_v2',
  CHAT: 'royal_oils_chat_v2'
};

const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-1001',
    customerName: 'شركة النور للعطور',
    customerPhone: '0123456789',
    customerAddress: 'وسط البلد، القاهرة',
    customerNotes: 'تسليم في أسرع وقت مع عينات جديدة',
    salesRepId: 's1',
    salesRepName: 'أحمد علي',
    items: [
      { productName: 'زيت عود ملكي', grade: 'عالي (Code A)', quantity: 200, price: 45 },
      { productName: 'زيت لافندر فرنسي', grade: 'عالي (Code A)', quantity: 300, price: 15 }
    ],
    subtotal: 13500,
    discountPercentage: 5,
    discountAmount: 675,
    shippingCost: 100,
    totalAmount: 12925,
    status: 'تم التسليم',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    commission: 646.25
  },
  {
    id: 'ord-1002',
    customerName: 'مؤسسة الزهور العطرية',
    customerPhone: '0109876543',
    customerAddress: 'مدينة نصر، القاهرة',
    customerNotes: 'تغليف خاص ومحكم للزجاجات',
    salesRepId: 's2',
    salesRepName: 'سارة محمود',
    items: [
      { productName: 'زيت ياسمين طبيعي', grade: 'تجاري (Code C)', quantity: 500, price: 8 }
    ],
    subtotal: 4000,
    discountPercentage: 0,
    discountAmount: 0,
    shippingCost: 80,
    totalAmount: 4080,
    status: 'قيد التنفيذ',
    createdAt: new Date().toISOString(),
    commission: 240
  }
];

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 'msg-1',
    senderId: 'u1',
    senderName: 'المدير العام',
    text: 'أهلاً بفريق العمل، تم تحديث أسعار زيت العود الملكي وتوفرت شحنة جديدة.',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString()
  },
  {
    id: 'msg-2',
    senderId: 'u2',
    senderName: 'أحمد علي',
    text: 'ممتاز يا فندم، عميل شركة النور طلب كمية إضافية بالفعل.',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString()
  }
];

// Helper to safely read from localStorage
function getLocal<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) {
      localStorage.setItem(key, JSON.stringify(fallback));
      return fallback;
    }
    return JSON.parse(item);
  } catch (e) {
    console.warn(`Error reading ${key} from storage:`, e);
    return fallback;
  }
}

// Helper to write to localStorage
function setLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('royal_storage_update', { detail: { key } }));
  } catch (e) {
    console.warn(`Error writing ${key} to storage:`, e);
  }
}

export const dataStore = {
  getUsers: (): User[] => getLocal(STORAGE_KEYS.USERS, INITIAL_USERS),
  setUsers: (users: User[]) => setLocal(STORAGE_KEYS.USERS, users),

  getProducts: (): Product[] => getLocal(STORAGE_KEYS.PRODUCTS, INITIAL_PRODUCTS),
  setProducts: (products: Product[]) => setLocal(STORAGE_KEYS.PRODUCTS, products),

  getSalesReps: (): SalesRep[] => getLocal(STORAGE_KEYS.SALES_REPS, INITIAL_SALES_REPS),
  setSalesReps: (reps: SalesRep[]) => setLocal(STORAGE_KEYS.SALES_REPS, reps),

  getCustomers: (): Customer[] => getLocal(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS),
  setCustomers: (customers: Customer[]) => setLocal(STORAGE_KEYS.CUSTOMERS, customers),

  getOrders: (): Order[] => getLocal(STORAGE_KEYS.ORDERS, INITIAL_ORDERS),
  setOrders: (orders: Order[]) => setLocal(STORAGE_KEYS.ORDERS, orders),

  getChat: (): ChatMessage[] => getLocal(STORAGE_KEYS.CHAT, INITIAL_CHAT),
  setChat: (messages: ChatMessage[]) => setLocal(STORAGE_KEYS.CHAT, messages),

  // Add Order and update customer / sales rep / stock
  addOrder: (order: Order) => {
    const orders = dataStore.getOrders();
    const newOrders = [order, ...orders];
    dataStore.setOrders(newOrders);

    // Update customer stats
    const customers = dataStore.getCustomers();
    const existingCustIdx = customers.findIndex(c => c.name.trim() === order.customerName.trim() || (order.customerPhone && c.phone === order.customerPhone));
    
    if (existingCustIdx >= 0) {
      const cust = customers[existingCustIdx];
      const newTotalSpent = cust.totalSpent + order.totalAmount;
      const classification: 'ذهبي' | 'فضي' | 'عادي' = newTotalSpent >= 10000 ? 'ذهبي' : newTotalSpent >= 5000 ? 'فضي' : 'عادي';
      customers[existingCustIdx] = {
        ...cust,
        totalSpent: newTotalSpent,
        classification,
        lastOrderDate: order.createdAt
      };
      dataStore.setCustomers([...customers]);
    } else {
      const newTotalSpent = order.totalAmount;
      const classification: 'ذهبي' | 'فضي' | 'عادي' = newTotalSpent >= 10000 ? 'ذهبي' : newTotalSpent >= 5000 ? 'فضي' : 'عادي';
      const newCust: Customer = {
        id: `c-${Date.now()}`,
        name: order.customerName,
        phone: order.customerPhone,
        address: order.customerAddress,
        totalSpent: newTotalSpent,
        classification,
        lastOrderDate: order.createdAt
      };
      dataStore.setCustomers([newCust, ...customers]);
    }

    // Update sales rep stats
    const reps = dataStore.getSalesReps();
    const repIdx = reps.findIndex(r => r.id === order.salesRepId);
    if (repIdx >= 0) {
      const rep = reps[repIdx];
      if (order.status === 'تم التسليم') {
        reps[repIdx] = {
          ...rep,
          totalCommission: rep.totalCommission + order.commission,
          ordersCount: rep.ordersCount + 1
        };
      } else {
        reps[repIdx] = {
          ...rep,
          pendingCommission: rep.pendingCommission + order.commission,
          ordersCount: rep.ordersCount + 1
        };
      }
      dataStore.setSalesReps([...reps]);
    }

    // Deduct stock
    const products = dataStore.getProducts();
    order.items.forEach(item => {
      const prodIdx = products.findIndex(p => p.name === item.productName && p.grade === item.grade);
      if (prodIdx >= 0) {
        products[prodIdx] = {
          ...products[prodIdx],
          stock: Math.max(0, products[prodIdx].stock - item.quantity)
        };
      }
    });
    dataStore.setProducts([...products]);

    return order;
  },

  // Update order status
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => {
    const orders = dataStore.getOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;
    
    const prevOrder = orders[idx];
    const prevStatus = prevOrder.status;
    orders[idx] = { ...prevOrder, status: newStatus };
    dataStore.setOrders([...orders]);

    // Recalculate sales rep commissions
    const reps = dataStore.getSalesReps();
    const repIdx = reps.findIndex(r => r.id === prevOrder.salesRepId);
    if (repIdx >= 0) {
      const rep = reps[repIdx];
      let totalComm = rep.totalCommission;
      let pendingComm = rep.pendingCommission;

      if (prevStatus === 'قيد التنفيذ' && newStatus === 'تم التسليم') {
        pendingComm = Math.max(0, pendingComm - prevOrder.commission);
        totalComm += prevOrder.commission;
      } else if (prevStatus === 'تم التسليم' && (newStatus === 'مرتجع' || newStatus === 'ملغي')) {
        totalComm = Math.max(0, totalComm - prevOrder.commission);
      } else if (prevStatus === 'قيد التنفيذ' && (newStatus === 'مرتجع' || newStatus === 'ملغي')) {
        pendingComm = Math.max(0, pendingComm - prevOrder.commission);
      }

      reps[repIdx] = { ...rep, totalCommission: totalComm, pendingCommission: pendingComm };
      dataStore.setSalesReps([...reps]);
    }
  },

  // Delete an order with full inventory restitution & commission adjustment
  deleteOrder: (orderId: string) => {
    const orders = dataStore.getOrders();
    const orderToDelete = orders.find(o => o.id === orderId);
    if (!orderToDelete) return;

    // 1. Restore product stock
    const products = dataStore.getProducts();
    orderToDelete.items.forEach(item => {
      const prodIdx = products.findIndex(p => p.name === item.productName && p.grade === item.grade);
      if (prodIdx >= 0) {
        products[prodIdx] = {
          ...products[prodIdx],
          stock: products[prodIdx].stock + item.quantity
        };
      }
    });
    dataStore.setProducts([...products]);

    // 2. Adjust sales rep commissions & counts
    const reps = dataStore.getSalesReps();
    const repIdx = reps.findIndex(r => r.id === orderToDelete.salesRepId);
    if (repIdx >= 0) {
      const rep = reps[repIdx];
      let totalComm = rep.totalCommission;
      let pendingComm = rep.pendingCommission;

      if (orderToDelete.status === 'تم التسليم') {
        totalComm = Math.max(0, totalComm - orderToDelete.commission);
      } else if (orderToDelete.status === 'قيد التنفيذ') {
        pendingComm = Math.max(0, pendingComm - orderToDelete.commission);
      }

      reps[repIdx] = {
        ...rep,
        totalCommission: totalComm,
        pendingCommission: pendingComm,
        ordersCount: Math.max(0, rep.ordersCount - 1)
      };
      dataStore.setSalesReps([...reps]);
    }

    // 3. Remove order from list
    const updatedOrders = orders.filter(o => o.id !== orderId);
    dataStore.setOrders(updatedOrders);

    // 4. Recalculate customer total spent
    const customers = dataStore.getCustomers();
    const custIdx = customers.findIndex(c => 
      c.name.trim() === orderToDelete.customerName.trim() || 
      (orderToDelete.customerPhone && c.phone === orderToDelete.customerPhone)
    );
    if (custIdx >= 0) {
      const remainingOrders = updatedOrders.filter(o => 
        o.customerName.trim() === customers[custIdx].name.trim() || 
        (customers[custIdx].phone && o.customerPhone === customers[custIdx].phone)
      );
      const newTotalSpent = remainingOrders.reduce((sum, o) => sum + o.totalAmount, 0);
      const classification: 'ذهبي' | 'فضي' | 'عادي' = newTotalSpent >= 10000 ? 'ذهبي' : newTotalSpent >= 5000 ? 'فضي' : 'عادي';
      customers[custIdx] = {
        ...customers[custIdx],
        totalSpent: newTotalSpent,
        classification,
        lastOrderDate: remainingOrders.length > 0 ? remainingOrders[0].createdAt : ''
      };
      dataStore.setCustomers([...customers]);
    }
  },

  // Add customer directly
  addCustomer: (customerData: Omit<Customer, 'id' | 'totalSpent' | 'classification' | 'lastOrderDate'>) => {
    const customers = dataStore.getCustomers();
    const newCust: Customer = {
      ...customerData,
      id: `c-${Date.now()}`,
      totalSpent: 0,
      classification: 'عادي',
      lastOrderDate: ''
    };
    dataStore.setCustomers([newCust, ...customers]);
    return newCust;
  },

  // Delete customer from system
  deleteCustomer: (customerId: string) => {
    const customers = dataStore.getCustomers();
    const updated = customers.filter(c => c.id !== customerId);
    dataStore.setCustomers(updated);
  },

  // Add Chat message
  addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const messages = dataStore.getChat();
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg-${Date.now()}`,
      timestamp: new Date().toISOString()
    };
    dataStore.setChat([...messages, newMsg]);
    return newMsg;
  },

  // Reset to initial demo data
  resetAll: () => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(INITIAL_USERS));
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(INITIAL_PRODUCTS));
    localStorage.setItem(STORAGE_KEYS.SALES_REPS, JSON.stringify(INITIAL_SALES_REPS));
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(INITIAL_CUSTOMERS));
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(INITIAL_ORDERS));
    localStorage.setItem(STORAGE_KEYS.CHAT, JSON.stringify(INITIAL_CHAT));
    window.dispatchEvent(new CustomEvent('royal_storage_update', { detail: { key: 'all' } }));
  }
};
