-- Kanban column of a todo on the Plan board: backlog | todo | doing | done.
-- NULL means "not placed yet": the apps read it as todo, or done when done = 1.
-- Old app versions don't send it, so an upsert without status keeps the stored one.
ALTER TABLE todos ADD COLUMN status TEXT CHECK (status IN ('backlog', 'todo', 'doing', 'done'));
