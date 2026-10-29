// 固定的定时重启策略与有界状态文件；不接受路径、命令或 cron 表达式。
import { cursor } from 'uci';
import { readfile, writefile, rename, unlink, fdopen, popen } from 'fs';
const config = '/etc/router-ui-schedule.json';
const stateFile = '/etc/router-ui-schedule.last';
const cronFile = '/etc/crontabs/root';
const reasons = ['requested', 'disabled', 'invalid_clock', 'not_due', 'duplicate', 'boot_grace', 'configuration_busy', 'maintenance_busy', 'reboot_failed'];
function validate(value) {
    if (type(value) != 'object' || type(value.enabled) != 'bool' || type(value.time) != 'string' || length(value.time) != 5 ||
        !match(value.time, /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/) ||
        type(value.days) != 'array' || length(value.days) < 1 || length(value.days) > 7) die('schedule_invalid');
    for (let key in keys(value)) if (index(['enabled', 'time', 'days'], key) < 0) die('schedule_invalid');
    let days = [], seen = {};
    for (let day in value.days) {
        if (type(day) != 'int' || day < 0 || day > 6 || seen['' + day]) die('schedule_invalid');
        seen['' + day] = true;
        push(days, day);
    }
    sort(days, (a, b) => a - b);
    return { enabled: value.enabled, time: value.time, days };
}
function requestPolicy(value) {
    if (type(value) != 'object') die('schedule_invalid');
    // uhttpd 在鉴权后附加的传输字段，不属于持久化策略。
    let settings = { ...value };
    delete settings.ubus_rpc_session;
    return validate(settings);
}
function policy() {
    let text = readfile(config, 2049);
    if (type(text) != 'string' || length(text) > 2048) die('schedule_invalid');
    return validate(json(text));
}
function state() {
    let text = readfile(stateFile, 4097);
    if (text == null) return { consumedSlot: null, last: null };
    if (!length(text) || length(text) > 4096) die('schedule_invalid_state');
    let value = json(text);
    if (type(value) != 'object' || (value.consumedSlot != null &&
        (type(value.consumedSlot) != 'string' || length(value.consumedSlot) != 16 || !match(value.consumedSlot, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/))) ||
        (value.last != null && type(value.last) != 'object')) die('schedule_invalid_state');
    return { consumedSlot: value.consumedSlot, last: value.last };
}
function dateTime(value) {
    return sprintf('%04d-%02d-%02d %02d:%02d:%02d', value.year, value.mon, value.mday, value.hour, value.min, value.sec);
}
function slot(value) { return substr(dateTime(value), 0, 16); }
function decision(settings, now, previous, uptime) {
    let local = localtime(now);
    if (!settings.enabled) return { due: false, reason: 'disabled', slot: null };
    if (!local || local.year < 2024 || local.year > 9999) return { due: false, reason: 'invalid_clock', slot: null };
    if (sprintf('%02d:%02d', local.hour, local.min) != settings.time || index(settings.days, local.wday % 7) < 0)
        return { due: false, reason: 'not_due', slot: null };
    let current = slot(local);
    if (previous.consumedSlot == current) return { due: false, reason: 'duplicate', slot: current };
    if (uptime < 300) return { due: false, reason: 'boot_grace', slot: current };
    return { due: true, reason: 'requested', slot: current };
}
function nextTime(settings, now, previous) {
    let local = localtime(now);
    if (!settings.enabled || !local || local.year < 2024 || local.year > 9999) return null;
    let clock = split(settings.time, ':'), hour = int(clock[0]), minute = int(clock[1]);
    // 按本地日历递增，不能用 86400 秒跨越夏令时边界。
    for (let offset = 0; offset <= 7; offset++) {
        let epoch = timelocal({ year: local.year, mon: local.mon, mday: local.mday + offset, hour, min: minute, sec: 0, isdst: -1 });
        if (epoch == null || epoch <= now) continue;
        let candidate = localtime(epoch);
        if (candidate.hour != hour || candidate.min != minute || index(settings.days, candidate.wday % 7) < 0 || slot(candidate) == previous.consumedSlot) continue;
        return dateTime(candidate);
    }
    return null;
}
function uptime() {
    let value = match(readfile('/proc/uptime', 128) || '', /^([0-9]+)\./);
    return value ? int(value[1]) : 0;
}
function atomicState(value) {
    let text = sprintf('%J\n', value);
    if (length(text) > 4096 || writefile(stateFile + '.tmp', text) != length(text) || !rename(stateFile + '.tmp', stateFile)) {
        unlink(stateFile + '.tmp');
        die('schedule_state_failed');
    }
}
function record(reason) {
    if (index(reasons, reason) < 0) die('schedule_invalid');
    let settings = policy(), previous = state(), now = time(), current = decision(settings, now, previous, uptime());
    if (current.slot) previous.consumedSlot = current.slot;
    previous.last = { at: now, localTime: dateTime(localtime(now)), outcome: reason == 'requested' ? 'requested' : reason == 'reboot_failed' ? 'failed' : 'skipped', reason, slot: current.slot };
    atomicState(previous);
}
function reserve() {
    let previous = state(), current = decision(policy(), time(), previous, uptime());
    if (!current.due) die('schedule_not_due');
    // 先持久化消费的分钟；被中断时保留上次已知事件，不冒称 ubus 已受理。
    previous.consumedSlot = current.slot;
    atomicState(previous);
}
function zoneName() {
    let u = cursor(), name = u.get('system', '@system[0]', 'zonename') || u.get('system', '@system[0]', 'timezone') || 'UTC';
    return substr('' + name, 0, 128);
}
function cronRunning() {
    let process = popen('/usr/bin/timeout -s KILL 2 pidof crond >/dev/null 2>&1', 'r');
    if (!process) return false;
    process.read(16);
    return process.close() == 0;
}
function cronLine(settings) {
    if (!settings.enabled) return '';
    let clock = split(settings.time, ':');
    return sprintf('%d %d * * %s /usr/libexec/router-ui/scheduled-reboot run >/dev/null 2>&1 # router-ui-scheduled-reboot', int(clock[1]), int(clock[0]), join(',', settings.days));
}
function cronSynchronized(settings) {
    let text = readfile(cronFile, 65537);
    if (text == null) return !settings.enabled;
    if (type(text) != 'string' || length(text) > 65536) return false;
    let expected = cronLine(settings), found = 0;
    for (let row in split(text, '\n')) {
        let current = trim(row);
        if (!match(current, / # router-ui-scheduled-reboot$/)) continue;
        if (!settings.enabled || current != expected) return false;
        found++;
    }
    return settings.enabled ? found == 1 : found == 0;
}
try {
    if (ARGV[0] == 'validate') {
        let text = fdopen(0, 'r').read(4097);
        if (!text || length(text) > 4096) die('schedule_invalid');
        print(requestPolicy(json(text)));
    } else if (ARGV[0] == 'status') {
        let settings = policy(), previous = state(), now = time();
        print({ ok: true, policy: settings, localTime: dateTime(localtime(now)), timezone: zoneName(), next: nextTime(settings, now, previous), last: previous.last, cronRunning: cronRunning(), cronSynchronized: cronSynchronized(settings) });
    } else if (ARGV[0] == 'line') {
        print(cronLine(policy()));
    } else if (ARGV[0] == 'decision') {
        print(decision(policy(), time(), state(), uptime()));
    } else if (ARGV[0] == 'record') {
        record(ARGV[1]);
    } else if (ARGV[0] == 'reserve') {
        reserve();
    } else die('schedule_invalid');
} catch (error) {
    let reason = error.message;
    if (index(['schedule_invalid', 'schedule_invalid_state', 'schedule_state_failed', 'schedule_not_due'], reason) < 0) reason = 'schedule_invalid';
    print({ ok: false, error: reason });
    exit(1);
}
