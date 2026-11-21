import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, withDbRetry } from './index.ts';
import {
  getOwnerSystemOverviewCounts,
  listBackupRecords,
} from './ownerControlQueries.ts';
import {
  auditLogs,
  chatMessages,
  commissionSettingLogs,
  customers,
  oilGrades,
  orderRevisions,
  orders,
  priceListImports,
  productCategories,
  productPriceHistory,
  products,
  salesReps,
  stockMovements,
  systemSettings,
  teamMembers,
} from './schema.ts';
import { hashPassword, verifyPassword } from '../lib/auth-utils.ts';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_COMMISSION_CONFIG,
  resolveCategoryDefaultCommissionEligible,
  resolveCategoryDefaultCommissionRate,
  roundMoney,
} from '../lib/commission-utils.ts';
import { normalizeArabicForSearch } from '../lib/product-classifier.ts';
import {
  DEFAULT_OIL_GRADES,
  decodeUploadedFilename,
  extractPriceListFromPdfBuffer,
  remapParsedTableRows,
  resolveOilGradeMatch,
} from '../lib/pdf-price-importer.ts';
import type {
  AuditLogEntry,
  CommissionConfig,
  CommissionMode,
  CommissionSettingLog,
  OilGradeRecord,
  OwnerCommissionAnalytics,
  PriceListColumnMapping,
  PriceListImportConfig,
  PriceListImportRecord,
  PriceListParsedItem,
  Product,
  ProductCategory,
  SystemGeneralSettings,
  User,
  UserRole,
} from '../../types.ts';

export const DEFAULT_SYSTEM_SETTINGS: SystemGeneralSettings = {
  companyName: 'Kima Scent Wholesale',
  defaultShippingCost: 50,
  lowStockThresholdOils: 5000,
  lowStockThresholdOther: 50,
  allowCustomItemsInInvoices: true,
};

export function mapCategoryRow(c: typeof productCategories.$inferSelect): ProductCategory {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    sortOrder: c.sortOrder,
    defaultUnit: c.defaultUnit,
    defaultCommissionEligible: c.defaultCommissionEligible,
    defaultCommissionRate:
      typeof c.defaultCommissionRate === 'number' ? c.defaultCommissionRate : null,
    isActive: c.isActive,
    description: c.description ?? undefined,
    createdAt: c.createdAt || undefined,
  };
}

export function mapProductRow(p: typeof products.$inferSelect): Product {
  const categoryId = p.categoryId || 'cat-oils';
  const categoryName = p.categoryName || 'الزيوت العطرية';
  return {
    id: p.id,
    code: p.code || `OIL-${p.id.toUpperCase()}`,
    name: p.name,
    categoryId,
    categoryName,
    description: p.description ?? undefined,
    unit: p.unit || 'mg',
    grade: p.grade ?? '',
    gradeId: p.gradeId ?? null,
    baseProductName: p.baseProductName ?? null,
    baseProductKey: p.baseProductKey ?? null,
    pricePerMg: p.pricePerMg,
    costPrice: p.costPrice ?? null,
    costUpdatedAt: p.costUpdatedAt ?? null,
    stock: p.stock,
    isActive: p.isActive ?? true,
    isCommissionEligible:
      typeof p.isCommissionEligible === 'boolean' ? p.isCommissionEligible : categoryId === 'cat-oils',
    commissionMode: (p.commissionMode as CommissionMode) || 'inherit_rep',
    customCommissionRate: p.customCommissionRate ?? null,
    customCommissionFixed: p.customCommissionFixed ?? null,
    createdAt: p.createdAt ?? undefined,
    updatedAt: p.updatedAt ?? undefined,
  };
}

export function mapOilGradeRow(g: typeof oilGrades.$inferSelect): OilGradeRecord {
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    sortOrder: g.sortOrder,
    isActive: g.isActive,
    aliases: Array.isArray(g.aliases) ? g.aliases : [],
    description: g.description ?? null,
    createdAt: g.createdAt || undefined,
    updatedAt: g.updatedAt || undefined,
  };
}

export async function ensureCatalogAndSettingsSeeded(): Promise<void> {
  const nowIso = new Date().toISOString();

  // 1. Seed default 5 categories non-destructively
  for (const cat of DEFAULT_CATEGORIES) {
    await db
      .insert(productCategories)
      .values({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        sortOrder: cat.sortOrder,
        defaultUnit: cat.defaultUnit,
        defaultCommissionEligible: cat.defaultCommissionEligible,
        defaultCommissionRate: cat.defaultCommissionRate ?? 0,
        isActive: cat.isActive,
        description: cat.description ?? null,
        createdAt: nowIso,
      })
      .onConflictDoNothing();
  }

  // 1b. Seed default oil grades (عالي / وسط / تجاري) non-destructively
  for (const grade of DEFAULT_OIL_GRADES) {
    await db
      .insert(oilGrades)
      .values({
        id: grade.id,
        name: grade.name,
        slug: grade.slug,
        sortOrder: grade.sortOrder,
        isActive: grade.isActive,
        aliases: grade.aliases,
        description: grade.description ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing();
  }

  // 2. Seed commission_config & general_settings if missing
  await db
    .insert(systemSettings)
    .values({
      key: 'commission_config',
      value: DEFAULT_COMMISSION_CONFIG as unknown as Record<string, unknown>,
      updatedAt: nowIso,
      updatedByName: 'النظام',
    })
    .onConflictDoNothing();

  await db
    .insert(systemSettings)
    .values({
      key: 'general_settings',
      value: DEFAULT_SYSTEM_SETTINGS as unknown as Record<string, unknown>,
      updatedAt: nowIso,
      updatedByName: 'النظام',
    })
    .onConflictDoNothing();

  // 3. Backfill existing legacy oil products cleanly without altering prices or stock
  const existingProducts = await db.select().from(products);
  const usedCodes = new Set(
    existingProducts.map((p) => (p.code || '').trim().toLowerCase()).filter(Boolean)
  );

  for (let idx = 0; idx < existingProducts.length; idx++) {
    const p = existingProducts[idx];
    const patch: Partial<typeof products.$inferInsert> = {};
    if (!p.code || !p.code.trim()) {
      let candidate = `OIL-${p.id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || idx + 1}`;
      let suffix = 1;
      while (usedCodes.has(candidate.toLowerCase())) {
        suffix += 1;
        candidate = `OIL-${p.id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}-${suffix}`;
      }
      usedCodes.add(candidate.toLowerCase());
      patch.code = candidate;
    }
    if (!p.categoryId) patch.categoryId = 'cat-oils';
    if (!p.categoryName) patch.categoryName = 'الزيوت العطرية';
    if (!p.unit) patch.unit = 'mg';
    if (typeof p.isActive !== 'boolean') patch.isActive = true;
    if (typeof p.isCommissionEligible !== 'boolean') patch.isCommissionEligible = true;
    if (!p.commissionMode) patch.commissionMode = 'inherit_rep';
    if (!p.createdAt) patch.createdAt = nowIso;

    if (Object.keys(patch).length > 0) {
      await db.update(products).set(patch).where(eq(products.id, p.id));
    }
  }

  // 4. Optional environment-driven Owner bootstrap (ZERO hardcoded credentials)
  const envOwnerUsername = process.env.OWNER_USERNAME?.trim().toLowerCase();
  const envOwnerPassword = process.env.OWNER_PASSWORD?.trim();
  if (envOwnerUsername && envOwnerPassword) {
    const owners = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.role, 'owner'));
    if (owners.length === 0) {
      const existingByUsername = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.username, envOwnerUsername))
        .limit(1);
      if (existingByUsername.length === 0) {
        await db.insert(teamMembers).values({
          id: `u-owner-${Date.now()}`,
          name: process.env.OWNER_DISPLAY_NAME?.trim() || 'المالك الرئيسي',
          username: envOwnerUsername,
          passwordHash: hashPassword(envOwnerPassword),
          role: 'owner',
          isSuspended: false,
          isMuted: false,
          canEditInventory: true,
          canConfirmDelivery: true,
          canManageOrderStatus: true,
          canDeleteOrders: true,
          canDeleteCustomers: true,
          startDate: nowIso,
          online: true,
        });
      }
    }
  }
}

export async function getAllCategories(): Promise<ProductCategory[]> {
  const rows = await db.select().from(productCategories);
  return rows.map(mapCategoryRow).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function ensureOilGradesSeeded(executor: {
  select: typeof db.select;
  insert: typeof db.insert;
} = db): Promise<void> {
  const existing = await executor
    .select({ id: oilGrades.id })
    .from(oilGrades)
    .limit(1);
  if (existing.length > 0) return;
  const nowIso = new Date().toISOString();
  for (const grade of DEFAULT_OIL_GRADES) {
    await executor
      .insert(oilGrades)
      .values({
        id: grade.id,
        name: grade.name,
        slug: grade.slug,
        sortOrder: grade.sortOrder,
        isActive: grade.isActive,
        aliases: grade.aliases,
        description: grade.description ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing();
  }
}

export async function getAllOilGrades(): Promise<OilGradeRecord[]> {
  await ensureOilGradesSeeded();
  const rows = await db
    .select()
    .from(oilGrades)
    .orderBy(asc(oilGrades.sortOrder), asc(oilGrades.id));
  if (rows.length === 0) return DEFAULT_OIL_GRADES;
  return rows.map(mapOilGradeRow);
}

export async function createOilGradeRecord(
  input: {
    name: string;
    slug?: string;
    sortOrder?: number;
    isActive?: boolean;
    aliases?: string[];
    description?: string | null;
  },
  actor: User
): Promise<OilGradeRecord> {
  const cleanName = (input.name || '').trim();
  const cleanSlug = (input.slug || cleanName)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0600-\u06FF-]/g, '');

  if (!cleanName || !cleanSlug) {
    throw new Error('يرجى إدخال اسم درجة زيت صالح.');
  }

  return await db.transaction(async (tx) => {
    await ensureOilGradesSeeded(tx);
    const existing = await tx.select().from(oilGrades);
    if (
      existing.some(
        (g) =>
          normalizeArabicForSearch(g.name) === normalizeArabicForSearch(cleanName) ||
          g.slug.trim().toLowerCase() === cleanSlug.toLowerCase()
      )
    ) {
      throw new Error('توجد درجة زيت بنفس الاسم أو المعرف مسبقاً.');
    }

    const nowIso = new Date().toISOString();
    const cleanAliases = Array.from(
      new Set(
        [cleanName, ...(Array.isArray(input.aliases) ? input.aliases : [])]
          .map((a) => String(a || '').trim())
          .filter(Boolean)
      )
    );

    const newRow: typeof oilGrades.$inferInsert = {
      id: `grade-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: cleanName,
      slug: cleanSlug,
      sortOrder:
        typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder)
          ? input.sortOrder
          : existing.length + 1,
      isActive: input.isActive !== false,
      aliases: cleanAliases,
      description: input.description?.trim() || null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await tx.insert(oilGrades).values(newRow);
    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'oil_grade_created',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        gradeId: newRow.id,
        name: newRow.name,
        aliases: cleanAliases,
      },
      createdAt: nowIso,
    });

    return mapOilGradeRow(newRow as typeof oilGrades.$inferSelect);
  });
}

export async function updateOilGradeRecord(
  input: Partial<OilGradeRecord> & { id: string },
  actor: User
): Promise<OilGradeRecord> {
  return await db.transaction(async (tx) => {
    const all = await tx.select().from(oilGrades);
    const current = all.find((g) => g.id === input.id);
    if (!current) throw new Error('درجة الزيت المطلوبة غير موجودة.');

    const nextName = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : current.name;
    const nextSlug =
      typeof input.slug === 'string' && input.slug.trim() ? input.slug.trim() : current.slug;

    if (
      all.some(
        (g) =>
          g.id !== input.id &&
          (normalizeArabicForSearch(g.name) === normalizeArabicForSearch(nextName) ||
            g.slug.trim().toLowerCase() === nextSlug.toLowerCase())
      )
    ) {
      throw new Error('توجد درجة زيت أخرى بنفس الاسم أو المعرف.');
    }

    const nextAliases = Array.isArray(input.aliases)
      ? Array.from(
          new Set(
            [nextName, ...input.aliases].map((a) => String(a || '').trim()).filter(Boolean)
          )
        )
      : current.aliases;

    const nowIso = new Date().toISOString();
    await tx
      .update(oilGrades)
      .set({
        name: nextName,
        slug: nextSlug,
        sortOrder:
          typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder)
            ? input.sortOrder
            : current.sortOrder,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : current.isActive,
        aliases: nextAliases,
        description:
          input.description !== undefined ? input.description?.trim() || null : current.description,
        updatedAt: nowIso,
      })
      .where(eq(oilGrades.id, input.id));

    if (nextName !== current.name) {
      await tx
        .update(products)
        .set({ grade: nextName, updatedAt: nowIso })
        .where(eq(products.gradeId, input.id));
    }

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'oil_grade_updated',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        gradeId: input.id,
        previousName: current.name,
        newName: nextName,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : current.isActive,
      },
      createdAt: nowIso,
    });

    const [updated] = await tx
      .select()
      .from(oilGrades)
      .where(eq(oilGrades.id, input.id))
      .limit(1);
    return mapOilGradeRow(updated);
  });
}

export async function getCommissionConfig(): Promise<CommissionConfig> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'commission_config'))
    .limit(1);
  if (rows.length === 0) return DEFAULT_COMMISSION_CONFIG;
  return {
    ...DEFAULT_COMMISSION_CONFIG,
    ...(rows[0].value as Partial<CommissionConfig>),
    updatedAt: rows[0].updatedAt || undefined,
    updatedByName: rows[0].updatedByName || undefined,
  };
}

export async function getGeneralSystemSettings(): Promise<SystemGeneralSettings> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'general_settings'))
    .limit(1);
  if (rows.length === 0) return DEFAULT_SYSTEM_SETTINGS;
  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...(rows[0].value as Partial<SystemGeneralSettings>),
  };
}

export class OwnerBootstrapError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'OwnerBootstrapError';
    this.statusCode = statusCode;
  }
}

const OWNER_BOOTSTRAP_LOCK_KEY = 88421001;

export async function getOwnerAccountCount(): Promise<number> {
  const owners = await withDbRetry(() =>
    db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.role, 'owner'))
  );
  return owners.length;
}

export async function getOwnerBootstrapStatus(): Promise<{
  hasOwnerAccount: boolean;
  hasRecoveryHash: boolean;
  hasClaimAudit: boolean;
  canBootstrapOwner: boolean;
}> {
  const [owners, recoveryRows, claimAudits] = await withDbRetry(() =>
    Promise.all([
      db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.role, 'owner')),
      db
        .select({ key: systemSettings.key })
        .from(systemSettings)
        .where(eq(systemSettings.key, 'owner_recovery_hash'))
        .limit(1),
      db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.actionType, 'owner_role_claimed'))
        .limit(1),
    ])
  );
  const hasOwnerAccount = owners.length > 0;
  const hasRecoveryHash = recoveryRows.length > 0;
  const hasClaimAudit = claimAudits.length > 0;
  return {
    hasOwnerAccount,
    hasRecoveryHash,
    hasClaimAudit,
    canBootstrapOwner: !hasOwnerAccount && !hasRecoveryHash && !hasClaimAudit,
  };
}

export async function claimInitialOwnerRoleRecord(
  actorUser: User,
  currentPassword: string,
  recoveryKey: string
): Promise<User> {
  if (!currentPassword) {
    throw new OwnerBootstrapError('يرجى إدخال كلمة المرور الحالية.', 400);
  }
  const cleanRecovery = recoveryKey.trim();
  if (cleanRecovery.length < 8) {
    throw new OwnerBootstrapError('يجب أن يكون مفتاح الاستعادة للمالك 8 أحرف أو أرقام على الأقل.', 400);
  }

  return await withDbRetry(() =>
    db.transaction(async (tx) => {
      // Serialize initial Owner bootstrap across concurrent sessions/tabs
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${OWNER_BOOTSTRAP_LOCK_KEY})`);

      const existingOwners = await tx
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(eq(teamMembers.role, 'owner'))
        .for('update');
      if (existingOwners.length > 0) {
        throw new OwnerBootstrapError(
          'تم تفعيل حساب المالك الرئيسي مسبقاً ولا يمكن تكرار الترقية.',
          409
        );
      }

      const [existingRecovery, existingClaimAudit] = await Promise.all([
        tx
          .select({ key: systemSettings.key })
          .from(systemSettings)
          .where(eq(systemSettings.key, 'owner_recovery_hash'))
          .limit(1),
        tx
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(eq(auditLogs.actionType, 'owner_role_claimed'))
          .limit(1),
      ]);

      if (existingRecovery.length > 0 || existingClaimAudit.length > 0) {
        throw new OwnerBootstrapError(
          'تم تسجيل تفعيل أو إعداد مفتاح استعادة للمالك الرئيسي مسبقاً ولا يمكن تكرار التفعيل.',
          409
        );
      }

      const actorRows = await tx
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.id, actorUser.id))
        .for('update');
      if (actorRows.length === 0) {
        throw new OwnerBootstrapError('الحساب غير موجود.', 404);
      }
      const actorRow = actorRows[0];
      const actorRole = String(actorRow.role || '').trim().toLowerCase();
      if (actorRow.isSuspended) {
        throw new OwnerBootstrapError('هذا الحساب معطل حالياً من قبل الإدارة.', 403);
      }
      if (actorRole === 'owner') {
        throw new OwnerBootstrapError(
          'تم ترقية هذا الحساب إلى المالك الرئيسي مسبقاً ولا يمكن تكرار التفعيل.',
          409
        );
      }
      if (actorRole !== 'admin') {
        throw new OwnerBootstrapError(
          'يمكن تفعيل المالك الأول فقط من خلال حساب المدير العام (Admin) المؤهل.',
          403
        );
      }

      if (!actorRow.passwordHash || !verifyPassword(currentPassword, actorRow.passwordHash)) {
        throw new OwnerBootstrapError(
          'كلمة المرور الحالية غير صحيحة. يرجى التأكد من كلمة مرور حساب المدير الحالي والمحاولة مرة أخرى.',
          400
        );
      }

      const nowIso = new Date().toISOString();
      const recoveryHash = hashPassword(cleanRecovery);

      await tx
        .update(teamMembers)
        .set({
          role: 'owner',
          canEditInventory: true,
          canConfirmDelivery: true,
          canManageOrderStatus: true,
          canDeleteOrders: true,
          canDeleteCustomers: true,
        })
        .where(eq(teamMembers.id, actorRow.id));

      await tx.insert(systemSettings).values({
        key: 'owner_recovery_hash',
        value: { hash: recoveryHash },
        updatedAt: nowIso,
        updatedById: actorRow.id,
        updatedByName: actorRow.name,
      });

      await tx.insert(auditLogs).values({
        id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        actionType: 'owner_role_claimed',
        actorId: actorRow.id,
        actorName: actorRow.name,
        actorRole: 'owner',
        details: { username: actorRow.username },
        createdAt: nowIso,
      });

      return {
        id: actorRow.id,
        name: actorRow.name,
        nickname: actorRow.nickname ?? undefined,
        avatar: actorRow.avatar ?? undefined,
        username: actorRow.username,
        role: 'owner',
        salesRepId: actorRow.salesRepId ?? undefined,
        isSuspended: actorRow.isSuspended,
        isMuted: actorRow.isMuted,
        canEditInventory: true,
        canConfirmDelivery: true,
        canManageOrderStatus: true,
        canDeleteOrders: true,
        canDeleteCustomers: true,
        address: actorRow.address ?? undefined,
        startDate: actorRow.startDate ?? undefined,
        online: actorRow.online,
      };
    })
  );
}

export async function setOwnerRecoveryKeyRecord(
  ownerUser: User,
  recoveryKey: string
): Promise<void> {
  const clean = recoveryKey.trim();
  if (clean.length < 8) {
    throw new OwnerBootstrapError('مفتاح الاستعادة يجب أن لا يقل عن 8 أحرف أو أرقام.', 400);
  }
  const nowIso = new Date().toISOString();
  const recoveryHash = hashPassword(clean);

  await withDbRetry(() =>
    db.transaction(async (tx) => {
      await tx
        .insert(systemSettings)
        .values({
          key: 'owner_recovery_hash',
          value: { hash: recoveryHash },
          updatedAt: nowIso,
          updatedById: ownerUser.id,
          updatedByName: ownerUser.name,
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: { hash: recoveryHash },
            updatedAt: nowIso,
            updatedById: ownerUser.id,
            updatedByName: ownerUser.name,
          },
        });

      await tx.insert(auditLogs).values({
        id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        actionType: 'owner_recovery_key_rotated',
        actorId: ownerUser.id,
        actorName: ownerUser.name,
        actorRole: ownerUser.role,
        details: {},
        createdAt: nowIso,
      });
    })
  );
}

export async function recoverOwnerAccessRecord(
  username: string,
  recoveryKey: string,
  newPassword: string
): Promise<User> {
  const cleanUser = username.trim().toLowerCase();
  const cleanNewPass = newPassword.trim();
  if (cleanNewPass.length < 6) {
    throw new OwnerBootstrapError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.', 400);
  }

  return await withDbRetry(() =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.username, cleanUser))
        .for('update');
      if (rows.length === 0 || rows[0].role !== 'owner') {
        throw new OwnerBootstrapError('حساب المالك الرئيسي المطلوب غير موجود.', 403);
      }

      const settingRows = await tx
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'owner_recovery_hash'))
        .limit(1);
      const storedHash =
        typeof settingRows[0]?.value?.hash === 'string' ? settingRows[0].value.hash : '';
      if (!storedHash || !verifyPassword(recoveryKey.trim(), storedHash)) {
        throw new OwnerBootstrapError('مفتاح استعادة المالك غير صحيح.', 403);
      }

      const nowIso = new Date().toISOString();
      await tx
        .update(teamMembers)
        .set({
          passwordHash: hashPassword(cleanNewPass),
          isSuspended: false,
        })
        .where(eq(teamMembers.id, rows[0].id));

      await tx.insert(auditLogs).values({
        id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        actionType: 'owner_password_recovered',
        actorId: rows[0].id,
        actorName: rows[0].name,
        actorRole: 'owner',
        details: { username: rows[0].username },
        createdAt: nowIso,
      });

      return {
        id: rows[0].id,
        name: rows[0].name,
        nickname: rows[0].nickname ?? undefined,
        avatar: rows[0].avatar ?? undefined,
        username: rows[0].username,
        role: 'owner',
        salesRepId: rows[0].salesRepId ?? undefined,
        isSuspended: false,
        isMuted: rows[0].isMuted,
        canEditInventory: true,
        canConfirmDelivery: true,
        canManageOrderStatus: true,
        canDeleteOrders: true,
        canDeleteCustomers: true,
        address: rows[0].address ?? undefined,
        startDate: rows[0].startDate ?? undefined,
        online: rows[0].online,
      };
    })
  );
}

export async function createCategoryRecord(
  input: Omit<ProductCategory, 'id' | 'createdAt'>,
  actor: User
): Promise<ProductCategory> {
  const cleanName = input.name.trim();
  const cleanSlug = (input.slug || cleanName)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0600-\u06FF-]/g, '');

  if (!cleanName || !cleanSlug) {
    throw new Error('يرجى إدخال اسم تصنيف صالح.');
  }

  return await db.transaction(async (tx) => {
    const existing = await tx.select().from(productCategories);
    if (
      existing.some(
        (c) =>
          c.name.trim().toLowerCase() === cleanName.toLowerCase() ||
          c.slug.trim().toLowerCase() === cleanSlug.toLowerCase()
      )
    ) {
      throw new Error('يوجد تصنيف بنفس الاسم أو المعرف مسبقاً؛ لا يُسمح بتكرار التصنيفات.');
    }

    const nowIso = new Date().toISOString();
    const numericRate =
      typeof input.defaultCommissionRate === 'number' && Number.isFinite(input.defaultCommissionRate)
        ? Math.max(0, Math.min(1, input.defaultCommissionRate))
        : input.defaultCommissionEligible
          ? 0.05
          : 0;
    const isEligible =
      typeof input.defaultCommissionRate === 'number'
        ? numericRate > 0
        : Boolean(input.defaultCommissionEligible);

    const newRow: typeof productCategories.$inferInsert = {
      id: `cat-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: cleanName,
      slug: cleanSlug,
      sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : existing.length + 1,
      defaultUnit: input.defaultUnit?.trim() || 'قطعة',
      defaultCommissionEligible: isEligible,
      defaultCommissionRate: numericRate,
      isActive: input.isActive !== false,
      description: input.description?.trim() || null,
      createdAt: nowIso,
    };

    await tx.insert(productCategories).values(newRow);
    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'category_created',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        categoryId: newRow.id,
        name: newRow.name,
        defaultUnit: newRow.defaultUnit,
        defaultCommissionRate: numericRate,
      },
      createdAt: nowIso,
    });

    return mapCategoryRow({ ...newRow } as typeof productCategories.$inferSelect);
  });
}

export async function updateCategoryRecord(
  cat: Partial<ProductCategory> & { id: string },
  actor: User
): Promise<ProductCategory> {
  return await db.transaction(async (tx) => {
    const allCats = await tx.select().from(productCategories);
    const current = allCats.find((c) => c.id === cat.id);
    if (!current) throw new Error('التصنيف المطلوب غير موجود.');

    const cleanName = typeof cat.name === 'string' ? cat.name.trim() : current.name;
    if (!cleanName) throw new Error('يرجى إدخال اسم تصنيف صالح.');
    const cleanSlug =
      typeof cat.slug === 'string' && cat.slug.trim() ? cat.slug.trim() : current.slug;

    if (
      allCats.some(
        (c) =>
          c.id !== cat.id &&
          (c.name.trim().toLowerCase() === cleanName.toLowerCase() ||
            c.slug.trim().toLowerCase() === cleanSlug.toLowerCase())
      )
    ) {
      throw new Error('يوجد تصنيف آخر بنفس الاسم أو المعرف.');
    }

    const commCfgRows = await tx
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'commission_config'))
      .limit(1);
    const commCfg: CommissionConfig = {
      ...DEFAULT_COMMISSION_CONFIG,
      ...((commCfgRows[0]?.value as Partial<CommissionConfig>) || {}),
    };

    const prevRate =
      typeof current.defaultCommissionRate === 'number'
        ? current.defaultCommissionRate
        : resolveCategoryDefaultCommissionRate(
            current.id,
            current.name,
            commCfg,
            allCats.map(mapCategoryRow)
          );

    let nextRate: number | null = current.defaultCommissionRate ?? null;
    if (
      typeof cat.defaultCommissionRate === 'number' &&
      Number.isFinite(cat.defaultCommissionRate)
    ) {
      nextRate = Math.max(0, Math.min(1, cat.defaultCommissionRate));
    } else if (cat.defaultCommissionRate === null) {
      nextRate = 0;
    } else if (
      typeof cat.defaultCommissionEligible === 'boolean' &&
      Boolean(cat.defaultCommissionEligible) !== current.defaultCommissionEligible
    ) {
      nextRate = cat.defaultCommissionEligible ? commCfg.defaultOilCommissionRate || 0.05 : 0;
    }

    const nextEligible =
      typeof nextRate === 'number'
        ? nextRate > 0
        : typeof cat.defaultCommissionEligible === 'boolean'
          ? Boolean(cat.defaultCommissionEligible)
          : current.defaultCommissionEligible;

    const nextSortOrder =
      typeof cat.sortOrder === 'number' && Number.isFinite(cat.sortOrder)
        ? cat.sortOrder
        : current.sortOrder;
    const nextUnit =
      typeof cat.defaultUnit === 'string' && cat.defaultUnit.trim()
        ? cat.defaultUnit.trim()
        : current.defaultUnit;
    const nextIsActive = typeof cat.isActive === 'boolean' ? cat.isActive : current.isActive;
    const nextDescription =
      cat.description !== undefined ? cat.description?.trim() || null : current.description;

    const nowIso = new Date().toISOString();
    await tx
      .update(productCategories)
      .set({
        name: cleanName,
        slug: cleanSlug,
        sortOrder: nextSortOrder,
        defaultUnit: nextUnit,
        defaultCommissionEligible: nextEligible,
        defaultCommissionRate: nextRate,
        isActive: nextIsActive,
        description: nextDescription,
      })
      .where(eq(productCategories.id, cat.id));

    if (cleanName !== current.name) {
      await tx
        .update(products)
        .set({ categoryName: cleanName })
        .where(eq(products.categoryId, cat.id));
    }

    // Sync cached eligibility badge on non-overridden products in this category
    await tx
      .update(products)
      .set({ isCommissionEligible: nextEligible })
      .where(
        sql`${products.categoryId} = ${cat.id} AND ${products.commissionMode} = 'inherit_rep'`
      );

    await tx.insert(commissionSettingLogs).values({
      id: `clg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      targetType: 'category',
      targetId: cat.id,
      targetName: cleanName,
      previousValue: {
        defaultCommissionEligible: current.defaultCommissionEligible,
        defaultCommissionRate: prevRate,
        defaultUnit: current.defaultUnit,
      },
      newValue: {
        defaultCommissionEligible: nextEligible,
        defaultCommissionRate: nextRate,
        defaultUnit: nextUnit,
      },
      reason: 'تعديل إعدادات ونسبة عمولة التصنيف من لوحة المالك',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      createdAt: nowIso,
    });

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'category_updated',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        categoryId: cat.id,
        name: cleanName,
        previousRate: prevRate,
        newRate: nextRate,
      },
      createdAt: nowIso,
    });

    const [updated] = await tx
      .select()
      .from(productCategories)
      .where(eq(productCategories.id, cat.id))
      .limit(1);
    return mapCategoryRow(updated);
  });
}

export async function updateCommissionConfigRecord(
  actor: User,
  nextConfig: Partial<CommissionConfig>,
  reason?: string
): Promise<CommissionConfig> {
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'commission_config'))
      .for('update');

    const prev: CommissionConfig = {
      ...DEFAULT_COMMISSION_CONFIG,
      ...((rows[0]?.value as Partial<CommissionConfig>) || {}),
    };

    const merged: CommissionConfig = {
      ...prev,
      ...nextConfig,
      defaultOilCommissionRate:
        typeof nextConfig.defaultOilCommissionRate === 'number' &&
        Number.isFinite(nextConfig.defaultOilCommissionRate)
          ? Math.max(0, Math.min(1, nextConfig.defaultOilCommissionRate))
          : prev.defaultOilCommissionRate,
    };

    const nowIso = new Date().toISOString();
    await tx
      .insert(systemSettings)
      .values({
        key: 'commission_config',
        value: merged as unknown as Record<string, unknown>,
        updatedAt: nowIso,
        updatedById: actor.id,
        updatedByName: actor.name,
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: merged as unknown as Record<string, unknown>,
          updatedAt: nowIso,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });

    await tx.insert(commissionSettingLogs).values({
      id: `clg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      targetType: 'global_config',
      targetId: 'commission_config',
      targetName: 'إعدادات العمولات العامة',
      previousValue: prev as unknown as Record<string, unknown>,
      newValue: merged as unknown as Record<string, unknown>,
      reason: reason?.trim() || 'تحديث إعدادات العمولات من لوحة المالك الرئيسي',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      createdAt: nowIso,
    });

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'commission_config_updated',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        previousRate: prev.defaultOilCommissionRate,
        newRate: merged.defaultOilCommissionRate,
        reason: reason || null,
      },
      createdAt: nowIso,
    });

    return {
      ...merged,
      updatedAt: nowIso,
      updatedByName: actor.name,
    };
  });
}

export async function updateSystemGeneralSettingsRecord(
  actor: User,
  nextSettings: Partial<SystemGeneralSettings>
): Promise<SystemGeneralSettings> {
  return await db.transaction(async (tx) => {
    const prev = await getGeneralSystemSettings();
    const merged: SystemGeneralSettings = {
      ...prev,
      ...nextSettings,
    };
    const nowIso = new Date().toISOString();
    await tx
      .insert(systemSettings)
      .values({
        key: 'general_settings',
        value: merged as unknown as Record<string, unknown>,
        updatedAt: nowIso,
        updatedById: actor.id,
        updatedByName: actor.name,
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: merged as unknown as Record<string, unknown>,
          updatedAt: nowIso,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'system_settings_updated',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: { newSettings: merged },
      createdAt: nowIso,
    });
    return merged;
  });
}

function mapPriceListImportRow(
  r: typeof priceListImports.$inferSelect
): PriceListImportRecord {
  return {
    id: r.id,
    fileName: decodeUploadedFilename(r.fileName),
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    extractionMethod: r.extractionMethod as PriceListImportRecord['extractionMethod'],
    status: r.status as PriceListImportRecord['status'],
    listCategoryId: r.listCategoryId ?? null,
    listCategoryName: r.listCategoryName ?? null,
    columnMapping: (r.columnMapping as PriceListColumnMapping | null) ?? null,
    importConfig: (r.importConfig as PriceListImportConfig | null) ?? null,
    rawTableRows: (r.rawTableRows as string[][] | undefined) ?? [],
    uploadedById: r.uploadedById,
    uploadedByName: r.uploadedByName,
    uploadedAt: r.uploadedAt,
    approvedById: r.approvedById ?? null,
    approvedByName: r.approvedByName ?? null,
    approvedAt: r.approvedAt ?? null,
    totalParsed: r.totalParsed,
    newCount: r.newCount,
    updatedCount: r.updatedCount,
    needsReviewCount: r.needsReviewCount,
    duplicateCount: r.duplicateCount,
    parsedItems: r.parsedItems ?? [],
    approvalSummary: r.approvalSummary ?? null,
    errorMessage: r.errorMessage ?? null,
    rawTextPreview: r.rawTextPreview ?? null,
  };
}

export async function createPriceListImportRecord(params: {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileDataBase64: string;
  extractionMethod: 'pdf_text' | 'pdf_ocr_gemini' | 'pdf_hybrid';
  listCategoryId?: string | null;
  listCategoryName?: string | null;
  columnMapping?: PriceListColumnMapping | null;
  importConfig?: PriceListImportConfig | null;
  rawTableRows?: string[][];
  parsedItems: PriceListParsedItem[];
  totalParsed: number;
  newCount: number;
  updatedCount: number;
  needsReviewCount: number;
  duplicateCount: number;
  rawTextPreview?: string | null;
  errorMessage?: string | null;
  actor: User;
}): Promise<PriceListImportRecord> {
  const nowIso = new Date().toISOString();
  const id = `pli-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const cleanFileName = decodeUploadedFilename(params.fileName);

  await db.transaction(async (tx) => {
    await tx.insert(priceListImports).values({
      id,
      fileName: cleanFileName,
      mimeType: params.mimeType,
      fileSizeBytes: params.fileSizeBytes,
      fileDataBase64: params.fileDataBase64,
      extractionMethod: params.extractionMethod,
      status: 'pending_review',
      listCategoryId: params.listCategoryId ?? null,
      listCategoryName: params.listCategoryName ?? null,
      columnMapping: params.columnMapping ?? null,
      importConfig: params.importConfig ?? null,
      rawTableRows: params.rawTableRows ?? [],
      uploadedById: params.actor.id,
      uploadedByName: params.actor.name,
      uploadedAt: nowIso,
      totalParsed: params.totalParsed,
      newCount: params.newCount,
      updatedCount: params.updatedCount,
      needsReviewCount: params.needsReviewCount,
      duplicateCount: params.duplicateCount,
      parsedItems: params.parsedItems,
      rawTextPreview: params.rawTextPreview ?? null,
      errorMessage: params.errorMessage ?? null,
    });

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'price_list_uploaded',
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      details: {
        importId: id,
        fileName: cleanFileName,
        listCategoryId: params.listCategoryId ?? null,
        listCategoryName: params.listCategoryName ?? null,
        extractionMethod: params.extractionMethod,
        totalParsed: params.totalParsed,
        newCount: params.newCount,
        updatedCount: params.updatedCount,
        duplicateCount: params.duplicateCount,
      },
      createdAt: nowIso,
    });
  });

  return {
    id,
    fileName: cleanFileName,
    mimeType: params.mimeType,
    fileSizeBytes: params.fileSizeBytes,
    extractionMethod: params.extractionMethod,
    status: 'pending_review',
    listCategoryId: params.listCategoryId ?? null,
    listCategoryName: params.listCategoryName ?? null,
    columnMapping: params.columnMapping ?? null,
    importConfig: params.importConfig ?? null,
    rawTableRows: params.rawTableRows ?? [],
    uploadedById: params.actor.id,
    uploadedByName: params.actor.name,
    uploadedAt: nowIso,
    totalParsed: params.totalParsed,
    newCount: params.newCount,
    updatedCount: params.updatedCount,
    needsReviewCount: params.needsReviewCount,
    duplicateCount: params.duplicateCount,
    parsedItems: params.parsedItems,
    rawTextPreview: params.rawTextPreview ?? null,
    errorMessage: params.errorMessage ?? null,
  };
}

export async function getPriceListImportHistory(): Promise<PriceListImportRecord[]> {
  const rows = await db
    .select()
    .from(priceListImports)
    .orderBy(desc(priceListImports.uploadedAt))
    .limit(50);

  return rows.map(mapPriceListImportRow);
}

export async function remapPriceListImportRecord(params: {
  importId: string;
  listCategoryId?: string | null;
  columnMapping?: PriceListColumnMapping | null;
  actor: User;
}): Promise<PriceListImportRecord> {
  const [importRow] = await db
    .select()
    .from(priceListImports)
    .where(eq(priceListImports.id, params.importId))
    .limit(1);
  if (!importRow) {
    throw new Error('سجل استيراد قائمة الأسعار غير موجود.');
  }
  if (importRow.status !== 'pending_review') {
    throw new Error('لا يمكن إعادة تعيين الأعمدة لدفعة معتمدة أو ملغاة.');
  }

  const [allProdRows, categories, gradesCatalog] = await Promise.all([
    db.select().from(products),
    getAllCategories(),
    getAllOilGrades(),
  ]);
  const existingProducts = allProdRows.map(mapProductRow);
  const nextListCategoryId =
    params.listCategoryId !== undefined ? params.listCategoryId : importRow.listCategoryId;

  const storedRows = (importRow.rawTableRows as string[][] | undefined) || [];
  const hasExplicitColMapping = Boolean(
    params.columnMapping &&
      ((params.columnMapping.columns && Object.keys(params.columnMapping.columns).length > 0) ||
        (params.columnMapping.columnConfigs &&
          Object.keys(params.columnMapping.columnConfigs).length > 0))
  );
  const storedRowsLookLegacySingleCol =
    storedRows.length === 0 || storedRows.every((r) => !Array.isArray(r) || r.length <= 1);

  let remapped;
  if (!storedRowsLookLegacySingleCol || hasExplicitColMapping || !importRow.fileDataBase64) {
    remapped = remapParsedTableRows({
      rawTableRows: storedRows,
      existingProducts,
      categoriesCatalog: categories,
      oilGrades: gradesCatalog,
      listCategoryId: nextListCategoryId,
      columnMapping: params.columnMapping ?? importRow.columnMapping ?? null,
    });
  } else {
    const buffer = Buffer.from(importRow.fileDataBase64, 'base64');
    remapped = await extractPriceListFromPdfBuffer(buffer, existingProducts, categories, {
      listCategoryId: nextListCategoryId,
      columnMapping: params.columnMapping ?? importRow.columnMapping ?? null,
      oilGrades: gradesCatalog,
    });
  }

  const cleanFileName = decodeUploadedFilename(importRow.fileName);
  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(priceListImports)
      .set({
        fileName: cleanFileName,
        listCategoryId: remapped.listCategoryId,
        listCategoryName: remapped.listCategoryName,
        columnMapping: remapped.columnMapping,
        importConfig: remapped.importConfig ?? null,
        rawTableRows: remapped.rawTableRows,
        parsedItems: remapped.parsedItems,
        totalParsed: remapped.totalParsed,
        newCount: remapped.newCount,
        updatedCount: remapped.updatedCount,
        needsReviewCount: remapped.needsReviewCount,
        duplicateCount: remapped.duplicateCount,
      })
      .where(eq(priceListImports.id, params.importId));

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'price_list_remapped',
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      details: {
        importId: params.importId,
        listCategoryId: remapped.listCategoryId,
        totalParsed: remapped.totalParsed,
        sourceUnit: remapped.importConfig?.unitConfig?.sourceUnit ?? null,
        confirmedByUser: remapped.importConfig?.unitConfig?.confirmedByUser ?? false,
      },
      createdAt: nowIso,
    });
  });

  const [updated] = await db
    .select()
    .from(priceListImports)
    .where(eq(priceListImports.id, params.importId))
    .limit(1);
  return mapPriceListImportRow(updated);
}

export async function getPriceListImportOriginalFile(importId: string): Promise<{
  fileName: string;
  mimeType: string;
  buffer: Buffer;
} | null> {
  const rows = await db
    .select({
      fileName: priceListImports.fileName,
      mimeType: priceListImports.mimeType,
      fileDataBase64: priceListImports.fileDataBase64,
    })
    .from(priceListImports)
    .where(eq(priceListImports.id, importId))
    .limit(1);

  if (rows.length === 0 || !rows[0].fileDataBase64) return null;
  return {
    fileName: decodeUploadedFilename(rows[0].fileName),
    mimeType: rows[0].mimeType || 'application/pdf',
    buffer: Buffer.from(rows[0].fileDataBase64, 'base64'),
  };
}

/**
 * Approves a reviewed PDF price list batch:
 * - Enforces oil unit confirmation when oils are included.
 * - Strictly prevents duplicate product codes & duplicate (baseProduct + grade + unit) keys.
 * - Supports multiple grades per base oil (e.g. عالي KS-1001 & وسط KS-2001) seamlessly.
 * - NEVER modifies existing warehouse `stock` and NEVER inserts `stock_movements`.
 * - New products start with `stock = 0` and `commissionMode = 'inherit_rep'`.
 */
export async function approvePriceListImportRecord(
  importId: string,
  submittedItems: PriceListParsedItem[],
  actor: User
): Promise<PriceListImportRecord> {
  return await db.transaction(async (tx) => {
    const existingImportRows = await tx
      .select()
      .from(priceListImports)
      .where(eq(priceListImports.id, importId))
      .for('update');
    if (existingImportRows.length === 0) {
      throw new Error('سجل استيراد قائمة الأسعار غير موجود.');
    }
    const importRow = existingImportRows[0];
    if (importRow.status !== 'pending_review') {
      throw new Error('تم اعتماد أو إلغاء عملية الاستيراد هذه مسبقاً.');
    }

    const categories = (await tx.select().from(productCategories)).map(mapCategoryRow);
    await ensureOilGradesSeeded(tx);
    const gradeRows = await tx.select().from(oilGrades);
    const gradesCatalog = gradeRows.length > 0 ? gradeRows.map(mapOilGradeRow) : DEFAULT_OIL_GRADES;

    const commSettingsRows = await tx
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'commission_config'))
      .limit(1);
    const commConfig: CommissionConfig = {
      ...DEFAULT_COMMISSION_CONFIG,
      ...((commSettingsRows[0]?.value as Partial<CommissionConfig>) || {}),
    };

    const existingProducts = await tx.select().from(products);
    const byCode = new Map(
      existingProducts
        .filter((p) => p.code)
        .map((p) => [p.code!.trim().toLowerCase(), p])
    );

    const buildVariantKey = (baseName: string, gradeText: string, unitText: string) => {
      const baseKey = normalizeArabicForSearch(baseName);
      const gRes = resolveOilGradeMatch(gradeText, gradesCatalog);
      const gradeKey = normalizeArabicForSearch(gRes.matched ? gRes.canonicalName : gradeText || '');
      const unitKey = normalizeArabicForSearch(unitText || '');
      return `${baseKey}||${gradeKey}||${unitKey}`;
    };

    const byVariantKey = new Map(
      existingProducts.map((p) => [
        buildVariantKey(p.baseProductName || p.name, p.grade || '', p.unit || ''),
        p,
      ])
    );

    const batchUnitConfirmed = Boolean(importRow.importConfig?.unitConfig?.confirmedByUser);
    const selectedCodesInBatch = new Set<string>();
    const selectedVariantKeyInBatch = new Set<string>();
    const selectedItems = (submittedItems || []).filter((item) => item.selectedForImport);

    for (const item of selectedItems) {
      const code = (item.code || '').trim().toUpperCase();
      if (!code) {
        throw new Error(`الصنف "${item.name || 'غير مسمى'}" لا يحتوي على كود منتج. يرجى إدخال كود أو استبعاده.`);
      }
      if (!item.name?.trim()) {
        throw new Error(`الصنف ذو الكود ${code} لا يحتوي على اسم.`);
      }
      if (item.matchStatus === 'duplicate_in_file') {
        throw new Error(`الكود ${code} مميز كمكرر داخل الملف ولا يمكن استيراده.`);
      }

      const catObj =
        categories.find((c) => c.id === item.suggestedCategoryId) ||
        categories.find((c) => c.name === item.suggestedCategoryName) ||
        (importRow.listCategoryId
          ? categories.find((c) => c.id === importRow.listCategoryId)
          : undefined);
      const isOilItem = catObj?.id === 'cat-oils' || catObj?.slug === 'oils';
      if (
        isOilItem &&
        !batchUnitConfirmed &&
        !item.originalPriceUnit &&
        (item.warnings || []).some((w) => w.includes('وحدة تسعير الزيت غير مؤكدة'))
      ) {
        throw new Error(
          'يجب تأكيد وحدة تسعير الزيوت (كيلوجرام أم جرام) أولاً قبل اعتماد وحفظ الأسعار.'
        );
      }

      const codeKey = code.toLowerCase();
      if (selectedCodesInBatch.has(codeKey)) {
        throw new Error(`الكود ${code} مكرر في البنود المحددة للاعتماد.`);
      }
      selectedCodesInBatch.add(codeKey);

      const variantKey = buildVariantKey(
        item.baseProductName || item.name,
        item.grade || '',
        item.unit || ''
      );
      if (selectedVariantKeyInBatch.has(variantKey)) {
        throw new Error(
          `الصنف "${item.baseProductName || item.name}"${item.grade ? ` (${item.grade})` : ''} مكرر بنفس الدرجة والوحدة في البنود المحددة للاعتماد.`
        );
      }
      selectedVariantKeyInBatch.add(variantKey);

      if (
        item.ambiguousSinglePrice !== null &&
        item.singlePriceMeaning === 'unresolved' &&
        item.sellingPrice === null &&
        item.costPrice === null
      ) {
        throw new Error(
          `الصنف "${item.name}" (${code}) يحتوي على سعر واحد غير محدد المعنى؛ يرجى تحديد هل هو سعر بيع أم سعر شراء.`
        );
      }
    }

    const nowIso = new Date().toISOString();
    let createdCount = 0;
    let updatedCount = 0;

    for (let idx = 0; idx < selectedItems.length; idx++) {
      const item = selectedItems[idx];
      const code = item.code.trim().toUpperCase();
      const codeKey = code.toLowerCase();
      const baseName = (item.baseProductName || item.name || '').trim();
      const baseKey = item.baseProductKey || normalizeArabicForSearch(baseName);
      const gradeRes = resolveOilGradeMatch(item.grade || '', gradesCatalog);
      const finalGradeName = item.grade?.trim()
        ? gradeRes.matched
          ? gradeRes.canonicalName
          : item.grade.trim()
        : '';
      const finalGradeId = item.gradeId ?? (gradeRes.matched ? gradeRes.gradeId : null);

      const variantKey = buildVariantKey(baseName, finalGradeName, item.unit || '');
      const matched =
        (item.matchedProductId
          ? existingProducts.find((p) => p.id === item.matchedProductId)
          : undefined) ||
        byCode.get(codeKey) ||
        byVariantKey.get(variantKey);

      const effectiveSelling =
        item.sellingPrice !== null
          ? Number(item.sellingPrice)
          : item.singlePriceMeaning === 'selling' && item.ambiguousSinglePrice !== null
            ? Number(item.ambiguousSinglePrice)
            : null;
      const effectiveCost =
        item.costPrice !== null
          ? Number(item.costPrice)
          : item.singlePriceMeaning === 'cost' && item.ambiguousSinglePrice !== null
            ? Number(item.ambiguousSinglePrice)
            : null;

      const catObj =
        categories.find((c) => c.id === item.suggestedCategoryId) ||
        categories.find((c) => c.name === item.suggestedCategoryName) ||
        (importRow.listCategoryId
          ? categories.find((c) => c.id === importRow.listCategoryId)
          : undefined) ||
        DEFAULT_CATEGORIES[4];

      if (matched) {
        const flags = item.updateFields || {};
        const patch: Partial<typeof products.$inferInsert> = {};
        if (flags.name && item.name.trim()) {
          patch.name = item.name.trim();
          patch.baseProductName = baseName;
          patch.baseProductKey = baseKey;
        }
        if (flags.description) patch.description = item.description.trim() || null;
        if (flags.category) {
          patch.categoryId = catObj.id;
          patch.categoryName = catObj.name;
        }
        if (flags.unit && item.unit?.trim()) patch.unit = item.unit.trim();
        if (flags.grade && finalGradeName) {
          patch.grade = finalGradeName;
          patch.gradeId = finalGradeId;
        }
        if (
          flags.sellingPrice &&
          effectiveSelling !== null &&
          Number.isFinite(effectiveSelling) &&
          effectiveSelling > 0
        ) {
          patch.pricePerMg = effectiveSelling;
        }
        if (
          flags.costPrice &&
          effectiveCost !== null &&
          Number.isFinite(effectiveCost) &&
          effectiveCost >= 0
        ) {
          patch.costPrice = effectiveCost;
          patch.costUpdatedAt = nowIso;
        }
        if (!matched.baseProductName && baseName) {
          patch.baseProductName = baseName;
          patch.baseProductKey = baseKey;
        }
        if (!matched.gradeId && finalGradeId) {
          patch.gradeId = finalGradeId;
        }
        // Explicitly NEVER touch stock!
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = nowIso;
          await tx.update(products).set(patch).where(eq(products.id, matched.id));
          updatedCount += 1;

          const priceChanged =
            (patch.pricePerMg !== undefined && patch.pricePerMg !== matched.pricePerMg) ||
            (patch.costPrice !== undefined && patch.costPrice !== matched.costPrice);
          if (priceChanged) {
            await tx.insert(productPriceHistory).values({
              id: `pph-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
              productId: matched.id,
              productCode: matched.code || code,
              productName: patch.name || matched.name,
              grade: patch.grade || matched.grade || finalGradeName || '',
              previousSellingPrice: matched.pricePerMg,
              newSellingPrice: patch.pricePerMg ?? matched.pricePerMg,
              previousCostPrice: matched.costPrice ?? null,
              newCostPrice: patch.costPrice !== undefined ? patch.costPrice : matched.costPrice ?? null,
              unit: patch.unit || matched.unit || 'جرام',
              sourceType: 'pdf_import',
              importBatchId: importId,
              actorId: actor.id,
              actorName: actor.name,
              actorRole: actor.role,
              note: item.conversionNote || `تحديث من استيراد قائمة الأسعار (${decodeUploadedFilename(importRow.fileName)})`,
              createdAt: nowIso,
            });
          }
        }
      } else {
        if (effectiveSelling === null || !Number.isFinite(effectiveSelling) || effectiveSelling <= 0) {
          throw new Error(`الصنف الجديد "${item.name}" (${code}) يحتاج سعر بيع صحيح.`);
        }
        const defaultEligible = resolveCategoryDefaultCommissionEligible(
          catObj.id,
          catObj.name,
          commConfig,
          categories
        );
        const newId = `p-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`;
        const finalUnit = item.unit?.trim() || catObj.defaultUnit;
        const resolvedGrade =
          finalGradeName ||
          (catObj.id === 'cat-oils'
            ? (gradesCatalog.find((g) => g.isActive)?.name || 'عالي')
            : '');
        const resolvedGradeId =
          finalGradeId ??
          (!finalGradeName && catObj.id === 'cat-oils'
            ? (gradesCatalog.find((g) => g.isActive)?.id || null)
            : null);

        const newProdRow: typeof products.$inferInsert = {
          id: newId,
          code,
          name: item.name.trim(),
          categoryId: catObj.id,
          categoryName: catObj.name,
          description: item.description.trim() || null,
          unit: finalUnit,
          grade: resolvedGrade,
          gradeId: resolvedGradeId,
          baseProductName: baseName,
          baseProductKey: baseKey,
          pricePerMg: effectiveSelling,
          costPrice: effectiveCost,
          costUpdatedAt: effectiveCost !== null ? nowIso : null,
          stock: 0, // NEVER add warehouse stock from a price list import!
          isActive: true,
          isCommissionEligible: defaultEligible,
          commissionMode: 'inherit_rep',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        await tx.insert(products).values(newProdRow);

        await tx.insert(productPriceHistory).values({
          id: `pph-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
          productId: newId,
          productCode: code,
          productName: newProdRow.name,
          grade: resolvedGrade,
          previousSellingPrice: null,
          newSellingPrice: effectiveSelling,
          previousCostPrice: null,
          newCostPrice: effectiveCost,
          unit: finalUnit,
          sourceType: 'pdf_import',
          importBatchId: importId,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          note: item.conversionNote || `إضافة من استيراد قائمة الأسعار (${decodeUploadedFilename(importRow.fileName)})`,
          createdAt: nowIso,
        });

        const insertedProd = newProdRow as typeof products.$inferSelect;
        byCode.set(codeKey, insertedProd);
        byVariantKey.set(buildVariantKey(baseName, resolvedGrade, finalUnit), insertedProd);
        createdCount += 1;
      }
    }

    const skippedCount = Math.max(0, (submittedItems || []).length - selectedItems.length);
    const approvalSummary = {
      createdCount,
      updatedCount,
      skippedCount,
      stockModified: false as const,
    };

    await tx
      .update(priceListImports)
      .set({
        status: 'approved',
        approvedById: actor.id,
        approvedByName: actor.name,
        approvedAt: nowIso,
        parsedItems: submittedItems,
        approvalSummary,
      })
      .where(eq(priceListImports.id, importId));

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'price_list_approved',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        importId,
        fileName: decodeUploadedFilename(importRow.fileName),
        listCategoryId: importRow.listCategoryId,
        ...approvalSummary,
      },
      createdAt: nowIso,
    });

    const [updated] = await tx
      .select()
      .from(priceListImports)
      .where(eq(priceListImports.id, importId))
      .limit(1);

    return mapPriceListImportRow(updated);
  });
}

export async function cancelPriceListImportRecord(importId: string, actor: User): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(priceListImports)
      .set({
        status: 'cancelled',
        approvedById: actor.id,
        approvedByName: actor.name,
        approvedAt: nowIso,
      })
      .where(eq(priceListImports.id, importId));

    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'price_list_cancelled',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: { importId },
      createdAt: nowIso,
    });
  });
}

/**
 * Deletes ONLY archived/stored price list import batch records (and their inline file_data_base64 PDF blob).
 * NEVER touches catalog products, codes, prices, stock, stock_movements, historical orders, or commissions.
 */
export async function deletePriceListImportRecords(
  importIds: string[],
  actor: User
): Promise<{ deletedCount: number; deletedIds: string[]; deletedFiles: string[] }> {
  const cleanIds = Array.from(
    new Set((importIds || []).map((id) => String(id || '').trim()).filter(Boolean))
  );
  if (cleanIds.length === 0) {
    throw new Error('يرجى تحديد دفعة استيراد واحدة على الأقل للحذف.');
  }

  return await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: priceListImports.id,
        fileName: priceListImports.fileName,
        status: priceListImports.status,
        uploadedAt: priceListImports.uploadedAt,
        listCategoryName: priceListImports.listCategoryName,
      })
      .from(priceListImports)
      .where(inArray(priceListImports.id, cleanIds));

    if (existing.length === 0) {
      throw new Error('دفعة الاستيراد المطلوب حذفها غير موجودة في السجل.');
    }

    const foundIds = existing.map((e) => e.id);
    const deletedFiles = existing.map((e) => decodeUploadedFilename(e.fileName));

    await tx.delete(priceListImports).where(inArray(priceListImports.id, foundIds));

    const nowIso = new Date().toISOString();
    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'price_list_archive_deleted',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        deletedCount: foundIds.length,
        deletedIds: foundIds,
        deletedBatches: existing.map((e) => ({
          id: e.id,
          fileName: decodeUploadedFilename(e.fileName),
          status: e.status,
          uploadedAt: e.uploadedAt,
          listCategoryName: e.listCategoryName,
        })),
        catalogProductsModified: false,
      },
      createdAt: nowIso,
    });

    return {
      deletedCount: foundIds.length,
      deletedIds: foundIds,
      deletedFiles,
    };
  });
}

export async function computeOwnerCommissionAnalytics(): Promise<OwnerCommissionAnalytics> {
  const allOrders = await db.select().from(orders);

  let commissionableDeliveredSales = 0;
  let commissionablePendingSales = 0;
  let nonCommissionableDeliveredSales = 0;
  let nonCommissionablePendingSales = 0;
  let earnedCommissionTotal = 0;
  let pendingCommissionTotal = 0;

  for (const o of allOrders) {
    if (
      o.status === 'بانتظار تأكيد العميل' ||
      o.status === 'ملغي' ||
      o.status === 'مرتجع' ||
      o.status === 'رفض استلام'
    ) {
      continue;
    }

    const discountFactor = 1 - Math.min(100, Math.max(0, o.discountPercentage || 0)) / 100;
    let commSubtotal =
      typeof o.commissionableSubtotal === 'number'
        ? o.commissionableSubtotal
        : o.items.reduce((sum, it) => {
            const elig = it.isCommissionEligible ?? true;
            return elig ? sum + it.quantity * it.price : sum;
          }, 0);
    const netCommSales = roundMoney(commSubtotal * discountFactor);
    const netNonCommSales = roundMoney(Math.max(0, (o.subtotal - commSubtotal) * discountFactor));

    if (o.status === 'تم التسليم') {
      commissionableDeliveredSales += netCommSales;
      nonCommissionableDeliveredSales += netNonCommSales;
      earnedCommissionTotal += o.commission;
    } else {
      commissionablePendingSales += netCommSales;
      nonCommissionablePendingSales += netNonCommSales;
      pendingCommissionTotal += o.commission;
    }
  }

  return {
    commissionableDeliveredSales: roundMoney(commissionableDeliveredSales),
    commissionablePendingSales: roundMoney(commissionablePendingSales),
    nonCommissionableDeliveredSales: roundMoney(nonCommissionableDeliveredSales),
    nonCommissionablePendingSales: roundMoney(nonCommissionablePendingSales),
    earnedCommissionTotal: roundMoney(earnedCommissionTotal),
    pendingCommissionTotal: roundMoney(pendingCommissionTotal),
  };
}

export async function getOwnerOverviewData() {
  const [
    categories,
    oilGradesList,
    commissionConfig,
    generalSettings,
    commissionLogRows,
    auditLogRows,
    priceImports,
    commissionAnalytics,
    systemCounts,
    backups,
  ] = await Promise.all([
    getAllCategories(),
    getAllOilGrades(),
    getCommissionConfig(),
    getGeneralSystemSettings(),
    db
      .select()
      .from(commissionSettingLogs)
      .orderBy(desc(commissionSettingLogs.createdAt))
      .limit(100),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200),
    getPriceListImportHistory(),
    computeOwnerCommissionAnalytics(),
    getOwnerSystemOverviewCounts(),
    listBackupRecords(),
  ]);

  return {
    categories,
    oilGrades: oilGradesList,
    commissionConfig,
    generalSettings,
    commissionLogs: commissionLogRows.map(
      (l): CommissionSettingLog => ({
        id: l.id,
        targetType: l.targetType as CommissionSettingLog['targetType'],
        targetId: l.targetId,
        targetName: l.targetName,
        previousValue: l.previousValue ?? {},
        newValue: l.newValue ?? {},
        reason: l.reason ?? null,
        actorId: l.actorId,
        actorName: l.actorName,
        actorRole: l.actorRole as UserRole,
        createdAt: l.createdAt,
      })
    ),
    auditLogs: auditLogRows.map(
      (a): AuditLogEntry => ({
        id: a.id,
        orderId: a.orderId ?? null,
        actionType: a.actionType,
        actorId: a.actorId,
        actorName: a.actorName,
        actorRole: a.actorRole as UserRole,
        details: a.details ?? {},
        createdAt: a.createdAt,
      })
    ),
    priceListImports: priceImports,
    commissionAnalytics,
    systemCounts,
    backups,
  };
}

export async function exportFullDatabaseSnapshotForOwner(actor: User) {
  const [
    cats,
    prods,
    reps,
    custs,
    ords,
    revs,
    moves,
    chats,
    logs,
    commLogs,
    settings,
    members,
  ] = await Promise.all([
    db.select().from(productCategories),
    db.select().from(products),
    db.select().from(salesReps),
    db.select().from(customers),
    db.select().from(orders),
    db.select().from(orderRevisions),
    db.select().from(stockMovements),
    db.select().from(chatMessages),
    db.select().from(auditLogs),
    db.select().from(commissionSettingLogs),
    db.select().from(systemSettings),
    db
      .select({
        id: teamMembers.id,
        name: teamMembers.name,
        username: teamMembers.username,
        role: teamMembers.role,
        salesRepId: teamMembers.salesRepId,
        isSuspended: teamMembers.isSuspended,
        canEditInventory: teamMembers.canEditInventory,
        canConfirmDelivery: teamMembers.canConfirmDelivery,
        canManageOrderStatus: teamMembers.canManageOrderStatus,
        canDeleteOrders: teamMembers.canDeleteOrders,
        canDeleteCustomers: teamMembers.canDeleteCustomers,
      })
      .from(teamMembers),
  ]);

  const nowIso = new Date().toISOString();
  await db.insert(auditLogs).values({
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    actionType: 'owner_backup_exported',
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    details: { ordersCount: ords.length, productsCount: prods.length },
    createdAt: nowIso,
  });

  return {
    exportedAt: nowIso,
    exportedBy: actor.name,
    counts: {
      categories: cats.length,
      products: prods.length,
      orders: ords.length,
      customers: custs.length,
      salesReps: reps.length,
      teamMembers: members.length,
    },
    data: {
      productCategories: cats,
      products: prods,
      salesReps: reps,
      customers: custs,
      orders: ords,
      orderRevisions: revs,
      stockMovements: moves,
      chatMessages: chats,
      auditLogs: logs,
      commissionSettingLogs: commLogs,
      systemSettings: settings.filter((s) => s.key !== 'owner_recovery_hash'),
      teamMembers: members,
    },
  };
}
