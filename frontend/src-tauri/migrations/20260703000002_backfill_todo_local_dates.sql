-- Todo date keys are local calendar dates, matching how meetings are shown in the UI.
-- Earlier extracted todos used the UTC date from meetings.created_at, which hid
-- late-night meetings from the local "Today" view.
UPDATE todos
SET date = (
    SELECT date(m.created_at, 'localtime')
    FROM meetings m
    WHERE m.id = todos.meeting_id
)
WHERE meeting_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM meetings m
    WHERE m.id = todos.meeting_id
  );
