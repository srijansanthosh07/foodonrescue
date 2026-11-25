# Manual test checklist

## Setup

1. Run `supabase/01_schema.sql`, then `supabase/02_matching.sql` in the Supabase SQL editor.
2. Enable Realtime for `notifications`, `donations`, and `assignments`.
3. Create test users:
   - Donor A near NGO 1 (within 10 km).
   - Donor B far from all NGOs.
   - NGO 1 verified, NGO 2 pending, NGO 3 rejected, NGO 4 suspended.
   - Volunteer 1 available, Volunteer 2 busy, Volunteer 3 offline.
   - Admin 1.
4. Give NGOs and volunteers valid `lat`, `lng`, and `service_radius_km` values.
5. Open the app at desktop width and at 375 px mobile width.

## Matching SQL

- [ ] `select * from nearby_ngos(9.9252, 78.1198);` returns verified, non-suspended NGOs inside 10 km.
- [ ] Results are ordered by `distance_km` ascending.
- [ ] `select * from nearby_ngos(9.9252, 78.1198, 1);` returns fewer or zero rows than the 10 km call.
- [ ] `select * from nearby_ngos(9.9252, 78.1198, 50);` includes the far NGO if it is verified.
- [ ] Pending, rejected, suspended, and coordinate-less NGOs never appear.
- [ ] Calling with `null` coordinates or radius `0` returns no rows.
- [ ] Donor A creates a donation: every returned NGO gets a `notifications` row with the donation title and `donation_id`.
- [ ] Donor B creates a far-away donation: no nearby NGO receives a notification.
- [ ] NGO 2, NGO 3, and NGO 4 never receive creation notifications.

## Role access and negative access

- [ ] Logged-out user visiting `/donor`, `/ngo`, `/volunteer`, or `/admin` is redirected to `/login`.
- [ ] Donor visiting `/ngo`, `/volunteer`, or `/admin` is redirected to `/donor`.
- [ ] NGO visiting `/donor`, `/volunteer`, or `/admin` is redirected to `/ngo`.
- [ ] Volunteer visiting `/donor`, `/ngo`, or `/admin` is redirected to `/volunteer`.
- [ ] Admin visiting `/donor`, `/ngo`, or `/volunteer` is redirected to `/admin`.
- [ ] Registering with role `admin` creates a donor account.
- [ ] Suspended user cannot log in and sees the suspended-account error.
- [ ] NGO 2 pending sees the verification banner and the Accept button is disabled.
- [ ] NGO 3 rejected cannot accept donations.

## Donor flow

### Creation validation

- [ ] Empty form shows field errors and one error toast.
- [ ] Quantity `0` or negative is rejected.
- [ ] Past expiry time is rejected.
- [ ] Pickup end before pickup start is rejected.
- [ ] Pickup end after expiry is rejected.
- [ ] Missing map pin is rejected.
- [ ] Missing food photo is rejected.
- [ ] Unsupported image type is rejected.
- [ ] Image larger than 5 MB is rejected.
- [ ] More than 3 images is rejected.
- [ ] Unchecked safety declaration is rejected.
- [ ] Valid form posts the donation, shows a success toast, and redirects to `/donor`.

### Donation views and transitions

- [ ] New donation appears as `AVAILABLE` in Donor Dashboard.
- [ ] Nearby NGO notification bell badge increases and toast appears.
- [ ] When NGO accepts, donor sees `ACCEPTED` and NGO name.
- [ ] When volunteer is assigned, donor sees `ASSIGNED` and volunteer name.
- [ ] When volunteer marks picked up, donor sees `PICKED_UP` and optional pickup photo.
- [ ] When volunteer marks delivered, donor sees `DELIVERED` and proof photo.
- [ ] When NGO confirms receipt, donor sees `COMPLETED`, confirmed quantity, and proof.
- [ ] When NGO rejects on arrival, donor sees `REJECTED` and the reason in the timeline.
- [ ] Donor can cancel `AVAILABLE`, `ACCEPTED`, or `ASSIGNED`; status becomes `CANCELLED`.
- [ ] Cancel button is hidden for `PICKED_UP`, `DELIVERED`, `COMPLETED`, `CANCELLED`, `EXPIRED`, and `REJECTED`.
- [ ] Directly calling the cancel path on a closed donation fails without changing the row.
- [ ] Expired donation shows `Expired` with the expiry timestamp.
- [ ] Timeline expander shows status events in order.
- [ ] Loading state appears while donations are being fetched.
- [ ] Empty state appears for a donor with no donations.

## NGO flow

### Feed and matching

- [ ] Feed lists only `AVAILABLE` donations with future expiry.
- [ ] Feed is sorted by soonest `expires_at` first, then shortest distance.
- [ ] Distance filter uses the NGO radius; "Show all distances" bypasses it.
- [ ] Dismissed donations disappear from the feed.
- [ ] Hidden donations list shows dismissed items.
- [ ] Undo restores a dismissed donation to the feed.
- [ ] Empty state appears when no donations match.
- [ ] Loading state appears while the NGO dashboard loads.

### Status transitions

- [ ] NGO 1 accepts an `AVAILABLE` donation: status becomes `ACCEPTED`.
- [ ] Accepting the same donation from a second NGO tab fails with a friendly error toast.
- [ ] Direct double-accept RPC fails and leaves the row unchanged.
- [ ] Pending/rejected NGO cannot accept; error toast appears.
- [ ] Accepting an expired donation fails.
- [ ] Releasing an `ACCEPTED` donation with no volunteer returns it to `AVAILABLE`.
- [ ] Releasing after a volunteer request or assignment fails.
- [ ] Assigning Volunteer 1 creates an `assignments` row with status `requested`.
- [ ] Volunteer 1 accepts: donation becomes `ASSIGNED`.
- [ ] Volunteer 1 declines: assignment becomes `declined`, donation stays `ACCEPTED`, NGO can assign someone else.
- [ ] Volunteer request times out after 15 minutes: assignment becomes `timed_out`, NGO can assign someone else.
- [ ] NGO cancels a pending request: assignment becomes `cancelled`.
- [ ] NGO changes an assigned volunteer: previous assignment is not active and a new request is created.
- [ ] Volunteer marks picked up: donation becomes `PICKED_UP`; optional pickup photo is shown.
- [ ] Volunteer marks delivered: donation becomes `DELIVERED`; proof image is shown.
- [ ] NGO confirms receipt with valid quantity: donation becomes `COMPLETED`; confirmed quantity is shown.
- [ ] Confirm receipt with `0`, negative, or empty quantity is rejected with an error toast.
- [ ] Confirm receipt before `DELIVERED` fails with an error toast.
- [ ] NGO rejects food from `PICKED_UP` or `DELIVERED`: donation becomes `REJECTED`.
- [ ] Reject without a reason is rejected with an error toast.
- [ ] Admin cancel produces `CANCELLED` and appears in NGO history.
- [ ] History tab shows `COMPLETED`, `CANCELLED`, `EXPIRED`, and `REJECTED` with correct details.

## Volunteer flow

- [ ] Availability toggle works for `available`, `busy`, and `offline`.
- [ ] Busy/offline volunteers are not shown in the NGO volunteer picker.
- [ ] Empty state appears with no incoming requests.
- [ ] Empty state appears with no active tasks.
- [ ] Empty state appears with no history.
- [ ] Loading state appears while the volunteer dashboard loads.
- [ ] New assignment request appears with a 15-minute countdown.
- [ ] Volunteer accepts: donation becomes `ASSIGNED` and appears in My Tasks.
- [ ] Volunteer declines: request disappears; NGO sees `declined`.
- [ ] Accepting after decline fails.
- [ ] Accepting after 15 minutes fails with the expired-request error toast.
- [ ] Volunteer marks picked up without a photo: donation becomes `PICKED_UP`.
- [ ] Volunteer marks picked up with a photo: photo appears for donor and NGO.
- [ ] Mark delivered without a proof photo is blocked by form validation.
- [ ] Mark delivered with proof: donation becomes `DELIVERED`.
- [ ] "Can't make it" on `ASSIGNED` returns the donation to `ACCEPTED` and lets the NGO reassign.
- [ ] `COMPLETED` tasks show the confirmed quantity in History.
- [ ] `REJECTED` tasks show the NGO reason in History.
- [ ] Delivery failure shows an error toast and leaves the status unchanged.

## Admin flow

- [ ] Pending NGO appears in NGO Verification.
- [ ] Verify NGO: status becomes `verified`; NGO can now accept.
- [ ] Reject NGO: status becomes `rejected`; NGO cannot accept.
- [ ] Suspend a user: user is blocked from logging in on next session check.
- [ ] Reactivate a user: user can log in again.
- [ ] Admin cannot suspend their own account; error toast appears.
- [ ] Cancel donation with a reason: status becomes `CANCELLED` and event is recorded.
- [ ] Cancel with empty reason is rejected with an error toast.
- [ ] Cancel a closed donation fails and leaves the row unchanged.
- [ ] Overview totals and 14-day chart update after donation changes.
- [ ] Users filters and Donations filters work.
- [ ] Reports CSV downloads current rows.
- [ ] Loading state appears while admin data loads.
- [ ] Empty states appear for empty tables/reports.

## Status transition matrix

| From | To | Trigger | Expected result |
| --- | --- | --- | --- |
| none | `AVAILABLE` | Donor creates donation | Feed + donor dashboard show it; nearby NGOs notified |
| `AVAILABLE` | `ACCEPTED` | NGO accepts | Locked to that NGO |
| `AVAILABLE` | `CANCELLED` | Donor/Admin cancels | Disappears from NGO feed |
| `ACCEPTED` | `AVAILABLE` | NGO releases | Reappears in NGO feed |
| `ACCEPTED` | `ASSIGNED` | Volunteer accepts request | Volunteer sees active task |
| `ACCEPTED` | `CANCELLED` | Donor/Admin cancels | Assignment paths blocked |
| `ASSIGNED` | `PICKED_UP` | Volunteer marks picked up | Proof optional |
| `ASSIGNED` | `ACCEPTED` | Volunteer can't make it / NGO unassigns | NGO can reassign |
| `PICKED_UP` | `DELIVERED` | Volunteer marks delivered | Proof photo required |
| `PICKED_UP` | `REJECTED` | NGO rejects on arrival | Reason recorded |
| `DELIVERED` | `COMPLETED` | NGO confirms receipt | Confirmed quantity recorded |
| `DELIVERED` | `REJECTED` | NGO rejects on arrival | Reason recorded |
| any open | `EXPIRED` | Expiry time passes | Excluded from NGO feed; donor sees expired badge |
| any open | `CANCELLED` | Admin cancels with reason | Terminal; event recorded |

## Realtime, loading, empty, toast, and mobile checks

- [ ] Live badge is green when Realtime connects and grey when it cannot connect.
- [ ] Donation change appears without manual refresh within about 500 ms.
- [ ] 30-second polling still refreshes when Realtime is unavailable.
- [ ] Switching browser tabs away and back triggers one refresh.
- [ ] New notification increments the badge, shows a toast, and appears at the top.
- [ ] Badge shows `9+` above nine unread notifications.
- [ ] Clicking a notification marks only that row read and decreases the badge.
- [ ] "Mark all as read" clears the badge and highlights.
- [ ] Clicking outside the notification dropdown closes it.
- [ ] Error toasts are readable, stacked, and auto-close after 5 seconds.
- [ ] All dashboards and forms remain usable at 375 px width with no horizontal page scroll.
- [ ] Tables use horizontal scrolling inside their card rather than breaking the page.
- [ ] No console errors occur during normal flows; expected failures are logged quietly and toasted.
