// 通过内核 LED 触发器配置灯效，并在停用时恢复原有属性。
import { readfile, writefile, rename, unlink, glob, access, fdopen } from 'fs';
const config = '/etc/router-ui-led.json';
const previous = '/var/run/router-ui-led.previous';

function fail(reason) { die(reason); }
function write(path, value) {
    if (writefile(path, value) != length(value)) fail('led_write_failed');
}
function atomic(path, value) {
    let text = sprintf('%J', value);
    write(path + '.tmp', text);
    if (!rename(path + '.tmp', path)) { unlink(path + '.tmp'); fail('led_write_failed'); }
}
function triggerInfo(path) {
    let available = [], current = 'none';
    let text = trim(readfile(path + '/trigger', 4096) || '');
    for (let token in split(text, ' ')) {
        token = trim(token);
        if (!length(token)) continue;
        let selected = match(token, /^\[([A-Za-z0-9_-]+)\]$/);
        if (selected) { token = selected[1]; current = token; }
        if (match(token, /^[A-Za-z0-9_-]{1,80}$/) && index(available, token) < 0) push(available, token);
    }
    return { available, current };
}
function capabilities() {
    let result = [];
    for (let path in glob('/sys/class/leds/*') || []) {
        let id = substr(path, length('/sys/class/leds/'));
        if (!match(id, /^[A-Za-z0-9_.:+-]{1,80}$/) || !access(path + '/brightness', 'w')) continue;
        let maximum = int(trim(readfile(path + '/max_brightness', 32) || '0'));
        if (maximum < 1 || maximum > 65535) continue;
        let trigger = triggerInfo(path);
        push(result, { id, triggers: trigger.available, currentTrigger: trigger.current, maxBrightness: maximum });
        if (length(result) >= 64) break;
    }
    return result;
}
function networkDevices() {
    let result = [];
    for (let path in glob('/sys/class/net/*') || []) {
        let id = substr(path, length('/sys/class/net/'));
        if (match(id, /^[A-Za-z0-9_.:-]{1,15}$/)) push(result, id);
        if (length(result) >= 128) break;
    }
    return result;
}
function knownLeds(leds) {
    let known = {};
    for (let led in leds) known[led.id] = led;
    return known;
}
function preferredLed(leds) {
    for (let led in leds) if (match(led.id, /(^|[:_-])(blue|white)([:_-]|$)/)) return led.id;
    return length(leds) ? leds[0].id : '';
}
function preferredActivityLed(leds) {
    for (let led in leds) if (match(led.id, /(^|[:_-])(green|white)([:_-]|$)/)) return led;
    return length(leds) ? leds[0] : null;
}
function defaultRule(id) {
    return { id, trigger: 'preserve', deviceName: 'wan', link: false, rx: true, tx: true,
        interval: 50, onMs: 250, offMs: 250 };
}
function defaultPolicy(leds) {
    let result = { version: 2, enabled: false,
        boot: { led: preferredLed(leds), effect: 'blink', onMs: 250, offMs: 250 }, leds: [] };
    let selected = preferredActivityLed(leds);
    if (selected) {
        let rule = defaultRule(selected.id);
        if (index(selected.triggers, 'netdev') >= 0) rule.trigger = 'netdev';
        else if (index(selected.triggers, 'heartbeat') >= 0) rule.trigger = 'heartbeat';
        result.leds = [rule];
    }
    return result;
}
function legacyEffect(value, fallback) {
    if (type(value) != 'object') return fallback;
    return { led: type(value.led) == 'string' ? value.led : fallback.led,
        effect: index(['on', 'off', 'blink'], value.effect) >= 0 ? value.effect : fallback.effect,
        onMs: type(value.onMs) == 'int' ? value.onMs : fallback.onMs,
        offMs: type(value.offMs) == 'int' ? value.offMs : fallback.offMs };
}
function normalize(raw, leds, devices) {
    let known = knownLeds(leds), fallback = defaultPolicy(leds);
    if (type(raw) != 'object') return fallback;
    if (raw.version != 2) {
        let oldStates = type(raw.states) == 'object' ? raw.states : {};
        fallback.enabled = raw.enabled == true;
        fallback.boot = legacyEffect(oldStates.boot, fallback.boot);
        if (!known[fallback.boot.led]) fallback.boot.led = preferredLed(leds);
        let normal = legacyEffect(oldStates.normal, { led: '', effect: 'off', onMs: 250, offMs: 250 });
        if (known[normal.led]) {
            let trigger = index(known[normal.led].triggers, 'netdev') >= 0 ? 'netdev' :
                index(known[normal.led].triggers, 'heartbeat') >= 0 ? 'heartbeat' :
                index(known[normal.led].triggers, 'timer') >= 0 ? 'timer' : 'preserve';
            let rule = defaultRule(normal.led);
            rule.trigger = trigger;
            rule.onMs = normal.onMs;
            rule.offMs = normal.offMs;
            if (trigger != 'preserve') fallback.leds = [rule];
        }
        return fallback;
    }

    let result = defaultPolicy(leds), defaultLeds = result.leds;
    result.enabled = raw.enabled == true;
    result.leds = [];
    if (type(raw.boot) == 'object') result.boot = legacyEffect(raw.boot, result.boot);
    if (!known[result.boot.led]) result.boot.led = preferredLed(leds);
    if (result.boot.effect == 'blink' && known[result.boot.led] && index(known[result.boot.led].triggers, 'timer') < 0)
        result.boot.effect = 'on';

    let seen = {};
    if (type(raw.leds) == 'array') for (let item in raw.leds) {
        if (type(item) != 'object' || type(item.id) != 'string' || !known[item.id]) continue;
        if (seen[item.id]) continue;
        seen[item.id] = true;
        let rule = defaultRule(item.id);
        if (type(item.trigger) == 'string') rule.trigger = item.trigger;
        if (rule.trigger == 'none') rule.trigger = 'off';
        if (rule.trigger == 'default-on') rule.trigger = 'on';
        if (rule.trigger != 'preserve' && rule.trigger != 'off' && rule.trigger != 'on' &&
            index(known[item.id].triggers, rule.trigger) < 0) rule.trigger = 'preserve';
        if (type(item.deviceName) == 'string') rule.deviceName = item.deviceName;
        if (type(item.link) == 'bool') rule.link = item.link;
        if (type(item.rx) == 'bool') rule.rx = item.rx;
        if (type(item.tx) == 'bool') rule.tx = item.tx;
        if (type(item.interval) == 'int' && item.interval >= 10 && item.interval <= 10000) rule.interval = item.interval;
        if (type(item.onMs) == 'int' && item.onMs >= 50 && item.onMs <= 10000) rule.onMs = item.onMs;
        if (type(item.offMs) == 'int' && item.offMs >= 50 && item.offMs <= 10000) rule.offMs = item.offMs;
        if (rule.trigger == 'netdev' && index(devices, rule.deviceName) < 0) {
            if (index(devices, 'wan') >= 0) rule.deviceName = 'wan';
            else if (length(devices)) rule.deviceName = devices[0];
            else rule.trigger = 'preserve';
        }
        push(result.leds, rule);
        if (length(result.leds) >= 64) break;
    }
    if (!length(result.leds)) result.leds = defaultLeds;
    return result;
}
function rawPolicy() {
    let text = readfile(config, 16385);
    if (!text || length(text) > 16384) return null;
    return json(text);
}
function policy(leds, devices) { return normalize(rawPolicy(), leds, devices); }
function validate(value, leds, devices) {
    if (type(value) != 'object' || value.version != 2 || type(value.enabled) != 'bool' ||
        type(value.boot) != 'object' || type(value.leds) != 'array' || length(value.leds) > 64) fail('led_invalid');
    let known = knownLeds(leds), clean = { version: 2, enabled: value.enabled, boot: {}, leds: [] }, ids = {};
    let boot = value.boot;
    if (type(boot.led) != 'string' || index(['on', 'off', 'blink'], boot.effect) < 0 ||
        type(boot.onMs) != 'int' || boot.onMs < 50 || boot.onMs > 10000 ||
        type(boot.offMs) != 'int' || boot.offMs < 50 || boot.offMs > 10000) fail('led_invalid');
    if (value.enabled && (boot.effect != 'off' && !known[boot.led] ||
        boot.effect == 'blink' && known[boot.led] && index(known[boot.led].triggers, 'timer') < 0)) fail('led_unsupported');
    clean.boot = { led: boot.led, effect: boot.effect, onMs: boot.onMs, offMs: boot.offMs };
    for (let item in value.leds) {
        if (type(item) != 'object' || type(item.id) != 'string' || type(item.trigger) != 'string' ||
            !match(item.id, /^[A-Za-z0-9_.:+-]{1,80}$/) || ids[item.id]) fail('led_invalid');
        ids[item.id] = true;
        if (value.enabled && !known[item.id]) fail('led_unsupported');
        let trigger = item.trigger == 'none' ? 'off' : item.trigger == 'default-on' ? 'on' : item.trigger;
        if (trigger != 'preserve' && trigger != 'off' && trigger != 'on' &&
            (!known[item.id] || index(known[item.id].triggers, trigger) < 0)) fail('led_unsupported');
        let rule = defaultRule(item.id);
        rule.trigger = trigger;
        if (type(item.deviceName) == 'string') rule.deviceName = item.deviceName;
        if (type(item.link) != 'bool' || type(item.rx) != 'bool' || type(item.tx) != 'bool' ||
            type(item.interval) != 'int' || item.interval < 10 || item.interval > 10000 ||
            type(item.onMs) != 'int' || item.onMs < 50 || item.onMs > 10000 ||
            type(item.offMs) != 'int' || item.offMs < 50 || item.offMs > 10000) fail('led_invalid');
        rule.link = item.link; rule.rx = item.rx; rule.tx = item.tx;
        rule.interval = item.interval; rule.onMs = item.onMs; rule.offMs = item.offMs;
        if (value.enabled && item.trigger == 'netdev' &&
            (index(known[item.id].triggers, 'netdev') < 0 || index(devices, rule.deviceName) < 0 ||
             (!rule.link && !rule.rx && !rule.tx))) fail('led_unsupported');
        if (value.enabled && item.trigger == 'timer' && index(known[item.id].triggers, 'timer') < 0) fail('led_unsupported');
        push(clean.leds, rule);
    }
    return clean;
}
function attributes(id) {
    let base = '/sys/class/leds/' + id, values = {};
    let current = triggerInfo(base).current;
    values.trigger = current;
    for (let key in ['brightness', 'delay_on', 'delay_off', 'device_name', 'link', 'rx', 'tx', 'interval', 'invert']) {
        let value = readfile(base + '/' + key, 128);
        if (value != null) values[key] = trim(value);
    }
    return values;
}
function attr(id, key, value) { write('/sys/class/leds/' + id + '/' + key, '' + value); }
function managed(settings) {
    let result = {};
    if (!settings.enabled) return result;
    if (settings.boot.led) result[settings.boot.led] = true;
    for (let item in settings.leds) if (item.trigger != 'preserve') result[item.id] = true;
    return result;
}
function savePrevious(settings) {
    if (access(previous)) return;
    let values = {}, ids = managed(settings), count = 0;
    for (let id in ids) {
        if (!access('/sys/class/leds/' + id + '/trigger', 'r')) continue;
        values[id] = attributes(id);
        count++;
    }
    if (count) atomic(previous, values);
}
function restoreOne(id, item) {
    let base = '/sys/class/leds/' + id;
    if (!item || !access(base + '/trigger', 'w')) return;
    let current = triggerInfo(base);
    attr(id, 'trigger', 'none');
    if (index(current.available, item.trigger) >= 0) attr(id, 'trigger', item.trigger);
    for (let key in ['brightness', 'delay_on', 'delay_off', 'device_name', 'link', 'rx', 'tx', 'interval', 'invert'])
        if (item[key] != null && access(base + '/' + key, 'w')) attr(id, key, item[key]);
}
function restore() {
    let text = readfile(previous, 32769);
    if (!text || length(text) > 32768) return;
    let saved = json(text);
    for (let id in saved) restoreOne(id, saved[id]);
    unlink(previous);
}
function setEffect(id, effect, onMs, offMs, leds) {
    let known = knownLeds(leds), led = known[id];
    if (!led) return;
    attr(id, 'trigger', 'none');
    attr(id, 'brightness', 0);
    if (effect == 'off') return;
    if (effect == 'on') { attr(id, 'brightness', led.maxBrightness); return; }
    attr(id, 'trigger', 'timer');
    attr(id, 'delay_on', onMs);
    attr(id, 'delay_off', offMs);
}
function applyRule(item, leds) {
    if (item.trigger == 'preserve') return;
    let known = knownLeds(leds), led = known[item.id];
    if (!led) return;
    attr(item.id, 'trigger', 'none');
    attr(item.id, 'brightness', 0);
    if (item.trigger == 'off') return;
    if (item.trigger == 'on') { attr(item.id, 'brightness', led.maxBrightness); return; }
    attr(item.id, 'trigger', item.trigger);
    if (item.trigger == 'timer') {
        attr(item.id, 'delay_on', item.onMs);
        attr(item.id, 'delay_off', item.offMs);
    }
    else if (item.trigger == 'netdev') {
        if (!access('/sys/class/leds/' + item.id + '/device_name', 'w') ||
            !access('/sys/class/leds/' + item.id + '/interval', 'w')) fail('led_unsupported');
        attr(item.id, 'device_name', item.deviceName);
        attr(item.id, 'link', item.link ? 1 : 0);
        attr(item.id, 'rx', item.rx ? 1 : 0);
        attr(item.id, 'tx', item.tx ? 1 : 0);
        attr(item.id, 'interval', item.interval);
    }
}
function applyBoot(settings, leds) {
    if (!settings.enabled || !settings.boot.led) return;
    savePrevious(settings);
    setEffect(settings.boot.led, settings.boot.effect, settings.boot.onMs, settings.boot.offMs, leds);
}
function applyRuntime(settings, leds) {
    if (!settings.enabled) { restore(); return; }
    savePrevious(settings);
    let active = {};
    for (let item in settings.leds) {
        if (item.trigger == 'preserve') continue;
        applyRule(item, leds);
        active[item.id] = true;
    }
    if (settings.boot.led && !active[settings.boot.led]) {
        let text = readfile(previous, 32769);
        if (text && length(text) <= 32768) {
            let saved = json(text);
            if (saved[settings.boot.led]) restoreOne(settings.boot.led, saved[settings.boot.led]);
        }
    }
}
try {
    let leds = capabilities(), devices = networkDevices();
    if (ARGV[0] == 'status') {
        print({ ok: true, leds, networkDevices: devices, policy: policy(leds, devices), updatedAt: time() });
    }
    else if (ARGV[0] == 'save') {
        let input = fdopen(0, 'r').read(16385);
        if (!input || length(input) > 16384) fail('led_invalid');
        let request = json(input);
        if (type(request.policy) != 'string' || length(request.policy) > 8192) fail('led_invalid');
        atomic(config, validate(json(request.policy), leds, devices));
        print({ ok: true });
    }
    else if (ARGV[0] == 'configure') {
        let raw = rawPolicy(), settings = normalize(raw, leds, devices);
        if (type(raw) != 'object' || raw.version != 2) atomic(config, settings);
        restore();
        applyRuntime(settings, leds);
    }
    else if (ARGV[0] == 'start') {
        let raw = rawPolicy(), settings = normalize(raw, leds, devices);
        if (type(raw) != 'object' || raw.version != 2) atomic(config, settings);
        applyRuntime(settings, leds);
    }
    else if (ARGV[0] == 'boot') {
        let raw = rawPolicy(), settings = normalize(raw, leds, devices);
        if (type(raw) != 'object' || raw.version != 2) atomic(config, settings);
        applyBoot(settings, leds);
    }
    else if (ARGV[0] == 'restore') {
        restore();
    }
    else fail('led_invalid');
}
catch (error) {
    let reason = error.message;
    if (reason != 'led_invalid' && reason != 'led_unsupported' && reason != 'led_write_failed') reason = 'led_invalid';
    print({ ok: false, error: reason });
    exit(1);
}
