<template>
    <v-dialog width="800" :persistent="!!savingCode" v-model="showState">
        <one-column-dialog-layout :disabled="!!savingCode"
                                  :title="tt('Asset Prices')" :cancel-button-title="tt('Close')"
                                  @cancel="close">
            <template #content>
                <div class="text-body-medium text-medium-emphasis mb-3">
                    {{ tt('format.misc.assetPricesHint', { currency: defaultCurrency }) }}
                </div>
                <v-table density="compact">
                    <thead>
                    <tr>
                        <th>{{ tt('Asset') }}</th>
                        <th style="width: 220px">{{ tt('Price') }}</th>
                        <th style="width: 120px"></th>
                    </tr>
                    </thead>
                    <tbody>
                    <tr :key="item.code" v-for="item in assetPrices">
                        <td>
                            <div>{{ item.name }} <span class="text-body-small">{{ item.code }}</span></div>
                            <div class="text-body-small text-medium-emphasis">{{ item.groupName }}</div>
                        </td>
                        <td>
                            <number-input density="compact" class="mt-2"
                                          :disabled="!!savingCode || loading"
                                          :placeholder="`${defaultCurrency} / ${item.unitName}`"
                                          :persistent-placeholder="true"
                                          :min-value="0"
                                          :max-value="ASSET_PRICE_MAX_VALUE"
                                          :max-decimal-count="4"
                                          v-model="item.price"
                                          @keyup.enter="save(item)" />
                            <div class="text-body-small text-medium-emphasis" style="margin-top: -16px" v-if="item.kind === 'metal' && item.price > 0">
                                {{ formatOuncePrice(item.price) }} {{ defaultCurrency }} / oz
                            </div>
                        </td>
                        <td>
                            <v-btn density="comfortable" variant="text" color="primary"
                                   :loading="savingCode === item.code" :disabled="!!savingCode || loading"
                                   @click="save(item)">{{ tt('Save') }}</v-btn>
                        </td>
                    </tr>
                    </tbody>
                </v-table>
            </template>
        </one-column-dialog-layout>
    </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useDesktopPageStore } from '@/stores/desktopPage.ts';

import { GRAMS_PER_TROY_OUNCE } from '@/consts/currency.ts';
import { useAssetPricesPageBase, type AssetPriceItem } from '@/views/base/exchangerates/AssetPricesPageBase.ts';

const ASSET_PRICE_MAX_VALUE = 999999999;

const { tt } = useI18n();
const desktopPageStore = useDesktopPageStore();

const {
    loading,
    defaultCurrency,
    assetPrices,
    reload,
    loadAssetPrices,
    savePrice
} = useAssetPricesPageBase();

const showState = ref<boolean>(false);
const savingCode = ref<string>('');

function formatOuncePrice(pricePerGram: number): string {
    return (Math.round(pricePerGram * GRAMS_PER_TROY_OUNCE * 100) / 100).toFixed(2);
}

function open(): void {
    loadAssetPrices();
    showState.value = true;
    reload();
}

function save(item: AssetPriceItem): void {
    if (savingCode.value) {
        return;
    }

    savingCode.value = item.code;

    savePrice(item).then(() => {
        savingCode.value = '';
        loadAssetPrices();
    }).catch(error => {
        savingCode.value = '';

        if (!error.processed) {
            desktopPageStore.addErrorToast(error);
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
