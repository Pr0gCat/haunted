import { gh } from "@/github/cli.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("github-prs");

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  headBranch: string;
  baseBranch: string;
  author: string;
  labels: string[];
  isDraft: boolean;
  mergeable: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePRParams {
  repo: string;
  title: string;
  body?: string;
  head: string;
  base?: string;
  draft?: boolean;
  labels?: string[];
}

export interface ReviewParams {
  repo: string;
  number: number;
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body?: string;
}

export async function listPullRequests(
  repo: string,
  options: { state?: "open" | "closed" | "merged" | "all" } = {}
): Promise<PullRequest[]> {
  const args = ["pr", "list", "-R", repo];

  if (options.state) {
    args.push("--state", options.state);
  }

  args.push(
    "--json",
    "number,title,body,state,headRefName,baseRefName,author,labels,isDraft,mergeable,url,createdAt,updatedAt"
  );

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to list PRs: ${result.stderr}`);
  }

  const prs = JSON.parse(result.stdout) as Array<{
    number: number;
    title: string;
    body: string;
    state: string;
    headRefName: string;
    baseRefName: string;
    author: { login: string };
    labels: Array<{ name: string }>;
    isDraft: boolean;
    mergeable: string;
    url: string;
    createdAt: string;
    updatedAt: string;
  }>;

  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state as "open" | "closed" | "merged",
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    author: pr.author.login,
    labels: pr.labels.map((l) => l.name),
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    url: pr.url,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  }));
}

export async function getPullRequest(repo: string, number: number): Promise<PullRequest> {
  const args = [
    "pr",
    "view",
    String(number),
    "-R",
    repo,
    "--json",
    "number,title,body,state,headRefName,baseRefName,author,labels,isDraft,mergeable,url,createdAt,updatedAt",
  ];

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get PR #${number}: ${result.stderr}`);
  }

  const pr = JSON.parse(result.stdout) as {
    number: number;
    title: string;
    body: string;
    state: string;
    headRefName: string;
    baseRefName: string;
    author: { login: string };
    labels: Array<{ name: string }>;
    isDraft: boolean;
    mergeable: string;
    url: string;
    createdAt: string;
    updatedAt: string;
  };

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state as "open" | "closed" | "merged",
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    author: pr.author.login,
    labels: pr.labels.map((l) => l.name),
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    url: pr.url,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

export async function createPullRequest(params: CreatePRParams): Promise<PullRequest> {
  const { repo, title, body, head, base = "main", draft = false, labels } = params;
  const args = ["pr", "create", "-R", repo, "--title", title, "--head", head, "--base", base];

  if (body) {
    args.push("--body", body);
  }

  if (draft) {
    args.push("--draft");
  }

  if (labels && labels.length > 0) {
    args.push("--label", labels.join(","));
  }

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create PR: ${result.stderr}`);
  }

  const urlMatch = result.stdout.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
  if (!urlMatch) {
    throw new Error("Failed to parse PR URL from output");
  }

  const prNumber = parseInt(urlMatch[1]!, 10);
  logger.info({ repo, number: prNumber, title }, "PR created");

  return getPullRequest(repo, prNumber);
}

export async function mergePullRequest(
  repo: string,
  number: number,
  options: { method?: "merge" | "squash" | "rebase"; deleteAfter?: boolean } = {}
): Promise<void> {
  const { method = "squash", deleteAfter = true } = options;
  const args = ["pr", "merge", String(number), "-R", repo, `--${method}`];

  if (deleteAfter) {
    args.push("--delete-branch");
  }

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to merge PR #${number}: ${result.stderr}`);
  }

  logger.info({ repo, number, method }, "PR merged");
}

export async function closePullRequest(repo: string, number: number): Promise<void> {
  const result = await gh(["pr", "close", String(number), "-R", repo]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to close PR #${number}: ${result.stderr}`);
  }

  logger.info({ repo, number }, "PR closed");
}

export async function addPRReview(params: ReviewParams): Promise<void> {
  const { repo, number, event, body } = params;
  const args = ["pr", "review", String(number), "-R", repo];

  switch (event) {
    case "APPROVE":
      args.push("--approve");
      break;
    case "REQUEST_CHANGES":
      args.push("--request-changes");
      break;
    case "COMMENT":
      args.push("--comment");
      break;
  }

  if (body) {
    args.push("--body", body);
  }

  const result = await gh(args);

  if (result.exitCode !== 0) {
    // Handle self-approval restriction gracefully
    if (result.stderr.includes("Can not approve your own pull request")) {
      logger.warn({ repo, number }, "Cannot approve own PR - skipping approval (GitHub restriction)");
      // Still try to leave a comment with the review feedback
      if (body) {
        await addPRComment(repo, number, `**[HouseMaster Review]**\n\n${body}`);
      }
      return;
    }
    throw new Error(`Failed to add review: ${result.stderr}`);
  }

  logger.info({ repo, number, event }, "Review added to PR");
}

export async function addPRComment(repo: string, number: number, body: string): Promise<void> {
  const args = ["pr", "comment", String(number), "-R", repo, "--body", body];

  const result = await gh(args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to add PR comment: ${result.stderr}`);
  }

  logger.info({ repo, number }, "Comment added to PR");
}

export async function getPRDiff(repo: string, number: number): Promise<string> {
  const result = await gh(["pr", "diff", String(number), "-R", repo]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get PR diff: ${result.stderr}`);
  }

  return result.stdout;
}
