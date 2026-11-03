import json
import os
import shutil
import sys
import time
import urllib.request

# CONFIG: change these five lines only.
RELAY_URL = "https://YOUR-WORKER.workers.dev/push"
RELAY_SECRET = "YOUR-PASSPHRASE"
WATCH_FOLDER = "C:/Recordings"
FILE_ENDING = ".wav"
STABLE_SECONDS = 60

# Pushes are title-only: on my phone, a push with a body is not
# spoken aloud, so everything goes into the title and there is no body.
def send_push(title):
    data = json.dumps({"title": title, "group": "sdr-record"}).encode()
    req = urllib.request.Request(RELAY_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Relay-Secret", RELAY_SECRET)
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(resp.read().decode())

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        send_push("Test push, relay path works")
        return
    seen = {}
    while True:
        for name in os.listdir(WATCH_FOLDER):
            if not name.lower().endswith(FILE_ENDING):
                continue
            path = os.path.join(WATCH_FOLDER, name)
            size = os.path.getsize(path)
            if name not in seen:
                seen[name] = (size, time.time())
            elif seen[name][0] == size and time.time() - seen[name][1] >= STABLE_SECONDS:
                free_gb = shutil.disk_usage(WATCH_FOLDER).free / 1024 / 1024 / 1024
                send_push("Recording finished, %s, %.1f MB, %.1f GB free" % (name, size / 1024 / 1024, free_gb))
                del seen[name]
            else:
                seen[name] = (size, time.time())
        time.sleep(30)

if __name__ == "__main__":
    main()
