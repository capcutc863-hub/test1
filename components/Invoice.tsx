import React, { useState } from 'react';
import { Order } from '../types';
import { getSalesOrderDisplayState, hasOrderPendingProcurement } from '../src/lib/date-utils';
import {
  Download,
  Printer,
  Phone,
  MapPin,
  Info,
  Edit2,
  Check,
  MessageCircle,
  CheckCircle2,
  XCircle,
  History,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  X,
} from 'lucide-react';

interface InvoiceProps {
  order: Order;
  canEdit?: boolean;
  editLabel?: string;
  onEdit?: () => void;
  canConfirm?: boolean;
  onConfirmOrder?: (orderId: string) => Promise<void> | void;
  canCancel?: boolean;
  onCancelOrder?: (orderId: string, reason: string) => Promise<void> | void;
  onClose: () => void;
}

const LOGO_SRC = '/assets/aistudio/logo_after_edit__2-1__80f21b58.png';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | { tl?: number; tr?: number; br?: number; bl?: number }
) {
  const rad =
    typeof r === 'number'
      ? { tl: r, tr: r, br: r, bl: r }
      : { tl: r.tl ?? 0, tr: r.tr ?? 0, br: r.br ?? 0, bl: r.bl ?? 0 };

  ctx.beginPath();
  ctx.moveTo(x + rad.tl, y);
  ctx.lineTo(x + w - rad.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad.tr);
  ctx.lineTo(x + w, y + h - rad.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad.br, y + h);
  ctx.lineTo(x + rad.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad.bl);
  ctx.lineTo(x, y + rad.tl);
  ctx.quadraticCurveTo(x, y, x + rad.tl, y);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
): string[] {
  ctx.save();
  ctx.font = font;
  const paragraphs = (text || '').split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${currentLine} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = words[i];
      }
    }
    lines.push(currentLine);
  }

  ctx.restore();
  return lines.length > 0 ? lines : [''];
}

function loadLogoImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawAmountLeftAligned(
  ctx: CanvasRenderingContext2D,
  leftX: number,
  y: number,
  prefix: string,
  amountStr: string,
  unit: string,
  amountFont: string,
  unitFont: string,
  amountColor: string,
  unitColor: string
) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.textAlign = 'left';

  // In RTL canvas with textAlign='left', drawing starts at leftX going rightward:
  // Visual order from left edge -> rightward: [unit] [gap] [prefix+amount]
  ctx.font = unitFont;
  ctx.fillStyle = unitColor;
  const unitW = ctx.measureText(unit).width;
  ctx.fillText(unit, leftX, y);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = amountFont;
  ctx.fillStyle = amountColor;
  ctx.fillText(`${prefix}${amountStr}`, leftX + unitW + 5, y);
  ctx.restore();
}

async function renderInvoiceToCanvas(order: Order): Promise<HTMLCanvasElement> {
  if (document.fonts) {
    await Promise.all([
      document.fonts.load('700 13px Cairo'),
      document.fonts.load('900 22px Cairo'),
      document.fonts.ready,
    ]);
  }

  const logoImg = await loadLogoImage(LOGO_SRC);

  const W = 600;
  const pad = 28;
  const contentW = W - pad * 2; // 544
  const rightX = W - pad; // 572
  const leftX = pad; // 28

  // Temporary measure context
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d')!;

  // Pre-measure dynamic text blocks
  const custNameLines = wrapTextLines(
    mctx,
    order.customerName,
    258,
    '900 16px Cairo, sans-serif'
  );
  const fullAddress = [order.governorate, order.customerAddress || 'الاستلام من المقر']
    .filter(Boolean)
    .join(' — ');
  const custAddrLines = wrapTextLines(
    mctx,
    `العنوان: ${fullAddress}`,
    252,
    '700 12px Cairo, sans-serif'
  );
  const repNameLines = wrapTextLines(
    mctx,
    order.salesRepName || 'سيلز فريق كيما سنت',
    210,
    '900 14px Cairo, sans-serif'
  );

  const rightBoxH = 26 + custNameLines.length * 22 + 22 + custAddrLines.length * 18;
  const leftBoxH = 26 + repNameLines.length * 20 + 42;
  const infoBoxH = Math.max(108, Math.max(rightBoxH, leftBoxH) + 28);

  const preparedRows = order.items.map((item) => {
    const nameLines = wrapTextLines(
      mctx,
      item.productName,
      230,
      '800 13px Cairo, sans-serif'
    );
    const gradeLabel = [
      item.categoryName,
      item.grade && item.grade !== 'قياسي' ? item.grade : '',
      item.productCode ? `كود ${item.productCode}` : '',
      item.isCustom ? 'طلب مخصوص' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const rowH = Math.max(52, nameLines.length * 18 + 30);
    return { item, nameLines, gradeLabel, rowH };
  });

  const tableHeaderH = 40;
  const tableRowsH = preparedRows.reduce((sum, r) => sum + r.rowH, 0);
  const tableH = tableHeaderH + tableRowsH;

  const noteLines = order.customerNotes
    ? wrapTextLines(mctx, order.customerNotes, contentW - 28, '700 12px Cairo, sans-serif')
    : [];
  const notesBoxH = noteLines.length > 0 ? 34 + noteLines.length * 19 + 10 : 0;

  let totalsLinesCount = 2; // subtotal + shipping
  if (order.discountAmount > 0) totalsLinesCount += 1;
  const totalsRowsH = totalsLinesCount * 26;
  const netBoxH = 54;
  const footerH = 44;

  // Total vertical height calculation
  const headerH = 74;
  const totalHeight =
    pad +
    headerH +
    18 +
    infoBoxH +
    18 +
    tableH +
    (notesBoxH > 0 ? 16 + notesBoxH : 0) +
    18 +
    totalsRowsH +
    10 +
    netBoxH +
    18 +
    footerH +
    16;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = totalHeight * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // 1. Clean White Sheet Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, totalHeight);

  let y = pad;

  // 2. Header: Title + Invoice Badge/Date on Right, Logo on Left
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#072F5F';
  ctx.font = '900 24px Cairo, sans-serif';
  ctx.fillText('فاتورة مبيعات', rightX, y + 16);
  ctx.restore();

  // Order ID Pill (+ Version if > 1)
  const versionNum = order.version || 1;
  const orderIdText = versionNum > 1 ? `#${order.id.slice(0, 10)} · v${versionNum}` : `#${order.id.slice(0, 10)}`;
  ctx.save();
  ctx.font = '900 12px Cairo, sans-serif';
  const badgeTextW = ctx.measureText(orderIdText).width;
  const badgeW = badgeTextW + 20;
  const badgeH = 26;
  const badgeX = rightX - badgeW;
  const badgeY = y + 36;
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 8);
  ctx.fillStyle = '#EFF6FF';
  ctx.fill();
  ctx.strokeStyle = '#BFDBFE';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0A468C';
  ctx.fillText(orderIdText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);
  ctx.restore();

  // Date beside badge
  const formattedDate = new Date(order.createdAt).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '700 12px Cairo, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(formattedDate, badgeX - 10, badgeY + badgeH / 2 + 1);
  ctx.restore();

  // Logo on Left
  if (logoImg) {
    const maxLogoH = 60;
    const aspect = logoImg.naturalWidth / (logoImg.naturalHeight || 1);
    const drawH = maxLogoH;
    const drawW = drawH * aspect;
    ctx.drawImage(logoImg, leftX, y, drawW, drawH);
  }

  y += headerH;

  // Blue bottom divider under header
  ctx.fillStyle = '#0A468C';
  ctx.fillRect(leftX, y, contentW, 2);
  y += 18;

  // 3. Customer (Right) & Sales Rep + Status (Left) Card
  drawRoundedRect(ctx, leftX, y, contentW, infoBoxH, 16);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Vertical divider between Customer (Right) & Sales Rep (Left)
  const splitX = leftX + 245;
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(splitX, y + 14, 1, infoBoxH - 28);

  // Right Side: Customer Info
  let ry = y + 22;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '900 11px Cairo, sans-serif';
  ctx.fillStyle = '#0A468C';
  ctx.fillText('بيانات العميل', rightX - 16, ry);
  ry += 20;

  ctx.font = '900 16px Cairo, sans-serif';
  ctx.fillStyle = '#0F172A';
  for (const line of custNameLines) {
    ctx.fillText(line, rightX - 16, ry);
    ry += 22;
  }

  // Phone
  ctx.font = '700 12px Cairo, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('الهاتف:', rightX - 16, ry);
  const phoneLabelW = ctx.measureText('الهاتف:').width;
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.fillText(order.customerPhone || 'بدون هاتف', rightX - 16 - phoneLabelW - 6, ry);
  ry += 20;

  // Address
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  for (let i = 0; i < custAddrLines.length; i++) {
    ctx.fillText(custAddrLines[i], rightX - 16, ry);
    ry += 18;
  }
  ctx.restore();

  // Left Side: Sales Rep Name & Order Status
  let ly = y + 22;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '900 11px Cairo, sans-serif';
  ctx.fillStyle = '#0A468C';
  ctx.fillText('سيلز فريق كيما سنت', leftX + 16, ly);
  ly += 20;

  ctx.font = '900 14px Cairo, sans-serif';
  ctx.fillStyle = '#0F172A';
  for (const line of repNameLines) {
    ctx.fillText(line, leftX + 16, ly);
    ly += 20;
  }
  ctx.restore();

  // Status Pill on Left bottom (uses decoupled sales display state)
  const canvasDisplayState = getSalesOrderDisplayState(order);
  const canvasStatusLabel = canvasDisplayState.primaryLabel;
  ctx.save();
  ctx.font = '900 11px Cairo, sans-serif';
  const statusW = ctx.measureText(canvasStatusLabel).width + 24;
  const statusH = 26;
  const statusX = leftX + 16;
  const statusY = y + infoBoxH - 16 - statusH;
  drawRoundedRect(ctx, statusX, statusY, statusW, statusH, 8);
  const statusBg =
    order.status === 'تم التسليم'
      ? '#065F46'
      : order.status === 'بانتظار تأكيد العميل'
        ? '#334155'
        : order.status === 'مرتجع' || order.status === 'رفض استلام'
          ? '#9A3412'
          : order.status === 'ملغي' || canvasDisplayState.isAwaitingReview
            ? '#991B1B'
            : canvasDisplayState.isRePrepActive
              ? '#B45309'
              : '#072F5F';
  ctx.fillStyle = statusBg;
  ctx.fill();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(canvasStatusLabel, statusX + statusW / 2, statusY + statusH / 2 + 1);
  ctx.restore();

  y += infoBoxH + 18;

  // 4. Items Table
  const tableStartY = y;
  drawRoundedRect(ctx, leftX, tableStartY, contentW, tableH, 14);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Table Header Bar
  drawRoundedRect(ctx, leftX, tableStartY, contentW, tableHeaderH, {
    tl: 14,
    tr: 14,
    br: 0,
    bl: 0,
  });
  ctx.fillStyle = '#072F5F';
  ctx.fill();

  const colItemX = rightX - 14;
  const colQtyCenterX = leftX + 245;
  const colPriceCenterX = leftX + 160;
  const colTotalLeftX = leftX + 14;

  ctx.save();
  ctx.font = '900 12px Cairo, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';

  ctx.textAlign = 'right';
  ctx.fillText('الصنف', colItemX, tableStartY + tableHeaderH / 2 + 1);

  ctx.textAlign = 'center';
  ctx.fillText('الكمية', colQtyCenterX, tableStartY + tableHeaderH / 2 + 1);
  ctx.fillText('السعر', colPriceCenterX, tableStartY + tableHeaderH / 2 + 1);

  ctx.textAlign = 'left';
  ctx.fillText('الإجمالي', colTotalLeftX, tableStartY + tableHeaderH / 2 + 1);
  ctx.restore();

  y = tableStartY + tableHeaderH;

  // Table Rows
  for (let i = 0; i < preparedRows.length; i++) {
    const { item, nameLines, gradeLabel, rowH } = preparedRows[i];

    if (i > 0) {
      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(leftX + 1, y, contentW - 2, 1);
    }

    // Item Name + Grade
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    let itemY = y + 18;
    ctx.font = '800 13px Cairo, sans-serif';
    ctx.fillStyle = '#0F172A';
    for (const nLine of nameLines) {
      ctx.fillText(nLine, colItemX, itemY);
      itemY += 18;
    }
    ctx.font = '700 11px Cairo, sans-serif';
    ctx.fillStyle = '#0A468C';
    ctx.fillText(gradeLabel, colItemX, itemY);
    ctx.restore();

    const rowMidY = y + 22;

    // Quantity
    ctx.save();
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 12px Cairo, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(`${item.quantity.toLocaleString()} ${item.unit || 'mg'}`, colQtyCenterX, rowMidY);
    ctx.restore();

    // Unit Price
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 12px Cairo, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`${item.price} ج.م`, colPriceCenterX, rowMidY);
    ctx.restore();

    // Line Total
    drawAmountLeftAligned(
      ctx,
      colTotalLeftX,
      rowMidY,
      '',
      (item.quantity * item.price).toLocaleString(),
      'ج.م',
      '900 13px Cairo, sans-serif',
      '700 11px Cairo, sans-serif',
      '#072F5F',
      '#072F5F'
    );

    y += rowH;
  }

  // 5. Optional Notes Box
  if (notesBoxH > 0) {
    y += 16;
    drawRoundedRect(ctx, leftX, y, contentW, notesBoxH, 12);
    ctx.fillStyle = '#F8FAFC';
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '900 12px Cairo, sans-serif';
    ctx.fillStyle = '#0A468C';
    ctx.fillText('ملاحظات الفاتورة', rightX - 14, y + 18);

    ctx.font = '700 12px Cairo, sans-serif';
    ctx.fillStyle = '#334155';
    let ny = y + 38;
    for (const line of noteLines) {
      ctx.fillText(line, rightX - 14, ny);
      ny += 19;
    }
    ctx.restore();
    y += notesBoxH;
  }

  // 6. Totals Breakdown
  y += 18;
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(leftX, y - 10, contentW, 1);

  const drawSummaryRow = (
    label: string,
    prefix: string,
    amountStr: string,
    color: string
  ) => {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '700 13px Cairo, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(label, rightX - 4, y + 12);
    ctx.restore();

    drawAmountLeftAligned(
      ctx,
      leftX + 4,
      y + 12,
      prefix,
      amountStr,
      'ج.م',
      '700 13px Cairo, sans-serif',
      '700 12px Cairo, sans-serif',
      color,
      color
    );
    y += 26;
  };

  drawSummaryRow('إجمالي الأصناف', '', order.subtotal.toLocaleString(), '#475569');
  if (order.discountAmount > 0) {
    drawSummaryRow(
      `الخصم (${order.discountPercentage}%)`,
      '-',
      order.discountAmount.toLocaleString(),
      '#DC2626'
    );
  }
  drawSummaryRow('تكلفة الشحن', '+', order.shippingCost.toLocaleString(), '#0A468C');

  y += 10;

  // Net Total Highlight Box
  drawRoundedRect(ctx, leftX, y, contentW, netBoxH, 16);
  ctx.fillStyle = '#072F5F';
  ctx.fill();

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '900 14px Cairo, sans-serif';
  ctx.fillStyle = '#DBEAFE';
  ctx.fillText('الصافي المستحق', rightX - 18, y + netBoxH / 2 + 1);
  ctx.restore();

  drawAmountLeftAligned(
    ctx,
    leftX + 18,
    y + netBoxH / 2 + 1,
    '',
    order.totalAmount.toLocaleString(),
    'ج.م',
    '900 22px Cairo, sans-serif',
    '700 13px Cairo, sans-serif',
    '#FFFFFF',
    '#BFDBFE'
  );

  y += netBoxH + 18;

  // 7. Footer
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(leftX, y, contentW, 1);

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 11px Cairo, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText('Kima Scent — Inspired by Purity', W / 2, y + 22);
  ctx.restore();

  return canvas;
}

function normalizeWhatsAppPhone(phone?: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (normalized.startsWith('00')) {
    normalized = normalized.slice(2);
  }
  if (normalized.length === 11 && normalized.startsWith('01')) {
    normalized = `2${normalized}`;
  } else if (normalized.length === 10 && normalized.startsWith('1')) {
    normalized = `20${normalized}`;
  }
  return normalized;
}

function buildWhatsAppSummary(order: Order): string {
  const versionNum = order.version || 1;
  const display = getSalesOrderDisplayState(order);
  const lines = [
    `*فاتورة مبيعات — Kima Scent*`,
    `رقم الفاتورة: #${order.id}${versionNum > 1 ? ` (الإصدار v${versionNum})` : ''}`,
    `الحالة: ${display.primaryLabel}${display.secondaryLabel ? ` (${display.secondaryLabel})` : ''}`,
    `العميل: ${order.customerName}`,
    order.customerPhone ? `الهاتف: ${order.customerPhone}` : '',
    order.governorate || order.customerAddress
      ? `العنوان: ${[order.governorate, order.customerAddress].filter(Boolean).join(' — ')}`
      : '',
    '',
    `*الأصناف المطلوبة (${order.items.length}):*`,
    ...order.items.map(
      (item, idx) =>
        `${idx + 1}. ${item.productName}${item.categoryName ? ` [${item.categoryName}]` : ''}${item.grade && item.grade !== 'قياسي' ? ` (${item.grade})` : ''} — ${item.quantity.toLocaleString()} ${item.unit || 'mg'} × ${item.price} = ${(item.quantity * item.price).toLocaleString()} ج.م`
    ),
    '',
    `إجمالي الأصناف: ${order.subtotal.toLocaleString()} ج.م`,
    order.discountAmount > 0
      ? `الخصم (${order.discountPercentage}%): -${order.discountAmount.toLocaleString()} ج.م`
      : '',
    `تكلفة الشحن: +${order.shippingCost.toLocaleString()} ج.م`,
    `*الصافي المستحق: ${order.totalAmount.toLocaleString()} ج.م*`,
    order.customerNotes ? `ملاحظات: ${order.customerNotes}` : '',
    '',
    order.status === 'بانتظار تأكيد العميل'
      ? 'يرجى مراجعة تفاصيل الفاتورة وتأكيد الطلب لبدء التجهيز.'
      : 'شكراً لتعاملكم مع Kima Scent.',
  ];
  return lines.filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== '')).join('\n');
}

export const Invoice: React.FC<InvoiceProps> = ({
  order,
  canEdit = false,
  editLabel = 'تعديل',
  onEdit,
  canConfirm = false,
  onConfirmOrder,
  canCancel = false,
  onCancelOrder,
  onClose,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);

  const versionNum = order.version || 1;
  const revisions = order.revisions || [];
  const salesDisplay = getSalesOrderDisplayState(order);
  const hasPendingProcurement = hasOrderPendingProcurement(order);

  const exportCanvasBlob = async (): Promise<{ blob: Blob | null; dataUrl: string; fileName: string }> => {
    const canvas = await renderInvoiceToCanvas(order);
    const fileName = `KimaScent-Invoice-${order.id}-v${versionNum}.png`;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 1.0)
    );
    const dataUrl = canvas.toDataURL('image/png');
    return { blob, dataUrl, fileName };
  };

  const triggerDownload = (blob: Blob | null, dataUrl: string, fileName: string) => {
    const link = document.createElement('a');
    link.download = fileName;
    if (blob) {
      const blobUrl = URL.createObjectURL(blob);
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
    } else {
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const openExternalWhatsAppLink = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadImage = async () => {
    setIsDownloading(true);
    setActionError(null);
    setDownloadDone(false);

    try {
      const { blob, dataUrl, fileName } = await exportCanvasBlob();
      triggerDownload(blob, dataUrl, fileName);
      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 2500);
    } catch (err) {
      console.error('Invoice export failed:', err);
      setActionError('تعذر حفظ صورة الفاتورة، يرجى المحاولة مرة أخرى أو استخدام زر الطباعة.');
    } finally {
      setIsDownloading(false);
    }
  };

  const shareViaWhatsApp = async () => {
    setIsSharing(true);
    setActionError(null);
    setShareHint(null);

    try {
      const summaryText = buildWhatsAppSummary(order);
      const { blob, dataUrl, fileName } = await exportCanvasBlob();

      if (blob && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        const pngFile = new File([blob], fileName, { type: 'image/png' });
        const supportsFiles =
          typeof navigator.canShare !== 'function' || navigator.canShare({ files: [pngFile] });

        if (supportsFiles) {
          try {
            await navigator.share({
              files: [pngFile],
              title: `فاتورة Kima Scent #${order.id}`,
              text: summaryText,
            });
            setShareHint('تمت مشاركة صورة الفاتورة وملخص الطلب عبر نافذة المشاركة.');
            return;
          } catch (shareErr: unknown) {
            if (shareErr instanceof DOMException && shareErr.name === 'AbortError') {
              return;
            }
            // Fall through to download + wa.me fallback cleanly
          }
        }
      }

      // Desktop / non-Web-Share fallback: download PNG locally + open wa.me link with honest manual attach instruction
      triggerDownload(blob, dataUrl, fileName);
      const phone = normalizeWhatsAppPhone(order.customerPhone);
      const waUrl = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(summaryText)}`
        : `https://wa.me/?text=${encodeURIComponent(summaryText)}`;
      openExternalWhatsAppLink(waUrl);
      setShareHint(
        'تم تنزيل صورة الفاتورة (PNG) وفتح محادثة واتساب بملخص الفاتورة — يرجى إرفاق الصورة المحمّلة يدوياً داخل المحادثة.'
      );
    } catch (err) {
      console.error('WhatsApp share failed:', err);
      setActionError('تعذر تجهيز الفاتورة للمشاركة، يمكنك تحميل الصورة وإرسالها يدوياً.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleConfirmClick = async () => {
    if (!onConfirmOrder) return;
    setIsConfirming(true);
    setActionError(null);
    try {
      await onConfirmOrder(order.id);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'تعذر تأكيد الفاتورة.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCancelOrder) return;
    if (cancelReason.trim().length < 3) {
      setActionError('يجب كتابة سبب واضح لإلغاء الفاتورة (3 أحرف على الأقل).');
      return;
    }
    setIsCancelling(true);
    setActionError(null);
    try {
      await onCancelOrder(order.id, cancelReason.trim());
      setShowCancelDialog(false);
      setCancelReason('');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة.');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[700] overflow-y-auto font-cairo print:static print:bg-white print:p-0 print:block print:overflow-visible"
      dir="rtl"
    >
      <div className="bg-white w-full max-w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] border border-blue-900/15 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 print:max-w-full print:w-full print:rounded-none print:shadow-none print:border-0 print:max-h-none print:my-0">
        {/* Scrollable Preview & Print Body */}
        <div className="flex-1 overflow-y-auto bg-white print:overflow-visible">
          <div className="p-4 sm:p-8 bg-white print:p-5 text-slate-900">
            {/* Header with Logo */}
            <div className="flex items-center justify-between gap-4 border-b-2 border-[#0A468C] pb-4 mb-5">
              <div className="space-y-1.5 min-w-0">
                <h1 className="text-xl sm:text-2xl font-black text-[#072F5F] leading-tight">
                  فاتورة مبيعات
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span
                    dir="ltr"
                    className="bg-blue-50 text-[#0A468C] border border-blue-200 px-2.5 py-0.5 rounded-lg font-black tabular-nums"
                  >
                    #{order.id.slice(0, 10)}
                  </span>
                  {versionNum > 1 && (
                    <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-lg text-[11px] font-black tabular-nums">
                      نسخة v{versionNum}
                    </span>
                  )}
                  <span className="text-slate-500 tabular-nums">
                    {new Date(order.createdAt).toLocaleDateString('ar-EG', {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end shrink-0">
                <img
                  src={LOGO_SRC}
                  alt="Kima Scent"
                  className="h-14 sm:h-16 w-auto object-contain"
                />
              </div>
            </div>

            {/* Draft or Cancellation Status Banners */}
            {order.status === 'بانتظار تأكيد العميل' && (
              <div className="mb-4 p-3.5 rounded-2xl bg-slate-100 border border-slate-300 text-xs font-bold text-slate-800 flex items-start gap-2 no-print">
                <Info className="w-4 h-4 text-[#0A468C] shrink-0 mt-0.5" />
                <span>
                  مسودة فاتورة بانتظار تأكيد العميل — لم يُخصم المخزون ولم يُحتسب ضمن التجهيز أو العمولات بعد.
                </span>
              </div>
            )}

            {order.status === 'ملغي' && order.cancellationInfo && (
              <div className="mb-4 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs space-y-1">
                <p className="font-black text-red-800 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 shrink-0" />
                  فاتورة ملغاة ({order.cancellationInfo.stageAtCancellation})
                </p>
                <p className="font-bold text-red-700">السبب: {order.cancellationInfo.reason}</p>
                <p className="font-bold text-red-600/80 text-[11px]">
                  بواسطة: {order.cancellationInfo.cancelledByName} ·{' '}
                  {new Date(order.cancellationInfo.cancelledAt).toLocaleString('ar-EG')}
                </p>
              </div>
            )}

            {(salesDisplay.secondaryLabel || hasPendingProcurement) && order.status !== 'ملغي' && (
              <div className="mb-4 space-y-2 no-print">
                {salesDisplay.secondaryLabel && (
                  <div
                    className={`p-3 rounded-2xl border text-xs font-bold flex items-start gap-2 ${
                      salesDisplay.isAwaitingReview
                        ? 'bg-red-50 border-red-200 text-red-900'
                        : salesDisplay.isRePrepActive
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-blue-50 border-blue-200 text-[#072F5F]'
                    }`}
                  >
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{salesDisplay.secondaryLabel}</span>
                  </div>
                )}
                {hasPendingProcurement && (
                  <div className="p-3 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-bold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                    <span>
                      تحتوي الفاتورة على أصناف بانتظار التوفير — لن يكتمل التجهيز أو الشحن قبل توفيرها.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Customer (Right) & Sales Rep (Left / Other Side) */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-5 bg-slate-50 p-3.5 sm:p-4 rounded-2xl border border-slate-200/80">
              <div className="space-y-1.5 min-w-0">
                <span className="text-[11px] font-black text-[#0A468C] block">بيانات العميل</span>
                <p className="font-black text-sm sm:text-base text-slate-900 leading-snug break-words">
                  {order.customerName}
                </p>
                <div className="space-y-1 text-[11px] sm:text-xs font-bold text-slate-600">
                  <p className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-[#0A468C] shrink-0" />
                    <span dir="ltr" className="tabular-nums truncate">
                      {order.customerPhone || 'بدون هاتف'}
                    </span>
                  </p>
                  <p className="flex items-start gap-1.5 break-words leading-relaxed">
                    <MapPin className="w-3.5 h-3.5 text-[#0A468C] shrink-0 mt-0.5" />
                    <span>
                      {order.governorate ? `${order.governorate} — ` : ''}
                      {order.customerAddress || 'الاستلام من المقر'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="text-left flex flex-col items-end justify-between border-r border-slate-200 pr-3 sm:pr-4 gap-2 min-w-0">
                <div className="space-y-0.5 w-full">
                  <span className="text-[10px] sm:text-[11px] font-black text-[#0A468C] block">
                    سيلز فريق كيما سنت
                  </span>
                  <p className="text-xs sm:text-sm font-black text-slate-900 leading-snug break-words">
                    {order.salesRepName}
                  </p>
                </div>
                <span
                  className={`inline-block text-white px-2.5 sm:px-3 py-1 rounded-lg text-[10px] sm:text-[11px] font-black w-fit whitespace-nowrap ${
                    order.status === 'تم التسليم'
                      ? 'bg-emerald-800'
                      : order.status === 'بانتظار تأكيد العميل'
                        ? 'bg-slate-700'
                        : order.status === 'مرتجع' || order.status === 'رفض استلام'
                          ? 'bg-orange-800'
                          : order.status === 'ملغي' || salesDisplay.isAwaitingReview
                            ? 'bg-red-800'
                            : salesDisplay.isRePrepActive
                              ? 'bg-amber-700'
                              : 'bg-[#072F5F]'
                  }`}
                >
                  {salesDisplay.primaryLabel}
                </span>
              </div>
            </div>

            {/* Items Table */}
            <div className="mb-5 rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-right border-collapse">
                <thead className="bg-[#072F5F] text-white">
                  <tr>
                    <th className="py-3 px-3 text-right font-black text-xs">الصنف</th>
                    <th className="py-3 px-2 text-center font-black text-xs">الكمية</th>
                    <th className="py-3 px-2 text-center font-black text-xs">السعر</th>
                    <th className="py-3 px-3 text-left font-black text-xs">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {order.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-3 px-3 text-right align-top">
                        <p className="font-black text-slate-900 text-xs sm:text-[13px] leading-snug break-words">
                          {item.productName}
                        </p>
                        <p className="text-[11px] text-[#0A468C] font-bold mt-0.5 leading-snug">
                          {[
                            item.categoryName,
                            item.grade && item.grade !== 'قياسي' ? item.grade : '',
                            item.productCode ? `#${item.productCode}` : '',
                            item.isCustom ? 'طلب مخصوص' : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {(item.pendingQty || 0) > 0 ? (
                          <p className="text-[10px] font-black text-amber-800 mt-0.5 no-print">
                            بانتظار التوفير ({(item.pendingQty || 0).toLocaleString()} {item.unit || 'mg'})
                          </p>
                        ) : item.sourcingSource && item.sourcingSource !== 'من المخزون الحالي' ? (
                          <p className="text-[10px] font-bold text-slate-500 mt-0.5 no-print">
                            {item.sourcingSource}
                            {item.supplierName ? ` · ${item.supplierName}` : ''}
                          </p>
                        ) : null}
                        <p className="text-[10px] font-bold mt-0.5 no-print tabular-nums">
                          {item.isCommissionEligible ? (
                            <span className="text-emerald-700">
                              عمولة البند: {(item.commissionAmount ?? 0).toLocaleString()} ج.م (
                              {Number(((item.commissionRateApplied || 0) * 100).toFixed(2))}%)
                            </span>
                          ) : (
                            <span className="text-slate-400">غير مستحق للعمولة</span>
                          )}
                        </p>
                      </td>
                      <td className="py-3 px-2 text-center font-bold text-slate-700 text-xs tabular-nums align-top whitespace-nowrap">
                        <span dir="ltr" className="inline-block">
                          {item.quantity.toLocaleString()} {item.unit || 'mg'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center font-bold text-slate-600 text-xs tabular-nums align-top whitespace-nowrap">
                        {item.price} ج.م
                      </td>
                      <td className="py-3 px-3 text-left font-black text-[#072F5F] text-xs sm:text-[13px] tabular-nums align-top whitespace-nowrap">
                        {(item.quantity * item.price).toLocaleString()}{' '}
                        <span className="text-[11px] font-bold">ج.م</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Notes & Totals */}
            <div className="space-y-3.5 pt-3.5 border-t border-slate-200">
              {order.customerNotes && (
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                  <p className="font-black text-[#0A468C] flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 shrink-0" /> ملاحظات الفاتورة
                  </p>
                  <p className="text-slate-700 font-bold leading-relaxed break-words">
                    {order.customerNotes}
                  </p>
                </div>
              )}

              <div className="space-y-2 text-xs sm:text-[13px]">
                <div className="flex justify-between items-center font-bold text-slate-600 px-1 tabular-nums">
                  <span>إجمالي الأصناف</span>
                  <span>{order.subtotal.toLocaleString()} ج.م</span>
                </div>
                {order.discountAmount > 0 && (
                  <div className="flex justify-between items-center font-bold text-red-600 px-1 tabular-nums">
                    <span>الخصم ({order.discountPercentage}%)</span>
                    <span dir="ltr">-{order.discountAmount.toLocaleString()} ج.م</span>
                  </div>
                )}
                <div className="flex justify-between items-center font-bold text-[#0A468C] px-1 tabular-nums">
                  <span>تكلفة الشحن</span>
                  <span dir="ltr">+{order.shippingCost.toLocaleString()} ج.م</span>
                </div>

                <div className="bg-[#072F5F] p-4 rounded-2xl text-white flex items-center justify-between mt-2.5">
                  <span className="text-xs sm:text-sm font-black text-blue-100">الصافي المستحق</span>
                  <div className="flex items-baseline gap-1.5 tabular-nums">
                    <span className="text-xl sm:text-2xl font-black">
                      {order.totalAmount.toLocaleString()}
                    </span>
                    <span className="text-xs font-bold text-blue-200">ج.م</span>
                  </div>
                </div>

                {/* Internal Commission Snapshot Card (non-printable) */}
                <div className="mt-3 p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200 text-xs space-y-2 no-print">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-[#072F5F]">
                      ملخص عمولة السيلز المحسوبة (داخلي — لا يظهر للعميل)
                    </span>
                    <span className="font-black text-emerald-800 tabular-nums">
                      إجمالي العمولة: {order.commission.toLocaleString()} ج.م
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-600 tabular-nums">
                    <span>
                      مبيعات خاضعة للعمولة:{' '}
                      {(order.commissionableSubtotal ?? 0).toLocaleString()} ج.م
                    </span>
                    {order.commissionRuleSnapshot?.categoryBreakdown &&
                      order.commissionRuleSnapshot.categoryBreakdown.length > 0 && (
                        <span>
                          التصنيفات:{' '}
                          {order.commissionRuleSnapshot.categoryBreakdown
                            .map(
                              (bk) =>
                                `${bk.categoryName} (${bk.eligible ? `${bk.commissionAmount.toLocaleString()} ج.م` : 'بدون عمولة'})`
                            )
                            .join(' · ')}
                        </span>
                      )}
                  </div>
                </div>
              </div>
            </div>

            {/* Revision History (non-printable internal trace) */}
            {revisions.length > 0 && (
              <div className="mt-5 border border-slate-200 rounded-2xl overflow-hidden no-print">
                <button
                  type="button"
                  onClick={() => setShowRevisions((prev) => !prev)}
                  className="w-full min-h-[42px] px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-black text-[#072F5F]"
                >
                  <span className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[#0A468C]" />
                    سجل تعديلات الفاتورة ({revisions.length})
                  </span>
                  {showRevisions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showRevisions && (
                  <div className="p-3.5 bg-white space-y-2.5 max-h-60 overflow-y-auto text-xs">
                    {revisions.map((rev) => (
                      <div key={rev.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-black text-[#072F5F]">
                            تعديل v{rev.fromVersion} ← v{rev.toVersion} ({rev.editedByName})
                          </span>
                          <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                            {new Date(rev.editedAt).toLocaleString('ar-EG')}
                          </span>
                        </div>
                        {rev.reason && (
                          <p className="font-bold text-slate-700">السبب: {rev.reason}</p>
                        )}
                        <div className="space-y-0.5 text-[11px] font-bold">
                          {rev.addedItems.map((it, i) => (
                            <p key={`add-${i}`} className="text-emerald-700">
                              + إضافة: {it.productName} ({it.grade}) — {it.newQuantity} {it.unit || 'mg'} × {it.newPrice} ج.م
                            </p>
                          ))}
                          {rev.removedItems.map((it, i) => (
                            <p key={`rem-${i}`} className="text-red-700">
                              - حذف: {it.productName} ({it.grade}) — كان {it.oldQuantity} {it.unit || 'mg'}
                            </p>
                          ))}
                          {rev.modifiedItems.map((it, i) => (
                            <p key={`mod-${i}`} className="text-amber-800">
                              ~ تعديل: {it.productName} ({it.grade}) — الكمية {it.oldQuantity} ← {it.newQuantity} {it.unit || 'mg'}
                            </p>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200 text-[11px] font-black text-[#072F5F] tabular-nums">
                          <span>
                            الإجمالي: {rev.previousTotal.toLocaleString()} ← {rev.newTotal.toLocaleString()} ج.م
                          </span>
                          {rev.reviewStatus !== 'none' && (
                            <span className="px-2 py-0.5 rounded bg-blue-100 text-[#072F5F]">
                              {rev.reviewStatus}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Clean Footer */}
            <div className="mt-6 pt-3.5 border-t border-slate-100 text-center text-[11px] font-bold text-slate-400">
              Kima Scent — Inspired by Purity
            </div>
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="bg-slate-50 p-3.5 sm:p-4 pb-safe space-y-2.5 border-t border-slate-200 no-print shrink-0">
          {actionError && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {shareHint && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-900 flex items-start gap-2">
              <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>{shareHint}</span>
            </div>
          )}

          {/* Primary Confirm Order button for pre-confirmation drafts */}
          {order.status === 'بانتظار تأكيد العميل' && canConfirm && onConfirmOrder && (
            <button
              onClick={() => void handleConfirmClick()}
              disabled={isConfirming}
              className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-4 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-md active:scale-[0.99] disabled:opacity-70"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isConfirming ? 'جاري التأكيد وخصم المخزون...' : 'تأكيد الطلب وإرساله للتجهيز'}
            </button>
          )}

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            <button
              onClick={() => void downloadImage()}
              disabled={isDownloading}
              className="min-h-[44px] sm:flex-1 bg-[#0A468C] text-white py-2.5 px-3 rounded-2xl font-black text-xs sm:text-sm hover:bg-[#072F5F] transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
            >
              {downloadDone ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {isDownloading ? 'جاري التصدير...' : downloadDone ? 'تم الحفظ PNG' : 'تحميل صورة الفاتورة (PNG)'}
            </button>

            <button
              onClick={() => void shareViaWhatsApp()}
              disabled={isSharing}
              className="min-h-[44px] sm:flex-1 bg-emerald-700 text-white py-2.5 px-3 rounded-2xl font-black text-xs sm:text-sm hover:bg-emerald-800 transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
            >
              <MessageCircle className="w-4 h-4" />
              {isSharing ? 'جاري التجهيز...' : 'مشاركة عبر واتساب'}
            </button>

            <button
              onClick={() => window.print()}
              className="min-h-[44px] px-4 bg-[#072F5F] text-white py-2.5 rounded-2xl font-black text-xs sm:text-sm hover:bg-black transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
            >
              <Printer className="w-4 h-4" />
              طباعة
            </button>

            {canEdit && onEdit && (
              <button
                onClick={onEdit}
                className="min-h-[44px] py-2.5 px-4 bg-blue-50 text-[#0A468C] border border-blue-200 rounded-2xl font-black text-xs sm:text-sm hover:bg-[#0A468C] hover:text-white transition-all flex items-center justify-center gap-1.5"
              >
                <Edit2 className="w-4 h-4" />
                {editLabel}
              </button>
            )}

            {canCancel && onCancelOrder && (
              <button
                onClick={() => {
                  setActionError(null);
                  setShowCancelDialog(true);
                }}
                className="min-h-[44px] py-2.5 px-4 bg-red-50 text-red-700 border border-red-200 rounded-2xl font-black text-xs sm:text-sm hover:bg-red-600 hover:text-white transition-all flex items-center justify-center gap-1.5"
              >
                <XCircle className="w-4 h-4" />
                إلغاء الفاتورة
              </button>
            )}

            <button
              onClick={onClose}
              className="min-h-[44px] py-2.5 px-4 bg-white text-slate-600 rounded-2xl font-black text-xs sm:text-sm border border-slate-200 hover:bg-slate-100 transition-all col-span-2 sm:col-span-1"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>

      {/* Inline Cancel Reason Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[760] font-cairo">
          <form
            onSubmit={(e) => void handleCancelSubmit(e)}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-[2rem] p-5 sm:p-6 pb-safe shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base sm:text-lg font-black text-red-700 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                إلغاء الفاتورة #{order.id}
              </h3>
              <button
                type="button"
                onClick={() => setShowCancelDialog(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs font-bold text-slate-600 leading-relaxed">
              تتحول الفاتورة إلى حالة "ملغي" مع الاحتفاظ بسجلها الكامل في النظام ولن يتم حذفها.
            </p>
            <div>
              <label className="block text-xs font-black text-slate-800 mb-1.5">
                سبب الإلغاء (إلزامي) *
              </label>
              <textarea
                rows={3}
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="اكتب سبب الإلغاء بوضوح (مثال: تراجع العميل قبل التأكيد)..."
                className="w-full px-3.5 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-red-500 outline-none font-bold text-sm"
              />
            </div>
            <div className="flex gap-2.5">
              <button
                type="submit"
                disabled={isCancelling}
                className="flex-1 min-h-[46px] py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm disabled:opacity-60"
              >
                {isCancelling ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
              </button>
              <button
                type="button"
                onClick={() => setShowCancelDialog(false)}
                className="min-h-[46px] px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm"
              >
                تراجع
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Invoice;
