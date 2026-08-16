// attention-notifier-web — 宿主半(持久化,空实现)。
//
// 本包是 dsh-attention-notifier 的**网页版呈现端**:判定仍由
// attention-plugin.mjs(宿主半)完成并聚合到 GET /dsh-attention;本包的
// 浏览器半(lib/client.js)在 DSH 网页版里轮询该端点,在你不在时把标签页
// 标题/favicon 变成闪烁提醒,并(授权后)弹系统通知。
//
// 宿主半本身什么都不做:它的唯一职责是作为 profile 组合中的一个加载条目,
// 让 @deepseek-ai/dsh-client-modules 发现本包的 dsh.client 声明(见
// package.json),解析 exports["./client"] 并把浏览器半以
// /plugins/<id>/client.js 路由下发到网页(机制与 conversation-cost-balance
// 相同)。不注册路由、不监听事件、不发布任何服务。
//
// 加载与安装见仓库根 README「网页版适配(Web 呈现端,无需桌面壳)」一节。

export default {
  name: 'attention-notifier-web',
  apply(ctx) {
    // 空宿主半:占位加载条目,使浏览器半被 dsh-client-modules 发现并下发。
    // 网页刷新后浏览器半生效,本条日志帮助确认宿主半已随组合加载。
    console.log('[attention-web] host half loaded (browser half applies after page refresh)')
  },
}
