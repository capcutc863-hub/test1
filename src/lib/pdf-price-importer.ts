import { GoogleGenAI, Type } from '@google/genai';
import { DEFAULT_CATEGORIES } from './commission-utils.ts';
import {
  CATEGORY_IMPORT_HANDLERS,
  type CategoryDocumentDetectionResult,
  type CategoryImportHandler,
  detectDocumentCategory,
  getCategoryImportHandler,
} from './import-categories.ts';
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
  fileName?: string;
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
 * Reconstructs Arabic lines extracted by pdf-parse where individual Presentation Forms-B
 * glyphs were separated by `\t` (e.g. "ﻗ\tﺎ\tﺋ\tﻤ\tﺔ" or "1004\tﻣ\tﻠ\tﻲ \t30 ...").
 * Leaves normal `\t`-delimited tables completely untouched.
 */
function reconstructArabicSpacedGlyphTabs(rawLine: string): string {
  if (!rawLine.includes('\t')) return rawLine;
  const tabParts = rawLine.split('\t');
  const shortArabicSegs = tabParts.filter((p) =>
    /^[\u0600-\u06FF\uFB50-\uFEFF]{1,3}\s*$/.test(p)
  ).length;
  if (shortArabicSegs < 2) return rawLine;

  // Dual-joining FINAL/ISOLATED Presentation Forms-B + plain isolated dual-joiners after right-joiners
  const wordEnders = new Set([
    0xfe90, 0xfe8f, 0xfe94, 0xfe93, 0xfe96, 0xfe95, 0xfe9a, 0xfe99, 0xfe9e, 0xfe9d,
    0xfea2, 0xfea1, 0xfea6, 0xfea5, 0xfeb2, 0xfeb1, 0xfeb6, 0xfeb5, 0xfeba, 0xfeb9,
    0xfebe, 0xfebd, 0xfec2, 0xfec1, 0xfec6, 0xfec5, 0xfeca, 0xfec9, 0xfece, 0xfecd,
    0xfed2, 0xfed1, 0xfed6, 0xfed5, 0xfeda, 0xfed9, 0xfede, 0xfedd, 0xfee2, 0xfee1,
    0xfee6, 0xfee5, 0xfeea, 0xfee9, 0xfef0, 0xfeef, 0xfef2, 0xfef1, 0xfe8a, 0xfe89,
    0x0628, 0x0629, 0x062a, 0x062b, 0x062c, 0x062d, 0x062e, 0x0633, 0x0634, 0x0635,
    0x0636, 0x0637, 0x0638, 0x0639, 0x063a, 0x0641, 0x0642, 0x0643, 0x0644, 0x0645,
    0x0646, 0x0647, 0x0649, 0x064a,
  ]);
  const rightJoiners = new Set([
    0x0627, 0x0622, 0x0623, 0x0625, 0x062f, 0x0630, 0x0631, 0x0632, 0x0648, 0x0624,
    0xfe8d, 0xfe8e, 0xfea9, 0xfeaa, 0xfeab, 0xfeac, 0xfead, 0xfeae, 0xfeaf, 0xfeb0,
    0xfeed, 0xfeee,
  ]);
  const initialForms = new Set([
    0xfe91, 0xfe97, 0xfe9b, 0xfe9f, 0xfea3, 0xfea7, 0xfeb3, 0xfeb7, 0xfebb, 0xfebf,
    0xfec3, 0xfec7, 0xfecb, 0xfecf, 0xfed3, 0xfed7, 0xfedb, 0xfedf, 0xfee3, 0xfee7,
    0xfeeb, 0xfef3, 0xfe8b,
  ]);

  let out = '';
  for (let i = 0; i < tabParts.length; i++) {
    const seg = tabParts[i];
    if (i === 0) {
      out += seg;
      continue;
    }
    const prevSeg = tabParts[i - 1];
    const hasTrailingSpace = /\s$/.test(prevSeg);
    const prevTrimmed = prevSeg.trimEnd();
    const lastCh = prevTrimmed.slice(-1);
    const nextTrimmed = seg.trimStart();
    const firstCh = nextTrimmed.slice(0, 1);

    const prevIsArabic = /[\u0600-\u06FF\uFB50-\uFEFF]/.test(lastCh);
    const nextIsArabic = /[\u0600-\u06FF\uFB50-\uFEFF]/.test(firstCh);

    if (hasTrailingSpace) {
      out += ' ' + nextTrimmed;
    } else if (prevIsArabic && nextIsArabic) {
      const lastCode = lastCh.charCodeAt(0);
      const firstCode = firstCh.charCodeAt(0);
      const secondCode =
        nextTrimmed.length >= 2
          ? nextTrimmed.charCodeAt(1)
          : tabParts[i + 1]?.trimStart().charCodeAt(0) || 0;
      const startsWithDefiniteArticle =
        (firstCode === 0x0627 || firstCode === 0xfe8d) &&
        (secondCode === 0xfedf || secondCode === 0xfef7 || secondCode === 0x0644);

      if (wordEnders.has(lastCode)) {
        out += ' ' + seg;
      } else if (rightJoiners.has(lastCode) && startsWithDefiniteArticle) {
        out += ' ' + seg;
      } else if (
        lastCode === 0x062f &&
        firstCode === 0x0627 &&
        nextTrimmed.length === 1 &&
        tabParts[i + 1] &&
        initialForms.has(tabParts[i + 1].charCodeAt(0))
      ) {
        out += ' ' + seg;
      } else {
        out += seg;
      }
    } else {
      out += '\t' + seg;
    }
  }
  return out.normalize('NFKC').replace(/ +/g, ' ').trim();
}

const KNOWN_HEADER_PHRASE_REGEX =
  /(?:اسم\s+الصنف|اسم\s+المنتج|رقم\s+الصنف|سعر\s+البيع|سعر\s+الشراء|سعر\s+التكلف[هة]|سعر\s+القطع[هة]|سعر\s+الدست[هة]|سعر\s+الكرتون[هة]|سعر\s+اللتر|سعر\s+الجركن|سعر\s+الكيلو|سعر\s+الجرام|الكود|الصنف|المنتج|التكلف[هة]|السعر|السع[هة]|الشكل|الشد|التركيز|الوحد[هة])/g;

function splitMergedHeaderRow(cells: string[]): string[] {
  if (cells.length !== 1) return cells;
  const line = normalizeArabicDisplay(cells[0]);
  if (line.length > 90) return cells;
  const matches = line.match(KNOWN_HEADER_PHRASE_REGEX);
  if (matches && matches.length >= 2) {
    let semanticHits = 0;
    for (const p of matches) {
      const r = classifyHeaderCellRole(p);
      if (r.role && r.role !== 'ignore') semanticHits += 1;
    }
    if (semanticHits >= 2) return matches.map((p) => p.trim());
  }
  return cells;
}

/**
 * Splits a raw text line into cells BEFORE collapsing whitespace so `\t` delimiters survive!
 */
function splitLineIntoCells(rawLine: string): string[] {
  const repaired = reconstructArabicSpacedGlyphTabs(rawLine);
  const stitched = stitchSpacedHyphenCodes(repaired.trim());
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
  return splitMergedHeaderRow([normalizeArabicDisplay(stitched)]);
}

export function extractRawTableRowsFromText(rawText: string): string[][] {
  return rawText
    .split(/\r?\n/)
    .map((l) => reconstructArabicSpacedGlyphTabs(l.replace(/\r/g, '')))
    .filter((l) => !isNoiseOrBannerLine(l))
    .map((l) => splitLineIntoCells(l))
    .filter((cells) => cells.some((c) => c.trim().length > 0));
}

function classifyHeaderCellRole(
  cell: string,
  handler?: CategoryImportHandler
): {
  role: PriceListColumnRole | null;
  isAmbiguousBarePrice: boolean;
  detectedUnit?: ProductUnit | null;
} {
  const rawNorm = normalizeArabicDisplay(cell);
  const norm = normalizeArabicForSearch(cell);
  if (!norm) return { role: null, isAmbiguousBarePrice: false };

  if (/^(#|n|no|م|مسلسل|ت|sr|seq|الرقم)$/.test(norm)) {
    return { role: 'serial', isAmbiguousBarePrice: false };
  }
  if (/(الصنف|اسم الصنف|المنتج|اسم المنتج|اسم العطر|اسم|item|product|name)/.test(norm)) {
    return { role: 'name', isAmbiguousBarePrice: false };
  }
  if (/(designer|براند|وصف|الوصف|تفاصيل|ملاحظات|description|brand|notes)/.test(norm)) {
    return { role: 'description', isAmbiguousBarePrice: false };
  }
  if (/(الوحده|الوحدة|وحده|وحدة|unit|uom)/.test(norm)) {
    return { role: 'unit', isAmbiguousBarePrice: false };
  }
  if (/^\d{2,3}\s*(?:g|جم|جرام)$/i.test(norm) && (!handler || handler.supportsGrades)) {
    return { role: 'ignore', isAmbiguousBarePrice: false };
  }
  // Check cost/purchase BEFORE code & selling price
  if (/(سعر الشراء|سعر التكلف[هة]|التكلف[هة]|تكلف[هة]|شراء|cost|buy|purchase|wholesale cost)/.test(norm)) {
    return { role: 'costPrice', isAmbiguousBarePrice: false };
  }

  // Category-specific column roles & non-oil pricing rules
  if (handler && !handler.supportsGrades) {
    const extra = handler.classifyExtraHeaderCell(norm, rawNorm);
    if (extra) {
      return {
        role: extra.role,
        isAmbiguousBarePrice: Boolean(extra.isAmbiguousBarePrice),
        detectedUnit: extra.detectedUnit ?? null,
      };
    }
  } else if (!handler) {
    // Generic header detection used before category is resolved (e.g. getTable() vs getText() choice)
    for (const key of ['packaging', 'alcohol', 'chemicals'] as const) {
      const extra = CATEGORY_IMPORT_HANDLERS[key].classifyExtraHeaderCell(norm, rawNorm);
      if (extra) {
        return {
          role: extra.role,
          isAmbiguousBarePrice: Boolean(extra.isAmbiguousBarePrice),
          detectedUnit: extra.detectedUnit ?? null,
        };
      }
    }
  }

  if (/(?:1\s*kg|سعر الكيلو|لكل كيلو|\/\s*كجم|\/\s*kg|per kg)/.test(norm)) {
    return { role: 'pricePerKg', isAmbiguousBarePrice: false };
  }
  if (/(?:1\s*g|سعر الجرام|سعر الغرام|لكل جرام|\/\s*جم|\/\s*g|per gram)/.test(norm)) {
    return { role: 'pricePerGram', isAmbiguousBarePrice: false };
  }
  if (/(سعر البيع|البيع|سعر كود|سعر الجمل[هة]|سعر|selling|sale|retail|unit price)/.test(norm)) {
    const bare = /^(السعر|سعر|price)$/.test(norm);
    return {
      role: 'sellingPrice',
      isAmbiguousBarePrice: handler ? bare && !handler.allowSingleBarePriceAsSelling : bare,
    };
  }
  if (/(الكود|كود|code|sku|رقم الصنف|رمز)/.test(norm)) {
    return { role: 'code', isAmbiguousBarePrice: false };
  }
  return { role: null, isAmbiguousBarePrice: false };
}

function isHeaderRowCells(cells: string[], handler?: CategoryImportHandler): boolean {
  if (cells.length < 2) return false;
  let semanticHits = 0;
  let hasCodeOrName = false;
  for (const c of cells) {
    const { role } = classifyHeaderCellRole(c, handler);
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
  hasCodeColumnInTable: boolean;
  headerRowText: string;
}

function inferColumnMappingFromRows(
  rows: string[][],
  gradesCatalog: OilGradeRecord[],
  handler: CategoryImportHandler = CATEGORY_IMPORT_HANDLERS.oils
): AnalyzedMappingResult {
  for (let rIdx = 0; rIdx < Math.min(rows.length, 15); rIdx++) {
    const row = rows[rIdx];
    if (!isHeaderRowCells(row, handler)) continue;

    const columns: Record<number, PriceListColumnRole> = {};
    const columnConfigs: Record<number, PriceListColumnAssignment> = {};
    let hasAmbiguousPriceHeader = false;
    let oilSourceUnit: PriceListColumnMapping['oilSourceUnit'] = 'auto';
    let detectedHeaderUnit: ProductUnit | null = null;
    let nameColIdx = -1;
    let hasCodeColumnInTable = false;

    row.forEach((cell, colIdx) => {
      const normCell = normalizeArabicDisplay(cell);
      const { role, isAmbiguousBarePrice, detectedUnit } = classifyHeaderCellRole(normCell, handler);
      const effectiveRole: PriceListColumnRole = role || 'ignore';
      columns[colIdx] = effectiveRole;
      if (effectiveRole === 'code') hasCodeColumnInTable = true;

      const uHeader = detectUnit(normCell, 'قطعة');
      if (handler.supportsGrades) {
        if (uHeader.matched && (uHeader.unit === 'كيلوجرام' || uHeader.unit === 'جرام')) {
          detectedHeaderUnit = uHeader.unit;
        }
      } else if (detectedUnit) {
        detectedHeaderUnit = detectedUnit;
      } else if (uHeader.matched && effectiveRole === 'sellingPrice') {
        detectedHeaderUnit = uHeader.unit;
      }

      if (effectiveRole === 'name' && nameColIdx === -1) nameColIdx = colIdx;
      if (handler.supportsGrades) {
        if (effectiveRole === 'pricePerKg') {
          oilSourceUnit = 'كيلوجرام';
          detectedHeaderUnit = 'كيلوجرام';
        }
        if (effectiveRole === 'pricePerGram') {
          oilSourceUnit = 'جرام';
          detectedHeaderUnit = 'جرام';
        }
      }
      if (isAmbiguousBarePrice) hasAmbiguousPriceHeader = true;

      let gradeName: string | null = null;
      let gradeId: string | null = null;
      if (
        handler.supportsGrades &&
        (effectiveRole === 'sellingPrice' ||
          effectiveRole === 'costPrice' ||
          effectiveRole === 'pricePerKg' ||
          effectiveRole === 'pricePerGram' ||
          effectiveRole === 'code')
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
        unit: detectedUnit || (uHeader.matched ? uHeader.unit : null),
      };
    });

    const detectedGrades: AnalyzedMappingResult['detectedGrades'] = [];
    let isMultiGradeTable = false;

    if (handler.supportsGrades) {
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

      detectedGrades.push(...Array.from(gradeMap.values()));
      isMultiGradeTable = detectedGrades.length > 1 || codeColIndices.length > 1;
    }

    return {
      mapping: {
        hasHeaderRow: true,
        columns,
        columnConfigs,
        oilSourceUnit: handler.supportsGrades ? oilSourceUnit : 'auto',
        sourceUnit: detectedHeaderUnit || 'auto',
      },
      headerRowIndex: rIdx,
      headerExplicitlyAmbiguousPrice:
        hasAmbiguousPriceHeader && !isMultiGradeTable && !handler.allowSingleBarePriceAsSelling,
      detectedGrades,
      detectedHeaderUnit,
      isMultiGradeTable,
      hasCodeColumnInTable,
      headerRowText: row.join(' '),
    };
  }

  return {
    mapping: null,
    headerRowIndex: -1,
    headerExplicitlyAmbiguousPrice: false,
    detectedGrades: [],
    detectedHeaderUnit: null,
    isMultiGradeTable: false,
    hasCodeColumnInTable: false,
    headerRowText: '',
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
  rawAttributes?: Record<string, string>;
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
  gradesCatalog: OilGradeRecord[] = DEFAULT_OIL_GRADES,
  handlerOverride?: CategoryImportHandler
): {
  candidates: RawCandidateItem[];
  resolvedMapping: PriceListColumnMapping | null;
  detectedGrades: AnalyzedMappingResult['detectedGrades'];
  detectedHeaderUnit: ProductUnit | null;
  isMultiGradeTable: boolean;
  serialNumbers: number[];
  hasCodeColumnInTable: boolean;
  headerRowText: string;
} {
  const listCatObj = listCategoryId
    ? categories.find((c) => c.id === listCategoryId) || null
    : null;
  const handler = handlerOverride || getCategoryImportHandler(listCatObj);

  const inferred = inferColumnMappingFromRows(rawRows, gradesCatalog, handler);
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

  const hasCodeColumnInTable =
    inferred.hasCodeColumnInTable ||
    Object.values(mergedColumns).some((r) => r === 'code');

  const headerIsAmbiguousSinglePrice =
    !explicitHasColumns &&
    inferred.headerExplicitlyAmbiguousPrice &&
    !handler.allowSingleBarePriceAsSelling;
  const headerRowIdx =
    mapping?.hasHeaderRow !== false && inferred.headerRowIndex >= 0 ? inferred.headerRowIndex : -1;

  const allHeaderText =
    headerRowIdx >= 0 && rawRows[headerRowIdx] ? rawRows[headerRowIdx].join(' ') : '';
  const docHeaderUnit = detectUnit(allHeaderText, 'قطعة');

  const fixVisualRtlName = (rawName: string): string => {
    if (handler.supportsGrades) return rawName;
    const n = normalizeArabicDisplay(rawName);
    // e.g. "ملي 30 فوارغ بلاستيك" -> "فوارغ بلاستيك 30 ملي"
    const mLeadCap = n.match(/^(?:ملي|ملل|مل)\s+(\d+(?:\.\d+)?)\s+(.+)$/);
    if (mLeadCap) {
      return `${mLeadCap[2].trim()} ${mLeadCap[1]} ملي`;
    }
    // e.g. "ملي عضلات 100 فوارغ زجاج مستورد" -> "فوارغ زجاج مستورد 100 ملي عضلات"
    const mLeadModCap = n.match(/^(?:ملي|ملل|مل)\s+([^\d]+?)\s+(\d+(?:\.\d+)?)\s+(.+)$/);
    if (mLeadModCap) {
      return `${mLeadModCap[3].trim()} ${mLeadModCap[2]} ملي ${mLeadModCap[1].trim()}`;
    }
    // Pure capacity line "ملي 30" or "ملي عضلات 100"
    const mOnlyCap = n.match(/^(?:ملي|ملل|مل)\s+(\d+(?:\.\d+)?)$/);
    if (mOnlyCap) {
      return `${mOnlyCap[1]} ملي`;
    }
    const mOnlyModCap = n.match(/^(?:ملي|ملل|مل)\s+([^\d]+?)\s+(\d+(?:\.\d+)?)$/);
    if (mOnlyModCap) {
      return `${mOnlyModCap[2]} ملي ${mOnlyModCap[1].trim()}`;
    }
    // Leading concentration "96% كحول طبي اوزون" -> "كحول طبي اوزون 96%"
    const mLeadPct = n.match(/^(\d{2,3}(?:\.\d+)?%)\s+(.+)$/);
    if (mLeadPct) {
      return `${mLeadPct[2].trim()} ${mLeadPct[1]}`;
    }
    return n;
  };

  const isSizeOnlyVariantName = (nameText: string): boolean => {
    return /^(?:\d+(?:\.\d+)?\s*(?:مللي|ملي|ملل|مل|لتر|جرام|جم|كيلو)(?:\s+[\p{L}]+)?|(?:ملي|ملل|مل)\s+(?:[^\d]+\s+)?\d+(?:\.\d+)?)$/iu.test(
      normalizeArabicDisplay(nameText)
    );
  };

  const candidates: RawCandidateItem[] = [];
  const serialNumbers: number[] = [];
  let activeSectionHeading = '';

  for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
    const cells = rawRows[rIdx];
    if (!cells || cells.length === 0) continue;
    if (rIdx <= headerRowIdx) continue;
    if (isHeaderRowCells(cells, handler)) continue;

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
      const rawAttributes: Record<string, string> = {};

      // Group grade variants per row (used strictly when handler.supportsGrades is true)
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
        if (role === 'capacity' || role === 'shape' || role === 'packSize' || role === 'concentration' || role === 'specs') {
          const attrKey =
            role === 'capacity' && handler.profileKey === 'alcohol' ? 'containerSize' : role;
          rawAttributes[attrKey] = rawAttributes[attrKey] ? `${rawAttributes[attrKey]} · ${val}` : val;
          if (!sharedDescription) sharedDescription = val;
          else if (!sharedDescription.includes(val)) sharedDescription = `${sharedDescription} · ${val}`;
          continue;
        }
        if (role === 'unit') {
          const u = detectUnit(val, 'قطعة');
          sharedUnitStr = u.matched ? u.unit : val;
          continue;
        }

        const slotGradeName = handler.supportsGrades
          ? cfg.gradeName || mapping.defaultGradeName || ''
          : '';
        const slotGradeId = handler.supportsGrades ? cfg.gradeId ?? null : null;

        if (role === 'code') {
          const cleanC = normalizeCodeToken(val);
          if (slotGradeName) {
            getSlot(slotGradeName, slotGradeId).code = cleanC;
          } else {
            sharedCode = cleanC;
          }
          continue;
        }

        if (!sharedUnitStr && cfg.unit && !handler.supportsGrades) {
          sharedUnitStr = cfg.unit;
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
          gradeName: handler.supportsGrades ? mapping.defaultGradeName || '' : '',
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
        if (handler.supportsGrades) {
          if (slot.sellFromKg !== null) pUnit = 'كيلوجرام';
          else if (slot.sellFromGram !== null) pUnit = 'جرام';
          else if (mapping.sourceUnit && mapping.sourceUnit !== 'auto' && mapping.sourceUnit !== 'unconfirmed') {
            pUnit = mapping.sourceUnit;
          } else if (mapping.oilSourceUnit && mapping.oilSourceUnit !== 'auto') {
            pUnit = mapping.oilSourceUnit;
          } else if (sharedUnitStr === 'كيلوجرام' || sharedUnitStr === 'جرام') {
            pUnit = sharedUnitStr;
          }
        } else {
          pUnit = sharedUnitStr || inferred.detectedHeaderUnit || null;
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

        let resolvedName = sharedName || finalCode;
        if (!handler.supportsGrades && resolvedName) {
          resolvedName = fixVisualRtlName(resolvedName);
          if (activeSectionHeading && isSizeOnlyVariantName(resolvedName)) {
            resolvedName = `${activeSectionHeading} ${resolvedName}`;
          } else {
            activeSectionHeading = '';
          }
        }

        candidates.push({
          rowIndex: rIdx,
          serialNumber,
          code: finalCode,
          name: resolvedName,
          baseProductName: resolvedName,
          grade: handler.supportsGrades ? slot.gradeName : '',
          gradeId: handler.supportsGrades ? slot.gradeId : null,
          rawAttributes: Object.keys(rawAttributes).length > 0 ? { ...rawAttributes } : undefined,
          description: sharedDescription,
          unit: sharedUnitStr,
          sellingPrice: finalSell,
          costPrice: finalCost,
          singleUnclearPrice: singleUnclear,
          isAvailable,
          priceSourceUnit: pUnit,
          costSourceUnit: pUnit,
          confidence:
            finalSell !== null || slot.sellUnavailable
              ? finalCode
                ? slot.gradeId || !slot.gradeName
                  ? 95
                  : 82
                : handler.allowAutoSuggestedCode
                  ? 84
                  : 70
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

    let name = nameParts.join(' ').trim();
    if (!name && !code) continue;
    if (!code && standaloneNumbers.length === 0 && explicitSell === null && explicitCost === null) {
      if (!handler.supportsGrades && name.length >= 2) {
        const nextRowText = normalizeArabicDisplay((rawRows[rIdx + 1] || []).join(' '));
        const nextIsSizeSubRow = isSizeOnlyVariantName(
          nextRowText.replace(/(?:^|\s)\d+(?:\.\d+)?\s*$/, '').trim()
        );
        const isGenericBanner = /^(قائم[هة]\s*ال[اأ]سعار|ال[اأ]سعار|بيان)/i.test(
          normalizeArabicForSearch(name)
        );
        if (isGenericBanner) {
          activeSectionHeading = '';
          continue;
        }
        if (nextIsSizeSubRow) {
          activeSectionHeading = name;
          continue;
        }
      }
      if (candidates.length > 0 && name.length >= 3) {
        const prev = candidates[candidates.length - 1];
        prev.description = prev.description ? `${prev.description} · ${name}` : name;
      }
      continue;
    }

    if (!handler.supportsGrades && name) {
      name = fixVisualRtlName(name);
      if (activeSectionHeading && isSizeOnlyVariantName(name)) {
        name = `${activeSectionHeading} ${name}`;
      } else {
        activeSectionHeading = '';
      }
    }

    if (!unitStr && handler.supportsGrades) {
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
        if (handler.allowSingleBarePriceAsSelling) {
          finalSell = standaloneNumbers[0];
        } else {
          singleUnclear = standaloneNumbers[0];
        }
      }
    }

    const gMatch = handler.supportsGrades
      ? resolveOilGradeMatch(`${name} ${description}`, gradesCatalog)
      : { matched: false, canonicalName: '', gradeId: null };

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
    hasCodeColumnInTable,
    headerRowText: inferred.headerRowText,
  };
}

async function extractWithGeminiMultimodal(
  base64Pdf: string,
  categories: ProductCategory[],
  gradesCatalog: OilGradeRecord[],
  rawTextHint: string,
  handler: CategoryImportHandler,
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

  const categorySpecificInstructions = handler.supportsGrades
    ? `
    درجات الزيوت العطرية المعرّفة في النظام: ${gradeNames}.
    - إذا احتوى الصف الواحد على أكثر من درجة جودة (مثل كود عالي وسعر كود عالي وتكلفة عالي، وكود وسط وسعر كود وسط وتكلفة وسط)، أخرج سجلًا مستقلاً لكل درجة جودة بنفس baseProductName ورقم المسلسل serialNumber.
    - إذا كان الملف يذكر وحدة وزن صراحة (مثل كيلو أو جرام) ضعها في priceSourceUnit، وإلا اترك priceSourceUnit فارغاً.
    - إذا كان هناك سعر واحد غامض تماماً اترك sellingPrice و costPrice قيمتهما null وضعه في singleUnclearPrice.`
    : handler.profileKey === 'packaging'
      ? `
    هذه القائمة خاصة بالفوارغ والعبوات والزجاجات والبخاخات (لا تستخدم درجات الزيوت مطلقاً):
    - استخرج لكل صنف: الكود (إن وجد)، اسم العبوة/الزجاجة، السعة بالمل (capacity مثل 50 مل)، الشكل/الخامة/الغلق (shape مثل كريستال كبس ذهبي)، عدد الشد/الكرتونة (packSize إن وجد)، الوحدة (قطعة/دستة/كرتونة/عبوة)، وسعر البيع (sellingPrice) وسعر التكلفة الاختياري (costPrice).
    - إذا احتوت القائمة على عمود سعر واحد (مثل "السعر" أو "سعر القطعة" أو "سعر الدستة") فاعتبره مباشرة سعر البيع sellingPrice.`
      : handler.profileKey === 'alcohol'
        ? `
    هذه القائمة خاصة بالكحول والمذيبات (لا تستخدم درجات الزيوت مطلقاً):
    - استخرج: الكود، اسم الكحول/النوع، درجة التركيز (concentration مثل 96% أو 99%)، سعة العبوة/الجركن (containerSize مثل 20 لتر)، الوحدة (لتر/جركن/ملليلتر/كيلوجرام)، وسعر البيع sellingPrice والتكلفة الاختيارية costPrice.`
        : `
    هذه القائمة خاصة بـ ${listCategoryName || handler.labelAr} (لا تفترض درجات زيوت ولا تقسم الأسعار على 1000):
    - استخرج: الكود، اسم الصنف، المواصفات (specs)، الوحدة الأصلية، وسعر البيع sellingPrice والتكلفة الاختيارية costPrice.`;

  const prompt = `
    استخرج جدول/قائمة المنتجات والأسعار من ملف PDF المرفق بدقة تامة دون اختراع أي أرقام غير موجودة.
    ${listCategoryName ? `تصنيف القائمة المحدد: ${listCategoryName}` : `التصنيفات المتاحة: ${catNames}.`}
    الوحدات المدعومة: mg، جرام، كيلوجرام، قطعة، عبوة، دستة، كرتونة، لتر، ملليلتر، جركن.
    ${categorySpecificInstructions}
    - تجاهل عمود المسلسل (# أو N أو م) ولا تضعه كسعر تكلفة أو بيع؛ ضعه فقط في serialNumber.
    - إذا كانت الخانة تحتوي على "غير متوفر" أو "-" اترك السعر null ولا تكتب 0.
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
                capacity: { type: Type.STRING },
                shape: { type: Type.STRING },
                packSize: { type: Type.STRING },
                concentration: { type: Type.STRING },
                containerSize: { type: Type.STRING },
                specs: { type: Type.STRING },
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
    items?: Array<
      RawCandidateItem & {
        serialNumber?: number | null;
        capacity?: string;
        shape?: string;
        packSize?: string;
        concentration?: string;
        containerSize?: string;
        specs?: string;
      }
    >;
  };
  return (Array.isArray(parsed.items) ? parsed.items : []).map((it, idx) => {
    const gMatch = handler.supportsGrades
      ? resolveOilGradeMatch(it.grade || '', gradesCatalog)
      : { matched: false, canonicalName: '', gradeId: null };
    const rawAttributes: Record<string, string> = {};
    if (it.capacity) rawAttributes.capacity = it.capacity;
    if (it.shape) rawAttributes.shape = it.shape;
    if (it.packSize) rawAttributes.packSize = it.packSize;
    if (it.concentration) rawAttributes.concentration = it.concentration;
    if (it.containerSize) rawAttributes.containerSize = it.containerSize;
    if (it.specs) rawAttributes.specs = it.specs;

    return {
      ...it,
      rowIndex: it.serialNumber || idx + 1,
      baseProductName: it.baseProductName || it.name,
      grade: gMatch.matched ? gMatch.canonicalName : handler.supportsGrades ? it.grade || '' : '',
      gradeId: gMatch.gradeId,
      rawAttributes: Object.keys(rawAttributes).length > 0 ? rawAttributes : undefined,
      isAvailable: it.sellingPrice !== null || it.costPrice !== null || it.singleUnclearPrice !== null,
    };
  });
}

function buildImportCounts(
  items: PriceListParsedItem[],
  serialNumbers: number[],
  rawRowsCount?: number,
  handler?: CategoryImportHandler
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
    const term = handler?.variantTermSingularAr || 'بند';
    excludedReasons.push(
      `${unavailableVariantsCount} ${term} محددة كـ "غير متوفر" في الملف (${unavailNames.join('، ')})`
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
  rawRowsCount?: number,
  extraOptions?: {
    handler?: CategoryImportHandler;
    detection?: CategoryDocumentDetectionResult;
    hasCodeColumnInTable?: boolean;
    headerRowText?: string;
  }
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
  const existingCodeSet = new Set(
    existingProducts.map((p) => (p.code || '').trim().toLowerCase()).filter(Boolean)
  );
  const finalized: PriceListParsedItem[] = [];

  let newCount = 0;
  let updatedCount = 0;
  let needsReviewCount = 0;
  let duplicateCount = 0;
  let autoCodeCounter = 1;

  const batchHandler =
    extraOptions?.handler ||
    (listCategory
      ? getCategoryImportHandler(listCategory)
      : candidates.some((c) => Boolean(c.grade))
        ? CATEGORY_IMPORT_HANDLERS.oils
        : CATEGORY_IMPORT_HANDLERS.other);

  const isOilList = batchHandler.supportsGrades;

  const targetUnit: ProductUnit =
    columnMapping?.targetUnit ||
    (isOilList ? 'جرام' : listCategory?.defaultUnit || batchHandler.defaultAllowedUnits[0] || 'قطعة');

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

  if (isOilList) {
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
    } else {
      sourceUnit = 'unconfirmed';
      confirmedByUser = false;
      conversionFactor = 1;
      if (medianSamplePrice !== null && medianSamplePrice >= 250) {
        suggestionReason = `متوسط الأسعار في الملف (${medianSamplePrice.toLocaleString()} ج.م) يشير غالباً إلى تسعير بالكيلوجرام — يرجى تأكيد وحدة السعر في الخطوة التالية لتحويله تلقائياً إلى ${targetUnit}.`;
      } else {
        suggestionReason = 'لم يصرّح الملف بوحدة التسعير (كيلوجرام أم جرام). يرجى تأكيد وحدة السعر قبل الاعتماد.';
      }
    }
  } else {
    sourceUnit = detectedHeaderUnit || targetUnit;
    confirmedByUser = true;
    conversionFactor = 1;
  }

  for (let i = 0; i < candidates.length; i++) {
    const raw = candidates[i];
    let cleanCode = raw.code ? normalizeCodeToken(raw.code) : '';
    const cleanBaseName = normalizeArabicDisplay(raw.baseProductName || raw.name || '');
    const cleanDesc = normalizeArabicDisplay(raw.description || '');
    const warnings: string[] = [];

    // Category resolution (auto-detected mixed non-oil files allow per-item specialization)
    let categoryId: string;
    let categoryName: string;
    const catConfident = true;

    if (
      extraOptions?.detection?.source === 'auto_detected' &&
      !batchHandler.supportsGrades &&
      (extraOptions.detection.confidence ?? 0) < 92
    ) {
      const itemCls = classifyProductName(`${cleanBaseName} ${cleanDesc}`, categories);
      if (itemCls.confident && itemCls.categoryId !== 'cat-oils') {
        categoryId = itemCls.categoryId;
        categoryName = itemCls.categoryName;
      } else {
        categoryId = extraOptions.detection.category.id;
        categoryName = extraOptions.detection.category.name;
      }
    } else if (listCategory) {
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
        const autoDoc = detectDocumentCategory({
          rawRows: [[cleanBaseName, cleanDesc]],
          categories,
          oilGrades: gradesCatalog,
        });
        categoryId = autoDoc.category.id;
        categoryName = autoDoc.category.name;
      }
    } else if (extraOptions?.detection) {
      categoryId = extraOptions.detection.category.id;
      categoryName = extraOptions.detection.category.name;
    } else {
      categoryId = DEFAULT_CATEGORIES[4].id;
      categoryName = DEFAULT_CATEGORIES[4].name;
    }

    const catObj = categories.find((c) => c.id === categoryId) || listCategory || null;
    const itemHandler = getCategoryImportHandler(catObj || batchHandler.profileKey);
    const isOilItem = itemHandler.supportsGrades;
    const catDefaultUnit: ProductUnit = isOilItem
      ? targetUnit
      : catObj?.defaultUnit || itemHandler.defaultAllowedUnits[0] || 'قطعة';

    let autoCodeNote: string | null = null;
    if (!cleanCode) {
      if (itemHandler.allowAutoSuggestedCode && extraOptions?.hasCodeColumnInTable === false) {
        let candidateCode = `${itemHandler.suggestedCodePrefix}-${String(autoCodeCounter).padStart(3, '0')}`;
        while (
          seenCodes.has(candidateCode.toLowerCase()) ||
          existingCodeSet.has(candidateCode.toLowerCase())
        ) {
          autoCodeCounter += 1;
          candidateCode = `${itemHandler.suggestedCodePrefix}-${String(autoCodeCounter).padStart(3, '0')}`;
        }
        autoCodeCounter += 1;
        cleanCode = candidateCode;
        autoCodeNote = `تم اقتراح كود تلقائي (${cleanCode}) لعدم وجود عمود كود بالملف — يمكنك تعديله`;
      } else {
        warnings.push('كود المنتج مفقود — يرجى إدخال كود فريد قبل الاعتماد');
      }
    }
    if (!cleanBaseName) {
      warnings.push('اسم المنتج مفقود');
    }

    // Grade resolution — strictly ONLY for oil items!
    let finalGrade = isOilItem ? normalizeArabicDisplay(raw.grade || '') : '';
    let finalGradeId: string | null = isOilItem ? raw.gradeId ?? null : null;
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
        const firstActiveGrade =
          gradesCatalog.find((g) => g.isActive) || DEFAULT_OIL_GRADES[0];
        finalGrade = firstActiveGrade.name;
        finalGradeId = firstActiveGrade.id;
      }
    }

    // Structured per-category attributes (non-oil categories)
    const attributes = itemHandler.extractAttributes({
      name: cleanBaseName,
      description: cleanDesc,
      rawAttributes: raw.rawAttributes,
    });

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
    let ambiguousSinglePrice =
      sellingPrice === null &&
      costPrice === null &&
      typeof raw.singleUnclearPrice === 'number' &&
      Number.isFinite(raw.singleUnclearPrice) &&
      raw.singleUnclearPrice > 0
        ? raw.singleUnclearPrice
        : null;

    if (!isOilItem && ambiguousSinglePrice !== null && itemHandler.allowSingleBarePriceAsSelling) {
      sellingPrice = ambiguousSinglePrice;
      ambiguousSinglePrice = null;
    }

    const originalPrice: number | null = sellingPrice ?? ambiguousSinglePrice;
    const originalCostPrice: number | null = costPrice;
    let finalUnit: ProductUnit = catDefaultUnit;
    let originalPriceUnit: string | null = null;
    let rowConversionFactor: number | null = null;
    let conversionNote: string | null = autoCodeNote;

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
      const explicitRowUnitRes = raw.unit
        ? detectUnit(raw.unit, catDefaultUnit)
        : { unit: catDefaultUnit, matched: false };
      const sameProfileHeaderUnit =
        itemHandler.profileKey === batchHandler.profileKey ? detectedHeaderUnit : null;
      const effectiveRowUnit =
        explicitRowUnitRes.matched &&
        (itemHandler.profileKey === batchHandler.profileKey || explicitRowUnitRes.unit !== detectedHeaderUnit)
          ? explicitRowUnitRes.unit
          : undefined;
      finalUnit = itemHandler.detectPreferredUnit({
        explicitHeaderUnit: sameProfileHeaderUnit,
        rowUnitText: effectiveRowUnit,
        name: cleanBaseName,
        description: cleanDesc,
        headerContextText:
          itemHandler.profileKey === batchHandler.profileKey
            ? extraOptions?.headerRowText
            : undefined,
        catDefaultUnit,
      });
      originalPriceUnit = finalUnit;
      rowConversionFactor = 1;
      if (!conversionNote) {
        conversionNote = `تسعير مباشر بـ (${finalUnit}) دون قسمة`;
      }
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
      warnings.push(
        isOilItem
          ? `الدرجة "${finalGrade || 'الأساسية'}" محددة كـ "غير متوفر" في الملف`
          : `الصنف "${cleanBaseName || cleanCode}" محدد كـ "غير متوفر" في الملف`
      );
    } else if (ambiguousSinglePrice !== null) {
      warnings.push('يحتوي على سعر واحد غير محدد النوع — حدد هل هو سعر بيع أم سعر شراء');
    } else if (missingSellPrice && !missingCostPrice) {
      warnings.push('سعر البيع مفقود بينما سعر التكلفة موجود — راجع سعر البيع');
    } else if (missingSellPrice && missingCostPrice) {
      warnings.push(
        isOilItem
          ? 'لم يتم العثور على سعر واضح لهذا الصنف/الدرجة'
          : 'لم يتم العثور على سعر واضح لهذا الصنف'
      );
    }

    if (sellingPrice !== null && costPrice !== null && costPrice > sellingPrice) {
      warnings.push(`تنبيه: التكلفة (${costPrice}) أعلى من سعر البيع (${sellingPrice})`);
    }

    // Matching & Duplicate check using CategoryImportHandler's variant key!
    let matchStatus: PriceListParsedItem['matchStatus'] = 'new';
    let matchedProduct: Product | undefined;
    let matchedBy: PriceListParsedItem['matchedBy'] = null;

    const codeKey = cleanCode.toLowerCase();
    const gradeKey = normalizeArabicForSearch(finalGrade || '');
    const unitKey = normalizeArabicForSearch(finalUnit);
    const variantKey = itemHandler.buildVariantKey({
      baseProductKey,
      gradeKey,
      unitKey,
      attributes,
    });

    if (cleanCode && seenCodes.has(codeKey)) {
      matchStatus = 'duplicate_in_file';
      duplicateCount += 1;
      warnings.push(`كود مكرر داخل نفس ملف PDF (${cleanCode})`);
    } else if (baseProductKey && seenVariantKeys.has(variantKey)) {
      matchStatus = 'duplicate_in_file';
      duplicateCount += 1;
      const summaryLabel = itemHandler.buildVariantSummaryLabel({
        grade: finalGrade,
        unit: finalUnit,
        attributes,
      });
      warnings.push(`صنف ومواصفات مكررة داخل نفس الملف (${cleanBaseName} · ${summaryLabel})`);
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
          if (isOilItem) {
            if (finalGrade) {
              const pGradeMatch = resolveOilGradeMatch(p.grade, gradesCatalog);
              const pGradeKey = normalizeArabicForSearch(
                pGradeMatch.matched ? pGradeMatch.canonicalName : p.grade || ''
              );
              return pGradeKey === gradeKey;
            }
            return !p.grade && normalizeArabicForSearch(p.unit) === unitKey;
          }
          const pAttrs = itemHandler.extractAttributes({
            name: p.name,
            description: p.description || '',
          });
          const pVariantKey = itemHandler.buildVariantKey({
            baseProductKey: pBase,
            gradeKey: '',
            unitKey: normalizeArabicForSearch(p.unit),
            attributes: pAttrs,
          });
          return pVariantKey === variantKey;
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
      categoryProfile: itemHandler.profileKey,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
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
            grade: Boolean(isOilItem && finalGrade && matchedProduct.grade !== finalGrade),
          }
        : undefined,
    });
  }

  const counts = buildImportCounts(finalized, serialNumbers, rawRowsCount, batchHandler);
  const samplePrice = finalized.find((f) => typeof f.originalPrice === 'number' && f.originalPrice > 0);
  const unitConfig: PriceListBatchUnitConfig = {
    detectedSourceUnit: detectedHeaderUnit,
    sourceUnit,
    targetUnit,
    confirmedByUser,
    conversionFactor,
    suggestionReason,
    exampleOriginalPrice: isOilList ? samplePrice?.originalPrice ?? 4000 : samplePrice?.originalPrice ?? null,
    exampleConvertedPrice: isOilList
      ? samplePrice?.originalPrice !== undefined && samplePrice?.originalPrice !== null
        ? roundUnitPrice(samplePrice.originalPrice * conversionFactor)
        : roundUnitPrice(4000 * conversionFactor)
      : samplePrice?.sellingPrice ?? null,
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
      detectedGrades: isOilList ? detectedGrades : [],
      isMultiGradeTable: isOilList ? isMultiGradeTable : false,
      categoryProfile: batchHandler.profileKey,
      detectedCategoryId: extraOptions?.detection?.category.id ?? listCategory?.id ?? null,
      detectedCategoryName: extraOptions?.detection?.category.name ?? listCategory?.name ?? null,
      detectionSource: extraOptions?.detection?.source ?? (listCategory ? 'user_selected' : 'auto_detected'),
      detectionConfidence: extraOptions?.detection?.confidence ?? 100,
      detectionReason: extraOptions?.detection?.reason ?? null,
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
  fileName?: string;
}): Omit<PdfExtractionOutput, 'extractionMethod' | 'rawTextPreview' | 'errorMessage'> {
  const categories =
    params.categoriesCatalog && params.categoriesCatalog.length > 0
      ? params.categoriesCatalog
      : DEFAULT_CATEGORIES;
  const gradesCatalog =
    params.oilGrades && params.oilGrades.length > 0 ? params.oilGrades : DEFAULT_OIL_GRADES;

  const detection = detectDocumentCategory({
    rawRows: params.rawTableRows,
    fileName: params.fileName,
    categories,
    explicitCategoryId: params.listCategoryId,
    oilGrades: gradesCatalog,
  });
  const listCategory = detection.category;
  const handler = getCategoryImportHandler(detection.profileKey);

  const {
    candidates,
    resolvedMapping,
    detectedGrades,
    detectedHeaderUnit,
    isMultiGradeTable,
    serialNumbers,
    hasCodeColumnInTable,
    headerRowText,
  } = parseStructuredTableRows(
    params.rawTableRows,
    categories,
    params.columnMapping || null,
    listCategory?.id || null,
    gradesCatalog,
    handler
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
    params.rawTableRows.length,
    {
      handler,
      detection,
      hasCodeColumnInTable,
      headerRowText,
    }
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

  // Detect document category BEFORE running category-specific column parsing!
  let detection = detectDocumentCategory({
    rawText: normalizedText,
    rawRows: rawTableRows,
    fileName: options.fileName,
    categories,
    explicitCategoryId: options.listCategoryId,
    oilGrades: gradesCatalog,
  });
  let listCategory: ProductCategory | null = detection.category;
  let handler = getCategoryImportHandler(detection.profileKey);

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
        handler,
        listCategory?.name
      );

      if ((!options.listCategoryId || options.listCategoryId === 'auto') && candidates.length > 0) {
        detection = detectDocumentCategory({
          rawRows: candidates.map((c) => [c.code || '', c.name || '', c.description || '']),
          fileName: options.fileName,
          categories,
          explicitCategoryId: 'auto',
          oilGrades: gradesCatalog,
        });
        listCategory = detection.category;
        handler = getCategoryImportHandler(detection.profileKey);
      }

      const summary = finalizeParsedItems(
        candidates,
        existingProducts,
        categories,
        gradesCatalog,
        listCategory,
        options.columnMapping || null,
        null,
        [],
        handler.supportsGrades && candidates.some((c) => Boolean(c.grade)),
        candidates
          .map((c) => c.serialNumber)
          .filter((n): n is number => typeof n === 'number'),
        undefined,
        {
          handler,
          detection,
          hasCodeColumnInTable: candidates.some((c) => Boolean(c.code)),
        }
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

  let {
    candidates,
    resolvedMapping,
    detectedGrades,
    detectedHeaderUnit,
    isMultiGradeTable,
    serialNumbers,
    hasCodeColumnInTable,
    headerRowText,
  } = parseStructuredTableRows(
    rawTableRows,
    categories,
    options.columnMapping || null,
    listCategory?.id || null,
    gradesCatalog,
    handler
  );
  let method: PdfExtractionOutput['extractionMethod'] = 'pdf_text';

  if (candidates.length === 0 && hasGeminiKey) {
    try {
      const aiCandidates = await extractWithGeminiMultimodal(
        base64Pdf,
        categories,
        gradesCatalog,
        normalizedText,
        handler,
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
    rawTableRows.length,
    {
      handler,
      detection,
      hasCodeColumnInTable,
      headerRowText,
    }
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
