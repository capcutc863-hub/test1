import { getInMemoryIdToken } from './tokenStore.ts';
import type {
  ChatMessage,
  Customer,
  Order,
  OrderEditRequest,
  OrderStatus,
  Product,
  SalesRep,
  User,
} from '../../types.ts';

export interface WorkspacePayload {
  users: User[];
  products: Product[];
  salesReps: SalesRep[];
  customers: Customer[];
  orders: Order[];
  chatMessages: ChatMessage[];
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
  tokenOverride?: string
): Promise<T> {
  const token = tokenOverride || (await getInMemoryIdToken());
  if (!token) {
    throw new Error('يرجى تسجيل الدخول أولاً.');
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || 'حدث خطأ أثناء تنفيذ العملية.');
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  getWorkspace: (tokenOverride?: string) =>
    apiRequest<WorkspacePayload>('/api/workspace', {}, tokenOverride),

  createOrder: (orderData: Omit<Order, 'id' | 'createdAt'>) =>
    apiRequest<Order>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    }),

  updateOrder: (orderId: string, orderData: Omit<Order, 'id' | 'createdAt'>) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      body: JSON.stringify(orderData),
    }),

  submitOrderEditRequest: (
    orderId: string,
    requestData: Omit<OrderEditRequest, 'requestedById' | 'requestedByName' | 'requestedAt'>
  ) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/edit-request`, {
      method: 'POST',
      body: JSON.stringify(requestData),
    }),

  resolveOrderEditRequest: (
    orderId: string,
    action: 'approve' | 'reject',
    overrideData?: Omit<Order, 'id' | 'createdAt'>
  ) =>
    apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/edit-request/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, overrideData }),
    }),

  updateOrderStatus: (orderId: string, status: OrderStatus) =>
    apiRequest<{ ok: boolean }>(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  deleteOrder: (orderId: string) =>
    apiRequest<{ ok: boolean }>(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
    }),

  createCustomer: (customerData: { name: string; phone: string; address?: string }) =>
    apiRequest<Customer>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(customerData),
    }),

  deleteCustomer: (customerId: string) =>
    apiRequest<{ ok: boolean }>(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'DELETE',
    }),

  createProduct: (productData: Omit<Product, 'id'>) =>
    apiRequest<Product>('/api/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    }),

  updateProduct: (product: Product) =>
    apiRequest<{ ok: boolean }>(`/api/products/${encodeURIComponent(product.id)}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    }),

  createTeamMember: (
    userData: Omit<User, 'id'> & { password?: string },
    initialRepData?: Partial<SalesRep>
  ) =>
    apiRequest<{ ok: boolean }>('/api/team-members', {
      method: 'POST',
      body: JSON.stringify({ userData, initialRepData }),
    }),

  updateTeamMember: (user: User & { newPassword?: string }) =>
    apiRequest<{ ok: boolean }>(`/api/team-members/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      body: JSON.stringify(user),
    }),

  updateSalesRep: (rep: SalesRep) =>
    apiRequest<{ ok: boolean }>(`/api/sales-reps/${encodeURIComponent(rep.id)}`, {
      method: 'PUT',
      body: JSON.stringify(rep),
    }),

  sendChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) =>
    apiRequest<ChatMessage>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(msg),
    }),
};
