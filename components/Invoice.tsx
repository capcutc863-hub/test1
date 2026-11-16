import React, { useState } from 'react';
import { Order } from '../types';
import { Download, Printer, Phone, MapPin, Info, Edit2, Check } from 'lucide-react';

interface InvoiceProps {
  order: Order;
  canEdit?: boolean;
  editLabel?: string;
  onEdit?: () => void;
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
  const custAddrLines = wrapTextLines(
    mctx,
    `العنوان: ${order.customerAddress || 'الاستلام من المقر'}`,
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
    const gradeLabel = `${item.grade}${item.isCustom ? ' · طلب مخصوص' : ''}`;
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

  // Order ID Pill
  const orderIdText = `#${order.id.slice(0, 10)}`;
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

  // Status Pill on Left bottom
  ctx.save();
  ctx.font = '900 11px Cairo, sans-serif';
  const statusW = ctx.measureText(order.status).width + 24;
  const statusH = 26;
  const statusX = leftX + 16;
  const statusY = y + infoBoxH - 16 - statusH;
  drawRoundedRect(ctx, statusX, statusY, statusW, statusH, 8);
  ctx.fillStyle = '#072F5F';
  ctx.fill();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(order.status, statusX + statusW / 2, statusY + statusH / 2 + 1);
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
    ctx.fillText(`${item.quantity.toLocaleString()} mg`, colQtyCenterX, rowMidY);
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

export const Invoice: React.FC<InvoiceProps> = ({
  order,
  canEdit = false,
  editLabel = 'تعديل',
  onEdit,
  onClose,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadImage = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadDone(false);

    try {
      const canvas = await renderInvoiceToCanvas(order);
      const fileName = `KimaScent-Invoice-${order.id}.png`;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png', 1.0)
      );

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
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 2500);
    } catch (err) {
      console.error('Invoice export failed:', err);
      setDownloadError('تعذر حفظ صورة الفاتورة، يرجى المحاولة مرة أخرى أو استخدام زر الطباعة.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[#072F5F]/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[700] overflow-y-auto font-cairo print:static print:bg-white print:p-0 print:block print:overflow-visible"
      dir="rtl"
    >
      <div className="bg-white w-full max-w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] border border-blue-900/15 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 print:max-w-full print:w-full print:rounded-none print:shadow-none print:border-0 print:max-h-none print:my-0">
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
                    <span>{order.customerAddress || 'الاستلام من المقر'}</span>
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
                <span className="inline-block bg-[#072F5F] text-white px-2.5 sm:px-3 py-1 rounded-lg text-[10px] sm:text-[11px] font-black w-fit whitespace-nowrap">
                  {order.status}
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
                          {item.grade}
                          {item.isCustom ? ' · طلب مخصوص' : ''}
                        </p>
                      </td>
                      <td className="py-3 px-2 text-center font-bold text-slate-700 text-xs tabular-nums align-top whitespace-nowrap">
                        <span dir="ltr" className="inline-block">
                          {item.quantity.toLocaleString()} mg
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
              </div>
            </div>

            {/* Clean Footer */}
            <div className="mt-6 pt-3.5 border-t border-slate-100 text-center text-[11px] font-bold text-slate-400">
              Kima Scent — Inspired by Purity
            </div>
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="bg-slate-50 p-3.5 sm:p-4 pb-safe space-y-2 border-t border-slate-200 no-print shrink-0">
          {downloadError && (
            <p className="text-xs font-bold text-red-600 text-center">{downloadError}</p>
          )}
          <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2">
            <button
              onClick={() => void downloadImage()}
              disabled={isDownloading}
              className="min-h-[46px] sm:flex-1 bg-[#0A468C] text-white py-2.5 px-3 rounded-2xl font-black text-xs sm:text-sm hover:bg-[#072F5F] transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
            >
              {downloadDone ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {isDownloading ? 'جاري الحفظ...' : downloadDone ? 'تم الحفظ' : 'حفظ كصورة'}
            </button>

            <button
              onClick={() => window.print()}
              className="min-h-[46px] sm:flex-1 bg-[#072F5F] text-white py-2.5 px-3 rounded-2xl font-black text-xs sm:text-sm hover:bg-black transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
            >
              <Printer className="w-4 h-4" />
              طباعة
            </button>

            {canEdit && onEdit && (
              <button
                onClick={onEdit}
                className="min-h-[46px] py-2.5 px-4 bg-blue-50 text-[#0A468C] border border-blue-200 rounded-2xl font-black text-xs sm:text-sm hover:bg-[#0A468C] hover:text-white transition-all flex items-center justify-center gap-1.5"
              >
                <Edit2 className="w-4 h-4" />
                {editLabel}
              </button>
            )}

            <button
              onClick={onClose}
              className={`min-h-[46px] py-2.5 px-4 bg-white text-slate-600 rounded-2xl font-black text-xs sm:text-sm border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all ${
                canEdit && onEdit ? '' : 'col-span-2 sm:col-span-1'
              }`}
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Invoice;
