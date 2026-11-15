# Send Feedback and Lost Item Report — Component Documentation
### Bukidnon Bus Company @BUKSU — Passenger Module

*The descriptions below are based on direct inspection of the system's source code. They describe what the passenger sees, what each control does, and how the system actually handles what is submitted, written in plain language rather than technical terms.*

---

## Send Feedback

**"Mainly About" Category.**
Before writing their feedback, the passenger first chooses what the feedback is mainly about, from four options: Route, stop, or terminal; Bus or vehicle; Driver; or Bus attendant. This choice is not just a label attached to the comment — it genuinely changes how the feedback is used afterward. If "Driver" is selected, an additional field appears asking the passenger to identify which driver the feedback concerns, and this becomes a required part of the submission in that case. Feedback specifically about a driver also contributes to that driver's own performance record elsewhere in the system, and administrators can filter and review feedback by this same category when looking through submissions.

**Feedback Text and Star Rating.**
The passenger rates their experience using a set of five stars and may also write a short comment describing their experience. Selecting at least one star is required before the feedback can be sent. For ratings of three stars or lower, the interface also requires the passenger to write at least a few words explaining their rating. It is worth noting a real inconsistency found in the system: although the on-screen form suggests that a written comment is only required for ratings below four stars, the system's actual processing on the back end will reject a four- or five-star rating submitted with no comment at all, which the interface otherwise allows the passenger to attempt. In practice, this means only ratings of one or two stars can truly be submitted without any written comment; a passenger giving four or five stars with nothing written will see their submission fail, shown only as a general error message rather than an explanation of why.

**Send Button and Confirmation.**
While the feedback is being sent, the button shows a brief "Sending…" state. On a successful submission, the form is cleared and a confirmation message appears, thanking the passenger and stating that operations staff will review the feedback. If sending fails, a clear error message is shown instead. One minor point worth noting is that once a successful confirmation has been shown, it remains visible even if the passenger submits feedback again afterward and that later attempt happens to fail — meaning both the earlier "received" message and a new error message could appear together, which may look slightly confusing. There is no limit specifically preventing a passenger from submitting the same feedback more than once; the only restriction in place is a general traffic limit shared across the whole system, not something designed to catch repeated or duplicate feedback specifically.

---

## Lost Item Report — "Left Something?"

**Date Last Seen.**
This field lets the passenger indicate when they last had the item with them, and is labeled on screen as optional. However, it was found to actually be required for the report to go through successfully — leaving it blank causes the submission to be rejected by the system, despite what the "(optional)" label on screen suggests. This is a limitation worth being aware of, since a passenger who skips this field exactly as the interface seems to invite them to do will have their report fail.

**Bus You Were On.**
The passenger can select which bus they were riding from a list of the company's actual registered buses, or choose a final option worded "Not sure / different bus" if they are uncertain. This field is genuinely optional, unlike the date field above. One technical limitation was found here as well: when a passenger selects "Not sure / different bus," a small mismatch in how that choice is processed means it is not cleanly converted into a readable "unknown bus" label as intended — instead, the internal placeholder value itself ends up stored as-is. This does not prevent the report from being submitted, but it means this particular selection is not recorded as cleanly as the other options.

**Your Email.**
This field is also labeled on screen as optional, but — like the date field — was found to actually be required; a report submitted with no email address will be rejected by the system, even though the interface does not stop the passenger from trying to submit it that way. If an email address is entered, it is checked to make sure it is in a valid format before the report can be sent.

**Details.**
This is a free-text field for describing the lost item, and is the one field genuinely marked and treated as optional throughout — it is not required either on screen or by the system processing the report.

**Submit Button and Confirmation.**
The button is disabled briefly while the report is being sent, preventing the passenger from accidentally submitting it twice in quick succession. On success, a confirmation message explains that terminal staff will compare the report against their records and may contact the passenger using the email address they provided, and that administrators are alerted both through an in-system notification and, where configured, by email. Unlike the feedback form, the lost-item form's fields are not cleared after a successful submission, so the passenger's previously entered details remain visible on screen. No reference number or tracking code is shown to the passenger at any point, even though the system does generate one internally for its own records.

**How Reports Are Reviewed by Staff.**
Both feedback and lost-item reports are genuinely saved and are reviewable by administrative staff, on a dedicated review screen built specifically for this purpose, separate from the screen administrators use to manage ticket and passenger activity. On that screen, feedback and lost-item reports appear together in one combined, most-recent-first list, with lost-item reports clearly marked as such. It is worth noting, however, that the lost-item report is stored using the same general incident-logging system the company uses for emergency reports, rather than a dedicated lost-and-found record — as a result, most of what the passenger typed (when the item was last seen, which bus, their email, and the details) is combined into a single written note rather than kept as clearly separate, individually labeled pieces of information, with only the bus information kept as its own separate detail. No location or device information is automatically captured alongside a lost-item report beyond the time it was submitted.

**Tracking a Submission's Status.**
Neither the feedback form nor the lost-item report form currently gives the passenger any way to check back on their submission afterward. No reference number, confirmation code, or "my submissions" list is shown or made available to the passenger at any point — once the one-time confirmation message has been seen, there is no further way for the passenger to follow up on what happened to their report through the system itself.

---

## Documentation Summary

The Send Feedback and Lost Item Report features give passengers a direct way to share their experience and to seek help recovering a lost belonging, without needing to create an account or contact the company through any other channel. Both genuinely reach administrative staff through a shared review screen built for this purpose, so submissions are not simply collected and ignored. At the same time, a passenger using either feature should be aware of a few real limitations uncovered during this review: two fields on the lost-item form are labeled optional but are actually required for the report to succeed, a four- or five-star feedback rating with no written comment may unexpectedly fail to send, and neither feature currently lets a passenger check back on what happened to a report they already submitted.

## Testing and Verification

This documentation is based entirely on direct inspection of the system's source code, including comparing what the on-screen forms communicate to passengers against how the system actually processes each submission behind the scenes. It has not been confirmed through actual use of the running application in a browser, and no live submission of feedback or a lost-item report was performed as part of producing this documentation.
