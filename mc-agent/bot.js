const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { plugin: collectBlock } = require('mineflayer-collectblock')
const { getObservation } = require('./observation')
const registry = require('./actionRegistry')
const { loadMemory, saveMemory, updateMemory, getMemorySummary, startSession, endSession } = require('./memory')
const { getAction, reflect } = require('./bridge')
const {
  startMetrics, recordAction, recordInventory,
  recordPosition, recordDeath, recordLowHealth, endMetrics
} = require('./metrics')

let botBusy = false
registry.loadLearnedActions()

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'AgentBot',
  version: '1.21.11'
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlock)

let memory = loadMemory()
memory = startSession(memory)
let metrics = startMetrics(memory.session_count)
let agentRunning = false

bot.getMemory = () => memory

bot.once('spawn', async () => {
  console.log('[AGENT] Bot spawned!')
  await bot.waitForChunksToLoad()
  console.log('[SETUP] World loaded')

  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot)
  movements.canDig = true
  movements.digCost = 1
  movements.allowSprinting = true
  movements.allowParkour = true
  movements.canOpenDoors = true
  movements.maxDropDown = 4
  movements.scafoldingBlocks = []
  movements.placeCost = 999
  movements.blocksCantBreak = new Set([
    mcData.blocksByName['bedrock']?.id,
    mcData.blocksByName['obsidian']?.id,
  ].filter(Boolean))
  movements.blocksToAvoid = new Set([
    mcData.blocksByName['lava']?.id,
    mcData.blocksByName['fire']?.id,
  ].filter(Boolean))
  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = 30000
  console.log('[SETUP] Pathfinder ready')

  setInterval(async () => {
    if (bot.food < 14 && !bot._eating) {
      bot._eating = true
      try { await registry.executeAction(bot, { type: 'eat' }) } catch {}
      bot._eating = false
    }
  }, 10000)

  console.log('[AGENT] Ready — starting agent loops')
  agentRunning = true
  runAgentLoop()
})

let forcedAction = null
let currentObservation = null
let recentActions = []

// ── REFLEX LOOP ──────────────────────────────────────────────────
async function reflexLoop() {
  await new Promise(resolve => setTimeout(resolve, 5000))

  while (agentRunning) {
    try {
      if (!bot.entity) {
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      currentObservation = getObservation(bot)
      recordPosition(metrics, bot.entity.position)

      if (botBusy) {
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      // Danger
      if (currentObservation.danger_level === 'dangerous' && !bot._fleeing) {
        console.log('[REFLEX] Danger — forcing run_away')
        forcedAction = { type: 'run_away', reason: 'reflex: danger' }
      }

      // Hunger — only if hungry AND has food
      if (currentObservation.status.hunger < 14 && !bot._eating) {
        const hasFood = bot.inventory.items().some(i =>
          ['cooked_beef','cooked_chicken','bread','apple','carrot',
           'salmon','cod','sweet_berries','cooked_salmon'].includes(i.name)
        )
        if (hasFood) {
          console.log('[REFLEX] Hungry — forcing eat')
          forcedAction = { type: 'eat', reason: 'reflex: hunger' }
        }
      }

      // Stuck — clear forced action, let LLM decide
      const last4 = recentActions.slice(-4).map(a => a.action)
      if (last4.length === 4 && new Set(last4).size === 1) {
        console.log(`[REFLEX] Stuck in ${last4[0]} loop — letting LLM decide`)
        forcedAction = null
      }

    } catch (err) { /* reflex must never crash */ }

    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}

// ── DECISION LOOP ────────────────────────────────────────────────
async function decisionLoop() {
  while (agentRunning) {
    try {
      if (!currentObservation) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }

      memory = updateMemory(memory, currentObservation, recentActions[recentActions.length - 1] ?? null)

      console.log('\n[AGENT] --- NEW DECISION CYCLE ---')
      console.log(`[AGENT] Health: ${currentObservation.status.health} | Hunger: ${currentObservation.status.hunger} | Danger: ${currentObservation.danger_level}`)
      console.log(`[AGENT] Time: ${currentObservation.world.time_of_day}`)
      console.log(`[AGENT] Nearby: ${currentObservation.nearby_resources.map(r => r.type).join(', ') || 'nothing'}`)
      console.log(`[AGENT] Entities: ${currentObservation.nearby_entities.map(e => e.type).join(', ') || 'none'}`)

      let action
      let llmTime = 0  // default 0 for reflex actions

      if (forcedAction) {
        action = forcedAction
        forcedAction = null
        console.log(`[AGENT] Reflex action: ${action.type} — "${action.reason}"`)
      } else {
        const memorySummary = getMemorySummary(memory)
        const llmStart = Date.now()
        action = await getAction(currentObservation, memorySummary, recentActions)
        llmTime = Date.now() - llmStart  // properly captured
        console.log(`[AGENT] Decision: ${action.type} — "${action.reason}" (${llmTime}ms)`)
      }

      let success = false
      if (action.type === 'learn_action') {
        registry.registerAction(action.name, action.description, action.steps)
        registry.saveLearnedActions()
        success = true
      } else {
        botBusy = true
        let result
        try {
          result = await registry.executeAction(bot, action)
        } catch (err) {
          console.log(`[AGENT] Action crashed: ${err.message}`)
          result = false
        }
        botBusy = false
        success = result !== false
      }

      recentActions.push({
        action: action.type,
        target: action.target ?? action.direction ?? null,
        success,
        reason: action.reason,
        context: {
          health: currentObservation.status.health,
          hunger: currentObservation.status.hunger,
          danger: currentObservation.danger_level,
          time: currentObservation.world.time_of_day,
          nearby: currentObservation.nearby_resources.map(r => r.type)
        }
      })
      if (recentActions.length > 20) recentActions.shift()

      recordInventory(metrics, bot.inventory.items())
      recordAction(metrics, action, success, currentObservation, llmTime)
      memory.last_action = { type: action.type }
      saveMemory(memory)

      if (recentActions.length > 0 && recentActions.length % 15 === 0) {
        console.log('[AGENT] Running reflection...')
        const newRules = await reflect(getMemorySummary(memory), recentActions)
        if (newRules?.length) {
          if (!memory.learned_rules) memory.learned_rules = []
          memory.learned_rules.push(...newRules)
          if (memory.learned_rules.length > 20) memory.learned_rules = memory.learned_rules.slice(-20)
          console.log('[AGENT] New rules:', newRules)
          saveMemory(memory)
        }
      }

    } catch (err) {
      console.error('[AGENT] Decision error:', err.message)
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }
}

async function runAgentLoop() {
  reflexLoop()
  decisionLoop()
}

bot.on('health', async () => {
  if (bot.health <= 8 && !bot._fleeing) {
    recordLowHealth(metrics)
    bot._fleeing = true
    console.log('[SURVIVAL] Low health — running away')
    bot.pathfinder.stop()
    try { await registry.executeAction(bot, { type: 'run_away' }) } catch {}
    bot._fleeing = false
  }
})

setInterval(() => {
  const items = Object.values(bot.entities).filter(e => e.name === 'item')
  if (!items.length) return
  const nearest = items
    .filter(e => e.position.distanceTo(bot.entity.position) < 5)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
  if (nearest) {
    const { goals } = require('mineflayer-pathfinder')
    bot.pathfinder.goto(new goals.GoalNear(nearest.position.x, nearest.position.y, nearest.position.z, 1)).catch(() => {})
  }
}, 5000)

bot.on('entitySpawn', (entity) => {
  if (entity.name !== 'item') return
  if (entity.position.distanceTo(bot.entity.position) > 8) return
  const { goals } = require('mineflayer-pathfinder')
  bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 1)).catch(() => {})
})

bot.on('spawn', async () => {
  if (memory?.home && !memory?.home_is_fixed) {
    memory.home = {
      x: Math.round(bot.entity.position.x),
      y: Math.round(bot.entity.position.y),
      z: Math.round(bot.entity.position.z)
    }
  }
})

process.on('SIGINT', () => {
  console.log('\n[AGENT] Shutting down...')
  endMetrics(metrics)
  endSession(memory, `Session ${memory.session_count} ended manually. Deaths: ${memory.death_count}`)
  process.exit(0)
})

bot.on('error', err => console.error('[BOT] Error:', err))
bot.on('kicked', reason => console.error('[BOT] Kicked:', reason))