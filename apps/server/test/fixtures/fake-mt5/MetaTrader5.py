"""MetaTrader5 ปลอม สำหรับเทสต์ tools/mt5/mt5_export.py บนเครื่องที่ไม่มี MT5
จำลองเซิร์ฟเวอร์แบบ New York close: เวลาแท่ง = เวลา UTC + 2 ชม. (หน้าหนาว) / + 3 ชม. (US DST)"""
from datetime import datetime, timezone

TIMEFRAME_M1 = 1
TIMEFRAME_M5 = 5
TIMEFRAME_M10 = 10
TIMEFRAME_M15 = 15
TIMEFRAME_M30 = 30
TIMEFRAME_H1 = 60
TIMEFRAME_H2 = 120
TIMEFRAME_H4 = 240
TIMEFRAME_D1 = 1440
TIMEFRAME_W1 = 10080

class _Sym:
    def __init__(self, name, description):
        self.name = name
        self.description = description

_SYMBOLS = [_Sym("GOLD", "Gold vs US Dollar"), _Sym("EURUSD", "Euro vs US Dollar")]

def initialize(*a, **k):
    return True

def shutdown():
    pass

def last_error():
    return (1, "ok")

def symbol_select(name, enable):
    return any(s.name == name for s in _SYMBOLS)

def symbols_get(pattern="*"):
    p = pattern.strip("*").upper()
    return [s for s in _SYMBOLS if p in s.name]

def copy_rates_range(symbol, tf, date_from, date_to):
    # date_from/date_to = เวลาเซิร์ฟเวอร์ (สคริปต์บวก offset มาแล้ว) ในรูป datetime aware UTC
    start = int(date_from.timestamp()) // 60 * 60
    end = int(date_to.timestamp())
    rows = []
    t = start
    price = 2650.0
    while t < end:
        rows.append({"time": t, "open": price, "high": price + 1, "low": price - 1, "close": price + 0.5, "tick_volume": 42})
        price += 0.5
        t += tf * 60
    return rows


class _Info:
    def __init__(self, **kw):
        self.__dict__.update(kw)


_SPECS = {
    "GOLD": dict(trade_contract_size=100.0, trade_tick_size=0.01, trade_tick_value=1.0, volume_min=0.01,
                 volume_step=0.01, volume_max=50.0, digits=2, currency_base="XAU", currency_profit="USD", spread=25),
    "EURUSD": dict(trade_contract_size=100000.0, trade_tick_size=0.00001, trade_tick_value=1.0, volume_min=0.01,
                   volume_step=0.01, volume_max=50.0, digits=5, currency_base="EUR", currency_profit="USD", spread=8),
}


def symbol_info(name):
    spec = _SPECS.get(name)
    return _Info(name=name, **spec) if spec else None


def account_info():
    return _Info(currency="USD", leverage=1000, balance=10000.0)
