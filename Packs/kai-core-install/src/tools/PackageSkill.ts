#!/usr/bin/env bun
/**
 * PackageSkill.ts
 *
 * Packages PAI skills into .skill format (ZIP archive) for export to Claude.ai.
 * Preserves PascalCase naming convention.
 *
 * Usage:
 *   bun run PackageSkill.ts <skill-name>              # Package single skill
 *   bun run PackageSkill.ts <skill-name> --output ./dist
 *   bun run PackageSkill.ts --all                     # Package all skills
 *   bun run PackageSkill.ts --all --output ./dist
 *   bun run PackageSkill.ts --list                    # List available skills
 *   bun run PackageSkill.ts --validate <skill-name>   # Validate only
 */

import { readdir, readFile, mkdir, stat } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

const PAI_DIR = process.env.PAI_DIR || process.env.PAI_HOME || join(homedir(), '.claude');
const DEFAULT_OUTPUT_DIR = join(PAI_DIR, 'exports');

// Size limits (bytes)
const SIZE_LIMIT_BYTES = 30 * 1024 * 1024; // 30 MB
const SIZE_WARNING_BYTES = 25 * 1024 * 1024; // 25 MB

// Custom ignore file name (gitignore-style)
const SKILL_IGNORE_FILE = '.skillignore';

// Default blocklist patterns (gitignore syntax)
const DEFAULT_BLOCKLIST = [
  // Dependencies
  'node_modules/', 'vendor/', 'bower_components/', '.pnpm/',
  // Build outputs
  'dist/', 'build/', 'out/', '.next/', '.nuxt/', 'target/', 'bin/', 'obj/',
  // Caches
  '__pycache__/', '*.pyc', '.pytest_cache/', '.mypy_cache/',
  // IDE/Editor
  '.idea/', '.vscode/', '*.swp', '*.swo',
  // Testing/Coverage
  'coverage/', '.nyc_output/', 'htmlcov/',
  // Logs/Temp
  '*.log', 'logs/', 'tmp/', 'temp/',
  // Secrets
  '.env', '.env.*', '*.pem', '*.key', 'credentials.json', 'secrets.yaml',
  // Lock files
  'package-lock.json', 'yarn.lock', 'bun.lock', 'pnpm-lock.yaml',
];

// =============================================================================
// Skill Info (with path)
// =============================================================================

interface SkillInfo {
  name: string;
  skillDir: string;
  scope: string; // e.g., "user", "nobs", "project"
}

// =============================================================================
// Name Conversion (PascalCase → kebab-case)
// =============================================================================

/**
 * Convert PascalCase to kebab-case for Agent Skills spec compliance
 * Examples:
 *   CORE → core
 *   CreateSkill → create-skill
 *   GitWorkflow → git-workflow
 *   DatadogResourceConfiguration → datadog-resource-configuration
 */
function toKebabCase(name: string): string {
  return name
    // Insert hyphen before uppercase letters (except at start)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    // Insert hyphen between consecutive uppercase and following lowercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    // Convert to lowercase
    .toLowerCase();
}

// =============================================================================
// Directory Mapping (PAI → Agent Skills)
// =============================================================================

const DIRECTORY_MAPPING: Record<string, string> = {
  'Tools': 'scripts',
  'Workflows': 'references',
  'Contexts': 'references',
  'Templates': 'assets',
  'Data': 'assets',
};

// Files that go to references/ (documentation)
const REFERENCE_EXTENSIONS = ['.md'];

// =============================================================================
// Exclusion Pattern Matching
// =============================================================================

interface ExclusionResult {
  patterns: string[];
  customPatterns: string[];
  hasCustomFile: boolean;
}

/**
 * Parse a .skillignore file (gitignore syntax)
 */
function parseIgnoreFile(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

/**
 * Load exclusion patterns for a skill
 */
async function loadExclusionPatterns(skillDir: string): Promise<ExclusionResult> {
  const ignoreFilePath = join(skillDir, SKILL_IGNORE_FILE);
  let customPatterns: string[] = [];
  let hasCustomFile = false;

  if (existsSync(ignoreFilePath)) {
    const content = await readFile(ignoreFilePath, 'utf-8');
    customPatterns = parseIgnoreFile(content);
    hasCustomFile = true;
  }

  return {
    patterns: [...DEFAULT_BLOCKLIST, ...customPatterns],
    customPatterns,
    hasCustomFile,
  };
}

/**
 * Check if a path matches any exclusion pattern
 * Supports gitignore-style patterns
 */
function matchesExclusionPattern(relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Directory pattern (ends with /)
    if (pattern.endsWith('/')) {
      const dirName = pattern.slice(0, -1);
      if (relativePath === dirName ||
          relativePath.startsWith(dirName + '/') ||
          relativePath.includes('/' + dirName + '/') ||
          relativePath.includes('/' + dirName)) {
        return true;
      }
    }
    // Glob pattern with *
    else if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '{{GLOBSTAR}}')
          .replace(/\*/g, '[^/]*')
          .replace(/\{\{GLOBSTAR\}\}/g, '.*')
        + '$'
      );
      if (regex.test(relativePath) || regex.test(basename(relativePath))) {
        return true;
      }
    }
    // Exact match
    else if (relativePath === pattern ||
             relativePath.endsWith('/' + pattern) ||
             basename(relativePath) === pattern) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Size Calculation and Validation
// =============================================================================

interface SizeEntry {
  path: string;
  size: number;
  isDirectory: boolean;
}

interface SizeReport {
  totalSize: number;
  entries: SizeEntry[];
  excludedSize: number;
  excludedEntries: SizeEntry[];
}

interface SizeValidation {
  valid: boolean;
  status: 'ok' | 'warning' | 'error';
  message: string;
  totalSize: number;
  limit: number;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Calculate total size of a directory recursively
 */
async function calculateDirectorySize(dir: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        totalSize += await calculateDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return totalSize;
}

/**
 * Validate size against limits
 */
function validateSize(totalSize: number): SizeValidation {
  const percentage = (totalSize / SIZE_LIMIT_BYTES * 100).toFixed(1);

  if (totalSize > SIZE_LIMIT_BYTES) {
    return {
      valid: false,
      status: 'error',
      message: `${formatBytes(totalSize)} exceeds ${formatBytes(SIZE_LIMIT_BYTES)} limit`,
      totalSize,
      limit: SIZE_LIMIT_BYTES,
    };
  }

  if (totalSize > SIZE_WARNING_BYTES) {
    return {
      valid: true,
      status: 'warning',
      message: `${formatBytes(totalSize)} / ${formatBytes(SIZE_LIMIT_BYTES)} (${percentage}%)`,
      totalSize,
      limit: SIZE_LIMIT_BYTES,
    };
  }

  return {
    valid: true,
    status: 'ok',
    message: `${formatBytes(totalSize)} / ${formatBytes(SIZE_LIMIT_BYTES)} (${percentage}%)`,
    totalSize,
    limit: SIZE_LIMIT_BYTES,
  };
}

/**
 * Print size report
 */
function printSizeReport(report: SizeReport, skillName: string): void {
  console.log(`\n📊 Size Analysis:`);

  // Group by top-level directory
  const byDir = new Map<string, number>();
  for (const entry of report.entries) {
    const parts = entry.path.split('/');
    const topLevel = parts.length > 1 ? parts[0] + '/' : entry.path;
    byDir.set(topLevel, (byDir.get(topLevel) || 0) + entry.size);
  }

  // Sort by size descending
  const sorted = [...byDir.entries()].sort((a, b) => b[1] - a[1]);

  for (const [dir, size] of sorted.slice(0, 5)) {
    console.log(`   ├── ${dir.padEnd(25)} ${formatBytes(size)}`);
  }
  console.log(`   └── TOTAL                      ${formatBytes(report.totalSize)}`);

  if (report.excludedEntries.length > 0) {
    console.log(`\n   📁 Excluded (blocklist):`);
    // Show top 3 largest excluded items
    const sortedExcluded = [...report.excludedEntries].sort((a, b) => b.size - a.size);
    for (const entry of sortedExcluded.slice(0, 3)) {
      console.log(`   └── ${entry.path.padEnd(25)} ${formatBytes(entry.size)} (EXCLUDED)`);
    }
  }
}

/**
 * Get suggested patterns for .skillignore based on largest entries
 */
function getSuggestedPatterns(entries: SizeEntry[], threshold: number = 1024 * 1024): string[] {
  const suggestions: string[] = [];
  const sortedEntries = [...entries].sort((a, b) => b.size - a.size);

  for (const entry of sortedEntries) {
    if (entry.size >= threshold) {
      // Suggest directory pattern if it's a directory
      if (entry.isDirectory) {
        suggestions.push(entry.path + '/');
      } else {
        suggestions.push(entry.path);
      }
    }
    if (suggestions.length >= 5) break;
  }

  return suggestions;
}

// =============================================================================
// Argument Parsing
// =============================================================================

interface Args {
  skillName?: string;
  all: boolean;
  list: boolean;
  validate: boolean;
  validateSize: boolean;
  outputDir: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    skillName: undefined,
    all: false,
    list: false,
    validate: false,
    validateSize: false,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--all') {
      result.all = true;
    } else if (arg === '--list') {
      result.list = true;
    } else if (arg === '--validate') {
      result.validate = true;
      // Next arg might be skill name
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        result.skillName = args[++i];
      }
    } else if (arg === '--validate-size') {
      result.validateSize = true;
      // Next arg might be skill name
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        result.skillName = args[++i];
      }
    } else if (arg === '--output' || arg === '-o') {
      if (args[i + 1]) {
        result.outputDir = args[++i];
      }
    } else if (!arg.startsWith('--')) {
      result.skillName = arg;
    }
  }

  return result;
}

// =============================================================================
// Skill Discovery (Multi-level like SkillSearch)
// =============================================================================

/**
 * Find all .claude/skills directories from CWD up to ~/.claude
 * Returns paths in order from closest (project) to farthest (user).
 */
function findAllSkillsDirectories(startDir: string): string[] {
  const skillsDirs: string[] = [];
  const home = homedir();
  const userClaudeSkillsDir = join(home, '.claude', 'skills');

  let currentDir = startDir;

  while (true) {
    const claudeSkillsDir = join(currentDir, '.claude', 'skills');

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

/**
 * Derive scope name from skills directory path
 */
function getScopeName(skillsDir: string): string {
  const home = homedir();
  const userSkillsDir = join(home, '.claude', 'skills');

  if (skillsDir === userSkillsDir) {
    return 'user';
  }

  // Extract project name from path (parent of .claude)
  const claudeDir = dirname(skillsDir);
  const projectDir = dirname(claudeDir);
  return basename(projectDir);
}

/**
 * Find all skills across all levels (project → user)
 * Returns map keyed by skill name (project-level overrides user-level)
 */
async function findAllSkills(): Promise<Map<string, SkillInfo>> {
  const skillsMap = new Map<string, SkillInfo>();
  const skillsDirs = findAllSkillsDirectories(process.cwd());

  // Process in reverse order (user-level first, project-level last)
  // so that project-level skills override user-level
  const orderedDirs = [...skillsDirs].reverse();

  for (const skillsDir of orderedDirs) {
    const scope = getScopeName(skillsDir);

    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            skillsMap.set(entry.name, {
              name: entry.name,
              skillDir: join(skillsDir, entry.name),
              scope,
            });
          }
        }
      }
    } catch {
      // Skip if we can't read the directory
    }
  }

  return skillsMap;
}

/**
 * Find a specific skill by name across all levels
 */
async function findSkill(skillName: string): Promise<SkillInfo | null> {
  const allSkills = await findAllSkills();
  return allSkills.get(skillName) || null;
}

// =============================================================================
// Validation
// =============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  frontmatter?: {
    name: string;
    description: string;
  };
}

function parseFrontmatter(content: string): { name?: string; description?: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);

  // Handle both single-line and multiline YAML descriptions
  let description = '';
  const multiLineMatch = frontmatter.match(/^description:\s*\|\n([\s\S]*?)(?=^\w+:|$)/m);
  const singleLineMatch = frontmatter.match(/^description:\s*([^|\n].+)$/m);

  if (multiLineMatch) {
    description = multiLineMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join(' ');
  } else if (singleLineMatch) {
    description = singleLineMatch[1].trim();
  }

  return {
    name: nameMatch?.[1]?.trim(),
    description,
  };
}

async function validateSkillByInfo(skillInfo: SkillInfo): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const skillMdPath = join(skillInfo.skillDir, 'SKILL.md');

  // Check skill directory exists
  if (!existsSync(skillInfo.skillDir)) {
    result.valid = false;
    result.errors.push(`Skill directory not found: ${skillInfo.skillDir}`);
    return result;
  }

  // Check SKILL.md exists
  if (!existsSync(skillMdPath)) {
    result.valid = false;
    result.errors.push(`SKILL.md not found in ${skillInfo.skillDir}`);
    return result;
  }

  // Parse and validate frontmatter
  const content = await readFile(skillMdPath, 'utf-8');
  const fm = parseFrontmatter(content);

  if (!fm) {
    result.valid = false;
    result.errors.push('SKILL.md missing YAML frontmatter (---...---)');
    return result;
  }

  if (!fm.name) {
    result.valid = false;
    result.errors.push('Frontmatter missing required field: name');
  }

  if (!fm.description) {
    result.valid = false;
    result.errors.push('Frontmatter missing required field: description');
  }

  if (fm.name && fm.description) {
    result.frontmatter = { name: fm.name, description: fm.description };
  }

  // Warnings (non-blocking)
  if (fm.description && fm.description.length > 1024) {
    result.warnings.push(`Description exceeds 1024 characters (${fm.description.length}). May be truncated by Claude.ai.`);
  }

  if (fm.name && fm.name !== skillInfo.name) {
    result.warnings.push(`Frontmatter name "${fm.name}" doesn't match directory name "${skillInfo.name}"`);
  }

  return result;
}

async function validateSkill(skillName: string): Promise<ValidationResult> {
  const skillInfo = await findSkill(skillName);
  if (!skillInfo) {
    return {
      valid: false,
      errors: [`Skill not found: ${skillName}`],
      warnings: [],
    };
  }
  return validateSkillByInfo(skillInfo);
}

// =============================================================================
// Packaging
// =============================================================================

interface FileEntry {
  sourcePath: string;
  archivePath: string;
}

interface PathReference {
  original: string;
  transformed: string;
  lineNumber: number;
  context: string;
}

/**
 * Extract all internal path references from SKILL.md content
 */
function extractPathReferences(content: string): PathReference[] {
  const references: PathReference[] = [];
  const lines = content.split('\n');

  // Patterns to match path references
  const patterns = [
    // Backtick references: `Workflows/File.md`
    /`((?:Tools|Workflows|Contexts|Templates|Data)\/[^`]+)`/g,
    // Markdown link references: (Workflows/File.md)
    /\(((?:Tools|Workflows|Contexts|Templates|Data)\/[^)]+)\)/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      let match;
      // Reset regex state
      pattern.lastIndex = 0;
      while ((match = pattern.exec(line)) !== null) {
        const original = match[1];
        const transformed = transformPath(original);
        references.push({
          original,
          transformed,
          lineNumber: i + 1,
          context: line.trim().substring(0, 80),
        });
      }
    }
  }

  return references;
}

/**
 * Transform a single path from PAI structure to Agent Skills structure
 */
function transformPath(path: string): string {
  return path
    .replace(/^Tools\//, 'scripts/')
    .replace(/^Workflows\//, 'references/')
    .replace(/^Contexts\//, 'references/')
    .replace(/^Templates\//, 'assets/')
    .replace(/^Data\//, 'assets/');
}

/**
 * Validate that all referenced files exist in the collected files
 */
function validatePathReferences(
  references: PathReference[],
  files: FileEntry[],
  kebabName: string
): { valid: boolean; missing: PathReference[] } {
  const archivePaths = new Set(files.map(f => f.archivePath));
  const missing: PathReference[] = [];

  for (const ref of references) {
    const expectedPath = `${kebabName}/${ref.transformed}`;
    if (!archivePaths.has(expectedPath)) {
      missing.push(ref);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

interface CollectResult {
  files: FileEntry[];
  sizeReport: SizeReport;
}

async function collectFiles(
  skillDir: string,
  skillName: string,
  kebabName: string,
  exclusionPatterns: string[] = []
): Promise<CollectResult> {
  const files: FileEntry[] = [];
  const entries: SizeEntry[] = [];
  const excludedEntries: SizeEntry[] = [];
  let totalSize = 0;
  let excludedSize = 0;

  async function walkDir(dir: string, relativePath: string = '', originalRelPath: string = '') {
    const dirEntries = await readdir(dir, { withFileTypes: true });

    for (const entry of dirEntries) {
      // Skip dotfiles (existing behavior)
      if (entry.name.startsWith('.')) continue;

      const sourcePath = join(dir, entry.name);
      // Track original path for exclusion matching (before directory mapping)
      const entryOriginalRelPath = originalRelPath ? join(originalRelPath, entry.name) : entry.name;
      const entryRelPath = relativePath ? join(relativePath, entry.name) : entry.name;

      // Use stat() to follow symlinks and determine actual type
      const stats = await stat(sourcePath);
      const isDir = stats.isDirectory();
      const isFile = stats.isFile();

      // Check against exclusion patterns (using original path)
      if (matchesExclusionPattern(entryOriginalRelPath, exclusionPatterns)) {
        if (isDir) {
          const dirSize = await calculateDirectorySize(sourcePath);
          excludedEntries.push({ path: entryOriginalRelPath, size: dirSize, isDirectory: true });
          excludedSize += dirSize;
        } else if (isFile) {
          excludedEntries.push({ path: entryOriginalRelPath, size: stats.size, isDirectory: false });
          excludedSize += stats.size;
        }
        continue;
      }

      if (isDir) {
        // Map directory names for archive path
        const mappedDir = DIRECTORY_MAPPING[entry.name] || entry.name;
        const newRelativePath = relativePath ? join(relativePath, mappedDir) : mappedDir;
        await walkDir(sourcePath, newRelativePath, entryOriginalRelPath);
      } else if (isFile) {
        totalSize += stats.size;
        entries.push({ path: entryRelPath, size: stats.size, isDirectory: false });

        let archivePath: string;

        if (entry.name === 'SKILL.md') {
          // SKILL.md goes at root (using kebab-case directory name)
          archivePath = join(kebabName, 'SKILL.md');
        } else if (relativePath) {
          // Files in subdirectories use mapped paths
          archivePath = join(kebabName, relativePath, entry.name);
        } else {
          // Other root-level .md files go to references/
          const ext = entry.name.substring(entry.name.lastIndexOf('.'));
          if (REFERENCE_EXTENSIONS.includes(ext)) {
            archivePath = join(kebabName, 'references', entry.name);
          } else {
            archivePath = join(kebabName, entry.name);
          }
        }

        files.push({ sourcePath, archivePath });
      }
    }
  }

  await walkDir(skillDir);

  return {
    files,
    sizeReport: {
      totalSize,
      entries,
      excludedSize,
      excludedEntries,
    },
  };
}

async function packageSkillByInfo(skillInfo: SkillInfo, outputDir: string): Promise<string | null> {
  // Validate first
  const validation = await validateSkillByInfo(skillInfo);

  if (!validation.valid) {
    console.log(`\n❌ Validation failed for ${skillInfo.name} (${skillInfo.scope}):`);
    for (const error of validation.errors) {
      console.log(`   - ${error}`);
    }
    return null;
  }

  if (validation.warnings.length > 0) {
    console.log(`\n⚠️  Warnings for ${skillInfo.name}:`);
    for (const warning of validation.warnings) {
      console.log(`   - ${warning}`);
    }
  }

  // Load exclusion patterns
  const exclusions = await loadExclusionPatterns(skillInfo.skillDir);
  if (exclusions.hasCustomFile) {
    console.log(`   📋 Custom .skillignore: ${exclusions.customPatterns.length} patterns`);
  }

  // Convert to kebab-case for Agent Skills spec compliance
  const kebabName = toKebabCase(skillInfo.name);
  const { files, sizeReport } = await collectFiles(skillInfo.skillDir, skillInfo.name, kebabName, exclusions.patterns);

  // Print size report
  printSizeReport(sizeReport, skillInfo.name);

  // Validate size
  const sizeValidation = validateSize(sizeReport.totalSize);

  if (sizeValidation.status === 'error') {
    console.log(`\n❌ PACKAGING BLOCKED: ${sizeValidation.message}`);
    console.log(`\n   Largest entries:`);
    const sorted = [...sizeReport.entries].sort((a, b) => b.size - a.size);
    for (const entry of sorted.slice(0, 5)) {
      console.log(`   ├── ${entry.path.padEnd(25)} ${formatBytes(entry.size)}`);
    }
    const ignoreFilePath = join(skillInfo.skillDir, SKILL_IGNORE_FILE);
    console.log(`\n   Create ${SKILL_IGNORE_FILE} at: ${ignoreFilePath}`);
    const suggestions = getSuggestedPatterns(sizeReport.entries);
    if (suggestions.length > 0) {
      console.log(`   Suggested patterns:`);
      for (const pattern of suggestions) {
        console.log(`     ${pattern}`);
      }
    }
    return null;
  }

  if (sizeValidation.status === 'warning') {
    console.log(`\n⚠️  SIZE WARNING: ${sizeValidation.message}`);
    console.log(`   Consider adding patterns to ${SKILL_IGNORE_FILE}`);
  } else {
    console.log(`\n✅ Size OK: ${sizeValidation.message}`);
  }

  // Read SKILL.md and validate path references
  const skillMdPath = join(skillInfo.skillDir, 'SKILL.md');
  const skillMdContent = await readFile(skillMdPath, 'utf-8');
  const pathRefs = extractPathReferences(skillMdContent);
  const refValidation = validatePathReferences(pathRefs, files, kebabName);

  if (!refValidation.valid) {
    console.log(`\n❌ Missing referenced files for ${skillInfo.name}:`);
    for (const missing of refValidation.missing) {
      console.log(`   Line ${missing.lineNumber}: ${missing.original}`);
      console.log(`      Expected: ${missing.transformed}`);
      console.log(`      Context: ${missing.context}`);
    }
    return null;
  }

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Output file uses kebab-case name
  const outputPath = join(outputDir, `${kebabName}.skill`);

  // Create a temp directory with the correct structure
  const tempDir = join(outputDir, `.temp-${kebabName}-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    // Copy files with correct structure
    for (const file of files) {
      const destPath = join(tempDir, file.archivePath);
      const destDir = join(destPath, '..');
      await mkdir(destDir, { recursive: true });

      // Transform SKILL.md to use kebab-case name and update paths
      if (file.sourcePath.endsWith('SKILL.md')) {
        let content = await readFile(file.sourcePath, 'utf-8');

        // Replace the name field in frontmatter with kebab-case
        content = content.replace(
          /^(---\n[\s\S]*?^name:\s*).+$/m,
          `$1${kebabName}`
        );

        // Transform directory references to match Agent Skills structure
        // Tools/ → scripts/
        content = content.replace(/`Tools\//g, '`scripts/');
        content = content.replace(/\(Tools\//g, '(scripts/');
        content = content.replace(/Tools\/([^`\s)]+)/g, 'scripts/$1');

        // Workflows/ → references/
        content = content.replace(/`Workflows\//g, '`references/');
        content = content.replace(/\(Workflows\//g, '(references/');
        content = content.replace(/Workflows\/([^`\s)]+)/g, 'references/$1');

        // Contexts/ → references/
        content = content.replace(/`Contexts\//g, '`references/');
        content = content.replace(/\(Contexts\//g, '(references/');
        content = content.replace(/Contexts\/([^`\s)]+)/g, 'references/$1');

        // Templates/ → assets/
        content = content.replace(/`Templates\//g, '`assets/');
        content = content.replace(/\(Templates\//g, '(assets/');
        content = content.replace(/Templates\/([^`\s)]+)/g, 'assets/$1');

        // Data/ → assets/
        content = content.replace(/`Data\//g, '`assets/');
        content = content.replace(/\(Data\//g, '(assets/');
        content = content.replace(/Data\/([^`\s)]+)/g, 'assets/$1');

        await Bun.write(destPath, content);
      } else {
        await Bun.write(destPath, Bun.file(file.sourcePath));
      }
    }

    // Remove existing .skill file if it exists
    if (existsSync(outputPath)) {
      await Bun.spawn(['rm', outputPath]).exited;
    }

    // Create ZIP (using kebab-case directory name)
    const zipProc = Bun.spawn(['zip', '-r', outputPath, kebabName], {
      cwd: tempDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    await zipProc.exited;

    // Clean up temp directory
    await Bun.spawn(['rm', '-rf', tempDir]).exited;

    console.log(`\n✅ Packaged: ${kebabName}.skill (${skillInfo.scope})`);
    console.log(`   📍 ${outputPath}`);
    if (kebabName !== skillInfo.name.toLowerCase()) {
      console.log(`   📝 ${skillInfo.name} → ${kebabName}`);
    }

    return outputPath;
  } catch (error) {
    // Clean up on error
    if (existsSync(tempDir)) {
      await Bun.spawn(['rm', '-rf', tempDir]).exited;
    }
    throw error;
  }
}

async function packageSkill(skillName: string, outputDir: string): Promise<string | null> {
  const skillInfo = await findSkill(skillName);
  if (!skillInfo) {
    console.log(`\n❌ Skill not found: ${skillName}`);
    return null;
  }
  return packageSkillByInfo(skillInfo, outputDir);
}

// =============================================================================
// Commands
// =============================================================================

async function listSkills(): Promise<void> {
  const skillsMap = await findAllSkills();

  if (skillsMap.size === 0) {
    console.log('No skills found.');
    return;
  }

  // Group skills by scope
  const byScope = new Map<string, SkillInfo[]>();
  for (const skill of skillsMap.values()) {
    const existing = byScope.get(skill.scope) || [];
    existing.push(skill);
    byScope.set(skill.scope, existing);
  }

  console.log(`\n📚 Available skills (${skillsMap.size} total):\n`);

  for (const [scope, skills] of byScope) {
    console.log(`  [${scope}]`);
    for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
      const validation = await validateSkillByInfo(skill);
      const status = validation.valid ? '✅' : '❌';
      const desc = validation.frontmatter?.description?.substring(0, 50) || '';
      console.log(`    ${status} ${skill.name}`);
      if (desc) {
        console.log(`       ${desc}${desc.length >= 50 ? '...' : ''}`);
      }
    }
    console.log();
  }
}

async function runValidation(skillName: string): Promise<void> {
  console.log(`\n🔍 Validating: ${skillName}\n`);

  const skillInfo = await findSkill(skillName);
  if (!skillInfo) {
    console.log(`❌ Skill not found: ${skillName}`);
    return;
  }

  const result = await validateSkillByInfo(skillInfo);

  if (result.valid) {
    console.log('✅ Frontmatter validation passed');
    if (result.frontmatter) {
      console.log(`   Name: ${result.frontmatter.name}`);
      console.log(`   Description: ${result.frontmatter.description.substring(0, 80)}...`);
    }
  } else {
    console.log('❌ Frontmatter validation failed:');
    for (const error of result.errors) {
      console.log(`   - ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    for (const warning of result.warnings) {
      console.log(`   - ${warning}`);
    }
  }

  // Load exclusion patterns
  const exclusions = await loadExclusionPatterns(skillInfo.skillDir);
  if (exclusions.hasCustomFile) {
    console.log(`\n📋 Custom .skillignore: ${exclusions.customPatterns.length} patterns`);
  }

  // Validate path references
  const kebabName = toKebabCase(skillInfo.name);
  const { files, sizeReport } = await collectFiles(skillInfo.skillDir, skillInfo.name, kebabName, exclusions.patterns);
  const skillMdPath = join(skillInfo.skillDir, 'SKILL.md');
  const skillMdContent = await readFile(skillMdPath, 'utf-8');
  const pathRefs = extractPathReferences(skillMdContent);

  if (pathRefs.length > 0) {
    console.log(`\n📂 Path references found: ${pathRefs.length}`);
    const refValidation = validatePathReferences(pathRefs, files, kebabName);

    if (refValidation.valid) {
      console.log('✅ All referenced files exist');
      for (const ref of pathRefs) {
        console.log(`   ${ref.original} → ${ref.transformed}`);
      }
    } else {
      console.log('❌ Missing referenced files:');
      for (const missing of refValidation.missing) {
        console.log(`   Line ${missing.lineNumber}: ${missing.original}`);
        console.log(`      Expected: ${missing.transformed}`);
      }
    }
  } else {
    console.log('\n📂 No internal path references found');
  }

  // Size validation (warning only, does not block)
  printSizeReport(sizeReport, skillInfo.name);
  const sizeValidation = validateSize(sizeReport.totalSize);

  if (sizeValidation.status === 'error') {
    console.log(`\n⚠️  SIZE WARNING: ${sizeValidation.message}`);
    console.log(`   This will block packaging. Consider creating a ${SKILL_IGNORE_FILE} file.`);

    // Show largest entries
    console.log(`\n   Largest entries:`);
    const sorted = [...sizeReport.entries].sort((a, b) => b.size - a.size);
    for (const entry of sorted.slice(0, 5)) {
      console.log(`   ├── ${entry.path.padEnd(25)} ${formatBytes(entry.size)}`);
    }

    // Offer to generate .skillignore
    const suggestions = getSuggestedPatterns(sizeReport.entries);
    if (suggestions.length > 0) {
      const ignoreFilePath = join(skillInfo.skillDir, SKILL_IGNORE_FILE);
      console.log(`\n   Suggested ${SKILL_IGNORE_FILE} patterns:`);
      for (const pattern of suggestions) {
        console.log(`     ${pattern}`);
      }
      console.log(`\n   To create ${SKILL_IGNORE_FILE}, run:`);
      console.log(`   echo "${suggestions.join('\\n')}" > ${ignoreFilePath}`);
    }
  } else if (sizeValidation.status === 'warning') {
    console.log(`\n⚠️  SIZE WARNING: ${sizeValidation.message}`);
    console.log(`   Consider adding patterns to ${SKILL_IGNORE_FILE}`);
  } else {
    console.log(`\n✅ Size OK: ${sizeValidation.message}`);
  }
}

/**
 * Run size validation only (for --validate-size flag)
 */
async function runSizeValidation(skillName: string): Promise<void> {
  console.log(`\n📏 Size Validation: ${skillName}\n`);

  const skillInfo = await findSkill(skillName);
  if (!skillInfo) {
    console.log(`❌ Skill not found: ${skillName}`);
    return;
  }

  // Load exclusion patterns
  const exclusions = await loadExclusionPatterns(skillInfo.skillDir);
  if (exclusions.hasCustomFile) {
    console.log(`📋 Custom .skillignore: ${exclusions.customPatterns.length} patterns`);
  }

  // Collect files and calculate sizes
  const kebabName = toKebabCase(skillInfo.name);
  const { sizeReport } = await collectFiles(skillInfo.skillDir, skillInfo.name, kebabName, exclusions.patterns);

  // Print size report
  printSizeReport(sizeReport, skillInfo.name);

  // Validate size
  const sizeValidation = validateSize(sizeReport.totalSize);

  if (sizeValidation.status === 'error') {
    console.log(`\n❌ SIZE EXCEEDS LIMIT: ${sizeValidation.message}`);
    console.log(`   Packaging will be blocked until size is reduced.`);

    // Show largest entries
    console.log(`\n   Largest entries:`);
    const sorted = [...sizeReport.entries].sort((a, b) => b.size - a.size);
    for (const entry of sorted.slice(0, 5)) {
      console.log(`   ├── ${entry.path.padEnd(25)} ${formatBytes(entry.size)}`);
    }

    // Suggest patterns
    const suggestions = getSuggestedPatterns(sizeReport.entries);
    if (suggestions.length > 0) {
      const ignoreFilePath = join(skillInfo.skillDir, SKILL_IGNORE_FILE);
      console.log(`\n   Create ${SKILL_IGNORE_FILE} at: ${ignoreFilePath}`);
      console.log(`   Suggested patterns:`);
      for (const pattern of suggestions) {
        console.log(`     ${pattern}`);
      }
    }
  } else if (sizeValidation.status === 'warning') {
    console.log(`\n⚠️  SIZE WARNING: ${sizeValidation.message}`);
    console.log(`   Consider reducing size before it exceeds the limit.`);
  } else {
    console.log(`\n✅ Size OK: ${sizeValidation.message}`);
  }
}

async function packageAll(outputDir: string): Promise<void> {
  const skillsMap = await findAllSkills();

  if (skillsMap.size === 0) {
    console.log('No skills found to package.');
    return;
  }

  console.log(`\n📦 Packaging ${skillsMap.size} skills...\n`);

  let success = 0;
  let failed = 0;

  for (const skillInfo of skillsMap.values()) {
    const result = await packageSkillByInfo(skillInfo, outputDir);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Packaged: ${success}`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}`);
  }
  console.log(`📍 Output: ${outputDir}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = parseArgs();

  if (args.list) {
    await listSkills();
    return;
  }

  if (args.validate) {
    if (!args.skillName) {
      console.log('Usage: bun run PackageSkill.ts --validate <skill-name>');
      process.exit(1);
    }
    await runValidation(args.skillName);
    return;
  }

  if (args.validateSize) {
    if (!args.skillName) {
      console.log('Usage: bun run PackageSkill.ts --validate-size <skill-name>');
      process.exit(1);
    }
    await runSizeValidation(args.skillName);
    return;
  }

  if (args.all) {
    await packageAll(args.outputDir);
    return;
  }

  if (args.skillName) {
    await packageSkill(args.skillName, args.outputDir);
    return;
  }

  // No args - show usage
  console.log(`
PackageSkill - Package PAI skills into .skill format for Claude.ai

Usage:
  bun run PackageSkill.ts <skill-name>                  # Package single skill
  bun run PackageSkill.ts <skill-name> --output ./      # Custom output directory
  bun run PackageSkill.ts --all                         # Package all skills
  bun run PackageSkill.ts --list                        # List available skills
  bun run PackageSkill.ts --validate <skill-name>       # Validate skill only
  bun run PackageSkill.ts --validate-size <skill-name>  # Check size only

Size Limits:
  Maximum: ${formatBytes(SIZE_LIMIT_BYTES)} (before compression)
  Warning: ${formatBytes(SIZE_WARNING_BYTES)}

Default output: ${DEFAULT_OUTPUT_DIR}
`);
}

main().catch(console.error);
