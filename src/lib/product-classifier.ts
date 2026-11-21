import type { Product, ProductCategory } from '../../types.ts';

export interface ClassificationResult {
  categoryId: string;
  categoryName: string;
  defaultUnit: string;
  confident: boolean;
  matchedKeyword?: string;
}

export interface CategoryConflictInfo {
  hasConflict: boolean;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  reason: string;
}

const FALLBACK_CATEGORY_META: Record<string, { name: string; defaultUnit: string }> = {
  'cat-oils': { name: 'الزيوت العطرية', defaultUnit: 'mg' },
  'cat-packaging': { name: 'الفوارغ والعبوات', defaultUnit: 'قطعة' },
  'cat-alcohol': { name: 'الكحول', defaultUnit: 'لتر' },
  'cat-chemicals': { name: 'الكيماويات', defaultUnit: 'جرام' },
  'cat-other': { name: 'مستلزمات أخرى', defaultUnit: 'قطعة' },
};

/**
 * Normalizes Unicode Arabic Presentation Forms (e.g. ﻗ → ق, ﻣﺳك → مسك),
 * converts Arabic-Indic digits to ASCII digits, and strips tatweel/diacritics
 * while preserving readable Arabic letters (ة, أ, إ, ي).
 */
export function normalizeArabicDisplay(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[\u0640\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search/keyword normalization for Arabic & English matching:
 * handles Presentation Forms, digits, alef variants, teh marbuta, and alef maksura.
 */
export function normalizeArabicForSearch(input: string): string {
  return normalizeArabicDisplay(input)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingKeyword(normalizedText: string, keywords: string[]): string | undefined {
  if (!normalizedText) return undefined;
  for (const kw of keywords) {
    const cleanKw = normalizeArabicForSearch(kw);
    if (!cleanKw) continue;
    // Unicode-safe token boundary check (avoid JS \b bug on Arabic characters)
    const boundaryPattern = new RegExp(
      `(?:^|[\\s\\-_/|,.;:()\\[\\]'"%×*+])(${escapeRegex(cleanKw)})(?:$|[\\s\\-_/|,.;:()\\[\\]'"%×*+])`,
      'i'
    );
    if (boundaryPattern.test(normalizedText)) {
      return kw;
    }
    // Also allow prefix/stem contains for multi-character Arabic descriptors (4+ chars)
    if (/[\u0600-\u06FF]/.test(cleanKw) && cleanKw.length >= 4 && normalizedText.includes(cleanKw)) {
      return kw;
    }
  }
  return undefined;
}

const EXPLICIT_EMPTY_PACKAGING_KEYWORDS = [
  'فارغ',
  'فارغه',
  'فوارغ',
  'تيستر',
  'تايستر',
  'بخاخ',
  'طرمبه',
  'مضخه',
  'مكبس',
  'سرنجه',
  'بليه',
  'بمب',
  'غطاء',
  'كبس',
  'قطاره',
  'كرتونه',
  'كرتون',
  'اتومايزر',
  'empty',
  'tester',
  'spray',
  'atomizer',
  'pump',
  'cap',
  'dropper',
  'carton',
  'crimp',
];

const ALCOHOL_KEYWORDS = [
  'كحول',
  'ايثيلي',
  'ايثانول',
  'ميثانول',
  'سبيرتو',
  'اسبيرتو',
  'alcohol',
  'ethanol',
  'ethyl',
  'methanol',
  'spirits',
];

const CHEMICAL_KEYWORDS = [
  'مثبت',
  'مثبتات',
  'دي بروبيلين',
  'بروبيلين',
  'جلسرين',
  'بنزيل',
  'كيماويات',
  'كيميا',
  'كيميائي',
  'سنديان',
  'تثبيت',
  'dpg',
  'chemical',
  'chemicals',
  'fixative',
  'glycerin',
  'glycerol',
  'stabilizer',
  'dipropylene',
  'benzyl',
];

const GENERIC_CONTAINER_PACKAGING_KEYWORDS = [
  'زجاجه',
  'زجاجات',
  'زجاج',
  'عبوه',
  'عبوات',
  'بلاستيك',
  'جركن',
  'برطمان',
  'قاروره',
  'bottle',
  'bottles',
  'vial',
  'vials',
  'flacon',
  'jar',
  'plastic',
  'glass',
  'packaging',
];

const OIL_KEYWORDS = [
  'زيت',
  'زيوت',
  'اسانس',
  'خلاصه',
  'عطر',
  'عطور',
  'عطري',
  'عطريه',
  'عود',
  'مسك',
  'عنبر',
  'لافندر',
  'ياسمين',
  'فانيليا',
  'صندل',
  'برجموت',
  'oil',
  'oils',
  'perfume',
  'essence',
  'fragrance',
  'oud',
  'musk',
  'amber',
  'lavender',
  'jasmine',
  'vanilla',
];

function resolveCategoryMeta(
  categoryId: string,
  categoriesCatalog?: ProductCategory[]
): { categoryId: string; categoryName: string; defaultUnit: string } {
  const slugMap: Record<string, string> = {
    'cat-oils': 'oils',
    'cat-packaging': 'packaging',
    'cat-alcohol': 'alcohol',
    'cat-chemicals': 'chemicals',
    'cat-other': 'other',
  };
  const found = categoriesCatalog?.find(
    (c) => c.id === categoryId || (slugMap[categoryId] && c.slug === slugMap[categoryId])
  );
  if (found) {
    return {
      categoryId: found.id,
      categoryName: found.name,
      defaultUnit: found.defaultUnit || FALLBACK_CATEGORY_META[categoryId]?.defaultUnit || 'قطعة',
    };
  }
  const fb = FALLBACK_CATEGORY_META[categoryId] || FALLBACK_CATEGORY_META['cat-other'];
  return {
    categoryId,
    categoryName: fb.name,
    defaultUnit: fb.defaultUnit,
  };
}

/**
 * Centralized rule-based auto-classification for custom/unlinked items:
 * Precedence prevents false oil positives like "زجاجة عطر 50 مل" or "تيستر عطور 5 مل" or "كحول إيثيلي معطر":
 * 1. Explicit empty/hardware packaging (تيستر / بخاخ / فارغ / غطاء / طرمبة / كرتونة) -> cat-packaging
 * 2. Alcohol (كحول / إيثيلي / إيثانول) -> cat-alcohol (catches "جركن كحول" & "كحول إيثيلي معطر")
 * 3. Chemicals (مثبت / DPG / جلسرين / كيماويات) -> cat-chemicals (catches "مثبت عطور DPG")
 * 4. Container packaging (زجاجة / عبوة / بلاستيك / جركن) -> cat-packaging (catches "زجاجة عطر 50 مل")
 * 5. Oils & fragrances (زيت / عود / مسك / عطر ...) -> cat-oils
 * 6. Fallback -> cat-other (NEVER cat-oils)
 */
export function classifyProductName(
  productName: string,
  categoriesCatalog?: ProductCategory[]
): ClassificationResult {
  const normalized = normalizeArabicForSearch(productName);
  if (!normalized) {
    return {
      ...resolveCategoryMeta('cat-other', categoriesCatalog),
      confident: false,
    };
  }

  const emptyPkgKw = findMatchingKeyword(normalized, EXPLICIT_EMPTY_PACKAGING_KEYWORDS);
  if (emptyPkgKw) {
    return {
      ...resolveCategoryMeta('cat-packaging', categoriesCatalog),
      confident: true,
      matchedKeyword: emptyPkgKw,
    };
  }

  const alcoholKw = findMatchingKeyword(normalized, ALCOHOL_KEYWORDS);
  if (alcoholKw) {
    return {
      ...resolveCategoryMeta('cat-alcohol', categoriesCatalog),
      confident: true,
      matchedKeyword: alcoholKw,
    };
  }

  const chemKw = findMatchingKeyword(normalized, CHEMICAL_KEYWORDS);
  if (chemKw) {
    return {
      ...resolveCategoryMeta('cat-chemicals', categoriesCatalog),
      confident: true,
      matchedKeyword: chemKw,
    };
  }

  const containerPkgKw = findMatchingKeyword(normalized, GENERIC_CONTAINER_PACKAGING_KEYWORDS);
  if (containerPkgKw) {
    return {
      ...resolveCategoryMeta('cat-packaging', categoriesCatalog),
      confident: true,
      matchedKeyword: containerPkgKw,
    };
  }

  const oilKw = findMatchingKeyword(normalized, OIL_KEYWORDS);
  if (oilKw) {
    return {
      ...resolveCategoryMeta('cat-oils', categoriesCatalog),
      confident: true,
      matchedKeyword: oilKw,
    };
  }

  return {
    ...resolveCategoryMeta('cat-other', categoriesCatalog),
    confident: false,
  };
}

/**
 * Non-destructive check for existing catalog products whose assigned category
 * may conflict with their name (e.g. a chemical or packaging item placed under Oils).
 * Never mutates stored records automatically.
 */
export function detectCatalogCategoryConflict(
  product: Pick<Product, 'name' | 'categoryId' | 'categoryName'>,
  categoriesCatalog?: ProductCategory[]
): CategoryConflictInfo | null {
  const suggestion = classifyProductName(product.name, categoriesCatalog);
  if (!suggestion.confident) return null;
  if (suggestion.categoryId === product.categoryId) return null;
  return {
    hasConflict: true,
    suggestedCategoryId: suggestion.categoryId,
    suggestedCategoryName: suggestion.categoryName,
    reason: `الاسم يتضمن "${suggestion.matchedKeyword}" ويرجّح تصنيفه تحت "${suggestion.categoryName}" بدلاً من "${product.categoryName}"`,
  };
}
