# DSH Attention Notifier

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 添加"微信式"任务栏注意力提醒的**持久化 Cordis 插件(宿主半)**。

## 功能

当会话**需要你介入**(审批/提问挂起超过 1 秒)或**一轮工作完成**(agent running → idle)时,把状态聚合到一个 JSON 端点,由桌面壳呈现为任务栏闪烁(闪几轮后常驻淡红,微信新消息同款)。

- 只做**判定**,不碰任何 UI,不发布任何服务;
- **持久化**:作为 agent preset 的一行加载,随 DSH 重启自动生效;
- 自带 `stats` 自诊断计数,排查问题一目了然。

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

配合桌面壳呈现提醒 —— 推荐 [dsh-shell](https://github.com/zdjmrq/dsh-shell)
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
