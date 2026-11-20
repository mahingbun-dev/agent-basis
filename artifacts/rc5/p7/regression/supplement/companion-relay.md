# RC5 补充回归面 · companion 中继协议实测（54 §5.5）

- 环境：E2 lane `rc5-e2suite`（3119）+ relay `ws://127.0.0.1:9322/extension`
- 方法：access 令牌视图/reset → relay /extension 腿凭据校验 → hello 握手 → /api/status 在线探测 → 断开回收

## 结论

**PASS**（协议级）。

- PASS · companion 视图：匿名 401（status=401）
- PASS · companion reset：签发本人令牌 + guideUrl（status=200 token=issued guide=http://127.0.0.1:9310/companion/guide）
- PASS · relay /extension：错误令牌被拒（连接关闭）（closed=true code=1006）
- PASS · relay /extension：正确令牌握手（WS open）
- PASS · relay /api/status：tokenConnected=true（命名空间=令牌）（{
          "extensionConnected": true,
          "extVersion": "0.0.0-sim",
          "chromeVersion": "test",
          "tabCount": 0,
          "cdpConnected": false,
          "connectedBrowsers": 1,
          "browsers": [
                    {
                              "extVersion": "0.0.0-sim",
                              "chromeVersion": "test",
                              "tabCoun）
- PASS · relay /api/status：extensionConnected=true + browsers≥1（connectedBrowsers=1）
- PASS · relay /api/status：断开后 tokenConnected=false（tokenConnected=false）

## 边界

- **REAL-EXT = NOTRUN**：真实 Chrome 扩展需交互式加载未打包扩展（developer mode / 持久 profile）；本验收为无人值守 headless 环境，不以仿真冒充实测。
- 产品代码面已覆盖：令牌签发/视图归属、错误令牌拒绝、命名空间=令牌、在线探测与断开回收。