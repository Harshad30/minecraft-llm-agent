const fs = require('fs')

const METRICS_DIR = './metrics'
const MODEL_NAME = 'claude-haiku'// change when you swap models

if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR)

function startMetrics(sessionId) {
  return {
    session_id: sessionId,
    model: MODEL_NAME,
    start_time: Date.now(),
    end_time: null,
    survival_time_ms: 0,

    // Progression
    unique_items: new Set(),
    total_items_collected: 0,
    items_timeline: [],

    // Track last known inventory to detect NEW items only
    _last_inventory_snapshot: {},

    // Actions
    total_actions: 0,
    successful_actions: 0,
    action_counts: {},
    action_log: [],

    // Movement
    positions: [],
    distance_traveled: 0,
    last_position: null,

    // Survival
    deaths: 0,
    low_health_events: 0,
    times_returned_home: 0,

    // LLM
    total_llm_calls: 0,
    total_llm_time_ms: 0,
    avg_llm_response_ms: 0,
  }
}

function recordAction(metrics, action, success, observation, llmTimeMs) {
  metrics.total_actions++
  if (success) metrics.successful_actions++

  metrics.action_counts[action.type] = (metrics.action_counts[action.type] ?? 0) + 1

  if (action.type === 'return_home' && success) metrics.times_returned_home++

  metrics.total_llm_calls++
  metrics.total_llm_time_ms += llmTimeMs
  metrics.avg_llm_response_ms = Math.round(metrics.total_llm_time_ms / metrics.total_llm_calls)

  metrics.action_log.push({
    time_ms: Date.now() - metrics.start_time,
    action: action.type,
    target: action.target ?? action.direction ?? null,
    reason: action.reason,
    success,
    health: observation.status.health,
    hunger: observation.status.hunger,
    danger: observation.danger_level,
    llm_ms: llmTimeMs
  })
}

function recordInventory(metrics, items) {
  // Build current inventory snapshot
  const current = {}
  for (const item of items) {
    current[item.name] = (current[item.name] ?? 0) + item.count
  }

  // Compare with last snapshot to find new items and count increases
  for (const [name, count] of Object.entries(current)) {
    const prevCount = metrics._last_inventory_snapshot[name] ?? 0

    // Track unique item types
    if (!metrics.unique_items.has(name)) {
      metrics.unique_items.add(name)
      metrics.items_timeline.push({
        time_ms: Date.now() - metrics.start_time,
        item: name,
        unique_count: metrics.unique_items.size
      })
      console.log(`[METRICS] New item: ${name} (${metrics.unique_items.size} unique total)`)
    }

    // Only count NET NEW items gathered (count increases)
    if (count > prevCount) {
      metrics.total_items_collected += count - prevCount
    }
  }

  // Update snapshot
  metrics._last_inventory_snapshot = current
}

function recordPosition(metrics, position) {
  const pos = { x: position.x, y: position.y, z: position.z }

  if (metrics.last_position) {
    const dx = pos.x - metrics.last_position.x
    const dz = pos.z - metrics.last_position.z
    metrics.distance_traveled += Math.sqrt(dx * dx + dz * dz)
  }

  metrics.last_position = pos
  metrics.positions.push({
    time_ms: Date.now() - metrics.start_time,
    ...pos
  })
}

function recordDeath(metrics) {
  metrics.deaths++
  console.log(`[METRICS] Death recorded. Total: ${metrics.deaths}`)
}

function recordLowHealth(metrics) {
  metrics.low_health_events++
}

function endMetrics(metrics) {
  metrics.end_time = Date.now()
  metrics.survival_time_ms = metrics.end_time - metrics.start_time

  const output = {
    ...metrics,
    unique_items: Array.from(metrics.unique_items),
    unique_item_count: metrics.unique_items.size,
    survival_time_minutes: Math.round(metrics.survival_time_ms / 60000),
    action_success_rate: metrics.total_actions > 0
      ? Math.round((metrics.successful_actions / metrics.total_actions) * 100)
      : 0,
  }

  // Remove internal tracking fields from output
  delete output.last_position
  delete output._last_inventory_snapshot

  const filename = `${METRICS_DIR}/${MODEL_NAME}_session_${metrics.session_id}_${Date.now()}.json`
  fs.writeFileSync(filename, JSON.stringify(output, null, 2))
  console.log(`[METRICS] Saved to ${filename}`)

  console.log('\n[METRICS] ═══════ SESSION SUMMARY ═══════')
  console.log(`[METRICS] Model: ${MODEL_NAME}`)
  console.log(`[METRICS] Survival time: ${output.survival_time_minutes} minutes`)
  console.log(`[METRICS] Unique items: ${output.unique_item_count}`)
  console.log(`[METRICS] Total items gathered: ${output.total_items_collected}`)
  console.log(`[METRICS] Total actions: ${output.total_actions}`)
  console.log(`[METRICS] Success rate: ${output.action_success_rate}%`)
  console.log(`[METRICS] Distance traveled: ${Math.round(output.distance_traveled)} blocks`)
  console.log(`[METRICS] Deaths: ${output.deaths}`)
  console.log(`[METRICS] Times returned home: ${output.times_returned_home}`)
  console.log(`[METRICS] Avg LLM response: ${output.avg_llm_response_ms}ms`)
  console.log(`[METRICS] Action breakdown:`, output.action_counts)
  console.log('[METRICS] ════════════════════════════════')

  return output
}

module.exports = {
  startMetrics,
  recordAction,
  recordInventory,
  recordPosition,
  recordDeath,
  recordLowHealth,
  endMetrics
}