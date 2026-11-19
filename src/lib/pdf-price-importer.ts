import { GoogleGenAI, Type } from '@google/genai';
import { DEFAULT_CATEGORIES } from './commission-utils.ts';
import {
  classifyProductName,
  normalizeArabicDisplay,
  normalizeArabicForSearch,
} from './product-classifier.ts';
import { PDFParse } from 'pdf-parse';
import type {
  PriceListColumnMapping,
  PriceListColumnRole,
  PriceListParsedItem,
  PriceListSinglePriceMeaning,
  Product,
  ProductCategory,
  ProductUnit,
} from '../../types.ts';

export interface PdfExtractionOptions {
  listCategoryId?: string | null;
  columnMapping?: PriceListColumnMapping | null;
  rawRowsOverride?: string[][];
}

export interface PdfExtractionOutput {
  extractionMethod: 'pdf_text' | 'pdf_ocr_gemini' | 'pdf_hybrid';
  listCategoryId: string | null;
  listCategoryName: string | null;
  columnMapping: PriceListColumnMapping | null;
  rawTableRows: string[][];
  parsedItems: PriceListParsedItem[];
  totalParsed: number;
  newCount: number;
  updatedCount: number;
  needsReviewCount: number;
  duplicateCount: number;
  rawTextPreview: string;
  errorMessage?: string | null;
}

const VALID_UNITS: Array<{ pattern: RegExp; canonical: ProductUnit }> = [
  {
    pattern: /(?:^|[\s/(\-\d])(mg|مجم|مليجرام|ملليغرام|ملغ)(?=$|[\s/)])/i,
    canonical: 'mg',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(كيلوجرام|كيلوغرام|كيلو|kilogram|kilo|kg)(?=$|[\s/)])/i,
    canonical: 'كيلوجرام',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(ملليلتر|مليلتر|ملل|مل|ml|milliliter)(?=$|[\s/)])/i,
    canonical: 'ملليلتر',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(جرام|غرام|جم|gram|grams|gm)(?=$|[\s/)])/i,
    canonical: 'جرام',
  },
  {
    pattern: /(?:^|[\s/\d])(g)(?=$|[\s/)])/i,
    canonical: 'جرام',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(لتر|ليتر|liter|litre|ltr)(?=$|[\s/)])/i,
    canonical: 'لتر',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(كرتونة|كرتون|كراتين|carton|ctn|box)(?=$|[\s/)])/i,
    canonical: 'كرتونة',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(دستة|درزن|dozen|doz)(?=$|[\s/)])/i,
    canonical: 'دستة',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(جركن|جالون|gallon|jerrycan)(?=$|[\s/)])/i,
    canonical: 'جركن',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(عبوة|عبوات|قارورة|flacon|vial)(?=$|[\s/)])/i,
    canonical: 'عبوة',
  },
  {
    pattern: /(?:^|[\s/(\-\d])(قطعة|قطع|حبة|زجاجة|pcs|pc|piece|pieces|unit)(?=$|[\s/)])/i,
    canonical: 'قطعة',
  },
];

export function detectUnit(
  text: string,
  fallback: ProductUnit = 'قطعة'
): { unit: ProductUnit; matched: boolean } {
  const norm = normalizeArabicDisplay(text);
  for (const entry of VALID_UNITS) {
    if (entry.pattern.test(norm)) {
      return { unit: entry.canonical, matched: true };
    }
  }
  return { unit: fallback, matched: false };
}

function roundUnitPrice(val: number): number {
  return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

function parseNumericToken(token: string): number | null {
  const norm = normalizeArabicDisplay(token);
  const cleaned = norm.replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const val = Number.parseFloat(cleaned);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function isPureNumericCell(cell: string): boolean {
  const norm = normalizeArabicDisplay(cell).trim();
  return /^[\d,]+(?:\.\d+)?\s*(?:ج\.?م|جنيه|egp|le)?$/i.test(norm);
}

function isLikelyCodeCell(cell: string): boolean {
  const norm = normalizeArabicDisplay(cell).trim();
  if (!norm || norm.length > 26 || /\s{2,}/.test(norm)) return false;
  // Standard code patterns: MMA1231, OIL-001, G-168-AM, S-168-AM, PKG50, CHM_01
  if (/^[A-Za-z][A-Za-z0-9]{0,9}(?:[-_][A-Za-z0-9]{1,8}){1,3}$/.test(norm)) return true;
  if (/^[A-Za-z]{2,8}\d{2,8}[A-Za-z]?$/.test(norm)) return true;
  if (/^[A-Za-z]\s*-\s*\d{1,6}\s*-\s*[A-Za-z]{1,6}$/.test(norm)) return true;
  return false;
}

function normalizeCodeToken(rawCode: string): string {
  return normalizeArabicDisplay(rawCode)
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function stitchSpacedHyphenCodes(line: string): string {
  return line.replace(
    /\b([A-Za-z]{1,4})\s*-\s*(\d{1,6})\s*-\s*([A-Za-z]{1,6})\b/g,
    '$1-$2-$3'
  );
}

function isNoiseOrBannerLine(line: string): boolean {
  const norm = normalizeArabicDisplay(line);
  if (!norm || norm.length < 3) return true;
  if (/^[-_=*~.•\s\d/]+$/.test(norm)) return true;
  if (/^(page|صفحة)\s*\d+/i.test(norm)) return true;
  if (/^[-–—\s]*\d+\s+(?:of|من)\s+\d+[-–—\s]*$/i.test(norm)) return true;
  // Promotional footers or contact banners with phone numbers / bullet slogans
  if (/(متاح من اول|للحجز|للتواصل|واتساب|هاتف|تليفون|whatsapp|silver\s*و\s*golden)/i.test(norm) && !isLikelyCodeCell(norm)) {
    const hasPriceCodePair =
      /[A-Za-z]{2,}\d{2,}|[A-Za-z]+-\d+/.test(norm) && /\d{2,}/.test(norm);
    if (!hasPriceCodePair) return true;
  }
  return false;
}

function splitLineIntoCells(line: string): string[] {
  const stitched = stitchSpacedHyphenCodes(normalizeArabicDisplay(line));
  if (stitched.includes('|')) {
    return stitched
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }
  if (stitched.includes('\t')) {
    return stitched
      .split('\t')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }
  if (stitched.includes(';')) {
    return stitched
      .split(';')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }
  const multiSpace = stitched
    .split(/\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (multiSpace.length >= 2) return multiSpace;
  return [stitched];
}

function classifyHeaderCellRole(cell: string): PriceListColumnRole | null {
  const norm = normalizeArabicForSearch(cell);
  if (!norm) return null;

  if (/^(n|no|#|\u0645|م|مسلسل|ت|sr|seq)$/.test(norm)) return 'ignore';
  if (/(الكود|كود|code|sku|رقم الصنف|رمز)/.test(norm)) return 'code';
  if (/(الصنف|اسم الصنف|المنتج|اسم المنتج|اسم|item|product|name)/.test(norm)) return 'name';
  if (/(designer|براند|وصف|الوصف|تفاصيل|مواصفات|ملاحظات|description|brand|notes)/.test(norm)) {
    return 'description';
  }
  if (/(الوحده|الوحدة|وحده|وحدة|unit|uom)/.test(norm)) return 'unit';

  // Weight/Kilo header columns (e.g., "1 kG", "سعر الكيلو")
  if (/(?:1\s*kg|سعر الكيلو|الكيلو|كيلوجرام|per kg|\/kg)/.test(norm)) return 'pricePerKg';
  if (/(?:1\s*g|سعر الجرام|سعر الغرام|per gram|\/g)/.test(norm)) return 'pricePerGram';
  // Sub-weight pack columns (500 G, 250 G, 125 G, 50 G) -> ignore so they never override 1 kG or become costPrice
  if (/^\d{2,3}\s*(?:g|جم|جرام)$/i.test(norm)) return 'ignore';

  if (/(سعر الشراء|سعر التكلف[هة]|التكلف[هة]|تكلف[هة]|شراء|cost|buy|purchase|wholesale cost)/.test(norm)) {
    return 'costPrice';
  }
  if (/(سعر البيع|البيع|جمل[هة]|سعر الجمل[هة]|selling|sale|retail|unit price)/.test(norm)) {
    return 'sellingPrice';
  }
  if (/^(السعر|سعر|price)$/.test(norm)) {
    return 'sellingPrice'; // note: treated separately if no explicit sell/cost label!
  }
  return null;
}

function isHeaderRowCells(cells: string[]): boolean {
  if (cells.length < 2) return false;
  let semanticHits = 0;
  let hasCodeOrName = false;
  for (const c of cells) {
    const role = classifyHeaderCellRole(c);
    if (role) {
      semanticHits += 1;
      if (role === 'code' || role === 'name') hasCodeOrName = true;
    }
  }
  return semanticHits >= 2 && hasCodeOrName;
}

function inferColumnMappingFromRows(
  rows: string[][]
): { mapping: PriceListColumnMapping | null; headerRowIndex: number; headerExplicitlyAmbiguousPrice: boolean } {
  for (let rIdx = 0; rIdx < Math.min(rows.length, 15); rIdx++) {
    const row = rows[rIdx];
    if (!isHeaderRowCells(row)) continue;

    const columns: Record<number, PriceListColumnRole> = {};
    let hasAmbiguousPriceHeader = false;
    let oilSourceUnit: PriceListColumnMapping['oilSourceUnit'] = 'auto';

    row.forEach((cell, colIdx) => {
      const norm = normalizeArabicForSearch(cell);
      const role = classifyHeaderCellRole(cell);
      if (role) {
        columns[colIdx] = role;
        if (role === 'pricePerKg') oilSourceUnit = 'كيلوجرام';
        if (role === 'pricePerGram') oilSourceUnit = 'جرام';
        if (/^(السعر|سعر|price)$/.test(norm)) {
          hasAmbiguousPriceHeader = true;
        }
      } else {
        columns[colIdx] = 'ignore';
      }
    });

    return {
      mapping: {
        hasHeaderRow: true,
        columns,
        oilSourceUnit,
      },
      headerRowIndex: rIdx,
      headerExplicitlyAmbiguousPrice: hasAmbiguousPriceHeader,
    };
  }
  return { mapping: null, headerRowIndex: -1, headerExplicitlyAmbiguousPrice: false };
}

export function extractRawTableRowsFromText(rawText: string): string[][] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => normalizeArabicDisplay(l))
    .filter((l) => !isNoiseOrBannerLine(l));

  return lines.map((l) => splitLineIntoCells(l));
}

interface RawCandidateItem {
  code?: string;
  name?: string;
  description?: string;
  categoryHint?: string;
  unit?: string;
  sellingPrice?: number | null;
  costPrice?: number | null;
  singleUnclearPrice?: number | null;
  priceSourceUnit?: 'كيلوجرام' | 'جرام' | 'auto' | ProductUnit;
  costSourceUnit?: 'كيلوجرام' | 'جرام' | 'auto' | ProductUnit;
  confidence?: number;
}

export function parseStructuredTableRows(
  rawRows: string[][],
  categories: ProductCategory[],
  explicitMapping?: PriceListColumnMapping | null,
  listCategoryId?: string | null
): {
  candidates: RawCandidateItem[];
  resolvedMapping: PriceListColumnMapping | null;
} {
  const inferred = inferColumnMappingFromRows(rawRows);
  const mapping = explicitMapping || inferred.mapping;
  const headerIsAmbiguousSinglePrice = !explicitMapping && inferred.headerExplicitlyAmbiguousPrice;
  const headerRowIdx = explicitMapping
    ? (explicitMapping.hasHeaderRow !== false && inferred.headerRowIndex >= 0 ? inferred.headerRowIndex : -1)
    : inferred.headerRowIndex;

  // Check if entire header / document declares kilo pricing for oils
  const allHeaderText = headerRowIdx >= 0 && rawRows[headerRowIdx] ? rawRows[headerRowIdx].join(' ') : '';
  const docHeaderUnit = detectUnit(allHeaderText, 'قطعة');

  const candidates: RawCandidateItem[] = [];

  for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
    const cells = rawRows[rIdx];
    if (!cells || cells.length === 0) continue;
    if (rIdx <= headerRowIdx) continue;
    // Skip repeated table headers on subsequent pages
    if (isHeaderRowCells(cells)) continue;

    // 1. Mapped Column Extraction (Exact & Serial-Immune)
    if (mapping && cells.length >= 2) {
      let code = '';
      let name = '';
      let description = '';
      let unitStr = '';
      let sellFromKg: number | null = null;
      let sellFromGram: number | null = null;
      let explicitSell: number | null = null;
      let explicitCost: number | null = null;

      // Support shifting alignment when serial column `N` was merged/missing cleanly
      const colEntries = Object.entries(mapping.columns);
      const mappedColCount = colEntries.length;
      const colShift =
        cells.length === mappedColCount - 1 && mapping.columns[0] === 'ignore' ? -1 : 0;

      for (let cIdx = 0; cIdx < cells.length; cIdx++) {
        const val = cells[cIdx]?.trim() || '';
        if (!val) continue;
        const mappedKey = cIdx - colShift;
        const role: PriceListColumnRole = mapping.columns[mappedKey] || 'ignore';

        if (role === 'ignore') continue;
        if (role === 'code') {
          code = normalizeCodeToken(val);
        } else if (role === 'name') {
          name = name ? `${name} ${val}` : val;
        } else if (role === 'description') {
          description = description ? `${description} · ${val}` : val;
        } else if (role === 'unit') {
          const u = detectUnit(val, 'قطعة');
          unitStr = u.matched ? u.unit : val;
        } else if (role === 'pricePerKg') {
          const n = parseNumericToken(val);
          if (n !== null) sellFromKg = n;
        } else if (role === 'pricePerGram') {
          const n = parseNumericToken(val);
          if (n !== null) sellFromGram = n;
        } else if (role === 'sellingPrice') {
          const n = parseNumericToken(val);
          if (n !== null) explicitSell = n;
        } else if (role === 'costPrice') {
          const n = parseNumericToken(val);
          if (n !== null) explicitCost = n;
        }
      }

      // Stitch wrapped description line onto previous candidate if this row has text but no code/price
      if (
        !code &&
        explicitSell === null &&
        explicitCost === null &&
        sellFromKg === null &&
        sellFromGram === null &&
        (name || description) &&
        candidates.length > 0
      ) {
        const prev = candidates[candidates.length - 1];
        const extra = [name, description].filter(Boolean).join(' ');
        prev.description = prev.description ? `${prev.description} · ${extra}` : extra;
        continue;
      }

      // Also scan name/description if unit wasn't in separate unit column
      if (!unitStr) {
        const uFromText = detectUnit(`${name} ${description}`, 'قطعة');
        if (uFromText.matched) unitStr = uFromText.unit;
        else if (docHeaderUnit.matched) unitStr = docHeaderUnit.unit;
      }

      const oilUnitPref = mapping.oilSourceUnit || 'auto';
      let priceSourceUnit: RawCandidateItem['priceSourceUnit'] = 'auto';
      let costSourceUnit: RawCandidateItem['costSourceUnit'] = 'auto';

      let finalSell = sellFromKg ?? sellFromGram ?? explicitSell;
      const finalCost = explicitCost;
      let singleUnclear: number | null = null;

      if (sellFromKg !== null) {
        priceSourceUnit = 'كيلوجرام';
        costSourceUnit = 'كيلوجرام';
      } else if (sellFromGram !== null) {
        priceSourceUnit = 'جرام';
        costSourceUnit = 'جرام';
      } else if (oilUnitPref === 'كيلوجرام') {
        priceSourceUnit = 'كيلوجرام';
        costSourceUnit = 'كيلوجرام';
      } else if (oilUnitPref === 'جرام') {
        priceSourceUnit = 'جرام';
        costSourceUnit = 'جرام';
      } else if (unitStr === 'كيلوجرام') {
        priceSourceUnit = 'كيلوجرام';
        costSourceUnit = 'كيلوجرام';
      } else if (unitStr === 'جرام') {
        priceSourceUnit = 'جرام';
        costSourceUnit = 'جرام';
      }

      if (headerIsAmbiguousSinglePrice && finalSell !== null && finalCost === null) {
        singleUnclear = finalSell;
        finalSell = null;
      }

      if (!name && !code && finalSell === null && finalCost === null && singleUnclear === null) {
        continue;
      }

      candidates.push({
        code,
        name: name || code,
        description,
        unit: unitStr,
        sellingPrice: finalSell,
        costPrice: finalCost,
        singleUnclearPrice: singleUnclear,
        priceSourceUnit,
        costSourceUnit,
        confidence: code && (finalSell !== null || finalCost !== null) ? 92 : 70,
      });
      continue;
    }

    // 2. Heuristic Parsing for Unmapped / Mixed Rows
    const joinedLine = cells.join('  ');
    let code = '';
    const nameParts: string[] = [];
    let description = '';
    let detectedCategoryHint = '';
    let unitStr = '';
    let explicitSell: number | null = null;
    let explicitCost: number | null = null;
    const standaloneNumbers: number[] = [];
    let priceSourceUnit: RawCandidateItem['priceSourceUnit'] = 'auto';

    if (cells.length >= 3) {
      for (let idx = 0; idx < cells.length; idx++) {
        const cell = cells[idx];
        // Ignore leading serial number (1, 2, 3...) when first cell is a small integer and next cell is a code
        if (
          idx === 0 &&
          /^\d{1,4}$/.test(cell) &&
          Number(cell) < 2000 &&
          cells[1] &&
          isLikelyCodeCell(cells[1])
        ) {
          continue;
        }

        if (!code && isLikelyCodeCell(cell)) {
          code = normalizeCodeToken(cell);
          continue;
        }

        const normCell = normalizeArabicForSearch(cell);
        const sellLabelMatch = normCell.match(/(?:سعر\s*البيع|بيع|selling|sell)\s*[:=]?\s*([\d.,]+)/i);
        const costLabelMatch = normCell.match(/(?:سعر\s*الشراء|تكلفه|شراء|cost|buy)\s*[:=]?\s*([\d.,]+)/i);
        if (sellLabelMatch) {
          explicitSell = parseNumericToken(sellLabelMatch[1]);
          const u = detectUnit(cell, 'قطعة');
          if (u.matched) priceSourceUnit = u.unit;
          continue;
        }
        if (costLabelMatch) {
          explicitCost = parseNumericToken(costLabelMatch[1]);
          continue;
        }

        if (isPureNumericCell(cell)) {
          const num = parseNumericToken(cell);
          if (num !== null) standaloneNumbers.push(num);
          continue;
        }

        const uCheck = detectUnit(cell, 'قطعة');
        if (uCheck.matched && cell.length <= 18 && nameParts.length > 0) {
          unitStr = uCheck.unit;
          continue;
        }

        const matchedCat = categories.find(
          (c) =>
            normalizeArabicForSearch(cell) === normalizeArabicForSearch(c.name) ||
            (cell.length <= 28 &&
              normalizeArabicForSearch(cell).includes(normalizeArabicForSearch(c.name)))
        );
        if (matchedCat && cell.length <= 28) {
          detectedCategoryHint = matchedCat.name;
          continue;
        }

        if (nameParts.length === 0) {
          nameParts.push(cell);
        } else {
          description = description ? `${description} · ${cell}` : cell;
        }
      }
    } else {
      // Single-column / space-delimited line
      const normLine = stitchSpacedHyphenCodes(normalizeArabicDisplay(joinedLine));
      const codeMatch = normLine.match(
        /(?:^|\s)([A-Za-z][A-Za-z0-9]{0,9}(?:[-_][A-Za-z0-9]{1,8}){1,3}|[A-Za-z]{2,8}\d{2,8})(?=$|\s)/
      );
      if (codeMatch) {
        code = normalizeCodeToken(codeMatch[1]);
      }
      const remaining = codeMatch ? normLine.replace(codeMatch[0], ' ').trim() : normLine;

      const sellMatch = remaining.match(/(?:سعر\s*البيع|بيع|selling|sell)\s*[:=]?\s*([\d.,]+)/i);
      const costMatch = remaining.match(/(?:سعر\s*الشراء|تكلفة|شراء|cost|buy)\s*[:=]?\s*([\d.,]+)/i);
      if (sellMatch) explicitSell = parseNumericToken(sellMatch[1]);
      if (costMatch) explicitCost = parseNumericToken(costMatch[1]);

      const numMatches = remaining.match(/(?:^|\s)([\d,]+(?:\.\d+)?)(?=$|\s)/g) || [];
      for (const n of numMatches) {
        const parsed = parseNumericToken(n);
        if (parsed !== null) standaloneNumbers.push(parsed);
      }

      const uCheck = detectUnit(remaining, 'قطعة');
      if (uCheck.matched) {
        unitStr = uCheck.unit;
        priceSourceUnit = uCheck.unit;
      }

      const cleanedName = remaining
        .replace(/(?:سعر\s*البيع|سعر\s*الشراء|بيع|شراء|تكلفة|selling|sell|cost|buy)\s*[:=]?\s*[\d.,]+/gi, '')
        .replace(/\b[\d.,]+\s*(?:ج\.?م|جنيه|egp|mg|مل|لتر|جرام|كيلوجرام|كيلو|قطعة|عبوة|دستة|كرتونة|جركن)\b/gi, '')
        .replace(/(?:^|\s)[\d,]+(?:\.\d+)?(?=$|\s)/g, ' ')
        .replace(/[|;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedName.length >= 2) {
        nameParts.push(cleanedName);
      }
    }

    const name = nameParts.join(' ').trim();
    if (!name && !code) continue;
    if (!code && standaloneNumbers.length === 0 && explicitSell === null && explicitCost === null) {
      // Continuation line of previous product?
      if (candidates.length > 0 && name.length >= 3) {
        const prev = candidates[candidates.length - 1];
        prev.description = prev.description ? `${prev.description} · ${name}` : name;
      }
      continue;
    }

    if (!unitStr && listCategoryId === 'cat-oils') {
      const unitInText = detectUnit(`${joinedLine} ${allHeaderText}`, 'قطعة');
      if (unitInText.matched) {
        unitStr = unitInText.unit;
        priceSourceUnit = unitInText.unit;
      }
    }

    let finalSell = explicitSell;
    let finalCost = explicitCost;
    let singleUnclear: number | null = null;

    if (finalSell === null && finalCost === null) {
      if (standaloneNumbers.length >= 2) {
        const [a, b] = standaloneNumbers;
        finalCost = Math.min(a, b);
        finalSell = Math.max(a, b);
      } else if (standaloneNumbers.length === 1) {
        singleUnclear = standaloneNumbers[0];
      }
    }

    candidates.push({
      code,
      name: name || code,
      description,
      categoryHint: detectedCategoryHint,
      unit: unitStr,
      sellingPrice: finalSell,
      costPrice: finalCost,
      singleUnclearPrice: singleUnclear,
      priceSourceUnit,
      costSourceUnit: priceSourceUnit,
      confidence: code && (finalSell !== null || finalCost !== null) ? 86 : 66,
    });
  }

  return { candidates, resolvedMapping: mapping };
}

async function extractWithGeminiMultimodal(
  base64Pdf: string,
  categories: ProductCategory[],
  rawTextHint: string,
  listCategoryName?: string | null
): Promise<RawCandidateItem[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });

  const catNames = categories.map((c) => c.name).join('، ');
  const prompt = `
    استخرج جدول/قائمة المنتجات والأسعار من ملف PDF المرفق بدقة تامة دون اختراع أي أرقام غير موجودة.
    ${listCategoryName ? `تصنيف القائمة المختار من المالك: ${listCategoryName}` : `التصنيفات المتاحة: ${catNames}.`}
    الوحدات المدعومة: mg، جرام، كيلوجرام، قطعة، عبوة، دستة، كرتونة، لتر، ملليلتر، جركن.
    ملاحظات صارمة:
    - تجاهل عمود المسلسل (N أو م أو #) ولا تضعه كسعر تكلفة أو بيع.
    - إذا كان السعر خاص بالكيلو للزيوت ضع "كيلوجرام" في priceSourceUnit، وإذا كان بالجرام ضع "جرام".
    - إذا كان الملف يذكر بوضوح "سعر البيع" ضعه في sellingPrice.
    - إذا كان يذكر بوضوح "سعر الشراء" أو "التكلفة" ضعه في costPrice.
    - إذا كان هناك سعر واحد فقط لكل صنف ولم يذكر الملف هل هو سعر بيع أم شراء، اترك sellingPrice و costPrice فارغين (null) وضع الرقم في singleUnclearPrice حتى يراجعه المالك.
    - استخرج كود المنتج الفريد كما هو في code.
    ${rawTextHint ? `نص مبدئي مستخرج للمساعدة:\n${rawTextHint.slice(0, 3000)}` : ''}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Pdf,
        },
      },
      prompt,
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                code: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                categoryHint: { type: Type.STRING },
                unit: { type: Type.STRING },
                priceSourceUnit: { type: Type.STRING },
                sellingPrice: { type: Type.NUMBER, nullable: true },
                costPrice: { type: Type.NUMBER, nullable: true },
                singleUnclearPrice: { type: Type.NUMBER, nullable: true },
                confidence: { type: Type.NUMBER },
              },
              required: ['name'],
            },
          },
        },
        required: ['items'],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{"items":[]}') as { items?: RawCandidateItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

function finalizeParsedItems(
  candidates: RawCandidateItem[],
  existingProducts: Product[],
  categories: ProductCategory[],
  listCategory?: ProductCategory | null
): Pick<
  PdfExtractionOutput,
  'parsedItems' | 'totalParsed' | 'newCount' | 'updatedCount' | 'needsReviewCount' | 'duplicateCount'
> {
  const seenCodes = new Set<string>();
  const seenNameUnitKeys = new Set<string>();
  const finalized: PriceListParsedItem[] = [];

  let newCount = 0;
  let updatedCount = 0;
  let needsReviewCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const raw = candidates[i];
    const cleanCode = raw.code ? normalizeCodeToken(raw.code) : '';
    const cleanName = normalizeArabicDisplay(raw.name || '');
    const cleanDesc = normalizeArabicDisplay(raw.description || '');
    const warnings: string[] = [];

    if (!cleanCode) {
      warnings.push('كود المنتج مفقود — يرجى إدخال كود فريد قبل الاعتماد');
    }
    if (!cleanName) {
      warnings.push('اسم المنتج مفقود');
    }

    // Category resolution: Owner-selected List Category has top priority
    let categoryId: string;
    let categoryName: string;
    let catConfident = true;

    if (listCategory) {
      categoryId = listCategory.id;
      categoryName = listCategory.name;
    } else if (raw.categoryHint) {
      const explicitCatMatch = categories.find(
        (c) => normalizeArabicForSearch(c.name) === normalizeArabicForSearch(raw.categoryHint || '')
      );
      if (explicitCatMatch) {
        categoryId = explicitCatMatch.id;
        categoryName = explicitCatMatch.name;
      } else {
        const auto = classifyProductName(`${cleanName} ${cleanDesc}`, categories);
        categoryId = auto.categoryId;
        categoryName = auto.categoryName;
        catConfident = auto.confident;
      }
    } else {
      const auto = classifyProductName(`${cleanName} ${cleanDesc}`, categories);
      categoryId = auto.categoryId;
      categoryName = auto.categoryName;
      catConfident = auto.confident;
    }

    const catObj = categories.find((c) => c.id === categoryId);
    const catDefaultUnit: ProductUnit =
      categoryId === 'cat-oils' ? 'جرام' : catObj?.defaultUnit || 'قطعة';

    const explicitUnitRes = raw.unit
      ? detectUnit(raw.unit, catDefaultUnit)
      : { unit: catDefaultUnit, matched: false };
    const unitRes = explicitUnitRes.matched
      ? explicitUnitRes
      : detectUnit(`${cleanName} ${cleanDesc}`, catDefaultUnit);

    let sellingPrice =
      typeof raw.sellingPrice === 'number' && Number.isFinite(raw.sellingPrice) && raw.sellingPrice > 0
        ? raw.sellingPrice
        : null;
    let costPrice =
      typeof raw.costPrice === 'number' && Number.isFinite(raw.costPrice) && raw.costPrice > 0
        ? raw.costPrice
        : null;
    const ambiguousSinglePrice =
      sellingPrice === null &&
      costPrice === null &&
      typeof raw.singleUnclearPrice === 'number' &&
      Number.isFinite(raw.singleUnclearPrice) &&
      raw.singleUnclearPrice > 0
        ? raw.singleUnclearPrice
        : null;

    let finalUnit: ProductUnit = unitRes.unit;
    let originalPrice: number | null = sellingPrice ?? ambiguousSinglePrice;
    let originalCostPrice: number | null = costPrice;
    let originalPriceUnit: string | null = unitRes.matched ? unitRes.unit : null;
    let conversionFactor: number | null = null;
    let conversionNote: string | null = null;

    const isOilItem = categoryId === 'cat-oils' || catObj?.slug === 'oils';
    if (isOilItem) {
      const srcUnit = raw.priceSourceUnit || (unitRes.matched ? unitRes.unit : 'auto');
      if (srcUnit === 'كيلوجرام') {
        finalUnit = 'جرام';
        originalPriceUnit = 'كيلوجرام';
        conversionFactor = 0.001;
        if (sellingPrice !== null) {
          originalPrice = sellingPrice;
          sellingPrice = roundUnitPrice(sellingPrice / 1000);
        }
        if (costPrice !== null) {
          originalCostPrice = costPrice;
          costPrice = roundUnitPrice(costPrice / 1000);
        }
        conversionNote =
          sellingPrice !== null
            ? `تم التحويل من سعر الكيلو (${originalPrice} ج.م / كجم) إلى الجرام (${sellingPrice} ج.م / جرام)`
            : 'قائمة بالكيلو — سيتم تحويل السعر إلى الجرام (÷ 1000) عند التحديد';
      } else if (srcUnit === 'جرام' || srcUnit === 'mg') {
        finalUnit = srcUnit;
        originalPriceUnit = srcUnit;
        conversionFactor = 1;
        conversionNote = `مسعر بالـ ${srcUnit} مباشرة دون قسمة`;
      } else {
        // Unclear oil pricing unit — do NOT guess/divide! Warn Owner.
        finalUnit = 'جرام';
        originalPriceUnit = null;
        warnings.push(
          'وحدة تسعير الزيت غير واضحة في الملف (كيلو أم جرام؟) — راجع السعر أو استخدم تعيين الأعمدة قبل الاعتماد'
        );
      }
    } else {
      // Non-oil categories (Packaging, Alcohol, Chemicals, Other): NEVER convert to grams!
      if (!unitRes.matched && catObj?.defaultUnit) {
        finalUnit = catObj.defaultUnit;
      }
      originalPriceUnit = finalUnit;
    }

    let singlePriceMeaning: PriceListSinglePriceMeaning = 'unresolved';
    if (sellingPrice !== null) singlePriceMeaning = 'selling';
    else if (costPrice !== null && sellingPrice === null && ambiguousSinglePrice === null) {
      singlePriceMeaning = 'cost';
    }

    if (ambiguousSinglePrice !== null) {
      warnings.push('يحتوي على سعر واحد غير محدد النوع — حدد هل هو سعر بيع أم سعر شراء');
    } else if (sellingPrice === null && costPrice === null) {
      warnings.push('لم يتم العثور على سعر واضح — يرجى مراجعة وإدخال السعر يدوياً');
    }

    let matchStatus: PriceListParsedItem['matchStatus'] = 'new';
    let matchedProduct: Product | undefined;
    let matchedBy: PriceListParsedItem['matchedBy'] = null;

    const codeKey = cleanCode.toLowerCase();
    const normNameKey = `${normalizeArabicForSearch(cleanName)}||${normalizeArabicForSearch(finalUnit)}`;

    if (cleanCode && seenCodes.has(codeKey)) {
      matchStatus = 'duplicate_in_file';
      duplicateCount += 1;
      warnings.push(`كود مكرر داخل نفس ملف PDF (${cleanCode}) — لن يتم إنشاء صنف مكرر`);
    } else if (cleanName && seenNameUnitKeys.has(normNameKey)) {
      matchStatus = 'duplicate_in_file';
      duplicateCount += 1;
      warnings.push(`صنف مكرر بنفس الاسم والوحدة داخل نفس ملف PDF (${cleanName})`);
    } else {
      if (cleanCode) seenCodes.add(codeKey);
      if (cleanName) seenNameUnitKeys.add(normNameKey);

      if (cleanCode) {
        matchedProduct = existingProducts.find(
          (p) => (p.code || '').trim().toLowerCase() === codeKey
        );
        if (matchedProduct) matchedBy = 'code';
      }
      if (!matchedProduct && cleanName) {
        const cleanSearchName = normalizeArabicForSearch(cleanName);
        matchedProduct = existingProducts.find(
          (p) =>
            normalizeArabicForSearch(p.name) === cleanSearchName &&
            (!finalUnit || normalizeArabicForSearch(p.unit) === normalizeArabicForSearch(finalUnit))
        );
        if (matchedProduct) matchedBy = 'normalized_name';
      }

      if (matchedProduct) {
        matchStatus = 'matched';
        updatedCount += 1;
      } else {
        newCount += 1;
      }
    }

    const baseConfidence =
      typeof raw.confidence === 'number' ? Math.min(100, Math.max(10, raw.confidence)) : 75;
    const penalty =
      (cleanCode ? 0 : 25) +
      (ambiguousSinglePrice !== null ? 20 : 0) +
      (sellingPrice === null && costPrice === null && ambiguousSinglePrice === null ? 25 : 0) +
      (matchStatus === 'duplicate_in_file' ? 35 : 0);
    const confidence = Math.max(10, Math.min(99, baseConfidence - penalty));

    const needsReview =
      warnings.length > 0 || !catConfident || matchStatus === 'duplicate_in_file';
    if (needsReview) {
      needsReviewCount += 1;
      if (matchStatus === 'new' && warnings.length > 0 && (!cleanCode || ambiguousSinglePrice !== null)) {
        matchStatus = 'needs_review';
      }
    }

    finalized.push({
      rowKey: `row-${i + 1}-${cleanCode || 'NOCODE'}`,
      code: cleanCode,
      name: cleanName,
      description: cleanDesc,
      suggestedCategoryId: categoryId,
      suggestedCategoryName: categoryName,
      unit: finalUnit,
      sellingPrice,
      costPrice,
      originalPrice,
      originalPriceUnit,
      originalCostPrice,
      conversionFactor,
      conversionNote,
      ambiguousSinglePrice,
      singlePriceMeaning,
      matchStatus,
      matchedBy,
      matchedProductId: matchedProduct?.id ?? null,
      matchedProductCurrent: matchedProduct
        ? {
            id: matchedProduct.id,
            code: matchedProduct.code,
            name: matchedProduct.name,
            categoryName: matchedProduct.categoryName,
            unit: matchedProduct.unit,
            pricePerMg: matchedProduct.pricePerMg,
            costPrice: matchedProduct.costPrice ?? null,
            description: matchedProduct.description,
            stock: matchedProduct.stock,
          }
        : null,
      confidence,
      warnings,
      needsReview,
      selectedForImport:
        matchStatus === 'duplicate_in_file'
          ? false
          : !cleanCode
            ? false
            : matchStatus === 'matched'
              ? true
              : Boolean(cleanCode && cleanName && sellingPrice !== null),
      updateFields: matchedProduct
        ? {
            name: false,
            description: Boolean(cleanDesc && cleanDesc !== (matchedProduct.description || '')),
            category: false,
            unit: false,
            sellingPrice: sellingPrice !== null,
            costPrice: costPrice !== null,
          }
        : undefined,
    });
  }

  return {
    parsedItems: finalized,
    totalParsed: finalized.length,
    newCount,
    updatedCount,
    needsReviewCount,
    duplicateCount,
  };
}

export function remapParsedTableRows(params: {
  rawTableRows: string[][];
  existingProducts: Product[];
  categoriesCatalog?: ProductCategory[];
  listCategoryId?: string | null;
  columnMapping?: PriceListColumnMapping | null;
}): Omit<PdfExtractionOutput, 'extractionMethod' | 'rawTextPreview' | 'errorMessage'> {
  const categories =
    params.categoriesCatalog && params.categoriesCatalog.length > 0
      ? params.categoriesCatalog
      : DEFAULT_CATEGORIES;
  const listCategory = params.listCategoryId
    ? categories.find((c) => c.id === params.listCategoryId) || null
    : null;

  const { candidates, resolvedMapping } = parseStructuredTableRows(
    params.rawTableRows,
    categories,
    params.columnMapping || null,
    listCategory?.id || null
  );

  const summary = finalizeParsedItems(
    candidates,
    params.existingProducts,
    categories,
    listCategory
  );

  return {
    listCategoryId: listCategory?.id ?? null,
    listCategoryName: listCategory?.name ?? null,
    columnMapping: resolvedMapping,
    rawTableRows: params.rawTableRows,
    ...summary,
  };
}

export async function extractPriceListFromPdfBuffer(
  buffer: Buffer,
  existingProducts: Product[],
  categoriesCatalog: ProductCategory[] = DEFAULT_CATEGORIES,
  options: PdfExtractionOptions = {}
): Promise<PdfExtractionOutput> {
  const categories =
    categoriesCatalog && categoriesCatalog.length > 0 ? categoriesCatalog : DEFAULT_CATEGORIES;
  const listCategory = options.listCategoryId
    ? categories.find((c) => c.id === options.listCategoryId) || null
    : null;

  let rawText = '';
  let textParseFailed = false;
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    rawText =
      typeof textResult === 'string'
        ? textResult
        : typeof (textResult as { text?: string })?.text === 'string'
          ? (textResult as { text: string }).text
          : '';
  } catch (err) {
    console.warn('PDF text extraction warning:', err);
    textParseFailed = true;
  } finally {
    await parser.destroy().catch(() => {});
  }

  const normalizedText = normalizeArabicDisplay(rawText);
  const trimmedText = rawText.trim();
  const isLikelyScanned = textParseFailed || normalizedText.length < 25;
  const base64Pdf = buffer.toString('base64');
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

  // Scanned/image-only PDF handling
  if (isLikelyScanned) {
    if (!hasGeminiKey) {
      return {
        extractionMethod: 'pdf_ocr_gemini',
        listCategoryId: listCategory?.id ?? null,
        listCategoryName: listCategory?.name ?? null,
        columnMapping: null,
        rawTableRows: [],
        parsedItems: [],
        totalParsed: 0,
        newCount: 0,
        updatedCount: 0,
        needsReviewCount: 0,
        duplicateCount: 0,
        rawTextPreview: normalizedText.slice(0, 500),
        errorMessage:
          'هذا الملف عبارة عن PDF مصور (بدون طبقة نصية قابلة للاستخراج). تفعيل قراءة OCR بالذكاء الاصطناعي يتطلب ضبط متغير GEMINI_API_KEY على الخادم. تم حفظ الملف الأصلي ويمكنك مراجعة السجل.',
      };
    }

    try {
      const candidates = await extractWithGeminiMultimodal(
        base64Pdf,
        categories,
        normalizedText,
        listCategory?.name
      );
      const summary = finalizeParsedItems(
        candidates,
        existingProducts,
        categories,
        listCategory
      );
      return {
        extractionMethod: 'pdf_ocr_gemini',
        listCategoryId: listCategory?.id ?? null,
        listCategoryName: listCategory?.name ?? null,
        columnMapping: null,
        rawTableRows: [],
        ...summary,
        rawTextPreview:
          normalizedText.slice(0, 800) || '[ملف PDF مصور تمت معالجته عبر Gemini OCR]',
        errorMessage:
          candidates.length === 0
            ? 'لم يتمكن محرك OCR من استخراج بنود واضحة من الصور داخل الملف.'
            : null,
      };
    } catch (ocrErr) {
      return {
        extractionMethod: 'pdf_ocr_gemini',
        listCategoryId: listCategory?.id ?? null,
        listCategoryName: listCategory?.name ?? null,
        columnMapping: null,
        rawTableRows: [],
        parsedItems: [],
        totalParsed: 0,
        newCount: 0,
        updatedCount: 0,
        needsReviewCount: 0,
        duplicateCount: 0,
        rawTextPreview: normalizedText.slice(0, 500),
        errorMessage:
          ocrErr instanceof Error
            ? `تعذرت قراءة الملف عبر OCR: ${ocrErr.message}`
            : 'تعذرت قراءة الملف عبر OCR.',
      };
    }
  }

  // Text/Table PDF deterministic extraction
  const rawTableRows =
    options.rawRowsOverride && options.rawRowsOverride.length > 0
      ? options.rawRowsOverride
      : extractRawTableRowsFromText(rawText);

  let { candidates, resolvedMapping } = parseStructuredTableRows(
    rawTableRows,
    categories,
    options.columnMapping || null,
    listCategory?.id || null
  );
  let method: PdfExtractionOutput['extractionMethod'] = 'pdf_text';

  if (candidates.length === 0 && hasGeminiKey) {
    try {
      const aiCandidates = await extractWithGeminiMultimodal(
        base64Pdf,
        categories,
        normalizedText,
        listCategory?.name
      );
      if (aiCandidates.length > 0) {
        candidates = aiCandidates;
        method = 'pdf_hybrid';
      }
    } catch (aiErr) {
      console.warn('Gemini hybrid fallback failed cleanly:', aiErr);
    }
  }

  const summary = finalizeParsedItems(candidates, existingProducts, categories, listCategory);
  return {
    extractionMethod: method,
    listCategoryId: listCategory?.id ?? null,
    listCategoryName: listCategory?.name ?? null,
    columnMapping: resolvedMapping,
    rawTableRows: rawTableRows.slice(0, 500),
    ...summary,
    rawTextPreview: normalizedText.slice(0, 1400),
    errorMessage:
      candidates.length === 0
        ? 'تم استخراج نص الملف ولكن لم يتم التعرف على صفوف منتجات/أسعار قياسية. يمكنك استخدام أداة تعيين الأعمدة أو مراجعة النص الخام.'
        : null,
  };
}
