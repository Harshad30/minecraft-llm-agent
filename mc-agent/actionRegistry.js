// All built-in actions
const builtinActions = require('./actions')

// Dynamic actions learned at runtime
const learnedActions = {}

// Register a new compound action
function registerAction(name, description, steps) {
  learnedActions[name] = {
    name,
    description,
    steps,        // array of primitive actions to execute in sequence
    learned_at: Date.now()
  }
  console.log(`[REGISTRY] Learned new action: ${name}`)
  console.log(`[REGISTRY] Description: ${description}`)
}

// Execute any action — builtin or learned
async function executeAction(bot, action) {
  if (!action || !action.type) {
    console.log(`[REGISTRY] Invalid action:`, action)
    return false
  }

  if (learnedActions[action.type]) {
    return await executeLearnedAction(bot, action)
  }

  try {
    return await builtinActions.executeAction(bot, action)
  } catch (err) {
    console.log(`[REGISTRY] Action "${action.type}" crashed: ${err.message}`)
    return false
  }
}

// Execute a learned compound action step by step
async function executeLearnedAction(bot, action) {
  const learned = learnedActions[action.type]
  console.log(`[REGISTRY] Executing learned action: ${action.type}`)
  console.log(`[REGISTRY] "${learned.description}"`)

  for (const step of learned.steps) {
    console.log(`[REGISTRY] Step: ${JSON.stringify(step)}`)
    const result = await builtinActions.executeAction(bot, step)
    if (result === false) {
      console.log(`[REGISTRY] Step failed, stopping action`)
      return false
    }
  }
  return true
}

// Get all available actions (for LLM context)
function getAvailableActions() {
  const builtin = [
    { type: 'explore',     params: 'direction: north/south/east/west' },
    { type: 'move_to',     params: 'x, y, z' },
    { type: 'return_home', params: 'none' },
    { type: 'gather',      params: 'target: block name' },
    { type: 'eat',         params: 'none' },
    { type: 'attack',      params: 'none' },
    { type: 'run_away',    params: 'none' },
    { type: 'craft',       params: 'target: item name' },
    { type: 'place_block', params: 'item, x, y, z' },
    { type: 'set_home',    params: 'none' },
    { type: 'sleep',       params: 'none' },
    { type: 'look_around', params: 'none' },
  ]

  const learned = Object.values(learnedActions).map(a => ({
    type: a.name,
    params: 'compound action',
    description: a.description,
    learned: true
  }))

  return { builtin, learned }
}

// Save learned actions to disk so they persist across sessions
const fs = require('fs')
const SAVE_PATH = './learned_actions.json'

function saveLearnedActions() {
  fs.writeFileSync(SAVE_PATH, JSON.stringify(learnedActions, null, 2))
  console.log(`[REGISTRY] Saved ${Object.keys(learnedActions).length} learned actions`)
}

function loadLearnedActions() {
  if (!fs.existsSync(SAVE_PATH)) return
  const data = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'))
  Object.assign(learnedActions, data)
  console.log(`[REGISTRY] Loaded ${Object.keys(learnedActions).length} learned actions`)
}

module.exports = {
  executeAction,
  registerAction,
  getAvailableActions,
  saveLearnedActions,
  loadLearnedActions
}