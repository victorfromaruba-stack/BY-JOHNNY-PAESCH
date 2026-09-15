/**
 * Forwards Interval's own emails to the Circle, so a Getaway reaches the board by itself.
 *
 * WHAT THIS IS AND IS NOT. This does not log in to Interval, does not read their site and does
 * not automate anything of theirs. It reads mail Interval already sent to Victor, in Victor's own
 * inbox, and posts the text to the Circle. Interval's terms forbid automated access to their
 * service; nothing here touches their service.
 *
 * SET IT UP (about three minutes, once):
 *   1. script.google.com → New project. Paste this whole file over the empty Code.gs.
 *   2. Project Settings → Script properties → Add script property:
 *        INGEST_TOKEN   = (the token the Desk was given — never paste it into the code itself)
 *   3. Back in the editor, pick `runOnce` from the function dropdown and press Run.
 *      Google asks for permission to read your Gmail the first time. That permission is what
 *      lets it see the Interval mail; it is your own account granting it to your own script.
 *   4. Triggers (the clock icon) → Add trigger → `pollInterval`, time-driven, every 5 minutes.
 *
 * After that: every Interval Getaway confirmation, and every Getaway Alert once you switch alerts
 * on, is on the board within five minutes of landing in your inbox. Anything it posts is labelled
 * "Hunto/posted" in Gmail so you can see exactly what it did, and anything it could not read is
 * labelled "Hunto/could-not-read" rather than silently dropped.
 */

var ENDPOINT = 'https://cdkopyphjvfxjqhasrae.supabase.co/functions/v1/ingest-deal';

// Interval's own senders. Anything else is ignored, so a forwarded copy from a stranger cannot
// put a week on the Circle's board.
var SEARCH = 'from:(intervalintl.com OR email-intervalintl.com OR intervalworld.com) ' +
             'newer_than:30d -label:Hunto/posted -label:Hunto/could-not-read';

function pollInterval() {
  var token = PropertiesService.getScriptProperties().getProperty('INGEST_TOKEN');
  if (!token) throw new Error('Set the INGEST_TOKEN script property first.');

  var done = label_('Hunto/posted');
  var stuck = label_('Hunto/could-not-read');
  var threads = GmailApp.search(SEARCH, 0, 25);

  threads.forEach(function (thread) {
    var posted = false, unreadable = false;
    thread.getMessages().forEach(function (m) {
      var res = post_(token, m.getSubject(), m.getPlainBody());
      if (res.ok && !res.skipped) posted = true;
      else if (res.skipped) unreadable = true;
    });
    // A thread that produced a week is filed as posted; one nothing could be read from is filed
    // separately so it is visible rather than retried for ever.
    if (posted) thread.addLabel(done);
    else if (unreadable) thread.addLabel(stuck);
  });
}

/** The same pass, but it logs what happened instead of labelling. Use it to check the setup. */
function runOnce() {
  var token = PropertiesService.getScriptProperties().getProperty('INGEST_TOKEN');
  if (!token) throw new Error('Set the INGEST_TOKEN script property first.');
  var threads = GmailApp.search(SEARCH, 0, 5);
  if (!threads.length) {
    Logger.log('No Interval mail in the last 30 days that has not already been filed.');
    return;
  }
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      var res = post_(token, m.getSubject(), m.getPlainBody(), true);
      Logger.log(m.getSubject() + '  ->  ' + JSON.stringify(res));
    });
  });
}

function post_(token, subject, body, dryRun) {
  var payload = { subject: subject, text: body };
  if (dryRun) payload.dryRun = true;
  var r = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-token': token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  try { return JSON.parse(r.getContentText()); }
  catch (e) { return { ok: false, skipped: true, why: 'HTTP ' + r.getResponseCode() }; }
}

function label_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
