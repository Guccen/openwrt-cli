// 固定内核节点、挂载点、租约和无线状态来源；不写文件、不扫描网络、不接受客户端路径。
import { readfile, glob, access, popen } from 'fs';
import { connect } from 'ubus';

function text(path, limit) { let value = readfile(path, limit || 256); return value == null ? null : trim(value); }
function number(path) {
    let value = text(path, 64);
    return value != null && match(value, /^[0-9]+$/) ? +value : null;
}
function temperatures() {
    let result = [];
    for (let path in slice(glob('/sys/class/thermal/thermal_zone*') || [], 0, 16)) {
        let value = text(path + '/temp', 32);
        if (value == null || !match(value, /^-?[0-9]+$/) || +value < -40000 || +value > 200000) continue;
        push(result, { name: text(path + '/type', 128) || '温度传感器', celsius: +value / 1000.0 });
    }
    return result;
}
function parseDisk(output, name, path) {
    for (let line in split(output || '', '\n')) {
        let cols = split(trim(line), /\s+/);
        if (length(cols) < 6 || cols[5] != path || !match(cols[1], /^[0-9]+$/) || !match(cols[2], /^[0-9]+$/) || !match(cols[3], /^[0-9]+$/)) continue;
        let total = +cols[1] * 1024, used = +cols[2] * 1024, available = +cols[3] * 1024;
        if (total > 0 && used <= total && available <= total) return { name, path, source: cols[0], total, used, available };
    }
    return null;
}
function disks() {
    // 合并查询，避免每次状态刷新分别为根目录和临时目录创建子进程。
    let fd = popen('df -kP / /tmp 2>/dev/null', 'r');
    if (!fd) return [];
    let output = fd.read(16384), code = fd.close(), result = [];
    if (code != 0) return result;
    for (let item in [
        { name: '可写存储', path: '/' },
        { name: '临时空间', path: '/tmp' }
    ]) {
        let disk = parseDisk(output, item.name, item.path);
        if (disk) push(result, disk);
    }
    return result;
}
function diskLayout(name, sectors, partitions, rootSource) {
    if (!match(name, /^(sd[a-z]+|vd[a-z]+|mmcblk[0-9]+|nvme[0-9]+n[0-9]+)$/) || sectors <= 0) return null;
    let total = sectors * 512, partitioned = 0, lastEnd = 0, device = '/dev/' + name, system = rootSource == device;
    for (let part in partitions) {
        if (part.start == null || part.sectors == null || part.start < 0 || part.sectors <= 0 || part.start + part.sectors > sectors) return null;
        partitioned += part.sectors * 512;
        lastEnd = max(lastEnd, (part.start + part.sectors) * 512);
        if (rootSource == '/dev/' + part.name) system = true;
    }
    if (partitioned > total) return null;
    // 无分区表时可能是整盘文件系统，不能把未挂载的已有数据误报为空闲空间。
    if (!length(partitions)) return { device, total, system, partitioned: system ? total : null, unallocated: system ? 0 : null };
    return { device, total, system, partitioned, unallocated: max(0, total - lastEnd) };
}
function physicalDisks(storage) {
    let rootSource = null, result = [];
    for (let mounted in storage) if (mounted.path == '/') rootSource = mounted.source;
    for (let path in slice(glob('/sys/class/block/*') || [], 0, 64)) {
        let name = substr(path, length('/sys/class/block/'));
        if (!match(name, /^(sd[a-z]+|vd[a-z]+|mmcblk[0-9]+|nvme[0-9]+n[0-9]+)$/) || access(path + '/partition')) continue;
        let sectors = number(path + '/size'), partitions = [];
        for (let entry in slice(glob(path + '/*/partition') || [], 0, 128)) {
            let base = substr(entry, 0, length(entry) - length('/partition'));
            let part = match(base, /\/([^/]+)$/);
            if (!part) continue;
            push(partitions, { name: part[1], start: number(base + '/start'), sectors: number(base + '/size') });
        }
        let disk = sectors != null ? diskLayout(name, sectors, partitions, rootSource) : null;
        if (disk) push(result, disk);
    }
    return result;
}
function ports() {
    let result = [];
    for (let path in glob('/sys/class/net/*') || []) {
        let name = substr(path, length('/sys/class/net/'));
        if (!match(name, /^[A-Za-z0-9_.:-]{1,15}$/) || number(path + '/type') != 1 ||
            access(path + '/wireless') || access(path + '/phy80211') ||
            (!access(path + '/device') && !text(path + '/phys_port_name'))) continue;
        let carrier = number(path + '/carrier'), speed = number(path + '/speed');
        push(result, { name, link: carrier == null ? null : carrier == 1,
            speed: carrier == 1 && speed > 0 && speed < 1000000 ? speed : null,
            duplex: carrier == 1 ? text(path + '/duplex', 32) : null,
            mac: text(path + '/address', 32), rx: number(path + '/statistics/rx_bytes'), tx: number(path + '/statistics/tx_bytes') });
        if (length(result) >= 32) break;
    }
    return result;
}
function ipv4(value) {
    if (!match(value, /^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/)) return false;
    for (let part in split(value, '.')) if (+part > 255) return false;
    return true;
}
function parseLeases(content, now) {
    let result = [], seen = {};
    for (let line in split(content || '', '\n')) {
        let cols = split(trim(line), /\s+/);
        if (length(cols) < 4 || !match(cols[0], /^[0-9]+$/) ||
            !match(cols[1], /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) || !ipv4(cols[2])) continue;
        let expiry = +cols[0], key = lc(cols[1]) + '/' + cols[2];
        if ((expiry != 0 && expiry <= now) || seen[key]) continue;
        seen[key] = true;
        push(result, { hostname: cols[3] == '*' ? null : substr(cols[3], 0, 253),
            mac: lc(cols[1]), address: cols[2], remaining: expiry == 0 ? null : expiry - now });
        if (length(result) >= 512) break;
    }
    return result;
}
function parseLeases6(data) {
    let result = [];
    for (let device, item in data?.device || {}) {
        if (type(item.leases) != 'array') continue;
        for (let lease in item.leases) {
            if (index(lease.flags || [], 'bound') < 0 || !length(lease.duid) || type(lease.valid) != 'int' || lease.valid == 0) continue;
            let addresses = [];
            for (let address in [...(lease['ipv6-addr'] || []), ...(lease['ipv6-prefix'] || [])]) {
                if (type(address.address) == 'string' && match(address.address, /^[0-9a-fA-F:]+$/) && index(address.address, ':') >= 0)
                    push(addresses, address.address + '/' + (address['prefix-length'] ?? 128));
                if (length(addresses) >= 16) break;
            }
            if (!length(addresses)) continue;
            push(result, { device: substr(device, 0, 64), hostname: substr(lease.hostname || '', 0, 253) || null,
                duid: substr(lease.duid, 0, 256), addresses,
                remaining: lease.valid == 4294967295 || lease.valid < 0 ? null : lease.valid });
            if (length(result) >= 512) return result;
        }
    }
    return result;
}
function clients() {
    let content = readfile('/tmp/dhcp.leases', 262145), ipv4Available = content != null && length(content) <= 262144;
    let bus = connect(null, 2), response = bus ? bus.call('dhcp', 'ipv6leases', {}) : null;
    bus?.disconnect();
    return { ok: true, ipv4Available, ipv6Available: type(response?.device) == 'object',
        ipv4: ipv4Available ? parseLeases(content, time()) : [], ipv6: parseLeases6(response),
        limited: content != null && length(content) > 262144, limit: 512 };
}
function deviceTime() {
    let t = localtime();
    return sprintf('%04d-%02d-%02d %02d:%02d:%02d', t.year, t.mon, t.mday, t.hour, t.min, t.sec);
}
function wirelessText(value) { return type(value) == 'string' ? substr(value, 0, 256) : ''; }
function wirelessData(data) {
    if (type(data) != 'object') return { ok: false, error: 'wireless_unavailable' };
    let radios = {};
    // 仅返回页面所需字段，不透传无线密码、认证参数或上游凭据。
    for (let name in slice(keys(data), 0, 8)) {
        let row = data[name];
        if (type(row) != 'object') continue;
        let config = type(row.config) == 'object' ? row.config : {}, interfaces = [];
        for (let iface in slice(type(row.interfaces) == 'array' ? row.interfaces : [], 0, 32)) {
            if (type(iface) != 'object') continue;
            let options = type(iface.config) == 'object' ? iface.config : {};
            push(interfaces, { section: wirelessText(iface.section), ifname: wirelessText(iface.ifname),
                config: { ssid: wirelessText(options.ssid), mode: wirelessText(options.mode) } });
        }
        radios[name] = { up: row.up == true, pending: row.pending == true, disabled: row.disabled == true,
            retry_setup_failed: row.retry_setup_failed == true,
            config: { band: wirelessText(config.band), hwmode: wirelessText(config.hwmode),
                channel: type(config.channel) == 'int' ? config.channel : wirelessText(config.channel) }, interfaces };
    }
    return { ok: true, radios };
}
function wireless() {
    let bus = connect(null, 2);
    // 网页网关附带的会话字段会被部分 netifd 拒绝；此处固定参数调用，不转发请求内容。
    let response = bus ? bus.call('network.wireless', 'status', {}) : null;
    bus?.disconnect();
    return wirelessData(response);
}
try {
    if (ARGV[0] == 'summary') {
        let storage = disks();
        print({ ok: true, localTime: deviceTime(), temperatures: temperatures(), storage, blockDisks: physicalDisks(storage), ports: ports() });
    }
    else if (ARGV[0] == 'clients') print(clients());
    else if (ARGV[0] == 'wireless') print(wireless());
    else print({ ok: false, error: 'unsupported_method' });
} catch (e) { print({ ok: false, error: 'status_unavailable' }); }
