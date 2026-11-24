// Helpers of the asset price history (see docs/ASSETS.md)

export const ASSET_PRICE_AUTO_UPDATE_INTERVAL_SECONDS = 3600;

// The server fetches public prices at most once per hour, the client does not even ask more often
export function shouldAutoUpdateAssetPrices(lastUpdateUnixTime: number | null | undefined, nowUnixTime: number): boolean {
    if (!lastUpdateUnixTime || lastUpdateUnixTime <= 0 || lastUpdateUnixTime > nowUnixTime) {
        return true;
    }

    return nowUnixTime - lastUpdateUnixTime >= ASSET_PRICE_AUTO_UPDATE_INTERVAL_SECONDS;
}

// Decides whether the client asks the server to fetch asset prices. Never in offline mode, not even when forced.
export function shouldRequestAssetPriceUpdate(options: { offlineMode: boolean, enabledByUser: boolean, force: boolean, lastUpdateUnixTime: number | null | undefined, nowUnixTime: number }): boolean {
    if (options.offlineMode) {
        return false;
    }

    if (options.force) {
        return true;
    }

    return options.enabledByUser && shouldAutoUpdateAssetPrices(options.lastUpdateUnixTime, options.nowUnixTime);
}

export function isValidAssetPriceDate(date: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00Z`);
    return !isNaN(parsed.getTime()) && parsed.toISOString().substring(0, 10) === date;
}

// Returns the date of the local calendar day as YYYY-MM-DD (prices are dated by plain calendar dates)
export function getLocalDateString(now: Date = new Date()): string {
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

export function addDaysToDateString(date: string, days: number): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().substring(0, 10);
}

// Converts a price string from the server (maybe in the exponent format) to a number, NaN when invalid
export function parseAssetPriceString(price: string | null | undefined): number {
    if (!price) {
        return NaN;
    }

    return Number(price);
}

// Converts a number entered by the user to the decimal string sent to the server (never the exponent format, up to 10 decimals)
export function formatAssetPriceForRequest(price: number): string {
    if (!Number.isFinite(price) || price <= 0) {
        return '';
    }

    const text = price.toFixed(10);
    return text.replace(/0+$/, '').replace(/\.$/, '');
}

// Formats a price for display: 2 decimals for prices from 100, 4 from 1, up to 8 for small prices, without trailing zeros
export function formatAssetPriceForDisplay(price: number | null | undefined): string {
    if (price === null || price === undefined || !Number.isFinite(price)) {
        return '-';
    }

    const decimals = price >= 100 ? 2 : price >= 1 ? 4 : 8;
    return price.toFixed(decimals).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}
