import { assertBodySize, defineHandler } from 'nitro/h3'
import { maxSnapshotBytes } from '#/features/importing/ynab-limits'

// Count the whole stream before Start parses it, including multipart fields
// other than the snapshot. Leave room for a full-size file and its framing.
export default defineHandler((event) =>
  assertBodySize(event, maxSnapshotBytes + 64 * 1024),
)
