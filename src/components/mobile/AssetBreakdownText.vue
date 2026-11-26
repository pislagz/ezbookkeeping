<template>
    <span v-if="!breakdown">{{ text }}</span>
    <template v-else>
        <f7-link class="asset-breakdown-link" :popover-open="'.' + popoverClass">{{ text }}</f7-link>
        <f7-popover :class="popoverClass">
            <div class="asset-breakdown-popover padding-half">
                <div class="asset-breakdown-popover-title">{{ breakdown.title }}</div>
                <div :key="index" v-for="(line, index) in breakdown.lines">{{ line }}</div>
            </div>
        </f7-popover>
    </template>
</template>

<script setup lang="ts">
import type { AssetBreakdown } from '@/views/base/accounts/AssetBreakdownBase.ts';

defineProps<{
    text: string;
    breakdown: AssetBreakdown | null;
    popoverClass: string; // unique class of the popover, one per displayed total
}>();
</script>

<style>
.asset-breakdown-link {
    color: inherit;
    font: inherit;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
}

.asset-breakdown-popover {
    font-size: 14px;
    line-height: 1.5;
    max-width: 320px;
}

.asset-breakdown-popover-title {
    font-weight: 600;
}
</style>
