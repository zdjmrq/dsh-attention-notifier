# DSH Attention Notifier

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 添加"微信式"任务栏注意力提醒的**持久化 Cordis 插件(宿主半)**。

## 功能

当会话**需要你介入**(审批/提问挂起超过 1 秒)或**一轮工作完成**(agent running → idle)时,把状态聚合到一个 JSON 端点,由桌面壳呈现为任务栏闪烁(闪几轮后常驻淡红,微信新消息同款)。

- 只做**判定**,不碰任何 UI,不发布任何服务;
- **持久化**:作为 agent preset 的一行加载,随 DSH 重启自动生效;
- 自带 `stats` 自诊断计数,排查问题一目了然。

## 工作原理

1. 插件挂载后,经 `agents` 服务找到 agent 的 ctx,在其上注册监听器
   (agent 级作用域事件沿链**向上**投递,必须挂在 agent 自己的作用域;
   挂载瞬间 agent 可能尚未注册,插件用 1 秒轮询重试补上);
2. 监听 `agent/status`(完成)、`approval/request` 与 `tools/execute`
   (介入;只观察不代答,waterfall 一律调用 `next()`);
3. 在宿主 `webServer` 上挂载 `GET /dsh-attention`,输出聚合状态:
   `{ intervention, running, completedId, completedAt, stats }`;
4. 桌面壳(如 [zdjmrq/dsh-shell](https://github.com/zdjmrq/dsh-shell))
   注入页面的轮询器每秒读取该端点,结合窗口焦点与活动检测决定何时闪烁、
   何时熄灭。

## 安装

1. 把 `attention-plugin.mjs` 复制进你的 agent preset 目录
   (`DSH_HOME` 默认 `~/.dsh`;想给哪个预设加提醒就复制到哪个预设目录):

```powershell
Copy-Item attention-plugin.mjs "$env:USERPROFILE\.dsh\.agent-presets\<你的预设>\"
```

2. 在该预设的 `agent.cordis.yml` 末尾追加一行:

```yaml
- id: attention-notifier
  name: './attention-plugin.mjs'
```

3. 让会话使用该预设:把 `settings.yaml` 的 `agent-presets.default` 指向它,
   或新建会话时在界面里选择;
4. (可选)配合桌面壳呈现提醒 —— 推荐 [dsh-shell](https://github.com/zdjmrq/dsh-shell)
   的注意力提醒实现(preload 桥 + 页面轮询 + 任务栏闪烁)。

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
