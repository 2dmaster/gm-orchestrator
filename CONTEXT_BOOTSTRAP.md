# gm-orchestrator v2 — контекст для Claude Code
# Импортируй один раз: /import CONTEXT_BOOTSTRAP.md  (потом удали файл)

## Что это

Tokenless оркестратор для автоматизации Claude Code + GraphMemory.
Каждая задача = отдельная `claude --print` сессия. Контекст умирает вместе с процессом.
Оркестратор читает задачи из GraphMemory REST API, Claude сигнализирует через `tasks_move("done")`.

## Стек

- TypeScript (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)
- Node.js ESM, `tsx` для запуска без компиляции
- Vitest для тестов
- Zero production dependencies

## Архитектура

```
src/
  core/           ← чистая бизнес-логика, никаких I/O
    types.ts          Domain types + Port interfaces (GraphMemoryPort, ClaudeRunnerPort, TaskPollerPort)
    orchestrator.ts   runSprint() и runEpic() — принимают порты через DI
    prompt-builder.ts buildPrompt() — AI-first промпт для каждой сессии Claude Code
    task-utils.ts     sortByPriority(), areBlockersResolved(), isTerminal()
  infra/          ← реализации портов
    gm-client.ts      GraphMemoryClient implements GraphMemoryPort
    claude-runner.ts  ClaudeRunner implements ClaudeRunnerPort (spawn claude --print)
    task-poller.ts    TaskPoller implements TaskPollerPort (REST polling каждые 3s)
    logger.ts         Logger interface + consoleLogger + silentLogger
    config.ts         loadConfig() — file < env < CLI args
  cli/
    index.ts          CLI entrypoint: sprint | epic <id> | status

tests/
  fixtures/
    factories.ts      makeTask(), makeEpic(), makeBlockedTask() — фабрики для тестов
    fakes.ts          FakeGraphMemory, FakePoller(gm), FakeRunner — in-memory фейки
  unit/
    task-utils.test.ts
    prompt-builder.test.ts
  integration/
    orchestrator.test.ts   Тестирует sprint и epic логику через фейки, без реального Claude/GM
```

## Ключевые дизайн-решения

**Port/Adapter pattern** — `core/` никогда не импортирует из `infra/`. Все зависимости инжектируются.
Это позволяет тестировать оркестратор полностью без Claude и GraphMemory.

**Сигнал завершения = task status** — оркестратор поллит REST `GET /api/{project}/tasks/{id}`.
Claude внутри сессии вызывает `tasks_move(id, "done")` через MCP. Никакого парсинга stdout.

**FakePoller синхронизирует FakeGraphMemory** — при `waitForCompletion()` фейк обновляет статус
таски в памяти, чтобы следующий `listTasks(status: 'todo')` вернул пустой список и цикл завершился.

**dry_run двигает таску в done** — иначе бесконечный цикл (таска остаётся todo навсегда).

**in_progress задачи resume-first** — при рестарте подхватываются первыми (до todo по приоритету).

## GraphMemory REST API

```
Base: http://localhost:3000/api/{projectId}

GET  /tasks?status=todo&tag=backend&limit=100
GET  /tasks/{id}          ← enriched: subtasks, blockedBy, blocks, related
POST /tasks/{id}/move     body: { status }
PATCH /tasks/{id}         partial update

GET  /epics?status=todo
GET  /epics/{id}          ← includes tasks[]
PATCH /epics/{id}         body: { status }
```

Auth: `Authorization: Bearer <apiKey>` (опционально)

## GraphMemory MCP инструменты (для Claude внутри сессии)

```
tasks_get(id)             → полный контекст + subtasks + blockedBy
tasks_move(id, status)    → СИГНАЛ оркестратору
skills_recall(query)      → поиск рецептов перед началом работы
tasks_list(status, tag)   → список задач
epics_get(id)             → задачи эпика
```

## Запуск

```bash
npm install
cp .gm-orchestrator.example.json .gm-orchestrator.json
# Редактируй projectId и apiKey

npx tsx src/cli/index.ts status
npx tsx src/cli/index.ts sprint
npx tsx src/cli/index.ts epic <epicId>
npx tsx src/cli/index.ts sprint --dry-run
npx tsx src/cli/index.ts sprint --tag backend --timeout 20 --retries 2
```

## Тесты

```bash
npm test                  # 41 тест, ~3 секунды
npm run test:watch
npm run test:coverage
```

## Конфиг .gm-orchestrator.json

```json
{
  "baseUrl": "http://localhost:3000",
  "projectId": "my-app",
  "apiKey": "mgm-key-...",
  "timeoutMs": 900000,
  "pauseMs": 2000,
  "maxRetries": 1,
  "claudeArgs": [],
  "dryRun": false
}
```

Env vars: GM_BASE_URL, GM_PROJECT_ID, GM_API_KEY, GM_TIMEOUT_MS
Priority: defaults < .gm-orchestrator.json < env < CLI flags

## Что можно добавить дальше

- Параллельный запуск независимых задач (сейчас строго sequential)
- WebSocket вместо polling (если GraphMemory добавит events)
- Git автокоммит после каждой задачи
- Дашборд прогресса спринта (React + GraphMemory WebSocket)
- `--epic` флаг вместо отдельной команды для удобства
- Retry с экспоненциальным backoff вместо фиксированного паузы
