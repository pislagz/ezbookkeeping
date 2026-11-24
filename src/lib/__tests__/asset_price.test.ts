import { describe, expect, test } from 'vitest';

import {
    shouldAutoUpdateAssetPrices,
    shouldRequestAssetPriceUpdate,
    isValidAssetPriceDate,
    getLocalDateString,
    addDaysToDateString,
    formatAssetPriceForRequest,
    parseAssetPriceString,
    formatAssetPriceForDisplay
} from '../asset_price.ts';

describe('shouldAutoUpdateAssetPrices', () => {
    test('updates when never updated or clock went backwards', () => {
        expect(shouldAutoUpdateAssetPrices(null, 1000)).toBe(true);
        expect(shouldAutoUpdateAssetPrices(0, 1000)).toBe(true);
        expect(shouldAutoUpdateAssetPrices(5000, 1000)).toBe(true);
    });

    test('at most once per hour', () => {
        expect(shouldAutoUpdateAssetPrices(1000, 1000 + 3599)).toBe(false);
        expect(shouldAutoUpdateAssetPrices(1000, 1000 + 3600)).toBe(true);
    });
});

describe('date helpers', () => {
    test('isValidAssetPriceDate', () => {
        expect(isValidAssetPriceDate('2026-02-28')).toBe(true);
        expect(isValidAssetPriceDate('2026-02-30')).toBe(false);
        expect(isValidAssetPriceDate('2026-2-3')).toBe(false);
        expect(isValidAssetPriceDate('')).toBe(false);
    });

    test('getLocalDateString pads month and day', () => {
        expect(getLocalDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    });

    test('addDaysToDateString', () => {
        expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28');
        expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
    });
});

describe('price formatting', () => {
    test('formatAssetPriceForRequest keeps small and large prices exact', () => {
        expect(formatAssetPriceForRequest(400000)).toBe('400000');
        expect(formatAssetPriceForRequest(0.0001)).toBe('0.0001');
        expect(formatAssetPriceForRequest(123.45)).toBe('123.45');
        expect(formatAssetPriceForRequest(1e-7)).toBe('0.0000001');
        expect(formatAssetPriceForRequest(0)).toBe('');
        expect(formatAssetPriceForRequest(NaN)).toBe('');
    });

    test('parseAssetPriceString', () => {
        expect(parseAssetPriceString('1.2e-7')).toBe(1.2e-7);
        expect(parseAssetPriceString('400000.5')).toBe(400000.5);
        expect(parseAssetPriceString('')).toBeNaN();
    });
});

describe('formatAssetPriceForDisplay', () => {
    test('formats without trailing zeros', () => {
        expect(formatAssetPriceForDisplay(400000)).toBe('400000');
        expect(formatAssetPriceForDisplay(400000.5)).toBe('400000.5');
        expect(formatAssetPriceForDisplay(0.0001)).toBe('0.0001');
        expect(formatAssetPriceForDisplay(2.5)).toBe('2.5');
        expect(formatAssetPriceForDisplay(null)).toBe('-');
    });
});

describe('shouldRequestAssetPriceUpdate', () => {
    const base = { offlineMode: false, enabledByUser: true, force: false, lastUpdateUnixTime: 0, nowUnixTime: 10000 };

    test('behaves like the normal auto update when online', () => {
        expect(shouldRequestAssetPriceUpdate(base)).toBe(true);
        expect(shouldRequestAssetPriceUpdate({ ...base, lastUpdateUnixTime: 9000 })).toBe(false);
        expect(shouldRequestAssetPriceUpdate({ ...base, enabledByUser: false })).toBe(false);
        expect(shouldRequestAssetPriceUpdate({ ...base, enabledByUser: false, force: true })).toBe(true);
    });

    test('never requests anything in offline mode, even when forced', () => {
        expect(shouldRequestAssetPriceUpdate({ ...base, offlineMode: true })).toBe(false);
        expect(shouldRequestAssetPriceUpdate({ ...base, offlineMode: true, force: true })).toBe(false);
    });
});
