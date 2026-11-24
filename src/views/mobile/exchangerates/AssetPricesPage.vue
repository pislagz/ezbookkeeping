<template>
    <f7-page ptr @ptr:refresh="reload" @page:afterin="reload()">
        <f7-navbar>
            <f7-nav-left :back-link="tt('Back')"></f7-nav-left>
            <f7-nav-title :title="tt('Asset Prices')"></f7-nav-title>
            <f7-nav-right>
                <f7-link icon-f7="chart_bar_alt_fill" :aria-label="tt('Price Charts')"
                         @click="openChart()"></f7-link>
                <f7-link icon-f7="arrow_clockwise" :class="{ 'disabled': fetching || loading }"
                         :aria-label="tt('Fetch Prices Now')"
                         @click="fetchNow"></f7-link>
            </f7-nav-right>
        </f7-navbar>

        <f7-block class="margin-vertical-half text-color-gray">
            {{ tt('format.misc.assetPricesHint', { currency: defaultCurrency }) }}
        </f7-block>

        <template :key="group.kind" v-for="group in groupedPrices">
            <f7-block-title>{{ group.name }}</f7-block-title>
            <f7-list strong inset dividers class="margin-vertical-half">
                <f7-list-item
                    link="#"
                    :key="item.code"
                    :title="`${item.name} (${item.code})`"
                    :footer="item.date ? `${item.date} · ${getSourceDisplayName(item.source, item.sourceName)}` : ''"
                    @click="openHistory(item)"
                    v-for="item in group.items"
                >
                    <template #after>
                        <div class="text-align-right">
                            <div>{{ formatPrice(item.price) }} {{ defaultCurrency }} / {{ item.unitName }}</div>
                            <div class="text-color-gray" style="font-size: var(--ebk-small-font-size, 12px)" v-if="item.kind === 'metal' && item.price">
                                {{ formatOuncePrice(item.price) }} {{ defaultCurrency }} / oz
                            </div>
                        </div>
                    </template>
                </f7-list-item>
            </f7-list>
        </template>
    </f7-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Router } from 'framework7/types';

import { useI18n } from '@/locales/helpers.ts';
import { useI18nUIComponents } from '@/lib/ui/mobile.ts';

import { useAssetPricesPageBase, type AssetPriceItem } from '@/views/base/exchangerates/AssetPricesPageBase.ts';

const props = defineProps<{
    f7router: Router.Router;
}>();

const { tt } = useI18n();
const { showToast } = useI18nUIComponents();

const {
    loading,
    defaultCurrency,
    assetPrices,
    loadAssetPrices,
    fetchNow: fetchPricesNow,
    getSourceDisplayName,
    formatPrice,
    formatOuncePrice
} = useAssetPricesPageBase();

const fetching = ref<boolean>(false);

const groupedPrices = computed<{ kind: string, name: string, items: AssetPriceItem[] }[]>(() => {
    return [
        { kind: 'metal', name: tt('Metals'), items: assetPrices.value.filter(item => item.kind === 'metal') },
        { kind: 'crypto', name: tt('Crypto'), items: assetPrices.value.filter(item => item.kind === 'crypto') }
    ];
});

function reload(done?: () => void): void {
    loadAssetPrices().then(() => done?.());
}

function openHistory(item: AssetPriceItem): void {
    props.f7router.navigate(`/exchange_rates/assets/history?asset=${encodeURIComponent(item.code)}`);
}

function openChart(code?: string): void {
    props.f7router.navigate(code ? `/exchange_rates/assets/chart?asset=${encodeURIComponent(code)}` : '/exchange_rates/assets/chart');
}

function fetchNow(): void {
    fetching.value = true;

    fetchPricesNow().then(() => {
        fetching.value = false;
        reload();
    }).catch(error => {
        fetching.value = false;

        if (!error.processed) {
            showToast(error.message || error);
        }
    });
}

</script>
