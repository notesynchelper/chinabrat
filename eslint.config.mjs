// 本地复现 Obsidian 官方插件审核 bot 的静态扫描（eslint-plugin-obsidianmd）。
// 跑法（eslint 9 需要 node20）：npm run lint
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

// validate-manifest 期望拿到 JS 的「对象表达式」AST，所以把 manifest.json 包一层括号
// 当 JS 喂给它（`(` 只挪动第 1 行的列号，报告的行号仍与原文件一致）。
const manifestAsExpression = {
	meta: { name: "manifest-as-expression" },
	preprocess: (text) => [{ text: `(${text})`, filename: "manifest.js" }],
	postprocess: (messages) => messages.flat(),
	supportsAutofix: false,
};

export default defineConfig([
	// 扫描目标由 npm run lint 显式给出（src / manifest.json / package.json）；
	// 这里兜住裸跑 `eslint .` 的情况，别去扫构建产物和截图
	{ ignores: ["node_modules/**", "main.js", "docs/**", "esbuild.config.mjs"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: { parser: tsparser, parserOptions: { project: "./tsconfig.json" } },
		rules: {
			// 句首大写规则会把 URL 里的 https 当缩写要求全大写（"HTTPS://example.com"）。
			// 官方审核 bot 没有报这条，示例地址也不是散文，整串跳过。
			"obsidianmd/ui/sentence-case": ["warn", { enforceCamelCaseLower: true, ignoreRegex: ["https?://"] }],
		},
	},
	// recommended 没给 manifest.json 配语言，manifest 校验要自己挂上
	{
		files: ["manifest.json"],
		processor: manifestAsExpression,
	},
	{
		files: ["**/manifest.json/*.js"],
		plugins: { obsidianmd },
		rules: { "obsidianmd/validate-manifest": "warn", "@typescript-eslint/no-unused-expressions": "off" },
	},
]);
