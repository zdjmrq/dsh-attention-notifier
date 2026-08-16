// attention-notifier-web — 浏览器半(Web 呈现端)。
//
// 在 DSH 网页版(GUI 由宿主 webServer 提供,页面与 /dsh-attention 同源)内
// 轮询判定端聚合状态,在你"不在"时呈现提醒:
//   - 需要介入(审批/提问挂起 ≥1s):标签页标题加「⚠ 需要介入」前缀并交替
//     闪烁、favicon 换成红点,授权后首次触发弹一条系统通知;
//   - 一轮完成(running → idle):标题加「✓ 本轮完成」前缀,同款闪烁,
//     不弹通知(避免打扰);
//   - "你不在"判定:标签页隐藏(document.hidden)、窗口失焦(!hasFocus)、
//     或超过 8 秒无任何操作(鼠标/键盘/滚轮/触摸)即视为不在;
//     回到对话(聚焦 + 有操作)立即熄灭。
//
// 首读记基线:completedId 在 DSH 重启后归零,呈现端首读时记录基线,
// 重启前的旧计数不会被当成"新完成"误闪。
//
// 只消费浏览器 API(fetch / document.title / favicon / Notification),
// 不注入任何 client service,不依赖 react 等第三方库。
//
// 本文件由宿主 @deepseek-ai/dsh-client-modules 以现成 bundle 形式下发
// (window.__ModuleLoader__.load),无需构建步骤;修改后刷新页面即生效。

window.__ModuleLoader__.load({
	id: "attention-notifier-web",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		// #region 常量(可自行调整)
		const ENDPOINT = "/dsh-attention"; // 判定端聚合状态端点(同源)
		const POLL_MS = 1000; // 轮询周期,与判定端心跳一致
		const AWAY_MS = 8000; // 无操作多久后视为"你不在"
		const FLASH_MS = 600; // 标题/favicon 交替闪烁周期
		const TITLE_ATTENTION = "⚠ 需要介入"; // 介入提醒标题前缀
		const TITLE_COMPLETED = "✓ 本轮完成"; // 完成提醒标题前缀
		const NOTIFY_ATTENTION = true; // 介入时是否弹系统通知(需已授权)
		const NOTIFY_COMPLETED = false; // 完成时是否弹系统通知
		// #endregion

		// #region 状态
		let baselineCompletedId = null; // 首读基线,重启归零不误闪
		let lastSeenCompletedId = null; // 已呈现过的最大完成计数
		let lastActivity = Date.now(); // 最后一次用户活动时间
		let flashing = false; // 是否正在闪烁
		let flashTimer = null; // 闪烁交替定时器
		let pollTimer = null; // 轮询定时器
		let savedTitle = ""; // 开始闪烁时的页面标题
		let savedIconHref = null; // 开始闪烁时的 favicon 地址(null=原本没有)
		// #endregion

		// #region favicon 辅助
		function faviconLink() {
			return document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
		}
		function redDotFavicon() {
			const canvas = document.createElement("canvas");
			canvas.width = 16;
			canvas.height = 16;
			const g = canvas.getContext("2d");
			g.fillStyle = "#e53935";
			g.beginPath();
			g.arc(8, 8, 7, 0, Math.PI * 2);
			g.fill();
			return canvas.toDataURL("image/png");
		}
		function setFavicon(href) {
			let link = faviconLink();
			if (!link) {
				link = document.createElement("link");
				link.rel = "icon";
				link.dataset.dshAttention = "1"; // 标记自建链接,恢复时清理
				document.head.appendChild(link);
			}
			link.href = href;
		}
		function restoreFavicon() {
			if (savedIconHref === null) {
				const link = faviconLink();
				if (link && link.dataset.dshAttention === "1") link.remove();
			} else {
				setFavicon(savedIconHref);
			}
		}
		// #endregion

		// #region 通知
		function maybeRequestNotificationPermission() {
			if (typeof Notification === "undefined") return;
			if (Notification.permission === "default") {
				try { Notification.requestPermission().catch(() => {}); } catch (err) { /* 忽略 */ }
			}
		}
		function notify(kind) {
			if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
			const want = kind === "attention" ? NOTIFY_ATTENTION : NOTIFY_COMPLETED;
			if (!want) return;
			try {
				new Notification(kind === "attention" ? "DSH 需要你介入" : "DSH 一轮完成", {
					body: kind === "attention"
						? "有审批或提问挂起超过 1 秒,需要你介入"
						: "有一轮工作已完成,可以回来查看",
					tag: "dsh-attention", // 同 tag 覆盖,避免通知堆积
				});
			} catch (err) { /* 忽略 */ }
		}
		// #endregion

		// #region 呈现
		function isAway() {
			return document.hidden || !document.hasFocus() || (Date.now() - lastActivity > AWAY_MS);
		}
		function beginFlash(kind) {
			if (flashing) return;
			flashing = true;
			savedTitle = document.title;
			const icon = faviconLink();
			savedIconHref = icon ? icon.href : null;
			const prefix = kind === "attention" ? TITLE_ATTENTION : TITLE_COMPLETED;
			const dot = redDotFavicon();
			let on = false;
			flashTimer = setInterval(() => {
				on = !on;
				document.title = on ? prefix + " · " + savedTitle : savedTitle;
				if (on) {
					setFavicon(dot);
				} else {
					restoreFavicon();
				}
			}, FLASH_MS);
			notify(kind);
		}
		function stopFlash() {
			if (!flashing) return;
			flashing = false;
			if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
			if (savedTitle !== "") document.title = savedTitle;
			restoreFavicon();
			savedTitle = "";
			savedIconHref = null;
		}
		// #endregion

		// #region 轮询
		async function poll() {
			try {
				const res = await fetch(ENDPOINT, {
					headers: { accept: "application/json" },
					cache: "no-store",
				});
				if (!res.ok) return;
				const state = await res.json();
				// 首读记基线:重启后的旧计数不当"新完成"
				if (baselineCompletedId === null) {
					baselineCompletedId = state.completedId;
					lastSeenCompletedId = state.completedId;
				}
				const newCompletion = typeof state.completedId === "number" && state.completedId > lastSeenCompletedId;
				if (newCompletion) lastSeenCompletedId = state.completedId;
				const want = state.intervention === true || newCompletion;
				if (want && isAway()) {
					beginFlash(state.intervention === true ? "attention" : "completion");
				} else if (!want || !isAway()) {
					stopFlash();
				}
			} catch (err) { /* 判定端未安装/未就绪时静默 */ }
		}
		// #endregion

		// #region client plugin
		const inject = [];
		function apply(ctx) {
			lastActivity = Date.now();
			pollTimer = setInterval(poll, POLL_MS);
			poll();
			// 用户活动跟踪 + 首次交互时请求通知权限
			const activityEvents = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
			const handlers = activityEvents.map((ev) => {
				const h = () => { lastActivity = Date.now(); maybeRequestNotificationPermission(); if (flashing && !isAway()) stopFlash(); };
				document.addEventListener(ev, h, { passive: true });
				return [ev, h];
			});
			const onFocus = () => { lastActivity = Date.now(); if (flashing) stopFlash(); };
			const onVisibility = () => { if (!document.hidden) { lastActivity = Date.now(); if (flashing) stopFlash(); } };
			window.addEventListener("focus", onFocus);
			document.addEventListener("visibilitychange", onVisibility);
			// 返回拆解函数:插件卸载时清理全部注册
			return () => {
				if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
				if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
				for (const [ev, h] of handlers) document.removeEventListener(ev, h);
				window.removeEventListener("focus", onFocus);
				document.removeEventListener("visibilitychange", onVisibility);
				stopFlash();
			};
		}
		// #endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
