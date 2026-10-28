-- Task groups (Private, School, Business, …) get their own column. Until now a todo's group id sat in `project`,
-- which the Plan board also uses for its projects. Move every value that is a group id (the defaults, or an id from
-- the synced "taskGroups" document) out of `project`, and bump those rows' rev so every device pulls the change.
ALTER TABLE todos ADD COLUMN task_group TEXT;

UPDATE meta SET value = value + 1 WHERE key = 'rev';

UPDATE todos SET task_group = project, project = NULL, rev = (SELECT value FROM meta WHERE key = 'rev')
WHERE project IN ('private', 'school', 'business')
   OR project IN (SELECT json_extract(e.value, '$.id') FROM docs, json_each(docs.value) e
                  WHERE docs.key = 'taskGroups' AND docs.deleted = 0 AND json_valid(docs.value));
