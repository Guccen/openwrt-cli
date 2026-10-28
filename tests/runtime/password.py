"""仅在独立 QEMU 设备修改临时 root 密码，不记录密码或 shadow 内容。"""
import json
import os
import secrets

from configuration import Api, RpcFailure
from maintenance import expect_rejected, maintenance
from simulation import REPORT, ssh


def login_with(address, password):
    api = Api(address)
    api.sid = api.call("session", "login", {"username": "root", "password": password, "timeout": 300})["ubus_rpc_session"]
    return api


def expect_expired(api):
    try:
        api.call("system", "info")
    except RpcFailure as error:
        if error.code not in (6, -32001, -32002):
            raise
    else:
        raise AssertionError("修改密码后原网页会话仍可访问")


def run(address):
    original = os.environ["SIM_PASSWORD"]
    updated = "Change-" + secrets.token_hex(16)
    api = login_with(address, original)
    other = login_with(address, original)
    args = {"current": original, "password": updated, "confirmation": updated}
    try:
        maintenance(Api(address), "password", args)
    except RpcFailure as error:
        if error.code not in (6, -32002):
            raise
    else:
        raise AssertionError("未登录不能修改密码")
    expect_rejected(api, "password", "current_password_incorrect", {**args, "current": "incorrect-fixture"})
    expect_rejected(api, "password", "password_mismatch", {**args, "confirmation": "different"})
    expect_rejected(api, "password", "invalid_password", {**args, "password": "short", "confirmation": "short"})
    section = next(name for name, values in api.values("dhcp").items() if values.get(".type") == "dnsmasq")
    api.set("dhcp", section, {"server": ["192.0.2.53"]})
    expect_rejected(other, "password", "configuration_busy", args)
    api.call("uci", "revert", {"config": "dhcp"})
    try:
        result = maintenance(api, "password", args)
        if not result.get("changed") or result.get("sessionsRevoked") is not True:
            raise AssertionError(f"设备没有完成密码修改及旧会话清理：ok={result.get('ok')}, changed={result.get('changed')}, revoked={result.get('sessionsRevoked')}, error={result.get('error')}")
        expect_expired(api)
        expect_expired(other)
        try:
            login_with(address, original)
        except RpcFailure:
            pass
        else:
            raise AssertionError("修改后旧密码仍可登录")
        fresh = login_with(address, updated)
        fresh.call("system", "info")
        restored = maintenance(fresh, "password", {"current": updated, "password": original, "confirmation": original})
        if not restored.get("changed") or restored.get("sessionsRevoked") is not True:
            raise AssertionError("无法通过维护接口还原测试密码")
        login_with(address, original).call("system", "info")
    finally:
        # 即使断言失败，也通过临时 SSH 密钥把密码还原，不输出明文。
        ssh(address, "passwd root", input=original + "\n" + original + "\n", capture_output=True)
    report = {name: "passed" for name in ("anonymous_denied", "current_password_checked", "confirmation_checked", "staged_configuration_guard", "password_changed", "old_password_denied", "new_password_login", "all_root_sessions_revoked", "password_roundtrip")}
    (REPORT / "password.json").write_text(json.dumps(report, indent=2) + "\n")
    print("登录密码修改、旧密码失效、所有 root 网页会话退出及测试密码恢复通过")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"])
