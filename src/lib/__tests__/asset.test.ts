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
        expect(getCurrencyStorageScale('XAU')).toBe(6);
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
        expect(format(31100000, 'XAU', 'g')).toBe('31.10');
        expect(format(10000, 'XAG', undefined)).toBe('0.01');
        expect(format(31103477, 'XAU', 'g')).toBe('31.103477');
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
        // 31.1034768 g = 1 oz, stored in 0.000001 g: 31.103477 g = 1.00000001 oz, displayed as exactly 1
        expect(storedAmountToViewAmount(31103477, spec, 'XAU')).toBe(10000);
        expect(format(31103477, 'XAU', 'oz')).toBe('1');
        expect(format(0, 'XAU', 'oz')).toBe('0');
        expect(format(15551738, 'XAU', 'oz')).toBe('0.5');
        expect(format(3110348, 'XAU', 'oz')).toBe('0.1');
        // data stored with the old precision (31.10 g) is still shown honestly
        expect(format(31100000, 'XAU', 'oz')).toBe('0.9999');
    });

    it('should convert troy ounces to grams', () => {
        const spec = getAmountViewSpec('XAU', 'oz', true);
        expect(spec.scale).toBe(6);
        expect(parseAmount('1', options('XAU', 'oz', true))).toBe(1000000);
        expect(viewAmountToStoredAmount(1000000, spec, 'XAU')).toBe(31103477);
        expect(viewAmountToStoredAmount(500000, spec, 'XAU')).toBe(15551738);
        expect(viewAmountToStoredAmount(-1000000, spec, 'XAU')).toBe(-31103477);
        expect(GRAMS_PER_TROY_OUNCE).toBe(31.1034768);
    });

    it('should round-trip common sizes: ounces entered -> grams stored -> ounces displayed', () => {
        const inputSpec = getAmountViewSpec('XAU', 'oz', true);
        const displaySpec = getAmountViewSpec('XAU', 'oz');

        for (const [text, expected] of [['1', '1'], ['0.5', '0.5'], ['0.1', '0.1'], ['2', '2'], ['10', '10'], ['0.25', '0.25'], ['32.150747', '32.1507']] as const) {
            const stored = viewAmountToStoredAmount(parseAmount(text, options('XAU', 'oz', true)), inputSpec, 'XAU');
            expect(format(stored, 'XAU', 'oz')).toBe(expected);
            // the edit form shows the same value again
            expect(formatAmount(parseBigDecimal(storedAmountToViewAmount(stored, inputSpec, 'XAU')), options('XAU', 'oz', true))).toBe(Number(text).toFixed(Math.max(2, (text.split('.')[1] ?? '').length)));
            expect(displaySpec.minDecimals).toBe(0);
        }

        // 1 kg in grams is exact, and is 32.1507 oz
        expect(format(1000000000, 'XAU', 'g')).toBe('1000.00');
        expect(format(1000000000, 'XAU', 'oz')).toBe('32.1507');
    });

    it('should keep the stored amount (within one micro-ounce) when the displayed input value is unchanged (oz view)', () => {
        const spec = getAmountViewSpec('XAU', 'oz', true);

        // amounts which come from ounces entered with up to 6 decimals are restored exactly
        for (const stored of [31103477, 15551738, 3110348, 62206954, 311034768]) {
            const view = storedAmountToViewAmount(stored, spec, 'XAU');
            expect(viewAmountToStoredAmount(view, spec, 'XAU')).toBe(stored);
        }

        // an arbitrary amount in grams may move by half of one micro-ounce (15.5 micrograms) at most
        for (const stored of [1, 2, 3110, 12345, 1000000000, 999999999999]) {
            const view = storedAmountToViewAmount(stored, spec, 'XAU');
            expect(Math.abs(viewAmountToStoredAmount(view, spec, 'XAU') - stored)).toBeLessThanOrEqual(16);
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

    it('should convert gold (grams, 6 decimals) to PLN', () => {
        // 31.10 g at 500 PLN per gram = 15550 PLN = 1555000 stored
        const converted = getExchangedAmountByRate(parseBigDecimal(31100000), '0.002', '1', 'XAU', 'PLN');
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
