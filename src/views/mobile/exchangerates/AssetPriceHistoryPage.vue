<template>
    <f7-page ptr @ptr:refresh="reload">
        <f7-navbar>
            <f7-nav-left :class="{ 'disabled': submitting }" :back-link="tt('Back')"></f7-nav-left>
            <f7-nav-title :title="`${assetName} (${assetCode})`"></f7-nav-title>
            <f7-nav-right>
                <f7-link icon-f7="chart_bar_alt_fill" :class="{ 'disabled': submitting }"
                         :aria-label="tt('Price Chart')"
                         @click="f7router.navigate(`/exchange_rates/assets/chart?asset=${encodeURIComponent(assetCode)}`)"></f7-link>
                <f7-link icon-f7="checkmark_alt" :class="{ 'disabled': submitting || loading }"
                         :aria-label="tt('Save')"
                         @click="save"></f7-link>
            </f7-nav-right>
        </f7-navbar>

        <f7-list form strong inset dividers class="margin-vertical-half">
            <f7-list-input
                type="date"
                :label="tt('Date')"
                :disabled="submitting"
                v-model:value="editDate"
            ></f7-list-input>
            <list-number-input
                :disabled="submitting"
                :label="`${tt('Price')} (${defaultCurrency} / ${unitName})`"
                :placeholder="`${defaultCurrency} / ${unitName}`"
                :min-value="0"
                :max-value="ASSET_PRICE_MAX_VALUE"
                :max-decimal-count="8"
                v-model="editPrice"
            ></list-number-input>
        </f7-list>
        <f7-block class="margin-vertical-half text-color-gray">
            {{ tt('A manual price replaces the automatic price of the same date.') }}
        </f7-block>

        <f7-block-title>{{ tt('Price History') }}</f7-block-title>
        <f7-list strong inset dividers class="margin-vertical-half" v-if="!history.length">
            <f7-list-item :title="tt('No data')"></f7-list-item>
        </f7-list>
        <f7-list strong inset dividers swipeout class="margin-vertical-half" v-else>
            <f7-list-item swipeout
                          :key="item.date"
                          :id="getDomId(item)"
                          :title="item.date"
                          :after="`${formatPrice(item.price)} ${defaultCurrency}`"
                          :footer="getSourceDisplayName(item.source, item.sourceName)"
                          @click="edit(item)"
                          v-for="item in history">
                <f7-swipeout-actions :left="textDirection === TextDirection.RTL"
                                     :right="textDirection === TextDirection.LTR">
                    <f7-swipeout-button color="red" class="padding-horizontal" :aria-label="tt('Delete')" @click="remove(item)">
                        <f7-icon f7="trash"></f7-icon>
                    </f7-swipeout-button>
                </f7-swipeout-actions>
            </f7-list-item>
        </f7-list>
    </f7-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Router } from 'framework7/types';

import { useI18n } from '@/locales/helpers.ts';
import { useI18nUIComponents, showLoading, hideLoading } from '@/lib/ui/mobile.ts';

import { TextDirection } from '@/core/text.ts';
import { ALL_ASSETS } from '@/consts/currency.ts';
import { getLocalDateString } from '@/lib/asset_price.ts';
import { useAssetPricesPageBase, type AssetPriceHistoryItem } from '@/views/base/exchangerates/AssetPricesPageBase.ts';

const ASSET_PRICE_MAX_VALUE = 999999999;

const props = defineProps<{
    f7route: Router.Route;
    f7router: Router.Router;
}>();

const { tt, getCurrencyName, getCurrentLanguageTextDirection } = useI18n();
const { showToast, showConfirm } = useI18nUIComponents();

const {
    loading,
    defaultCurrency,
    history,
    loadHistory,
    validate,
    savePrice,
    removePrice,
    getSourceDisplayName,
    formatPrice
} = useAssetPricesPageBase();

const assetCode = ref<string>(props.f7route.query['asset'] || '');
const assetInfo = ALL_ASSETS.find(asset => asset.code === assetCode.value);
const assetName = computed<string>(() => getCurrencyName(assetCode.value));
const unitName = assetInfo && assetInfo.kind === 'metal' ? 'g' : assetCode.value;
const textDirection = computed<TextDirection>(() => getCurrentLanguageTextDirection());

const submitting = ref<boolean>(false);
const editDate = ref<string>(getLocalDateString());
const editPrice = ref<number>(0);

function getDomId(item: AssetPriceHistoryItem): string {
    return `asset_price_${item.date}`;
}

function reload(done?: () => void): void {
    loadHistory(assetCode.value).then(() => done?.());
}

function edit(item: AssetPriceHistoryItem): void {
    editDate.value = item.date;
    editPrice.value = item.price;
}

function save(): void {
    const message = validate(editDate.value, editPrice.value);

    if (message) {
        showToast(message);
        return;
    }

    submitting.value = true;
    showLoading(() => submitting.value);

    savePrice(assetCode.value, editDate.value, editPrice.value).then(() => {
        submitting.value = false;
        hideLoading();
        reload();
    }).catch(error => {
        submitting.value = false;
        hideLoading();

        if (!error.processed) {
            showToast(error.message || error);
        }
    });
}

function remove(item: AssetPriceHistoryItem): void {
    showConfirm('Are you sure you want to delete this price?', () => {
        submitting.value = true;
        showLoading(() => submitting.value);

        removePrice(assetCode.value, item.date).then(() => {
            submitting.value = false;
            hideLoading();
            reload();
        }).catch(error => {
            submitting.value = false;
            hideLoading();

            if (!error.processed) {
                showToast(error.message || error);
            }
        });
    });
}

reload();
</script>
