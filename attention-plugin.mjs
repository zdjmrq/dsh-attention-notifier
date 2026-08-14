// DSH Attention Notifier — 持久宿主半(桌面壳提醒的判定端)。
//
// 判定两类信号:
//   - 需要介入:审批请求挂起、或向用户提问(ask_user_question 执行中)超过 1 秒
//     (机器秒答的审批不会误报);
//   - 一轮完成:agent 状态 running -> idle。
//
// 关键实现点:agent 级事件(agent/status、approval/request、tools/execute)按
// 作用域沿链向上投递、绝不向下,而预设插件挂在 agent 的子作用域(会话作用域),
// 直接 ctx.on 收不到。因此监听器必须注册在 agent 自己的 ctx 上(经 agents
// 服务取得)。挂载瞬间 agent 可能尚未进入注册表,用 1 秒轮询重试补上。
//
// 通过宿主 webServer 挂载 GET /dsh-attention 端点,供 dsh-shell 注入到页面
// 的轮询器读取并上报任务栏闪烁。路由随挂载本预设的会话数增减(最后一个会话
// 卸载时移除,下个会话挂载时重新注册),并聚合所有已挂载会话的状态。
// 本插件只消费宿主服务、不发布任何服务,无需 isolate realm。
// 端点带 stats 自诊断计数,便于排查事件是否被观察到。

const now = () => Date.now()

const liveSessions = new Set()
let routeDispose = null
let routeOwners = 0

function aggregate() {
  const t = now()
  const out = {
    intervention: false,
    running: false,
    completedId: 0,
    completedAt: 0,
    stats: { sessions: liveSessions.size, approvals: 0, questions: 0, completions: 0 },
  }
  for (const s of liveSessions) {
    let oldest = -1
    for (const entry of s.approvals) {
      if (oldest < 0 || entry.since < oldest) oldest = entry.since
    }
    if (oldest >= 0 && t - oldest >= 1000) out.intervention = true
    oldest = -1
    for (const entry of s.questions) {
      if (oldest < 0 || entry.since < oldest) oldest = entry.since
    }
    if (oldest >= 0 && t - oldest >= 1000) out.intervention = true
    if (s.running) out.running = true
    if (s.completedAt > out.completedAt) {
      out.completedAt = s.completedAt
      out.completedId = s.completedId
    }
    out.stats.approvals += s.stats.approvals
    out.stats.questions += s.stats.questions
    out.stats.completions += s.stats.completions
  }
  return out
}

function ensureRoute(webServer) {
  if (routeDispose) return
  routeDispose = webServer.register({
    kind: 'exact',
    path: '/dsh-attention',
    handler: (_req, res) => {
      const state = aggregate()
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(state))
    },
  })
}

export const name = 'attention-notifier'

export function apply(ctx) {
  const local = {
    approvals: [],
    questions: [],
    running: false,
    completedId: 0,
    completedAt: 0,
    stats: { approvals: 0, questions: 0, completions: 0 },
  }

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

  // 在目标 ctx(agent.ctx)上注册三个监听器,返回统一拆解函数
  const registerListeners = (target) => {
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

  // 找到 agent 注册表里所有 agent 的 ctx 并注册监听器;
  // 挂载瞬间 agent 可能还没注册,由下面的定时器重试。
  let wired = false
  let wireOff = null
  let retryDispose = null
  let retries = 0

  const tryWire = () => {
    if (wired) return
    const agents = ctx.get('agents')
    if (!agents || typeof agents.list !== 'function') return
    const list = agents.list()
    if (!Array.isArray(list) || list.length === 0) return
    const targets = []
    for (const agent of list) {
      if (agent && agent.ctx && typeof agent.ctx.on === 'function') {
        if (agent.status === 'running') local.running = true
        targets.push(agent.ctx)
      }
    }
    if (targets.length === 0) return
    wired = true
    const offs = targets.map((t) => registerListeners(t))
    wireOff = () => {
      for (const off of offs) off()
    }
    console.log('[attention] wired listeners on ' + targets.length + ' agent ctx(s)')
  }

  ctx.effect(() => {
    liveSessions.add(local)
    return () => liveSessions.delete(local)
  })

  ctx.effect(() => {
    const timer = ctx.get('timer')
    if (timer && typeof timer.interval === 'function') {
      retryDispose = timer.interval(() => {
        retries += 1
        tryWire()
        if (wired || retries > 60) {
          if (retryDispose) { retryDispose(); retryDispose = null }
        }
      }, 1000)
    }
    tryWire()
    return () => {
      if (retryDispose) { retryDispose(); retryDispose = null }
      if (wireOff) { wireOff(); wireOff = null }
    }
  })

  ctx.effect(() => {
    const webServer = ctx.get('webServer')
    if (!webServer || typeof webServer.register !== 'function') return
    routeOwners += 1
    ensureRoute(webServer)
    return () => {
      routeOwners -= 1
      if (routeOwners <= 0 && routeDispose) {
        routeDispose()
        routeDispose = null
      }
    }
  })
}
