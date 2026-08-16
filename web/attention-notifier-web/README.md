# attention-notifier-web

[dsh-attention-notifier](https://github.com/zdjmrq/dsh-attention-notifier) 的**网页版呈现端**
（双半插件）：判定由仓库根 `attention-plugin.mjs` 完成并聚合到
`GET /dsh-attention`；本包的**浏览器半**在 DSH 网页版（GUI 与端点同源）里
轮询该端点，在你"不在"时把标签页标题 / favicon 变成闪烁提醒，并（授权后）
弹系统通知。判显职责与 [dsh-shell](https://github.com/zdjmrq/dsh-shell)
桌面壳方案一致，只是把"显"从 Electron 换成浏览器 API。

## 呈现行为

- **需要介入**（审批/提问挂起 ≥1 秒）：标题加「⚠ 需要介入」前缀并交替
  闪烁、favicon 变红点，直至你回到对话或挂起结束；授权后首次触发弹系统
  通知；
- **一轮完成**（running → idle）：标题加「✓ 本轮完成」前缀，同款闪烁，
  不弹通知（避免打扰）；
- **"你不在"判定**：标签页隐藏、窗口失焦、或超过 8 秒无任何操作
  （鼠标/键盘/滚轮/触摸）即视为不在，避免误闪；回到对话立即熄灭；
- **首读记基线**：`completedId` 在 DSH 重启后归零，浏览器半首读时记录
  基线，重启前的旧计数不会被当成"新完成"误闪。

## 安装

1. 把本目录复制到 `~/.dsh/profiles/node_modules/`（与
   `conversation-cost-balance` 同级）：

```powershell
Copy-Item attention-notifier-web "$env:USERPROFILE\.dsh\profiles\node_modules\" -Recurse
```

2. 编辑 `~/.dsh/profiles/web/cordis.patch.yml`，追加一个 insert 条目：

```yaml
- insert:
    - id: attention-notifier-web
      name: 'attention-notifier-web'
```

3. 重启 DSH web（关壳重开，或重启 `pnpm dsh web`），然后刷新页面；
4. 可选：首次收到提醒时浏览器会请求通知权限，允许后即可弹系统通知。

> 宿主半是空实现，仅作为加载条目让 `@deepseek-ai/dsh-client-modules` 发现
> 并下发浏览器半（机制同 `conversation-cost-balance`）；判定仍由
> `attention-plugin.mjs` 完成，两个插件相互独立，可只装其一。

## 与桌面壳方案的差异

- **无任务栏闪烁**：网页标签页没有"任务栏图标"，最接近的替代是系统通知
  与标题/favicon 闪烁；需要任务栏级提醒时仍用 dsh-shell；
- **后台节流**：浏览器会对后台标签页的定时器降频（Chrome 在标签页隐藏
  5 分钟后可能降到约 1 次/分钟），长时间完全切走时提醒可能延迟；
- **端点无鉴权**：仅限 DSH 本机 web 服务使用，别把端口暴露到公网。

阈值（轮询 1 秒、闲置 8 秒、闪烁 600ms、通知开关）在 `lib/client.js` 顶部
常量中，可自行调整。
