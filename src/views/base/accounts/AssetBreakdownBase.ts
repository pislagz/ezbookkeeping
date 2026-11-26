import { useI18n } from '@/locales/helpers.ts';

import type { BigDecimal, HiddenAmount, BigDecimalWithSuffix } from '@/core/numeral.ts';

import { isObject } from '@/lib/common.ts';
import { getCurrentUnixTime, parseDateTimeFromUnixTime } from '@/lib/datetime.ts';
import { isAssetBreakdownDate } from '@/lib/asset_totals.ts';

export interface AssetBreakdown {
    readonly title: string;
    readonly lines: string[];
}

// Builds the text of the popover which explains a total that includes assets (precious metals / crypto)
export function useAssetBreakdownBase() {
    const { tt, getCurrencyName, formatAmountToLocalizedNumeralsWithCurrency, formatDateTimeToLongDate, formatGregorianTextualYearMonthDayToLongDate } = useI18n();

    function getAssetBreakdown(total: BigDecimal | HiddenAmount | BigDecimalWithSuffix | undefined, defaultCurrency: string): AssetBreakdown | null {
        if (!isObject(total) || !('assetItems' in total) || !total.assetItems || !total.assetItems.length) {
            return null;
        }

        const lines: string[] = [];

        for (const item of total.assetItems) {
            const name = getCurrencyName(item.currency);
            const amount = formatAmountToLocalizedNumeralsWithCurrency(item.amount, item.currency);

            if (!item.value) {
                lines.push(tt('format.misc.assetBreakdownNoPrice', { name, amount }));
                continue;
            }

            const value = formatAmountToLocalizedNumeralsWithCurrency(item.value, defaultCurrency);

            if (item.priceDate && isAssetBreakdownDate(item.priceDate)) {
                lines.push(tt('format.misc.assetBreakdownLine', { name, amount, value, date: formatGregorianTextualYearMonthDayToLongDate(item.priceDate) }));
            } else {
                lines.push(tt('format.misc.assetBreakdownLineNoDate', { name, amount, value }));
            }
        }

        return {
            title: tt('format.misc.assetBreakdownTitle', { date: formatDateTimeToLongDate(parseDateTimeFromUnixTime(getCurrentUnixTime())) }),
            lines
        };
    }

    return {
        getAssetBreakdown
    };
}
