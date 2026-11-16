import { desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  chatMessages,
  customers,
  orders,
  products,
  salesReps,
  teamMembers,
} from './schema.ts';
import {
  INITIAL_CUSTOMERS,
  INITIAL_PRODUCTS,
  INITIAL_SALES_REPS,
  INITIAL_USERS,
} from '../../constants.ts';
import { hashPassword, verifyPassword } from '../lib/auth-utils.ts';
import type {
  ChatMessage,
  Customer,
  OilGrade,
  Order,
  OrderEditRequest,
  OrderItem,
  OrderStatus,
  Product,
  SalesRep,
  User,
  UserRole,
} from '../../types.ts';

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
      { productName: 'زيت لافندر فرنسي', grade: 'عالي (Code A)', quantity: 300, price: 15 },
    ],
    subtotal: 13500,
    discountPercentage: 5,
    discountAmount: 675,
    shippingCost: 100,
    totalAmount: 12925,
    status: 'تم التسليم',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    commission: 646.25,
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
      { productName: 'زيت ياسمين طبيعي', grade: 'تجاري (Code C)', quantity: 500, price: 8 },
    ],
    subtotal: 4000,
    discountPercentage: 0,
    discountAmount: 0,
    shippingCost: 80,
    totalAmount: 4080,
    status: 'قيد التنفيذ',
    createdAt: new Date().toISOString(),
    commission: 240,
  },
];

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 'msg-1',
    senderId: 'u1',
    senderName: 'المدير العام',
    text: 'أهلاً بفريق العمل، تم تحديث أسعار زيت العود الملكي وتوفرت شحنة جديدة.',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 'msg-2',
    senderId: 'u2',
    senderName: 'أحمد علي',
    text: 'ممتاز يا فندم، عميل شركة النور طلب كمية إضافية بالفعل.',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
];

function computeClassification(totalSpent: number): 'ذهبي' | 'فضي' | 'عادي' {
  if (totalSpent >= 10000) return 'ذهبي';
  if (totalSpent >= 5000) return 'فضي';
  return 'عادي';
}

function mapTeamMemberRow(u: typeof teamMembers.$inferSelect): User {
  return {
    id: u.id,
    name: u.name,
    nickname: u.nickname ?? undefined,
    avatar: u.avatar ?? undefined,
    username: u.username,
    role: u.role as UserRole,
    salesRepId: u.salesRepId ?? undefined,
    isSuspended: u.isSuspended,
    isMuted: u.isMuted,
    canEditInventory: u.canEditInventory,
    canConfirmDelivery: u.canConfirmDelivery,
    canManageOrderStatus: u.canManageOrderStatus,
    canDeleteOrders: u.canDeleteOrders,
    canDeleteCustomers: u.canDeleteCustomers,
    address: u.address ?? undefined,
    startDate: u.startDate ?? undefined,
    online: u.online,
  };
}

let seedVerified = false;
let seedInFlight: Promise<void> | null = null;

export async function ensureInitialDataSeeded() {
  if (seedVerified) return;
  if (seedInFlight) return seedInFlight;

  seedInFlight = (async () => {
    try {
      const existingUsers = await db.select().from(teamMembers);
      const existingProducts = await db.select({ id: products.id }).from(products).limit(1);

      if (existingUsers.length === 0 && existingProducts.length === 0) {
        const defaultHash = hashPassword('123456');
        await db
          .insert(teamMembers)
          .values(
            INITIAL_USERS.map((u) => ({
              id: u.id,
              name: u.name,
              nickname: u.nickname ?? null,
              avatar: u.avatar ?? null,
              username: u.username,
              passwordHash: defaultHash,
              role: u.role,
              salesRepId: u.salesRepId ?? null,
              isSuspended: u.isSuspended,
              isMuted: u.isMuted,
              canEditInventory: u.canEditInventory,
              canConfirmDelivery: u.canConfirmDelivery,
              canManageOrderStatus: u.canManageOrderStatus ?? u.role === 'admin',
              canDeleteOrders: u.canDeleteOrders ?? u.role === 'admin',
              canDeleteCustomers: u.canDeleteCustomers ?? u.role === 'admin',
              address: u.address ?? null,
              startDate: u.startDate ?? null,
              online: u.online ?? false,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(products)
          .values(
            INITIAL_PRODUCTS.map((p) => ({
              id: p.id,
              name: p.name,
              grade: p.grade,
              pricePerMg: p.pricePerMg,
              stock: p.stock,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(salesReps)
          .values(
            INITIAL_SALES_REPS.map((r) => ({
              id: r.id,
              userId: r.userId,
              name: r.name,
              totalCommission: r.totalCommission,
              pendingCommission: r.pendingCommission,
              ordersCount: r.ordersCount,
              maxDiscountAllowed: r.maxDiscountAllowed,
              customCommissionRate: r.customCommissionRate,
              monthlyHistory: r.monthlyHistory,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(customers)
          .values(
            INITIAL_CUSTOMERS.map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              address: c.address ?? null,
              totalSpent: c.totalSpent,
              classification: c.classification,
              lastOrderDate: c.lastOrderDate,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(orders)
          .values(
            INITIAL_ORDERS.map((o) => ({
              id: o.id,
              customerName: o.customerName,
              customerPhone: o.customerPhone,
              customerAddress: o.customerAddress,
              customerNotes: o.customerNotes ?? null,
              salesRepId: o.salesRepId,
              salesRepName: o.salesRepName,
              items: o.items,
              subtotal: o.subtotal,
              discountPercentage: o.discountPercentage,
              discountAmount: o.discountAmount,
              shippingCost: o.shippingCost,
              totalAmount: o.totalAmount,
              status: o.status,
              createdAt: o.createdAt,
              commission: o.commission,
            }))
          )
          .onConflictDoNothing();

        await db
          .insert(chatMessages)
          .values(INITIAL_CHAT)
          .onConflictDoNothing();
      } else {
        const rowsMissingPassword = existingUsers.filter((u) => !u.passwordHash);
        if (rowsMissingPassword.length > 0) {
          const defaultHash = hashPassword('123456');
          await Promise.all(
            rowsMissingPassword.map((row) =>
              db
                .update(teamMembers)
                .set({ passwordHash: defaultHash })
                .where(eq(teamMembers.id, row.id))
            )
          );
        }
      }
      seedVerified = true;
    } catch (error) {
      console.error('Database query failed in ensureInitialDataSeeded:', error);
      throw new Error('Failed to initialize workspace data.', { cause: error });
    } finally {
      seedInFlight = null;
    }
  })();

  return seedInFlight;
}

export async function authenticateTeamMember(
  username: string,
  password: string
): Promise<{ user: User | null; error?: string }> {
  try {
    await ensureInitialDataSeeded();
    const cleanUsername = username.trim().toLowerCase();
    const rows = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.username, cleanUsername))
      .limit(1);

    if (rows.length === 0) {
      return { user: null, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
    }

    const row = rows[0];
    if (!verifyPassword(password, row.passwordHash)) {
      return { user: null, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
    }

    if (row.isSuspended) {
      return { user: null, error: 'هذا الحساب معطل حالياً من قبل الإدارة.' };
    }

    return { user: mapTeamMemberRow(row) };
  } catch (error) {
    console.error('Database query failed in authenticateTeamMember:', error);
    throw new Error('Authentication failed.', { cause: error });
  }
}

export async function getTeamMemberById(userId: string): Promise<User | null> {
  try {
    const rows = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, userId))
      .limit(1);
    if (rows.length === 0) return null;
    return mapTeamMemberRow(rows[0]);
  } catch (error) {
    console.error('Database query failed in getTeamMemberById:', error);
    throw new Error('Failed to fetch user profile.', { cause: error });
  }
}

export async function getAllWorkspaceData() {
  try {
    await ensureInitialDataSeeded();

    const [
      userRows,
      productRows,
      repRows,
      customerRows,
      orderRows,
      chatRows,
    ] = await Promise.all([
      db.select().from(teamMembers),
      db.select().from(products),
      db.select().from(salesReps),
      db.select().from(customers),
      db.select().from(orders).orderBy(desc(orders.createdAt)),
      db.select().from(chatMessages),
    ]);

    return {
      users: userRows.map(mapTeamMemberRow),
      products: productRows.map((p): Product => ({
        id: p.id,
        name: p.name,
        grade: p.grade as OilGrade,
        pricePerMg: p.pricePerMg,
        stock: p.stock,
      })),
      salesReps: repRows.map((r): SalesRep => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        totalCommission: r.totalCommission,
        pendingCommission: r.pendingCommission,
        ordersCount: r.ordersCount,
        maxDiscountAllowed: r.maxDiscountAllowed,
        customCommissionRate: r.customCommissionRate,
        monthlyHistory: r.monthlyHistory ?? [],
      })),
      customers: customerRows.map((c): Customer => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address ?? undefined,
        totalSpent: c.totalSpent,
        classification: c.classification as Customer['classification'],
        lastOrderDate: c.lastOrderDate,
      })),
      orders: orderRows.map((o): Order => ({
        id: o.id,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        customerAddress: o.customerAddress,
        customerNotes: o.customerNotes ?? undefined,
        salesRepId: o.salesRepId,
        salesRepName: o.salesRepName,
        items: o.items,
        subtotal: o.subtotal,
        discountPercentage: o.discountPercentage,
        discountAmount: o.discountAmount,
        shippingCost: o.shippingCost,
        totalAmount: o.totalAmount,
        status: o.status as OrderStatus,
        createdAt: o.createdAt,
        commission: o.commission,
        pendingEditRequest: o.pendingEditRequest ?? null,
      })),
      chatMessages: chatRows,
    };
  } catch (error) {
    console.error('Database query failed in getAllWorkspaceData:', error);
    throw new Error('Failed to load workspace data from database.', { cause: error });
  }
}

function sanitizeOrderItemsForStorage(items: OrderItem[]): OrderItem[] {
  return items.map((item) => ({
    productName: item.productName.trim(),
    grade: item.grade,
    quantity: Number(item.quantity),
    price: Number(item.price),
    ...(item.isCustom ? { isCustom: true } : {}),
  }));
}

function findMatchingProduct(
  productList: Array<typeof products.$inferSelect>,
  productName: string,
  grade: string
) {
  const cleanName = productName.trim().toLowerCase();
  return productList.find(
    (p) => p.name.trim().toLowerCase() === cleanName && p.grade === grade
  );
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  try {
    const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (rows.length === 0) return null;
    const o = rows[0];
    return {
      id: o.id,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      customerAddress: o.customerAddress,
      customerNotes: o.customerNotes ?? undefined,
      salesRepId: o.salesRepId,
      salesRepName: o.salesRepName,
      items: o.items,
      subtotal: o.subtotal,
      discountPercentage: o.discountPercentage,
      discountAmount: o.discountAmount,
      shippingCost: o.shippingCost,
      totalAmount: o.totalAmount,
      status: o.status as OrderStatus,
      createdAt: o.createdAt,
      commission: o.commission,
      pendingEditRequest: o.pendingEditRequest ?? null,
    };
  } catch (error) {
    console.error('Database query failed in getOrderById:', error);
    throw new Error('Failed to fetch order.', { cause: error });
  }
}

export async function createOrderRecord(orderData: Omit<Order, 'id' | 'createdAt'>): Promise<Order> {
  try {
    const cleanedItems = sanitizeOrderItemsForStorage(orderData.items);
    const newOrder: Order = {
      ...orderData,
      items: cleanedItems,
      id: `ORD-${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
    };

    await db.transaction(async (tx) => {
      const allProducts = await tx.select().from(products);
      const stockMap = new Map<string, number>();
      for (const p of allProducts) {
        stockMap.set(p.id, p.stock);
      }

      // Register any custom/new items requested to be added to warehouse
      for (let idx = 0; idx < orderData.items.length; idx++) {
        const rawItem = orderData.items[idx];
        const cleanName = rawItem.productName.trim();
        if (!cleanName) continue;

        let prod = findMatchingProduct(allProducts, cleanName, rawItem.grade);
        if (!prod && rawItem.addToInventory) {
          const newProdRow: typeof products.$inferInsert = {
            id: `p-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
            name: cleanName,
            grade: rawItem.grade,
            pricePerMg: Number(rawItem.price),
            stock: 0,
          };
          await tx.insert(products).values(newProdRow);
          allProducts.push(newProdRow);
          stockMap.set(newProdRow.id, 0);
          prod = newProdRow;
        }

        if (prod) {
          const currentStock = stockMap.get(prod.id) ?? prod.stock;
          stockMap.set(prod.id, Math.max(0, currentStock - Number(rawItem.quantity)));
        }
      }

      for (const p of allProducts) {
        const updatedStock = stockMap.get(p.id);
        if (updatedStock !== undefined && updatedStock !== p.stock) {
          await tx
            .update(products)
            .set({ stock: updatedStock })
            .where(eq(products.id, p.id));
        }
      }

      await tx.insert(orders).values({
        id: newOrder.id,
        customerName: newOrder.customerName,
        customerPhone: newOrder.customerPhone,
        customerAddress: newOrder.customerAddress,
        customerNotes: newOrder.customerNotes ?? null,
        salesRepId: newOrder.salesRepId,
        salesRepName: newOrder.salesRepName,
        items: newOrder.items,
        subtotal: newOrder.subtotal,
        discountPercentage: newOrder.discountPercentage,
        discountAmount: newOrder.discountAmount,
        shippingCost: newOrder.shippingCost,
        totalAmount: newOrder.totalAmount,
        status: newOrder.status,
        createdAt: newOrder.createdAt,
        commission: newOrder.commission,
      });

      const allCustomers = await tx.select().from(customers);
      const matchedCustomer = allCustomers.find(
        (c) =>
          c.name.trim() === newOrder.customerName.trim() ||
          (newOrder.customerPhone && c.phone === newOrder.customerPhone)
      );

      if (matchedCustomer) {
        const newTotalSpent = matchedCustomer.totalSpent + newOrder.totalAmount;
        await tx
          .update(customers)
          .set({
            totalSpent: newTotalSpent,
            classification: computeClassification(newTotalSpent),
            lastOrderDate: newOrder.createdAt,
          })
          .where(eq(customers.id, matchedCustomer.id));
      } else {
        await tx.insert(customers).values({
          id: `c-${Date.now()}`,
          name: newOrder.customerName,
          phone: newOrder.customerPhone,
          address: newOrder.customerAddress || null,
          totalSpent: newOrder.totalAmount,
          classification: computeClassification(newOrder.totalAmount),
          lastOrderDate: newOrder.createdAt,
        });
      }

      const matchedReps = await tx
        .select()
        .from(salesReps)
        .where(eq(salesReps.id, newOrder.salesRepId));
      if (matchedReps.length > 0) {
        const rep = matchedReps[0];
        if (newOrder.status === 'تم التسليم') {
          await tx
            .update(salesReps)
            .set({
              totalCommission: rep.totalCommission + newOrder.commission,
              ordersCount: rep.ordersCount + 1,
            })
            .where(eq(salesReps.id, rep.id));
        } else {
          await tx
            .update(salesReps)
            .set({
              pendingCommission: rep.pendingCommission + newOrder.commission,
              ordersCount: rep.ordersCount + 1,
            })
            .where(eq(salesReps.id, rep.id));
        }
      }
    });

    return newOrder;
  } catch (error) {
    console.error('Database query failed in createOrderRecord:', error);
    throw new Error('Failed to create order in database.', { cause: error });
  }
}

function isPendingCommissionStatus(status: OrderStatus): boolean {
  return status === 'قيد التنفيذ' || status === 'تم التجهيز' || status === 'تم الشحن';
}

export async function updateOrderRecord(
  orderId: string,
  orderData: Omit<Order, 'id' | 'createdAt'>,
  canEditAnytime: boolean,
  canEditPrepared = false
): Promise<Order> {
  try {
    const cleanedItems = sanitizeOrderItemsForStorage(orderData.items);

    const updatedOrder = await db.transaction(async (tx) => {
      const existingRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (existingRows.length === 0) {
        throw new Error('الفاتورة المطلوبة غير موجودة.');
      }

      const prevOrder = existingRows[0];
      const prevStatus = prevOrder.status as OrderStatus;

      if (!canEditAnytime) {
        if (prevStatus === 'تم الشحن' || prevStatus === 'تم التسليم' || prevStatus === 'مرتجع' || prevStatus === 'ملغي') {
          throw new Error('لا يمكن تعديل الفاتورة بعد شحن الطلب أو تسليمه. المدير العام فقط يمكنه التعديل.');
        }
        if (prevStatus === 'تم التجهيز' && !canEditPrepared) {
          throw new Error('الطلب تم تجهيزه بالفعل؛ يرجى إرسال طلب تعديل لمسؤول حالة الطلبات.');
        }
      }

      const targetStatus: OrderStatus = canEditAnytime && orderData.status ? orderData.status : prevStatus;

      // 1. Restore previous items' stock, register any new inventory products, then deduct updated items' stock
      const allProducts = await tx.select().from(products);
      const stockMap = new Map<string, number>();
      for (const p of allProducts) {
        stockMap.set(p.id, p.stock);
      }

      for (const oldItem of prevOrder.items) {
        const prod = findMatchingProduct(allProducts, oldItem.productName, oldItem.grade);
        if (prod) {
          const cur = stockMap.get(prod.id) ?? prod.stock;
          stockMap.set(prod.id, cur + Number(oldItem.quantity));
        }
      }

      for (let idx = 0; idx < orderData.items.length; idx++) {
        const rawItem = orderData.items[idx];
        const cleanName = rawItem.productName.trim();
        if (!cleanName) continue;

        let prod = findMatchingProduct(allProducts, cleanName, rawItem.grade);
        if (!prod && rawItem.addToInventory) {
          const newProdRow: typeof products.$inferInsert = {
            id: `p-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
            name: cleanName,
            grade: rawItem.grade,
            pricePerMg: Number(rawItem.price),
            stock: 0,
          };
          await tx.insert(products).values(newProdRow);
          allProducts.push(newProdRow);
          stockMap.set(newProdRow.id, 0);
          prod = newProdRow;
        }

        if (prod) {
          const cur = stockMap.get(prod.id) ?? prod.stock;
          stockMap.set(prod.id, Math.max(0, cur - Number(rawItem.quantity)));
        }
      }

      for (const p of allProducts) {
        const nextStock = stockMap.get(p.id);
        if (nextStock !== undefined && nextStock !== p.stock) {
          await tx
            .update(products)
            .set({ stock: nextStock })
            .where(eq(products.id, p.id));
        }
      }

      // 2. Reconcile sales rep commissions & counts
      const allReps = await tx.select().from(salesReps);
      const repMap = new Map(allReps.map((r) => [r.id, { ...r }]));

      const prevRep = repMap.get(prevOrder.salesRepId);
      if (prevRep) {
        if (prevStatus === 'تم التسليم') {
          prevRep.totalCommission = Math.max(0, prevRep.totalCommission - prevOrder.commission);
        } else if (isPendingCommissionStatus(prevStatus)) {
          prevRep.pendingCommission = Math.max(0, prevRep.pendingCommission - prevOrder.commission);
        }
        if (orderData.salesRepId !== prevOrder.salesRepId) {
          prevRep.ordersCount = Math.max(0, prevRep.ordersCount - 1);
        }
      }

      const nextRep = repMap.get(orderData.salesRepId);
      if (nextRep) {
        if (targetStatus === 'تم التسليم') {
          nextRep.totalCommission += orderData.commission;
        } else if (isPendingCommissionStatus(targetStatus)) {
          nextRep.pendingCommission += orderData.commission;
        }
        if (orderData.salesRepId !== prevOrder.salesRepId) {
          nextRep.ordersCount += 1;
        }
      }

      if (prevRep) {
        await tx
          .update(salesReps)
          .set({
            totalCommission: prevRep.totalCommission,
            pendingCommission: prevRep.pendingCommission,
            ordersCount: prevRep.ordersCount,
          })
          .where(eq(salesReps.id, prevRep.id));
      }
      if (nextRep && nextRep.id !== prevRep?.id) {
        await tx
          .update(salesReps)
          .set({
            totalCommission: nextRep.totalCommission,
            pendingCommission: nextRep.pendingCommission,
            ordersCount: nextRep.ordersCount,
          })
          .where(eq(salesReps.id, nextRep.id));
      }

      // 3. Persist updated order
      await tx
        .update(orders)
        .set({
          customerName: orderData.customerName,
          customerPhone: orderData.customerPhone,
          customerAddress: orderData.customerAddress,
          customerNotes: orderData.customerNotes ?? null,
          salesRepId: orderData.salesRepId,
          salesRepName: orderData.salesRepName,
          items: cleanedItems,
          subtotal: orderData.subtotal,
          discountPercentage: orderData.discountPercentage,
          discountAmount: orderData.discountAmount,
          shippingCost: orderData.shippingCost,
          totalAmount: orderData.totalAmount,
          status: targetStatus,
          commission: orderData.commission,
          pendingEditRequest: null,
        })
        .where(eq(orders.id, orderId));

      // 4. Recompute affected customer totals
      const allOrders = await tx.select().from(orders).orderBy(desc(orders.createdAt));
      const allCustomers = await tx.select().from(customers);

      const prevCustomer = allCustomers.find(
        (c) =>
          c.name.trim() === prevOrder.customerName.trim() ||
          (prevOrder.customerPhone && c.phone === prevOrder.customerPhone)
      );
      const nextCustomer = allCustomers.find(
        (c) =>
          c.name.trim() === orderData.customerName.trim() ||
          (orderData.customerPhone && c.phone === orderData.customerPhone)
      );

      if (prevCustomer) {
        const custOrders = allOrders.filter(
          (o) =>
            o.customerName.trim() === prevCustomer.name.trim() ||
            (prevCustomer.phone && o.customerPhone === prevCustomer.phone)
        );
        const totalSpent = custOrders.reduce((sum, o) => sum + o.totalAmount, 0);
        await tx
          .update(customers)
          .set({
            totalSpent,
            classification: computeClassification(totalSpent),
            lastOrderDate: custOrders.length > 0 ? custOrders[0].createdAt : '',
          })
          .where(eq(customers.id, prevCustomer.id));
      }

      if (nextCustomer && nextCustomer.id !== prevCustomer?.id) {
        const custOrders = allOrders.filter(
          (o) =>
            o.customerName.trim() === nextCustomer.name.trim() ||
            (nextCustomer.phone && o.customerPhone === nextCustomer.phone)
        );
        const totalSpent = custOrders.reduce((sum, o) => sum + o.totalAmount, 0);
        await tx
          .update(customers)
          .set({
            totalSpent,
            classification: computeClassification(totalSpent),
            lastOrderDate: custOrders.length > 0 ? custOrders[0].createdAt : '',
          })
          .where(eq(customers.id, nextCustomer.id));
      } else if (!nextCustomer) {
        await tx.insert(customers).values({
          id: `c-${Date.now()}`,
          name: orderData.customerName,
          phone: orderData.customerPhone,
          address: orderData.customerAddress || null,
          totalSpent: orderData.totalAmount,
          classification: computeClassification(orderData.totalAmount),
          lastOrderDate: prevOrder.createdAt,
        });
      }

      return {
        id: prevOrder.id,
        customerName: orderData.customerName,
        customerPhone: orderData.customerPhone,
        customerAddress: orderData.customerAddress,
        customerNotes: orderData.customerNotes,
        salesRepId: orderData.salesRepId,
        salesRepName: orderData.salesRepName,
        items: cleanedItems,
        subtotal: orderData.subtotal,
        discountPercentage: orderData.discountPercentage,
        discountAmount: orderData.discountAmount,
        shippingCost: orderData.shippingCost,
        totalAmount: orderData.totalAmount,
        status: targetStatus,
        createdAt: prevOrder.createdAt,
        commission: orderData.commission,
        pendingEditRequest: null,
      };
    });

    return updatedOrder;
  } catch (error) {
    console.error('Database query failed in updateOrderRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('لا يمكن تعديل') ||
        error.message.includes('غير موجودة') ||
        error.message.includes('تم تجهيزه'))
    ) {
      throw error;
    }
    throw new Error('Failed to update order in database.', { cause: error });
  }
}

export async function submitOrderEditRequestRecord(
  orderId: string,
  editRequest: OrderEditRequest
): Promise<Order> {
  try {
    const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (rows.length === 0) {
      throw new Error('الفاتورة المطلوبة غير موجودة.');
    }

    const prevOrder = rows[0];
    if (prevOrder.status !== 'تم التجهيز') {
      throw new Error('طلبات التعديل متاحة فقط للطلبات في حالة "تم التجهيز".');
    }

    await db
      .update(orders)
      .set({ pendingEditRequest: editRequest })
      .where(eq(orders.id, orderId));

    return {
      id: prevOrder.id,
      customerName: prevOrder.customerName,
      customerPhone: prevOrder.customerPhone,
      customerAddress: prevOrder.customerAddress,
      customerNotes: prevOrder.customerNotes ?? undefined,
      salesRepId: prevOrder.salesRepId,
      salesRepName: prevOrder.salesRepName,
      items: prevOrder.items,
      subtotal: prevOrder.subtotal,
      discountPercentage: prevOrder.discountPercentage,
      discountAmount: prevOrder.discountAmount,
      shippingCost: prevOrder.shippingCost,
      totalAmount: prevOrder.totalAmount,
      status: prevOrder.status as OrderStatus,
      createdAt: prevOrder.createdAt,
      commission: prevOrder.commission,
      pendingEditRequest: editRequest,
    };
  } catch (error) {
    console.error('Database query failed in submitOrderEditRequestRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') || error.message.includes('طلبات التعديل'))
    ) {
      throw error;
    }
    throw new Error('Failed to submit order edit request.', { cause: error });
  }
}

export async function resolveOrderEditRequestRecord(
  orderId: string,
  action: 'approve' | 'reject',
  overrideData?: Omit<Order, 'id' | 'createdAt'>
): Promise<Order> {
  try {
    const existing = await getOrderById(orderId);
    if (!existing) {
      throw new Error('الفاتورة المطلوبة غير موجودة.');
    }

    if (action === 'reject') {
      await db
        .update(orders)
        .set({ pendingEditRequest: null })
        .where(eq(orders.id, orderId));
      return { ...existing, pendingEditRequest: null };
    }

    const reqData = overrideData || existing.pendingEditRequest;
    if (!reqData) {
      throw new Error('لا يوجد طلب تعديل معلق على هذه الفاتورة.');
    }

    return await updateOrderRecord(
      orderId,
      {
        customerName: reqData.customerName,
        customerPhone: reqData.customerPhone,
        customerAddress: reqData.customerAddress,
        customerNotes: reqData.customerNotes,
        salesRepId: reqData.salesRepId,
        salesRepName: reqData.salesRepName,
        items: reqData.items,
        subtotal: reqData.subtotal,
        discountPercentage: reqData.discountPercentage,
        discountAmount: reqData.discountAmount,
        shippingCost: reqData.shippingCost,
        totalAmount: reqData.totalAmount,
        status: existing.status,
        commission: reqData.commission,
      },
      true,
      true
    );
  } catch (error) {
    console.error('Database query failed in resolveOrderEditRequestRecord:', error);
    if (
      error instanceof Error &&
      (error.message.includes('غير موجودة') ||
        error.message.includes('لا يوجد طلب') ||
        error.message.includes('لا يمكن تعديل'))
    ) {
      throw error;
    }
    throw new Error('Failed to resolve order edit request.', { cause: error });
  }
}

export async function updateOrderStatusRecord(orderId: string, newStatus: OrderStatus) {
  try {
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (existing.length === 0) return;

      const prevOrder = existing[0];
      const prevStatus = prevOrder.status as OrderStatus;

      const shouldClearEditRequest =
        newStatus === 'تم الشحن' ||
        newStatus === 'تم التسليم' ||
        newStatus === 'مرتجع' ||
        newStatus === 'ملغي';

      await tx
        .update(orders)
        .set({
          status: newStatus,
          ...(shouldClearEditRequest ? { pendingEditRequest: null } : {}),
        })
        .where(eq(orders.id, orderId));

      const matchedReps = await tx
        .select()
        .from(salesReps)
        .where(eq(salesReps.id, prevOrder.salesRepId));

      if (matchedReps.length > 0) {
        const rep = matchedReps[0];
        let totalComm = rep.totalCommission;
        let pendingComm = rep.pendingCommission;

        if (isPendingCommissionStatus(prevStatus) && newStatus === 'تم التسليم') {
          pendingComm = Math.max(0, pendingComm - prevOrder.commission);
          totalComm += prevOrder.commission;
        } else if (prevStatus === 'تم التسليم' && (newStatus === 'مرتجع' || newStatus === 'ملغي')) {
          totalComm = Math.max(0, totalComm - prevOrder.commission);
        } else if (isPendingCommissionStatus(prevStatus) && (newStatus === 'مرتجع' || newStatus === 'ملغي')) {
          pendingComm = Math.max(0, pendingComm - prevOrder.commission);
        } else if (prevStatus === 'تم التسليم' && isPendingCommissionStatus(newStatus)) {
          totalComm = Math.max(0, totalComm - prevOrder.commission);
          pendingComm += prevOrder.commission;
        }

        await tx
          .update(salesReps)
          .set({ totalCommission: totalComm, pendingCommission: pendingComm })
          .where(eq(salesReps.id, rep.id));
      }
    });
  } catch (error) {
    console.error('Database query failed in updateOrderStatusRecord:', error);
    throw new Error('Failed to update order status.', { cause: error });
  }
}

export async function deleteOrderRecord(orderId: string) {
  try {
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (existing.length === 0) return;
      const orderToDelete = existing[0];

      const allProducts = await tx.select().from(products);
      for (const item of orderToDelete.items) {
        const prod = allProducts.find(
          (p) => p.name === item.productName && p.grade === item.grade
        );
        if (prod) {
          await tx
            .update(products)
            .set({ stock: prod.stock + item.quantity })
            .where(eq(products.id, prod.id));
        }
      }

      const matchedReps = await tx
        .select()
        .from(salesReps)
        .where(eq(salesReps.id, orderToDelete.salesRepId));
      if (matchedReps.length > 0) {
        const rep = matchedReps[0];
        let totalComm = rep.totalCommission;
        let pendingComm = rep.pendingCommission;

        if (orderToDelete.status === 'تم التسليم') {
          totalComm = Math.max(0, totalComm - orderToDelete.commission);
        } else if (isPendingCommissionStatus(orderToDelete.status as OrderStatus)) {
          pendingComm = Math.max(0, pendingComm - orderToDelete.commission);
        }

        await tx
          .update(salesReps)
          .set({
            totalCommission: totalComm,
            pendingCommission: pendingComm,
            ordersCount: Math.max(0, rep.ordersCount - 1),
          })
          .where(eq(salesReps.id, rep.id));
      }

      await tx.delete(orders).where(eq(orders.id, orderId));

      const allCustomers = await tx.select().from(customers);
      const matchedCustomer = allCustomers.find(
        (c) =>
          c.name.trim() === orderToDelete.customerName.trim() ||
          (orderToDelete.customerPhone && c.phone === orderToDelete.customerPhone)
      );

      if (matchedCustomer) {
        const remainingOrders = await tx
          .select()
          .from(orders)
          .orderBy(desc(orders.createdAt));
        const custRemaining = remainingOrders.filter(
          (o) =>
            o.customerName.trim() === matchedCustomer.name.trim() ||
            (matchedCustomer.phone && o.customerPhone === matchedCustomer.phone)
        );
        const newTotalSpent = custRemaining.reduce((sum, o) => sum + o.totalAmount, 0);
        await tx
          .update(customers)
          .set({
            totalSpent: newTotalSpent,
            classification: computeClassification(newTotalSpent),
            lastOrderDate: custRemaining.length > 0 ? custRemaining[0].createdAt : '',
          })
          .where(eq(customers.id, matchedCustomer.id));
      }
    });
  } catch (error) {
    console.error('Database query failed in deleteOrderRecord:', error);
    throw new Error('Failed to delete order.', { cause: error });
  }
}

export async function createCustomerRecord(customerData: {
  name: string;
  phone: string;
  address?: string;
}): Promise<Customer> {
  try {
    const newCust: Customer = {
      id: `c-${Date.now()}`,
      name: customerData.name,
      phone: customerData.phone,
      address: customerData.address,
      totalSpent: 0,
      classification: 'عادي',
      lastOrderDate: '',
    };

    await db.insert(customers).values({
      id: newCust.id,
      name: newCust.name,
      phone: newCust.phone,
      address: newCust.address ?? null,
      totalSpent: 0,
      classification: 'عادي',
      lastOrderDate: '',
    });

    return newCust;
  } catch (error) {
    console.error('Database query failed in createCustomerRecord:', error);
    throw new Error('Failed to create customer.', { cause: error });
  }
}

export async function deleteCustomerRecord(customerId: string) {
  try {
    await db.delete(customers).where(eq(customers.id, customerId));
  } catch (error) {
    console.error('Database query failed in deleteCustomerRecord:', error);
    throw new Error('Failed to delete customer.', { cause: error });
  }
}

export async function createProductRecord(productData: Omit<Product, 'id'>): Promise<Product> {
  try {
    const newProduct: Product = {
      ...productData,
      id: `p-${Date.now()}`,
    };
    await db.insert(products).values(newProduct);
    return newProduct;
  } catch (error) {
    console.error('Database query failed in createProductRecord:', error);
    throw new Error('Failed to create product.', { cause: error });
  }
}

export async function updateProductRecord(updatedProduct: Product) {
  try {
    await db
      .update(products)
      .set({
        name: updatedProduct.name,
        grade: updatedProduct.grade,
        pricePerMg: updatedProduct.pricePerMg,
        stock: updatedProduct.stock,
      })
      .where(eq(products.id, updatedProduct.id));
  } catch (error) {
    console.error('Database query failed in updateProductRecord:', error);
    throw new Error('Failed to update product.', { cause: error });
  }
}

export async function createTeamMemberRecord(
  userData: Omit<User, 'id'> & { password?: string },
  initialRepData?: Partial<SalesRep>
) {
  try {
    const userId = `u-${Date.now()}`;
    const repId = `s-${Date.now()}`;
    const rawPassword = userData.password?.trim() || '123456';
    const passwordHash = hashPassword(rawPassword);

    await db.transaction(async (tx) => {
      await tx.insert(teamMembers).values({
        id: userId,
        name: userData.name,
        nickname: userData.nickname ?? null,
        avatar: userData.avatar ?? null,
        username: userData.username.toLowerCase().trim(),
        passwordHash,
        role: userData.role,
        salesRepId: userData.role === 'sales' ? repId : null,
        isSuspended: userData.isSuspended,
        isMuted: userData.isMuted,
        canEditInventory: userData.canEditInventory,
        canConfirmDelivery: userData.canConfirmDelivery,
        canManageOrderStatus: userData.canManageOrderStatus ?? false,
        canDeleteOrders: userData.canDeleteOrders ?? false,
        canDeleteCustomers: userData.canDeleteCustomers ?? false,
        address: userData.address ?? null,
        startDate: userData.startDate ?? null,
        online: userData.online ?? true,
      });

      if (userData.role === 'sales' && initialRepData) {
        await tx.insert(salesReps).values({
          id: repId,
          userId,
          name: userData.name,
          totalCommission: initialRepData.totalCommission || 0,
          pendingCommission: initialRepData.pendingCommission || 0,
          ordersCount: initialRepData.ordersCount || 0,
          maxDiscountAllowed: initialRepData.maxDiscountAllowed || 10,
          customCommissionRate: initialRepData.customCommissionRate || 0.05,
          monthlyHistory: [],
        });
      }
    });
  } catch (error) {
    console.error('Database query failed in createTeamMemberRecord:', error);
    throw new Error('Failed to create team member.', { cause: error });
  }
}

export async function updateTeamMemberRecord(
  updatedUser: User & { newPassword?: string }
) {
  try {
    const updateFields: Partial<typeof teamMembers.$inferInsert> = {
      name: updatedUser.name,
      nickname: updatedUser.nickname ?? null,
      avatar: updatedUser.avatar ?? null,
      username: updatedUser.username.toLowerCase().trim(),
      role: updatedUser.role,
      salesRepId: updatedUser.salesRepId ?? null,
      isSuspended: updatedUser.isSuspended,
      isMuted: updatedUser.isMuted,
      canEditInventory: updatedUser.canEditInventory,
      canConfirmDelivery: updatedUser.canConfirmDelivery,
      canManageOrderStatus: updatedUser.canManageOrderStatus ?? false,
      canDeleteOrders: updatedUser.canDeleteOrders ?? false,
      canDeleteCustomers: updatedUser.canDeleteCustomers ?? false,
      address: updatedUser.address ?? null,
      startDate: updatedUser.startDate ?? null,
      online: updatedUser.online ?? false,
    };

    if (updatedUser.newPassword && updatedUser.newPassword.trim().length > 0) {
      updateFields.passwordHash = hashPassword(updatedUser.newPassword.trim());
    }

    await db
      .update(teamMembers)
      .set(updateFields)
      .where(eq(teamMembers.id, updatedUser.id));
  } catch (error) {
    console.error('Database query failed in updateTeamMemberRecord:', error);
    throw new Error('Failed to update team member.', { cause: error });
  }
}

export async function updateSalesRepRecord(updatedRep: SalesRep) {
  try {
    await db
      .update(salesReps)
      .set({
        name: updatedRep.name,
        totalCommission: updatedRep.totalCommission,
        pendingCommission: updatedRep.pendingCommission,
        ordersCount: updatedRep.ordersCount,
        maxDiscountAllowed: updatedRep.maxDiscountAllowed,
        customCommissionRate: updatedRep.customCommissionRate,
        monthlyHistory: updatedRep.monthlyHistory,
      })
      .where(eq(salesReps.id, updatedRep.id));
  } catch (error) {
    console.error('Database query failed in updateSalesRepRecord:', error);
    throw new Error('Failed to update sales rep.', { cause: error });
  }
}

export async function createChatMessageRecord(msg: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
  try {
    const newMsg: ChatMessage = {
      ...msg,
      id: `msg-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    await db.insert(chatMessages).values(newMsg);
    return newMsg;
  } catch (error) {
    console.error('Database query failed in createChatMessageRecord:', error);
    throw new Error('Failed to send chat message.', { cause: error });
  }
}
