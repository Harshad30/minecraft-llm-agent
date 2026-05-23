import json
import urllib.request
import os
from dotenv import load_dotenv

load_dotenv(override=True)

# ── CHANGE THIS TO SWITCH MODELS ──
ACTIVE_MODEL = 'claude-haiku'
# Options: 'mistral', 'llama3.2', 'claude-haiku', 'claude-sonnet', 'gpt-4o-mini', 'gpt-4o'

SYSTEM_PROMPT = """You are a Minecraft survival agent with a permanent home base.

HOME BASE:
- Safe house with a crafting table already inside
- Coordinates are saved in your memory
- If at_home is true in observation: you ARE already home — do NOT use return_home
- When at home you can craft immediately

AVAILABLE ACTIONS:
- {"type": "gather", "target": "<block_name>"} — gather nearby block
- {"type": "explore", "direction": "<north|south|east|west>"} — explore a direction
- {"type": "return_home"} — only use if NOT already at home and dist_to_home > 5
- {"type": "eat"} — eat food from inventory
- {"type": "attack"} — attack nearest hostile
- {"type": "run_away"} — flee from danger
- {"type": "craft", "target": "<item_name>"} — craft an item (at home OR using portable crafting table)

SURVIVAL PRIORITIES (follow in order):
1. danger nearby → run_away then return_home
2. health below 15 → return_home immediately
3. hunger below 14 → eat if food available, else gather sweet_berries or apple
4. night or evening AND far from home → return_home
5. night or evening AND at home → craft if materials available
6. daytime and safe → explore and gather resources
7. gathered 15+ items → return_home to process and craft
8. have crafting_table in inventory AND have materials → craft on the go
9. NEVER use eat if hunger is already 18 or above

EXPLORATION:
- Explore freely up to 80 blocks from home during daytime
- When resources are sparse near home, explore farther to find new areas
- Always note your distance from home — if over 60 blocks, prioritize return_home when evening comes
- If far from home when evening starts, return_home immediately
- Prefer unexplored directions over already-visited ones
- Gather any useful resources you pass by

CRAFTING:
- At home: use the built-in crafting table to craft anything
- Away from home: if you have a crafting_table in inventory, craft tools on the go
- Priority crafting order: oak_planks → stick → wooden_pickaxe → wooden_axe → crafting_table (to carry)

COMBAT RULES:
- NEVER attack a creeper — always run_away
- Only attack if health is full and only 1 hostile nearby
- When in doubt → run_away

OUTPUT RULES:
- Respond with ONLY a valid JSON object, no markdown
- Always include a "reason" field
- Example: {"type": "gather", "target": "oak_log", "reason": "need wood for crafting"}"""


def get_unlocked_recipes(inventory: list) -> str:
    """Returns recipe hints progressively based on what the bot has collected"""

    item_names = set(i.get('name', '') for i in inventory)
    recipes = []

    # Tier 0 — always available
    recipes.append("🪵 oak_log or birch_log → craft oak_planks (4 planks per log) — no table needed")

    # Tier 1 — have any logs or planks
    if item_names & {'oak_log', 'birch_log', 'oak_planks', 'birch_planks'}:
        recipes.append("🪵 oak_planks x2 → craft stick x4 — no table needed")
        recipes.append("🪵 oak_planks x4 → craft crafting_table — no table needed (carry it with you!)")

    # Tier 2 — have sticks
    if 'stick' in item_names:
        recipes.append("⛏ oak_planks x3 + stick x2 → craft wooden_pickaxe — needs crafting table")
        recipes.append("🪓 oak_planks x3 + stick x2 → craft wooden_axe — needs crafting table")
        recipes.append("⚔ oak_planks x2 + stick x1 → craft wooden_sword — needs crafting table")
        recipes.append("🔦 coal x1 + stick x1 → craft torch x4 — needs crafting table")

    # Tier 3 — have wooden pickaxe or have mined stone
    if item_names & {'wooden_pickaxe', 'cobblestone', 'stone'}:
        recipes.append("⛏ cobblestone x3 + stick x2 → craft stone_pickaxe — needs crafting table")
        recipes.append("🪓 cobblestone x3 + stick x2 → craft stone_axe — needs crafting table")
        recipes.append("⚔ cobblestone x2 + stick x1 → craft stone_sword — needs crafting table")
        recipes.append("🔥 cobblestone x8 → craft furnace — needs crafting table")

    # Tier 4 — have furnace or coal
    if item_names & {'furnace', 'coal', 'coal_ore'}:
        recipes.append("🍖 raw_beef/chicken/pork + coal in furnace → cooked food (use furnace)")
        recipes.append("🧱 cobblestone in furnace → stone (use furnace)")

    # Tier 5 — have iron ore
    if item_names & {'iron_ore', 'raw_iron', 'iron_ingot'}:
        recipes.append("⚙ iron_ore in furnace → iron_ingot (smelt it!)")
        recipes.append("⛏ iron_ingot x3 + stick x2 → craft iron_pickaxe — needs crafting table")
        recipes.append("🪓 iron_ingot x3 + stick x2 → craft iron_axe — needs crafting table")
        recipes.append("⚔ iron_ingot x2 + stick x1 → craft iron_sword — needs crafting table")
        recipes.append("🛡 iron_ingot x5 → craft iron_chestplate — needs crafting table")

    # Tier 6 — have enough wood for shelter
    oak_count = next((i.get('count', 0) for i in inventory if i.get('name') == 'oak_log'), 0)
    plank_count = next((i.get('count', 0) for i in inventory if i.get('name') == 'oak_planks'), 0)
    if oak_count + plank_count >= 20:
        recipes.append("🏠 oak_planks x many → build walls and shelter (use place_block)")
        recipes.append("🚪 oak_planks x6 → craft door x3 — needs crafting table")
        recipes.append("📦 oak_planks x8 → craft chest — needs crafting table (store items!)")

    # Tier 7 — have diamonds (long term goal hint)
    if item_names & {'diamond', 'diamond_ore'}:
        recipes.append("💎 diamond x3 + stick x2 → craft diamond_pickaxe — needs crafting table")
        recipes.append("💎 diamond x3 + stick x2 → craft diamond_axe — needs crafting table")
        recipes.append("💎 diamond x2 + stick x1 → craft diamond_sword — needs crafting table")

    return '\n'.join(recipes)


def build_prompt(observation: dict, memory: dict, recent_actions: list = None) -> str:
    recent_actions = recent_actions or []

    rules_text = ''
    if memory.get('learned_rules'):
        recent_rules = memory['learned_rules'][-10:]
        rules_text = '\n\nRules learned from experience:\n'
        rules_text += '\n'.join(f"- {r}" for r in recent_rules)

    last_action = memory.get('last_action', {})
    last_action_type = last_action.get('type') if isinstance(last_action, dict) else last_action
    look_around_warning = ''
    if last_action_type == 'return_home':
        look_around_warning = '\nWARNING: You JUST returned home. Do NOT return_home again. Craft or gather instead.'
    elif last_action_type == 'look_around':
        look_around_warning = '\nWARNING: You just used look_around. Take a DIFFERENT real action now.'

    recent_text = ''
    if recent_actions:
        last5 = recent_actions[-5:]
        recent_text = '\n\nYour last 5 actions (learn from these):\n'
        for a in last5:
            status = 'SUCCESS' if a.get('success') else 'FAILED'
            recent_text += f"- {status}: {a['action']} {a.get('target','') or a.get('direction','')} — {a.get('reason','')}\n"

        last3 = [a['action'] for a in recent_actions[-3:]]
        if len(last3) == 3 and len(set(last3)) == 1:
            recent_text += f"\nCRITICAL: You have done '{last3[0]}' 3 times in a row. Choose a completely different action now.\n"

    # Distance to home
    home = memory.get('home', {})
    at_home_warning = ''
    dist_to_home = 999
    at_home = False

    if home:
        pos = observation.get('world', {}).get('position', {})
        if pos:
            dx = pos.get('x', 0) - home.get('x', 0)
            dz = pos.get('z', 0) - home.get('z', 0)
            dist_to_home = (dx**2 + dz**2) ** 0.5
            at_home = dist_to_home < 5

            if at_home:
                at_home_warning = '\nYOU ARE ALREADY AT HOME. Do NOT use return_home. Craft or gather instead.'

    time_of_day = observation.get('world', {}).get('time_of_day', '')
    if time_of_day in ('night', 'evening') and at_home:
        at_home_warning += '\nIt is NIGHT and you are HOME. Stay home. Craft if you have materials, else wait.'
    elif time_of_day in ('night', 'evening') and not at_home:
        at_home_warning += f'\nIt is NIGHT and you are {int(dist_to_home)} blocks from home. Return home immediately!'

    # Progressive recipe unlocking
    inventory = observation.get('inventory', [])
    unlocked_recipes = get_unlocked_recipes(inventory)
    recipe_text = f"\n\nRECIPES YOU HAVE UNLOCKED:\n{unlocked_recipes}"

    return f"""{SYSTEM_PROMPT}{rules_text}{look_around_warning}{at_home_warning}{recipe_text}{recent_text}

Observation:
{json.dumps(observation, indent=2)}

Memory:
{json.dumps(memory, indent=2)}

Respond with only a JSON action object:"""


# ── LOCAL OLLAMA MODELS ──────────────────────────────────────────

def decide_ollama(observation: dict, memory: dict, model: str, recent_actions: list = None) -> dict:
    prompt = build_prompt(observation, memory, recent_actions)

    req = urllib.request.Request(
        'http://localhost:11434/api/generate',
        data=json.dumps({
            'model': model,
            'prompt': prompt,
            'stream': False,
            'format': 'json',
            'options': {
                'temperature': 0.3,
                'num_predict': 80,
                'num_ctx': 2048,
            }
        }).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )

    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        raw = data['response'].strip()

    print(f"[BRAIN] Raw: {raw}")
    return json.loads(raw)


# ── CLAUDE MODELS ────────────────────────────────────────────────

def decide_claude(observation: dict, memory: dict, model: str, recent_actions: list = None) -> dict:
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))

    prompt = build_prompt(observation, memory, recent_actions)

    response = client.messages.create(
        model=model,
        max_tokens=150,
        messages=[{'role': 'user', 'content': prompt}]
    )

    raw = response.content[0].text.strip()
    if raw.startswith('```'):
        raw = raw.split('```')[1]
        if raw.startswith('json'):
            raw = raw[4:]
    raw = raw.strip()

    print(f"[BRAIN] Raw: {raw}")
    return json.loads(raw)


# ── OPENAI MODELS ────────────────────────────────────────────────

def decide_openai(observation: dict, memory: dict, model: str, recent_actions: list = None) -> dict:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

    prompt = build_prompt(observation, memory, recent_actions)

    response = client.chat.completions.create(
        model=model,
        max_tokens=150,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.choices[0].message.content.strip()
    print(f"[BRAIN] Raw: {raw}")
    return json.loads(raw)


# ── REFLECTION ───────────────────────────────────────────────────

def reflect(memory_summary: dict, recent_actions: list) -> list:
    failures = [a for a in recent_actions if not a.get('success')]
    successes = [a for a in recent_actions if a.get('success')]

    prompt = f"""You are reviewing a Minecraft agent's recent actions to extract survival rules.

Failed actions: {[f"{a['action']} {a.get('target','')}" for a in failures]}
Successful actions: {[f"{a['action']} {a.get('target','')}" for a in successes]}

Write 3 short practical rules this agent should follow.
Use ONLY these action names: gather, explore, eat, attack, run_away, craft, return_home

Respond with ONLY a JSON array of 3 strings.
Format: "If [situation], do [action] instead of [other_action]"
Example: ["If gather oak_log fails 2x, explore a new direction first", "If craft fails, check you have enough materials"]

Your response:"""

    try:
        if ACTIVE_MODEL.startswith('claude'):
            import anthropic
            client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))
            response = client.messages.create(
                model='claude-haiku-4-5-20251001',
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}]
            )
            raw = response.content[0].text.strip()
        elif ACTIVE_MODEL.startswith('gpt'):
            from openai import OpenAI
            client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))
            response = client.chat.completions.create(
                model='gpt-4o-mini',
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}]
            )
            raw = response.choices[0].message.content.strip()
        else:
            req = urllib.request.Request(
                'http://localhost:11434/api/generate',
                data=json.dumps({
                    'model': ACTIVE_MODEL,
                    'prompt': prompt,
                    'stream': False,
                    'options': {'temperature': 0.4, 'num_predict': 200}
                }).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=60) as response:
                data = json.loads(response.read())
                raw = data['response'].strip()

        print(f"[BRAIN] Reflection raw: {raw}")
        import re
        match = re.search(r'\[.*?\]', raw, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
            if isinstance(parsed, list):
                VALID_ACTIONS = {'gather', 'explore', 'eat', 'attack', 'run_away', 'craft', 'return_home'}
                return [r for r in parsed if isinstance(r, str) and any(a in r.lower() for a in VALID_ACTIONS)]
        return []
    except Exception as e:
        print(f"[BRAIN] Reflection error: {e}")
        return []


# ── MAIN DECIDE ──────────────────────────────────────────────────

def decide(observation: dict, memory: dict, recent_actions: list = None) -> dict:
    recent_actions = recent_actions or []
    try:
        if ACTIVE_MODEL in ('mistral', 'llama3.2', 'gemma3', 'deepseek-r1'):
            return decide_ollama(observation, memory, ACTIVE_MODEL, recent_actions)
        elif ACTIVE_MODEL.startswith('claude'):
            model_map = {
                'claude-haiku': 'claude-haiku-4-5-20251001',
                'claude-sonnet': 'claude-sonnet-4-6',
            }
            return decide_claude(observation, memory, model_map.get(ACTIVE_MODEL, 'claude-haiku-4-5-20251001'), recent_actions)
        elif ACTIVE_MODEL.startswith('gpt'):
            model_map = {
                'gpt-4o-mini': 'gpt-4o-mini',
                'gpt-4o': 'gpt-4o',
            }
            return decide_openai(observation, memory, model_map.get(ACTIVE_MODEL, 'gpt-4o-mini'), recent_actions)
        else:
            return decide_ollama(observation, memory, ACTIVE_MODEL, recent_actions)
    except Exception as e:
        print(f"[BRAIN] Decision failed: {e}")
        return {"type": "look_around", "reason": "fallback after error"}


if __name__ == "__main__":
    test_obs = {
        "status": {"health": 20, "hunger": 18},
        "world": {"position": {"x": -32, "y": 71, "z": 14}, "time_of_day": "day"},
        "inventory": [{"name": "oak_log", "count": 5}, {"name": "stick", "count": 4}],
        "nearby_resources": [{"type": "oak_log", "distance": 10}],
        "nearby_entities": [],
        "danger_level": "safe"
    }
    test_memory = {"home": {"x": -32, "y": 71, "z": 14}, "known_resources": [], "death_count": 0}
    action = decide(test_obs, test_memory)
    print("Action decided:", action)