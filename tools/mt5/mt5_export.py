"""
ดึงแท่งเทียนจาก MetaTrader 5 (เช่นบัญชี XM) แล้วพิมพ์ออกมาเป็น JSON ทีละบรรทัด (เวลา UTC)
zonedee เรียกสคริปต์นี้เองตอน `npm run fetch` ถ้าตั้ง FOREX_SOURCE = 'mt5'

ใช้เอง:
  python tools/mt5/mt5_export.py --list GOLD
  python tools/mt5/mt5_export.py --info GOLD
  python tools/mt5/mt5_export.py --symbol GOLD --timeframe M1 --from 2026-10-01T00:00:00Z --to 2026-10-02T00:00:00Z

ต้องมี: Windows + MT5 desktop ที่ login ค้างไว้ + `pip install MetaTrader5`

เรื่องเวลา: MT5 เก็บเวลาแท่งเป็น "เวลาเซิร์ฟเวอร์" ของโบรก ไม่ใช่ UTC
XM ใช้แบบ New York close คือ GMT+2 ช่วงหน้าหนาว / GMT+3 ช่วง US daylight saving
สคริปต์นี้แปลงกลับเป็น UTC ให้ (เปลี่ยนได้ด้วย --offset <ชั่วโมง> ถ้าโบรกใช้แบบอื่น)
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass


def fail(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    sys.exit(code)


try:
    import MetaTrader5 as mt5  # type: ignore
except ImportError:
    fail("ยังไม่ได้ติดตั้งแพ็กเกจ MetaTrader5 — รัน: pip install MetaTrader5", 2)


TIMEFRAMES = {
    "M1": "TIMEFRAME_M1",
    "M5": "TIMEFRAME_M5",
    "M10": "TIMEFRAME_M10",
    "M15": "TIMEFRAME_M15",
    "M30": "TIMEFRAME_M30",
    "H1": "TIMEFRAME_H1",
    "H2": "TIMEFRAME_H2",
    "H4": "TIMEFRAME_H4",
    "D1": "TIMEFRAME_D1",
    "W1": "TIMEFRAME_W1",
}


def _nth_sunday(year: int, month: int, n: int) -> datetime:
    d = datetime(year, month, 1, tzinfo=timezone.utc)
    first_sunday = d + timedelta(days=(6 - d.weekday()) % 7)
    return first_sunday + timedelta(weeks=n - 1)


def us_dst_active(utc: datetime) -> bool:
    """US daylight saving: อาทิตย์ที่ 2 ของ มี.ค. 02:00 EST (07:00 UTC) ถึงอาทิตย์แรกของ พ.ย. 02:00 EDT (06:00 UTC)"""
    start = _nth_sunday(utc.year, 3, 2) + timedelta(hours=7)
    end = _nth_sunday(utc.year, 11, 1) + timedelta(hours=6)
    return start <= utc < end


def ny_close_offset_hours(utc: datetime) -> int:
    """ออฟเซ็ตเวลาเซิร์ฟเวอร์แบบ New York close (XM): +3 ช่วง DST, +2 นอกช่วง"""
    return 3 if us_dst_active(utc) else 2


def server_to_utc_seconds(server_ts: int, fixed_offset: float | None) -> int:
    if fixed_offset is not None:
        return int(server_ts - fixed_offset * 3600)
    # เดา UTC ด้วย +2 ก่อน แล้วค่อยเช็กว่าช่วงนั้นเป็น DST ไหม
    approx = datetime.fromtimestamp(server_ts - 2 * 3600, tz=timezone.utc)
    return server_ts - ny_close_offset_hours(approx) * 3600


def utc_to_server(dt: datetime, fixed_offset: float | None) -> datetime:
    off = fixed_offset if fixed_offset is not None else ny_close_offset_hours(dt)
    return dt + timedelta(hours=off)


def parse_time(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def connect() -> None:
    if not mt5.initialize():
        err = mt5.last_error()
        fail(
            f"เชื่อมต่อ MT5 ไม่ได้ ({err}) — เปิดโปรแกรม MT5 และ login บัญชี XM ไว้ก่อน "
            "(ถ้าลง MT5 หลายตัว ปิดตัวอื่นให้เหลือตัวของ XM)",
            3,
        )


def list_symbols(pattern: str) -> None:
    connect()
    found = mt5.symbols_get(f"*{pattern}*") or []
    if not found:
        fail(f"ไม่เจอ symbol ที่มีคำว่า '{pattern}'", 4)
    for s in found:
        print(f"{s.name}\t{s.description}")
    mt5.shutdown()


def info(symbol: str) -> None:
    """สเปกสัญญา + ข้อมูลบัญชี เป็น JSON บรรทัดเดียว (ใช้ในเครื่องคิด lot)"""
    connect()
    if not mt5.symbol_select(symbol, True):
        fail(f"ไม่เจอ symbol '{symbol}' ใน MT5 (แก้ชื่อใน apps/server/src/symbols.ts)", 4)
    s = mt5.symbol_info(symbol)
    a = mt5.account_info()
    if s is None:
        fail(f"อ่านข้อมูล symbol ไม่ได้ ({mt5.last_error()})", 6)
    account_currency = a.currency if a else "USD"
    swap_mode_raw = getattr(s, "swap_mode", 1)
    swap_mode = "points"
    if swap_mode_raw == 0:
        swap_mode = "disabled"
    elif swap_mode_raw in (2, 3, 4):
        swap_mode = "money"
    elif swap_mode_raw in (5, 6):
        swap_mode = "percent"

    print(
        json.dumps(
            {
                "symbol": s.name,
                "contractSize": float(s.trade_contract_size),
                "tickSize": float(s.trade_tick_size),
                "tickValue": float(s.trade_tick_value),
                "volumeMin": float(s.volume_min),
                "volumeStep": float(s.volume_step),
                "volumeMax": float(s.volume_max),
                "digits": int(s.digits),
                "currencyBase": s.currency_base,
                "currencyProfit": s.currency_profit,
                "spreadPoints": int(getattr(s, "spread", 0) or 0),
                "accountCurrency": account_currency,
                "leverage": int(a.leverage) if a else None,
                "balance": float(a.balance) if a else None,
                "swapLong": float(getattr(s, "swap_long", 0.0) or 0.0),
                "swapShort": float(getattr(s, "swap_short", 0.0) or 0.0),
                "swapMode": swap_mode,
                "swap3Day": int(getattr(s, "swap_rollover3days", 3) or 3),
            },
            ensure_ascii=False,
        )
    )
    mt5.shutdown()


def export(symbol: str, tf: str, start: datetime, end: datetime, fixed_offset: float | None) -> None:
    if tf not in TIMEFRAMES:
        fail(f"timeframe ไม่รองรับ: {tf}", 5)
    connect()
    if not mt5.symbol_select(symbol, True):
        base = symbol.rstrip("#.m")[:6]
        names = [s.name for s in (mt5.symbols_get(f"*{base}*") or [])][:10]
        hint = f" — ชื่อที่ใกล้เคียง: {', '.join(names)}" if names else ""
        fail(f"ไม่เจอ symbol '{symbol}' ใน MT5{hint} (แก้ชื่อใน apps/server/src/symbols.ts)", 4)

    rates = mt5.copy_rates_range(
        symbol,
        getattr(mt5, TIMEFRAMES[tf]),
        utc_to_server(start, fixed_offset),
        utc_to_server(end, fixed_offset),
    )
    if rates is None:
        fail(f"MT5 ไม่ส่งข้อมูลกลับมา ({mt5.last_error()})", 6)

    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    out = sys.stdout
    for r in rates:
        t_ms = server_to_utc_seconds(int(r["time"]), fixed_offset) * 1000
        if t_ms < start_ms or t_ms >= end_ms:
            continue
        out.write(
            json.dumps(
                {
                    "t": t_ms,
                    "o": float(r["open"]),
                    "h": float(r["high"]),
                    "l": float(r["low"]),
                    "c": float(r["close"]),
                    "v": float(r["tick_volume"]),
                },
                separators=(",", ":"),
            )
            + "\n"
        )
    mt5.shutdown()


def main() -> None:
    p = argparse.ArgumentParser(description="ดึงแท่งเทียนจาก MT5 เป็น JSON lines (UTC)")
    p.add_argument("--list", metavar="PATTERN", help="แสดงชื่อ symbol ที่มีคำนี้ เช่น GOLD")
    p.add_argument("--info", metavar="SYMBOL", help="สเปกสัญญา + leverage + ยอดเงิน เป็น JSON")
    p.add_argument("--symbol")
    p.add_argument("--timeframe", default="M1")
    p.add_argument("--from", dest="start")
    p.add_argument("--to", dest="end")
    p.add_argument("--offset", type=float, default=None, help="ออฟเซ็ตเวลาเซิร์ฟเวอร์คงที่ (ชั่วโมง) แทนแบบ NY close")
    a = p.parse_args()

    if a.list:
        list_symbols(a.list)
        return
    if a.info:
        info(a.info)
        return
    if not (a.symbol and a.start and a.end):
        fail("ต้องระบุ --symbol --from --to (หรือใช้ --list)", 1)
    export(a.symbol, a.timeframe.upper(), parse_time(a.start), parse_time(a.end), a.offset)


if __name__ == "__main__":
    main()
