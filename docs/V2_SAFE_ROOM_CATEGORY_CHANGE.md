# V2 room category changes after historical stays (FL-014)

Rooms remain seven physical inventory units. A room category may be changed **immediately** when the target physical room has no live or future booking allocation and all future category commitments remain valid after the change. The server tests the entire affected future inventory inside one SQLite transaction. An allocated reservation, checked-in occupant, or existing unassigned capacity commitment that would exceed the remaining category inventory blocks the change. The room name/category and audit event roll back together on failure.

Existing historical bookings, proforma snapshots and payments are **never rewritten**. Owner/manager role and a `room.updated` event are required. This is immediate reclassification only, not a scheduled effective-dated inventory planning feature; future effective-date changes are intentionally not simulated by changing historical booking categories.

Regression includes historical checked-out stays, active assigned guests, seven-room unassigned commitments, permission denial and HTTP audit. Hotel operator must verify physical room classification before enabling a new category.
