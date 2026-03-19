import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from telethon import TelegramClient
from telethon.network import ConnectionTcpAbridged

from database import init_db, get_settings_dict
from ws_manager import manager
from downloader import process_chat_download, sync_chatlist, process_batch_download

telegram_client = None
db_pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global telegram_client, db_pool
    
    db_pool = await init_db()
    
    settings = await get_settings_dict(db_pool)
    
    api_id = settings.get('api_id')
    api_hash = settings.get('api_hash')
    session_name = settings.get('session_name', 'wirekeeper_session')
    
    if api_id and api_hash:
        try:
            telegram_client = TelegramClient(session_name, int(api_id), api_hash, connection=ConnectionTcpAbridged)
            await telegram_client.start()
            print("WireKeeper Engine Started Successfully.")
        except Exception as e:
            print(f"Failed to start Telegram Client: {e}")
            telegram_client = None
    else:
        print("WireKeeper Setup Required: API keys missing from database.")
    
    yield
    
    if telegram_client:
        await telegram_client.disconnect()
    await db_pool.close()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (perfect for local homelab testing)
    allow_credentials=True,
    allow_methods=["*"],  # Allows POST, GET, OPTIONS, etc.
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
    """Returns the comprehensive list of configured chats from the database."""
    query = """
        SELECT 
            chat_id, chat_name, chat_type, total_messages, is_batch,
            old_name, last_download_scan, last_message_id, topics, topics_exclude, 
            last_archived, total_downloaded
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

            result.append({
                "chat_id": r[0], 
                "name": r[1], 
                "type": r[2], 
                "total_messages": r[3], 
                "is_batch": bool(r[4]),
                "old_name": r[5],
                "last_scan": r[6],            
                "last_message": r[7],         
                "topics": topics_data,        
                "topics_exclude": topics_exclude_data, 
                "last_archived": r[10],
                "total_downloaded": r[11] or 0
            })
            
        return result
        
@app.post("/api/sync")
async def trigger_sync(background_tasks: BackgroundTasks):
    """Triggers a database sync of Telegram dialogs."""
    if not telegram_client:
        raise HTTPException(status_code=400, detail="Telegram client is not connected. Please complete setup.")
        
    background_tasks.add_task(sync_chatlist, telegram_client, db_pool)
    return {"status": "Sync initiated"}

@app.post("/api/download/{chat_id}")
async def start_download(
    chat_id: int, 
    background_tasks: BackgroundTasks,
    overwrite: bool = Query(False, description="Overwrite existing files"),
    validate: bool = Query(False, description="Rescan chat from beginning (min_id=0)"),
    resume: bool = Query(True, description="Resume incomplete .part files")
):
    """Triggers a download job for a specific chat."""
    if not telegram_client:
        raise HTTPException(status_code=400, detail="Telegram client is not connected. Please complete setup.")
        
    background_tasks.add_task(
        process_chat_download, 
        telegram_client, 
        db_pool, 
        chat_id,
        overwrite,
        validate,
        resume
    )
    return {
        "status": "Download initiated", 
        "chat_id": chat_id, 
        "options": {"overwrite": overwrite, "validate": validate, "resume": resume}
    }

@app.post("/api/batch/start")
async def start_batch(
    background_tasks: BackgroundTasks,
    overwrite: bool = Query(False),
    validate: bool = Query(False),
    resume: bool = Query(True),
    sort: str = Query("default", description="Sort order: default, chat_id_asc, chat_id_desc, messages_asc, messages_desc, date_added_asc, date_added_desc")
):
    """Starts the sequential batch download process for flagged chats."""
    if not telegram_client:
        raise HTTPException(status_code=400, detail="Telegram client is not connected. Please complete setup.")
        
    background_tasks.add_task(
        process_batch_download,
        telegram_client,
        db_pool,
        overwrite,
        validate,
        resume,
        sort
    )
    return {"status": "Batch process initiated", "sort_order": sort}

@app.get("/api/status")
async def system_status():
    settings = await get_settings_dict(db_pool)
    setup_complete = bool(settings.get('api_id') and settings.get('api_hash'))
    
    return {
        "setup_complete": setup_complete,
        "client_connected": telegram_client.is_connected() if telegram_client else False,
        "active_ws_connections": len(manager.active_connections)
    }

if __name__ == "__main__":
    import uvicorn
    import os

    app_port = int(os.getenv("WIREKEEPER_PORT", 39486))
    app_host = os.getenv("WIREKEEPER_HOST", "0.0.0.0")

    uvicorn.run("main:app", host=app_host, port=app_port, reload=True)