/**
 * Daily Report · Node 端公共服务。
 *
 * 同 ai.service 一样可同时被 Electron main 与 Express server 复用；
 * 本身不依赖 Electron API。
 *
 * 职责：
 * 1. 调 simple-git 抽取多仓库 commit
 * 2. 应用 ReportFilter（过滤 / 去重 / 关键字 / 分支）
 * 3. 调 buildAndRender 渲染 Markdown / 纯文本
 * 4. 调 chatCompletions 做 AI 润色（与 commit 生成共用同一份 AiConnection）
 */
import * as path from "path";
import { simpleGit, type SimpleGit } from "simple-git";
import { applyReportFilter, parseConventional, resolveRange } from "../../shared/report/report-filter.js";
import { buildAndRender } from "../../shared/report/report-grouper.js";
import {
  buildReportPolishPrompt,
  truncateReportInput,
} from "../../shared/ai/report-prompt-builder.js";
import {
  DEFAULT_PUBLIC_AI_SETTINGS,
  type AiSettings,
  type ReportAiSettings,
} from "../../shared/ai/types.js";
import type {
  AuthorSuggestion,
  RepoBranchInfo,
  ReportEntry,
  ReportExtractResult,
  ReportFilter,
  ReportPolishInput,
  ReportPolishResult,
} from "../../shared/report/types.js";
import { chatCompletions, type AiConnection } from "./ai.service.js";
import type { PublicStorage, SecretStorage } from "./ai.service.js";

export interface ReportServiceDeps {
  secretStorage: SecretStorage;
  publicStorage: PublicStorage;
}

const FIELD_SEP = "\u001f";
const RECORD_SEP = "\u001e";
const LOG_FORMAT = [
  "%H",
  "%h",
  "%P",
  "%an",
  "%ae",
  "%aI",
  "%s",
  "%B",
].join(FIELD_SEP);

function openGit(repo: string): SimpleGit {
  return simpleGit({ baseDir: repo, binary: "git" });
}

async function getCurrentBranch(git: SimpleGit): Promise<string | undefined> {
  try {
    const raw = await git.raw(["rev-parse", "--abbrev-ref", "HEAD"]);
    const name = raw.trim();
    return name && name !== "HEAD" ? name : undefined;
  } catch {
    return undefined;
  }
}

async function getDefaultAuthor(git: SimpleGit): Promise<{ name?: string; email?: string }> {
  try {
    const [name, email] = await Promise.all([
      git.raw(["config", "user.name"]).then((s) => s.trim()).catch(() => ""),
      git.raw(["config", "user.email"]).then((s) => s.trim()).catch(() => ""),
    ]);
    return { name: name || undefined, email: email || undefined };
  } catch {
    return {};
  }
}

function buildGitLogArgs(filter: ReportFilter, branch: string | undefined): string[] {
  const args = ["log", `--pretty=format:${LOG_FORMAT}${RECORD_SEP}`];

  const { fromISO, toISO } = resolveRange(filter.range);
  args.push(`--since=${fromISO}`);
  args.push(`--until=${toISO}`);

  // 作者参数：simple-git 不支持多 --author OR；改用 grep 让 git 自己 OR
  const authors = (filter.authors ?? []).filter((a) => a && a !== "*");
  if (authors.length === 1) {
    args.push(`--author=${authors[0]}`);
  } else if (authors.length > 1) {
    args.push("--perl-regexp");
    args.push(`--author=${authors.map(escapeRegex).join("|")}`);
  }

  // 分支：
  // - branches=['--all'] → 所有分支
  // - 给定白名单 → 多个 ref 直接附加在 args 末尾（git log 支持多 ref）
  // - 默认（空）→ 当前分支（已由 caller 注入 branch 参数到 args 末尾）
  const branches = filter.branches ?? [];
  if (branches.includes("--all")) {
    args.push("--all");
  } else if (branches.length > 0) {
    // 调用方负责确保分支名安全
    args.push(...branches);
  } else if (branch) {
    args.push(branch);
  }

  // 关键字过滤交给后处理（applyReportFilter）；这里不用 --grep 以避免转义复杂度

  return args;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 解析 `--pretty=format:` 自定义输出。
 *
 * 字段分隔：`\x1f`；记录分隔：`\x1e`。最后一条记录后还会有一个 `\x1e`。
 */
function parseLog(raw: string, repo: string): ReportEntry[] {
  const repoName = path.basename(repo);
  const records = raw.split(RECORD_SEP).map((r) => r.trim()).filter(Boolean);
  const out: ReportEntry[] = [];
  for (const rec of records) {
    const fields = rec.split(FIELD_SEP);
    if (fields.length < 8) continue;
    const [sha, shortSha, parents, author, email, dateISO, subject, body] = fields;
    const parentList = (parents ?? "").trim().split(/\s+/).filter(Boolean);
    const message = body && body.trim() ? body : subject;
    const parsed = parseConventional(message);
    out.push({
      repo,
      repoName,
      branch: undefined,
      sha,
      shortSha,
      author,
      email,
      dateISO,
      message: message.trim(),
      // 优先用 parseConventional 解析出的"去前缀"subject，避免后续渲染时
      // 出现 `feat(messaging): feat(messaging): xxx` 这种前缀重复
      subject: parsed.subject || subject?.trim() || "",
      module: parsed.module,
      scope: parsed.scope,
      parentCount: parentList.length,
    });
  }
  return out;
}

async function gitLogForRepo(repo: string, filter: ReportFilter): Promise<ReportEntry[]> {
  const git = openGit(repo);
  const branches = filter.branches ?? [];
  // 优先级：branchByRepo[repo] > branches['--all'] > branches[白名单] > 当前分支
  let branchForArgs: string | undefined;
  const perRepoBranch = filter.branchByRepo?.[repo];
  if (perRepoBranch && !branches.includes("--all")) {
    branchForArgs = perRepoBranch;
  } else if (!branches.includes("--all") && branches.length === 0) {
    branchForArgs = await getCurrentBranch(git);
  }
  const args = buildGitLogArgs(filter, branchForArgs);
  const raw = await git.raw(args);
  const entries = parseLog(raw, repo);
  // 给 branch 字段填值（如果调用方没用 --all）
  if (branchForArgs) {
    for (const e of entries) e.branch = branchForArgs;
  }
  return entries;
}

/** 列出本地分支，并标记 HEAD 所在分支。 */
async function listLocalBranches(repo: string): Promise<RepoBranchInfo> {
  const git = openGit(repo);
  try {
    const raw = await git.raw(["branch", "--list", "--format=%(refname:short)\u001f%(HEAD)"]);
    const branches: string[] = [];
    let current: string | undefined;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [name, headFlag] = trimmed.split("\u001f");
      const safeName = (name ?? "").trim();
      if (!safeName) continue;
      branches.push(safeName);
      if (headFlag?.trim() === "*") current = safeName;
    }
    return { branches: branches.sort((a, b) => a.localeCompare(b)), current };
  } catch {
    return { branches: [], current: undefined };
  }
}

async function loadAiSettings(deps: ReportServiceDeps): Promise<AiSettings | null> {
  const apiKey = await deps.secretStorage.getApiKey();
  if (!apiKey) return null;
  const pub = (await deps.publicStorage.read()) ?? DEFAULT_PUBLIC_AI_SETTINGS;
  return { ...pub, apiKey };
}

function asConnection(s: AiSettings): AiConnection {
  return { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, timeout: s.timeout };
}

function mergeReportSettings(
  defaults: ReportAiSettings,
  override?: Partial<ReportAiSettings>
): ReportAiSettings {
  return {
    style: override?.style ?? defaults.style,
    lang: override?.lang ?? defaults.lang,
    maxInputChars: override?.maxInputChars ?? defaults.maxInputChars,
    customPrompt: override?.customPrompt ?? defaults.customPrompt ?? "",
  };
}

export function makeReportService(deps: ReportServiceDeps) {
  let currentController: AbortController | null = null;
  let currentInstance = 0;

  return {
    async listBranches(repos: string[]): Promise<Record<string, RepoBranchInfo>> {
      const out: Record<string, RepoBranchInfo> = {};
      for (const repo of repos) {
        out[repo] = await listLocalBranches(repo);
      }
      return out;
    },

    async listAuthors(repos: string[], since?: string, until?: string): Promise<AuthorSuggestion[]> {
      if (!repos.length) return [];
      const counts = new Map<string, AuthorSuggestion>();
      for (const repo of repos) {
        try {
          const git = openGit(repo);
          const args = ["log", `--pretty=format:%an${FIELD_SEP}%ae`];
          if (since) args.push(`--since=${since}`);
          if (until) args.push(`--until=${until}`);
          args.push("--all");
          const raw = await git.raw(args);
          for (const line of raw.split(/\r?\n/)) {
            const [name, email] = line.split(FIELD_SEP);
            if (!email) continue;
            const key = email.toLowerCase();
            const existing = counts.get(key);
            if (existing) existing.count += 1;
            else counts.set(key, { name: name ?? email, email, count: 1 });
          }
        } catch {
          // 单仓库失败不影响其它仓库
        }
      }
      return [...counts.values()].sort((a, b) => b.count - a.count);
    },

    async extract(filter: ReportFilter): Promise<ReportExtractResult> {
      if (!filter.repos || filter.repos.length === 0) {
        return { ok: false, code: "NO_REPO", reason: "至少需要 1 个仓库" };
      }
      if (
        filter.range.preset === "custom" &&
        (!filter.range.fromISO || !filter.range.toISO)
      ) {
        return { ok: false, code: "INVALID_RANGE", reason: "自定义范围需同时提供起止时间" };
      }

      // 没指定作者时，默认用第一个仓库的当前 git user.email
      let effectiveFilter = filter;
      if (!filter.authors || filter.authors.length === 0) {
        try {
          const firstGit = openGit(filter.repos[0]);
          const def = await getDefaultAuthor(firstGit);
          if (def.email) {
            effectiveFilter = { ...filter, authors: [def.email] };
          }
        } catch {
          // ignore
        }
      }

      const allEntries: ReportEntry[] = [];
      const errors: string[] = [];
      for (const repo of effectiveFilter.repos) {
        try {
          const entries = await gitLogForRepo(repo, effectiveFilter);
          allEntries.push(...entries);
        } catch (e: unknown) {
          errors.push(`${path.basename(repo)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (allEntries.length === 0 && errors.length === effectiveFilter.repos.length) {
        return { ok: false, code: "GIT_FAIL", reason: errors.join("; ") };
      }

      const filtered = applyReportFilter(allEntries, effectiveFilter);
      if (filtered.length === 0) {
        return { ok: false, code: "NO_COMMITS", reason: "时间范围内没有匹配的提交" };
      }

      const rangeISO = resolveRange(effectiveFilter.range);
      const rendered = buildAndRender(filtered, { rangeISO });

      return {
        ok: true,
        result: {
          filter: effectiveFilter,
          groups: rendered.groups,
          markdown: rendered.markdown,
          plain: rendered.plain,
          totalCommits: rendered.totalCommits,
          generatedAtISO: new Date().toISOString(),
        },
      };
    },

    async polish(input: ReportPolishInput): Promise<ReportPolishResult> {
      currentController?.abort("superseded");
      const ctrl = new AbortController();
      currentController = ctrl;
      const myInstance = ++currentInstance;
      const releaseIfMine = () => {
        if (currentInstance === myInstance) currentController = null;
      };

      try {
        const settings = await loadAiSettings(deps);
        if (!settings) {
          return { ok: false, code: "NO_API_KEY", reason: "未配置 AI apiKey" };
        }
        const reportSettings = mergeReportSettings(settings.report, {
          style: input.style,
          lang: input.lang,
          customPrompt: input.customPrompt,
        });

        const { truncated } = truncateReportInput(input.markdown, reportSettings.maxInputChars);

        if (ctrl.signal.aborted) {
          return { ok: false, code: "ABORT", reason: "已取消" };
        }

        const { system, user } = buildReportPolishPrompt({
          rawMarkdown: truncated,
          style: reportSettings.style,
          lang: reportSettings.lang,
          customPrompt: reportSettings.customPrompt,
        });

        let res = await chatCompletions(asConnection(settings), system, user, ctrl.signal);
        if (
          !res.ok &&
          (res.code === "SERVER" || res.code === "NETWORK") &&
          !ctrl.signal.aborted
        ) {
          await new Promise((r) => setTimeout(r, 2000));
          if (!ctrl.signal.aborted) {
            res = await chatCompletions(asConnection(settings), system, user, ctrl.signal);
          } else {
            return { ok: false, code: "ABORT", reason: "已取消" };
          }
        }

        if (res.ok) return { ok: true, markdown: res.message };
        return { ok: false, code: res.code, reason: res.reason };
      } finally {
        releaseIfMine();
      }
    },

    abort(): void {
      currentController?.abort("user-cancel");
      currentController = null;
    },
  };
}

export type ReportService = ReturnType<typeof makeReportService>;
