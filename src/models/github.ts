/**
 * GitHub-related data models
 */

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  author: string;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
  repository: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  head: string;
  base: string;
  author: string;
  reviewers: string[];
  labels: string[];
  issueNumber?: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  repository: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
  url: string;
}

export interface GitHubReviewComment {
  id: number;
  body: string;
  author: string;
  path: string;
  line?: number;
  side: 'LEFT' | 'RIGHT';
  createdAt: string;
}

export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  url: string;
  columns: GitHubProjectColumn[];
}

export interface GitHubProjectColumn {
  id: string;
  name: string;
}

export interface GitHubProjectItem {
  id: string;
  contentId: string;
  columnId: string;
}

export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  url: string;
}

export interface GitHubUser {
  login: string;
  id: number;
  type: 'User' | 'Bot' | 'Organization';
}

/**
 * GitHub Event Types (from webhooks)
 */
export type GitHubEventType =
  | 'issues.labeled'
  | 'issues.unlabeled'
  | 'issues.opened'
  | 'issues.closed'
  | 'issue_comment.created'
  | 'pull_request.opened'
  | 'pull_request.closed'
  | 'pull_request_review.submitted'
  | 'pull_request_review_comment.created';

export interface GitHubEvent {
  type: GitHubEventType;
  action: string;
  repository: GitHubRepository;
  sender: GitHubUser;
  issue?: GitHubIssue;
  pullRequest?: GitHubPullRequest;
  comment?: GitHubComment;
  reviewComment?: GitHubReviewComment;
  label?: { name: string };
}

/**
 * Haunted-specific labels
 */
export const HAUNTED_LABELS = {
  TRIGGER: 'haunted',
  PLANNING: 'haunted:planning',
  IMPLEMENTING: 'haunted:implementing',
  TESTING: 'haunted:testing',
  REVIEW: 'haunted:review',
  BLOCKED: 'haunted:blocked',
} as const;

export type HauntedLabel = typeof HAUNTED_LABELS[keyof typeof HAUNTED_LABELS];

/**
 * Project column names
 */
export const PROJECT_COLUMNS = {
  BACKLOG: 'Backlog',
  PLANNING: 'Planning',
  IMPLEMENTING: 'Implementing',
  TESTING: 'Testing',
  REVIEW: 'Review',
  DONE: 'Done',
} as const;

export type ProjectColumn = typeof PROJECT_COLUMNS[keyof typeof PROJECT_COLUMNS];

/**
 * User commands in issue/PR comments
 */
export const USER_COMMANDS = {
  APPROVE: '/approve',
  REJECT: '/reject',
  PAUSE: '/pause',
  RETRY: '/retry',
  STATUS: '/status',
} as const;

export type UserCommand = typeof USER_COMMANDS[keyof typeof USER_COMMANDS];

export function parseUserCommand(body: string): UserCommand | null {
  const trimmed = body.trim().toLowerCase();
  for (const [, command] of Object.entries(USER_COMMANDS)) {
    if (trimmed.startsWith(command)) {
      return command;
    }
  }
  return null;
}
