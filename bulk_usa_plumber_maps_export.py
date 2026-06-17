import ast
import asyncio
import csv
import json
import math
import os
import re
import time
from collections import deque
from datetime import datetime
from pathlib import Path

import aiohttp


DESKTOP = Path(r"C:\Users\User\Desktop")
PERMISSIONS_FILE = DESKTOP / "gemini_key_permissions.json"
EXTRACTED_KEYS_FILE = DESKTOP / "google_maps_gemini_keys.json"
DENTIST_SCRIPT = DESKTOP / "recent_python_files_20260614" / "dentist_leads_usa.py"

TARGET = 10_000
KEYWORD = "plumber"
RADIUS = 16_000
MAX_PAGES = 3
POINT_WORKERS = 36
DETAIL_WORKERS = 90
REQUEST_TIMEOUT = 18
CHECKPOINT_EVERY = 500

PLACE_DETAILS_FIELDS = (
    "name,formatted_address,formatted_phone_number,international_phone_number,"
    "website,rating,user_ratings_total,opening_hours,types,geometry,business_status,url"
)

STAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
PROGRESS_CSV = DESKTOP / f"usa_plumber_leads_progress_{STAMP}.csv"
FINAL_CSV = DESKTOP / f"usa_plumber_leads_10000_{STAMP}.csv"
FINAL_JSON = DESKTOP / f"usa_plumber_leads_10000_{STAMP}.json"
RUN_LOG_JSON = DESKTOP / f"usa_plumber_leads_run_log_{STAMP}.json"

CSV_FIELDS = [
    "name",
    "address",
    "phone",
    "international_phone",
    "website",
    "rating",
    "reviews",
    "status",
    "open_now",
    "hours",
    "types",
    "lat",
    "lng",
    "place_id",
    "google_maps_url",
    "search_city",
    "search_point",
]


def load_keys() -> tuple[list[str], dict]:
    verified = []
    fallback = []
    if PERMISSIONS_FILE.exists():
        raw = json.loads(PERMISSIONS_FILE.read_text(encoding="utf-8"))
        verified = [
            row["key"]
            for row in raw
            if row.get("key") and "Maps Places" in row.get("working_apis", [])
        ]
    if EXTRACTED_KEYS_FILE.exists():
        raw = json.loads(EXTRACTED_KEYS_FILE.read_text(encoding="utf-8"))
        fallback = [
            row["key"]
            for row in raw.get("keys", [])
            if row.get("key") and "google_maps" in row.get("services", [])
        ]

    keys = []
    seen = set()
    for key in verified + fallback:
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys, {
        "verified_maps_places_keys": len(set(verified)),
        "fallback_maps_context_keys": len(set(fallback) - set(verified)),
        "total_candidate_keys": len(keys),
    }


def load_cities() -> list[tuple[str, bool]]:
    source = DENTIST_SCRIPT.read_text(encoding="utf-8", errors="ignore")
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "US_CITIES":
                    cities = ast.literal_eval(node.value)
                    cleaned = []
                    seen = set()
                    for city, grid in cities:
                        city = str(city).strip()
                        if city and city not in seen:
                            seen.add(city)
                            cleaned.append((city, bool(grid)))
                    return cleaned
    raise RuntimeError(f"Could not find US_CITIES in {DENTIST_SCRIPT}")


def grid_offsets(use_big_grid: bool) -> list[tuple[float, float]]:
    if use_big_grid:
        values = [-0.24, -0.12, 0.0, 0.12, 0.24]
        return [(lat, lng) for lat in values for lng in values]
    return [
        (0.0, 0.0),
        (0.12, 0.0),
        (-0.12, 0.0),
        (0.0, 0.16),
        (0.0, -0.16),
        (0.12, 0.16),
        (-0.12, -0.16),
    ]


def mask_key(key: str) -> str:
    return f"{key[:10]}...{key[-4:]}" if len(key) > 14 else key


class KeyRotator:
    def __init__(self, keys: list[str]):
        self._keys = deque(keys)
        self._lock = asyncio.Lock()
        self._cooldown: dict[str, float] = {}
        self._disabled: set[str] = set()
        self._stats = {
            key: {"ok": 0, "over_query_limit": 0, "request_denied": 0, "http_errors": 0, "other_errors": 0}
            for key in keys
        }

    async def get(self) -> str:
        while True:
            async with self._lock:
                now = time.time()
                active = [k for k in self._keys if k not in self._disabled]
                if not active:
                    raise RuntimeError("All API keys were disabled or rejected")
                soonest = None
                for _ in range(len(self._keys)):
                    key = self._keys[0]
                    self._keys.rotate(-1)
                    if key in self._disabled:
                        continue
                    resume = self._cooldown.get(key, 0)
                    if resume <= now:
                        return key
                    soonest = resume if soonest is None else min(soonest, resume)
                sleep_for = max(0.2, (soonest or (now + 1)) - now)
            await asyncio.sleep(min(sleep_for, 3.0))

    async def ok(self, key: str) -> None:
        async with self._lock:
            self._stats[key]["ok"] += 1
            self._cooldown.pop(key, None)

    async def over_limit(self, key: str, delay: float = 8.0) -> None:
        async with self._lock:
            self._stats[key]["over_query_limit"] += 1
            self._cooldown[key] = time.time() + delay

    async def denied(self, key: str) -> None:
        async with self._lock:
            self._stats[key]["request_denied"] += 1
            # Context-only fallback keys may fail Maps restrictions; keep the pool clean.
            if self._stats[key]["request_denied"] >= 2:
                self._disabled.add(key)

    async def http_error(self, key: str) -> None:
        async with self._lock:
            self._stats[key]["http_errors"] += 1
            self._cooldown[key] = time.time() + 4.0

    async def other_error(self, key: str) -> None:
        async with self._lock:
            self._stats[key]["other_errors"] += 1
            self._cooldown[key] = time.time() + 2.0

    async def snapshot(self) -> dict:
        async with self._lock:
            return {
                "active_keys": len([k for k in self._keys if k not in self._disabled]),
                "disabled_keys": len(self._disabled),
                "key_stats_masked": {mask_key(k): v for k, v in self._stats.items()},
            }


async def api_get(session: aiohttp.ClientSession, rotator: KeyRotator, url: str, params: dict, retries: int = 7) -> dict:
    last = {}
    for attempt in range(retries):
        key = await rotator.get()
        query = dict(params)
        query["key"] = key
        try:
            async with session.get(url, params=query, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)) as response:
                try:
                    data = await response.json(content_type=None)
                except Exception:
                    data = {"status": f"HTTP_{response.status}", "error_message": await response.text()}
                status = data.get("status", "")
                last = data
                if response.status >= 500:
                    await rotator.http_error(key)
                    await asyncio.sleep(0.4 * (attempt + 1))
                    continue
                if status in ("OK", "ZERO_RESULTS"):
                    await rotator.ok(key)
                    return data
                if status == "OVER_QUERY_LIMIT":
                    await rotator.over_limit(key, delay=6.0 + attempt)
                    await asyncio.sleep(0.25 * (attempt + 1))
                    continue
                if status == "REQUEST_DENIED":
                    await rotator.denied(key)
                    await asyncio.sleep(0.15)
                    continue
                if status == "INVALID_REQUEST" and "pagetoken" in params:
                    await asyncio.sleep(2.2)
                    continue
                return data
        except (aiohttp.ClientError, asyncio.TimeoutError):
            await rotator.other_error(key)
            await asyncio.sleep(0.3 * (attempt + 1))
    return last


async def geocode_city(session: aiohttp.ClientSession, rotator: KeyRotator, city: str) -> tuple[float | None, float | None]:
    data = await api_get(
        session,
        rotator,
        "https://maps.googleapis.com/maps/api/geocode/json",
        {"address": f"{city}, USA"},
    )
    results = data.get("results", [])
    if not results:
        return None, None
    location = results[0]["geometry"]["location"]
    return float(location["lat"]), float(location["lng"])


async def nearby_page(
    session: aiohttp.ClientSession,
    rotator: KeyRotator,
    lat: float,
    lng: float,
    token: str | None = None,
) -> tuple[list[dict], str | None]:
    if token:
        await asyncio.sleep(2.2)
        params = {"pagetoken": token}
    else:
        params = {
            "location": f"{lat:.6f},{lng:.6f}",
            "radius": RADIUS,
            "keyword": KEYWORD,
        }
    data = await api_get(session, rotator, "https://maps.googleapis.com/maps/api/place/nearbysearch/json", params)
    return data.get("results", []), data.get("next_page_token")


async def detail_for_place(session: aiohttp.ClientSession, rotator: KeyRotator, place_id: str) -> dict:
    data = await api_get(
        session,
        rotator,
        "https://maps.googleapis.com/maps/api/place/details/json",
        {"place_id": place_id, "fields": PLACE_DETAILS_FIELDS},
        retries=8,
    )
    return data.get("result", {})


def flatten(stub: dict, detail: dict) -> dict:
    geometry = detail.get("geometry") or stub.get("geometry") or {}
    location = geometry.get("location") or {}
    opening = detail.get("opening_hours") or {}
    hours = opening.get("weekday_text") or []
    return {
        "name": detail.get("name") or stub.get("name", ""),
        "address": detail.get("formatted_address") or stub.get("vicinity", ""),
        "phone": detail.get("formatted_phone_number", ""),
        "international_phone": detail.get("international_phone_number", ""),
        "website": detail.get("website", ""),
        "rating": detail.get("rating") or stub.get("rating", ""),
        "reviews": detail.get("user_ratings_total") or stub.get("user_ratings_total", ""),
        "status": detail.get("business_status") or stub.get("business_status", ""),
        "open_now": str(opening.get("open_now", "")),
        "hours": " | ".join(hours),
        "types": ", ".join(detail.get("types") or stub.get("types", [])),
        "lat": location.get("lat", ""),
        "lng": location.get("lng", ""),
        "place_id": stub.get("place_id", ""),
        "google_maps_url": detail.get("url", ""),
        "search_city": stub.get("_search_city", ""),
        "search_point": stub.get("_search_point", ""),
    }


def write_csv(path: Path, rows: list[dict]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp, path)


async def collect_stubs(session: aiohttp.ClientSession, rotator: KeyRotator, points: list[dict]) -> list[dict]:
    seen_ids = set()
    stubs = []
    lock = asyncio.Lock()
    stop = asyncio.Event()
    queue = asyncio.Queue()
    for point in points:
        queue.put_nowait(point)

    async def worker(worker_id: int) -> None:
        while not stop.is_set():
            try:
                point = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            token = None
            try:
                for _ in range(MAX_PAGES):
                    page, token = await nearby_page(session, rotator, point["lat"], point["lng"], token)
                    fresh = 0
                    async with lock:
                        for place in page:
                            pid = place.get("place_id")
                            if not pid or pid in seen_ids:
                                continue
                            seen_ids.add(pid)
                            place["_search_city"] = point["city"]
                            place["_search_point"] = f'{point["lat"]:.5f},{point["lng"]:.5f}'
                            stubs.append(place)
                            fresh += 1
                        if len(stubs) >= math.ceil(TARGET * 1.08):
                            stop.set()
                    if not token or stop.is_set():
                        break
                if worker_id == 0 or len(stubs) % 1000 < 40:
                    print(f"[stubs] {len(stubs)} unique collected | latest +{fresh} from {point['city']}", flush=True)
            finally:
                queue.task_done()

    await asyncio.gather(*(worker(i) for i in range(POINT_WORKERS)))
    return stubs


async def enrich_stubs(session: aiohttp.ClientSession, rotator: KeyRotator, stubs: list[dict]) -> list[dict]:
    selected = stubs[:TARGET]
    queue = asyncio.Queue()
    for stub in selected:
        queue.put_nowait(stub)

    rows = []
    rows_lock = asyncio.Lock()

    async def worker() -> None:
        while True:
            try:
                stub = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            try:
                detail = await detail_for_place(session, rotator, stub["place_id"])
                row = flatten(stub, detail)
                async with rows_lock:
                    rows.append(row)
                    count = len(rows)
                    if count % CHECKPOINT_EVERY == 0:
                        write_csv(PROGRESS_CSV, rows)
                        print(f"[details] {count}/{len(selected)} enriched -> {PROGRESS_CSV}", flush=True)
            finally:
                queue.task_done()

    await asyncio.gather(*(worker() for _ in range(DETAIL_WORKERS)))
    return rows[:TARGET]


async def build_points(session: aiohttp.ClientSession, rotator: KeyRotator) -> tuple[list[dict], list[str]]:
    cities = load_cities()
    points = []
    failed = []
    print(f"[setup] geocoding {len(cities)} city anchors", flush=True)
    for index, (city, use_big_grid) in enumerate(cities, 1):
        lat, lng = await geocode_city(session, rotator, city)
        if lat is None:
            failed.append(city)
            continue
        for dlat, dlng in grid_offsets(use_big_grid):
            points.append({"city": city, "lat": lat + dlat, "lng": lng + dlng})
        if index % 25 == 0:
            print(f"[setup] geocoded {index}/{len(cities)} cities -> {len(points)} search points", flush=True)
    return points, failed


async def main() -> None:
    keys, key_counts = load_keys()
    if not keys:
        raise SystemExit("No Maps keys found in Desktop key files")

    rotator = KeyRotator(keys)
    started = time.time()
    print(f"[start] target={TARGET} keyword={KEYWORD!r}", flush=True)
    print(f"[keys] {key_counts}", flush=True)
    print(f"[out] progress_csv={PROGRESS_CSV}", flush=True)

    connector = aiohttp.TCPConnector(limit=POINT_WORKERS + DETAIL_WORKERS + 40, ssl=False)
    async with aiohttp.ClientSession(connector=connector, headers={"User-Agent": "Mozilla/5.0"}) as session:
        points, failed_cities = await build_points(session, rotator)
        print(f"[setup] {len(points)} search points ready | failed city geocodes={len(failed_cities)}", flush=True)

        stubs = await collect_stubs(session, rotator, points)
        print(f"[stubs] finished with {len(stubs)} unique candidate places", flush=True)

        rows = await enrich_stubs(session, rotator, stubs)
        rows = rows[:TARGET]

    write_csv(FINAL_CSV, rows)
    FINAL_JSON.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    key_snapshot = await rotator.snapshot()
    run_log = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "target": TARGET,
        "keyword": KEYWORD,
        "rows_saved": len(rows),
        "candidate_stubs": len(stubs),
        "key_counts": key_counts,
        "failed_city_geocodes": failed_cities,
        "duration_seconds": round(time.time() - started, 2),
        "final_csv": str(FINAL_CSV),
        "final_json": str(FINAL_JSON),
        "progress_csv": str(PROGRESS_CSV),
        "rotator": key_snapshot,
        "quality_counts": {
            "with_phone": sum(1 for row in rows if row.get("phone")),
            "with_website": sum(1 for row in rows if row.get("website")),
            "with_google_maps_url": sum(1 for row in rows if row.get("google_maps_url")),
        },
    }
    RUN_LOG_JSON.write_text(json.dumps(run_log, indent=2), encoding="utf-8")
    print(json.dumps({k: run_log[k] for k in ["rows_saved", "candidate_stubs", "duration_seconds", "final_csv", "final_json", "progress_csv", "quality_counts"]}, indent=2), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
