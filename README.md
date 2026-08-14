# DSH Attention Notifier

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 添加"微信式"任务栏注意力提醒的**持久化 Cordis 插件(宿主半)**,与
[dsh-shell](https://github.com/zdjmrq/dsh-shell) 桌面壳**配套使用(推荐)**:插件负责"判",壳负责"显"。

## 功能

当会话**需要你介入**(审批/提问挂起超过 1 秒)或**一轮工作完成**(agent running → idle)时,把状态聚合到一个 JSON 端点,由桌面壳呈现为任务栏闪烁(闪几轮后常驻淡红,微信新消息同款)。

- 只做**判定**,不碰任何 UI,不发布任何服务;
- **持久化**:作为 agent preset 的一行加载,随 DSH 重启自动生效;
- 自带 `stats` 自诊断计数,排查问题一目了然;
- 与 [dsh-shell](https://github.com/zdjmrq/dsh-shell) 桌面壳**配套使用(推荐)**:
  插件只负责判定与状态端点,任务栏闪烁等呈现全部由壳完成,详见
  [与 dsh-shell 搭配使用](#与-dsh-shell-搭配使用推荐)。

## 工作原理

1. 插件挂载在**宿主组合层**(Web 组合 patch),一个实例服务**所有预设的所有
   会话**;经 `agents.roots()` 找到各根 agent 的 ctx,在其上注册监听器
   (agent 级作用域事件沿链**向上**投递,必须挂在 agent 自己的作用域;
   启动时 agent 尚未创建,1 秒轮询持续补线新会话、清理已销毁的会话,
   子代理事件天然不会误报);
2. 监听 `agent/status`(完成)、`approval/request` 与 `tools/execute`
   (介入;只观察不代答,waterfall 一律调用 `next()`);
3. 在宿主 `webServer` 上挂载 `GET /dsh-attention`,输出聚合状态:
   `{ intervention, running, completedId, completedAt, stats }`;
4. 桌面壳(如 [zdjmrq/dsh-shell](https://github.com/zdjmrq/dsh-shell))
   注入页面的轮询器每秒读取该端点,结合窗口焦点与活动检测决定何时闪烁、
   何时熄灭。

## 安装(宿主层,推荐)

插件挂载在 Web 组合的 patch 层,**DSH 启动时自动加载,所有预设、所有会话
自动生效**,无需在每个预设里加行,也无需任何"启用"操作:

1. 把 `attention-plugin.mjs` 放到 `~/.dsh/plugins/`(没有就新建):

```powershell
New-Item -ItemType Directory -Path "$env:USERPROFILE\.dsh\plugins" -Force
Copy-Item attention-plugin.mjs "$env:USERPROFILE\.dsh\plugins\"
```

2. 编辑 `~/.dsh/profiles/web/cordis.patch.yml`,把内容 `[]` 替换为:

```yaml
- insert:
    - id: attention-notifier
      name: 'file:///C:/Users/<你的用户名>/.dsh/plugins/attention-plugin.mjs'
```

   > Windows 下 `name` 必须用 `file:///` 绝对 URL:`C:/...` 形式会被 Node ESM
   > 当作 scheme 为 `c:` 的 URL 而拒绝导入,导致启动失败。

3. 重启 DSH(关壳重开,或重启 `pnpm dsh web`),无其他步骤。

### 备选:按预设安装

只想给特定预设加提醒时,把 `attention-plugin.mjs` 复制进该预设目录,并在其
`agent.cordis.yml` 末尾追加一行:

```yaml
- id: attention-notifier
  name: './attention-plugin.mjs'
```

### 呈现

呈现由桌面壳完成,无需任何页面侧插件 —— 见
[与 dsh-shell 搭配使用(推荐)](#与-dsh-shell-搭配使用推荐)。

## 与 dsh-shell 搭配使用(推荐)

本插件与 [dsh-shell](https://github.com/zdjmrq/dsh-shell) 是**一对**:
一个负责"判",一个负责"显",建议一起安装。

- **本插件(DSH 侧)**:把"需要介入 / 一轮完成"聚合到
  `GET /dsh-attention` JSON 端点,不碰任何 UI;
- **dsh-shell(桌面侧)**:注入页面的轮询器每秒读取该端点,结合窗口焦点
  与操作活动判定"你不在",再经 preload 桥(`window.dshShell.setAttention`)
  上报主进程,触发 Windows 任务栏按钮闪烁(微信新消息同款,闪几轮后
  常驻淡红);介入与完成同款呈现。

### 安装步骤

1. 按上文把本插件装好(宿主层即可,所有预设自动生效);
2. 获取并运行 dsh-shell:按其 README 打包 `DSH Desktop.exe`
   (或开发模式 `npm start`);
3. 确认壳 `config.json` 里的 `port` 与 DSH web 端口一致(默认都是
   `3080`)—— 不一致时壳读不到端点,提醒不会出现;
4. 正常使用即可:需要介入或一轮完成时,只要你没在关注(窗口失焦/最小化,
   或聚焦但超过 8 秒无操作),任务栏按钮就闪烁;回到对话立即熄灭。

### 注意事项

- **没装本插件**:壳的轮询器读不到 `/dsh-attention`,任务栏不会闪烁 ——
  壳只提供窗口层通道,不探测 DSH 页面状态;
- **不用壳**:插件同样独立可用 —— 端点照常对外,任何自制的呈现端
  (浏览器脚本、桌面组件、其他人自己打包的桌面壳)都能读同一 JSON 做
  自己的提醒,详见 [独立使用与适配其他桌面壳](#独立使用与适配其他桌面壳);
- 按预设安装插件同样兼容壳:端点挂在宿主 `webServer` 上,该预设会话
  运行时即生效。

## 独立使用与适配其他桌面壳

本插件与呈现完全解耦:**不装 dsh-shell 也完全可用**;任何桌面壳 —— 包括
其他人自己打包的桌面版 —— 只要消费 `GET /dsh-attention`,就能获得同样的
任务栏提醒能力。插件本身与平台无关,Windows / macOS / Linux 的壳都能读
同一个端点。

### 端点契约

`GET http://127.0.0.1:3080/dsh-attention` 返回
(`Cache-Control: no-store`,仅 DSH 本机 web 服务):

| 字段 | 含义 |
| --- | --- |
| `intervention` | 是否有审批/提问挂起超过 1 秒,需要你介入 |
| `running` | 是否有一轮工作正在进行 |
| `completedId` | 完成轮次自增计数(DSH 重启后归零) |
| `completedAt` | 最近一次完成的 epoch 毫秒时间 |
| `stats` | 自诊断计数:`sessions` / `approvals` / `questions` / `completions` |

### 呈现端最小实现

任何呈现端只需三步:**轮询端点 → 判定"你不在" → 呈现与熄灭**。以自己打包
的 Electron 壳为例,在注入页面的脚本里:

```js
let baseline = null
let lastActivity = Date.now()
for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']) {
  document.addEventListener(ev, () => { lastActivity = Date.now() }, { passive: true })
}
setInterval(async () => {
  try {
    const state = await (await fetch('/dsh-attention', { cache: 'no-store' })).json()
    if (baseline === null) { baseline = state.completedId; return } // 首读记基线,旧完成不误闪
    const away = !document.hasFocus() || Date.now() - lastActivity > 8000
    if (state.intervention || state.completedId !== baseline) {
      baseline = state.completedId
      if (away) window.flashShell && window.flashShell() // 经 preload 桥通知主进程
    }
    if (!away) window.clearShell && window.clearShell() // 回到对话立即熄灭
  } catch {}
}, 1000)
```

主进程侧按平台选择呈现方式:

- **Windows 任务栏**:Electron `win.flashFrame(true)`,熄灭用
  `win.flashFrame(false)`(dsh-shell 的做法,微信新消息同款);
- **macOS Dock**:`app.dock.bounce('informational')`,或
  `win.flashFrame(true)`(系统转为一次应用注意请求);
- **Linux**:窗口管理器支持 urgency hint 时同样可用 `win.flashFrame`。

示例里的 `window.flashShell / clearShell` 是示意桥,按你的 preload 设计自行
命名即可;1 秒轮询、8 秒闲置、完成确认窗口等阈值都只是推荐值,可自行调整。
不装任何呈现端时,插件只是把状态聚合在端点里(浏览器直接打开即可查看),
不会自行闪烁。

## 验证

```powershell
Invoke-WebRequest http://127.0.0.1:3080/dsh-attention
# {"intervention":false,"running":false,"completedId":0,"completedAt":0,"stats":{...}}
```

- `stats.sessions` 应为 1(本会话已挂载);
- 提问/审批挂起时 `intervention` 变为 `true`,`stats.questions/approvals` 递增;
- 一轮工作结束后 `completedId` 递增。

## 呈现侧的"你不在"判定(以 dsh-shell 为例)

- 窗口失焦/最小化,或聚焦但超过 8 秒没有任何操作(鼠标/键盘/滚轮/触摸);
- 回到对话(窗口聚焦,或窗口内任意操作)立即熄灭;
- 完成事件若发生在你正活跃地看着窗口时,视为已看到,不闪。

## License

MIT
