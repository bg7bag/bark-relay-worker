import json
import os
import sys
import time
import urllib.request

# CONFIG: change these lines only.
RELAY_URL = "https://YOUR-WORKER.workers.dev/push"
RELAY_SECRET = "YOUR-PASSPHRASE"
WATCH_FOLDER = "C:/Recordings"
FILE_ENDING = ".wav"
COOLDOWN_SECONDS = 600
REPEATER_NAME = "YOUR-REPEATER-FREQUENCY"

def send_push(title, body):
    data = json.dumps({"title": title, "body": body, "group": "sdr-repeater"}).encode()
    req = urllib.request.Request(RELAY_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Relay-Secret", RELAY_SECRET)
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(resp.read().decode())

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        send_push("Test push", "If you read this on your phone, the relay path works.")
        return
    known = set(os.listdir(WATCH_FOLDER))
    last_push = 0
    while True:
        current = set(os.listdir(WATCH_FOLDER))
        for name in sorted(current - known):
            if name.lower().endswith(FILE_ENDING) and time.time() - last_push >= COOLDOWN_SECONDS:
                send_push("Repeater traffic", "%s, %s" % (REPEATER_NAME, name))
                last_push = time.time()
        known = current
        time.sleep(30)

if __name__ == "__main__":
    main()
