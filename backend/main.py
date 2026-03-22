import asyncio
import json
import os

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

# Pydantic model for validating incoming settings from React
class SettingsUpdate(BaseModel):
    api_id: str
    api_hash: str
    session_name: str
    download_path: str
    alt_download_path: str
    max_concurrent_heavy: str
    max_concurrent_light: str

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

@app.post("/api/sync")
async def trigger_sync():
    task_id = queue_manager.add_task("sync-all", {})
    return {"status": "Queued Sync All", "task_id": task_id}

@app.post("/api/sync/{chat_id}")
async def trigger_chat_sync(chat_id: int):
    task_id = queue_manager.add_task("sync-single", {"chat_id": chat_id})
    return {"status": "Queued Chat Sync", "task_id": task_id}

@app.post("/api/download/{chat_id}")
async def start_download(chat_id: int, overwrite: bool = False, validate: bool = False, resume: bool = True):
    task_id = queue_manager.add_task("download-chat", {
        "chat_id": chat_id, "overwrite": overwrite, "validate": validate, "resume": resume
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
    task_id = queue_manager.add_task("batch-download", {
        "overwrite": overwrite, "validate": validate, "resume": resume, "sort": sort
    })
    return {"status": "Queued Batch", "task_id": task_id}

@app.get("/api/queue")
async def get_queue():
    """Returns the current state of the Orchestrator."""
    return {
        "current_task": queue_manager.current_task,
        "queue": queue_manager.queue
    }

@app.delete("/api/queue/{task_id}")
async def kill_task(task_id: str):
    """Kills an active task or removes it from the queue."""
    result = await queue_manager.kill_task(task_id)
    return result

@app.post("/api/sync/multiple")
async def sync_multiple(req: MultiChatRequest):
    """Accepts an ordered array of chat IDs and queues them for syncing individually."""
    task_ids = []
    for cid in req.chat_ids:
        tid = queue_manager.add_task("sync-single", {"chat_id": cid})
        task_ids.append(tid)
    return {"status": "Queued Multiple Syncs", "task_ids": task_ids}

@app.post("/api/download/multiple")
async def download_multiple(req: MultiChatRequest):
    """Accepts an ordered array of chat IDs and queues them for downloading sequentially."""
    task_ids = []
    for cid in req.chat_ids:
        tid = queue_manager.add_task("download-chat", {
            "chat_id": cid, 
            "overwrite": req.overwrite, 
            "validate": req.validate_mode, 
            "resume": req.resume
        })
        task_ids.append(tid)
    return {"status": "Queued Multiple Downloads", "task_ids": task_ids}

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
    """Saves settings to the database."""
    settings_dict = settings.model_dump()
    
    for key, value in settings_dict.items():
        await update_setting(db_pool, key, value) 
    
    return {"status": "Settings saved successfully. Restart required for API keys."}

if __name__ == "__main__":
    import uvicorn
    
    # Read the port and host from the .env file, fallback to defaults if missing
    app_port = int(os.getenv("WIREKEEPER_PORT", 39486))
    app_host = os.getenv("WIREKEEPER_HOST", "0.0.0.0")
    
    uvicorn.run("main:app", host=app_host, port=app_port, reload=True)