/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// PreToolUse hook: refuses changes while the project checkout is on the main
// branch. Blocks file edits inside the repo and git commit/push/merge, so
// agents always work on a feature branch (see CLAUDE.md, Workflow).
// Exit code 2 blocks the tool call and shows stderr to the agent.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROTECTED = new Set(['master', 'main']);
const GIT_WRITE = /\bgit\b[^;&|\n]*\b(commit|push|merge)\b/;

const input = JSON.parse(readFileSync(0, 'utf8'));
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

const git = (...args) =>
  execFileSync('git', args, {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

let branch, repoRoot;
try {
  branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  // Ask git for the root: it returns a native path even when the env var
  // holds a Git Bash style path like /c/Users/...
  repoRoot = git('rev-parse', '--show-toplevel');
} catch {
  process.exit(0); // Not a git checkout: nothing to guard.
}
if (!PROTECTED.has(branch)) process.exit(0);

const normalize = (p) => {
  const resolved = path.resolve(repoRoot, p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const isInsideProject = (p) => {
  const root = normalize(repoRoot);
  const target = normalize(p);
  return target === root || target.startsWith(root + path.sep);
};

const tool = input.tool_name;
const args = input.tool_input ?? {};
let reason = null;

if (['Edit', 'Write', 'NotebookEdit'].includes(tool)) {
  const target = args.file_path ?? args.notebook_path;
  if (target && isInsideProject(target)) reason = `editing ${target}`;
} else if (['Bash', 'PowerShell'].includes(tool)) {
  const match = GIT_WRITE.exec(args.command ?? '');
  if (match) reason = `running git ${match[1]}`;
}

if (reason) {
  process.stderr.write(
    `Blocked: ${reason} on '${branch}'. Changes never go directly on ` +
      `'${branch}'. Create a feature branch first, as its own command:\n` +
      `  git switch -c <type>/<short-name>\n` +
      `then make the change there and open a PR (see CLAUDE.md, Workflow).\n`,
  );
  process.exit(2);
}
