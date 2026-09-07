# 客户端实时命令 · HTTP→gRPC 代理方案（历史参考）

> ⚠️ **状态更新（源码实测结论）**：本文件初版基于"客户端实时控制只实现在 gRPC command 上下文、未挂任何 HTTP app"的假设，**该假设已被证伪**。
>
> CIMS 的 management 端口已通过 `account_client` 路由挂载客户端控制接口，原生提供：
> - `POST /account/{acct}/client/{uid}/command/restart`
> - `POST /account/{acct}/client/{uid}/command/update-data`（强制客户端立即拉取最新配置）
> - `POST /account/{acct}/client/{uid}/command/send-notification`
> - `GET  /account/{acct}/client/list`、`/status`、`/{uid}`
>
> 因此**面板可直接调用这些 HTTP 接口，无需自建 HTTP→gRPC 代理**。本文件保留方案 B 仅作"需要自定义命令逻辑或独立部署代理"的参考。

## 方案 B（独立轻量代理，仅特殊场景）

当不直连 CIMS management 端口、或需要在代理层加自定义鉴权/审计时，可新建独立 FastAPI 服务，用 grpcio 客户端连接 CIMS gRPC（:27044），对外提供 REST：

```python
# 伪代码
@app.post("/client/{cid}/restart")
async def restart(cid: str):
    async with grpc.aio.insecure_channel("cims:27044") as ch:
        stub = ClientCommandDeliverStub(ch)
        # 经已建立的 session 下发 RestartApp 命令
        ...
```

优点：不动 CIMS 主干；缺点：需自己维护 session/online 映射（CIMS 已内置，重复造轮子，不推荐）。

## 已知约束

- bidi `ListenCommand` 在 grpcio 1.78 真实 socket 下有边界 bug（评估报告 §2.10）。
  但 `restart` / `update-data` / `send-notification` 是**服务端单向推送命令**（不依赖 bidi 下游回包），不受该 bug 影响，可直接使用。
- `rename` / `disconnect` / `disable` / `enable` / `config` 接口在源码中返回"暂未实现"，属 CIMS 未完工端点，面板已对这类动作做降级/提示处理。
