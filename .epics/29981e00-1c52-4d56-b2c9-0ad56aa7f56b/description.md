Two UI features:

1. **Version display** — show app version (from package.json) in the sidebar footer, next to project info. Requires a `/api/version` endpoint or inclusion in existing `/api/status` response.

2. **Selective task runner** — allow users to select individual tasks (via checkboxes in the task list) and run only the selected ones, instead of running an entire epic or all tasks. Needs a new `startTasks(projectId, taskIds[])` method in RunnerService, a corresponding API endpoint, and UI controls (checkboxes + "Run Selected" button) in the Dashboard task list.