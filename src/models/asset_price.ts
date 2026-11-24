export interface AssetPriceInfo {
    readonly asset: string;
    readonly date: string; // YYYY-MM-DD
    readonly price: string; // decimal string, default currency per gram (metals) or per coin (crypto)
    readonly source: 'auto' | 'manual';
    readonly sourceName: string; // nbp | coingecko | manual
    readonly updateTime: number;
}

export interface AssetPriceSeriesItem {
    readonly date: string;
    readonly price: string;
    readonly source: 'auto' | 'manual';
    readonly sourceName: string;
}

export interface AssetPriceSeriesRequest {
    readonly asset: string;
    readonly startDate?: string;
    readonly endDate?: string;
}

export interface AssetPriceSaveRequest {
    readonly asset: string;
    readonly date: string;
    readonly price: string;
}

export interface AssetPriceDeleteRequest {
    readonly asset: string;
    readonly date: string;
}

export interface AssetPriceAutoUpdateResponse {
    readonly enabled: boolean;
    readonly updatedAssets: string[];
    readonly savedCount: number;
}
