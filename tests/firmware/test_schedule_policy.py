"""真实 ucode 验证定时策略、日历计算和持久化去重；只写独立临时目录。"""

import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


class SchedulePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", "")) or ([shutil.which("ucode")] if shutil.which("ucode") else [])
        if not cls.command:
            raise unittest.SkipTest("需要真实 ucode")

    def evaluate(self, body):
        root = "/tmp/router-ui-schedule-test-" + uuid.uuid4().hex
        source = (ROOT / "package/router-ui/files/schedule.uc").read_text(encoding="utf-8").split("\ntry {", 1)[0]
        source = source.replace("import { cursor } from 'uci';", "")
        source = source.replace("import { readfile,", "import { mkdir, rmdir, glob, readfile,", 1)
        source = source.replace("/etc/router-ui-schedule.json", root + "/config").replace("/etc/router-ui-schedule.last", root + "/state").replace("/proc/uptime", root + "/uptime")
        source = source.replace("now = time()", "now = fixtureNow")
        source = source.replace("decision(policy(), time(), previous, uptime())", "decision(policy(), fixtureNow, previous, uptime())")
        setup = f"mkdir('/tmp'); mkdir('{root}'); writefile('{root}/uptime', '5000.00 0.00');"
        setup += "global.fixtureNow = timelocal({year:2026,mon:10,mday:27,hour:3,min:0,sec:0,isdst:-1}); let settings = {enabled:true,time:'03:00',days:[0,1,2,3,4,5,6]}, previous = {consumedSlot:null,last:null}; writefile(config,sprintf('%J',settings));"
        cleanup = f"for (let path in glob('{root}/*')) unlink(path); rmdir('{root}');"
        result = subprocess.run([*self.command, "-e", source + setup + body + cleanup], capture_output=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_strict_policy_rejects_arbitrary_cron_and_normalizes_weekday_order(self):
        body = """
        let bad = [null, {}, {...settings,time:'3:00'}, {...settings,time:'24:00'}, {...settings,time:'03:60'},
          {...settings,time:'03:00\\nreboot'}, {...settings,time:'* * * * *'}, {...settings,days:[]}, {...settings,days:[7]},
          {...settings,days:[-1]}, {...settings,days:[1,1]}, {...settings,days:[true]}, {...settings,days:['1']},
          {...settings,days:[1.5]}, {...settings,enabled:1}, {...settings,command:'reboot'}];
        let rejected=[];
        for(let value in bad) { try {validate(value); push(rejected,false);} catch(e) {push(rejected,e.message=='schedule_invalid');} }
        print({rejected, canonical:validate({...settings,days:[6,0,2]})});
        """
        result = self.evaluate(body)
        self.assertTrue(all(result["rejected"]), result["rejected"])
        self.assertEqual(result["canonical"], {"enabled": True, "time": "03:00", "days": [0, 2, 6]})

    def test_due_requires_exact_local_weekday_minute_valid_clock_and_boot_grace(self):
        body = """
        let results=[];
        for(let item in [
          decision(settings,fixtureNow,previous,300),
          decision({...settings,enabled:false},fixtureNow,previous,1000),
          decision(settings,timegm({year:2023,mon:1,mday:1}),previous,1000),
          decision(settings,fixtureNow+60,previous,1000),
          decision({...settings,days:[0]},fixtureNow,previous,1000),
          decision(settings,fixtureNow,previous,299),
          decision(settings,fixtureNow,{consumedSlot:'2026-10-27 03:00'},1000)
        ]) push(results,[item.due,item.reason]);
        let sunday=timelocal({year:2026,mon:11,mday:1,hour:3,min:0,sec:0,isdst:-1});
        push(results,[decision({...settings,days:[0]},sunday,previous,1000).due,'sunday']);
        print(results);
        """
        self.assertEqual(self.evaluate(body), [[True, "requested"], [False, "disabled"], [False, "invalid_clock"], [False, "not_due"], [False, "not_due"], [False, "boot_grace"], [False, "duplicate"], [True, "sunday"]])

    def test_rpc_transport_session_is_not_saved_and_other_unknown_fields_are_rejected(self):
        body = """
        let incoming = {...settings,ubus_rpc_session:'transport-only'}, rejected=[];
        for(let value in [{...incoming,command:'reboot'}, {...incoming,path:'/etc/shadow'}, {...incoming,policy:{enabled:true}}]) {
          try {requestPolicy(value);push(rejected,false);} catch(e) {push(rejected,e.message=='schedule_invalid');}
        }
        let stored=requestPolicy(incoming), transportStillPresent=incoming.ubus_rpc_session=='transport-only';
        try {validate(incoming);push(rejected,false);} catch(e) {push(rejected,e.message=='schedule_invalid');}
        print({stored,transportStillPresent,rejected});
        """
        result = self.evaluate(body)
        self.assertEqual(result["stored"], {"enabled": True, "time": "03:00", "days": list(range(7))})
        self.assertTrue(result["transportStillPresent"])
        self.assertTrue(all(result["rejected"]))

    def test_next_uses_local_calendar_weekday_and_skips_consumed_slots(self):
        body = """
        print([
          nextTime(settings,fixtureNow,previous),
          nextTime({...settings,days:[5]},fixtureNow,previous),
          nextTime(settings,fixtureNow-60,{consumedSlot:'2026-10-27 03:00'}),
          nextTime({...settings,enabled:false},fixtureNow,previous),
          nextTime(settings,timegm({year:2023,mon:1,mday:1}),previous)
        ]);
        """
        self.assertEqual(self.evaluate(body), ["2026-10-28 03:00:00", "2026-10-30 03:00:00", "2026-10-28 03:00:00", None, None])

    def test_skip_consumes_due_slot_and_later_not_due_does_not_forget_it(self):
        body = """
        record('maintenance_busy'); let busy=state(); fixtureNow+=60; record('not_due'); let later=state();
        fixtureNow-=60; let repeated=decision(settings,fixtureNow,later,5000);
        print({busy:busy.last, later:later.last, consumed:later.consumedSlot, repeated});
        """
        result = self.evaluate(body)
        self.assertEqual(result["busy"]["outcome"], "skipped")
        self.assertEqual(result["busy"]["reason"], "maintenance_busy")
        self.assertEqual(result["busy"]["slot"], "2026-10-27 03:00")
        self.assertEqual(result["later"]["reason"], "not_due")
        self.assertEqual(result["consumed"], "2026-10-27 03:00")
        self.assertEqual(result["repeated"]["reason"], "duplicate")

    def test_success_failure_history_and_corrupt_or_oversized_state_are_bounded(self):
        body = """
        reserve(); let reserved=state(), repeated=decision(settings,fixtureNow,reserved,5000);
        record('requested'); let requested=state().last; record('reboot_failed'); let failed=state().last;
        let rejected=[];
        for(let text in ['{}x','[]',sprintf('%4097s','x'),'{"consumedSlot":"../../etc/shadow"}']) {
          writefile(stateFile,text); try {state();push(rejected,false);} catch(e) {push(rejected,true);}
        }
        print({reserved,repeated,requested,failed,rejected});
        """
        result = self.evaluate(body)
        self.assertIsNone(result["reserved"]["last"])
        self.assertEqual(result["reserved"]["consumedSlot"], "2026-10-27 03:00")
        self.assertEqual(result["repeated"]["reason"], "duplicate")
        self.assertEqual(result["requested"]["outcome"], "requested")
        self.assertIsInstance(result["requested"]["at"], int)
        self.assertEqual(result["failed"]["outcome"], "failed")
        self.assertTrue(all(result["rejected"]))


if __name__ == "__main__":
    unittest.main()
