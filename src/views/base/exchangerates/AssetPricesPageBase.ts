import { isOfflineMode } from '@/lib/server_settings.ts';
import { ref, computed } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useUserStore } from '@/stores/user.ts';
import { useAssetPricesStore } from '@/stores/assetPrices.ts';

import { ALL_ASSETS, GRAMS_PER_TROY_OUNCE } from '@/consts/currency.ts';
import type { AssetPriceInfo, AssetPriceSeriesItem } from '@/models/asset_price.ts';
import {
    getLocalDateString,
    addDaysToDateString,
    formatAssetPriceForRequest,
    formatAssetPriceForDisplay,
    isValidAssetPriceDate,
    parseAssetPriceString
} from '@/lib/asset_price.ts';

const HISTORY_DAYS = 400;

export interface AssetPriceItem {
    readonly code: string;
    readonly name: string;
    readonly kind: 'metal' | 'crypto';
    readonly groupName: string;
    readonly unitName: string; // 'g' for metals, the code for crypto
    readonly price: number | null; // latest price, null when there is no price
    readonly date: string | null;
    readonly source: 'auto' | 'manual' | null;
    readonly sourceName: string | null;
}

export interface AssetPriceHistoryItem {
    readonly date: string;
    readonly price: number;
    readonly source: 'auto' | 'manual';
    readonly sourceName: string;
}

// Prices of assets are in the default currency per one gram (metals) or per one coin (crypto), stored as a dated history on the server.
// Metal prices are also displayed per troy ounce for convenience. Manual entries always win over automatic ones of the same date.
export function useAssetPricesPageBase() {
    const { tt, getCurrencyName } = useI18n();

    const offlineMode = isOfflineMode();

    const userStore = useUserStore();
    const assetPricesStore = useAssetPricesStore();

    const loading = ref<boolean>(false);
    const defaultCurrency = computed<string>(() => userStore.currentUserDefaultCurrency);

    const assetPrices = ref<AssetPriceItem[]>([]);
    const history = ref<AssetPriceHistoryItem[]>([]);

    function buildAssetPriceItems(latest: AssetPriceInfo[]): AssetPriceItem[] {
        const latestMap: Record<string, AssetPriceInfo> = {};

        for (const info of latest) {
            latestMap[info.asset] = info;
        }

        return ALL_ASSETS.map(asset => {
            const info = latestMap[asset.code];
            const price = info ? parseAssetPriceString(info.price) : NaN;

            return {
                code: asset.code,
                name: getCurrencyName(asset.code),
                kind: asset.kind,
                groupName: asset.kind === 'metal' ? tt('Metals') : tt('Crypto'),
                unitName: asset.kind === 'metal' ? 'g' : asset.code,
                price: info && Number.isFinite(price) ? price : null,
                date: info ? info.date : null,
                source: info ? info.source : null,
                sourceName: info ? info.sourceName : null
            };
        });
    }

    function loadAssetPrices(): Promise<void> {
        loading.value = true;

        return new Promise((resolve) => {
            assetPricesStore.loadLatestAssetPrices().then(latest => {
                assetPrices.value = buildAssetPriceItems(latest);
                loading.value = false;
                resolve();
            }).catch(() => {
                assetPrices.value = buildAssetPriceItems([]);
                loading.value = false;
                resolve();
            });
        });
    }

    function loadHistory(code: string): Promise<void> {
        loading.value = true;

        return new Promise((resolve) => {
            assetPricesStore.loadAssetPriceSeries({
                asset: code,
                startDate: addDaysToDateString(getLocalDateString(), -HISTORY_DAYS)
            }).then((series: AssetPriceSeriesItem[]) => {
                history.value = series.map(item => ({
                    date: item.date,
                    price: parseAssetPriceString(item.price),
                    source: item.source,
                    sourceName: item.sourceName
                })).reverse(); // newest first
                loading.value = false;
                resolve();
            }).catch(() => {
                history.value = [];
                loading.value = false;
                resolve();
            });
        });
    }

    function validate(date: string, price: number | null | undefined): string | null {
        if (!isValidAssetPriceDate(date)) {
            return 'Date is invalid';
        }

        if (!price || !formatAssetPriceForRequest(price)) {
            return 'Price is invalid';
        }

        return null;
    }

    function savePrice(code: string, date: string, price: number): Promise<unknown> {
        return assetPricesStore.saveAssetPrice({ asset: code, date, price: formatAssetPriceForRequest(price) });
    }

    function removePrice(code: string, date: string): Promise<unknown> {
        return assetPricesStore.deleteAssetPrice({ asset: code, date });
    }

    function fetchNow(): Promise<unknown> {
        if (offlineMode) {
            return Promise.resolve();
        }

        return assetPricesStore.fetchAssetPricesNow();
    }

    function getSourceDisplayName(source: 'auto' | 'manual' | null, sourceName?: string | null): string {
        if (source === 'manual') {
            return tt('Manual');
        } else if (source === 'auto') {
            const name = sourceName === 'nbp' ? 'NBP' : sourceName === 'coingecko' ? 'CoinGecko' : sourceName || '';
            return name ? `${tt('Automatic')} (${name})` : tt('Automatic');
        }

        return '';
    }

    function formatPrice(price: number | null): string {
        return formatAssetPriceForDisplay(price);
    }

    function formatOuncePrice(pricePerGram: number): string {
        return (Math.round(pricePerGram * GRAMS_PER_TROY_OUNCE * 100) / 100).toFixed(2);
    }

    return {
        // states
        loading,
        offlineMode,
        defaultCurrency,
        assetPrices,
        history,
        // functions
        loadAssetPrices,
        loadHistory,
        validate,
        savePrice,
        removePrice,
        fetchNow,
        getSourceDisplayName,
        formatPrice,
        formatOuncePrice
    };
}
