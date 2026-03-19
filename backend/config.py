import os
from dotenv import load_dotenv

ENV_FILE = '.env'

# Create .env if it doesn't exist
if not os.path.exists(ENV_FILE):
    with open(ENV_FILE, 'w') as f:
        f.write("WIREKEEPER_DB_PATH=wirekeeper.db\n")
        f.write("WIREKEEPER_PORT=8000\n")
        f.write("WIREKEEPER_HOST=0.0.0.0\n")
        f.write("WIREKEEPER_LOG_LEVEL=info\n")

# Load environment variables into os.environ
load_dotenv(ENV_FILE)

# Core Boot Variables
DB_NAME = os.getenv("WIREKEEPER_DB_PATH", "wirekeeper.db")

# Static Constants
PHOTO_EXTS = {".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp", ".png", ".webp", ".gif", ".avif", ".svg", ".svgz",".tiff", ".tif", ".heic", ".heif", ".psd", ".psb", ".ai", ".eps", ".bmp", ".ico", ".cur",".dng", ".cr2", ".cr3", ".nef", ".arw", ".srf", ".sr2", ".raf", ".orf", ".rw2"}
ARCHIVE_EXTS = {".zip", ".rar", ".7z", ".tar", ".gz", ".gzip", ".bz2", ".bzip2", ".xz", ".iso", ".tgz", ".tbz2",".part1.rar", ".part2.rar", ".part3.rar", ".part4.rar", ".part5.rar", ".part6.rar", ".part7.rar", ".part8.rar", ".part9.rar",".r00", ".r01", ".r02", ".r03", ".r04", ".r05", ".r06", ".r07", ".r08", ".r09",".7z.001", ".7z.002", ".7z.003", ".7z.004", ".7z.005",".z01", ".z02", ".z03", ".z04", ".z05", ".z06", ".z07", ".z08", ".z09",".001", ".002", ".003", ".004", ".005",".dmg", ".cab", ".apk", ".xapk", ".deb", ".rpm", ".jar", ".war"}
SAFE_RESUME_REWIND = 1024 * 1024