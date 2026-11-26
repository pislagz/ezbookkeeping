import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

import { useSettingsStore } from './setting.ts';
import { useUserStore } from './user.ts';

import { type BeforeResolveFunction, itemAndIndex } from '@/core/base.ts';
import type { BigDecimal } from '@/core/numeral.ts';

import type { AssetPriceInfo, AssetPriceAutoUpdateResponse } from '@/models/asset_price.ts';
import type {
    UserCustomExchangeRateUpdateResponse,
    LatestExchangeRate,
    LatestExchangeRateResponse
} from '@/models/exchange_rate.ts';

import { isEquals } from '@/lib/common.ts';
import {
    isUnixTimeYearMonthDayEquals,
    isUnixTimeYearMonthDayHourEquals,
    getCurrentUnixTime
} from '@/lib/datetime.ts';
import { getExchangedAmountByRate } from '@/lib/numeral.ts';
import { isAssetCurrency } from '@/lib/asset.ts';
import { shouldRequestAssetPriceUpdate } from '@/lib/asset_price.ts';
import { convertAssetAmountByPrice, type AssetLatestPrice } from '@/lib/asset_totals.ts';
import { isOfflineMode } from '@/lib/server_settings.ts';

import logger from '@/lib/logger.ts';
import services from '@/lib/services.ts';

const exchangeRatesLocalStorageKey = 'ebk_app_exchange_rates';
const userDataSourceType = 'user_custom';
const assetPricesAutoUpdateTimeLocalStorageKey = 'ebk_app_asset_prices_auto_update_time';

interface LatestExchangeRates {
    readonly time?: number;
    readonly data?: LatestExchangeRateResponse;
}

function getExchangeRatesFromLocalStorage(): LatestExchangeRates {
    const storageData = localStorage.getItem(exchangeRatesLocalStorageKey) || '{}';
    return JSON.parse(storageData) as LatestExchangeRates;
}

function getExchangeRatesRawDataFromLocalStorage(): string | null {
    return localStorage.getItem(exchangeRatesLocalStorageKey);
}

function setExchangeRatesToLocalStorage(value: LatestExchangeRates): void {
    const storageData = JSON.stringify(value);
    localStorage.setItem(exchangeRatesLocalStorageKey, storageData);
}

function clearExchangeRatesFromLocalStorage(): void {
    localStorage.removeItem(exchangeRatesLocalStorageKey);
}

export const useExchangeRatesStore = defineStore('exchangeRates', () => {
    const settingsStore = useSettingsStore();
    const userStore = useUserStore();

    // The latest price (any date) of every asset which has one, in the user's default currency. It is loaded from the local database of the server
    // (never from the internet), independent of the exchange rates data source, the offline mode and the exchange rates cache.
    const latestAssetPrices = ref<Record<string, AssetLatestPrice>>({});

    const latestExchangeRates = ref<LatestExchangeRates>(getExchangeRatesFromLocalStorage());

    const exchangeRatesDataCacheEnabled = computed<boolean>(() => settingsStore.appSettings.exchangeRatesDataCacheExpiration >= 0);

    const isUserCustomExchangeRates = computed((): boolean => {
        if (!latestExchangeRates.value || !latestExchangeRates.value.data) {
            return false;
        }

        return latestExchangeRates.value.data.dataSource === userDataSourceType;
    });

    const exchangeRatesLastUpdateTime = computed<number | null>(() => {
        const exchangeRates = latestExchangeRates.value || {};
        return exchangeRates && exchangeRates.data ? exchangeRates.data.updateTime : null;
    });

    const latestExchangeRateMap = computed<Record<string, LatestExchangeRate>>(() => {
        const exchangeRateMap: Record<string, LatestExchangeRate> = {};

        if (!latestExchangeRates.value || !latestExchangeRates.value.data || !latestExchangeRates.value.data.exchangeRates) {
            return exchangeRateMap;
        }

        for (const exchangeRate of latestExchangeRates.value.data.exchangeRates) {
            exchangeRateMap[exchangeRate.currency] = exchangeRate;
        }

        return exchangeRateMap;
    });

    function updateExchangeRateToLatestExchangeRateList(latestExchangeRate: LatestExchangeRate, updateTime: number): void {
        if (!latestExchangeRates.value || !latestExchangeRates.value.data || !latestExchangeRates.value.data.exchangeRates) {
            return;
        }

        const exchangeRates = latestExchangeRates.value.data.exchangeRates;
        let changed = false;

        for (const [exchangeRate, index] of itemAndIndex(exchangeRates)) {
            if (exchangeRate.currency === latestExchangeRate.currency) {
                exchangeRates.splice(index, 1, latestExchangeRate);
                changed = true;
                break;
            }
        }

        if (!changed) {
            exchangeRates.push(latestExchangeRate);
            changed = true;
        }

        latestExchangeRates.value.data.updateTime = updateTime;

        if (exchangeRatesDataCacheEnabled.value && changed) {
            setExchangeRatesToLocalStorage(latestExchangeRates.value);
        }
    }

    function removeExchangeRateFromLatestExchangeRateList(currency: string): void {
        if (!latestExchangeRates.value || !latestExchangeRates.value.data || !latestExchangeRates.value.data.exchangeRates) {
            return;
        }

        const exchangeRates = latestExchangeRates.value.data.exchangeRates;
        let changed = false;

        for (const [exchangeRate, index] of itemAndIndex(exchangeRates)) {
            if (exchangeRate.currency === currency) {
                exchangeRates.splice(index, 1);
                changed = true;
                break;
            }
        }

        if (exchangeRatesDataCacheEnabled.value && changed) {
            setExchangeRatesToLocalStorage(latestExchangeRates.value);
        }
    }

    function getExchangeRatesCacheSize(): number {
        const storageData = getExchangeRatesRawDataFromLocalStorage();

        if (!storageData) {
            return 0;
        }

        return new Blob([storageData]).size;
    }

    function removeExpiredExchangeRates(removeDataInStore?: boolean): void {
        if (settingsStore.appSettings.exchangeRatesDataCacheExpiration > 0) {
            const currentExchangeRateData = latestExchangeRates.value;
            const now = getCurrentUnixTime();

            if (currentExchangeRateData && currentExchangeRateData.time) {
                if (now - currentExchangeRateData.time >= settingsStore.appSettings.exchangeRatesDataCacheExpiration) {
                    if (removeDataInStore) {
                        resetLatestExchangeRates();
                    } else {
                        clearExchangeRatesFromLocalStorage();
                    }
                }
            }
        } else if (settingsStore.appSettings.exchangeRatesDataCacheExpiration < 0) { // Disable Cache
            if (removeDataInStore) {
                resetLatestExchangeRates();
            } else {
                clearExchangeRatesFromLocalStorage();
            }
        }
    }

    function resetLatestAssetPrices(): void {
        latestAssetPrices.value = {};
    }

    function resetLatestExchangeRates(): void {
        latestExchangeRates.value = {};
        clearExchangeRatesFromLocalStorage();
    }

    function setLatestAssetPrices(prices: AssetPriceInfo[]): void {
        const map: Record<string, AssetLatestPrice> = {};

        for (const item of prices) {
            map[item.asset] = { price: item.price, date: item.date };
        }

        latestAssetPrices.value = map;
    }

    // Loads the latest price of every asset (local database only, no outbound request)
    function loadLatestAssetPrices(): Promise<void> {
        return new Promise((resolve, reject) => {
            services.getLatestAssetPrices().then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to retrieve asset prices' });
                    return;
                }

                setLatestAssetPrices(data.result);
                resolve();
            }).catch(error => {
                logger.error('failed to load latest asset prices', error);
                reject({ message: 'Unable to retrieve asset prices' });
            });
        });
    }

    function autoUpdateExchangeRatesData(): void {
        // the prices of assets are read from the local database, they are needed in every mode
        loadLatestAssetPrices().catch(() => {});

        if (isOfflineMode()) {
            // the server only reads the local database in offline mode, it is safe to ask for the (manually entered) rates
            getLatestExchangeRates({ silent: true, force: false }).catch(() => {});
            return;
        }

        if (settingsStore.appSettings.autoUpdateExchangeRatesData) {
            getLatestExchangeRates({ silent: true, force: false });
        }

        autoUpdateAssetPrices({ force: false }).catch(() => {});
    }

    // Asks the server to fetch the public prices of gold and crypto assets which the user holds (the server fetches at most once per hour,
    // can be disabled in the config). Nothing is sent to external services by the browser, and no user data is sent by the server.
    function autoUpdateAssetPrices({ force }: { force: boolean }): Promise<AssetPriceAutoUpdateResponse | undefined> {
        const now = getCurrentUnixTime();

        if (!shouldRequestAssetPriceUpdate({
            offlineMode: isOfflineMode(),
            enabledByUser: !!settingsStore.appSettings.autoUpdateAssetPricesData,
            force,
            lastUpdateUnixTime: Number(localStorage.getItem(assetPricesAutoUpdateTimeLocalStorageKey) || 0),
            nowUnixTime: now
        })) {
            return Promise.resolve(undefined);
        }

        localStorage.setItem(assetPricesAutoUpdateTimeLocalStorageKey, now.toString());

        return new Promise((resolve, reject) => {
            services.autoUpdateAssetPrices().then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to update asset prices' });
                    return;
                }

                if (data.result.savedCount > 0) {
                    reloadExchangeRatesAfterAssetPriceChanged().then(() => resolve(data.result)).catch(() => resolve(data.result));
                } else {
                    resolve(data.result);
                }
            }).catch(error => {
                logger.error('failed to update asset prices', error);
                reject({ message: 'Unable to update asset prices' });
            });
        });
    }

    function getLatestExchangeRates({ silent, force }: { silent: boolean, force: boolean }): Promise<LatestExchangeRateResponse> {
        const currentExchangeRateData = latestExchangeRates.value;
        const now = getCurrentUnixTime();

        if (!force) {
            if (currentExchangeRateData && currentExchangeRateData.time && currentExchangeRateData.data && isUnixTimeYearMonthDayEquals(currentExchangeRateData.data.updateTime, now)) {
                return Promise.resolve(currentExchangeRateData.data);
            }

            if (currentExchangeRateData && currentExchangeRateData.time && currentExchangeRateData.data && isUnixTimeYearMonthDayHourEquals(currentExchangeRateData.time, now)) {
                return Promise.resolve(currentExchangeRateData.data);
            }
        }

        return new Promise((resolve, reject) => {
            services.getLatestExchangeRates({
                ignoreError: silent
            }).then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to retrieve exchange rates data' });
                    return;
                }

                const currentData = getExchangeRatesFromLocalStorage();

                if (force && currentData && currentData.data && isEquals(currentData.data, data.result)) {
                    reject({ message: 'Exchange rates data is up to date', isUpToDate: true });
                    return;
                }

                if (exchangeRatesDataCacheEnabled.value) {
                    latestExchangeRates.value = {
                        time: now,
                        data: data.result
                    };
                    setExchangeRatesToLocalStorage(latestExchangeRates.value);
                }

                resolve(data.result);
            }).catch(error => {
                logger.error('failed to retrieve latest exchange rates data', error);

                if (error && error.processed) {
                    reject(error);
                } else if (error.response && error.response.data && error.response.data.errorMessage) {
                    reject({ error: error.response.data });
                } else {
                    reject({ message: 'Unable to retrieve exchange rates data' });
                }
            });
        });
    }

    function updateUserCustomExchangeRate({ currency, rate }: { currency: string, rate: number }): Promise<UserCustomExchangeRateUpdateResponse> {
        return new Promise((resolve, reject) => {
            services.updateUserCustomExchangeRate({
                currency: currency,
                rate: rate.toString()
            }).then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to update user custom exchange rate' });
                    return;
                }

                if (isAssetCurrency(currency)) {
                    // for assets the server returns the price (not a rate), reload the exchange rates to get the converted rate
                    reloadExchangeRatesAfterAssetPriceChanged().then(() => resolve(data.result)).catch(reject);
                    return;
                }

                const exchangeRate: LatestExchangeRate = {
                    currency: data.result.currency,
                    rate: data.result.rate
                };

                updateExchangeRateToLatestExchangeRateList(exchangeRate, data.result.updateTime);

                resolve(data.result);
            }).catch(error => {
                logger.error('failed to update user custom exchange rate', error);

                if (error.response && error.response.data && error.response.data.errorMessage) {
                    reject({ error: error.response.data });
                } else if (!error.processed) {
                    reject({ message: 'Unable to update user custom exchange rate' });
                } else {
                    reject(error);
                }
            });
        });
    }

    function deleteUserCustomExchangeRate({ currency, beforeResolve }: { currency: string, beforeResolve?: BeforeResolveFunction }): Promise<boolean> {
        return new Promise((resolve, reject) => {
            services.deleteUserCustomExchangeRate({
                currency: currency
            }).then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to delete this user custom exchange rate' });
                    return;
                }

                if (isAssetCurrency(currency)) {
                    reloadExchangeRatesAfterAssetPriceChanged().then(() => resolve(data.result)).catch(reject);
                    return;
                }

                if (beforeResolve) {
                    beforeResolve(() => {
                        removeExchangeRateFromLatestExchangeRateList(currency);
                    });
                } else {
                    removeExchangeRateFromLatestExchangeRateList(currency);
                }

                resolve(data.result);
            }).catch(error => {
                logger.error('failed to delete user custom exchange rate', error);

                if (error.response && error.response.data && error.response.data.errorMessage) {
                    reject({ error: error.response.data });
                } else if (!error.processed) {
                    reject({ message: 'Unable to delete this user custom exchange rate' });
                } else {
                    reject(error);
                }
            });
        });
    }

    function reloadExchangeRatesAfterAssetPriceChanged(): Promise<void> {
        return loadLatestAssetPrices().catch(() => {}).then(() => new Promise<void>((resolve, reject) => {
            getLatestExchangeRates({ silent: true, force: true }).then(() => resolve()).catch(error => {
                if (error && error.isUpToDate) {
                    resolve();
                } else {
                    reject(error);
                }
            });
        }));
    }

    // Returns the price of one unit (one gram for metals, one coin for crypto) of the asset in the default currency
    // The server converts the asset prices to rates of the same format as other currencies (see pkg/exchangerates/exchange_rates_data_provider_container.go)
    function getAssetPrice(assetCode: string, defaultCurrency: string): number | undefined {
        const assetRate = Number(latestExchangeRateMap.value[assetCode]?.rate);
        const defaultCurrencyRate = Number(latestExchangeRateMap.value[defaultCurrency]?.rate);

        if (!assetRate || !defaultCurrencyRate || !Number.isFinite(assetRate) || !Number.isFinite(defaultCurrencyRate) || assetRate <= 0) {
            return undefined;
        }

        return defaultCurrencyRate / assetRate;
    }

    // Returns the latest price (any date) of the asset in the default currency, undefined if the asset has no price at all
    function getAssetLatestPrice(assetCode: string): AssetLatestPrice | undefined {
        return latestAssetPrices.value[assetCode];
    }

    function getExchangedAmount(amount: BigDecimal, fromCurrency: string, toCurrency: string): BigDecimal | null {
        if (amount.isZero()) {
            return amount;
        }

        // assets are valued directly with their latest price, so the valuation does not depend on the exchange rates list
        if (isAssetCurrency(fromCurrency) && toCurrency === userStore.currentUserDefaultCurrency) {
            const latest = latestAssetPrices.value[fromCurrency];
            const value = latest ? convertAssetAmountByPrice(amount, fromCurrency, latest.price, toCurrency) : null;

            if (value) {
                return value;
            }
        }

        if (!latestExchangeRates.value || !latestExchangeRates.value.data || !latestExchangeRates.value.data.exchangeRates) {
            return null;
        }

        const exchangeRates = latestExchangeRates.value.data.exchangeRates;
        const exchangeRateMap: Record<string, LatestExchangeRate> = {};

        for (const exchangeRate of exchangeRates) {
            exchangeRateMap[exchangeRate.currency] = exchangeRate;
        }

        const fromCurrencyExchangeRate = exchangeRateMap[fromCurrency];
        const toCurrencyExchangeRate = exchangeRateMap[toCurrency];

        if (!fromCurrencyExchangeRate || !toCurrencyExchangeRate) {
            return null;
        }

        return getExchangedAmountByRate(amount, fromCurrencyExchangeRate.rate, toCurrencyExchangeRate.rate, fromCurrency, toCurrency);
    }

    return {
        // states
        latestExchangeRates,
        latestAssetPrices,
        // computed states
        isUserCustomExchangeRates,
        exchangeRatesLastUpdateTime,
        latestExchangeRateMap,
        // functions
        getExchangeRatesCacheSize,
        removeExpiredExchangeRates,
        resetLatestExchangeRates,
        resetLatestAssetPrices,
        autoUpdateExchangeRatesData,
        autoUpdateAssetPrices,
        reloadExchangeRatesAfterAssetPriceChanged,
        getLatestExchangeRates,
        updateUserCustomExchangeRate,
        deleteUserCustomExchangeRate,
        getAssetPrice,
        loadLatestAssetPrices,
        getAssetLatestPrice,
        getExchangedAmount
    };
});
