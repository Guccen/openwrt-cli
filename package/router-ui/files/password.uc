// 密码只通过标准输入传递；固定修改 root，不接受用户名或命令。
import { fdopen, popen } from 'fs';
import { connect } from 'ubus';

function fail(reason) { die(reason); }
function controls(value) {
    for (let i = 0; i < length(value); i++) {
        let byte = ord(value, i);
        if (byte < 32 || byte == 127) return true;
    }
    return false;
}
try {
    let input = fdopen(0, 'r').read(4097);
    if (!input || length(input) > 4096) fail('invalid_password');
    let args = json(input);
    if (type(args.current) != 'string' || length(args.current) < 1 || length(args.current) > 512 ||
        type(args.password) != 'string' || length(args.password) < 8 || length(args.password) > 128 ||
        !length(trim(args.password)) || controls(args.current) || controls(args.password)) fail('invalid_password');
    if (args.password != args.confirmation) fail('password_mismatch');
    if (args.current == args.password) fail('password_unchanged');
    let bus = connect(null, 5);
    if (!bus) fail('password_failed');
    let verified = bus.call('session', 'login', { username: 'root', password: args.current, timeout: 1 });
    if (!verified || !verified.ubus_rpc_session) fail('current_password_incorrect');
    bus.call('session', 'destroy', { ubus_rpc_session: verified.ubus_rpc_session });
    let sessions = bus.call('session', 'list', {}, 'multiple');
    if (type(sessions) != 'array') fail('password_failed');
    let process = popen('/bin/passwd root >/dev/null 2>&1', 'w');
    if (!process) fail('password_failed');
    if (process.write(args.password + '\n') != length(args.password) + 1 || !process.flush()) {
        process.close(); fail('password_failed');
    }
    // BusyBox passwd 会在询问确认密码前清理输入，需要分两次写入。
    sleep(250);
    let written = process.write(args.password + '\n');
    let status = process.close();
    if (written != length(args.password) + 1 || status !== 0) fail('password_failed');
    let revoked = true;
    for (let session in sessions) {
        if (session.data?.username == 'root' && session.ubus_rpc_session) {
            if (bus.call('session', 'destroy', { ubus_rpc_session: session.ubus_rpc_session }) == null)
                revoked = false;
        }
    }
    bus.disconnect();
    print({ ok: true, changed: true, sessionsRevoked: revoked });
}
catch (error) {
    let reason = error.message;
    if (!match(reason, /^(invalid_password|password_mismatch|password_unchanged|current_password_incorrect|password_failed)$/))
        reason = 'password_failed';
    print({ ok: false, error: reason });
}
