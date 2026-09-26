/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// PreToolUse hook: keeps agents off the main branch (see CLAUDE.md,
// Workflow). While the checkout is on master/main it blocks file edits inside
// the repo and git commit/merge/push. From any branch it blocks pushes that
// target master/main and commands that switch to master/main and then write.
// Exit code 2 blocks the tool call and shows stderr to the agent.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROTECTED = new Set(['master', 'main']);
// Global git options that take a separate value, e.g. `git -C dir commit`.
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree']);

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

const normalize = (p) => {
  const resolved = path.resolve(repoRoot, p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const isInsideProject = (p) => {
  const root = normalize(repoRoot);
  const target = normalize(p);
  return target === root || target.startsWith(root + path.sep);
};

// Splits a shell command into simple commands and returns each git
// invocation as [subcommand, ...args], with git's global options skipped.
const gitInvocations = (command) =>
  command.split(/&&|\|\||[;&|\n]/).flatMap((part) => {
    const words = part.trim().split(/\s+/);
    let i = words.indexOf('git') + 1;
    if (i === 0) return [];
    while (i < words.length && words[i].startsWith('-')) {
      i += GIT_OPTS_WITH_VALUE.has(words[i]) ? 2 : 1;
    }
    return i < words.length ? [words.slice(i)] : [];
  });

// True if a push refspec such as `master`, `+main` or `HEAD:master` names a
// protected branch as its destination.
const refTargetsProtected = (ref) =>
  PROTECTED.has(ref.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, ''));

// Walks the git invocations in order, tracking which branch the checkout is
// on after any switch/checkout, and returns why the command is refused.
const checkCommand = (command) => {
  let current = branch;
  for (const [sub, ...rest] of gitInvocations(command)) {
    const positional = rest.filter((a) => !a.startsWith('-'));
    if ((sub === 'switch' || sub === 'checkout') && !rest.includes('--')) {
      // With -c/-b the first positional is the new branch; either way it's
      // the branch we end up on.
      if (positional.length > 0) current = positional[0];
    } else if ((sub === 'commit' || sub === 'merge') && PROTECTED.has(current)) {
      return `running git ${sub} on '${current}'`;
    } else if (sub === 'push') {
      if (PROTECTED.has(current)) return `running git push on '${current}'`;
      // positional[0] is the remote; the rest are refspecs.
      const ref = positional.slice(1).find(refTargetsProtected);
      if (ref) return `pushing to a protected branch (${ref})`;
    }
  }
  return null;
};

const tool = input.tool_name;
const args = input.tool_input ?? {};
let reason = null;

if (['Edit', 'Write', 'NotebookEdit'].includes(tool)) {
  const target = args.file_path ?? args.notebook_path;
  if (PROTECTED.has(branch) && target && isInsideProject(target)) {
    reason = `editing ${target} on '${branch}'`;
  }
} else if (['Bash', 'PowerShell'].includes(tool)) {
  reason = checkCommand(args.command ?? '');
}

if (reason) {
  process.stderr.write(
    `Blocked: ${reason}. Changes never go directly on master. Create a ` +
      `feature branch first, as its own command:\n` +
      `  git switch -c <type>/<short-name>\n` +
      `then make the change there and open a PR (see CLAUDE.md, Workflow).\n`,
  );
  process.exit(2);
}
