/**
 * Database Manager - SQLite database operations
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { randomUUID, createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import type {
  Phase,
  Issue,
  Comment,
  IssueStats,
  WorkflowStage
} from '../models/index.js';
import { logger } from '../utils/logger.js';

export class DatabaseManager {
  private db!: Database<sqlite3.Database, sqlite3.Statement>;
  private dbPath: string;

  constructor(dbUrl: string = './.haunted/database.db') {
    this.dbPath = dbUrl.replace('sqlite://', '');
  }

  async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Open database connection
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      await this.createTables();
      logger.info(`Database initialized at ${this.dbPath}`);
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    // Phases table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS phases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'planning',
        branch_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Issues table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        workflow_stage TEXT NOT NULL DEFAULT 'plan',
        phase_id TEXT,
        branch_name TEXT NOT NULL,
        plan TEXT,
        implementation TEXT,
        diagnosis_log TEXT,
        iteration_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (phase_id) REFERENCES phases(id)
      );
    `);

    // Tasks table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        output TEXT,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (issue_id) REFERENCES issues(id)
      );
    `);

    // Comments table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (issue_id) REFERENCES issues(id)
      );
    `);

    // Workflow runs table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        error TEXT,
        output TEXT,
        FOREIGN KEY (issue_id) REFERENCES issues(id)
      );
    `);

    // Indexes
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
      CREATE INDEX IF NOT EXISTS idx_issues_workflow_stage ON issues(workflow_stage);
      CREATE INDEX IF NOT EXISTS idx_issues_phase_id ON issues(phase_id);
      CREATE INDEX IF NOT EXISTS idx_comments_issue_id ON comments(issue_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_issue_id ON workflow_runs(issue_id);
    `);
  }

  // Phase operations
  async createPhase(name: string, description?: string, commitHash?: string): Promise<Phase> {
    // Check if a phase with this name already exists
    const existingPhase = await this.db.get(`
      SELECT id FROM phases WHERE name = ?
    `, [name]);

    if (existingPhase) {
      throw new Error(`A phase named "${name}" already exists`);
    }

    const branchName = `phase/${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    // Generate short ID from branch name and commit hash
    const idSource = commitHash ? `${branchName}-${commitHash}` : branchName;
    const id = createHash('sha256').update(idSource).digest('hex').substring(0, 8);

    await this.db.run(`
      INSERT INTO phases (id, name, description, branch_name)
      VALUES (?, ?, ?, ?)
    `, [id, name, description, branchName]);

    const phase = await this.db.get(`
      SELECT * FROM phases WHERE id = ?
    `, [id]);

    return this.mapPhase(phase);
  }

  async listPhases(): Promise<Phase[]> {
    const rows = await this.db.all(`
      SELECT * FROM phases ORDER BY created_at DESC
    `);

    return rows.map(row => this.mapPhase(row));
  }

  // Issue operations
  async createIssue(
    title: string,
    description: string,
    priority: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    phaseId?: string
  ): Promise<Issue> {
    // Create a temporary branch name, will update after getting the ID
    const tempBranchName = 'temp';

    const result = await this.db.run(`
      INSERT INTO issues (title, description, priority, phase_id, branch_name, workflow_stage)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [title, description, priority, phaseId, tempBranchName, 'plan']);

    // Now update with the proper branch name using issue ID format
    const issueId = result.lastID;
    const branchName = `#${issueId}`;

    await this.db.run(`
      UPDATE issues SET branch_name = ? WHERE id = ?
    `, [branchName, issueId]);

    const issue = await this.db.get(`
      SELECT * FROM issues WHERE id = ?
    `, [issueId]);

    return this.mapIssue(issue);
  }

  async listIssues(status?: string, stage?: string): Promise<Issue[]> {
    let query = 'SELECT * FROM issues';
    const params: any[] = [];

    if (status || stage) {
      const conditions = [];
      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }
      if (stage) {
        conditions.push('workflow_stage = ?');
        params.push(stage);
      }
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY created_at DESC';

    const rows = await this.db.all(query, params);
    return rows.map(row => this.mapIssue(row));
  }

  async getIssue(id: string): Promise<Issue | null> {
    // Try to parse as number first for serial IDs
    const numId = parseInt(id);
    const row = await this.db.get(`
      SELECT * FROM issues WHERE id = ? OR CAST(id AS TEXT) LIKE ?
    `, [isNaN(numId) ? id : numId, `${id}%`]);

    return row ? this.mapIssue(row) : null;
  }

  async updateIssueStatus(id: string, status: string): Promise<void> {
    const numId = parseInt(id);
    await this.db.run(`
      UPDATE issues SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [status, isNaN(numId) ? id : numId]);
  }

  async updateIssueWorkflowStage(id: string, stage: WorkflowStage): Promise<void> {
    const numId = parseInt(id);
    await this.db.run(`
      UPDATE issues SET workflow_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [stage, isNaN(numId) ? id : numId]);
  }

  async updateIssuePlan(id: string, plan: string): Promise<void> {
    const numId = parseInt(id);
    await this.db.run(`
      UPDATE issues SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [plan, isNaN(numId) ? id : numId]);
  }

  async updateIssueImplementation(id: string, implementation: string): Promise<void> {
    const numId = parseInt(id);
    await this.db.run(`
      UPDATE issues SET implementation = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [implementation, isNaN(numId) ? id : numId]);
  }

  async updateIssueDiagnosisLog(id: string, diagnosisLog: string): Promise<void> {
    const numId = parseInt(id);
    await this.db.run(`
      UPDATE issues SET diagnosis_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [diagnosisLog, isNaN(numId) ? id : numId]);
  }

  async updateIssueIterationCount(id: string, count: number): Promise<void> {
    const numId = parseInt(id);
    await this.db.run(`
      UPDATE issues SET iteration_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [count, isNaN(numId) ? id : numId]);
  }

  async incrementIssueIteration(id: string): Promise<number> {
    const issue = await this.getIssue(id);
    if (!issue) {
      throw new Error(`Issue ${id} not found`);
    }
    const newCount = issue.iterationCount + 1;
    await this.updateIssueIterationCount(id, newCount);
    return newCount;
  }

  // Comment operations
  async addComment(issueId: string, author: string, content: string): Promise<Comment> {
    const id = randomUUID();

    await this.db.run(`
      INSERT INTO comments (id, issue_id, author, content)
      VALUES (?, ?, ?, ?)
    `, [id, issueId, author, content]);

    const comment = await this.db.get(`
      SELECT * FROM comments WHERE id = ?
    `, [id]);

    return this.mapComment(comment);
  }

  async getComments(issueId: string): Promise<Comment[]> {
    const rows = await this.db.all(`
      SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC
    `, [issueId]);

    return rows.map(row => this.mapComment(row));
  }

  // Statistics
  async getIssueStats(): Promise<IssueStats> {
    const statusStats = await this.db.all(`
      SELECT status, COUNT(*) as count FROM issues GROUP BY status
    `);

    const stageStats = await this.db.all(`
      SELECT workflow_stage, COUNT(*) as count FROM issues GROUP BY workflow_stage
    `);

    const stats: IssueStats = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      closed: 0,
      workflowStages: {} as Record<WorkflowStage, number>
    };

    // Process status stats
    for (const row of statusStats) {
      if (row.status in stats) {
        (stats as any)[row.status] = row.count;
      }
    }

    // Process stage stats
    for (const row of stageStats) {
      stats.workflowStages[row.workflow_stage as WorkflowStage] = row.count;
    }

    return stats;
  }

  // Mapping functions
  private mapPhase(row: any): Phase {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      branchName: row.branch_name,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  private mapIssue(row: any): Issue {
    return {
      id: String(row.id),
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      workflowStage: row.workflow_stage,
      phaseId: row.phase_id,
      branchName: row.branch_name,
      plan: row.plan,
      implementation: row.implementation,
      diagnosisLog: row.diagnosis_log,
      iterationCount: row.iteration_count || 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  private mapComment(row: any): Comment {
    return {
      id: row.id,
      issueId: row.issue_id,
      author: row.author,
      content: row.content,
      createdAt: new Date(row.created_at)
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
    }
  }
}