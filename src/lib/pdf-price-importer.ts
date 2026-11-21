import { GoogleGenAI, Type } from '@google/genai';
import { DEFAULT_CATEGORIES } from './commission-utils.ts';
import {
  classifyProductName,
  normalizeArabicDisplay,
  normalizeArabicForSearch,
} from './product-classifier.ts';
import { normalizeProductUnit } from './unit-conversion.ts';
import { PDFParse } from 'pdf-parse';
import type {
  OilGradeRecord,
  PriceListBatchUnitConfig,
  PriceListColumnAssignment,
  PriceListColumnMapping,
  PriceListColumnRole,
  PriceListImportConfig,
  PriceListImportCounts,
  PriceListParsedItem,
  PriceListSinglePriceMeaning,
  Product,
  ProductCategory,
  ProductUnit,
} from '../../types.ts';

export const DEFAULT_OIL_GRADES: OilGradeRecord[] = [
  {
    id: 'grade-high',
    name: 'عالي',
    slug: 'high',
    sortOrder: 1,
    isActive: true,
    aliases: [
      'عالي (Code A)',
      'كود عالي',
      'سعر كود عالي',
      'Code A',
      'Grade A',
      'Golden',
      'Gold',
      'ممتاز',
      'درجة أولى',
      'A',
    ],
    description: 'الدرجة العالية (Code A / Golden)',
  },
  {
    id: 'grade-medium',
    name: 'وسط',
    slug: 'medium',
    sortOrder: 2,
    isActive: true,
    aliases: [
      'وسط (Code B)',
      'كود وسط',
      'سعر كود وسط',
      'Code B',
      'Grade B',
      'Silver',
      'درجة ثانية',
      'B',
    ],
    description: 'الدرجة المتوسطة (Code B / Silver)',
  },
  {
    id: 'grade-commercial',
    name: 'تجاري',
    slug: 'commercial',
    sortOrder: 3,
    isActive: true,
    aliases: [
      'تجاري (Code C)',
      'كود تجاري',
      'سعر كود تجاري',
      'Code C',
      'Grade C',
      'Commercial',
      'درجة ثالثة',
      'اقتصادي',
      'C',
    ],
    description: 'الدرجة التجارية (Code C)',
  },
];

export interface PdfExtractionOptions {
  listCategoryId?: string | null;
  columnMapping?: PriceListColumnMapping | null;
  rawRowsOverride?: string[][];
  oilGrades?: OilGradeRecord[];
}

export interface PdfExtractionOutput {
  extractionMethod: 'pdf_text' | 'pdf_ocr_gemini' | 'pdf_hybrid';
  listCategoryId: string | null;
  listCategoryName: string | null;
  columnMapping: PriceListColumnMapping | null;
  importConfig: PriceListImportConfig | null;
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
    pattern: /(?:^|[\s/(\-\d])(كيلوجرام|كيلوغرام|كيلو|كجم|kilogram|kilo|kg)(?=$|[\s/)])/i,
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

export function roundUnitPrice(val: number): number {
  return Math.round((val + Number.EPSILON) * 1_000_000) / 1_000_000;
}

/**
 * Computes the PRICE multiplier when converting price-per-sourceUnit to price-per-targetUnit.
 * Example: source = 'كيلوجرام', target = 'جرام' => factor = 0.001 (divide by 1000: 4000/kg -> 4/g).
 */
export function computePriceConversionFactor(
  sourceUnit: string,
  targetUnit: string
): { ok: true; factor: number } | { ok: false; reason: string } {
  const src = normalizeProductUnit(sourceUnit);
  const tgt = normalizeProductUnit(targetUnit);
  if (!src || !tgt) {
    return { ok: false, reason: 'وحدة القياس غير محددة.' };
  }
  if (src === tgt) {
    return { ok: true, factor: 1 };
  }
  const massToMg: Record<string, number> = {
    mg: 1,
    جرام: 1000,
    كيلوجرام: 1_000_000,
  };
  if (massToMg[src] && massToMg[tgt]) {
    // 1 src = ratio * tgt => price per tgt = price per src * (massToMg[tgt] / massToMg[src])
    return { ok: true, factor: massToMg[tgt] / massToMg[src] };
  }
  const volToMl: Record<string, number> = {
    ملليلتر: 1,
    لتر: 1000,
  };
  if (volToMl[src] && volToMl[tgt]) {
    return { ok: true, factor: volToMl[tgt] / volToMl[src] };
  }
  return {
    ok: false,
    reason: `لا يمكن التحويل التلقائي للأسعار بين "${src}" و"${tgt}".`,
  };
}

export function resolveOilGradeMatch(
  rawGradeText: string | null | undefined,
  gradesCatalog: OilGradeRecord[]
): {
  matched: boolean;
  gradeRecord: OilGradeRecord | null;
  canonicalName: string;
  gradeId: string | null;
} {
  const raw = normalizeArabicDisplay(rawGradeText || '');
  if (!raw) {
    return { matched: false, gradeRecord: null, canonicalName: '', gradeId: null };
  }
  const catalog = gradesCatalog && gradesCatalog.length > 0 ? gradesCatalog : DEFAULT_OIL_GRADES;
  const searchNorm = normalizeArabicForSearch(raw);

  // Build candidate tokens sorted longest-first to avoid partial matches
  const entries: Array<{ tokenNorm: string; grade: OilGradeRecord }> = [];
  for (const g of catalog) {
    const names = [g.name, ...(Array.isArray(g.aliases) ? g.aliases : [])];
    for (const alias of names) {
      const n = normalizeArabicForSearch(alias);
      if (n) entries.push({ tokenNorm: n, grade: g });
    }
  }
  entries.sort((a, b) => b.tokenNorm.length - a.tokenNorm.length);

  // 1. Exact full match
  for (const e of entries) {
    if (searchNorm === e.tokenNorm) {
      return {
        matched: true,
        gradeRecord: e.grade,
        canonicalName: e.grade.name,
        gradeId: e.grade.id,
      };
    }
  }

  // 2. Parenthesized / word-boundary match
  for (const e of entries) {
    if (e.tokenNorm.length <= 1) {
      // Single letter like 'A' / 'B' / 'C' must match "code a" / "(a)" explicitly
      const re = new RegExp(`(?:^|\\(|\\s|code\\s*)${escapeRegex(e.tokenNorm)}(?:$|\\)|\\s)`, 'i');
      if (re.test(searchNorm)) {
        return {
          matched: true,
          gradeRecord: e.grade,
          canonicalName: e.grade.name,
          gradeId: e.grade.id,
        };
      }
      continue;
    }
    const re = new RegExp(`(?:^|[\\s(\\-_/])${escapeRegex(e.tokenNorm)}(?=$|[\\s)\\-_/:])`, 'i');
    if (re.test(searchNorm)) {
      return {
        matched: true,
        gradeRecord: e.grade,
        canonicalName: e.grade.name,
        gradeId: e.grade.id,
      };
    }
  }

  return { matched: false, gradeRecord: null, canonicalName: raw, gradeId: null };
}

export function decodeUploadedFilename(rawName: string): string {
  const name = (rawName || '').trim();
  if (!name) return 'price-list.pdf';
  // Detect UTF-8 bytes misread as Latin-1 by multipart uploaders (e.g. "Ù‚Ø§Ø¦Ù…Ø©")
  if (/[\u00C0-\u00FF]/.test(name) && !/[\u0600-\u06FF]/.test(name)) {
    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      if (decoded && !decoded.includes('\uFFFD') && /[\u0600-\u06FF]/.test(decoded)) {
        return decoded;
      }
    } catch {
      // fall through to original
    }
  }
  return name;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractUnknownGradeHint(headerCell: string): string | null {
  const norm = normalizeArabicDisplay(headerCell);
  const parenMatch = norm.match(/\(([^()]{2,24})\)/);
  if (parenMatch) {
    return parenMatch[1].trim();
  }
  const codeWordMatch = norm.match(/(?:سعر\s*كود|كود|درجة|فئة)\s+([^\s()]{2,20})/);
  if (codeWordMatch) {
    return codeWordMatch[1].trim();
  }
  const stripped = norm
    .replace(/(?:سعر\s*البيع|سعر\s*الشراء|سعر\s*التكلفة|التكلفة|تكلفة|سعر\s*الكيلو|سعر\s*الجرام|سعر|selling|cost|price|buy|kg|gram|per|\/)/gi, '')
    .replace(/[()[\]:\-_]+/g, ' ')
    .trim();
  if (stripped.length >= 2 && stripped.length <= 24 && !/^\d+$/.test(stripped)) {
    return stripped;
  }
  return null;
}

function parseUnavailableOrPriceCell(cell: string): {
  value: number | null;
  isUnavailable: boolean;
} {
  const norm = normalizeArabicDisplay(cell).trim();
  if (!norm) return { value: null, isUnavailable: false };
  if (
    /^(?:-|—|–|_|n\/?a|none|null|غير\s*متوفر|غير\s*متاح|نفد|غير\s*موجود|\.{2,})$/i.test(norm)
  ) {
    return { value: null, isUnavailable: true };
  }
  const cleaned = norm.replace(/,/g, '').replace(/(?:ج\.?م|جنيه|egp|le)/gi, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    // Allow mixed price cell like "4000 ج.م / كجم"
    const m = cleaned.match(/(\d+(?:\.\d+)?)/);
    if (!m) return { value: null, isUnavailable: false };
    const val = Number.parseFloat(m[1]);
    return Number.isFinite(val) && val > 0
      ? { value: val, isUnavailable: false }
      : { value: null, isUnavailable: true };
  }
  const val = Number.parseFloat(cleaned);
  if (!Number.isFinite(val) || val <= 0) {
    return { value: null, isUnavailable: true };
  }
  return { value: val, isUnavailable: false };
}

function parseNumericToken(token: string): number | null {
  const res = parseUnavailableOrPriceCell(token);
  return res.value;
}

function isPureNumericCell(cell: string): boolean {
  const norm = normalizeArabicDisplay(cell).trim();
  return /^[\d,]+(?:\.\d+)?\s*(?:ج\.?م|جنيه|egp|le)?$/i.test(norm);
}

function isLikelyCodeCell(cell: string): boolean {
  const norm = normalizeArabicDisplay(cell).trim();
  if (!norm || norm.length > 26 || /\s{2,}/.test(norm)) return false;
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
  if (!norm || norm.length < 2) return true;
  if (/^[-_=*~.•\s/]+$/.test(norm)) return true;
  if (/^(page|صفحة)\s*\d+/i.test(norm)) return true;
  if (/^[-–—\s]*\d+\s+(?:of|من)\s+\d+[-–—\s]*$/i.test(norm)) return true;
  if (
    /(متاح من اول|للحجز|للتواصل|واتساب|هاتف|تليفون|whatsapp)/i.test(norm) &&
    !isLikelyCodeCell(norm)
  ) {
    const hasPriceCodePair =
      /[A-Za-z]{2,}\d{2,}|[A-Za-z]+-\d+/.test(norm) && /\d{2,}/.test(norm);
    if (!hasPriceCodePair) return true;
  }
  return false;
}

/**
 * Splits a raw text line into cells BEFORE collapsing whitespace so `\t` delimiters survive!
 */
function splitLineIntoCells(rawLine: string): string[] {
  const stitched = stitchSpacedHyphenCodes(rawLine.trim());
  if (!stitched) return [];
  if (stitched.includes('|')) {
    return stitched.split('|').map((c) => normalizeArabicDisplay(c));
  }
  if (stitched.includes('\t')) {
    return stitched.split('\t').map((c) => normalizeArabicDisplay(c));
  }
  if (stitched.includes(';')) {
    return stitched.split(';').map((c) => normalizeArabicDisplay(c));
  }
  const multiSpace = stitched
    .split(/\s{2,}/)
    .map((c) => normalizeArabicDisplay(c))
    .filter((c) => c.length > 0);
  if (multiSpace.length >= 2) return multiSpace;
  return [normalizeArabicDisplay(stitched)];
}

export function extractRawTableRowsFromText(rawText: string): string[][] {
  return rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\r/g, ''))
    .filter((l) => !isNoiseOrBannerLine(l))
    .map((l) => splitLineIntoCells(l))
    .filter((cells) => cells.some((c) => c.trim().length > 0));
}

function classifyHeaderCellRole(cell: string): {
  role: PriceListColumnRole | null;
  isAmbiguousBarePrice: boolean;
} {
  const norm = normalizeArabicForSearch(cell);
  if (!norm) return { role: null, isAmbiguousBarePrice: false };

  if (/^(#|n|no|م|مسلسل|ت|sr|seq|الرقم)$/.test(norm)) {
    return { role: 'serial', isAmbiguousBarePrice: false };
  }
  if (/(الصنف|اسم الصنف|المنتج|اسم المنتج|اسم العطر|اسم|item|product|name)/.test(norm)) {
    return { role: 'name', isAmbiguousBarePrice: false };
  }
  if (/(designer|براند|وصف|الوصف|تفاصيل|مواصفات|ملاحظات|description|brand|notes)/.test(norm)) {
    return { role: 'description', isAmbiguousBarePrice: false };
  }
  if (/(الوحده|الوحدة|وحده|وحدة|unit|uom)/.test(norm)) {
    return { role: 'unit', isAmbiguousBarePrice: false };
  }
  if (/^\d{2,3}\s*(?:g|جم|جرام)$/i.test(norm)) {
    return { role: 'ignore', isAmbiguousBarePrice: false };
  }
  // Check cost/purchase BEFORE code & selling price
  if (/(سعر الشراء|سعر التكلف[هة]|التكلف[هة]|تكلف[هة]|شراء|cost|buy|purchase|wholesale cost)/.test(norm)) {
    return { role: 'costPrice', isAmbiguousBarePrice: false };
  }
  if (/(?:1\s*kg|سعر الكيلو|لكل كيلو|\/\s*كجم|\/\s*kg|per kg)/.test(norm)) {
    return { role: 'pricePerKg', isAmbiguousBarePrice: false };
  }
  if (/(?:1\s*g|سعر الجرام|سعر الغرام|لكل جرام|\/\s*جم|\/\s*g|per gram)/.test(norm)) {
    return { role: 'pricePerGram', isAmbiguousBarePrice: false };
  }
  if (/(سعر البيع|البيع|سعر كود|سعر الجمل[هة]|سعر|selling|sale|retail|unit price)/.test(norm)) {
    const bare = /^(السعر|سعر|price)$/.test(norm);
    return { role: 'sellingPrice', isAmbiguousBarePrice: bare };
  }
  if (/(الكود|كود|code|sku|رقم الصنف|رمز)/.test(norm)) {
    return { role: 'code', isAmbiguousBarePrice: false };
  }
  return { role: null, isAmbiguousBarePrice: false };
}

function isHeaderRowCells(cells: string[]): boolean {
  if (cells.length < 2) return false;
  let semanticHits = 0;
  let hasCodeOrName = false;
  for (const c of cells) {
    const { role } = classifyHeaderCellRole(c);
    if (role && role !== 'ignore') {
      semanticHits += 1;
      if (role === 'code' || role === 'name') hasCodeOrName = true;
    }
  }
  return semanticHits >= 2 && hasCodeOrName;
}

interface AnalyzedMappingResult {
  mapping: PriceListColumnMapping | null;
  headerRowIndex: number;
  headerExplicitlyAmbiguousPrice: boolean;
  detectedGrades: Array<{
    name: string;
    gradeId?: string | null;
    matched: boolean;
    columnIndices: number[];
  }>;
  detectedHeaderUnit: ProductUnit | null;
  isMultiGradeTable: boolean;
}

function inferColumnMappingFromRows(
  rows: string[][],
  gradesCatalog: OilGradeRecord[]
): AnalyzedMappingResult {
  for (let rIdx = 0; rIdx < Math.min(rows.length, 15); rIdx++) {
    const row = rows[rIdx];
    if (!isHeaderRowCells(row)) continue;

    const columns: Record<number, PriceListColumnRole> = {};
    const columnConfigs: Record<number, PriceListColumnAssignment> = {};
    let hasAmbiguousPriceHeader = false;
    let oilSourceUnit: PriceListColumnMapping['oilSourceUnit'] = 'auto';
    let detectedHeaderUnit: ProductUnit | null = null;
    let nameColIdx = -1;

    row.forEach((cell, colIdx) => {
      const normCell = normalizeArabicDisplay(cell);
      const { role, isAmbiguousBarePrice } = classifyHeaderCellRole(normCell);
      const effectiveRole: PriceListColumnRole = role || 'ignore';
      columns[colIdx] = effectiveRole;

      const uHeader = detectUnit(normCell, 'قطعة');
      if (uHeader.matched && (uHeader.unit === 'كيلوجرام' || uHeader.unit === 'جرام')) {
        detectedHeaderUnit = uHeader.unit;
      }

      if (effectiveRole === 'name' && nameColIdx === -1) nameColIdx = colIdx;
      if (effectiveRole === 'pricePerKg') {
        oilSourceUnit = 'كيلوجرام';
        detectedHeaderUnit = 'كيلوجرام';
      }
      if (effectiveRole === 'pricePerGram') {
        oilSourceUnit = 'جرام';
        detectedHeaderUnit = 'جرام';
      }
      if (isAmbiguousBarePrice) hasAmbiguousPriceHeader = true;

      let gradeName: string | null = null;
      let gradeId: string | null = null;
      if (
        effectiveRole === 'sellingPrice' ||
        effectiveRole === 'costPrice' ||
        effectiveRole === 'pricePerKg' ||
        effectiveRole === 'pricePerGram' ||
        effectiveRole === 'code'
      ) {
        const gMatch = resolveOilGradeMatch(normCell, gradesCatalog);
        if (gMatch.matched) {
          gradeName = gMatch.canonicalName;
          gradeId = gMatch.gradeId;
        } else if (effectiveRole !== 'code') {
          const hint = extractUnknownGradeHint(normCell);
          if (hint && !detectUnit(hint, 'قطعة').matched) {
            gradeName = hint;
            gradeId = null;
          }
        }
      }

      columnConfigs[colIdx] = {
        role: effectiveRole,
        gradeId,
        gradeName,
        unit: uHeader.matched ? uHeader.unit : null,
      };
    });

    // Pair ungraded `code` columns with adjacent grade blocks (handles both L-to-R and R-to-L column orders!)
    const priceColIndices = Object.entries(columnConfigs)
      .filter(([, cfg]) =>
        ['sellingPrice', 'costPrice', 'pricePerKg', 'pricePerGram'].includes(cfg.role)
      )
      .map(([idx]) => Number(idx))
      .sort((a, b) => a - b);

    const codeColIndices = Object.entries(columnConfigs)
      .filter(([, cfg]) => cfg.role === 'code' && !cfg.gradeName)
      .map(([idx]) => Number(idx))
      .sort((a, b) => a - b);

    // Group contiguous grade price columns by gradeName
    const gradeBlocks: Array<{
      gradeName: string;
      gradeId: string | null;
      minCol: number;
      maxCol: number;
      cols: number[];
    }> = [];
    for (const cIdx of priceColIndices) {
      const cfg = columnConfigs[cIdx];
      if (!cfg.gradeName) continue;
      const last = gradeBlocks[gradeBlocks.length - 1];
      if (
        last &&
        last.gradeName === cfg.gradeName &&
        cIdx - last.maxCol <= 1
      ) {
        last.maxCol = cIdx;
        last.cols.push(cIdx);
      } else {
        gradeBlocks.push({
          gradeName: cfg.gradeName,
          gradeId: cfg.gradeId ?? null,
          minCol: cIdx,
          maxCol: cIdx,
          cols: [cIdx],
        });
      }
    }

    if (gradeBlocks.length >= 1 && codeColIndices.length >= 1) {
      // Determine block direction: are price columns to the LEFT or RIGHT of their paired code column?
      // Look at a code column touching only ONE side of a grade block (e.g. nearest to `name` column)
      let codeIsToRightOfPrices: boolean | null = null;
      for (const codeIdx of codeColIndices) {
        const leftBlock = gradeBlocks.find((b) => b.maxCol === codeIdx - 1);
        const rightBlock = gradeBlocks.find((b) => b.minCol === codeIdx + 1);
        if (leftBlock && !rightBlock) {
          codeIsToRightOfPrices = true;
          break;
        }
        if (rightBlock && !leftBlock) {
          codeIsToRightOfPrices = false;
          break;
        }
      }
      if (codeIsToRightOfPrices === null && nameColIdx >= 0) {
        // If `name` sits at higher index than price columns (L-to-R extract of RTL sheet), code is on the right of each block
        codeIsToRightOfPrices = nameColIdx > (gradeBlocks[0]?.minCol ?? 0);
      }

      for (const codeIdx of codeColIndices) {
        const leftBlock = gradeBlocks.find((b) => b.maxCol === codeIdx - 1);
        const rightBlock = gradeBlocks.find((b) => b.minCol === codeIdx + 1);
        const chosen =
          codeIsToRightOfPrices === true
            ? leftBlock || rightBlock
            : rightBlock || leftBlock;
        if (chosen) {
          columnConfigs[codeIdx].gradeName = chosen.gradeName;
          columnConfigs[codeIdx].gradeId = chosen.gradeId;
        }
      }
    }

    const gradeMap = new Map<
      string,
      { name: string; gradeId?: string | null; matched: boolean; columnIndices: number[] }
    >();
    Object.entries(columnConfigs).forEach(([idxStr, cfg]) => {
      const idx = Number(idxStr);
      if (!cfg.gradeName) return;
      const key = `${cfg.gradeId || ''}::${cfg.gradeName}`;
      const existing = gradeMap.get(key);
      if (existing) {
        existing.columnIndices.push(idx);
      } else {
        gradeMap.set(key, {
          name: cfg.gradeName,
          gradeId: cfg.gradeId ?? null,
          matched: Boolean(cfg.gradeId),
          columnIndices: [idx],
        });
      }
    });

    const detectedGrades = Array.from(gradeMap.values());
    const isMultiGradeTable = detectedGrades.length > 1 || codeColIndices.length > 1;

    return {
      mapping: {
        hasHeaderRow: true,
        columns,
        columnConfigs,
        oilSourceUnit,
        sourceUnit: detectedHeaderUnit || 'auto',
      },
      headerRowIndex: rIdx,
      headerExplicitlyAmbiguousPrice: hasAmbiguousPriceHeader && !isMultiGradeTable,
      detectedGrades,
      detectedHeaderUnit,
      isMultiGradeTable,
    };
  }

  return {
    mapping: null,
    headerRowIndex: -1,
    headerExplicitlyAmbiguousPrice: false,
    detectedGrades: [],
    detectedHeaderUnit: null,
    isMultiGradeTable: false,
  };
}

interface RawCandidateItem {
  rowIndex: number;
  serialNumber?: number | null;
  code?: string;
  name?: string;
  baseProductName?: string;
  grade?: string;
  gradeId?: string | null;
  description?: string;
  categoryHint?: string;
  unit?: string;
  sellingPrice?: number | null;
  costPrice?: number | null;
  singleUnclearPrice?: number | null;
  isAvailable?: boolean;
  priceSourceUnit?: string | null;
  costSourceUnit?: string | null;
  confidence?: number;
}

function buildEffectiveColumnConfigs(
  mapping: PriceListColumnMapping,
  inferred?: AnalyzedMappingResult
): Record<number, PriceListColumnAssignment> {
  const configs: Record<number, PriceListColumnAssignment> = {};
  const explicitRoleKeys = Object.keys(mapping.columns || {});
  const explicitConfigKeys = Object.keys(mapping.columnConfigs || {});
  const hasExplicitColumns = explicitRoleKeys.length > 0 || explicitConfigKeys.length > 0;

  const allIndices = new Set<number>([
    ...Object.keys(inferred?.mapping?.columns || {}).map(Number),
    ...Object.keys(inferred?.mapping?.columnConfigs || {}).map(Number),
    ...explicitRoleKeys.map(Number),
    ...explicitConfigKeys.map(Number),
  ]);

  for (const idx of allIndices) {
    const custom = mapping.columnConfigs?.[idx];
    const inf = inferred?.mapping?.columnConfigs?.[idx];
    const explicitRole = hasExplicitColumns ? mapping.columns?.[idx] : undefined;
    const role = custom?.role ?? explicitRole ?? inf?.role ?? 'ignore';
    const keepInferredGrade =
      !custom && (!explicitRole || explicitRole === inf?.role);
    configs[idx] = {
      role,
      gradeId:
        custom?.gradeId !== undefined
          ? custom.gradeId
          : keepInferredGrade
            ? inf?.gradeId ?? null
            : null,
      gradeName:
        custom?.gradeName !== undefined
          ? custom.gradeName
          : keepInferredGrade
            ? inf?.gradeName ?? null
            : null,
      unit: custom?.unit !== undefined ? custom.unit : inf?.unit ?? null,
    };
  }
  return configs;
}

export function parseStructuredTableRows(
  rawRows: string[][],
  categories: ProductCategory[],
  explicitMapping?: PriceListColumnMapping | null,
  listCategoryId?: string | null,
  gradesCatalog: OilGradeRecord[] = DEFAULT_OIL_GRADES
): {
  candidates: RawCandidateItem[];
  resolvedMapping: PriceListColumnMapping | null;
  detectedGrades: AnalyzedMappingResult['detectedGrades'];
  detectedHeaderUnit: ProductUnit | null;
  isMultiGradeTable: boolean;
  serialNumbers: number[];
} {
  const inferred = inferColumnMappingFromRows(rawRows, gradesCatalog);
  const explicitHasColumns = Boolean(
    explicitMapping &&
      ((explicitMapping.columns && Object.keys(explicitMapping.columns).length > 0) ||
        (explicitMapping.columnConfigs && Object.keys(explicitMapping.columnConfigs).length > 0))
  );
  const mergedColumns: Record<number, PriceListColumnRole> = explicitHasColumns
    ? { ...(inferred.mapping?.columns || {}), ...(explicitMapping?.columns || {}) }
    : { ...(inferred.mapping?.columns || {}) };

  const mapping: PriceListColumnMapping | null = explicitMapping
    ? {
        ...(inferred.mapping || {}),
        ...explicitMapping,
        columns: mergedColumns,
        columnConfigs: buildEffectiveColumnConfigs(explicitMapping, inferred),
      }
    : inferred.mapping;

  const headerIsAmbiguousSinglePrice = !explicitHasColumns && inferred.headerExplicitlyAmbiguousPrice;
  const headerRowIdx =
    mapping?.hasHeaderRow !== false && inferred.headerRowIndex >= 0 ? inferred.headerRowIndex : -1;

  const allHeaderText =
    headerRowIdx >= 0 && rawRows[headerRowIdx] ? rawRows[headerRowIdx].join(' ') : '';
  const docHeaderUnit = detectUnit(allHeaderText, 'قطعة');

  const candidates: RawCandidateItem[] = [];
  const serialNumbers: number[] = [];

  for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
    const cells = rawRows[rIdx];
    if (!cells || cells.length === 0) continue;
    if (rIdx <= headerRowIdx) continue;
    if (isHeaderRowCells(cells)) continue;

    if (mapping && cells.length >= 2) {
      const colConfigs = buildEffectiveColumnConfigs(mapping, inferred);
      const colEntries = Object.entries(colConfigs);
      const colShift =
        cells.length === colEntries.length - 1 &&
        (colConfigs[0]?.role === 'ignore' || colConfigs[0]?.role === 'serial')
          ? -1
          : 0;

      let serialNumber: number | null = null;
      let sharedName = '';
      let sharedDescription = '';
      let sharedUnitStr = '';
      let sharedCode = '';

      // Group grade variants per row!
      interface GradeSlot {
        gradeKey: string;
        gradeName: string;
        gradeId: string | null;
        code: string;
        sell: number | null;
        cost: number | null;
        sellFromKg: number | null;
        sellFromGram: number | null;
        sellUnavailable: boolean;
        costUnavailable: boolean;
      }
      const gradeSlots = new Map<string, GradeSlot>();
      const getSlot = (gName: string, gId: string | null): GradeSlot => {
        const key = `${gId || ''}::${gName}`;
        let slot = gradeSlots.get(key);
        if (!slot) {
          slot = {
            gradeKey: key,
            gradeName: gName,
            gradeId: gId,
            code: '',
            sell: null,
            cost: null,
            sellFromKg: null,
            sellFromGram: null,
            sellUnavailable: false,
            costUnavailable: false,
          };
          gradeSlots.set(key, slot);
        }
        return slot;
      };

      for (let cIdx = 0; cIdx < cells.length; cIdx++) {
        const val = normalizeArabicDisplay(cells[cIdx] ?? '');
        if (!val) continue;
        const mappedIdx = cIdx - colShift;
        const cfg = colConfigs[mappedIdx] || { role: 'ignore' as PriceListColumnRole };
        const role = cfg.role;

        if (role === 'ignore') continue;
        if (role === 'serial') {
          const sn = Number.parseInt(val.replace(/[^\d]/g, ''), 10);
          if (Number.isFinite(sn) && sn > 0 && sn < 50000) {
            serialNumber = sn;
          }
          continue;
        }
        if (role === 'name') {
          sharedName = sharedName ? `${sharedName} ${val}` : val;
          continue;
        }
        if (role === 'description') {
          sharedDescription = sharedDescription ? `${sharedDescription} · ${val}` : val;
          continue;
        }
        if (role === 'unit') {
          const u = detectUnit(val, 'قطعة');
          sharedUnitStr = u.matched ? u.unit : val;
          continue;
        }

        const slotGradeName = cfg.gradeName || mapping.defaultGradeName || '';
        const slotGradeId = cfg.gradeId ?? null;

        if (role === 'code') {
          const cleanC = normalizeCodeToken(val);
          if (slotGradeName) {
            getSlot(slotGradeName, slotGradeId).code = cleanC;
          } else {
            sharedCode = cleanC;
          }
          continue;
        }

        const parsedNum = parseUnavailableOrPriceCell(val);
        if (role === 'pricePerKg') {
          const slot = getSlot(slotGradeName, slotGradeId);
          if (parsedNum.value !== null) slot.sellFromKg = parsedNum.value;
          else if (parsedNum.isUnavailable) slot.sellUnavailable = true;
        } else if (role === 'pricePerGram') {
          const slot = getSlot(slotGradeName, slotGradeId);
          if (parsedNum.value !== null) slot.sellFromGram = parsedNum.value;
          else if (parsedNum.isUnavailable) slot.sellUnavailable = true;
        } else if (role === 'sellingPrice') {
          const slot = getSlot(slotGradeName, slotGradeId);
          if (parsedNum.value !== null) slot.sell = parsedNum.value;
          else if (parsedNum.isUnavailable) slot.sellUnavailable = true;
        } else if (role === 'costPrice') {
          const slot = getSlot(slotGradeName, slotGradeId);
          if (parsedNum.value !== null) slot.cost = parsedNum.value;
          else if (parsedNum.isUnavailable) slot.costUnavailable = true;
        }
      }

      if (serialNumber !== null) {
        serialNumbers.push(serialNumber);
      }

      // Stitch wrapped description/name onto previous product if this row has no prices and no codes
      const hasAnyPriceOrCodeInSlots =
        Boolean(sharedCode) ||
        Array.from(gradeSlots.values()).some(
          (s) =>
            Boolean(s.code) ||
            s.sell !== null ||
            s.cost !== null ||
            s.sellFromKg !== null ||
            s.sellFromGram !== null ||
            s.sellUnavailable ||
            s.costUnavailable
        );

      if (!hasAnyPriceOrCodeInSlots && (sharedName || sharedDescription) && candidates.length > 0) {
        const lastRowIdx = candidates[candidates.length - 1].rowIndex;
        const extra = [sharedName, sharedDescription].filter(Boolean).join(' ');
        for (let k = candidates.length - 1; k >= 0 && candidates[k].rowIndex === lastRowIdx; k--) {
          candidates[k].description = candidates[k].description
            ? `${candidates[k].description} · ${extra}`
            : extra;
        }
        continue;
      }

      if (!sharedName && !sharedCode && gradeSlots.size === 0) continue;

      if (!sharedUnitStr) {
        const uText = detectUnit(`${sharedName} ${sharedDescription}`, 'قطعة');
        if (uText.matched) sharedUnitStr = uText.unit;
        else if (docHeaderUnit.matched) sharedUnitStr = docHeaderUnit.unit;
      }

      if (gradeSlots.size === 0) {
        gradeSlots.set('::', {
          gradeKey: '::',
          gradeName: mapping.defaultGradeName || '',
          gradeId: null,
          code: sharedCode,
          sell: null,
          cost: null,
          sellFromKg: null,
          sellFromGram: null,
          sellUnavailable: false,
          costUnavailable: false,
        });
      }

      for (const slot of gradeSlots.values()) {
        const finalCode = slot.code || sharedCode;
        let finalSell = slot.sellFromKg ?? slot.sellFromGram ?? slot.sell;
        const finalCost = slot.cost;
        let singleUnclear: number | null = null;

        let pUnit: string | null = null;
        if (slot.sellFromKg !== null) pUnit = 'كيلوجرام';
        else if (slot.sellFromGram !== null) pUnit = 'جرام';
        else if (mapping.sourceUnit && mapping.sourceUnit !== 'auto' && mapping.sourceUnit !== 'unconfirmed') {
          pUnit = mapping.sourceUnit;
        } else if (mapping.oilSourceUnit && mapping.oilSourceUnit !== 'auto') {
          pUnit = mapping.oilSourceUnit;
        } else if (sharedUnitStr === 'كيلوجرام' || sharedUnitStr === 'جرام') {
          pUnit = sharedUnitStr;
        }

        if (headerIsAmbiguousSinglePrice && finalSell !== null && finalCost === null) {
          singleUnclear = finalSell;
          finalSell = null;
        }

        if (
          !sharedName &&
          !finalCode &&
          finalSell === null &&
          finalCost === null &&
          singleUnclear === null &&
          !slot.sellUnavailable &&
          !slot.costUnavailable
        ) {
          continue;
        }

        const isAvailable = !(slot.sellUnavailable && finalSell === null && finalCost === null);

        candidates.push({
          rowIndex: rIdx,
          serialNumber,
          code: finalCode,
          name: sharedName || finalCode,
          baseProductName: sharedName || finalCode,
          grade: slot.gradeName,
          gradeId: slot.gradeId,
          description: sharedDescription,
          unit: sharedUnitStr,
          sellingPrice: finalSell,
          costPrice: finalCost,
          singleUnclearPrice: singleUnclear,
          isAvailable,
          priceSourceUnit: pUnit,
          costSourceUnit: pUnit,
          confidence:
            finalCode && (finalSell !== null || slot.sellUnavailable)
              ? slot.gradeId || !slot.gradeName
                ? 95
                : 82
              : 70,
        });
      }
      continue;
    }

    // Fallback heuristic single-variant row parser (e.g., unstructured text lines)
    const joinedLine = cells.join('  ');
    let code = '';
    const nameParts: string[] = [];
    let description = '';
    let detectedCategoryHint = '';
    let unitStr = '';
    let explicitSell: number | null = null;
    let explicitCost: number | null = null;
    const standaloneNumbers: number[] = [];
    let priceSourceUnit: string | null = null;
    let serialNumber: number | null = null;

    if (cells.length >= 3) {
      for (let idx = 0; idx < cells.length; idx++) {
        const cell = cells[idx];
        if (
          idx === 0 &&
          /^\d{1,4}$/.test(cell) &&
          Number(cell) < 5000 &&
          cells[1] &&
          isLikelyCodeCell(cells[1])
        ) {
          serialNumber = Number(cell);
          serialNumbers.push(serialNumber);
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

        if (nameParts.length === 0) nameParts.push(cell);
        else description = description ? `${description} · ${cell}` : cell;
      }
    } else {
      const normLine = stitchSpacedHyphenCodes(normalizeArabicDisplay(joinedLine));
      const codeMatch = normLine.match(
        /(?:^|\s)([A-Za-z][A-Za-z0-9]{0,9}(?:[-_][A-Za-z0-9]{1,8}){1,3}|[A-Za-z]{2,8}\d{2,8})(?=$|\s)/
      );
      if (codeMatch) code = normalizeCodeToken(codeMatch[1]);
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
      if (cleanedName.length >= 2) nameParts.push(cleanedName);
    }

    const name = nameParts.join(' ').trim();
    if (!name && !code) continue;
    if (!code && standaloneNumbers.length === 0 && explicitSell === null && explicitCost === null) {
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

    const gMatch = resolveOilGradeMatch(`${name} ${description}`, gradesCatalog);

    candidates.push({
      rowIndex: rIdx,
      serialNumber,
      code,
      name: name || code,
      baseProductName: name || code,
      grade: gMatch.matched ? gMatch.canonicalName : '',
      gradeId: gMatch.gradeId,
      description,
      categoryHint: detectedCategoryHint,
      unit: unitStr,
      sellingPrice: finalSell,
      costPrice: finalCost,
      singleUnclearPrice: singleUnclear,
      isAvailable: true,
      priceSourceUnit,
      costSourceUnit: priceSourceUnit,
      confidence: code && (finalSell !== null || finalCost !== null) ? 84 : 66,
    });
  }

  return {
    candidates,
    resolvedMapping: mapping,
    detectedGrades: inferred.detectedGrades,
    detectedHeaderUnit: inferred.detectedHeaderUnit,
    isMultiGradeTable: inferred.isMultiGradeTable,
    serialNumbers,
  };
}

async function extractWithGeminiMultimodal(
  base64Pdf: string,
  categories: ProductCategory[],
  gradesCatalog: OilGradeRecord[],
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
  const gradeNames = gradesCatalog.filter((g) => g.isActive).map((g) => g.name).join('، ');
  const prompt = `
    استخرج جدول/قائمة المنتجات والأسعار من ملف PDF المرفق بدقة تامة دون اختراع أي أرقام غير موجودة.
    ${listCategoryName ? `تصنيف القائمة المختار من المالك: ${listCategoryName}` : `التصنيفات المتاحة: ${catNames}.`}
    درجات الزيوت العطرية المعرّفة في النظام: ${gradeNames}.
    الوحدات المدعومة: mg، جرام، كيلوجرام، قطعة، عبوة، دستة، كرتونة، لتر، ملليلتر، جركن.
    ملاحظات صارمة:
    - إذا احتوى الصف الواحد على أكثر من درجة جودة (مثل كود عالي وسعر كود عالي وتكلفة عالي، وكود وسط وسعر كود وسط وتكلفة وسط)، أخرج سجلًا مستقلاً لكل درجة جودة بنفس baseProductName ورقم المسلسل serialNumber.
    - تجاهل عمود المسلسل (# أو N أو م) ولا تضعه كسعر تكلفة أو بيع؛ ضعه فقط في serialNumber.
    - إذا كانت الخانة تحتوي على "غير متوفر" أو "-" اترك السعر null ولا تكتب 0.
    - إذا كان الملف يذكر وحدة صراحة (مثل كيلو أو جرام) ضعها في priceSourceUnit، وإلا اترك priceSourceUnit فارغاً.
    - ضع سعر البيع في sellingPrice وسعر الشراء/التكلفة في costPrice. إذا كان هناك سعر واحد غامض تماماً اتركهما null وضعه في singleUnclearPrice.
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
                serialNumber: { type: Type.INTEGER, nullable: true },
                code: { type: Type.STRING },
                name: { type: Type.STRING },
                baseProductName: { type: Type.STRING },
                grade: { type: Type.STRING },
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

  const parsed = JSON.parse(response.text || '{"items":[]}') as {
    items?: Array<RawCandidateItem & { serialNumber?: number | null }>;
  };
  return (Array.isArray(parsed.items) ? parsed.items : []).map((it, idx) => {
    const gMatch = resolveOilGradeMatch(it.grade || '', gradesCatalog);
    return {
      ...it,
      rowIndex: it.serialNumber || idx + 1,
      baseProductName: it.baseProductName || it.name,
      grade: gMatch.matched ? gMatch.canonicalName : it.grade || '',
      gradeId: gMatch.gradeId,
      isAvailable: it.sellingPrice !== null || it.costPrice !== null || it.singleUnclearPrice !== null,
    };
  });
}

function buildImportCounts(
  items: PriceListParsedItem[],
  serialNumbers: number[],
  rawRowsCount?: number
): PriceListImportCounts {
  const uniqueBases = new Set<string>();
  for (const item of items) {
    const baseKey = item.baseProductKey || normalizeArabicForSearch(item.baseProductName || item.name);
    if (baseKey) uniqueBases.add(baseKey);
  }
  const uniqueProductsCount = uniqueBases.size;
  const totalVariantsCount = items.length;
  const availableVariantsCount = items.filter((i) => i.isAvailable !== false).length;
  const unavailableVariantsCount = items.filter((i) => i.isAvailable === false).length;
  const incompletePricesCount = items.filter(
    (i) => i.isAvailable !== false && (i.sellingPrice === null || i.ambiguousSinglePrice !== null)
  ).length;
  const unconfirmedCostsCount = items.filter(
    (i) => i.isAvailable !== false && i.costPrice === null
  ).length;

  const excludedReasons: string[] = [];
  if (unavailableVariantsCount > 0) {
    const unavailNames = Array.from(
      new Set(
        items
          .filter((i) => i.isAvailable === false)
          .map((i) => i.baseProductName || i.name)
      )
    ).slice(0, 4);
    excludedReasons.push(
      `${unavailableVariantsCount} درجة محددة كـ "غير متوفر" في الملف (${unavailNames.join('، ')})`
    );
  }
  const dupCount = items.filter((i) => i.matchStatus === 'duplicate_in_file').length;
  if (dupCount > 0) {
    excludedReasons.push(`${dupCount} بند مكرر داخل نفس الملف`);
  }

  let expectedSerialCount: number | null = null;
  let detectedSerialMin: number | null = null;
  let detectedSerialMax: number | null = null;
  const missingSerialNumbers: number[] = [];

  const validSerials = Array.from(
    new Set(serialNumbers.filter((n) => Number.isInteger(n) && n > 0))
  ).sort((a, b) => a - b);

  if (validSerials.length >= 2) {
    detectedSerialMin = validSerials[0];
    detectedSerialMax = validSerials[validSerials.length - 1];
    expectedSerialCount = detectedSerialMax;
    const serialSet = new Set(validSerials);
    for (let n = 1; n <= detectedSerialMax; n++) {
      if (!serialSet.has(n)) {
        missingSerialNumbers.push(n);
      }
    }
  }

  let hasCountMismatch = false;
  let countMismatchReason: string | null = null;
  if (expectedSerialCount !== null && uniqueProductsCount !== expectedSerialCount) {
    hasCountMismatch = true;
    countMismatchReason = `عدد الأصناف المستخرجة (${uniqueProductsCount}) لا يطابق آخر رقم مسلسل في الجدول (${expectedSerialCount})${
      missingSerialNumbers.length > 0
        ? ` — أرقام مسلسلة مفقودة: ${missingSerialNumbers.slice(0, 10).join('، ')}`
        : ''
    }.`;
  } else if (missingSerialNumbers.length > 0) {
    hasCountMismatch = true;
    countMismatchReason = `توجد أرقام مسلسلة مفقودة في التسلسل: ${missingSerialNumbers.slice(0, 10).join('، ')}`;
  }

  return {
    expectedSerialCount,
    uniqueProductsCount,
    totalVariantsCount,
    rawRowsCount: rawRowsCount ?? undefined,
    availableVariantsCount,
    unavailableVariantsCount,
    incompletePricesCount,
    unconfirmedCostsCount,
    excludedReasons,
    hasCountMismatch,
    countMismatchReason,
    detectedSerialMin,
    detectedSerialMax,
    missingSerialNumbers: missingSerialNumbers.slice(0, 30),
  };
}

function finalizeParsedItems(
  candidates: RawCandidateItem[],
  existingProducts: Product[],
  categories: ProductCategory[],
  gradesCatalog: OilGradeRecord[],
  listCategory?: ProductCategory | null,
  columnMapping?: PriceListColumnMapping | null,
  detectedHeaderUnit?: ProductUnit | null,
  detectedGrades: AnalyzedMappingResult['detectedGrades'] = [],
  isMultiGradeTable = false,
  serialNumbers: number[] = [],
  rawRowsCount?: number
): Pick<
  PdfExtractionOutput,
  | 'parsedItems'
  | 'totalParsed'
  | 'newCount'
  | 'updatedCount'
  | 'needsReviewCount'
  | 'duplicateCount'
  | 'importConfig'
> {
  const seenCodes = new Set<string>();
  const seenVariantKeys = new Set<string>();
  const finalized: PriceListParsedItem[] = [];

  let newCount = 0;
  let updatedCount = 0;
  let needsReviewCount = 0;
  let duplicateCount = 0;

  // Determine batch-level unit config
  const isOilList =
    listCategory?.id === 'cat-oils' ||
    listCategory?.slug === 'oils' ||
    (!listCategory && candidates.some((c) => Boolean(c.grade)));

  const targetUnit: ProductUnit =
    columnMapping?.targetUnit ||
    (isOilList ? 'جرام' : listCategory?.defaultUnit || 'قطعة');

  const sampleRawPrices = candidates
    .map((c) => c.sellingPrice ?? c.costPrice ?? c.singleUnclearPrice)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const medianSamplePrice =
    sampleRawPrices.length > 0
      ? [...sampleRawPrices].sort((a, b) => a - b)[Math.floor(sampleRawPrices.length / 2)]
      : null;

  let confirmedByUser = Boolean(columnMapping?.unitConfirmedByUser);
  let sourceUnit: PriceListBatchUnitConfig['sourceUnit'] = 'unconfirmed';
  let conversionFactor = 1;
  let suggestionReason: string | null = null;

  const explicitSource =
    columnMapping?.sourceUnit && columnMapping.sourceUnit !== 'auto'
      ? columnMapping.sourceUnit
      : columnMapping?.oilSourceUnit && columnMapping.oilSourceUnit !== 'auto'
        ? columnMapping.oilSourceUnit
        : null;

  if (explicitSource && explicitSource !== 'unconfirmed') {
    sourceUnit = explicitSource;
    if (columnMapping?.unitConfirmedByUser !== false) {
      confirmedByUser = true;
    }
    const conv = computePriceConversionFactor(sourceUnit, targetUnit);
    conversionFactor =
      typeof columnMapping?.conversionFactor === 'number' && columnMapping.conversionFactor > 0
        ? columnMapping.conversionFactor
        : conv.ok
          ? conv.factor
          : 1;
  } else if (detectedHeaderUnit) {
    sourceUnit = detectedHeaderUnit;
    confirmedByUser = true;
    const conv = computePriceConversionFactor(sourceUnit, targetUnit);
    conversionFactor = conv.ok ? conv.factor : 1;
  } else if (isOilList) {
    sourceUnit = 'unconfirmed';
    confirmedByUser = false;
    conversionFactor = 1;
    if (medianSamplePrice !== null && medianSamplePrice >= 250) {
      suggestionReason = `متوسط الأسعار في الملف (${medianSamplePrice.toLocaleString()} ج.م) يشير غالباً إلى تسعير بالكيلوجرام — يرجى تأكيد وحدة السعر في الخطوة التالية لتحويله تلقائياً إلى ${targetUnit}.`;
    } else {
      suggestionReason = 'لم يصرّح الملف بوحدة التسعير (كيلوجرام أم جرام). يرجى تأكيد وحدة السعر قبل الاعتماد.';
    }
  } else {
    sourceUnit = targetUnit;
    confirmedByUser = true;
    conversionFactor = 1;
  }

  for (let i = 0; i < candidates.length; i++) {
    const raw = candidates[i];
    const cleanCode = raw.code ? normalizeCodeToken(raw.code) : '';
    const cleanBaseName = normalizeArabicDisplay(raw.baseProductName || raw.name || '');
    const cleanDesc = normalizeArabicDisplay(raw.description || '');
    const warnings: string[] = [];

    if (!cleanCode) {
      warnings.push('كود المنتج مفقود — يرجى إدخال كود فريد قبل الاعتماد');
    }
    if (!cleanBaseName) {
      warnings.push('اسم المنتج مفقود');
    }

    // Category resolution
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
        const auto = classifyProductName(`${cleanBaseName} ${cleanDesc}`, categories);
        categoryId = auto.categoryId;
        categoryName = auto.categoryName;
        catConfident = auto.confident;
      }
    } else {
      const auto = classifyProductName(`${cleanBaseName} ${cleanDesc}`, categories);
      categoryId = auto.categoryId;
      categoryName = auto.categoryName;
      catConfident = auto.confident;
    }

    const catObj = categories.find((c) => c.id === categoryId);
    const isOilItem = categoryId === 'cat-oils' || catObj?.slug === 'oils';
    const catDefaultUnit: ProductUnit = isOilItem
      ? targetUnit
      : catObj?.defaultUnit || 'قطعة';

    // Grade resolution
    let finalGrade = normalizeArabicDisplay(raw.grade || '');
    let finalGradeId: string | null = raw.gradeId ?? null;
    if (isOilItem) {
      const gradeSourceText = finalGrade || `${cleanBaseName} ${cleanDesc}`;
      const gMatch = resolveOilGradeMatch(gradeSourceText, gradesCatalog);
      if (gMatch.matched && gMatch.gradeRecord) {
        finalGrade = gMatch.canonicalName;
        finalGradeId = gMatch.gradeId;
        if (!gMatch.gradeRecord.isActive) {
          warnings.push(`الدرجة "${finalGrade}" معطلة حالياً في النظام`);
        }
      } else if (finalGrade) {
        warnings.push(`الدرجة "${finalGrade}" غير معرّفة في درجات الزيوت — اربطها بدرجة قائمة أو أنشئها`);
      } else {
        // Default single-grade oil list if no grade column existed
        const firstActiveGrade =
          gradesCatalog.find((g) => g.isActive) || DEFAULT_OIL_GRADES[0];
        finalGrade = firstActiveGrade.name;
        finalGradeId = firstActiveGrade.id;
      }
    }

    // Build product SKU name consistently without duplicating grade suffix if already present
    const displayName = cleanBaseName;
    const baseProductKey = normalizeArabicForSearch(cleanBaseName);

    // Pricing & Unit conversion
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

    const originalPrice: number | null = sellingPrice ?? ambiguousSinglePrice;
    const originalCostPrice: number | null = costPrice;
    let finalUnit: ProductUnit = catDefaultUnit;
    let originalPriceUnit: string | null = null;
    let rowConversionFactor: number | null = null;
    let conversionNote: string | null = null;

    if (isOilItem) {
      const explicitRowUnit =
        raw.priceSourceUnit && raw.priceSourceUnit !== 'auto' && raw.priceSourceUnit !== 'unconfirmed'
          ? raw.priceSourceUnit
          : sourceUnit !== 'unconfirmed'
            ? sourceUnit
            : null;

      if (explicitRowUnit && (confirmedByUser || detectedHeaderUnit || raw.priceSourceUnit)) {
        const conv = computePriceConversionFactor(explicitRowUnit, targetUnit);
        const factor =
          sourceUnit === explicitRowUnit && conversionFactor !== 1
            ? conversionFactor
            : conv.ok
              ? conv.factor
              : 1;
        finalUnit = targetUnit;
        originalPriceUnit = explicitRowUnit;
        rowConversionFactor = factor;

        if (sellingPrice !== null && factor !== 1) {
          sellingPrice = roundUnitPrice(sellingPrice * factor);
        }
        if (costPrice !== null && factor !== 1) {
          costPrice = roundUnitPrice(costPrice * factor);
        }
        if (factor !== 1 && originalPrice !== null && sellingPrice !== null) {
          conversionNote = `تحويل من ${explicitRowUnit} (${originalPrice.toLocaleString()}) إلى ${targetUnit} (${sellingPrice.toLocaleString()})`;
        } else {
          conversionNote = `تسعير مباشر بوحدة ${finalUnit}`;
        }
      } else {
        finalUnit = targetUnit;
        originalPriceUnit = null;
        rowConversionFactor = null;
        warnings.push(
          'وحدة تسعير الزيت غير مؤكدة (كيلوجرام أم جرام؟) — أكد وحدة التسعير في أعلى الشاشة قبل الاعتماد'
        );
      }
    } else {
      const explicitUnitRes = raw.unit ? detectUnit(raw.unit, catDefaultUnit) : { unit: catDefaultUnit, matched: false };
      finalUnit = explicitUnitRes.matched ? explicitUnitRes.unit : catDefaultUnit;
      originalPriceUnit = finalUnit;
      rowConversionFactor = 1;
    }

    let singlePriceMeaning: PriceListSinglePriceMeaning = 'unresolved';
    if (sellingPrice !== null) singlePriceMeaning = 'selling';
    else if (costPrice !== null && sellingPrice === null && ambiguousSinglePrice === null) {
      singlePriceMeaning = 'cost';
    }

    const isAvailable = raw.isAvailable !== false;
    const missingSellPrice = sellingPrice === null && ambiguousSinglePrice === null;
    const missingCostPrice = costPrice === null;

    if (!isAvailable) {
      warnings.push(`الدرجة "${finalGrade || 'الأساسية'}" محددة كـ "غير متوفر" في الملف`);
    } else if (ambiguousSinglePrice !== null) {
      warnings.push('يحتوي على سعر واحد غير محدد النوع — حدد هل هو سعر بيع أم سعر شراء');
    } else if (missingSellPrice && !missingCostPrice) {
      warnings.push('سعر البيع مفقود بينما سعر التكلفة موجود — راجع سعر البيع');
    } else if (missingSellPrice && missingCostPrice) {
      warnings.push('لم يتم العثور على سعر واضح لهذا الصنف/الدرجة');
    }

    if (sellingPrice !== null && costPrice !== null && costPrice > sellingPrice) {
      warnings.push(`تنبيه: التكلفة (${costPrice}) أعلى من سعر البيع (${sellingPrice})`);
    }

    // Matching & Duplicate check (NEVER collide different grades of the same oil!)
    let matchStatus: PriceListParsedItem['matchStatus'] = 'new';
    let matchedProduct: Product | undefined;
    let matchedBy: PriceListParsedItem['matchedBy'] = null;

    const codeKey = cleanCode.toLowerCase();
    const gradeKey = normalizeArabicForSearch(finalGrade || '');
    const unitKey = normalizeArabicForSearch(finalUnit);
    const variantKey = `${baseProductKey}||${gradeKey}||${unitKey}`;

    if (cleanCode && seenCodes.has(codeKey)) {
      matchStatus = 'duplicate_in_file';
      duplicateCount += 1;
      warnings.push(`كود مكرر داخل نفس ملف PDF (${cleanCode})`);
    } else if (baseProductKey && seenVariantKeys.has(variantKey)) {
      matchStatus = 'duplicate_in_file';
      duplicateCount += 1;
      warnings.push(
        `صنف ودرجة مكررة داخل نفس الملف (${cleanBaseName}${finalGrade ? ` · ${finalGrade}` : ''})`
      );
    } else {
      if (cleanCode) seenCodes.add(codeKey);
      if (baseProductKey) seenVariantKeys.add(variantKey);

      if (cleanCode) {
        matchedProduct = existingProducts.find(
          (p) => (p.code || '').trim().toLowerCase() === codeKey
        );
        if (matchedProduct) matchedBy = 'code';
      }

      if (!matchedProduct && baseProductKey) {
        matchedProduct = existingProducts.find((p) => {
          const pBase =
            p.baseProductKey || normalizeArabicForSearch(p.baseProductName || p.name);
          if (pBase !== baseProductKey) return false;
          if (finalGrade) {
            const pGradeMatch = resolveOilGradeMatch(p.grade, gradesCatalog);
            const pGradeKey = normalizeArabicForSearch(
              pGradeMatch.matched ? pGradeMatch.canonicalName : p.grade || ''
            );
            return pGradeKey === gradeKey;
          }
          return !p.grade && normalizeArabicForSearch(p.unit) === unitKey;
        });
        if (matchedProduct) {
          matchedBy = finalGrade ? 'name_and_grade' : 'normalized_name';
        }
      }

      if (matchedProduct) {
        matchStatus = 'matched';
        updatedCount += 1;
      } else {
        newCount += 1;
      }
    }

    const baseConfidence =
      typeof raw.confidence === 'number' ? Math.min(100, Math.max(10, raw.confidence)) : 80;
    const penalty =
      (cleanCode ? 0 : 25) +
      (ambiguousSinglePrice !== null ? 20 : 0) +
      (missingSellPrice ? 15 : 0) +
      (!confirmedByUser && isOilItem ? 10 : 0) +
      (matchStatus === 'duplicate_in_file' ? 35 : 0);
    const confidence = Math.max(10, Math.min(99, baseConfidence - penalty));

    const needsReview =
      warnings.length > 0 || !catConfident || matchStatus === 'duplicate_in_file';
    if (needsReview) {
      needsReviewCount += 1;
      if (matchStatus === 'new' && (!cleanCode || ambiguousSinglePrice !== null)) {
        matchStatus = 'needs_review';
      }
    }

    const canSelectDefault =
      matchStatus !== 'duplicate_in_file' &&
      Boolean(cleanCode) &&
      Boolean(cleanBaseName) &&
      isAvailable &&
      (matchStatus === 'matched'
        ? sellingPrice !== null || costPrice !== null
        : sellingPrice !== null);

    finalized.push({
      rowKey: `row-${raw.rowIndex || i + 1}-v${i + 1}-${cleanCode || 'NOCODE'}`,
      rowIndex: raw.rowIndex || i + 1,
      serialNumber: raw.serialNumber ?? null,
      code: cleanCode,
      name: displayName,
      baseProductName: cleanBaseName,
      baseProductKey,
      grade: finalGrade,
      gradeId: finalGradeId,
      description: cleanDesc,
      suggestedCategoryId: categoryId,
      suggestedCategoryName: categoryName,
      unit: finalUnit,
      sellingPrice,
      costPrice,
      originalPrice,
      originalPriceUnit,
      originalCostPrice,
      conversionFactor: rowConversionFactor,
      conversionNote,
      isAvailable,
      missingSellPrice,
      missingCostPrice,
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
            grade: matchedProduct.grade,
            gradeId: matchedProduct.gradeId ?? null,
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
      selectedForImport: canSelectDefault,
      updateFields: matchedProduct
        ? {
            name: false,
            description: Boolean(cleanDesc && cleanDesc !== (matchedProduct.description || '')),
            category: false,
            unit: matchedProduct.unit !== finalUnit,
            sellingPrice: sellingPrice !== null,
            costPrice: costPrice !== null,
            grade: Boolean(finalGrade && matchedProduct.grade !== finalGrade),
          }
        : undefined,
    });
  }

  const counts = buildImportCounts(finalized, serialNumbers, rawRowsCount);
  const samplePrice = finalized.find((f) => typeof f.originalPrice === 'number' && f.originalPrice > 0);
  const unitConfig: PriceListBatchUnitConfig = {
    detectedSourceUnit: detectedHeaderUnit,
    sourceUnit,
    targetUnit,
    confirmedByUser,
    conversionFactor,
    suggestionReason,
    exampleOriginalPrice: samplePrice?.originalPrice ?? 4000,
    exampleConvertedPrice:
      samplePrice?.originalPrice !== undefined && samplePrice?.originalPrice !== null
        ? roundUnitPrice(samplePrice.originalPrice * conversionFactor)
        : roundUnitPrice(4000 * conversionFactor),
  };

  return {
    parsedItems: finalized,
    totalParsed: finalized.length,
    newCount,
    updatedCount,
    needsReviewCount,
    duplicateCount,
    importConfig: {
      unitConfig,
      counts,
      detectedGrades,
      isMultiGradeTable,
    },
  };
}

export function remapParsedTableRows(params: {
  rawTableRows: string[][];
  existingProducts: Product[];
  categoriesCatalog?: ProductCategory[];
  oilGrades?: OilGradeRecord[];
  listCategoryId?: string | null;
  columnMapping?: PriceListColumnMapping | null;
}): Omit<PdfExtractionOutput, 'extractionMethod' | 'rawTextPreview' | 'errorMessage'> {
  const categories =
    params.categoriesCatalog && params.categoriesCatalog.length > 0
      ? params.categoriesCatalog
      : DEFAULT_CATEGORIES;
  const gradesCatalog =
    params.oilGrades && params.oilGrades.length > 0 ? params.oilGrades : DEFAULT_OIL_GRADES;
  const listCategory = params.listCategoryId
    ? categories.find((c) => c.id === params.listCategoryId) || null
    : null;

  const {
    candidates,
    resolvedMapping,
    detectedGrades,
    detectedHeaderUnit,
    isMultiGradeTable,
    serialNumbers,
  } = parseStructuredTableRows(
    params.rawTableRows,
    categories,
    params.columnMapping || null,
    listCategory?.id || null,
    gradesCatalog
  );

  const summary = finalizeParsedItems(
    candidates,
    params.existingProducts,
    categories,
    gradesCatalog,
    listCategory,
    resolvedMapping,
    detectedHeaderUnit,
    detectedGrades,
    isMultiGradeTable,
    serialNumbers,
    params.rawTableRows.length
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
  const gradesCatalog =
    options.oilGrades && options.oilGrades.length > 0 ? options.oilGrades : DEFAULT_OIL_GRADES;
  const listCategory = options.listCategoryId
    ? categories.find((c) => c.id === options.listCategoryId) || null
    : null;

  let rawText = '';
  let tableRowsFromPdf: string[][] = [];
  let textParseFailed = false;
  const parser = new PDFParse({ data: buffer });

  try {
    try {
      const tableResult = await parser.getTable();
      if (tableResult && Array.isArray(tableResult.pages)) {
        for (const page of tableResult.pages) {
          if (!Array.isArray(page.tables)) continue;
          for (const tbl of page.tables) {
            if (!Array.isArray(tbl)) continue;
            for (const row of tbl) {
              if (!Array.isArray(row)) continue;
              const cleanedRow = row.map((cell) => normalizeArabicDisplay(String(cell ?? '')));
              if (cleanedRow.some((c) => c.length > 0)) {
                tableRowsFromPdf.push(cleanedRow);
              }
            }
          }
        }
      }
    } catch (tblErr) {
      console.warn('PDF structured getTable extraction fallback to getText:', tblErr);
    }

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
  const isLikelyScanned =
    tableRowsFromPdf.length === 0 && (textParseFailed || normalizedText.length < 25);
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
        importConfig: null,
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
        gradesCatalog,
        normalizedText,
        listCategory?.name
      );
      const summary = finalizeParsedItems(
        candidates,
        existingProducts,
        categories,
        gradesCatalog,
        listCategory,
        options.columnMapping || null,
        null,
        [],
        candidates.some((c) => Boolean(c.grade)),
        candidates
          .map((c) => c.serialNumber)
          .filter((n): n is number => typeof n === 'number')
      );
      return {
        extractionMethod: 'pdf_ocr_gemini',
        listCategoryId: listCategory?.id ?? null,
        listCategoryName: listCategory?.name ?? null,
        columnMapping: options.columnMapping || null,
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
        importConfig: null,
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

  // Prefer structured getTable() grid rows when it detected a real header or >= 2 columns per row!
  const textFallbackRows = extractRawTableRowsFromText(rawText);
  const useGetTableRows =
    tableRowsFromPdf.length >= 2 &&
    tableRowsFromPdf.some((r) => isHeaderRowCells(r) || r.length >= 3);

  const rawTableRows =
    options.rawRowsOverride && options.rawRowsOverride.length > 0
      ? options.rawRowsOverride
      : useGetTableRows
        ? tableRowsFromPdf
        : textFallbackRows;

  let {
    candidates,
    resolvedMapping,
    detectedGrades,
    detectedHeaderUnit,
    isMultiGradeTable,
    serialNumbers,
  } = parseStructuredTableRows(
    rawTableRows,
    categories,
    options.columnMapping || null,
    listCategory?.id || null,
    gradesCatalog
  );
  let method: PdfExtractionOutput['extractionMethod'] = 'pdf_text';

  if (candidates.length === 0 && hasGeminiKey) {
    try {
      const aiCandidates = await extractWithGeminiMultimodal(
        base64Pdf,
        categories,
        gradesCatalog,
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

  const summary = finalizeParsedItems(
    candidates,
    existingProducts,
    categories,
    gradesCatalog,
    listCategory,
    resolvedMapping,
    detectedHeaderUnit,
    detectedGrades,
    isMultiGradeTable,
    serialNumbers,
    rawTableRows.length
  );

  return {
    extractionMethod: method,
    listCategoryId: listCategory?.id ?? null,
    listCategoryName: listCategory?.name ?? null,
    columnMapping: resolvedMapping,
    rawTableRows: rawTableRows.slice(0, 1000),
    ...summary,
    rawTextPreview: normalizedText.slice(0, 1400),
    errorMessage:
      candidates.length === 0
        ? 'تم استخراج نص الملف ولكن لم يتم التعرف على صفوف منتجات/أسعار قياسية. يمكنك استخدام أداة تعيين الأعمدة أو مراجعة النص الخام.'
        : null,
  };
}
