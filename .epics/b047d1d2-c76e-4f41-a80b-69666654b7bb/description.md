Improve Dashboard UX: filter epics by status (hide closed by default, toggle to show all), and when an epic is selected — show only its tasks in the task list.

## Motivation
Currently the dashboard shows all epics (including done/cancelled) and all tasks regardless of epic selection. This makes it hard to focus on the active work.

## Scope
- Epic list: show only open/in_progress by default, add toggle for closed
- Epic selector dropdown: same filtering
- Task list: when an epic is selected, show only that epic's tasks
- API: may need endpoint to fetch tasks by epic