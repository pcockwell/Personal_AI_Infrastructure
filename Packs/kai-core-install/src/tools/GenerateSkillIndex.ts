#!/usr/bin/env bun
/**
 * GenerateSkillIndex.ts
 *
 * Parses all SKILL.md files and builds searchable indexes at each level.
 *
 * Usage:
 *   bun run GenerateSkillIndex.ts              # Auto-detect: generate indexes at all levels from CWD to ~/.claude
 *   bun run GenerateSkillIndex.ts --path /dir  # Generate index for specific skills directory
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

const PAI_DIR = process.env.PAI_DIR || process.env.PAI_HOME || join(process.env.HOME || '', '.claude');
const ALWAYS_LOADED_SKILLS = ['CORE', 'Development', 'Research'];

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(): { path?: string; autoDetect: boolean } {
  const args = process.argv.slice(2);
  const pathIndex = args.indexOf('--path');

  if (pathIndex !== -1 && args[pathIndex + 1]) {
    return { path: args[pathIndex + 1], autoDetect: false };
  }
  return { path: undefined, autoDetect: true };
}

// =============================================================================
// Directory Walking
// =============================================================================

/**
 * Walk up from startDir to ~/.claude, finding all .claude/skills directories
 * that contain at least one skill (SKILL.md file).
 * Returns paths in order from closest (project) to farthest (user).
 */
function findAllSkillsDirectories(startDir: string): string[] {
  const skillsDirs: string[] = [];
  const home = homedir();
  const userClaudeSkillsDir = join(home, '.claude', 'skills');

  let currentDir = startDir;

  while (true) {
    const claudeSkillsDir = join(currentDir, '.claude', 'skills');

    // Check if this directory has skills (contains at least one SKILL.md)
    if (existsSync(claudeSkillsDir)) {
      try {
        const entries = Bun.spawnSync(['ls', claudeSkillsDir]).stdout.toString().trim().split('\n');
        const hasSkills = entries.some(entry => {
          if (entry.startsWith('.') || !entry) return false;
          return existsSync(join(claudeSkillsDir, entry, 'SKILL.md'));
        });

        if (hasSkills) {
          skillsDirs.push(claudeSkillsDir);
        }
      } catch {
        // Skip if we can't read the directory
      }
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

  // Always check user-level skills as final stop (if not already included)
  if (existsSync(userClaudeSkillsDir) && !skillsDirs.includes(userClaudeSkillsDir)) {
    try {
      const entries = Bun.spawnSync(['ls', userClaudeSkillsDir]).stdout.toString().trim().split('\n');
      const hasSkills = entries.some(entry => {
        if (entry.startsWith('.') || !entry) return false;
        return existsSync(join(userClaudeSkillsDir, entry, 'SKILL.md'));
      });

      if (hasSkills) {
        skillsDirs.push(userClaudeSkillsDir);
      }
    } catch {
      // Skip if we can't read
    }
  }

  return skillsDirs;
}

// =============================================================================
// Skill Parsing
// =============================================================================

async function findSkillFiles(dir: string): Promise<string[]> {
  const skillFiles: string[] = [];

  if (!existsSync(dir)) {
    return skillFiles;
  }

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    // Follow symlinks by checking the resolved path
    const entryPath = join(dir, entry.name);
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && existsSync(join(entryPath, 'SKILL.md')));

    if (isDir && !entry.name.startsWith('.')) {
      const skillMdPath = join(entryPath, 'SKILL.md');
      if (existsSync(skillMdPath)) {
        skillFiles.push(skillMdPath);
      }
    }
  }
  return skillFiles;
}

function parseFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const tierMatch = frontmatter.match(/^tier:\s*(.+)$/m);
  const indexedMatch = frontmatter.match(/^indexed:\s*(.+)$/m);

  // Handle both single-line and multiline YAML descriptions
  let description = '';
  const multiLineMatch = frontmatter.match(/^description:\s*\|\n([\s\S]*?)(?=^\w+:|$)/m);
  const singleLineMatch = frontmatter.match(/^description:\s*([^|\n].+)$/m);

  if (multiLineMatch) {
    // Multiline YAML: join indented lines, normalize whitespace
    description = multiLineMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join(' ');
  } else if (singleLineMatch) {
    description = singleLineMatch[1].trim();
  }

  // Parse indexed field (defaults to true if not specified)
  const indexedValue = indexedMatch?.[1]?.trim().toLowerCase();
  const indexed = indexedValue !== 'false' && indexedValue !== 'no';

  return {
    name: nameMatch?.[1]?.trim() || '',
    description,
    tier: tierMatch?.[1]?.trim() as 'always' | 'deferred' | undefined,
    indexed
  };
}

// Common stopwords to filter from triggers
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'into', 'through', 'during',
  'to', 'from', 'in', 'on', 'of', 'as', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
  'any', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too',
  'very', 'just', 'also', 'now', 'here', 'there', 'where', 'how', 'why',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'user', 'users', 'says', 'asks', 'wants', 'needs', 'using', 'use',
  'new', 'get', 'set', 'run', 'make', 'take', 'give', 'put', 'let'
]);

function extractTriggers(description: string): string[] {
  const triggers: string[] = [];
  // Match "USE WHEN" or "Use when" (case-insensitive) followed by content until period or end
  const useWhenMatch = description.match(/use when[^.]+/gi);

  if (useWhenMatch) {
    for (const match of useWhenMatch) {
      // Split on commas first to preserve phrases, then handle OR
      const rawPhrases = match
        .replace(/use when/gi, '')
        // Remove parenthetical content like "(scripts, references, assets)"
        .replace(/\([^)]*\)/g, '')
        .split(/,|\bOR\b/i)
        .map(p => p.trim().toLowerCase())
        .filter(p => p.length > 0);

      for (const phrase of rawPhrases) {
        // Filter out stopword-only phrases
        const words = phrase.split(/\s+/).filter(w => !STOPWORDS.has(w) && w.length > 1);
        if (words.length > 0) {
          // Keep the cleaned phrase (stopwords removed)
          triggers.push(words.join(' '));
        }
      }
    }
  }
  return [...new Set(triggers)];
}

function extractWorkflows(content: string): string[] {
  const workflows: string[] = [];
  const workflowSection = content.match(/## Workflow Routing[\s\S]*?(?=##|$)/);

  if (workflowSection) {
    const tableRows = workflowSection[0].match(/\|\s*\*\*(\w+)\*\*/g);
    if (tableRows) {
      for (const row of tableRows) {
        const name = row.match(/\*\*(\w+)\*\*/)?.[1];
        if (name) workflows.push(name);
      }
    }
  }

  return workflows;
}

// =============================================================================
// Index Generation
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
  indexPath: string;
  skills: Record<string, SkillEntry>;
}

async function generateIndexForDirectory(skillsDir: string): Promise<void> {
  console.log(`\n--- Generating index for: ${skillsDir} ---\n`);

  const skillFiles = await findSkillFiles(skillsDir);
  const index: SkillIndex = {
    generated: new Date().toISOString(),
    totalSkills: 0,
    alwaysLoadedCount: 0,
    deferredCount: 0,
    indexPath: skillsDir,
    skills: {}
  };

  for (const filePath of skillFiles) {
    const content = await readFile(filePath, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm?.name) continue;

    // Skip skills with indexed: false
    if (!fm.indexed) {
      console.log(`  ⏭️  ${fm.name} (indexed: false)`);
      continue;
    }

    // Use frontmatter tier if specified, otherwise fallback to hardcoded list
    const tier = fm.tier || (ALWAYS_LOADED_SKILLS.includes(fm.name) ? 'always' : 'deferred');
    const key = fm.name.toLowerCase();

    index.skills[key] = {
      name: fm.name,
      path: filePath.replace(skillsDir, '').replace(/^\//, ''),
      fullDescription: fm.description,
      triggers: extractTriggers(fm.description),
      workflows: extractWorkflows(content),
      tier,
      scope: skillsDir
    };

    index.totalSkills++;
    if (tier === 'always') index.alwaysLoadedCount++;
    else index.deferredCount++;

    console.log(`  ${tier === 'always' ? '🔒' : '📦'} ${fm.name}`);
  }

  const outputFile = join(skillsDir, 'skill-index.json');
  await writeFile(outputFile, JSON.stringify(index, null, 2));
  console.log(`\n✅ Index generated: ${outputFile}`);
  console.log(`   Total: ${index.totalSkills} skills (${index.alwaysLoadedCount} always loaded, ${index.deferredCount} deferred)`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { path: explicitPath, autoDetect } = parseArgs();

  if (explicitPath) {
    // Single directory mode
    console.log(`Generating skill index for: ${explicitPath}\n`);
    await generateIndexForDirectory(explicitPath);
  } else if (autoDetect) {
    // Auto-detect mode: find all .claude/skills directories
    const cwd = process.cwd();
    console.log(`Auto-detecting skills directories from: ${cwd}\n`);

    const skillsDirs = findAllSkillsDirectories(cwd);

    if (skillsDirs.length === 0) {
      console.log('No skills directories found.');
      return;
    }

    console.log(`Found ${skillsDirs.length} skills director${skillsDirs.length === 1 ? 'y' : 'ies'}:`);
    for (const dir of skillsDirs) {
      console.log(`  - ${dir}`);
    }

    // Generate index for each directory
    for (const dir of skillsDirs) {
      await generateIndexForDirectory(dir);
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✅ Generated indexes for ${skillsDirs.length} level${skillsDirs.length === 1 ? '' : 's'}`);
  }
}

main().catch(console.error);
