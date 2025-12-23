/**
 * Notification Service - Handles commenting on GitHub Issues and PRs
 */

import { GitHubService } from '../github/index.js';
import { logger } from '../../utils/logger.js';
import type { WorkflowStage, TrackedIssue } from '../../models/index.js';

export class NotificationService {
  constructor(private github: GitHubService) {}

  /**
   * Notify that processing has started
   */
  async notifyProcessingStarted(issue: TrackedIssue): Promise<void> {
    const message = `
## 👻 Haunted is processing this issue

I'm analyzing the requirements and will create an implementation plan shortly.

**Status**: Planning
**Branch**: \`${issue.branchName}\`

---
*I'll update this thread with my progress.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified processing started for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that a plan is ready for approval
   */
  async notifyPlanReady(issue: TrackedIssue, plan: string): Promise<void> {
    const message = `
## 📋 Implementation Plan Ready

I've analyzed the issue and created the following plan:

${plan}

---

### Next Steps

Please review the plan above. When you're ready:
- Reply with \`/approve\` to start implementation
- Reply with \`/reject [reason]\` to request changes to the plan

*Waiting for your approval to proceed.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified plan ready for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that implementation is in progress
   */
  async notifyImplementationStarted(issue: TrackedIssue): Promise<void> {
    const message = `
## 🔨 Implementation Started

I'm now implementing the approved plan. This may take a few minutes.

**Status**: Implementing
**Branch**: \`${issue.branchName}\`

*I'll notify you when the implementation is complete and ready for review.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified implementation started for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that testing is in progress
   */
  async notifyTestingStarted(issue: TrackedIssue): Promise<void> {
    const message = `
## 🧪 Running Tests

Implementation complete! Now running tests to verify the changes.

**Status**: Testing

*I'll fix any failing tests and notify you of the results.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified testing started for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that PR is ready for review
   */
  async notifyPRReady(issue: TrackedIssue, prNumber: number, prUrl: string): Promise<void> {
    const message = `
## ✅ Pull Request Ready for Review

I've completed the implementation and all tests are passing!

**Pull Request**: #${prNumber}
**Link**: ${prUrl}

**Status**: Review

Please review the changes and let me know if any modifications are needed.

*I'll address any review comments automatically.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified PR ready for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that review comments are being addressed
   */
  async notifyAddressingReview(prNumber: number, commentCount: number): Promise<void> {
    const message = `
## 💬 Addressing Review Comments

I'm addressing ${commentCount} review comment${commentCount > 1 ? 's' : ''}. I'll push updates shortly.

*Please wait while I make the requested changes.*
`.trim();

    await this.github.addPRComment(prNumber, message);
    logger.info(`Notified addressing review for PR #${prNumber}`);
  }

  /**
   * Notify that review comments have been addressed
   */
  async notifyReviewAddressed(prNumber: number, changes: string[]): Promise<void> {
    const changeList = changes.length > 0
      ? changes.map(f => `- \`${f}\``).join('\n')
      : '- Minor adjustments made';

    const message = `
## ✅ Review Comments Addressed

I've made the following changes:

${changeList}

Please review the updates and let me know if anything else needs to be changed.
`.trim();

    await this.github.addPRComment(prNumber, message);
    logger.info(`Notified review addressed for PR #${prNumber}`);
  }

  /**
   * Notify that the issue is complete
   */
  async notifyComplete(issue: TrackedIssue, prNumber: number): Promise<void> {
    const message = `
## 🎉 Issue Completed!

The changes have been merged successfully.

**Summary**:
- Implementation completed and tested
- Pull Request #${prNumber} merged
- This issue has been automatically closed

Thank you for using Haunted! 👻
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified completion for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that processing is blocked
   */
  async notifyBlocked(issue: TrackedIssue, reason: string): Promise<void> {
    const message = `
## ⚠️ Processing Blocked

I've encountered an issue that requires human intervention:

**Reason**: ${reason}

**What you can do**:
- Fix the underlying issue manually
- Reply with \`/retry\` to try again
- Reply with \`/status\` to check current status

*The \`haunted:blocked\` label has been added to this issue.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified blocked for issue #${issue.githubNumber}`);
  }

  /**
   * Notify current status
   */
  async notifyStatus(issue: TrackedIssue): Promise<void> {
    const stageEmoji: Record<WorkflowStage, string> = {
      [WorkflowStage.PLANNING]: '📋',
      [WorkflowStage.IMPLEMENTING]: '🔨',
      [WorkflowStage.TESTING]: '🧪',
      [WorkflowStage.REVIEW]: '👀',
      [WorkflowStage.DONE]: '✅',
    };

    const message = `
## 📊 Current Status

| Field | Value |
|-------|-------|
| Stage | ${stageEmoji[issue.workflowStage]} ${issue.workflowStage} |
| Status | ${issue.status} |
| Branch | \`${issue.branchName}\` |
| Iteration | ${issue.iterationCount} |
${issue.prNumber ? `| PR | #${issue.prNumber} |` : ''}

*Last updated: ${new Date().toISOString()}*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified status for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that plan was rejected
   */
  async notifyPlanRejected(issue: TrackedIssue, reason?: string): Promise<void> {
    const message = `
## 🔄 Plan Rejected - Replanning

${reason ? `**Reason**: ${reason}\n\n` : ''}I'll create a new plan based on your feedback.

*Please wait while I analyze the requirements again.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified plan rejected for issue #${issue.githubNumber}`);
  }

  /**
   * Notify that processing is paused
   */
  async notifyPaused(issue: TrackedIssue): Promise<void> {
    const message = `
## ⏸️ Processing Paused

Processing has been paused as requested.

To resume, reply with \`/approve\` or \`/retry\`.

*Current progress has been saved.*
`.trim();

    await this.github.addIssueComment(issue.githubNumber, message);
    logger.info(`Notified paused for issue #${issue.githubNumber}`);
  }
}

export default NotificationService;
