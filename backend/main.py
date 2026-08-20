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
    active_profile: Optional[str] = None
    profile_1_api_id: Optional[str] = None
    profile_1_api_hash: Optional[str] = None
    profile_1_session_name: Optional[str] = None
    profile_2_api_id: Optional[str] = None
    profile_2_api_hash: Optional[str] = None
    profile_2_session_name: Optional[str] = None
    
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

# --- NEW: Safe API ID Fetcher for DB Scoping ---
async def get_active_api_id():
    settings = await get_settings_dict(db_pool)
    active_prof = settings.get('active_profile', '1')
    return settings.get(f'profile_{active_prof}_api_id')

async def startup_telethon(db):
    global telegram_client
    settings = await get_settings_dict(db)
    
    active_prof = settings.get('active_profile', '1')
    api_id = settings.get(f'profile_{active_prof}_api_id')
    api_hash = settings.get(f'profile_{active_prof}_api_hash')
    session_name = settings.get(f'profile_{active_prof}_session_name', f'wirekeeper_session_{active_prof}')
    
    if api_id and api_hash:
        try:
            telegram_client = TelegramClient(session_name, int(api_id), api_hash, connection=ConnectionTcpAbridged)
            await telegram_client.start()
            print(f"WireKeeper Engine Started Successfully (Active Profile: {active_prof}).")
            queue_manager.initialize(telegram_client, db)
            return True
        except Exception as e:
            print(f"Failed to start Telegram Client for Profile {active_prof}: {e}")
            telegram_client = None
            return False
    return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    global telegram_client, db_pool
    db_pool = await init_db()
    
    await db_pool.execute('''
        CREATE TABLE IF NOT EXISTS activity_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_id TEXT,
            timestamp TEXT,
            chat_id INTEGER,
            stats TEXT
        )
    ''')
    
    await db_pool.execute('''
        CREATE TABLE IF NOT EXISTS archivings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_id TEXT,
            chat_id INTEGER,
            chat_name TEXT,
            files_moved INTEGER,
            status TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            details TEXT
        )
    ''')
    
    await db_pool.commit()
    
    await startup_telethon(db_pool)
    asyncio.create_task(queue_manager.worker_loop())
    yield
    
    if telegram_client: await telegram_client.disconnect()
    await db_pool.close()

app = FastAPI(lifespan=lifespan)

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

@app.post("/api/account/switch/{profile_id}")
async def switch_profile(profile_id: str):
    global telegram_client
    if profile_id not in ["1", "2"]:
        raise HTTPException(status_code=400, detail="Invalid profile ID")

    await manager.broadcast({"event": "log", "message": f"Switching to Profile {profile_id}..."})

    await queue_manager.wipe_all()

    if telegram_client and telegram_client.is_connected():
        await telegram_client.disconnect()

    await update_setting(db_pool, 'active_profile', profile_id)

    success = await startup_telethon(db_pool)
    
    status_msg = f"Profile {profile_id} active and connected." if success else f"Profile {profile_id} active (Needs setup)."
    await manager.broadcast({"event": "log", "message": status_msg})
    
    if success:
        queue_manager.add_task("sync-all", {"chat_name": f"Profile {profile_id} Auto-Sync"})
    
    return {"status": "Profile switched", "connected": success}

@app.get("/api/chats")
async def get_chats():
    api_id = await get_active_api_id()
    if not api_id: return []
    
    query = """
        SELECT 
            chat_id, chat_name, chat_type, total_messages, is_batch,
            old_name, last_download_scan, last_message_id, topics, topics_exclude, 
            last_archived, total_downloaded, enabled, hidden, defer, total_size, last_download, date_updated, chat_status
        FROM chat_list
        WHERE api_id = ?
    """
    async with db_pool.execute(query, (api_id,)) as cursor:
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

@app.post("/api/chats/toggle")
async def toggle_chat_flags(req: ToggleRequest):
    allowed_fields = {"is_batch", "defer", "enabled", "hidden"}
    if req.field not in allowed_fields:
        raise HTTPException(status_code=400, detail="Invalid field")

    api_id = await get_active_api_id()
    val = 1 if req.value else 0
    placeholders = ",".join("?" for _ in req.chat_ids)
    query = f"UPDATE chat_list SET {req.field} = ? WHERE api_id = ? AND chat_id IN ({placeholders})"
    
    params = [val, api_id] + req.chat_ids
    
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
    
    api_id = await get_active_api_id()
    placeholders = ",".join("?" for _ in req.chat_ids)
    query = f"SELECT chat_id, chat_name FROM chat_list WHERE api_id = ? AND chat_id IN ({placeholders})"
    async with db_pool.execute(query, [api_id] + req.chat_ids) as cursor:
        name_map = {r[0]: r[1] for r in await cursor.fetchall()}

    for cid in req.chat_ids:
        tid = queue_manager.add_task("sync-single", {
            "chat_id": cid,
            "chat_name": name_map.get(cid, str(cid)) 
        }, broadcast=False)
        if tid: task_ids.append(tid)

    await queue_manager._broadcast_state()
    return {"status": "Queued Multiple Syncs", "task_ids": task_ids}

@app.post("/api/download/multiple")
async def download_multiple(req: MultiChatRequest):
    task_ids = []
    if not req.chat_ids: return {"status": "No chats provided"}
    
    api_id = await get_active_api_id()
    placeholders = ",".join("?" for _ in req.chat_ids)
    query = f"SELECT chat_id, chat_name FROM chat_list WHERE api_id = ? AND chat_id IN ({placeholders})"
    async with db_pool.execute(query, [api_id] + req.chat_ids) as cursor:
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
    api_id = await get_active_api_id()
    async with db_pool.execute("SELECT chat_name FROM chat_list WHERE api_id = ? AND chat_id = ?", (api_id, chat_id)) as cursor:
        row = await cursor.fetchone()
        chat_name = row[0] if row else str(chat_id)
        
    task_id = queue_manager.add_task("sync-single", {"chat_id": chat_id, "chat_name": chat_name})
    return {"status": "Queued Chat Sync", "task_id": task_id}

@app.post("/api/download/{chat_id}")
async def start_download(chat_id: int, overwrite: bool = False, validate: bool = False, resume: bool = True):
    api_id = await get_active_api_id()
    async with db_pool.execute("SELECT chat_name FROM chat_list WHERE api_id = ? AND chat_id = ?", (api_id, chat_id)) as cursor:
        row = await cursor.fetchone()
        chat_name = row[0] if row else str(chat_id)
        
    task_id = queue_manager.add_task("download-chat", {
        "chat_id": chat_id, "chat_name": chat_name, "overwrite": overwrite, "validate": validate, "resume": resume
    })
    return {"status": "Queued Download", "task_id": task_id}

@app.get("/api/chat/{chat_id}/files")
async def get_chat_files(chat_id: int):
    api_id = await get_active_api_id()
    query = """
        SELECT message_id, final_filename, original_filename, file_size, file_path, timestamp 
        FROM downloads 
        WHERE api_id = ? AND chat_id = ? AND status = 'success'
        ORDER BY message_id DESC
    """
    
    try:
        async with db_pool.execute(query, (api_id, chat_id)) as cursor:
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
        msg_id, final_name, orig_name, size, path, date_dl = row
        
        category = "misc"
        path_lower = path.lower() if path else ""
        
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
    api_id = await get_active_api_id()
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
    
    query = f"SELECT chat_id, chat_name FROM chat_list WHERE api_id = ? AND is_batch = 1 AND enabled = 1 AND chat_status = 1 {sql_order}"
    
    async with db_pool.execute(query, (api_id,)) as cursor:
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
    result = await queue_manager.kill_batch(batch_id)
    return result

@app.get("/api/queue")
async def get_queue():
    return {
        "current_task": queue_manager.current_task,
        "queue": queue_manager.queue
    }

@app.delete("/api/queue/singles")
async def kill_all_singles():
    result = await queue_manager.kill_all_singles()
    return result

@app.delete("/api/queue/{task_id}")
async def kill_task(task_id: str):
    result = await queue_manager.kill_task(task_id)
    return result

@app.get("/api/status")
async def system_status():
    settings = await get_settings_dict(db_pool)
    active_prof = settings.get('active_profile', '1')
    setup_complete = bool(settings.get(f'profile_{active_prof}_api_id') and settings.get(f'profile_{active_prof}_api_hash'))
    
    return {
        "setup_complete": setup_complete,
        "active_profile": active_prof,
        "client_connected": telegram_client.is_connected() if telegram_client else False,
        "active_ws_connections": len(manager.active_connections)
    }

@app.get("/api/settings")
async def get_current_settings():
    return await get_settings_dict(db_pool)

@app.post("/api/settings")
async def save_settings(settings: SettingsUpdate):
    settings_dict = settings.model_dump(exclude_unset=True) 
    for key, value in settings_dict.items():
        await update_setting(db_pool, key, value) 
    
    return {"status": "Settings saved successfully."}

@app.get("/api/history")
async def get_activity_history():
    api_id = await get_active_api_id()
    async with db_pool.execute("SELECT timestamp, chat_id, stats FROM activity_history WHERE api_id = ? ORDER BY id ASC", (api_id,)) as cursor:
        rows = await cursor.fetchall()
        history = []
        for r in rows:
            history.append({
                "time": r[0],
                "chat_id": r[1],
                "stats": json.loads(r[2]) if r[2] else {}
            })
        return history

@app.delete("/api/history")
async def clear_activity_history():
    api_id = await get_active_api_id()
    await db_pool.execute("DELETE FROM activity_history WHERE api_id = ?", (api_id,))
    await db_pool.commit()
    return {"status": "History cleared."}
    
if __name__ == "__main__":
    import uvicorn
    app_port = int(os.getenv("WIREKEEPER_PORT", 39486))
    app_host = os.getenv("WIREKEEPER_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=app_host, port=app_port, reload=True)