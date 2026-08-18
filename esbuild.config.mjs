import { readFileSync } from "node:fs";
import esbuild from "esbuild";

const prod = process.argv[2] === "production";
// 插件 id 只在 manifest.json 里维护一份，构建时注入，避免改名后两处不同步
const { id } = JSON.parse(readFileSync("manifest.json", "utf8"));

const ctx = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian"],
	format: "cjs",
	target: "es2020",
	platform: "browser",
	// 中文文案直接以 UTF-8 输出，不再逐字转成 \uXXXX（省 300 多字节）
	charset: "utf8",
	define: { SELF_ID: JSON.stringify(id) },
	treeShaking: true,
	minify: prod,
	legalComments: "none",
	sourcemap: prod ? false : "inline",
	logLevel: "info",
	outfile: "main.js",
});

if (prod) {
	await ctx.rebuild();
	await ctx.dispose();
} else {
	await ctx.watch();
}
