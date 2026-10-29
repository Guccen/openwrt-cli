// 只控制内核实际枚举的 LED 与固定属性，配置通过原子重命名保存。
import { readfile, writefile, rename, unlink, glob, access, fdopen, popen } from 'fs';
const config = '/etc/router-ui-led.json';
const previous = '/var/run/router-ui-led.previous';
const statusFile = '/var/run/router-ui-led.status';
const cronFile = '/etc/crontabs/root';
const cronLine = '* * * * * /usr/libexec/router-ui/led-state check >/dev/null 2>&1 # router-ui-led';
const states = ['boot', 'normal', 'offline', 'fault'];
function fail(reason) { die(reason); }
function write(path, value) {
    if (writefile(path, value) != length(value)) fail('led_write_failed');
}
function atomic(path, value) {
    let text = sprintf('%J', value);
    write(path + '.tmp', text);
    if (!rename(path + '.tmp', path)) { unlink(path + '.tmp'); fail('led_write_failed'); }
}
function capabilities() {
    let result = [];
    for (let path in glob('/sys/class/leds/*') || []) {
        let id = substr(path, length('/sys/class/leds/'));
        if (!match(id, /^[A-Za-z0-9_.:+-]{1,80}$/) || !access(path + '/brightness', 'w')) continue;
        let trigger = readfile(path + '/trigger', 4096) || '';
        let maximum = int(trim(readfile(path + '/max_brightness', 32) || '0'));
        if (maximum < 1 || maximum > 65535) continue;
        push(result, { id, timer: !!match(trigger, /(^|[ \[])timer([ \]]|$)/), maxBrightness: maximum });
        if (length(result) >= 64) break;
    }
    return result;
}
function validate(policy, leds) {
    if (type(policy) != 'object' || type(policy.enabled) != 'bool' || type(policy.targets) != 'array' ||
        length(policy.targets) < 1 || length(policy.targets) > 2 || type(policy.states) != 'object') fail('led_invalid');
    let targets = [], known = {};
    for (let led in leds) known[led.id] = led;
    for (let target in policy.targets) {
        if (type(target) != 'string' || !match(target, /^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/)) fail('led_invalid');
        let parts = split(target, '.');
        for (let part in parts) if (int(part) > 255) fail('led_invalid');
        if (int(parts[0]) == 0 || int(parts[0]) == 127 || int(parts[0]) >= 224) fail('led_invalid');
        push(targets, target);
    }
    let clean = { enabled: policy.enabled, targets, states: {} };
    for (let name in states) {
        let state = policy.states[name];
        if (type(state) != 'object' || type(state.led) != 'string' ||
            (state.effect != 'on' && state.effect != 'off' && state.effect != 'blink') ||
            type(state.onMs) != 'int' || state.onMs < 50 || state.onMs > 10000 ||
            type(state.offMs) != 'int' || state.offMs < 50 || state.offMs > 10000) fail('led_invalid');
        if (policy.enabled && (!known[state.led] || (state.effect == 'blink' && !known[state.led].timer))) fail('led_unsupported');
        clean.states[name] = { led: state.led, effect: state.effect, onMs: state.onMs, offMs: state.offMs };
    }
    return clean;
}
function policy() {
    return json(readfile(config, 8193));
}
function cronRunning() {
    let process = popen('/usr/bin/timeout -s KILL 2 pidof crond >/dev/null 2>&1', 'r');
    if (!process) return false;
    process.read(16);
    return process.close() == 0;
}
function cronSynchronized(settings) {
    let text = readfile(cronFile, 65537);
    if (text == null) return !settings.enabled;
    if (type(text) != 'string' || length(text) > 65536) return false;
    let found = 0;
    for (let row in split(text, '\n')) {
        let current = trim(row);
        if (!match(current, / # router-ui-led$/)) continue;
        if (!settings.enabled || current != cronLine) return false;
        found++;
    }
    return settings.enabled ? found == 1 : found == 0;
}
function attributes(id) {
    let base = '/sys/class/leds/' + id, values = {};
    let current = match(readfile(base + '/trigger', 4096) || '', /\[([^\]]+)\]/);
    values.trigger = current ? current[1] : 'none';
    for (let key in ['brightness', 'delay_on', 'delay_off', 'device_name', 'link', 'rx', 'tx', 'interval', 'invert']) {
        let value = readfile(base + '/' + key, 128);
        if (value != null) values[key] = trim(value);
    }
    return values;
}
function attr(id, key, value) { write('/sys/class/leds/' + id + '/' + key, '' + value); }
function restore(leds) {
    let text = readfile(previous, 32769);
    if (!text || length(text) > 32768) return;
    let saved = json(text);
    for (let led in leds) {
        let item = saved[led.id];
        if (!item) continue;
        attr(led.id, 'trigger', item.trigger);
        for (let key in ['brightness', 'delay_on', 'delay_off', 'device_name', 'link', 'rx', 'tx', 'interval', 'invert'])
            if (item[key] != null && access('/sys/class/leds/' + led.id + '/' + key, 'w')) attr(led.id, key, item[key]);
    }
    unlink(previous);
    unlink(statusFile);
}
try {
    let leds = capabilities();
    if (ARGV[0] == 'status') {
        let settings = policy(), current = readfile(statusFile, 1024);
        print({ ok: true, leds, policy: settings, current: current ? json(current) : null,
            cronRunning: cronRunning(), cronSynchronized: cronSynchronized(settings) });
    }
    else if (ARGV[0] == 'save') {
        let input = fdopen(0, 'r').read(16385);
        if (!input || length(input) > 16384) fail('led_invalid');
        let request = json(input);
        if (type(request.policy) != 'string' || length(request.policy) > 8192) fail('led_invalid');
        atomic(config, validate(json(request.policy), leds));
        print({ ok: true });
    }
    else if (ARGV[0] == 'restore') {
        restore(leds);
    }
    else if (ARGV[0] == 'apply') {
        let settings = validate(policy(), leds), name = ARGV[1];
        if (!settings.enabled) exit(0);
        if (index(states, name) < 0) fail('led_invalid');
        let managed = {}, saved = {}, known = {};
        for (let led in leds) known[led.id] = led;
        for (let key in states) managed[settings.states[key].led] = true;
        if (!access(previous)) {
            for (let id in managed) saved[id] = attributes(id);
            atomic(previous, saved);
        }
        for (let id in managed) { attr(id, 'trigger', 'none'); attr(id, 'brightness', 0); }
        let selected = settings.states[name];
        if (selected.effect != 'off') {
            attr(selected.led, 'brightness', known[selected.led].maxBrightness);
            if (selected.effect == 'blink') {
                attr(selected.led, 'trigger', 'timer');
                attr(selected.led, 'delay_on', selected.onMs);
                attr(selected.led, 'delay_off', selected.offMs);
            }
        }
        atomic(statusFile, { state: name, checkedAt: time() });
    }
    else fail('led_invalid');
}
catch (error) {
    let reason = error.message;
    if (reason != 'led_invalid' && reason != 'led_unsupported' && reason != 'led_write_failed') reason = 'led_invalid';
    print({ ok: false, error: reason });
    exit(1);
}
