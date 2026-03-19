# Telegram Media Manager: Architecture & API Documentation

## 1. System Overview

This project is a headless, asynchronous FastAPI backend designed to scrape, categorize, and download media and text histories from Telegram groups, channels, and private dialogs.

Originally built as a monolithic, terminal-blocking Python script (`tg_dl.py`), the system has been refactored into an event-driven web service. It is optimized to run continuously in a homelab or NAS environment, exposing a REST API for orchestration and WebSockets for real-time progress monitoring.

---

## 2. Feature Matrix & Internal Engine Behaviors

### 🟢 Retained & Restored Features (Full Parity)

The following features from the original CLI engine were retained or carefully restored to maintain real-world resilience:

- **File Integrity & Size Validation (`check_file_size_integrity`):** Prevents silent file truncations by comparing expected Telegram document sizes against bytes on disk.
- **Safe Resume Logic (`SAFE_RESUME_REWIND`):** If a `.part` file exists, the worker reads its size, rolls back by 1MB (to prevent corrupted chunk boundaries), and resumes the download via `client.iter_download`.
- **Smart Categorization (`get_file_category`):** Automatically routes files into `images/`, `videos/`, `archives/`, or `misc/` folders based on Telethon media types and mime-type guessing. Explicitly ignores zero-byte map locations, polls, and dice rolls.
- **Dynamic Filename Generation (`generate_filename`):** Attempts to extract the original uploaded filename via `DocumentAttributeFilename`. If missing, falls back to a safe `<message_id>_<chat_id>_<timestamp>.<ext>` format.
- **Windows-Safe File Operations:** Renaming a `.part` file to its final extension is wrapped in a 3-attempt retry loop with a 1-second delay to bypass temporary OS or local Antivirus file locks.
- **Alt-Path Awareness:** The engine checks an optional `ALT_DOWNLOADS_DIR` (e.g., a secondary storage array) during both the scan phase and the worker execution phase to prevent re-downloading existing data.
- **Topic Exclusion (`db_get_topic_exclusions`):** Allows specific Telegram Forum Topic IDs to be ignored during scans, saving bandwidth and storage.
- **Text & Metadata Archiving:** Extracts message text, reply chains, sender IDs, and forum topic IDs into a deduplicated `messages.json` file in the chat's root folder. Includes an automated `.bak` corruption recovery system.
- **Incomplete Chunk Recovery:** Queries the database for message IDs marked as queued/failed but missing from the current scan session, and re-fetches their message objects in chunks of 200.
- **Flood Control & Network Pausing (`SYSTEM_PAUSED`):** Catches HTTP 429/FloodWait errors, pauses the entire spawning system globally, and applies a multiplied backoff strategy before retrying the specific chunk.
- **Expired Reference Handling:** Explicitly catches `FileReferenceExpiredError` and invokes a fresh `client.get_messages()` call to renew the file token rather than failing out.
- **Smart Congestion Control (`should_spawn_smart`):** An internal bandwidth monitor that calculates the global download speed across all active tasks. It blocks new heavy workers from spawning if spinning up recent tasks resulted in a net-zero bandwidth gain, preventing API bans.
- **Dynamic Download Counting (`update_total_downloaded`):** Automatically recalculates and updates the `total_downloaded` integer in the database silently after scans and syncs.

### 🟡 Modified Behaviors (Refactored for Web)

- **Progress UI:** Terminal `rich.progress` bars were replaced with a `ws_manager.py` singleton that broadcasts JSON status events to connected browser clients.
- **Batch Orchestration:** The synchronous CLI loop for processing `is_batch=1` chats was rebuilt as a FastAPI `BackgroundTask`, allowing the user to trigger a massive queue and close the browser without interrupting the server.
- **Database Syncing:** Dialog fetching is now triggered via a dedicated `POST /api/sync` endpoint rather than a CLI menu. It uses proper Telethon type-checking (e.g., `isinstance(entity, Channel)`) to distinguish groups from broadcasts.

### 🔴 Omitted Features

- **The Auto-Scheduler (`--auto`):** The infinite Python `while` loop was removed. Scheduling should now be handled externally (e.g., a CRON job hitting the `/api/batch/start` endpoint).
- **Redownload Wiping (`--redownload`):** The automated DB-wiping utility for the `redownload=1` flag was stripped from the core engine to prevent accidental data loss via API.
- **`for_dl` Endpoint Exposure:** Added to the DB schema but purposefully omitted from the JSON API payload.

---

## 3. Database Schema (`aiosqlite`)

### Table: `chat_list`

| Column               | Type         | Description                                                |
| :------------------- | :----------- | :--------------------------------------------------------- |
| `chat_id`            | INTEGER (PK) | The unique Telegram Chat/Channel ID.                       |
| `chat_name`          | TEXT         | Current display name of the chat.                          |
| `chat_type`          | TEXT         | Group, Channel, or Private.                                |
| `total_messages`     | INTEGER      | Total message count in the chat.                           |
| `is_batch`           | INTEGER      | Boolean flag (0/1) for inclusion in batch runs.            |
| `date_added`         | DATETIME     | When the chat was first tracked.                           |
| `date_updated`       | DATETIME     | Last time the metadata was synced.                         |
| `old_name`           | TEXT         | Previous chat name if renamed.                             |
| `last_message_id`    | INTEGER      | The cursor position of the last scanned message.           |
| `last_download_scan` | DATETIME     | Timestamp of the last media scan.                          |
| `defer`              | INTEGER      | Priority ordering for batch processing (lower runs first). |
| `topics`             | TEXT         | JSON string of available forum topics.                     |
| `topics_exclude`     | TEXT         | Comma-separated string of topic IDs to ignore.             |
| `redownload`         | INTEGER      | Flag indicating a requested history wipe.                  |
| `last_archived`      | DATETIME     | Timestamp of the last `messages.json` update.              |
| `for_dl`             | BOOLEAN      | Internal flag (default 1).                                 |
| `total_downloaded`   | INTEGER      | Dynamically calculated count of 'success' files.           |

### Table: `downloads`

| Column              | Type      | Description                                    |
| :------------------ | :-------- | :--------------------------------------------- |
| `file_unique_id`    | TEXT (PK) | Composite key: `{chat_id}_{message_id}`        |
| `chat_id`           | INTEGER   | FK to `chat_list`.                             |
| `message_id`        | INTEGER   | The specific Telegram message ID.              |
| `topic_id`          | INTEGER   | The forum topic ID (if applicable).            |
| `file_path`         | TEXT      | The absolute path on disk.                     |
| `original_filename` | TEXT      | The original filename extracted from metadata. |
| `final_filename`    | TEXT      | The generated/sanitized filename used on disk. |
| `status`            | TEXT      | `queued`, `pending`, `success`, or `failed`.   |
| `file_size`         | INTEGER   | Expected byte size of the media.               |
| `timestamp`         | DATETIME  | When the record was created.                   |

---

## 4. REST API Endpoints

### Data & Status

- **`GET /api/status`**
    - **Purpose:** Health check.
    - **Response:** `{"client_connected": true, "active_ws_connections": 1}`
- **`GET /api/chats`**
    - **Purpose:** Retrieves all tracked chats for UI tables.
    - **Response:** Array of objects: `[{"chat_id": 123, "name": "Video Dump", "type": "Channel", "total_messages": 5000, "is_batch": true, "old_name": null, "last_scan": "2024-01-01...", "last_message": 4500, "topics": [...], "topics_exclude": [5, 12], "last_archived": "...", "total_downloaded": 1400}]`

### Orchestration

- **`POST /api/sync`**
    - **Purpose:** Initiates a background database sync of all Telegram dialogs.
    - **Response:** `{"status": "Sync initiated"}`
- **`POST /api/download/{chat_id}`**
    - **Purpose:** Triggers the scanning and multi-threaded downloading process for a specific chat.
    - **Query Params:**
        - `overwrite` (bool, default: false): Overwrite existing files on disk.
        - `validate` (bool, default: false): Ignore `last_message_id` cursor and scan from 0.
        - `resume` (bool, default: true): Safely resume `.part` files.
    - **Response:** `{"status": "Download initiated", "chat_id": 12345, "options": {...}}`
- **`POST /api/batch/start`**
    - **Purpose:** Triggers sequential background downloading for all chats where `is_batch=1`.
    - **Query Params:** `overwrite`, `validate`, `resume` (applies to all chats in the queue).
    - **Response:** `{"status": "Batch process initiated"}`

---

## 5. WebSocket Events (`WS /ws`)

The backend broadcasts JSON payloads. The frontend should switch on the `event` key.

| Event Type                       | Payload Data                                                          | Trigger Condition                                                            |
| :------------------------------- | :-------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| `log`                            | `message` (string)                                                    | General system notifications or DB sync updates.                             |
| `scan_start`                     | `chat_name`, `chat_id`, `min_id`                                      | Emitted when a chat begins its metadata parsing phase.                       |
| `scan_progress`                  | `scanned` (int)                                                       | Emitted every 500 messages to prevent UI timeouts during deep scans.         |
| `scan_complete`                  | `queued` (int)                                                        | Scan finished; total number of files requiring download.                     |
| `task_start`                     | `file_id`, `filename`, `chat_id`, `queue_info`                        | A worker has picked up a specific file and created the `.part` file.         |
| `progress`                       | `file_id`, `downloaded` (bytes), `total` (bytes), `speed` (bytes/sec) | Live metrics emitted during the active download stream.                      |
| `task_complete`                  | `file_id`, `status` ("success")                                       | File finished downloading, renamed successfully, and passed integrity check. |
| `task_error`                     | `file_id`, `error` (string)                                           | A file failed permanently after exhausting `MAX_RETRIES`.                    |
| `error`                          | `message` (string)                                                    | System-level error (e.g., FloodWait pausing the global queue).               |
| `chat_complete`                  | `chat_id`, `stats` (object)                                           | All queues for a specific chat are empty. Contains success/fail tallies.     |
| `batch_complete`                 | _None_                                                                | The entire `is_batch=1` loop has concluded.                                  |
| gins its metadata parsing phase. |
| `scan_progress`                  | `scanned` (int)                                                       | Emitted every 500 messages to prevent UI timeouts during deep scans.         |
| `scan_complete`                  | `queued` (int)                                                        | Scan finished; total number of files requiring download.                     |
| `task_start`                     | `file_id`, `filename`, `chat_id`, `queue_info`                        | A worker has picked up a specific file and created the `.part` file.         |
| `progress`                       | `file_id`, `downloaded` (bytes), `total` (bytes), `speed` (bytes/sec) | Live metrics emitted during the active download stream.                      |
| `task_complete`                  | `file_id`, `status` ("success")                                       | File finished downloading, renamed successfully, and passed integrity check. |
| `task_error`                     | `file_id`, `error` (string)                                           | A file failed permanently after exhausting `MAX_RETRIES`.                    |
| `error`                          | `message` (string)                                                    | System-level error (e.g., FloodWait pausing the global queue).               |
| `chat_complete`                  | `chat_id`, `stats` (object)                                           | All queues for a specific chat are empty. Contains success/fail tallies.     |
| `batch_complete`                 | _None_                                                                | The entire `is_batch=1` loop has concluded.                                  |
