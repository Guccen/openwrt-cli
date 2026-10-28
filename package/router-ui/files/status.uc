// 固定内核节点、挂载点和租约来源；不写文件、不扫描网络、不接受客户端路径。
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
        if (length(cols) < 6 || !match(cols[1], /^[0-9]+$/) || !match(cols[2], /^[0-9]+$/) || !match(cols[3], /^[0-9]+$/)) continue;
        let total = +cols[1] * 1024, used = +cols[2] * 1024, available = +cols[3] * 1024;
        if (total > 0 && used <= total && available <= total) return { name, path, total, used, available };
    }
    return null;
}
function disks() {
    let result = [];
    for (let item in [
        { name: '可写存储', path: '/', command: 'df -kP / 2>/dev/null' },
        { name: '临时空间', path: '/tmp', command: 'df -kP /tmp 2>/dev/null' }
    ]) {
        let fd = popen(item.command, 'r');
        if (!fd) continue;
        let output = fd.read(16384), code = fd.close();
        let disk = code == 0 ? parseDisk(output, item.name, item.path) : null;
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
try {
    if (ARGV[0] == 'summary') print({ ok: true, localTime: deviceTime(), temperatures: temperatures(), storage: disks(), ports: ports() });
    else if (ARGV[0] == 'clients') print(clients());
    else print({ ok: false, error: 'unsupported_method' });
} catch (e) { print({ ok: false, error: 'status_unavailable' }); }
