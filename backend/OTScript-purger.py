import sqlite3
import os
import sys
import shutil
from dotenv import load_dotenv

# Import the exact normalization logic your app uses
from utils import normalize_name

# Load the exact same environment variables as your main app
load_dotenv('.env')
DB_NAME = os.getenv("WIREKEEPER_DB_PATH", "wirekeeper.db")

def get_dir_stats(path):
    """Calculates total file count and size of a directory."""
    total_size = 0
    file_count = 0
    if os.path.exists(path) and os.path.isdir(path):
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    total_size += os.path.getsize(fp)
                    file_count += 1
    return file_count, total_size

def format_size(size_in_bytes):
    """Converts bytes to a human-readable format."""
    if size_in_bytes == 0:
        return "0.00 B"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_in_bytes < 1024.0:
            return f"{size_in_bytes:.2f} {unit}"
        size_in_bytes /= 1024.0
    return f"{size_in_bytes:.2f} PB"

def delete_directory(path):
    """Safely deletes a directory if it exists."""
    if os.path.exists(path) and os.path.isdir(path):
        try:
            shutil.rmtree(path)
            print(f"  ✓ Deleted folder: {path}")
        except Exception as e:
            print(f"  ⚠ Failed to delete {path}: {e}")
    else:
        print(f"  - Skipped: Folder not found at {path}")

def main():
    print("--- Wirekeeper Chat Purge Utility ---")
    
    if not os.path.exists(DB_NAME):
        print(f"❌ Error: Database '{DB_NAME}' not found.")
        sys.exit(1)

    chat_id = input("Enter the Chat ID to purge: ").strip()
    if not chat_id:
        print("No Chat ID provided. Exiting.")
        sys.exit(0)

    try:
        # Connect to the SQLite database
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        # 1. Fetch paths from the settings table
        cursor.execute("SELECT value FROM settings WHERE key = 'download_path'")
        dl_row = cursor.fetchone()
        dl_path = dl_row[0] if dl_row else "downloads"

        cursor.execute("SELECT value FROM settings WHERE key = 'alt_download_path'")
        alt_row = cursor.fetchone()
        alt_dl_path = alt_row[0] if alt_row else ""

        # 2. Verify the chat exists and get the raw chat name
        cursor.execute("SELECT chat_name FROM chat_list WHERE chat_id = ?", (chat_id,))
        result = cursor.fetchone()

        if not result:
            print(f"❌ Chat ID '{chat_id}' not found in the chat_list table.")
            conn.close()
            sys.exit(0)

        raw_chat_name = result[0]
        
        # 3. Construct the exact folder name using the app's native logic
        norm_name = normalize_name(raw_chat_name)
        exact_folder_name = f"[{chat_id}]_{norm_name}"

        primary_target = os.path.join(dl_path, exact_folder_name)
        alt_target = os.path.join(alt_dl_path, exact_folder_name) if alt_dl_path else None

        # 4. Pre-flight Check: Calculate sizes
        print("\nScanning directories...")
        p_count, p_size = get_dir_stats(primary_target)
        a_count, a_size = get_dir_stats(alt_target) if alt_target else (0, 0)
        
        total_files = p_count + a_count
        total_size = p_size + a_size

        print(f"\n--- TARGET ACQUIRED ---")
        print(f"Raw Chat Name: {raw_chat_name}")
        print(f"Target Folder: {exact_folder_name}")
        print(f"Primary Path:  {primary_target} ({p_count} files, {format_size(p_size)})")
        if alt_target:
            print(f"Alt Path:      {alt_target} ({a_count} files, {format_size(a_size)})")
        
        print(f"\nTotal Destruction: {total_files} files freeing up {format_size(total_size)} of disk space.")
        
        # 5. Final Confirmation
        confirm = input("\nAre you sure you want to permanently delete these files and wipe the DB records? (y/n): ").strip().lower()
        
        if confirm != 'y':
            print("Operation aborted. No changes made.")
            conn.close()
            sys.exit(0)

        print("\nInitiating purge...")

        # Execute File Deletion
        delete_directory(primary_target)
        if alt_target:
            delete_directory(alt_target)

        # Execute DB Purge
        cursor.execute("DELETE FROM downloads WHERE chat_id = ?", (chat_id,))
        deleted_rows = cursor.rowcount
        print(f"  ✓ Deleted {deleted_rows} records from the 'downloads' table.")

        # Reset chat_list metrics
        cursor.execute("""
            UPDATE chat_list 
            SET total_downloaded = 0, total_size = 0, last_download = NULL 
            WHERE chat_id = ?
        """, (chat_id,))
        print("  ✓ Reset 'total_downloaded', 'total_size', and 'last_download' in the 'chat_list' table.")

        # Commit transaction
        conn.commit()
        print("\n✅ Purge complete. The slate is clean.")

    except sqlite3.Error as e:
        print(f"\n❌ Database error occurred: {e}")
        conn.rollback()
    except Exception as e:
        print(f"\n❌ An unexpected error occurred: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    main()