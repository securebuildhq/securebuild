import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync } from "fs";
import { join, relative, dirname, basename } from "path";
import { tmpdir } from "os";
import * as semver from "semver";

export interface AdditionalFile {
  path: string;
  content: string;
}

export interface SpecContent {
  content: string;
  commitSha: string;
  additionalFiles: AdditionalFile[];
}

export function pullSpecFromGit(
  gitRemote: string,
  filePath: string,
  tag: string
): SpecContent {
  const repoDir = mkdtempSync();

  try {
    cloneRepoAtTag(repoDir, gitRemote, tag);

    const commitSha = resolveHead(repoDir);
    const fullPath = join(repoDir, filePath);
    const content = readFileSync(fullPath, "utf-8");

    const specDir = dirname(fullPath);
    const specFileName = basename(fullPath);
    const additionalFiles = collectAdditionalFiles(specDir, specFileName);

    return { content, commitSha, additionalFiles };
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

export function resolveTagToCommit(gitRemote: string, tag: string): string {
  const repoDir = mkdtempSync();

  try {
    cloneRepoAtTag(repoDir, gitRemote, tag);
    return resolveHead(repoDir);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

export function listTags(gitRemote: string): string[] {
  const repoDir = mkdtempSync();

  try {
    execSync(
      `git clone --bare --filter=blob-none "${gitRemote}" "${repoDir}"`,
      { stdio: "pipe", timeout: 60000 }
    );

    const output = execSync(`git -C "${repoDir}" tag --list`, {
      stdio: "pipe",
      timeout: 30000,
    }).toString();

    return output
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t !== "");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

export function generateOCITagFromTemplate(
  template: string,
  gitTag: string
): string {
  if (!template) {
    return gitTag;
  }

  const parsed = semver.coerce(gitTag);
  if (!parsed) {
    return gitTag;
  }

  let result = template;
  result = result.replace(/\{major\}/g, String(parsed.major));
  result = result.replace(/\{minor\}/g, String(parsed.minor));
  result = result.replace(/\{patch\}/g, String(parsed.patch));
  return result;
}

function mkdtempSync(): string {
  return join(tmpdir(), `gitspec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function cloneRepoAtTag(dir: string, gitRemote: string, tag: string): void {
  mkdirSync(dirname(dir), { recursive: true });
  execSync(
    `git clone --depth 1 --branch "${tag}" "${gitRemote}" "${dir}"`,
    { stdio: "pipe", timeout: 120000 }
  );
}

function resolveHead(repoDir: string): string {
  return execSync(`git -C "${repoDir}" rev-parse HEAD`, {
    stdio: "pipe",
    timeout: 10000,
  })
    .toString()
    .trim();
}

function collectAdditionalFiles(
  specDir: string,
  specFileName: string
): AdditionalFile[] {
  const files: AdditionalFile[] = [];

  function walk(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === ".git") continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry === specFileName && dir === specDir) continue;

      const relPath = relative(specDir, fullPath);
      if (relPath === "." || relPath === "") continue;

      const content = readFileSync(fullPath, "utf-8");
      files.push({ path: relPath, content });
    }
  }

  if (existsSync(specDir)) {
    walk(specDir);
  }

  return files;
}
