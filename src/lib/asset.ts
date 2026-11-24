import { ALL_ASSETS_BY_CODE, GRAMS_PER_TROY_OUNCE, type AssetDefinition } from '@/consts/currency.ts';
import { DEFAULT_DECIMAL_NUMBER_COUNT, MAX_SUPPORTED_DECIMAL_NUMBER_COUNT } from '@/consts/numeral.ts';

import { getCurrencyFraction } from '@/lib/currency.ts';

export type MetalUnit = 'g' | 'oz';

export const DEFAULT_METAL_UNIT: MetalUnit = 'g';

// count of decimals of troy ounce when it is displayed in lists, and when it is entered in an input
const OUNCE_DISPLAY_SCALE = 4;
const OUNCE_INPUT_SCALE = 6;

export interface AmountViewSpec {
    // count of decimals of the integer amount in this view (the textual amount is amount / 10^scale)
    readonly scale: number;
    // minimum count of displayed decimals, trailing zeros beyond this count are trimmed
    readonly minDecimals: number;
    // the unit the amount is displayed with, only metals have unit
    readonly unit?: MetalUnit;
}

export function getAssetDefinition(currencyCode?: string): AssetDefinition | undefined {
    if (!currencyCode) {
        return undefined;
    }

    return ALL_ASSETS_BY_CODE[currencyCode];
}

export function isAssetCurrency(currencyCode?: string): boolean {
    return !!getAssetDefinition(currencyCode);
}

export function isMetalCurrency(currencyCode?: string): boolean {
    return getAssetDefinition(currencyCode)?.kind === 'metal';
}

export function isCryptoCurrency(currencyCode?: string): boolean {
    return getAssetDefinition(currencyCode)?.kind === 'crypto';
}

export function normalizeMetalUnit(unit?: string): MetalUnit {
    return unit === 'oz' ? 'oz' : DEFAULT_METAL_UNIT;
}

/**
 * The count of decimals the amount of the currency is stored with in database (stored integer = amount * 10^scale)
 */
export function getCurrencyStorageScale(currencyCode?: string): number {
    return getAssetDefinition(currencyCode)?.scale ?? MAX_SUPPORTED_DECIMAL_NUMBER_COUNT;
}

/**
 * Returns the specification of how amounts of the currency are formatted and parsed
 * @param currencyCode the currency code
 * @param metalUnit the user preference of the unit of precious metals
 * @param forInput whether it is for amount input, input uses the max supported precision
 */
export function getAmountViewSpec(currencyCode?: string, metalUnit?: string, forInput: boolean = false): AmountViewSpec {
    const asset = getAssetDefinition(currencyCode);

    if (!asset) {
        const fraction = getCurrencyFraction(currencyCode);
        return {
            scale: MAX_SUPPORTED_DECIMAL_NUMBER_COUNT,
            minDecimals: (fraction === undefined || fraction > MAX_SUPPORTED_DECIMAL_NUMBER_COUNT) ? DEFAULT_DECIMAL_NUMBER_COUNT : fraction
        };
    }

    if (asset.kind === 'metal') {
        const unit = normalizeMetalUnit(metalUnit);

        if (unit === 'oz') {
            return { scale: forInput ? OUNCE_INPUT_SCALE : OUNCE_DISPLAY_SCALE, minDecimals: 2, unit: 'oz' };
        }

        return { scale: asset.scale, minDecimals: 2, unit: 'g' };
    }

    return { scale: asset.scale, minDecimals: Math.min(2, asset.scale) };
}

function roundHalfAwayFromZero(value: number): number {
    return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Converts a stored integer amount to the integer amount of the view (grams -> troy ounces for metals in oz view)
 * @param stored the stored amount (integer, scale is the storage scale of the currency)
 */
export function storedAmountToViewAmount(stored: number, spec: AmountViewSpec, currencyCode?: string): number {
    if (spec.unit !== 'oz') {
        return stored;
    }

    const storageScale = getCurrencyStorageScale(currencyCode);
    // stored / 10^storageScale grams = stored / 10^storageScale / GRAMS_PER_TROY_OUNCE ounces, expressed with view scale decimals
    return roundHalfAwayFromZero(stored / GRAMS_PER_TROY_OUNCE * (10 ** (spec.scale - storageScale)));
}

/**
 * Converts an integer amount of the view back to the stored integer amount (troy ounces -> 0.01 g units for metals in oz view)
 */
export function viewAmountToStoredAmount(view: number, spec: AmountViewSpec, currencyCode?: string): number {
    if (spec.unit !== 'oz') {
        return view;
    }

    const storageScale = getCurrencyStorageScale(currencyCode);
    return roundHalfAwayFromZero(view * GRAMS_PER_TROY_OUNCE / (10 ** (spec.scale - storageScale)));
}

/**
 * The unit label of an amount: "g" / "oz" for metals, the asset code for crypto, undefined for normal currencies
 */
export function getAmountUnitLabel(currencyCode?: string, metalUnit?: string): string | undefined {
    const asset = getAssetDefinition(currencyCode);

    if (!asset) {
        return undefined;
    }

    if (asset.kind === 'metal') {
        return normalizeMetalUnit(metalUnit);
    }

    return asset.code;
}
