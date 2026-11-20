# TERM-013 + DATA-009 24h 浸泡启动命令（2026-11-20）
cd /Users/sunny/code/agent-basis-rc5
nohup node scripts/soak-rc5.mjs --suite both --duration 24h --interval 60s --db-interval 5m --writers 2 --container eterna-rc5-e1 --data-root "$HOME/eterna-data/test-rc5/e1" --out artifacts/rc5/p5/testbed/soak --tag 24h > artifacts/rc5/p5/testbed/soak/console-24h.log 2>&1 &
echo $! > artifacts/rc5/p5/testbed/soak/soak.pid
