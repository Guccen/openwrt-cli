// 仅规划本项目的 N1 双分区 USB 镜像；调用方负责校验真实挂载与 USB 来源。
import { readfile } from 'fs';

function plan(table, state) {
    if (state.device != 'phicomm-n1' || state.filesystem != 'btrfs' || state.usb != true || state.sectorSize != 512)
        return { ok: false, reason: '设备或根文件系统不符合自动扩容条件' };
    if (type(state.root) != 'string' || !match(state.root, /^\/dev\/sd[a-z]+2$/) || type(state.sectors) != 'int' || state.sectors > 4294967295)
        return { ok: false, reason: '根设备或磁盘容量不受支持' };
    let disk = substr(state.root, 0, length(state.root) - 1), parts = table?.partitiontable?.partitions;
    if (table?.partitiontable?.label != 'dos' || table.partitiontable.device != disk || table.partitiontable.unit != 'sectors' || table.partitiontable.sectorsize != 512 || type(parts) != 'array' || length(parts) != 2)
        return { ok: false, reason: '不是标准双分区 DOS 镜像，保留原分区' };
    let boot = parts[0], root = parts[1];
    if (boot.node != disk + '1' || boot.start != 8192 || boot.size != 522240 || boot.type != 'c' ||
        root.node != state.root || root.start != 532480 || root.type != '83' || root.bootable == true ||
        type(root.size) != 'int' || root.size < 2097152 || root.start + root.size > state.sectors ||
        state.start != root.start || state.size != root.size)
        return { ok: false, reason: '分区布局或内核视图不匹配，保留原分区' };
    return { ok: true, disk, root: state.root, start: root.start, previous: root.size, size: state.sectors - root.start, grow: root.start + root.size < state.sectors };
}

try {
    let input = json(readfile(ARGV[0], 65536));
    print(plan(input.table, input.state));
} catch (e) { print({ ok: false, reason: '无法读取可信的分区信息' }); }
