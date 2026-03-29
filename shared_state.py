import redis
import json
import os
import time

r = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379)
NODE_ID = os.getenv("NODE_ID", "node_default")

def publish_weights(weights):
    r.set("global_weights", json.dumps(weights))

def get_weights():
    data = r.get("global_weights")
    return json.loads(data) if data else None

def publish_pnl(pnl):
    r.hset("pnl_table", NODE_ID, pnl)

def get_all_pnl():
    return {k.decode(): float(v) for k, v in r.hgetall("pnl_table").items()}

def heartbeat():
    r.set(f"heartbeat:{NODE_ID}", time.time(), ex=10)

def get_alive_nodes():
    now = time.time()
    keys = r.keys("heartbeat:*")
    alive = []
    for k in keys:
        t = float(r.get(k))
        if now - t < 10:
            alive.append(k.decode().split(":")[1])
    return alive

def is_master():
    alive = get_alive_nodes()
    return sorted(alive)[0] == NODE_ID if alive else False

def master_only_task():
    return is_master()
