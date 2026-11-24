<template>
    <v-dialog width="900" :persistent="saving" v-model="showState">
        <one-column-dialog-layout :disabled="saving"
                                  :title="selectedAsset ? `${selectedAsset.name} (${selectedAsset.code})` : tt('Asset Prices')"
                                  :cancel-button-title="tt('Close')"
                                  @cancel="close">
            <template #content>
                <template v-if="!selectedAsset">
                    <div class="text-body-medium text-medium-emphasis mb-3">
                        {{ tt('format.misc.assetPricesHint', { currency: defaultCurrency }) }}
                    </div>
                    <v-alert type="info" variant="tonal" class="mb-3" v-if="offlineMode">{{ tt('Offline mode is on: prices are not fetched from the internet. Enter them manually.') }}</v-alert>
                    <div class="mb-3" v-else>
                        <v-btn color="default" variant="outlined" :loading="fetching" :disabled="loading || fetching"
                               @click="fetchNow">{{ tt('Fetch Prices Now') }}</v-btn>
                    </div>
                    <v-table density="compact">
                        <thead>
                        <tr>
                            <th>{{ tt('Asset') }}</th>
                            <th class="text-right">{{ tt('Price') }}</th>
                            <th>{{ tt('Date') }}</th>
                            <th>{{ tt('Source') }}</th>
                            <th style="width: 220px"></th>
                        </tr>
                        </thead>
                        <tbody>
                        <tr :key="item.code" v-for="item in assetPrices">
                            <td>
                                <div>{{ item.name }} <span class="text-body-small">{{ item.code }}</span></div>
                                <div class="text-body-small text-medium-emphasis">{{ item.groupName }}</div>
                            </td>
                            <td class="text-right">
                                <div>{{ formatPrice(item.price) }} <span class="text-body-small text-medium-emphasis">{{ defaultCurrency }} / {{ item.unitName }}</span></div>
                                <div class="text-body-small text-medium-emphasis" v-if="item.kind === 'metal' && item.price">
                                    {{ formatOuncePrice(item.price) }} {{ defaultCurrency }} / oz
                                </div>
                            </td>
                            <td>{{ item.date || '' }}</td>
                            <td>{{ getSourceDisplayName(item.source, item.sourceName) }}</td>
                            <td>
                                <v-btn density="comfortable" variant="text" color="primary"
                                       :disabled="loading" @click="selectAsset(item)">{{ tt('History') }}</v-btn>
                                <v-btn density="comfortable" variant="text" color="primary"
                                       :disabled="loading" @click="openChart(item)">{{ tt('Price Chart') }}</v-btn>
                            </td>
                        </tr>
                        </tbody>
                    </v-table>
                </template>
                <template v-else>
                    <div class="mb-3">
                        <v-btn variant="text" color="default" :disabled="saving" @click="backToList">{{ tt('Back') }}</v-btn>
                    </div>
                    <v-form class="d-flex flex-wrap align-center ga-3 mb-3" @submit.prevent="save">
                        <v-text-field type="date" style="max-width: 200px" density="compact" hide-details
                                      :label="tt('Date')" :disabled="saving" v-model="editDate"/>
                        <number-input density="compact" hide-details style="max-width: 260px"
                                      :disabled="saving"
                                      :placeholder="`${defaultCurrency} / ${selectedAsset.unitName}`"
                                      :persistent-placeholder="true"
                                      :min-value="0"
                                      :max-value="ASSET_PRICE_MAX_VALUE"
                                      :max-decimal-count="8"
                                      v-model="editPrice"
                                      @keyup.enter="save" />
                        <v-btn color="primary" :loading="saving" :disabled="saving" @click="save">{{ tt('Save') }}</v-btn>
                    </v-form>
                    <div class="text-body-small text-medium-emphasis mb-3">{{ tt('A manual price replaces the automatic price of the same date.') }}</div>
                    <v-table density="compact" fixed-header height="360">
                        <thead>
                        <tr>
                            <th>{{ tt('Date') }}</th>
                            <th class="text-right">{{ tt('Price') }}</th>
                            <th>{{ tt('Source') }}</th>
                            <th style="width: 160px"></th>
                        </tr>
                        </thead>
                        <tbody>
                        <tr :key="item.date" v-for="item in history">
                            <td>{{ item.date }}</td>
                            <td class="text-right">{{ formatPrice(item.price) }} {{ defaultCurrency }}</td>
                            <td>{{ getSourceDisplayName(item.source, item.sourceName) }}</td>
                            <td>
                                <v-btn density="comfortable" variant="text" color="primary" :disabled="saving"
                                       @click="edit(item)">{{ tt('Edit') }}</v-btn>
                                <v-btn density="comfortable" variant="text" color="error" :disabled="saving"
                                       @click="remove(item)">{{ tt('Delete') }}</v-btn>
                            </td>
                        </tr>
                        <tr v-if="!history.length">
                            <td colspan="4" class="text-center text-medium-emphasis">{{ tt('No data') }}</td>
                        </tr>
                        </tbody>
                    </v-table>
                </template>
            </template>
        </one-column-dialog-layout>
        <confirm-dialog ref="confirmDialog"/>
    </v-dialog>
</template>

<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';

import ConfirmDialog from '@/components/desktop/ConfirmDialog.vue';

import { useI18n } from '@/locales/helpers.ts';

import { useDesktopPageStore } from '@/stores/desktopPage.ts';

import { getLocalDateString } from '@/lib/asset_price.ts';
import { useAssetPricesPageBase, type AssetPriceItem, type AssetPriceHistoryItem } from '@/views/base/exchangerates/AssetPricesPageBase.ts';

type ConfirmDialogType = InstanceType<typeof ConfirmDialog>;

const ASSET_PRICE_MAX_VALUE = 999999999;

const emit = defineEmits<{
    (e: 'chart', asset: string): void;
}>();

const { tt } = useI18n();
const desktopPageStore = useDesktopPageStore();

const {
    loading,
    defaultCurrency,
    assetPrices,
    history,
    loadAssetPrices,
    loadHistory,
    validate,
    savePrice,
    removePrice,
    offlineMode,
    fetchNow: fetchPricesNow,
    getSourceDisplayName,
    formatPrice,
    formatOuncePrice
} = useAssetPricesPageBase();

const confirmDialog = useTemplateRef<ConfirmDialogType>('confirmDialog');

const showState = ref<boolean>(false);
const saving = ref<boolean>(false);
const fetching = ref<boolean>(false);
const selectedAsset = ref<AssetPriceItem | null>(null);
const editDate = ref<string>(getLocalDateString());
const editPrice = ref<number>(0);

function open(): void {
    selectedAsset.value = null;
    showState.value = true;
    loadAssetPrices();
}

function handleError(error: { processed?: boolean, message?: string }): void {
    if (!error.processed) {
        desktopPageStore.addErrorToast(error as { message: string });
    }
}

function selectAsset(item: AssetPriceItem): void {
    selectedAsset.value = item;
    editDate.value = getLocalDateString();
    editPrice.value = item.price || 0;
    history.value = [];
    loadHistory(item.code);
}

function backToList(): void {
    selectedAsset.value = null;
    loadAssetPrices();
}

function edit(item: AssetPriceHistoryItem): void {
    editDate.value = item.date;
    editPrice.value = item.price;
}

function save(): void {
    if (saving.value || !selectedAsset.value) {
        return;
    }

    const message = validate(editDate.value, editPrice.value);

    if (message) {
        desktopPageStore.addErrorToast(message);
        return;
    }

    saving.value = true;

    savePrice(selectedAsset.value.code, editDate.value, editPrice.value).then(() => {
        saving.value = false;
        return loadHistory(selectedAsset.value!.code);
    }).catch(error => {
        saving.value = false;
        handleError(error);
    });
}

function remove(item: AssetPriceHistoryItem): void {
    if (saving.value || !selectedAsset.value) {
        return;
    }

    confirmDialog.value?.open('Are you sure you want to delete this price?').then(() => {
        saving.value = true;

        removePrice(selectedAsset.value!.code, item.date).then(() => {
            saving.value = false;
            return loadHistory(selectedAsset.value!.code);
        }).catch(error => {
            saving.value = false;
            handleError(error);
        });
    });
}

function fetchNow(): void {
    fetching.value = true;

    fetchPricesNow().then(() => {
        fetching.value = false;
        loadAssetPrices();
    }).catch(error => {
        fetching.value = false;
        handleError(error);
    });
}

function openChart(item: AssetPriceItem): void {
    showState.value = false;
    emit('chart', item.code);
}

function close(): void {
    showState.value = false;
}

defineExpose({
    open
});
</script>
