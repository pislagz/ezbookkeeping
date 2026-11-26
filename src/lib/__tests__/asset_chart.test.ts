import { describe, expect, it } from 'vitest';

import { GRAMS_PER_TROY_OUNCE } from '@/consts/currency.ts';
import {
    buildAssetChartMarkers,
    filterByRange,
    findNearestEarlierPriceIndex,
    getDisplayQuantity,
    getFirstChartDate,
    getPriceDecimals,
    getPricePerDisplayUnit,
    getRangeStartDate,
    getTransactionDateString,
    groupMarkersByPoint,
    type AssetChartAccount,
    type AssetChartTransaction
} from '@/lib/asset_chart.ts';

const accounts: Record<string, AssetChartAccount> = {
    g1: { id: 'g1', name: 'Gold safe', currency: 'XAU' },
    g2: { id: 'g2', name: 'Gold bank', currency: 'XAU' },
    b1: { id: 'b1', name: 'Cold wallet', currency: 'BTC' },
    p1: { id: 'p1', name: 'Cash', currency: 'PLN' },
    e1: { id: 'e1', name: 'Euro', currency: 'EUR' }
};

const day = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000;

function tx(partial: Partial<AssetChartTransaction> & { id: string, date: string }): AssetChartTransaction {
    return {
        type: 2,
        time: day(partial.date),
        utcOffset: 0,
        sourceAccountId: 'g1',
        destinationAccountId: '0',
        sourceAmount: 31100000, // 31.10 g
        destinationAmount: 0,
        ...partial
    };
}

const prices = [
    { date: '2025-01-03', price: 300 },
    { date: '2025-01-01', price: 290 },
    { date: '2025-01-06', price: 310 }
];

function build(transactions: AssetChartTransaction[], assetCode = 'XAU', metalUnit = 'g', p = prices) {
    return buildAssetChartMarkers({ assetCode, defaultCurrency: 'PLN', metalUnit, accounts, transactions, prices: p });
}

describe('units', () => {
    it('converts price and quantity to oz', () => {
        expect(getPricePerDisplayUnit(100, 'XAU', 'oz')).toBeCloseTo(100 * GRAMS_PER_TROY_OUNCE, 8);
        expect(getPricePerDisplayUnit(100, 'XAU', 'g')).toBe(100);
        expect(getPricePerDisplayUnit(100, 'BTC', 'oz')).toBe(100);
        expect(getDisplayQuantity(31103476.8, 'XAU', 'oz')).toBeCloseTo(1, 6);
        expect(getDisplayQuantity(123456, 'BTC', 'oz')).toBe(0.00123456);
    });
});

describe('dates', () => {
    it('uses the transaction timezone', () => {
        const t = Date.parse('2025-01-01T23:30:00Z') / 1000;
        expect(getTransactionDateString(t, 0)).toBe('2025-01-01');
        expect(getTransactionDateString(t, 60)).toBe('2025-01-02');
        expect(getTransactionDateString(t, -300)).toBe('2025-01-01');
    });

    it('finds the nearest earlier price', () => {
        const sorted = [{ date: '2025-01-01', price: 1 }, { date: '2025-01-03', price: 1 }];
        expect(findNearestEarlierPriceIndex(sorted, '2024-12-31')).toBe(-1);
        expect(findNearestEarlierPriceIndex(sorted, '2025-01-01')).toBe(0);
        expect(findNearestEarlierPriceIndex(sorted, '2025-01-02')).toBe(0);
        expect(findNearestEarlierPriceIndex(sorted, '2025-01-03')).toBe(1);
        expect(findNearestEarlierPriceIndex(sorted, '2026-01-01')).toBe(1);
        expect(findNearestEarlierPriceIndex([], '2026-01-01')).toBe(-1);
    });
});

describe('markers', () => {
    it('income is a buy, expense is a sell, at the price of the day', () => {
        const markers = build([
            tx({ id: 'a', date: '2025-01-03', type: 2 }),
            tx({ id: 'b', date: '2025-01-06', type: 3 })
        ]);
        expect(markers.map(m => [m.id, m.side, m.price, m.accountName])).toEqual([
            ['a', 'buy', 300, 'Gold safe'],
            ['b', 'sell', 310, 'Gold safe']
        ]);
        expect(markers[0]!.quantity).toBeCloseTo(31.1, 8);
        expect(markers[0]!.value).toBeCloseTo(31.1 * 300, 6);
    });

    it('uses the nearest earlier price when the day has none', () => {
        const [m] = build([tx({ id: 'a', date: '2025-01-05' })]);
        expect(m!.price).toBe(300);
    });

    it('shows price and quantity per ounce', () => {
        const [m] = build([tx({ id: 'a', date: '2025-01-03', sourceAmount: 3110340000 })], 'XAU', 'oz');
        expect(m!.price).toBeCloseTo(300 * GRAMS_PER_TROY_OUNCE, 6);
        expect(m!.quantity).toBeCloseTo(3110.34 / GRAMS_PER_TROY_OUNCE, 6);
        expect(m!.value).toBeCloseTo(3110.34 * 300, 4);
    });

    it('excludes transactions with unknown date and balance modifications', () => {
        const markers = build([
            tx({ id: 'a', date: '2025-01-03', timeUnknown: true }),
            tx({ id: 'b', date: '2025-01-03', type: 1 }),
            tx({ id: 'c', date: '2025-01-03' })
        ]);
        expect(markers.map(m => m.id)).toEqual(['c']);
    });

    it('ignores accounts of other currencies', () => {
        expect(build([tx({ id: 'a', date: '2025-01-03', sourceAccountId: 'p1' })])).toEqual([]);
        expect(build([tx({ id: 'a', date: '2025-01-03', sourceAccountId: 'b1' })])).toEqual([]);
        expect(build([tx({ id: 'a', date: '2025-01-03', sourceAccountId: 'b1', sourceAmount: 123456 })], 'BTC')).toHaveLength(1);
    });

    it('treats transfers', () => {
        const markers = build([
            // between two gold accounts: no marker
            tx({ id: 'internal', date: '2025-01-03', type: 4, sourceAccountId: 'g1', destinationAccountId: 'g2', destinationAmount: 31100000 }),
            // PLN -> gold: buy, value is the PLN amount
            tx({ id: 'buy', date: '2025-01-03', type: 4, sourceAccountId: 'p1', destinationAccountId: 'g1', sourceAmount: 1000000, destinationAmount: 31100000 }),
            // gold -> EUR: sell valued at the series price
            tx({ id: 'sell', date: '2025-01-06', type: 4, sourceAccountId: 'g2', destinationAccountId: 'e1', sourceAmount: 10000000, destinationAmount: 5000 })
        ]);
        expect(markers.map(m => [m.id, m.side])).toEqual([['buy', 'buy'], ['sell', 'sell']]);
        expect(markers[0]!.value).toBe(10000);
        expect(markers[0]!.price).toBe(300);
        expect(markers[1]!.value).toBeCloseTo(10 * 310, 6);
        expect(markers[1]!.accountName).toBe('Gold bank');
    });

    it('uses the implied price when no price exists before the transaction', () => {
        const markers = build([
            tx({ id: 'a', date: '2024-12-01', type: 4, sourceAccountId: 'p1', destinationAccountId: 'g1', sourceAmount: 620000, destinationAmount: 31100000 }),
            tx({ id: 'b', date: '2024-12-01', type: 2 })
        ]);
        expect(markers).toHaveLength(1);
        expect(markers[0]!.id).toBe('a');
        expect(markers[0]!.priceFromSeries).toBe(false);
        expect(markers[0]!.price).toBeCloseTo(6200 / 31.1, 6);
    });

    it('has no markers without prices', () => {
        expect(build([tx({ id: 'a', date: '2025-01-03' })], 'XAU', 'g', [])).toEqual([]);
    });

    it('sorts by date and uses the transaction timezone for the date', () => {
        const late = Date.parse('2025-01-02T23:30:00Z') / 1000;
        const markers = build([
            tx({ id: 'b', date: '2025-01-06' }),
            tx({ id: 'a', date: '2025-01-03', time: late, utcOffset: 120 })
        ]);
        expect(markers.map(m => m.id)).toEqual(['a', 'b']);
        expect(markers[0]!.date).toBe('2025-01-03');
    });
});

describe('ranges', () => {
    it('computes the start date', () => {
        expect(getRangeStartDate('ALL', '2025-06-30')).toBeUndefined();
        expect(getRangeStartDate('1M', '2025-06-30')).toBe('2025-05-31');
        expect(getRangeStartDate('1Y', '2025-06-30')).toBe('2024-06-30');
    });

    it('filters and finds the first date', () => {
        const points = [{ date: '2025-01-01', price: 1 }, { date: '2025-06-01', price: 1 }, { date: '2025-06-30', price: 1 }];
        expect(filterByRange(points, '1M', '2025-06-30').map(p => p.date)).toEqual(['2025-06-01', '2025-06-30']);
        expect(filterByRange(points, 'ALL', '2025-06-30')).toHaveLength(3);
        const marker = build([tx({ id: 'a', date: '2025-01-03' })])[0]!;
        expect(getFirstChartDate(points, [marker])).toBe('2025-01-01');
        expect(getFirstChartDate([{ date: '2025-02-01', price: 1 }], [marker])).toBe('2025-01-03');
        expect(getFirstChartDate([], [])).toBeUndefined();
    });

    it('groups markers by the visible point', () => {
        const markers = build([
            tx({ id: 'a', date: '2025-01-01' }),
            tx({ id: 'b', date: '2025-01-05' }),
            tx({ id: 'c', date: '2025-01-06' })
        ]);
        const visible = [{ date: '2025-01-03', price: 300 }, { date: '2025-01-06', price: 310 }];
        const groups = groupMarkersByPoint(markers, visible);
        expect(groups['2025-01-03']!.map(m => m.id)).toEqual(['a', 'b']);
        expect(groups['2025-01-06']!.map(m => m.id)).toEqual(['c']);
        expect(groupMarkersByPoint(markers, [])).toEqual({});
    });

    it('picks decimals by price size', () => {
        expect(getPriceDecimals(13000)).toBe(2);
        expect(getPriceDecimals(5)).toBe(4);
        expect(getPriceDecimals(0.5)).toBe(6);
        expect(getPriceDecimals(0.0004)).toBe(8);
    });
});
