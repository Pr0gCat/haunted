/**
 * GitHub Service - Wraps gh CLI for GitHub operations
 */

import { execa } from 'execa';
import { logger } from '../../utils/logger.js';
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubProject,
  GitHubProjectColumn,
  HauntedLabel,
  ProjectColumn,
} from '../../models/index.js';
import { HAUNTED_LABELS, PROJECT_COLUMNS } from '../../models/index.js';

export class GitHubService {
  constructor(private repository: string) {}

  /**
   * Check if gh CLI is available and authenticated
   */
  async checkAvailability(): Promise<boolean> {
    try {
      const result = await execa('gh', ['auth', 'status'], { timeout: 10000 });
      return result.exitCode === 0;
    } catch (error) {
      logger.warn('GitHub CLI not available or not authenticated:', error);
      return false;
    }
  }

  // ==================== Issue Operations ====================

  /**
   * Get issue details
   */
  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const result = await execa('gh', [
      'issue', 'view', String(issueNumber),
      '--repo', this.repository,
      '--json', 'number,title,body,state,labels,author,assignees,createdAt,updatedAt,url'
    ]);

    const data = JSON.parse(result.stdout);
    return {
      number: data.number,
      title: data.title,
      body: data.body || '',
      state: data.state.toLowerCase(),
      labels: data.labels.map((l: { name: string }) => l.name),
      author: data.author.login,
      assignees: data.assignees.map((a: { login: string }) => a.login),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      url: data.url,
      repository: this.repository,
    };
  }

  /**
   * Add a comment to an issue
   */
  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    await execa('gh', [
      'issue', 'comment', String(issueNumber),
      '--repo', this.repository,
      '--body', body
    ]);
    logger.debug(`Added comment to issue #${issueNumber}`);
  }

  /**
   * Add labels to an issue
   */
  async addIssueLabels(issueNumber: number, labels: string[]): Promise<void> {
    await execa('gh', [
      'issue', 'edit', String(issueNumber),
      '--repo', this.repository,
      '--add-label', labels.join(',')
    ]);
    logger.debug(`Added labels [${labels.join(', ')}] to issue #${issueNumber}`);
  }

  /**
   * Remove labels from an issue
   */
  async removeIssueLabels(issueNumber: number, labels: string[]): Promise<void> {
    await execa('gh', [
      'issue', 'edit', String(issueNumber),
      '--repo', this.repository,
      '--remove-label', labels.join(',')
    ]);
    logger.debug(`Removed labels [${labels.join(', ')}] from issue #${issueNumber}`);
  }

  /**
   * Close an issue
   */
  async closeIssue(issueNumber: number, reason?: string): Promise<void> {
    const args = ['issue', 'close', String(issueNumber), '--repo', this.repository];
    if (reason) {
      args.push('--reason', reason);
    }
    await execa('gh', args);
    logger.info(`Closed issue #${issueNumber}`);
  }

  /**
   * Update Haunted stage label
   */
  async updateStageLabel(issueNumber: number, newStage: HauntedLabel): Promise<void> {
    // Remove all haunted:* labels except the trigger label
    const stageLabels = Object.values(HAUNTED_LABELS).filter(l => l !== HAUNTED_LABELS.TRIGGER);

    try {
      await this.removeIssueLabels(issueNumber, stageLabels);
    } catch {
      // Ignore errors if labels don't exist
    }

    // Add the new stage label
    if (newStage !== HAUNTED_LABELS.TRIGGER) {
      await this.addIssueLabels(issueNumber, [newStage]);
    }
  }

  // ==================== PR Operations ====================

  /**
   * Create a pull request
   */
  async createPullRequest(options: {
    title: string;
    body: string;
    head: string;
    base?: string;
    draft?: boolean;
  }): Promise<GitHubPullRequest> {
    const args = [
      'pr', 'create',
      '--repo', this.repository,
      '--title', options.title,
      '--body', options.body,
      '--head', options.head,
    ];

    if (options.base) {
      args.push('--base', options.base);
    }
    if (options.draft) {
      args.push('--draft');
    }

    const result = await execa('gh', args);

    // Get PR number from output URL
    const prUrl = result.stdout.trim();
    const prNumber = parseInt(prUrl.split('/').pop() || '0', 10);

    logger.info(`Created PR #${prNumber}: ${options.title}`);

    return this.getPullRequest(prNumber);
  }

  /**
   * Get pull request details
   */
  async getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    const result = await execa('gh', [
      'pr', 'view', String(prNumber),
      '--repo', this.repository,
      '--json', 'number,title,body,state,headRefName,baseRefName,author,reviewRequests,labels,createdAt,updatedAt,url'
    ]);

    const data = JSON.parse(result.stdout);
    return {
      number: data.number,
      title: data.title,
      body: data.body || '',
      state: data.state.toLowerCase(),
      head: data.headRefName,
      base: data.baseRefName,
      author: data.author.login,
      reviewers: data.reviewRequests?.map((r: { login: string }) => r.login) || [],
      labels: data.labels.map((l: { name: string }) => l.name),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      url: data.url,
      repository: this.repository,
    };
  }

  /**
   * Add a comment to a PR
   */
  async addPRComment(prNumber: number, body: string): Promise<void> {
    await execa('gh', [
      'pr', 'comment', String(prNumber),
      '--repo', this.repository,
      '--body', body
    ]);
    logger.debug(`Added comment to PR #${prNumber}`);
  }

  /**
   * Get PR review comments
   */
  async getPRReviewComments(prNumber: number): Promise<GitHubComment[]> {
    const result = await execa('gh', [
      'api',
      `repos/${this.repository}/pulls/${prNumber}/comments`,
      '--jq', '.[] | {id: .id, body: .body, author: .user.login, createdAt: .created_at, url: .html_url}'
    ]);

    if (!result.stdout.trim()) {
      return [];
    }

    // Parse JSONL output
    const comments: GitHubComment[] = result.stdout
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));

    return comments;
  }

  // ==================== Project Operations ====================

  /**
   * Get or create a GitHub Project
   */
  async getOrCreateProject(projectName: string): Promise<GitHubProject> {
    // Try to find existing project
    try {
      const listResult = await execa('gh', [
        'project', 'list',
        '--owner', this.repository.split('/')[0],
        '--format', 'json'
      ]);

      const projects = JSON.parse(listResult.stdout);
      const existing = projects.projects?.find((p: { title: string }) => p.title === projectName);

      if (existing) {
        return this.getProjectDetails(existing.number);
      }
    } catch {
      // Project doesn't exist, create it
    }

    // Create new project
    const createResult = await execa('gh', [
      'project', 'create',
      '--owner', this.repository.split('/')[0],
      '--title', projectName,
      '--format', 'json'
    ]);

    const created = JSON.parse(createResult.stdout);
    logger.info(`Created GitHub Project: ${projectName}`);

    // Set up columns
    await this.setupProjectColumns(created.number);

    return this.getProjectDetails(created.number);
  }

  /**
   * Get project details including columns
   */
  private async getProjectDetails(projectNumber: number): Promise<GitHubProject> {
    const result = await execa('gh', [
      'project', 'view', String(projectNumber),
      '--owner', this.repository.split('/')[0],
      '--format', 'json'
    ]);

    const data = JSON.parse(result.stdout);

    // Get columns (status field)
    const columns: GitHubProjectColumn[] = [];
    // Note: gh project doesn't directly expose columns, we'll use the field API

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      url: data.url,
      columns,
    };
  }

  /**
   * Set up project columns
   */
  private async setupProjectColumns(projectNumber: number): Promise<void> {
    const columns = Object.values(PROJECT_COLUMNS);

    // Create Status field with our columns
    // Note: This requires GraphQL API for full control
    logger.debug(`Setting up project columns: ${columns.join(', ')}`);

    // For now, we'll rely on the default Status field
    // Full implementation would use gh api with GraphQL
  }

  /**
   * Add an issue to a project
   */
  async addIssueToProject(issueNumber: number, projectNumber: number): Promise<string> {
    const result = await execa('gh', [
      'project', 'item-add', String(projectNumber),
      '--owner', this.repository.split('/')[0],
      '--url', `https://github.com/${this.repository}/issues/${issueNumber}`,
      '--format', 'json'
    ]);

    const data = JSON.parse(result.stdout);
    logger.debug(`Added issue #${issueNumber} to project #${projectNumber}`);
    return data.id;
  }

  /**
   * Move a project item to a column
   */
  async moveToColumn(projectNumber: number, itemId: string, column: ProjectColumn): Promise<void> {
    // This requires GraphQL API to update the Status field
    // For now, log the intended action
    logger.debug(`Moving item ${itemId} to column ${column} in project #${projectNumber}`);

    // TODO: Implement with gh api using GraphQL mutation
    // gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(...) }'
  }

  // ==================== Auth/Permission Operations ====================

  /**
   * Check if a user is a repository collaborator
   */
  async isCollaborator(username: string): Promise<boolean> {
    try {
      await execa('gh', [
        'api',
        `repos/${this.repository}/collaborators/${username}`,
        '--silent'
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the authenticated user
   */
  async getAuthenticatedUser(): Promise<string> {
    const result = await execa('gh', ['api', 'user', '--jq', '.login']);
    return result.stdout.trim();
  }
}

export default GitHubService;
