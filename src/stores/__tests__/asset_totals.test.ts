import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useUserStore } from '@/stores/user.ts';
import { useAccountsStore } from '@/stores/account.ts';
import { useExchangeRatesStore } from '@/stores/exchangeRates.ts';

import type { BigDecimalWithSuffix } from '@/core/numeral.ts';
import { EMPTY_USER_BASIC_INFO } from '@/models/user.ts';
import type { Account } from '@/models/account.ts';

import { parseBigDecimal } from '@/lib/numeral.ts';

vi.hoisted(() => {
    const data = new Map<string, string>();
    const storage = {
        getItem: (key: string) => data.has(key) ? data.get(key) as string : null,
        setItem: (key: string, value: string) => { data.set(key, String(value)); },
        removeItem: (key: string) => { data.delete(key); },
        clear: () => { data.clear(); },
        key: (index: number) => Array.from(data.keys())[index] ?? null,
        get length() { return data.size; }
    };

    Object.assign(globalThis, {
        window: { location: { pathname: '/', origin: 'http://localhost', href: 'http://localhost/' }, localStorage: storage, sessionStorage: storage },
        localStorage: storage,
        sessionStorage: storage
    });
});

function account(id: string, currency: string, balance: string, category: number = 1): Account {
    return { id, name: id, parentId: '0', category, type: 1, currency, balance, hidden: false, isAsset: true, isLiability: false } as unknown as Account;
}

function setAccounts(accounts: Account[]): void {
    useAccountsStore().allCategorizedAccountsMap = { 1: { category: 1, accounts } } as never;
}

describe('totals with assets', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        useUserStore().storeUserBasicInfo({ ...EMPTY_USER_BASIC_INFO, username: 'test', defaultCurrency: 'PLN' });
    });

    it('values gold with the latest price even when the exchange rates list is empty (offline mode, rates never loaded)', () => {
        const exchangeRatesStore = useExchangeRatesStore();
        // 1 oz stored in 0.01 g
        exchangeRatesStore.latestAssetPrices = { XAU: { price: '480.5', date: '2026-11-20' } };
        setAccounts([account('a', 'PLN', '10000000'), account('b', 'XAU', '3110')]);

        const total = useAccountsStore().getTotalAssets(true, {}) as BigDecimalWithSuffix;

        // 100000.00 PLN + 31.10 g * 480.5 = 14943.55 -> 114943.55 PLN
        expect(total.value.toString()).toBe('11494355');
        expect(total.suffix).toBe('*');
        expect(total.assetItems).toHaveLength(1);
        expect(total.assetItems?.[0]?.currency).toBe('XAU');
        expect(total.assetItems?.[0]?.priceDate).toBe('2026-11-20');
        expect(total.assetItems?.[0]?.value?.toString()).toBe('1494355');
    });

    it('values crypto with its stored scale (8 decimals)', () => {
        const exchangeRatesStore = useExchangeRatesStore();
        exchangeRatesStore.latestAssetPrices = { BTC: { price: '350000', date: '2026-11-26' } };
        setAccounts([account('c', 'BTC', '1000000')]); // 0.01 BTC

        const total = useAccountsStore().getNetAssets(true, {}) as BigDecimalWithSuffix;

        expect(total.value.toString()).toBe('350000');
        expect(total.suffix).toBe('*');
    });

    it('keeps the asterisk and excludes an asset without any price', () => {
        const exchangeRatesStore = useExchangeRatesStore();
        exchangeRatesStore.latestAssetPrices = { XAU: { price: '500', date: '2026-11-20' } };
        setAccounts([account('a', 'PLN', '1000'), account('b', 'XAU', '3110'), account('s', 'XAG', '50000')]);

        const total = useAccountsStore().getTotalAssets(true, {}) as BigDecimalWithSuffix;

        expect(total.suffix).toBe('*'); // no "+": a missing asset price is listed in the breakdown
        expect(total.value.toString()).toBe((1000 + 1555000).toString());
        const silver = total.assetItems?.find(item => item.currency === 'XAG');
        expect(silver?.value).toBeNull();
        expect(silver?.amount.toString()).toBe('50000');
    });

    it('keeps the upstream "+" for an ordinary currency without a rate', () => {
        setAccounts([account('a', 'PLN', '1000'), account('u', 'USD', '5000')]);

        const total = useAccountsStore().getTotalAssets(true, {}) as BigDecimalWithSuffix;

        expect(total.suffix).toBe('+');
        expect(total.assetItems).toEqual([]);
        expect(total.value.toString()).toBe('1000');
    });

    it('combines both markers and does not mark totals without assets', () => {
        const exchangeRatesStore = useExchangeRatesStore();
        exchangeRatesStore.latestAssetPrices = { XAU: { price: '500', date: '2026-11-20' } };
        setAccounts([account('b', 'XAU', '3110'), account('u', 'USD', '5000')]);

        expect((useAccountsStore().getTotalAssets(true, {}) as BigDecimalWithSuffix).suffix).toBe('+*');

        setAccounts([account('a', 'PLN', '1000')]);
        expect(useAccountsStore().getTotalAssets(true, {})).toEqual(parseBigDecimal('1000'));
    });

    it('counts liabilities with the negative sign', () => {
        const exchangeRatesStore = useExchangeRatesStore();
        exchangeRatesStore.latestAssetPrices = { XAU: { price: '500', date: '2026-11-20' } };
        const liability = { ...account('l', 'XAU', '3110'), isAsset: false, isLiability: true } as unknown as Account;
        setAccounts([liability]);

        const total = useAccountsStore().getTotalLiabilities(true, {}) as BigDecimalWithSuffix;

        expect(total.value.toString()).toBe('-' + (31.1 * 500 * 100).toString());
        expect(total.assetItems?.[0]?.value?.toString()).toBe('-' + (31.1 * 500 * 100).toString());
    });
});
