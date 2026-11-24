<template>
    <f7-page ptr @ptr:refresh="reloadPrices">
        <f7-navbar>
            <f7-nav-left :class="{ 'disabled': submitting }" :back-link="tt('Back')"></f7-nav-left>
            <f7-nav-title :title="tt('Asset Prices')"></f7-nav-title>
            <f7-nav-right>
                <f7-link icon-f7="checkmark_alt" :class="{ 'disabled': submitting || loading }"
                         :aria-label="tt('Save')"
                         @click="confirm"></f7-link>
            </f7-nav-right>
        </f7-navbar>

        <f7-block class="margin-vertical-half text-color-gray">
            {{ tt('format.misc.assetPricesHint', { currency: defaultCurrency }) }}
        </f7-block>

        <template :key="group.kind" v-for="group in groupedPrices">
            <f7-block-title>{{ group.name }}</f7-block-title>
            <f7-list form strong inset dividers class="margin-vertical-half">
                <template #list>
                    <list-number-input
                        :key="item.code"
                        :disabled="submitting"
                        :label="`${item.name} (${item.code}) - ${defaultCurrency} / ${item.unitName}`"
                        :placeholder="`${defaultCurrency} / ${item.unitName}`"
                        :min-value="0"
                        :max-value="ASSET_PRICE_MAX_VALUE"
                        :max-decimal-count="4"
                        v-model="item.price"
                        v-for="item in group.items"
                    ></list-number-input>
                </template>
            </f7-list>
        </template>
    </f7-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Router } from 'framework7/types';

import { useI18n } from '@/locales/helpers.ts';
import { useI18nUIComponents, showLoading, hideLoading } from '@/lib/ui/mobile.ts';

import { useAssetPricesPageBase, type AssetPriceItem } from '@/views/base/exchangerates/AssetPricesPageBase.ts';

const ASSET_PRICE_MAX_VALUE = 999999999;

const props = defineProps<{
    f7router: Router.Router;
}>();

const { tt } = useI18n();
const { showToast } = useI18nUIComponents();

const {
    loading,
    defaultCurrency,
    assetPrices,
    reload,
    loadAssetPrices,
    savePrice
} = useAssetPricesPageBase();

const submitting = ref<boolean>(false);
const originalPrices = ref<Record<string, number>>({});

const groupedPrices = computed<{ kind: string, name: string, items: AssetPriceItem[] }[]>(() => {
    return [
        { kind: 'metal', name: tt('Metals'), items: assetPrices.value.filter(item => item.kind === 'metal') },
        { kind: 'crypto', name: tt('Crypto'), items: assetPrices.value.filter(item => item.kind === 'crypto') }
    ];
});

function rememberOriginalPrices(): void {
    const prices: Record<string, number> = {};

    for (const item of assetPrices.value) {
        prices[item.code] = item.price;
    }

    originalPrices.value = prices;
}

function reloadPrices(done?: () => void): void {
    reload().then(() => {
        rememberOriginalPrices();
        done?.();
    });
}

function confirm(): void {
    const router = props.f7router;
    const changedItems = assetPrices.value.filter(item => (item.price || 0) !== (originalPrices.value[item.code] || 0));

    if (changedItems.length < 1) {
        router.back();
        return;
    }

    submitting.value = true;
    showLoading(() => submitting.value);

    // save prices one by one, the server keeps all asset prices of the user in one table
    changedItems.reduce((promise, item) => promise.then(() => savePrice(item)), Promise.resolve<unknown>(undefined)).then(() => {
        submitting.value = false;
        hideLoading();

        showToast('You have updated exchange rate');
        router.back();
    }).catch(error => {
        submitting.value = false;
        hideLoading();
        loadAssetPrices();
        rememberOriginalPrices();

        if (!error.processed) {
            showToast(error.message || error);
        }
    });
}

loadAssetPrices();
rememberOriginalPrices();
reloadPrices();
</script>
