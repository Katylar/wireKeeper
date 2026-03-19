import aiosqlite
from config import DB_NAME

async def init_db():
    conn = await aiosqlite.connect(DB_NAME)
    
    await conn.execute('''
        CREATE TABLE IF NOT EXISTS downloads (
            file_unique_id TEXT PRIMARY KEY,
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
    
    # Cleaned up: All columns defined right from the start
    await conn.execute('''
        CREATE TABLE IF NOT EXISTS chat_list (
            chat_id INTEGER PRIMARY KEY,
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
            hidden INTEGER DEFAULT 0
        )
    ''')

    await conn.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    
    # Seed default settings if the table is empty
    async with conn.execute("SELECT COUNT(*) FROM settings") as cursor:
        count = (await cursor.fetchone())[0]
        if count == 0:
            default_settings = [
                ('api_id', ''),
                ('api_hash', ''),
                ('session_name', 'wirekeeper_session'),
                ('max_concurrent_heavy', '3'),
                ('max_concurrent_light', '2'),
                ('speed_threshold_kb', '100'),
                ('max_retries', '3'),
                ('download_path', 'downloads'),
                ('alt_download_path', ''),
                ('ignored_extensions', '.aac,.accdb,.aiff,.amr,.apk,.app,.azw,.azw3,.bat,.bin,.bittorrent,.c,.cer,.chm,.cmd,.com,.cpl,.cpp,.crt,.cs,.csr,.css,.csv,.db,.dbf,.djvu,.dmg,.doc,.docx,.epub,.exe,.fb2,.flac,.gadget,.go,.htm,.html,.iba,.ics,.ipa,.jar,.java,.js,.json,.key,.kpf,.lit,.log,.lrf,.m4a,.mdb,.mid,.midi,.mobi,.mp2,.mp3,.msg,.msi,.numbers,.odp,.ods,.odt,.oga,.ogg,.opus,.pages,.pdb,.pdf,.pem,.php,.pif,.ppt,.pptx,.prc,.ps1,.py,.ra,.rb,.rss,.rtf,.scr,.sh,.snd,.sql,.sqlite,.tcr,.tex,.torrent,.txt,.vbs,.vcard,.vcf,.wav,.wma,.xapk,.xhtml,.xls,.xlsx,.xml')
            ]
            await conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", default_settings)

    await conn.execute('CREATE INDEX IF NOT EXISTS idx_chat_msg ON downloads(chat_id, message_id)')
    await conn.commit()
    return conn

async def get_last_message_id(conn, chat_id):
    async with conn.execute("SELECT last_message_id FROM chat_list WHERE chat_id = ?", (chat_id,)) as cursor:
        result = await cursor.fetchone()
        return result[0] if result else 0

async def update_cursor(conn, chat_id, message_id):
    await conn.execute('''
        UPDATE chat_list 
        SET last_message_id = ?, last_download_scan = CURRENT_TIMESTAMP
        WHERE chat_id = ? AND last_message_id < ?
    ''', (message_id, chat_id, message_id))
    await conn.commit()

async def db_update_status(conn, unique_id, chat_id, message_id, status, file_path=None, original_name=None, final_name=None, file_size=None, topic_id=None):
    row_exists = False
    async with conn.execute("SELECT 1 FROM downloads WHERE file_unique_id = ?", (unique_id,)) as cursor:
        if await cursor.fetchone(): row_exists = True
            
    if not row_exists:
        await conn.execute('''
            INSERT OR REPLACE INTO downloads 
            (file_unique_id, chat_id, message_id, topic_id, file_path, original_filename, final_filename, status, file_size) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (unique_id, chat_id, message_id, topic_id, file_path, original_name, final_name, status, file_size))
    else:
        if file_path and status == 'success':
                await conn.execute("UPDATE downloads SET status = ?, file_path = ?, topic_id = ? WHERE file_unique_id = ?", (status, file_path, topic_id, unique_id))
        else:
                await conn.execute("UPDATE downloads SET status = ?, topic_id = ? WHERE file_unique_id = ?", (status, topic_id, unique_id))
    await conn.commit()

async def db_check_existing(conn, chat_id, message_id):
    async with conn.execute("SELECT status FROM downloads WHERE chat_id = ? AND message_id = ?", (chat_id, message_id)) as cursor:
        result = await cursor.fetchone()
        return result[0] if result else None

async def db_get_incomplete(conn, chat_id):
    query = "SELECT message_id FROM downloads WHERE chat_id = ? AND status != 'success'"
    async with conn.execute(query, (chat_id,)) as cursor:
        rows = await cursor.fetchall()
        return {r[0] for r in rows} if rows else set()

async def db_get_topic_exclusions(conn, chat_id):
    async with conn.execute("SELECT topics_exclude FROM chat_list WHERE chat_id = ?", (chat_id,)) as cursor:
        row = await cursor.fetchone()
        if row and row[0]:
            try: return {int(x.strip()) for x in row[0].split(',') if x.strip().isdigit()}
            except: return set()
        return set()

async def update_total_downloaded(conn, chat_id=None):
    """
    Counts all 'success' status downloads and updates the chat_list table.
    If chat_id is provided, it only updates that specific chat.
    If chat_id is None, it updates all chats (for global sync).
    """
    update_query = """
        UPDATE chat_list 
        SET total_downloaded = (
            SELECT COUNT(*) 
            FROM downloads 
            WHERE downloads.chat_id = chat_list.chat_id 
            AND downloads.status = 'success'
        )
    """
    
    if chat_id is not None:
        await conn.execute(update_query + " WHERE chat_id = ?", (chat_id,))
    else:
        await conn.execute(update_query)
        
    await conn.commit()

async def get_settings_dict(conn):
    """Returns all settings as a dictionary."""
    async with conn.execute("SELECT key, value FROM settings") as cursor:
        rows = await cursor.fetchall()
        return {r[0]: r[1] for r in rows}

async def update_setting(conn, key, value):
    """Updates or inserts a single setting."""
    await conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
    await conn.commit()