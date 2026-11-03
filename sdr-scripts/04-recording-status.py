import json
import os
import shutil
import sys
import time
import urllib.request

# CONFIG: change these lines only.
RELAY_URL = "https://YOUR-WORKER.workers.dev/push"
RELAY_SECRET = "YOUR-PASSPHRASE"
WATCH_FOLDER = "C:/Recordings"
FILE_ENDING = ".wav"
LOW_DISK_GB = 5
EXPECTED_FILE = ""
MISSING_MINUTES = 10
STABLE_SECONDS = 60

def send_push(title, body):
    data = json.dumps({"title": title, "body": body, "group": "sdr-status"}).encode()
    req = urllib.request.Request(RELAY_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Relay-Secret", RELAY_SECRET)
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(resp.read().decode())

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        send_push("Test push", "If you read this on your phone, the relay path works.")
        return
    seen = {}
    disk_warned = False
    missing_warned = False
    start = time.time()
    while True:
        for name in os.listdir(WATCH_FOLDER):
            if not name.lower().endswith(FILE_ENDING):
                continue
            path = os.path.join(WATCH_FOLDER, name)
            size = os.path.getsize(path)
            if size == 0:
                continue
            if name not in seen:
                seen[name] = (size, time.time())
            elif seen[name][0] == size and time.time() - seen[name][1] >= STABLE_SECONDS:
                free_gb = shutil.disk_usage(WATCH_FOLDER).free / 1024 / 1024 / 1024
                send_push("Recording finished", "%s, %.1f MB, %.1f GB free" % (name, size / 1024 / 1024, free_gb))
                del seen[name]
            else:
                seen[name] = (size, time.time())
        free_gb = shutil.disk_usage(WATCH_FOLDER).free / 1024 / 1024 / 1024
        if free_gb < LOW_DISK_GB and not disk_warned:
            send_push("Disk low", "%.1f GB free in %s" % (free_gb, WATCH_FOLDER))
            disk_warned = True
        elif free_gb >= LOW_DISK_GB:
            disk_warned = False
        if EXPECTED_FILE and not missing_warned and EXPECTED_FILE not in os.listdir(WATCH_FOLDER):
            if time.time() - start >= MISSING_MINUTES * 60:
                send_push("Recording missing", "%s not found after %d minutes" % (EXPECTED_FILE, MISSING_MINUTES))
                missing_warned = True
        time.sleep(60)

if __name__ == "__main__":
    main()
