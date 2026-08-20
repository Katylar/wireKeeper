import sqlite3
import os
from dotenv import load_dotenv

load_dotenv('.env')
DB_NAME = os.getenv("WIREKEEPER_DB_PATH", "wirekeeper.db")

def run_migration():
    if not os.path.exists(DB_NAME):
        print(f"Error: Database {DB_NAME} not found!")
        return

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # 1. Fetch the API ID for the current data (Profile 1)
    cursor.execute("SELECT value FROM settings WHERE key = 'profile_1_api_id'")
    row = cursor.fetchone()
    
    if not row or not row[0]:
        print("Error: 'profile_1_api_id' is missing in the settings table.")
        print("Please ensure your API ID is saved via the UI before running this migration.")
        conn.close()
        return

    api_id = row[0]
    print(f"Found API ID: {api_id}. Migrating all existing data to this account...")

    try:
        # 2. Get existing columns from chat_list to avoid mismatch errors
        cursor.execute("PRAGMA table_info(chat_list)")
        columns_info = cursor.fetchall()
        existing_cols = [col[1] for col in columns_info]
        print(f"Detected existing chat_list columns: {existing_cols}")

        # Build column definitions and SELECT statements dynamically
        col_defs = ["api_id TEXT"]
        for col in columns_info:
            # col = (cid, name, type, notnull, dflt_value, pk)
            name, ctype, notnull, dflt = col[1], col[2], col[3], col[4]
            if name == 'chat_id':
                col_defs.append(f"{name} {ctype} PRIMARY KEY")
            else:
                def_str = f"{name} {ctype}"
                if notnull: def_str += " NOT NULL"
                if dflt is not None: def_str += f" DEFAULT {dflt}"
                col_defs.append(def_str)

        # Drop primary key restriction from chat_id alone, make compound primary key instead
        # Re-engineering the table schema creation cleanly:
        cursor.execute('''
            CREATE TABLE chat_list_new (
                api_id TEXT,
                chat_id INTEGER,
                chat_name TEXT,
                chat_type TEXT,
                total_messages INTEGER,
                is_batch INTEGER DEFAULT 0,
                defer INTEGER DEFAULT 0,
                topics TEXT,
                topics_exclude INTEGER DEFAULT 0,
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

        # Construct safe insert matching whichever columns actually exist in old table
        # We'll map standard columns explicitly
        standard_cols = [
            'chat_id', 'chat_name', 'chat_type', 'total_messages', 'is_batch', 'defer', 
            'topics', 'date_added', 'date_updated', 'old_name', 
            'last_message_id', 'last_download_scan', 'last_archived', 'total_downloaded', 
            'enabled', 'hidden', 'total_size', 'last_download', 'chat_status'
        ]
        
        # Filter down to only columns that actually exist in the user's database
        active_cols = [c for c in standard_cols if c in existing_cols]
        cols_sql = ", ".join(active_cols)
        
        print(f"-> Migrating chat_list rows using columns: {active_cols}")
        cursor.execute(f'''
            INSERT INTO chat_list_new (api_id, {cols_sql})
            SELECT ?, {cols_sql} FROM chat_list
        ''', (api_id,))

        # 3. Migrate downloads
        print("-> Creating new downloads table with api_id reference...")
        cursor.execute('''
            CREATE TABLE downloads_new (
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

        cursor.execute('''
            INSERT INTO downloads_new (
                file_unique_id, api_id, chat_id, message_id, topic_id, file_path, 
                original_filename, final_filename, status, file_size, timestamp
            )
            SELECT 
                ? || '_' || file_unique_id, ?, chat_id, message_id, topic_id, file_path, 
                original_filename, final_filename, status, file_size, timestamp
            FROM downloads
        ''', (api_id, api_id))

        # 4. Swap tables
        print("-> Replacing old tables...")
        cursor.execute("DROP TABLE chat_list")
        cursor.execute("ALTER TABLE chat_list_new RENAME TO chat_list")

        cursor.execute("DROP TABLE downloads")
        cursor.execute("ALTER TABLE downloads_new RENAME TO downloads")

        # 5. Recreate index
        print("-> Rebuilding indices...")
        cursor.execute("DROP INDEX IF EXISTS idx_chat_msg")
        cursor.execute("DROP INDEX IF EXISTS idx_api_chat_msg")
        cursor.execute("CREATE INDEX idx_api_chat_msg ON downloads(api_id, chat_id, message_id)")

        conn.commit()
        print("\n✅ Migration completed successfully!")

    except Exception as e:
        conn.rollback()
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()

if __name__ == '__main__':
    run_migration()