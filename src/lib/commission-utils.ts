import { classifyProductName } from './product-classifier.ts';
import type {
  CommissionConfig,
  OrderCommissionSnapshot,
  OrderItem,
  Product,
  ProductCategory,
  ProductUnit,
} from '../../types.ts';

export const DEFAULT_CATEGORIES: ProductCategory[] = [
  {
    id: 'cat-oils',
    name: 'الزيوت العطرية',
    slug: 'oils',
    sortOrder: 1,
    defaultUnit: 'mg',
    defaultCommissionEligible: true,
    defaultCommissionRate: 0.05,
    isActive: true,
    description: 'زيوت عطرية مركزة وخامات عطرية أصلية',
  },
  {
    id: 'cat-packaging',
    name: 'الفوارغ والعبوات',
    slug: 'packaging',
    sortOrder: 2,
    defaultUnit: 'قطعة',
    defaultCommissionEligible: false,
    defaultCommissionRate: 0,
    isActive: true,
    description: 'زجاجات فارغة، عبوات، بخاخات، أغطية وكراتين تغليف',
  },
  {
    id: 'cat-alcohol',
    name: 'الكحول',
    slug: 'alcohol',
    sortOrder: 3,
    defaultUnit: 'لتر',
    defaultCommissionEligible: false,
    defaultCommissionRate: 0,
    isActive: true,
    description: 'كحول إيثيلي نقي ومذيبات عطرية',
  },
  {
    id: 'cat-chemicals',
    name: 'الكيماويات',
    slug: 'chemicals',
    sortOrder: 4,
    defaultUnit: 'جرام',
    defaultCommissionEligible: false,
    defaultCommissionRate: 0,
    isActive: true,
    description: 'مثبتات عطرية ومواد كيميائية مساعدة',
  },
  {
    id: 'cat-other',
    name: 'مستلزمات أخرى',
    slug: 'other',
    sortOrder: 5,
    defaultUnit: 'قطعة',
    defaultCommissionEligible: false,
    defaultCommissionRate: 0,
    isActive: true,
    description: 'إكسسوارات ومستلزمات تشغيل ومنتجات أخرى',
  },
];

export const DEFAULT_COMMISSION_CONFIG: CommissionConfig = {
  defaultOilCommissionRate: 0.05,
  useSalesRepCustomRateWhenInherited: true,
  accrualTrigger: 'delivery',
  calculationBasis: 'net_commissionable_after_discount',
  packagingDefaultEligible: false,
  alcoholDefaultEligible: false,
  chemicalsDefaultEligible: false,
  otherDefaultEligible: false,
};

export const PRODUCT_UNIT_OPTIONS: ProductUnit[] = [
  'mg',
  'جرام',
  'كيلوجرام',
  'قطعة',
  'عبوة',
  'دستة',
  'كرتونة',
  'لتر',
  'ملليلتر',
  'جركن',
];

export function getQuickQuantityPresetsForUnit(unit?: ProductUnit): string[] {
  switch ((unit || 'mg').trim()) {
    case 'mg':
      return ['250', '500', '1000', '2500', '5000', '10000'];
    case 'جرام':
    case 'ملليلتر':
      return ['50', '100', '250', '500', '1000', '5000'];
    case 'كيلوجرام':
    case 'لتر':
    case 'جركن':
      return ['1', '2', '5', '10', '20', '50'];
    case 'قطعة':
    case 'عبوة':
    case 'دستة':
    case 'كرتونة':
    default:
      return ['1', '5', '10', '25', '50', '100'];
  }
}

export function roundMoney(val: number): number {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

export function resolveCategoryDefaultCommissionEligible(
  categoryId: string | undefined,
  categoryName: string | undefined,
  config: CommissionConfig,
  categoriesCatalog: ProductCategory[] = DEFAULT_CATEGORIES
): boolean {
  const rate = resolveCategoryDefaultCommissionRate(
    categoryId,
    categoryName,
    config,
    categoriesCatalog
  );
  if (rate > 0) return true;
  const cat = categoriesCatalog.find(
    (c) =>
      (categoryId && c.id === categoryId) ||
      (categoryName && c.name.trim() === categoryName.trim())
  );
  if (cat && typeof cat.defaultCommissionRate === 'number' && cat.defaultCommissionRate === 0) {
    return false;
  }
  if (cat) {
    if (cat.slug === 'oils' || cat.id === 'cat-oils') return config.defaultOilCommissionRate > 0;
    if (cat.slug === 'packaging' || cat.id === 'cat-packaging') return config.packagingDefaultEligible;
    if (cat.slug === 'alcohol' || cat.id === 'cat-alcohol') return config.alcoholDefaultEligible;
    if (cat.slug === 'chemicals' || cat.id === 'cat-chemicals') return config.chemicalsDefaultEligible;
    if (cat.slug === 'other' || cat.id === 'cat-other') return config.otherDefaultEligible;
    return cat.defaultCommissionEligible;
  }
  return false;
}

export function resolveCategoryDefaultCommissionRate(
  categoryId: string | undefined,
  categoryName: string | undefined,
  config: CommissionConfig = DEFAULT_COMMISSION_CONFIG,
  categoriesCatalog: ProductCategory[] = DEFAULT_CATEGORIES
): number {
  const cat = categoriesCatalog.find(
    (c) =>
      (categoryId && c.id === categoryId) ||
      (categoryName && c.name.trim() === categoryName.trim())
  );
  if (cat) {
    if (
      typeof cat.defaultCommissionRate === 'number' &&
      Number.isFinite(cat.defaultCommissionRate) &&
      cat.defaultCommissionRate >= 0
    ) {
      return Math.min(1, Math.max(0, cat.defaultCommissionRate));
    }
    if (cat.slug === 'oils' || cat.id === 'cat-oils') {
      return Math.min(1, Math.max(0, config.defaultOilCommissionRate));
    }
    const legacyEligible =
      cat.slug === 'packaging' || cat.id === 'cat-packaging'
        ? config.packagingDefaultEligible
        : cat.slug === 'alcohol' || cat.id === 'cat-alcohol'
          ? config.alcoholDefaultEligible
          : cat.slug === 'chemicals' || cat.id === 'cat-chemicals'
            ? config.chemicalsDefaultEligible
            : cat.slug === 'other' || cat.id === 'cat-other'
              ? config.otherDefaultEligible
              : cat.defaultCommissionEligible;
    return legacyEligible ? Math.min(1, Math.max(0, config.defaultOilCommissionRate)) : 0;
  }
  if (categoryId === 'cat-oils') {
    return Math.min(1, Math.max(0, config.defaultOilCommissionRate));
  }
  return 0;
}

export function resolveEffectiveRateForCategoryAndRep(params: {
  categoryId: string;
  categoryName?: string;
  repBaseRate?: number;
  repCategoryRates?: Record<string, number>;
  commissionConfig?: CommissionConfig;
  categoriesCatalog?: ProductCategory[];
  frozenSnapshot?: OrderCommissionSnapshot | null;
}): number {
  const cfg = params.commissionConfig || DEFAULT_COMMISSION_CONFIG;
  const categories =
    params.categoriesCatalog && params.categoriesCatalog.length > 0
      ? params.categoriesCatalog
      : DEFAULT_CATEGORIES;

  // 1. Frozen historical snapshot takes precedence when supplied (for existing order edits without rep swap)
  if (params.frozenSnapshot) {
    const snapCatRate = params.frozenSnapshot.repCategoryRates?.[params.categoryId];
    if (typeof snapCatRate === 'number' && Number.isFinite(snapCatRate) && snapCatRate >= 0) {
      return Math.min(1, snapCatRate);
    }
    if (
      params.categoryId === 'cat-oils' &&
      cfg.useSalesRepCustomRateWhenInherited &&
      typeof params.frozenSnapshot.repBaseRate === 'number' &&
      Number.isFinite(params.frozenSnapshot.repBaseRate) &&
      params.frozenSnapshot.repBaseRate >= 0
    ) {
      return Math.min(1, params.frozenSnapshot.repBaseRate);
    }
    const snapDefRate = params.frozenSnapshot.categoryDefaultRates?.[params.categoryId];
    if (typeof snapDefRate === 'number' && Number.isFinite(snapDefRate) && snapDefRate >= 0) {
      return Math.min(1, snapDefRate);
    }
  }

  // 2. Explicit rep-level override for this exact category (including explicit 0%)
  const repCatRate = params.repCategoryRates?.[params.categoryId];
  if (typeof repCatRate === 'number' && Number.isFinite(repCatRate) && repCatRate >= 0) {
    return Math.min(1, repCatRate);
  }

  // 3. Backward compatibility: legacy `rep.customCommissionRate` applies to Oils when inherited
  if (
    params.categoryId === 'cat-oils' &&
    cfg.useSalesRepCustomRateWhenInherited &&
    typeof params.repBaseRate === 'number' &&
    Number.isFinite(params.repBaseRate) &&
    params.repBaseRate >= 0
  ) {
    return Math.min(1, params.repBaseRate);
  }

  // 4. Category default commission rate (fallback 0% for non-oils unless Owner configures)
  return resolveCategoryDefaultCommissionRate(
    params.categoryId,
    params.categoryName,
    cfg,
    categories
  );
}

export function findCatalogProductForItem(
  item: Pick<OrderItem, 'productId' | 'productCode' | 'productName' | 'grade'>,
  productsCatalog: Product[]
): Product | undefined {
  if (item.productId) {
    const byId = productsCatalog.find((p) => p.id === item.productId);
    if (byId) return byId;
  }
  if (item.productCode) {
    const cleanCode = item.productCode.trim().toLowerCase();
    const byCode = productsCatalog.find((p) => (p.code || '').trim().toLowerCase() === cleanCode);
    if (byCode) return byCode;
  }
  const cleanName = (item.productName || '').trim().toLowerCase();
  if (!cleanName) return undefined;
  const byNameAndGrade = productsCatalog.find(
    (p) => p.name.trim().toLowerCase() === cleanName && (p.grade || '') === (item.grade || '')
  );
  if (byNameAndGrade) return byNameAndGrade;
  return productsCatalog.find((p) => p.name.trim().toLowerCase() === cleanName);
}

export interface ComputeCommissionParams {
  items: OrderItem[];
  discountPercentage: number;
  shippingCost: number;
  repBaseRate?: number;
  repCategoryRates?: Record<string, number>;
  commissionConfig?: CommissionConfig;
  productsCatalog: Product[];
  categoriesCatalog?: ProductCategory[];
  frozenSnapshot?: OrderCommissionSnapshot | null;
  capturedAt?: string;
}

export interface ComputedOrderFinancials {
  items: OrderItem[];
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  commission: number;
  commissionableSubtotal: number;
  nonCommissionableSubtotal: number;
  commissionRateSnapshot: number;
  commissionRuleSnapshot: OrderCommissionSnapshot;
}

/**
 * Category + Rep + Product commission calculation:
 * Resolution priority per line item:
 * 1. Product override (`none` -> 0%, `fixed_rate`, `fixed_per_unit`).
 * 2. When `inherit_rep` (or custom unclassified item): rep's per-category rate (`repCategoryRates[catId]`)
 *    -> else Oils legacy rep rate -> else Category default rate -> else 0%.
 * 3. Custom items not found in catalog are classified server/shared via `classifyProductName`
 *    (falling back to `cat-other`, NEVER `cat-oils`).
 * 4. Shipping is always excluded; invoice discount applies proportionally per item.
 */
export function calculateOrderFinancialsAndCommission(
  params: ComputeCommissionParams
): ComputedOrderFinancials {
  const cfg = params.commissionConfig || DEFAULT_COMMISSION_CONFIG;
  const categories =
    params.categoriesCatalog && params.categoriesCatalog.length > 0
      ? params.categoriesCatalog
      : DEFAULT_CATEGORIES;

  const repBaseRate =
    typeof params.repBaseRate === 'number' && Number.isFinite(params.repBaseRate) && params.repBaseRate >= 0
      ? params.repBaseRate
      : cfg.defaultOilCommissionRate;

  const safeDiscountPct = Math.min(100, Math.max(0, Number(params.discountPercentage) || 0));
  const discountFactor = 1 - safeDiscountPct / 100;
  const safeShipping = Math.max(0, Number(params.shippingCost) || 0);

  let subtotal = 0;
  let commissionableSubtotal = 0;
  let nonCommissionableSubtotal = 0;
  let totalCommission = 0;

  const snapshotRepRates: Record<string, number> = {
    ...(params.frozenSnapshot?.repCategoryRates || params.repCategoryRates || {}),
  };
  const snapshotCatDefaults: Record<string, number> = {};
  for (const cat of categories) {
    snapshotCatDefaults[cat.id] =
      params.frozenSnapshot?.categoryDefaultRates?.[cat.id] ??
      resolveCategoryDefaultCommissionRate(cat.id, cat.name, cfg, categories);
  }

  const enrichedItems: OrderItem[] = params.items.map((rawItem) => {
    const qty = Math.max(0, Number(rawItem.quantity) || 0);
    const price = Math.max(0, Number(rawItem.price) || 0);
    const lineGross = qty * price;
    subtotal += lineGross;

    const matchedProd = findCatalogProductForItem(rawItem, params.productsCatalog);

    let resolvedCategoryId: string;
    let resolvedCategoryName: string;
    let resolvedUnit: ProductUnit;

    if (matchedProd) {
      resolvedCategoryId = matchedProd.categoryId || 'cat-other';
      const matchedCat = categories.find((c) => c.id === resolvedCategoryId);
      resolvedCategoryName = matchedProd.categoryName || matchedCat?.name || 'مستلزمات أخرى';
      resolvedUnit = matchedProd.unit || rawItem.unit || matchedCat?.defaultUnit || 'قطعة';
    } else {
      // Custom/unmatched item: auto-classify reliably via shared classifier (defaulting unknown -> cat-other)
      const autoCat = classifyProductName(rawItem.productName, categories);
      resolvedCategoryId = autoCat.categoryId;
      resolvedCategoryName = autoCat.categoryName;
      resolvedUnit = rawItem.unit || autoCat.defaultUnit || 'قطعة';
    }

    const resolvedCode = matchedProd?.code || rawItem.productCode || undefined;

    let mode: Product['commissionMode'] = 'inherit_rep';
    let itemCustomRate: number | null | undefined = null;
    let itemCustomFixed: number | null | undefined = null;

    if (matchedProd) {
      mode =
        matchedProd.commissionMode ||
        (matchedProd.isCommissionEligible ? 'inherit_rep' : 'none');
      itemCustomRate = matchedProd.customCommissionRate;
      itemCustomFixed = matchedProd.customCommissionFixed;
    }

    const categoryEffectiveRate = resolveEffectiveRateForCategoryAndRep({
      categoryId: resolvedCategoryId,
      categoryName: resolvedCategoryName,
      repBaseRate,
      repCategoryRates: params.repCategoryRates,
      commissionConfig: cfg,
      categoriesCatalog: categories,
      frozenSnapshot: params.frozenSnapshot,
    });

    snapshotRepRates[resolvedCategoryId] = categoryEffectiveRate;

    let isEligible = false;
    let rateApplied = 0;
    let lineCommission = 0;
    const netLineGross = lineGross * discountFactor;

    if (mode === 'none') {
      isEligible = false;
      rateApplied = 0;
      lineCommission = 0;
    } else if (mode === 'fixed_rate') {
      rateApplied =
        typeof itemCustomRate === 'number' && Number.isFinite(itemCustomRate) && itemCustomRate >= 0
          ? Math.min(1, itemCustomRate)
          : categoryEffectiveRate;
      isEligible = rateApplied > 0;
      lineCommission = isEligible ? netLineGross * rateApplied : 0;
    } else if (mode === 'fixed_per_unit') {
      const fixedPerUnit =
        typeof itemCustomFixed === 'number' && Number.isFinite(itemCustomFixed) && itemCustomFixed >= 0
          ? itemCustomFixed
          : 0;
      isEligible = fixedPerUnit > 0;
      lineCommission = isEligible ? qty * fixedPerUnit : 0;
      rateApplied = netLineGross > 0 ? lineCommission / netLineGross : 0;
    } else {
      // 'inherit_rep' (default for products without override & all custom items)
      rateApplied = categoryEffectiveRate;
      isEligible = rateApplied > 0;
      lineCommission = isEligible ? netLineGross * rateApplied : 0;
    }

    if (isEligible && lineCommission > 0) {
      commissionableSubtotal += lineGross;
      totalCommission += lineCommission;
    } else {
      nonCommissionableSubtotal += lineGross;
    }

    return {
      ...rawItem,
      ...(matchedProd ? { productId: matchedProd.id } : {}),
      ...(resolvedCode ? { productCode: resolvedCode } : {}),
      categoryId: resolvedCategoryId,
      categoryName: resolvedCategoryName,
      unit: resolvedUnit,
      grade: rawItem.grade ?? matchedProd?.grade ?? '',
      isCommissionEligible: isEligible,
      commissionRateApplied: roundMoney(rateApplied * 10000) / 10000,
      commissionAmount: roundMoney(lineCommission),
    };
  });

  const roundedSubtotal = roundMoney(subtotal);
  const discountAmount = roundMoney((roundedSubtotal * safeDiscountPct) / 100);
  const totalAmount = roundMoney(Math.max(0, roundedSubtotal - discountAmount + safeShipping));
  const roundedCommission = roundMoney(totalCommission);
  const netCommissionable = roundMoney(commissionableSubtotal * discountFactor);
  const effectiveSnapshotRate =
    netCommissionable > 0 ? roundMoney((roundedCommission / netCommissionable) * 10000) / 10000 : 0;

  return {
    items: enrichedItems,
    subtotal: roundedSubtotal,
    discountPercentage: safeDiscountPct,
    discountAmount,
    shippingCost: safeShipping,
    totalAmount,
    commission: roundedCommission,
    commissionableSubtotal: roundMoney(commissionableSubtotal),
    nonCommissionableSubtotal: roundMoney(nonCommissionableSubtotal),
    commissionRateSnapshot: effectiveSnapshotRate,
    commissionRuleSnapshot: {
      method: 'product_eligibility_net_after_discount',
      repBaseRate:
        params.frozenSnapshot?.repBaseRate !== undefined
          ? params.frozenSnapshot.repBaseRate
          : repBaseRate,
      repCategoryRates: snapshotRepRates,
      categoryDefaultRates: snapshotCatDefaults,
      defaultOilRate:
        params.frozenSnapshot?.defaultOilRate !== undefined
          ? params.frozenSnapshot.defaultOilRate
          : cfg.defaultOilCommissionRate,
      discountPercentage: safeDiscountPct,
      commissionableSubtotal: roundMoney(commissionableSubtotal),
      nonCommissionableSubtotal: roundMoney(nonCommissionableSubtotal),
      computedCommission: roundedCommission,
      capturedAt: params.capturedAt || new Date().toISOString(),
    },
  };
}
