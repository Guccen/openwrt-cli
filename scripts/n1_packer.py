"""固定 N1 打包器依赖，并在打包末尾应用本项目的设备配置。"""

import argparse
import json
import re
import shutil
from pathlib import Path

from firmware import SOURCES, checkout


def patch_packer(directory, overlay):
    script = directory / "remake"
    text = script.read_text(encoding="utf-8")
    cases = "\n".join(f"        '{url}') revision='{revision}' ;;" for url, revision in SOURCES["n1_packager"]["dependencies"].items())
    function = """git_pull_dir() {
    local repository="${1%.git}" destination="$3" revision
    case "$repository" in
@CASES@
        *) error_msg "依赖仓库没有固定版本：$repository" ;;
    esac
    git -C "$destination" init -q
    git -C "$destination" remote add origin "$repository"
    git -C "$destination" fetch -q --depth=1 origin "$revision" || error_msg "下载固定依赖失败"
    git -C "$destination" checkout -q --detach FETCH_HEAD || error_msg "检出固定依赖失败"
}
""".replace("@CASES@", cases)
    text, count = re.subn(r"(?ms)^git_pull_dir\(\) \{.*?^\}\n", lambda _: function, text)
    if count != 1 or text.count("refactor_rootfs() {") != 1:
        raise ValueError("N1 打包器接口发生变化，需要重新审核补丁")
    text = text.replace("refactor_rootfs() {", "upstream_refactor_rootfs() {")
    # 在上游完成文件替换后再次应用配置，防止模式和管理权限被覆盖。
    hook = """refactor_rootfs() {
    upstream_refactor_rootfs
    python3 "$ROUTER_LITE_ROOT/scripts/n1_packer.py" finalize \
        --directory "$ROUTER_LITE_PACKER" --overlay "$ROUTER_LITE_OVERLAY" \
        --rootfs "$tag_rootfs" || error_msg "轻量配置校验失败"
}

"""
    text, count = re.subn(r"(?m)^clean_tmp\(\) \{", lambda _: hook + "clean_tmp() {", text)
    if count != 1:
        raise ValueError("无法安装 N1 打包完成钩子")
    script.write_text(text, encoding="utf-8", newline="\n")
    # 依赖版本由主锁文件统一提供，构建时不跟随远端分支移动。
    (directory / "router-lite-inputs.json").write_text(json.dumps({"packager": SOURCES["n1_packager"], "overlay": str(overlay)}, indent=2) + "\n", encoding="utf-8")


def bounded_remove(root, path):
    # 只允许清理当前镜像内的文件，符号链接仅删除链接本身。
    if not path.parent.resolve().is_relative_to(root):
        raise ValueError(f"拒绝清理镜像外路径：{path}")
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def finalize(directory, overlay, rootfs):
    expected = (directory / "openwrt/tmp").resolve()
    rootfs = rootfs.resolve()
    if not rootfs.is_relative_to(expected) or rootfs.name != "rootfs":
        raise ValueError("只允许修改打包器临时目录内的根文件系统")
    metadata = json.loads((overlay / "www/device.json").read_text(encoding="utf-8"))
    if metadata["device"] != "phicomm-n1":
        raise ValueError("N1 打包器只能应用 N1 配置")
    shutil.copytree(overlay, rootfs, dirs_exist_ok=True, symlinks=True)
    # N1 当前仅走有线网络；保留 USB 有线网卡可能使用的固件。
    firmware = rootfs / "lib/firmware"
    if firmware.exists():
        for child in firmware.iterdir():
            if child.name != "rtl_nic":
                bounded_remove(rootfs, child)
    modules = rootfs / "etc/modules.d"
    prefixes = ("ath10k", "brcm", "bcmdhd", "rtl818", "rtw88", "rt2500", "rt2800", "rt2x00", "mt76", "mt79", "ssv6051", "rk_", "rknpu", "snd-", "drm-rockchip", "panfrost")
    if modules.is_dir():
        for child in modules.iterdir():
            if child.name.startswith(prefixes):
                bounded_remove(rootfs, child)
    startup = rootfs / "etc/rc.local"
    if startup.is_file():
        lines = startup.read_text(encoding="utf-8").splitlines()
        startup.write_text("\n".join(line for line in lines if "/etc/custom_service/start_service.sh" not in line) + "\n", encoding="utf-8")
    bounded_remove(rootfs, rootfs / "etc/custom_service")
    # 首版保留配套内核模块，不按文件名盲目删除模块及其依赖。
    if metadata["role"] == "router":
        module_files = list((rootfs / "lib/modules").rglob("r8152.ko*"))
        if not module_files:
            raise ValueError("主路由镜像缺少 RTL8152/8153 USB 网卡驱动")
    (rootfs / "etc/uci-defaults/zz-router-lite").chmod(0o755)
    for name in ("rpcd", "uhttpd", "network", "dhcp"):
        if (rootfs / f"etc/config/{name}").read_bytes() != (overlay / f"etc/config/{name}").read_bytes():
            raise ValueError(f"设备配置未生效：{name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "finalize"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--overlay", type=Path, required=True)
    parser.add_argument("--rootfs", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.command == "prepare":
        lock = SOURCES["n1_packager"]
        checkout(lock["url"], lock["revision"], directory)
        patch_packer(directory, args.overlay.resolve())
    else:
        if args.rootfs is None:
            parser.error("必须提供镜像根目录")
        finalize(directory, args.overlay.resolve(), args.rootfs)


if __name__ == "__main__":
    main()
