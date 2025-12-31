import { createLogger } from "@/utils/logger.ts";
import type { GitHubEvent, IssueCommentEventPayload } from "@/events/types.ts";
import type { Config } from "@/config/schema.ts";
import type { Orchestrator } from "@/agents/orchestrator.ts";
import { isAgentComment } from "@/github/comments.ts";

const logger = createLogger("comment-handler");

export function createCommentHandlers(config: Config, orchestrator: Orchestrator) {
  async function handleCommentCreated(event: GitHubEvent): Promise<void> {
    const payload = event.payload as unknown as IssueCommentEventPayload;
    const { issue, comment, repository } = payload;
    const repo = repository.full_name;

    if (isAgentComment(comment.body)) {
      logger.debug({ repo, issue: issue.number }, "Ignoring agent comment");
      return;
    }

    // Handle PR comments - user feedback on PR
    if (issue.pull_request) {
      logger.info(
        { repo, pr: issue.number, author: comment.user.login },
        "New comment on PR"
      );

      // Handle commands in PR comments
      const commands = parseCommands(comment.body);
      if (commands.length > 0) {
        for (const command of commands) {
          await orchestrator.handleCommand({
            repo,
            issueNumber: issue.number,
            command: command.name,
            args: command.args,
            author: comment.user.login,
          });
        }
        return;
      }

      // If not a command, treat as revision request
      await orchestrator.handlePRRevisionRequest({
        repo,
        prNumber: issue.number,
        comment: comment.body,
        author: comment.user.login,
      });
      return;
    }

    logger.info(
      { repo, issue: issue.number, author: comment.user.login },
      "New comment on issue"
    );

    const mentionPattern = /@haunted\b/i;
    if (mentionPattern.test(comment.body)) {
      logger.info({ repo, issue: issue.number }, "Haunted mentioned in comment");

      await orchestrator.handleMention({
        repo,
        issueNumber: issue.number,
        commentId: comment.id,
        body: comment.body,
        author: comment.user.login,
      });
    }

    const commands = parseCommands(comment.body);
    if (commands.length > 0) {
      logger.info({ repo, issue: issue.number, commands }, "Commands found in comment");

      for (const command of commands) {
        await orchestrator.handleCommand({
          repo,
          issueNumber: issue.number,
          command: command.name,
          args: command.args,
          author: comment.user.login,
        });
      }
    }
  }

  return {
    handleCommentCreated,
  };
}

interface Command {
  name: string;
  args: string[];
}

function parseCommands(body: string): Command[] {
  const commands: Command[] = [];
  const lines = body.split("\n");

  for (const line of lines) {
    const match = line.match(/^\/(\w+)(?:\s+(.*))?$/);
    if (match) {
      commands.push({
        name: match[1]!,
        args: match[2] ? match[2].split(/\s+/) : [],
      });
    }
  }

  return commands;
}
