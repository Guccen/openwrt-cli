// 只修改 system 的时区和固定 ntp 节，不能指定 UCI 文件、节名或任意键。
import { cursor } from 'uci';
import { readfile, writefile, rename, unlink, fdopen, popen } from 'fs';
const zones = { 'UTC': 'UTC0', 'Asia/Shanghai': 'CST-8', 'Asia/Hong_Kong': 'HKT-8', 'Asia/Tokyo': 'JST-9', 'Asia/Singapore': 'SGT-8' };
function validServer(value) {
    if (type(value) != 'string' || length(value) < 1 || length(value) > 253) return false;
    for (let c in split(value, '')) if (index('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:-', c) < 0) return false;
    if (index(value, ':') >= 0) return match(value, /^[0-9a-fA-F:]{2,45}$/) != null;
    for (let label in split(value, '.')) if (!match(label, /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
    return true;
}
function validated(request, previous) {
    if (type(request) != 'object' || type(request.enabled) != 'bool' || type(request.useDhcp) != 'bool' ||
        type(request.servers) != 'array' || length(request.servers) > 4 ||
        (request.enabled && !request.useDhcp && !length(request.servers))) die('invalid_time_settings');
    if (!zones[request.zone] && request.zone != previous.zone) die('invalid_timezone');
    for (let server in request.servers) if (!validServer(server)) die('invalid_ntp_server');
    return request;
}
function reload() {
    let fd = popen('/etc/init.d/system reload >/dev/null 2>&1 && /etc/init.d/sysntpd restart >/dev/null 2>&1', 'r');
    if (!fd) return false;
    fd.read(1024);
    return fd.close() == 0;
}
try {
    let u = cursor(), sections = [];
    u.foreach('system', 'system', s => push(sections, s));
    if (length(sections) != 1) die('advanced_system_configuration');
    let ntp = u.get_all('system', 'ntp');
    if (ntp && ntp['.type'] != 'timeserver') die('advanced_system_configuration');
    let s = sections[0], previous = { zone: s.zonename || 'UTC', enabled: ntp?.enabled != '0',
        useDhcp: ntp?.use_dhcp != '0', servers: type(ntp?.server) == 'array' ? ntp.server : ntp?.server ? [ntp.server] : [] };
    if (ARGV[0] == 'status') { print({ ok: true, settings: previous, zones: keys(zones) }); exit(0); }
    if (ARGV[0] != 'save') die('unsupported_method');
    let input = fdopen(0, 'r').read(4097);
    if (length(input) > 4096) die('invalid_request');
    let request = validated(json(input), previous), original = readfile('/etc/config/system', 65537);
    if (type(original) != 'string' || length(original) > 65536) die('system_configuration_too_large');
    if (request.zone != previous.zone) {
        u.set('system', s['.name'], 'zonename', request.zone);
        u.set('system', s['.name'], 'timezone', zones[request.zone]);
    }
    if (!ntp) u.set('system', 'ntp', 'timeserver');
    u.set('system', 'ntp', 'enabled', request.enabled ? '1' : '0');
    u.set('system', 'ntp', 'use_dhcp', request.useDhcp ? '1' : '0');
    if (length(request.servers)) u.set('system', 'ntp', 'server', request.servers);
    else u.delete('system', 'ntp', 'server');
    if (!u.commit('system') || !reload()) {
        u.revert('system');
        let path = '/etc/config/.router-ui-system-restore';
        if (!writefile(path, original) || !rename(path, '/etc/config/system')) { unlink(path); die('time_restore_failed'); }
        reload();
        die('time_apply_failed');
    }
    print({ ok: true });
} catch (e) { print({ ok: false, error: e.message || 'time_settings_unavailable' }); }
