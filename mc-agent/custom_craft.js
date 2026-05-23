const { goals, Movements } = require('mineflayer-pathfinder')

// Complete recipe database
const RECIPES = {
  'oak_planks':     { ingredients: {'oak_log': 1}, result: 4, needsTable: false, shape: [[0]] },
  'stick':          { ingredients: {'oak_planks': 2}, result: 4, needsTable: false, shape: [[0],[0]] },
  'crafting_table': { ingredients: {'oak_planks': 4}, result: 1, needsTable: false, shape: [[0,0],[0,0]] },
  'wooden_pickaxe': { ingredients: {'oak_planks': 3, 'stick': 2}, result: 1, needsTable: true,
    shape: [[0,0,0],[null,1,null],[null,1,null]] },
  'wooden_axe':     { ingredients: {'oak_planks': 3, 'stick': 2}, result: 1, needsTable: true,
    shape: [[0,0,null],[0,1,null],[null,1,null]] },
  'wooden_sword':   { ingredients: {'oak_planks': 2, 'stick': 1}, result: 1, needsTable: true,
    shape: [[0,null,null],[0,null,null],[1,null,null]] },
  'stone_pickaxe':  { ingredients: {'cobblestone': 3, 'stick': 2}, result: 1, needsTable: true,
    shape: [[0,0,0],[null,1,null],[null,1,null]] },
  'furnace':        { ingredients: {'cobblestone': 8}, result: 1, needsTable: true,
    shape: [[0,0,0],[0,null,0],[0,0,0]] },
  'torch':          { ingredients: {'coal': 1, 'stick': 1}, result: 4, needsTable: false,
    shape: [[0],[1]] },
  'chest':          { ingredients: {'oak_planks': 8}, result: 1, needsTable: true,
    shape: [[0,0,0],[0,null,0],[0,0,0]] },
  'wooden_shovel':  { ingredients: {'oak_planks': 1, 'stick': 2}, result: 1, needsTable: true,
    shape: [[0,null,null],[1,null,null],[1,null,null]] },
  'wooden_hoe':     { ingredients: {'oak_planks': 2, 'stick': 2}, result: 1, needsTable: true,
    shape: [[0,0,null],[null,1,null],[null,1,null]] },
}

async function hasIngredients(bot, recipe) {
  const mcData = require('minecraft-data')(bot.version)
  for (const [ingredient, needed] of Object.entries(recipe.ingredients)) {
    const have = bot.inventory.items()
      .filter(i => i.name === ingredient)
      .reduce((sum, i) => sum + i.count, 0)
    if (have < needed) return false
  }
  return true
}

async function craftItem(bot, itemName, depth = 0) {
  if (depth > 6) return false

  const recipe = RECIPES[itemName]
  if (!recipe) {
    console.log(`[CRAFT] No recipe for: ${itemName}`)
    return false
  }

  console.log(`${'  '.repeat(depth)}[CRAFT] Crafting: ${itemName}`)

  // Craft prerequisites
  for (const [ingredient, needed] of Object.entries(recipe.ingredients)) {
    const have = bot.inventory.items()
      .filter(i => i.name === ingredient)
      .reduce((sum, i) => sum + i.count, 0)

    if (have < needed) {
      console.log(`${'  '.repeat(depth)}[CRAFT] Need ${needed} ${ingredient}, have ${have}`)
      const success = await craftItem(bot, ingredient, depth + 1)
      if (!success) {
        console.log(`${'  '.repeat(depth)}[CRAFT] Cannot get ${ingredient}`)
        return false
      }
    }
  }

  // Execute the craft
  try {
    if (recipe.needsTable) {
      return await craftWithTable(bot, itemName, recipe)
    } else {
      return await craftInInventory(bot, itemName, recipe)
    }
  } catch (err) {
    console.log(`[CRAFT] Error: ${err.message}`)
    return false
  }
}

async function craftInInventory(bot, itemName, recipe) {
  const mcData = require('minecraft-data')(bot.version)
  const item = mcData.itemsByName[itemName]
  if (!item) return false

  // Try mineflayer craft first
  const recipes = bot.recipesFor(item.id, null, 1, null)
  if (recipes.length) {
    await bot.craft(recipes[0], 1, null)
    console.log(`[CRAFT] ✓ Crafted ${itemName} in inventory`)
    return true
  }

  console.log(`[CRAFT] No mineflayer recipe for ${itemName} — trying manual`)
  return false
}

async function craftWithTable(bot, itemName, recipe) {
  const mcData = require('minecraft-data')(bot.version)

  const tableBlock = bot.findBlock({
    matching: mcData.blocksByName['crafting_table']?.id,
    maxDistance: 16
  })

  if (!tableBlock) {
    console.log(`[CRAFT] No crafting table nearby`)
    return false
  }

  // Path to table
  const movements = new Movements(bot)
  bot.pathfinder.setMovements(movements)

  await Promise.race([
    bot.pathfinder.goto(new goals.GoalNear(
      tableBlock.position.x,
      tableBlock.position.y,
      tableBlock.position.z, 2
    )),
    new Promise((_, reject) => setTimeout(() => reject(new Error('path timeout')), 15000))
  ])

  await new Promise(resolve => setTimeout(resolve, 500))

  // Re-find table after moving
  const fresh = bot.findBlock({
    matching: mcData.blocksByName['crafting_table']?.id,
    maxDistance: 4
  })

  if (!fresh) {
    console.log(`[CRAFT] Lost table after moving`)
    return false
  }

  const item = mcData.itemsByName[itemName]
  if (!item) return false

  // Try bot.craft passing fresh block directly
  const recipes = bot.recipesFor(item.id, null, 1, fresh)
  console.log(`[CRAFT] Recipes found: ${recipes.length}`)

  if (recipes.length) {
    try {
      await bot.craft(recipes[0], 1, fresh)
      console.log(`[CRAFT] ✓ Crafted ${itemName}`)
      return true
    } catch (err) {
      console.log(`[CRAFT] bot.craft failed: ${err.message}`)
    }
  }

  // Fallback to manual
  console.log(`[CRAFT] Falling back to manual slot placement`)
  return await manualCraft(bot, fresh, itemName, recipe, mcData)
}

async function manualCraft(bot, tableBlock, itemName, recipe, mcData) {
  try {
    const window = await bot.openBlock(tableBlock)
    await new Promise(resolve => setTimeout(resolve, 500))

    console.log(`[CRAFT] Window opened, slots:`, window.slots.length)

    const ingredientNames = Object.keys(recipe.ingredients)
    const shape = recipe.shape

    // Place items in crafting grid using clickWindow
    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row].length; col++) {
        const ingredientIdx = shape[row][col]
        if (ingredientIdx === null || ingredientIdx === undefined) continue

        const ingredientName = ingredientNames[ingredientIdx]
        const invItem = bot.inventory.findInventoryItem(
          mcData.itemsByName[ingredientName]?.id
        )

        if (!invItem) {
          console.log(`[CRAFT] Missing ingredient: ${ingredientName}`)
          await bot.closeWindow(window)
          return false
        }

        const craftSlot = row * 3 + col + 1  // 1-9
        console.log('[CRAFT] Initial window slots:')
        window.slots.forEach((slot, i) => {
        if (slot) console.log(`  Slot ${i}: ${slot.name} x${slot.count}`)
        })

        // Click ingredient in inventory to pick it up
        await bot.clickWindow(invItem.slot, 0, 0)
        await new Promise(resolve => setTimeout(resolve, 200))

        // Click crafting slot to place 1
        await bot.clickWindow(craftSlot, 1, 0)  // right click places 1
        await new Promise(resolve => setTimeout(resolve, 200))

        // If still holding items, put back
        if (bot.inventory.selectedItem) {
          await bot.clickWindow(invItem.slot, 0, 0)
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
    console.log('[CRAFT] All slots after placing:')
    window.slots.forEach((slot, i) => {
    if (slot) console.log(`  Slot ${i}: ${slot.name} x${slot.count}`)
    })

    // Take result from slot 0
    const resultSlot = window.slots[0]
    console.log(`[CRAFT] Result slot:`, resultSlot?.name)

    if (resultSlot) {
      await bot.clickWindow(0, 0, 0)  // left click to take result
      await new Promise(resolve => setTimeout(resolve, 300))
      console.log(`[CRAFT] ✓ Manual craft succeeded: ${itemName}`)
      await bot.closeWindow(window)
      return true
    }

    await bot.closeWindow(window)
    console.log(`[CRAFT] No result appeared in slot 0`)
    return false

  } catch (err) {
    console.log(`[CRAFT] Manual craft error: ${err.message}`)
    return false
  }
}
module.exports = { craftItem, RECIPES }