#!/usr/bin/env bun
/**
 * SkillSearch.ts
 *
 * Search skill indexes across all levels (project > user).
 * Uses MergeSkillIndexes to get merged index from current working directory context.
 *
 * Usage:
 *   bun run SkillSearch.ts <query>        # Search all levels
 *   bun run SkillSearch.ts --list         # List all skills
 *   bun run SkillSearch.ts --user-only <query>  # Only user-level skills
 */

import { join } from 'path';
import { spawnSync } from 'bun';
import { homedir } from 'os';

const PAI_DIR = process.env.PAI_DIR || process.env.PAI_HOME || join(process.env.HOME || '', '.claude');

// =============================================================================
// Types
// =============================================================================

interface SkillEntry {
  name: string;
  path: string;
  fullDescription: string;
  triggers: string[];
  workflows: string[];
  tier: 'always' | 'deferred';
  scope: string;
}

interface MergedIndex {
  generated: string;
  totalSkills: number;
  alwaysLoadedCount: number;
  deferredCount: number;
  sources: string[];
  skills: Record<string, SkillEntry>;
}

// =============================================================================
// Index Loading
// =============================================================================

/**
 * Load merged index by calling MergeSkillIndexes tool.
 * Uses current working directory context for project-aware merging.
 */
async function loadMergedIndex(userOnly: boolean = false): Promise<MergedIndex> {
  const mergeToolPath = join(PAI_DIR, 'tools', 'MergeSkillIndexes.ts');

  const args = ['run', mergeToolPath];
  if (userOnly) {
    args.push('--from', homedir());
  }

  const result = spawnSync(['bun', ...args], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe'
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    throw new Error(`MergeSkillIndexes failed: ${stderr}`);
  }

  const stdout = result.stdout.toString();
  return JSON.parse(stdout);
}

// =============================================================================
// Search
// =============================================================================

function searchSkills(query: string, index: MergedIndex) {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const results: { skill: SkillEntry; score: number }[] = [];

  for (const [key, skill] of Object.entries(index.skills)) {
    let score = 0;

    // Name match: +10 points
    if (key.includes(query.toLowerCase())) score += 10;

    // Trigger and description matches
    for (const term of queryTerms) {
      // Trigger match: +5 points per term
      for (const trigger of skill.triggers) {
        if (trigger.includes(term)) score += 5;
      }
      // Description match: +2 points per term
      if (skill.fullDescription.toLowerCase().includes(term)) score += 2;
    }

    if (score > 0) results.push({ skill, score });
  }

  return results.sort((a, b) => b.score - a.score);
}

// =============================================================================
// Display Helpers
// =============================================================================

/**
 * Format scope path as human-readable label.
 */
function formatScope(scope: string): string {
  const home = homedir();
  const userSkillsPath = join(home, '.claude', 'skills');

  if (scope === userSkillsPath || scope.startsWith(userSkillsPath)) {
    return '(user)';
  }

  // Extract project name from path: /path/to/project/.claude/skills -> project
  const match = scope.match(/\/([^/]+)\/\.claude\/skills$/);
  return match ? `(${match[1]})` : '(project)';
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const userOnly = args.includes('--user-only');
  const filteredArgs = args.filter(a => a !== '--user-only');

  let index: MergedIndex;
  try {
    index = await loadMergedIndex(userOnly);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    console.error('   Run GenerateSkillIndex.ts first to create indexes.');
    process.exit(1);
  }

  // List mode
  if (filteredArgs.includes('--list') || filteredArgs.length === 0) {
    const levelLabel = userOnly ? 'user-level only' : `${index.sources.length} level${index.sources.length === 1 ? '' : 's'}`;
    console.log(`\n📚 Skill Index (${index.totalSkills} skills from ${levelLabel})\n`);

    if (index.sources.length > 1) {
      console.log('Sources (closest first):');
      for (const source of index.sources) {
        console.log(`  - ${source}`);
      }
      console.log();
    }

    const sortedSkills = Object.values(index.skills).sort((a, b) => a.name.localeCompare(b.name));
    for (const skill of sortedSkills) {
      const icon = skill.tier === 'always' ? '🔒' : '📦';
      const scopeLabel = formatScope(skill.scope).padEnd(12);
      const triggers = skill.triggers.slice(0, 3).join(', ') || '(no triggers)';
      console.log(`  ${icon} ${skill.name.padEnd(25)} ${scopeLabel} │ ${triggers}`);
    }
    return;
  }

  // Search mode
  const query = filteredArgs.join(' ');
  const results = searchSkills(query, index).slice(0, 5);

  console.log(`\n🔍 Searching for: "${query}"\n`);

  if (results.length === 0) {
    console.log('No matching skills found.');
    return;
  }

  for (const { skill, score } of results) {
    const scopeLabel = formatScope(skill.scope);
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`${skill.tier === 'always' ? '🔒' : '📦'} **${skill.name}** (score: ${score}) ${scopeLabel}`);
    console.log(`Path: ${skill.path}`);
    console.log(`Scope: ${skill.scope}`);
    if (skill.workflows.length > 0) {
      console.log(`Workflows: ${skill.workflows.join(', ')}`);
    }
    if (skill.triggers.length > 0) {
      console.log(`Triggers: ${skill.triggers.slice(0, 5).join(', ')}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
