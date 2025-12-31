import { gh } from "@/github/cli.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("github-comments");

export interface Comment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export async function getPRComments(repo: string, prNumber: number): Promise<Comment[]> {
  const result = await gh([
    "api",
    `repos/${repo}/pulls/${prNumber}/comments`,
    "--jq",
    '.[] | {id: .id, body: .body, author: .user.login, createdAt: .created_at, updatedAt: .updated_at, url: .html_url}',
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get PR comments: ${result.stderr}`);
  }

  if (!result.stdout.trim()) {
    return [];
  }

  const lines = result.stdout.trim().split("\n");
  return lines.map((line) => JSON.parse(line) as Comment);
}

export async function createComment(
  repo: string,
  issueNumber: number,
  body: string
): Promise<Comment> {
  const result = await gh([
    "api",
    `repos/${repo}/issues/${issueNumber}/comments`,
    "-X",
    "POST",
    "-f",
    `body=${body}`,
    "--jq",
    '{id: .id, body: .body, author: .user.login, createdAt: .created_at, updatedAt: .updated_at, url: .html_url}',
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create comment: ${result.stderr}`);
  }

  logger.info({ repo, issueNumber }, "Comment created");
  return JSON.parse(result.stdout) as Comment;
}

export async function updateComment(
  repo: string,
  commentId: number,
  body: string
): Promise<Comment> {
  const result = await gh([
    "api",
    `repos/${repo}/issues/comments/${commentId}`,
    "-X",
    "PATCH",
    "-f",
    `body=${body}`,
    "--jq",
    '{id: .id, body: .body, author: .user.login, createdAt: .created_at, updatedAt: .updated_at, url: .html_url}',
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to update comment: ${result.stderr}`);
  }

  logger.info({ repo, commentId }, "Comment updated");
  return JSON.parse(result.stdout) as Comment;
}

export async function deleteComment(repo: string, commentId: number): Promise<void> {
  const result = await gh([
    "api",
    `repos/${repo}/issues/comments/${commentId}`,
    "-X",
    "DELETE",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to delete comment: ${result.stderr}`);
  }

  logger.info({ repo, commentId }, "Comment deleted");
}

export function formatAgentComment(agentName: string, message: string): string {
  return `<!-- haunted:${agentName} -->\n**[${agentName}]**\n\n${message}`;
}

export function isAgentComment(body: string, agentName?: string): boolean {
  if (agentName) {
    return body.includes(`<!-- haunted:${agentName} -->`);
  }
  return body.includes("<!-- haunted:");
}
