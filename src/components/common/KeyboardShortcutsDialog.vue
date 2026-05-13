<script setup lang="ts">
defineEmits<{ close: [] }>();

interface Shortcut {
  keys: string;
  desc: string;
}

interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

const groups: ShortcutGroup[] = [
  {
    title: "全局",
    items: [
      { keys: "?", desc: "显示快捷键帮助" },
      { keys: "Esc", desc: "关闭弹窗 / 取消" },
    ],
  },
  {
    title: "提交日志",
    items: [
      { keys: "↑ / ↓", desc: "切换上一个 / 下一个 commit" },
      { keys: "Ctrl + 点击", desc: "多选提交" },
      { keys: "Shift + 点击", desc: "范围选择" },
    ],
  },
  {
    title: "本地变更",
    items: [
      { keys: "Ctrl + Enter", desc: "提交（在 message 框内）" },
      { keys: "Ctrl + Shift + Enter", desc: "提交并推送" },
      { keys: "Ctrl + A", desc: "全选文件" },
    ],
  },
  {
    title: "差异视图",
    items: [
      { keys: "← / →", desc: "上一个 / 下一个 hunk" },
      { keys: "Space", desc: "暂存 / 取消暂存当前 hunk" },
    ],
  },
];
</script>

<template>
  <div class="shortcuts-overlay" @click.self="$emit('close')">
    <div class="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div class="shortcuts-header">
        <h2 id="shortcuts-title">键盘快捷键</h2>
        <button class="shortcuts-close" aria-label="关闭" @click="$emit('close')">✕</button>
      </div>
      <div class="shortcuts-body">
        <section v-for="g in groups" :key="g.title" class="shortcut-group">
          <h3>{{ g.title }}</h3>
          <ul>
            <li v-for="(s, i) in g.items" :key="i">
              <kbd>{{ s.keys }}</kbd>
              <span>{{ s.desc }}</span>
            </li>
          </ul>
        </section>
      </div>
      <div class="shortcuts-footer">
        <span>按 <kbd>?</kbd> 随时打开此面板</span>
        <button class="btn-close" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
}
.shortcuts-dialog {
  width: min(640px, 90vw);
  max-height: 80vh;
  background: var(--color-surface, #1e1e1e);
  color: var(--color-foreground, #e0e0e0);
  border: 1px solid var(--color-border, #333);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border, #333);
}
.shortcuts-header h2 {
  margin: 0;
  font-size: 16px;
}
.shortcuts-close {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}
.shortcuts-close:hover {
  background: var(--color-surface-hover, #2a2a2a);
  border-radius: 4px;
}
.shortcuts-body {
  padding: 8px 16px;
  overflow-y: auto;
  flex: 1;
}
.shortcut-group {
  margin-bottom: 16px;
}
.shortcut-group h3 {
  margin: 8px 0;
  font-size: 13px;
  color: var(--color-foreground-muted, #888);
  font-weight: 600;
}
.shortcut-group ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.shortcut-group li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 0;
  font-size: 13px;
}
kbd {
  display: inline-block;
  min-width: 32px;
  text-align: center;
  padding: 2px 6px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  background: var(--color-surface-active, #2a2a2a);
  border: 1px solid var(--color-border, #333);
  border-radius: 3px;
}
.shortcuts-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border, #333);
  font-size: 12px;
  color: var(--color-foreground-muted, #888);
}
.btn-close {
  padding: 4px 12px;
  background: var(--color-primary, #2196f3);
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
</style>
