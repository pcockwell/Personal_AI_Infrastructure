#!/usr/bin/env bun
/**
 * MergeSkillIndexes.ts
 *
 * Runtime tool to merge skill indexes from multiple levels.
 * Outputs merged index to stdout - does not write files.
 *
 * Usage:
 *   bun run MergeSkillIndexes.ts              # Merge from CWD up to ~/.claude
 *   bun run MergeSkillIndexes.ts --from /path # Start from specific directory
 *   bun run MergeSkillIndexes.ts --list       # List index locations only
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

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

interface SkillIndex {
  generated: string;
  totalSkills: number;
  alwaysLoadedCount: number;
  deferredCount: number;
  indexPath?: string;
  skills: Record<string, SkillEntry>;
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
// Directory Walking
// =============================================================================

/**
 * Walk up from startDir to ~/.claude, finding all skill-index.json files.
 * Returns paths in order from closest (project) to farthest (user).
 */
function findSkillIndexFiles(startDir: string): string[] {
  const indexFiles: string[] = [];
  const home = homedir();
  const userClaudeDir = join(home, '.claude');

  let currentDir = startDir;

  while (true) {
    const indexPath = join(currentDir, '.claude', 'skills', 'skill-index.json');

    if (existsSync(indexPath)) {
      indexFiles.push(indexPath);
    }

    // Stop at user's home directory
    if (currentDir === home) {
      break;
    }

    // Move up one directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  // Always check user-level index as final stop (if not already included)
  const userIndexPath = join(userClaudeDir, 'skills', 'skill-index.json');
  if (existsSync(userIndexPath) && !indexFiles.includes(userIndexPath)) {
    indexFiles.push(userIndexPath);
  }

  return indexFiles;
}

// =============================================================================
// Merge Logic
// =============================================================================

/**
 * Merge multiple skill indexes with priority ordering.
 * Later entries override earlier ones (closest to CWD wins).
 */
async function mergeIndexes(indexFiles: string[]): Promise<MergedIndex> {
  const merged: MergedIndex = {
    generated: new Date().toISOString(),
    totalSkills: 0,
    alwaysLoadedCount: 0,
    deferredCount: 0,
    sources: [],
    skills: {}
  };

  // Process in reverse order (user-level first, project-level last)
  // so that project-level skills override user-level
  const orderedFiles = [...indexFiles].reverse();

  for (const indexFile of orderedFiles) {
    try {
      const content = await readFile(indexFile, 'utf-8');
      const index: SkillIndex = JSON.parse(content);

      merged.sources.push(indexFile);

      for (const [key, skill] of Object.entries(index.skills)) {
        // Add scope if not present (backwards compatibility with old format)
        if (!skill.scope) {
          skill.scope = index.indexPath || dirname(dirname(indexFile));
        }

        // Later entries override earlier ones (project overrides user)
        merged.skills[key] = skill;
      }
    } catch (error) {
      // Log to stderr so it doesn't pollute JSON output
      console.error(`Warning: Could not read ${indexFile}: ${error}`);
    }
  }

  // Recalculate totals
  for (const skill of Object.values(merged.skills)) {
    merged.totalSkills++;
    if (skill.tier === 'always') {
      merged.alwaysLoadedCount++;
    } else {
      merged.deferredCount++;
    }
  }

  // Reverse sources to show in discovery order (closest first)
  merged.sources.reverse();

  return merged;
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(): { startDir: string; listOnly: boolean } {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf('--from');
  const listOnly = args.includes('--list');

  let startDir = process.cwd();
  if (fromIndex !== -1 && args[fromIndex + 1]) {
    startDir = args[fromIndex + 1];
  }

  return { startDir, listOnly };
}

async function main() {
  const { startDir, listOnly } = parseArgs();

  const indexFiles = findSkillIndexFiles(startDir);

  if (indexFiles.length === 0) {
    console.error('No skill-index.json files found. Run GenerateSkillIndex.ts first.');
    process.exit(1);
  }

  if (listOnly) {
    // Output to stderr so it doesn't pollute potential JSON piping
    console.error('Skill index files (closest to CWD first):');
    for (const file of indexFiles) {
      console.error(`  ${file}`);
    }
    return;
  }

  const merged = await mergeIndexes(indexFiles);

  // Output to stdout as JSON
  console.log(JSON.stringify(merged, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
