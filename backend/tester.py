import asyncio
import random
import time
import json
from datetime import datetime
from ws_manager import manager

# --- 1. MOCK SYNC OPERATIONS ---
async def sync_chatlist(client, conn):
    """Simulates a global sync with the 4 specific scenarios you requested."""
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
    """Simulates syncing a single chat."""
    await manager.broadcast({"event": "log", "message": f"[MOCK] Syncing chat ID {chat_id}..."})
    await asyncio.sleep(2)
    
    # Randomly pick one of the 4 scenarios
    outcomes = [
        "No updates found.",
        "Chat is dead or inaccessible.",
        "Found 15 new text messages. No media.",
        "Found 8 new media items."
    ]
    await manager.broadcast({"event": "log", "message": f"[MOCK SYNC RESULT] {random.choice(outcomes)}"})

# --- 2. MOCK WORKER (Simulates Progress Bars) ---
async def mock_worker(worker_type, file_list, chat_id, chat_name):
    """Fakes the progress of downloading files."""
    for i, file_data in enumerate(file_list):
        file_id = f"mock_{chat_id}_{file_data['id']}"
        total_size = file_data['size']
        
        # 1. Emit Task Start
        await manager.broadcast({
            "event": "task_start",
            "file_id": file_id,
            "filename": file_data['name'],
            "chat_id": chat_id,
            "queue_info": f"{worker_type} {i+1}/{len(file_list)} (Global: 200)"
        })
        
        downloaded = 0
        chunks = random.randint(8, 20) # Simulate how many UI updates this file takes
        chunk_size = total_size / chunks
        
        # 2. Emit Progress Chunks
        for _ in range(chunks):
            await asyncio.sleep(random.uniform(0.1, 0.4)) # Random delay between chunks
            downloaded += chunk_size
            if downloaded > total_size: downloaded = total_size
            
            # Simulate fluctuating internet speed (1MB/s to 10MB/s)
            mock_speed = random.randint(1_000_000, 10_000_000) 
            
            await manager.broadcast({
                "event": "progress", "file_id": file_id,
                "downloaded": downloaded, "total": total_size, "speed": mock_speed
            })
            
        # 3. Emit Completion (with a 5% chance to fail to test UI Error states)
        if random.random() < 0.05:
            await manager.broadcast({"event": "task_error", "file_id": file_id, "error": "Mock network timeout"})
        else:
            await manager.broadcast({"event": "task_complete", "file_id": file_id, "status": "success"})

# --- 3. MOCK CHAT DOWNLOAD (Simulates Scan & Queue Spawning) ---
async def process_chat_download(client, conn, chat_id, overwrite_mode=False, validate_mode=False, resume_mode=True):
    chat_name = f"Mock_Chat_{chat_id}"
    await manager.broadcast({"event": "log", "message": f"[MOCK] Starting download for {chat_name}"})
    
    # --- PHASE A: Simulate the Scanner ---
    await manager.broadcast({"event": "scan_start", "chat_name": chat_name, "chat_id": chat_id, "min_id": 0})
    
    total_msgs = random.randint(1500, 3000)
    for i in range(0, total_msgs, 500):
        await asyncio.sleep(0.5)
        await manager.broadcast({"event": "scan_progress", "chat_id": chat_id, "scanned": i})
        
    total_heavy = 150 # 150 heavy files
    total_light = 50  # 50 light files
    total_queued = total_heavy + total_light
    
    await manager.broadcast({
        "event": "scan_complete", "chat_id": chat_id,
        "scanned": total_msgs, "queued": total_queued
    })
    
    # --- PHASE B: Prepare Fake Files ---
    heavy_files = [{"id": f"h{i}", "name": f"mock_video_file_{i}.mp4", "size": random.randint(50_000_000, 500_000_000)} for i in range(total_heavy)]
    light_files = [{"id": f"l{i}", "name": f"mock_image_file_{i}.jpg", "size": random.randint(500_000, 5_000_000)} for i in range(total_light)]
    
    # --- PHASE C: Spawn Concurrent Workers (3 Heavy, 2 Light) ---
    tasks = []
    
    # Split heavy files into 3 parallel queues
    h_chunks = [heavy_files[i::3] for i in range(3)]
    for chunk in h_chunks:
        if chunk: tasks.append(asyncio.create_task(mock_worker("heavy", chunk, chat_id, chat_name)))
        
    # Split light files into 2 parallel queues
    l_chunks = [light_files[i::2] for i in range(2)]
    for chunk in l_chunks:
        if chunk: tasks.append(asyncio.create_task(mock_worker("light", chunk, chat_id, chat_name)))
        
    # Wait for all mock workers to finish downloading
    await asyncio.gather(*tasks)
    
    # --- PHASE D: Final Stats ---
    stats = {
        'total_files_found': total_queued, 
        'total_messages_scanned': total_msgs,
        'successful_downloads': int(total_queued * 0.95), 
        'skipped_downloads': 0, 
        'failed_downloads': int(total_queued * 0.05), 
        'new_text_messages': 0
    }

    time_str = datetime.now().strftime("%I:%M:%S %p")
    await conn.execute("INSERT INTO activity_history (timestamp, chat_id, stats) VALUES (?, ?, ?)", (time_str, chat_id, json.dumps(stats)))
    await conn.commit()
    
    await manager.broadcast({"event": "chat_complete", "chat_id": chat_id, "stats": stats})
    return stats