import os
import re
import mimetypes
from unidecode import unidecode
from telethon import utils
from telethon.tl.types import (
    MessageMediaPhoto, MessageMediaDocument, MessageMediaWebPage,
    DocumentAttributeFilename, MessageMediaGeo, MessageMediaContact, 
    MessageMediaPoll, MessageMediaDice, MessageMediaGame, MessageMediaVenue, WebPage
)
from config import ARCHIVE_EXTS, PHOTO_EXTS

mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('audio/ogg', '.oga')

def normalize_name(name):
    if not name: return "Unknown"
    name = unidecode(name)
    clean_name = re.sub(r'[^a-zA-Z0-9_\-\s]', '', name)
    clean_name = re.sub(r'\s+', ' ', clean_name)
    return clean_name.strip()

def get_file_category(message, filename):
    if isinstance(message.media, (MessageMediaGeo, MessageMediaContact, MessageMediaPoll, MessageMediaDice, MessageMediaGame, MessageMediaVenue)):
        return None
    if isinstance(message.media, MessageMediaPhoto): return 'images'
    if isinstance(message.media, MessageMediaDocument):
        if message.voice or message.audio: return 'misc' 
        if message.video or message.gif: return 'videos'
        mime_type = getattr(message.file, 'mime_type', '').lower()
        if mime_type.startswith('image/'): return 'images'
        if mime_type.startswith('video/'): return 'videos'
        ext = os.path.splitext(filename)[1].lower() if filename else ""
        if ext in ARCHIVE_EXTS: return 'archives'
        return 'misc'
    if isinstance(message.media, MessageMediaWebPage) and isinstance(message.media.webpage, WebPage):
        if message.media.webpage.photo: return 'images'
        if message.media.webpage.document: return 'misc'
    return None

def get_msg_file_size(message):
    if not message.media: return None
    if hasattr(message.media, 'document') and message.media.document:
        if hasattr(message.media.document, 'size'): return message.media.document.size
    if hasattr(message.media, 'photo') and message.media.photo and message.media.photo.sizes:
        last_size = message.media.photo.sizes[-1]
        if hasattr(last_size, 'size'): return last_size.size
    return None

def generate_filename(message, chat_id):
    original_filename = None
    message_id = message.id
    timestamp = int(message.date.timestamp())
    
    if message.media and hasattr(message.media, 'document'):
        for attr in message.media.document.attributes:
            if isinstance(attr, DocumentAttributeFilename):
                original_filename = attr.file_name
                break
    
    ext = utils.get_extension(message.media)
    if not ext and hasattr(message, 'file') and hasattr(message.file, 'mime_type'):
        ext = mimetypes.guess_extension(message.file.mime_type)

    if not ext:
        if isinstance(message.media, MessageMediaPhoto) or (isinstance(message.media, MessageMediaWebPage) and getattr(message.media.webpage, 'photo', None)): 
            ext = '.jpg'
    
    if not ext: return None, None

    if original_filename:
        name, file_ext = os.path.splitext(original_filename)
        sanitized_name = normalize_name(name)
        actual_ext = file_ext if file_ext else ext
        if sanitized_name:
            return f"{message_id}_{sanitized_name}{actual_ext}", original_filename

    return f"{message_id}_{chat_id}_{timestamp}{ext}", original_filename
    
def check_file_size_integrity(path, expected_size, filename):
    if not os.path.exists(path): return False, "File does not exist"
    actual_size = os.path.getsize(path)
    if expected_size and actual_size == expected_size: return True, "Exact match"
    if expected_size is None:
        if actual_size > 0: return True, f"Size unknown but downloaded ({actual_size} bytes)"
        return False, "Empty file downloaded"
    _, ext = os.path.splitext(filename)
    if ext.lower() in PHOTO_EXTS: return True, f"Photo size ignored"
    return False, f"Size mismatch (Exp: {expected_size}, Got: {actual_size})"

def get_message_topic_id(message):
    if not message.reply_to: return None
    if message.reply_to.forum_topic:
        return getattr(message.reply_to, 'reply_to_top_id', message.reply_to.reply_to_msg_id)
    return None