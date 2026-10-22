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

The popup title should show **v18** after replacing the script and reloading the
sheet. Column D chooses the template; column E chooses the project.

## Belt changes and history folders

For a direct PDF link, a different belt in column D loads that belt's verified
blank template, fills it, and replaces the existing file's contents and filename.
The Drive ID and link stay the same. The old PDF is backed up first. Undo restores
both its previous contents and filename. This also supports switching to an
earlier belt; it does not assume students always advance in belt order.

For the selected student, check **Level-up: keep previous trackers in a folder**
to preserve history instead. When the linked PDF is a different belt, the script
creates a student folder alongside the old PDF (or in My Drive if no parent is
available), copies the old tracker into it, and adds the filled new belt PDF.
The original old PDF stays intact. Column I (J for Scratch Jr when used) changes
to the folder URL. Undo removes the generated files and restores the prior link.

If I/J already links to a folder, previous belt PDFs remain there automatically.
The script updates the PDF matching column D, or adds it from its template if
that belt is missing. It does not create another copy when that belt already
exists. Multiple matching PDFs are reported as ambiguous. Folder mode is chosen
per selected student; day batches use existing folders automatically and replace
mismatched direct PDF links using backups.

The script verifies the student's name before replacing a different belt PDF.
It validates the filled result before uploading or creating files. It never
overwrites a configured blank template. A folder you create must be accessible
to the intended parents; the generator does not change sharing permissions.

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
CS_1 and JR, N must be `PDF UPDATED` and N1 must be `PDF STATUS`. Fundamentals
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
matching heading. Clients data starts at row 2 and daily journal students at row
3. Editing any dated journal tab loads student details, including older dates.
Choosing another student clears the old current belt/project, resets readiness,
and marks the PDF stale. Changing the belt clears an old project unless the edit
explicitly pastes a replacement project too. Multi-row edits are supported.

Rebuilding Clients processes tabs by session date, oldest first, so later
sessions win regardless of tab order. Blank values do not erase existing saved
progress or links. No live email has been sent as part of developing this change.

Blue numbered Solve projects map directly to the printed wrench fields, regardless
of Courses list order. Earlier activities become C and earlier levels receive L.
Later IMPACT C/W/R/L markers are cleared to match the journal project; explicit S
skips remain. Dropdowns without blank options can also be cleared. Quest level-up
still requires approval. Moving the journal project backwards resets later progress,
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
