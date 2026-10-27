# /backtest

รัน Backtest หรือ Grid Search Tuning ผ่าน CLI:
```bash
npx.cmd tsx apps/server/src/backtest-cli.ts $ARGUMENTS
```
ตัวอย่าง:
- `npx.cmd tsx apps/server/src/backtest-cli.ts --all` (เทียบทุกท่า)
- `npx.cmd tsx apps/server/src/backtest-cli.ts --symbol XAUUSD --tf M15 --strategy sk-fibo --tune` (จูนพารามิเตอร์)
