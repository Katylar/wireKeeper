import sqlite3
import os
from dotenv import load_dotenv

load_dotenv('.env')
DB_NAME = os.getenv("WIREKEEPER_DB_PATH", "wirekeeper.db")

def run_history_migration():
    if not os.path.exists(DB_NAME):
        print(f"Error: Database {DB_NAME} not found!")
        return

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # 1. Fetch the Profile 1 API ID from settings
    cursor.execute("SELECT value FROM settings WHERE key = 'profile_1_api_id'")
    row = cursor.fetchone()
    
    if not row or not row[0]:
        print("Error: 'profile_1_api_id' is missing in the settings table.")
        conn.close()
        return

    api_id = row[0]
    print(f"Found API ID: {api_id}. Migrating activity_history and archivings...")

    try:
        # 2. Migrate activity_history if it exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_history'")
        if cursor.fetchone():
            print("-> Migrating activity_history table...")
            cursor.execute("ALTER TABLE activity_history ADD COLUMN api_id TEXT")
            cursor.execute("UPDATE activity_history SET api_id = ? WHERE api_id IS NULL", (api_id,))
            print("   activity_history updated successfully.")
        else:
            print("-> Table activity_history does not exist yet (skipping).")

        # 3. Migrate archivings if it exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='archivings'")
        if cursor.fetchone():
            print("-> Migrating archivings table...")
            cursor.execute("ALTER TABLE archivings ADD COLUMN api_id TEXT")
            cursor.execute("UPDATE archivings SET api_id = ? WHERE api_id IS NULL", (api_id,))
            print("   archivings updated successfully.")
        else:
            print("-> Table archivings does not exist yet (skipping).")

        conn.commit()
        print("\n✅ History and archiving tables migrated successfully!")

    except Exception as e:
        conn.rollback()
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()

if __name__ == '__main__':
    run_history_migration()