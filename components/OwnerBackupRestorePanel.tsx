import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileCheck2,
  FileWarning,
  HardDriveDownload,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  BackupInspectionReport,
  BackupRecord,
  RestoreExecutionReport,
} from '../types';
import { apiClient, ApiRequestError } from '../src/lib/api';

const CONFIRM_LIVE_RESTORE_PHRASE = 'استعادة النسخة واستبدال البيانات الحالية';

interface OwnerBackupRestorePanelProps {
  backups: BackupRecord[];
  stepUpActive: boolean;
  onRequireStepUp: () => void;
  onRefreshAll: () => Promise<void>;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const OwnerBackupRestorePanel: React.FC<OwnerBackupRestorePanelProps> = ({
  backups,
  stepUpActive,
  onRequireStepUp,
  onRefreshAll,
  onError,
  onSuccess,
}) => {
  const [backupName, setBackupName] = useState('');
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Inspection & Restore states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionReport, setInspectionReport] = useState<BackupInspectionReport | null>(null);

  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [restoringMode, setRestoringMode] = useState<'isolated_sandbox' | 'live_replace' | null>(null);
  const [restoreReport, setRestoreReport] = useState<RestoreExecutionReport | null>(null);

  const handleApiErr = (err: unknown, fallback: string) => {
    if (err instanceof ApiRequestError && err.requiresOwnerReauth) {
      onRequireStepUp();
    }
    onError(err instanceof Error ? err.message : fallback);
  };

  const handleCreateFullZipBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingBackup) return;
    setCreatingBackup(true);
    onError(null);
    onSuccess(null);
    try {
      const res = await apiClient.createOwnerBackup(backupName.trim() || undefined);
      setBackupName('');
      // Immediately trigger browser ZIP download
      try {
        await apiClient.downloadOwnerBackupZip(res.record.id, res.fileName);
      } catch {
        // Still keep record created cleanly
      }
      onSuccess(
        `تم إنشاء نسخة احتياطية كاملة وتوثيق بصمتها SHA-256 (${res.record.totalRecords} سجل و${res.record.attachmentsCount} مرفق PDF) ✅`
      );
      await onRefreshAll();
    } catch (err) {
      handleApiErr(err, 'تعذر إنشاء النسخة الاحتياطية الكاملة.');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDownloadZip = async (bkp: BackupRecord) => {
    if (downloadingId) return;
    setDownloadingId(bkp.id);
    onError(null);
    try {
      const fileName = `KimaScent-Backup-${bkp.createdAt.slice(0, 10)}-${bkp.id.slice(-6)}.zip`;
      await apiClient.downloadOwnerBackupZip(bkp.id, fileName);
      onSuccess(`تم تنزيل حزمة ZIP للنسخة "${bkp.name}" ✅`);
    } catch (err) {
      handleApiErr(err, 'تعذر تنزيل النسخة الاحتياطية.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleVerifyStoredBackup = async (bkp: BackupRecord) => {
    if (verifyingId) return;
    setVerifyingId(bkp.id);
    onError(null);
    onSuccess(null);
    try {
      const report = await apiClient.verifyStoredOwnerBackup(bkp.id);
      setSelectedBackupId(bkp.id);
      setSelectedFile(null);
      setInspectionReport(report);
      setRestoreReport(null);
      onSuccess(`تم فحص النسخة "${bkp.name}": ${report.statusLabelAr}`);
      await onRefreshAll();
    } catch (err) {
      handleApiErr(err, 'تعذر فحص النسخة الاحتياطية.');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    if (deletingId) return;
    setDeletingId(backupId);
    onError(null);
    onSuccess(null);
    try {
      await apiClient.deleteOwnerBackup(backupId);
      setConfirmDeleteId(null);
      if (selectedBackupId === backupId) {
        setSelectedBackupId(null);
        setInspectionReport(null);
      }
      onSuccess('تم حذف سجل النسخة الاحتياطية من الخادم فقط دون المساس ببيانات النظام أو الملفات المحفوظة على جهازك ✅');
      await onRefreshAll();
    } catch (err) {
      handleApiErr(err, 'تعذر حذف سجل النسخة الاحتياطية.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleInspectUploadedFile = async (file: File) => {
    if (inspecting) return;
    setInspecting(true);
    setSelectedFile(file);
    setSelectedBackupId(null);
    setRestoreReport(null);
    onError(null);
    onSuccess(null);
    try {
      const report = await apiClient.inspectBackupZipFile(file);
      setInspectionReport(report);
      onSuccess(`نتيجة فحص الملف (${file.name}): ${report.statusLabelAr}`);
    } catch (err) {
      setInspectionReport(null);
      handleApiErr(err, 'فشل تحليل ملف النسخة الاحتياطية.');
    } finally {
      setInspecting(false);
    }
  };

  const handleRunRestore = async (mode: 'isolated_sandbox' | 'live_replace') => {
    if (restoringMode || (!selectedFile && !selectedBackupId)) return;
    if (mode === 'live_replace' && confirmPhrase.trim() !== CONFIRM_LIVE_RESTORE_PHRASE) {
      onError(`يرجى كتابة عبارة التأكيد المطابقة أولاً: "${CONFIRM_LIVE_RESTORE_PHRASE}"`);
      return;
    }
    setRestoringMode(mode);
    onError(null);
    onSuccess(null);
    try {
      const result = await apiClient.restoreBackupZip({
        file: selectedFile,
        backupId: selectedBackupId,
        mode,
        confirmationPhrase: mode === 'live_replace' ? confirmPhrase.trim() : undefined,
        confirmPassword: confirmPassword.trim() || undefined,
      });
      setRestoreReport(result);
      if (mode === 'live_replace') {
        setConfirmPhrase('');
        setConfirmPassword('');
        onSuccess(
          `تمت الاستعادة الحية بنجاح (${result.restoredRecordsTotal} سجل و${result.restoredAttachmentsCount} مرفق PDF) بعد حفظ نسخة الأمان المسبقة ${result.preRestoreBackupId || ''} ✅`
        );
      } else {
        onSuccess(
          `نجح اختبار الاستعادة المعزول (Sandbox) على جميع الجداول الـ ${result.restoredTablesCount} دون أي تعديل على البيانات الحية ✅`
        );
      }
      await onRefreshAll();
    } catch (err) {
      handleApiErr(err, 'فشلت عملية الاستعادة.');
    } finally {
      setRestoringMode(null);
    }
  };

  const canRestoreFromInspection =
    inspectionReport &&
    (inspectionReport.status === 'valid' || inspectionReport.status === 'valid_with_warnings');

  return (
    <div className="space-y-6">
      {/* 1. Create Full Backup ZIP Section */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
              <DatabaseBackup className="w-5 h-5 text-[#0A468C]" />
              إنشاء نسخة احتياطية كاملة (حزمة ZIP موثقة بـ SHA-256)
            </h4>
            <p className="text-xs font-bold text-slate-600 leading-relaxed">
              تأخذ لقطة متسقة (REPEATABLE READ Snapshot) من جميع جداول النظام الـ 14 (المستخدمين، المناديب، التصنيفات، المنتجات، المخزون، العملاء، الفواتير، المراجعات، حركات المخزون، إعدادات النظام والعمولات، سجل التدقيق، الشات) بالإضافة إلى ملفات PDF الأصلية في مجلد <span dir="ltr">attachments/</span> وملف <span dir="ltr">manifest.json</span>.
            </p>
          </div>
          <div className="shrink-0 bg-blue-50 border border-blue-200 rounded-2xl px-3.5 py-2.5 text-[11px] font-bold text-[#072F5F] max-w-sm">
            <p className="font-black">حماية الأسرار والاعتماد السحابي:</p>
            <p className="mt-0.5 text-slate-700">
              تُستبعد كلمات المرور المشفّرة ورمز استرداد المالك ومفاتيح API من ملفات النسخة. النسخ التلقائي على Cloud Storage / Cloud SQL PITR يتطلب صلاحيات GCS/Cloud SQL Admin خارج حاوية التشغيل.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleCreateFullZipBackup(e)} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
            placeholder="اسم وصفي اختياري للنسخة (مثال: نسخة ما قبل جرد نهاية الشهر)..."
            className="flex-1 min-h-[46px] px-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm"
          />
          <button
            type="submit"
            disabled={creatingBackup}
            className="min-h-[46px] px-6 py-2.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-md disabled:opacity-60 shrink-0"
          >
            {creatingBackup ? (
              <>
                <RefreshCcw className="w-4 h-4 animate-spin" />
                جاري التقاط اللقطة والتحقق...
              </>
            ) : (
              <>
                <HardDriveDownload className="w-4 h-4" />
                إنشاء وتنزيل نسخة ZIP كاملة
              </>
            )}
          </button>
        </form>
      </div>

      {/* 2. Persistent Backup History Ledger */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Archive className="w-5 h-5 text-[#0A468C]" />
              سجل النسخ الاحتياطية المحفوظة ({backups.length})
            </h4>
            <p className="text-[11px] font-bold text-slate-500">
              يُسجل كل إنشاء نسخة مع بصمة SHA-256 وحالة التحقق — حذف أي سجل لا يمس بيانات النظام أو ملفاتك المحلية
            </p>
          </div>
        </div>

        {backups.length === 0 ? (
          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center text-xs font-bold text-slate-500">
            لا توجد نسخ احتياطية مسجلة في السجل بعد. قم بإنشاء أول نسخة احتياطية كاملة بالأعلى.
          </div>
        ) : (
          <div className="space-y-2.5">
            {backups.map((bkp) => (
              <div
                key={bkp.id}
                className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-900 text-sm">{bkp.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded-lg font-black text-[11px] ${
                        bkp.backupType === 'pre_restore_safety'
                          ? 'bg-amber-100 text-amber-900'
                          : bkp.backupType === 'pre_reset_safety'
                            ? 'bg-orange-100 text-orange-900'
                            : 'bg-blue-100 text-[#072F5F]'
                      }`}
                    >
                      {bkp.backupType === 'pre_restore_safety'
                        ? 'أمان قبل الاستعادة'
                        : bkp.backupType === 'pre_reset_safety'
                          ? 'أمان قبل التصفير'
                          : 'نسخة كاملة'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-lg font-black text-[11px] ${
                        bkp.verificationStatus === 'verified'
                          ? 'bg-emerald-100 text-emerald-900'
                          : bkp.verificationStatus === 'warnings'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {bkp.verificationStatus === 'verified'
                        ? 'سليمة ومتحقق منها'
                        : bkp.verificationStatus === 'warnings'
                          ? 'متحقق منها بتحذيرات'
                          : 'فشل التحقق'}
                    </span>
                  </div>
                  <p className="text-[11px] font-bold text-slate-600 tabular-nums">
                    التاريخ: {new Date(bkp.createdAt).toLocaleString('ar-EG')} · بواسطة: {bkp.createdByName} · الجداول: {bkp.tablesCount} · السجلات: {bkp.totalRecords} · مرفقات PDF: {bkp.attachmentsCount} · الحجم: {formatBytes(bkp.fileSizeBytes)}
                  </p>
                  <p dir="ltr" className="text-[10px] font-bold text-slate-500 truncate tabular-nums">
                    ID: {bkp.id} | SHA-256: {bkp.zipSha256}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {bkp.hasStoredArchive && (
                    <>
                      <button
                        type="button"
                        disabled={downloadingId === bkp.id}
                        onClick={() => void handleDownloadZip(bkp)}
                        className="min-h-[38px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded-xl font-black text-xs flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5 text-[#0A468C]" />
                        {downloadingId === bkp.id ? 'جاري التنزيل...' : 'تنزيل ZIP'}
                      </button>

                      <button
                        type="button"
                        disabled={verifyingId === bkp.id}
                        onClick={() => void handleVerifyStoredBackup(bkp)}
                        className="min-h-[38px] px-3 py-1.5 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl font-black text-xs flex items-center gap-1.5"
                      >
                        <FileCheck2 className="w-3.5 h-3.5" />
                        {verifyingId === bkp.id ? 'جاري الفحص...' : 'فحص ومقارنة / استعادة'}
                      </button>
                    </>
                  )}

                  {confirmDeleteId === bkp.id ? (
                    <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 px-2.5 py-1 rounded-xl">
                      <span className="text-[11px] font-black text-red-800">حذف السجل فقط؟</span>
                      <button
                        type="button"
                        disabled={deletingId === bkp.id}
                        onClick={() => void handleDeleteBackup(bkp.id)}
                        className="px-2.5 py-1 bg-red-600 text-white rounded-lg font-black text-[11px]"
                      >
                        {deletingId === bkp.id ? '...' : 'نعم'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 bg-white text-slate-700 border border-slate-200 rounded-lg font-bold text-[11px]"
                      >
                        إلغاء
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(bkp.id)}
                      className="min-h-[38px] px-3 py-1.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-xl font-black text-xs flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      حذف النسخة
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Upload / Inspect & Safe Restore Zone */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-black text-[#072F5F] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#0A468C]" />
              فحص ملف نسخة احتياطية والاستعادة الآمنة (Sandbox أو Live)
            </h4>
            <p className="text-xs font-bold text-slate-500 mt-0.5">
              ارفع ملف <span dir="ltr">.zip</span> من جهازك أو اضغط "فحص ومقارنة / استعادة" على أي نسخة محفوظة أعلاه لمعاينة الفروق والتحقق من البصمات قبل التنفيذ
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleInspectUploadedFile(file);
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={inspecting}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] px-5 py-2.5 bg-slate-900 hover:bg-[#072F5F] text-white rounded-2xl font-black text-xs flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {inspecting ? 'جاري فحص ZIP...' : 'رفع وفحص ملف نسخة (.zip)'}
            </button>
          </div>
        </div>

        {/* Inspection Report Card */}
        {inspectionReport && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {inspectionReport.status === 'valid' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                ) : inspectionReport.status === 'valid_with_warnings' ? (
                  <FileWarning className="w-6 h-6 text-amber-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
                )}
                <div>
                  <span
                    className={`inline-block px-3 py-1 rounded-xl text-xs font-black ${
                      inspectionReport.status === 'valid'
                        ? 'bg-emerald-100 text-emerald-900'
                        : inspectionReport.status === 'valid_with_warnings'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-red-100 text-red-900'
                    }`}
                  >
                    حالة النسخة: {inspectionReport.statusLabelAr}
                  </span>
                  <p className="text-[11px] font-bold text-slate-600 mt-1 tabular-nums">
                    الحجم: {formatBytes(inspectionReport.zipSizeBytes)}
                    {inspectionReport.manifest
                      ? ` · تاريخ الإنشاء: ${new Date(inspectionReport.manifest.createdAt).toLocaleString('ar-EG')} · Schema v${inspectionReport.manifest.schemaVersion} · مرفقات PDF: ${inspectionReport.manifest.attachmentsCount}`
                      : ''}
                  </p>
                </div>
              </div>
              <span dir="ltr" className="text-[10px] font-bold text-slate-500 tabular-nums">
                SHA-256: {inspectionReport.zipSha256.slice(0, 24)}...
              </span>
            </div>

            {inspectionReport.integrityErrors.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-xs font-bold text-red-800">
                <p className="font-black">أخطاء سلامة تمنع الاستعادة:</p>
                {inspectionReport.integrityErrors.map((e, i) => (
                  <p key={i}>• {e}</p>
                ))}
              </div>
            )}

            {inspectionReport.checksumMismatches.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-xs font-bold text-red-800">
                <p className="font-black">ملفات لا تطابق بصمة SHA-256:</p>
                {inspectionReport.checksumMismatches.map((m, i) => (
                  <p key={i} dir="ltr">
                    • {m}
                  </p>
                ))}
              </div>
            )}

            {inspectionReport.missingTables.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-900">
                جداول مفقودة ({inspectionReport.missingTables.length}):{' '}
                <span dir="ltr">{inspectionReport.missingTables.join(', ')}</span>
              </div>
            )}

            {inspectionReport.warnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs font-bold text-amber-900">
                <p className="font-black">ملاحظات وتحذيرات الفحص:</p>
                {inspectionReport.warnings.map((w, i) => (
                  <p key={i}>• {w}</p>
                ))}
              </div>
            )}

            {inspectionReport.tableComparison.length > 0 && (
              <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-100 text-slate-700 font-black">
                    <tr>
                      <th className="p-2.5">الجدول</th>
                      <th className="p-2.5">في النسخة</th>
                      <th className="p-2.5">قاعدة البيانات الحالية</th>
                      <th className="p-2.5">الفرق</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold tabular-nums">
                    {inspectionReport.tableComparison.map((row) => (
                      <tr key={row.tableName}>
                        <td className="p-2.5 font-black text-[#072F5F]" dir="ltr">
                          {row.tableName}
                        </td>
                        <td className="p-2.5">{row.backupCount}</td>
                        <td className="p-2.5">{row.liveCount}</td>
                        <td
                          className={`p-2.5 font-black ${
                            row.delta === 0
                              ? 'text-slate-500'
                              : row.delta > 0
                                ? 'text-emerald-700'
                                : 'text-red-700'
                          }`}
                          dir="ltr"
                        >
                          {row.delta > 0 ? `+${row.delta}` : row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Safe Restore Actions */}
            {canRestoreFromInspection && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                {/* Option 1: Isolated Sandbox Verification */}
                <div className="bg-white p-4 rounded-2xl border border-blue-200 space-y-3">
                  <h5 className="font-black text-sm text-[#072F5F]">
                    1. اختبار استعادة معزول (Sandbox Verification)
                  </h5>
                  <p className="text-xs font-bold text-slate-600 leading-relaxed">
                    ينشئ مخطط PostgreSQL مؤقتاً معزولاً بالكامل، ويستعيد جميع الجداول الـ 14 ومرفقات PDF داخله ويتحقق من التطابق، ثم يحذف المخطط المؤقت دون لمس البيانات الحية.
                  </p>
                  <button
                    type="button"
                    disabled={restoringMode !== null}
                    onClick={() => void handleRunRestore('isolated_sandbox')}
                    className="w-full min-h-[44px] px-4 py-2 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-xl font-black text-xs disabled:opacity-50"
                  >
                    {restoringMode === 'isolated_sandbox'
                      ? 'جاري الاختبار داخل مخطط معزول...'
                      : 'تشغيل اختبار الاستعادة المعزول الآن'}
                  </button>
                </div>

                {/* Option 2: Live Production Replace Restore */}
                <div className="bg-rose-50/70 p-4 rounded-2xl border border-rose-300 space-y-3">
                  <h5 className="font-black text-sm text-rose-900 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-700" />
                    2. استعادة حية واستبدال بيانات النظام الحالية
                  </h5>
                  <p className="text-[11px] font-bold text-rose-900 leading-relaxed">
                    يُنشئ النظام أولاً نسخة أمان تلقائية من وضعك الحالي ثم يستبدل الجداول في معاملة واحدة (Rollback تلقائي عند أي خطأ) مع الحفاظ على حساب المالك الرئيسي وكلمة مروره ورمز الاسترداد.
                  </p>
                  <input
                    type="text"
                    value={confirmPhrase}
                    onChange={(e) => setConfirmPhrase(e.target.value)}
                    placeholder={`اكتب: ${CONFIRM_LIVE_RESTORE_PHRASE}`}
                    className="w-full min-h-[40px] px-3 py-1.5 bg-white border border-rose-300 rounded-xl font-bold text-xs"
                  />
                  {!stepUpActive && (
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="كلمة مرور المالك الرئيسي للتأكيد..."
                      className="w-full min-h-[40px] px-3 py-1.5 bg-white border border-rose-300 rounded-xl font-bold text-xs"
                    />
                  )}
                  <button
                    type="button"
                    disabled={
                      restoringMode !== null || confirmPhrase.trim() !== CONFIRM_LIVE_RESTORE_PHRASE
                    }
                    onClick={() => void handleRunRestore('live_replace')}
                    className="w-full min-h-[44px] px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl font-black text-xs disabled:opacity-50"
                  >
                    {restoringMode === 'live_replace'
                      ? 'جاري تنفيذ الاستعادة الحية...'
                      : 'تنفيذ الاستعادة الحية واستبدال البيانات'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Restore Execution Verification Result */}
        {restoreReport && (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-4 sm:p-5 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-black text-emerald-950 text-sm">
                تقرير التحقق بعد الاستعادة (
                {restoreReport.mode === 'isolated_sandbox' ? 'اختبار معزول Sandbox' : 'استعادة حية'})
              </p>
              <span className="font-bold text-emerald-800 tabular-nums">
                {restoreReport.restoredRecordsTotal} سجل · {restoreReport.restoredAttachmentsCount} مرفق PDF
              </span>
            </div>
            {restoreReport.preRestoreBackupId && (
              <p className="font-bold text-emerald-900">
                نسخة الأمان المنشأة تلقائياً قبل الاستعادة:{' '}
                <span dir="ltr" className="font-black">
                  {restoreReport.preRestoreBackupId}
                </span>
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {restoreReport.relationalChecks.map((chk, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl border ${
                    chk.passed
                      ? 'bg-white border-emerald-200 text-emerald-950'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <p className="font-black">{chk.checkName}</p>
                  <p className="text-[11px] font-bold mt-0.5">{chk.details}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
