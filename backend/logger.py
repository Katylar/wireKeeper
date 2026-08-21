import logging
from logging.handlers import RotatingFileHandler
import os
from config import LOG_FILE, LOG_LEVEL

# Ensure log directory exists if a path is provided
log_dir = os.path.dirname(LOG_FILE)
if log_dir and not os.path.exists(log_dir):
    os.makedirs(log_dir, exist_ok=True)

# Create a custom logger
logger = logging.getLogger("WireKeeper")
level = getattr(logging, LOG_LEVEL, logging.INFO)
logger.setLevel(level)

# 10 MB per file, keep 5 backups (50MB total log storage max)
file_handler = RotatingFileHandler(LOG_FILE, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')
console_handler = logging.StreamHandler()

# Clean, highly-readable format
formatter = logging.Formatter('%(asctime)s | %(levelname)-8s | %(module)-12s | %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

if not logger.handlers:
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

# SILENCE NOISY LIBRARIES: 
# Telethon and aiosqlite will output thousands of lines per minute if we don't set them to WARNING only.
logging.getLogger('telethon').setLevel(logging.WARNING)
logging.getLogger('aiosqlite').setLevel(logging.WARNING)