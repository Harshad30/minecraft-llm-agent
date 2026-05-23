const { Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

// ─── INTERNAL HELPERS ───────────────────────────────────────────

function getMoves(bot) {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot)
  movements.canDig = true
  movements.digCost = 1
  movements.allowSprinting = true
  movements.allowParkour = true
  movements.canOpenDoors = true
  movements.canSwim = true
  movements.liquidCost = 2
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
  return { mcData, movements }
}

function resetControls(bot) {
  bot.setControlState('forward', false)
  bot.setControlState('back', false)
  bot.setControlState('left', false)
  bot.setControlState('right', false)
  bot.setControlState('jump', false)
  bot.setControlState('sprint', false)
  bot.pathfinder.stop()
}

async function pathTo(bot, x, y, z, range = 2) {
  getMoves(bot)
  await Promise.race([
    bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('path timeout')), 30000))
  ])
}

// ─── MOVEMENT ───────────────────────────────────────────────────

async function explore(bot, direction = 'north') {
  const pos = bot.entity.position

  // Try progressively shorter distances if blocked
  for (const distance of [80, 50, 25]) {
    const targets = {
      north: [pos.x,            pos.y, pos.z - distance],
      south: [pos.x,            pos.y, pos.z + distance],
      east:  [pos.x + distance, pos.y, pos.z           ],
      west:  [pos.x - distance, pos.y, pos.z           ],
    }

    const fallbacks = Object.keys(targets).filter(d => d !== direction)
    const toTry = [direction, ...fallbacks]

    for (const dir of toTry) {
      const [x, y, z] = targets[dir]
      console.log(`[ACTION] Exploring ${dir} (${distance} blocks)`)
      try {
        await pathTo(bot, x, y, z, 5)
        console.log(`[ACTION] Explored ${dir}`)
        return true
      } catch {
        console.log(`[ACTION] Explore ${dir} blocked at ${distance} blocks`)
      }
    }
  }

  console.log(`[ACTION] All directions blocked at all distances`)
  return false
}

async function moveTo(bot, x, y, z) {
  console.log(`[ACTION] Moving to ${x} ${y} ${z}`)
  const dist = bot.entity.position.distanceTo(new Vec3(x, y, z))
  if (dist <= 3) {
    console.log(`[ACTION] Already there`)
    return true
  }
  try {
    await pathTo(bot, x, y, z, 2)
    console.log(`[ACTION] Arrived`)
    return true
  } catch (err) {
    resetControls(bot)
    console.log(`[ACTION] Could not reach: ${err.message}`)
    return false
  }
}

async function returnHome(bot) {
  const memory = bot.getMemory ? bot.getMemory() : null
  const home = memory?.home

  if (!home) {
    console.log(`[ACTION] No home set`)
    return false
  }

  const dist = bot.entity.position.distanceTo(new Vec3(home.x, home.y, home.z))
  console.log(`[ACTION] Returning home — distance: ${Math.round(dist)} blocks`)

  if (dist <= 5) {
    console.log(`[ACTION] Already at home`)
    return true
  }

  // Try walking first if close enough
  if (dist <= 80) {
    try {
      await Promise.race([
        pathTo(bot, home.x, home.y, home.z, 3),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000))
      ])
      console.log(`[ACTION] Walked home`)
      return true
    } catch {
      resetControls(bot)
      console.log(`[ACTION] Walk home failed — teleporting`)
    }
  }

  // Teleport fallback
  const posBefore = bot.entity.position.clone()
  bot.chat(`/tp @s ${home.x} ${home.y} ${home.z}`)
  await new Promise(resolve => setTimeout(resolve, 1500))
  const moved = bot.entity.position.distanceTo(posBefore)
  if (moved > 2) {
    console.log(`[ACTION] Teleported home successfully`)
  } else {
    console.log(`[ACTION] Teleport failed — bot did not move (needs op?)`)
  }
  return true
}

// ─── RESOURCES ──────────────────────────────────────────────────

async function gather(bot, resourceName) {
  const mcData = require('minecraft-data')(bot.version)
  const blockType = mcData.blocksByName[resourceName]

  if (!blockType) {
    console.log(`[ACTION] Unknown block: ${resourceName}`)
    return false
  }

  const memory = bot.getMemory ? bot.getMemory() : null
  const home = memory?.home

  const block = bot.findBlock({
    matching: blockType.id,
    maxDistance: 64,
    useExtraInfo: (b) => {
      if (!home) return true
      const distToHome = b.position.distanceTo(new Vec3(home.x, home.y, home.z))
      return distToHome > 5
    }
  })

  if (!block) {
    console.log(`[ACTION] No ${resourceName} in range`)
    return false
  }

  const dist = block.position.distanceTo(bot.entity.position)
  const distToHome = home ? Math.round(block.position.distanceTo(new Vec3(home.x, home.y, home.z))) : '?'
  console.log(`[ACTION] Gathering ${resourceName} — distance: ${Math.round(dist)}, dist to home: ${distToHome}`)
  // console.log(`[DEBUG] Best tool: ${bot.pathfinder?.bestHarvestTool?.(block)?.name ?? 'none'}`)

  try {
    await Promise.race([
      bot.collectBlock.collect(block),
      new Promise((_, reject) => setTimeout(() => reject(new Error('collect timeout')), 15000))
    ])
    console.log(`[ACTION] Gathered ${resourceName}`)
    return true

  } catch (err) {
    resetControls(bot)
    // console.log(`[DEBUG] collectBlock failed: ${err.message}, trying manual dig...`)

    try {
      await Promise.race([
        pathTo(bot, block.position.x, block.position.y, block.position.z, 2),
        new Promise((_, reject) => setTimeout(() => reject(new Error('path timeout')), 10000))
      ])
      // Re-find block after moving — original reference may be stale
      const freshBlock = bot.blockAt(block.position)
      if (freshBlock && freshBlock.name === resourceName) {
        await bot.dig(freshBlock)
        console.log(`[ACTION] Gathered ${resourceName} via manual dig`)
        return true
      }
    } catch (err2) {
      console.log(`[ACTION] Manual dig also failed: ${err2.message}`)
    }

    const finalDist = block.position.distanceTo(bot.entity.position)
    const inventoryHasItem = bot.inventory.items().some(i => i.name === resourceName)
    if (finalDist <= 5 || inventoryHasItem) {
      console.log(`[ACTION] Gathered ${resourceName} (completed despite error)`)
      return true
    }

    console.log(`[ACTION] Could not gather ${resourceName}`)
    return false
  }
}

// ─── SURVIVAL ───────────────────────────────────────────────────

async function eat(bot) {
  if (bot.food >= 18 && bot.health >= 18) {
    console.log(`[ACTION] Not hungry (${bot.food}/20) — skipping`)
    return false
  }

  const mcData = require('minecraft-data')(bot.version)
  const foodNames = [
    'cooked_beef', 'cooked_chicken', 'cooked_porkchop',
    'cooked_mutton', 'cooked_rabbit', 'cooked_salmon', 'cooked_cod',
    'bread', 'apple', 'carrot', 'baked_potato', 'melon_slice',
    'sweet_berries', 'cookie', 'salmon', 'cod', 'tropical_fish',
    'raw_beef', 'raw_chicken', 'raw_porkchop'
  ]

  for (const name of foodNames) {
    const itemData = mcData.itemsByName[name]
    if (!itemData) continue
    const item = bot.inventory.findInventoryItem(itemData.id)
    if (item) {
      try {
        console.log(`[ACTION] Eating ${name}`)
        await bot.equip(item, 'hand')
        await bot.consume()
        console.log(`[ACTION] Ate ${name}`)
        return true
      } catch (err) {
        console.log(`[ACTION] Eat failed: ${err.message}`)
        return false
      }
    }
  }

  console.log(`[ACTION] No food in inventory`)
  return false
}

async function attack(bot) {
  const hostileTypes = ['zombie', 'skeleton', 'spider', 'enderman', 'witch']
  const hostile = Object.values(bot.entities).find(e =>
    e && e.name && hostileTypes.includes(e.name.toLowerCase()) &&
    e.position && e.position.distanceTo(bot.entity.position) < 16
  )

  if (!hostile) {
    console.log(`[ACTION] No hostile nearby`)
    return false
  }

  const dist = hostile.position.distanceTo(bot.entity.position)
  console.log(`[ACTION] Attacking ${hostile.name} at distance ${Math.round(dist)}`)

  try {
    if (dist > 3) {
      await Promise.race([
        pathTo(bot, hostile.position.x, hostile.position.y, hostile.position.z, 2),
        new Promise((_, reject) => setTimeout(() => reject(new Error('attack path timeout')), 5000))
      ])
    }
    if (!bot.entities[hostile.id]) return false
    await bot.attack(hostile)
    console.log(`[ACTION] Attacked ${hostile.name}`)
    return true
  } catch (err) {
    resetControls(bot)
    console.log(`[ACTION] Attack failed: ${err.message}`)
    return false
  }
}

async function runAway(bot) {
  const hostileTypes = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch']
  const hostiles = Object.values(bot.entities)
    .filter(e => e && e.name && hostileTypes.includes(e.name.toLowerCase()))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))

  if (!hostiles.length) {
    console.log(`[ACTION] Nothing to run from`)
    return false
  }

  bot.pathfinder.stop()
  const nearest = hostiles[0]
  const pos = bot.entity.position
  const dx = pos.x - nearest.position.x
  const dz = pos.z - nearest.position.z
  const len = Math.sqrt(dx * dx + dz * dz) || 1
  bot.entity.yaw = Math.atan2(-dx / len, -dz / len)

  console.log(`[ACTION] Sprinting from ${nearest.name}`)
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  bot.setControlState('jump', true)
  await new Promise(resolve => setTimeout(resolve, 3000))
  bot.setControlState('sprint', false)
  bot.setControlState('forward', false)
  bot.setControlState('jump', false)
  console.log(`[ACTION] Escaped`)
  return true
}

// ─── CRAFTING ───────────────────────────────────────────────────

async function craft(bot, itemName) {
  const { craftItem } = require('./custom_craft')
  console.log(`[ACTION] Crafting ${itemName}`)
  const result = await craftItem(bot, itemName)
  console.log(result ? `[ACTION] Crafted ${itemName}` : `[ACTION] Craft failed for ${itemName}`)
  return result
}

// ─── WORLD INTERACTION ──────────────────────────────────────────

async function placeBlock(bot, itemName, targetX, targetY, targetZ) {
  const mcData = require('minecraft-data')(bot.version)
  const item = bot.inventory.findInventoryItem(mcData.itemsByName[itemName]?.id)
  if (!item) {
    console.log(`[ACTION] No ${itemName} in inventory`)
    return false
  }
  try {
    await bot.equip(item, 'hand')
    const refBlock = bot.blockAt(new Vec3(targetX, targetY - 1, targetZ))
    await bot.placeBlock(refBlock, new Vec3(0, 1, 0))
    console.log(`[ACTION] Placed ${itemName}`)
    return true
  } catch (err) {
    console.log(`[ACTION] Place failed: ${err.message}`)
    return false
  }
}

async function setHome(bot) {
  const memory = bot.getMemory ? bot.getMemory() : null
  if (memory) {
    memory.home = {
      x: Math.round(bot.entity.position.x),
      y: Math.round(bot.entity.position.y),
      z: Math.round(bot.entity.position.z)
    }
    console.log(`[ACTION] Home set at`, memory.home)
  }
  return true
}

async function sleep(bot) {
  const mcData = require('minecraft-data')(bot.version)
  const bed = bot.findBlock({
    matching: Object.values(mcData.blocks).filter(b => b.name.includes('_bed')).map(b => b.id),
    maxDistance: 16
  })
  if (!bed) {
    console.log(`[ACTION] No bed nearby`)
    return false
  }
  try {
    await pathTo(bot, bed.position.x, bed.position.y, bed.position.z, 2)
    await bot.sleep(bed)
    console.log(`[ACTION] Sleeping`)
    return true
  } catch (err) {
    console.log(`[ACTION] Sleep failed: ${err.message}`)
    return false
  }
}

async function lookAround(bot) {
  const pos = bot.entity.position
  const mcData = require('minecraft-data')(bot.version)

  const hostileTypes = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch']
  const entities = Object.values(bot.entities)
    .filter(e => e !== bot.entity && e.position && e.position.distanceTo(pos) < 20)
    .map(e => ({
      type: e.name ?? e.type,
      distance: Math.round(e.position.distanceTo(pos)),
      hostile: hostileTypes.includes(e.name?.toLowerCase())
    }))

  const resourceTypes = ['oak_log', 'birch_log', 'coal_ore', 'iron_ore', 'crafting_table', 'sweet_berries', 'apple']
  const resources = resourceTypes
    .map(name => {
      const block = bot.findBlock({ matching: mcData.blocksByName[name]?.id, maxDistance: 20 })
      return block ? { type: name, distance: Math.round(block.position.distanceTo(pos)) } : null
    })
    .filter(Boolean)

  console.log(`[ACTION] Surroundings:`, JSON.stringify({ entities, resources }, null, 2))

  const hostiles = entities.filter(e => e.hostile)
  if (hostiles.length > 0 && hostiles[0].distance < 10) return await runAway(bot)

  const food = resources.find(r => ['sweet_berries', 'apple'].includes(r.type))
  if (food && bot.food < 16) return await gather(bot, food.type)

  const wood = resources.find(r => ['birch_log', 'oak_log'].includes(r.type))
  if (wood) return await gather(bot, wood.type)

  return await explore(bot, 'north')
}

// ─── DISPATCHER ─────────────────────────────────────────────────

async function executeAction(bot, action) {
  if (!bot || !action) return false
  console.log(`\n[AGENT] Action: ${action.type}`)

  try {
    switch (action.type) {
      case 'explore':     return await explore(bot, action.direction)
      case 'move_to':     return await moveTo(bot, action.x, action.y, action.z)
      case 'return_home': return await returnHome(bot)
      case 'gather':      return await gather(bot, action.target)
      case 'eat':         return await eat(bot)
      case 'attack':      return await attack(bot)
      case 'run_away':    return await runAway(bot)
      case 'craft':       return await craft(bot, action.target)
      case 'place_block': return await placeBlock(bot, action.item, action.x, action.y, action.z)
      case 'set_home':    return await setHome(bot)
      case 'sleep':       return await sleep(bot)
      case 'look_around': return await lookAround(bot)
      default:
        console.log(`[ACTION] Unknown action: ${action.type}`)
        return false
    }
  } catch (err) {
    console.log(`[ACTION] "${action.type}" threw: ${err.message}`)
    return false
  }
}

module.exports = { executeAction }