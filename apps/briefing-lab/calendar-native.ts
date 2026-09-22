import { spawn } from 'node:child_process';
import { mkdir, lstat, mkdtemp, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
const SOURCE = String.raw`import Foundation
import EventKit
import AppKit
import Security
let input = FileHandle.standardInput.readDataToEndOfFile()
func finish(_ value: [String:Any]) -> Never { let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); FileHandle.standardOutput.write(data); exit(0) }
func fail(_ code: String) -> Never { finish(["error":code]) }
guard let q = try? JSONSerialization.jsonObject(with: input) as? [String:Any], let action=q["action"] as? String else { fail("calendar_request_invalid") }
let store=EKEventStore()
let app=NSApplication.shared
app.setActivationPolicy(.accessory)
if action.hasPrefix("reminders_") {
 var reminderStatus=EKEventStore.authorizationStatus(for: .reminder)
 if action == "reminders_authorize" && reminderStatus != .fullAccess && reminderStatus != .authorized {
  app.activate(ignoringOtherApps: true)
  var done=false, allowed=false
  store.requestFullAccessToReminders { ok,_ in allowed=ok;done=true }
  let until=Date().addingTimeInterval(90)
  while !done && Date()<until { RunLoop.current.run(until:Date().addingTimeInterval(0.05)) }
  guard done && allowed else { fail("reminders_permission_required") }
  reminderStatus=EKEventStore.authorizationStatus(for: .reminder)
 }
 let authorized=reminderStatus == .fullAccess || reminderStatus == .authorized
 if action == "reminders_catalog" || action == "reminders_authorize" {
  let lists: [[String:Any]] = authorized ? store.calendars(for:.reminder).prefix(200).map { c in
   ["id":c.calendarIdentifier,"name":String(c.title.prefix(300)),"source":String(c.source.title.prefix(300)),"writable":c.allowsContentModifications]
  } : []
  finish(["authorized":authorized,"lists":lists,"defaultListId":authorized ? (store.defaultCalendarForNewReminders()?.calendarIdentifier ?? "") : ""])
 }
 guard action == "reminders_create" else { fail("reminders_action_invalid") }
 guard authorized else { fail("reminders_permission_required") }
 guard let listId=q["listId"] as? String, let list=store.calendars(for:.reminder).first(where:{$0.calendarIdentifier==listId}),list.allowsContentModifications else { fail("reminders_list_unavailable") }
 guard let taskId=q["taskId"] as? String,UUID(uuidString:taskId) != nil,let title=q["title"] as? String,!title.isEmpty,title.count<=240,let notes=q["notes"] as? String,notes.count<=4000 else { fail("reminders_request_invalid") }
 let marker="gosu://briefing-task/"+taskId
 var complete=false, found:[EKReminder]?=nil
 let fetch=store.fetchReminders(matching:store.predicateForReminders(in:[list])) { reminders in found=reminders;complete=true }
 let until=Date().addingTimeInterval(20)
 while !complete && Date()<until { RunLoop.current.run(until:Date().addingTimeInterval(0.05)) }
 guard complete,let existing=found,existing.count<=10000 else { store.cancelFetchRequest(fetch);fail("reminders_read_incomplete") }
 let matches=existing.filter{$0.url?.absoluteString==marker}
 guard matches.count<=1 else { fail("reminders_duplicate_uncertain") }
 if let prior=matches.first { finish(["id":prior.calendarItemIdentifier,"existing":true]) }
 let reminder=EKReminder(eventStore:store)
 reminder.calendar=list;reminder.title=title;reminder.notes=notes;reminder.url=URL(string:marker)
 if let instant=q["dueAt"] as? String {
  let format=ISO8601DateFormatter()
  format.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
  let fractional=format.date(from:instant)
  format.formatOptions=[.withInternetDateTime]
  guard let date=fractional ?? format.date(from:instant) else { fail("reminders_date_invalid") }
  var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone(secondsFromGMT:0)!
  var components=calendar.dateComponents([.year,.month,.day,.hour,.minute,.second],from:date)
  components.timeZone=calendar.timeZone
  reminder.dueDateComponents=components
 } else if let due=q["dueDate"] as? String {
  let format=DateFormatter();format.locale=Locale(identifier:"en_US_POSIX");format.calendar=Calendar(identifier:.gregorian);format.dateFormat="yyyy-MM-dd";format.isLenient=false
  guard let date=format.date(from:due),format.string(from:date)==due else { fail("reminders_date_invalid") }
  reminder.dueDateComponents=format.calendar.dateComponents([.year,.month,.day],from:date)
 }
 do { try store.save(reminder,commit:true);finish(["id":reminder.calendarItemIdentifier,"existing":false]) } catch { fail("reminders_write_uncertain") }
}
let status=EKEventStore.authorizationStatus(for: .event)
if action == "status" { finish(["authorized": status == .fullAccess || status == .authorized]) }
if action == "authorize" {
 app.activate(ignoringOtherApps: true)
 var done=false, allowed=false
 store.requestFullAccessToEvents { ok,_ in allowed=ok;done=true }
 let until=Date().addingTimeInterval(90)
 while !done && Date()<until { RunLoop.current.run(until:Date().addingTimeInterval(0.05)) }
 guard done && allowed else { fail("calendar_permission_required") }
 finish(["authorized":true])
}
guard status == .fullAccess || status == .authorized else { fail("calendar_permission_required") }
let calendars=store.calendars(for: .event)
if action == "calendars" {
 finish(["calendars":calendars.prefix(100).map { c -> [String:Any] in
 let color=NSColor(cgColor:c.cgColor)?.usingColorSpace(.deviceRGB)
 return ["id":c.calendarIdentifier,"name":String(c.title.prefix(300)),"source":String(c.source.title.prefix(200)),"writable":c.allowsContentModifications,"color":color.map{String(format:"#%02X%02X%02X",Int($0.redComponent*255),Int($0.greenComponent*255),Int($0.blueComponent*255))} ?? "#527d0b"] }])
}
let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
func date(_ value:Any?) -> Date? { guard let s=value as? String else{return nil}; if let d=formatter.date(from:s){return d};let f=ISO8601DateFormatter();return f.date(from:s) }
func encode(_ event:EKEvent) -> [String:Any] {
 return ["nativeId":event.eventIdentifier ?? "","modifiedAt":event.lastModifiedDate.map{formatter.string(from:$0)} ?? "","calendarId":event.calendar.calendarIdentifier,"title":String((event.title ?? "").prefix(300)),"start":formatter.string(from:event.startDate),"end":formatter.string(from:event.endDate),"allDay":event.isAllDay,"timeZone":event.timeZone?.identifier ?? TimeZone.current.identifier,"location":String((event.location ?? "").prefix(1000)),"notes":String((event.notes ?? "").prefix(6000)),"alarmMinutes":event.alarms?.first.map{max(0,Int(-$0.relativeOffset/60))} as Any? ?? NSNull(),"recurring":event.hasRecurrenceRules,"hasAttendees":!(event.attendees?.isEmpty ?? true),"contentTruncated":(event.notes ?? "").count>6000 || (event.title ?? "").count>300 || (event.location ?? "").count>1000]
}
func sameContent(_ event: EKEvent, _ expected: [String:Any]) -> Bool {
 var current=encode(event), previous=expected
 current.removeValue(forKey:"modifiedAt");previous.removeValue(forKey:"modifiedAt")
 guard let a=try? JSONSerialization.data(withJSONObject:current,options:[.sortedKeys]),let b=try? JSONSerialization.data(withJSONObject:previous,options:[.sortedKeys]) else{return false}
 return a==b
}
// Only a certificate-signed installed GOSU parent can use the direct UI path. CLI/AI calls
// retain native confirmation; a caller-supplied boolean alone is not sufficient.
func trustedGosuParent() -> Bool {
 let expectedURL=URL(fileURLWithPath:"/Applications/GOSU.app")
 guard NSRunningApplication(processIdentifier:getppid())?.bundleURL?.standardizedFileURL.path == expectedURL.path else {return false}
 var installed:SecStaticCode?, requirement:SecRequirement?, parent:SecCode?, information:CFDictionary?
 guard SecStaticCodeCreateWithPath(expectedURL as CFURL,[],&installed)==errSecSuccess, let installed=installed,
 SecStaticCodeCheckValidity(installed,SecCSFlags(rawValue:kSecCSStrictValidate),nil)==errSecSuccess,
 SecCodeCopySigningInformation(installed,SecCSFlags(rawValue:kSecCSSigningInformation),&information)==errSecSuccess,
 let certs=(information as? [String:Any])?[kSecCodeInfoCertificates as String] as? [Any], !certs.isEmpty,
 SecCodeCopyDesignatedRequirement(installed,[],&requirement)==errSecSuccess, let requirement=requirement,
 SecCodeCopyGuestWithAttributes(nil,[kSecGuestAttributePid as String:getppid()] as CFDictionary,[],&parent)==errSecSuccess, let parent=parent else {return false}
 return SecCodeCheckValidity(parent,SecCSFlags(rawValue:kSecCSStrictValidate),requirement)==errSecSuccess
}
if action == "events" {
 guard let ids=q["calendarIds"] as? [String], !ids.isEmpty, ids.count<=30, let start=date(q["start"]), let end=date(q["end"]), end>start, end.timeIntervalSince(start)<=93*86400 else{fail("calendar_range_invalid")}
 let selected=calendars.filter{ids.contains($0.calendarIdentifier)}
 guard selected.count==Set(ids).count else{fail("calendar_scope_missing")}
 let found=store.events(matching:store.predicateForEvents(withStart:start,end:end,calendars:selected)).filter{$0.status != .canceled}.sorted{$0.startDate<$1.startDate}
 finish(["events":found.prefix(500).map{encode($0)},"limited":found.count>500])
}
guard ["create","update","delete"].contains(action),let draft=q["draft"] as? [String:Any],let cid=draft["calendarId"] as? String,let calendar=calendars.first(where:{$0.calendarIdentifier==cid}),calendar.allowsContentModifications,let start=date(draft["start"]),let end=date(draft["end"]),end>start else{fail("calendar_write_invalid")}
var event:EKEvent
if action == "create" { event=EKEvent(eventStore:store);event.calendar=calendar }
else {
 guard let nativeId=q["nativeId"] as? String,let originalStart=date(q["originalStart"]) else {fail("calendar_event_missing")}
 let found=store.events(matching:store.predicateForEvents(withStart:originalStart.addingTimeInterval(-1),end:originalStart.addingTimeInterval(1),calendars:[calendar]))
 guard let original=found.first(where:{$0.eventIdentifier==nativeId && abs($0.startDate.timeIntervalSince(originalStart))<0.1}) else{fail("calendar_event_missing")}
 guard original.attendees?.isEmpty ?? true else{fail("calendar_invitation_readonly")}
 guard (encode(original)["contentTruncated"] as? Bool) != true else {fail("calendar_content_readonly")}
 guard let expected=q["original"] as? [String:Any],sameContent(original,expected) else{fail("calendar_event_changed")}
 event=original
}
if (q["directInteraction"] as? Bool) != true || !trustedGosuParent() {
let review=NSAlert();review.messageText="GOSU Calendar 변경 확인"
let reviewTitle=draft["title"] as? String ?? "", reviewStart=draft["start"] as? String ?? "", reviewEnd=draft["end"] as? String ?? ""
review.informativeText="\(action) · \(calendar.title)\n\(reviewTitle)\n\(reviewStart) → \(reviewEnd)\n반복 일정은 이번 발생만 변경합니다. 직접 검토한 변경일 때만 승인하세요."
review.addButton(withTitle:"취소");review.addButton(withTitle:"이 변경 승인")
app.activate(ignoringOtherApps:true)
guard review.runModal() == .alertSecondButtonReturn else {fail("calendar_write_declined")}
}
if action != "create" {
 store.reset()
 guard let nativeId=q["nativeId"] as? String,let originalStart=date(q["originalStart"]),let currentCalendar=store.calendars(for:.event).first(where:{$0.calendarIdentifier==cid}),currentCalendar.allowsContentModifications else {fail("calendar_event_changed")}
 let refreshed=store.events(matching:store.predicateForEvents(withStart:originalStart.addingTimeInterval(-1),end:originalStart.addingTimeInterval(1),calendars:[currentCalendar]))
 guard let fresh=refreshed.first(where:{$0.eventIdentifier==nativeId && abs($0.startDate.timeIntervalSince(originalStart))<0.1}),let expected=q["original"] as? [String:Any] else {fail("calendar_event_changed")}
 guard sameContent(fresh,expected) else {fail("calendar_event_changed")}
 event=fresh
}
do {
 if action == "delete" {try store.remove(event,span:.thisEvent,commit:true);finish(["deleted":true])}
 guard let title=draft["title"] as? String,!title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{fail("calendar_title_required")}
 event.title=title;event.startDate=start;event.endDate=end;event.isAllDay=draft["allDay"] as? Bool ?? false;event.timeZone=TimeZone(identifier:draft["timeZone"] as? String ?? TimeZone.current.identifier);event.location=draft["location"] as? String;event.notes=draft["notes"] as? String
 let previousAlarm=event.alarms?.first.map{max(0,Int(-$0.relativeOffset/60))}
 let requestedAlarm=draft["alarmMinutes"] as? Int
 if action == "create" || requestedAlarm != previousAlarm {
  if let minutes=requestedAlarm {event.alarms=[EKAlarm(relativeOffset:Double(-minutes*60))]} else {event.alarms=[]}
 }
 try store.save(event,span:.thisEvent,commit:true);finish(["event":encode(event)])
} catch {fail("calendar_write_failed")}
`;
const PLIST = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>science.gosu.briefing-calendar</string><key>CFBundleName</key><string>GOSU Briefing Calendar</string><key>CFBundleExecutable</key><string>CalendarBridge</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>NSCalendarsFullAccessUsageDescription</key><string>GOSU에서 선택한 Calendar를 조회하고, 직접 승인한 일정 변경과 알림을 저장합니다.</string><key>NSCalendarsUsageDescription</key><string>GOSU에서 선택한 Calendar와 승인한 일정 변경에 접근합니다.</string><key>NSRemindersFullAccessUsageDescription</key><string>GOSU adds the tasks you confirm to your selected Reminders list. 선택한 미리 알림 목록에 확인한 할 일을 추가하고 중복 여부를 확인합니다.</string><key>NSRemindersUsageDescription</key><string>선택한 미리 알림 목록에 확인한 할 일을 추가합니다.</string></dict></plist>`;
let compiled: Promise<string> | undefined;
export async function packagedCalendarBinary(resourcesPath?: string) {
  if (!resourcesPath) return undefined;
  try {
    if (!(await lstat(join(resourcesPath, 'app.asar'))).isFile()) return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const binary = join(resourcesPath, 'CalendarBridge.app', 'Contents', 'MacOS', 'CalendarBridge');
  if (!(await lstat(binary)).isFile()) throw new Error('calendar_packaged_bridge_missing');
  return binary;
}
export function prepareCalendarBridge(): Promise<string> {
  if (!compiled)
    compiled = (async () => {
      if (process.platform !== 'darwin') throw new Error('calendar_macos_required');
      const bundled = await packagedCalendarBinary(
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
      );
      if (bundled) return bundled;
      const root = join(
        homedir(),
        'Library',
        'Application Support',
        'GOSU',
        'briefing-lab',
        'runtime',
      );
      await mkdir(root, { recursive: true, mode: 0o700 });
      if ((await lstat(root)).isSymbolicLink()) throw new Error('calendar_path_unsafe');
      const app = join(
          root,
          `Calendar-${createHash('sha256')
            .update(SOURCE + PLIST)
            .digest('hex')
            .slice(0, 16)}.app`,
        ),
        binary = join(app, 'Contents', 'MacOS', 'CalendarBridge');
      try {
        if ((await lstat(binary)).isFile()) return binary;
      } catch {
        /* Build when no cached executable exists. */
      }
      const temporary = await mkdtemp(join(root, 'calendar-build-'));
      try {
        const bundle = join(temporary, 'Calendar.app'),
          out = join(bundle, 'Contents', 'MacOS', 'CalendarBridge');
        await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true });
        await writeFile(join(bundle, 'Contents', 'Info.plist'), PLIST);
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            '/usr/bin/xcrun',
            [
              'swiftc',
              '-swift-version',
              '5',
              '-O',
              '-target',
              `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
              '-o',
              out,
              '-',
            ],
            { stdio: ['pipe', 'ignore', 'pipe'] },
          );
          let diagnostic = '';
          child.stderr.on('data', (b) => {
            diagnostic = (diagnostic + b).slice(-3000);
          });
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('calendar_bridge_build_timeout'));
          }, 90000);
          child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error('calendar_bridge_build_failed:' + diagnostic));
          });
          child.on('error', () => {
            clearTimeout(timer);
            reject(new Error('calendar_bridge_build_failed'));
          });
          child.stdin.on('error', () => undefined);
          child.stdin.end(SOURCE);
        });
        await chmod(out, 0o700);
        await new Promise<void>((resolve, reject) => {
          const child = spawn('/usr/bin/codesign', ['--force', '--sign', '-', bundle], {
            stdio: 'ignore',
          });
          child.on('error', () => reject(new Error('calendar_bridge_sign_failed')));
          child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error('calendar_bridge_sign_failed')),
          );
        });
        await rename(bundle, app);
        return binary;
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    })().catch((error) => {
      compiled = undefined;
      throw error;
    });
  return compiled;
}
export async function runCalendarNative(input: unknown, signal: AbortSignal): Promise<unknown> {
  const executable = await prepareCalendarBridge();
  if (signal.aborted) throw new Error('source_cancelled');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '',
      done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        child.kill();
        reject(error);
      } else {
        try {
          const result = JSON.parse(output);
          if (result.error) reject(new Error(result.error));
          else resolve(result);
        } catch {
          reject(new Error('calendar_response_invalid'));
        }
      }
    };
    const abort = () => finish(new Error('source_cancelled')),
      timer = setTimeout(() => finish(new Error('calendar_timeout')), 100000);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (b) => {
      output += b;
      if (Buffer.byteLength(output) > 5_000_000) finish(new Error('calendar_response_limit'));
    });
    child.on('error', () => finish(new Error('calendar_unavailable')));
    child.on('close', (code) => finish(code === 0 ? undefined : new Error('calendar_unavailable')));
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
    if (signal.aborted) abort();
  });
}
