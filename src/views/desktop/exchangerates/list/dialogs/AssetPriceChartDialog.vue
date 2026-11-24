<template>
    <v-dialog width="1000" v-model="showState">
        <one-column-dialog-layout :title="tt('Price Charts')" :cancel-button-title="tt('Close')" @cancel="close">
            <template #content>
                <div class="text-body-medium text-medium-emphasis" v-if="!loadingAssets && !assets.length">
                    {{ tt('No assets with accounts or prices yet.') }}
                </div>
                <template v-else>
                    <div class="d-flex flex-wrap align-center ga-3 mb-3">
                        <v-select style="max-width: 300px" density="compact" hide-details item-title="title" item-value="code"
                                  :label="tt('Asset')" :disabled="loadingAssets || loading"
                                  :items="assetItems" :model-value="selectedAsset"
                                  @update:model-value="selectAsset" />
                        <v-btn-toggle density="compact" color="primary" variant="outlined" divided mandatory v-model="range">
                            <v-btn :key="item" :value="item" v-for="item in allRanges">{{ getRangeName(item) }}</v-btn>
                        </v-btn-toggle>
                        <span class="text-body-small text-medium-emphasis">{{ defaultCurrency }} / {{ unitName }}</span>
                    </div>

                    <v-alert type="error" variant="tonal" class="mb-3" v-if="loadFailed">{{ tt('Unable to load the price chart') }}</v-alert>
                    <v-alert type="info" variant="tonal" class="mb-3" v-else-if="!loading && selectedAsset && !hasPrices">
                        {{ tt('No prices yet for this asset.') }}
                        <div class="mt-1" v-if="!autoUpdateEnabled">{{ tt('Auto-update of asset prices is turned off.') }}</div>
                    </v-alert>
                    <v-alert type="info" variant="tonal" class="mb-3" v-else-if="!loading && selectedAsset && hasPrices && !hasDatedTransactions">
                        {{ tt('No dated transactions for this asset.') }}
                    </v-alert>

                    <v-progress-linear indeterminate v-if="loading" />
                    <asset-price-chart :asset-code="selectedAsset" :unit-name="unitName" :currency="defaultCurrency"
                                       :points="model.points" :markers="model.markers"
                                       :markers-by-point-date="model.markersByPointDate"
                                       :dark="isDarkMode" :height="420"
                                       v-if="!loading && selectedAsset && hasPrices" />
                    <div class="text-body-small text-medium-emphasis mt-2" v-if="hasPrices">{{ tt('Price chart markers hint') }}</div>
                </template>
            </template>
        </one-column-dialog-layout>
    </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTheme } from 'vuetify';

import AssetPriceChart from '@/components/common/AssetPriceChart.vue';

import { useI18n } from '@/locales/helpers.ts';
import { ThemeType } from '@/core/theme.ts';
import { useAssetChartPageBase } from '@/views/base/exchangerates/AssetChartPageBase.ts';

const { tt } = useI18n();
const theme = useTheme();

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

const showState = ref<boolean>(false);
const isDarkMode = computed<boolean>(() => theme.global.name.value === ThemeType.Dark);
const assetItems = computed(() => assets.value.map(asset => ({ code: asset.code, title: `${asset.name} (${asset.code})` })));

function selectAsset(code: string): void {
    loadAsset(code);
}

function open(asset?: string): void {
    showState.value = true;

    loadAssets().then(() => {
        const code = asset && assets.value.some(item => item.code === asset) ? asset : assets.value.find(item => item.hasAccount)?.code || assets.value[0]?.code;

        if (code) {
            loadAsset(code);
        }
    });
}

function close(): void {
    showState.value = false;
}

defineExpose({
    open
});
</script>
