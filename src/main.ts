import type { App, ButtonComponent, SettingDefinitionItem, TextComponent } from "obsidian";

// 值从运行时 require 解构进来：比 `import { … } from "obsidian"` 少一层命名空间引用。
// Obsidian 取插件类的方式是 `module.exports.default || module.exports`（obsidian.asar
// loadPlugin），所以直接挂 module.exports，还能省掉 esbuild 的 ESM→CJS 互操作样板。
declare function require(id: "obsidian"): typeof import("obsidian");
const { Notice, Plugin, PluginSettingTab, Setting, requestUrl, requireApiVersion } = require("obsidian");

/** 构建时由 esbuild 从 manifest.json 注入，用来认出「在装我自己」 */
declare const SELF_ID: string;

/** 设置页下方的三个示例：点一下即填入并安装 */
const EXAMPLES: [string, string][] = [
	["笔记同步助手", "https://www.bijitongbu.site/ob/"],
	["手机电脑同步", "https://relay-2.bijitongbu.site/obsync/plugin/"],
	["China Speedup 加速商店", "https://gh.clipfx.app/plugin-market/"],
];

/** 一个插件的三件套，顺序固定；styles.css 允许缺失 */
const FILES = ["manifest.json", "main.js", "styles.css"];

interface Manifest {
	id: string;
	name?: string;
	version: string;
	minAppVersion?: string;
}

/** app.plugins 没有公开类型，这里只声明本插件真正用到的那几个成员 */
interface PluginManager {
	plugins: Record<string, unknown>;
	loadManifests(): Promise<void>;
	disablePlugin(id: string): Promise<void>;
	enablePluginAndSave(id: string): Promise<void>;
}

/**
 * 从「按路径下放文件」的地址安装：取 manifest.json / main.js / styles.css，
 * 写进 .obsidian/plugins/<id>/ 后加载并启用，返回它的 manifest。
 *
 * 不做解压：源站把三件套摊开放，插件这边就不用带任何解压代码。
 */
async function install(app: App, url: string): Promise<Manifest> {
	let root: URL;
	try {
		root = new URL(url.trim());
	} catch {
		throw new Error("地址格式不对，要填完整的网址");
	}
	// 装什么就等于执行什么，明文 http 会被同网段的人换掉；只给本机开发放行
	const dev = root.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.hostname);
	if (root.protocol !== "https:" && !dev) throw new Error("插件代码必须走 https 下载");
	root.hash = "";
	// 粘目录、粘 manifest.json 都行；query 保留（有的源站带签名参数）
	root.pathname = root.pathname.replace(/\/manifest\.json$/i, "").replace(/\/+$/, "") + "/";

	const get = async (name: string): Promise<string | null> => {
		const u = new URL(root);
		u.pathname += name;
		const r = await requestUrl({ url: u.href, throw: false });
		if (r.status >= 200 && r.status < 300) return r.text;
		// 只有「确实没有」才算可选文件缺失：500/403 当成缺失会误删已装好的旧样式
		if (name === FILES[2] && (r.status === 404 || r.status === 410)) return null;
		throw new Error(name + " 取不到：HTTP " + r.status);
	};

	const manText = (await get(FILES[0])) as string;
	const man = JSON.parse(manText) as Manifest;
	const id = man.id;
	// id 会拼进写盘路径，且缺字段的 manifest 写进去会让插件加载不了
	if (typeof id !== "string" || !/^[\w.-]+$/.test(id) || id.startsWith(".") || typeof man.version !== "string") {
		throw new Error("manifest.json 不合法");
	}
	// 写盘不可逆，先确认这版跑得起来，别把能用的版本覆盖成装不上的
	if (man.minAppVersion && !requireApiVersion(man.minAppVersion)) {
		throw new Error("它需要 Obsidian " + man.minAppVersion + " 或更高版本");
	}

	const texts: (string | null)[] = [manText, ...(await Promise.all([get(FILES[1]), get(FILES[2])]))];
	if (!(texts[1] as string).trim()) throw new Error("main.js 是空的");

	const ad = app.vault.adapter;
	const dir = app.vault.configDir + "/plugins/" + id;
	if (!(await ad.exists(dir))) await ad.mkdir(dir);
	for (let i = 0; i < FILES.length; i++) {
		const f = dir + "/" + FILES[i];
		// 新版本不再带 styles.css 时要删掉旧的，否则老样式会继续生效
		if (texts[i] != null) await ad.write(f, texts[i] as string);
		else if (await ad.exists(f)) await ad.remove(f);
	}

	const { plugins } = app as App & { plugins: PluginManager };
	await plugins.loadManifests();
	if (id === SELF_ID) {
		new Notice("已更新 " + SELF_ID + "，重启 Obsidian 后生效", 8000);
		return man;
	}
	// 已在运行的先停掉，否则新代码不会生效（这里报错不能吞：吞了会留下两个实例）
	if (plugins.plugins[id]) await plugins.disablePlugin(id);
	await plugins.enablePluginAndSave(id);
	// 启用可能悄悄失败（不兼容、main.js 报错），别把它说成安装成功
	if (!plugins.plugins[id]) throw new Error("已下载，但 Obsidian 没能启用它，请在第三方插件列表里查看");
	return man;
}

class CBratTab extends PluginSettingTab {
	private url = "";
	private busy = false;

	// 1.13 起设置项可以被全局搜索索引。本页只有一个「填地址→点安装」的动作，
	// 没有可索引的配置项；这里必须返回空数组——返回非空会让 1.13 跳过 display()。
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [];
	}

	display(): void {
		const el = this.containerEl;
		el.empty();
		let input: TextComponent;

		// 说明放整行标题上，不放 setDesc：setDesc 会被输入框挤成很窄的一列（实测很难读）
		new Setting(el)
			.setName("从地址安装插件")
			.setDesc("填一个放着 manifest.json 和 main.js 的目录地址，装好后会自动启用。")
			.setHeading();

		new Setting(el)
			.setName("插件地址")
			.addText((t) => {
				input = t;
				t.setPlaceholder("https://example.com/myplugin/")
					.setValue(this.url)
					.onChange((v) => (this.url = v));
				t.inputEl.size = 42;
			})
			.addButton((b) => b.setButtonText("安装").setCta().onClick(() => this.run(this.url, b)));

		new Setting(el).setName("示例").setHeading();
		for (const [name, url] of EXAMPLES) {
			new Setting(el)
				.setName(name)
				.setDesc(url)
				.addButton((b) =>
					b.setButtonText("填入并安装").onClick(() => {
						this.url = url;
						input.setValue(url);
						return this.run(url, b);
					}),
				);
		}
	}

	private async run(url: string, b: ButtonComponent): Promise<void> {
		if (this.busy) return void new Notice("正在装另一个，稍等");
		this.busy = true;
		const label = b.buttonEl.textContent || "安装";
		b.setButtonText("安装中…").setDisabled(true);
		try {
			const m = await install(this.app, url);
			if (m.id !== SELF_ID) new Notice("已安装 " + (m.name || m.id) + " v" + m.version, 6000);
		} catch (e) {
			new Notice("安装失败：" + (e instanceof Error ? e.message : String(e)), 8000);
		} finally {
			this.busy = false;
			b.setButtonText(label).setDisabled(false);
		}
	}
}

class CBrat extends Plugin {
	onload(): void {
		this.addSettingTab(new CBratTab(this.app, this));
	}
}

declare const module: { exports: typeof CBrat };
module.exports = CBrat;
