import aiosqlite
from config import DB_NAME

async def init_db():
    conn = await aiosqlite.connect(DB_NAME)
    
    await conn.execute('PRAGMA journal_mode=WAL;')
    
    await conn.execute('''
        CREATE TABLE IF NOT EXISTS downloads (
            file_unique_id TEXT PRIMARY KEY,
            api_id TEXT,
            chat_id INTEGER,
            message_id INTEGER,
            topic_id INTEGER,
            file_path TEXT,
            original_filename TEXT,
            final_filename TEXT,
            status TEXT,
            file_size INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    await conn.execute('''
        CREATE TABLE IF NOT EXISTS chat_list (
            api_id TEXT,
            chat_id INTEGER,
            chat_name TEXT,
            chat_type TEXT,
            total_messages INTEGER,
            is_batch INTEGER DEFAULT 0,
            defer INTEGER DEFAULT 0,
            topics TEXT,
            topics_exclude TEXT,
            redownload INTEGER DEFAULT 0,
            date_added DATETIME,
            date_updated DATETIME,
            old_name TEXT,
            last_message_id INTEGER DEFAULT 0,
            last_download_scan DATETIME,
            last_archived DATETIME,
            total_downloaded INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            hidden INTEGER DEFAULT 0,
            total_size INTEGER DEFAULT 0,
            last_download DATETIME,
            chat_status INTEGER DEFAULT 1,
            PRIMARY KEY (api_id, chat_id)
        )
    ''')

    await conn.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    
    # Initialize Multi-Account Settings if empty
    await conn.execute("UPDATE settings SET key = 'profile_1_api_id' WHERE key = 'api_id'")
    await conn.execute("UPDATE settings SET key = 'profile_1_api_hash' WHERE key = 'api_hash'")
    await conn.execute("UPDATE settings SET key = 'profile_1_session_name' WHERE key = 'session_name'")
    
    async with conn.execute("SELECT COUNT(*) FROM settings") as cursor:
        count = (await cursor.fetchone())[0]
        if count == 0:
            default_settings = [
                ('profiles_list', '["1", "2"]'),
                ('active_profile', '1'),
                ('profile_1_api_id', ''),
                ('profile_1_api_hash', ''),
                ('profile_1_session_name', 'wirekeeper_session_1'),
                ('profile_2_api_id', ''),
                ('profile_2_api_hash', ''),
                ('profile_2_session_name', 'wirekeeper_session_2'),
                ('max_concurrent_heavy', '4'),
                ('max_concurrent_light', '6'),
                ('speed_threshold_kb', '100'),
                ('max_retries', '3'),
                ('download_path', 'downloads'),
                ('alt_download_path', ''),
                ('ignored_extensions', '.aac,.accdb,.aiff,.amr,.apk,.app,.azw,.azw3,.bat,.bin,.bittorrent,.c,.cer,.chm,.cmd,.com,.cpl,.cpp,.crt,.cs,.csr,.css,.csv,.db,.dbf,.djvu,.dmg,.doc,.docx,.epub,.exe,.fb2,.flac,.gadget,.go,.htm,.html,.iba,.ics,.ipa,.jar,.java,.js,.json,.key,.kpf,.lit,.log,.lrf,.m4a,.mdb,.mid,.midi,.mobi,.mp2,.mp3,.msg,.msi,.numbers,.odp,.ods,.odt,.oga,.ogg,.opus,.pages,.pdb,.pdf,.pem,.php,.pif,.ppt,.pptx,.prc,.ps1,.py,.ra,.rb,.rss,.rtf,.scr,.sh,.snd,.sql,.sqlite,.tcr,.tex,.torrent,.txt,.vbs,.vcard,.vcf,.wav,.wma,.xapk,.xhtml,.xls,.xlsx,.xml')
            ]
            await conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", default_settings)
        else:
            await conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('active_profile', '1')")
            await conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('profiles_list', '[\"1\", \"2\"]')")

    await conn.execute('CREATE INDEX IF NOT EXISTS idx_api_chat_msg ON downloads(api_id, chat_id, message_id)')
    await conn.commit()
    return conn

async def get_last_message_id(conn, api_id, chat_id):
    async with conn.execute("SELECT last_message_id FROM chat_list WHERE api_id = ? AND chat_id = ?", (api_id, chat_id)) as cursor:
        result = await cursor.fetchone()
        return result[0] if result else 0

async def update_cursor(conn, api_id, chat_id, message_id):
    await conn.execute('''
        UPDATE chat_list 
        SET last_message_id = ?, last_download_scan = CURRENT_TIMESTAMP
        WHERE api_id = ? AND chat_id = ? AND last_message_id < ?
    ''', (message_id, api_id, chat_id, message_id))
    await conn.commit()

async def db_update_status(conn, api_id, unique_id, chat_id, message_id, status, file_path=None, original_name=None, final_name=None, file_size=None, topic_id=None):
    row_exists = False
    async with conn.execute("SELECT 1 FROM downloads WHERE file_unique_id = ?", (unique_id,)) as cursor:
        if await cursor.fetchone(): row_exists = True
            
    if not row_exists:
        await conn.execute('''
            INSERT OR REPLACE INTO downloads 
            (file_unique_id, api_id, chat_id, message_id, topic_id, file_path, original_filename, final_filename, status, file_size) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (unique_id, api_id, chat_id, message_id, topic_id, file_path, original_name, final_name, status, file_size))
    else:
        if file_path and status == 'success':
                await conn.execute("UPDATE downloads SET status = ?, file_path = ?, topic_id = ? WHERE file_unique_id = ?", (status, file_path, topic_id, unique_id))
        else:
                await conn.execute("UPDATE downloads SET status = ?, topic_id = ? WHERE file_unique_id = ?", (status, topic_id, unique_id))
    await conn.commit()

async def db_check_existing(conn, api_id, chat_id, message_id):
    async with conn.execute("SELECT status FROM downloads WHERE api_id = ? AND chat_id = ? AND message_id = ?", (api_id, chat_id, message_id)) as cursor:
        result = await cursor.fetchone()
        return result[0] if result else None

async def db_get_incomplete(conn, api_id, chat_id):
    query = "SELECT message_id FROM downloads WHERE api_id = ? AND chat_id = ? AND status != 'success'"
    async with conn.execute(query, (api_id, chat_id)) as cursor:
        rows = await cursor.fetchall()
        return {r[0] for r in rows} if rows else set()

async def db_get_topic_exclusions(conn, api_id, chat_id):
    async with conn.execute("SELECT topics_exclude FROM chat_list WHERE api_id = ? AND chat_id = ?", (api_id, chat_id)) as cursor:
        row = await cursor.fetchone()
        if row and row[0]:
            try: return {int(x.strip()) for x in row[0].split(',') if x.strip().isdigit()}
            except: return set()
        return set()

async def update_total_downloaded(conn, api_id, chat_id=None):
    update_query = """
        UPDATE chat_list 
        SET total_downloaded = (
            SELECT COUNT(*) 
            FROM downloads 
            WHERE downloads.api_id = chat_list.api_id 
            AND downloads.chat_id = chat_list.chat_id 
            AND downloads.status = 'success'
        )
        WHERE chat_list.api_id = ?
    """
    
    if chat_id is not None:
        await conn.execute(update_query + " AND chat_list.chat_id = ?", (api_id, chat_id))
    else:
        await conn.execute(update_query, (api_id,))
        
    await conn.commit()

async def get_settings_dict(conn):
    async with conn.execute("SELECT key, value FROM settings") as cursor:
        rows = await cursor.fetchall()
        return {r[0]: r[1] for r in rows}

async def update_setting(conn, key, value):
    await conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
    await conn.commit()