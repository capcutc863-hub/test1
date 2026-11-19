import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Pool as PgPool } from 'pg';
import JSZip from 'jszip';
import { desc, eq } from 'drizzle-orm';
import { createPool, db } from './index.ts';
import { auditLogs, backupRecords } from './schema.ts';
import type {
  BackupAttachmentMeta,
  BackupInspectionReport,
  BackupManifest,
  BackupRecord,
  BackupTableComparison,
  BackupVerificationStatus,
  OwnerSystemOverviewCounts,
  RestoreExecutionReport,
  SystemResetPreview,
  SystemResetResult,
  SystemResetScope,
  User,
} from '../../types.ts';

export const BACKUP_APP_VERSION = '2.4.0';
export const BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_CONFIRM_RESTORE_PHRASE = 'استعادة النسخة واستبدال البيانات الحالية';
export const RESET_FULL_CONFIRM_PHRASE = 'تأكيد تصفير النظام بالكامل';

const OWNER_SENSITIVE_ADVISORY_LOCK_KEY = 98421001;
const SANDBOX_SCHEMA_REGEX = /^restore_sandbox_[a-z0-9_]+$/;

export const ALL_BACKUP_TABLES = [
  'product_categories',
  'products',
  'team_members',
  'sales_reps',
  'customers',
  'orders',
  'order_revisions',
  'stock_movements',
  'price_list_imports',
  'system_settings',
  'commission_setting_logs',
  'audit_logs',
  'chat_messages',
  'users',
] as const;

export type BackupTableName = (typeof ALL_BACKUP_TABLES)[number];

const TABLE_JSONB_COLUMNS: Record<BackupTableName, string[]> = {
  product_categories: [],
  products: [],
  team_members: [],
  sales_reps: ['category_rates', 'monthly_history'],
  customers: ['return_history'],
  orders: [
    'items',
    'commission_rule_snapshot',
    'pending_edit_request',
    'status_history',
    'shipping_info',
    'delivery_info',
    'return_info',
    'hold_info',
    'revision_alert',
    'cancellation_info',
  ],
  order_revisions: ['added_items', 'removed_items', 'modified_items'],
  stock_movements: [],
  price_list_imports: ['column_mapping', 'raw_table_rows', 'parsed_items', 'approval_summary'],
  system_settings: ['value'],
  commission_setting_logs: ['previous_value', 'new_value'],
  audit_logs: ['details'],
  chat_messages: [],
  users: [],
};

const TABLE_COLUMNS: Record<BackupTableName, string[]> = {
  product_categories: [
    'id',
    'name',
    'slug',
    'sort_order',
    'default_unit',
    'default_commission_eligible',
    'default_commission_rate',
    'is_active',
    'description',
    'created_at',
  ],
  products: [
    'id',
    'code',
    'name',
    'category_id',
    'category_name',
    'description',
    'unit',
    'grade',
    'price_per_mg',
    'cost_price',
    'stock',
    'is_active',
    'is_commission_eligible',
    'commission_mode',
    'custom_commission_rate',
    'custom_commission_fixed',
    'created_at',
    'updated_at',
  ],
  team_members: [
    'id',
    'name',
    'nickname',
    'avatar',
    'username',
    'password_hash',
    'role',
    'sales_rep_id',
    'is_suspended',
    'is_muted',
    'can_edit_inventory',
    'can_confirm_delivery',
    'can_manage_order_status',
    'can_delete_orders',
    'can_delete_customers',
    'address',
    'start_date',
    'online',
  ],
  sales_reps: [
    'id',
    'user_id',
    'name',
    'total_commission',
    'pending_commission',
    'orders_count',
    'max_discount_allowed',
    'custom_commission_rate',
    'category_rates',
    'monthly_history',
  ],
  customers: [
    'id',
    'name',
    'phone',
    'address',
    'total_spent',
    'classification',
    'last_order_date',
    'return_history',
  ],
  orders: [
    'id',
    'customer_name',
    'customer_phone',
    'customer_address',
    'governorate',
    'customer_notes',
    'operational_notes',
    'sales_rep_id',
    'sales_rep_name',
    'items',
    'subtotal',
    'discount_percentage',
    'discount_amount',
    'shipping_cost',
    'total_amount',
    'status',
    'created_at',
    'commission',
    'commissionable_subtotal',
    'commission_rate_snapshot',
    'commission_rule_snapshot',
    'version',
    'confirmed_at',
    'confirmed_by_id',
    'confirmed_by_name',
    'prep_started_at',
    'prep_completed_at',
    'shipped_at',
    'delivered_at',
    'cancelled_at',
    'returned_at',
    'pending_edit_request',
    'status_history',
    'shipping_info',
    'delivery_info',
    'return_info',
    'hold_info',
    'revision_alert',
    'cancellation_info',
  ],
  order_revisions: [
    'id',
    'order_id',
    'from_version',
    'to_version',
    'edited_by_id',
    'edited_by_name',
    'edited_by_role',
    'edited_at',
    'reason',
    'order_status_at_edit',
    'added_items',
    'removed_items',
    'modified_items',
    'previous_item_count',
    'new_item_count',
    'previous_total',
    'new_total',
    'previous_commission',
    'new_commission',
    'requires_re_preparation',
    'review_status',
    'reviewed_by_id',
    'reviewed_by_name',
    'reviewed_at',
    'review_note',
  ],
  stock_movements: [
    'id',
    'product_id',
    'product_name',
    'grade',
    'order_id',
    'movement_type',
    'sourcing_source',
    'quantity_delta',
    'order_quantity_covered',
    'previous_stock',
    'new_stock',
    'supplier_name',
    'note',
    'actor_id',
    'actor_name',
    'actor_role',
    'created_at',
  ],
  price_list_imports: [
    'id',
    'file_name',
    'mime_type',
    'file_size_bytes',
    'file_data_base64',
    'extraction_method',
    'status',
    'list_category_id',
    'list_category_name',
    'column_mapping',
    'raw_table_rows',
    'uploaded_by_id',
    'uploaded_by_name',
    'uploaded_at',
    'approved_by_id',
    'approved_by_name',
    'approved_at',
    'total_parsed',
    'new_count',
    'updated_count',
    'needs_review_count',
    'duplicate_count',
    'parsed_items',
    'approval_summary',
    'error_message',
    'raw_text_preview',
  ],
  system_settings: ['key', 'value', 'updated_at', 'updated_by_id', 'updated_by_name'],
  commission_setting_logs: [
    'id',
    'target_type',
    'target_id',
    'target_name',
    'previous_value',
    'new_value',
    'reason',
    'actor_id',
    'actor_name',
    'actor_role',
    'created_at',
  ],
  audit_logs: [
    'id',
    'order_id',
    'action_type',
    'actor_id',
    'actor_name',
    'actor_role',
    'details',
    'created_at',
  ],
  chat_messages: ['id', 'sender_id', 'sender_name', 'text', 'timestamp'],
  users: ['id', 'uid', 'email', 'created_at'],
};

const TABLE_ORDER_BY: Record<BackupTableName, string> = {
  product_categories: 'sort_order ASC, id ASC',
  products: 'id ASC',
  team_members: 'id ASC',
  sales_reps: 'id ASC',
  customers: 'id ASC',
  orders: 'created_at ASC, id ASC',
  order_revisions: 'edited_at ASC, id ASC',
  stock_movements: 'created_at ASC, id ASC',
  price_list_imports: 'uploaded_at ASC, id ASC',
  system_settings: 'key ASC',
  commission_setting_logs: 'created_at ASC, id ASC',
  audit_logs: 'created_at ASC, id ASC',
  chat_messages: 'timestamp ASC, id ASC',
  users: 'id ASC',
};

export class OwnerControlError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'OwnerControlError';
    this.statusCode = statusCode;
  }
}

let activeSensitiveOperation: string | null = null;
let adminPoolInstance: Pool | null = null;

function getAdminPool(): Pool {
  if (!adminPoolInstance) {
    const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER;
    const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;
    adminPoolInstance = new PgPool({
      host: process.env.SQL_HOST,
      user,
      password,
      database: process.env.SQL_DB_NAME,
      max: 4,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 20000,
    });
    adminPoolInstance.on('error', (err) => {
      console.error('Unexpected error on admin SQL pool client:', err);
    });
  }
  return adminPoolInstance;
}

function assertValidTargetSchema(schemaName: string): string {
  if (schemaName === 'public') return 'public';
  if (SANDBOX_SCHEMA_REGEX.test(schemaName)) return schemaName;
  throw new OwnerControlError('اسم مخطط قاعدة البيانات غير صالح.', 400);
}

function sha256Hex(input: Buffer | string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function sanitizeArchiveFileName(name: string): string {
  return (name || 'attachment.pdf')
    .replace(/[^\w.\-\u0600-\u06FF]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

function statusToLabelAr(status: BackupVerificationStatus): string {
  switch (status) {
    case 'valid':
      return 'سليمة وقابلة للاستعادة';
    case 'valid_with_warnings':
      return 'سليمة ولكن بها تحذيرات';
    case 'incomplete':
      return 'غير مكتملة';
    case 'incompatible':
      return 'غير متوافقة';
    case 'corrupted':
      return 'تالفة';
  }
}

/**
 * Concurrency lock using BOTH in-process operation guard AND PostgreSQL advisory lock
 * so concurrent Backup / Restore / Reset calls cannot interleave.
 */
export async function withOwnerSensitiveLock<T>(
  operationLabel: string,
  fn: () => Promise<T>
): Promise<T> {
  if (activeSensitiveOperation) {
    throw new OwnerControlError(
      `توجد عملية إدارية حساسة أخرى قيد التنفيذ حالياً (${activeSensitiveOperation}). يرجى الانتظار حتى انتهائها.`,
      409
    );
  }

  activeSensitiveOperation = operationLabel;
  const pool = createPool();
  let lockClient: PoolClient | null = null;
  let acquiredPgLock = false;

  try {
    lockClient = await pool.connect();
    const lockRes = await lockClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [OWNER_SENSITIVE_ADVISORY_LOCK_KEY]
    );
    acquiredPgLock = Boolean(lockRes.rows[0]?.acquired);
    if (!acquiredPgLock) {
      throw new OwnerControlError(
        'توجد عملية نسخ احتياطي أو استعادة أو تصفير نشطة على الخادم حالياً. يرجى المحاولة بعد قليل.',
        409
      );
    }

    return await fn();
  } finally {
    if (lockClient && acquiredPgLock) {
      await lockClient
        .query('SELECT pg_advisory_unlock($1)', [OWNER_SENSITIVE_ADVISORY_LOCK_KEY])
        .catch(() => {});
    }
    lockClient?.release();
    activeSensitiveOperation = null;
  }
}

export function getActiveOwnerSensitiveOperation(): string | null {
  return activeSensitiveOperation;
}

function mapBackupRecordRow(
  row: typeof backupRecords.$inferSelect,
  includeHasArchive = true
): BackupRecord {
  return {
    id: row.id,
    name: row.name,
    backupType: row.backupType as BackupRecord['backupType'],
    createdAt: row.createdAt,
    createdById: row.createdById,
    createdByName: row.createdByName,
    appVersion: row.appVersion,
    schemaVersion: row.schemaVersion,
    tablesCount: row.tablesCount,
    totalRecords: row.totalRecords,
    attachmentsCount: row.attachmentsCount,
    recordCounts: row.recordCounts || {},
    fileSizeBytes: row.fileSizeBytes,
    zipSha256: row.zipSha256,
    storageMode: row.storageMode as BackupRecord['storageMode'],
    status: row.status as BackupRecord['status'],
    verificationStatus: row.verificationStatus as BackupRecord['verificationStatus'],
    verificationNotes: row.verificationNotes ?? null,
    hasStoredArchive: includeHasArchive ? Boolean(row.archiveBase64 && row.archiveBase64.length > 0) : false,
  };
}

async function queryLiveTableCounts(client: PoolClient | Pool, schemaName = 'public'): Promise<Record<string, number>> {
  const safeSchema = assertValidTargetSchema(schemaName);
  const counts: Record<string, number> = {};
  for (const tbl of ALL_BACKUP_TABLES) {
    const r = await client.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM "${safeSchema}"."${tbl}"`);
    counts[tbl] = parseInt(r.rows[0]?.cnt || '0', 10);
  }
  return counts;
}

export async function getOwnerSystemOverviewCounts(): Promise<OwnerSystemOverviewCounts> {
  const pool = createPool();
  const [counts, backupsMeta] = await Promise.all([
    queryLiveTableCounts(pool, 'public'),
    db
      .select({
        id: backupRecords.id,
        createdAt: backupRecords.createdAt,
        status: backupRecords.status,
        verificationStatus: backupRecords.verificationStatus,
      })
      .from(backupRecords)
      .orderBy(desc(backupRecords.createdAt)),
  ]);

  const lastVerified = backupsMeta.find(
    (b) => b.status === 'completed' && b.verificationStatus === 'verified'
  );

  return {
    usersCount: counts.team_members || 0,
    salesRepsCount: counts.sales_reps || 0,
    categoriesCount: counts.product_categories || 0,
    productsCount: counts.products || 0,
    customersCount: counts.customers || 0,
    ordersCount: counts.orders || 0,
    stockMovementsCount: counts.stock_movements || 0,
    priceListImportsCount: counts.price_list_imports || 0,
    backupsCount: backupsMeta.length,
    lastVerifiedBackupAt: lastVerified?.createdAt ?? null,
    lastVerifiedBackupId: lastVerified?.id ?? null,
  };
}

export async function listBackupRecords(): Promise<BackupRecord[]> {
  const rows = await db
    .select({
      id: backupRecords.id,
      name: backupRecords.name,
      backupType: backupRecords.backupType,
      createdAt: backupRecords.createdAt,
      createdById: backupRecords.createdById,
      createdByName: backupRecords.createdByName,
      appVersion: backupRecords.appVersion,
      schemaVersion: backupRecords.schemaVersion,
      tablesCount: backupRecords.tablesCount,
      totalRecords: backupRecords.totalRecords,
      attachmentsCount: backupRecords.attachmentsCount,
      recordCounts: backupRecords.recordCounts,
      fileSizeBytes: backupRecords.fileSizeBytes,
      zipSha256: backupRecords.zipSha256,
      storageMode: backupRecords.storageMode,
      status: backupRecords.status,
      verificationStatus: backupRecords.verificationStatus,
      verificationNotes: backupRecords.verificationNotes,
      archiveLen: backupRecords.fileSizeBytes,
    })
    .from(backupRecords)
    .orderBy(desc(backupRecords.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    backupType: r.backupType as BackupRecord['backupType'],
    createdAt: r.createdAt,
    createdById: r.createdById,
    createdByName: r.createdByName,
    appVersion: r.appVersion,
    schemaVersion: r.schemaVersion,
    tablesCount: r.tablesCount,
    totalRecords: r.totalRecords,
    attachmentsCount: r.attachmentsCount,
    recordCounts: r.recordCounts || {},
    fileSizeBytes: r.fileSizeBytes,
    zipSha256: r.zipSha256,
    storageMode: r.storageMode as BackupRecord['storageMode'],
    status: r.status as BackupRecord['status'],
    verificationStatus: r.verificationStatus as BackupRecord['verificationStatus'],
    verificationNotes: r.verificationNotes ?? null,
    hasStoredArchive: r.storageMode === 'server_db' && r.fileSizeBytes > 0,
  }));
}

export async function getBackupArchiveById(backupId: string): Promise<{
  record: BackupRecord;
  zipBuffer: Buffer;
} | null> {
  const rows = await db
    .select()
    .from(backupRecords)
    .where(eq(backupRecords.id, backupId))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.archiveBase64) return null;
  const zipBuffer = Buffer.from(row.archiveBase64, 'base64');
  return {
    record: mapBackupRecordRow(row, true),
    zipBuffer,
  };
}

export async function deleteBackupRecordById(backupId: string, actor: User): Promise<void> {
  const existing = await db
    .select({
      id: backupRecords.id,
      name: backupRecords.name,
      zipSha256: backupRecords.zipSha256,
    })
    .from(backupRecords)
    .where(eq(backupRecords.id, backupId))
    .limit(1);

  if (existing.length === 0) {
    throw new OwnerControlError('سجل النسخة الاحتياطية غير موجود.', 404);
  }

  await db.transaction(async (tx) => {
    await tx.delete(backupRecords).where(eq(backupRecords.id, backupId));
    await tx.insert(auditLogs).values({
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actionType: 'owner_backup_deleted',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        backupId,
        backupName: existing[0].name,
        zipSha256: existing[0].zipSha256,
        operationalDataTouched: false,
      },
      createdAt: new Date().toISOString(),
    });
  });
}

/**
 * Creates a full, transactionally consistent PostgreSQL REPEATABLE READ ZIP backup
 * across all 14 application tables + binary PDF attachments, redacting raw password hashes
 * and recovery key hashes, verifying ZIP integrity immediately, and storing the record.
 */
export async function createFullSystemBackup(
  actor: User,
  options?: {
    name?: string;
    backupType?: BackupRecord['backupType'];
    sourceSchema?: string;
    skipLock?: boolean;
    persistRecord?: boolean;
  }
): Promise<{ record: BackupRecord; zipBuffer: Buffer; fileName: string; manifest: BackupManifest }> {
  const exec = async () => {
    const sourceSchema = assertValidTargetSchema(options?.sourceSchema || 'public');
    const pool = sourceSchema === 'public' ? createPool() : getAdminPool();
    const client = await pool.connect();

    const createdAt = new Date().toISOString();
    const backupId = `bkp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const backupType: BackupRecord['backupType'] = options?.backupType || 'full';
    const displayName =
      options?.name?.trim() ||
      (backupType === 'pre_restore_safety'
        ? `نسخة أمان تلقائية قبل الاستعادة (${createdAt.slice(0, 16).replace('T', ' ')})`
        : backupType === 'pre_reset_safety'
          ? `نسخة أمان قبل التصفير (${createdAt.slice(0, 16).replace('T', ' ')})`
          : `نسخة شاملة للنظام (${createdAt.slice(0, 16).replace('T', ' ')})`);

    const tableRows: Record<string, Record<string, unknown>[]> = {};
    const recordCounts: Record<string, number> = {};
    const tableSha256s: Record<string, string> = {};
    const attachments: BackupAttachmentMeta[] = [];
    const zip = new JSZip();

    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

      for (const tableName of ALL_BACKUP_TABLES) {
        const orderBy = TABLE_ORDER_BY[tableName];
        const res = await client.query<Record<string, unknown>>(
          `SELECT * FROM "${sourceSchema}"."${tableName}" ORDER BY ${orderBy}`
        );

        let sanitizedRows = res.rows.map((row) => ({ ...row }));

        if (tableName === 'team_members') {
          sanitizedRows = sanitizedRows.map((row) => {
            const hasPass = typeof row.password_hash === 'string' && row.password_hash.length > 0;
            return {
              ...row,
              password_hash: null,
              has_password_configured: hasPass,
            };
          });
        } else if (tableName === 'system_settings') {
          sanitizedRows = sanitizedRows.filter((row) => row.key !== 'owner_recovery_hash');
        } else if (tableName === 'price_list_imports') {
          sanitizedRows = sanitizedRows.map((row) => {
            const base64 = typeof row.file_data_base64 === 'string' ? row.file_data_base64 : '';
            if (base64.length > 0) {
              const pdfBuffer = Buffer.from(base64, 'base64');
              const safeName = sanitizeArchiveFileName(String(row.file_name || 'price-list.pdf'));
              const archivePath = `attachments/${String(row.id)}_${safeName}`;
              const pdfHash = sha256Hex(pdfBuffer);
              zip.file(archivePath, pdfBuffer);
              attachments.push({
                importId: String(row.id),
                archivePath,
                fileName: String(row.file_name || safeName),
                mimeType: String(row.mime_type || 'application/pdf'),
                fileSizeBytes: pdfBuffer.length,
                sha256: pdfHash,
              });
              return {
                ...row,
                file_data_base64: '',
                attachment_archive_path: archivePath,
              };
            }
            return row;
          });
        }

        tableRows[tableName] = sanitizedRows;
        recordCounts[tableName] = sanitizedRows.length;

        const jsonContent = JSON.stringify(sanitizedRows, null, 2);
        tableSha256s[tableName] = sha256Hex(jsonContent);
        zip.file(`tables/${tableName}.json`, jsonContent);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const manifest: BackupManifest = {
      backupId,
      name: displayName,
      createdAt,
      createdById: actor.id,
      createdByName: actor.name,
      appVersion: BACKUP_APP_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      backupType,
      databaseEngine: 'postgresql',
      tables: [...ALL_BACKUP_TABLES],
      recordCounts,
      attachmentsCount: attachments.length,
      attachments,
      tableSha256s,
      excludedSensitiveFields: {
        team_members: ['password_hash'],
        system_settings: ['owner_recovery_hash'],
        environment: ['GEMINI_API_KEY', 'SQL_PASSWORD', 'SQL_ADMIN_PASSWORD', 'SESSION_SECRET'],
      },
      compatibility: {
        minSchemaVersion: 2,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        appVersion: BACKUP_APP_VERSION,
      },
      supportedRestoreModes: ['isolated_sandbox', 'live_replace'],
    };

    const manifestStr = JSON.stringify(manifest, null, 2);
    zip.file('manifest.json', manifestStr);

    const checksumLines = [
      `${sha256Hex(manifestStr)}  manifest.json`,
      ...ALL_BACKUP_TABLES.map((t) => `${tableSha256s[t]}  tables/${t}.json`),
      ...attachments.map((a) => `${a.sha256}  ${a.archivePath}`),
    ];
    zip.file('checksums.sha256', checksumLines.join('\n') + '\n');

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const zipSha256 = sha256Hex(zipBuffer);
    const totalRecords = Object.values(recordCounts).reduce((sum, n) => sum + n, 0);

    // Self-verify the generated ZIP immediately before recording success
    const selfCheck = await inspectBackupZipBuffer(zipBuffer, { skipLiveDbDiff: true });
    if (selfCheck.status !== 'valid' && selfCheck.status !== 'valid_with_warnings') {
      throw new OwnerControlError(
        `فشل التحقق التلقائي من سلامة حزمة النسخة الاحتياطية بعد إنشائها: ${selfCheck.integrityErrors.join('؛ ')}`,
        500
      );
    }

    const record: BackupRecord = {
      id: backupId,
      name: displayName,
      backupType,
      createdAt,
      createdById: actor.id,
      createdByName: actor.name,
      appVersion: BACKUP_APP_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      tablesCount: ALL_BACKUP_TABLES.length,
      totalRecords,
      attachmentsCount: attachments.length,
      recordCounts,
      fileSizeBytes: zipBuffer.length,
      zipSha256,
      storageMode: 'server_db',
      status: 'completed',
      verificationStatus: selfCheck.status === 'valid' ? 'verified' : 'warnings',
      verificationNotes:
        selfCheck.warnings.length > 0
          ? selfCheck.warnings.join(' | ')
          : 'تم التحقق تلقائياً من جميع الجداول والمرفقات وبصمات SHA-256.',
      hasStoredArchive: true,
    };

    if (options?.persistRecord !== false && sourceSchema === 'public') {
      await db.transaction(async (tx) => {
        await tx.insert(backupRecords).values({
          id: record.id,
          name: record.name,
          backupType: record.backupType,
          createdAt: record.createdAt,
          createdById: record.createdById,
          createdByName: record.createdByName,
          appVersion: record.appVersion,
          schemaVersion: record.schemaVersion,
          tablesCount: record.tablesCount,
          totalRecords: record.totalRecords,
          attachmentsCount: record.attachmentsCount,
          recordCounts: record.recordCounts,
          fileSizeBytes: record.fileSizeBytes,
          zipSha256: record.zipSha256,
          storageMode: record.storageMode,
          status: record.status,
          verificationStatus: record.verificationStatus,
          verificationNotes: record.verificationNotes,
          archiveBase64: zipBuffer.toString('base64'),
        });

        await tx.insert(auditLogs).values({
          id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          actionType: 'owner_backup_created',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          details: {
            backupId: record.id,
            backupType: record.backupType,
            tablesCount: record.tablesCount,
            totalRecords: record.totalRecords,
            attachmentsCount: record.attachmentsCount,
            fileSizeBytes: record.fileSizeBytes,
            zipSha256: record.zipSha256,
          },
          createdAt,
        });
      });
    }

    const fileName = `KimaScent-Backup-${createdAt.slice(0, 10)}-${backupId.slice(-6)}.zip`;
    return { record, zipBuffer, fileName, manifest };
  };

  if (options?.skipLock) {
    return exec();
  }
  return withOwnerSensitiveLock('إنشاء نسخة احتياطية كاملة', exec);
}

/**
 * Inspects and validates a ZIP backup buffer:
 * - ZIP structure & manifest.json
 * - Schema compatibility
 * - Expected 14 tables & row counts
 * - Exact SHA-256 checksums for every table & binary PDF attachment
 * - Relational consistency checks
 * - Live DB diff comparison
 */
export async function inspectBackupZipBuffer(
  zipBuffer: Buffer,
  options?: { skipLiveDbDiff?: boolean; actor?: User; logInspection?: boolean }
): Promise<BackupInspectionReport> {
  const zipSha256 = sha256Hex(zipBuffer);
  const checksumMismatches: string[] = [];
  const missingTables: string[] = [];
  const unexpectedTables: string[] = [];
  const integrityErrors: string[] = [];
  const warnings: string[] = [];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    return {
      validZip: false,
      status: 'corrupted',
      statusLabelAr: statusToLabelAr('corrupted'),
      manifest: null,
      zipSha256,
      zipSizeBytes: zipBuffer.length,
      checksumMismatches: [],
      missingTables: [...ALL_BACKUP_TABLES],
      unexpectedTables: [],
      integrityErrors: ['الملف المرفوع ليس أرشيف ZIP صالحاً أو أنه تالف ولا يمكن فتحه.'],
      warnings: [],
      tableComparison: [],
      willReplaceTables: [],
      preservedProtections: [
        'يُحفظ حساب المالك الرئيسي وصلاحياته ورمز الاسترداد عند الاستعادة الحية',
      ],
    };
  }

  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    return {
      validZip: true,
      status: 'corrupted',
      statusLabelAr: statusToLabelAr('corrupted'),
      manifest: null,
      zipSha256,
      zipSizeBytes: zipBuffer.length,
      checksumMismatches: [],
      missingTables: [...ALL_BACKUP_TABLES],
      unexpectedTables: [],
      integrityErrors: ['ملف التعريف manifest.json مفقود داخل النسخة الاحتياطية.'],
      warnings: [],
      tableComparison: [],
      willReplaceTables: [],
      preservedProtections: [],
    };
  }

  let manifest: BackupManifest | null = null;
  try {
    const manifestText = await manifestEntry.async('string');
    manifest = JSON.parse(manifestText) as BackupManifest;
  } catch {
    integrityErrors.push('تعذر قراءة أو تحليل manifest.json داخل الأرشيف.');
    return {
      validZip: true,
      status: 'corrupted',
      statusLabelAr: statusToLabelAr('corrupted'),
      manifest: null,
      zipSha256,
      zipSizeBytes: zipBuffer.length,
      checksumMismatches: [],
      missingTables: [...ALL_BACKUP_TABLES],
      unexpectedTables: [],
      integrityErrors,
      warnings: [],
      tableComparison: [],
      willReplaceTables: [],
      preservedProtections: [],
    };
  }

  if (!manifest || !manifest.backupId || !manifest.recordCounts || !manifest.tableSha256s) {
    integrityErrors.push('بيانات manifest.json غير مكتملة البنية.');
  }

  // Schema compatibility check
  let incompatible = false;
  const minVer = manifest?.compatibility?.minSchemaVersion ?? manifest?.schemaVersion ?? 0;
  const schemaVer = manifest?.schemaVersion ?? 0;
  if (schemaVer > BACKUP_SCHEMA_VERSION || schemaVer < 1 || minVer > BACKUP_SCHEMA_VERSION) {
    incompatible = true;
    integrityErrors.push(
      `إصدار مخطط النسخة الاحتياطية (v${schemaVer}) غير متوافق مع إصدار النظام الحالي (v${BACKUP_SCHEMA_VERSION}).`
    );
  }

  const parsedTables: Record<string, Record<string, unknown>[]> = {};
  const archiveTableFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith('tables/') && name.endsWith('.json')
  );
  for (const filePath of archiveTableFiles) {
    const tblName = filePath.replace(/^tables\//, '').replace(/\.json$/, '');
    if (!(ALL_BACKUP_TABLES as readonly string[]).includes(tblName)) {
      unexpectedTables.push(tblName);
    }
  }

  for (const tbl of ALL_BACKUP_TABLES) {
    const file = zip.file(`tables/${tbl}.json`);
    if (!file) {
      missingTables.push(tbl);
      continue;
    }

    let rawContent: string;
    try {
      rawContent = await file.async('string');
    } catch {
      checksumMismatches.push(`tables/${tbl}.json (تعذر فك الضغط)`);
      continue;
    }

    const expectedSha = manifest?.tableSha256s?.[tbl];
    const actualSha = sha256Hex(rawContent);
    if (!expectedSha || expectedSha !== actualSha) {
      checksumMismatches.push(`tables/${tbl}.json`);
    }

    let rows: unknown;
    try {
      rows = JSON.parse(rawContent);
    } catch {
      integrityErrors.push(`ملف الجدول tables/${tbl}.json ليس JSON صالحاً.`);
      continue;
    }

    if (!Array.isArray(rows)) {
      integrityErrors.push(`بيانات الجدول ${tbl} يجب أن تكون مصفوفة سجلات.`);
      continue;
    }

    const expectedCount = manifest?.recordCounts?.[tbl];
    if (typeof expectedCount === 'number' && expectedCount !== rows.length) {
      integrityErrors.push(
        `عدد السجلات الفعلي في ${tbl} (${rows.length}) لا يطابق المسجل في manifest (${expectedCount}).`
      );
    }

    parsedTables[tbl] = rows as Record<string, unknown>[];
  }

  // Verify attachments & SHA-256 checksums
  const manifestAttachments = Array.isArray(manifest?.attachments) ? manifest.attachments : [];
  for (const att of manifestAttachments) {
    const entry = zip.file(att.archivePath);
    if (!entry) {
      integrityErrors.push(`المرفق المرجعي ${att.archivePath} (${att.fileName}) مفقود داخل ZIP.`);
      continue;
    }
    try {
      const buf = await entry.async('nodebuffer');
      const actualHash = sha256Hex(buf);
      if (actualHash !== att.sha256) {
        checksumMismatches.push(att.archivePath);
      }
      if (buf.length !== att.fileSizeBytes) {
        checksumMismatches.push(`${att.archivePath} (تطابق الحجم)`);
      }
    } catch {
      checksumMismatches.push(att.archivePath);
    }
  }

  // Relational consistency checks on parsed rows
  if (parsedTables.team_members && parsedTables.sales_reps) {
    const memberIds = new Set(parsedTables.team_members.map((m) => String(m.id || '')));
    const ownerMembers = parsedTables.team_members.filter((m) => m.role === 'owner' && !m.is_suspended);
    if (ownerMembers.length === 0) {
      warnings.push('النسخة لا تحتوي على مستخدم بدور owner نشط — سيتم الحفاظ على حساب المالك الحالي تلقائياً أثناء الاستعادة الحية.');
    }
    const orphanReps = parsedTables.sales_reps.filter((r) => !memberIds.has(String(r.user_id || '')));
    if (orphanReps.length > 0) {
      warnings.push(`يوجد ${orphanReps.length} مندوب مبيعات بدون حساب فريق مطابق في team_members.`);
    }
  }

  if (parsedTables.orders && parsedTables.order_revisions) {
    const orderIds = new Set(parsedTables.orders.map((o) => String(o.id || '')));
    const orphanRevs = parsedTables.order_revisions.filter(
      (rev) => !orderIds.has(String(rev.order_id || ''))
    );
    if (orphanRevs.length > 0) {
      warnings.push(`يوجد ${orphanRevs.length} مراجعة تعديل فاتورة بدون فاتورة مطابقة في orders.`);
    }
  }

  if (parsedTables.price_list_imports) {
    const attPaths = new Set(manifestAttachments.map((a) => a.archivePath));
    for (const imp of parsedTables.price_list_imports) {
      const refPath = typeof imp.attachment_archive_path === 'string' ? imp.attachment_archive_path : '';
      if (refPath && !attPaths.has(refPath)) {
        warnings.push(`ملف PDF الخاص بدفعة الاستيراد ${String(imp.id)} غير مدرج في فهرس المرفقات.`);
      }
    }
  }

  if (manifest?.excludedSensitiveFields?.team_members?.includes('password_hash')) {
    warnings.push('تم استبعاد كلمات المرور المشفّرة ورمز الاسترداد ومفاتيح API لأسباب أمنية؛ يحتفظ حساب المالك والحسابات الحالية بكلمات مرورها عند الاستعادة الحية.');
  }

  // Live database comparison
  let tableComparison: BackupTableComparison[] = [];
  if (!options?.skipLiveDbDiff) {
    try {
      const liveCounts = await queryLiveTableCounts(createPool(), 'public');
      tableComparison = ALL_BACKUP_TABLES.map((tbl) => {
        const bCount = parsedTables[tbl]?.length ?? manifest?.recordCounts?.[tbl] ?? 0;
        const lCount = liveCounts[tbl] ?? 0;
        return {
          tableName: tbl,
          backupCount: bCount,
          liveCount: lCount,
          delta: bCount - lCount,
        };
      });
    } catch {
      tableComparison = [];
    }
  }

  let status: BackupVerificationStatus = 'valid';
  if (checksumMismatches.length > 0 || integrityErrors.length > 0) {
    status = incompatible ? 'incompatible' : 'corrupted';
  } else if (incompatible) {
    status = 'incompatible';
  } else if (missingTables.length > 0) {
    status = 'incomplete';
  } else if (warnings.length > 0 || unexpectedTables.length > 0) {
    status = 'valid_with_warnings';
  }

  if (options?.logInspection && options.actor) {
    await db
      .insert(auditLogs)
      .values({
        id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        actionType: 'owner_backup_inspected',
        actorId: options.actor.id,
        actorName: options.actor.name,
        actorRole: options.actor.role,
        details: {
          backupId: manifest?.backupId || null,
          status,
          zipSha256,
          zipSizeBytes: zipBuffer.length,
          missingTables,
          checksumMismatches,
        },
        createdAt: new Date().toISOString(),
      })
      .catch(() => {});
  }

  return {
    validZip: true,
    status,
    statusLabelAr: statusToLabelAr(status),
    manifest,
    zipSha256,
    zipSizeBytes: zipBuffer.length,
    checksumMismatches,
    missingTables,
    unexpectedTables,
    integrityErrors,
    warnings,
    tableComparison,
    willReplaceTables: ALL_BACKUP_TABLES.filter((t) => !missingTables.includes(t)),
    preservedProtections: [
      'إنشاء نسخة أمان احتياطية إجبارية قبل بدء أي استعادة حية',
      'الحفاظ على حساب المالك الرئيسي الحالي وصلاحياته وكلمة مروره ورمز الاسترداد',
      'تنفيذ الاستعادة داخل معاملة PostgreSQL واحدة قابلة للتراجع التلقائي (ROLLBACK) عند أي خطأ',
    ],
  };
}

async function extractParsedTablesAndAttachments(
  zipBuffer: Buffer
): Promise<Record<BackupTableName, Record<string, unknown>[]>> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const result = {} as Record<BackupTableName, Record<string, unknown>[]>;

  for (const tbl of ALL_BACKUP_TABLES) {
    const file = zip.file(`tables/${tbl}.json`);
    if (!file) {
      throw new OwnerControlError(`الجدول ${tbl} مفقود داخل النسخة الاحتياطية.`, 400);
    }
    const text = await file.async('string');
    const parsed = JSON.parse(text) as Record<string, unknown>[];

    if (tbl === 'price_list_imports') {
      const rehydrated: Record<string, unknown>[] = [];
      for (const row of parsed) {
        const archivePath =
          typeof row.attachment_archive_path === 'string' ? row.attachment_archive_path : '';
        let fileDataBase64 = typeof row.file_data_base64 === 'string' ? row.file_data_base64 : '';
        if (archivePath) {
          const attFile = zip.file(archivePath);
          if (!attFile) {
            throw new OwnerControlError(`مرفق PDF ${archivePath} مفقود داخل النسخة.`, 400);
          }
          const pdfBuf = await attFile.async('nodebuffer');
          fileDataBase64 = pdfBuf.toString('base64');
        }
        const cleanRow: Record<string, unknown> = { ...row, file_data_base64: fileDataBase64 };
        delete cleanRow.attachment_archive_path;
        rehydrated.push(cleanRow);
      }
      result[tbl] = rehydrated;
    } else {
      result[tbl] = parsed;
    }
  }
  return result;
}

async function insertRowsIntoTable(
  client: PoolClient,
  schemaName: string,
  tableName: BackupTableName,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const cols = TABLE_COLUMNS[tableName];
  const jsonbCols = new Set(TABLE_JSONB_COLUMNS[tableName]);
  const colListSql = cols.map((c) => `"${c}"`).join(', ');
  const placeholdersSql = cols
    .map((c, idx) => (jsonbCols.has(c) ? `$${idx + 1}::jsonb` : `$${idx + 1}`))
    .join(', ');
  const insertSql = `INSERT INTO "${schemaName}"."${tableName}" (${colListSql}) VALUES (${placeholdersSql})`;

  for (const row of rows) {
    const values = cols.map((c) => {
      const val = row[c];
      if (jsonbCols.has(c)) {
        if (val === undefined) return 'null';
        return JSON.stringify(val);
      }
      if (val === undefined) return null;
      return val;
    });
    await client.query(insertSql, values);
  }
}

async function verifyRestoredSchemaState(
  client: PoolClient,
  schemaName: string,
  expectedCounts: Record<string, number>,
  expectedPdfCount: number
): Promise<{
  tableVerification: RestoreExecutionReport['tableVerification'];
  relationalChecks: RestoreExecutionReport['relationalChecks'];
  ownerPreserved: boolean;
}> {
  const tableVerification: RestoreExecutionReport['tableVerification'] = [];
  for (const tbl of ALL_BACKUP_TABLES) {
    const r = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."${tbl}"`
    );
    const actualCount = parseInt(r.rows[0]?.cnt || '0', 10);
    const expectedCount = expectedCounts[tbl] ?? 0;
    tableVerification.push({
      tableName: tbl,
      expectedCount,
      actualCount,
      matched: actualCount === expectedCount,
    });
  }

  const ownerRes = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."team_members" WHERE role = 'owner' AND is_suspended = false`
  );
  const ownerPreserved = parseInt(ownerRes.rows[0]?.cnt || '0', 10) > 0;

  const pdfRes = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."price_list_imports" WHERE length(file_data_base64) > 0`
  );
  const restoredPdfCount = parseInt(pdfRes.rows[0]?.cnt || '0', 10);

  const orphanRevRes = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."order_revisions" r LEFT JOIN "${schemaName}"."orders" o ON o.id = r.order_id WHERE o.id IS NULL`
  );
  const orphanRevs = parseInt(orphanRevRes.rows[0]?.cnt || '0', 10);

  const commRes = await client.query<{ total_comm: string; cnt: string }>(
    `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(commission), 0)::text AS total_comm FROM "${schemaName}"."orders"`
  );

  const relationalChecks: RestoreExecutionReport['relationalChecks'] = [
    {
      checkName: 'حساب المالك الرئيسي نشط',
      passed: ownerPreserved,
      details: ownerPreserved ? 'يوجد حساب owner نشط داخل قاعدة البيانات المستعادة.' : 'لا يوجد حساب owner نشط.',
    },
    {
      checkName: 'استعادة مرفقات PDF الأصلية',
      passed: restoredPdfCount >= expectedPdfCount,
      details: `تمت استعادة ${restoredPdfCount} من أصل ${expectedPdfCount} ملف PDF ثنائي.`,
    },
    {
      checkName: 'ترابط تعديلات الفواتير (order_revisions -> orders)',
      passed: orphanRevs === 0,
      details: orphanRevs === 0 ? 'جميع المراجعات مرتبطة بفواتير صالحة.' : `توجد ${orphanRevs} مراجعة غير مرتبطة.`,
    },
    {
      checkName: 'توافق بيانات الفواتير والعمولات',
      passed: parseInt(commRes.rows[0]?.cnt || '0', 10) === (expectedCounts.orders ?? 0),
      details: `الفواتير: ${commRes.rows[0]?.cnt || '0'} · إجمالي العمولات المسجلة: ${Number(commRes.rows[0]?.total_comm || 0).toLocaleString()} ج.م`,
    },
  ];

  return { tableVerification, relationalChecks, ownerPreserved };
}

export async function cleanupSandboxSchema(schemaName: string): Promise<boolean> {
  if (!SANDBOX_SCHEMA_REGEX.test(schemaName)) {
    throw new OwnerControlError('لا يُسمح بحذف إلا مخططات الاختبار المعزولة فقط.', 400);
  }
  const adminPool = getAdminPool();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  return true;
}

/**
 * Safe Restore Engine supporting:
 * 1) `isolated_sandbox`: Real PostgreSQL schema restoration test (`restore_sandbox_*`) without touching `public`
 * 2) `live_replace`: Transactional `REPEATABLE READ` live restore with mandatory pre-restore safety backup & Owner preservation
 */
export async function executeBackupRestore(options: {
  zipBuffer: Buffer;
  mode: 'isolated_sandbox' | 'live_replace';
  actor: User;
  confirmationPhrase?: string;
  keepSandboxForTests?: boolean;
}): Promise<RestoreExecutionReport> {
  const { zipBuffer, mode, actor, confirmationPhrase, keepSandboxForTests } = options;

  return withOwnerSensitiveLock(
    mode === 'isolated_sandbox' ? 'اختبار استعادة معزول (Sandbox)' : 'استعادة نسخة احتياطية حية',
    async () => {
      const inspection = await inspectBackupZipBuffer(zipBuffer, { skipLiveDbDiff: mode === 'isolated_sandbox' });
      if (
        inspection.status === 'corrupted' ||
        inspection.status === 'incompatible' ||
        inspection.status === 'incomplete' ||
        !inspection.manifest
      ) {
        const reasonList = [
          ...inspection.integrityErrors,
          ...inspection.checksumMismatches.map((m) => `اختلاف بصمة SHA-256: ${m}`),
          ...inspection.missingTables.map((t) => `جدول مفقود: ${t}`),
        ];
        throw new OwnerControlError(
          `تم رفض الاستعادة لأن النسخة الاحتياطية مصنفة كـ "${inspection.statusLabelAr}": ${reasonList.join('؛ ')}`,
          400
        );
      }

      const parsedTables = await extractParsedTablesAndAttachments(zipBuffer);
      const manifest = inspection.manifest;

      if (mode === 'isolated_sandbox') {
        const sandboxSchema = `restore_sandbox_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
        const adminPool = getAdminPool();
        const client = await adminPool.connect();

        try {
          await client.query(`CREATE SCHEMA "${sandboxSchema}"`);
          for (const tbl of ALL_BACKUP_TABLES) {
            await client.query(
              `CREATE TABLE "${sandboxSchema}"."${tbl}" (LIKE "public"."${tbl}" INCLUDING DEFAULTS)`
            );
          }

          await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          // In sandbox, redacted password_hash becomes '' to satisfy NOT NULL cleanly
          parsedTables.team_members = parsedTables.team_members.map((m) => ({
            ...m,
            password_hash: typeof m.password_hash === 'string' ? m.password_hash : '',
          }));

          for (const tbl of ALL_BACKUP_TABLES) {
            await insertRowsIntoTable(client, sandboxSchema, tbl, parsedTables[tbl]);
          }

          const verification = await verifyRestoredSchemaState(
            client,
            sandboxSchema,
            manifest.recordCounts,
            manifest.attachmentsCount
          );

          await client.query('COMMIT');

          const allMatched = verification.tableVerification.every((t) => t.matched);
          if (!allMatched) {
            throw new OwnerControlError('فشل تطابق أعداد السجلات داخل بيئة الاستعادة المعزولة.', 500);
          }

          let cleanedUp = false;
          if (!keepSandboxForTests) {
            await cleanupSandboxSchema(sandboxSchema);
            cleanedUp = true;
          }

          const totalRestored = Object.values(manifest.recordCounts).reduce((s, n) => s + n, 0);
          await db.insert(auditLogs).values({
            id: `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            actionType: 'owner_restore_sandbox_tested',
            actorId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
            details: {
              backupId: manifest.backupId,
              sandboxSchema,
              sandboxCleanedUp: cleanedUp,
              restoredRecordsTotal: totalRestored,
            },
            createdAt: new Date().toISOString(),
          });

          return {
            mode: 'isolated_sandbox',
            preRestoreBackupId: null,
            sandboxSchemaName: sandboxSchema,
            sandboxCleanedUp: cleanedUp,
            restoredAt: new Date().toISOString(),
            restoredTablesCount: ALL_BACKUP_TABLES.length,
            restoredRecordsTotal: totalRestored,
            restoredAttachmentsCount: manifest.attachmentsCount,
            tableVerification: verification.tableVerification,
            relationalChecks: verification.relationalChecks,
            ownerPreserved: verification.ownerPreserved,
          };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          if (!keepSandboxForTests) {
            await cleanupSandboxSchema(sandboxSchema).catch(() => {});
          }
          throw err;
        } finally {
          client.release();
        }
      }

      // Live Replace Mode: requires exact confirmation phrase AND mandatory pre-restore safety backup
      if ((confirmationPhrase || '').trim() !== BACKUP_CONFIRM_RESTORE_PHRASE) {
        throw new OwnerControlError(
          `يجب إدخال عبارة التأكيد المطابقة: "${BACKUP_CONFIRM_RESTORE_PHRASE}".`,
          400
        );
      }

      const safety = await createFullSystemBackup(actor, {
        backupType: 'pre_restore_safety',
        skipLock: true,
        persistRecord: true,
      });

      const pool = createPool();
      const client = await pool.connect();

      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');

        // Capture live authentication credentials & Owner recovery key hash BEFORE replacing
        const liveMembersRes = await client.query<{ id: string; username: string; password_hash: string }>(
          'SELECT id, username, password_hash FROM "public"."team_members"'
        );
        const hashById = new Map(liveMembersRes.rows.map((r) => [r.id, r.password_hash]));
        const hashByUsername = new Map(liveMembersRes.rows.map((r) => [r.username.toLowerCase(), r.password_hash]));

        const actorLiveRow = await client.query<Record<string, unknown>>(
          'SELECT * FROM "public"."team_members" WHERE id = $1 LIMIT 1',
          [actor.id]
        );
        const recoveryRes = await client.query<Record<string, unknown>>(
          `SELECT * FROM "public"."system_settings" WHERE key = 'owner_recovery_hash' LIMIT 1`
        );

        // Rehydrate team_members safely without losing Owner login or local hashes
        const preparedMembers: Record<string, unknown>[] = parsedTables.team_members.map((m) => {
          const mid = String(m.id || '');
          const mUser = String(m.username || '').toLowerCase();
          const existingHash = hashById.get(mid) || hashByUsername.get(mUser) || '';
          const isActingActor = mid === actor.id;
          return {
            ...m,
            password_hash: existingHash,
            role: isActingActor ? 'owner' : m.role,
            is_suspended: isActingActor ? false : Boolean(m.is_suspended),
          };
        });

        if (actorLiveRow.rows[0] && !preparedMembers.some((m) => String(m.id) === actor.id)) {
          preparedMembers.push({
            ...actorLiveRow.rows[0],
            role: 'owner',
            is_suspended: false,
          });
        }
        parsedTables.team_members = preparedMembers;

        if (recoveryRes.rows[0]) {
          const filteredSettings = parsedTables.system_settings.filter(
            (s) => s.key !== 'owner_recovery_hash'
          );
          filteredSettings.push(recoveryRes.rows[0]);
          parsedTables.system_settings = filteredSettings;
        }

        // Delete existing rows in reverse order, insert restored rows in forward order
        const reverseTables = [...ALL_BACKUP_TABLES].reverse();
        for (const tbl of reverseTables) {
          await client.query(`DELETE FROM "public"."${tbl}"`);
        }

        for (const tbl of ALL_BACKUP_TABLES) {
          await insertRowsIntoTable(client, 'public', tbl, parsedTables[tbl]);
        }

        await client.query(
          `SELECT setval(pg_get_serial_sequence('public.users', 'id'), COALESCE((SELECT MAX(id) FROM "public"."users"), 1), true)`
        );

        const expectedLiveCounts: Record<string, number> = {
          ...manifest.recordCounts,
          team_members: parsedTables.team_members.length,
          system_settings: parsedTables.system_settings.length,
        };

        const verification = await verifyRestoredSchemaState(
          client,
          'public',
          expectedLiveCounts,
          manifest.attachmentsCount
        );

        if (!verification.ownerPreserved) {
          throw new OwnerControlError('تم إلغاء الاستعادة لأن حساب المالك الرئيسي لم يكن صالحاً بعد التحقق.', 500);
        }

        await client.query(
          `INSERT INTO "public"."audit_logs" (id, action_type, actor_id, actor_name, actor_role, details, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            'owner_restore_live_completed',
            actor.id,
            actor.name,
            actor.role,
            JSON.stringify({
              backupId: manifest.backupId,
              preRestoreBackupId: safety.record.id,
              restoredRecordsTotal: Object.values(expectedLiveCounts).reduce((s, n) => s + n, 0),
              attachmentsCount: manifest.attachmentsCount,
            }),
            new Date().toISOString(),
          ]
        );

        await client.query('COMMIT');

        return {
          mode: 'live_replace',
          preRestoreBackupId: safety.record.id,
          sandboxSchemaName: null,
          sandboxCleanedUp: false,
          restoredAt: new Date().toISOString(),
          restoredTablesCount: ALL_BACKUP_TABLES.length,
          restoredRecordsTotal: Object.values(expectedLiveCounts).reduce((s, n) => s + n, 0),
          restoredAttachmentsCount: manifest.attachmentsCount,
          tableVerification: verification.tableVerification,
          relationalChecks: verification.relationalChecks,
          ownerPreserved: verification.ownerPreserved,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  );
}

const SEED_DEMO_PROD_IDS = new Set(['1', '2', '3', '4']);
const SEED_DEMO_PROD_NAMES = new Set([
  'زيت لافندر فرنسي',
  'زيت عود ملكي',
  'زيت ياسمين طبيعي',
]);

function getDemoProductReason(p: {
  id: string;
  code: string;
  name: string;
}): string | null {
  const cleanName = (p.name || '').trim();
  const cleanCode = (p.code || '').trim();
  if (SEED_DEMO_PROD_IDS.has(p.id) && SEED_DEMO_PROD_NAMES.has(cleanName)) {
    return 'صنف افتراضي من بيانات التأسيس التجريبية';
  }
  if (
    /\b(test|demo|dummy)\b/i.test(cleanName) ||
    /(تيست|تجريبي|تجربة|اختباري|وهمي)/.test(cleanName) ||
    /\b(test|demo|dummy)\b/i.test(cleanCode)
  ) {
    return 'صنف يحمل وسم اختباري / تجريبي';
  }
  return null;
}

function isDemoCustomerCandidate(c: { id: string; name: string; phone: string }): boolean {
  const cleanName = (c.name || '').trim();
  if (c.id === 'c1' && (cleanName === 'شركة النور للعطور' || c.phone === '0123456789')) {
    return true;
  }
  if (
    /\b(test|demo|dummy)\b/i.test(cleanName) ||
    /(تيست|تجريبي|تجربة|اختباري|وهمي)/.test(cleanName)
  ) {
    return true;
  }
  return false;
}

async function upsertInitialSeedCompletedSettingTx(
  client: PoolClient,
  schemaName: string,
  nowIso: string
) {
  const upd = await client.query(
    `UPDATE "${schemaName}"."system_settings" SET updated_at = $1 WHERE key = 'initial_seed_completed'`,
    [nowIso]
  );
  if ((upd.rowCount ?? 0) === 0) {
    await client.query(
      `INSERT INTO "${schemaName}"."system_settings" (key, value, updated_at)
       VALUES ('initial_seed_completed', $1::jsonb, $2)`,
      [JSON.stringify({ completed: true, updatedAt: nowIso }), nowIso]
    );
  }
}

async function analyzeCustomersForReset(client: PoolClient, schemaName: string) {
  const [custRes, ordRes] = await Promise.all([
    client.query<{ id: string; name: string; phone: string }>(
      `SELECT id, name, phone FROM "${schemaName}"."customers" ORDER BY id`
    ),
    client.query<{ customer_name: string; customer_phone: string }>(
      `SELECT customer_name, customer_phone FROM "${schemaName}"."orders"`
    ),
  ]);

  const linkedNames = new Set<string>();
  const linkedPhones = new Set<string>();
  for (const o of ordRes.rows) {
    const n = (o.customer_name || '').trim().toLowerCase();
    const p = (o.customer_phone || '').trim();
    if (n) linkedNames.add(n);
    if (p) linkedPhones.add(p);
  }

  const linkedIds: string[] = [];
  const unlinkedRows: Array<{ id: string; name: string; phone: string; isDemo: boolean }> = [];
  let demoCount = 0;

  for (const c of custRes.rows) {
    const isDemo = isDemoCustomerCandidate(c);
    if (isDemo) demoCount++;
    const n = (c.name || '').trim().toLowerCase();
    const p = (c.phone || '').trim();
    const isLinked = (n && linkedNames.has(n)) || (p && linkedPhones.has(p));
    if (isLinked) {
      linkedIds.push(c.id);
    } else {
      unlinkedRows.push({
        id: c.id,
        name: c.name,
        phone: c.phone,
        isDemo,
      });
    }
  }

  return {
    totalCount: custRes.rows.length,
    ordersCount: ordRes.rows.length,
    linkedIds,
    unlinkedRows,
    demoCount,
  };
}

async function analyzeDemoProductsForReset(client: PoolClient, schemaName: string) {
  const [prodRes, ordRes, movRes] = await Promise.all([
    client.query<{
      id: string;
      code: string;
      name: string;
      category_name: string;
      grade: string;
      stock: number;
    }>(
      `SELECT id, code, name, category_name, grade, stock FROM "${schemaName}"."products" ORDER BY id`
    ),
    client.query<{
      id: string;
      items: Array<{ productId?: string; productName?: string; grade?: string }>;
    }>(`SELECT id, items FROM "${schemaName}"."orders"`),
    client.query<{ product_id: string | null }>(
      `SELECT product_id FROM "${schemaName}"."stock_movements" WHERE product_id IS NOT NULL`
    ),
  ]);

  const movementCountByProd = new Map<string, number>();
  for (const mv of movRes.rows) {
    if (!mv.product_id) continue;
    movementCountByProd.set(mv.product_id, (movementCountByProd.get(mv.product_id) || 0) + 1);
  }

  const eligibleToDelete: Array<{
    id: string;
    code: string;
    name: string;
    categoryName: string;
    stock: number;
    reason: string;
  }> = [];

  const blockedLinked: Array<{
    id: string;
    code: string;
    name: string;
    categoryName: string;
    ordersCount: number;
    stockMovementsCount: number;
  }> = [];

  for (const p of prodRes.rows) {
    const demoReason = getDemoProductReason(p);
    if (!demoReason) continue;

    const cleanName = (p.name || '').trim().toLowerCase();
    const cleanGrade = (p.grade || '').trim();
    let linkedOrdersCount = 0;
    for (const ord of ordRes.rows) {
      const items = Array.isArray(ord.items) ? ord.items : [];
      const hit = items.some((it) => {
        if (it.productId) return it.productId === p.id;
        const itName = (it.productName || '').trim().toLowerCase();
        if (!itName || itName !== cleanName) return false;
        const itGrade = (it.grade || '').trim();
        return !cleanGrade || !itGrade || itGrade === cleanGrade;
      });
      if (hit) linkedOrdersCount++;
    }

    const movCount = movementCountByProd.get(p.id) || 0;
    if (linkedOrdersCount > 0 || movCount > 0) {
      blockedLinked.push({
        id: p.id,
        code: p.code,
        name: p.name,
        categoryName: p.category_name,
        ordersCount: linkedOrdersCount,
        stockMovementsCount: movCount,
      });
    } else {
      eligibleToDelete.push({
        id: p.id,
        code: p.code,
        name: p.name,
        categoryName: p.category_name,
        stock: p.stock,
        reason: demoReason,
      });
    }
  }

  return {
    totalProducts: prodRes.rows.length,
    eligibleToDelete,
    blockedLinked,
  };
}

export async function previewSystemReset(
  scope: SystemResetScope,
  options?: { targetSchema?: string }
): Promise<SystemResetPreview> {
  const schemaName = assertValidTargetSchema(options?.targetSchema || 'public');
  const pool = schemaName === 'public' ? createPool() : getAdminPool();
  const client = await pool.connect();

  try {
    const ordCntRes = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."orders"`
    );
    const ordersCount = parseInt(ordCntRes.rows[0]?.cnt || '0', 10);
    const warnings: string[] = [];

    if (scope.mode === 'reset_customers') {
      const info = await analyzeCustomersForReset(client, schemaName);
      if (info.linkedIds.length > 0 && scope.customerAction === 'delete_all') {
        warnings.push(
          `يوجد ${info.linkedIds.length} عميل مرتبط بـ ${ordersCount} فاتورة — ممنوع الحذف النهائي للكل، يمكنك اختيار "حذف العملاء غير المرتبطين والتجريبيين فقط".`
        );
      }
      return {
        mode: scope.mode,
        ordersCount,
        customersSummary: {
          totalCount: info.totalCount,
          linkedCount: info.linkedIds.length,
          unlinkedCount: info.unlinkedRows.length,
          demoCount: info.demoCount,
          unlinkedSample: info.unlinkedRows.slice(0, 25),
        },
        warnings,
      };
    }

    if (scope.mode === 'reset_stock') {
      const stockRes = await client.query<{
        total_products: string;
        non_zero_count: string;
        total_units: string;
      }>(
        `SELECT COUNT(*)::text AS total_products,
                COUNT(*) FILTER (WHERE stock <> 0)::text AS non_zero_count,
                COALESCE(SUM(ABS(stock)) FILTER (WHERE stock <> 0), 0)::text AS total_units
         FROM "${schemaName}"."products"`
      );
      return {
        mode: scope.mode,
        ordersCount,
        stockSummary: {
          totalProducts: parseInt(stockRes.rows[0]?.total_products || '0', 10),
          nonZeroProductsCount: parseInt(stockRes.rows[0]?.non_zero_count || '0', 10),
          totalUnitsToZero: parseFloat(stockRes.rows[0]?.total_units || '0'),
        },
        warnings,
      };
    }

    if (scope.mode === 'reset_demo_products') {
      const demo = await analyzeDemoProductsForReset(client, schemaName);
      if (demo.blockedLinked.length > 0) {
        warnings.push(
          `تم استثناء ${demo.blockedLinked.length} منتج تجريبي من الحذف لارتباطه بفواتير أو حركات مخزون حالية (يمكنك أرشفته بدلاً من الحذف).`
        );
      }
      return {
        mode: scope.mode,
        ordersCount,
        demoProductsSummary: demo,
        warnings,
      };
    }

    if (scope.mode === 'reset_extras') {
      const [chatCnt, pdfCnt, commCnt, audCnt] = await Promise.all([
        client.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."chat_messages"`),
        client.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."price_list_imports"`),
        client.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."commission_setting_logs"`),
        client.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM "${schemaName}"."audit_logs" WHERE action_type NOT IN ('owner_role_claimed','owner_recovery_key_updated','owner_backup_created','owner_restore_live_completed','owner_system_reset')`
        ),
      ]);
      return {
        mode: scope.mode,
        ordersCount,
        extrasSummary: {
          chatMessagesCount: parseInt(chatCnt.rows[0]?.cnt || '0', 10),
          priceListImportsCount: parseInt(pdfCnt.rows[0]?.cnt || '0', 10),
          commissionLogsCount: parseInt(commCnt.rows[0]?.cnt || '0', 10),
          operationalAuditLogsCount: parseInt(audCnt.rows[0]?.cnt || '0', 10),
        },
        warnings,
      };
    }

    return {
      mode: scope.mode,
      ordersCount,
      warnings,
    };
  } finally {
    client.release();
  }
}

/**
 * Granular System Reset Engine (Strictly separated from Restore!).
 * Supports executing on `public` OR on an isolated `restore_sandbox_*` schema for safe E2E testing.
 */
export async function executeSystemReset(
  scope: SystemResetScope,
  actor: User,
  options?: { targetSchema?: string; skipLock?: boolean }
): Promise<SystemResetResult> {
  const run = async (): Promise<SystemResetResult> => {
    const schemaName = assertValidTargetSchema(options?.targetSchema || 'public');
    const isProductionSchema = schemaName === 'public';
    const pool = isProductionSchema ? createPool() : getAdminPool();
    const nowIso = new Date().toISOString();

    if (scope.mode === 'reset_stock' && !(scope.reason || '').trim()) {
      throw new OwnerControlError('يجب كتابة سبب واضح عند تصفير أرصدة المخزون.', 400);
    }

    if (scope.mode === 'reset_full') {
      if ((scope.confirmationPhrase || '').trim() !== RESET_FULL_CONFIRM_PHRASE) {
        throw new OwnerControlError(
          `يتطلب التصفير الكامل كتابة عبارة التأكيد المطابقة: "${RESET_FULL_CONFIRM_PHRASE}".`,
          400
        );
      }

      if (isProductionSchema) {
        if (!scope.verifiedBackupId) {
          throw new OwnerControlError(
            'ممنوع تنفيذ التصفير الكامل بدون نسخة احتياطية حديثة ناجحة ومتحقق منها أولاً.',
            400
          );
        }
        const bkpRows = await db
          .select({
            id: backupRecords.id,
            status: backupRecords.status,
            verificationStatus: backupRecords.verificationStatus,
          })
          .from(backupRecords)
          .where(eq(backupRecords.id, scope.verifiedBackupId))
          .limit(1);
        if (
          bkpRows.length === 0 ||
          bkpRows[0].status !== 'completed' ||
          bkpRows[0].verificationStatus === 'failed'
        ) {
          throw new OwnerControlError(
            'النسخة الاحتياطية المحددة غير صالحة أو لم يتم التحقق من سلامتها.',
            400
          );
        }
      }
    }

    let preResetBackupId: string | null = scope.verifiedBackupId || null;
    if (
      isProductionSchema &&
      (scope.mode === 'reset_sales' ||
        scope.mode === 'reset_stock' ||
        scope.mode === 'reset_demo_products' ||
        scope.mode === 'reset_customers')
    ) {
      const safety = await createFullSystemBackup(actor, {
        backupType: 'pre_reset_safety',
        skipLock: true,
        persistRecord: true,
      });
      preResetBackupId = safety.record.id;
    }

    const client = await pool.connect();
    const affectedCounts: Record<string, number> = {};
    const preservedSummary: string[] = [];
    const warnings: string[] = [];
    const extraAuditDetails: Record<string, unknown> = {};

    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');

      if (scope.mode === 'reset_sales') {
        const revDel = await client.query(`DELETE FROM "${schemaName}"."order_revisions"`);
        const movDel = await client.query(
          `DELETE FROM "${schemaName}"."stock_movements" WHERE order_id IS NOT NULL OR movement_type IN ('order_deduction','order_delta_deduction','order_delta_restore','order_allocation','external_direct')`
        );
        const ordDel = await client.query(`DELETE FROM "${schemaName}"."orders"`);
        const repUpd = await client.query(
          `UPDATE "${schemaName}"."sales_reps" SET total_commission = 0, pending_commission = 0, orders_count = 0, monthly_history = '[]'::jsonb`
        );
        const custUpd = await client.query(
          `UPDATE "${schemaName}"."customers" SET total_spent = 0, classification = 'عادي', last_order_date = '', return_history = '[]'::jsonb`
        );

        affectedCounts.ordersDeleted = ordDel.rowCount ?? 0;
        affectedCounts.revisionsDeleted = revDel.rowCount ?? 0;
        affectedCounts.orderStockMovementsDeleted = movDel.rowCount ?? 0;
        affectedCounts.salesRepsReset = repUpd.rowCount ?? 0;
        affectedCounts.customersTotalsReset = custUpd.rowCount ?? 0;
        preservedSummary.push(
          'تم الحفاظ على حساب المالك الرئيسي والمستخدمين وصلاحياتهم',
          'تم الحفاظ على كتالوج المنتجات وأرصدة المخزون الحالية والتصنيفات',
          'تم الحفاظ على نسب عمولات المناديب والإعدادات العامة للنظام'
        );
      } else if (scope.mode === 'reset_stock') {
        const nonZeroProds = await client.query<{
          id: string;
          name: string;
          grade: string;
          stock: number;
        }>(`SELECT id, name, grade, stock FROM "${schemaName}"."products" WHERE stock <> 0`);

        let totalClearedUnits = 0;
        for (const p of nonZeroProds.rows) {
          totalClearedUnits += Math.abs(p.stock);
          await client.query(
            `UPDATE "${schemaName}"."products" SET stock = 0, updated_at = $1 WHERE id = $2`,
            [nowIso, p.id]
          );
          await client.query(
            `INSERT INTO "${schemaName}"."stock_movements" (id, product_id, product_name, grade, order_id, movement_type, sourcing_source, quantity_delta, order_quantity_covered, previous_stock, new_stock, supplier_name, note, actor_id, actor_name, actor_role, created_at)
             VALUES ($1, $2, $3, $4, NULL, 'manual_adjustment', 'من المخزون الحالي', $5, 0, $6, 0, NULL, $7, $8, $9, $10, $11)`,
            [
              `mov-rst-${Date.now()}-${Math.floor(Math.random() * 100000)}-${p.id}`,
              p.id,
              p.name,
              p.grade || '',
              -p.stock,
              p.stock,
              `تصفير رصيد المخزون: ${scope.reason!.trim()}`,
              actor.id,
              actor.name,
              actor.role,
              nowIso,
            ]
          );
        }

        affectedCounts.productsStockZeroed = nonZeroProds.rows.length;
        affectedCounts.totalUnitsCleared = totalClearedUnits;
        preservedSummary.push(
          'تم الحفاظ على جميع أصناف الكتالوج وأكوادها وأسعارها وتصنيفاتها',
          'تم تسجيل حركة تسوية في stock_movements لكل صنف تأثر بالتصفير',
          'لم يتم المساس بالفواتير أو العمولات أو حسابات الفريق'
        );
      } else if (scope.mode === 'reset_customers') {
        const custAnalysis = await analyzeCustomersForReset(client, schemaName);
        const action = scope.customerAction || 'reset_balances';

        if (action === 'delete_all' && custAnalysis.ordersCount > 0) {
          throw new OwnerControlError(
            `يوجد حالياً ${custAnalysis.ordersCount} فاتورة مسجلة مرتبطة بالعملاء — لا يمكن حذف جميع العملاء مع بقاء الفواتير. يمكنك اختيار "حذف العملاء غير المرتبطين والتجريبيين فقط" أو تصفير الفواتير أولاً.`,
            409
          );
        }

        if (action === 'delete_all') {
          const delRes = await client.query(`DELETE FROM "${schemaName}"."customers"`);
          await upsertInitialSeedCompletedSettingTx(client, schemaName, nowIso);
          affectedCounts.customersDeleted = delRes.rowCount ?? 0;
          extraAuditDetails.customerAction = 'delete_all';
        } else if (action === 'delete_unlinked_and_demo') {
          const idsToDelete = custAnalysis.unlinkedRows.map((c) => c.id);
          let deletedCount = 0;
          if (idsToDelete.length > 0) {
            const delRes = await client.query(
              `DELETE FROM "${schemaName}"."customers" WHERE id = ANY($1::text[])`,
              [idsToDelete]
            );
            deletedCount = delRes.rowCount ?? 0;
          }
          await upsertInitialSeedCompletedSettingTx(client, schemaName, nowIso);
          affectedCounts.unlinkedCustomersDeleted = deletedCount;
          affectedCounts.preservedLinkedCustomers = custAnalysis.linkedIds.length;
          extraAuditDetails.customerAction = 'delete_unlinked_and_demo';
          extraAuditDetails.deletedCustomerNames = custAnalysis.unlinkedRows.map((c) => c.name);
          if (custAnalysis.linkedIds.length > 0) {
            warnings.push(
              `تم الحفاظ التام على ${custAnalysis.linkedIds.length} عميل مرتبط بفواتير تاريخية دون إفساد أي سجل.`
            );
          }
          preservedSummary.push(
            'تم حذف العملاء غير المرتبطين بفواتير والعملاء التجريبيين فقط',
            'لن تُعاد إضافة العملاء التجريبيين تلقائياً مستقبلاً'
          );
        } else {
          const updRes = await client.query(
            `UPDATE "${schemaName}"."customers" SET total_spent = 0, classification = 'عادي', last_order_date = '', return_history = '[]'::jsonb`
          );
          affectedCounts.customersBalancesReset = updRes.rowCount ?? 0;
          extraAuditDetails.customerAction = 'reset_balances';
          if (custAnalysis.ordersCount > 0) {
            warnings.push(
              `تم تصفير أرصدة وتصنيفات العملاء مع الإبقاء على بياناتهم الأساسية نظراً لوجود ${custAnalysis.ordersCount} فاتورة.`
            );
          }
        }
        preservedSummary.push('تم الحفاظ على حساب المالك والمستخدمين والكتالوج والفواتير والإعدادات');
      } else if (scope.mode === 'reset_demo_products') {
        const demoAnalysis = await analyzeDemoProductsForReset(client, schemaName);
        const eligibleMap = new Map(demoAnalysis.eligibleToDelete.map((p) => [p.id, p]));

        let targetIds: string[];
        if (Array.isArray(scope.selectedDemoProductIds)) {
          if (scope.selectedDemoProductIds.length === 0) {
            throw new OwnerControlError('يرجى تحديد صنف تجريبي واحد على الأقل للحذف.', 400);
          }
          const nonDemoOrUnknown = scope.selectedDemoProductIds.filter(
            (id) =>
              !eligibleMap.has(id) && !demoAnalysis.blockedLinked.some((b) => b.id === id)
          );
          if (nonDemoOrUnknown.length > 0) {
            throw new OwnerControlError(
              'ممنوع حذف المنتجات الحقيقية عبر أداة إزالة المنتجات التجريبية.',
              403
            );
          }
          targetIds = scope.selectedDemoProductIds.filter((id) => eligibleMap.has(id));
        } else {
          targetIds = demoAnalysis.eligibleToDelete.map((p) => p.id);
        }

        let deletedCount = 0;
        const deletedDetails: Array<{ id: string; code: string; name: string }> = [];
        if (targetIds.length > 0) {
          const delRes = await client.query(
            `DELETE FROM "${schemaName}"."products" WHERE id = ANY($1::text[])`,
            [targetIds]
          );
          deletedCount = delRes.rowCount ?? 0;
          for (const id of targetIds) {
            const p = eligibleMap.get(id);
            if (p) deletedDetails.push({ id: p.id, code: p.code, name: p.name });
          }
        }

        await upsertInitialSeedCompletedSettingTx(client, schemaName, nowIso);

        affectedCounts.demoProductsDeleted = deletedCount;
        affectedCounts.skippedLinkedDemoProducts = demoAnalysis.blockedLinked.length;
        affectedCounts.realProductsPreserved =
          demoAnalysis.totalProducts - deletedCount - demoAnalysis.blockedLinked.length;
        extraAuditDetails.deletedDemoProducts = deletedDetails;
        extraAuditDetails.skippedLinkedDemoProducts = demoAnalysis.blockedLinked.map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          ordersCount: b.ordersCount,
          stockMovementsCount: b.stockMovementsCount,
        }));

        if (demoAnalysis.blockedLinked.length > 0) {
          warnings.push(
            `تم الإبقاء على ${demoAnalysis.blockedLinked.length} صنف تجريبي مرتبط بفواتير أو حركات مخزون (${demoAnalysis.blockedLinked.map((b) => b.name).join('، ')}) حفاظاً على البيانات التاريخية؛ ويمكنك أرشفته من المخزون.`
          );
        }
        preservedSummary.push(
          'تم الحفاظ التام على جميع المنتجات الحقيقية وأرصدة المخزون الخاصة بها',
          'تم منع إعادة زرع الأصناف التجريبية تلقائياً عند إعادة التشغيل'
        );
      } else if (scope.mode === 'reset_extras') {
        if (!scope.clearChatMessages && !scope.clearPriceListImports && !scope.clearOperationalLogs) {
          throw new OwnerControlError('يرجى تحديد خيار واحد على الأقل للتنظيف.', 400);
        }
        if (scope.clearChatMessages) {
          const chatDel = await client.query(`DELETE FROM "${schemaName}"."chat_messages"`);
          affectedCounts.chatMessagesDeleted = chatDel.rowCount ?? 0;
        }
        if (scope.clearPriceListImports) {
          const pdfDel = await client.query(`DELETE FROM "${schemaName}"."price_list_imports"`);
          affectedCounts.priceListImportsDeleted = pdfDel.rowCount ?? 0;
        }
        if (scope.clearOperationalLogs) {
          const commLogDel = await client.query(`DELETE FROM "${schemaName}"."commission_setting_logs"`);
          const audDel = await client.query(
            `DELETE FROM "${schemaName}"."audit_logs" WHERE action_type NOT IN ('owner_role_claimed','owner_recovery_key_updated','owner_backup_created','owner_restore_live_completed','owner_system_reset')`
          );
          affectedCounts.commissionLogsDeleted = commLogDel.rowCount ?? 0;
          affectedCounts.operationalAuditLogsDeleted = audDel.rowCount ?? 0;
        }
        preservedSummary.push('تم الحفاظ على الفواتير والمخزون والعملاء والمستخدمين');
      } else if (scope.mode === 'reset_full') {
        const revDel = await client.query(`DELETE FROM "${schemaName}"."order_revisions"`);
        const movDel = await client.query(`DELETE FROM "${schemaName}"."stock_movements"`);
        const ordDel = await client.query(`DELETE FROM "${schemaName}"."orders"`);
        const custDel = await client.query(`DELETE FROM "${schemaName}"."customers"`);
        const chatDel = await client.query(`DELETE FROM "${schemaName}"."chat_messages"`);
        const pdfDel = await client.query(`DELETE FROM "${schemaName}"."price_list_imports"`);
        const commLogDel = await client.query(`DELETE FROM "${schemaName}"."commission_setting_logs"`);
        const prodUpd = await client.query(
          `UPDATE "${schemaName}"."products" SET stock = 0, updated_at = $1 WHERE stock <> 0`,
          [nowIso]
        );
        const repUpd = await client.query(
          `UPDATE "${schemaName}"."sales_reps" SET total_commission = 0, pending_commission = 0, orders_count = 0, monthly_history = '[]'::jsonb`
        );
        await upsertInitialSeedCompletedSettingTx(client, schemaName, nowIso);

        affectedCounts.ordersDeleted = ordDel.rowCount ?? 0;
        affectedCounts.revisionsDeleted = revDel.rowCount ?? 0;
        affectedCounts.stockMovementsDeleted = movDel.rowCount ?? 0;
        affectedCounts.customersDeleted = custDel.rowCount ?? 0;
        affectedCounts.chatMessagesDeleted = chatDel.rowCount ?? 0;
        affectedCounts.priceListImportsDeleted = pdfDel.rowCount ?? 0;
        affectedCounts.commissionLogsDeleted = commLogDel.rowCount ?? 0;
        affectedCounts.productsStockZeroed = prodUpd.rowCount ?? 0;
        affectedCounts.salesRepsReset = repUpd.rowCount ?? 0;

        preservedSummary.push(
          'تم الحفاظ الكامل على حساب المالك الرئيسي وصلاحياته وكلمة مروره ورمز الاسترداد',
          'تم الحفاظ على هيكل قاعدة البيانات والتصنيفات وإعدادات النظام وكتالوج الأصناف (برصيد مخزون 0)'
        );
      }

      await client.query(
        `INSERT INTO "${schemaName}"."audit_logs" (id, action_type, actor_id, actor_name, actor_role, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          `aud-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          'owner_system_reset',
          actor.id,
          actor.name,
          actor.role,
          JSON.stringify({
            mode: scope.mode,
            reason: scope.reason || null,
            preResetBackupId,
            affectedCounts,
            ...extraAuditDetails,
          }),
          nowIso,
        ]
      );

      await client.query('COMMIT');

      return {
        executedAt: nowIso,
        mode: scope.mode,
        preResetBackupId,
        affectedCounts,
        preservedSummary,
        warnings,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  if (options?.skipLock) {
    return run();
  }
  return withOwnerSensitiveLock(`تصفير النظام (${scope.mode})`, run);
}
