# 🤖 Minecraft LLM Agent — Multi-Model Survival Comparison

A research project comparing how different Large Language Models behave as autonomous survival agents in Minecraft. Inspired by [Project Sid (arXiv:2411.00114)](https://arxiv.org/abs/2411.00114) and the PIANO architecture.

> *"Studying behavioral differences under imperfect embodiment"* — the core research question is not whether the agent succeeds, but how differently each LLM reasons about the same survival problem.

---

## 🎯 Research Question

**How do different LLMs behave differently when given the same survival environment, observation data, and action space?**

Rather than measuring raw task completion, this project compares behavioral patterns — decision speed, exploration strategy, resource diversity, home-base adherence, and adaptability — across local and cloud-hosted models.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────┐
│                Minecraft Server (Paper 1.21.11)      │
└──────────────────────┬──────────────────────────────┘
                       │ mineflayer
┌──────────────────────▼──────────────────────────────┐
│                  Bot Layer (Node.js)                 │
│                                                     │
│  ┌─────────────────┐    ┌──────────────────────┐   │
│  │  Reflex Loop    │    │   Decision Loop       │   │
│  │  (every 5s)     │    │   (LLM every cycle)   │   │
│  │                 │    │                      │   │
│  │  • Danger       │───▶│  • Observation        │   │
│  │  • Hunger       │    │  • Memory summary     │   │
│  │  • Stuck detect │    │  • Recent 5 actions   │   │
│  └─────────────────┘    └──────────┬───────────┘   │
│                                    │               │
│  ┌─────────────────────────────────▼─────────────┐ │
│  │             Action Registry                   │ │
│  │  gather │ craft │ explore │ return_home │ eat  │ │
│  └───────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (port 5001)
┌──────────────────────▼──────────────────────────────┐
│                Brain Layer (Python)                 │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐   │
│  │ Mistral  │  │  Claude  │  │  GPT-4o-mini   │   │
│  │ (Ollama) │  │  Haiku   │  │  (OpenAI API)  │   │
│  └──────────┘  └──────────┘  └────────────────┘   │
│                                                     │
│  • Progressive recipe unlocking based on inventory  │
│  • Reflection & rule learning every 15 cycles       │
│  • Recent action history injected every prompt      │
└─────────────────────────────────────────────────────┘
```

### Key Design Decisions

**PIANO-Inspired Dual Loop** — A fast reflex loop (5s) handles immediate threats and hunger while a slow decision loop calls the LLM for all planning decisions. This prevents the LLM from being interrupted mid-action while keeping safety responses instant.

**Custom Crafting System** — Bypasses mineflayer's broken `bot.recipesFor` API with a manual recipe dictionary and direct window slot control. Handles full prerequisite chains automatically: `oak_log → planks → sticks → pickaxe`.

**Progressive Recipe Unlocking** — The LLM only sees recipes it has "unlocked" based on current inventory. Finding iron ore unlocks iron tool recipes. Accumulating wood unlocks shelter recipes. This creates natural progression without hardcoding a goal sequence.

**Persistent Memory + Reflection** — The agent maintains cross-session memory of learned rules and home location. Every 15 action cycles, the LLM reflects on recent successes and failures to generate new behavioral rules.

**Failure-Aware Prompting** — The last 5 actions (with success/failure status) are injected into every prompt. When the same action fails 3× in a row, a CRITICAL warning fires. This dramatically reduces pathological loops.

---

## 📊 Phase 8 — Final Model Comparison Results

Sessions conducted in Peaceful difficulty to isolate resource gathering and crafting behavior from combat variables. Same world seed, same starting inventory (iron axe, iron pickaxe, 16 cooked beef), same system prompt.

| Metric | Claude Haiku | GPT-4o-mini |
|---|---|---|
| Survival time | 32 minutes | 31 minutes |
| Total actions | 302 | 234 |
| Success rate | 15% | 38% |
| Unique items collected | 7 | 8 |
| Distance traveled | 275 blocks | 301 blocks |
| Times returned home | 29 | **49** |
| Avg LLM response | **1,605ms** | 1,834ms |
| Action breakdown | craft(171) gather(58) return_home(29) | craft(108) gather(56) return_home(49) |

### Key Behavioral Findings

**GPT-4o-mini followed the daily cycle more faithfully** — returning home 49 times vs Claude's 29, suggesting GPT weighted the evening/return-home instructions more heavily. Claude showed higher action throughput but more repetitive crafting loops (171 craft actions vs 108).

**Claude was faster but less accurate** — 1,605ms vs 1,834ms per decision, but only 15% success rate vs GPT's 38%. Claude attempted more actions in the same time window, trading accuracy for throughput.

**Both models showed genuine intelligent reasoning** — GPT produced decisions like *"inventory is full but birch_log is only 9 blocks away; will prioritize logs over dirt to make space"* — demonstrating multi-factor reasoning about inventory management, distance, and item priority simultaneously.

**Architecture timing affects model behavior** — Mistral (local, ~19s response) was consistently overridden by the reflex loop designed for cloud APIs (1-3s). This is a genuine finding: hybrid agent architectures must be calibrated for the specific LLM's response latency to avoid reflex dominance suppressing LLM decision-making.

**Important distinction — cognitive vs embodiment failure** — The 15-38% success rates reflect a mix of LLM reasoning errors (cognitive failure) and pathfinding/API limitations (embodiment failure). Future work should separate these to measure true LLM decision quality independent of execution reliability.

---

## 🛠 Tech Stack

| Component | Technology |
|---|---|
| Minecraft server | Paper 1.21.11 |
| Bot framework | mineflayer (Node.js) |
| Pathfinding | mineflayer-pathfinder |
| Block collection | mineflayer-collectblock |
| LLM bridge | HTTP server (Python) |
| Local model | Mistral via Ollama |
| Cloud models | Claude Haiku (Anthropic API), GPT-4o-mini (OpenAI API) |
| Metrics | Custom JSON session logging |

---

## 📁 Project Structure

```
mc-agent/
├── bot.js              # Main agent — PIANO dual-loop architecture
├── actions.js          # Action implementations (gather, craft, explore...)
├── custom_craft.js     # Custom crafting — bypasses broken mineflayer recipe API
├── observation.js      # World state extraction & compression
├── memory.js           # Persistent cross-session memory
├── bridge.js           # Node→Python HTTP bridge
├── metrics.js          # Session metrics tracking & JSON export
├── actionRegistry.js   # Action dispatcher with learned action support
├── package.json

mc-agent-brain/
├── brain.py            # LLM decision making — all three models
├── server.py           # HTTP server (/decide and /reflect endpoints)
├── requirements.txt

metrics/                # Session data (research output)
├── claude-haiku_session_*.json
├── gpt-4o-mini_session_*.json
└── mistral_session_*.json

README.md
.gitignore
```

---

## 🚀 Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- Minecraft Paper server 1.21.11
- Ollama (for Mistral local model)
- Anthropic API key (for Claude Haiku)
- OpenAI API key (for GPT-4o-mini)

### Installation

```bash
# Bot
cd mc-agent
npm install

# Brain
cd mc-agent-brain
pip install -r requirements.txt
```

### Configuration

Create `mc-agent-brain/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

Set active model in `brain.py`:
```python
ACTIVE_MODEL = 'claude-haiku'  # or 'gpt-4o-mini', 'mistral'
```

Set matching model name in `metrics.js`:
```javascript
const MODEL_NAME = 'claude-haiku'
```

### Running

```bash
# Terminal 1 — Brain server
cd mc-agent-brain
python server.py

# Terminal 2 — Bot
cd mc-agent
node bot.js
```

### Reset between sessions

```bash
node -e "const fs=require('fs');const m={session_count:0,death_count:0,death_locations:[],home:{x:-32,y:71,z:14},home_is_fixed:true,known_resources:{},successful_actions:{},failed_actions:{},learned_rules:[],last_session_summary:'',total_play_time_ms:0,last_action:{}};fs.writeFileSync('./memory.json',JSON.stringify(m,null,2));console.log('Reset done');"
```

In-game setup:
```
op AgentBot
clear AgentBot
tp AgentBot -32 71 14
give AgentBot minecraft:iron_axe
give AgentBot minecraft:iron_pickaxe
give AgentBot minecraft:cooked_beef 16
time set 1000
```

---

## 🔬 Limitations & Future Work

### Current Limitations

**Movement reliability** — mineflayer-pathfinder has known compatibility issues with Minecraft 1.21.x physics, particularly around height transitions and water bodies. Actions are more reliable on flat terrain.

**Cognitive vs embodiment failure conflation** — Current success metrics mix LLM reasoning errors with pathfinding/API failures. A verified-action layer with explicit postconditions would separate these cleanly.

**Reflex-LLM timing mismatch** — Local models (~19s response) are overridden by the reflex loop before decisions execute. Architectures should dynamically adjust reflex timing based on measured LLM latency.

### Planned Future Work

**Verified action layer** — Every action produces explicit postconditions. `craft wooden_pickaxe` verifies `inventory.contains("wooden_pickaxe")` after execution. Failures are classified as cognitive (bad reasoning) or embodiment (execution failure).

**Behavioral metrics** — Track exploration radius entropy, resource diversity, territorial behavior, retry persistence, and idle ratio. These reveal personality differences between models more clearly than success counts.

**Spatial map memory** — Agents maintain a simple `known_locations = {wood: [...], coal: [...], danger: [...]}` that persists across sessions. This enables long-horizon planning and revisit avoidance.

**Phase 9 — Multi-agent persistent world** — Multiple bots with different LLM brains in the same world simultaneously. Study emergent territoriality, resource competition, specialization, and whether communication actions emerge.

**Controlled scarcity experiments** — Remove nearby resources to study exploration adaptation and risk tolerance. Aligns with ecological foraging theory.

**Movement heatmaps & replay** — Top-down visualization of agent paths with action annotations. Makes behavioral differences immediately visible.

---

## 📚 References

- [Project Sid: Many-agent simulations toward AI civilization (arXiv:2411.00114)](https://arxiv.org/abs/2411.00114)
- [PIANO: Parallel Individualized Agents with Non-verbal cOmmunication](https://arxiv.org/abs/2411.00114)
- [mineflayer documentation](https://github.com/PrismarineJS/mineflayer)
- [Mindcraft — LLM agents in Minecraft](https://github.com/mindcraft-bots/mindcraft)

---

## 👤 Author

Built as a research exploration into LLM behavioral differences in constrained survival environments.

*Sessions conducted in Peaceful difficulty. All models received identical prompts, world conditions, and starting inventory.*