<template>
    <f7-page ptr @ptr:refresh="reload">
        <f7-navbar>
            <f7-nav-left :back-link="tt('Back')"></f7-nav-left>
            <f7-nav-title :title="tt('Price Chart')"></f7-nav-title>
        </f7-navbar>

        <f7-block class="margin-vertical-half text-color-gray" v-if="!loadingAssets && !assets.length">
            {{ tt('No assets with accounts or prices yet.') }}
        </f7-block>

        <template v-else>
            <f7-list strong inset dividers class="margin-top-half margin-bottom-half">
                <f7-list-input type="select" :label="tt('Asset')" :disabled="loading"
                               :value="selectedAsset" @change="selectAsset($event.target.value)">
                    <option :key="item.code" :value="item.code" v-for="item in assets">{{ item.name }} ({{ item.code }})</option>
                </f7-list-input>
            </f7-list>

            <div class="padding-horizontal">
                <f7-segmented strong tag="div">
                    <f7-button :key="item" :active="range === item" @click="range = item" v-for="item in allRanges">{{ getRangeName(item) }}</f7-button>
                </f7-segmented>
            </div>

            <f7-block class="margin-vertical-half text-color-gray" style="font-size: var(--ebk-small-font-size, 12px)">
                {{ defaultCurrency }} / {{ unitName }}
            </f7-block>

            <f7-block class="margin-vertical-half text-color-red" v-if="loadFailed">{{ tt('Unable to load the price chart') }}</f7-block>
            <f7-block class="margin-vertical-half" v-else-if="!loading && selectedAsset && !hasPrices">
                <div>{{ tt('No prices yet for this asset.') }}</div>
                <div class="margin-top-half" v-if="!autoUpdateEnabled">{{ tt('Auto-update of asset prices is turned off.') }}</div>
            </f7-block>
            <f7-block class="margin-vertical-half text-color-gray" v-else-if="!loading && selectedAsset && hasPrices && !hasDatedTransactions">
                {{ tt('No dated transactions for this asset.') }}
            </f7-block>

            <div class="padding-horizontal" v-if="loading">
                <f7-progressbar infinite></f7-progressbar>
            </div>
            <div class="padding-horizontal" v-if="!loading && selectedAsset && hasPrices">
                <asset-price-chart :asset-code="selectedAsset" :unit-name="unitName" :currency="defaultCurrency"
                                   :points="model.points" :markers="model.markers"
                                   :markers-by-point-date="model.markersByPointDate"
                                   :dark="isDarkMode" :height="chartHeight" />
            </div>
            <f7-block class="margin-vertical-half text-color-gray" style="font-size: var(--ebk-small-font-size, 12px)" v-if="hasPrices">
                {{ tt('Price chart markers hint') }}
            </f7-block>
        </template>
    </f7-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Router } from 'framework7/types';

import AssetPriceChart from '@/components/common/AssetPriceChart.vue';

import { useI18n } from '@/locales/helpers.ts';
import { useAssetChartPageBase } from '@/views/base/exchangerates/AssetChartPageBase.ts';

const props = defineProps<{
    f7route: Router.Route;
    f7router: Router.Router;
}>();

const { tt } = useI18n();

const {
    loadingAssets,
    loading,
    loadFailed,
    assets,
    selectedAsset,
    range,
    defaultCurrency,
    unitName,
    autoUpdateEnabled,
    model,
    hasPrices,
    hasDatedTransactions,
    allRanges,
    loadAssets,
    loadAsset,
    getRangeName
} = useAssetChartPageBase();

// follows the app theme: Framework7 puts the "dark" class on the root element
const isDarkMode = computed<boolean>(() => document.documentElement.classList.contains('dark'));
// responsive: about 45% of the screen height, between 240 and 420 px
const chartHeight = computed<number>(() => Math.max(240, Math.min(420, Math.round(window.innerHeight * 0.45))));

function selectAsset(code: string): void {
    loadAsset(code);
}

function initialize(done?: () => void): void {
    const requested = props.f7route.query['asset'] as string | undefined;

    loadAssets().then(() => {
        const code = selectedAsset.value && assets.value.some(item => item.code === selectedAsset.value) ? selectedAsset.value
            : requested && assets.value.some(item => item.code === requested) ? requested
            : assets.value.find(item => item.hasAccount)?.code || assets.value[0]?.code;

        return code ? loadAsset(code) : undefined;
    }).finally(() => done?.());
}

function reload(done?: () => void): void {
    initialize(done);
}

initialize();
</script>
