# 👻 Haunted

> AI DevOps tool that haunts your GitHub repository

Haunted 是一個「附身」在 GitHub repo 的 AI DevOps 工具，透過兩個 agent 自動化管理開發流程。

## 核心概念

- **House Master (HM)** - AI Project Manager，負責分析 issue、指派任務、Code Review
- **Claude Code (CC)** - AI Developer，負責實際開發、建立 PR

## 功能特色

- 🔍 自動分析新 issue 並決定處理方式
- 🤖 AI 自動實作並建立 PR
- 📝 自動 Code Review
- 📋 GitHub Project 看板整合
- 🔄 支援 Webhook + Polling 混合模式
- 🐳 Docker 化部署
- 🌳 Git worktree 支援多任務並行

## 快速開始

### 前置需求

- [Bun](https://bun.sh) 1.0+
- [GitHub CLI](https://cli.github.com) (`gh`)
- [Claude Code CLI](https://claude.ai/code) (`claude`)

### 安裝

```bash
# Clone 專案
git clone https://github.com/your-org/haunted.git
cd haunted

# 安裝依賴
bun install

# 確認 GitHub CLI 已登入
gh auth status

# 確認 Claude Code 已登入
claude --version
```

### 配置

1. 複製範例配置檔：

```bash
cp haunted.yaml.example haunted.yaml
```

2. 編輯 `haunted.yaml`：

```yaml
scope:
  type: "repo"
  target: "your-org/your-repo"

github:
  webhook:
    enabled: true
    port: 3000
    secret: "${WEBHOOK_SECRET}"  # 可選
  polling:
    enabled: true
    interval: 60
```

### 執行

```bash
# 開發模式 (hot reload)
bun run dev

# 生產模式
bun run start
```

## Docker 部署

```bash
# 建置 image
docker build -t haunted .

# 執行 (需要掛載認證目錄)
docker-compose up -d
```

### 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `REPO_PATH` | 目標 repo 路徑 | `.` |
| `WEBHOOK_SECRET` | GitHub webhook 密鑰 | - |
| `LOG_LEVEL` | 日誌等級 | `info` |

## 使用方式

### 自動處理

當有新 issue 建立時，Haunted 會自動：

1. **House Master 分析** - 判斷 issue 類型、複雜度
2. **決定指派** - AI 處理或需要人類介入
3. **Claude Code 實作** - 在獨立 worktree 中開發
4. **建立 PR** - 推送變更並建立 Pull Request
5. **Code Review** - House Master 自動審查

### 特殊 Labels

| Label | 說明 |
|-------|------|
| `human-only` | 只能由人類處理，AI 會跳過 |
| `haunted-skip` | 完全跳過 AI 處理 |
| `auto-merge` | PR 通過審查後自動合併 |
| `needs-review` | 需要人類審核 |

### 指令

在 issue 評論中使用：

- `/retry` - 重新處理此 issue
- `/cancel` - 取消正在進行的處理
- `/status` - 查看處理狀態

### @mention

在評論中 `@haunted` 可以與 House Master 互動。

## Multi-Instance Manager

Haunted 提供 Manager 服務，可以同時管理多個 haunted instance。

### 配置

```bash
# 複製範例配置
cp manager.yaml.example manager.yaml
```

編輯 `manager.yaml`：

```yaml
version: "1.0"

manager:
  api:
    port: 8080
    host: "0.0.0.0"
  supervisor:
    auto_restart: true
    max_restarts: 3

instances:
  - id: "org-main"
    name: "Main Organization"
    enabled: true
    config_file: "./instances/org.yaml"
    working_dir: "/path/to/org/repo"
    env:
      GITHUB_TOKEN: "${ORG_GITHUB_TOKEN}"

  - id: "my-repo"
    name: "Personal Repo"
    enabled: true
    config:
      scope:
        type: "repo"
        target: "username/repo"
      github:
        webhook:
          port: 3001
    working_dir: "/path/to/repo"
```

### 執行

```bash
# 開發模式
bun run manager:dev

# 生產模式
bun run manager
```

### HTTP API

Manager 提供 HTTP API 來管理 instances：

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/health` | 健康檢查 |
| GET | `/api/instances` | 列出所有 instances |
| GET | `/api/instances/:id` | 取得 instance 狀態 |
| POST | `/api/instances/:id/start` | 啟動 instance |
| POST | `/api/instances/:id/stop` | 停止 instance |
| POST | `/api/instances/:id/restart` | 重啟 instance |
| GET | `/api/instances/:id/logs` | 取得日誌 |
| GET | `/api/instances/:id/logs/stream` | SSE 即時日誌 |
| GET | `/api/metrics` | 全局監控指標 |

範例：

```bash
# 查看所有 instances
curl http://localhost:8080/api/instances

# 重啟特定 instance
curl -X POST http://localhost:8080/api/instances/my-repo/restart

# 取得最新 50 行日誌
curl "http://localhost:8080/api/instances/my-repo/logs?limit=50"
```

## 架構

```
┌─────────────────────────────────────────────────────┐
│                GitHub Repository                     │
│  ┌────────┐  ┌──────────┐  ┌──────┐  ┌──────────┐  │
│  │ Issues │  │ Projects │  │ PRs  │  │ Webhooks │  │
│  └────────┘  └──────────┘  └──────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
                        │
                ┌───────▼───────┐
                │   Haunted     │
                ├───────────────┤
                │ Event Handler │◄── Webhook + Polling
                ├───────────────┤
                │ House Master  │◄── Claude Code CLI
                ├───────────────┤
                │ Claude Code   │◄── Claude Code CLI
                │   Workers     │    + Git Worktrees
                └───────────────┘
```

### Manager 架構

```
┌─────────────────────────────────────────────────────┐
│                  Haunted Manager                     │
│  ┌──────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ HTTP API │  │ Supervisor │  │ MetricsCollector│  │
│  └──────────┘  └────────────┘  └────────────────┘  │
├─────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐       │
│  │ Instance  │  │ Instance  │  │ Instance  │  ...  │
│  │ (子進程)   │  │ (子進程)   │  │ (子進程)   │       │
│  └───────────┘  └───────────┘  └───────────┘       │
└─────────────────────────────────────────────────────┘
```

## 開發

```bash
# 型別檢查
bun run typecheck

# Lint
bun run lint
```

## 授權

MIT
