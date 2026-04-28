<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";

export interface MenuItem {
  label: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  shortcut?: string;
  children?: MenuItem[];
}

const props = defineProps<{
  items: MenuItem[];
}>();

const visible = ref(false);
const x = ref(0);
const y = ref(0);
const menuRef = ref<HTMLElement>();
const activeSubmenuIndex = ref<number | null>(null);
const submenuX = ref(0);
const submenuY = ref(0);

function show(event: MouseEvent) {
  event.preventDefault();
  x.value = event.clientX;
  y.value = event.clientY;
  visible.value = true;
  activeSubmenuIndex.value = null;

  nextTick(() => {
    if (menuRef.value) {
      const rect = menuRef.value.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        x.value = window.innerWidth - rect.width - 4;
      }
      if (rect.bottom > window.innerHeight) {
        y.value = window.innerHeight - rect.height - 4;
      }
    }
  });
}

function hide() {
  visible.value = false;
  activeSubmenuIndex.value = null;
}

function handleClick(item: MenuItem) {
  if (item.disabled) return;
  if (item.children?.length) return; // submenu items don't close on click
  item.action?.();
  hide();
}

function handleMouseEnter(index: number, item: MenuItem, event: MouseEvent) {
  if (!item.children?.length) {
    activeSubmenuIndex.value = null;
    return;
  }
  activeSubmenuIndex.value = index;
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  submenuX.value = rect.right;
  submenuY.value = rect.top;

  nextTick(() => {
    // adjust submenu position if it goes off-screen
    const submenuEl = document.querySelector(".context-submenu") as HTMLElement | null;
    if (submenuEl) {
      const srect = submenuEl.getBoundingClientRect();
      if (srect.right > window.innerWidth) {
        submenuX.value = rect.left - srect.width;
      }
      if (srect.bottom > window.innerHeight) {
        submenuY.value = window.innerHeight - srect.height - 4;
      }
    }
  });
}

function handleSubmenuClick(item: MenuItem) {
  if (item.disabled) return;
  item.action?.();
  hide();
}

function onClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    hide();
  }
}

onMounted(() => {
  document.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
});

defineExpose({ show, hide });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.separator" class="context-menu-separator" />
        <div
          v-else
          class="context-menu-item"
          :class="{
            disabled: item.disabled,
            'has-submenu': item.children?.length,
            active: activeSubmenuIndex === i,
          }"
          @click="handleClick(item)"
          @mouseenter="handleMouseEnter(i, item, $event)"
        >
          <span class="context-menu-label">{{ item.label }}</span>
          <span v-if="item.shortcut && !item.children?.length" class="context-menu-shortcut">
            {{ item.shortcut }}
          </span>
          <span v-if="item.children?.length" class="context-menu-arrow">›</span>
        </div>
      </template>

      <!-- Submenu -->
      <Teleport to="body">
        <div
          v-if="activeSubmenuIndex !== null && items[activeSubmenuIndex]?.children?.length"
          class="context-menu context-submenu"
          :style="{ left: submenuX + 'px', top: submenuY + 'px' }"
        >
          <template v-for="(child, ci) in items[activeSubmenuIndex]!.children" :key="ci">
            <div v-if="child.separator" class="context-menu-separator" />
            <div
              v-else
              class="context-menu-item"
              :class="{ disabled: child.disabled }"
              @click="handleSubmenuClick(child)"
            >
              <span class="context-menu-label">{{ child.label }}</span>
              <span v-if="child.shortcut" class="context-menu-shortcut">{{ child.shortcut }}</span>
            </div>
          </template>
        </div>
      </Teleport>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 4px 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.context-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  cursor: pointer;
  gap: 16px;
  font-size: 12px;
  white-space: nowrap;
}

.context-menu-item:hover:not(.disabled),
.context-menu-item.active:not(.disabled) {
  background: var(--color-primary);
  color: white;
}

.context-menu-item.disabled {
  opacity: 0.4;
  cursor: default;
}

.context-menu-shortcut {
  font-size: 11px;
  opacity: 0.6;
  margin-left: auto;
}

.context-menu-arrow {
  font-size: 14px;
  margin-left: auto;
  line-height: 1;
}

.context-menu-separator {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}
</style>
