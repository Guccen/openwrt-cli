// 由固定维护脚本调用；客户端不能指定设备端路径。
import { readfile, writefile, open, stat, lstat, mkdir, unlink, rmdir, fdopen } from 'fs';

const directory = '/tmp/router-ui-upload';
const payload = directory + '/payload';
const metadata = directory + '/metadata';
const expandedLimit = 2097152;
let created = false;

function fail(reason) { die(reason); }
function operationRecord(value) {
    if (type(value) != 'object' || type(value.id) != 'string' || !match(value.id, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/) ||
        index(['reboot', 'restore', 'upgrade', 'reset'], value.kind) < 0 ||
        index(['accepted', 'running', 'rebooting', 'failed'], value.state) < 0 ||
        type(value.updatedAt) != 'int' || value.updatedAt < 0 ||
        type(value.bootId) != 'string' || !match(value.bootId, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/) ||
        type(value.error) != 'string' || !match(value.error, /^[a-z_]{0,80}$/)) return null;
    return { id: value.id, kind: value.kind, state: value.state, error: value.error,
        updatedAt: value.updatedAt, bootId: value.bootId };
}
function save(path, data) {
    if (writefile(path, data) != length(data)) fail('write_failed');
}
function cleanup() {
    for (let name in ['payload', 'metadata', 'expanded', 'restore.tar', 'rescue.tar.gz']) unlink(directory + '/' + name);
    rmdir(directory);
}
function load() {
    let text = readfile(metadata, 4096);
    let info = text ? json(text) : null;
    if (!info || time() - info.updated > 600) {
        cleanup();
        fail('upload_expired');
    }
    return info;
}
function field(header, offset, size) {
    return split(substr(header, offset, size), '\x00')[0];
}
function octal(value) {
    value = trim(value);
    if (!match(value, /^[0-7]+$/)) fail('invalid_archive');
    return int(value, 8);
}
function nulpad(value, size) {
    let count = size - length(value), padding = '\x00';
    if (count < 0) fail('invalid_archive');
    while (length(padding) < count) padding += padding;
    return value + substr(padding, 0, count);
}
function member(name, content) {
    let header = nulpad(name, 100) + '0000600\x00' + '0000000\x00' + '0000000\x00' +
        sprintf('%011o', length(content)) + '\x00' + '00000000000\x00' + '        ' +
        '0' + nulpad('', 100) + 'ustar\x00' + '00';
    header = nulpad(header, 512);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += ord(header, i);
    header = substr(header, 0, 148) + sprintf('%06o', sum) + '\x00 ' + substr(header, 156);
    return header + content + nulpad('', (512 - length(content) % 512) % 512);
}
function identity() {
    let device = json(readfile('/www/device.json', 4096));
    return { device: device.device, role: device.role, revision: device.revision,
        release: readfile('/etc/openwrt_release', 8192) };
}
function archive(data, requireIdentity) {
    if (!data || length(data) > expandedLimit || length(data) % 512) fail('invalid_archive');
    let names = {}, count = 0, offset = 0, filtered = '', manifest = null;
    while (offset + 512 <= length(data)) {
        let header = substr(data, offset, 512);
        if (header == nulpad('', 512)) break;
        let checksum = 0;
        for (let i = 0; i < 512; i++) checksum += (i >= 148 && i < 156) ? 32 : ord(header, i);
        if (checksum != octal(field(header, 148, 8))) fail('invalid_archive');
        let name = field(header, 0, 100), prefix = field(header, 345, 155);
        if (prefix != '') name = prefix + '/' + name;
        if (substr(name, 0, 2) == './') name = substr(name, 2);
        let size = octal(field(header, 124, 12));
        let kind = substr(header, 156, 1);
        if (kind != '0' && kind != '\x00' && kind != '5') fail('invalid_archive');
        if (kind == '5' && size != 0) fail('invalid_archive');
        if (match(name, /\/$/)) name = substr(name, 0, length(name) - 1);
        if (names[name] || ++count > 512) fail('invalid_archive');
        names[name] = true;
        let next = offset + 512 + int((size + 511) / 512) * 512;
        if (next > length(data)) fail('invalid_archive');
        if (name == 'router-ui-backup.json' && kind == '0' && size < 16384) {
            manifest = json(substr(data, offset + 512, size));
        }
        else {
            if (!(name == 'etc' && kind == '5') &&
                (!match(name, /^etc(\/[A-Za-z0-9_+.-]+)+$/) || match(name, /(^|\/)\.\.?($|\/)/)))
                fail('invalid_archive');
            // 不能沿设备中既有的符号链接写入归档外路径。
            let parts = split(name, '/'), path = '';
            for (let part in parts) {
                path += '/' + part;
                let existing = lstat(path);
                if (existing && existing.type == 'link') fail('invalid_archive');
            }
            filtered += substr(data, offset, next - offset);
        }
        offset = next;
    }
    // 不接受提前结束后的额外成员、缺失结束块或缺失核心配置的归档。
    if (offset + 1024 > length(data) || substr(data, offset) != nulpad('', length(data) - offset) ||
        !names['etc/config/network'] || !names['etc/config/dhcp'] || !names['etc/config/rpcd'])
        fail('invalid_archive');
    if (requireIdentity) {
        let expected = identity();
        if (!manifest || manifest.device != expected.device || manifest.role != expected.role ||
            manifest.revision != expected.revision || manifest.release != expected.release)
            fail('archive_mismatch');
        save(directory + '/restore.tar', filtered + nulpad('', 1024));
    }
    return count;
}

try {
    let mode = ARGV[0];
    if (mode == 'operation') {
        let saved = readfile('/var/run/router-ui-maintenance.json', 4097), value = null;
        try { value = saved && length(saved) <= 4096 ? operationRecord(json(saved)) : null; } catch (e) {}
        print(sprintf('%J', value));
        exit(0);
    }
    if (mode == 'seal') {
        let data = readfile(ARGV[1], expandedLimit + 1);
        // 导出保留标准 sysupgrade 文件内容，只前置一个可供网页恢复核对的清单。
        if (!data || length(data) > expandedLimit - 16896) fail('backup_too_large');
        save(ARGV[1], member('router-ui-backup.json', sprintf('%J', identity())) + data);
        exit(0);
    }
    if (mode == 'archive') {
        print({ ok: true, files: archive(readfile(directory + '/expanded', expandedLimit + 1), true) });
        exit(0);
    }
    let input = fdopen(0, 'r').read(65537);
    if (!input || length(input) > 65536) fail('invalid_upload');
    let request = json(input);
    if (mode == 'start') {
        if (request.kind != 'restore' && request.kind != 'upgrade') fail('invalid_upload');
        if (request.kind == 'upgrade' && trim(readfile('/tmp/sysinfo/board_name', 128)) != 'jdcloud,re-ss-01')
            fail('unsupported_device');
        let limit = request.kind == 'restore' ? 131072 : 33554432;
        if (type(request.size) != 'int' || request.size < 1 || request.size > limit ||
            type(request.sha256) != 'string' || !match(request.sha256, /^[a-f0-9]{64}$/)) fail('invalid_upload');
        if (stat(metadata)) {
            let old = json(readfile(metadata, 4096));
            if (old && time() - old.updated <= 600) fail('operation_busy');
            cleanup();
        }
        if (!mkdir(directory, 0700)) fail('operation_busy');
        created = true;
        let random = open('/dev/urandom', 'r');
        let token = random ? random.read(16) : null;
        if (random) random.close();
        if (!token || length(token) != 16) fail('write_failed');
        save(payload, '');
        let info = { token: hexenc(token), kind: request.kind, size: request.size,
            sha256: request.sha256, updated: time() };
        save(metadata, sprintf('%J', info));
        print({ ok: true, token: info.token });
    }
    else {
        let info = load();
        if (type(request.token) != 'string' || request.token != info.token) fail('invalid_token');
        if (mode == 'cancel') { cleanup(); print({ ok: true }); }
        else if (mode == 'append') {
            let current = stat(payload);
            if (type(request.offset) != 'int' || !current || request.offset != current.size ||
                type(request.data) != 'string' || length(request.data) > 43692) fail('invalid_upload');
            let chunk = b64dec(request.data);
            if (!chunk || length(chunk) > 32768 || current.size + length(chunk) > info.size) fail('invalid_upload');
            let file = open(payload, 'a');
            if (!file || file.write(chunk) != length(chunk)) fail('write_failed');
            file.close();
            info.updated = time();
            save(metadata, sprintf('%J', info));
            print({ ok: true, offset: current.size + length(chunk) });
        }
        else if (mode == 'check') {
            let current = stat(payload);
            if (!current || current.size != info.size) fail('incomplete_upload');
            info.confirm = request.confirm === true;
            print({ ok: true, ...info });
        }
        else fail('invalid_upload');
    }
}
catch (error) {
    if (created) cleanup();
    let reason = error.message;
    if (!match(reason, /^(invalid_archive|archive_mismatch|invalid_upload|invalid_token|incomplete_upload|upload_expired|operation_busy|write_failed|backup_too_large|unsupported_device)$/))
        reason = 'invalid_upload';
    print({ ok: false, error: reason });
    exit(1);
}
