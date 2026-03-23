import asyncio
import json
import os
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from contextlib import asynccontextmanager
from telethon import TelegramClient
from telethon.network import ConnectionTcpAbridged

from database import init_db, get_settings_dict, update_setting
from ws_manager import manager
from downloader import process_chat_download, sync_chatlist, sync_single_chat, process_batch_download
from utils import normalize_name
from orchestrator import queue_manager


telegram_client = None
db_pool = None

class SettingsUpdate(BaseModel):
    api_id: Optional[str] = None
    api_hash: Optional[str] = None
    session_name: Optional[str] = None
    download_path: Optional[str] = None
    alt_download_path: Optional[str] = None
    max_concurrent_heavy: Optional[str] = None
    max_concurrent_light: Optional[str] = None
    max_retries: Optional[str] = None
    speed_threshold_kb: Optional[str] = None
    ignored_extensions: Optional[str] = None
    ui_sort_config: Optional[str] = None
    ui_filter_config: Optional[str] = None

class ToggleRequest(BaseModel):
    chat_ids: List[int]
    field: str
    value: bool

class MultiChatRequest(BaseModel):
    chat_ids: List[int]
    overwrite: Optional[bool] = False
    validate_mode: Optional[bool] = False
    resume: Optional[bool] = True

@asynccontextmanager
async def lifespan(app: FastAPI):
    global telegram_client, db_pool
    db_pool = await init_db()
    
    # --- NEW: Create Activity History Table ---
    await db_pool.execute('''
        CREATE TABLE IF NOT EXISTS activity_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            chat_id INTEGER,
            stats TEXT
        )
    ''')
    await db_pool.commit()
    
    settings = await get_settings_dict(db_pool)
    api_id, api_hash, session_name = settings.get('api_id'), settings.get('api_hash'), settings.get('session_name', 'wirekeeper_session')
    
    if api_id and api_hash:
        try:
            telegram_client = TelegramClient(session_name, int(api_id), api_hash, connection=ConnectionTcpAbridged)
            await telegram_client.start()
            print("WireKeeper Engine Started Successfully.")
            
            # --- Initialize and start Orchestrator ---
            queue_manager.initialize(telegram_client, db_pool)
            asyncio.create_task(queue_manager.worker_loop())
            
        except Exception as e:
            print(f"Failed to start Telegram Client: {e}")
            telegram_client = None
    
    yield
    
    if telegram_client: await telegram_client.disconnect()
    await db_pool.close()

app = FastAPI(lifespan=lifespan)

# CORS config to allow the React frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/api/chats")
async def get_chats():
    query = """
        SELECT 
            chat_id, chat_name, chat_type, total_messages, is_batch,
            old_name, last_download_scan, last_message_id, topics, topics_exclude, 
            last_archived, total_downloaded, enabled, hidden, defer, total_size, last_download, date_updated, chat_status
        FROM chat_list
    """
    async with db_pool.execute(query) as cursor:
        rows = await cursor.fetchall()
        
        result = []
        for r in rows:
            topics_data = None
            if r[8]:
                try: topics_data = json.loads(r[8])
                except json.JSONDecodeError: topics_data = r[8] 
            
            topics_exclude_data = []
            if r[9]:
                try: topics_exclude_data = [int(x.strip()) for x in r[9].split(',') if x.strip().isdigit()]
                except Exception: pass

            raw_name = r[1] or "Unknown_Chat"
            chat_id = r[0]
            norm_name = normalize_name(raw_name)
            exact_folder_name = f"[{chat_id}]_{norm_name}"

            result.append({
                "chat_id": chat_id, 
                "name": raw_name, 
                "folder_name": exact_folder_name,
                "type": r[2], 
                "total_messages": r[3], 
                "is_batch": bool(r[4]),
                "old_name": r[5],
                "last_scan": r[6],            
                "last_message": r[7],         
                "topics": topics_data,        
                "topics_exclude": topics_exclude_data, 
                "last_archived": r[10],
                "total_downloaded": r[11] or 0,
                "enabled": bool(r[12] if r[12] is not None else 1), 
                "hidden": bool(r[13] if r[13] is not None else 0),
                "defer": bool(r[14] if r[14] is not None else 0),
                "total_size": r[15] or 0,
                "last_download": r[16],
                "date_updated": r[17],
                "chat_status": bool(r[18] if r[18] is not None else 1)
            })
            
        return result

# --- NEW BULK TOGGLE ENDPOINT ---
@app.post("/api/chats/toggle")
async def toggle_chat_flags(req: ToggleRequest):
    """Dynamically toggles boolean flags for one or multiple chats."""
    allowed_fields = {"is_batch", "defer", "enabled", "hidden"}
    if req.field not in allowed_fields:
        raise HTTPException(status_code=400, detail="Invalid field")

    # Convert Python boolean to SQLite integer
    val = 1 if req.value else 0
    
    # Create the ?,?,? string dynamically based on how many chats were selected
    placeholders = ",".join("?" for _ in req.chat_ids)
    query = f"UPDATE chat_list SET {req.field} = ? WHERE chat_id IN ({placeholders})"
    
    params = [val] + req.chat_ids
    
    try:
        async with db_pool.execute(query, params) as cursor:
            pass
        await db_pool.commit()
        return {"status": "success", "updated": len(req.chat_ids)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sync/multiple")
async def sync_multiple(req: MultiChatRequest):
    task_ids = []
    if not req.chat_ids: return {"status": "No chats provided"}
    
    # 1. Look up all chat names at once
    placeholders = ",".join("?" for _ in req.chat_ids)
    query = f"SELECT chat_id, chat_name FROM chat_list WHERE chat_id IN ({placeholders})"
    async with db_pool.execute(query, req.chat_ids) as cursor:
        name_map = {r[0]: r[1] for r in await cursor.fetchall()}

    for cid in req.chat_ids:
        tid = queue_manager.add_task("sync-single", {
            "chat_id": cid,
            "chat_name": name_map.get(cid, str(cid)) # 2. Inject the name
        }, broadcast=False)
        if tid: task_ids.append(tid)

    await queue_manager._broadcast_state()
    return {"status": "Queued Multiple Syncs", "task_ids": task_ids}

@app.post("/api/download/multiple")
async def download_multiple(req: MultiChatRequest):
    task_ids = []
    if not req.chat_ids: return {"status": "No chats provided"}
    
    placeholders = ",".join("?" for _ in req.chat_ids)
    query = f"SELECT chat_id, chat_name FROM chat_list WHERE chat_id IN ({placeholders})"
    async with db_pool.execute(query, req.chat_ids) as cursor:
        name_map = {r[0]: r[1] for r in await cursor.fetchall()}

    for cid in req.chat_ids:
        tid = queue_manager.add_task("download-chat", {
            "chat_id": cid, 
            "chat_name": name_map.get(cid, str(cid)),
            "overwrite": req.overwrite, 
            "validate": req.validate_mode, 
            "resume": req.resume
        }, broadcast=False)
        if tid: task_ids.append(tid)

    await queue_manager._broadcast_state()
    return {"status": "Queued Multiple Downloads", "task_ids": task_ids}

@app.post("/api/sync")
async def trigger_sync():
    task_id = queue_manager.add_task("sync-all", {"chat_name": "Global Database"})
    return {"status": "Queued Sync All", "task_id": task_id}

@app.post("/api/sync/{chat_id}")
async def trigger_chat_sync(chat_id: int):
    async with db_pool.execute("SELECT chat_name FROM chat_list WHERE chat_id = ?", (chat_id,)) as cursor:
        row = await cursor.fetchone()
        chat_name = row[0] if row else str(chat_id)
        
    task_id = queue_manager.add_task("sync-single", {"chat_id": chat_id, "chat_name": chat_name})
    return {"status": "Queued Chat Sync", "task_id": task_id}

@app.post("/api/download/{chat_id}")
async def start_download(chat_id: int, overwrite: bool = False, validate: bool = False, resume: bool = True):
    async with db_pool.execute("SELECT chat_name FROM chat_list WHERE chat_id = ?", (chat_id,)) as cursor:
        row = await cursor.fetchone()
        chat_name = row[0] if row else str(chat_id)
        
    task_id = queue_manager.add_task("download-chat", {
        "chat_id": chat_id, "chat_name": chat_name, "overwrite": overwrite, "validate": validate, "resume": resume
    })
    return {"status": "Queued Download", "task_id": task_id}


@app.get("/api/chat/{chat_id}/files")
async def get_chat_files(chat_id: int):
    """Fetches all successfully downloaded files for a specific chat, categorized."""
    
    # Updated to match your exact SQLite schema
    query = """
        SELECT message_id, final_filename, original_filename, file_size, file_path, timestamp 
        FROM downloads 
        WHERE chat_id = ? AND status = 'success'
        ORDER BY message_id DESC
    """
    
    try:
        async with db_pool.execute(query, (chat_id,)) as cursor:
            rows = await cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
    categorized_files = {
        "videos": [],
        "images": [],
        "archives": [],
        "misc": [],
        "audio": []
    }
    
    for row in rows:
        # Unpack the row based on the new query order
        msg_id, final_name, orig_name, size, path, date_dl = row
        
        category = "misc"
        path_lower = path.lower() if path else ""
        
        # Standardize slashes for cross-platform checking
        normalized_path = path_lower.replace('\\', '/')
        if "/videos/" in normalized_path: category = "videos"
        elif "/images/" in normalized_path: category = "images"
        elif "/archives/" in normalized_path: category = "archives"
        elif "/audio/" in normalized_path: category = "audio"
        
        file_data = {
            "message_id": msg_id,
            "filename": final_name,
            "original_filename": orig_name,
            "size_bytes": size or 0,
            "file_path": path,
            "date_downloaded": date_dl,
            "category": category
        }
        
        categorized_files[category].append(file_data)
        
    return categorized_files

@app.post("/api/batch/start")
async def start_batch(overwrite: bool = False, validate: bool = False, resume: bool = True, sort: str = "default"):
    
    order_mapping = {
        "default": "ORDER BY defer ASC, total_messages ASC",
        "chat_id_asc": "ORDER BY chat_id ASC",
        "chat_id_desc": "ORDER BY chat_id DESC",
        "messages_asc": "ORDER BY total_messages ASC",
        "messages_desc": "ORDER BY total_messages DESC",
        "date_added_asc": "ORDER BY date_added ASC",
        "date_added_desc": "ORDER BY date_added DESC"
    }
    sql_order = order_mapping.get(sort, order_mapping["default"])
    
    query = f"SELECT chat_id, chat_name FROM chat_list WHERE is_batch = 1 AND enabled = 1 AND chat_status = 1 {sql_order}"
    
    async with db_pool.execute(query) as cursor:
        batch_targets = await cursor.fetchall()
        
    if not batch_targets:
        return {"status": "No valid chats marked for batch download.", "task_ids": []}

    batch_id = str(uuid.uuid4())
    total_chats = len(batch_targets)
    task_ids = []

    
    for i, row in enumerate(batch_targets, 1):
        chat_id, chat_name = row[0], row[1]
        tid = queue_manager.add_task("download-chat", {
            "chat_id": chat_id, 
            "chat_name": chat_name,
            "overwrite": overwrite, 
            "validate": validate, 
            "resume": resume,
            "batch_id": batch_id,
            "batch_index": i,
            "batch_total": total_chats
        }, broadcast=False)
        if tid: task_ids.append(tid)

    
    await queue_manager._broadcast_state()
    return {"status": "Queued Batch", "batch_id": batch_id, "task_ids": task_ids}

@app.delete("/api/queue/batch/{batch_id}")
async def kill_batch(batch_id: str):
    """Kills all tasks associated with a specific batch."""
    result = await queue_manager.kill_batch(batch_id)
    return result

@app.get("/api/queue")
async def get_queue():
    """Returns the current state of the Orchestrator."""
    return {
        "current_task": queue_manager.current_task,
        "queue": queue_manager.queue
    }

@app.delete("/api/queue/singles")
async def kill_all_singles():
    """Kills all standalone tasks."""
    result = await queue_manager.kill_all_singles()
    return result

@app.delete("/api/queue/{task_id}")
async def kill_task(task_id: str):
    """Kills an active task or removes it from the queue."""
    result = await queue_manager.kill_task(task_id)
    return result



@app.get("/api/status")
async def system_status():
    settings = await get_settings_dict(db_pool)
    setup_complete = bool(settings.get('api_id') and settings.get('api_hash'))
    
    return {
        "setup_complete": setup_complete,
        "client_connected": telegram_client.is_connected() if telegram_client else False,
        "active_ws_connections": len(manager.active_connections)
    }

@app.get("/api/settings")
async def get_current_settings():
    """Fetches current settings for the UI form."""
    return await get_settings_dict(db_pool)

@app.post("/api/settings")
async def save_settings(settings: SettingsUpdate):
    """Saves settings to the database using partial updates."""
    # exclude_unset=True ensures we only update fields that were actually sent in the JSON payload!
    settings_dict = settings.model_dump(exclude_unset=True) 
    
    for key, value in settings_dict.items():
        await update_setting(db_pool, key, value) 
    
    return {"status": "Settings saved successfully."}

@app.get("/api/history")
async def get_activity_history():
    """Fetches persistent session history."""
    async with db_pool.execute("SELECT timestamp, chat_id, stats FROM activity_history ORDER BY id ASC") as cursor:
        rows = await cursor.fetchall()
        history = []
        for r in rows:
            history.append({
                "time": r[0],
                "chat_id": r[1],
                "stats": json.loads(r[2]) if r[2] else {}
            })
        return history
        
if __name__ == "__main__":
    import uvicorn
    
    # Read the port and host from the .env file, fallback to defaults if missing
    app_port = int(os.getenv("WIREKEEPER_PORT", 39486))
    app_host = os.getenv("WIREKEEPER_HOST", "0.0.0.0")
    
    uvicorn.run("main:app", host=app_host, port=app_port, reload=True)