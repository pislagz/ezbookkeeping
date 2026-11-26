<template>
    <span v-if="!breakdown">{{ text }}</span>
    <v-menu location="bottom start" open-on-hover open-on-click :open-delay="100" :close-delay="150" v-else>
        <template #activator="{ props }">
            <span class="asset-breakdown-text" tabindex="0" v-bind="props">{{ text }}</span>
        </template>
        <v-card class="asset-breakdown-popover pa-3" max-width="420">
            <div class="text-body-medium font-weight-medium mb-1">{{ breakdown.title }}</div>
            <div class="text-body-medium" :key="index" v-for="(line, index) in breakdown.lines">{{ line }}</div>
        </v-card>
    </v-menu>
</template>

<script setup lang="ts">
import type { AssetBreakdown } from '@/views/base/accounts/AssetBreakdownBase.ts';

defineProps<{
    text: string;
    breakdown: AssetBreakdown | null;
}>();
</script>

<style>
.asset-breakdown-text {
    cursor: help;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
}
</style>
