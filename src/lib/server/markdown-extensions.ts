import type MarkdownIt from "markdown-it";

/**
 * 零依赖的 markdown 语法扩展（在 markdown-it 原生能力之上补齐常用写法）。
 *
 * 说明：项目用 pnpm 管理依赖，混用 npm 安装 markdown-it-* 插件会破坏
 * node_modules 结构并产生 package-lock/pnpm-lock 冲突，因此这里直接用
 * markdown-it 的 ruler API 自行实现，不引入任何第三方包。
 *
 * 已支持：
 *   - 上标  ^text^        -> <sup>
 *   - 下标  ~text~        -> <sub>（不影响删除线 ~~text~~）
 *   - 高亮  ==text==      -> <mark>
 *   - 提示块 > [!TIP] 标题 -> <blockquote class="md-callout md-callout-tip">
 */

const CALLOUT_TYPES = new Set([
	"tip", "note", "info", "success", "warning", "danger",
	"important", "caution", "question", "example", "quote",
	"abstract", "summary", "todo"
]);

/** 各提示块的中文默认标题（未写标题时兜底展示） */
const CALLOUT_LABELS: Record<string, string> = {
	tip: "提示", note: "注释", info: "信息", success: "成功",
	warning: "警告", danger: "危险", important: "重要", caution: "注意",
	question: "疑问", example: "示例", quote: "引用",
	abstract: "摘要", summary: "总结", todo: "待办"
};

type AnyState = any;

function textToken(state: AnyState, content: string) {
	const t = new state.Token("text", "", 0);
	t.content = content;
	return t;
}

function wrappedTokens(state: AnyState, open: string, content: string, close: string) {
	const a = new state.Token("html_inline", "", 0);
	a.content = open;
	const b = new state.Token("text", "", 0);
	b.content = content;
	const c = new state.Token("html_inline", "", 0);
	c.content = close;
	return [a, b, c];
}

/**
 * 上标 / 下标 / 高亮。
 * 挂在 core ruler 的 inline 之后，只处理 inline token 的 text 子节点，
 * 因此天然跳过 fence / code_block / code_inline 里的同形字符。
 */
function inlineMarks(md: MarkdownIt) {
	md.core.ruler.after("inline", "inline_marks", (state: AnyState) => {
		const re = /(==)([^=\n]+?)(==)|(\^)([^\^\n]+?)(\^)|(~)([^~\n]+?)(~)/g;
		for (const token of state.tokens) {
			if (token.type !== "inline" || !token.children) continue;
			const out: any[] = [];
			let changed = false;
			for (const child of token.children) {
				if (child.type !== "text" || !child.content) {
					out.push(child);
					continue;
				}
				const src: string = child.content;
				re.lastIndex = 0;
				let last = 0;
				let m: RegExpExecArray | null;
				let hit = false;
				while ((m = re.exec(src)) !== null) {
					if (m.index > last) out.push(textToken(state, src.slice(last, m.index)));
					if (m[1]) {
						out.push(...wrappedTokens(state, "<mark>", m[2], "</mark>"));
					} else if (m[4]) {
						out.push(...wrappedTokens(state, "<sup>", m[5], "</sup>"));
					} else if (m[7]) {
						out.push(...wrappedTokens(state, "<sub>", m[8], "</sub>"));
					}
					last = re.lastIndex;
					hit = true;
				}
				if (hit) {
					if (last < src.length) out.push(textToken(state, src.slice(last)));
					changed = true;
				} else {
					out.push(child);
				}
			}
			if (changed) token.children = out;
		}
		return false;
	});
}

/**
 * Callout 提示块：GitHub / Obsidian 写法
 *   > [!TIP] 这里是标题
 *   > 正文内容
 * 实现方式是给已有的 blockquote_open token 挂 class，并插入标题节点，
 * 不改动块级解析流程，因此块内 markdown（列表、代码、加粗等）照常渲染。
 */
function callouts(md: MarkdownIt) {
	md.core.ruler.push("callouts", (state: AnyState) => {
		const tokens = state.tokens;
		for (let i = 0; i < tokens.length; i++) {
			const open = tokens[i];
			if (open.type !== "blockquote_open") continue;
			const pOpen = tokens[i + 1];
			if (!pOpen || pOpen.type !== "paragraph_open") continue;
			const inlineTok = tokens[i + 2];
			if (!inlineTok || inlineTok.type !== "inline" || !inlineTok.children?.length) continue;
			const first = inlineTok.children[0];
			if (!first || first.type !== "text") continue;

			const m = /^\[!([A-Za-z]+)\][ \t]*([^\n]*)/.exec(first.content);
			if (!m) continue;
			const type = m[1].toLowerCase();
			if (!CALLOUT_TYPES.has(type)) continue;

			// 标记行剩下的文字即正文首行；标题取标记后的同一行内容
			let title = (m[2] || "").trim();
			open.attrJoin("class", `md-callout md-callout-${type}`);

			const rest = first.content.slice(m[0].length);
			// 若标记后本行还有内容，把它当作正文（标题留空由 CSS 兜底显示默认标签）
			if (rest.trim()) {
				first.content = rest.replace(/^[ \t]+/, "");
				title = "";
			} else {
				first.content = rest.replace(/^\r?\n/, "");
				title = title || CALLOUT_LABELS[type] || type;
			}

			if (title) {
				const t = new state.Token("html_inline", "", 0);
				t.content = `<span class="md-callout-title">${md.utils.escapeHtml(title)}</span>`;
				inlineTok.children.unshift(t);
			}
			if (!first.content.trim() && inlineTok.children.length === (title ? 2 : 1)) {
				inlineTok.children = [];
			}
		}
		return false;
	});
}

export function applyMarkdownExtensions(md: MarkdownIt) {
	inlineMarks(md);
	callouts(md);
}
