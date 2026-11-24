// Pure logic of the asset price charts (see docs/ASSETS.md, section "Charts"):
// price series + transactions of the accounts of one asset -> chart points and buy/sell markers.

import { GRAMS_PER_TROY_OUNCE } from '@/consts/currency.ts';
import { TransactionType } from '@/core/transaction.ts';

import { getAssetDefinition, getCurrencyStorageScale, isMetalCurrency, normalizeMetalUnit, type MetalUnit } from '@/lib/asset.ts';
import { addDaysToDateString } from '@/lib/asset_price.ts';

export type AssetChartRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const ASSET_CHART_RANGES: AssetChartRange[] = ['1M', '3M', '6M', '1Y', 'ALL'];

const RANGE_DAYS: Record<Exclude<AssetChartRange, 'ALL'>, number> = {
    '1M': 30,
    '3M': 91,
    '6M': 182,
    '1Y': 365
};

// stored amounts of normal currencies have two decimals
const DEFAULT_CURRENCY_SCALE = 2;

export interface AssetChartPricePoint {
    readonly date: string; // YYYY-MM-DD
    readonly price: number; // default currency per gram (metals) or per coin (crypto)
}

export interface AssetChartAccount {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
}

export interface AssetChartTransaction {
    readonly id: string;
    readonly type: number;
    readonly time: number; // unix time in seconds
    readonly utcOffset: number; // minutes east of UTC, the timezone the transaction was entered in
    readonly timeUnknown?: boolean;
    readonly sourceAccountId: string;
    readonly destinationAccountId: string;
    readonly sourceAmount: number; // stored (scaled integer) amount in the currency of the source account
    readonly destinationAmount: number;
}

export interface AssetChartMarker {
    readonly id: string;
    readonly side: 'buy' | 'sell';
    readonly date: string; // the date of the transaction
    readonly price: number; // y of the marker, default currency per display unit (oz / g / coin)
    readonly priceFromSeries: boolean; // false when the price is implied by the transfer
    readonly quantity: number; // amount in display units
    readonly storedAmount: number; // amount in the stored unit (0.01 g / coin scale)
    readonly value: number; // value in the default currency
    readonly accountName: string;
}

/**
 * The calendar date (YYYY-MM-DD) of a transaction in the timezone it was entered in
 */
export function getTransactionDateString(time: number, utcOffset: number): string {
    return new Date((time + utcOffset * 60) * 1000).toISOString().substring(0, 10);
}

/**
 * How many display units one stored/base unit is: metals in oz view are divided by 31.1034768 g
 */
export function getDisplayUnitGrams(assetCode: string, metalUnit?: string): number {
    if (isMetalCurrency(assetCode) && normalizeMetalUnit(metalUnit) === 'oz') {
        return GRAMS_PER_TROY_OUNCE;
    }

    return 1;
}

/**
 * The price per display unit from the price per gram / coin
 */
export function getPricePerDisplayUnit(basePrice: number, assetCode: string, metalUnit?: string): number {
    return basePrice * getDisplayUnitGrams(assetCode, metalUnit);
}

/**
 * The quantity in the base unit (grams / coins) of a stored integer amount
 */
export function getBaseQuantity(storedAmount: number, assetCode: string): number {
    return storedAmount / (10 ** getCurrencyStorageScale(assetCode));
}

/**
 * The quantity in display units (oz / g / coins) of a stored integer amount
 */
export function getDisplayQuantity(storedAmount: number, assetCode: string, metalUnit?: string): number {
    return getBaseQuantity(storedAmount, assetCode) / getDisplayUnitGrams(assetCode, metalUnit);
}

export function getDisplayUnitName(assetCode: string, metalUnit?: string): string {
    const asset = getAssetDefinition(assetCode);

    if (asset && asset.kind === 'metal') {
        return normalizeMetalUnit(metalUnit) as MetalUnit;
    }

    return assetCode;
}

/**
 * Index of the last point whose date is <= the date, -1 if there is none (points must be sorted by date ascending)
 */
export function findNearestEarlierPriceIndex(points: readonly AssetChartPricePoint[], date: string): number {
    let low = 0;
    let high = points.length - 1;
    let result = -1;

    while (low <= high) {
        const mid = (low + high) >> 1;

        if (points[mid]!.date <= date) {
            result = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return result;
}

export function sortPricePoints(points: readonly AssetChartPricePoint[]): AssetChartPricePoint[] {
    return points.filter(p => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

interface MarkerCandidate {
    readonly side: 'buy' | 'sell';
    readonly storedAmount: number;
    readonly accountId: string;
    // the amount on the other side of a transfer, when it is in the default currency (stored, 2 decimals)
    readonly counterpartDefaultCurrencyAmount?: number;
}

/**
 * Classifies a transaction for one asset:
 * - income into an account of the asset: buy; expense from an account of the asset: sell
 * - transfer into an account of the asset from an account of another currency: buy, out of it into another currency: sell
 * - transfer between two accounts of the asset: no marker (the holding does not change)
 * - opening balance / balance modification: no marker (its date is not an acquisition date)
 * - transactions with unknown date: no marker
 */
export function classifyTransaction(tx: AssetChartTransaction, assetCode: string, defaultCurrency: string, accounts: Readonly<Record<string, AssetChartAccount>>): MarkerCandidate | null {
    if (tx.timeUnknown || tx.type === TransactionType.ModifyBalance) {
        return null;
    }

    const source = accounts[tx.sourceAccountId];
    const destination = accounts[tx.destinationAccountId];
    const sourceIsAsset = !!source && source.currency === assetCode;
    const destinationIsAsset = !!destination && destination.currency === assetCode;

    if (tx.type === TransactionType.Income) {
        return sourceIsAsset && tx.sourceAmount > 0 ? { side: 'buy', storedAmount: tx.sourceAmount, accountId: source.id } : null;
    }

    if (tx.type === TransactionType.Expense) {
        return sourceIsAsset && tx.sourceAmount > 0 ? { side: 'sell', storedAmount: tx.sourceAmount, accountId: source.id } : null;
    }

    if (tx.type === TransactionType.Transfer) {
        if (sourceIsAsset === destinationIsAsset) {
            return null;
        }

        if (sourceIsAsset) {
            return {
                side: 'sell',
                storedAmount: tx.sourceAmount,
                accountId: source.id,
                counterpartDefaultCurrencyAmount: destination && destination.currency === defaultCurrency ? tx.destinationAmount : undefined
            };
        }

        return {
            side: 'buy',
            storedAmount: tx.destinationAmount,
            accountId: destination!.id,
            counterpartDefaultCurrencyAmount: source && source.currency === defaultCurrency ? tx.sourceAmount : undefined
        };
    }

    return null;
}

/**
 * Builds the markers of one asset.
 * The marker is placed at the transaction date and at the price of that date (the nearest earlier price when there is none for the day).
 * If there is no price on or before that date, the price implied by a transfer to / from an account in the default currency is used;
 * otherwise (no price at all) the transaction gets no marker.
 * @param prices price points (default currency per gram / coin), any order
 */
export function buildAssetChartMarkers(params: {
    assetCode: string;
    defaultCurrency: string;
    metalUnit?: string;
    accounts: Readonly<Record<string, AssetChartAccount>>;
    transactions: readonly AssetChartTransaction[];
    prices: readonly AssetChartPricePoint[];
}): AssetChartMarker[] {
    const { assetCode, defaultCurrency, metalUnit, accounts, transactions } = params;
    const prices = sortPricePoints(params.prices);
    const markers: AssetChartMarker[] = [];

    if (!prices.length) {
        return markers;
    }

    const displayUnitGrams = getDisplayUnitGrams(assetCode, metalUnit);

    for (const tx of transactions) {
        const candidate = classifyTransaction(tx, assetCode, defaultCurrency, accounts);

        if (!candidate || !(candidate.storedAmount > 0)) {
            continue;
        }

        const date = getTransactionDateString(tx.time, tx.utcOffset);
        const baseQuantity = getBaseQuantity(candidate.storedAmount, assetCode);
        const index = findNearestEarlierPriceIndex(prices, date);
        let basePrice: number;
        let priceFromSeries = true;
        let value: number;

        if (candidate.counterpartDefaultCurrencyAmount !== undefined && candidate.counterpartDefaultCurrencyAmount > 0) {
            value = candidate.counterpartDefaultCurrencyAmount / (10 ** DEFAULT_CURRENCY_SCALE);
        } else {
            value = NaN;
        }

        if (index >= 0) {
            basePrice = prices[index]!.price;
        } else if (Number.isFinite(value)) {
            basePrice = value / baseQuantity;
            priceFromSeries = false;
        } else {
            continue; // no price before the transaction and nothing to derive one from
        }

        if (!Number.isFinite(value)) {
            value = baseQuantity * basePrice;
        }

        markers.push({
            id: tx.id,
            side: candidate.side,
            date,
            price: basePrice * displayUnitGrams,
            priceFromSeries,
            quantity: baseQuantity / displayUnitGrams,
            storedAmount: candidate.storedAmount,
            value,
            accountName: accounts[candidate.accountId]?.name ?? ''
        });
    }

    return markers.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/**
 * The first date of the "All" range: the first price or the first marker, whichever is earlier
 */
export function getFirstChartDate(prices: readonly AssetChartPricePoint[], markers: readonly AssetChartMarker[]): string | undefined {
    let first: string | undefined;

    for (const p of prices) {
        if (!first || p.date < first) {
            first = p.date;
        }
    }

    for (const m of markers) {
        if (!first || m.date < first) {
            first = m.date;
        }
    }

    return first;
}

/**
 * The first date (inclusive) of a range ending today, undefined = from the beginning
 */
export function getRangeStartDate(range: AssetChartRange, today: string): string | undefined {
    if (range === 'ALL') {
        return undefined;
    }

    return addDaysToDateString(today, -RANGE_DAYS[range]);
}

export function filterByRange<T extends { date: string }>(items: readonly T[], range: AssetChartRange, today: string): T[] {
    const start = getRangeStartDate(range, today);
    return start ? items.filter(item => item.date >= start) : items.slice();
}

/**
 * Groups markers by the visible price point (the nearest earlier one, the first one when there is none) their tooltip is shown at
 */
export function groupMarkersByPoint(markers: readonly AssetChartMarker[], visiblePoints: readonly AssetChartPricePoint[]): Record<string, AssetChartMarker[]> {
    const result: Record<string, AssetChartMarker[]> = {};

    if (!visiblePoints.length) {
        return result;
    }

    for (const marker of markers) {
        const index = Math.max(findNearestEarlierPriceIndex(visiblePoints, marker.date), 0);
        (result[visiblePoints[index]!.date] ??= []).push(marker);
    }

    return result;
}

/**
 * Number of decimals for displaying a price: 2 from 100, 4 from 1, more for small prices
 */
export function getPriceDecimals(price: number): number {
    const abs = Math.abs(price);

    if (abs >= 100) {
        return 2;
    } else if (abs >= 1) {
        return 4;
    } else if (abs >= 0.01) {
        return 6;
    }

    return 8;
}
