<template>
    <v-chart autoresize class="asset-price-chart" :style="{ height: `${height}px` }"
             :option="chartOptions" :update-options="{ notMerge: true }" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CallbackDataParams } from 'echarts/types/dist/shared';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import VChart from 'vue-echarts';

import { useI18n } from '@/locales/helpers.ts';

import { parseDateTimeFromUnixTimeWithTimezoneOffset } from '@/lib/datetime.ts';
import { parseBigDecimal } from '@/lib/numeral.ts';
import { getPriceDecimals, type AssetChartMarker, type AssetChartPricePoint } from '@/lib/asset_chart.ts';

echarts.use([CanvasRenderer, LineChart, ScatterChart, GridComponent, TooltipComponent]);

const BUY_COLOR = '#2e9e6a';
const SELL_COLOR = '#d9534f';

const props = defineProps<{
    assetCode: string;
    unitName: string;
    currency: string; // the default currency
    points: AssetChartPricePoint[]; // price per display unit
    markers: AssetChartMarker[];
    markersByPointDate: Record<string, AssetChartMarker[]>;
    dark: boolean;
    height: number;
    lineColor?: string;
}>();

const {
    tt,
    formatDateTimeToLongDate,
    formatNumberToLocalizedNumerals,
    formatAmountToLocalizedNumeralsWithCurrency
} = useI18n();

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateToMs(date: string): number {
    return Date.parse(`${date}T00:00:00Z`);
}

function formatDate(date: string): string {
    // the date is a plain calendar date: use offset 0 so that it is never shifted
    return formatDateTimeToLongDate(parseDateTimeFromUnixTimeWithTimezoneOffset(dateToMs(date) / 1000 + 12 * 3600, 0));
}

function formatPrice(price: number): string {
    return `${formatNumberToLocalizedNumerals(price, getPriceDecimals(price))} ${props.currency}`;
}

function formatValue(value: number): string {
    return formatAmountToLocalizedNumeralsWithCurrency(parseBigDecimal(Math.round(value * 100)), props.currency);
}

function formatQuantity(marker: AssetChartMarker): string {
    return formatAmountToLocalizedNumeralsWithCurrency(parseBigDecimal(marker.storedAmount), props.assetCode);
}

const textColor = computed<string>(() => props.dark ? '#eee' : '#333');
const axisColor = computed<string>(() => props.dark ? '#888' : '#666');
const color = computed<string>(() => props.lineColor || '#c67e48');

function getMarkerData(side: 'buy' | 'sell'): object[] {
    return props.markers.filter(m => m.side === side).map(m => ({ value: [dateToMs(m.date), m.price], marker: m }));
}

const chartOptions = computed<Record<string, unknown>>(() => {
    const backgroundColor = props.dark ? '#333' : '#fff';

    return {
        animation: false,
        tooltip: {
            trigger: 'axis',
            confine: true,
            axisPointer: { type: 'line', snap: true },
            backgroundColor,
            borderColor: backgroundColor,
            textStyle: { color: textColor.value },
            formatter: (params: CallbackDataParams[]) => {
                const linePoint = params.find(p => p.seriesType === 'line');

                if (!linePoint) {
                    return '';
                }

                const value = linePoint.value as number[];
                const date = new Date(value[0]!).toISOString().substring(0, 10);
                let html = `<table class="chart-tooltip-table"><tbody><tr><td>${escapeHtml(formatDate(date))}</td>`
                    + `<td><span class="ms-5" style="float: inline-end">${escapeHtml(formatPrice(value[1]!))} / ${escapeHtml(props.unitName)}</span></td></tr>`;

                for (const marker of props.markersByPointDate[date] || []) {
                    const side = marker.side === 'buy' ? tt('Buy') : tt('Sell');
                    const markerColor = marker.side === 'buy' ? BUY_COLOR : SELL_COLOR;
                    html += `<tr><td colspan="2" style="border-top: ${markerColor} solid 1px; padding-top: 4px">`
                        + `<b style="color: ${markerColor}">${escapeHtml(side)}</b> ${escapeHtml(formatDate(marker.date))}</td></tr>`
                        + `<tr><td>${escapeHtml(tt('Amount'))}</td><td><span class="ms-5" style="float: inline-end">${escapeHtml(formatQuantity(marker))}</span></td></tr>`
                        + `<tr><td>${escapeHtml(tt('Value'))}</td><td><span class="ms-5" style="float: inline-end">${escapeHtml(formatValue(marker.value))}</span></td></tr>`
                        + `<tr><td>${escapeHtml(tt('Price'))}</td><td><span class="ms-5" style="float: inline-end">${escapeHtml(formatPrice(marker.price))}${marker.priceFromSeries ? '' : ' *'}</span></td></tr>`
                        + `<tr><td>${escapeHtml(tt('Account'))}</td><td><span class="ms-5" style="float: inline-end">${escapeHtml(marker.accountName)}</span></td></tr>`;
                }

                return html + '</tbody></table>';
            }
        },
        grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
        xAxis: {
            type: 'time',
            axisLabel: { color: axisColor.value, hideOverlap: true },
            axisLine: { lineStyle: { color: axisColor.value } }
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLabel: {
                color: axisColor.value,
                formatter: (value: number) => formatNumberToLocalizedNumerals(value, getPriceDecimals(value) > 2 ? getPriceDecimals(value) : 0)
            },
            splitLine: { lineStyle: { color: props.dark ? '#444' : '#e5e5e5' } }
        },
        series: [
            {
                name: tt('Price'),
                type: 'line',
                showSymbol: props.points.length <= 1,
                symbolSize: 6,
                data: props.points.map(p => [dateToMs(p.date), p.price]),
                itemStyle: { color: color.value },
                lineStyle: { color: color.value, width: 2 }
            },
            {
                name: tt('Buy'),
                type: 'scatter',
                symbol: 'triangle',
                symbolSize: 14,
                z: 10,
                data: getMarkerData('buy'),
                itemStyle: { color: BUY_COLOR, borderColor: backgroundColor, borderWidth: 1 }
            },
            {
                name: tt('Sell'),
                type: 'scatter',
                symbol: 'triangle',
                symbolRotate: 180,
                symbolSize: 14,
                z: 10,
                data: getMarkerData('sell'),
                itemStyle: { color: SELL_COLOR, borderColor: backgroundColor, borderWidth: 1 }
            }
        ]
    };
});
</script>

<style>
.asset-price-chart {
    width: 100%;
}
</style>
