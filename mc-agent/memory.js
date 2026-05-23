const fs = require('fs')
const MEMORY_PATH = './memory.json'

function loadMemory() {
  if (!fs.existsSync(MEMORY_PATH)) {
    return defaultMemory()
  }
  try {
    return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'))
  } catch {
    console.log('[MEMORY] Corrupt memory file, starting fresh')
    return defaultMemory()
  }
}

function defaultMemory() {
  return {
    // Identity
    session_count: 0,

    // Survival history
    death_count: 0,
    death_locations: [],
    death_causes: [],

    // World knowledge
    home: null,
    known_resources: {},    // { "birch_log": [{x, z, session}] }
    blocked_areas: [],      // areas where movement consistently fails
    explored_directions: {},// { "north": true, "east": false }

    // Inventory history
    best_inventory: [],

    // Behavioral patterns
    successful_actions: {}, // { "gather": 42, "explore": 10 }
    failed_actions: {},     // { "explore_east": 8 }

    // Session notes
    last_session_summary: '',
    total_play_time_ms: 0,
    session_start: null
  }
}

function saveMemory(memory) {
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2))
  } catch (err) {
    console.log('[MEMORY] Save failed:', err.message)
  }
}

function updateMemory(memory, observation, lastAction) {
  // Track successful and failed actions
  if (lastAction) {
    // Ensure these objects exist even on old memory files
    if (!memory.successful_actions) memory.successful_actions = {}
    if (!memory.failed_actions) memory.failed_actions = {}
    const key = lastAction.type === 'explore'
      ? `explore_${lastAction.direction}`
      : lastAction.type

    if (lastAction.success) {
      memory.successful_actions[key] = (memory.successful_actions[key] ?? 0) + 1
    } else {
      memory.failed_actions[key] = (memory.failed_actions[key] ?? 0) + 1
    }
  }

  // Track known resource locations
  const pos = observation.world.position
  for (const resource of observation.nearby_resources ?? []) {
    if (!memory.known_resources[resource.type]) {
      memory.known_resources[resource.type] = []
    }
    // Only store if we dont already have a nearby entry
    const entries = memory.known_resources[resource.type]
    const alreadyKnown = entries.some(e =>
      Math.abs(e.x - pos.x) < 20 && Math.abs(e.z - pos.z) < 20
    )
    if (!alreadyKnown) {
      entries.push({ x: pos.x, z: pos.z, session: memory.session_count })
      // Cap at 10 locations per resource type
      if (entries.length > 10) entries.shift()
    }
  }

  // Track deaths
  // Track deaths separately from home
if (observation.status.health === 0 && !memory._was_dead) {
  memory._was_dead = true
  memory.death_count++

  const pos = observation.world.position
  memory.death_locations.push({
    x: pos.x,
    z: pos.z,
    session: memory.session_count,
    time: new Date().toISOString()
  })

  // Keep last 20 death locations
  if (memory.death_locations.length > 20) memory.death_locations.shift()

  console.log(`[MEMORY] Death #${memory.death_count} recorded at ${pos.x}, ${pos.z}`)
}
if (observation.status.health > 0) {
  memory._was_dead = false
}

  // Track best inventory
  const invSize = observation.inventory?.length ?? 0
  const bestSize = memory.best_inventory?.length ?? 0
  if (invSize > bestSize) {
    memory.best_inventory = observation.inventory
  }

  // Track play time
  if (memory.session_start) {
    memory.total_play_time_ms = (memory.total_play_time_ms ?? 0) +
      (Date.now() - memory.session_start)
  }
  memory.session_start = Date.now()

  return memory
}

// Compress memory into a concise summary for the LLM
function getMemorySummary(memory) {
  const failedActions = Object.entries(memory.failed_actions ?? {})
    .filter(([, count]) => count > 3)
    .map(([action, count]) => `${action}(failed ${count}x)`)

  const knownResources = Object.entries(memory.known_resources ?? {})
    .map(([type, locs]) => `${type}(${locs.length} locations known)`)

  return {
    session: memory.session_count,
    total_deaths: memory.death_count,
    home: memory.home,
    known_resources: knownResources,
    avoid_actions: failedActions,
    best_inventory_achieved: memory.best_inventory,
    last_session: memory.last_session_summary,
    play_time_minutes: Math.round((memory.total_play_time_ms ?? 0) / 60000)
  }
}

function startSession(memory) {
  memory.session_count++
  memory.session_start = Date.now()
  console.log(`[MEMORY] Session ${memory.session_count} started`)
  console.log(`[MEMORY] Deaths so far: ${memory.death_count}`)
  if (memory.last_session_summary) {
    console.log(`[MEMORY] Last session: ${memory.last_session_summary}`)
  }
  return memory
}

function endSession(memory, summary) {
  memory.last_session_summary = summary
  memory.total_play_time_ms = (memory.total_play_time_ms ?? 0) +
    (Date.now() - (memory.session_start ?? Date.now()))
  saveMemory(memory)
  console.log(`[MEMORY] Session ended. Summary: ${summary}`)
}

module.exports = {
  loadMemory,
  saveMemory,
  updateMemory,
  getMemorySummary,
  startSession,
  endSession
}