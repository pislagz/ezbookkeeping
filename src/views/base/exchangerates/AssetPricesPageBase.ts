import { ref, computed } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useUserStore } from '@/stores/user.ts';
import { useExchangeRatesStore } from '@/stores/exchangeRates.ts';

import { ALL_ASSETS } from '@/consts/currency.ts';

export interface AssetPriceItem {
    readonly code: string;
    readonly name: string;
    readonly kind: 'metal' | 'crypto';
    readonly groupName: string;
    readonly unitName: string; // 'g' for metals, 'coin' for crypto
    price: number; // 0 when the price is not set
}

// The prices of assets are entered by the user in the default currency per one unit (one gram or one coin).
// Prices of metals are also displayed per troy ounce for convenience.
// HOOK: dated price history + auto-fetch will fill the same prices, this page then edits the manual entries.
export function useAssetPricesPageBase() {
    const { tt, getCurrencyName } = useI18n();

    const userStore = useUserStore();
    const exchangeRatesStore = useExchangeRatesStore();

    const loading = ref<boolean>(false);
    const defaultCurrency = computed<string>(() => userStore.currentUserDefaultCurrency);

    const assetPrices = ref<AssetPriceItem[]>([]);

    function loadAssetPrices(): void {
        assetPrices.value = ALL_ASSETS.map(asset => ({
            code: asset.code,
            name: getCurrencyName(asset.code),
            kind: asset.kind,
            groupName: asset.kind === 'metal' ? tt('Metals') : tt('Crypto'),
            unitName: asset.kind === 'metal' ? 'g' : asset.code,
            price: exchangeRatesStore.getAssetPrice(asset.code, defaultCurrency.value) ?? 0
        }));
    }

    function reload(): Promise<void> {
        loading.value = true;

        return new Promise((resolve) => {
            exchangeRatesStore.getLatestExchangeRates({ silent: true, force: false }).then(() => {
                loadAssetPrices();
                loading.value = false;
                resolve();
            }).catch(() => {
                loadAssetPrices();
                loading.value = false;
                resolve();
            });
        });
    }

    function savePrice(item: AssetPriceItem): Promise<unknown> {
        if (!item.price || item.price <= 0) {
            return exchangeRatesStore.deleteUserCustomExchangeRate({ currency: item.code });
        }

        return exchangeRatesStore.updateUserCustomExchangeRate({ currency: item.code, rate: item.price });
    }

    function removePrice(item: AssetPriceItem): Promise<unknown> {
        return exchangeRatesStore.deleteUserCustomExchangeRate({ currency: item.code });
    }

    return {
        // states
        loading,
        defaultCurrency,
        assetPrices,
        // functions
        reload,
        loadAssetPrices,
        savePrice,
        removePrice
    };
}
