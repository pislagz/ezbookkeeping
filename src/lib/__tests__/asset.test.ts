import { describe, expect, it } from 'vitest';

import { DecimalSeparator, DigitGroupingSymbol, DigitGroupingType, NumeralSystem, type NumberFormatOptions } from '@/core/numeral.ts';
import { ALL_ASSETS, GRAMS_PER_TROY_OUNCE } from '@/consts/currency.ts';

import {
    getAmountUnitLabel,
    getAmountViewSpec,
    getCurrencyStorageScale,
    isAssetCurrency,
    isCryptoCurrency,
    isMetalCurrency,
    storedAmountToViewAmount,
    viewAmountToStoredAmount
} from '@/lib/asset.ts';
import { formatAmount, getExchangedAmountByRate, parseAmount, parseBigDecimal } from '@/lib/numeral.ts';

function options(currency: string | undefined, metalUnit?: string, forInput: boolean = false): NumberFormatOptions {
    const spec = getAmountViewSpec(currency, metalUnit, forInput);

    return {
        numeralSystem: NumeralSystem.WesternArabicNumerals,
        digitGrouping: DigitGroupingType.None,
        digitGroupingSymbol: DigitGroupingSymbol.Comma.symbol,
        decimalSeparator: DecimalSeparator.Dot.symbol,
        decimalNumberCount: spec.minDecimals,
        amountScale: spec.scale
    };
}

function format(stored: number, currency: string, metalUnit?: string): string {
    const spec = getAmountViewSpec(currency, metalUnit);
    return formatAmount(parseBigDecimal(storedAmountToViewAmount(stored, spec, currency)), options(currency, metalUnit));
}

describe('asset registry', () => {
    it('should classify currencies', () => {
        expect(isAssetCurrency('XAU')).toBe(true);
        expect(isMetalCurrency('XAG')).toBe(true);
        expect(isCryptoCurrency('BTC')).toBe(true);
        expect(isAssetCurrency('PLN')).toBe(false);
        expect(isAssetCurrency(undefined)).toBe(false);
    });

    it('should contain all required assets with a scale that fits the amount limitation', () => {
        for (const code of ['XAU', 'XAG', 'BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'XRP', 'ADA', 'DOGE', 'DOT', 'LTC', 'BNB', 'AVAX', 'LINK', 'XMR', 'TRX']) {
            expect(isAssetCurrency(code)).toBe(true);
        }

        for (const asset of ALL_ASSETS) {
            expect(asset.scale).toBeGreaterThanOrEqual(2);
            expect(asset.scale).toBeLessThanOrEqual(8);
            expect(asset.code.length).toBeGreaterThanOrEqual(3);
            expect(asset.code.length).toBeLessThanOrEqual(10);
        }

        expect(getCurrencyStorageScale('BTC')).toBe(8);
        expect(getCurrencyStorageScale('XAU')).toBe(2);
        expect(getCurrencyStorageScale('PLN')).toBe(2);
    });
});

describe('formatAmount and parseAmount with scale', () => {
    it('should keep the behavior of normal currencies', () => {
        expect(formatAmount(parseBigDecimal(12345), options('PLN'))).toBe('123.45');
        expect(formatAmount(parseBigDecimal(-5), options('PLN'))).toBe('-0.05');
        expect(formatAmount(parseBigDecimal(12300), options('JPY'))).toBe('123');
        expect(formatAmount(parseBigDecimal(12350), options('JPY'))).toBe('123.5');
        expect(parseAmount('123.45', options('PLN'))).toBe(12345);
        expect(parseAmount('123.4', options('PLN'))).toBe(12340);
        expect(parseAmount('123.456', options('PLN'))).toBe(12345);
    });

    it.each([
        ['0.00123456', 123456],
        ['1.00000001', 100000001],
        ['1.5', 150000000],
        ['0.00000001', 1],
        ['-0.5', -50000000],
        ['9999999.99999999', 999999999999999]
    ])('should round-trip BTC amount %s exactly', (text, stored) => {
        expect(parseAmount(text, options('BTC', undefined, true))).toBe(stored);
        const formatted = formatAmount(parseBigDecimal(stored), options('BTC'));
        expect(parseAmount(formatted, options('BTC', undefined, true))).toBe(stored);
    });

    it('should format BTC with at least 2 and at most 8 decimals', () => {
        expect(formatAmount(parseBigDecimal(123456), options('BTC'))).toBe('0.00123456');
        expect(formatAmount(parseBigDecimal(150000000), options('BTC'))).toBe('1.50');
        expect(formatAmount(parseBigDecimal(100000000), options('BTC'))).toBe('1.00');
        expect(formatAmount(parseBigDecimal(1), options('BTC'))).toBe('0.00000001');
        expect(formatAmount(parseBigDecimal(0), options('BTC'))).toBe('0.00');
    });

    it('should use 6 decimals for low priced coins', () => {
        expect(formatAmount(parseBigDecimal(12345123456), options('DOGE'))).toBe('12345.123456');
        expect(parseAmount('12345.123456', options('DOGE', undefined, true))).toBe(12345123456);
    });
});

describe('metals in grams and troy ounces', () => {
    it('should display grams with 2 decimals', () => {
        expect(format(3110, 'XAU', 'g')).toBe('31.10');
        expect(format(1, 'XAG', undefined)).toBe('0.01');
        expect(getAmountUnitLabel('XAU', 'g')).toBe('g');
        expect(getAmountUnitLabel('XAU', 'oz')).toBe('oz');
        expect(getAmountUnitLabel('XAU', 'unexpected')).toBe('g');
        expect(getAmountUnitLabel('BTC', 'oz')).toBe('BTC');
        expect(getAmountUnitLabel('PLN', 'oz')).toBeUndefined();
    });

    it('should convert grams to troy ounces', () => {
        const spec = getAmountViewSpec('XAU', 'oz');
        expect(spec.unit).toBe('oz');
        expect(spec.scale).toBe(4);
        // 31.1034768 g = 1 oz, stored in 0.01 g: 31.10 g = 0.99989 oz
        expect(storedAmountToViewAmount(3110, spec, 'XAU')).toBe(9999);
        expect(storedAmountToViewAmount(3111, spec, 'XAU')).toBe(10002);
        expect(format(3110, 'XAU', 'oz')).toBe('0.9999');
        expect(format(0, 'XAU', 'oz')).toBe('0.00');
        expect(format(1555, 'XAU', 'oz')).toBe('0.4999');
        expect(format(1, 'XAU', 'oz')).toBe('0.0003');
    });

    it('should convert troy ounces to grams rounded to 0.01 g', () => {
        const spec = getAmountViewSpec('XAU', 'oz', true);
        expect(spec.scale).toBe(6);
        expect(parseAmount('1', options('XAU', 'oz', true))).toBe(1000000);
        expect(viewAmountToStoredAmount(1000000, spec, 'XAU')).toBe(3110);
        expect(viewAmountToStoredAmount(500000, spec, 'XAU')).toBe(1555);
        expect(viewAmountToStoredAmount(-1000000, spec, 'XAU')).toBe(-3110);
        expect(GRAMS_PER_TROY_OUNCE).toBe(31.1034768);
    });

    it('should not change the stored amount when the displayed input value is unchanged (oz view)', () => {
        const spec = getAmountViewSpec('XAU', 'oz', true);

        for (const stored of [1, 2, 3110, 3111, 12345, 99999, 123456789, 999999999999]) {
            const view = storedAmountToViewAmount(stored, spec, 'XAU');
            expect(viewAmountToStoredAmount(view, spec, 'XAU')).toBe(stored);
        }
    });

    it('should leave amounts untouched for grams, crypto and normal currencies', () => {
        for (const currency of ['XAU', 'BTC', 'PLN']) {
            const spec = getAmountViewSpec(currency, 'g', true);
            expect(storedAmountToViewAmount(12345, spec, currency)).toBe(12345);
            expect(viewAmountToStoredAmount(12345, spec, currency)).toBe(12345);
        }

        // the oz preference does not affect crypto
        const btcSpec = getAmountViewSpec('BTC', 'oz');
        expect(btcSpec.unit).toBeUndefined();
        expect(storedAmountToViewAmount(12345, btcSpec, 'BTC')).toBe(12345);
    });
});

describe('getExchangedAmountByRate with asset scales', () => {
    // rates are units of the currency per one unit of the base currency (PLN)
    it('should convert BTC (8 decimals) to PLN (2 decimals)', () => {
        // 0.00123456 BTC at 400000 PLN per BTC = 493.824 PLN = 49382.4 stored
        const stored = parseBigDecimal(123456);
        const converted = getExchangedAmountByRate(stored, '0.0000025', '1', 'BTC', 'PLN');
        expect(converted?.toDoubleNumber()).toBeCloseTo(49382.4, 6);
    });

    it('should convert gold (grams, 2 decimals) to PLN', () => {
        // 31.10 g at 500 PLN per gram = 15550 PLN = 1555000 stored
        const converted = getExchangedAmountByRate(parseBigDecimal(3110), '0.002', '1', 'XAU', 'PLN');
        expect(converted?.toDoubleNumber()).toBeCloseTo(1555000, 6);
    });

    it('should convert between PLN and BTC and keep normal currencies unchanged', () => {
        // 1000 PLN = 100000 stored = 0.0025 BTC = 250000 stored
        const converted = getExchangedAmountByRate(parseBigDecimal(100000), '1', '0.0000025', 'PLN', 'BTC');
        expect(converted?.toDoubleNumber()).toBeCloseTo(250000, 4);

        const usd = getExchangedAmountByRate(parseBigDecimal(100), '1', '0.25', 'PLN', 'USD');
        expect(usd?.toDoubleNumber()).toBeCloseTo(25, 8);
        expect(getExchangedAmountByRate(parseBigDecimal(100), '1', '0.25')?.toDoubleNumber()).toBeCloseTo(25, 8);
    });
});
