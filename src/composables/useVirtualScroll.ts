import { computed, type ComputedRef, type Ref } from "vue";

export interface UseVirtualScrollOptions {
  /** 当前滚动位置（像素），通常由外部容器 scroll 事件写入 */
  scrollTop: Ref<number>;
  /** 视口高度（像素） */
  viewportHeight: Ref<number>;
  /** 列表总条目数 */
  totalItems: Ref<number>;
  /** 单条目高度（像素），目前仅支持等高列表；不等高可后续扩展 measured-height 表 */
  itemHeight: number;
  /** 上下额外渲染的条数，缓冲快速滚动；典型值 5~15 */
  overscan?: number;
}

export interface UseVirtualScrollReturn {
  /** 当前应渲染区间起点（含），可直接 slice */
  visibleStart: ComputedRef<number>;
  /** 当前应渲染区间终点（不含） */
  visibleEnd: ComputedRef<number>;
  /** 渲染层向下偏移量（像素），等于 visibleStart * itemHeight */
  offsetY: ComputedRef<number>;
  /** 撑开父容器的总高度（像素），保证滚动条比例正确 */
  totalHeight: ComputedRef<number>;
}

/**
 * 计算虚拟滚动可见区间。纯函数风格——所有输入用 Ref，所有输出用 computed，
 * 不接触 DOM，便于单元测试。
 *
 * 调用方负责：
 *  1. 监听容器 scroll 事件并把 scrollTop 同步到这里
 *  2. 监听容器 resize 把 viewportHeight 同步进来
 *  3. 根据 visibleStart/visibleEnd 切片 items 并把 offsetY 应用为 translateY
 */
export function useVirtualScroll(opts: UseVirtualScrollOptions): UseVirtualScrollReturn {
  const { scrollTop, viewportHeight, totalItems, itemHeight } = opts;
  const overscan = opts.overscan ?? 10;
  const safeHeight = itemHeight > 0 ? itemHeight : 1; // 防 itemHeight=0 除零

  const visibleStart = computed(() => {
    if (totalItems.value === 0) return 0;
    const raw = Math.floor(scrollTop.value / safeHeight) - overscan;
    return Math.max(0, raw);
  });

  const visibleEnd = computed(() => {
    if (totalItems.value === 0) return 0;
    const raw = Math.ceil((scrollTop.value + viewportHeight.value) / safeHeight) + overscan;
    return Math.min(totalItems.value, raw);
  });

  const offsetY = computed(() => visibleStart.value * safeHeight);

  const totalHeight = computed(() => totalItems.value * safeHeight);

  return { visibleStart, visibleEnd, offsetY, totalHeight };
}
