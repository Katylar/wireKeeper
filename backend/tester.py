import asyncio
import random
import time
import json
from datetime import datetime
from ws_manager import manager

async def sync_chatlist(client, conn):
    await manager.broadcast({"event": "log", "message": "[MOCK] Starting Global Sync..."})
    await asyncio.sleep(1)
    scenarios = [
        "[Alive, No Updates] Chat 'Meme Stash' checked. No new messages.",
        "[Dead Chat] Chat 'Old Crypto Group' is no longer accessible. Marked as dead.",
        "[Updates, No Media] Chat 'Family Group' has 45 new text messages. Saved to history.",
        "[Updates, With Media] Chat 'Movie Archive' has 12 new messages. 4 new media files found."
    ]
    for s in scenarios:
        await asyncio.sleep(1.5)
        await manager.broadcast({"event": "log", "message": f"[MOCK SYNC] {s}"})
    await manager.broadcast({"event": "log", "message": "[MOCK] Global Sync Complete."})

async def sync_single_chat(client, conn, chat_id):
    await manager.broadcast({"event": "log", "message": f"[MOCK] Syncing chat ID {chat_id}..."})
    await asyncio.sleep(2)
    outcomes = ["No updates found.", "Chat is dead or inaccessible.", "Found 15 new text messages. No media.", "Found 8 new media items."]
    await manager.broadcast({"event": "log", "message": f"[MOCK SYNC RESULT] {random.choice(outcomes)}"})

async def mock_worker(worker_type, file_list, chat_id, chat_name, stats, file_category):
    for i, file_data in enumerate(file_list):
        file_id = f"mock_{chat_id}_{file_data['id']}"
        total_size = file_data['size']
        
        await manager.broadcast({
            "event": "task_start", "file_id": file_id, "filename": file_data['name'], "chat_id": chat_id,
            "queue_info": f"{worker_type} {i+1}/{len(file_list)}"
        })
        
        downloaded = 0
        chunks = random.randint(8, 20) 
        chunk_size = total_size / chunks
        
        for _ in range(chunks):
            await asyncio.sleep(random.uniform(0.1, 0.4)) 
            downloaded += chunk_size
            if downloaded > total_size: downloaded = total_size
            mock_speed = random.randint(1_000_000, 10_000_000) 
            await manager.broadcast({
                "event": "progress", "file_id": file_id,
                "downloaded": downloaded, "total": total_size, "speed": mock_speed
            })
            
        if random.random() < 0.05:
            stats['failed_downloads'] += 1
            stats['categories'][file_category]['failed'] += 1
            await manager.broadcast({"event": "task_error", "file_id": file_id, "error": "Mock network timeout"})
        else:
            stats['successful_downloads'] += 1
            stats['categories'][file_category]['success'] += 1
            await manager.broadcast({"event": "task_complete", "file_id": file_id, "status": "success"})

async def process_chat_download(client, conn, chat_id, overwrite_mode=False, validate_mode=False, resume_mode=True):
    start_time_dt = datetime.now()
    start_time_sec = time.time()
    task_status = "completed"
    
    stats = {
        'total_files_found': 0, 'total_messages_scanned': 0, 'total_queued': 0,
        'successful_downloads': 0, 'skipped_downloads': 0, 'failed_downloads': 0,
        'new_text_messages': 0,
        'categories': {
            'images': {'success': 0, 'failed': 0, 'skipped': 0, 'enqueued': 0},
            'videos': {'success': 0, 'failed': 0, 'skipped': 0, 'enqueued': 0},
            'audio': {'success': 0, 'failed': 0, 'skipped': 0, 'enqueued': 0},
            'archives': {'success': 0, 'failed': 0, 'skipped': 0, 'enqueued': 0},
            'misc': {'success': 0, 'failed': 0, 'skipped': 0, 'enqueued': 0}
        }
    }

    try:
        chat_name = f"Mock_Chat_{chat_id}"
        await manager.broadcast({"event": "log", "message": f"[MOCK] Starting download for {chat_name}"})
        await manager.broadcast({"event": "scan_start", "chat_name": chat_name, "chat_id": chat_id, "min_id": 0})
        
        total_msgs = random.randint(1500, 3000)
        for i in range(0, total_msgs, 500):
            await asyncio.sleep(0.5)
            await manager.broadcast({"event": "scan_progress", "chat_id": chat_id, "scanned": i})
            
        total_heavy = 30
        total_light = 15
        total_queued = total_heavy + total_light
        
        stats['total_messages_scanned'] = total_msgs
        stats['total_files_found'] = total_queued
        stats['total_queued'] = total_queued
        stats['categories']['videos']['enqueued'] = total_heavy
        stats['categories']['images']['enqueued'] = total_light
        
        await manager.broadcast({
            "event": "scan_complete", "chat_id": chat_id, "scanned": total_msgs, "queued": total_queued
        })
        
        heavy_files = [{"id": f"h{i}", "name": f"mock_video_file_{i}.mp4", "size": random.randint(50_000_000, 500_000_000)} for i in range(total_heavy)]
        light_files = [{"id": f"l{i}", "name": f"mock_image_file_{i}.jpg", "size": random.randint(500_000, 5_000_000)} for i in range(total_light)]
        
        tasks = []
        h_chunks = [heavy_files[i::3] for i in range(3)]
        for chunk in h_chunks:
            if chunk: tasks.append(asyncio.create_task(mock_worker("heavy", chunk, chat_id, chat_name, stats, 'videos')))
            
        l_chunks = [light_files[i::2] for i in range(2)]
        for chunk in l_chunks:
            if chunk: tasks.append(asyncio.create_task(mock_worker("light", chunk, chat_id, chat_name, stats, 'images')))
            
        await asyncio.gather(*tasks)

    except asyncio.CancelledError:
        task_status = "killed"
        raise
    except Exception as e:
        task_status = "error"
        raise
    finally:
        end_time_dt = datetime.now()
        elapsed = time.time() - start_time_sec
        
        history_data = {
            "status": task_status,
            "start_time": start_time_dt.strftime("%Y-%m-%d %I:%M:%S %p"),
            "end_time": end_time_dt.strftime("%Y-%m-%d %I:%M:%S %p"),
            "elapsed_seconds": round(elapsed, 2),
            "total_messages": total_msgs if 'total_msgs' in locals() else 0,
            "last_message_id": 99999,
            "total_enqueued": stats['total_queued'],
            "breakdown": stats
        }
        
        time_str = end_time_dt.strftime("%I:%M:%S %p")
        try:
            await conn.execute("INSERT INTO activity_history (timestamp, chat_id, stats) VALUES (?, ?, ?)", (time_str, chat_id, json.dumps(history_data)))
            await conn.commit()
        except Exception: pass
        
        await manager.broadcast({
            "event": "chat_complete", "chat_id": chat_id, "stats": history_data
        })