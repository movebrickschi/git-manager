/**
 * 轻量级 Markdown → HTML 渲染器，零依赖。
 *
 * 仅覆盖日报场景常见语法：
 * - ATX 标题 (#…######)
 * - 围栏代码块 ```lang … ```
 * - 无序列表 (-, *, +) / 有序列表 (1.)
 * - 引用块 (>)
 * - 水平分隔线 (---, ***, ___)
 * - 行内：**bold** / *italic* / `code` / [text](url) / 自动链接
 * - 换行：单个换行符渲染为 <br>（GFM 风格）
 *
 * 输出始终经过 HTML 转义，原始 HTML 一律视为文本——避免 XSS。
 */

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

function renderInline(text: string): string {
  let out = escapeHtml(text);

  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);

  out = out.replace(
    /\*\*([^*]+)\*\*/g,
    (_m, inner: string) => `<strong>${inner}</strong>`
  );
  out = out.replace(/__([^_]+)__/g, (_m, inner: string) => `<strong>${inner}</strong>`);

  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_m, lead: string, inner: string) =>
    `${lead}<em>${inner}</em>`
  );
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, (_m, lead: string, inner: string) =>
    `${lead}<em>${inner}</em>`
  );

  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );

  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_m, lead: string, url: string) =>
      `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );

  return out;
}

/**
 * 列表节点：一项 = 文本 + 0..n 个子列表（支持任意层级嵌套）。
 */
interface ListItem {
  text: string;
  children: ListContext[];
}

interface ListContext {
  ordered: boolean;
  /** 当前 list 在源码中的前导空格列数（tab 视为 4 列）。 */
  indent: number;
  items: ListItem[];
}

function renderListContext(ctx: ListContext): string {
  const tag = ctx.ordered ? "ol" : "ul";
  const lis = ctx.items
    .map((it) => {
      let inner = renderInline(it.text);
      if (it.children.length > 0) {
        inner += it.children.map(renderListContext).join("");
      }
      return `<li>${inner}</li>`;
    })
    .join("");
  return `<${tag}>${lis}</${tag}>`;
}

/**
 * 把目前积累的"根列表队列"输出到 html 流，并清空 stack 与 roots。
 *
 * 嵌套子列表通过 ListItem.children 表达，渲染时递归生成，
 * 所以这里只需要 dump roots 即可。
 */
function flushLists(
  stack: ListContext[],
  roots: ListContext[],
  html: string[]
): void {
  if (roots.length === 0) {
    stack.length = 0;
    return;
  }
  for (const root of roots) {
    html.push(renderListContext(root));
  }
  stack.length = 0;
  roots.length = 0;
}

function flushParagraph(buf: string[], html: string[]): void {
  if (buf.length === 0) return;
  const joined = buf.join("\n").trim();
  if (joined) {
    html.push(`<p>${renderInline(joined).replace(/\n/g, "<br>")}</p>`);
  }
  buf.length = 0;
}

/** 计算前导空白对应的列数（tab 视为 4 列）。 */
function leadingIndent(raw: string): number {
  let n = 0;
  for (const ch of raw) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

export function renderMarkdown(source: string): string {
  if (!source) return "";

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  const paraBuf: string[] = [];
  const listStack: ListContext[] = [];
  const rootLists: ListContext[] = [];
  let inFence = false;
  let fenceLang = "";
  const fenceBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    const fenceMatch = raw.match(/^```\s*([\w-]*)\s*$/);
    if (fenceMatch) {
      if (inFence) {
        const codeHtml = escapeHtml(fenceBuf.join("\n"));
        const cls = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : "";
        html.push(`<pre><code${cls}>${codeHtml}</code></pre>`);
        fenceBuf.length = 0;
        inFence = false;
        fenceLang = "";
      } else {
        flushParagraph(paraBuf, html);
        flushLists(listStack, rootLists, html);
        inFence = true;
        fenceLang = fenceMatch[1] ?? "";
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(raw);
      continue;
    }

    const line = raw;
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paraBuf, html);
      flushLists(listStack, rootLists, html);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(paraBuf, html);
      flushLists(listStack, rootLists, html);
      html.push("<hr>");
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph(paraBuf, html);
      flushLists(listStack, rootLists, html);
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph(paraBuf, html);
      flushLists(listStack, rootLists, html);
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    // 列表项：保留前导空格，支持基于缩进的嵌套
    const listMatch = raw.match(/^([ \t]*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      flushParagraph(paraBuf, html);
      const indent = leadingIndent(listMatch[1] ?? "");
      const ordered = /^\d+\./.test(listMatch[2]);
      const itemText = listMatch[3].trim();

      // 弹出栈顶所有 indent > 当前 indent 的 list（回到父层级）
      while (
        listStack.length > 0 &&
        listStack[listStack.length - 1].indent > indent
      ) {
        listStack.pop();
      }

      const top = listStack[listStack.length - 1];

      if (top && top.indent === indent && top.ordered === ordered) {
        // 同层 & 同 ordered：追加到栈顶
        top.items.push({ text: itemText, children: [] });
      } else if (top && top.indent === indent && top.ordered !== ordered) {
        // 同层但 ordered 不同：作为新的根 list（视作同级兄弟）
        listStack.pop();
        const newList: ListContext = {
          ordered,
          indent,
          items: [{ text: itemText, children: [] }],
        };
        if (listStack.length === 0) {
          rootLists.push(newList);
        } else {
          // 父层级仍存在：把它挂到父的最后一个 item 下
          const parent = listStack[listStack.length - 1];
          parent.items[parent.items.length - 1].children.push(newList);
        }
        listStack.push(newList);
      } else if (top && top.indent < indent) {
        // 更深一层：作为栈顶最后一项的子 list
        const newList: ListContext = {
          ordered,
          indent,
          items: [{ text: itemText, children: [] }],
        };
        top.items[top.items.length - 1].children.push(newList);
        listStack.push(newList);
      } else {
        // 栈空：作为顶级根 list
        const newList: ListContext = {
          ordered,
          indent,
          items: [{ text: itemText, children: [] }],
        };
        rootLists.push(newList);
        listStack.push(newList);
      }
      continue;
    }

    // 列表续行：若当前在列表内，且本行缩进 ≥ 栈顶 list 缩进 + 2，则视为
    // 栈顶最后一个 item 文本的续行（lazy continuation），追加到 text 中。
    if (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      const indent = leadingIndent(raw);
      if (indent >= top.indent + 2) {
        const lastItem = top.items[top.items.length - 1];
        lastItem.text += "\n" + trimmed;
        continue;
      }
    }

    // 否则视为段落
    flushLists(listStack, rootLists, html);
    paraBuf.push(line);
  }

  if (inFence) {
    const codeHtml = escapeHtml(fenceBuf.join("\n"));
    const cls = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : "";
    html.push(`<pre><code${cls}>${codeHtml}</code></pre>`);
  }
  flushParagraph(paraBuf, html);
  flushLists(listStack, rootLists, html);

  return html.join("\n");
}
