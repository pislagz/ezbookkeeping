import { ref, computed } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useUserStore } from '@/stores/user.ts';
import { useSettingsStore } from '@/stores/setting.ts';
import { useAccountsStore } from '@/stores/account.ts';
import { useAssetPricesStore } from '@/stores/assetPrices.ts';

import { ALL_ASSETS } from '@/consts/currency.ts';

import services from '@/lib/services.ts';
import { getLocalDateString, parseAssetPriceString } from '@/lib/asset_price.ts';
import {
    type AssetChartRange,
    type AssetChartAccount,
    type AssetChartMarker,
    type AssetChartPricePoint,
    type AssetChartTransaction,
    ASSET_CHART_RANGES,
    buildAssetChartMarkers,
    filterByRange,
    getFirstChartDate,
    getPricePerDisplayUnit,
    getDisplayUnitName,
    groupMarkersByPoint,
    sortPricePoints
} from '@/lib/asset_chart.ts';

const TRANSACTION_PAGE_SIZE = 50; // the maximum the server accepts
const MAX_TRANSACTION_PAGES = 400;

export interface AssetChartAssetItem {
    readonly code: string;
    readonly name: string;
    readonly hasAccount: boolean;
}

export interface AssetChartModel {
    readonly points: AssetChartPricePoint[]; // visible price points, price per display unit
    readonly markers: AssetChartMarker[]; // visible markers
    readonly markersByPointDate: Record<string, AssetChartMarker[]>;
}

// Data of the price charts: the price history of an asset plus buy/sell markers of its accounts' dated transactions (docs/ASSETS.md, "Charts").
// Everything comes from local data (the server database), no price API is contacted.
export function useAssetChartPageBase() {
    const { tt, getCurrencyName } = useI18n();

    const userStore = useUserStore();
    const settingsStore = useSettingsStore();
    const accountsStore = useAccountsStore();
    const assetPricesStore = useAssetPricesStore();

    const loadingAssets = ref<boolean>(false);
    const loading = ref<boolean>(false);
    const loadFailed = ref<boolean>(false);
    const assets = ref<AssetChartAssetItem[]>([]);
    const selectedAsset = ref<string>('');
    const range = ref<AssetChartRange>('1Y');
    const basePrices = ref<AssetChartPricePoint[]>([]); // per gram / coin, all history
    const transactions = ref<AssetChartTransaction[]>([]);
    const assetAccounts = ref<Record<string, AssetChartAccount>>({});
    const today = ref<string>(getLocalDateString());

    const defaultCurrency = computed<string>(() => userStore.currentUserDefaultCurrency);
    const metalUnit = computed<string>(() => settingsStore.appSettings.metalDisplayUnit);
    const autoUpdateEnabled = computed<boolean>(() => !!settingsStore.appSettings.autoUpdateAssetPricesData);
    const unitName = computed<string>(() => selectedAsset.value ? getDisplayUnitName(selectedAsset.value, metalUnit.value) : '');

    const allMarkers = computed<AssetChartMarker[]>(() => {
        if (!selectedAsset.value) {
            return [];
        }

        return buildAssetChartMarkers({
            assetCode: selectedAsset.value,
            defaultCurrency: defaultCurrency.value,
            metalUnit: metalUnit.value,
            accounts: assetAccounts.value,
            transactions: transactions.value,
            prices: basePrices.value
        });
    });

    const allPoints = computed<AssetChartPricePoint[]>(() => {
        return basePrices.value.map(p => ({ date: p.date, price: getPricePerDisplayUnit(p.price, selectedAsset.value, metalUnit.value) }));
    });

    const model = computed<AssetChartModel>(() => {
        const points = filterByRange(allPoints.value, range.value, today.value);
        const markers = filterByRange(allMarkers.value, range.value, today.value);
        return { points, markers, markersByPointDate: groupMarkersByPoint(markers, points) };
    });

    const firstDate = computed<string | undefined>(() => getFirstChartDate(allPoints.value, allMarkers.value));
    const hasPrices = computed<boolean>(() => basePrices.value.length > 0);
    const hasDatedTransactions = computed<boolean>(() => allMarkers.value.length > 0);

    function getAllAccounts(): Record<string, AssetChartAccount> {
        const result: Record<string, AssetChartAccount> = {};

        // all accounts (also other currencies) are needed to classify transfers
        for (const account of accountsStore.allPlainAccounts) {
            result[account.id] = { id: account.id, name: account.name, currency: account.currency };
        }

        return result;
    }

    function loadAssets(): Promise<void> {
        loadingAssets.value = true;
        loadFailed.value = false;
        today.value = getLocalDateString();

        return Promise.all([
            accountsStore.loadAllAccounts({ force: false }).catch(() => []),
            assetPricesStore.loadLatestAssetPrices().catch(() => [])
        ]).then(([, latest]) => {
            const held = new Set(accountsStore.allPlainAccounts.map(account => account.currency));
            const withPrice = new Set(latest.map(item => item.asset));

            assets.value = ALL_ASSETS.filter(asset => held.has(asset.code) || withPrice.has(asset.code)).map(asset => ({
                code: asset.code,
                name: getCurrencyName(asset.code),
                hasAccount: held.has(asset.code)
            }));
            loadingAssets.value = false;
        });
    }

    async function loadAllTransactions(accountIds: string[]): Promise<AssetChartTransaction[]> {
        const result: AssetChartTransaction[] = [];

        if (!accountIds.length) {
            return result;
        }

        let maxTime = 0;

        for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
            const response = await services.getTransactions({
                maxTime,
                minTime: 0,
                count: TRANSACTION_PAGE_SIZE,
                page: 1,
                withCount: false,
                type: 0,
                categoryIds: '',
                accountIds: accountIds.join(','),
                tagFilter: '',
                amountFilter: '',
                keyword: '',
                matchMode: 0
            });
            const data = response.data;

            if (!data || !data.success || !data.result) {
                throw new Error('Unable to retrieve transaction list');
            }

            for (const item of data.result.items) {
                result.push({
                    id: item.id,
                    type: item.type,
                    time: item.time,
                    utcOffset: item.utcOffset,
                    timeUnknown: !!item.timeUnknown,
                    sourceAccountId: item.sourceAccountId,
                    destinationAccountId: item.destinationAccountId,
                    sourceAmount: item.sourceAmount,
                    destinationAmount: item.destinationAmount
                });
            }

            if (!data.result.nextTimeSequenceId) {
                break;
            }

            maxTime = data.result.nextTimeSequenceId;
        }

        return result;
    }

    function loadAsset(code: string): Promise<void> {
        selectedAsset.value = code;
        loading.value = true;
        loadFailed.value = false;
        basePrices.value = [];
        transactions.value = [];
        assetAccounts.value = getAllAccounts();

        const accountIds = Object.values(assetAccounts.value).filter(account => account.currency === code).map(account => account.id);

        return Promise.all([
            assetPricesStore.loadAssetPriceSeries({ asset: code }),
            loadAllTransactions(accountIds)
        ]).then(([series, txs]) => {
            if (selectedAsset.value !== code) {
                return; // another asset was selected meanwhile
            }

            basePrices.value = sortPricePoints(series.map(item => ({ date: item.date, price: parseAssetPriceString(item.price) })));
            transactions.value = txs;
            loading.value = false;
        }).catch(() => {
            if (selectedAsset.value === code) {
                loadFailed.value = true;
                loading.value = false;
            }
        });
    }

    function getRangeName(value: AssetChartRange): string {
        return value === 'ALL' ? tt('All') : value;
    }

    return {
        // states
        loadingAssets,
        loading,
        loadFailed,
        assets,
        selectedAsset,
        range,
        defaultCurrency,
        metalUnit,
        unitName,
        autoUpdateEnabled,
        model,
        firstDate,
        hasPrices,
        hasDatedTransactions,
        allRanges: ASSET_CHART_RANGES,
        // functions
        loadAssets,
        loadAsset,
        getRangeName
    };
}
