# Haunted 重構實作計畫

> Issue 驅動開發 + GitHub 深度整合 + Self-hosted Runner + Claude Max

## 目錄

1. [專案概覽](#專案概覽)
2. [架構設計](#架構設計)
3. [實作階段](#實作階段)
4. [檔案結構](#檔案結構)
5. [詳細任務清單](#詳細任務清單)

---

## 專案概覽

### 目標

將 Haunted 從 CLI 工具重構為 **GitHub 深度整合的自動化開發服務**，使用：

- **Self-hosted GitHub Actions Runner** 執行工作
- **Claude Code CLI + Claude Max** 進行 AI 輔助開發
- **Issue 驅動** 的開發流程
- **Git Worktree** 實現並行開發
- **GitHub Project** 看板追蹤進度

### 核心價值

```
用戶在 GitHub 建立 Issue
        ↓
    加上 label "haunted"
        ↓
    Haunted 自動分析、規劃、實作、測試
        ↓
    建立 PR 等待 Review
        ↓
    根據 Review 意見修改
        ↓
    合併後自動關閉 Issue
```

---

## 架構設計

### 系統架構圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                          GitHub                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  Issues  │  │   PRs    │  │ Projects │  │ Actions  │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
└───────┼─────────────┼─────────────┼─────────────┼───────────────────┘
        │             │             │             │
        │         Webhooks          │             │
        └─────────────┼─────────────┘             │
                      ▼                           │
┌─────────────────────────────────────────────────┼───────────────────┐
│                 Haunted Docker Container        │                    │
├─────────────────────────────────────────────────┼───────────────────┤
│                                                 │                    │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Orchestrator (主控程序)                                        │ │
│  │  ├── Runner Pool Manager    - 管理多個 Runner 實例              │ │
│  │  ├── Worktree Manager       - Git worktree 生命週期             │ │
│  │  ├── Task Queue             - 任務佇列與調度                    │ │
│  │  └── Health Monitor         - 健康檢查與自動恢復                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│          ┌───────────────────┼───────────────────┐                  │
│          ▼                   ▼                   ▼                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐            │
│  │ Runner #1    │   │ Runner #2    │   │ Runner #N    │            │
│  │ ┌──────────┐ │   │ ┌──────────┐ │   │ ┌──────────┐ │            │
│  │ │ Workflow │ │   │ │ Workflow │ │   │ │ Workflow │ │            │
│  │ │ Engine   │ │   │ │ Engine   │ │   │ │ Engine   │ │            │
│  │ └──────────┘ │   │ └──────────┘ │   │ └──────────┘ │            │
│  │ Issue #42    │   │ Issue #56    │   │ Issue #78    │            │
│  │ repo-a       │   │ repo-b       │   │ repo-a       │            │
│  └──────────────┘   └──────────────┘   └──────────────┘            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Services Layer                                                 │ │
│  │  ├── GitHubService      - gh CLI 封裝 (Issue/PR/Project)       │ │
│  │  ├── ClaudeService      - Claude Code CLI 封裝                 │ │
│  │  ├── GitService         - Git 操作 (branch/worktree/commit)    │ │
│  │  └── NotificationService - Issue/PR 評論通知                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Worktree Pool                                                  │ │
│  │  /work/repo-a/.git          (bare repo)                        │ │
│  │  /work/repo-a/issue-42      (worktree)                         │ │
│  │  /work/repo-a/issue-78      (worktree)                         │ │
│  │  /work/repo-b/.git          (bare repo)                        │ │
│  │  /work/repo-b/issue-56      (worktree)                         │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
        │
        │  Volumes
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ~/.claude            - Claude Code 認證憑證                         │
│  ~/.config/gh         - GitHub CLI 認證                              │
│  /work                - Worktree 工作目錄 (persistent volume)        │
│  /data                - SQLite 資料庫 (persistent volume)            │
└──────────────────────────────────────────────────────────────────────┘
```

### 工作流程圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Issue Lifecycle                               │
└─────────────────────────────────────────────────────────────────────┘

  ┌─────────┐
  │  User   │
  └────┬────┘
       │ 1. Create Issue + label "haunted"
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Trigger: issues.labeled                                         │
  │  ─────────────────────────────────────────────────────────────── │
  │  • 驗證 Issue 作者是 Collaborator                                │
  │  • 建立/取得 GitHub Project                                      │
  │  • 加入 Project → Backlog                                        │
  │  • 配置 Runner 處理此 Issue                                      │
  └─────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Stage: PLANNING                                                 │
  │  Label: haunted:planning                                         │
  │  Project: Planning                                               │
  │  ─────────────────────────────────────────────────────────────── │
  │  • 建立 worktree: /work/{repo}/issue-{number}                   │
  │  • Claude 分析 Issue 內容                                        │
  │  • Claude 產生實作計畫                                           │
  │  • 在 Issue 評論區貼出計畫                                       │
  │  • 等待用戶 /approve 或 /reject                                  │
  └─────────────────────────────────────────────────────────────────┘
       │
       │ User comments: /approve
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Stage: IMPLEMENTING                                             │
  │  Label: haunted:implementing                                     │
  │  Project: Implementing                                           │
  │  ─────────────────────────────────────────────────────────────── │
  │  • 建立分支: issue/{number}                                      │
  │  • Claude 實作程式碼                                             │
  │  • 定期在 Issue 更新進度                                         │
  └─────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Stage: TESTING                                                  │
  │  Label: haunted:testing                                          │
  │  Project: Testing                                                │
  │  ─────────────────────────────────────────────────────────────── │
  │  • 執行單元測試                                                  │
  │  • 執行整合測試                                                  │
  │  • 若失敗：Claude 診斷並修復，重試 (最多 3 次)                   │
  │  • 若持續失敗：標記 haunted:blocked                              │
  └─────────────────────────────────────────────────────────────────┘
       │
       │ Tests pass
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Stage: REVIEW                                                   │
  │  Label: haunted:review                                           │
  │  Project: Review                                                 │
  │  ─────────────────────────────────────────────────────────────── │
  │  • 建立 Pull Request                                             │
  │  • PR 描述包含：變更摘要、測試結果、關聯 Issue                   │
  │  • 在 Issue 評論區貼出 PR 連結                                   │
  │  • 等待 Review                                                   │
  └─────────────────────────────────────────────────────────────────┘
       │
       │ Reviewer comments / requests changes
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Trigger: pull_request_review / pull_request_review_comment     │
  │  ─────────────────────────────────────────────────────────────── │
  │  • 收集 Review Comments                                         │
  │  • Claude 根據意見修改程式碼                                     │
  │  • Push 更新                                                     │
  │  • 在 PR 回覆處理結果                                            │
  └─────────────────────────────────────────────────────────────────┘
       │
       │ PR Merged
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Stage: DONE                                                     │
  │  Project: Done                                                   │
  │  ─────────────────────────────────────────────────────────────── │
  │  • 關閉 Issue                                                    │
  │  • 移除 haunted:* labels                                         │
  │  • 刪除分支                                                      │
  │  • 清理 worktree                                                 │
  │  • 在 Issue 留下完成摘要                                         │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 實作階段

### Phase 1: 基礎重構 (保留可用功能)

**目標**：重新組織專案結構，保留核心功能，移除不需要的部分

| 任務 | 說明 | 優先級 |
|------|------|--------|
| 1.1 重新命名專案 | `haunted-cli` → `haunted` | P0 |
| 1.2 重構目錄結構 | 按新架構重新組織 | P0 |
| 1.3 保留 Workflow Engine | 重構以支援新流程 | P0 |
| 1.4 保留 Claude Wrapper | 維持 Claude Code CLI 整合 | P0 |
| 1.5 移除 Daemon 模式 | 改用 Runner 模式 | P1 |
| 1.6 移除 MCP Server | 暫不需要 | P2 |

### Phase 2: GitHub 整合

**目標**：實現與 GitHub 的深度整合

| 任務 | 說明 | 優先級 |
|------|------|--------|
| 2.1 GitHubService | 封裝 `gh` CLI 操作 | P0 |
| 2.2 Issue 操作 | 讀取、評論、標籤管理 | P0 |
| 2.3 PR 操作 | 建立、更新、回覆 review | P0 |
| 2.4 Project 操作 | 建立看板、移動卡片 | P0 |
| 2.5 Collaborator 驗證 | 檢查用戶權限 | P1 |

### Phase 3: Git Worktree 管理

**目標**：實現 worktree 並行開發能力

| 任務 | 說明 | 優先級 |
|------|------|--------|
| 3.1 WorktreeManager | Worktree 生命週期管理 | P0 |
| 3.2 Repo 初始化 | Clone 或 fetch repo | P0 |
| 3.3 Worktree 建立 | 為每個 Issue 建立 worktree | P0 |
| 3.4 Worktree 清理 | Issue 完成後清理 | P1 |
| 3.5 空間管理 | 定期清理過期 worktree | P2 |

### Phase 4: Runner 與任務管理

**目標**：實現多 Runner 並行處理

| 任務 | 說明 | 優先級 |
|------|------|--------|
| 4.1 Orchestrator | 主控程序 | P0 |
| 4.2 Runner Pool | 多 Runner 實例管理 | P0 |
| 4.3 Task Queue | 任務佇列 | P0 |
| 4.4 Event Handler | GitHub 事件處理 | P0 |
| 4.5 Health Monitor | 健康檢查與恢復 | P1 |

### Phase 5: Docker 化

**目標**：打包為 Docker Image

| 任務 | 說明 | 優先級 |
|------|------|--------|
| 5.1 Dockerfile | 建立 Docker 配置 | P0 |
| 5.2 docker-compose | 開發/部署配置 | P0 |
| 5.3 GitHub Actions Runner | 整合 self-hosted runner | P0 |
| 5.4 Volume 管理 | 認證與資料持久化 | P0 |
| 5.5 CI/CD | 自動建置與發布 image | P1 |

### Phase 6: GitHub Actions Workflows

**目標**：建立 GitHub Actions workflow 模板

| 任務 | 說明 | 優先級 |
|------|------|--------|
| 6.1 issue-labeled.yml | Issue 標籤觸發 | P0 |
| 6.2 issue-comment.yml | Issue 評論處理 | P0 |
| 6.3 pr-review.yml | PR Review 處理 | P0 |
| 6.4 pr-merged.yml | PR 合併後處理 | P0 |
| 6.5 Workflow 模板產生器 | 自動產生 workflow 檔案 | P1 |

---

## 檔案結構

```
haunted/
├── .github/
│   └── workflows/
│       └── ci.yml                    # CI/CD for Haunted itself
│
├── bin/
│   └── haunted.mjs                   # CLI 入口 (簡化版)
│
├── docker/
│   ├── Dockerfile                    # 主要 Docker image
│   ├── docker-compose.yml            # 開發/部署配置
│   ├── docker-compose.dev.yml        # 開發環境
│   └── entrypoint.sh                 # Container 啟動腳本
│
├── templates/                        # 使用者 repo 需要的檔案模板
│   └── workflows/
│       ├── haunted-issue.yml         # Issue 處理 workflow
│       ├── haunted-comment.yml       # 評論處理 workflow
│       ├── haunted-pr-review.yml     # PR Review workflow
│       └── haunted-pr-merged.yml     # PR 合併 workflow
│
├── src/
│   ├── index.ts                      # Library 入口
│   │
│   ├── orchestrator/                 # 主控程序
│   │   ├── index.ts                  # Orchestrator 主類
│   │   ├── runner-pool.ts            # Runner 池管理
│   │   ├── task-queue.ts             # 任務佇列
│   │   └── health-monitor.ts         # 健康監控
│   │
│   ├── runner/                       # Runner 實例
│   │   ├── index.ts                  # Runner 主類
│   │   ├── event-handler.ts          # GitHub 事件處理
│   │   └── workflow-executor.ts      # Workflow 執行器
│   │
│   ├── services/                     # 服務層
│   │   ├── github/
│   │   │   ├── index.ts              # GitHub Service 主類
│   │   │   ├── issue.ts              # Issue 操作
│   │   │   ├── pr.ts                 # PR 操作
│   │   │   ├── project.ts            # Project 操作
│   │   │   └── auth.ts               # 權限驗證
│   │   │
│   │   ├── git/
│   │   │   ├── index.ts              # Git Service 主類
│   │   │   ├── worktree.ts           # Worktree 管理
│   │   │   └── operations.ts         # Git 操作
│   │   │
│   │   ├── claude/
│   │   │   ├── index.ts              # Claude Service 主類
│   │   │   ├── planner.ts            # 規劃功能
│   │   │   ├── implementer.ts        # 實作功能
│   │   │   └── reviewer.ts           # Review 回應
│   │   │
│   │   └── notification/
│   │       └── index.ts              # 通知服務 (Issue/PR 評論)
│   │
│   ├── workflow/                     # 工作流程
│   │   ├── index.ts                  # Workflow Engine
│   │   ├── stages/
│   │   │   ├── planning.ts           # Planning 階段
│   │   │   ├── implementing.ts       # Implementing 階段
│   │   │   ├── testing.ts            # Testing 階段
│   │   │   └── review.ts             # Review 階段
│   │   └── transitions.ts            # 階段轉換邏輯
│   │
│   ├── models/                       # 資料模型
│   │   ├── index.ts                  # 型別定義
│   │   ├── issue.ts                  # Issue 相關型別
│   │   ├── task.ts                   # Task 相關型別
│   │   └── workflow.ts               # Workflow 相關型別
│   │
│   ├── database/                     # 資料庫
│   │   ├── index.ts                  # Database 主類
│   │   ├── migrations/               # 資料庫遷移
│   │   └── repositories/             # Repository pattern
│   │
│   ├── commands/                     # CLI 指令 (簡化版)
│   │   ├── init.ts                   # 初始化 repo
│   │   ├── start.ts                  # 啟動服務
│   │   └── status.ts                 # 查看狀態
│   │
│   ├── cli/
│   │   └── index.ts                  # CLI 入口
│   │
│   └── utils/
│       ├── config.ts                 # 配置管理
│       ├── logger.ts                 # 日誌
│       └── constants.ts              # 常數定義
│
├── tests/                            # 測試
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── IMPLEMENTATION_PLAN.md        # 本文件
│   ├── SETUP_GUIDE.md               # 安裝指南
│   └── USER_GUIDE.md                # 使用指南
│
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── Dockerfile                        # 簡化版 (指向 docker/)
└── README.md
```

---

## 詳細任務清單

### Phase 1: 基礎重構

#### 1.1 重新命名專案
- [ ] 更新 `package.json` 中的 `name` 為 `haunted`
- [ ] 更新 `description`
- [ ] 更新所有文件中的專案名稱引用

#### 1.2 重構目錄結構
- [ ] 建立 `src/orchestrator/` 目錄
- [ ] 建立 `src/runner/` 目錄
- [ ] 建立 `src/services/github/` 目錄
- [ ] 建立 `src/services/git/` 目錄
- [ ] 建立 `src/services/claude/` 目錄
- [ ] 建立 `src/workflow/stages/` 目錄
- [ ] 建立 `docker/` 目錄
- [ ] 建立 `templates/workflows/` 目錄

#### 1.3 保留並重構 Workflow Engine
- [ ] 移動 `workflow-engine.ts` 到 `src/workflow/`
- [ ] 拆分各階段到 `stages/` 目錄
- [ ] 更新階段定義 (Planning, Implementing, Testing, Review, Done)
- [ ] 移除舊的 DIAGNOSE/FIX_ISSUES 邏輯 (整合到 Testing)

#### 1.4 保留並重構 Claude Wrapper
- [ ] 移動 `claude-wrapper.ts` 到 `src/services/claude/`
- [ ] 拆分功能到 `planner.ts`, `implementer.ts`, `reviewer.ts`
- [ ] 更新 prompt 模板以適應新流程

#### 1.5 移除 Daemon 模式
- [ ] 移除 `src/services/daemon.ts`
- [ ] 更新相關 CLI 指令

#### 1.6 移除 MCP Server (可選保留)
- [ ] 移除或標記為 deprecated `src/mcp/`
- [ ] 更新 exports

---

### Phase 2: GitHub 整合

#### 2.1 建立 GitHubService
```typescript
// src/services/github/index.ts
export class GitHubService {
  constructor(private repo: string) {}

  // Issue 操作
  async getIssue(number: number): Promise<Issue>
  async addIssueComment(number: number, body: string): Promise<void>
  async addIssueLabels(number: number, labels: string[]): Promise<void>
  async removeIssueLabels(number: number, labels: string[]): Promise<void>

  // PR 操作
  async createPR(options: CreatePROptions): Promise<PR>
  async addPRComment(number: number, body: string): Promise<void>
  async getPRReviewComments(number: number): Promise<ReviewComment[]>

  // Project 操作
  async getOrCreateProject(name: string): Promise<Project>
  async moveCardToColumn(itemId: string, columnName: string): Promise<void>
  async addIssueToProject(issueNumber: number, projectId: string): Promise<void>

  // 權限
  async isCollaborator(username: string): Promise<boolean>
}
```

#### 2.2 Issue 操作實現
- [ ] 實現 `getIssue()` - 使用 `gh issue view`
- [ ] 實現 `addIssueComment()` - 使用 `gh issue comment`
- [ ] 實現 `addIssueLabels()` - 使用 `gh issue edit --add-label`
- [ ] 實現 `removeIssueLabels()` - 使用 `gh issue edit --remove-label`
- [ ] 實現 `closeIssue()` - 使用 `gh issue close`

#### 2.3 PR 操作實現
- [ ] 實現 `createPR()` - 使用 `gh pr create`
- [ ] 實現 `addPRComment()` - 使用 `gh pr comment`
- [ ] 實現 `getPRReviewComments()` - 使用 `gh api`
- [ ] 實現 `replyToReviewComment()` - 使用 `gh api`

#### 2.4 Project 操作實現
- [ ] 實現 `getOrCreateProject()` - 使用 `gh project list` / `gh project create`
- [ ] 實現 `getProjectColumns()` - 取得看板欄位
- [ ] 實現 `addIssueToProject()` - 使用 `gh project item-add`
- [ ] 實現 `moveCardToColumn()` - 使用 `gh project item-edit`

#### 2.5 權限驗證
- [ ] 實現 `isCollaborator()` - 使用 `gh api repos/{owner}/{repo}/collaborators/{username}`

---

### Phase 3: Git Worktree 管理

#### 3.1 建立 WorktreeManager
```typescript
// src/services/git/worktree.ts
export class WorktreeManager {
  constructor(private workDir: string) {}

  async ensureRepo(repo: string): Promise<string>
  async createWorktree(repo: string, issueNumber: number, branch: string): Promise<string>
  async removeWorktree(repo: string, issueNumber: number): Promise<void>
  async listWorktrees(repo: string): Promise<Worktree[]>
  async cleanupStaleWorktrees(maxAge: number): Promise<void>
}
```

#### 3.2 Repo 初始化
- [ ] 實現 bare clone: `git clone --bare`
- [ ] 實現 fetch: `git fetch origin`
- [ ] 實現 repo 路徑管理

#### 3.3 Worktree 操作
- [ ] 實現 `createWorktree()`: `git worktree add`
- [ ] 實現 `removeWorktree()`: `git worktree remove`
- [ ] 實現 `listWorktrees()`: `git worktree list`

#### 3.4 清理機制
- [ ] 實現過期 worktree 檢測
- [ ] 實現自動清理邏輯
- [ ] 實現磁碟空間檢查

---

### Phase 4: Runner 與任務管理

#### 4.1 建立 Orchestrator
```typescript
// src/orchestrator/index.ts
export class Orchestrator {
  private runnerPool: RunnerPool
  private taskQueue: TaskQueue
  private healthMonitor: HealthMonitor

  async start(): Promise<void>
  async stop(): Promise<void>
  async handleEvent(event: GitHubEvent): Promise<void>
}
```

#### 4.2 Runner Pool
- [ ] 實現 Runner 類
- [ ] 實現 Runner 池管理
- [ ] 實現動態 Runner 分配
- [ ] 實現 Runner 狀態追蹤

#### 4.3 Task Queue
- [ ] 實現任務佇列
- [ ] 實現優先級排序
- [ ] 實現任務狀態管理
- [ ] 實現任務持久化 (SQLite)

#### 4.4 Event Handler
- [ ] 實現 `issues.labeled` 事件處理
- [ ] 實現 `issue_comment.created` 事件處理
- [ ] 實現 `pull_request_review` 事件處理
- [ ] 實現 `pull_request.closed` 事件處理

#### 4.5 Health Monitor
- [ ] 實現 Runner 健康檢查
- [ ] 實現自動重啟邏輯
- [ ] 實現資源監控

---

### Phase 5: Docker 化

#### 5.1 建立 Dockerfile
```dockerfile
# docker/Dockerfile
FROM node:22-bookworm

# 安裝相依套件
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq

# 安裝 GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh

# 安裝 Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# 安裝 GitHub Actions Runner
# ... (runner 安裝步驟)

# 複製 Haunted
COPY . /app
WORKDIR /app
RUN npm install && npm run build

# 入口點
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

#### 5.2 建立 docker-compose.yml
```yaml
# docker/docker-compose.yml
version: '3.8'
services:
  haunted:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    volumes:
      - ~/.claude:/home/runner/.claude:ro
      - ~/.config/gh:/home/runner/.config/gh:ro
      - haunted-work:/work
      - haunted-data:/data
    environment:
      - GITHUB_ORG=${GITHUB_ORG}
      - RUNNER_TOKEN=${RUNNER_TOKEN}
      - MAX_RUNNERS=${MAX_RUNNERS:-3}
    restart: unless-stopped

volumes:
  haunted-work:
  haunted-data:
```

#### 5.3 建立 entrypoint.sh
- [ ] 設定 Runner 註冊
- [ ] 啟動 Orchestrator
- [ ] 處理信號 (graceful shutdown)

---

### Phase 6: GitHub Actions Workflows

#### 6.1 建立 workflow 模板

```yaml
# templates/workflows/haunted-issue.yml
name: Haunted Issue Handler
on:
  issues:
    types: [labeled]

jobs:
  handle-issue:
    if: github.event.label.name == 'haunted'
    runs-on: self-hosted
    steps:
      - name: Handle Issue
        run: haunted handle-issue ${{ github.event.issue.number }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

#### 6.2 建立所有 workflow 模板
- [ ] `haunted-issue.yml` - Issue 標籤處理
- [ ] `haunted-comment.yml` - Issue 評論處理 (/approve, /reject, etc.)
- [ ] `haunted-pr-review.yml` - PR Review 處理
- [ ] `haunted-pr-merged.yml` - PR 合併後處理

#### 6.3 建立模板產生器
- [ ] CLI 指令 `haunted init` 複製 workflow 模板到目標 repo
- [ ] 自動設定必要的 labels
- [ ] 自動建立 GitHub Project

---

## 依賴關係圖

```
Phase 1 (基礎重構)
    │
    ├──► Phase 2 (GitHub 整合)
    │       │
    │       └──► Phase 4 (Runner 管理) ──► Phase 5 (Docker)
    │               │                          │
    │               └──────────────────────────┴──► Phase 6 (Workflows)
    │
    └──► Phase 3 (Worktree 管理)
            │
            └──► Phase 4 (Runner 管理)
```

---

## 預估工作量

| Phase | 任務數 | 複雜度 |
|-------|--------|--------|
| Phase 1: 基礎重構 | 6 | 中 |
| Phase 2: GitHub 整合 | 5 | 高 |
| Phase 3: Worktree 管理 | 5 | 中 |
| Phase 4: Runner 管理 | 5 | 高 |
| Phase 5: Docker 化 | 5 | 中 |
| Phase 6: Workflows | 5 | 低 |

---

## 下一步

1. 確認此計畫是否符合需求
2. 開始 Phase 1 實作
3. 逐步完成各 Phase

---

*文件版本: 1.0*
*建立日期: 2024-12*
