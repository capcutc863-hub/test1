import type { ProductUnit, UnitQuantityTotal } from '../../types.ts';

export interface UnitSpec {
  canonical: string;
  group: 'mass' | 'volume' | 'discrete';
  factorToBase: number;
}

const UNIT_ALIASES: Record<string, UnitSpec> = {
  mg: { canonical: 'mg', group: 'mass', factorToBase: 1 },
  مجم: { canonical: 'mg', group: 'mass', factorToBase: 1 },
  مليجرام: { canonical: 'mg', group: 'mass', factorToBase: 1 },
  ملليجرام: { canonical: 'mg', group: 'mass', factorToBase: 1 },

  جرام: { canonical: 'جرام', group: 'mass', factorToBase: 1000 },
  جم: { canonical: 'جرام', group: 'mass', factorToBase: 1000 },
  g: { canonical: 'جرام', group: 'mass', factorToBase: 1000 },
  gram: { canonical: 'جرام', group: 'mass', factorToBase: 1000 },

  كيلوجرام: { canonical: 'كيلوجرام', group: 'mass', factorToBase: 1_000_000 },
  كيلو: { canonical: 'كيلوجرام', group: 'mass', factorToBase: 1_000_000 },
  كجم: { canonical: 'كيلوجرام', group: 'mass', factorToBase: 1_000_000 },
  kg: { canonical: 'كيلوجرام', group: 'mass', factorToBase: 1_000_000 },

  ملليلتر: { canonical: 'ملليلتر', group: 'volume', factorToBase: 1 },
  مل: { canonical: 'ملليلتر', group: 'volume', factorToBase: 1 },
  ml: { canonical: 'ملليلتر', group: 'volume', factorToBase: 1 },

  لتر: { canonical: 'لتر', group: 'volume', factorToBase: 1000 },
  l: { canonical: 'لتر', group: 'volume', factorToBase: 1000 },
  liter: { canonical: 'لتر', group: 'volume', factorToBase: 1000 },
};

export function normalizeProductUnit(unit?: ProductUnit | string | null): string {
  const raw = (unit || '').trim();
  if (!raw) return 'قطعة';
  const key = raw.toLowerCase();
  const mapped = UNIT_ALIASES[key] || UNIT_ALIASES[raw];
  return mapped ? mapped.canonical : raw;
}

export function getUnitSpec(unit?: ProductUnit | string | null): UnitSpec {
  const raw = (unit || '').trim() || 'قطعة';
  const key = raw.toLowerCase();
  const mapped = UNIT_ALIASES[key] || UNIT_ALIASES[raw];
  if (mapped) return mapped;
  return { canonical: raw, group: 'discrete', factorToBase: 1 };
}

export function getCompatibleUnitsForProductUnit(unit?: ProductUnit | string | null): string[] {
  const spec = getUnitSpec(unit);
  if (spec.group === 'mass') return ['mg', 'جرام', 'كيلوجرام'];
  if (spec.group === 'volume') return ['ملليلتر', 'لتر'];
  return [spec.canonical];
}

export function convertQuantityBetweenUnits(
  quantity: number,
  fromUnit: ProductUnit | string,
  toUnit: ProductUnit | string
):
  | {
      ok: true;
      convertedQuantity: number;
      conversionFactor: number;
      note: string;
    }
  | {
      ok: false;
      reason: string;
    } {
  if (!Number.isFinite(quantity)) {
    return { ok: false, reason: 'الكمية المدخلة غير صالحة.' };
  }
  const fromSpec = getUnitSpec(fromUnit);
  const toSpec = getUnitSpec(toUnit);

  if (fromSpec.canonical === toSpec.canonical) {
    return {
      ok: true,
      convertedQuantity: roundStockNumber(quantity),
      conversionFactor: 1,
      note: `${quantity.toLocaleString()} ${fromSpec.canonical}`,
    };
  }

  if (fromSpec.group === 'discrete' || toSpec.group === 'discrete' || fromSpec.group !== toSpec.group) {
    return {
      ok: false,
      reason: `الوحدة المختارة (${fromSpec.canonical}) غير متوافقة للتحويل مع وحدة المنتج (${toSpec.canonical}).`,
    };
  }

  const factor = fromSpec.factorToBase / toSpec.factorToBase;
  const converted = roundStockNumber(quantity * factor);
  return {
    ok: true,
    convertedQuantity: converted,
    conversionFactor: factor,
    note: `${quantity.toLocaleString()} ${fromSpec.canonical} = ${converted.toLocaleString()} ${toSpec.canonical}`,
  };
}

export function roundStockNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

export function aggregateQuantitiesByUnit(
  entries: Array<{ unit?: string | null; quantity: number }>
): UnitQuantityTotal[] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const qty = Number(entry.quantity || 0);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const unit = normalizeProductUnit(entry.unit || 'قطعة');
    map.set(unit, roundStockNumber((map.get(unit) || 0) + qty));
  }
  return Array.from(map.entries())
    .map(([unit, quantity]) => ({ unit, quantity }))
    .sort((a, b) => b.quantity - a.quantity);
}

export function formatUnitTotalsSummary(totals: UnitQuantityTotal[]): string {
  if (!totals || totals.length === 0) return '0';
  return totals.map((t) => `${t.quantity.toLocaleString()} ${t.unit}`).join(' + ');
}
