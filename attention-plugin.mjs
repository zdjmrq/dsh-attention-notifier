// DSH Attention Notifier — 宿主层版本(Web 组合 patch 挂载)。
//
// 与"预设行版本"的区别:挂载在宿主组合层,一个实例服务**所有预设的所有
// 会话**,无需在每个预设里加行。判定两类信号:
//   - 需要介入:审批请求挂起、或向用户提问(ask_user_question 执行中)超过 1 秒
//     (机器秒答的审批不会误报);
//   - 一轮完成:根 agent 状态 running -> idle。
//
// 作用域规则:agent 级事件沿作用域链向上投递、绝不向下;监听器注册在
// 根 agent 自己的 ctx 上(经 agents.roots() 取得),天然只收到该根 agent
// 的事件 —— 子代理(subagent)是受管子 agent,不会触发误报。
// 启动时 agent 尚未创建,1 秒轮询持续补线新出现的根 agent(新会话/恢复
// 会话都会产生新 agent 对象),同时清理已销毁的 agent;webServer 就绪前
// 路由注册也由同一轮询重试。
//
// 生命周期纪律:每个 agent 的监听器拆解函数都随条目保存,agent 销毁时
// 与插件卸载时统一执行,不留任何跨插件生命周期的注册。
//
// 经宿主 webServer 挂载 GET /dsh-attention,供桌面壳(如 dsh-shell)注入
// 页面的轮询器读取并上报任务栏闪烁。本插件只消费宿主服务、不发布任何
// 服务。端点带 stats 自诊断计数。
//
// 注意:组合行里的 name 必须用 file:/// 绝对 URL(Windows 下 C:/ 形式的
// 绝对路径会被 Node ESM 当作 scheme 为 c: 的 URL 而拒绝导入)。

const now = () => Date.now()
const HOSTAGE_MS = 1000 // 审批/提问挂起多久后视为"需要介入"(机器秒答不误报)

const liveAgents = new Map() // Agent -> { local, off }
const wiredAgents = new WeakSet()
let routeDispose = null
let routeReady = false

function aggregate() {
  const t = now()
  const out = {
    intervention: false,
    running: false,
    completedId: 0,
    completedAt: 0,
    stats: { sessions: liveAgents.size, approvals: 0, questions: 0, completions: 0 },
  }
  for (const { local } of liveAgents.values()) {
    let oldest = -1
    for (const entry of local.approvals) {
      if (oldest < 0 || entry.since < oldest) oldest = entry.since
    }
    if (oldest >= 0 && t - oldest >= HOSTAGE_MS) out.intervention = true
    oldest = -1
    for (const entry of local.questions) {
      if (oldest < 0 || entry.since < oldest) oldest = entry.since
    }
    if (oldest >= 0 && t - oldest >= HOSTAGE_MS) out.intervention = true
    if (local.running) out.running = true
    if (local.completedAt > out.completedAt) {
      out.completedAt = local.completedAt
      out.completedId = local.completedId
    }
    out.stats.approvals += local.stats.approvals
    out.stats.questions += local.stats.questions
    out.stats.completions += local.stats.completions
  }
  return out
}

export const name = 'attention-notifier'

// 硬依赖:加载器会等这些服务就绪后才激活本插件,消除启动时序竞态
// (webServer 未就绪时路由注册会静默失败且无重试,timer 未就绪时补线轮询
// 永远不启动)。
export const inject = ['webServer', 'agents', 'timer']

export function apply(ctx) {
  const mark = (list) => {
    const entry = { since: now() }
    list.push(entry)
    return () => {
      const index = list.indexOf(entry)
      if (index >= 0) list.splice(index, 1)
    }
  }

  const observe = (promise, done) => {
    if (promise && typeof promise.then === 'function') promise.then(done, done)
    else done()
  }

  // 在根 agent 的 ctx 上注册三个监听器,返回统一拆解函数
  const registerListeners = (target, local) => {
    const offs = []
    offs.push(target.on('agent/status', (payload) => {
      const status = payload && payload.status
      if (status === 'running') {
        local.running = true
      } else if (status === 'idle') {
        if (local.running) {
          local.completedAt = now()
          local.completedId += 1
          local.stats.completions += 1
          console.log('[attention] turn completed id=' + local.completedId)
        }
        local.running = false
      }
    }))
    offs.push(target.on('approval/request', (req, next) => {
      const done = mark(local.approvals)
      local.stats.approvals += 1
      console.log('[attention] approval requested')
      try {
        const outcome = next()
        observe(outcome, done)
        return outcome
      } catch (err) {
        done()
        throw err
      }
    }))
    offs.push(target.on('tools/execute', (exec, next) => {
      const name = exec && typeof exec.name === 'string' ? exec.name : ''
      if (name !== 'ask_user_question' && name.indexOf('ask_user_question') < 0) return next()
      const done = mark(local.questions)
      local.stats.questions += 1
      console.log('[attention] question requested (tool=' + name + ')')
      try {
        const outcome = next()
        observe(outcome, done)
        return outcome
      } catch (err) {
        done()
        throw err
      }
    }))
    return () => {
      for (const off of offs) off()
    }
  }

  const detachAgent = (agent) => {
    const entry = liveAgents.get(agent)
    if (entry) {
      try { entry.off() } catch (err) { /* 已随 agent ctx 清理则忽略 */ }
      liveAgents.delete(agent)
    }
  }

  const wireAgent = (agent) => {
    if (wiredAgents.has(agent)) return
    if (!agent || !agent.ctx || typeof agent.ctx.on !== 'function') return
    wiredAgents.add(agent)
    const local = {
      approvals: [],
      questions: [],
      running: agent.status === 'running',
      completedId: 0,
      completedAt: 0,
      stats: { approvals: 0, questions: 0, completions: 0 },
    }
    const off = registerListeners(agent.ctx, local)
    liveAgents.set(agent, { local, off })
    console.log('[attention] wired root agent ' + String(agent.id))
  }

  const sweep = (agents) => {
    for (const agent of liveAgents.keys()) {
      let alive = false
      try {
        alive = agents.get(agent.id) === agent
      } catch (err) {
        alive = false
      }
      if (!alive) detachAgent(agent)
    }
  }

  // webServer 就绪前由轮询重试注册,避免启动时序问题
  const ensureRoute = () => {
    if (routeReady) return
    const webServer = ctx.get('webServer')
    if (!webServer || typeof webServer.register !== 'function') return
    routeReady = true
    routeDispose = webServer.register({
      kind: 'exact',
      path: '/dsh-attention',
      handler: (_req, res) => {
        let body
        try {
          body = JSON.stringify(aggregate())
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'aggregate failed' }))
          return
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(body)
      },
    })
  }

  const tick = () => {
    ensureRoute()
    const agents = ctx.get('agents')
    if (!agents || typeof agents.roots !== 'function' || typeof agents.get !== 'function') return
    sweep(agents)
    for (const agent of agents.roots()) wireAgent(agent)
  }

  ctx.effect(() => {
    const timer = ctx.get('timer')
    if (timer && typeof timer.interval === 'function') {
      timer.interval(tick, 1000)
    }
    tick()
    return () => {
      for (const agent of [...liveAgents.keys()]) detachAgent(agent)
      if (routeDispose) { routeDispose(); routeDispose = null }
      routeReady = false
    }
  })
}
