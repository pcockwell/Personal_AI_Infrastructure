#!/usr/bin/env python3
"""
Datadog Custom Check: PAI (Personal AI Infrastructure) Metrics

This unified check processes Claude Code hook events from raw JSONL files
and ships comprehensive telemetry to Datadog.

Supports multiple event files per day with timestamp-based watermarking
and event deduplication for reliable metrics across CLI and chatbot sessions.

Metrics submitted:
- claude.session.started (COUNT) - Session starts
- claude.session.stopped (COUNT) - Session completions
- claude.tool.calls (COUNT) - Tool invocations
- claude.subagent.spawned (COUNT) - Subagent spawns
- claude.subagent.duration_ms (GAUGE) - Execution time
- claude.subagent.tokens.total (GAUGE) - Total tokens
- claude.subagent.tokens.input (GAUGE) - Input tokens
- claude.subagent.tokens.output (GAUGE) - Output tokens
- claude.subagent.tokens.cache_read (GAUGE) - Cache read tokens
- claude.subagent.tokens.cache_created (GAUGE) - Cache created tokens
- claude.subagent.tool_use_count (GAUGE) - Tools called by agent
- claude.skill.invoked (COUNT) - Skill invocations (once per skill per session)
- claude.skill.workflow.triggered (COUNT) - Workflow triggers
- claude.events.total (COUNT) - Total events by type

Tags:
- interface: claude-code | chat-bot | web (detected from session_id suffix or payload.source_app)
- source_app: Agent/app name (Tera, Explore, etc.)
- tool_name: Tool being called
- agent_type: Subagent type for Task tool calls
- skill_name: Name of the skill (PascalCase)
- skill_category: user | project
- workflow_name: Name of the workflow (PascalCase)
"""

import json
import os
from datetime import datetime
from pathlib import Path
from collections import defaultdict

try:
    from datadog_checks.base import AgentCheck
except ImportError:
    # Fallback for testing
    class AgentCheck:
        def __init__(self):
            pass
        def gauge(self, *args, **kwargs):
            pass
        def count(self, *args, **kwargs):
            pass
        class log:
            @staticmethod
            def debug(*args, **kwargs):
                pass
            @staticmethod
            def info(*args, **kwargs):
                pass
            @staticmethod
            def warning(*args, **kwargs):
                pass
            @staticmethod
            def error(*args, **kwargs):
                pass


class PaiMetricsCheck(AgentCheck):
    """Unified check for all PAI/Claude Code metrics."""

    # Base path for Claude data (hardcoded since agent runs as root)
    CLAUDE_HOME = Path("/Users/pcockwell/.claude")
    RAW_OUTPUTS_DIR = CLAUDE_HOME / "history" / "raw-outputs"
    STATE_FILE = CLAUDE_HOME / "metrics" / ".pai-metrics-last-processed"

    # Base tags for all metrics
    BASE_TAGS = ["user:pcockwell", "env:development", "service:claude-code"]

    def __init__(self, name, init_config, instances):
        super(PaiMetricsCheck, self).__init__(name, init_config, instances)

    def get_last_processed_timestamp(self):
        """Get the last processed event timestamp (milliseconds)."""
        if not self.STATE_FILE.exists():
            return 0

        try:
            with open(self.STATE_FILE, 'r') as f:
                state = json.load(f)
                # Support new format
                if 'last_processed_timestamp' in state:
                    return state['last_processed_timestamp']
                # Migration from old format: return 0 to reprocess
                # (old format had file paths as keys)
                if any(isinstance(k, str) and '/' in k for k in state.keys()):
                    self.log.info("Migrating from old state format, will reprocess all events")
                    return 0
                return 0
        except Exception as e:
            self.log.warning(f"Failed to read state file: {e}")
            return 0

    def update_last_processed_timestamp(self, timestamp):
        """Update the last processed event timestamp (milliseconds)."""
        try:
            self.STATE_FILE.parent.mkdir(parents=True, exist_ok=True)

            state = {'last_processed_timestamp': timestamp}

            with open(self.STATE_FILE, 'w') as f:
                json.dump(state, f)

        except Exception as e:
            self.log.error(f"Failed to update state file: {e}")

    def get_events_files_since(self, watermark_ts):
        """Find all event files that may contain events after watermark."""
        files = []

        if not self.RAW_OUTPUTS_DIR.exists():
            self.log.debug(f"Raw outputs directory does not exist: {self.RAW_OUTPUTS_DIR}")
            return files

        # Walk all month directories in raw-outputs (YYYY-MM format)
        for month_dir in self.RAW_OUTPUTS_DIR.glob("????-??"):
            if not month_dir.is_dir():
                continue

            # Find all .jsonl files (any naming pattern)
            for jsonl_file in month_dir.glob("*.jsonl"):
                try:
                    # Check if file was modified after watermark
                    mtime = jsonl_file.stat().st_mtime * 1000
                    if mtime > watermark_ts:
                        files.append(jsonl_file)
                except Exception as e:
                    self.log.warning(f"Failed to stat file {jsonl_file}: {e}")
                    continue

        # Sort by filename (which typically includes date) for consistent ordering
        return sorted(files, key=lambda p: p.name)

    def get_event_id(self, event):
        """Extract unique ID for deduplication."""
        payload = event.get('payload', {})

        # Use invocation_id for skill/workflow events
        if 'invocation_id' in payload:
            return payload['invocation_id']

        # Fallback: timestamp + event_type + session_id + tool_name (if present)
        ts = event.get('timestamp', 0)
        event_type = event.get('hook_event_type', '')
        session_id = event.get('session_id', '')
        tool_name = payload.get('tool_name', '')

        return f"{ts}-{event_type}-{session_id}-{tool_name}"

    def read_all_new_events(self, files, watermark_ts):
        """Read and merge events from multiple files, deduplicating by event ID."""
        seen_ids = set()
        events = []
        max_timestamp = watermark_ts

        for events_file in files:
            try:
                with open(events_file, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            event = json.loads(line)
                            event_ts = event.get('timestamp', 0)

                            # Skip events at or before watermark
                            if event_ts <= watermark_ts:
                                continue

                            # Deduplicate by event ID
                            event_id = self.get_event_id(event)
                            if event_id in seen_ids:
                                self.log.debug(f"Skipping duplicate event: {event_id}")
                                continue
                            seen_ids.add(event_id)

                            events.append(event)
                            max_timestamp = max(max_timestamp, event_ts)

                        except json.JSONDecodeError as e:
                            self.log.warning(f"Skipping malformed JSON in {events_file}: {e}")
                            continue

            except Exception as e:
                self.log.error(f"Error reading events file {events_file}: {e}")
                continue

        return events, max_timestamp

    def aggregate_events(self, events):
        """Aggregate events into metrics."""
        metrics = {
            'sessions_started': defaultdict(int),
            'sessions_stopped': defaultdict(int),
            'tool_calls': defaultdict(int),
            'subagents_spawned': defaultdict(int),
            'subagent_data': [],  # List of dicts with agent stats
            'skills_invoked': defaultdict(int),
            'workflows_triggered': defaultdict(int),
            'events_by_type': defaultdict(int),
        }

        for event in events:
            event_type = event.get('hook_event_type')
            source_app = event.get('source_app', 'unknown')
            permission_mode = event.get('permission_mode', 'unknown')

            # Determine interface type (claude-code, chat-bot, web)
            session_id = event.get('session_id', '')
            payload = event.get('payload', {})
            if session_id.endswith('-chatbot') or payload.get('source_app') == 'claude-chatbot':
                interface = 'chat-bot'
            elif session_id.endswith('-web') or payload.get('source_app') == 'claude-web':
                interface = 'web'
            else:
                interface = 'claude-code'

            # Track all events by type
            metrics['events_by_type'][event_type] += 1

            if event_type == 'SessionStart':
                session_key = (source_app, interface)
                metrics['sessions_started'][session_key] += 1

            elif event_type == 'Stop':
                session_key = (source_app, interface)
                metrics['sessions_stopped'][session_key] += 1

            elif event_type in ('PreToolUse', 'PostToolUse'):
                tool_name = payload.get('tool_name', 'unknown')

                # Count tool calls (use PostToolUse only to avoid double-counting)
                if event_type == 'PostToolUse':
                    tool_key = (tool_name, source_app, permission_mode, interface)
                    metrics['tool_calls'][tool_key] += 1

                    # Check for subagent spawns
                    if tool_name == 'Task':
                        tool_input = payload.get('tool_input', {})
                        tool_response = payload.get('tool_response', {})

                        agent_type = tool_input.get('subagent_type', 'unknown')
                        agent_key = (agent_type, source_app, interface)

                        metrics['subagents_spawned'][agent_key] += 1

                        # Collect detailed stats if available
                        if isinstance(tool_response, dict):
                            usage = tool_response.get('usage', {})
                            metrics['subagent_data'].append({
                                'agent_type': agent_type,
                                'source_app': source_app,
                                'interface': interface,
                                'duration_ms': tool_response.get('totalDurationMs'),
                                'total_tokens': tool_response.get('totalTokens'),
                                'input_tokens': usage.get('input_tokens'),
                                'output_tokens': usage.get('output_tokens'),
                                'cache_read_tokens': usage.get('cache_read_input_tokens'),
                                'cache_created_tokens': usage.get('cache_creation_input_tokens'),
                                'tool_use_count': tool_response.get('totalToolUseCount'),
                            })

            elif event_type == 'SkillInvoked':
                skill_name = payload.get('skill_name', 'unknown')
                skill_category = payload.get('skill_category', 'unknown')
                skill_key = (skill_name, skill_category, interface)
                metrics['skills_invoked'][skill_key] += 1

            elif event_type == 'WorkflowTriggered':
                skill_name = payload.get('skill_name', 'unknown')
                workflow_name = payload.get('workflow_name', 'unknown')
                workflow_key = (skill_name, workflow_name, interface)
                metrics['workflows_triggered'][workflow_key] += 1

        return metrics

    def submit_metrics(self, metrics):
        """Submit aggregated metrics to Datadog."""
        base_tags = self.BASE_TAGS.copy()

        # Session metrics
        for (source_app, interface), count in metrics['sessions_started'].items():
            tags = base_tags + [f'source_app:{source_app}', f'interface:{interface}']
            self.count('claude.session.started', count, tags=tags)

        for (source_app, interface), count in metrics['sessions_stopped'].items():
            tags = base_tags + [f'source_app:{source_app}', f'interface:{interface}']
            self.count('claude.session.stopped', count, tags=tags)

        # Tool call metrics
        for (tool_name, source_app, permission_mode, interface), count in metrics['tool_calls'].items():
            tags = base_tags + [
                f'tool_name:{tool_name}',
                f'source_app:{source_app}',
                f'permission_mode:{permission_mode}',
                f'interface:{interface}'
            ]
            self.count('claude.tool.calls', count, tags=tags)

        # Subagent spawn counts
        for (agent_type, source_app, interface), count in metrics['subagents_spawned'].items():
            tags = base_tags + [
                f'agent_type:{agent_type}',
                f'source_app:{source_app}',
                f'interface:{interface}'
            ]
            self.count('claude.subagent.spawned', count, tags=tags)

        # Subagent detailed metrics (gauges for each invocation)
        for data in metrics['subagent_data']:
            tags = base_tags + [
                f"agent_type:{data['agent_type']}",
                f"source_app:{data['source_app']}",
                f"interface:{data.get('interface', 'claude-code')}"
            ]

            if data.get('duration_ms') is not None:
                self.gauge('claude.subagent.duration_ms', data['duration_ms'], tags=tags)

            if data.get('total_tokens') is not None:
                self.gauge('claude.subagent.tokens.total', data['total_tokens'], tags=tags)

            if data.get('input_tokens') is not None:
                self.gauge('claude.subagent.tokens.input', data['input_tokens'], tags=tags)

            if data.get('output_tokens') is not None:
                self.gauge('claude.subagent.tokens.output', data['output_tokens'], tags=tags)

            if data.get('cache_read_tokens') is not None:
                self.gauge('claude.subagent.tokens.cache_read', data['cache_read_tokens'], tags=tags)

            if data.get('cache_created_tokens') is not None:
                self.gauge('claude.subagent.tokens.cache_created', data['cache_created_tokens'], tags=tags)

            if data.get('tool_use_count') is not None:
                self.gauge('claude.subagent.tool_use_count', data['tool_use_count'], tags=tags)

        # Skill invocations
        for (skill_name, skill_category, interface), count in metrics['skills_invoked'].items():
            tags = base_tags + [
                f'skill_name:{skill_name}',
                f'skill_category:{skill_category}',
                f'interface:{interface}'
            ]
            self.count('claude.skill.invoked', count, tags=tags)

        # Workflow triggers
        for (skill_name, workflow_name, interface), count in metrics['workflows_triggered'].items():
            tags = base_tags + [
                f'skill_name:{skill_name}',
                f'workflow_name:{workflow_name}',
                f'interface:{interface}'
            ]
            self.count('claude.skill.workflow.triggered', count, tags=tags)

        # Event type counts
        for event_type, count in metrics['events_by_type'].items():
            tags = base_tags + [f'hook_event_type:{event_type}']
            self.count('claude.events.total', count, tags=tags)

    def check(self, instance):
        """
        Main check method called by the Datadog Agent periodically.

        Reads new events from all JSONL files since last watermark and submits metrics.
        """
        try:
            # Get last processed timestamp
            watermark_ts = self.get_last_processed_timestamp()
            self.log.debug(f"Last processed timestamp: {watermark_ts}")

            # Find all files that may have new events
            files = self.get_events_files_since(watermark_ts)

            if not files:
                self.log.debug("No event files found with new content")
                return

            self.log.debug(f"Found {len(files)} files to check: {[str(f) for f in files]}")

            # Read and merge events from all files
            events, new_watermark = self.read_all_new_events(files, watermark_ts)

            if not events:
                self.log.debug("No new events to process")
                return

            self.log.info(f"Processing {len(events)} new events from {len(files)} files")

            # Aggregate and submit
            metrics = self.aggregate_events(events)
            self.submit_metrics(metrics)

            # Update watermark timestamp
            self.update_last_processed_timestamp(new_watermark)

            self.log.info(f"Successfully processed {len(events)} events, new watermark: {new_watermark}")

        except Exception as e:
            self.log.error(f"Error in PAI metrics check: {e}")
            import traceback
            self.log.error(traceback.format_exc())
