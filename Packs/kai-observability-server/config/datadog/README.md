# PAI Datadog Agent Configuration

Custom Datadog Agent checks and configurations for PAI (Personal AI Infrastructure) telemetry.

## Contents

```
datadog/
├── checks.d/
│   └── pai_metrics.py          # Custom check for processing JSONL events
└── conf.d/
    ├── pai_metrics.d/
    │   └── conf.yaml           # Configuration for the metrics check
    └── pai_logs.d/
        └── conf.yaml           # Log tailing configuration
```

## Installation

### Prerequisites

- Datadog Agent installed (`brew install datadog-agent` on macOS)
- Claude Code with PAI hooks configured (writes events to `~/.claude/history/raw-outputs/`)

### Install Custom Check

Copy the custom check to the Datadog Agent checks directory:

```bash
# macOS (Homebrew installation)
sudo cp checks.d/pai_metrics.py /opt/datadog-agent/etc/checks.d/

# Linux
sudo cp checks.d/pai_metrics.py /etc/datadog-agent/checks.d/
```

### Install Configurations

Copy the configuration directories:

```bash
# macOS (Homebrew installation)
sudo cp -r conf.d/pai_metrics.d /opt/datadog-agent/etc/conf.d/
sudo cp -r conf.d/pai_logs.d /opt/datadog-agent/etc/conf.d/

# Linux
sudo cp -r conf.d/pai_metrics.d /etc/datadog-agent/conf.d/
sudo cp -r conf.d/pai_logs.d /etc/datadog-agent/conf.d/
```

### Enable Log Collection

Ensure log collection is enabled in your Datadog Agent configuration (`datadog.yaml`):

```yaml
logs_enabled: true
```

### Restart the Agent

```bash
# macOS
sudo launchctl stop com.datadoghq.agent
sudo launchctl start com.datadoghq.agent

# Or using the agent command
datadog-agent restart
```

## Verification

### Check Status

```bash
datadog-agent status
```

Look for `pai_metrics` in the Checks section.

### Run Check Manually

```bash
datadog-agent check pai_metrics
```

### View Logs

```bash
# macOS
tail -f /opt/datadog-agent/logs/agent.log | grep pai
```

## Customization

### Adjusting Paths

The check has hardcoded paths that may need adjustment for your environment:

In `pai_metrics.py`:
- `CLAUDE_HOME` - Path to your `.claude` directory
- `BASE_TAGS` - Default tags for all metrics (user, env, service)

In `pai_logs.d/conf.yaml`:
- `path` - Glob pattern for JSONL event files
- `tags` - Default tags for log entries

### Collection Interval

The default collection interval is 300 seconds (5 minutes). Adjust in `pai_metrics.d/conf.yaml`:

```yaml
instances:
  - min_collection_interval: 60  # Check every minute
```

## Metrics Emitted

| Metric | Type | Description |
|--------|------|-------------|
| `claude.session.started` | COUNT | Session start events |
| `claude.session.stopped` | COUNT | Session stop events |
| `claude.tool.calls` | COUNT | Tool invocations |
| `claude.subagent.spawned` | COUNT | Subagent (Task) spawns |
| `claude.subagent.duration_ms` | GAUGE | Subagent execution time |
| `claude.subagent.tokens.total` | GAUGE | Total tokens used |
| `claude.subagent.tokens.input` | GAUGE | Input tokens |
| `claude.subagent.tokens.output` | GAUGE | Output tokens |
| `claude.subagent.tokens.cache_read` | GAUGE | Cache read tokens |
| `claude.subagent.tokens.cache_created` | GAUGE | Cache created tokens |
| `claude.subagent.tool_use_count` | GAUGE | Tools called by subagent |
| `claude.skill.invoked` | COUNT | Skill invocations |
| `claude.skill.workflow.triggered` | COUNT | Workflow triggers |
| `claude.events.total` | COUNT | Total events by type |

## Tags

All metrics include these base tags plus event-specific tags:

- `user:pcockwell`
- `env:development`
- `service:claude-code`
- `interface:claude-code|chat-bot|web`
- `source_app:<app-name>`
- `tool_name:<tool>` (for tool metrics)
- `agent_type:<type>` (for subagent metrics)
- `skill_name:<name>` (for skill metrics)
