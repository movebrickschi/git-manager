/**
 * 中文（简体）词典。
 * 按页面 / 组件分组。词条命名约定：<page>.<section>.<key>
 *
 * 添加新词条规则：
 * 1. 同时在 en-US.ts 加对应 key
 * 2. key 用 snake-like 小写 + 点分层级
 * 3. 占位符用 {name} 形式
 */
export default {
  common: {
    confirm: "确认",
    cancel: "取消",
    close: "关闭",
    delete: "删除",
    save: "保存",
    loading: "加载中...",
    error: "错误",
    success: "成功",
    retry: "重试",
    yes: "是",
    no: "否",
  },
  welcome: {
    title: "Git Manager",
    subtitle: "可视化 Git 客户端",
    open_repo: "打开仓库",
    clone_repo: "克隆仓库",
    recent_repos: "最近打开",
    no_recent: "暂无最近打开的仓库",
  },
  toolbar: {
    add_repo: "添加仓库",
    fetch: "拉取（fetch）",
    pull: "拉取并合并（pull）",
    push: "推送（push）",
    commit: "提交",
    branches: "分支",
  },
  changes: {
    title: "本地变更",
    staged: "已暂存",
    unstaged: "未暂存",
    untracked: "未跟踪",
    commit_placeholder: "输入提交信息...",
    commit_btn: "提交",
    commit_and_push: "提交并推送",
    amend: "修正上次提交",
    discard: "放弃更改",
    stage_all: "全部暂存",
    unstage_all: "全部取消暂存",
  },
  merge_banner: {
    in_progress: "正在进行 {state}",
    has_conflicts: "存在未解决的冲突",
    continue: "继续",
    abort: "中止",
  },
  shortcuts: {
    title: "键盘快捷键",
    open_panel_hint: "按 ? 随时打开此面板",
  },
  errors: {
    repo_open_failed: "打开仓库失败",
    network_unreachable: "网络不可达",
    auth_failed: "认证失败，请检查账号 / 密钥",
    timeout: "操作超时",
    unknown: "未知错误",
  },
};
