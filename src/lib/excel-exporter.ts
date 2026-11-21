import ExcelJS from 'exceljs';
import type { UnifiedReportPayload } from '../db/analyticsQueries.ts';
import { formatUnitTotalsSummary } from './unit-conversion.ts';
import { formatCairoYmd } from './date-utils.ts';

export async function buildUnifiedReportWorkbookBuffer(
  report: UnifiedReportPayload,
  actorName: string,
  companyName = 'Kima Scent Wholesale'
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = companyName;
  workbook.created = new Date();

  const sheetTitle = report.titleAr.replace(/[*?:\\/\[\]]/g, ' ').slice(0, 31).trim() || 'Report';
  const sheet = workbook.addWorksheet(sheetTitle, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 6 }],
  });

  const colCount = Math.max(1, report.columns.length);
  const lastColLetter = sheet.getColumn(colCount).letter;

  // Row 1: Company + Report Title
  sheet.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${companyName} — ${report.titleAr}`;
  titleCell.font = { name: 'Cairo', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(1).height = 30;

  // Row 2: Subtitle + Metadata
  sheet.mergeCells(`A2:${lastColLetter}2`);
  const metaCell = sheet.getCell('A2');
  metaCell.value = `${report.subtitleAr} | ${report.appliedFilterSummary}`;
  metaCell.font = { name: 'Cairo', size: 10, color: { argb: 'FF334155' } };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  metaCell.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(2).height = 22;

  // Row 3: Export signature
  sheet.mergeCells(`A3:${lastColLetter}3`);
  const sigCell = sheet.getCell('A3');
  sigCell.value = `تاريخ التصدير: ${formatCairoYmd()} | بواسطة: ${actorName} | عدد السجلات: ${report.rows.length}`;
  sigCell.font = { name: 'Cairo', size: 9, color: { argb: 'FF64748B' } };
  sigCell.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(3).height = 18;

  // Row 4: Summary KPIs strip
  sheet.mergeCells(`A4:${lastColLetter}4`);
  const summaryCell = sheet.getCell('A4');
  summaryCell.value = report.summaryCards.map((c) => `${c.label}: ${c.value}`).join('   |   ');
  summaryCell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FF065F46' } };
  summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
  summaryCell.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(4).height = 22;

  // Row 5: spacer
  sheet.getRow(5).height = 8;

  // Row 6: Table Header
  const headerRow = sheet.getRow(6);
  headerRow.height = 26;
  report.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'thin', color: { argb: 'FF334155' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });

  // Track max lengths for column sizing
  const colWidths = report.columns.map((c) => Math.max(14, c.label.length + 4));

  // Data rows
  report.rows.forEach((rowObj, rowIdx) => {
    const excelRow = sheet.getRow(7 + rowIdx);
    excelRow.height = 20;
    const isAlt = rowIdx % 2 === 1;

    report.columns.forEach((col, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      const rawVal = rowObj[col.key];

      if (rawVal === null || rawVal === undefined || rawVal === '') {
        cell.value = '-';
      } else if (
        (col.format === 'currency' || col.format === 'number' || col.format === 'percent') &&
        typeof rawVal === 'number'
      ) {
        cell.value = rawVal;
        if (col.format === 'currency') {
          cell.numFmt = '#,##0.00';
        } else if (col.format === 'percent') {
          cell.numFmt = '0.0"%"';
        } else {
          cell.numFmt = '#,##0.####';
        }
      } else {
        cell.value = String(rawVal);
      }

      const strLen = String(cell.value ?? '').length;
      colWidths[colIdx] = Math.min(48, Math.max(colWidths[colIdx], strLen + 4));

      cell.font = { name: 'Cairo', size: 10, color: { argb: 'FF0F172A' } };
      cell.fill = isAlt
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      cell.alignment = {
        horizontal:
          col.format === 'currency' || col.format === 'number' || col.format === 'percent'
            ? 'center'
            : 'right',
        vertical: 'middle',
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  // Optional unit-safe summary row at bottom
  if (report.unitTotals && report.unitTotals.length > 0) {
    const footerRowIdx = 7 + report.rows.length + 1;
    sheet.mergeCells(`A${footerRowIdx}:${lastColLetter}${footerRowIdx}`);
    const footerCell = sheet.getCell(`A${footerRowIdx}`);
    footerCell.value = `ملخص الكميات (مفصولة حسب الوحدة): ${formatUnitTotalsSummary(report.unitTotals)}`;
    footerCell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    footerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    footerCell.alignment = { horizontal: 'right', vertical: 'middle' };
    sheet.getRow(footerRowIdx).height = 24;
  }

  report.columns.forEach((_col, i) => {
    sheet.getColumn(i + 1).width = colWidths[i];
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
