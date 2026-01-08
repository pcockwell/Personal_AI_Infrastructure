#!/usr/bin/env bun
// $PAI_DIR/skills/ClaudeChatbotObservability/Tools/ChatbotSessionTelemetry.ts
// Unified CLI for chatbot session management
// Composes with capture-all-events.ts for event emission

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes, randomUUID } from 'crypto';

const PAI_DIR = process.env.PAI_DIR || join(homedir(), '.claude');
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const PENDING_EVENTS_FILE = '/tmp/chatbot-pending-events.jsonl';

// --- Naming Normalization ---

/**
 * Converts kebab-case to PascalCase for consistent metrics.
 * Chatbot uses kebab-case paths (/mnt/skills/git-workflow/) but PAI uses PascalCase.
 *
 * Examples:
 *   "git-workflow" → "GitWorkflow"
 *   "chatbot-observability" → "ChatbotObservability"
 *   "commit" → "Commit" (single word, capitalize first letter)
 *   "CORE" → "CORE" (already uppercase, unchanged)
 *   "GitWorkflow" → "GitWorkflow" (already PascalCase, unchanged)
 */
function normalizeSkillName(name: string): string {
  // Already PascalCase or all uppercase - leave unchanged
  if (/^[A-Z]/.test(name) && !name.includes('-')) {
    return name;
  }
  // Convert kebab-case or lowercase to PascalCase
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

// --- Utility Functions ---

function getLocalTimestamp(): string {
  const date = new Date();
  const tz = process.env.TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    const localDate = new Date(date.toLocaleString('en-US', { timeZone: tz }));
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    const hours = String(localDate.getHours()).padStart(2, '0');
    const minutes = String(localDate.getMinutes()).padStart(2, '0');
    const seconds = String(localDate.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return new Date().toISOString();
  }
}

function parseTranscriptFilename(filename: string): { timestamp: string; description: string } {
  // Expected format: 2026-01-08-00-27-38-description.txt
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(.+)\.txt$/);
  if (!match) {
    throw new Error(`Invalid transcript filename format: ${filename}. Expected: YYYY-MM-DD-HH-MM-SS-description.txt`);
  }

  const [, year, month, day, hour, minute, second, description] = match;
  const timestamp = `${year}${month}${day}${hour}${minute}${second}`;
  return { timestamp, description };
}

function generateChatbotSessionId(timestamp: string): string {
  const uuid = randomBytes(4).toString('hex'); // 8 hex chars
  return `${timestamp}-${uuid}-chatbot`;
}

function getSessionFilePath(sessionId: string): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const sessionsDir = join(PAI_DIR, 'history', 'sessions', yearMonth);

  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  // Extract timestamp from session ID for filename
  const timestamp = sessionId.split('-')[0];
  return join(sessionsDir, `${timestamp}_CHATBOT-SESSION.md`);
}

// --- Event Emission (Composes with capture-all-events.ts) ---

function emitEvent(eventType: string, payload: object, stdoutJson: boolean = false): Promise<string | void> {
  return new Promise((resolve, reject) => {
    // First try: hook in same directory as this script (symlinked or bundled)
    let hookPath = join(SCRIPT_DIR, 'capture-all-events.ts');

    // Fallback: original hooks directory
    if (!existsSync(hookPath)) {
      hookPath = join(PAI_DIR, 'hooks', 'capture-all-events.ts');
    }

    if (!existsSync(hookPath)) {
      console.error(`Hook not found in either location:`);
      console.error(`  - ${join(SCRIPT_DIR, 'capture-all-events.ts')}`);
      console.error(`  - ${join(PAI_DIR, 'hooks', 'capture-all-events.ts')}`);
      reject(new Error('capture-all-events.ts hook not found'));
      return;
    }

    const spawnArgs = ['tsx', hookPath, '--event-type', eventType];
    if (stdoutJson) {
      spawnArgs.push('--stdout-json');
    }

    const proc = spawn('npx', spawnArgs, {
      stdio: ['pipe', stdoutJson ? 'pipe' : 'inherit', 'inherit']
    });

    let stdout = '';
    if (stdoutJson && proc.stdout) {
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdoutJson ? stdout.trim() : undefined);
      } else {
        reject(new Error(`Hook exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// --- Commands ---

async function startSession(transcriptFile: string, queueLocal: boolean = false): Promise<void> {
  const { timestamp, description } = parseTranscriptFilename(transcriptFile);
  const sessionId = generateChatbotSessionId(timestamp);

  // Emit SessionStart event
  const payload = {
    session_id: sessionId,
    source_app: 'claude-chatbot',
    tool_name: null,
    tool_input: null,
    transcript_file: transcriptFile
  };

  if (queueLocal) {
    const eventJson = await emitEvent('SessionStart', payload, true);
    appendFileSync(PENDING_EVENTS_FILE, eventJson + '\n', 'utf-8');
  } else {
    await emitEvent('SessionStart', payload);
  }

  // Create session file
  const sessionFilePath = getSessionFilePath(sessionId);
  const localTimestamp = getLocalTimestamp();

  const sessionContent = `---
capture_type: CHATBOT-SESSION
timestamp: ${localTimestamp}
session_id: ${sessionId}
executor: claude-chatbot
transcript_file: ${transcriptFile}
---

# Chatbot Session: ${description}

**Session ID:** ${sessionId}
**Started:** ${localTimestamp}

---

## Tools Used

(populated by end command)

---

## Summary

(populated by end command)

---

*Session captured by ClaudeChatbotObservability*
`;

  writeFileSync(sessionFilePath, sessionContent);

  // Output session ID for use in subsequent commands
  const output: Record<string, any> = { session_id: sessionId, session_file: sessionFilePath };
  if (queueLocal) {
    output.queued = true;
  }
  console.log(JSON.stringify(output));
}

async function emitSessionEvent(
  sessionId: string,
  eventType: string,
  options: Record<string, string>,
  stdoutJson: boolean = false,
  queueLocal: boolean = false
): Promise<void> {
  const validTypes = ['PreToolUse', 'PostToolUse', 'SkillInvoked', 'WorkflowTriggered'];
  if (!validTypes.includes(eventType)) {
    throw new Error(`Invalid event type: ${eventType}. Must be one of: ${validTypes.join(', ')}`);
  }

  const payload: Record<string, any> = {
    session_id: sessionId,
    source_app: 'claude-chatbot',
  };

  const output: Record<string, any> = { success: true, event_type: eventType };

  switch (eventType) {
    case 'PreToolUse':
    case 'PostToolUse':
      if (!options['tool-name']) {
        throw new Error('--tool-name required for PreToolUse/PostToolUse');
      }
      payload.tool_name = options['tool-name'];
      payload.tool_input = options['tool-input'] ? JSON.parse(options['tool-input']) : null;
      if (eventType === 'PostToolUse' && options['tool-response']) {
        payload.tool_response = options['tool-response'];
      }
      output.tool_name = options['tool-name'];
      break;

    case 'SkillInvoked':
      if (!options['skill-name'] || !options['skill-path']) {
        throw new Error('--skill-name and --skill-path required for SkillInvoked');
      }
      const skillInvocationId = randomUUID();
      payload.skill_name = normalizeSkillName(options['skill-name']);
      payload.skill_path = options['skill-path'];
      payload.skill_category = options['skill-category'] || 'user';
      payload.invocation_id = skillInvocationId;
      output.skill_name = payload.skill_name;
      output.invocation_id = skillInvocationId;
      break;

    case 'WorkflowTriggered':
      if (!options['skill-name'] || !options['workflow-name'] || !options['workflow-path'] || !options['invocation-id']) {
        throw new Error('--skill-name, --workflow-name, --workflow-path, and --invocation-id required for WorkflowTriggered');
      }
      payload.skill_name = normalizeSkillName(options['skill-name']);
      payload.workflow_name = normalizeSkillName(options['workflow-name']);
      payload.workflow_path = options['workflow-path'];
      payload.invocation_id = options['invocation-id'];
      output.skill_name = payload.skill_name;
      output.workflow_name = payload.workflow_name;
      break;
  }

  if (queueLocal) {
    // Get full event JSON from capture-all-events.ts
    const eventJson = await emitEvent(eventType, payload, true); // --stdout-json mode

    // Append to pending file
    appendFileSync(PENDING_EVENTS_FILE, eventJson + '\n', 'utf-8');

    console.log(JSON.stringify({ queued: true, event_type: eventType, ...output }));
    return;
  }

  const result = await emitEvent(eventType, payload, stdoutJson);

  if (stdoutJson && result) {
    // Output full event JSON for chatbot workflow
    console.log(result);
  } else {
    console.log(JSON.stringify(output));
  }
}

async function endSession(sessionId: string, toolsUsed?: string, summary?: string, queueLocal: boolean = false): Promise<void> {
  // Emit Stop event
  const payload = {
    session_id: sessionId,
    source_app: 'claude-chatbot',
    stop_hook_active: true
  };

  if (queueLocal) {
    const eventJson = await emitEvent('Stop', payload, true);
    appendFileSync(PENDING_EVENTS_FILE, eventJson + '\n', 'utf-8');
  } else {
    await emitEvent('Stop', payload);
  }

  // Update session file
  const sessionFilePath = getSessionFilePath(sessionId);

  if (existsSync(sessionFilePath)) {
    let content = readFileSync(sessionFilePath, 'utf-8');
    const localTimestamp = getLocalTimestamp();

    // Update Tools Used section
    if (toolsUsed) {
      const toolsList = toolsUsed.split(',').map(t => `- ${t.trim()}`).join('\n');
      content = content.replace(
        /## Tools Used\n\n\(populated by end command\)/,
        `## Tools Used\n\n${toolsList}`
      );
    } else {
      content = content.replace(
        /## Tools Used\n\n\(populated by end command\)/,
        '## Tools Used\n\n- None recorded'
      );
    }

    // Update Summary section
    if (summary) {
      content = content.replace(
        /## Summary\n\n\(populated by end command\)/,
        `## Summary\n\n${summary}`
      );
    } else {
      content = content.replace(
        /## Summary\n\n\(populated by end command\)/,
        '## Summary\n\nNo summary provided'
      );
    }

    // Add end timestamp
    content = content.replace(
      /\*\*Started:\*\* .+/,
      `**Started:** ${content.match(/\*\*Started:\*\* (.+)/)?.[1] || 'unknown'}\n**Ended:** ${localTimestamp}`
    );

    writeFileSync(sessionFilePath, content);
  }

  const output: Record<string, any> = { success: true, session_id: sessionId, ended: true };
  if (queueLocal) {
    output.queued = true;
  }
  console.log(JSON.stringify(output));
}

async function flushPendingEvents(dryRun: boolean, clearPending: boolean): Promise<void> {
  if (clearPending) {
    if (existsSync(PENDING_EVENTS_FILE)) {
      unlinkSync(PENDING_EVENTS_FILE);
    }
    console.log(JSON.stringify({ cleared: true }));
    return;
  }

  if (!existsSync(PENDING_EVENTS_FILE)) {
    console.log(JSON.stringify({ pending_count: 0, by_date: [] }));
    return;
  }

  const content = readFileSync(PENDING_EVENTS_FILE, 'utf-8').trim();
  if (!content) {
    console.log(JSON.stringify({ pending_count: 0, by_date: [] }));
    return;
  }

  const lines = content.split('\n').filter(Boolean);
  const events = lines.map(line => JSON.parse(line));

  // Group by date AND session_id (each session gets its own file)
  // Key format: "date|session_id"
  const eventsByDateSession = new Map<string, any[]>();
  for (const event of events) {
    const date = event.timestamp_local.split(' ')[0]; // "YYYY-MM-DD"
    const sessionId = event.session_id || 'unknown';
    const key = `${date}|${sessionId}`;
    if (!eventsByDateSession.has(key)) {
      eventsByDateSession.set(key, []);
    }
    eventsByDateSession.get(key)!.push(event);
  }

  const output = {
    pending_count: events.length,
    by_date: Array.from(eventsByDateSession.entries()).map(([key, dateEvents]) => {
      const [date, sessionId] = key.split('|');
      return {
        date,
        year_month: date.substring(0, 7),
        session_id: sessionId,
        target_file: `${date}_${sessionId}.jsonl`,
        events: dateEvents,
        event_ids: dateEvents.map(e =>
          e.payload?.invocation_id || `${e.timestamp}-${e.hook_event_type}`
        )
      };
    })
  };

  console.log(JSON.stringify(output, null, dryRun ? 2 : 0));
}

// --- CLI Parser ---

function printUsage(): void {
  console.log(`
ChatbotSession - Unified CLI for chatbot session observability

Usage:
  npx tsx ChatbotSessionTelemetry.ts <command> [options]

Commands:
  start    Start a new chatbot session
  emit     Emit any event type (tool use, skill invoked, workflow triggered)
  end      End a chatbot session
  flush    Flush pending events (for syncing to local filesystem)

Options for 'start':
  --transcript-file <file>    Transcript filename (required)
                              Format: YYYY-MM-DD-HH-MM-SS-description.txt
  --queue-local               Queue event locally instead of sending immediately

Options for 'emit':
  --session-id <id>           Session ID from start command (required)
  --event-type <type>         Event type (required):
                              PreToolUse, PostToolUse, SkillInvoked, WorkflowTriggered
  --stdout-json               Output full event JSON to stdout (for chatbot workflows)
  --queue-local               Queue event to temp file for batch sync to local filesystem

  For PreToolUse/PostToolUse:
    --tool-name <name>        Tool name (required)
    --tool-input <json>       Tool input JSON (optional)
    --tool-response <text>    Tool response (PostToolUse only)

  For SkillInvoked:
    --skill-name <name>       Skill name, kebab-case OK (required)
    --skill-path <path>       Full path to SKILL.md (required)
    --skill-category <cat>    "user" or "project" (default: user)

  For WorkflowTriggered:
    --skill-name <name>       Parent skill name (required)
    --workflow-name <name>    Workflow name, kebab-case OK (required)
    --workflow-path <path>    Path to workflow file (required)
    --invocation-id <id>      ID from SkillInvoked event (required)

Options for 'end':
  --session-id <id>           Session ID from start command (required)
  --tools-used <list>         Comma-separated list of tools used (optional)
  --summary <text>            Brief session summary (optional)
  --queue-local               Queue event locally instead of sending immediately

Options for 'flush':
  --dry-run                   Show pending events without clearing
  --clear-pending             Clear pending events after successful sync

Examples:
  # Start a session
  npx tsx ChatbotSessionTelemetry.ts start --transcript-file "2026-01-08-00-27-38-research.txt"

  # Emit tool events
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type PreToolUse --tool-name WebSearch
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type PostToolUse --tool-name WebSearch --tool-response "results"

  # Emit skill invocation (returns invocation_id for workflow correlation)
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked --skill-name "git-workflow" --skill-path "/mnt/skills/user/git-workflow/SKILL.md"

  # Emit workflow trigger
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type WorkflowTriggered --skill-name "git-workflow" --workflow-name "commit" --workflow-path "references/commit.md" --invocation-id "..."

  # End session
  npx tsx ChatbotSessionTelemetry.ts end --session-id "..." --tools-used "WebSearch,Read" --summary "Researched docs"

  # Queue entire session lifecycle for batch sync
  npx tsx ChatbotSessionTelemetry.ts start --transcript-file "2026-01-08-00-27-38-research.txt" --queue-local
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked --skill-name "..." --skill-path "..." --queue-local
  npx tsx ChatbotSessionTelemetry.ts end --session-id "..." --tools-used "WebSearch,Read" --summary "..." --queue-local

  # Flush pending events
  npx tsx ChatbotSessionTelemetry.ts flush --dry-run
  npx tsx ChatbotSessionTelemetry.ts flush --clear-pending
`);
}

function printEmitHelp(): void {
  console.log(`
emit - Emit any event type to the observability system

Usage:
  npx tsx ChatbotSessionTelemetry.ts emit --session-id <id> --event-type <type> [options]

Required:
  --session-id <id>       Session ID from 'start' command
  --event-type <type>     One of: PreToolUse, PostToolUse, SkillInvoked, WorkflowTriggered

Optional:
  --stdout-json           Output full event JSON to stdout instead of confirmation object.
                          Use for chatbot workflows where you need to capture the event
                          and write it to the local filesystem via MCP tools.
  --queue-local           Queue event to temp file for batch sync to local filesystem.
                          Use with 'flush' command to sync events before response.

Event-specific options:

  PreToolUse / PostToolUse (tool usage tracking):
    --tool-name <name>      Name of the tool being used (required)
    --tool-input <json>     JSON string of tool input (optional)
    --tool-response <text>  Tool response text (PostToolUse only)

  SkillInvoked (track when a skill is read):
    --skill-name <name>     Skill name, kebab-case OK (required)
    --skill-path <path>     Full path to SKILL.md (required)
    --skill-category <cat>  "user" or "project" (default: user)

    Returns: { invocation_id: "..." } - use this for WorkflowTriggered correlation

  WorkflowTriggered (track when a workflow/reference is read):
    --skill-name <name>     Parent skill name (required)
    --workflow-name <name>  Workflow name, kebab-case OK (required)
    --workflow-path <path>  Path to workflow file (required)
    --invocation-id <id>    ID from SkillInvoked event (required)

Examples:
  # Tool events
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type PreToolUse --tool-name WebSearch
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type PostToolUse --tool-name WebSearch --tool-response "Found 10 results"

  # Skill invocation (returns invocation_id)
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \\
    --skill-name "git-workflow" --skill-path "/mnt/skills/user/git-workflow/SKILL.md"

  # Workflow trigger (uses invocation_id from SkillInvoked)
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type WorkflowTriggered \\
    --skill-name "git-workflow" --workflow-name "commit" \\
    --workflow-path "references/commit.md" --invocation-id "abc-123"

  # Chatbot workflow (capture full event JSON for local file write)
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \\
    --skill-name "TestSkill" --skill-path "/mnt/skills/user/test/SKILL.md" --stdout-json

  # Queue events for batch sync
  npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \\
    --skill-name "TestSkill" --skill-path "/mnt/skills/user/test/SKILL.md" --queue-local
`);
}

function printFlushHelp(): void {
  console.log(`
flush - Manage pending events for local filesystem sync

Usage:
  npx tsx ChatbotSessionTelemetry.ts flush [options]

Options:
  --dry-run         Show pending events grouped by date (for AI to sync)
  --clear-pending   Clear pending events file (after successful sync)

Workflow:
  1. Events queued with --queue-local go to /tmp/chatbot-pending-events.jsonl
  2. Before response: flush --dry-run to get events grouped by date
  3. AI syncs each date group to local ~/.claude/history/raw-outputs/
  4. After success: flush --clear-pending to clear temp file

Examples:
  # Check pending events
  npx tsx ChatbotSessionTelemetry.ts flush --dry-run

  # Clear after successful sync
  npx tsx ChatbotSessionTelemetry.ts flush --clear-pending
`);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] || '';
      result[key] = value;
      i++;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const options = parseArgs(args.slice(1));

  try {
    switch (command) {
      case 'start': {
        if (!options['transcript-file']) {
          console.error('Error: --transcript-file is required');
          process.exit(1);
        }
        const queueLocalStart = args.includes('--queue-local');
        await startSession(options['transcript-file'], queueLocalStart);
        break;
      }

      case 'emit':
        if (options['help'] !== undefined || args.includes('--help') || args.includes('-h')) {
          printEmitHelp();
          process.exit(0);
        }
        if (!options['session-id'] || !options['event-type']) {
          console.error('Error: --session-id and --event-type are required');
          console.error('Run "npx tsx ChatbotSessionTelemetry.ts emit --help" for usage');
          process.exit(1);
        }
        const stdoutJson = args.includes('--stdout-json');
        const queueLocal = args.includes('--queue-local');
        await emitSessionEvent(options['session-id'], options['event-type'], options, stdoutJson, queueLocal);
        break;

      case 'end': {
        if (!options['session-id']) {
          console.error('Error: --session-id is required');
          process.exit(1);
        }
        const queueLocalEnd = args.includes('--queue-local');
        await endSession(
          options['session-id'],
          options['tools-used'],
          options['summary'],
          queueLocalEnd
        );
        break;
      }

      case 'flush':
        if (options['help'] !== undefined || args.includes('--help') || args.includes('-h')) {
          printFlushHelp();
          process.exit(0);
        }
        const dryRun = args.includes('--dry-run');
        const clearPending = args.includes('--clear-pending');
        await flushPendingEvents(dryRun, clearPending);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
