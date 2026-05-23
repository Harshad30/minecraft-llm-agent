function getObservation(bot) {
  const { Vec3 } = require('vec3')

  // --- Health & Status ---
  const status = {
    health: Math.round(bot.health),
    hunger: Math.round(bot.food),
    saturation: Math.round(bot.foodSaturation),
    experience_level: bot.experience.level,
  }

  // --- Position & World ---
  const pos = bot.entity.position

  // Fix: get home from memory and calculate real distance
  const home = bot.getMemory ? bot.getMemory()?.home : null
  const distToHome = home
    ? Math.round(bot.entity.position.distanceTo(new Vec3(home.x, home.y, home.z)))
    : null

  const world = {
    position: {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      z: Math.round(pos.z)
    },
    biome: bot.blockAt(pos)?.biome?.name ?? 'unknown',
    time_of_day: bot.time.timeOfDay < 6000 ? 'morning' :
                 bot.time.timeOfDay < 12000 ? 'day' :
                 bot.time.timeOfDay < 18000 ? 'evening' : 'night',
    is_raining: bot.isRaining,
    distance_to_home: distToHome,
    at_home: distToHome !== null && distToHome < 5
  }

  // --- Inventory ---
  const inventory = bot.inventory.items().map(item => ({
    name: item.name,
    count: item.count
  }))

  // --- Blocked directions ---
  const directions = {
    north: [pos.x, pos.y, pos.z - 5],
    south: [pos.x, pos.y, pos.z + 5],
    east:  [pos.x + 5, pos.y, pos.z],
    west:  [pos.x - 5, pos.y, pos.z]
  }

  const blocked_directions = []
  for (const [dir, [dx, dy, dz]] of Object.entries(directions)) {
    const block = bot.blockAt(new Vec3(dx, dy, dz))
    const blockAbove = bot.blockAt(new Vec3(dx, dy + 1, dz))
    if (block && block.name !== 'air' && blockAbove && blockAbove.name !== 'air') {
      blocked_directions.push(dir)
    }
  }

  // --- Nearby Entities ---
  const nearby_entities = Object.values(bot.entities)
    .filter(e => e !== bot.entity && e.position && e.position.distanceTo(pos) < 20)
    .map(e => ({
      type: e.name ?? e.type,
      distance: Math.round(e.position.distanceTo(pos)),
      is_hostile: isHostile(e.name)
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10)

  // --- Nearby Blocks / Resources ---
  const resourceTypes = [
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
    'coal_ore', 'iron_ore', 'diamond_ore',
    'crafting_table', 'furnace', 'chest',
    'water', 'lava', 'sweet_berries', 'apple'
  ]

  const mcData = require('minecraft-data')(bot.version)
  const nearby_resources = []

  for (const resourceName of resourceTypes) {
    const blockType = mcData.blocksByName[resourceName]
    if (!blockType) continue

    const block = bot.findBlock({
      matching: blockType.id,
      maxDistance: 20
    })

    if (block) {
      nearby_resources.push({
        type: resourceName,
        distance: Math.round(block.position.distanceTo(pos))
      })
    }
  }

  // --- Danger Assessment ---
  const hostile_nearby = nearby_entities.filter(e => e.is_hostile)
  const danger_level = hostile_nearby.length === 0 ? 'safe' :
                       hostile_nearby.some(e => e.distance < 5) ? 'critical' :
                       hostile_nearby.some(e => e.distance < 10) ? 'dangerous' : 'caution'

  return {
    status,
    world,
    inventory,
    nearby_entities,
    nearby_resources,
    danger_level,
    blocked_directions,
    timestamp: Date.now()
  }
}

function isHostile(name) {
  const hostiles = [
    'zombie', 'skeleton', 'creeper', 'spider',
    'enderman', 'witch', 'pillager', 'phantom'
  ]
  return hostiles.includes(name?.toLowerCase())
}

module.exports = { getObservation }