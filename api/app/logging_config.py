import logging
from logging.handlers import RotatingFileHandler
import os
import sys

# Ensure the logs directory exists
# In PyInstaller frozen mode, __file__ may point to a read-only temp dir,
# so write logs next to the executable instead.
if getattr(sys, 'frozen', False):
    LOG_DIR = os.path.join(os.path.dirname(sys.executable), 'logs')
else:
    LOG_DIR = os.path.join(os.path.dirname(__file__), 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

LOG_FILE_PATH = os.path.join(LOG_DIR, 'illuminate.log')

def setup_logging():
    # Prevent duplicate handlers if setup_logging() is called multiple times
    if len(logging.getLogger().handlers) == 0:
        file_handler = RotatingFileHandler(LOG_FILE_PATH, maxBytes=5*1024*1024, backupCount=2)
        formatter = logging.Formatter('%(asctime)s | %(levelname)s | %(name)s | %(message)s')
        file_handler.setFormatter(formatter)
        logging.basicConfig(level=logging.INFO, handlers=[file_handler])
