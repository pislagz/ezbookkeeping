import { defineStore } from 'pinia';

import { useExchangeRatesStore } from './exchangeRates.ts';

import type {
    AssetPriceInfo,
    AssetPriceSeriesItem,
    AssetPriceAutoUpdateResponse
} from '@/models/asset_price.ts';

import logger from '@/lib/logger.ts';
import services from '@/lib/services.ts';

function getServerError(error: { processed?: boolean, response?: { data?: { errorMessage?: string } } }, defaultMessage: string): unknown {
    if (error.response && error.response.data && error.response.data.errorMessage) {
        return { error: error.response.data };
    } else if (!error.processed) {
        return { message: defaultMessage };
    }

    return error;
}

// Asset price history (see docs/ASSETS.md). Every change reloads the exchange rates, because the valuation uses the latest price.
export const useAssetPricesStore = defineStore('assetPrices', () => {
    const exchangeRatesStore = useExchangeRatesStore();

    function loadLatestAssetPrices(): Promise<AssetPriceInfo[]> {
        return new Promise((resolve, reject) => {
            services.getLatestAssetPrices().then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to retrieve asset prices' });
                    return;
                }

                resolve(data.result);
            }).catch(error => {
                logger.error('failed to load latest asset prices', error);
                reject(getServerError(error, 'Unable to retrieve asset prices'));
            });
        });
    }

    function loadAssetPriceSeries({ asset, startDate, endDate }: { asset: string, startDate?: string, endDate?: string }): Promise<AssetPriceSeriesItem[]> {
        return new Promise((resolve, reject) => {
            services.getAssetPriceSeries({ asset, startDate, endDate }).then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to retrieve asset prices' });
                    return;
                }

                resolve(data.result);
            }).catch(error => {
                logger.error('failed to load asset price series', error);
                reject(getServerError(error, 'Unable to retrieve asset prices'));
            });
        });
    }

    function saveAssetPrice({ asset, date, price }: { asset: string, date: string, price: string }): Promise<AssetPriceInfo> {
        return new Promise((resolve, reject) => {
            services.saveAssetPrice({ asset, date, price }).then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to save asset price' });
                    return;
                }

                exchangeRatesStore.reloadExchangeRatesAfterAssetPriceChanged().then(() => resolve(data.result)).catch(reject);
            }).catch(error => {
                logger.error('failed to save asset price', error);
                reject(getServerError(error, 'Unable to save asset price'));
            });
        });
    }

    function deleteAssetPrice({ asset, date }: { asset: string, date: string }): Promise<boolean> {
        return new Promise((resolve, reject) => {
            services.deleteAssetPrice({ asset, date }).then(response => {
                const data = response.data;

                if (!data || !data.success || !data.result) {
                    reject({ message: 'Unable to delete asset price' });
                    return;
                }

                exchangeRatesStore.reloadExchangeRatesAfterAssetPriceChanged().then(() => resolve(data.result)).catch(reject);
            }).catch(error => {
                logger.error('failed to delete asset price', error);
                reject(getServerError(error, 'Unable to delete asset price'));
            });
        });
    }

    // fetches the public prices now (the server still serves its one-hour cache)
    function fetchAssetPricesNow(): Promise<AssetPriceAutoUpdateResponse | undefined> {
        return exchangeRatesStore.autoUpdateAssetPrices({ force: true });
    }

    return {
        loadLatestAssetPrices,
        loadAssetPriceSeries,
        saveAssetPrice,
        deleteAssetPrice,
        fetchAssetPricesNow
    };
});
