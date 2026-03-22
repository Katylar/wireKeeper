import os
import time
import json
import asyncio
from datetime import datetime
from telethon import utils, errors
from telethon.tl.types import Chat, Channel, MessageMediaGeo, MessageMediaContact, MessageMediaPoll, MessageMediaUnsupported
from telethon.tl.functions.channels import GetForumTopicsRequest
from config import SAFE_RESUME_REWIND
from database import get_last_message_id, db_get_topic_exclusions, update_cursor, db_check_existing, db_update_status, db_get_incomplete, update_total_downloaded, get_settings_dict
from utils import normalize_name, generate_filename, get_file_category, get_msg_file_size, check_file_size_integrity, get_message_topic_id, get_dir_size
from ws_manager import manager

SYSTEM_PAUSED = False 
last_total_speed = 0
consecutive_no_gain = 0
last_spawn_time = 0

def should_spawn_smart(active_list, max_limit, speed_threshold_bytes):
    global last_total_speed, consecutive_no_gain, last_spawn_time, SYSTEM_PAUSED
    if SYSTEM_PAUSED: return False 
    if len(active_list) >= max_limit: return False
    if len(active_list) == 0:
        last_spawn_time = time.time()
        return True
    
    stabilization_time = 20 
    if (time.time() - last_spawn_time) < stabilization_time: return False

    current_total_speed = sum(s.current_speed for t, s in active_list)
    gain = current_total_speed - last_total_speed
    
    if gain < speed_threshold_bytes: consecutive_no_gain += 1
    else: consecutive_no_gain = 0
        
    last_total_speed = current_total_speed
    if consecutive_no_gain >= 2: return False

    last_spawn_time = time.time()
    return True

class WorkerStatus:
    def __init__(self, w_type="heavy"):
        self.start_time = time.time()
        self.current_speed = 0  
        self.downloaded_bytes = 0
        self.type = w_type 

async def download_worker(client, conn, queue, stats, overwrite_mode, resume_mode, worker_status, app_settings):
    global SYSTEM_PAUSED 
    max_retries = int(app_settings.get('max_retries', 3))
    
    try:
        item = await queue.get()
    except asyncio.CancelledError:
        return

    message_obj, initial_path, unique_id, chat_id, message_id, original_name, initial_final_name, expected_size, alt_path, idx_info = item
    q_type, q_curr, q_total, g_total = idx_info
    topic_id = get_message_topic_id(message_obj)
    
    final_path = initial_path
    current_filename = initial_final_name
    part_path = f"{initial_path}.{message_id}.part" 

    if os.path.exists(final_path):
        is_valid, _ = check_file_size_integrity(final_path, expected_size, current_filename)
        if is_valid and not overwrite_mode:
            await db_update_status(conn, unique_id, chat_id, message_id, 'success', final_path, original_name, current_filename, expected_size, topic_id)
            stats['successful_downloads'] += 1
            queue.task_done()
            return
        elif overwrite_mode:
            try: os.remove(final_path)
            except OSError: pass

    if alt_path and os.path.exists(alt_path) and not overwrite_mode:
        is_valid_alt, _ = check_file_size_integrity(alt_path, expected_size, current_filename)
        if is_valid_alt:
            await db_update_status(conn, unique_id, chat_id, message_id, 'success', alt_path, original_name, current_filename, expected_size, topic_id)
            stats['successful_downloads'] += 1
            queue.task_done()
            return

    await manager.broadcast({
        "event": "task_start", 
        "file_id": unique_id, 
        "filename": current_filename, 
        "chat_id": chat_id,
        "queue_info": f"{q_type} {q_curr}/{q_total} (Global: {g_total})"
    })

    offset = 0
    should_resume = False
    if os.path.exists(part_path):
        if resume_mode:
            current_part_size = os.path.getsize(part_path)
            if expected_size and current_part_size < expected_size:
                should_resume = True
                offset = max(0, current_part_size - SAFE_RESUME_REWIND)
            else:
                try: os.remove(part_path)
                except: pass
        else:
            try: os.remove(part_path)
            except: pass

    current_message = message_obj 
    
    for attempt in range(1, max_retries + 1):
        try:
            if SYSTEM_PAUSED:
                await asyncio.sleep(5)
                continue

            worker_status.start_time = time.time()
            
            async def progress_callback(current, total):
                elapsed = time.time() - worker_status.start_time
                if elapsed > 1: worker_status.current_speed = current / elapsed
                await manager.broadcast({
                    "event": "progress",
                    "file_id": unique_id,
                    "downloaded": current,
                    "total": total,
                    "speed": worker_status.current_speed
                })

            if should_resume:
                with open(part_path, 'r+b') as f:
                    f.seek(offset); f.truncate()
                    async for chunk in client.iter_download(current_message, offset=offset, chunk_size=512*1024):
                        f.write(chunk)
                        offset += len(chunk)
                        await progress_callback(offset, expected_size)
            else:
                with open(part_path, 'wb') as f:
                     await client.download_media(current_message, file=f, progress_callback=progress_callback)

            if os.path.exists(final_path):
                name, ext = os.path.splitext(initial_final_name)
                current_filename = f"{name}_{message_id}{ext}"
                final_path = os.path.join(os.path.dirname(initial_path), current_filename)

            rename_success = False
            for _ in range(3):
                try:
                    if os.path.exists(final_path): os.remove(final_path) 
                    os.rename(part_path, final_path)
                    rename_success = True; break
                except OSError: await asyncio.sleep(1)
            
            if not rename_success: raise OSError("Failed to rename file after download")

            is_valid, reason = check_file_size_integrity(final_path, expected_size, current_filename)
            if not is_valid:
                  try: os.remove(final_path) 
                  except: pass
                  raise Exception(f"Integrity check failed: {reason}")
            
            await db_update_status(conn, unique_id, chat_id, message_id, 'success', final_path, original_name, current_filename, expected_size, topic_id)
            stats['successful_downloads'] += 1

            await conn.execute("UPDATE chat_list SET last_download = CURRENT_TIMESTAMP WHERE chat_id = ?", (chat_id,))
            await conn.commit()

            await manager.broadcast({"event": "task_complete", "file_id": unique_id, "status": "success"})
            
            if SYSTEM_PAUSED: 
                SYSTEM_PAUSED = False
                await manager.broadcast({"event": "log", "message": "Network recovered. Resuming spawner."})
            break 

        except errors.FileReferenceExpiredError:
            await manager.broadcast({"event": "log", "message": f"Ref expired for {current_filename}. Refreshing..."})
            await asyncio.sleep(2)
            try:
                refreshed = await client.get_messages(chat_id, ids=message_id)
                if refreshed: current_message = refreshed
                else: raise Exception("Could not refresh message reference")
            except: pass
            continue
        except (errors.FloodWaitError, Exception) as e:
            err_str = str(e).lower()
            if any(x in err_str for x in ["429", "flood", "invalid response buffer", "disconnected"]):
                SYSTEM_PAUSED = True
                wait_time = getattr(e, 'seconds', 60) * attempt 
                await manager.broadcast({"event": "error", "message": f"Network Throttle. Pausing system for {wait_time}s."})
                await db_update_status(conn, unique_id, chat_id, message_id, 'queued', topic_id=topic_id)
                await asyncio.sleep(wait_time)
                if attempt < max_retries: continue

            if attempt == max_retries:
                await db_update_status(conn, unique_id, chat_id, message_id, 'failed', topic_id=topic_id)
                stats['failed_downloads'] += 1
                await manager.broadcast({"event": "task_error", "file_id": unique_id, "error": str(e)})
                if not resume_mode and os.path.exists(part_path):
                    try: os.remove(part_path)
                    except: pass
            else: await asyncio.sleep(1)

    queue.task_done()

async def execute_rename_logic(conn, chat_id, db_chat_name, new_chat_title, app_settings):
    """Handles folder renaming and DB path updates when a chat title changes."""
    norm_old = normalize_name(db_chat_name)
    norm_new = normalize_name(new_chat_title)
    
    # If the normalized names are identical, no file system changes are needed
    if norm_old == norm_new:
        return

    old_folder = f"[{chat_id}]_{norm_old}"
    new_folder = f"[{chat_id}]_{norm_new}"
    
    downloads_dir = app_settings.get('download_path', 'downloads')
    alt_downloads_dir = app_settings.get('alt_download_path', '')

    old_primary_path = os.path.join(downloads_dir, old_folder)
    new_primary_path = os.path.join(downloads_dir, new_folder)
    
    # 1. Rename primary directory
    if os.path.exists(old_primary_path):
        try:
            os.rename(old_primary_path, new_primary_path)
            await manager.broadcast({"event": "log", "message": f"Renamed folder: {old_folder} -> {new_folder}"})
        except OSError as e:
            await manager.broadcast({"event": "error", "message": f"Failed to rename primary folder {old_folder}: {e}"})

    # 2. Rename alternate directory (if it exists)
    if alt_downloads_dir and os.path.exists(alt_downloads_dir):
        old_alt_path = os.path.join(alt_downloads_dir, old_folder)
        new_alt_path = os.path.join(alt_downloads_dir, new_folder)
        if os.path.exists(old_alt_path):
            try:
                os.rename(old_alt_path, new_alt_path)
            except OSError as e:
                await manager.broadcast({"event": "error", "message": f"Failed to rename alt folder {old_folder}: {e}"})

    # 3. Fast SQL Replace for all paths in the downloads table
    try:
        # Cross-platform replace for forward and backward slashes
        query = """
            UPDATE downloads 
            SET file_path = REPLACE(
                REPLACE(file_path, '\\' || ?, '\\' || ?), 
                '/' || ?, '/' || ?
            )
            WHERE chat_id = ?
        """
        await conn.execute(query, (old_folder, new_folder, old_folder, new_folder, chat_id))
        await conn.commit()
    except Exception as e:
        await manager.broadcast({"event": "error", "message": f"Failed to update database paths for rename: {e}"})

async def sync_chatlist(client, conn):
    await manager.broadcast({"event": "log", "message": "Processing chat list (Syncing with DB)..."})
    
    app_settings = await get_settings_dict(conn)
    db_chats = {}
    try:
        async with conn.execute("SELECT chat_id, chat_name, date_added, old_name, is_batch, last_message_id, total_downloaded FROM chat_list") as cursor:
            rows = await cursor.fetchall()
            for row in rows: 
                db_chats[row[0]] = {
                    "chat_name": row[1], "date_added": row[2], "old_name": row[3], 
                    "is_batch": row[4], "last_message_id": row[5] or 0, "total_downloaded": row[6] or 0
                }
    except: pass

    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    seen_chat_ids = set()
    
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        chat_id = entity.id
        seen_chat_ids.add(chat_id)
        current_name = utils.get_display_name(entity)
        
        c_type = "Group" if isinstance(entity, Chat) else "Channel" if isinstance(entity, Channel) else "Private"
        
        try: total_messages = (await client.get_messages(entity, limit=0)).total
        except: total_messages = 0

        topics_json = None
        if getattr(entity, 'forum', False):
            try:
                topics_list = []
                result = await client(GetForumTopicsRequest(channel=entity, offset_date=None, offset_id=0, offset_topic=0, limit=100))
                if result and result.topics:
                    topics_list = [{"id": t.id, "title": t.title} for t in result.topics]
                    topics_json = json.dumps(topics_list, ensure_ascii=False)
            except: pass

        is_batch = bool(db_chats[chat_id]['is_batch']) if chat_id in db_chats else False
        
        # Name Shift Logic & Folder Rename
        old_name = db_chats[chat_id]['old_name'] if chat_id in db_chats else None
        if chat_id in db_chats and db_chats[chat_id]['chat_name'] != current_name:
            old_name = db_chats[chat_id]['chat_name']
            await execute_rename_logic(conn, old_name, current_name, app_settings)
            
        date_added = db_chats[chat_id]['date_added'] if chat_id in db_chats else current_time

        # --- EDGE CASE: Wiped Chat History ---
        db_last_msg_id = db_chats[chat_id]['last_message_id'] if chat_id in db_chats else 0
        db_total_dl = db_chats[chat_id]['total_downloaded'] if chat_id in db_chats else 0
        
        is_history_wiped = False
        if total_messages == 0 and (db_last_msg_id > 0 or db_total_dl > 0):
            total_messages = db_last_msg_id
            is_history_wiped = True

        chat_status_val = 0 if is_history_wiped else 1

        await conn.execute('''
            INSERT INTO chat_list (chat_id, chat_name, chat_type, total_messages, is_batch, date_added, date_updated, old_name, topics, chat_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                chat_name = excluded.chat_name, chat_type = excluded.chat_type, total_messages = excluded.total_messages,
                is_batch = excluded.is_batch, date_updated = excluded.date_updated, old_name = excluded.old_name, topics = excluded.topics, chat_status = excluded.chat_status
        ''', (chat_id, current_name, c_type, total_messages, 1 if is_batch else 0, date_added, current_time, old_name, topics_json, chat_status_val))

        if is_history_wiped:
            await conn.execute("UPDATE chat_list SET enabled = 0 WHERE chat_id = ?", (chat_id,))

    # Identify ghost chats and mark them dead
    db_chat_ids = set(db_chats.keys())
    dead_chat_ids = db_chat_ids - seen_chat_ids

    if dead_chat_ids:
        dead_list = list(dead_chat_ids)
        placeholders = ",".join("?" for _ in dead_list)
        await conn.execute(f'''
            UPDATE chat_list 
            SET chat_status = 0, enabled = 0 
            WHERE chat_id IN ({placeholders})
        ''', dead_list)
        await manager.broadcast({"event": "log", "message": f"Auto-disabled {len(dead_chat_ids)} inaccessible/ghost chats."})

    await conn.commit()
    await update_total_downloaded(conn)
    await manager.broadcast({"event": "log", "message": "Database Updated."})


async def process_chat_download(client, conn, chat_id, overwrite_mode=False, validate_mode=False, resume_mode=True):
    global SYSTEM_PAUSED
    SYSTEM_PAUSED = False 
    
    app_settings = await get_settings_dict(conn)
    downloads_dir = app_settings.get('download_path', 'downloads')
    alt_downloads_dir = app_settings.get('alt_download_path', '')
    max_concurrent_heavy = int(app_settings.get('max_concurrent_heavy', 3))
    max_concurrent_light = int(app_settings.get('max_concurrent_light', 2))
    speed_threshold_bytes = int(app_settings.get('speed_threshold_kb', 100)) * 1024
    
    ignored_str = app_settings.get('ignored_extensions', '')
    ignored_extensions = set()
    if ignored_str:
        for x in ignored_str.split(','):
            clean = x.replace('*', '').strip().lower()
            if clean:
                if not clean.startswith('.'): clean = f".{clean}"
                ignored_extensions.add(clean)

    try:
        entity = await client.get_entity(chat_id)
        chat_title = utils.get_display_name(entity)
        
        # Fetch current total messages from Telegram to check for wiped history
        try: total_messages = (await client.get_messages(entity, limit=0)).total
        except: total_messages = 0

        # Sync name changes, execute folder rename, and revive status during individual scan
        async with conn.execute("SELECT chat_name, old_name, last_message_id, total_downloaded FROM chat_list WHERE chat_id = ?", (chat_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                await conn.execute("INSERT INTO chat_list (chat_id, chat_name, date_added, date_updated, chat_status) VALUES (?, ?, ?, ?, 1)", 
                                   (chat_id, chat_title, datetime.now(), datetime.now()))
            else:
                db_chat_name, db_old_name, db_last_msg_id, db_total_dl = row
                new_old_name = db_old_name
                
                # Shift name and rename folders if it changed on Telegram
                if db_chat_name and db_chat_name != chat_title:
                    new_old_name = db_chat_name
                    await execute_rename_logic(conn, db_chat_name, chat_title, app_settings)
                
                # --- EDGE CASE: Wiped Chat History ---
                if total_messages == 0 and ((db_last_msg_id or 0) > 0 or (db_total_dl or 0) > 0):
                    await conn.execute("""
                        UPDATE chat_list 
                        SET chat_name = ?, old_name = ?, chat_status = 0, enabled = 0, total_messages = ?, date_updated = CURRENT_TIMESTAMP
                        WHERE chat_id = ?
                    """, (chat_title, new_old_name, db_last_msg_id, chat_id))
                    await conn.commit()
                    await manager.broadcast({"event": "log", "message": f"Chat history wiped for {chat_title}. Marking as dead."})
                    
                    # Abort the download safely by returning empty stats
                    return {'total_files_found': 0, 'total_messages_scanned': 0, 'successful_downloads': 0, 'skipped_downloads': 0, 'failed_downloads': 0, 'new_text_messages': 0}
                
                await conn.execute("""
                    UPDATE chat_list 
                    SET chat_name = ?, old_name = ?, chat_status = 1, date_updated = CURRENT_TIMESTAMP
                    WHERE chat_id = ?
                """, (chat_title, new_old_name, chat_id))
        await conn.commit()
            
    except Exception as e:
        await manager.broadcast({"event": "log", "message": f"Error fetching chat {chat_id}: {e}. Marking as dead."})
        # Mark as dead/disabled if Telegram denies access
        await conn.execute("UPDATE chat_list SET chat_status = 0, enabled = 0 WHERE chat_id = ?", (chat_id,))
        await conn.commit()
        return

    norm_name = normalize_name(chat_title)
    base_folder = os.path.join(downloads_dir, f"[{chat_id}]_{norm_name}")
    folders = {k: os.path.join(base_folder, k) for k in ['images', 'videos', 'archives', 'misc', 'audio']}
    for p in folders.values(): os.makedirs(p, exist_ok=True)

    alt_folders = None
    if alt_downloads_dir and os.path.exists(alt_downloads_dir):
        alt_base = os.path.join(alt_downloads_dir, f"[{chat_id}]_{norm_name}")
        alt_folders = {k: os.path.join(alt_base, k) for k in ['images', 'videos', 'archives', 'misc', 'audio']}

    excluded_topics = await db_get_topic_exclusions(conn, chat_id)
    
    last_read_id = 0 if validate_mode else await get_last_message_id(conn, chat_id)
    
    await manager.broadcast({"event": "scan_start", "chat_name": chat_title, "chat_id": chat_id, "min_id": last_read_id})
    
    stats = {
        'total_files_found': 0, 'total_messages_scanned': 0,
        'successful_downloads': 0, 'skipped_downloads': 0, 
        'failed_downloads': 0, 'new_text_messages': 0
    }
    
    temp_download_list = []
    new_text_messages = []
    highest_scanned_id = last_read_id
    scanned_ids_in_session = set()

    try:
        async for message in client.iter_messages(entity, min_id=last_read_id):
            scanned_ids_in_session.add(message.id)
            stats['total_messages_scanned'] += 1
            
            if stats['total_messages_scanned'] % 500 == 0:
                await manager.broadcast({"event": "scan_progress", "scanned": stats['total_messages_scanned']})

            if message.id > highest_scanned_id: highest_scanned_id = message.id
            msg_topic_id = get_message_topic_id(message)
            if excluded_topics and msg_topic_id in excluded_topics: continue

            should_archive = False
            if message.text: should_archive = True
            if message.media and not isinstance(message.media, (MessageMediaGeo, MessageMediaContact, MessageMediaPoll, MessageMediaUnsupported)):
                should_archive = True

            if should_archive:
                reply_id = None
                if message.reply_to:
                    reply_id = getattr(message.reply_to, 'reply_to_msg_id', None)
                    if not reply_id: reply_id = getattr(message.reply_to, 'reply_to_top_id', None)
                
                sender_name = "Unknown"
                try:
                    if message.sender: sender_name = utils.get_display_name(message.sender)
                    elif message.sender_id: sender_name = str(message.sender_id)
                except: pass

                new_text_messages.append({
                    "id": message.id, 
                    "date": str(message.date), 
                    "text": message.text if message.text else "",
                    "reply_to": reply_id,
                    "topic_id": msg_topic_id,
                    "sender_id": sender_name,
                    "grouped_id": getattr(message, 'grouped_id', None)
                })

            if message.media:
                final_filename, original_filename = generate_filename(message, chat_id)
                if not final_filename: continue
                    
                _, file_extension = os.path.splitext(final_filename)
                if file_extension.lower() in ignored_extensions: continue
                
                category = get_file_category(message, final_filename)
                if category: 
                    target_path = os.path.join(folders[category], final_filename)
                    unique_id = f"{chat_id}_{message.id}"
                    alt_target_path = os.path.join(alt_folders[category], final_filename) if alt_folders else None
                    
                    status = await db_check_existing(conn, chat_id, message.id)
                    if status != 'success':
                        expected_size = get_msg_file_size(message)
                        file_found_on_disk = False
                        
                        if os.path.exists(target_path):
                            is_valid, _ = check_file_size_integrity(target_path, expected_size, final_filename)
                            if is_valid and not overwrite_mode:
                                file_found_on_disk = True
                                await db_update_status(conn, unique_id, chat_id, message.id, 'success', target_path, original_filename, final_filename, expected_size, msg_topic_id)
                        
                        if not file_found_on_disk and alt_target_path and os.path.exists(alt_target_path):
                            is_valid, _ = check_file_size_integrity(alt_target_path, expected_size, final_filename)
                            if is_valid and not overwrite_mode:
                                file_found_on_disk = True
                                await db_update_status(conn, unique_id, chat_id, message.id, 'success', alt_target_path, original_filename, final_filename, expected_size, msg_topic_id)

                        if file_found_on_disk: 
                            stats['skipped_downloads'] += 1
                        else:
                            stats['total_files_found'] += 1
                            await db_update_status(conn, unique_id, chat_id, message.id, 'queued', target_path, original_filename, final_filename, expected_size, msg_topic_id)
                            temp_download_list.append({
                                'data': (message, target_path, unique_id, chat_id, message.id, original_filename, final_filename, expected_size, alt_target_path),
                                'category': category
                            })
                    else:
                        stats['skipped_downloads'] += 1
    except Exception as e:
        await manager.broadcast({"event": "log", "message": f"Scan error: {e}"})

    if highest_scanned_id > last_read_id: await update_cursor(conn, chat_id, highest_scanned_id)

    incomplete_ids = await db_get_incomplete(conn, chat_id)
    ids_to_fetch = list(incomplete_ids - scanned_ids_in_session)
    
    if ids_to_fetch:
        await manager.broadcast({"event": "log", "message": f"Found {len(ids_to_fetch)} incomplete files. Re-fetching in chunks..."})
        try:
            chunk_size = 200
            for i in range(0, len(ids_to_fetch), chunk_size):
                chunk = ids_to_fetch[i:i + chunk_size]
                async for message in client.iter_messages(entity, ids=chunk):
                    if not message or not message.media: continue 
                    msg_incomplete_topic_id = get_message_topic_id(message)
                    if excluded_topics and msg_incomplete_topic_id in excluded_topics: continue

                    final_filename, original_filename = generate_filename(message, chat_id)
                    category = get_file_category(message, final_filename)
                    if category:
                        target_path = os.path.join(folders[category], final_filename)
                        unique_id = f"{chat_id}_{message.id}"
                        expected_size = get_msg_file_size(message)
                        alt_target_path = os.path.join(alt_folders[category], final_filename) if alt_folders else None
                        
                        await db_update_status(conn, unique_id, chat_id, message.id, 'queued', target_path, original_filename, final_filename, expected_size, msg_incomplete_topic_id)
                        temp_download_list.append({
                            'data': (message, target_path, unique_id, chat_id, message.id, original_filename, final_filename, expected_size, alt_target_path),
                            'category': category
                        })
        except Exception as e:
            await manager.broadcast({"event": "log", "message": f"Incomplete fetch error: {e}"})

    if new_text_messages:
        msg_file = os.path.join(base_folder, 'messages.json')
        try:
            existing = []
            if os.path.exists(msg_file):
                try:
                    with open(msg_file, 'r', encoding='utf-8') as f: 
                        existing = json.load(f)
                except json.JSONDecodeError:
                    backup_file = f"{msg_file}.corrupt_{int(time.time())}.bak"
                    os.rename(msg_file, backup_file)
                    await manager.broadcast({"event": "log", "message": f"Corrupted json backed up. Starting fresh."})
                    existing = []
            
            existing_ids = {msg['id'] for msg in existing}
            unique_new = []
            for msg in new_text_messages: 
                if msg['id'] not in existing_ids:
                    unique_new.append(msg)
                    existing_ids.add(msg['id'])
            
            combined = existing + unique_new
            combined.sort(key=lambda x: x['id'])

            if unique_new:
                with open(msg_file, 'w', encoding='utf-8') as f:
                    json.dump(combined, f, indent=4, ensure_ascii=False)
                await manager.broadcast({"event": "log", "message": f"Saved {len(unique_new)} text/media records."})
        except Exception as e: 
            await manager.broadcast({"event": "error", "message": f"Error saving messages: {e}"})

    await update_total_downloaded(conn, chat_id)

    total_downloads_needed = len(temp_download_list)
    await manager.broadcast({"event": "scan_complete", "queued": total_downloads_needed})
    
    if total_downloads_needed > 0:
        queue_heavy = asyncio.Queue()
        queue_light = asyncio.Queue()
        
        total_heavy = sum(1 for x in temp_download_list if x['category'] in ['videos', 'archives', 'audio'])
        total_light = len(temp_download_list) - total_heavy
        
        c_heavy, c_light = 0, 0
        for item in temp_download_list:
            if item['category'] in ['videos', 'archives', 'audio']:
                c_heavy += 1
                queue_heavy.put_nowait(item['data'] + (('heavy', c_heavy, total_heavy, total_downloads_needed),))
            else:
                c_light += 1
                queue_light.put_nowait(item['data'] + (('light', c_light, total_light, total_downloads_needed),))
        
        active_heavy, active_light = [], []

        try:
            while not queue_heavy.empty() or not queue_light.empty() or active_heavy or active_light:
                active_heavy = [(t, s) for t, s in active_heavy if not t.done()]
                active_light = [(t, s) for t, s in active_light if not t.done()]
                
                if not queue_heavy.empty() and should_spawn_smart(active_heavy, max_concurrent_heavy, speed_threshold_bytes):
                    new_status = WorkerStatus(w_type="heavy")
                    new_task = asyncio.create_task(download_worker(client, conn, queue_heavy, stats, overwrite_mode, resume_mode, new_status, app_settings))
                    active_heavy.append((new_task, new_status))
                
                if not queue_light.empty() and len(active_light) < max_concurrent_light:
                    new_status = WorkerStatus(w_type="light")
                    new_task = asyncio.create_task(download_worker(client, conn, queue_light, stats, overwrite_mode, resume_mode, new_status, app_settings))
                    active_light.append((new_task, new_status))
                
                await asyncio.sleep(0.5)

        finally:
            all_tasks = active_heavy + active_light
            for task, _ in all_tasks: 
                if not task.done(): task.cancel()

    total_bytes = await asyncio.to_thread(get_dir_size, base_folder)
    if alt_folders:
        total_bytes += await asyncio.to_thread(get_dir_size, alt_base)
        
    await conn.execute("UPDATE chat_list SET total_size = ? WHERE chat_id = ?", (total_bytes, chat_id))
    await conn.commit()

    for p in folders.values():
        try: os.rmdir(p)
        except OSError: pass
        
    if alt_folders:
        for p in alt_folders.values():
            try: os.rmdir(p)
            except OSError: pass

    try: os.rmdir(base_folder)
    except OSError: pass

    await manager.broadcast({
        "event": "chat_complete", 
        "chat_id": chat_id,
        "stats": stats
    })
    
    return stats
    
async def process_batch_download(client, conn, overwrite_mode=False, validate_mode=False, resume_mode=True, sort_order="default"):
    # Map the frontend string to a safe, hardcoded SQL injection-proof string
    order_mapping = {
        "default": "ORDER BY defer ASC, total_messages ASC",
        "chat_id_asc": "ORDER BY chat_id ASC",
        "chat_id_desc": "ORDER BY chat_id DESC",
        "messages_asc": "ORDER BY total_messages ASC",
        "messages_desc": "ORDER BY total_messages DESC",
        "date_added_asc": "ORDER BY date_added ASC",
        "date_added_desc": "ORDER BY date_added DESC"
    }
    
    # Fallback to default if an unknown sort string is passed
    sql_order = order_mapping.get(sort_order, order_mapping["default"])
    
    await manager.broadcast({"event": "log", "message": f"[DB] Fetching batch list from database (Sort: {sort_order})..."})
    
    query = f"SELECT chat_id, chat_name FROM chat_list WHERE is_batch = 1 AND enabled = 1 AND chat_status = 1 {sql_order}"
    async with conn.execute(query) as cursor:
        batch_targets = await cursor.fetchall()
        
    if not batch_targets:
        await manager.broadcast({"event": "log", "message": "No valid chats marked for batch download."})
        return

    total_chats = len(batch_targets)
    await manager.broadcast({"event": "log", "message": f"Batch processing {total_chats} chats."})
    
    for i, row in enumerate(batch_targets, 1):
        chat_id, chat_name = row[0], row[1]
        await manager.broadcast({"event": "log", "message": f"--- Downloading Batch {i}/{total_chats}: {chat_name} ---"})
        try:
            await process_chat_download(client, conn, chat_id, overwrite_mode, validate_mode, resume_mode)
        except Exception as e:
            await manager.broadcast({"event": "error", "message": f"Skipping {chat_name} due to error: {e}"})
        await asyncio.sleep(2)
        
    await manager.broadcast({"event": "batch_complete"})