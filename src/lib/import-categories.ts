import { DEFAULT_CATEGORIES } from './commission-utils.ts';
import {
  classifyProductName,
  normalizeArabicDisplay,
  normalizeArabicForSearch,
} from './product-classifier.ts';
import type {
  ImportCategoryProfileKey,
  OilGradeRecord,
  PriceListColumnRole,
  PriceListParsedItem,
  ProductCategory,
  ProductUnit,
} from '../../types.ts';

export interface CategoryDocumentDetectionResult {
  category: ProductCategory;
  profileKey: ImportCategoryProfileKey;
  source: 'user_selected' | 'auto_detected';
  confidence: number;
  reason: string;
}

export interface CategoryImportHandler {
  profileKey: ImportCategoryProfileKey;
  labelAr: string;
  processorTitleAr: string;
  variantTermSingularAr: string;
  variantTermPluralAr: string;
  supportsGrades: boolean;
  requiresUnitConfirmation: boolean;
  allowSingleBarePriceAsSelling: boolean;
  allowMissingCostWithoutReview: boolean;
  allowAutoSuggestedCode: boolean;
  suggestedCodePrefix: string;
  defaultAllowedUnits: ProductUnit[];
  classifyExtraHeaderCell: (
    normSearchCell: string,
    rawNormCell: string
  ) => {
    role: PriceListColumnRole;
    detectedUnit?: ProductUnit;
    isAmbiguousBarePrice?: boolean;
  } | null;
  extractAttributes: (params: {
    name: string;
    description?: string;
    rawAttributes?: Record<string, string>;
  }) => Record<string, string>;
  detectPreferredUnit: (params: {
    explicitHeaderUnit?: ProductUnit | null;
    rowUnitText?: string;
    name: string;
    description?: string;
    headerContextText?: string;
    catDefaultUnit: ProductUnit;
  }) => ProductUnit;
  buildVariantKey: (params: {
    baseProductKey: string;
    gradeKey?: string;
    unitKey: string;
    attributes?: Record<string, string>;
  }) => string;
  buildVariantSummaryLabel: (params: {
    grade?: string;
    unit: string;
    attributes?: Record<string, string>;
  }) => string;
}

function findMatchedToken(text: string, tokens: string[]): string {
  const norm = normalizeArabicForSearch(text);
  if (!norm) return '';
  for (const token of tokens) {
    const tNorm = normalizeArabicForSearch(token);
    if (!tNorm) continue;
    const re = new RegExp(
      `(?:^|[\\s\\-_/|,.;:()\\[\\]])${tNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s\\-_/|,.;:()\\[\\]])`,
      'i'
    );
    if (re.test(norm) || (tNorm.length >= 4 && norm.includes(tNorm))) {
      return token;
    }
  }
  return '';
}

function cleanAttrVal(v?: string | null): string {
  return normalizeArabicDisplay(v || '').trim();
}

export function resolveImportCategoryProfileKey(
  category?: Partial<Pick<ProductCategory, 'id' | 'slug' | 'name'>> | null
): ImportCategoryProfileKey {
  if (!category) return 'other';
  const id = (category.id || '').trim().toLowerCase();
  const slug = (category.slug || '').trim().toLowerCase();
  const name = normalizeArabicForSearch(category.name || '');

  if (id === 'cat-oils' || slug === 'oils' || /(زيت|زيوت|عطر|عطور|عطري|اسانس)/.test(name)) {
    return 'oils';
  }
  if (
    id === 'cat-packaging' ||
    id === 'cat-bottles' ||
    slug === 'packaging' ||
    slug === 'bottles' ||
    /(فوارغ|فارغ|عبو|زجاج|بخاخ|تيستر|تغليف|غطاء)/.test(name)
  ) {
    return 'packaging';
  }
  if (
    id === 'cat-alcohol' ||
    slug === 'alcohol' ||
    /(كحول|ايثيلي|ايثانول|سبيرتو|مذيب)/.test(name)
  ) {
    return 'alcohol';
  }
  if (
    id === 'cat-chemicals' ||
    slug === 'chemicals' ||
    /(كيماويات|كيميائ|مثبت|جلسرين|سنديان)/.test(name)
  ) {
    return 'chemicals';
  }
  return 'other';
}

export function findCategoryForProfile(
  profileKey: ImportCategoryProfileKey,
  categoriesCatalog: ProductCategory[] = DEFAULT_CATEGORIES
): ProductCategory {
  const list = categoriesCatalog.length > 0 ? categoriesCatalog : DEFAULT_CATEGORIES;
  const direct = list.find((c) => resolveImportCategoryProfileKey(c) === profileKey);
  if (direct) return direct;
  const fallback = DEFAULT_CATEGORIES.find(
    (c) => resolveImportCategoryProfileKey(c) === profileKey
  );
  return fallback || list[0] || DEFAULT_CATEGORIES[4];
}

function extractPackagingAttributes(params: {
  name: string;
  description?: string;
  rawAttributes?: Record<string, string>;
}): Record<string, string> {
  const combined = normalizeArabicDisplay(`${params.name} ${params.description || ''}`);
  const out: Record<string, string> = {};

  const capRaw = cleanAttrVal(params.rawAttributes?.capacity);
  if (capRaw) {
    out.capacity = capRaw;
  } else {
    const capMatch = combined.match(/(\d+(?:\.\d+)?)\s*(?:مللي|ملي|ملل|مل|ml|cc)(?=$|\s|[^\p{L}])/iu);
    if (capMatch) {
      out.capacity = `${capMatch[1]} مل`;
    }
  }

  const shapeRaw = cleanAttrVal(params.rawAttributes?.shape);
  if (shapeRaw) {
    out.shape = shapeRaw;
  } else {
    const shapeParts: string[] = [];
    const closures = ['كبس', 'قلاووظ', 'رول أون', 'رول اون', 'رول', 'قطارة', 'سبراي', 'بخاخ', 'طرمبة', 'أتومايزر', 'تستر', 'تيستر'];
    const materials = ['كريستال', 'زجاج', 'بلاستيك', 'ألومنيوم', 'أكريليك'];
    const forms = ['مربع', 'دائري', 'اسطواني', 'مستطيل', 'سداسي', 'مسحوب', 'ثقيل', 'رول'];
    const colors = ['شفاف', 'فاميه', 'أسود', 'اسود', 'ذهبي', 'فضي', 'أبيض', 'ابيض', 'عسلي', 'كهرماني', 'متجمد', 'مطفى'];

    for (const group of [materials, forms, closures, colors]) {
      const m = findMatchedToken(combined, group);
      if (m && !shapeParts.includes(m)) shapeParts.push(m);
    }
    if (shapeParts.length > 0) {
      out.shape = shapeParts.join(' · ');
    }
  }

  const packRaw = cleanAttrVal(params.rawAttributes?.packSize);
  if (packRaw) {
    out.packSize = packRaw;
  } else {
    const packMatch =
      combined.match(/(?:شد|تعبئة|كرتونة|باكو)\s*[:\-]?\s*(\d+)\s*(?:قطعة|حبة|زجاجة|عبوة)?/i) ||
      combined.match(/(\d+)\s*(?:قطعة|حبة|زجاجة)\s*(?:في|\/|بال)?\s*(?:الكرتونة|الشد|الباكو)/i);
    if (packMatch) {
      out.packSize = `${packMatch[1]} قطعة`;
    }
  }

  return out;
}

function extractAlcoholAttributes(params: {
  name: string;
  description?: string;
  rawAttributes?: Record<string, string>;
}): Record<string, string> {
  const combined = normalizeArabicDisplay(`${params.name} ${params.description || ''}`);
  const out: Record<string, string> = {};

  const concRaw = cleanAttrVal(params.rawAttributes?.concentration);
  if (concRaw) {
    out.concentration = concRaw.includes('%') ? concRaw : /^\d+(?:\.\d+)?$/.test(concRaw) ? `${concRaw}%` : concRaw;
  } else {
    const concMatch =
      combined.match(/(\d{2,3}(?:\.\d+)?)\s*%/) ||
      combined.match(/تركيز\s*[:\-]?\s*(\d{2,3}(?:\.\d+)?)/i);
    if (concMatch) {
      out.concentration = `${concMatch[1]}%`;
    }
  }

  const sizeRaw = cleanAttrVal(params.rawAttributes?.capacity || params.rawAttributes?.containerSize);
  if (sizeRaw) {
    out.containerSize = sizeRaw;
  } else {
    const sizeMatch = combined.match(/(\d+(?:\.\d+)?)\s*(?:لتر|ليتر|جركن|مل|ml|l)\b/i);
    if (sizeMatch) {
      out.containerSize = sizeMatch[0].trim();
    }
  }

  const typeRaw = cleanAttrVal(params.rawAttributes?.specs);
  if (typeRaw) {
    out.alcoholType = typeRaw;
  } else {
    const tMatch = findMatchedToken(combined, [
      'إيثيلي',
      'ايثانول',
      'إيثانول',
      'سبيرتو أبيض',
      'سبيرتو',
      'معدل',
      'نقي',
      'طبي',
    ]);
    if (tMatch) out.alcoholType = tMatch;
  }

  return out;
}

function extractChemicalAttributes(params: {
  name: string;
  description?: string;
  rawAttributes?: Record<string, string>;
}): Record<string, string> {
  const combined = normalizeArabicDisplay(`${params.name} ${params.description || ''}`);
  const out: Record<string, string> = {};

  const specsRaw = cleanAttrVal(params.rawAttributes?.specs);
  if (specsRaw) {
    out.specs = specsRaw;
  } else if (params.description?.trim()) {
    out.specs = cleanAttrVal(params.description);
  }

  const capRaw = cleanAttrVal(params.rawAttributes?.capacity || params.rawAttributes?.packSize);
  if (capRaw) {
    out.packWeight = capRaw;
  } else {
    const wMatch = combined.match(/(\d+(?:\.\d+)?)\s*(?:كجم|كيلو|جم|جرام|لتر|مل)\b/i);
    if (wMatch) {
      out.packWeight = wMatch[0].trim();
    }
  }

  return out;
}

export const CATEGORY_IMPORT_HANDLERS: Record<ImportCategoryProfileKey, CategoryImportHandler> = {
  oils: {
    profileKey: 'oils',
    labelAr: 'الزيوت العطرية',
    processorTitleAr: 'معالج الزيوت العطرية (متعدد الدرجات ووحدات الوزن)',
    variantTermSingularAr: 'درجة',
    variantTermPluralAr: 'درجات',
    supportsGrades: true,
    requiresUnitConfirmation: true,
    allowSingleBarePriceAsSelling: false,
    allowMissingCostWithoutReview: false,
    allowAutoSuggestedCode: false,
    suggestedCodePrefix: 'KS',
    defaultAllowedUnits: ['جرام', 'كيلوجرام', 'mg'],
    classifyExtraHeaderCell: () => null,
    extractAttributes: () => ({}),
    detectPreferredUnit: ({ explicitHeaderUnit, rowUnitText, catDefaultUnit }) => {
      if (explicitHeaderUnit === 'جرام' || explicitHeaderUnit === 'كيلوجرام') {
        return explicitHeaderUnit;
      }
      if (rowUnitText && (rowUnitText === 'جرام' || rowUnitText === 'كيلوجرام' || rowUnitText === 'mg')) {
        return rowUnitText as ProductUnit;
      }
      return catDefaultUnit || 'جرام';
    },
    buildVariantKey: ({ baseProductKey, gradeKey = '', unitKey }) =>
      `${baseProductKey}||${gradeKey}||${unitKey}`,
    buildVariantSummaryLabel: ({ grade, unit }) =>
      `${grade || 'أساسي'} (${unit})`,
  },

  packaging: {
    profileKey: 'packaging',
    labelAr: 'الفوارغ والعبوات',
    processorTitleAr: 'معالج الفوارغ والعبوات (السعة، الشكل، الشد، وسعر القطعة)',
    variantTermSingularAr: 'عبوة',
    variantTermPluralAr: 'عبوات',
    supportsGrades: false,
    requiresUnitConfirmation: false,
    allowSingleBarePriceAsSelling: true,
    allowMissingCostWithoutReview: true,
    allowAutoSuggestedCode: true,
    suggestedCodePrefix: 'PKG',
    defaultAllowedUnits: ['قطعة', 'دستة', 'كرتونة', 'عبوة'],
    classifyExtraHeaderCell: (norm) => {
      if (/(السع[هة]|سع[هة]|الحجم|حجم|المقاس|مقاس|capacity|volume|size\s*\(?ml\)?|مللي)/i.test(norm)) {
        return { role: 'capacity' };
      }
      if (
        /(الشكل|شكل|النوع|نوع|الموديل|موديل|الخام[هة]|خام[هة]|اللون|لون|الغلق|غلق|الغطاء|غطاء|shape|style|material|color|closure|neck)/i.test(
          norm
        )
      ) {
        return { role: 'shape' };
      }
      if (
        /(الشد|شد|التعبئ[هة]|تعبئ[هة]|عدد الكرتون[هة]|الكرتون[هة]|عدد القطع|الكمي[هة] بالباكو|pack\s*size|qty\/ctn|pcs\/ctn|carton)/i.test(
          norm
        ) &&
        !/(سعر الكرتون[هة]|سعر الدست[هة])/.test(norm)
      ) {
        return { role: 'packSize' };
      }
      if (/(سعر الدست[هة]|دست[هة]|dozen)/i.test(norm) && /سعر/.test(norm)) {
        return { role: 'sellingPrice', detectedUnit: 'دستة', isAmbiguousBarePrice: false };
      }
      if (/(سعر الكرتون[هة]|سعر الشد)/i.test(norm)) {
        return { role: 'sellingPrice', detectedUnit: 'كرتونة', isAmbiguousBarePrice: false };
      }
      if (/(سعر العبو[هة])/i.test(norm)) {
        return { role: 'sellingPrice', detectedUnit: 'عبوة', isAmbiguousBarePrice: false };
      }
      if (/(سعر القطع[هة]|سعر الحب[هة]|سعر الزجاج[هة]|سعر الواحد[هة]|سعر البيع|السعر|سعر|unit price|price)/i.test(norm)) {
        return { role: 'sellingPrice', detectedUnit: 'قطعة', isAmbiguousBarePrice: false };
      }
      return null;
    },
    extractAttributes: extractPackagingAttributes,
    detectPreferredUnit: ({ explicitHeaderUnit, rowUnitText, name, description, headerContextText, catDefaultUnit }) => {
      const validPkgUnits: ProductUnit[] = ['قطعة', 'دستة', 'كرتونة', 'عبوة'];
      if (rowUnitText && validPkgUnits.includes(rowUnitText as ProductUnit)) {
        return rowUnitText as ProductUnit;
      }
      if (explicitHeaderUnit && validPkgUnits.includes(explicitHeaderUnit)) {
        return explicitHeaderUnit;
      }
      const txt = normalizeArabicForSearch(`${name} ${description || ''} ${headerContextText || ''}`);
      if (/(سعر الدست[هة]|بالدست[هة]|دست[هة]|dozen)/.test(txt)) return 'دستة';
      if (/(سعر الكرتون[هة]|بالكرتون[هة])/.test(txt)) return 'كرتونة';
      if (/(سعر العبو[هة])/.test(txt)) return 'عبوة';
      return validPkgUnits.includes(catDefaultUnit) ? catDefaultUnit : 'قطعة';
    },
    buildVariantKey: ({ baseProductKey, unitKey, attributes }) => {
      const cap = normalizeArabicForSearch(attributes?.capacity || '');
      const shp = normalizeArabicForSearch(attributes?.shape || '');
      const pack = normalizeArabicForSearch(attributes?.packSize || '');
      return `${baseProductKey}||${cap}||${shp}||${pack}||${unitKey}`;
    },
    buildVariantSummaryLabel: ({ unit, attributes }) => {
      const parts = [
        attributes?.capacity ? `السعة ${attributes.capacity}` : '',
        attributes?.shape || '',
        attributes?.packSize ? `الشد ${attributes.packSize}` : '',
      ].filter(Boolean);
      return parts.length > 0 ? `${parts.join(' · ')} (${unit})` : unit;
    },
  },

  alcohol: {
    profileKey: 'alcohol',
    labelAr: 'الكحول والمذيبات',
    processorTitleAr: 'معالج الكحول (التركيز %، نوع الكحول، وسعة اللتر/الجركن)',
    variantTermSingularAr: 'صنف',
    variantTermPluralAr: 'أصناف',
    supportsGrades: false,
    requiresUnitConfirmation: false,
    allowSingleBarePriceAsSelling: true,
    allowMissingCostWithoutReview: true,
    allowAutoSuggestedCode: true,
    suggestedCodePrefix: 'ALC',
    defaultAllowedUnits: ['لتر', 'جركن', 'ملليلتر', 'كيلوجرام', 'عبوة'],
    classifyExtraHeaderCell: (norm) => {
      if (/(التركيز|تركيز|النقاء|نقاء|درج[هة] التركيز|concentration|purity|abv)/i.test(norm)) {
        return { role: 'concentration' };
      }
      if (/(حجم الجركن|حجم العبو[هة]|السع[هة]|الحجم|التعبئ[هة]|container|pack|volume)/i.test(norm)) {
        return { role: 'capacity' };
      }
      if (/(سعر الجركن|سعر الجالون)/i.test(norm)) {
        return { role: 'sellingPrice', detectedUnit: 'جركن', isAmbiguousBarePrice: false };
      }
      if (/(سعر اللتر|لتر|سعر الكيلو|سعر البيع|السعر|سعر|price)/i.test(norm)) {
        const isLiter = /لتر/.test(norm);
        const isKg = /كيلو/.test(norm);
        return {
          role: 'sellingPrice',
          detectedUnit: isKg ? 'كيلوجرام' : isLiter ? 'لتر' : undefined,
          isAmbiguousBarePrice: false,
        };
      }
      return null;
    },
    extractAttributes: extractAlcoholAttributes,
    detectPreferredUnit: ({ explicitHeaderUnit, rowUnitText, name, description, headerContextText, catDefaultUnit }) => {
      const validAlcUnits: ProductUnit[] = ['لتر', 'جركن', 'ملليلتر', 'كيلوجرام', 'عبوة'];
      if (rowUnitText && validAlcUnits.includes(rowUnitText as ProductUnit)) {
        return rowUnitText as ProductUnit;
      }
      if (explicitHeaderUnit && validAlcUnits.includes(explicitHeaderUnit)) {
        return explicitHeaderUnit;
      }
      const txt = normalizeArabicForSearch(`${headerContextText || ''} ${name} ${description || ''}`);
      if (/(سعر الجركن|جركن|جالون)/.test(txt)) return 'جركن';
      if (/(سعر اللتر|لتر|ليتر)/.test(txt)) return 'لتر';
      if (/(ملليلتر|مليلتر|\d+\s*مل)/.test(txt) && !/لتر/.test(txt)) return 'ملليلتر';
      if (/(كيلوجرام|كيلو)/.test(txt)) return 'كيلوجرام';
      return validAlcUnits.includes(catDefaultUnit) ? catDefaultUnit : 'لتر';
    },
    buildVariantKey: ({ baseProductKey, unitKey, attributes }) => {
      const conc = normalizeArabicForSearch(attributes?.concentration || '');
      const cSize = normalizeArabicForSearch(attributes?.containerSize || '');
      return `${baseProductKey}||${conc}||${cSize}||${unitKey}`;
    },
    buildVariantSummaryLabel: ({ unit, attributes }) => {
      const parts = [
        attributes?.concentration ? `تركيز ${attributes.concentration}` : '',
        attributes?.containerSize || '',
        attributes?.alcoholType || '',
      ].filter(Boolean);
      return parts.length > 0 ? `${parts.join(' · ')} (${unit})` : unit;
    },
  },

  chemicals: {
    profileKey: 'chemicals',
    labelAr: 'الكيماويات والمثبتات',
    processorTitleAr: 'معالج الكيماويات والمثبتات (المادة الفعالة، الاستخدام، والوحدة)',
    variantTermSingularAr: 'مادة',
    variantTermPluralAr: 'مواد',
    supportsGrades: false,
    requiresUnitConfirmation: false,
    allowSingleBarePriceAsSelling: true,
    allowMissingCostWithoutReview: true,
    allowAutoSuggestedCode: true,
    suggestedCodePrefix: 'CHM',
    defaultAllowedUnits: ['جرام', 'كيلوجرام', 'لتر', 'ملليلتر', 'عبوة', 'قطعة'],
    classifyExtraHeaderCell: (norm) => {
      if (/(الماد[هة] الفعال[هة]|الاستخدام|التركيب|المواصفات|الدرج[هة] الكيميائي[هة]|active|specs|usage|purity)/i.test(norm)) {
        return { role: 'specs' };
      }
      if (/(الوزن|الحجم|العبو[هة]|التعبئ[هة]|pack|weight|size)/i.test(norm)) {
        return { role: 'capacity' };
      }
      if (/(سعر البيع|سعر الجمل[هة]|السعر|سعر|price)/i.test(norm)) {
        return { role: 'sellingPrice', isAmbiguousBarePrice: false };
      }
      return null;
    },
    extractAttributes: extractChemicalAttributes,
    detectPreferredUnit: ({ explicitHeaderUnit, rowUnitText, name, description, headerContextText, catDefaultUnit }) => {
      const validUnits: ProductUnit[] = ['جرام', 'كيلوجرام', 'لتر', 'ملليلتر', 'عبوة', 'قطعة'];
      if (rowUnitText && validUnits.includes(rowUnitText as ProductUnit)) {
        return rowUnitText as ProductUnit;
      }
      if (explicitHeaderUnit && validUnits.includes(explicitHeaderUnit)) {
        return explicitHeaderUnit;
      }
      const txt = normalizeArabicForSearch(`${headerContextText || ''} ${name} ${description || ''}`);
      if (/(كيلوجرام|كيلو|كجم)/.test(txt)) return 'كيلوجرام';
      if (/(لتر|ليتر)/.test(txt)) return 'لتر';
      if (/(عبو[هة])/.test(txt)) return 'عبوة';
      return validUnits.includes(catDefaultUnit) ? catDefaultUnit : 'جرام';
    },
    buildVariantKey: ({ baseProductKey, unitKey, attributes }) => {
      const specs = normalizeArabicForSearch(attributes?.specs || '');
      const packW = normalizeArabicForSearch(attributes?.packWeight || '');
      return `${baseProductKey}||${specs}||${packW}||${unitKey}`;
    },
    buildVariantSummaryLabel: ({ unit, attributes }) => {
      const parts = [attributes?.packWeight || '', attributes?.specs || ''].filter(Boolean);
      return parts.length > 0 ? `${parts.join(' · ')} (${unit})` : unit;
    },
  },

  other: {
    profileKey: 'other',
    labelAr: 'مستلزمات أخرى',
    processorTitleAr: 'معالج المستلزمات والمنتجات العامة',
    variantTermSingularAr: 'بند',
    variantTermPluralAr: 'بنود',
    supportsGrades: false,
    requiresUnitConfirmation: false,
    allowSingleBarePriceAsSelling: true,
    allowMissingCostWithoutReview: true,
    allowAutoSuggestedCode: true,
    suggestedCodePrefix: 'ITM',
    defaultAllowedUnits: ['قطعة', 'عبوة', 'دستة', 'كرتونة', 'جرام', 'كيلوجرام', 'لتر'],
    classifyExtraHeaderCell: (norm) => {
      if (/(المواصفات|specs|notes|تفاصيل)/i.test(norm)) {
        return { role: 'specs' };
      }
      if (/(سعر البيع|السعر|سعر|price)/i.test(norm)) {
        return { role: 'sellingPrice', isAmbiguousBarePrice: false };
      }
      return null;
    },
    extractAttributes: extractChemicalAttributes,
    detectPreferredUnit: ({ explicitHeaderUnit, rowUnitText, catDefaultUnit }) =>
      (rowUnitText as ProductUnit) || explicitHeaderUnit || catDefaultUnit || 'قطعة',
    buildVariantKey: ({ baseProductKey, unitKey, attributes }) =>
      `${baseProductKey}||${normalizeArabicForSearch(attributes?.specs || '')}||${unitKey}`,
    buildVariantSummaryLabel: ({ unit, attributes }) =>
      attributes?.specs ? `${attributes.specs} (${unit})` : unit,
  },
};

export function getCategoryImportHandler(
  profileOrCategory?: ImportCategoryProfileKey | Partial<ProductCategory> | null
): CategoryImportHandler {
  if (typeof profileOrCategory === 'string') {
    return CATEGORY_IMPORT_HANDLERS[profileOrCategory] || CATEGORY_IMPORT_HANDLERS.other;
  }
  const key = resolveImportCategoryProfileKey(profileOrCategory);
  return CATEGORY_IMPORT_HANDLERS[key] || CATEGORY_IMPORT_HANDLERS.other;
}

export function buildProductDescriptionFromImportItem(
  item: Pick<PriceListParsedItem, 'description' | 'attributes' | 'categoryProfile'>
): string {
  const baseDesc = normalizeArabicDisplay(item.description || '');
  const attrs = item.attributes || {};
  const profile = item.categoryProfile;

  const formattedSpecs: string[] = [];
  if (profile === 'packaging') {
    if (attrs.capacity) formattedSpecs.push(`السعة: ${attrs.capacity}`);
    if (attrs.shape) formattedSpecs.push(`الشكل/الغلق: ${attrs.shape}`);
    if (attrs.packSize) formattedSpecs.push(`الشد/الكرتونة: ${attrs.packSize}`);
  } else if (profile === 'alcohol') {
    if (attrs.concentration) formattedSpecs.push(`التركيز: ${attrs.concentration}`);
    if (attrs.containerSize) formattedSpecs.push(`العبوة: ${attrs.containerSize}`);
    if (attrs.alcoholType) formattedSpecs.push(`النوع: ${attrs.alcoholType}`);
  } else {
    if (attrs.packWeight) formattedSpecs.push(`العبوة: ${attrs.packWeight}`);
    if (attrs.specs) formattedSpecs.push(attrs.specs);
  }

  const missingSpecs = formattedSpecs.filter(
    (s) => !normalizeArabicForSearch(baseDesc).includes(normalizeArabicForSearch(s))
  );
  if (missingSpecs.length === 0) return baseDesc;
  return baseDesc ? `${baseDesc} · ${missingSpecs.join(' · ')}` : missingSpecs.join(' · ');
}

export function detectDocumentCategory(params: {
  rawText?: string;
  rawRows: string[][];
  fileName?: string;
  categories?: ProductCategory[];
  explicitCategoryId?: string | null;
  oilGrades?: OilGradeRecord[];
}): CategoryDocumentDetectionResult {
  const categories =
    params.categories && params.categories.length > 0 ? params.categories : DEFAULT_CATEGORIES;
  const rawExplicit = (params.explicitCategoryId || '').trim();

  if (rawExplicit && rawExplicit !== 'auto') {
    const matchedCat =
      categories.find((c) => c.id === rawExplicit) ||
      categories.find((c) => c.slug === rawExplicit);
    if (matchedCat) {
      const profileKey = resolveImportCategoryProfileKey(matchedCat);
      return {
        category: matchedCat,
        profileKey,
        source: 'user_selected',
        confidence: 100,
        reason: `تم تحديد التصنيف (${matchedCat.name}) يدوياً وتفعيل معالجها المستقل.`,
      };
    }
  }

  const scores: Record<ImportCategoryProfileKey, number> = {
    oils: 0,
    packaging: 0,
    alcohol: 0,
    chemicals: 0,
    other: 0,
  };
  const reasons: Record<ImportCategoryProfileKey, string[]> = {
    oils: [],
    packaging: [],
    alcohol: [],
    chemicals: [],
    other: [],
  };

  // 1. Filename signals (explicit non-oil materials take priority over generic "عطور")
  const fNameNorm = normalizeArabicForSearch(params.fileName || '');
  const fPkg = /(فوارغ|فارغ|زجاج|عبو|بخاخ|تيستر|bottle|packaging|flacon|vial)/.test(fNameNorm);
  const fAlc = /(كحول|سبيرتو|ايثيلي|ايثانول|alcohol|ethanol)/.test(fNameNorm);
  const fChm = /(كيماويات|مثبت|جلسرين|dpg|chemical|fixative)/.test(fNameNorm);
  const fOil = /(زيت|زيوت|عطر|عطور|عطري|اسانس|oil|perfume|essence)/.test(fNameNorm);
  if (fPkg) {
    scores.packaging += 40;
    reasons.packaging.push('اسم الملف');
  }
  if (fAlc) {
    scores.alcohol += 40;
    reasons.alcohol.push('اسم الملف');
  }
  if (fChm) {
    scores.chemicals += 40;
    reasons.chemicals.push('اسم الملف');
  }
  if (fOil && !fPkg && !fAlc && !fChm) {
    scores.oils += 35;
    reasons.oils.push('اسم الملف');
  }

  // 2. Grade aliases + table header signals across first 15 rows
  const gradeTokens = (params.oilGrades || []).flatMap((g) => [
    g.name,
    ...(Array.isArray(g.aliases) ? g.aliases : []),
  ]);
  const headerRowsSample = params.rawRows.slice(0, 15);
  for (const row of headerRowsSample) {
    const rowNorm = normalizeArabicForSearch(row.join(' '));
    if (!rowNorm) continue;
    const looksLikeHeader =
      row.length >= 2 &&
      /(الصنف|اسم الصنف|المنتج|الكود|كود|سعر|التكلف|الشراء|البيع|السع[هة]|الشكل|التركيز|الوحد[هة]|code|price|item|product|unit)/.test(
        rowNorm
      );
    if (!looksLikeHeader) continue;

    // Multi-grade column pair signal (e.g. two code columns or two selling price columns)
    const codeColsInRow = row.filter((c) =>
      /(الكود|كود|code|sku)/i.test(normalizeArabicForSearch(c))
    ).length;
    const priceColsInRow = row.filter((c) =>
      /(سعر البيع|selling|سعر الكيلو|سعر الجرام)/i.test(normalizeArabicForSearch(c))
    ).length;
    if (codeColsInRow >= 2 || priceColsInRow >= 2) {
      scores.oils += 45;
      reasons.oils.push('أعمدة متعددة الدرجات');
    }

    if (/(سعر الكيلو|لكل كيلو|\/\s*كجم|\/\s*kg|سعر الجرام|\/\s*جم)/.test(rowNorm)) {
      scores.oils += 45;
      reasons.oils.push('وحدات تسعير الزيوت (كيلو/جرام)');
    }

    const hasExplicitGradeHeader = gradeTokens.some((tok) => {
      const tNorm = normalizeArabicForSearch(tok);
      if (tNorm.length < 2) return false;
      return row.some((c) => {
        const cn = normalizeArabicForSearch(c);
        return cn === tNorm || new RegExp(`(?:^|[\\s(])${tNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s)])`).test(cn);
      });
    });
    if (hasExplicitGradeHeader) {
      scores.oils += 55;
      reasons.oils.push('درجات الزيوت');
    }

    if (/(السع[هة]|الشكل|الغلق|الغطاء|الشد|التعبئ[هة]|سعر القطع[هة]|سعر الدست[هة]|سعر الكرتون[هة])/.test(rowNorm)) {
      scores.packaging += 55;
      reasons.packaging.push('أعمدة السعة والشكل وسعر القطعة');
    }

    if (/(التركيز|النقاء|سعر اللتر|سعر الجركن|درج[هة] التركيز)/.test(rowNorm)) {
      scores.alcohol += 55;
      reasons.alcohol.push('أعمدة التركيز واللتر/الجركن');
    }

    if (/(الماد[هة] الفعال[هة]|الاستخدام|التركيب|المواصفات الكيميائي[هة])/.test(rowNorm)) {
      scores.chemicals += 45;
      reasons.chemicals.push('أعمدة المواصفات الكيميائية');
    }
  }

  // 3. Content rows & text sample signals
  const contentSamples = [
    ...params.rawRows.slice(0, 35).map((r) => r.join(' ')),
    ...(params.rawText ? params.rawText.split(/\r?\n/).slice(0, 35) : []),
  ];
  for (const line of contentSamples) {
    const clean = normalizeArabicDisplay(line);
    if (clean.length < 3) continue;
    const cls = classifyProductName(clean, categories);
    if (cls.confident) {
      const pKey = resolveImportCategoryProfileKey({ id: cls.categoryId, name: cls.categoryName });
      scores[pKey] += 7;
    }

    const lineSearch = normalizeArabicForSearch(clean);
    if (
      /\d+\s*(?:مللي|ملي|ملل|مل|ml)(?=$|\s|[^\p{L}])/iu.test(lineSearch) &&
      /(كبس|قلاووظ|بخاخ|طرمب|مضخ|زجاج|فارغ|فوارغ|تيستر|تايستر|كريستال|قطار|غطاء|كرتون|دست|بلاستيك|بليه)/.test(
        lineSearch
      )
    ) {
      scores.packaging += 9;
    }
    if (
      /(?:70|80|85|86|90|95|96|99(?:\.\d+)?)\s*%/.test(lineSearch) &&
      /(كحول|ايث|سبيرت|لتر|جركن)/.test(lineSearch) &&
      !/(مضخ[هة]|بخاخ|فوارغ)/.test(lineSearch)
    ) {
      scores.alcohol += 10;
    }
    // Dual SKU pattern typical in oil lists (e.g. KS-1001 ... KS-2001)
    const skuMatches = clean.match(/\b[A-Za-z]{1,4}-\d{3,6}\b/g);
    if (skuMatches && skuMatches.length >= 2) {
      scores.oils += 15;
    }
  }

  const ordered: ImportCategoryProfileKey[] = ['packaging', 'alcohol', 'chemicals', 'oils', 'other'];
  let winner: ImportCategoryProfileKey = 'other';
  let topScore = 0;
  let secondScore = 0;

  for (const key of ordered) {
    const sc = scores[key];
    if (sc > topScore) {
      secondScore = topScore;
      topScore = sc;
      winner = key;
    } else if (sc > secondScore) {
      secondScore = sc;
    }
  }

  const matchedCat = findCategoryForProfile(winner, categories);
  const confidence =
    topScore === 0
      ? 45
      : Math.min(99, Math.max(55, Math.round(55 + (topScore - secondScore) * 0.6)));
  const topReasons = Array.from(new Set(reasons[winner])).slice(0, 3);
  const reasonText =
    topScore === 0
      ? 'لم تظهر إشارات قاطعة لفئة محددة — تم اختيار المعالج العام ويمكنك تبديله بحرية.'
      : topReasons.length > 0
        ? `تم التعرف تلقائياً على "${matchedCat.name}" بناءً على: ${topReasons.join('، ')}.`
        : `تم التعرف تلقائياً على "${matchedCat.name}" من بنود وألفاظ الملف.`;

  return {
    category: matchedCat,
    profileKey: winner,
    source: 'auto_detected',
    confidence,
    reason: reasonText,
  };
}
