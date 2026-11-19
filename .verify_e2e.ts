import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from './src/db/index.ts';
import {
  auditLogs,
  commissionSettingLogs,
  customers,
  orders,
  priceListImports,
  productCategories,
  products,
  salesReps,
  stockMovements,
  systemSettings,
  teamMembers,
} from './src/db/schema.ts';
import { hashPassword } from './src/lib/auth.ts';

const BASE = 'http://localhost:3000';

async function apiCall(
  path: string,
  options: RequestInit & { token?: string; stepUpToken?: string } = {}
) {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.stepUpToken) headers['X-Owner-Step-Up'] = options.stepUpToken;
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  const runId = Date.now();
  const createdUserIds: string[] = [];
  const createdRepIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdImportIds: string[] = [];
  const testStartIso = new Date().toISOString();

  // Snapshot original commission_config and categories
  const origSettingsRows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'commission_config'));
  const origCommConfig = origSettingsRows[0]?.value ?? null;
  const origCats = await db.select().from(productCategories);

  try {
    console.log('1) Creating ephemeral test Owner, Admin, and Sales accounts...');
    const testPwd = 'VerifyPass!2026';
    const pwdHash = hashPassword(testPwd);
    const ownerId = `u_v_own_${runId}`;
    const adminId = `u_v_adm_${runId}`;
    const salesUserId = `u_v_sls_${runId}`;
    const salesRepId = `s_v_sls_${runId}`;

    createdUserIds.push(ownerId, adminId, salesUserId);
    createdRepIds.push(salesRepId);

    await db.insert(teamMembers).values([
      {
        id: ownerId,
        name: 'Verify Owner',
        username: `v_own_${runId}`,
        passwordHash: pwdHash,
        role: 'owner',
        salesRepId: null,
        isSuspended: false,
        isMuted: false,
        canEditInventory: true,
        canConfirmDelivery: true,
        canManageOrderStatus: true,
        canDeleteOrders: true,
        canDeleteCustomers: true,
        online: false,
      },
      {
        id: adminId,
        name: 'Verify Admin',
        username: `v_adm_${runId}`,
        passwordHash: pwdHash,
        role: 'admin',
        salesRepId: null,
        isSuspended: false,
        isMuted: false,
        canEditInventory: true,
        canConfirmDelivery: true,
        canManageOrderStatus: true,
        canDeleteOrders: true,
        canDeleteCustomers: true,
        online: false,
      },
      {
        id: salesUserId,
        name: 'Verify Sales',
        username: `v_sls_${runId}`,
        passwordHash: pwdHash,
        role: 'sales',
        salesRepId,
        isSuspended: false,
        isMuted: false,
        canEditInventory: false,
        canConfirmDelivery: false,
        canManageOrderStatus: false,
        canDeleteOrders: false,
        canDeleteCustomers: false,
        online: false,
      },
    ]);

    await db.insert(salesReps).values({
      id: salesRepId,
      userId: salesUserId,
      name: 'Verify Sales',
      totalCommission: 0,
      pendingCommission: 0,
      ordersCount: 0,
      maxDiscountAllowed: 25,
      customCommissionRate: 0.05,
      monthlyHistory: [],
    });

    const loginOwner = await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: `v_own_${runId}`, password: testPwd }),
    });
    assert.equal(loginOwner.status, 200, 'Owner login failed');
    const ownerToken = loginOwner.data.token as string;

    const loginAdmin = await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: `v_adm_${runId}`, password: testPwd }),
    });
    assert.equal(loginAdmin.status, 200, 'Admin login failed');
    const adminToken = loginAdmin.data.token as string;

    const loginSales = await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: `v_sls_${runId}`, password: testPwd }),
    });
    assert.equal(loginSales.status, 200, 'Sales login failed');
    const salesToken = loginSales.data.token as string;

    const stepUpRes = await apiCall('/api/owner/verify-identity', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({ password: testPwd }),
    });
    assert.equal(stepUpRes.status, 200, 'Owner step-up verify failed');
    const stepUpToken = stepUpRes.data.stepUpToken as string;
    console.log('   OK: Logins & Owner Step-Up passed.');

    console.log('2) Testing RBAC enforcement (Admin & Sales must get 403)...');
    for (const [label, tok] of [
      ['Admin', adminToken],
      ['Sales', salesToken],
    ] as const) {
      const r1 = await apiCall('/api/owner/commission-settings', {
        method: 'PUT',
        token: tok,
        body: JSON.stringify({ defaultOilCommissionRate: 0.2 }),
      });
      assert.equal(r1.status, 403, `${label} should get 403 on /api/owner/commission-settings`);

      const r2 = await apiCall(`/api/owner/rep-commissions/${salesRepId}`, {
        method: 'PUT',
        token: tok,
        body: JSON.stringify({ customCommissionRate: 0.2 }),
      });
      assert.equal(r2.status, 403, `${label} should get 403 on /api/owner/rep-commissions`);

      const r3 = await apiCall('/api/price-lists/import', {
        method: 'POST',
        token: tok,
      });
      assert.equal(r3.status, 403, `${label} should get 403 on /api/price-lists/import`);
    }

    // Also Admin trying to change rep commission rate via PUT /api/sales-reps/:id
    const rRepEdit = await apiCall(`/api/sales-reps/${salesRepId}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({
        id: salesRepId,
        userId: salesUserId,
        name: 'Verify Sales',
        totalCommission: 0,
        pendingCommission: 0,
        ordersCount: 0,
        maxDiscountAllowed: 25,
        customCommissionRate: 0.15,
        monthlyHistory: [],
      }),
    });
    assert.equal(rRepEdit.status, 403, 'Admin changing customCommissionRate on sales-reps must get 403');
    console.log('   OK: Strict RBAC 403 checks passed.');

    console.log('3) Owner configures flexible per-category % rates (Oils 5%, Packaging 2%, Alcohol 0%)...');
    const commUpdate = await apiCall('/api/owner/commission-settings', {
      method: 'PUT',
      token: ownerToken,
      stepUpToken,
      body: JSON.stringify({
        defaultOilCommissionRate: 0.05,
        categoryRates: {
          'cat-oils': 0.05,
          'cat-packaging': 0.02,
          'cat-alcohol': 0,
          'cat-chemicals': 0.03,
          'cat-other': 0,
        },
        repCategoryOverrides: {},
        includeShippingInCommission: false,
        useSalesRepCustomRateWhenInherited: false,
        reason: 'E2E Verify Category Rates',
      }),
    });
    assert.equal(commUpdate.status, 200, 'Owner updateCommissionSettings failed');
    assert.equal(commUpdate.data.categoryRates['cat-packaging'], 0.02);
    assert.equal(commUpdate.data.categoryRates['cat-alcohol'], 0);
    console.log('   OK: Category rates saved.');

    console.log('4) Testing mixed-category invoice math & 10% proportional discount...');
    const order1Res = await apiCall('/api/orders', {
      method: 'POST',
      token: salesToken,
      body: JSON.stringify({
        customerName: `__VerifyCust_${runId}`,
        customerPhone: '01099998888',
        customerAddress: 'Verify Street',
        salesRepId,
        salesRepName: 'Verify Sales',
        discountPercentage: 10,
        shippingCost: 50,
        items: [
          {
            productName: `__VerifyOil_${runId}`,
            categoryId: 'cat-oils',
            categoryName: 'الزيوت العطرية',
            unit: 'mg',
            grade: 'عالي (Code A)',
            quantity: 1000,
            price: 1,
            isCustom: true,
            addToInventory: false,
            sourcingSource: 'توفير خارجي دون إدخاله إلى المخزن',
          },
          {
            productName: `__VerifyBottle_${runId}`,
            categoryId: 'cat-packaging',
            categoryName: 'الفوارغ والعبوات',
            unit: 'قطعة',
            grade: 'قياسي',
            quantity: 10,
            price: 50,
            isCustom: true,
            addToInventory: false,
            sourcingSource: 'توفير خارجي دون إدخاله إلى المخزن',
          },
          {
            productName: `__VerifyAlcohol_${runId}`,
            categoryId: 'cat-alcohol',
            categoryName: 'الكحول',
            unit: 'لتر',
            grade: 'قياسي',
            quantity: 5,
            price: 100,
            isCustom: true,
            addToInventory: false,
            sourcingSource: 'توفير خارجي دون إدخاله إلى المخزن',
          },
        ],
      }),
    });
    assert.equal(order1Res.status, 200, `Create order1 failed: ${JSON.stringify(order1Res.data)}`);
    const ord1 = order1Res.data;
    createdOrderIds.push(ord1.id);
    // Clean up customer later
    const custRows = await db
      .select()
      .from(customers)
      .where(eq(customers.name, `__VerifyCust_${runId}`));
    custRows.forEach((c) => createdCustomerIds.push(c.id));

    assert.equal(ord1.subtotal, 2000);
    assert.equal(ord1.discountAmount, 200);
    assert.equal(ord1.totalAmount, 1850);
    assert.equal(ord1.commissionableSubtotal, 1500);
    assert.equal(ord1.commission, 54, `Expected 54, got ${ord1.commission}`);
    assert.equal(ord1.items[0].commissionAmount, 45);
    assert.equal(ord1.items[1].commissionAmount, 9);
    assert.equal(ord1.items[2].isCommissionEligible, false);
    assert.equal(ord1.items[2].commissionAmount, 0);
    console.log('   OK: Mixed-category invoice commission = 54 (45 + 9 + 0) verified!');

    console.log('5) Testing per-rep per-category override (Packaging 4% for this rep)...');
    const repOverRes = await apiCall(`/api/owner/rep-commissions/${salesRepId}`, {
      method: 'PUT',
      token: ownerToken,
      stepUpToken,
      body: JSON.stringify({
        customCommissionRate: 0.05,
        categoryCommissionRates: {
          'cat-packaging': 0.04,
        },
        reason: 'E2E Rep Category Override',
      }),
    });
    assert.equal(repOverRes.status, 200, `Rep override failed: ${JSON.stringify(repOverRes.data)}`);

    const order2Res = await apiCall('/api/orders', {
      method: 'POST',
      token: salesToken,
      body: JSON.stringify({
        customerName: `__VerifyCust_${runId}`,
        customerPhone: '01099998888',
        customerAddress: 'Verify Street',
        salesRepId,
        salesRepName: 'Verify Sales',
        discountPercentage: 10,
        shippingCost: 50,
        items: [
          {
            productName: `__VerifyOil_${runId}`,
            categoryId: 'cat-oils',
            categoryName: 'الزيوت العطرية',
            unit: 'mg',
            grade: 'عالي (Code A)',
            quantity: 1000,
            price: 1,
            isCustom: true,
            addToInventory: false,
            sourcingSource: 'توفير خارجي دون إدخاله إلى المخزن',
          },
          {
            productName: `__VerifyBottle_${runId}`,
            categoryId: 'cat-packaging',
            categoryName: 'الفوارغ والعبوات',
            unit: 'قطعة',
            grade: 'قياسي',
            quantity: 10,
            price: 50,
            isCustom: true,
            addToInventory: false,
            sourcingSource: 'توفير خارجي دون إدخاله إلى المخزن',
          },
        ],
      }),
    });
    assert.equal(order2Res.status, 200, 'Create order2 failed');
    const ord2 = order2Res.data;
    createdOrderIds.push(ord2.id);
    assert.equal(ord2.commission, 63, `Expected 63 (45 + 18), got ${ord2.commission}`);
    console.log('   OK: Rep-category override = 63 (45 + 18) verified!');

    console.log('6) Testing Historical Immutability after global rule change...');
    await apiCall('/api/owner/commission-settings', {
      method: 'PUT',
      token: ownerToken,
      stepUpToken,
      body: JSON.stringify({
        defaultOilCommissionRate: 0.12,
        categoryRates: {
          'cat-oils': 0.12,
          'cat-packaging': 0.1,
          'cat-alcohol': 0.08,
          'cat-chemicals': 0.08,
          'cat-other': 0.05,
        },
        reason: 'E2E Immutability check',
      }),
    });
    const fetchOrd1 = await apiCall(`/api/workspace`, { token: ownerToken });
    assert.equal(fetchOrd1.status, 200);
    const persistedOrd1 = (fetchOrd1.data.orders as any[]).find((o) => o.id === ord1.id);
    assert.equal(persistedOrd1.commission, 54, 'Historical invoice commission must NOT change when global rates change!');
    console.log('   OK: Historical invoice remained unchanged at 54.');

    console.log('7) Testing REAL PDF Imports (قائمة أسعار عطور المدينة + MMA FRAGRANCE + Manual Remap + Non-Stock Approval)...');
    const realImports = await db
      .select({
        id: priceListImports.id,
        fileName: priceListImports.fileName,
        fileDataBase64: priceListImports.fileDataBase64,
      })
      .from(priceListImports);

    const madinaRow = realImports.find((r) => r.id === 'pli-1795036554560-264');
    const mmaRow = realImports.find((r) => r.id === 'pli-1795036947297-2127');
    assert.ok(madinaRow?.fileDataBase64, 'Missing stored Madina PDF binary in DB');
    assert.ok(mmaRow?.fileDataBase64, 'Missing stored MMA PDF binary in DB');

    // 7A. Upload Madina PDF with latin1 mojibake filename as Multer produces to test decodeUploadedFilename
    const madinaBuf = Buffer.from(madinaRow!.fileDataBase64, 'base64');
    const mojibakeMadinaName = Buffer.from('قائمة_أسعار_عطور_المدينة_.pdf', 'utf8').toString('latin1');
    const fdMadina = new FormData();
    fdMadina.append('file', new Blob([madinaBuf], { type: 'application/pdf' }), mojibakeMadinaName);
    const upMadinaRes = await fetch(`${BASE}/api/price-lists/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: fdMadina,
    });
    const upMadinaData = await upMadinaRes.json();
    assert.equal(upMadinaRes.status, 200, `Madina PDF upload failed: ${JSON.stringify(upMadinaData)}`);
    createdImportIds.push(upMadinaData.id);
    assert.equal(upMadinaData.fileName, 'قائمة_أسعار_عطور_المدينة_.pdf', `Expected decoded Arabic filename, got ${upMadinaData.fileName}`);
    const am168g = upMadinaData.parsedItems.find((i: any) => i.code === 'AM-168-G');
    const am168s = upMadinaData.parsedItems.find((i: any) => i.code === 'AM-168-S');
    assert.ok(am168g, 'Expected split RTL code AM-168-G to be reconstructed');
    assert.ok(am168s, 'Expected split RTL code AM-168-S to be reconstructed');
    assert.equal(am168g.sellingPrice, 3000, `Expected AM-168-G sellingPrice=3000, got ${am168g.sellingPrice}`);
    assert.equal(am168s.sellingPrice, 2200, `Expected AM-168-S sellingPrice=2200, got ${am168s.sellingPrice}`);
    assert.ok(am168g.name.includes('ياسمين مغربي'), `Expected normalized Arabic name 'ياسمين مغربي', got '${am168g.name}'`);
    assert.equal(am168g.singlePriceMeaning, 'selling', 'Banner "قائمة أسعار العملاء" should auto-resolve singlePriceMeaning as selling');
    console.log(`   OK: Madina PDF decoded filename + reconstructed AM-168-G/S (${upMadinaData.parsedItems.length} items)!`);

    // 7B. Upload MMA PDF & test N ignored + Manual Remapping
    const mmaBuf = Buffer.from(mmaRow!.fileDataBase64, 'base64');
    const fdMma = new FormData();
    fdMma.append('file', new Blob([mmaBuf], { type: 'application/pdf' }), 'MMA FRAGRANCE 8_2026.pdf');
    const upMmaRes = await fetch(`${BASE}/api/price-lists/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: fdMma,
    });
    const upMmaData = await upMmaRes.json();
    assert.equal(upMmaRes.status, 200, 'MMA PDF upload failed');
    createdImportIds.push(upMmaData.id);
    const firstMmaItem = upMmaData.parsedItems.find((i: any) => i.code === 'MMA1231') || upMmaData.parsedItems[0];
    assert.ok(firstMmaItem, 'MMA should extract items');
    assert.notEqual(firstMmaItem.costPrice, 1, 'Row index N=1 MUST NOT become costPrice=1!');
    assert.ok(upMmaData.rawTableData && upMmaData.rawTableData.rows.length > 50, 'MMA rawTableData must be stored for manual remapping');

    // Find column index of '1 kG' in rawTableData.headers and remap it to 'selling_price'
    const headers: string[] = upMmaData.rawTableData.headers || [];
    const kgColIdx = headers.findIndex((h) => /1\s*kg/i.test(h));
    if (kgColIdx >= 0) {
      const customMapping = {
        ...(upMmaData.rawTableData.columnMapping || {}),
        [kgColIdx]: 'selling_price',
      };
      const remapRes = await apiCall(`/api/price-lists/${upMmaData.id}/remap`, {
        method: 'POST',
        token: ownerToken,
        body: JSON.stringify({ columnMapping: customMapping }),
      });
      assert.equal(remapRes.status, 200, `Remap failed: ${JSON.stringify(remapRes.data)}`);
      const remappedFirst = remapRes.data.parsedItems[0];
      assert.ok(remappedFirst.sellingPrice !== null && remappedFirst.singlePriceMeaning === 'selling', 'Remapped column should become sellingPrice cleanly');
      console.log(`   OK: MMA PDF ignored N=1 + Manual Column Mapping (${remapRes.data.parsedItems.length} items) verified!`);
    }

    // 7C. Approve 1 synthetic item from Madina ephemeral batch and verify stock=0 & 0 new stock_movements
    const movBefore = await db.select().from(stockMovements);
    const testCode = `__V_PDF_${runId}`;
    const approveRes = await apiCall(`/api/price-lists/${upMadinaData.id}/approve`, {
      method: 'POST',
      token: ownerToken,
      stepUpToken,
      body: JSON.stringify({
        items: [
          {
            rowKey: 'verify-1',
            code: testCode,
            name: `صنف اختبار PDF ${runId}`,
            description: 'اختبار مؤقت',
            suggestedCategoryId: 'cat-packaging',
            suggestedCategoryName: 'الفوارغ والعبوات',
            unit: 'قطعة',
            sellingPrice: 120,
            costPrice: 80,
            ambiguousSinglePrice: null,
            singlePriceMeaning: 'selling',
            matchStatus: 'new',
            confidence: 99,
            warnings: [],
            needsReview: false,
            selectedForImport: true,
          },
        ],
      }),
    });
    assert.equal(approveRes.status, 200, `Approve PDF failed: ${JSON.stringify(approveRes.data)}`);
    assert.equal(approveRes.data.approvalSummary.stockModified, false);

    const createdPdfProds = await db.select().from(products).where(eq(products.code, testCode));
    assert.equal(createdPdfProds.length, 1);
    createdPdfProds.forEach((p) => createdProductIds.push(p.id));
    assert.equal(createdPdfProds[0].stock, 0, 'New PDF product MUST start with stock=0');
    assert.equal(createdPdfProds[0].commissionMode, 'inherit_rep', 'New PDF product MUST default to inherit_rep');

    const movAfter = await db.select().from(stockMovements);
    assert.equal(movAfter.length, movBefore.length, 'PDF import approval MUST NOT touch stock_movements');
    console.log('   OK: Non-stock PDF approval verified (stock=0, movements untouched).');

    console.log('\n✅ ALL E2E TESTS PASSED CLEANLY!');
  } finally {
    console.log('Cleaning up ephemeral verification rows & restoring original commission settings...');
    if (origCommConfig !== null) {
      await db
        .update(systemSettings)
        .set({ value: origCommConfig })
        .where(eq(systemSettings.key, 'commission_config'));
    }
    for (const cat of origCats) {
      await db
        .update(productCategories)
        .set({
          defaultCommissionEligible: cat.defaultCommissionEligible,
          defaultCommissionRate: cat.defaultCommissionRate,
          isActive: cat.isActive,
        })
        .where(eq(productCategories.id, cat.id));
    }

    if (createdOrderIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.orderId, createdOrderIds));
      await db.delete(orders).where(inArray(orders.id, createdOrderIds));
    }
    if (createdImportIds.length > 0) {
      await db.delete(priceListImports).where(inArray(priceListImports.id, createdImportIds));
    }
    if (createdProductIds.length > 0) {
      await db.delete(products).where(inArray(products.id, createdProductIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(customers).where(inArray(customers.id, createdCustomerIds));
    }
    if (createdRepIds.length > 0) {
      await db.delete(salesReps).where(inArray(salesReps.id, createdRepIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, createdUserIds));
      await db.delete(commissionSettingLogs).where(inArray(commissionSettingLogs.actorId, createdUserIds));
      await db.delete(teamMembers).where(inArray(teamMembers.id, createdUserIds));
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('E2E TEST FAILED:', err);
  process.exit(1);
});
