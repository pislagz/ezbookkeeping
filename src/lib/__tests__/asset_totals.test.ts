import { describe, expect, it } from 'vitest';

import { AssetBreakdownCollector, convertAssetAmountByPrice, getTotalAmountSuffix } from '@/lib/asset_totals.ts';
import { parseBigDecimal } from '@/lib/numeral.ts';

describe('convertAssetAmountByPrice', () => {
    it('values grams stored with the metal scale in the default currency scale (2)', () => {
        // 31.10 g * 480.5 PLN/g = 14943.55 PLN
        const gold = convertAssetAmountByPrice(parseBigDecimal(31100000), 'XAU', '480.5', 'PLN');
        expect(gold?.truncate().toString()).toBe('1494355');
    });

    it('values crypto stored with 8 decimals', () => {
        const btc = convertAssetAmountByPrice(parseBigDecimal(1000000), 'BTC', '350000', 'PLN'); // 0.01 BTC
        expect(btc?.toString()).toBe('350000');
    });

    it('rejects invalid prices and non-assets', () => {
        expect(convertAssetAmountByPrice(parseBigDecimal(1000000), 'XAU', '0', 'PLN')).toBeNull();
        expect(convertAssetAmountByPrice(parseBigDecimal(1000000), 'XAU', 'abc', 'PLN')).toBeNull();
        expect(convertAssetAmountByPrice(parseBigDecimal(100), 'USD', '4', 'PLN')).toBeNull();
    });
});

describe('AssetBreakdownCollector', () => {
    it('merges the same asset, ignores zero and ordinary currencies, keeps missing prices', () => {
        const collector = new AssetBreakdownCollector();
        const latest = { price: '500', date: '2026-11-20' };

        collector.add('PLN', parseBigDecimal(100), parseBigDecimal(100));
        collector.add('XAU', parseBigDecimal(0), parseBigDecimal(0));
        expect(collector.hasAssets).toBe(false);

        collector.add('XAU', parseBigDecimal(3110), parseBigDecimal(1555000), latest);
        collector.add('XAU', parseBigDecimal(100), parseBigDecimal(50000), latest);
        collector.add('XAG', parseBigDecimal(500), null);

        const items = collector.items;
        expect(items).toHaveLength(2);
        expect(items[0]?.amount.toString()).toBe('3210');
        expect(items[0]?.value?.toString()).toBe('1605000');
        expect(items[0]?.priceDate).toBe('2026-11-20');
        expect(items[1]?.value).toBeNull();
    });
});

describe('getTotalAmountSuffix', () => {
    it('chooses the markers', () => {
        expect(getTotalAmountSuffix(false, false)).toBe('');
        expect(getTotalAmountSuffix(true, false)).toBe('+');
        expect(getTotalAmountSuffix(false, true)).toBe('*');
        expect(getTotalAmountSuffix(true, true)).toBe('+*');
    });
});
