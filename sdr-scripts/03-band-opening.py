import json
import os
import sys
import time
import urllib.request

# CONFIG: change these lines only.
RELAY_URL = "https://YOUR-WORKER.workers.dev/push"
RELAY_SECRET = "YOUR-PASSPHRASE"
LOG_FILE = "C:/Users/YOUR-NAME/AppData/Local/WSJT-X/ALL.txt"
WANTED_FREQ = "14.074"
WANTED_MODE = "FT8"
WANTED_TEXT = "YOUR-WANTED-CALL-OR-PREFIX"
COOLDOWN_SECONDS = 600

def send_push(title, body):
    data = json.dumps({"title": title, "body": body, "group": "sdr-dx"}).encode()
    req = urllib.request.Request(RELAY_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Relay-Secret", RELAY_SECRET)
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(resp.read().decode())

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        send_push("Test push", "If you read this on your phone, the relay path works.")
        return
    pos = os.path.getsize(LOG_FILE)
    last_push = 0
    while True:
        size = os.path.getsize(LOG_FILE)
        if size < pos:
            pos = 0
        if size > pos:
            with open(LOG_FILE, "r", errors="ignore") as f:
                f.seek(pos)
                for line in f:
                    if WANTED_FREQ in line and WANTED_MODE in line and WANTED_TEXT in line:
                        if time.time() - last_push >= COOLDOWN_SECONDS:
                            send_push("Band open", line.strip()[:120])
                            last_push = time.time()
            pos = size
        time.sleep(15)

if __name__ == "__main__":
    main()
