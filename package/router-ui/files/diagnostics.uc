// 只允许单个目标和固定操作，命令参数不接受空白、引号、选项或 URL。
import { fdopen, popen } from 'fs';
function target(value) {
    if (type(value) != 'string' || length(value) < 1 || length(value) > 253) return false;
    for (let c in split(value, '')) if (index('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:-', c) < 0) return false;
    if (index(value, ':') >= 0) return match(value, /^[0-9a-fA-F:]{2,45}$/) != null;
    for (let label in split(value, '.'))
        if (!match(label, /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
    return true;
}
function command(request) {
    if (request.operation == 'logs') return '/usr/bin/timeout -s KILL 6 logread -l 100 2>&1';
    if (!target(request.target)) die('invalid_target');
    if (request.operation == 'ping4') return "/usr/bin/timeout -s KILL 6 ping -4 -c 2 -W 2 '" + request.target + "' 2>&1";
    if (request.operation == 'ping6') return "/usr/bin/timeout -s KILL 6 ping -6 -c 2 -W 2 '" + request.target + "' 2>&1";
    if (request.operation == 'dns') return "/usr/bin/timeout -s KILL 6 nslookup '" + request.target + "' 2>&1";
    die('unsupported_operation');
}
try {
    let input = fdopen(0, 'r').read(1025);
    if (length(input) > 1024) die('invalid_request');
    let request = json(input), cmd = command(request);
    let fd = popen(cmd, 'r');
    if (!fd) die('diagnostic_unavailable');
    let output = fd.read(16385), code = fd.close();
    print({ ok: true, success: code == 0, code, output: substr(output || '', 0, 16384), limited: length(output || '') > 16384 });
} catch (e) { print({ ok: false, error: e.message || 'diagnostic_unavailable' }); }
