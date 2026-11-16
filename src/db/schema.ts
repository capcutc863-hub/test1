import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { MonthlyCommission, OrderEditRequest, OrderItem } from '../../types.ts';

// Authenticated Firebase users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Internal team members & sales staff permissions
export const teamMembers = pgTable('team_members', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nickname: text('nickname'),
  avatar: text('avatar'),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull().default(''),
  role: text('role').notNull(),
  salesRepId: text('sales_rep_id'),
  isSuspended: boolean('is_suspended').notNull().default(false),
  isMuted: boolean('is_muted').notNull().default(false),
  canEditInventory: boolean('can_edit_inventory').notNull().default(false),
  canConfirmDelivery: boolean('can_confirm_delivery').notNull().default(false),
  canManageOrderStatus: boolean('can_manage_order_status').notNull().default(false),
  canDeleteOrders: boolean('can_delete_orders').notNull().default(false),
  canDeleteCustomers: boolean('can_delete_customers').notNull().default(false),
  address: text('address'),
  startDate: text('start_date'),
  online: boolean('online').notNull().default(false),
});

// Essential oils inventory products
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  grade: text('grade').notNull(),
  pricePerMg: doublePrecision('price_per_mg').notNull(),
  stock: integer('stock').notNull(),
});

// Sales representatives commission & discount configuration
export const salesReps = pgTable('sales_reps', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  totalCommission: doublePrecision('total_commission').notNull().default(0),
  pendingCommission: doublePrecision('pending_commission').notNull().default(0),
  ordersCount: integer('orders_count').notNull().default(0),
  maxDiscountAllowed: doublePrecision('max_discount_allowed').notNull().default(10),
  customCommissionRate: doublePrecision('custom_commission_rate').notNull().default(0.05),
  monthlyHistory: jsonb('monthly_history').$type<MonthlyCommission[]>().notNull().default([]),
});

// Wholesale customers
export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  address: text('address'),
  totalSpent: doublePrecision('total_spent').notNull().default(0),
  classification: text('classification').notNull().default('عادي'),
  lastOrderDate: text('last_order_date').notNull().default(''),
});

// Sales invoices / orders
export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull().default(''),
  customerAddress: text('customer_address').notNull().default(''),
  customerNotes: text('customer_notes'),
  salesRepId: text('sales_rep_id').notNull(),
  salesRepName: text('sales_rep_name').notNull(),
  items: jsonb('items').$type<OrderItem[]>().notNull(),
  subtotal: doublePrecision('subtotal').notNull(),
  discountPercentage: doublePrecision('discount_percentage').notNull().default(0),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
  shippingCost: doublePrecision('shipping_cost').notNull().default(0),
  totalAmount: doublePrecision('total_amount').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  commission: doublePrecision('commission').notNull().default(0),
  pendingEditRequest: jsonb('pending_edit_request').$type<OrderEditRequest | null>().default(null),
});

// Internal team chat messages
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  senderId: text('sender_id').notNull(),
  senderName: text('sender_name').notNull(),
  text: text('text').notNull(),
  timestamp: text('timestamp').notNull(),
});
