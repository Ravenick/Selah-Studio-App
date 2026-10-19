---
name: Hymnal archive import quirks
description: External source and licensing constraints for refreshing the Open Hymnal catalog.
---

The official Open Hymnal export is served over HTTP; HTTPS certificate validation failed in this environment. Its XML also contains an undeclared `&mdash;` entity, and individual entries carry their own copyright statements.

**Why:** the upstream is not a dependable secure browser endpoint, and a catalog-wide license statement is not a substitute for checking each hymn's rights.

**How to apply:** when refreshing the archive, validate and normalize the XML offline, preserve attribution, and only expose entries whose own record explicitly permits public-domain use.
