import assert from 'node:assert/strict'
import test from 'node:test'
import { H3 } from 'nitro/h3'
import limit from './request-size.server'

test('a full 32 MiB file fits, but extra multipart fields count toward the request limit', async () => {
  const app = new H3().use(limit).post('/', async (event) => {
    const file = (await event.req.formData()).get('snapshot')
    return file instanceof File ? String(file.size) : 'no file'
  })
  const data = new FormData()
  data.set('country', 'US')
  data.set(
    'snapshot',
    new Blob([new Uint8Array(32 * 1024 * 1024)]),
    'plan.json',
  )
  const post = () =>
    app.fetch(new Request('http://test/', { method: 'POST', body: data }))
  assert.equal(await (await post()).text(), '33554432')
  data.set('extra', 'x'.repeat(64 * 1024))
  assert.equal((await post()).status, 413)
})

test('a declared oversize body is rejected unread; a chunked one is rejected before EOF', async () => {
  const app = new H3().use(limit).post('/', () => 'accepted')
  for (const declared of [true, false]) {
    let reads = 0
    const chunk = new Uint8Array(1024 * 1024)
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (++reads === 40) controller.close()
          else controller.enqueue(chunk)
        },
      },
      { highWaterMark: 0 },
    )
    const init = {
      method: 'POST',
      body,
      duplex: 'half',
      headers: declared
        ? { 'content-length': String(39 * chunk.length) }
        : new Headers(),
    }
    assert.equal(
      (await app.fetch(new Request('http://test/', init))).status,
      413,
    )
    if (declared) assert.equal(reads, 0)
    else assert.ok(reads >= 33 && reads < 40, `read ${reads} chunks`)
  }
})
