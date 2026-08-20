[x] Add HIDDEN
[x ]Add 'disable'
[x] Add AUTOMATIC DISABLE on ERROR (Error fetching chat 3318678815: The channel specified is private and you lack permission to access it. Another reason may be that you were banned from it (caused by GetChannelsRequest))
[x] Add sorting
[x] Add filtering / instant filter (search)

Add total messages, total new, total new media, total success, total failed to terminal log

[x] Stat display: total messages, last message, last update, saved (breakdown), total size on disk

Buttons-
KILL ALL
ARCHIVE ALL
SCHEDULE (set time or RECURRING)
SHOW TERMINAL

Per Chat-List page:
Sync
Download
Purge
Archive
Zip
Defer
Enbatch
Validate (checkbox)
Overwrite (checkbox)
Link to Active Path
Link to Final Path

---

SELECT FILE TYPES to VAULT

---

VALIDATE don't work (it doesn't play nice with PURGER because the last-message-id doesn't get reset) - Create PURGE + RESET function
A skipped/killed is still 'complete'

History should be saved
Settings (filter/sorting) should be saved


[9:31:43 PM]
Chat 1801160866 Completed.
Found: 200 | Success: 190 | Failed: 10

Add time-start, time-end, time-elapsed for the FINISHED FILES and the progress abr

Processing 114 queued chats --> Include start time, time-elapsed, and X of Y