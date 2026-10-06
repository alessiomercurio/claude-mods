# claude-mods

![workflow-radar showing a live plan and progress above the Claude Code prompt](docs/demo.webp)

Claude Code mods by Alessio Mercurio.

| Plugin | What it does |
| --- | --- |
| **workflow-radar** | Live view of what the model is doing (thinking, writing, tool calls, subagents) in the band above the prompt, plus a `plan` tool the model uses to track multi-step tasks. |
| **token-weather-v2** | A live forecast of the context window in the band above the prompt. |

## Install

In Claude Code:

```
/plugin marketplace add alessiomercurio/claude-mods
/plugin install workflow-radar@alessio-mods
/plugin install token-weather-v2@alessio-mods
```


