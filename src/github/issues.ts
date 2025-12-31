import { gh } from "@/github/cli.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("github-issues");

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface IssueComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
}

export interface CreateIssueParams {
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface UpdateIssueParams {
  repo: string;
  number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  labels?: string[];
  assignees?: string[];
}

export async function listIssues(
  repo: string,
  options: { state?: "open" | "closed" | "all"; labels?: string[] } = {}
): Promise<Issue[]> {
  const args = ["issue", "list", "-R", repo];

  if (options.state) {
    args.push("--state", options.state);
  }

  if (options.labels && options.labels.length > 0) {
    args.push("--label", options.labels.join(","));
  }

  args.push("--json", "number,title,body,state,labels,assignees,author,createdAt,updatedAt,url");

  const result = await gh(args);

  if (result.exitCode !== 0) {
    logger.error({ repo, stderr: result.stderr }, "Failed to list issues");
    throw new Error(`Failed to list issues: ${result.stderr}`);
  }

  const issues = JSON.parse(result.stdout) as Array<{
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    author: { login: string };
    createdAt: string;
    updatedAt: string;
    url: string;
  }>;

  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state as "open" | "closed",
    labels: issue.labels.map((l) => l.name),
    assignees: issue.assignees.map((a) => a.login),
    author: issue.author.login,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    url: issue.url,
  }));
}

export async function getIssue(repo: string, number: number): Promise<Issue> {
  const args = [
    "issue",
    "view",
    String(number),
    "-R",
    repo,
    "--json",
    "number,title,body,state,labels,assignees,author,createdAt,updatedAt,url",
  ];

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get issue #${number}: ${result.stderr}`);
  }

  const issue = JSON.parse(result.stdout) as {
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    author: { login: string };
    createdAt: string;
    updatedAt: string;
    url: string;
  };

  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state as "open" | "closed",
    labels: issue.labels.map((l) => l.name),
    assignees: issue.assignees.map((a) => a.login),
    author: issue.author.login,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    url: issue.url,
  };
}

export async function createIssue(params: CreateIssueParams): Promise<Issue> {
  const { repo, title, body, labels, assignees } = params;
  const args = ["issue", "create", "-R", repo, "--title", title];

  if (body) {
    args.push("--body", body);
  }

  if (labels && labels.length > 0) {
    args.push("--label", labels.join(","));
  }

  if (assignees && assignees.length > 0) {
    args.push("--assignee", assignees.join(","));
  }

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create issue: ${result.stderr}`);
  }

  const urlMatch = result.stdout.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  if (!urlMatch) {
    throw new Error("Failed to parse issue URL from output");
  }

  const issueNumber = parseInt(urlMatch[1]!, 10);
  logger.info({ repo, number: issueNumber, title }, "Issue created");

  return getIssue(repo, issueNumber);
}

export async function updateIssue(params: UpdateIssueParams): Promise<void> {
  const { repo, number, title, body, state, labels, assignees } = params;
  const args = ["issue", "edit", String(number), "-R", repo];

  if (title) {
    args.push("--title", title);
  }

  if (body) {
    args.push("--body", body);
  }

  if (labels) {
    args.push("--remove-label", "");
    if (labels.length > 0) {
      args.push("--add-label", labels.join(","));
    }
  }

  if (assignees) {
    args.push("--remove-assignee", "");
    if (assignees.length > 0) {
      args.push("--add-assignee", assignees.join(","));
    }
  }

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to update issue #${number}: ${result.stderr}`);
  }

  if (state) {
    const stateArgs = ["issue", state === "closed" ? "close" : "reopen", String(number), "-R", repo];
    const stateResult = await gh(stateArgs);

    if (stateResult.exitCode !== 0) {
      throw new Error(`Failed to update issue state: ${stateResult.stderr}`);
    }
  }

  logger.info({ repo, number }, "Issue updated");
}

export async function getIssueComments(repo: string, number: number): Promise<IssueComment[]> {
  const args = [
    "issue",
    "view",
    String(number),
    "-R",
    repo,
    "--json",
    "comments",
  ];

  const result = await gh(args);

  if (result.exitCode !== 0) {
    logger.warn({ repo, number, stderr: result.stderr }, "Failed to get issue comments");
    return [];
  }

  const data = JSON.parse(result.stdout) as {
    comments: Array<{
      id: string;
      body: string;
      author: { login: string };
      createdAt: string;
    }>;
  };

  return data.comments.map((c) => ({
    id: parseInt(c.id, 10) || 0,
    body: c.body,
    author: c.author.login,
    createdAt: c.createdAt,
  }));
}

export async function addIssueComment(repo: string, number: number, body: string): Promise<void> {
  const args = ["issue", "comment", String(number), "-R", repo, "--body", body];

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to add comment: ${result.stderr}`);
  }

  logger.info({ repo, number }, "Comment added to issue");
}

export async function addIssueLabels(repo: string, number: number, labels: string[]): Promise<void> {
  const args = ["issue", "edit", String(number), "-R", repo, "--add-label", labels.join(",")];

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to add labels: ${result.stderr}`);
  }

  logger.info({ repo, number, labels }, "Labels added to issue");
}

export async function removeIssueLabels(repo: string, number: number, labels: string[]): Promise<void> {
  const args = ["issue", "edit", String(number), "-R", repo, "--remove-label", labels.join(",")];

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to remove labels: ${result.stderr}`);
  }

  logger.info({ repo, number, labels }, "Labels removed from issue");
}

export interface LabelDefinition {
  name: string;
  color?: string;
  description?: string;
}

export async function ensureLabel(repo: string, label: LabelDefinition): Promise<void> {
  // Check if label exists
  const checkResult = await gh(["api", `repos/${repo}/labels/${encodeURIComponent(label.name)}`]);

  if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
    // Label exists, check if we need to update it
    try {
      const existingLabel = JSON.parse(checkResult.stdout) as { color: string; description: string };
      const needsUpdate =
        (label.color && existingLabel.color !== label.color) ||
        (label.description && existingLabel.description !== label.description);

      if (needsUpdate) {
        const updateArgs = ["api", "-X", "PATCH", `repos/${repo}/labels/${encodeURIComponent(label.name)}`];
        if (label.color) {
          updateArgs.push("-f", `color=${label.color}`);
        }
        if (label.description) {
          updateArgs.push("-f", `description=${label.description}`);
        }

        const updateResult = await gh(updateArgs);
        if (updateResult.exitCode !== 0) {
          logger.warn({ repo, label: label.name, stderr: updateResult.stderr }, "Failed to update label");
        } else {
          logger.debug({ repo, label: label.name }, "Label updated");
        }
      }
    } catch {
      // JSON parse error, label might not exist in expected format
      logger.debug({ repo, label: label.name }, "Could not parse existing label, skipping update check");
    }
    return;
  }

  // Create label
  const createArgs = ["api", "-X", "POST", `repos/${repo}/labels`, "-f", `name=${label.name}`];

  if (label.color) {
    createArgs.push("-f", `color=${label.color}`);
  }
  if (label.description) {
    createArgs.push("-f", `description=${label.description}`);
  }

  const createResult = await gh(createArgs);

  if (createResult.exitCode !== 0) {
    // Label might already exist (race condition) or permission issue
    logger.warn({ repo, label: label.name, stderr: createResult.stderr }, "Failed to create label");
  } else {
    logger.info({ repo, label: label.name }, "Label created");
  }
}

export async function ensureLabels(repo: string, labels: LabelDefinition[]): Promise<void> {
  // Process labels in parallel but with a limit to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < labels.length; i += batchSize) {
    const batch = labels.slice(i, i + batchSize);
    await Promise.all(batch.map((label) => ensureLabel(repo, label)));
  }
}
