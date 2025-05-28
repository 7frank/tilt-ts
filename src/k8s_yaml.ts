// src/k8s_yaml.ts
import { tiltConfig } from "./tiltState";
import { glob } from "glob";
import path from "path";

/**
 * Register Kubernetes YAML resources for deployment
 *
 * Supports multiple input formats:
 * - Single file: k8s_yaml("./example/deployment.yaml")
 * - Directory: k8s_yaml("./example/") or k8s_yaml("./example")
 * - Glob pattern: k8s_yaml("./example/*.yaml") or k8s_yaml("./example/*")
 * - Multiple files: k8s_yaml(["./example/deployment.yaml", "./example/service.yaml"])
 * - Mixed patterns: k8s_yaml(["./example/", "./other/*.yaml", "./single.yml"])
 */
export function k8s_yaml(yamlInput: string | string[]) {
  const inputs = Array.isArray(yamlInput) ? yamlInput : [yamlInput];
  const resolvedPaths: string[] = [];

  for (const input of inputs) {
    const resolved = resolveYamlInput(input.trim());
    resolvedPaths.push(...resolved);
  }

  // Remove duplicates and sort for consistent ordering
  const uniquePaths = [...new Set(resolvedPaths)].sort();

  if (uniquePaths.length === 0) {
    console.warn(`⚠️  No YAML files found for input: ${yamlInput}`);
    return;
  }

  // Store each resolved path as a separate k8s_yaml config
  // This allows for better change tracking and individual management
  for (const yamlPath of uniquePaths) {
    tiltConfig.addK8sYaml(yamlPath);
  }

  console.log(`📁 Registered ${uniquePaths.length} YAML file(s):`);
  uniquePaths.forEach((p) => console.log(`   - ${p}`));
}

/**
 * Resolve different types of YAML inputs to actual file paths
 */
function resolveYamlInput(input: string): string[] {
  try {
    // Normalize path separators and resolve relative paths
    const normalizedInput = path.resolve(input);

    // Check if it's a glob pattern (contains *, ?, [, or **)
    if (containsGlobPattern(input)) {
      return resolveGlobPattern(input);
    }

    // Check if it's a directory
    if (isDirectory(normalizedInput)) {
      return resolveDirectory(normalizedInput);
    }

    // Check if it's a single file
    if (isFile(normalizedInput)) {
      if (isYamlFile(normalizedInput)) {
        return [normalizedInput];
      } else {
        console.warn(`⚠️  File ${normalizedInput} is not a YAML file`);
        return [];
      }
    }

    // Path doesn't exist - might be a glob pattern without special chars
    // Try as glob first, then warn if nothing found
    const globResults = resolveGlobPattern(input);
    if (globResults.length > 0) {
      return globResults;
    }

    console.warn(`⚠️  Path does not exist: ${input}`);
    return [];
  } catch (error) {
    console.error(`❌ Error resolving YAML input "${input}": ${error}`);
    return [];
  }
}

/**
 * Check if a string contains glob pattern characters
 */
function containsGlobPattern(path: string): boolean {
  return /[*?[\]{}]/.test(path) || path.includes("**");
}

/**
 * Resolve glob pattern to matching files
 */
function resolveGlobPattern(pattern: string): string[] {
  try {
    const matches = glob.sync(pattern, {
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.*", // Hidden files
        "**/*.tmp",
        "**/*.bak",
      ],
      absolute: true,
      nodir: true, // Only return files, not directories
    });

    // Filter to only YAML files
    const yamlFiles = matches.filter(isYamlFile);

    if (matches.length > yamlFiles.length) {
      const nonYamlCount = matches.length - yamlFiles.length;
      console.log(
        `📝 Filtered out ${nonYamlCount} non-YAML file(s) from pattern: ${pattern}`
      );
    }

    return yamlFiles;
  } catch (error) {
    console.error(`❌ Error resolving glob pattern "${pattern}": ${error}`);
    return [];
  }
}

/**
 * Resolve directory to all YAML files within it
 */
function resolveDirectory(dirPath: string): string[] {
  try {
    // Look for YAML files in directory and subdirectories
    const patterns = [
      path.join(dirPath, "*.yaml"),
      path.join(dirPath, "*.yml"),
      path.join(dirPath, "**/*.yaml"),
      path.join(dirPath, "**/*.yml"),
    ];

    const allFiles: string[] = [];

    for (const pattern of patterns) {
      const matches = glob.sync(pattern, {
        ignore: ["**/node_modules/**", "**/.git/**", "**/.*"],
        absolute: true,
        nodir: true,
      });
      allFiles.push(...matches);
    }

    // Remove duplicates
    const uniqueFiles = [...new Set(allFiles)];

    if (uniqueFiles.length === 0) {
      console.warn(`⚠️  No YAML files found in directory: ${dirPath}`);
    }

    return uniqueFiles;
  } catch (error) {
    console.error(`❌ Error resolving directory "${dirPath}": ${error}`);
    return [];
  }
}

/**
 * Check if path is a directory
 */
function isDirectory(path: string): boolean {
  try {
    const stat = require("fs").statSync(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if path is a file
 */
function isFile(path: string): boolean {
  try {
    const stat = require("fs").statSync(path);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if file has YAML extension
 */
function isYamlFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".yaml" || ext === ".yml";
}

/**
 * Validate YAML file content (basic check)
 */
export function validateYamlFile(filePath: string): {
  valid: boolean;
  error?: string;
} {
  try {
    const content = require("fs").readFileSync(filePath, "utf8");

    // Basic validation - check if it's not empty and doesn't have obvious syntax errors
    if (!content.trim()) {
      return { valid: false, error: "File is empty" };
    }

    // Check for common YAML issues
    if (content.includes("\t")) {
      console.warn(
        `⚠️  File ${filePath} contains tabs - YAML should use spaces for indentation`
      );
    }

    // Try to parse with js-yaml if available
    try {
      const yaml = require("js-yaml");
      yaml.load(content);
    } catch (yamlError) {
      return { valid: false, error: `YAML syntax error: ${yamlError}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Cannot read file: ${error}` };
  }
}

/**
 * Get statistics about resolved YAML files
 */
export function getYamlStats(yamlInput: string | string[]): {
  totalFiles: number;
  byExtension: Record<string, number>;
  byDirectory: Record<string, number>;
  largestFile: { path: string; size: number } | null;
} {
  const inputs = Array.isArray(yamlInput) ? yamlInput : [yamlInput];
  const resolvedPaths: string[] = [];

  for (const input of inputs) {
    const resolved = resolveYamlInput(input.trim());
    resolvedPaths.push(...resolved);
  }

  const uniquePaths = [...new Set(resolvedPaths)];
  const stats = {
    totalFiles: uniquePaths.length,
    byExtension: {} as Record<string, number>,
    byDirectory: {} as Record<string, number>,
    largestFile: null as { path: string; size: number } | null,
  };

  let maxSize = 0;

  for (const filePath of uniquePaths) {
    // Count by extension
    const ext = path.extname(filePath).toLowerCase();
    stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;

    // Count by directory
    const dir = path.dirname(filePath);
    stats.byDirectory[dir] = (stats.byDirectory[dir] || 0) + 1;

    // Track largest file
    try {
      const stat = require("fs").statSync(filePath);
      if (stat.size > maxSize) {
        maxSize = stat.size;
        stats.largestFile = { path: filePath, size: stat.size };
      }
    } catch {
      // Ignore stat errors
    }
  }

  return stats;
}
