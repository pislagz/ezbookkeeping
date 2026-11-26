import type { BigDecimal, AssetBreakdownItem } from '@/core/numeral.ts';
import { INCOMPLETE_AMOUNT_SUFFIX, ASSET_TOTAL_SUFFIX } from '@/consts/numeral.ts';

import { getCurrencyStorageScale, isAssetCurrency } from '@/lib/asset.ts';
import { parseBigDecimal } from '@/lib/numeral.ts';

/**
 * The latest known price of an asset: price is in the user's default currency per 1 g (metals) or per 1 coin (crypto)
 */
export interface AssetLatestPrice {
    readonly price: string;
    readonly date: string; // YYYY-MM-DD
}

/**
 * Values a stored asset amount with the latest price, the result uses the stored scale of the target currency
 * @returns null when the price is invalid
 */
export function convertAssetAmountByPrice(amount: BigDecimal, assetCode: string, price: string, toCurrency: string): BigDecimal | null {
    if (!isAssetCurrency(assetCode) || isAssetCurrency(toCurrency)) {
        return null;
    }

    try {
        const priceValue = parseBigDecimal(price);

        if (!(priceValue.compareTo(parseBigDecimal(0)) > 0)) {
            return null;
        }

        const scaleDiff = getCurrencyStorageScale(toCurrency) - getCurrencyStorageScale(assetCode);
        const factor = scaleDiff === 0 ? priceValue : priceValue.multiply(10 ** scaleDiff);
        return amount.multiply(factor);
    } catch {
        return null;
    }
}

/**
 * Collects the asset accounts which are part of a total, to explain it in a popover
 */
export class AssetBreakdownCollector {
    private readonly map: Map<string, { amount: BigDecimal, value: BigDecimal | null, latest?: AssetLatestPrice }> = new Map();

    /**
     * @param currency the currency of the account balance, anything except an asset is ignored
     * @param amount the signed stored amount as it is counted in the total
     * @param value the signed value in the default currency which is counted in the total, null if it could not be calculated
     */
    add(currency: string, amount: BigDecimal, value: BigDecimal | null, latest?: AssetLatestPrice): void {
        if (!isAssetCurrency(currency) || amount.isZero()) {
            return;
        }

        const current = this.map.get(currency);

        if (!current) {
            this.map.set(currency, { amount, value, latest });
            return;
        }

        this.map.set(currency, {
            amount: current.amount.add(amount),
            value: current.value && value ? current.value.add(value) : null,
            latest: current.latest ?? latest
        });
    }

    get hasAssets(): boolean {
        return this.map.size > 0;
    }

    get items(): AssetBreakdownItem[] {
        const ret: AssetBreakdownItem[] = [];

        this.map.forEach((entry, currency) => {
            ret.push({
                currency,
                amount: entry.amount,
                value: entry.value,
                price: entry.latest?.price,
                priceDate: entry.latest?.date
            });
        });

        return ret;
    }
}

/**
 * The suffix of a total: "+" when an ordinary currency could not be converted, "*" when the total includes assets (or lacks an asset price)
 */
export function getTotalAmountSuffix(hasUnCalculatedAmount: boolean, hasAssets: boolean): string {
    return (hasUnCalculatedAmount ? INCOMPLETE_AMOUNT_SUFFIX : '') + (hasAssets ? ASSET_TOTAL_SUFFIX : '');
}

/**
 * Whether the text is a plain calendar date (YYYY-MM-DD) of a price
 */
export function isAssetBreakdownDate(text: string): text is `${number}-${number}-${number}` {
    return /^\d{4}-\d{2}-\d{2}$/.test(text);
}
