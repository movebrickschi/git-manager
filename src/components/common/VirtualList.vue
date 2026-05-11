<script setup lang="ts" generic="T">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useVirtualScroll } from "@/composables/useVirtualScroll";

const props = defineProps<{
  /** 完整列表数据；组件内部仅切片显示，不修改 */
  items: readonly T[];
  /** 单条目固定高度（px），等高虚拟滚动的核心约束 */
  itemHeight: number;
  /** 上下额外预渲染条数，默认 10 */
  overscan?: number;
  /** 自定义 key 生成；默认用 index，但建议传入稳定 id */
  getKey?: (item: T, index: number) => string | number;
  /**
   * 距离底部 < threshold(px) 时触发 reach-end，常用于无限滚动加载更多。
   * 默认 100；设 -1 关闭。
   */
  reachEndThreshold?: number;
}>();

const emit = defineEmits<{
  /** 滚动接近底部时触发，可用于触发 loadMore */
  "reach-end": [];
}>();

defineSlots<{
  /** 默认插槽，传入单条 item 与索引 */
  default: (props: { item: T; index: number }) => unknown;
}>();

const viewportRef = ref<HTMLElement>();
const scrollTop = ref(0);
const viewportHeight = ref(0);

const itemsRef = computed(() => props.items);
const totalItems = computed(() => itemsRef.value.length);

const { visibleStart, visibleEnd, offsetY, totalHeight } = useVirtualScroll({
  scrollTop,
  viewportHeight,
  totalItems,
  itemHeight: props.itemHeight,
  overscan: props.overscan ?? 10,
});

const visibleItems = computed(() =>
  itemsRef.value.slice(visibleStart.value, visibleEnd.value),
);

function resolveKey(item: T, index: number): string | number {
  return props.getKey ? props.getKey(item, index) : index;
}

let resizeObserver: ResizeObserver | null = null;

function onScroll(e: Event): void {
  const el = e.target as HTMLElement;
  scrollTop.value = el.scrollTop;

  const threshold = props.reachEndThreshold ?? 100;
  if (threshold >= 0) {
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distance < threshold) emit("reach-end");
  }
}

onMounted(() => {
  if (!viewportRef.value) return;
  viewportHeight.value = viewportRef.value.clientHeight;
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      viewportHeight.value = entry.contentRect.height;
    }
  });
  resizeObserver.observe(viewportRef.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

defineExpose({
  /** 滚动到指定索引；调用方控制是否平滑滚动 */
  scrollToIndex(index: number, behavior: ScrollBehavior = "auto"): void {
    if (!viewportRef.value) return;
    viewportRef.value.scrollTo({ top: index * props.itemHeight, behavior });
  },
});
</script>

<template>
  <div ref="viewportRef" class="vlist-viewport" @scroll="onScroll">
    <div class="vlist-spacer" :style="{ height: totalHeight + 'px' }">
      <div
        class="vlist-items"
        :style="{ transform: `translateY(${offsetY}px)` }"
      >
        <template
          v-for="(item, i) in visibleItems"
          :key="resolveKey(item, visibleStart + i)"
        >
          <slot :item="item" :index="visibleStart + i" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist-viewport {
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}
.vlist-spacer {
  position: relative;
}
.vlist-items {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}
</style>
