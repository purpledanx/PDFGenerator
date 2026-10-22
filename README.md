# PDFGenerator

Google Apps Script journal, parent email, and student tracker PDF workflow.
`PDFGenerator.gs` generates trackers; `Code.gs` contains the corrected journal
and email script. Keep both files in the same Apps Script project.

## Apply the fix

In the journal's Apps Script project, replace the existing PDFGenerator script
with `PDFGenerator.gs`. For the journal/email fixes, replace the existing
`Code.gs` with this repository's `Code.gs` as well. Replace existing contents
rather than adding second copies with duplicate functions and constants.
Keep the existing HTML templates and other project files. Save, then reload
the spreadsheet. No emails are sent by saving these files.

Set the student's program in column D and current project in E. Use
**Tracker PDFs → Generate / Update Tracker** to update the PDF linked in I
(or J for Scratch Jr). Changing E alone marks the tracker as needing an update;
it does not automatically rewrite the PDF. Existing backup and undo behavior
remains available.

This revision is **v29**. Replace the script and reload the sheet to use it.
Column D chooses the template; column E chooses the project.

Generation asks for confirmation when it needs to add a new belt tracker.
Cancel makes no tracker changes. An existing belt update does not prompt.
If the tracker link is blank, generation creates a folder named exactly after
that child in My Drive and adds the filled tracker. Undo removes the generated
files and restores the previous link, including a blank link. An inaccessible
or invalid existing link is reported rather than silently replaced. The dated
`getDateMd` documentation comment is retained in `Code.gs`.

## Belt changes and history folders

When column D specifies a different belt than the linked PDF, a confirmation
popup lists the child and new belt. After confirmation, the script automatically
creates a folder named exactly after the child (for example, `Oliver P`), copies
the old tracker into it, and adds a filled PDF from the correct belt template.
The folder is created alongside the old PDF, or in My Drive if no parent is
available. The original old PDF remains intact. Column I (J for Scratch Jr when
used) changes to the folder URL. There is no level-up checkbox or replace-belt
option. Undo removes the generated files and restores the previous link.

If I/J already links to a folder, future belts are added to that same folder
after confirmation, preserving all previous trackers. If that belt already has
one matching PDF, the script updates it without creating a duplicate or asking
for new-belt confirmation. Multiple matching PDFs are reported as ambiguous.
The same behavior applies to selected-student and day generation.

The script verifies the student's name before copying a different belt PDF.
It validates the filled result before uploading or creating files and never
overwrites a configured blank template. The generator sets the student folder and all PDFs inside it to **Anyone with
the link → Viewer**. A direct tracker PDF gets the same viewing access. Running
generation again applies this to an existing history folder and its earlier
belt PDFs as well. Templates and Undo backups are not explicitly shared.
Existing public view/comment/edit access is checked first, so already-shared
files and folders are not reshared. If Google rejects a needed sharing change
and a fresh read cannot confirm public viewing, generation reports an error rather than
marking the tracker updated. Undo restores tracker content/links; it does not
revoke link viewing on existing files or folders.

## Undo backup retention

Undo backup PDFs are kept for the five most recent successful generation actions
per journal. A whole-day run counts as one action, even when it updates many
students. On action six, backups from the oldest action move to Drive Trash.
Empty or fully failed runs do not advance retention. Undo Last PDF Update still
restores only the latest run; keeping backup files does not add a history picker.

Cleanup removes only recorded backup PDFs in the Undo backup folder. Student
trackers, child folders and archived belt PDFs are preserved. A failed update
with a successful rollback discards its unused backup immediately. Cleanup
permission failures are logged and retried on later generation actions.

The last available Undo run is registered when upgrading. Older untracked
backups from previous script versions are left alone because their action ages
cannot be established reliably.

## Whole-day progress

The whole-day dialog stays open until you close it. It shows the completed
student count, current student's name and processing stage, a progress bar, and
per-student tracker links or errors. At the end it shows updated/failed totals
and a Close button. Student-level failures do not prevent other students from
being processed. A failed server request stops the run with the error visible.

Progress stages include finding the tracker, filling markers, validating saved
values, backing up or creating PDFs, enabling link viewing, and updating the
journal link. Stages are read periodically while each student is processed.
The dialog uses public Apps Script entry points; private functions ending in
an underscore are not callable from HTML-service clients.

## Email links

The supplied `sendEmails` function puts column I into `levelTemplate.trackerLink`
and J into `levelTemplate.jrLink`. It sends an HTML email without attachments.
With a folder URL, the tracker link opens that folder, where parents can select
the current or earlier belts. It does not automatically select or attach a PDF.
The HTML template must use these properties as its links.

The replacement `Code.gs` reads plain URLs, HYPERLINK formulas, and linked labels.
After a successful email, it saves I/J into Clients C/D along with the student's
progress. The next session therefore loads the saved history folder URL.
`saveClientsProgress` and `reupdateClientsProgress` also persist those links.

Only rows with K checked and L exactly `NOT SENT` are eligible. For IMPACT, Unity,
CS_1 and JR, N must be `PDF UPDATED` or `UNDONE` and N1 must be `PDF STATUS`.
`UNDONE` sends the restored tracker/link without requiring regeneration.
Fundamentals
keeps its existing workflow because the PDF generator does not support it.
Every eligible row is validated and its HTML rendered before any email is sent;
an invalid row blocks the batch with row-specific errors. The existing HTML
templates (`impact`, `belts`, `scratchJr`, `cs1AndFundamentals`) must still exist.
Generating a PDF does not send email or reset an `EMAIL SENT` status.

`sendEmails(true)` asks for confirmation and Cancel stops the operation.
`sendEmails()` retains the existing behavior of sending without a dialog. Both
use the selected journal tab's date and the year in the spreadsheet filename.
If Courses A2 contains a subject with `<ninja>`, `<level>` or `<date>`, it is used;
when A2 is a curriculum project under a course heading, a standard progress
subject is used instead. This avoids sending a project title as the subject.

Course names are read from Courses row 1; projects start at row 2 under the
matching heading. Clients and journal email processing start at row 2, matching
the original email script. Blank or unchecked rows are skipped. The PDF generator
currently selects students from row 3 onward. Editing any dated journal tab loads
student details, including older dates.
Choosing another student clears the old current belt/project, resets readiness,
and marks the PDF stale. Changing the belt clears an old project unless the edit
explicitly pastes a replacement project too. Multi-row edits are supported.

Rebuilding Clients processes tabs by session date, oldest first, so later
sessions win regardless of tab order. Blank values do not erase existing saved
progress or links. No live email has been sent as part of developing this change.

After running `sendEmails`, a spreadsheet notification reports how many emails
were submitted, or explains that no rows were eligible. Validation and mail
errors also appear in a notification and Apps Script execution logs. `EMAIL SENT`
means Google accepted the send request; it does not confirm inbox delivery.

Some belt PDFs have fewer activity markers than the Courses list has projects.
When a project exceeds the available W/C/S slots (for example, Explore entries),
the last valid activity marker is shared. Notes always identify the exact current
project in this case. The quest marker stays separate, and genuinely ambiguous
or missing fields still stop generation rather than updating the wrong field.

Blue numbered Solve projects map directly to the printed wrench fields, regardless
of Courses list order. Earlier activities become C and earlier levels receive L.
Later IMPACT C/W/R/L markers are cleared to match the journal project; explicit S
skips remain. Dropdowns without blank options can also be cleared. A current
Quest / Adventure is marked W in its quest dropdown. When a source field only
allows R/L/blank, W is added to that student's PDF, leaving the shared template
unchanged. Selecting a quest does not award the current level an L. Moving the
journal project backwards resets later progress,
so use Undo Last PDF Update to restore the prior tracker if needed.

## Local checks

Use Node.js 24 and run from this directory:

```sh
npm ci --cache /tmp/pdfgenerator-npm-cache --no-audit --no-fund
npm test
```

The tests simulate journal edits and email sending, exercise link persistence,
confirmation, PDF readiness, subject dates, dropdowns and chronological saving.
They also create editable PDF fixtures with pdf-lib 1.17.1, move projects forward
and backward, and save/reopen PDFs to check marker values and visible appearance
streams. No local server is required. Live spreadsheet, Drive, and undo operations
must be checked in the authorized Google Apps Script runtime; these tests do not
connect to Google or modify student PDFs.

Documentation and code changes are maintained by [purpledanx](https://github.com/purpledanx).
